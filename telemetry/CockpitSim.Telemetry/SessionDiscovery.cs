using System.Text.Json;

namespace CockpitSim.Telemetry;

// Resolves the active session from the backend (GET /api/bridge/active) so
// --session can be omitted: localhost call, pre-shared token header, no login.
// Throws UnauthorizedAccessException on 401/403 (fail loud, never guess).
public sealed class SessionDiscovery : IDisposable
{
    private readonly HttpClient _http = new();
    private readonly string _activeUrl;

    public sealed record ActiveSession(string SessionId, string Scenario, DateTimeOffset StartedAt);

    public SessionDiscovery(string backendBaseUrl, string token)
    {
        _activeUrl = $"{backendBaseUrl.TrimEnd('/')}/api/bridge/active";
        // Dedicated header (NOT Authorization) — matches the backend's
        // Request.Headers["X-Bridge-Token"] lookup, keeps tokens out of URLs.
        _http.DefaultRequestHeaders.Add("X-Bridge-Token", token);
    }

    // Null = no active session (HTTP 204). Anything else returns the session.
    public async Task<ActiveSession?> GetActiveAsync(CancellationToken ct)
    {
        using var response = await _http.GetAsync(_activeUrl, ct);
        if (response.StatusCode == System.Net.HttpStatusCode.NoContent) return null;
        if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized ||
            response.StatusCode == System.Net.HttpStatusCode.Forbidden)
        {
            throw new UnauthorizedAccessException(
                "Backend rejected the bridge token (401/403). " +
                "Check INFLUX_TOKEN / .env matches the backend's token.");
        }
        response.EnsureSuccessStatusCode();

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        var root = doc.RootElement;
        return new ActiveSession(
            root.GetProperty("sessionId").GetString() ?? string.Empty,
            root.TryGetProperty("scenario", out var sc) ? sc.GetString() ?? "hover" : "hover",
            root.TryGetProperty("startedAt", out var st) && st.TryGetDateTimeOffset(out var at)
                ? at : DateTimeOffset.UtcNow);
    }

    public void Dispose() => _http.Dispose();
}
