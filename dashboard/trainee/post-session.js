// CockpitSim — Trainee Post-Session Report
// Guard: trainees (and admins previewing) only.
const session = requireRole(['trainee', 'admin']);

const SUMMARY_CARDS = [
  { label: "Flight time", value: "24 min 18 sec", delta: "+3 min vs last attempt" },
  { label: "Completion", value: "100%", delta: "All required maneuvers captured" },
  { label: "Score", value: "88", delta: "+6 points" },
  { label: "Risk", value: "Low", delta: "Stable handling throughout" },
];

const TELEMETRY = [
  { label: "Average altitude", value: "1,760 ft" },
  { label: "Average airspeed", value: "73 kt" },
  { label: "Vertical speed", value: "-640 ft/min" },
  { label: "Rotor RPM", value: "97%" },
  { label: "Heading variance", value: "4.2°" },
  { label: "Warnings", value: "1 minor" },
];

const TRAINER_NOTES = [
  "Good recovery entry and a cleaner flare than the last attempt.",
  "Keep collective movement slightly earlier during the descent phase.",
  "Overall session was stable enough to mark as successful.",
];

const TIMELINE = [
  { time: "00:00", event: "Session started and telemetry capture enabled." },
  { time: "08:41", event: "Approach phase remained within tolerance." },
  { time: "16:12", event: "One brief airspeed deviation logged, no intervention needed." },
  { time: "24:18", event: "Landing completed and report finalized." },
];

function renderSummaryCards() {
  const container = document.getElementById("summary-cards");
  container.innerHTML = "";

  SUMMARY_CARDS.forEach((card) => {
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

function renderTelemetry() {
  const list = document.getElementById("telemetry-stats");
  list.innerHTML = "";

  TELEMETRY.forEach((item) => {
    const term = document.createElement("div");
    term.className = "stat-item";
    term.innerHTML = `<dt>${item.label}</dt><dd>${item.value}</dd>`;
    list.appendChild(term);
  });
}

function renderNotes() {
  const list = document.getElementById("trainer-notes");
  list.innerHTML = "";

  TRAINER_NOTES.forEach((note) => {
    const item = document.createElement("li");
    item.className = "note-item";
    item.textContent = note;
    list.appendChild(item);
  });
}

function renderTimeline() {
  const list = document.getElementById("timeline-list");
  list.innerHTML = "";

  TIMELINE.forEach((item) => {
    const li = document.createElement("li");
    li.className = "timeline-item";
    li.innerHTML = `
      <span class="timeline-time">${item.time}</span>
      <span class="timeline-event">${item.event}</span>
    `;
    list.appendChild(li);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  renderSummaryCards();
  renderTelemetry();
  renderNotes();
  renderTimeline();
});