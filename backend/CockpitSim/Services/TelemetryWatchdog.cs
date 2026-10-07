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
    // In_progress sessions older than this with no points inside SilenceAfter
    // are completed. Generous on purpose: MSFS cold start takes minutes, and
    // the bridge only tags points once the sim is actually flying.
    public static readonly TimeSpan SilenceAfter = TimeSpan.FromSeconds(60);
    public static readonly TimeSpan MinimumAge = TimeSpan.FromSeconds(90);
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(15);

    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<TelemetryWatchdog> _logger;

    public TelemetryWatchdog(IServiceScopeFactory scopes, ILogger<TelemetryWatchdog> logger)
    {
        _scopes = scopes;
        _logger = logger;
    }

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
        if (!influx.IsConfigured) return; // no telemetry backend: nothing to detect silence on

        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var grading = scope.ServiceProvider.GetRequiredService<GradingService>();

        var cutoff = DateTime.UtcNow - MinimumAge;
        var stale = await db.Sessions
            .Where(s => s.Status == "in_progress" && s.StartedAt < cutoff)
            .ToListAsync(ct);

        foreach (var session in stale)
        {
            var latest = await influx.GetLatestAsync(session.Id, SilenceAfter, ct);
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
