import { livePresentation } from './trainee-view-model.js';

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
let timeLimitMinutes = null;
let redirected = false;

function elapsedText() {
  if (!startedAt) return "00:00";
  const s = Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function remainingSeconds() {
  if (!startedAt || !timeLimitMinutes) return null;
  return Math.max(0, Math.floor(timeLimitMinutes * 60 - (Date.now() - startedAt.getTime()) / 1000));
}

function renderRemaining() {
  const rem = remainingSeconds();
  const row = document.getElementById("remaining-row");
  const dd = document.getElementById("remaining-time");
  if (rem === null) {
    row.hidden = true;
    return;
  }
  row.hidden = false;
  dd.textContent = `${String(Math.floor(rem / 60)).padStart(2, "0")}:${String(rem % 60).padStart(2, "0")}`;
  dd.classList.toggle("remaining-low", rem <= 60);
  const progress = document.getElementById('time-progress');
  if (progress) progress.style.width = `${Math.max(0, Math.min(100, rem / (timeLimitMinutes * 60) * 100))}%`;
}

function renderObjectives(scenarioKey) {
  const def = typeof scenarioDef === "function" ? scenarioDef(scenarioKey) : null;
  const panel = document.getElementById("objectives-panel");
  const list = document.getElementById("objectives-list");
  if (!def || !def.objectives || def.objectives.length === 0) {
    panel.hidden = true;
    return;
  }
  list.innerHTML = "";
  def.objectives.forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    list.appendChild(li);
  });
  panel.hidden = false;
}

function setState(text, ok) {
  const pill = document.getElementById("ongoing-state");
  pill.textContent = text;
  pill.className = `live-state${ok ? " success" : ""}`;
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
  document.getElementById("hud-status").textContent = "Live";
  document.getElementById("ongoing-exercise").textContent = scenarioDef(report.scenario)?.title || report.scenario || "Flight";
  document.getElementById("ongoing-session").textContent = report.sessionId || "—";
  document.getElementById("elapsed-time").textContent = elapsedText();

  const view = livePresentation(report);
  document.getElementById("tol-status").textContent = view.message;
  document.getElementById("ongoing-hint").textContent = view.state === 'waiting'
    ? 'Your flight continues while the simulator connects.'
    : view.state === 'on-track' ? 'Keep this steady control through the flight.'
    : 'Make a small correction and check the live indicators.';
  document.getElementById("warning-count").textContent = String((report.warnings || []).length);
  if (view.state === 'waiting' && report.warnings?.length) console.info('[live] simulator status', report.warnings);
  setState(view.state === 'waiting' ? 'Waiting' : view.state === 'on-track' ? 'On track' : 'Check', view.state === 'on-track');
  if (report.timeLimitMinutes && !timeLimitMinutes) {
    timeLimitMinutes = report.timeLimitMinutes;
  }
  renderRemaining();
  renderFlags(report);
}

async function pollOnce() {
  if (redirected) return;
  const res = await apiRequest(`/me/sessions/${sessionId}/live`, { auth: true });
  if (!res.ok || !res.data) {
    document.getElementById("ongoing-hint").textContent =
      "Connection paused. Keep flying; this screen will try again shortly.";
    return;
  }
  if (res.data.status === "completed" || res.data.status === "cancelled") {
    await handleFinished();
    return;
  }
  if (!startedAt) {
    startedAt = parseDbDate(res.data.startedAt);
    renderObjectives(res.data.scenario);
  }
  renderLive(res.data);
}

async function handleFinished() {
  if (redirected) return;
  document.getElementById("hud-status").textContent = "Complete";
  setState("Flight ended", true);
  document.getElementById("ongoing-hint").textContent = "Session ended — finalizing your report…";
  const res = await apiRequest(`/me/sessions/${sessionId}/report`, { auth: true });
  if (res.ok && res.data) {
    redirected = true;
    window.location.href = `./post-session.html?session=${encodeURIComponent(sessionId)}`;
  }
  // 404 = graded row not stored yet (grading takes seconds on long windows):
  // stay put, keep polling until it appears.
}

let ending = false;

async function endSession() {
  if (ending || redirected || !sessionId) return;
  ending = true;
  const btn = document.getElementById("btn-end-session");
  btn.disabled = true;
  document.getElementById("ongoing-hint").textContent = "Ending session…";
  const res = await apiRequest(`/me/sessions/${sessionId}/end`, {
    method: "POST",
    auth: true,
  });
  if (!res.ok) {
    ending = false;
    btn.disabled = false;
    document.getElementById("ongoing-hint").textContent =
      "Could not end the session — keep flying, or reload this page to retry.";
    return;
  }
  await handleFinished();
}

// Host (WPF) → page events about the simulator lifetime. Only wired up inside
// WebView2 (window.chrome.webview); a no-op in a plain browser.
function listenForSimulatorEvents() {
  if (!(window.chrome && window.chrome.webview)) return;
  window.chrome.webview.addEventListener("message", (e) => {
    const msg = e.data || {};
    const hint = document.getElementById("ongoing-hint");

    if (msg.event === "simulatorStarted") {
      hint.textContent = "Simulator launched. Your flight is ready.";
    } else if (msg.event === "simulatorLaunchFailed") {
      // Non-fatal: a manually-opened sim still feeds telemetry.
      console.warn('[live] simulator launch failed', msg.detail);
      hint.textContent = "The simulator did not open automatically. You can open it manually and continue.";
    } else if (msg.event === "simulatorClosed") {
      // Auto-end the session so the report is generated. endSession() no-ops
      // when the user already ended (ending/redirected guards) or no session.
      if (!redirected && !ending && sessionId) {
        hint.textContent = "Simulator closed — ending your session…";
        endSession();
      }
    }
  });
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
  const confirm = document.getElementById('end-confirm');
  document.getElementById("btn-end-session").addEventListener("click", () => confirm.showModal());
  document.getElementById('cancel-end').addEventListener('click', () => confirm.close());
  document.getElementById('confirm-end').addEventListener('click', () => { confirm.close(); endSession(); });
  listenForSimulatorEvents();
  pollOnce();
  pollTimer = setInterval(pollOnce, interval);
  clockTimer = setInterval(() => {
    document.getElementById("elapsed-time").textContent = elapsedText();
    renderRemaining();
  }, 1000);

  initLogoutConfirm();
});
