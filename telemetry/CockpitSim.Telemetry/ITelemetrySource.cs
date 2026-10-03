namespace CockpitSim.Telemetry;

// Pluggable sample source. The live MSFS implementation arrives with the SDK
// (see MsfsSimConnectSource.cs); the mock keeps backend/dashboard development
// independent of the sim running.
public interface ITelemetrySource : IAsyncDisposable
{
    // Written as the `source` tag on every point so dashboards can tell a
    // simulated feed ("mock") from live sim data ("sim").
    string SourceName { get; }

    // Yields samples at approximately SamplesPerSecond until cancelled.
    IAsyncEnumerable<HoverSample> ReadAsync(CancellationToken ct);
}
