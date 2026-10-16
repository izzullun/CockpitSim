using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using CockpitSim.Data;
using CockpitSim.DTOs;
using CockpitSim.Models;
using CockpitSim.Services;

namespace CockpitSim.Controllers;

[Authorize]
[ApiController]
[Route("api/me")]
public class MeController : ControllerBase
{
    // Fallback when the trainer hasn't configured a per-trainee duration.
    private const int DefaultSessionMinutes = 25;

    private readonly UserManager<ApplicationUser> _userManager;
    private readonly Data.ApplicationDbContext _db;
    private readonly LiveReportService _live;

    public MeController(
        UserManager<ApplicationUser> userManager,
        Data.ApplicationDbContext db,
        LiveReportService live)
    {
        _userManager = userManager;
        _db = db;
        _live = live;
    }

    // Profile for the logged-in user, including their assigned trainer's name.
    [HttpGet]
    public async Task<IActionResult> GetProfile()
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (userId == null) return Unauthorized();

        var user = await _userManager.FindByIdAsync(userId);
        if (user == null) return Unauthorized();

        string? trainerName = null;
        if (user.AssignedTrainerId != null)
        {
            var trainer = await _userManager.FindByIdAsync(user.AssignedTrainerId);
            trainerName = trainer?.FullName;
        }

        return Ok(new MeResponseDto
        {
            UserId = user.Id,
            Username = user.UserName ?? string.Empty,
            FullName = user.FullName,
            Role = (await _userManager.GetRolesAsync(user)).FirstOrDefault() ?? string.Empty,
            LastLoginAt = user.LastLoginAt,
            AssignedTrainerName = trainerName,
            SessionDurationMinutes = user.SessionDurationMinutes ?? DefaultSessionMinutes,
        });
    }

    // Start a new training session for the logged-in trainee. One active
    // session at a time (409 while one is in_progress). The returned id is
    // what the telemetry bridge tags its Influx points with.
    [HttpPost("sessions/start")]
    [Authorize(Policy = "RequireTrainee")]
    public async Task<IActionResult> StartSession([FromBody] StartSessionRequestDto request)
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (userId == null) return Unauthorized();

        if (!ScenarioMetrics.TryParseKey(request.Scenario, out var scenarioKey))
        {
            return BadRequest(new
            {
                message = $"Unknown scenario '{request.Scenario}'. " +
                    $"Use one of: {string.Join(", ", ScenarioMetrics.KnownKeys)}."
            });
        }

        var active = _db.Sessions
            .FirstOrDefault(s => s.TraineeId == userId && s.Status == "in_progress");
        if (active != null)
        {
            return Conflict(new { message = "A session is already in progress.", sessionId = active.Id });
        }

        var user = await _userManager.FindByIdAsync(userId);
        var session = new TrainingSession
        {
            TraineeId = userId,
            TrainerId = user?.AssignedTrainerId,
            Scenario = scenarioKey,
            StartedAt = DateTime.UtcNow,
            Status = "in_progress",
            TimeLimitMinutes = user?.SessionDurationMinutes ?? DefaultSessionMinutes,
        };
        _db.Sessions.Add(session);
        await _db.SaveChangesAsync();

        return Ok(new
        {
            sessionId = session.Id,
            scenario = session.Scenario,
            timeLimitMinutes = session.TimeLimitMinutes,
        });
    }

    // End the trainee's own in-progress session. Grading runs here, once —
    // the stored snapshot is never recomputed on read.
    [HttpPost("sessions/{id}/end")]
    [Authorize(Policy = "RequireTrainee")]
    public async Task<IActionResult> EndSession(
        string id, [FromServices] GradingService grading)
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (userId == null) return Unauthorized();

        var session = await _db.Sessions.FirstOrDefaultAsync(s => s.Id == id);
        if (session == null) return NotFound(new { message = "Session not found." });
        if (session.TraineeId != userId) return Forbid();
        if (session.Status != "in_progress")
        {
            return Conflict(new { message = $"Session is {session.Status}, not in_progress." });
        }

        session.EndedAt = DateTime.UtcNow;
        session.Status = "completed";
        await _db.SaveChangesAsync();

        var score = await grading.GradeAsync(session.Id);
        return Ok(new { sessionId = session.Id, status = session.Status, score });
    }

    // Immutable post-session snapshot for the trainee's own session. The stored
    // JSON is returned verbatim (never recomputed); only trainer notes are
    // merged live since they are annotations written after grading.
    // 404 = session predates grading or was never graded.
    [HttpGet("sessions/{id}/report")]
    [Authorize(Policy = "RequireTrainee")]
    public async Task<IActionResult> GetReport(string id)
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (userId == null) return Unauthorized();

        var session = await _db.Sessions.FirstOrDefaultAsync(s => s.Id == id);
        if (session == null) return NotFound(new { message = "Session not found." });
        if (session.TraineeId != userId) return Forbid();

        var stored = await _db.Reports.FirstOrDefaultAsync(r => r.SessionId == id);
        if (stored == null)
        {
            return NotFound(new { message = "No report for this session yet." });
        }

        SessionReportDto report;
        try
        {
            report = System.Text.Json.JsonSerializer.Deserialize<SessionReportDto>(
                stored.MetricsJson, GradingService.JsonOptions)
                ?? throw new InvalidOperationException("Null report payload.");
        }
        catch
        {
            return StatusCode(500, new { message = "Stored report is unreadable." });
        }

        report.Notes = await LoadNotesAsync(id);
        return Ok(report);
    }

    // Trainer feedback on the trainee's own session. Notes are trainer-written
    // in SessionsController/TraineesController; this is the trainee-readable
    // mirror (closes the pre-session.js TODO).
    [HttpGet("sessions/{id}/notes")]
    [Authorize(Policy = "RequireTrainee")]
    public async Task<IActionResult> GetSessionNotes(string id)
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (userId == null) return Unauthorized();

        var session = await _db.Sessions.FirstOrDefaultAsync(s => s.Id == id);
        if (session == null) return NotFound(new { message = "Session not found." });
        if (session.TraineeId != userId) return Forbid();

        return Ok(await LoadNotesAsync(id));
    }

    private async Task<List<ReportNoteDto>> LoadNotesAsync(string sessionId) =>
        await _db.SessionNotes
            .Where(n => n.SessionId == sessionId)
            .OrderBy(n => n.CreatedAt)
            .Join(_db.Users, n => n.AuthorId, u => u.Id, (n, u) => new ReportNoteDto
            {
                Author = u.FullName,
                CreatedAt = n.CreatedAt,
                Note = n.Note,
            })
            .ToListAsync();

    // Live snapshot of the trainee's own session for the session-ongoing page.
    // Same builder as the trainer endpoint (shared LiveReportService) —
    // the ongoing view polls this every second and redirects to the report
    // once the session completes.
    [HttpGet("sessions/{id}/live")]
    [Authorize(Policy = "RequireTrainee")]
    public async Task<IActionResult> GetLive(string id, CancellationToken ct)
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (userId == null) return Unauthorized();

        var session = await _db.Sessions.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (session == null) return NotFound(new { message = "Session not found." });
        if (session.TraineeId != userId) return Forbid();

        return Ok(await _live.BuildAsync(session, ct));
    }

    // The logged-in trainee's own session history (oldest first).
    [HttpGet("sessions")]
    public IActionResult GetMySessions()
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (userId == null) return Unauthorized();

        var sessions = _db.Sessions
            .Where(s => s.TraineeId == userId)
            .OrderBy(s => s.StartedAt)
            .ToList();

        var result = sessions.Select((s, index) => new SessionDto
        {
            SessionId = s.Id,
            Scenario = s.Scenario ?? string.Empty,
            StartedAt = s.StartedAt,
            EndedAt = s.EndedAt,
            Status = s.Status,
            Attempt = index + 1
        });

        return Ok(result);
    }
}
