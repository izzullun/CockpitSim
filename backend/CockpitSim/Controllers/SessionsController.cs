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
    private readonly InfluxService _influx;

    public SessionsController(ApplicationDbContext db, InfluxService influx)
    {
        _db = db;
        _influx = influx;
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

    // Live telemetry snapshot for the trainer's in-session view.
    // Polls InfluxDB (last 30s for this session) and shapes the SessionReport
    // contract with score: null — grading happens once at session-end, never
    // on read. Unknown scenarios and missing telemetry return honest empties.
    // ponytail: polling (1s hover cadence from the dashboard); upgrade to
    // SignalR only if sub-second in-session alerts are ever required.
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

        var scenarioKey = ScenarioMetrics.NormalizeScenarioKey(session.Scenario);
        var report = new SessionReportDto
        {
            SessionId = session.Id,
            Scenario = scenarioKey,
            Status = session.Status,
            StartedAt = session.StartedAt,
            EndedAt = session.EndedAt,
            Score = null,
        };

        var defs = ScenarioMetrics.ForScenario(scenarioKey);
        if (defs.Count == 0)
        {
            report.Warnings.Add($"Scenario '{session.Scenario}' has no live metric set yet.");
            return Ok(report);
        }

        var latest = await _influx.GetLatestAsync(session.Id, TimeSpan.FromSeconds(30), ct);
        foreach (var def in defs)
        {
            report.Metrics.Add(ScenarioMetrics.ToReport(def, latest));
        }

        if (latest.Count == 0)
        {
            report.Warnings.Add(
                _influx.IsConfigured
                    ? "No telemetry in the last 30s — is the bridge running for this session?"
                    : "Telemetry backend not configured — no live data available.");
            return Ok(report);
        }

        foreach (var metric in report.Metrics)
        {
            if (metric.WithinTol == false)
            {
                report.Warnings.Add(
                    $"{metric.Label} {metric.Actual}{metric.Unit} outside " +
                    $"±{metric.Tolerance} of target {metric.Target}{metric.Unit}");
            }
        }

        return Ok(report);
    }

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
