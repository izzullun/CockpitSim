using CockpitSim.DTOs;

namespace CockpitSim.Services;

// Server-side metric definitions per scenario: Influx field -> label/unit +
// target/tolerance. Mirrors dashboard/shared/js/scenarios.js (the frontend
// single source of truth) — keep the two in sync; targets/tolerances come
// from BasicHeliTraining.md. Hover first; other scenarios return no metric
// set yet (honest empty, not zeroes).
public static class ScenarioMetrics
{
    public sealed record MetricDef(
        string Key, string InfluxField, string Label, string Unit,
        double? Target, double? Tolerance);

    // Hover box (BasicHeliTraining.md §1): hold ~5 ft AGL, ~0 groundspeed,
    // near-zero rates/attitudes. Null target = informational only (no grading).
    private static readonly MetricDef[] Hover =
    {
        new("radar_alt", "radar_alt_ft", "Radar Alt", "ft", 5.0, 2.0),
        new("ground_speed", "ground_velocity_kt", "Ground Speed", "kt", 0.0, 1.0),
        new("vertical_speed", "vertical_speed_fpm", "Vertical Speed", "ft/min", 0.0, 100.0),
        new("bank", "bank_deg", "Bank", "°", 0.0, 5.0),
        new("pitch", "pitch_deg", "Pitch", "°", 0.0, 5.0),
        new("heading", "heading_true_deg", "Heading", "°", null, null),
        new("collective", "collective_pct", "Collective", "%", null, null),
    };

    // Stored Scenario values predate the enum keys ("Hover Hold — Attempt 1");
    // match loosely so old rows don't 500. New sessions use the enum keys.
    public static string NormalizeScenarioKey(string? stored) =>
        (stored ?? string.Empty).ToLowerInvariant() switch
        {
            var s when s.Contains("hover") => "hover",
            var s when s.Contains("straight") || s.Contains("level") => "straight_level",
            var s when s.Contains("climb") || s.Contains("descent") => "climb_descent",
            var s when s.Contains("turn") => "turns",
            var s when s.Contains("takeoff") || s.Contains("landing") || s.Contains("touchdown") => "takeoff_landing",
            var s when s.Contains("autorotation") || s.Contains("emergency") || s.Contains("nap-of") || s.Contains("confined") => s.Trim(),
            _ => (stored ?? string.Empty).Trim(),
        };

    public static IReadOnlyList<MetricDef> ForScenario(string scenarioKey) =>
        scenarioKey == "hover" ? Hover : Array.Empty<MetricDef>();

    public static ReportMetricDto ToReport(
        MetricDef def, Dictionary<string, (double Value, DateTimeOffset At)> latest)
    {
        var dto = new ReportMetricDto
        {
            Key = def.Key,
            Label = def.Label,
            Unit = def.Unit,
            Target = def.Target,
            Tolerance = def.Tolerance,
        };

        if (latest.TryGetValue(def.InfluxField, out var sample))
        {
            dto.Actual = Math.Round(sample.Value, 2);
            if (def.Target.HasValue && def.Tolerance.HasValue)
                dto.WithinTol = Math.Abs(sample.Value - def.Target.Value) <= def.Tolerance.Value;
        }

        return dto;
    }
}
