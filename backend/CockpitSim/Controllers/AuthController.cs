using Microsoft.AspNetCore.Mvc;
using CockpitSim.DTOs;
using CockpitSim.Models;
using CockpitSim.Services;

namespace CockpitSim.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly IJwtTokenService _jwtService;

    // Temporary mock data matching your CockpitSim user schema for local testing
    private static readonly List<User> _mockUsers = new()
    {
        new User
        {
            UserId = 1,
            Username = "trainer_lim",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("password123"),
            FullName = "Lim Wei Jian",
            Role = "trainer",
            AssignedTrainerId = null
        },
        new User
        {
            UserId = 2,
            Username = "trainee_adam",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("password123"),
            FullName = "Adam Haikal",
            Role = "trainee",
            AssignedTrainerId = 1
        },
        new User
        {
            UserId = 3,
            Username = "trainee_siti",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("password123"),
            FullName = "Siti Nur",
            Role = "trainee",
            AssignedTrainerId = 1
        }
    };

    public AuthController(IJwtTokenService jwtService)
    {
        _jwtService = jwtService;
    }

    [HttpPost("login")]
    public IActionResult Login([FromBody] LoginRequestDto request)
    {
        if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
        {
            return BadRequest(new { message = "Username and password are required." });
        }

        // 1. Fetch user from mock list
        var user = _mockUsers.FirstOrDefault(u => u.Username.Equals(request.Username, StringComparison.OrdinalIgnoreCase));
        
        if (user == null)
        {
            return Unauthorized(new { message = "Invalid username or password." });
        }

        // 2. Verify hashed password (BCrypt)
        bool isValidPassword = BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash);
        if (!isValidPassword)
        {
            return Unauthorized(new { message = "Invalid username or password." });
        }

        // 3. Generate JWT
        var token = _jwtService.GenerateToken(user);

        // 4. Update last_login timestamp
        user.LastLogin = DateTime.UtcNow;

        // 5. Return JWT + basic profile info
        return Ok(new AuthResponseDto
        {
            Token = token,
            UserId = user.UserId,
            Username = user.Username,
            FullName = user.FullName,
            Role = user.Role,
            AssignedTrainerId = user.AssignedTrainerId
        });
    }
}