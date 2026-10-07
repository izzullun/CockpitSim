namespace CockpitSim.Telemetry;

// Minimal .env loader (no package): fills INFLUX_* from local files so nobody
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
            foreach (var rawLine in File.ReadAllLines(path))
            {
                var line = rawLine.Trim();
                if (line.Length == 0 || line.StartsWith('#')) continue;
                var eq = line.IndexOf('=');
                if (eq <= 0) continue;
                var key = line[..eq].Trim();
                var value = line[(eq + 1)..].Trim().Trim('"');
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
    }
}
