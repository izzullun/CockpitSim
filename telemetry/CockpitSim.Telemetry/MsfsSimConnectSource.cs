using System.Runtime.InteropServices;
using System.Threading.Channels;
using Microsoft.FlightSimulator.SimConnect;

namespace CockpitSim.Telemetry;

// Live MSFS 2020 source. The managed SimConnect wrapper is message-driven, so
// this owns a hidden WinForms window on a dedicated STA thread; sim frames are
// funneled through a bounded channel (latest wins) to the async consumer.
// All-FLOAT64 definition (tightly-packed sim buffers + mixed types =
// misalignment): booleans arrive as 0.0/1.0. SIM_FRAME subscription throttled
// in code to the requested rate. Sim closed/absent = retry with a banner, the
// process never exits on its own (the launcher owns its lifetime).
public sealed class MsfsSimConnectSource : ITelemetrySource
{
    public string SourceName => "sim";

    private readonly int _samplesPerSecond;
    private readonly Channel<HoverSample> _channel =
        Channel.CreateBounded<HoverSample>(new BoundedChannelOptions(32)
        {
            FullMode = BoundedChannelFullMode.DropOldest, // live view wants now, not backlog
            SingleReader = true,
            SingleWriter = true,
        });
    private readonly CancellationTokenSource _pumpCts = new();
    private Thread? _pumpThread;
    private bool _disposed;

    public MsfsSimConnectSource(int samplesPerSecond = 10)
    {
        _samplesPerSecond = Math.Clamp(samplesPerSecond, 1, 20);
        _pumpThread = new Thread(PumpLoop)
        {
            IsBackground = true,
            Name = "SimConnect pump",
        };
        _pumpThread.SetApartmentState(ApartmentState.STA);
        _pumpThread.Start();
    }

    public async IAsyncEnumerable<HoverSample> ReadAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct)
    {
        await foreach (var sample in _channel.Reader.ReadAllAsync(ct))
            yield return sample;
    }

    private void PumpLoop()
    {
        // Safety net: any exception thrown on this WinForms thread (e.g. from a
        // Form.Load handler) is caught here and logged instead of popping the
        // JIT crash dialog — the loop below then reconnects. ThrowException
        // would re-raise at the Application.Run call site; CatchException routes
        // to ThreadException, which we swallow so the retry keeps running.
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += OnPumpThreadException;
        try
        {
            while (!_pumpCts.Token.IsCancellationRequested)
            {
                try
                {
                    using var form = new SimPumpForm(_samplesPerSecond, _channel.Writer, _pumpCts.Token);
                    Application.Run(form); // returns on cancel or sim quit
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"[sim] pump error ({ex.Message}) — retrying in 5s...");
                }
                if (_pumpCts.Token.IsCancellationRequested) break;
                Console.WriteLine("[sim] sim disconnected — waiting for reconnect...");
                Thread.Sleep(TimeSpan.FromSeconds(5));
            }
        }
        finally
        {
            Application.ThreadException -= OnPumpThreadException;
        }
        _channel.Writer.TryComplete();
    }

    private static void OnPumpThreadException(object sender, ThreadExceptionEventArgs e)
    {
        Console.Error.WriteLine($"[sim] recoverable UI-thread error: {e.Exception.Message}");
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        _pumpCts.Cancel();
        await Task.Run(() => _pumpThread?.Join(TimeSpan.FromSeconds(5)));
        _pumpCts.Dispose();
    }

    // Must match the data definition order EXACTLY (see Subscribe): ten
    // doubles, sequential, no padding surprises.
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi, Pack = 1)]
    private struct HeliFrame
    {
        public double GroundVelocityKt;
        public double RadarAltFt;
        public double HeadingTrueDeg;
        public double VelBodyX;
        public double VelBodyZ;
        public double VerticalSpeedFpm;
        public double BankDeg;
        public double PitchDeg;
        public double CollectivePct;
        public double OnGround;
    }

    private enum Def : uint { Heli = 0 }
    private enum Req : uint { Heli = 0 }

    private sealed class SimPumpForm : Form
    {
        private const int WM_USER_SIMCONNECT = 0x0402;

        private readonly int _minIntervalMs;
        private readonly ChannelWriter<HoverSample> _out;
        private readonly CancellationToken _ct;
        private SimConnect? _sim;
        private long _lastEmitTicks;

        public SimPumpForm(int samplesPerSecond, ChannelWriter<HoverSample> output, CancellationToken ct)
        {
            _minIntervalMs = 1000 / Math.Clamp(samplesPerSecond, 1, 20);
            _out = output;
            _ct = ct;
            ShowInTaskbar = false;
            WindowState = FormWindowState.Minimized;
            Load += (_, _) =>
            {
                Visible = false;
                Open();
            };
        }

        private void Open()
        {
            try
            {
                // Throws COMException E_FAIL when MSFS isn't running (or the sim
                // isn't up yet). Caught here so the form closes and PumpLoop
                // retries in 5s — previously this escaped the Form.Load handler
                // and surfaced as a WinForms thread-exception crash dialog.
                _sim = new SimConnect("CockpitSim", Handle, WM_USER_SIMCONNECT, null, 0);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[sim] MSFS not reachable ({ex.Message}) — will retry.");
                Close(); // returns Application.Run; PumpLoop sleeps and retries
                return;
            }
            _sim.OnRecvQuit += (_, _) =>
            {
                // Sim closed: unwind the message loop; the pump thread retries.
                BeginInvoke(Close);
            };
            _sim.OnRecvException += (_, e) => Console.Error.WriteLine(
                $"[sim] datum rejected by sim: exception={e.dwException} sendId={e.dwSendID} index={e.dwIndex}");
            _sim.OnRecvSimobjectData += (_, e) =>
            {
                var now = DateTimeOffset.UtcNow.Ticks;
                if (now - Interlocked.Read(ref _lastEmitTicks) < _minIntervalMs * TimeSpan.TicksPerMillisecond)
                    return; // SIM_FRAME firehose throttled to the requested rate
                Interlocked.Exchange(ref _lastEmitTicks, now);

                var f = (HeliFrame)e.dwData[0];
                _out.TryWrite(new HoverSample
                {
                    Timestamp = DateTimeOffset.UtcNow,
                    GroundVelocityKt = f.GroundVelocityKt,
                    RadarAltFt = f.RadarAltFt,
                    HeadingTrueDeg = f.HeadingTrueDeg,
                    VelBodyX = f.VelBodyX,
                    VelBodyZ = f.VelBodyZ,
                    VerticalSpeedFpm = f.VerticalSpeedFpm,
                    BankDeg = f.BankDeg,
                    PitchDeg = f.PitchDeg,
                    CollectivePct = f.CollectivePct,
                    OnGround = f.OnGround >= 0.5,
                });
            };

            Subscribe();
            Console.WriteLine("[sim] connected to MSFS 2020, streaming hover data.");
        }

        private void Subscribe()
        {
            // (name, unit) pairs mirror BasicHeliTraining.md §1; units match the
            // backend's fixed semantics (kt / ft / deg / m/s / ft/min / %).
            // A wrong name/unit surfaces here as an OnRecvException datum id.
            var defs = new (string Name, string Unit)[]
            {
                ("GROUND VELOCITY", "Knots"),
                ("PLANE ALT ABOVE GROUND", "Feet"),
                ("PLANE HEADING DEGREES TRUE", "Degrees"),
                ("VELOCITY BODY X", "Meters per second"),
                ("VELOCITY BODY Z", "Meters per second"),
                ("VERTICAL SPEED", "Feet per minute"),
                ("PLANE BANK DEGREES", "Degrees"),
                ("PLANE PITCH DEGREES", "Degrees"),
                ("COLLECTIVE POSITION", "Percent"),
                ("SIM ON GROUND", "Bool"),
            };
            foreach (var (name, unit) in defs)
            {
                _sim!.AddToDataDefinition(Def.Heli, name, unit,
                    SIMCONNECT_DATATYPE.FLOAT64, 0.0f, SimConnect.SIMCONNECT_UNUSED);
            }
            _sim!.RegisterDataDefineStruct<HeliFrame>(Def.Heli);
            _sim!.RequestDataOnSimObject(Req.Heli, Def.Heli,
                SimConnect.SIMCONNECT_OBJECT_ID_USER, SIMCONNECT_PERIOD.SIM_FRAME,
                SIMCONNECT_DATA_REQUEST_FLAG.DEFAULT, 0, 0, 0);
        }

        protected override void DefWndProc(ref Message m)
        {
            if (m.Msg == WM_USER_SIMCONNECT && _sim != null)
            {
                try
                {
                    _sim.ReceiveMessage();
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"[sim] receive failed: {ex.Message}");
                }
            }
            else base.DefWndProc(ref m);
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            try { _sim?.Dispose(); } catch { }
            _sim = null;
            base.OnFormClosing(e);
        }
    }
}
