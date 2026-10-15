using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
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
    private readonly UserManager<ApplicationUser> _userManager;

    public TraineesController(ApplicationDbContext db, UserManager<ApplicationUser> userManager)
    {
        _db = db;
        _userManager = userManager;
    }

    // SPIKE (throwaway): trainer creates a trainee account.
    // AssignedTrainerId comes from the logged-in trainer's JWT — never the body.
    [HttpPost]
    public async Task<IActionResult> CreateTrainee([FromBody] CreateTraineeRequestDto request)
    {
        if (string.IsNullOrWhiteSpace(request.FullName)
            || string.IsNullOrWhiteSpace(request.Email)
            || string.IsNullOrWhiteSpace(request.Username)
            || string.IsNullOrWhiteSpace(request.Password))
        {
            return BadRequest(new { message = "All fields are required." });
        }

        var trainerId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (trainerId == null) return Unauthorized();

        var existing = await _userManager.FindByNameAsync(request.Username);
        if (existing != null)
        {
            return BadRequest(new { message = "Username is already taken." });
        }

        var user = new ApplicationUser
        {
            UserName = request.Username,
            Email = request.Email,
            FullName = request.FullName,
            AssignedTrainerId = trainerId
        };

        var result = await _userManager.CreateAsync(user, request.Password);
        if (!result.Succeeded)
        {
            var firstError = result.Errors.FirstOrDefault()?.Description ?? "Failed to create trainee.";
            return BadRequest(new { message = firstError });
        }

        await _userManager.AddToRoleAsync(user, "trainee");

        return Created($"/api/trainees/{user.Id}", new { traineeId = user.Id });
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
}
