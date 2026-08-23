// ==========================================================================
// Trainee Dashboard — Pre-Session View
// UI shell only, driven by dummy data. No live backend calls yet.
//
// TODO (Member 3 — Backend API ready):
//   Replace DUMMY_PROFILE / DUMMY_UPCOMING / DUMMY_HISTORY with a call to
//   GET /dashboard (JWT-gated), which returns profile + assigned trainer +
//   session history for the logged-in trainee.
//
// TODO (Member 4 — WPF Launcher / Launcher API ready):
//   Replace the startSession() stub with a real local HTTP call to the
//   Launcher API: POST /msfs/launch, then poll GET /session/status.
// ==========================================================================

// Guard: trainees (and admins previewing) only.
const session = requireRole(['trainee', 'admin']);

if (session) {

const DUMMY_PROFILE = {
  fullName: "Adam Haikal",
  role: "Trainee",
  assignedTrainer: "Aiman Hakim Redza",
  lastLogin: "2026-07-12 09:41",
};

const DUMMY_UPCOMING = {
  exercise: "Autorotation Recovery — Attempt 4",
  scheduled: "2026-07-21 14:00",
  estDuration: "25 min",
  notes: "Focus on collective timing during flare. Trainer notes from last attempt available below.",
};

const DUMMY_HISTORY = [
  { attempt: 3, date: "2026-07-14", duration: "22 min", outcome: "success", feedback: "Good flare timing." },
  { attempt: 2, date: "2026-07-10", duration: "19 min", outcome: "failed",  feedback: "Collective input too late." },
  { attempt: 1, date: "2026-07-05", duration: "17 min", outcome: "failed",  feedback: "Lost rotor RPM on entry." },
];

function renderProfile(profile) {
  document.getElementById("profile-name").textContent = profile.fullName;
  document.getElementById("profile-role").textContent = profile.role;
  document.getElementById("profile-trainer").textContent = profile.assignedTrainer;

  // TODO: lastLogin should come from the backend profile once wired.
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
  // Profile comes from the login session; trainer name stays dummy for now.
  renderProfile({
    fullName: session.fullName,
    role: "Trainee",
    assignedTrainer: DUMMY_PROFILE.assignedTrainer,
    lastLogin: null,
  });
  renderUpcoming(DUMMY_UPCOMING);
  renderHistory(DUMMY_HISTORY);

  document.getElementById("btn-start-session").addEventListener("click", startSession);
});
}