using System.Net.Http.Headers;
using System.Text;

namespace CockpitSim.Services;

// Reads live telemetry back out of InfluxDB for the dashboard pipeline.
// Dashboards never query Influx directly (auth lives here, JWT-gated) —
// the backend polls the last N seconds and shapes the SessionReport.
// Raw HttpClient + Flux, no extra NuGet (mirrors the bridge's writer).
public sealed class InfluxService : IDisposable
{
    private readonly HttpClient _http = new();
    private readonly string _queryUrl;
    private readonly string _bucket;
    private readonly string _token;
    private readonly ILogger<InfluxService> _logger;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_token);

    public InfluxService(IConfiguration config, ILogger<InfluxService> logger)
    {
        _logger = logger;
        var baseUrl = config["Influx:Url"] ?? "http://localhost:8086";
        var org = config["Influx:Org"] ?? "cockpitsim";
        _bucket = config["Influx:Bucket"] ?? "telemetry";
        // appsettings / Influx__Token env first, plain INFLUX_TOKEN as fallback
        // (same variable the bridge uses, so one export serves both).
        _token = config["Influx:Token"]
            ?? Environment.GetEnvironmentVariable("INFLUX_TOKEN")
            ?? string.Empty;

        _queryUrl = $"{baseUrl.TrimEnd('/')}/api/v2/query?org={Uri.EscapeDataString(org)}";
        if (IsConfigured)
        {
            _http.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Token", _token);
        }
    }

    // Latest value per field for one session within the lookback window.
    // Returns field -> (value, timestamp). Empty when unconfigured or no data —
    // callers render the honest empty state, never fake numbers.
    public async Task<Dictionary<string, (double Value, DateTimeOffset At)>> GetLatestAsync(
        string sessionId, TimeSpan lookback, CancellationToken ct = default)
    {
        var empty = new Dictionary<string, (double, DateTimeOffset)>();
        if (!IsConfigured)
        {
            _logger.LogWarning("Influx token not configured — live telemetry unavailable.");
            return empty;
        }

        var flux =
            $"from(bucket:\"{Escape(_bucket)}\") " +
            $"|> range(start:-{(int)lookback.TotalSeconds}s) " +
            $"|> filter(fn:(r) => r._measurement == \"heli_telemetry\" " +
            $"and r.sessionId == \"{Escape(sessionId)}\") " +
            "|> last()";

        string csv;
        try
        {
            using var content = new StringContent(flux, Encoding.UTF8, "application/vnd.flux");
            using var response = await _http.PostAsync(_queryUrl, content, ct);
            response.EnsureSuccessStatusCode();
            csv = await response.Content.ReadAsStringAsync(ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Influx query failed for session {SessionId}.", sessionId);
            return empty;
        }

        return ParseAnnotatedCsv(csv);
    }

    // Minimal parser for Influx annotated CSV: finds the header row, maps the
    // _field / _value / _time columns, one entry per field (last() => single row).
    internal static Dictionary<string, (double Value, DateTimeOffset At)> ParseAnnotatedCsv(string csv)
    {
        var result = new Dictionary<string, (double, DateTimeOffset)>(StringComparer.Ordinal);
        string[]? header = null;

        foreach (var rawLine in csv.Split('\n'))
        {
            var line = rawLine.TrimEnd('\r');
            if (line.Length == 0 || line.StartsWith('#')) continue;

            var cells = SplitCsv(line);
            if (header == null)
            {
                // Header row is the first non-annotation line (starts with empty/space then "result").
                if (cells.Length > 2 && cells[2] == "table") { header = cells; }
                continue;
            }

            int fieldIdx = Array.IndexOf(header, "_field");
            int valueIdx = Array.IndexOf(header, "_value");
            int timeIdx = Array.IndexOf(header, "_time");
            if (fieldIdx < 0 || valueIdx < 0 || fieldIdx >= cells.Length || valueIdx >= cells.Length)
                return result;

            var field = cells[fieldIdx];
            if (!double.TryParse(cells[valueIdx],
                    System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture, out var value))
                continue;

            var at = DateTimeOffset.UtcNow;
            if (timeIdx >= 0 && timeIdx < cells.Length &&
                DateTimeOffset.TryParse(cells[timeIdx], out var parsed))
                at = parsed;

            result[field] = (value, at);
        }

        return result;
    }

    private static string[] SplitCsv(string line) =>
        // Influx CSV values we read (field keys, numbers, timestamps) never
        // contain quoted commas — a plain split is sufficient and dependency-free.
        line.Split(',');

    private static string Escape(string value) =>
        value.Replace("\\", "\\\\").Replace("\"", "\\\"");

    public void Dispose() => _http.Dispose();
}
