using System.Diagnostics;
using System.IO;

namespace CockpitSim.Launcher;

/// <summary>
/// Owns the telemetry bridge child process for the life of the app.
/// The bridge runs in discovery mode (no --session): it idles on
/// "waiting for an active session" until someone presses START SESSION,
/// feeds each session in turn, and goes back to waiting. Hidden window,
/// killed with the app. Missing exe = logged once, app continues without
/// telemetry (dashboards show their honest waiting states).
/// Member 4 area: the future MSFS-launch host object reuses Start/Stop here.
/// </summary>
public sealed class BridgeHost : IDisposable
{
    private readonly LauncherConfig _config;
    private Process? _process;
    private bool _disposed;

    public bool IsRunning => _process is { HasExited: false };

    public BridgeHost(LauncherConfig config)
    {
        _config = config;
    }

    public void EnsureRunning()
    {
        if (!_config.AutoStartBridge || IsRunning || _disposed) return;

        var exe = ResolveBridgeExe();
        if (exe == null)
        {
            Trace.WriteLine("[bridge] exe not found — telemetry disabled until it is published.");
            return;
        }

        try
        {
            // No --mock: live MSFS data by default (use --mock only for testing).
            // AutoStartBridge=false in appsettings.json disables this entirely.
            _process = Process.Start(new ProcessStartInfo
            {
                FileName = exe,
                Arguments = "--rate 10",
                WorkingDirectory = Path.GetDirectoryName(exe)!,
                CreateNoWindow = true,
                UseShellExecute = false,
            });
            Trace.WriteLine($"[bridge] started pid={_process?.Id} ({exe}).");
        }
        catch (Exception ex)
        {
            Trace.WriteLine($"[bridge] failed to start: {ex.Message}");
            _process = null;
        }
    }

    public void Stop()
    {
        if (_process == null) return;
        try
        {
            if (!_process.HasExited)
            {
                _process.Kill(entireProcessTree: true);
                _process.WaitForExit(milliseconds: 3000);
            }
        }
        catch (Exception ex)
        {
            Trace.WriteLine($"[bridge] stop failed: {ex.Message}");
        }
        finally
        {
            _process?.Dispose();
            _process = null;
        }
    }

    // Dev layout (telemetry/.../bin) wins when present; otherwise the published
    // bundle layout (launcher/../telemetry/*.exe). Explicit config first.
    private string? ResolveBridgeExe()
    {
        if (!string.IsNullOrWhiteSpace(_config.BridgeExePath) && File.Exists(_config.BridgeExePath))
            return _config.BridgeExePath;

        var baseDir = AppContext.BaseDirectory;
        var candidates = new[]
        {
            Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..", "..",
                "telemetry", "CockpitSim.Telemetry", "bin", "Release", "net8.0-windows",
                "CockpitSim.Telemetry.exe")),
            Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..", "..",
                "telemetry", "CockpitSim.Telemetry", "bin", "Debug", "net8.0-windows",
                "CockpitSim.Telemetry.exe")),
            Path.GetFullPath(Path.Combine(baseDir, "..", "telemetry", "CockpitSim.Telemetry.exe")),
            Path.GetFullPath(Path.Combine(baseDir, "CockpitSim.Telemetry.exe")),
        };
        return candidates.FirstOrDefault(File.Exists);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        Stop();
    }
}
