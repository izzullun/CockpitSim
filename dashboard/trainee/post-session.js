// CockpitSim — Trainee Post-Session Report (live data).
// Reads ?session=<id> (falls back to the trainee's latest completed session),
// loads GET /api/me/sessions/{id}/report and renders all four sections with
// shared/js/report-renderer.js. No dummy data — ungraded sessions show the
// honest pending state.
// Guard: trainees (and admins previewing) only.
const session = requireRole(['trainee', 'admin']);

function sessionIdFromUrl() {
  return new URLSearchParams(window.location.search).get("session");
}

async function resolveSessionId() {
  const param = sessionIdFromUrl();
  if (param) return param;
  const res = await apiRequest("/me/sessions", { auth: true });
  if (!res.ok || !Array.isArray(res.data)) return null;
  const completed = res.data.filter((s) => s.status === "completed");
  return completed.length > 0 ? completed[completed.length - 1].sessionId : null;
}

function renderSummary(report, attemptLabel) {
  document.getElementById("summary-exercise").textContent =
    `${report.scenario}${attemptLabel ? ` — ${attemptLabel}` : ""}`;
  const outcome = reportOutcome(report);
  const pill = document.getElementById("summary-outcome");
  pill.textContent = outcome.text;
  pill.className = `summary-pill${outcome.cls ? ` ${outcome.cls}` : ""}`;

  const container = document.getElementById("summary-cards");
  container.innerHTML = "";
  reportSummaryCards(report).forEach((card) => {
    const article = document.createElement("article");
    article.className = "summary-card";
    article.innerHTML = `
      <span class="summary-card-label">${card.label}</span>
      <span class="summary-card-value">${card.value}</span>
      <span class="summary-card-delta">${card.delta}</span>
    `;
    container.appendChild(article);
  });
}

function renderTelemetry(report) {
  const list = document.getElementById("telemetry-stats");
  list.innerHTML = "";
  if (report.metrics.length === 0) {
    const empty = document.createElement("div");
    empty.className = "stat-item";
    empty.innerHTML = "<dt>No metrics</dt><dd>—</dd>";
    list.appendChild(empty);
    return;
  }
  report.metrics.forEach((m) => {
    const term = document.createElement("div");
    term.className = "stat-item";
    const flag = m.withinTol === false ? " ⚠" : "";
    // Graded rows show the acceptable range ("aim 3–7 ft"); informational rows
    // (no target) show only their value — fmtTarget returns "" so no span.
    const target = fmtTarget(m);
    const targetHtml = target ? ` <span class="stat-target">${target}</span>` : "";
    term.innerHTML = `<dt>${m.label}${flag}</dt><dd>${fmtActual(m)}${targetHtml}</dd>`;
    list.appendChild(term);
  });
  if (report.warnings.length > 0) {
    const item = document.createElement("div");
    item.className = "stat-item";
    item.innerHTML = `<dt>Warnings</dt><dd>${report.warnings.length}</dd>`;
    list.appendChild(item);
  }
}

function renderNotes(report) {
  const list = document.getElementById("trainer-notes");
  list.innerHTML = "";
  if (report.notes.length === 0) {
    const item = document.createElement("li");
    item.className = "note-item";
    item.textContent = "No trainer notes yet.";
    list.appendChild(item);
    return;
  }
  report.notes.forEach((n) => {
    const item = document.createElement("li");
    item.className = "note-item";
    item.textContent = `${n.author}: ${n.note}`;
    list.appendChild(item);
  });
}

function renderTimeline(report) {
  const list = document.getElementById("timeline-list");
  list.innerHTML = "";
  if (report.timeline.length === 0) {
    const li = document.createElement("li");
    li.className = "timeline-item";
    li.innerHTML = `<span class="timeline-event">No timeline events recorded.</span>`;
    list.appendChild(li);
    return;
  }
  report.timeline.forEach((item) => {
    const li = document.createElement("li");
    li.className = "timeline-item";
    li.innerHTML = `
      <span class="timeline-time">${item.time}</span>
      <span class="timeline-event"></span>
    `;
    // textContent for the event body: timeline text can include sim values.
    li.querySelector(".timeline-event").textContent = item.event;
    list.appendChild(li);
  });
}

function renderConclusion(report) {
  const verdict = reportConclusion(report);
  const copy = document.getElementById("action-copy");
  copy.textContent = verdict.tip
    ? `${verdict.copy}`
    : verdict.copy;
}

async function loadReport() {
  if (!session) return;
  document.getElementById("hud-username").textContent = session.username.toUpperCase();

  const id = await resolveSessionId();
  if (!id) {
    document.getElementById("summary-exercise").textContent = "No completed sessions yet";
    document.getElementById("action-copy").textContent =
      "Start your first session from the pre-session page.";
    return;
  }

  const res = await apiRequest(`/me/sessions/${id}/report`, { auth: true });
  if (!res.ok || !res.data) {
    document.getElementById("summary-exercise").textContent = "Report unavailable";
    document.getElementById("action-copy").textContent =
      res.status === 404
        ? "This session has no report yet — grading runs when the session ends."
        : "Could not load the report. Retry shortly.";
    return;
  }

  const report = res.data;
  let attemptLabel = "";
  const hist = await apiRequest("/me/sessions", { auth: true });
  if (hist.ok && Array.isArray(hist.data)) {
    const same = hist.data.filter((s) => s.scenario === report.scenario);
    const idx = same.findIndex((s) => s.sessionId === report.sessionId);
    if (idx >= 0) attemptLabel = `Attempt ${idx + 1}`;
  }

  renderSummary(report, attemptLabel);
  renderTelemetry(report);
  renderNotes(report);
  renderTimeline(report);
  renderConclusion(report);
}

document.addEventListener("DOMContentLoaded", () => {
  loadReport();
  initLogoutConfirm();
});
