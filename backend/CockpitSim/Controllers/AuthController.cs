using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using CockpitSim.Data;
using CockpitSim.DTOs;
using CockpitSim.Services;

namespace CockpitSim.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly IJwtTokenService _jwtService;

    public AuthController(UserManager<ApplicationUser> userManager, IJwtTokenService jwtService)
    {
        _userManager = userManager;
        _jwtService = jwtService;
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequestDto request)
    {
        if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
        {
            return BadRequest(new { message = "Username and password are required." });
        }

        // 1. Fetch user from the database (FindByNameAsync normalizes, so the
        //    lookup is case-insensitive like the old mock behaviour).
        var user = await _userManager.FindByNameAsync(request.Username);

        if (user == null)
        {
            return Unauthorized(new { message = "Invalid username or password." });
        }

        // 2. Verify hashed password via Identity (PBKDF2).
        bool isValidPassword = await _userManager.CheckPasswordAsync(user, request.Password);
        if (!isValidPassword)
        {
            return Unauthorized(new { message = "Invalid username or password." });
        }

        // 3. Resolve role from Identity roles (seeded lowercase).
        var roles = await _userManager.GetRolesAsync(user);
        var role = roles.FirstOrDefault() ?? string.Empty;

        // 4. Stamp last login.
        user.LastLoginAt = DateTime.UtcNow;
        await _userManager.UpdateAsync(user);

        // 5. Generate JWT + return basic profile info.
        var token = _jwtService.GenerateToken(user, role);

        return Ok(new AuthResponseDto
        {
            Token = token,
            UserId = user.Id,
            Username = user.UserName ?? string.Empty,
            FullName = user.FullName,
            Role = role,
            AssignedTrainerId = user.AssignedTrainerId
        });
    }
}
