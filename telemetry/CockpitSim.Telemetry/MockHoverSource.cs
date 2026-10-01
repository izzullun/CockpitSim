namespace CockpitSim.Telemetry;

// Deterministic-ish hover replay: holds the BasicHeliTraining.md hover box
// (5 ft AGL, ~0 groundspeed) with light noise + a slow heading pedal-turn
// drift so grading/tolerance code has something to chew on.
// Ceiling: canned data, not a flight model — replace with MsfsSimConnectSource
// once the MSFS SDK is installed (one-line swap in Program.cs).
public sealed class MockHoverSource : ITelemetrySource
{
    private readonly int _samplesPerSecond;
    private readonly Random _random = new(42); // fixed seed: replays are comparable

    // Hover targets (see BasicHeliTraining.md §1: 3–10 ft box, ±3 ft lateral).
    private const double TargetAltFt = 5.0;
    private const double TargetHeadingDeg = 90.0;

    public MockHoverSource(int samplesPerSecond = 10)
    {
        _samplesPerSecond = Math.Clamp(samplesPerSecond, 1, 20);
    }

    public async IAsyncEnumerable<HoverSample> ReadAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct)
    {
        var interval = TimeSpan.FromSeconds(1.0 / _samplesPerSecond);
        var t = 0;

        using var timer = new PeriodicTimer(interval);
        while (await timer.WaitForNextTickAsync(ct))
        {
            t++;
            var elapsed = t / (double)_samplesPerSecond;

            yield return new HoverSample
            {
                Timestamp = DateTimeOffset.UtcNow,
                // Hover taxi creep: ±0.4 kt wander around zero.
                GroundVelocityKt = Noise(0.0, 0.4),
                // Collective corrections chasing 5 ft: ±1.2 ft (inside ±2 ft tol).
                RadarAltFt = TargetAltFt + Noise(0.0, 1.2),
                // Slow pedal-turn drift ±3° around 090.
                HeadingTrueDeg = TargetHeadingDeg + 3.0 * Math.Sin(elapsed * 0.15) + Noise(0.0, 0.5),
                VelBodyX = Noise(0.0, 0.3),
                VelBodyZ = Noise(0.0, 0.3),
                VerticalSpeedFpm = Noise(0.0, 60.0),
                // Over-controlling wobble: ±2°.
                BankDeg = Noise(0.0, 2.0),
                PitchDeg = Noise(0.0, 2.0),
                // Collective working ~55% ±4 to hold the hover.
                CollectivePct = 55.0 + Noise(0.0, 4.0),
            };
        }
    }

    private double Noise(double mean, double amplitude) =>
        mean + (_random.NextDouble() * 2.0 - 1.0) * amplitude;

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}
