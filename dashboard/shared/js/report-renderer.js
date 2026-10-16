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
  // Risk mirrors the backend rule (GradingService): weighted breach rate
  // (100 - score) <10 → Low, <30 → Medium, else High.
  const breachRate = report.score === null || report.score === undefined ? null : 100 - report.score;
  const risk = breachRate === null ? "—"
    : breachRate < 10 ? "Low" : breachRate < 30 ? "Medium" : "High";
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

// 05 // visible score calculation — per-metric breakdown table plus the
// formula string stored by the backend (scoreFormula). Returns "" for live /
// ungraded reports (score null) so callers can inject it unconditionally.
// Additive fields only (weight / withinPct / contribution) — old stored
// reports without them fall back to weights from scenarios.js.
function reportScoreBreakdown(report) {
  if (!report || report.score === null || report.score === undefined) return "";
  const def = scenarioDef(report.scenario);
  const fallbackWeights = (def && def.weights) || {};
  const threshold = report.passThreshold || (def && def.passThreshold) || 70;

  const rows = (report.metrics || [])
    .filter((m) => (m.weight !== null && m.weight !== undefined) || fallbackWeights[m.key])
    .map((m) => {
      const weight = m.weight !== null && m.weight !== undefined ? m.weight : fallbackWeights[m.key];
      const pct = m.withinPct;
      const contrib = m.contribution;
      const calc = (pct === null || pct === undefined || contrib === null || contrib === undefined)
        ? "—"
        : `${weight} × ${pct.toFixed(1)}% = ${contrib.toFixed(1)}`;
      return `<tr>
        <td>${m.label}</td>
        <td>${weight}</td>
        <td>${pct === null || pct === undefined ? "—" : pct.toFixed(1) + "%"}</td>
        <td>${calc}</td>
      </tr>`;
    })
    .join("");

  if (!rows) return "";
  const verdict = report.score >= threshold ? "PASS" : "NEEDS WORK";
  // Risk uses the backend rule: weighted breach rate (100 - score).
  const breach = Math.round((100 - report.score) * 10) / 10;
  const risk = breach < 10 ? "Low" : breach < 30 ? "Medium" : "High";
  return `
    <section class="score-breakdown">
      <h3>How your score was calculated</h3>
      <p class="score-breakdown__hint">Each graded metric tracks what % of the session you stayed within its tolerance band. That % is multiplied by the metric's weight; the contributions add up to your score. <strong>PASS needs ${threshold} or more.</strong></p>
      <table class="score-breakdown__table">
        <thead><tr><th>Metric</th><th>Weight</th><th>Within tolerance</th><th>Weight × % = contribution</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr><th colspan="3">Total score</th><th>${report.score} / 100 → ${verdict} (threshold ${threshold})</th></tr>
          <tr><th colspan="3">Risk</th><th>${risk} — weighted breach rate ${breach}% (&lt;10 Low, &lt;30 Medium, else High)</th></tr>
        </tfoot>
      </table>
      ${report.scoreFormula ? `<p class="score-breakdown__formula">Full calculation: <code>${report.scoreFormula}</code></p>` : ""}
    </section>`;
}
