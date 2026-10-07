using System.IO;
using System.Text.Json;

namespace CockpitSim.Launcher;

/// <summary>
/// Launcher configuration, loaded from appsettings.json next to the exe.
/// Kept dependency-free (System.Text.Json only) — no Options/DI plumbing.
/// </summary>
public sealed class LauncherConfig
{
    private const string DefaultBaseUrl = "http://localhost:5247";

    /// <summary>Root URL of the CockpitSim backend (no trailing slash).</summary>
    public string BackendBaseUrl { get; set; } = DefaultBaseUrl;

    /// <summary>
    /// Auto-start the telemetry bridge as a hidden child process while the app
    /// runs. The bridge self-discovers sessions (GET /api/bridge/active), so no
    /// session id is passed — disable only for debugging.
    /// </summary>
    public bool AutoStartBridge { get; set; } = true;

    /// <summary>Explicit bridge exe path. When empty, resolved next to the app.</summary>
    public string BridgeExePath { get; set; } = string.Empty;

    /// <summary>
    /// Auto-start the backend as a hidden child process when
    /// GET /api/health fails at launch (mirrors Start-CockpitSim.cmd).
    /// Disable only when a backend is managed externally.
    /// </summary>
    public bool AutoStartBackend { get; set; } = true;

    /// <summary>Explicit backend exe path. When empty, resolved next to the app.</summary>
    public string BackendExePath { get; set; } = string.Empty;

    /// <summary>
    /// Launch the simulator (via its Steam rungameid URI) when the dashboard
    /// sends the startSimulator command. Disable to leave MSFS launches manual.
    /// </summary>
    public bool AutoLaunchSimulator { get; set; } = true;

    /// <summary>Steam App ID used to build the steam://rungameid URI. 1250410 = MSFS 2020.</summary>
    public string SimulatorAppId { get; set; } = "1250410";

    /// <summary>
    /// Process names (no extension) the watcher polls for to know the sim is
    /// alive and to detect its exit. Config-driven so MSFS 2024 / the Store
    /// edition can be added later without a recompile.
    /// </summary>
    public string[] SimulatorProcessNames { get; set; } = new[] { "FlightSimulator" };

    public string HealthUrl => $"{BackendBaseUrl}/api/health";
    public string LoginUrl => $"{BackendBaseUrl}/dashboard/login/login.html";

    public static LauncherConfig Load()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "appsettings.json");
        try
        {
            if (File.Exists(path))
            {
                var config = JsonSerializer.Deserialize<LauncherConfig>(
                    File.ReadAllText(path),
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (config is not null && !string.IsNullOrWhiteSpace(config.BackendBaseUrl))
                {
                    config.BackendBaseUrl = config.BackendBaseUrl.TrimEnd('/');
                    return config;
                }
            }
        }
        catch
        {
            // Malformed or unreadable config — fall back to the default URL.
        }

        return new LauncherConfig();
    }
}
