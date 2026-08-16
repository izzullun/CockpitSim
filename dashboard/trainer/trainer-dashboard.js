const ANALYTICS = [
	{ label: 'Active trainees', value: '4', delta: '+1 vs yesterday' },
	{ label: 'Pass rate', value: '82%', delta: '+6%' },
	{ label: 'Avg score', value: '87', delta: '+4 points' },
	{ label: 'Pending reviews', value: '3', delta: '2 urgent' },
];

const TRAINEES = [
	{
		id: 1,
		fullName: 'Adam Haikal',
		callsign: 'TRAINEE_ADAM',
		status: 'In session',
		sessionState: 'Active',
		currentExercise: 'Autorotation Recovery',
		liveScore: '87',
		riskLevel: 'Low',
		lastTelemetryAt: '00:02 ago',
		pendingNotesCount: 1,
		connectionState: 'Online',
		warnings: ['Flare timing needs smoothing', 'Rotor RPM stable'],
		monitoring: { altitude: '1,820 ft', airspeed: '74 kt', heading: '271°', verticalSpeed: '-820 ft/min', rotorRpm: '97%' },
		sessionStateLabel: 'Live',
		actionLabels: ['Review', 'Monitor'],
	},
	{
		id: 2,
		fullName: 'Siti Nur',
		callsign: 'TRAINEE_SITI',
		status: 'Ready for review',
		sessionState: 'Waiting',
		currentExercise: 'Hover Hold',
		liveScore: '91',
		riskLevel: 'Low',
		lastTelemetryAt: '05:11 ago',
		pendingNotesCount: 2,
		connectionState: 'Standby',
		warnings: ['Good heading control', 'No active warnings'],
		monitoring: { altitude: '920 ft', airspeed: '18 kt', heading: '183°', verticalSpeed: '0 ft/min', rotorRpm: '95%' },
		sessionStateLabel: 'Ready',
		actionLabels: ['Assign', 'Open'],
	},
	{
		id: 3,
		fullName: 'Faiz Rahman',
		callsign: 'TRAINEE_FAIZ',
		status: 'Needs attention',
		sessionState: 'Paused',
		currentExercise: 'Emergency Landing',
		liveScore: '72',
		riskLevel: 'High',
		lastTelemetryAt: '01:28 ago',
		pendingNotesCount: 4,
		connectionState: 'Online',
		warnings: ['Altitude deviation', 'Late collective response'],
		monitoring: { altitude: '1,140 ft', airspeed: '52 kt', heading: '309°', verticalSpeed: '-1,150 ft/min', rotorRpm: '89%' },
		sessionStateLabel: 'Paused',
		actionLabels: ['Resume', 'Review'],
	},
];

const SESSION_QUEUE = [
	{ trainee: 'Adam Haikal', exercise: 'Autorotation Recovery', state: 'Live', action: 'Monitor' },
	{ trainee: 'Siti Nur', exercise: 'Hover Hold', state: 'Ready', action: 'Assign' },
	{ trainee: 'Faiz Rahman', exercise: 'Emergency Landing', state: 'Paused', action: 'Resume' },
];

const FEEDBACK_BY_TRAINEE = {
	1: [
		{ author: 'Trainer Lim', time: '16:22', note: 'Good job on the recovery profile, but keep the flare smoother.' },
	],
	2: [
		{ author: 'Trainer Lim', time: '15:58', note: 'Siti is stable. Push the hover hold duration on the next attempt.' },
	],
	3: [
		{ author: 'Trainer Lim', time: '15:30', note: 'Faiz needs one-on-one review after repeated descent warnings.' },
	],
};

const TREND_BARS = [68, 72, 74, 80, 83, 87];

let selectedTraineeId = TRAINEES[0].id;

function tickClock() {
	const el = document.getElementById('hud-time');
	el.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
}

function renderAnalytics() {
	const container = document.getElementById('analytics-cards');
	container.innerHTML = '';

	ANALYTICS.forEach((item) => {
		const block = document.createElement('article');
		block.className = 'metric-card';
		block.innerHTML = `
			<span class="metric-label">${item.label}</span>
			<span class="metric-value">${item.value}</span>
			<span class="metric-delta">${item.delta}</span>
		`;
		container.appendChild(block);
	});

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

function traineePillClass(status) {
	if (status === 'In session') return 'pill-ok';
	if (status === 'Needs attention') return 'pill-error';
	return 'pill-warn';
}

function renderRoster() {
	const roster = document.getElementById('trainee-roster');
	roster.innerHTML = '';

	TRAINEES.forEach((trainee) => {
		const row = document.createElement('button');
		row.type = 'button';
		row.className = `trainee-row${trainee.id === selectedTraineeId ? ' is-selected' : ''}`;
		row.dataset.id = String(trainee.id);
		row.innerHTML = `
			<div>
				<div class="trainee-name">${trainee.fullName}</div>
				<div class="trainee-meta">${trainee.callsign} • ${trainee.currentExercise}<br>${trainee.lastTelemetryAt} • ${trainee.pendingNotesCount} pending notes</div>
			</div>
			<span class="trainee-pill ${traineePillClass(trainee.status)}">${trainee.status}</span>
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
	const trainee = TRAINEES.find((item) => item.id === selectedTraineeId) || TRAINEES[0];

	document.getElementById('live-trainee-name').textContent = trainee.fullName;
	document.getElementById('live-trainee-meta').textContent = `${trainee.currentExercise} • ${trainee.sessionState} • ${trainee.connectionState}`;
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

	trainee.warnings.forEach((warning) => {
		const item = document.createElement('li');
		item.className = 'warning-item';
		item.innerHTML = `<strong>${trainee.riskLevel === 'High' ? 'High priority' : 'Info'}</strong>${warning}`;
		warnings.appendChild(item);
	});

	renderFeedback();
}

function getSelectedTraineeFeedback() {
	if (!FEEDBACK_BY_TRAINEE[selectedTraineeId]) {
		FEEDBACK_BY_TRAINEE[selectedTraineeId] = [];
	}

	return FEEDBACK_BY_TRAINEE[selectedTraineeId];
}

function renderSessions() {
	const tbody = document.getElementById('session-body');
	tbody.innerHTML = '';

	SESSION_QUEUE.forEach((item) => {
		const row = document.createElement('tr');
		row.innerHTML = `
			<td>${item.trainee}</td>
			<td>${item.exercise}</td>
			<td>${item.state}</td>
			<td><a class="queue-link" href="#">${item.action}</a></td>
		`;
		tbody.appendChild(row);
	});
}

function renderFeedback() {
	const list = document.getElementById('feedback-stream');
	list.innerHTML = '';

	const traineeFeedback = getSelectedTraineeFeedback();

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
			<div class="feedback-item-body">${entry.note}</div>
		`;
		list.appendChild(item);
	});
}

function bindFeedbackButton() {
	const button = document.getElementById('send-feedback-btn');
	button.addEventListener('click', () => {
		const input = document.getElementById('feedback-input');
		const text = input.value.trim();
		if (!text) return;

		getSelectedTraineeFeedback().unshift({
			author: 'Trainer Lim',
			time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
			note: text,
		});
		input.value = '';
		renderFeedback();
	});
}

function bindLogoutButton() {
	const button = document.getElementById('logout-btn');
	button.addEventListener('click', () => {
		window.location.href = '../login/login.html';
	});
}

document.addEventListener('DOMContentLoaded', () => {
	renderAnalytics();
	renderRoster();
	renderLiveMonitor();
	renderSessions();
	bindFeedbackButton();
	bindLogoutButton();
	tickClock();
	setInterval(tickClock, 1000);
});