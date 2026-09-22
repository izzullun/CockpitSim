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
