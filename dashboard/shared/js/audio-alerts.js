// CockpitSim — in-session audio warnings (Web Audio API, no asset files).
// Beeps when a metric TRANSITIONS from OK to out-of-tolerance (edge trigger,
// not a repeating alarm), with a global cooldown so multiple simultaneous
// violations don't stack into noise. Latches reset when the metric recovers,
// so a new violation on the same metric beeps again.
//
// Browser autoplay policy: the AudioContext is created/resumed on the first
// user gesture — call audioAlerts.unlock() from any click handler (the pages
// wire this to the End Session button and a one-time document click).
//
// Usage:
//   audioAlerts.update(metrics);   // each poll cycle, pass report.metrics
//   audioAlerts.warnTimeExpired(); // one-shot double beep when time runs out
//   audioAlerts.setMuted(true);    // persisted to localStorage
//   audioAlerts.muted              // current state

const audioAlerts = (() => {
  const STORAGE_KEY = "cockpitSim.audioMuted";
  const COOLDOWN_MS = 5000;

  let ctx = null;
  let lastBeepAt = 0;
  const violated = new Set(); // metric keys currently out of tolerance
  let muted = false;
  try {
    muted = localStorage.getItem(STORAGE_KEY) === "1";
  } catch { /* storage unavailable — default unmuted */ }

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  // Two-tone descending beep: attention-grabbing but short.
  function beep(freqA = 880, freqB = 620, duration = 0.35) {
    if (muted) return;
    const ac = ensureCtx();
    if (!ac || ac.state !== "running") return;
    const t0 = ac.currentTime;
    [freqA, freqB].forEach((freq, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.08, t0 + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + i * 0.18 + duration * 0.45);
      osc.connect(gain).connect(ac.destination);
      osc.start(t0 + i * 0.18);
      osc.stop(t0 + i * 0.18 + duration * 0.5);
    });
  }

  // Call each live-poll cycle with report.metrics. Beeps once per metric that
  // newly goes out of tolerance (withinTol false), subject to the cooldown.
  function update(metrics) {
    const nowOut = new Set(
      (metrics || []).filter((m) => m.withinTol === false).map((m) => m.key)
    );
    const fresh = [...nowOut].filter((k) => !violated.has(k));
    violated.clear();
    nowOut.forEach((k) => violated.add(k));

    if (fresh.length === 0) return;
    const now = Date.now();
    if (now - lastBeepAt < COOLDOWN_MS) return;
    lastBeepAt = now;
    beep();
  }

  // Distinct longer triple beep for the final-minute / expired warning.
  function warnTimeExpired() {
    if (muted) return;
    beep(980, 740, 0.5);
    setTimeout(() => beep(980, 740, 0.5), 600);
  }

  function setMuted(value) {
    muted = !!value;
    try {
      localStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
    } catch { /* ignore */ }
  }

  // Resume the context from a user gesture (autoplay policy).
  function unlock() {
    ensureCtx();
  }

  return {
    update,
    warnTimeExpired,
    setMuted,
    unlock,
    get muted() { return muted; },
  };
})();
