// ==========================================================================
// CockpitSim — Trainee Pre-Session View
// Live data: profile + session history come from the backend (/api/me,
// /api/me/sessions) via shared/js/api.js.
//
// TODO (Member 4 — WPF Launcher / Launcher API ready):
//   Replace the startSession() stub with a real local HTTP call to the
//   Launcher API: POST /msfs/launch, then poll GET /session/status.
//
// TODO (scheduling feature): the "upcoming session" panel still shows dummy
//   data — no session-scheduling API exists yet.
// ==========================================================================

// Guard: trainees (and admins previewing) only.
const session = requireRole(['trainee', 'admin']);

if (session) {

// Dummy until a scheduling API exists.
const DUMMY_UPCOMING = {
  exercise: "Autorotation Recovery — Attempt 4",
  scheduled: "2026-07-21 14:00",
  estDuration: "25 min",
  notes: "Focus on collective timing during flare. Trainer notes from last attempt available below.",
};

function renderProfile(profile) {
  document.getElementById("profile-name").textContent = profile.fullName;
  document.getElementById("profile-role").textContent = profile.role;
  document.getElementById("profile-trainer").textContent = profile.assignedTrainer;

  document.getElementById("profile-last-login").textContent = profile.lastLogin || "—";

  const hudName = profile.fullName.toUpperCase().replace(/\s+/g, "_");
  document.getElementById("hud-username").textContent = hudName;
}

// Static pass/fail criteria panel — the trainee-visible mirror of the
// backend grading rules (GradingService). Weights come from scenarios.js so
// the two stay in sync via the single source of truth.
function renderPassCriteria(durationMinutes) {
  const host = document.getElementById("pass-criteria");
  if (!host || typeof scenarioDef !== "function") return;
  const def = scenarioDef("hover");
  if (!def) return;

  const weightRows = Object.entries(def.weights || {})
    .map(([key, w]) => {
      const metric = def.metrics.find((m) => m.key === key);
      return `<tr><td>${metric ? metric.label : key}</td><td>${w}</td></tr>`;
    })
    .join("");

  host.innerHTML = `
    <div class="guideline-panel">
      <h3>Pass criteria</h3>
      <ul>
        <li><strong>PASS</strong>: score ≥ ${def.passThreshold}. <strong>NEEDS WORK</strong>: below ${def.passThreshold}.</li>
        <li>Score = Σ (weight × % of session spent within tolerance) across the graded metrics below.</li>
        <li>Finish the objective within the session time limit of <strong>${durationMinutes} min</strong> — the session ends automatically when time expires.</li>
      </ul>
      <table>
        <thead><tr><th>Graded metric</th><th>Weight</th></tr></thead>
        <tbody>${weightRows}</tbody>
      </table>
    </div>`;
}

function renderUpcoming(upcoming) {
  document.getElementById("upcoming-exercise").textContent = upcoming.exercise;
  document.getElementById("upcoming-date").textContent = upcoming.scheduled;
  document.getElementById("upcoming-duration").textContent = upcoming.estDuration;
  document.getElementById("upcoming-notes").textContent = upcoming.notes;
}

function outcomeBadge(outcome) {
  const labels = { success: "SUCCESS", failed: "FAILED", pending: "PENDING" };
  const cls = { success: "outcome-success", failed: "outcome-failed", pending: "outcome-pending" };
  const span = document.createElement("span");
  span.className = `outcome-badge ${cls[outcome] || "outcome-pending"}`;
  span.textContent = labels[outcome] || "PENDING";
  return span;
}

function renderHistory(history) {
  const tbody = document.getElementById("history-body");
  tbody.innerHTML = "";

  if (history.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="5" style="color: rgba(230,241,255,0.4);">No sessions logged yet. Start your first session above.</td>`;
    tbody.appendChild(row);
    return;
  }

  history.forEach((entry) => {
    const row = document.createElement("tr");

    const attemptCell = document.createElement("td");
    attemptCell.textContent = `#${entry.attempt}`;

    const dateCell = document.createElement("td");
    dateCell.textContent = entry.date;

    const durationCell = document.createElement("td");
    durationCell.textContent = entry.duration;

    const outcomeCell = document.createElement("td");
    outcomeCell.appendChild(outcomeBadge(entry.outcome));

    const feedbackCell = document.createElement("td");
    feedbackCell.textContent = entry.feedback || "—";
    if (entry.status === "completed" && entry.sessionId) {
      const link = document.createElement("a");
      link.className = "queue-link";
      link.href = `./post-session.html?session=${encodeURIComponent(entry.sessionId)}`;
      link.textContent = "View report";
      feedbackCell.append(document.createElement("br"), link);
    }

    row.append(attemptCell, dateCell, durationCell, outcomeCell, feedbackCell);
    tbody.appendChild(row);
  });
}

// Map one backend session record to a history-table row. sessionId is carried
// through so completed rows can link to their post-session report.
function toHistoryEntry(s) {
  const started = parseDbDate(s.startedAt);
  let duration = "—";
  if (s.endedAt) {
    const minutes = Math.round((parseDbDate(s.endedAt) - started) / 60000);
    duration = `${minutes} min`;
  }

  // TODO: surface the trainer's note text here once an endpoint exposes
  // notes to the trainee (currently trainer-only).
  const outcome = s.status === "completed" ? "success"
    : s.status === "cancelled" ? "failed"
    : "pending";

  return {
    sessionId: s.sessionId,
    status: s.status,
    attempt: s.attempt,
    date: started.toISOString().slice(0, 10),
    duration,
    outcome,
    feedback: ""
  };
}

async function loadLiveSection() {
  // Profile — replaces the old DUMMY_PROFILE block.
  const meRes = await apiRequest("/me", { auth: true });
  if (meRes.ok && meRes.data) {
    const me = meRes.data;
    renderProfile({
      fullName: me.fullName,
      role: "Trainee",
      assignedTrainer: me.assignedTrainerName || "Unassigned",
      lastLogin: me.lastLoginAt
        ? parseDbDate(me.lastLoginAt).toLocaleString("en-GB", { hour12: false })
        : null,
    });

    // Real session time limit (trainer-configured, default 25 min).
    const mins = me.sessionDurationMinutes || 25;
    const durEl = document.getElementById("upcoming-duration");
    if (durEl) durEl.textContent = `${mins} min`;
    renderPassCriteria(mins);
  }

  // Session history — replaces DUMMY_HISTORY.
  const sessRes = await apiRequest("/me/sessions", { auth: true });
  if (sessRes.ok && Array.isArray(sessRes.data)) {
    renderHistory(sessRes.data.map(toHistoryEntry).reverse());
  }
}

let launchInProgress = false;

// Ask the WPF host to launch MSFS 2020 via Steam (steam://rungameid). This is
// a no-op in a plain browser — window.chrome.webview only exists inside
// WebView2 — so developing against Live Server / a normal browser is unaffected.
function requestSimulatorLaunch() {
  try {
    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage({ command: "startSimulator" });
    }
  } catch (err) {
    // Never block the session flow on a host-messaging failure.
    console.warn("[pre-session] startSimulator postMessage failed", err);
  }
}

// Real start: creates the backend session, asks the WPF host to launch MSFS
// via Steam (see requestSimulatorLaunch), then hands off to the ongoing page —
// which polls live telemetry and auto-redirects to the report when the session
// completes. In a plain browser the launch request is a no-op and MSFS is
// opened manually.
async function startSession() {
  const statusEl = document.getElementById("hud-status");
  const btn = document.getElementById("btn-start-session");

  if (launchInProgress) {
    return;
  }

  launchInProgress = true;
  statusEl.textContent = "LAUNCHING…";
  btn.disabled = true;
  btn.style.opacity = "0.6";
  btn.style.cursor = "not-allowed";

  // Scenario comes from the assigned-session panel; hover is the only graded
  // rubric so far, anything else starts but reports "no rubric yet".
  const res = await apiRequest("/me/sessions/start", {
    method: "POST",
    auth: true,
    body: { scenario: "hover" },
  });

  if (res.ok && res.data && res.data.sessionId) {
    requestSimulatorLaunch();
    window.location.href = `./session-ongoing.html?session=${encodeURIComponent(res.data.sessionId)}`;
    return;
  }

  // 409 = a session is already running — pick up where it left off.
  if (res.status === 409 && res.data && res.data.sessionId) {
    requestSimulatorLaunch();
    window.location.href = `./session-ongoing.html?session=${encodeURIComponent(res.data.sessionId)}`;
    return;
  }

  statusEl.textContent = "START FAILED";
  btn.disabled = false;
  btn.style.opacity = "";
  btn.style.cursor = "";
  launchInProgress = false;
  console.error("[pre-session] start failed", res.status, res.data);
}

document.addEventListener("DOMContentLoaded", () => {
  loadLiveSection();
  renderUpcoming(DUMMY_UPCOMING);

  document.getElementById("btn-start-session").addEventListener("click", startSession);

  initLogoutConfirm();
});
}
