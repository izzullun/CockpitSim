using System.Globalization;
using System.Net.Http.Headers;
using System.Text;

namespace CockpitSim.Telemetry;

// Minimal InfluxDB v2 writer over raw line protocol — dependency-free
// (System.Net.Http only) so the bridge stays a single small project.
// Contract with the backend: measurement `heli_telemetry`, tags
// `sessionId` + `scenario`, millisecond precision.
public sealed class InfluxWriter : IDisposable
{
    private const string Measurement = "heli_telemetry";

    private readonly HttpClient _http = new();
    private readonly string _writeUrl;

    public InfluxWriter(string baseUrl, string org, string bucket, string token)
    {
        _http.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Token", token);
        _writeUrl =
            $"{baseUrl.TrimEnd('/')}/api/v2/write" +
            $"?org={Uri.EscapeDataString(org)}" +
            $"&bucket={Uri.EscapeDataString(bucket)}" +
            "&precision=ms";
    }

    public static string ToLineProtocol(HoverSample s, string sessionId, string scenario, string source = "mock")
    {
        var sb = new StringBuilder(Measurement);
        sb.Append(",sessionId=").Append(EscapeTag(sessionId));
        sb.Append(",scenario=").Append(EscapeTag(scenario));
        sb.Append(",source=").Append(EscapeTag(source));
        sb.Append(' ');

        var first = true;
        void Field(string key, double value)
        {
            if (double.IsNaN(value) || double.IsInfinity(value)) return; // never store bogus zeros
            if (!first) sb.Append(',');
            first = false;
            sb.Append(key).Append('=').Append(value.ToString("R", CultureInfo.InvariantCulture));
        }

        Field("ground_velocity_kt", s.GroundVelocityKt);
        Field("radar_alt_ft", s.RadarAltFt);
        Field("heading_true_deg", s.HeadingTrueDeg);
        Field("vel_body_x", s.VelBodyX);
        Field("vel_body_z", s.VelBodyZ);
        Field("vertical_speed_fpm", s.VerticalSpeedFpm);
        Field("bank_deg", s.BankDeg);
        Field("pitch_deg", s.PitchDeg);
        Field("collective_pct", s.CollectivePct);
        Field("on_ground", s.OnGround ? 1.0 : 0.0);

        if (first) return string.Empty; // no valid fields — skip the sample
        sb.Append(' ').Append(s.Timestamp.ToUnixTimeMilliseconds());
        return sb.ToString();
    }

    // One POST per batch (caller accumulates ~1s of samples) — avoids an
    // HTTP round-trip per sample at 10–20 Hz on localhost.
    public async Task WriteBatchAsync(IEnumerable<string> lines, CancellationToken ct)
    {
        var payload = string.Join('\n', lines.Where(l => l.Length > 0));
        if (payload.Length == 0) return;

        using var content = new StringContent(payload, Encoding.UTF8, "text/plain");
        using var response = await _http.PostAsync(_writeUrl, content, ct);
        response.EnsureSuccessStatusCode();
    }

    private static string EscapeTag(string value) =>
        value.Replace("\\", "\\\\").Replace(",", "\\,").Replace(" ", "\\ ").Replace("=", "\\=");

    public void Dispose() => _http.Dispose();
}
