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
    private readonly IConfiguration _config;

    public AuthController(UserManager<ApplicationUser> userManager, IJwtTokenService jwtService, IConfiguration config)
    {
        _userManager = userManager;
        _jwtService = jwtService;
        _config = config;
    }

    // SPIKE (throwaway): public trainer self-registration gated by a shared
    // code. Model B (per-invite one-time codes) later swaps only
    // ValidateRegistrationCode — see plan appendix.
    [HttpPost("register-trainer")]
    public async Task<IActionResult> RegisterTrainer([FromBody] RegisterTrainerRequestDto request)
    {
        if (string.IsNullOrWhiteSpace(request.FullName)
            || string.IsNullOrWhiteSpace(request.Email)
            || string.IsNullOrWhiteSpace(request.Username)
            || string.IsNullOrWhiteSpace(request.Password))
        {
            return BadRequest(new { message = "All fields are required." });
        }

        if (!ValidateRegistrationCode(request.RegistrationCode))
        {
            return Unauthorized(new { message = "Invalid registration code." });
        }

        // Role is forced server-side — never accepted from the body.
        var existing = await _userManager.FindByNameAsync(request.Username);
        if (existing != null)
        {
            return BadRequest(new { message = "Username is already taken." });
        }

        var user = new ApplicationUser
        {
            UserName = request.Username,
            Email = request.Email,
            FullName = request.FullName
        };

        var result = await _userManager.CreateAsync(user, request.Password);
        if (!result.Succeeded)
        {
            var firstError = result.Errors.FirstOrDefault()?.Description ?? "Registration failed.";
            return BadRequest(new { message = firstError });
        }

        await _userManager.AddToRoleAsync(user, "trainer");

        var roles = await _userManager.GetRolesAsync(user);
        var token = _jwtService.GenerateToken(user, roles.FirstOrDefault() ?? "trainer");

        return Ok(new AuthResponseDto
        {
            Token = token,
            UserId = user.Id,
            Username = user.UserName ?? string.Empty,
            FullName = user.FullName,
            Role = "trainer"
        });
    }

    // Model A: shared code from config, env-overridable via Registration__TrainerCode.
    private bool ValidateRegistrationCode(string? code)
    {
        var expected = _config["Registration:TrainerCode"]
            ?? Environment.GetEnvironmentVariable("Registration__TrainerCode");
        return !string.IsNullOrWhiteSpace(expected)
            && !string.IsNullOrWhiteSpace(code)
            && string.Equals(code.Trim(), expected.Trim(), StringComparison.Ordinal);
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
