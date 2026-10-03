using System.Net;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using CockpitSim.Data;

namespace CockpitSim.Controllers;

// Machine-to-machine endpoint for the telemetry bridge: "which session is
// active right now?" so operators never paste session ids by hand.
// Trust model (documented ponytail — revisit if this ever leaves the single
// demo PC): caller proves localhost (loopback gate) AND knowledge of the
// Influx token (X-Bridge-Token header, constant-time compare). No JWT, no
// login. Fail-closed: with no token configured, every call is 401.
[AllowAnonymous]
[ApiController]
[Route("api/bridge")]
public class BridgeController : ControllerBase
{
    private const string TokenHeader = "X-Bridge-Token";

    private readonly ApplicationDbContext _db;
    private readonly string _token;

    public BridgeController(ApplicationDbContext db, IConfiguration config)
    {
        _db = db;
        _token = config["Influx:Token"]
            ?? Environment.GetEnvironmentVariable("INFLUX_TOKEN")
            ?? string.Empty;
    }

    // Most recently started in_progress session, or 204 when none is active.
    [HttpGet("active")]
    public async Task<IActionResult> GetActive(CancellationToken ct)
    {
        var remote = HttpContext.Connection.RemoteIpAddress;
        if (remote == null || !IPAddress.IsLoopback(remote))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                new { message = "Bridge API is localhost-only." });
        }

        var presented = Request.Headers[TokenHeader].FirstOrDefault() ?? string.Empty;
        if (!TokensEqual(presented, _token))
        {
            return Unauthorized(new { message = "Bad or missing bridge token." });
        }

        var session = await _db.Sessions
            .Where(s => s.Status == "in_progress")
            .OrderByDescending(s => s.StartedAt)
            .Select(s => new { sessionId = s.Id, scenario = s.Scenario ?? "hover", startedAt = s.StartedAt })
            .FirstOrDefaultAsync(ct);

        if (session == null) return NoContent();
        return Ok(session);
    }

    private static bool TokensEqual(string presented, string configured)
    {
        if (string.IsNullOrEmpty(configured)) return false; // fail closed
        var a = Encoding.UTF8.GetBytes(presented);
        var b = Encoding.UTF8.GetBytes(configured);
        if (a.Length != b.Length) return false;
        return CryptographicOperations.FixedTimeEquals(a, b);
    }
}
