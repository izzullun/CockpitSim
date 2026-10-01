// One hover sample. Field names mirror the SimVars in BasicHeliTraining.md
// (§1 Hovering) so the backend grading service can map 1:1 without a
// translation table. Units are fixed per field — see ToLineProtocol().
namespace CockpitSim.Telemetry;

// All fields are doubles; missing/failed reads are double.NaN (dropped from
// the line-protocol output so Influx never stores a bogus zero).
public sealed record HoverSample
{
    public DateTimeOffset Timestamp { get; init; } = DateTimeOffset.UtcNow;

    public double GroundVelocityKt { get; init; }   // GROUND VELOCITY (kt)
    public double RadarAltFt { get; init; }         // PLANE ALT ABOVE GROUND (ft)
    public double HeadingTrueDeg { get; init; }     // PLANE HEADING DEGREES TRUE
    public double VelBodyX { get; init; }           // VELOCITY BODY X (m/s, +right)
    public double VelBodyZ { get; init; }           // VELOCITY BODY Z (m/s, +forward)
    public double VerticalSpeedFpm { get; init; }   // VERTICAL SPEED (ft/min)
    public double BankDeg { get; init; }            // PLANE BANK DEGREES
    public double PitchDeg { get; init; }           // PLANE PITCH DEGREES
    public double CollectivePct { get; init; }      // COLLECTIVE POSITION (%)
}
