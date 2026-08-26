// ==========================================================================
// CockpitSim — Trainer Dashboard
// Live data: roster + session queue from /api/sessions/queue, feedback via
// /api/trainees/{id}/notes and /api/sessions/{id}/feedback (trainer-only).
//
// TODO (SimConnect/telemetry pipeline): liveStats (altitude/airspeed/RPM),
//   warnings, riskLevel and liveScore have no backend source yet — they show
//   neutral placeholders until the launcher streams telemetry.
// TODO: trend bars remain illustrative until historical metrics exist.
// ==========================================================================

// Guard: trainers (and admins previewing) only.
const session = requireRole(['trainer', 'admin']);

if (session) {
	document.getElementById('hud-username').textContent = session.username.toUpperCase();

let QUEUE = [];            // raw queue rows from the API
let TRAINTEES = [];        // roster derived from the queue
let selectedTraineeId = null;
const FEEDBACK_CACHE = {}; // traineeId -> [{author, time, note}]

// Neutral placeholders until telemetry streaming exists.
const PLACEHOLDER_MONITORING = {
	altitude: '—', airspeed: '—', heading: '—', verticalSpeed: '—', rotorRpm: '—'
};

function statusLabelFor(sessions) {
	if (sessions.some((item) => item.status === 'in_progress')) return 'In session';
	const latest = sessions[0];
	if (!latest) return 'No sessions';
	if (latest.status === 'completed') return 'Ready for review';
	if (latest.status === 'scheduled') return 'Scheduled';
	return 'Needs attention';
}

function pillClass(status) {
	if (status === 'In session') return 'pill-ok';
	if (status === 'Needs attention') return 'pill-error';
	return 'pill-warn';
}

function stateLabelFor(status) {
	if (status === 'in_progress') return 'Live';
	if (status === 'completed') return 'Ready';
	if (status === 'scheduled') return 'Scheduled';
	return 'Paused';
}

function relativeTime(iso) {
	const minutes = Math.max(0, Math.round((Date.now() - parseDbDate(iso).getTime()) / 60000));
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m ago`;
}

// Build the per-trainee roster from raw queue rows.
function buildRoster() {
	const byTrainee = new Map();

	QUEUE.forEach((item) => {
		if (!byTrainee.has(item.traineeId)) byTrainee.set(item.traineeId, []);
		byTrainee.get(item.traineeId).push(item);
	});

	// API returns newest first, so sessions[0] is the latest.
	for (const [traineeId, sessions] of byTrainee) {
		const latest = sessions[0];

		TRAINTEES.push({
			id: traineeId,
			fullName: latest.traineeFullName,
			callsign: latest.traineeUsername.toUpperCase(),
			status: statusLabelFor(sessions),
			currentExercise: latest.scenario || 'Unassigned exercise',
			lastActiveAt: latest.startedAt,
			sessionStateLabel: stateLabelFor(latest.status),
			monitoring: { ...PLACEHOLDER_MONITORING },
			warnings: ['Telemetry stream not connected yet'],
			riskLevel: 'Low',
		});
	}
}

function renderAnalytics() {
	const container = document.getElementById('analytics-cards');
	container.innerHTML = '';

	// Real figures derived from the queue; the rest stay placeholder.
	const completed = QUEUE.filter((item) => item.status === 'completed').length;
	const passRate = QUEUE.length > 0 ? Math.round((completed / QUEUE.length) * 100) : 0;

	// TODO: avg score needs a scoring backend; pending reviews needs a review workflow.
	const analytics = [
		{ label: 'Active trainees', value: String(TRAINTEES.length), delta: `${TRAINTEES.length} assigned to you` },
		{ label: 'Pass rate', value: `${passRate}%`, delta: `${completed}/${QUEUE.length} sessions` },
		{ label: 'Avg score', value: '—', delta: 'scoring backend pending' },
		{ label: 'Pending reviews', value: '—', delta: 'review workflow pending' },
	];

	analytics.forEach((item) => {
		const block = document.createElement('article');
		block.className = 'metric-card';
		block.innerHTML = `
			<span class="metric-label">${item.label}</span>
			<span class="metric-value">${item.value}</span>
			<span class="metric-delta">${item.delta}</span>
		`;
		container.appendChild(block);
	});

	// TODO: replace with real weekly trend once historical metrics exist.
	const TREND_BARS = [68, 72, 74, 80, 83, 87];
	const trendBars = document.getElementById('trend-bars');
	trendBars.innerHTML = '';

	TREND_BARS.forEach((value, index) => {
		const bar = document.createElement('div');
		bar.className = 'trend-bar';
		bar.style.setProperty('--bar-height', `${value}%`);
		bar.innerHTML = `<span>W${index + 1}</span>`;
		trendBars.appendChild(bar);
	});
}

function renderRoster() {
	const roster = document.getElementById('trainee-roster');
	roster.innerHTML = '';

	TRAINTEES.forEach((trainee) => {
		const row = document.createElement('button');
		row.type = 'button';
		row.className = `trainee-row${trainee.id === selectedTraineeId ? ' is-selected' : ''}`;
		row.dataset.id = String(trainee.id);
		row.innerHTML = `
			<div>
				<div class="trainee-name">${trainee.fullName}</div>
				<div class="trainee-meta">${trainee.callsign} • ${trainee.currentExercise}<br>${relativeTime(trainee.lastActiveAt)}</div>
			</div>
			<span class="trainee-pill ${pillClass(trainee.status)}">${trainee.status}</span>
		`;
		row.addEventListener('click', () => {
			selectedTraineeId = trainee.id;
			renderRoster();
			renderLiveMonitor();
		});
		roster.appendChild(row);
	});
}

function renderLiveMonitor() {
	const trainee = TRAINTEES.find((item) => item.id === selectedTraineeId)
		|| TRAINTEES[0]
		|| { fullName: 'No trainees assigned', currentExercise: '—', sessionStateLabel: '—', monitoring: PLACEHOLDER_MONITORING, warnings: [], riskLevel: 'Low' };

	document.getElementById('live-trainee-name').textContent = trainee.fullName;
	document.getElementById('live-trainee-meta').textContent = `${trainee.currentExercise} • ${trainee.sessionStateLabel}`;
	document.getElementById('feedback-target').textContent = `Selected trainee: ${trainee.fullName}`;

	const liveStats = document.getElementById('live-stats');
	liveStats.innerHTML = '';

	Object.entries(trainee.monitoring).forEach(([label, value]) => {
		const stat = document.createElement('dl');
		stat.className = 'live-stat';
		stat.innerHTML = `<dt>${label.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase())}</dt><dd>${value}</dd>`;
		liveStats.appendChild(stat);
	});

	const warnings = document.getElementById('live-warnings');
	warnings.innerHTML = '';

	(trainee.warnings || []).forEach((warning) => {
		const item = document.createElement('li');
		item.className = 'warning-item';
		item.innerHTML = `<strong>Info</strong>${warning}`;
		warnings.appendChild(item);
	});

	renderFeedback();
}

function renderSessions() {
	const tbody = document.getElementById('session-body');
	tbody.innerHTML = '';

	if (QUEUE.length === 0) {
		const row = document.createElement('tr');
		row.innerHTML = `<td colspan="4">No sessions logged for your trainees yet.</td>`;
		tbody.appendChild(row);
		return;
	}

	QUEUE.forEach((item) => {
		const row = document.createElement('tr');
		row.innerHTML = `
			<td>${item.traineeFullName}</td>
			<td>${item.scenario}</td>
			<td>${stateLabelFor(item.status)}</td>
			<td><a class="queue-link" href="#">Open</a></td>
		`;
		tbody.appendChild(row);
	});
}

async function ensureNotesLoaded(traineeId) {
	if (FEEDBACK_CACHE[traineeId]) return;

	const res = await apiRequest(`/trainees/${traineeId}/notes`, { auth: true });
		FEEDBACK_CACHE[traineeId] = (res.ok && Array.isArray(res.data))
		? res.data.map((n) => ({
			author: n.author,
			time: parseDbDate(n.createdAt).toLocaleTimeString('en-GB', { hour12: false }),
			note: n.note,
		}))
		: [];
}

async function renderFeedback() {
	const list = document.getElementById('feedback-stream');
	list.innerHTML = '';

	if (!selectedTraineeId) {
		const empty = document.createElement('li');
		empty.className = 'feedback-empty';
		empty.textContent = 'Select a trainee to view feedback.';
		list.appendChild(empty);
		return;
	}

	await ensureNotesLoaded(selectedTraineeId);

	const traineeFeedback = FEEDBACK_CACHE[selectedTraineeId] || [];

	if (traineeFeedback.length === 0) {
		const empty = document.createElement('li');
		empty.className = 'feedback-empty';
		empty.textContent = 'No feedback yet for this trainee.';
		list.appendChild(empty);
		return;
	}

	traineeFeedback.forEach((entry) => {
		const item = document.createElement('li');
		item.className = 'feedback-item';
		item.innerHTML = `
			<div class="feedback-item-head"><span>${entry.author}</span><span>${entry.time}</span></div>
			<div class="feedback-item-body"></div>
		`;
		// textContent avoids injecting anything typed into the note box.
		item.querySelector('.feedback-item-body').textContent = entry.note;
		list.appendChild(item);
	});
}

function bindFeedbackButton() {
	const button = document.getElementById('send-feedback-btn');
	button.addEventListener('click', async () => {
		const input = document.getElementById('feedback-input');
		const text = input.value.trim();
		if (!text || !selectedTraineeId) return;

		// Feedback attaches to the selected trainee's most recent session.
		const newest = QUEUE.find((item) => item.traineeId === selectedTraineeId);
		if (!newest) return;

		const res = await apiRequest(`/sessions/${newest.sessionId}/feedback`, {
			method: 'POST',
			auth: true,
			body: { note: text },
		});

		if (!res.ok) {
			console.error('[trainer] feedback failed', res.status, res.data);
			return;
		}

		delete FEEDBACK_CACHE[selectedTraineeId];
		input.value = '';
		await renderFeedback();
	});
}

function bindLogoutButton() {
	initLogoutConfirm();
}

async function loadLiveData() {
	const res = await apiRequest('/sessions/queue', { auth: true });
	if (!res.ok || !Array.isArray(res.data)) {
		console.error('[trainer] failed to load session queue', res.status, res.data);
		return;
	}

	QUEUE = res.data;
	buildRoster();
	selectedTraineeId = TRAINTEES.length > 0 ? TRAINTEES[0].id : null;

	renderAnalytics();
	renderRoster();
	renderLiveMonitor();
	renderSessions();
}

document.addEventListener('DOMContentLoaded', () => {
	loadLiveData();
	bindFeedbackButton();
	bindLogoutButton();
});
}
