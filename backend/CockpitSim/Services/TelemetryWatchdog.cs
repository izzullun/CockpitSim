using CockpitSim.Data;
using Microsoft.EntityFrameworkCore;

namespace CockpitSim.Services;

// Auto-ends sessions whose telemetry has gone silent: sim closed (or bridge
// stopped) -> no Influx points -> complete + grade. This is the v1 "system
// detected the session ended" — the launcher's sim-close detection upgrades
// it later without touching the dashboards, which only watch session status.
// Skipped entirely when Influx is unconfigured (dev without telemetry):
// such sessions stay in_progress until ended explicitly.
public sealed class TelemetryWatchdog : BackgroundService
{
    // In_progress sessions older than MinimumAge with no points inside
    // SilenceAfter are completed. Generous on purpose: MSFS cold start (Steam
    // intro -> menus -> load flight) takes minutes, and the bridge only tags
    // points once the sim is actually flying. Both are config-driven
    // (Telemetry:MinimumAgeSeconds / Telemetry:SilenceSeconds) so slow boots
    // are tolerated without a rebuild; the launcher still ends sessions
    // instantly on sim close, so this is only the abandoned-session backstop.
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(15);

    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<TelemetryWatchdog> _logger;
    private readonly TimeSpan _minimumAge;
    private readonly TimeSpan _silenceAfter;

    public TelemetryWatchdog(
        IServiceScopeFactory scopes,
        ILogger<TelemetryWatchdog> logger,
        IConfiguration config)
    {
        _scopes = scopes;
        _logger = logger;
        // Read as string + parse (mirrors InfluxService's config style — no
        // binder extension needed). Fall back to the patient defaults when
        // absent or malformed so slow MSFS boots are always tolerated.
        _minimumAge = TimeSpan.FromSeconds(ParseSeconds(config["Telemetry:MinimumAgeSeconds"], 900));
        _silenceAfter = TimeSpan.FromSeconds(ParseSeconds(config["Telemetry:SilenceSeconds"], 600));
    }

    private static double ParseSeconds(string? value, double fallback) =>
        double.TryParse(value, out var s) && s > 0 ? s : fallback;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
        using var timer = new PeriodicTimer(PollInterval);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await SweepAsync(stoppingToken);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Telemetry watchdog sweep failed — retrying next interval.");
            }
        }
    }

    private async Task SweepAsync(CancellationToken ct)
    {
        using var scope = _scopes.CreateScope();
        var influx = scope.ServiceProvider.GetRequiredService<InfluxService>();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var grading = scope.ServiceProvider.GetRequiredService<GradingService>();

        // Time-limit sweep: sessions past their configured duration are
        // completed + graded regardless of telemetry state.
        var now = DateTime.UtcNow;
        var expired = await db.Sessions
            .Where(s => s.Status == "in_progress" && s.TimeLimitMinutes != null)
            .ToListAsync(ct);
        foreach (var session in expired.Where(s =>
                     now > s.StartedAt.AddMinutes(s.TimeLimitMinutes!.Value)))
        {
            session.EndedAt = now;
            session.Status = "completed";
            await db.SaveChangesAsync(ct);

            var score = await grading.GradeAsync(session.Id, ct);
            _logger.LogInformation(
                "Watchdog auto-ended time-expired session {SessionId} " +
                "(limit {Limit} min, score {Score}).",
                session.Id, session.TimeLimitMinutes, score);
        }

        if (!influx.IsConfigured) return; // no telemetry backend: nothing to detect silence on

        var cutoff = now - _minimumAge;
        var stale = await db.Sessions
            .Where(s => s.Status == "in_progress" && s.StartedAt < cutoff)
            .ToListAsync(ct);

        foreach (var session in stale)
        {
            var latest = await influx.GetLatestAsync(session.Id, _silenceAfter, ct);
            if (latest.Count > 0) continue;

            session.EndedAt = DateTime.UtcNow;
            session.Status = "completed";
            await db.SaveChangesAsync(ct);

            var score = await grading.GradeAsync(session.Id, ct);
            _logger.LogInformation(
                "Watchdog auto-ended silent session {SessionId} (score {Score}).",
                session.Id, score);
        }
    }
}
