using System.IO;

namespace CockpitSim.Telemetry;

// Shared by the bridge, backend and launcher (linked by their project files).
// Minimal .env loader (no package): fills telemetry settings from local files so nobody
// has to export tokens in every terminal. Precedence: real environment first,
// then the first file that defines each key. Files are gitignored; a missing
// file is not an error — the caller still reports "set INFLUX_TOKEN" clearly.
internal static class DotEnv
{
    public static void Load()
    {
        foreach (var path in CandidatePaths())
        {
            if (!File.Exists(path)) continue;
            string[] lines;
            try { lines = File.ReadAllLines(path); }
            catch (IOException) { continue; }
            catch (UnauthorizedAccessException) { continue; }
            foreach (var rawLine in lines)
            {
                var line = rawLine.Trim();
                if (line.Length == 0 || line.StartsWith('#')) continue;
                var eq = line.IndexOf('=');
                if (eq <= 0) continue;
                var key = line[..eq].Trim();
                var value = line[(eq + 1)..].Trim().Trim('"');
                // A telemetry file must not override unrelated process settings.
                if (key is not ("INFLUX_TOKEN" or "INFLUX_URL" or "INFLUX_ORG" or "INFLUX_BUCKET" or "BACKEND_URL"))
                    continue;
                if (key.Length == 0 || value.Length == 0) continue;
                if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable(key)))
                {
                    Environment.SetEnvironmentVariable(key, value);
                }
            }
        }
    }

    private static IEnumerable<string> CandidatePaths()
    {
        // Published bundle layout (CockpitSimApp/telemetry/*.exe + ../.env),
        // then repo-root runs (dotnet run --project, cwd = repo root).
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        string[] candidates =
        {
            Path.Combine(AppContext.BaseDirectory, ".env"),
            Path.Combine(AppContext.BaseDirectory, "..", ".env"),
            Path.Combine(Directory.GetCurrentDirectory(), ".env"),
            Path.Combine(Directory.GetCurrentDirectory(), "CockpitSimApp", ".env"),
        };
        foreach (var raw in candidates)
        {
            string full;
            try
            {
                full = Path.GetFullPath(raw);
            }
            catch
            {
                continue;
            }
            if (seen.Add(full)) yield return full;
        }

        // dotnet run from backend/CockpitSim (or a dev executable's bin
        // directory) must find the same root file as a repo-root bridge run.
        // Stop at the actual monorepo rather than loading arbitrary parent files.
        foreach (var start in new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
        {
            for (var dir = new DirectoryInfo(start); dir != null; dir = dir.Parent)
            {
                if (!Directory.Exists(Path.Combine(dir.FullName, "backend", "CockpitSim")) ||
                    !Directory.Exists(Path.Combine(dir.FullName, "telemetry", "CockpitSim.Telemetry")))
                    continue;

                foreach (var path in new[] {
                    Path.Combine(dir.FullName, ".env"),
                    Path.Combine(dir.FullName, "CockpitSimApp", ".env") })
                {
                    if (seen.Add(path)) yield return path;
                }
                break;
            }
        }
    }
}
