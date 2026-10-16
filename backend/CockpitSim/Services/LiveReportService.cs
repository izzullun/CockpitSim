using CockpitSim.Data;
using CockpitSim.DTOs;

namespace CockpitSim.Services;

// Single builder behind BOTH live endpoints (trainer GET /sessions/{id}/live
// and trainee GET /me/sessions/{id}/live) so the two can never drift.
// Ownership checks stay in the controllers; this shapes the SessionReport
// contract with score: null — grading happens once at session-end, never here.
// ponytail: polling (1s hover cadence from the dashboards); upgrade to
// SignalR only if sub-second in-session alerts are ever required.
public sealed class LiveReportService
{
    // Live lookback: Influx points newer than this count as "now".
    public static readonly TimeSpan LiveLookback = TimeSpan.FromSeconds(30);

    private readonly ApplicationDbContext _db;
    private readonly InfluxService _influx;

    public LiveReportService(ApplicationDbContext db, InfluxService influx)
    {
        _db = db;
        _influx = influx;
    }

    public async Task<SessionReportDto> BuildAsync(
        Models.TrainingSession session, CancellationToken ct = default)
    {
        var scenarioKey = ScenarioMetrics.NormalizeScenarioKey(session.Scenario);
        var report = new SessionReportDto
        {
            SessionId = session.Id,
            Scenario = scenarioKey,
            Status = session.Status,
            StartedAt = session.StartedAt,
            EndedAt = session.EndedAt,
            Score = null,
            TimeLimitMinutes = session.TimeLimitMinutes,
        };

        var defs = ScenarioMetrics.ForScenario(scenarioKey);
        if (defs.Count == 0)
        {
            report.Warnings.Add($"Scenario '{session.Scenario}' has no live metric set yet.");
            return report;
        }

        var latest = await _influx.GetLatestAsync(session.Id, LiveLookback, ct);
        foreach (var def in defs)
        {
            report.Metrics.Add(ScenarioMetrics.ToReport(def, latest));
        }

        if (latest.Count == 0)
        {
            report.Warnings.Add(
                _influx.IsConfigured
                    ? "No telemetry in the last 30s — is the bridge running for this session?"
                    : "Telemetry backend not configured — no live data available.");
            return report;
        }

        foreach (var metric in report.Metrics)
        {
            if (metric.WithinTol == false)
            {
                report.Warnings.Add(
                    $"{metric.Label} {metric.Actual}{metric.Unit} outside " +
                    $"±{metric.Tolerance} of target {metric.Target}{metric.Unit}");
            }
        }

        // Feed provenance: all-mock means the numbers are a simulated replay,
        // not the simulator. Mixed/unknown sources stay silent (no assumption).
        var sources = latest.Values
            .Select(v => v.Source)
            .Where(s => !string.IsNullOrEmpty(s))
            .Distinct(StringComparer.Ordinal)
            .ToList();
        if (sources.Count > 0 && sources.All(s => s == "mock"))
        {
            report.Warnings.Add("Simulated feed (mock) — not live MSFS 2020 data.");
        }

        return report;
    }
}
