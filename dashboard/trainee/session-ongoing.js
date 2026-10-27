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

function bridgeCommand() {
  return `dotnet run --project telemetry/CockpitSim.Telemetry -- --mock --session ${sessionId} --rate 10`;
}

function renderLive(report) {
  document.getElementById("hud-status").textContent = "LIVE";
  document.getElementById("ongoing-exercise").textContent = report.scenario || "—";
  document.getElementById("ongoing-session").textContent = report.sessionId || "—";
  document.getElementById("elapsed-time").textContent = elapsedText();

  const warnings = report.warnings || [];
  const noBackend = warnings.some((w) => w.includes("not configured"));
  const noData = warnings.some((w) => w.includes("last 30s"));
  const simulated = warnings.some((w) => w.includes("Simulated feed"));

  const graded = (report.metrics || []).filter((m) => m.withinTol !== null && m.withinTol !== undefined);
  const breaches = graded.filter((m) => m.withinTol === false).length;
  const waiting = noBackend || noData || graded.length === 0;

  // Three visibly different states so there is no guessing: setup needed
  // (backend has no token) vs bridge not running (no points) vs live feed.
  const tolEl = document.getElementById("tol-status");
  const cmdWrap = document.getElementById("bridge-cmd-wrap");
  if (noBackend) {
    tolEl.textContent = "Setup needed — backend has no telemetry token.";
    document.getElementById("ongoing-hint").textContent =
      "Add INFLUX_TOKEN to the backend and restart it; live values appear here once data flows.";
    cmdWrap.hidden = true;
    setState("SETUP", false);
  } else if (noData || graded.length === 0) {
    tolEl.textContent = "Bridge not running — no points in the last 30s.";
    document.getElementById("ongoing-hint").textContent =
      simulated || !noData
        ? "Waiting for telemetry…"
        : "Start the bridge below (same session id), then fly or let the mock run.";
    document.getElementById("bridge-cmd").textContent = bridgeCommand();
    cmdWrap.hidden = false;
    setState("CONNECTING", false);
  } else {
    tolEl.textContent = breaches === 0 ? "All within tolerance" : `${breaches} metric${breaches > 1 ? "s" : ""} to check`;
    document.getElementById("ongoing-hint").textContent = simulated
      ? "Receiving simulated feed (mock) — not live MSFS 2020 data."
      : "Receiving live telemetry.";
    cmdWrap.hidden = true;
    setState(breaches === 0 ? "ON TRACK" : "CHECK", breaches === 0);
  }

  document.getElementById("warning-count").textContent = String(warnings.length);
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
      "Lost contact with the session. Check the backend, then reload this page.";
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
      hint.textContent = "Simulator launched — fly in MSFS, then press END SESSION when done.";
    } else if (msg.event === "simulatorLaunchFailed") {
      // Non-fatal: a manually-opened sim still feeds telemetry.
      hint.textContent = (msg.detail || "Could not launch MSFS via Steam.") +
        " Start it manually, then fly.";
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
  document.getElementById("btn-end-session").addEventListener("click", endSession);
  listenForSimulatorEvents();
  pollOnce();
  pollTimer = setInterval(pollOnce, interval);
  clockTimer = setInterval(() => {
    document.getElementById("elapsed-time").textContent = elapsedText();
    renderRemaining();
  }, 1000);

  initLogoutConfirm();
});
