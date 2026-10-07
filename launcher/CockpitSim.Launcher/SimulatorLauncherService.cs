using System.Diagnostics;
using System.IO;

namespace CockpitSim.Launcher;

/// <summary>
/// Owns launching the flight simulator and watching its lifetime, kept
/// deliberately narrow so it can later grow to MSFS 2024 and SimConnect.
///
/// Launch path: Steam URI protocol (<c>steam://rungameid/&lt;appId&gt;</c>) via
/// <see cref="Process.Start(ProcessStartInfo)"/> with
/// <see cref="ProcessStartInfo.UseShellExecute"/> = true. The URI handler
/// starts Steam when needed and routes the rungameid — no hardcoded Steam.exe
/// or MSFS path, and no GUI automation.
///
/// Lifetime: after the URI is handed to the shell, a background watcher polls
/// the process list (no owned child process exists — Steam spawns MSFS
/// detached). It first waits for the sim to appear (generous grace window —
/// Steam + MSFS are slow to boot), then watches for it to disappear, raising
/// <see cref="SimulatorClosed"/>. This service never kills MSFS and never
/// closes the app — WPF keeps running for the whole flight.
/// </summary>
public sealed class SimulatorLauncherService : IDisposable
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(3);

    // MSFS (plus Steam bootstrap) can take minutes to reach a running process.
    private static readonly TimeSpan StartGraceWindow = TimeSpan.FromMinutes(3);

    private readonly LauncherConfig _config;
    private readonly SynchronizationContext? _uiContext;
    private CancellationTokenSource? _watcher;
    private bool _disposed;

    /// <summary>Raised once the simulator process is observed running.</summary>
    public event EventHandler? SimulatorStarted;

    /// <summary>Raised when a previously-observed simulator process exits.</summary>
    public event EventHandler? SimulatorClosed;

    /// <summary>Raised when the launch itself fails (e.g. no Steam URI handler).</summary>
    public event EventHandler<string>? LaunchFailed;

    public SimulatorLauncherService(LauncherConfig config)
    {
        _config = config;
        // Capture the UI context so events land where WebView2 can be touched.
        _uiContext = SynchronizationContext.Current;
    }

    /// <summary>
    /// Hands the simulator's Steam rungameid URI to the shell and starts the
    /// process watcher. Idempotent per flight: a second call while a watcher is
    /// active just re-arms detection (no duplicate notifications).
    /// </summary>
    public Task LaunchAsync()
    {
        if (_disposed || !_config.AutoLaunchSimulator)
        {
            return Task.CompletedTask;
        }

        var uri = $"steam://rungameid/{_config.SimulatorAppId}";

        // Log-only check: whether Steam is already running changes nothing
        // about what we do (the URI handler deals with both cases), but the
        // trace helps when diagnosing a slow boot.
        var steamRunning = Process.GetProcessesByName("steam").Length > 0;
        Trace.WriteLine($"[sim] launching {uri} (steam running: {steamRunning}).");

        try
        {
            Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            // No URI association (Steam not installed) or the shell refused it.
            Trace.WriteLine($"[sim] launch failed: {ex.Message}");
            Raise(LaunchFailed, "Could not launch the simulator via Steam. Is Steam installed?");
            return Task.CompletedTask;
        }

        StartWatcher();
        return Task.CompletedTask;
    }

    /// <summary>True while a watcher loop is active (between launch and close).</summary>
    public bool IsWatching => _watcher is { IsCancellationRequested: false };

    private void StartWatcher()
    {
        StopWatcher();
        var cts = new CancellationTokenSource();
        _watcher = cts;
        _ = Task.Run(() => WatchAsync(cts.Token));
    }

    private async Task WatchAsync(CancellationToken ct)
    {
        // Phase 1 — wait for the sim process to appear (bounded by the grace
        // window so a failed/cancelled launch doesn't watch forever).
        var startDeadline = DateTime.UtcNow + StartGraceWindow;
        while (!ct.IsCancellationRequested && DateTime.UtcNow < startDeadline)
        {
            if (IsSimulatorRunning())
            {
                Trace.WriteLine("[sim] simulator process detected.");
                Raise(SimulatorStarted);
                break;
            }
            if (!await DelayAsync(ct)) return; // cancelled
        }

        if (!IsSimulatorRunning())
        {
            // Never showed up within the grace window.
            Trace.WriteLine("[sim] simulator process not detected within grace window.");
            if (!ct.IsCancellationRequested)
            {
                Raise(LaunchFailed, "The simulator did not start. Launch MSFS manually, then fly.");
            }
            return;
        }

        // Phase 2 — watch for the sim to exit.
        while (!ct.IsCancellationRequested)
        {
            if (!IsSimulatorRunning())
            {
                Trace.WriteLine("[sim] simulator process exited.");
                Raise(SimulatorClosed);
                return;
            }
            if (!await DelayAsync(ct)) return; // cancelled
        }
    }

    private bool IsSimulatorRunning()
    {
        foreach (var name in _config.SimulatorProcessNames)
        {
            if (string.IsNullOrWhiteSpace(name)) continue;
            try
            {
                if (Process.GetProcessesByName(name).Length > 0) return true;
            }
            catch
            {
                // A transient process-list failure must not kill the watcher.
            }
        }
        return false;
    }

    private static async Task<bool> DelayAsync(CancellationToken ct)
    {
        try
        {
            await Task.Delay(PollInterval, ct);
            return true;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }

    private void Raise(EventHandler? handler)
    {
        if (handler == null) return;
        if (_uiContext != null)
        {
            _uiContext.Post(_ => handler(this, EventArgs.Empty), null);
        }
        else
        {
            handler(this, EventArgs.Empty);
        }
    }

    private void Raise(EventHandler<string>? handler, string detail)
    {
        if (handler == null) return;
        if (_uiContext != null)
        {
            _uiContext.Post(_ => handler(this, detail), null);
        }
        else
        {
            handler(this, detail);
        }
    }

    /// <summary>Stops watching. Never kills MSFS — Steam owns that process.</summary>
    public void StopWatcher()
    {
        try
        {
            _watcher?.Cancel();
        }
        catch
        {
            // best-effort
        }
        finally
        {
            _watcher?.Dispose();
            _watcher = null;
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        StopWatcher();
    }
}
