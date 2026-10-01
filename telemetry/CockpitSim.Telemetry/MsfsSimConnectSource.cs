namespace CockpitSim.Telemetry;

// TODO: live MSFS 2020 source via the SDK's managed SimConnect.dll
// (MSFS SDK → Core Utilities Kit → SimConnect SDK → lib\managed).
// Integration point: reference that DLL, subscribe the §1 hover SimVars
// (GROUND VELOCITY, PLANE ALT ABOVE GROUND, PLANE HEADING DEGREES TRUE,
// VELOCITY BODY X/Z, VERTICAL SPEED, PLANE BANK/PITCH DEGREES,
// COLLECTIVE POSITION) at 10–20 Hz, map each OnRecvSimobjectData frame to a
// HoverSample, and return this class from Program.cs instead of
// MockHoverSource. Until the SDK is installed this type is intentionally
// unimplemented so nobody mistakes mock data for sim data.
public sealed class MsfsSimConnectSource : ITelemetrySource
{
    public MsfsSimConnectSource(int samplesPerSecond = 10)
    {
        throw new NotSupportedException(
            "MSFS SDK not installed. Install C:\\MSFS SDK, reference its managed " +
            "SimConnect.dll here, then implement OnRecvSimobjectData mapping.");
    }

    public IAsyncEnumerable<HoverSample> ReadAsync(CancellationToken ct) =>
        throw new NotSupportedException("MSFS SDK not installed — use --mock.");

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}
