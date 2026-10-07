using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using CockpitSim.Data;
using CockpitSim.DTOs;
using CockpitSim.Models;
using CockpitSim.Services;

namespace CockpitSim.Controllers;

// Trainer-only endpoints for monitoring trainees and leaving feedback.
[Authorize(Policy = "RequireTrainer")]
[ApiController]
[Route("api/sessions")]
public class SessionsController : ControllerBase
{
    private readonly ApplicationDbContext _db;
    private readonly LiveReportService _live;

    public SessionsController(ApplicationDbContext db, LiveReportService live)
    {
        _db = db;
        _live = live;
    }

    private string? CurrentUserId =>
        User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;

    // Ids of trainees assigned to the logged-in trainer.
    private List<string> AssignedTraineeIds()
    {
        var trainerId = CurrentUserId!;
        return _db.Users
            .Where(u => u.AssignedTrainerId == trainerId)
            .Select(u => u.Id)
            .ToList();
    }

    // Session queue: all sessions belonging to the trainer's assigned trainees,
    // newest first. The dashboard groups these per trainee to build the roster.
    [HttpGet("queue")]
    public IActionResult GetQueue()
    {
        var traineeIds = AssignedTraineeIds();

        var queue = _db.Sessions
            .Where(s => s.TraineeId != null && traineeIds.Contains(s.TraineeId))
            .OrderByDescending(s => s.StartedAt)
            .Join(_db.Users, s => s.TraineeId, u => u.Id, (s, u) => new QueueItemDto
            {
                SessionId = s.Id,
                TraineeId = s.TraineeId,
                TraineeFullName = u.FullName,
                TraineeUsername = u.UserName ?? string.Empty,
                Scenario = s.Scenario ?? string.Empty,
                Status = s.Status,
                StartedAt = s.StartedAt,
                EndedAt = s.EndedAt
            })
            .ToList();

        return Ok(queue);
    }

    // Live telemetry snapshot for the trainer's in-session view. Shaped by the
    // shared LiveReportService (score: null — grading happens once at
    // session-end, never on read). Trainee mirror: GET /api/me/sessions/{id}/live.
    [HttpGet("{id}/live")]
    public async Task<IActionResult> GetLive(string id, CancellationToken ct)
    {
        var session = await _db.Sessions.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (session == null) return NotFound(new { message = "Session not found." });

        var traineeIds = AssignedTraineeIds();
        if (!traineeIds.Contains(session.TraineeId))
        {
            return Forbid();
        }

        return Ok(await _live.BuildAsync(session, ct));
    }

    // Feedback coverage: per-trainee completed vs reviewed sessions.
    // Reviewed = completed session with >=1 note. Powers the trainer
    // "Awaiting feedback" card without N+1 /notes calls. The dashboard keeps
    // its trainee-level fallback when this endpoint is unreachable.
    [HttpGet("feedback-coverage")]
    public IActionResult GetFeedbackCoverage()
    {
        var traineeIds = AssignedTraineeIds();

        var sessions = _db.Sessions
            .Where(s => s.TraineeId != null && traineeIds.Contains(s.TraineeId))
            .ToList();

        var reviewedSessionIds = _db.SessionNotes
            .Where(n => sessions.Select(s => s.Id).Contains(n.SessionId))
            .Select(n => n.SessionId)
            .Distinct()
            .ToHashSet();

        var trainees = _db.Users
            .Where(u => traineeIds.Contains(u.Id))
            .ToDictionary(u => u.Id, u => u.FullName);

        var items = new List<FeedbackCoverageItemDto>();
        foreach (var traineeId in traineeIds)
        {
            var completed = sessions
                .Where(s => s.TraineeId == traineeId && s.Status == "completed")
                .ToList();
            if (completed.Count == 0) continue;

            var reviewed = completed.Count(s => reviewedSessionIds.Contains(s.Id));
            items.Add(new FeedbackCoverageItemDto
            {
                TraineeId = traineeId,
                TraineeFullName = trainees.TryGetValue(traineeId, out var name) ? name : traineeId,
                CompletedSessions = completed.Count,
                ReviewedSessions = reviewed,
                AwaitingSessions = completed.Count - reviewed,
            });
        }

        return Ok(new FeedbackCoverageDto
        {
            AwaitingTrainees = items.Count(i => i.AwaitingSessions > 0),
            AwaitingSessions = items.Sum(i => i.AwaitingSessions),
            TotalCompleted = items.Sum(i => i.CompletedSessions),
            Items = items,
        });
    }

    // Immutable post-session snapshot for a session of one of the trainer's
    // trainees. Same stored payload as the trainee mirror
    // (GET /api/me/sessions/{id}/report): the JSON is returned verbatim
    // (never recomputed); only trainer notes are merged live since they are
    // annotations written after grading.
    // 404 = session predates grading or was never graded.
    [HttpGet("{id}/report")]
    public async Task<IActionResult> GetReport(string id)
    {
        var session = await _db.Sessions.FirstOrDefaultAsync(s => s.Id == id);
        if (session == null) return NotFound(new { message = "Session not found." });

        var traineeIds = AssignedTraineeIds();
        if (!traineeIds.Contains(session.TraineeId))
        {
            return Forbid();
        }

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

    // Attach a feedback note to a session (trainer must own the session's trainee).
    [HttpPost("{id}/feedback")]
    public async Task<IActionResult> AddFeedback(string id, [FromBody] FeedbackRequestDto request)
    {
        if (string.IsNullOrWhiteSpace(request.Note))
        {
            return BadRequest(new { message = "Note text is required." });
        }

        var session = await _db.Sessions.FirstOrDefaultAsync(s => s.Id == id);
        if (session == null) return NotFound(new { message = "Session not found." });

        var traineeIds = AssignedTraineeIds();
        if (!traineeIds.Contains(session.TraineeId))
        {
            return Forbid();
        }

        var authorId = CurrentUserId;
        if (authorId == null) return Unauthorized();

        _db.SessionNotes.Add(new SessionNote
        {
            SessionId = session.Id,
            AuthorId = authorId,
            Note = request.Note.Trim(),
            CreatedAt = DateTime.UtcNow
        });
        await _db.SaveChangesAsync();

        return Ok(new { message = "Feedback saved." });
    }
}
