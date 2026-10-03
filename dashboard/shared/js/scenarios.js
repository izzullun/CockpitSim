// CockpitSim — scenario metric definitions (single source of truth).
// Server mirror: backend/CockpitSim/Services/ScenarioMetrics.cs — keep the
// keys, targets and tolerances in sync. Targets/tolerances come from
// BasicHeliTraining.md. Hover first; other scenarios get their sets next.
//
// Post-session aggregates: means for position/rate/power metrics, variability
// (stddev) for attitude/heading — the backend stores them in metrics[].actual
// in this same order (worst-first). `tip` powers the auto next-action:
// weakest graded metric -> its tip.
const SCENARIOS = {
  hover: {
    title: "Hover",
    pollMs: 1000,
    metrics: [
      { key: "radar_alt", label: "Radar Alt", unit: "ft", target: 5.0, tolerance: 2.0, aggregate: "mean",
        tip: "Make collective corrections earlier — chase the altitude trend, not the number." },
      { key: "ground_speed", label: "Ground Speed", unit: "kt", target: 0.0, tolerance: 1.0, aggregate: "mean",
        tip: "Anchor a ground reference point and correct drift before it reaches 1 kt." },
      { key: "vertical_speed", label: "Vertical Speed", unit: "ft/min", target: 0.0, tolerance: 100.0, aggregate: "mean",
        tip: "Freeze the collective once vertical speed trends to zero — small inputs, then wait." },
      { key: "bank", label: "Bank", unit: "°", target: 0.0, tolerance: 5.0, aggregate: "stddev",
        tip: "Level the wings with fingertip cyclic pressure — over-controlling shows up here first." },
      { key: "pitch", label: "Pitch", unit: "°", target: 0.0, tolerance: 5.0, aggregate: "stddev",
        tip: "Hold attitude with the horizon, not the altimeter — pitch wobble drives altitude wobble." },
      { key: "heading", label: "Heading", unit: "°", target: null, tolerance: null, aggregate: "stddev",
        tip: "Feed pedal smoothly ahead of the drift rather than chasing it after." },
      { key: "collective", label: "Collective", unit: "%", target: null, tolerance: null, aggregate: "mean",
        tip: "Smooth, early collective movement beats large late corrections." },
      { key: "on_ground", label: "On Ground", unit: "", target: null, tolerance: null, aggregate: "mean",
        tip: "Grades count only airborne time — lift into the hover to start scoring." },
    ],
  },
};

function scenarioDef(key) {
  return SCENARIOS[key] || null;
}

// Weakest graded metric = first metrics[] entry with withinTol === false
// (backend stores worst-first). Returns its tip, or null when all pass.
function weakestTip(scenarioKey, metrics) {
  const def = scenarioDef(scenarioKey);
  if (!def) return null;
  const worst = (metrics || []).find((m) => m.withinTol === false);
  if (!worst) return null;
  const tip = def.metrics.find((m) => m.key === worst.key);
  return tip ? { label: worst.label, tip: tip.tip } : null;
}
