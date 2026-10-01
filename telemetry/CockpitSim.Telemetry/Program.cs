using CockpitSim.Telemetry;

// CockpitSim MSFS → InfluxDB bridge (hover first).
//
//   CockpitSim.Telemetry --session <id> [--scenario hover] [--rate 10] [--mock]
//     [--influx-url http://localhost:8086] [--org cockpitsim] [--bucket telemetry]
//     [--duration 60] [--dry-run]
//
// Token via INFLUX_TOKEN env (never a CLI arg, so it stays out of shell
// history). --dry-run prints line protocol to stdout instead of posting —
// needs no InfluxDB, no token, no sim.
var options = BridgeOptions.Parse(args);
if (options == null) return 2;

using var cts = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); };
if (options.DurationSeconds > 0)
    cts.CancelAfter(TimeSpan.FromSeconds(options.DurationSeconds));

await using ITelemetrySource source = options.Mock
    ? new MockHoverSource(options.RateHz)
    : new MsfsSimConnectSource(options.RateHz); // TODO: throws until MSFS SDK installed

using var influx = options.DryRun
    ? null
    : new InfluxWriter(options.InfluxUrl, options.Org, options.Bucket, options.Token);

Console.WriteLine(
    $"Bridge: session={options.SessionId} scenario={options.Scenario} " +
    $"rate={options.RateHz}Hz source={(options.Mock ? "mock-hover" : "msfs-simconnect")} " +
    $"target={(options.DryRun ? "stdout" : $"{options.InfluxUrl} bucket={options.Bucket}")}");

var batch = new List<string>(options.RateHz);
var batchDeadline = DateTimeOffset.UtcNow.AddSeconds(1);
var written = 0L;

try
{
    await foreach (var sample in source.ReadAsync(cts.Token))
    {
        var line = InfluxWriter.ToLineProtocol(sample, options.SessionId, options.Scenario);

        if (options.DryRun)
        {
            Console.WriteLine(line);
            written++;
            continue;
        }

        batch.Add(line);
        if (DateTimeOffset.UtcNow < batchDeadline || batch.Count < options.RateHz) continue;

        await influx!.WriteBatchAsync(batch, cts.Token);
        written += batch.Count;
        batch.Clear();
        batchDeadline = DateTimeOffset.UtcNow.AddSeconds(1);
    }
}
catch (OperationCanceledException) { /* Ctrl+C or --duration elapsed: flush below */ }

if (!options.DryRun && batch.Count > 0)
{
    try { await influx!.WriteBatchAsync(batch, CancellationToken.None); written += batch.Count; }
    catch (Exception ex) { Console.Error.WriteLine($"Flush failed: {ex.Message}"); }
}

Console.WriteLine($"Bridge stopped. Samples written: {written}.");
return 0;

internal sealed record BridgeOptions(
    string SessionId, string Scenario, int RateHz, bool Mock,
    string InfluxUrl, string Org, string Bucket, string Token,
    int DurationSeconds, bool DryRun)
{
    public static BridgeOptions? Parse(string[] args)
    {
        string? Get(string name)
        {
            for (var i = 0; i < args.Length - 1; i++)
                if (args[i] == name) return args[i + 1];
            return null;
        }
        var has = (string name) => args.Contains(name);

        var dryRun = has("--dry-run");
        var session = Get("--session") ?? (dryRun ? "dryrun" : null);
        if (session == null)
        {
            Console.Error.WriteLine("Missing --session <id> (or use --dry-run).");
            return null;
        }

        var scenario = Get("--scenario") ?? "hover";
        var rate = int.TryParse(Get("--rate"), out var r) ? Math.Clamp(r, 1, 20) : 10;
        var duration = int.TryParse(Get("--duration"), out var d) ? d : 0;

        var token = Environment.GetEnvironmentVariable("INFLUX_TOKEN") ?? string.Empty;
        if (!dryRun && string.IsNullOrWhiteSpace(token))
        {
            Console.Error.WriteLine("Missing InfluxDB token: set INFLUX_TOKEN env (never commit it).");
            return null;
        }

        return new BridgeOptions(
            session, scenario, rate,
            Mock: has("--mock") || dryRun, // dry-run always uses the mock source
            InfluxUrl: Get("--influx-url") ?? Environment.GetEnvironmentVariable("INFLUX_URL") ?? "http://localhost:8086",
            Org: Get("--org") ?? Environment.GetEnvironmentVariable("INFLUX_ORG") ?? "cockpitsim",
            Bucket: Get("--bucket") ?? Environment.GetEnvironmentVariable("INFLUX_BUCKET") ?? "telemetry",
            Token: token, duration, dryRun);
    }
}
