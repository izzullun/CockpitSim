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

    // Source mirrors the bridge's `source` tag ("mock" | "sim"). Old points
    // written before the tag existed parse as "" (unknown) — never assumed.
    public sealed record TimedSample(string Field, double Value, DateTimeOffset At, string Source = "");

    // Latest value per field for one session within the lookback window.
    // Returns field -> (value, timestamp, feed source). Empty when unconfigured
    // or no data — callers render the honest empty state, never fake numbers.
    public async Task<Dictionary<string, (double Value, DateTimeOffset At, string Source)>> GetLatestAsync(
        string sessionId, TimeSpan lookback, CancellationToken ct = default)
    {
        var rows = await QueryAsync(
            sessionId,
            $"range(start:-{(int)lookback.TotalSeconds}s) |> last()",
            ct);
        var latest = new Dictionary<string, (double Value, DateTimeOffset At, string Source)>(StringComparer.Ordinal);
        foreach (var row in rows)
        {
            if (!latest.TryGetValue(row.Field, out var cur) || row.At > cur.At)
                latest[row.Field] = (row.Value, row.At, row.Source);
        }
        return latest;
    }

    // Every point for one session in [from, to] (grading window).
    // ponytail: a long session at 10–20 Hz returns tens of thousands of rows
    // as one CSV — fine for FYP scale; downsample (|> aggregateWindow) if this
    // ever backs onto long cruise sessions.
    public Task<List<TimedSample>> GetWindowAsync(
        string sessionId, DateTimeOffset from, DateTimeOffset to, CancellationToken ct = default) =>
        QueryAsync(
            sessionId,
            $"range(start:{from:yyyy-MM-ddTHH:mm:ssZ}, stop:{to:yyyy-MM-ddTHH:mm:ssZ})",
            ct);

    private async Task<List<TimedSample>> QueryAsync(
        string sessionId, string rangeAndTail, CancellationToken ct)
    {
        var rows = new List<TimedSample>();
        if (!IsConfigured)
        {
            _logger.LogWarning("Influx token not configured — telemetry unavailable.");
            return rows;
        }

        var flux =
            $"from(bucket:\"{Escape(_bucket)}\") " +
            $"|> {rangeAndTail} " +
            $"|> filter(fn:(r) => r._measurement == \"heli_telemetry\" " +
            $"and r.sessionId == \"{Escape(sessionId)}\")";

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
            return rows;
        }

        return ParseAnnotatedCsv(csv);
    }

    // Minimal parser for Influx annotated CSV: finds the header row, maps the
    // _field / _value / _time columns. One row per (field, timestamp);
    // callers reduce (latest per field, or full series for grading).
    internal static List<TimedSample> ParseAnnotatedCsv(string csv)
    {
        var result = new List<TimedSample>();
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
            int sourceIdx = Array.IndexOf(header, "source");
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

            var source = sourceIdx >= 0 && sourceIdx < cells.Length ? cells[sourceIdx] : string.Empty;
            result.Add(new TimedSample(field, value, at, source));
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
