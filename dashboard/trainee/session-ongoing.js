// CockpitSim — Trainee Session Ongoing (simplified live view).
// Polls GET /api/me/sessions/{id}/live every pollMs for the scenario and
// redirects to the report once the session completes (report 200 = graded,
// 404 = "finalizing", keep polling). No raw numbers here by design — values
// stay hidden until the post-session report; only OK / BREACH / waiting flags.
// Guard: trainees (and admins previewing) only.
const session = requireRole(['trainee', 'admin']);

let sessionId = null;
let pollTimer = null;
let clockTimer = null;
let startedAt = null;
let redirected = false;

function elapsedText() {
  if (!startedAt) return "00:00";
  const s = Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function setState(text, ok) {
  const pill = document.getElementById("ongoing-state");
  pill.textContent = text;
  pill.className = `summary-pill${ok ? " success" : ""}`;
}

function renderFlags(report) {
  const list = document.getElementById("live-flags");
  list.innerHTML = "";
  (report.metrics || []).forEach((m) => {
    const li = document.createElement("li");
    const state = m.withinTol === true ? "ok" : m.withinTol === false ? "breach" : "wait";
    const label = m.withinTol === true ? "OK" : m.withinTol === false ? "CHECK" : "…";
    li.className = `flag flag-${state}`;
    li.innerHTML = `<span></span><span>${label}</span>`;
    li.querySelector("span").textContent = m.label;
    list.appendChild(li);
  });
}

function renderLive(report) {
  document.getElementById("hud-status").textContent = "LIVE";
  document.getElementById("ongoing-exercise").textContent = report.scenario || "—";
  document.getElementById("elapsed-time").textContent = elapsedText();

  const graded = (report.metrics || []).filter((m) => m.withinTol !== null && m.withinTol !== undefined);
  const breaches = graded.filter((m) => m.withinTol === false).length;
  const waiting = (report.metrics || []).length > 0 && graded.length === 0;

  document.getElementById("tol-status").textContent = waiting
    ? "Waiting for telemetry…"
    : breaches === 0 ? "All within tolerance" : `${breaches} metric${breaches > 1 ? "s" : ""} to check`;
  document.getElementById("warning-count").textContent = String((report.warnings || []).length);
  setState(waiting ? "CONNECTING" : breaches === 0 ? "ON TRACK" : "CHECK", breaches === 0 && !waiting);
  renderFlags(report);
}

async function pollOnce() {
  if (redirected) return;
  const res = await apiRequest(`/me/sessions/${sessionId}/live`, { auth: true });
  if (!res.ok || !res.data) {
    document.getElementById("ongoing-hint").textContent =
      "Lost contact with the session. Check the backend, then reload this page.";
    return;
  }
  if (res.data.status === "completed" || res.data.status === "cancelled") {
    await handleFinished();
    return;
  }
  if (!startedAt) startedAt = parseDbDate(res.data.startedAt);
  renderLive(res.data);
}

async function handleFinished() {
  if (redirected) return;
  document.getElementById("hud-status").textContent = "COMPLETE";
  setState("DONE", true);
  document.getElementById("ongoing-hint").textContent = "Session ended — finalizing your report…";
  const res = await apiRequest(`/me/sessions/${sessionId}/report`, { auth: true });
  if (res.ok && res.data) {
    redirected = true;
    window.location.href = `./post-session.html?session=${encodeURIComponent(sessionId)}`;
  }
  // 404 = graded row not stored yet (grading takes seconds on long windows):
  // stay put, keep polling until it appears.
}

document.addEventListener("DOMContentLoaded", () => {
  if (session) {
    document.getElementById("hud-username").textContent = session.username.toUpperCase();
  }
  sessionId = new URLSearchParams(window.location.search).get("session");
  if (!sessionId) {
    document.getElementById("ongoing-exercise").textContent = "No session selected";
    document.getElementById("ongoing-hint").textContent = "Start a session from the pre-session page first.";
    return;
  }
  const def = (typeof scenarioDef === "function" && scenarioDef("hover")) || null;
  const interval = (def && def.pollMs) || 1000;
  pollOnce();
  pollTimer = setInterval(pollOnce, interval);
  clockTimer = setInterval(() => {
    document.getElementById("elapsed-time").textContent = elapsedText();
  }, 1000);
  initLogoutConfirm();
});
