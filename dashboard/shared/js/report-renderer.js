// CockpitSim — one SessionReport renderer, two sources.
// Live (score null, latest values) and post-session (aggregates + stored
// score) share this shape; only the data source differs — the swap is a
// one-line apiRequest call at each call site.
// Depends on: api.js (apiRequest, parseDbDate), scenarios.js (weakestTip).
// Score null renders as "—": that IS the honest pre-grading state.

function fmtActual(metric) {
  if (metric.actual === null || metric.actual === undefined) return "—";
  return `${metric.actual} ${metric.unit || ""}`.trim();
}

// Display choice: the report shows each metric's actual value only — no
// target/tolerance quote. Grading still uses target/tolerance server-side
// (ScenarioMetrics + GradingService); this only hides them on the report.
// Returns "" for every metric so the caller never renders a target span.
function fmtTarget(metric) {
  return "";
}

// 01 // summary cards from a report: flight time, completion, score, risk.
function reportSummaryCards(report) {
  const mins = report.endedAt
    ? Math.max(1, Math.round((parseDbDate(report.endedAt) - parseDbDate(report.startedAt)) / 60000))
    : null;
  const breachShare = report.metrics.length > 0
    ? report.metrics.filter((m) => m.withinTol === false).length / report.metrics.length
    : 0;
  const risk = report.score === null || report.score === undefined ? "—"
    : breachShare < 0.1 ? "Low" : breachShare < 0.3 ? "Medium" : "High";
  return [
    { label: "Flight time", value: mins === null ? "—" : `${mins} min`, delta: report.status },
    { label: "Completion", value: report.status === "completed" ? "100%" : report.status, delta: report.scenario },
    { label: "Score", value: report.score === null || report.score === undefined ? "—" : String(report.score),
      delta: report.score === null || report.score === undefined ? "awaiting grading" : (report.score >= 70 ? "PASS" : "needs work") },
    { label: "Risk", value: risk, delta: "tolerance breaches" },
  ];
}

function reportOutcome(report) {
  if (report.score === null || report.score === undefined) return { text: "PENDING", cls: "" };
  return report.score >= 70 ? { text: "PASS", cls: "success" } : { text: "REVIEW", cls: "" };
}

// 04 // verdict sentence + weakest-metric coaching tip.
function reportConclusion(report) {
  const tip = weakestTip(report.scenario, report.metrics);
  if (report.score === null || report.score === undefined) {
    return {
      copy: "This session has not been graded yet.",
      tip: null,
    };
  }
  if (!tip) {
    return {
      copy: `Clean session — score ${report.score}. Hold these tolerances next attempt.`,
      tip: null,
    };
  }
  return {
    copy: `Focus next attempt on ${tip.label.toLowerCase()} — ${tip.tip}`,
    tip,
  };
}
