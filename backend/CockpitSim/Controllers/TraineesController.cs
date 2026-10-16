using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using CockpitSim.Data;
using CockpitSim.DTOs;

namespace CockpitSim.Controllers;

[Authorize(Policy = "RequireTrainer")]
[ApiController]
[Route("api/trainees")]
public class TraineesController : ControllerBase
{
    private readonly ApplicationDbContext _db;

    public TraineesController(ApplicationDbContext db)
    {
        _db = db;
    }

    // Feedback notes across ALL of a trainee's sessions, newest first.
    // Only reachable for trainees assigned to the logged-in trainer.
    [HttpGet("{traineeId}/notes")]
    public IActionResult GetNotes(string traineeId)
    {
        var trainerId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (trainerId == null) return Unauthorized();

        var isAssigned = _db.Users.Any(u => u.Id == traineeId && u.AssignedTrainerId == trainerId);
        if (!isAssigned) return Forbid();

        var notes = _db.SessionNotes
            .Where(n => _db.Sessions.Any(s => s.Id == n.SessionId && s.TraineeId == traineeId))
            .OrderByDescending(n => n.CreatedAt)
            .Join(_db.Users, n => n.AuthorId, u => u.Id, (n, u) => new TraineeNoteDto
            {
                Author = u.FullName,
                CreatedAt = n.CreatedAt,
                Note = n.Note,
                SessionId = n.SessionId
            })
            .ToList();

        return Ok(notes);
    }

    // List of the logged-in trainer's trainees, including their configured
    // session duration limit (null = default fallback applied at start).
    [HttpGet]
    public async Task<IActionResult> GetTrainees()
    {
        var trainerId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (trainerId == null) return Unauthorized();

        var trainees = await _db.Users
            .Where(u => u.AssignedTrainerId == trainerId)
            .OrderBy(u => u.FullName)
            .Select(u => new TraineeSettingsDto
            {
                TraineeId = u.Id,
                FullName = u.FullName,
                Username = u.UserName ?? string.Empty,
                SessionDurationMinutes = u.SessionDurationMinutes,
            })
            .ToListAsync();

        return Ok(trainees);
    }

    // Set the per-trainee session duration limit. Constrained to 5–60 minutes
    // in 5-minute steps (validated server-side; the UI uses a dropdown).
    [HttpPut("{traineeId}/session-duration")]
    public async Task<IActionResult> SetSessionDuration(
        string traineeId, [FromBody] SetSessionDurationRequestDto request)
    {
        var trainerId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (trainerId == null) return Unauthorized();

        var minutes = request.Minutes;
        if (minutes < 5 || minutes > 60 || minutes % 5 != 0)
        {
            return BadRequest(new
            {
                message = "Duration must be between 5 and 60 minutes in 5-minute steps."
            });
        }

        var trainee = await _db.Users
            .FirstOrDefaultAsync(u => u.Id == traineeId && u.AssignedTrainerId == trainerId);
        if (trainee == null) return Forbid();

        trainee.SessionDurationMinutes = minutes;
        await _db.SaveChangesAsync();

        return Ok(new { traineeId, sessionDurationMinutes = minutes });
    }
}
