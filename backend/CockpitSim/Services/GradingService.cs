using System.Text.Json;
using CockpitSim.Data;
using CockpitSim.DTOs;
using CockpitSim.Models;
using Microsoft.EntityFrameworkCore;

namespace CockpitSim.Services;

// Scores a completed session ONCE at session-end and stores the immutable
// snapshot in dashboard_reports. Reads stop here — /report returns the stored
// JSON verbatim (plus live trainer notes merged at read time; notes are
// annotations, everything else is frozen).
public sealed class GradingService
{
    // Hover weights (sum = 100). Locked with the FYP demo; changing them
    // changes future scores only — stored snapshots keep their own numbers.
    private static readonly Dictionary<string, double> HoverWeights = new()
    {
        ["radar_alt"] = 35.0,
        ["ground_speed"] = 25.0,
        ["vertical_speed"] = 15.0,
        ["bank"] = 12.5,
        ["pitch"] = 12.5,
    };

    private const double PassThreshold = 70.0;

    internal static readonly JsonSerializerOptions JsonOptions =
        new(JsonSerializerDefaults.Web);

    private readonly ApplicationDbContext _db;
    private readonly InfluxService _influx;
    private readonly ILogger<GradingService> _logger;

    public GradingService(
        ApplicationDbContext db, InfluxService influx, ILogger<GradingService> logger)
    {
        _db = db;
        _influx = influx;
        _logger = logger;
    }

    // Returns the stored score (null when ungradable). Never regrades: if a
    // report row already exists, its score is returned untouched.
    public async Task<double?> GradeAsync(string sessionId, CancellationToken ct = default)
    {
        var existing = await _db.Reports
            .FirstOrDefaultAsync(r => r.SessionId == sessionId, ct);
        if (existing != null)
        {
            return TryReadScore(existing.MetricsJson);
        }

        var session = await _db.Sessions.FirstOrDefaultAsync(s => s.Id == sessionId, ct);
        if (session == null) return null;

        var scenarioKey = ScenarioMetrics.NormalizeScenarioKey(session.Scenario);
        var defs = ScenarioMetrics.ForScenario(scenarioKey);

        var report = new SessionReportDto
        {
            SessionId = session.Id,
            Scenario = scenarioKey,
            Status = session.Status,
            StartedAt = session.StartedAt,
            EndedAt = session.EndedAt,
            Score = null,
        };
        report.Timeline.Add(new TimelineEventDto
        {
            Time = "00:00",
            Event = "Session started and telemetry capture enabled.",
        });

        if (defs.Count == 0)
        {
            report.Warnings.Add($"Scenario '{session.Scenario}' has no grading rubric yet.");
            report.SummaryFallback();
            await StoreAsync(session, report, ct);
            return null;
        }

        var from = new DateTimeOffset(session.StartedAt, TimeSpan.Zero);
        var to = new DateTimeOffset(session.EndedAt ?? DateTime.UtcNow, TimeSpan.Zero);
        var rows = await _influx.GetWindowAsync(sessionId, from, to, ct);

        if (rows.Count == 0)
        {
            report.Warnings.Add("No telemetry was captured for this session.");
            foreach (var def in defs)
                report.Metrics.Add(ScenarioMetrics.ToReport(def,
                    new Dictionary<string, (double Value, DateTimeOffset At, string Source)>()));
            await StoreAsync(session, report, ct);
            return null;
        }

        var byField = rows
            .GroupBy(r => r.Field, StringComparer.Ordinal)
            .ToDictionary(
                g => g.Key,
                g => g.OrderBy(r => r.At).ToList(),
                StringComparer.Ordinal);

        var scored = new List<(ScenarioMetrics.MetricDef Def, double WithinPct, ReportMetricDto Metric)>();
        foreach (var def in defs)
        {
            if (!byField.TryGetValue(def.InfluxField, out var series) || series.Count == 0)
            {
                scored.Add((def, double.NaN, ScenarioMetrics.ToReport(def,
                    new Dictionary<string, (double Value, DateTimeOffset At, string Source)>())));
                continue;
            }

            double withinPct = 100.0;
            if (def.Target.HasValue && def.Tolerance.HasValue)
            {
                var inside = series.Count(s =>
                    Math.Abs(s.Value - def.Target.Value) <= def.Tolerance.Value);
                withinPct = 100.0 * inside / series.Count;
            }

            // Post-session aggregates: means for position/rate/power metrics,
            // variability (stddev) for attitude/heading — a mean bank of ~0°
            // says nothing, its spread says everything.
            var values = series.Select(s => s.Value).ToList();
            var aggregate = def.Key is "bank" or "pitch" or "heading"
                ? StdDev(values)
                : values.Average();

            var metric = new ReportMetricDto
            {
                Key = def.Key,
                Label = def.Label,
                Unit = def.Unit,
                Actual = Math.Round(aggregate, 2),
                Target = def.Target,
                Tolerance = def.Tolerance,
                WithinTol = def.Target.HasValue ? withinPct >= PassThreshold : null,
            };
            scored.Add((def, withinPct, metric));

            if (def.Target.HasValue && withinPct < 100.0)
            {
                var firstOut = series.First(s =>
                    Math.Abs(s.Value - def.Target.Value) > def.Tolerance!.Value);
                report.Timeline.Add(new TimelineEventDto
                {
                    Time = Offset(from, firstOut.At),
                    Event = $"{def.Label} left tolerance " +
                        $"({firstOut.Value:F1}{def.Unit} vs target {def.Target.Value}{def.Unit}).",
                });
            }
        }

        // Convention (mirrored in report-renderer.js): metrics[] is stored
        // worst-first so the frontend reads the weakest metric off index 0
        // without any extra field — the contract shape stays untouched.
        foreach (var (_, _, metric) in scored
                     .OrderBy(t => double.IsNaN(t.WithinPct) ? double.MaxValue : t.WithinPct)
                     .ThenBy(t => t.Def.Key, StringComparer.Ordinal))
        {
            report.Metrics.Add(metric);
        }

        var graded = scored.Where(t => HoverWeights.ContainsKey(t.Def.Key)).ToList();
        double score = graded.Sum(t =>
            HoverWeights[t.Def.Key] * (double.IsNaN(t.WithinPct) ? 0.0 : t.WithinPct) / 100.0);
        report.Score = Math.Round(score, 1);

        // Feed provenance goes into the immutable snapshot too, so the report
        // always says whether it was graded on simulated or live sim data.
        var feedSources = rows
            .Select(r => r.Source)
            .Where(s => !string.IsNullOrEmpty(s))
            .Distinct(StringComparer.Ordinal)
            .ToList();
        if (feedSources.Count > 0 && feedSources.All(s => s == "mock"))
        {
            report.Warnings.Add("Simulated feed (mock) — not live MSFS 2020 data.");
        }

        var breached = scored
            .Where(t => !double.IsNaN(t.WithinPct) && t.WithinPct < 100.0)
            .ToList();
        foreach (var (def, pct, _) in breached.OrderBy(t => t.WithinPct))
        {
            report.Warnings.Add(
                $"{def.Label} outside tolerance {100.0 - pct:F0}% of the session.");
        }

        var breachRate = 100.0 - graded.Sum(t =>
            HoverWeights[t.Def.Key] * (double.IsNaN(t.WithinPct) ? 0.0 : t.WithinPct) / 100.0);
        var risk = breachRate < 10 ? "Low" : breachRate < 30 ? "Medium" : "High";
        var weakest = breached.Count > 0 ? breached.MinBy(t => t.WithinPct).Def.Label : "—";
        report.Timeline.Add(new TimelineEventDto
        {
            Time = Offset(from, to),
            Event = $"Session ended — report finalized, score {report.Score} " +
                $"({(report.Score >= PassThreshold ? "PASS" : "NEEDS WORK")}, risk {risk}).",
        });

        await StoreAsync(session, report, ct, risk, weakest);
        return report.Score;
    }

    private async Task StoreAsync(
        TrainingSession session, SessionReportDto report,
        CancellationToken ct, string? risk = null, string? weakest = null)
    {
        // Human verdict lives in Summary (free text); the frontend derives the
        // weakest-metric coaching tip from metrics[0] (worst-first ordering).
        var verdict = report.Score.HasValue
            ? $"{Title(report.Scenario)} held {100.0 - BreachRate(report):F0}% inside tolerance — " +
              $"score {report.Score} ({(report.Score >= PassThreshold ? "PASS" : "NEEDS WORK")}, risk {risk}). " +
              $"Focus area next attempt: {weakest}."
            : $"No score for this session — {report.Warnings.FirstOrDefault() ?? "no telemetry captured."}";

        _db.Reports.Add(new DashboardReport
        {
            SessionId = session.Id,
            GeneratedBy = null, // system grading, not a user
            Summary = verdict,
            MetricsJson = JsonSerializer.Serialize(report, JsonOptions),
            CreatedAt = DateTime.UtcNow,
        });
        await _db.SaveChangesAsync();
        _logger.LogInformation(
            "Graded session {SessionId}: score {Score}.", session.Id, report.Score);
    }

    private static double BreachRate(SessionReportDto report) =>
        100.0 - (report.Score ?? 0.0);

    private static double StdDev(List<double> values)
    {
        if (values.Count == 0) return 0.0;
        var mean = values.Average();
        return Math.Sqrt(values.Sum(v => (v - mean) * (v - mean)) / values.Count);
    }

    private static string Offset(DateTimeOffset from, DateTimeOffset at)
    {
        var span = at - from;
        if (span < TimeSpan.Zero) span = TimeSpan.Zero;
        return $"{(int)span.TotalMinutes:D2}:{span.Seconds:D2}";
    }

    private static string Title(string key) =>
        key switch
        {
            "hover" => "Hover",
            "straight_level" => "Straight-and-level",
            "climb_descent" => "Climb/descent",
            "turns" => "Turns",
            "takeoff_landing" => "Takeoff/landing",
            _ => key,
        };

    private static double? TryReadScore(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<SessionReportDto>(json, JsonOptions)?.Score;
        }
        catch
        {
            return null;
        }
    }
}

internal static class SessionReportDtoExtensions
{
    // Placeholder verdict for ungradable reports (no rubric / no telemetry).
    internal static void SummaryFallback(this SessionReportDto report)
    {
        report.Timeline.Add(new TimelineEventDto
        {
            Time = "00:00",
            Event = "Session ended without a grading rubric — no score assigned.",
        });
    }
}
