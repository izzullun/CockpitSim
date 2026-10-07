using System.Diagnostics;
using System.IO;
using System.Net.Http;

namespace CockpitSim.Launcher;

/// <summary>
/// Owns the backend child process for the life of the app (mirrors what
/// packaging/Start-CockpitSim.cmd does, so double-clicking the launcher alone
/// is enough: backend starts if needed, health is awaited, then the dashboard
/// shows). Idempotent: if the backend is already healthy (dev `dotnet run` or
/// a previous launcher instance) nothing is started and nothing is killed on
/// exit — only a backend this host started is stopped with the app.
/// InfluxDB preflight (`docker start influxdb-cockpitsim`) is best-effort and
/// never fatal: backend + dashboard run fine without telemetry.
/// </summary>
public sealed class BackendHost : IDisposable
{
    private static readonly TimeSpan StartupTimeout = TimeSpan.FromSeconds(30);

    private readonly LauncherConfig _config;
    private Process? _process;
    private bool _owned;
    private bool _disposed;

    public BackendHost(LauncherConfig config)
    {
        _config = config;
    }

    /// <summary>
    /// Returns true once GET {BackendBaseUrl}/api/health succeeds.
    /// Starts the backend first when it isn't already up.
    /// </summary>
    public async Task<bool> EnsureRunningAsync(
        Action<string>? report = null,
        CancellationToken cancellationToken = default)
    {
        if (await IsBackendHealthyAsync(cancellationToken)) return true;
        if (!_config.AutoStartBackend || _disposed) return false;

        LoadTokenFromEnvFile();

        var exe = ResolveBackendExe();
        if (exe == null)
        {
            report?.Invoke("Backend not found next to the app — republish the bundle.");
            return false;
        }

        StartInfluxPreflight();

        report?.Invoke("Starting CockpitSim server…");
        try
        {
            var dir = Path.GetDirectoryName(exe)!;
            var startInfo = new ProcessStartInfo
            {
                FileName = exe,
                WorkingDirectory = dir,
                CreateNoWindow = true,
                UseShellExecute = false,
            };
            // Child inherits this process' environment.
            startInfo.Environment["ASPNETCORE_ENVIRONMENT"] = "Development";
            startInfo.Environment["ASPNETCORE_URLS"] = _config.BackendBaseUrl;
            _process = Process.Start(startInfo);
            _owned = _process != null;
        }
        catch (Exception ex)
        {
            Trace.WriteLine($"[backend] failed to start: {ex.Message}");
            _process = null;
            _owned = false;
            return false;
        }

        report?.Invoke("Waiting for CockpitSim server…");
        var deadline = DateTime.UtcNow + StartupTimeout;
        while (DateTime.UtcNow < deadline && !cancellationToken.IsCancellationRequested)
        {
            if (await IsBackendHealthyAsync(cancellationToken)) return true;
            await Task.Delay(500, cancellationToken);
        }

        return await IsBackendHealthyAsync(cancellationToken);
    }

    public void Stop()
    {
        if (!_owned || _process == null) return;
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
            Trace.WriteLine($"[backend] stop failed: {ex.Message}");
        }
        finally
        {
            _process?.Dispose();
            _process = null;
            _owned = false;
        }
    }

    private async Task<bool> IsBackendHealthyAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
            using var response = await http.GetAsync(_config.HealthUrl, cancellationToken);
            return response.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    // Same one-line shape as packaging/.env.example: INFLUX_TOKEN=<token>.
    // Real environment wins; the file only fills gaps. Never committed.
    private void LoadTokenFromEnvFile()
    {
        if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("INFLUX_TOKEN")))
            return;

        var baseDir = AppContext.BaseDirectory;
        var candidates = new[]
        {
            Path.GetFullPath(Path.Combine(baseDir, "..", ".env")),
            Path.Combine(baseDir, ".env"),
        };
        foreach (var path in candidates)
        {
            string[] lines;
            try
            {
                if (!File.Exists(path)) continue;
                lines = File.ReadAllLines(path);
            }
            catch
            {
                continue;
            }
            foreach (var raw in lines)
            {
                var line = raw.Trim();
                if (line.Length == 0 || line.StartsWith('#')) continue;
                var eq = line.IndexOf('=');
                if (eq <= 0) continue;
                if (!line[..eq].Trim().Equals("INFLUX_TOKEN", StringComparison.OrdinalIgnoreCase))
                    continue;
                var value = line[(eq + 1)..].Trim().Trim('"');
                if (value.Length > 0)
                {
                    Environment.SetEnvironmentVariable("INFLUX_TOKEN", value);
                    return;
                }
            }
        }
    }

    // Fire-and-forget: `docker start` a stopped InfluxDB container so telemetry
    // is warm by the time a session starts. Any failure is ignored by design.
    private static void StartInfluxPreflight()
    {
        try
        {
            using var proc = Process.Start(new ProcessStartInfo
            {
                FileName = "docker",
                Arguments = "start influxdb-cockpitsim",
                CreateNoWindow = true,
                UseShellExecute = false,
            });
            proc?.WaitForExit(milliseconds: 5000);
        }
        catch (Exception ex)
        {
            Trace.WriteLine($"[backend] influx preflight skipped: {ex.Message}");
        }
    }

    // Published bundle layout (launcher/../backend/*.exe) wins; dev build
    // output (backend/CockpitSim/bin/...) next for `dotnet run` era setups.
    // Explicit config path first.
    private string? ResolveBackendExe()
    {
        if (!string.IsNullOrWhiteSpace(_config.BackendExePath) && File.Exists(_config.BackendExePath))
            return _config.BackendExePath;

        var baseDir = AppContext.BaseDirectory;
        var candidates = new[]
        {
            Path.GetFullPath(Path.Combine(baseDir, "..", "backend", "CockpitSim.exe")),
            Path.GetFullPath(Path.Combine(baseDir, "CockpitSim.exe")),
            Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..", "..",
                "backend", "CockpitSim", "bin", "Release", "net8.0",
                "CockpitSim.exe")),
            Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..", "..",
                "backend", "CockpitSim", "bin", "Debug", "net8.0",
                "CockpitSim.exe")),
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
