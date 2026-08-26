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
                Note = n.Note
            })
            .ToList();

        return Ok(notes);
    }
}
