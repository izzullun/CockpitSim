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

    row.append(attemptCell, dateCell, durationCell, outcomeCell, feedbackCell);
    tbody.appendChild(row);
  });
}

// Map one backend session record to a history-table row.
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
  }

  // Session history — replaces DUMMY_HISTORY.
  const sessRes = await apiRequest("/me/sessions", { auth: true });
  if (sessRes.ok && Array.isArray(sessRes.data)) {
    renderHistory(sessRes.data.map(toHistoryEntry).reverse());
  }
}

let launchInProgress = false;
let handoffTimer = null;

function startSession() {
  const statusEl = document.getElementById("hud-status");
  const btn = document.getElementById("btn-start-session");

  if (launchInProgress) {
    return;
  }

  launchInProgress = true;

  // TODO: replace with real Launcher API call:
  //   fetch("http://localhost:PORT/msfs/launch", { method: "POST" })
  //     .then(...) then poll GET /session/status
  statusEl.textContent = "LAUNCHING…";
  btn.disabled = true;
  btn.style.opacity = "0.6";
  btn.style.cursor = "not-allowed";

  console.log("[pre-session] startSession() stub called — no Launcher API wired yet.");

  // Simulated feedback only, for demo purposes until Launcher API exists.
  handoffTimer = setTimeout(() => {
    statusEl.textContent = "ACTIVE (SIMULATED)";

    window.location.href = "./post-session.html";
  }, 1200);
}

document.addEventListener("DOMContentLoaded", () => {
  loadLiveSection();
  renderUpcoming(DUMMY_UPCOMING);

  document.getElementById("btn-start-session").addEventListener("click", startSession);

  initLogoutConfirm();
});
}
