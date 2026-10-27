using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Diagnostics;
using CockpitSim.Launcher;
using CockpitSim.Telemetry;

// Dependency-free regression checks: dotnet run --project tests/TelemetryStartup
if (args.Contains("--bundle-probe"))
{
    DotEnv.Load();
    Equal("bundle-token", Environment.GetEnvironmentVariable("INFLUX_TOKEN"));
    return 0;
}

var originalDirectory = Directory.GetCurrentDirectory();
var originalToken = Environment.GetEnvironmentVariable("INFLUX_TOKEN");
var fixture = Path.Combine(Path.GetTempPath(), "CockpitSim-startup-" + Guid.NewGuid());
var failures = 0;
try
{
    Directory.CreateDirectory(Path.Combine(fixture, "backend", "CockpitSim"));
    Directory.CreateDirectory(Path.Combine(fixture, "telemetry", "CockpitSim.Telemetry"));
    File.WriteAllText(Path.Combine(fixture, ".env"), "# local settings\nINFLUX_TOKEN=\"fixture-token\"\n");
    Directory.SetCurrentDirectory(Path.Combine(fixture, "backend", "CockpitSim"));

    Check("backend-directory startup finds the repo-root token", () =>
    {
        Environment.SetEnvironmentVariable("INFLUX_TOKEN", null);
        DotEnv.Load();
        Equal("fixture-token", Environment.GetEnvironmentVariable("INFLUX_TOKEN"));
    });
    Check("an explicit environment token wins over local files", () =>
    {
        Environment.SetEnvironmentVariable("INFLUX_TOKEN", "explicit-token");
        DotEnv.Load();
        Equal("explicit-token", Environment.GetEnvironmentVariable("INFLUX_TOKEN"));
    });

    Check("an unreadable optional file does not prevent startup", () =>
    {
        Environment.SetEnvironmentVariable("INFLUX_TOKEN", "explicit-token");
        using var lockedFile = File.Open(Path.Combine(fixture, ".env"), FileMode.Open,
            FileAccess.ReadWrite, FileShare.None);
        DotEnv.Load();
        Equal("explicit-token", Environment.GetEnvironmentVariable("INFLUX_TOKEN"));
    });

    Check("published bundle finds its parent token from an unrelated working directory", () =>
    {
        var bundle = Path.Combine(fixture, "bundle");
        var launcher = Path.Combine(bundle, "launcher");
        Directory.CreateDirectory(launcher);
        var copies = new List<string>();
        try
        {
            File.WriteAllText(Path.Combine(bundle, ".env"), "INFLUX_TOKEN=bundle-token\n");
            foreach (var source in Directory.GetFiles(AppContext.BaseDirectory, "TelemetryStartup.*"))
            {
                var target = Path.Combine(launcher, Path.GetFileName(source));
                File.Copy(source, target);
                copies.Add(target);
            }
            var start = new ProcessStartInfo(Path.Combine(launcher, "TelemetryStartup.exe"), "--bundle-probe")
            {
                WorkingDirectory = Directory.GetCurrentDirectory(),
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            start.Environment.Remove("INFLUX_TOKEN");
            using var child = Process.Start(start)!;
            if (!child.WaitForExit(10000) || child.ExitCode != 0)
                throw new Exception("Published-layout token lookup failed.");
        }
        finally
        {
            foreach (var copy in copies) File.Delete(copy);
            File.Delete(Path.Combine(bundle, ".env"));
            Directory.Delete(launcher);
            Directory.Delete(bundle);
        }
    });

    // Exercise the real host with a healthy HTTP server. It must prepare the
    // bridge's environment even when it does not start a backend process.
    var envPath = Path.Combine(AppContext.BaseDirectory, ".env");
    if (File.Exists(envPath)) throw new InvalidOperationException("Unexpected test-output .env; refusing to replace it.");
    File.WriteAllText(envPath, "INFLUX_TOKEN=launcher-token\n");
    try
    {
        Environment.SetEnvironmentVariable("INFLUX_TOKEN", null);
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        var serve = Task.Run(async () =>
        {
            using var client = await listener.AcceptTcpClientAsync();
            using var stream = client.GetStream();
            var buffer = new byte[4096];
            await stream.ReadAsync(buffer);
            await stream.WriteAsync(Encoding.ASCII.GetBytes(
                "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}"));
        });
        using var host = new BackendHost(new LauncherConfig { BackendBaseUrl = $"http://127.0.0.1:{port}" });
        var healthy = await host.EnsureRunningAsync();
        await serve.WaitAsync(TimeSpan.FromSeconds(5));
        Check("healthy existing backend still prepares the bridge token", () =>
        {
            if (!healthy) throw new Exception("Health check failed.");
            Equal("launcher-token", Environment.GetEnvironmentVariable("INFLUX_TOKEN"));
        });
    }
    finally { File.Delete(envPath); }
}
finally
{
    Directory.SetCurrentDirectory(originalDirectory);
    Environment.SetEnvironmentVariable("INFLUX_TOKEN", originalToken);
    // Delete only this test's known files; leave no token fixtures behind.
    File.Delete(Path.Combine(fixture, ".env"));
    Directory.Delete(Path.Combine(fixture, "backend", "CockpitSim"));
    Directory.Delete(Path.Combine(fixture, "backend"));
    Directory.Delete(Path.Combine(fixture, "telemetry", "CockpitSim.Telemetry"));
    Directory.Delete(Path.Combine(fixture, "telemetry"));
    Directory.Delete(fixture);
}
return failures == 0 ? 0 : 1;

void Check(string name, Action check)
{
    try { check(); Console.WriteLine($"PASS: {name}"); }
    catch (Exception ex) { failures++; Console.WriteLine($"FAIL: {name}: {ex.Message}"); }
}
static void Equal(string expected, string? actual)
{
    // Never include token values in test output.
    if (expected != actual) throw new Exception("Expected token was not loaded.");
}
