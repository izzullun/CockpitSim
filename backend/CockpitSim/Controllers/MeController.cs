using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using CockpitSim.Data;
using CockpitSim.DTOs;

namespace CockpitSim.Controllers;

[Authorize]
[ApiController]
[Route("api/me")]
public class MeController : ControllerBase
{
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly Data.ApplicationDbContext _db;

    public MeController(UserManager<ApplicationUser> userManager, Data.ApplicationDbContext db)
    {
        _userManager = userManager;
        _db = db;
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
            AssignedTrainerName = trainerName
        });
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
