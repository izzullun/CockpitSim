using CockpitSim.Telemetry;

// CockpitSim MSFS → InfluxDB bridge (hover first).
//
//   CockpitSim.Telemetry [--session <id>] [--scenario hover] [--rate 10] [--mock]
//     [--influx-url http://localhost:8086] [--org cockpitsim] [--bucket telemetry]
//     [--backend-url http://localhost:5247] [--duration 60] [--dry-run]
//
// Session resolution: explicit --session wins (single-shot); otherwise the
// bridge polls GET /api/bridge/active, feeds each session in turn, and goes
// back to waiting when one ends — it runs for the whole app lifetime.
// Token via INFLUX_TOKEN env or local
// .env files (see DotEnv) — never a CLI arg, so it stays out of shell
// history. --dry-run prints line protocol to stdout — no backend, Influx, or
// sim needed.
DotEnv.Load();
var options = BridgeOptions.Parse(args);
if (options == null) return 2;

using var cts = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); };
if (options.DurationSeconds > 0)
    cts.CancelAfter(TimeSpan.FromSeconds(options.DurationSeconds));

await using ITelemetrySource source = options.Mock
    ? new MockHoverSource(options.RateHz)
    : new MsfsSimConnectSource(options.RateHz); // TODO: picks up --session/attach the same way once the SDK lands

var sessionId = options.SessionId;
var scenario = options.Scenario;
SessionDiscovery? discovery = null;
// Discovery mode (no --session): wait for sessions and feed each in turn for
// the life of the process — this is what the launcher auto-starts, so the app
// never needs a session id. Explicit --session (and --dry-run) stay single-shot.
var discoveryMode = !options.DryRun && sessionId == null;
if (discoveryMode)
    discovery = new SessionDiscovery(options.BackendUrl, options.Token);
else if (options.DryRun && sessionId == null)
    sessionId = "dryrun";

using var influx = options.DryRun
    ? null
    : new InfluxWriter(options.InfluxUrl, options.Org, options.Bucket, options.Token);

var written = 0L;
var fatalAuth = false;

void PrintBanner() => Console.WriteLine(
    $"Bridge: session={sessionId} scenario={scenario} " +
    $"rate={options.RateHz}Hz feed={source.SourceName} " +
    $"({(options.Mock ? "SIMULATED hover replay — not MSFS data" : "LIVE MSFS 2020 data")}) " +
    $"target={(options.DryRun ? "stdout" : $"{options.InfluxUrl} bucket={options.Bucket}")}");

// Discovery wait: returns false on cancel/fatal (caller stops), true attached.
async Task<bool> WaitForSessionAsync()
{
    while (true)
    {
        SessionDiscovery.ActiveSession? active;
        try
        {
            active = await discovery!.GetActiveAsync(cts.Token);
        }
        catch (UnauthorizedAccessException ex)
        {
            Console.Error.WriteLine(ex.Message);
            fatalAuth = true;
            return false;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
        if (active != null && !string.IsNullOrWhiteSpace(active.SessionId))
        {
            sessionId = active.SessionId;
            scenario = active.Scenario;
            Console.WriteLine($"Attached to session {sessionId} ({scenario}).");
            return true;
        }
        Console.WriteLine("Waiting for an active session — press START SESSION in the app...");
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(5), cts.Token);
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }
}

// One feed pass. Returns true when OUR session ended (loop back to waiting in
// discovery mode); false on cancel. Explicit --session never reports ended —
// it keeps the legacy write-regardless behavior.
async Task<bool> FeedSessionAsync()
{
    var batch = new List<string>(options.RateHz);
    var batchDeadline = DateTimeOffset.UtcNow.AddSeconds(1);
    var sessionCheckAt = DateTimeOffset.UtcNow.AddSeconds(5);
    try
    {
        await foreach (var sample in source.ReadAsync(cts.Token))
        {
            var line = InfluxWriter.ToLineProtocol(sample, sessionId!, scenario, source.SourceName);

            if (options.DryRun)
            {
                Console.WriteLine(line);
                written++;
                continue;
            }

            batch.Add(line);
            if (DateTimeOffset.UtcNow < batchDeadline || batch.Count < options.RateHz) continue;

            // A failed batch must never kill the feed (Influx restarting,
            // Docker paused, network hiccup): drop that second loudly and
            // keep sampling.
            try
            {
                await influx!.WriteBatchAsync(batch, cts.Token);
                written += batch.Count;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Write failed ({ex.Message}) — dropped {batch.Count} samples, retrying...");
            }
            batch.Clear();
            batchDeadline = DateTimeOffset.UtcNow.AddSeconds(1);

            if (discoveryMode && DateTimeOffset.UtcNow >= sessionCheckAt)
            {
                sessionCheckAt = DateTimeOffset.UtcNow.AddSeconds(5);
                SessionDiscovery.ActiveSession? current;
                try
                {
                    current = await discovery!.GetActiveAsync(cts.Token);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                if (current == null || current.SessionId != sessionId)
                {
                    Console.WriteLine("Session ended — waiting for the next session...");
                    return true;
                }
            }
        }
    }
    catch (OperationCanceledException) { /* Ctrl+C or --duration elapsed: flush below */ }

    if (!options.DryRun && batch.Count > 0)
    {
        try { await influx!.WriteBatchAsync(batch, CancellationToken.None); written += batch.Count; }
        catch (Exception ex) { Console.Error.WriteLine($"Flush failed: {ex.Message}"); }
    }
    return false;
}

if (discoveryMode)
{
    while (!cts.Token.IsCancellationRequested)
    {
        if (!await WaitForSessionAsync()) break;
        PrintBanner();
        await FeedSessionAsync();
    }
}
else
{
    PrintBanner();
    await FeedSessionAsync();
}

discovery?.Dispose();
Console.WriteLine($"Bridge stopped. Samples written: {written}.");
return fatalAuth ? 1 : 0;

internal sealed record BridgeOptions(
    string? SessionId, string Scenario, int RateHz, bool Mock,
    string InfluxUrl, string Org, string Bucket, string Token,
    string BackendUrl, int DurationSeconds, bool DryRun)
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
        var session = Get("--session"); // null = discover from the backend (not for dry-run)

        var scenario = Get("--scenario") ?? "hover";
        var rate = int.TryParse(Get("--rate"), out var r) ? Math.Clamp(r, 1, 20) : 10;
        var duration = int.TryParse(Get("--duration"), out var d) ? d : 0;

        var token = Environment.GetEnvironmentVariable("INFLUX_TOKEN") ?? string.Empty;
        if (!dryRun && string.IsNullOrWhiteSpace(token))
        {
            Console.Error.WriteLine("Missing InfluxDB token: set INFLUX_TOKEN env or add a local .env (never commit it).");
            return null;
        }

        return new BridgeOptions(
            session, scenario, rate,
            Mock: has("--mock") || dryRun, // dry-run always uses the mock source
            InfluxUrl: Get("--influx-url") ?? Environment.GetEnvironmentVariable("INFLUX_URL") ?? "http://localhost:8086",
            Org: Get("--org") ?? Environment.GetEnvironmentVariable("INFLUX_ORG") ?? "cockpitsim",
            Bucket: Get("--bucket") ?? Environment.GetEnvironmentVariable("INFLUX_BUCKET") ?? "telemetry",
            Token: token,
            BackendUrl: Get("--backend-url") ?? Environment.GetEnvironmentVariable("BACKEND_URL") ?? "http://localhost:5247",
            DurationSeconds: duration, DryRun: dryRun);
    }
}
