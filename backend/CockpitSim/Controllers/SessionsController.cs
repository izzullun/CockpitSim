using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using CockpitSim.Data;
using CockpitSim.DTOs;
using CockpitSim.Models;

namespace CockpitSim.Controllers;

// Trainer-only endpoints for monitoring trainees and leaving feedback.
[Authorize(Policy = "RequireTrainer")]
[ApiController]
[Route("api/sessions")]
public class SessionsController : ControllerBase
{
    private readonly ApplicationDbContext _db;

    public SessionsController(ApplicationDbContext db)
    {
        _db = db;
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
