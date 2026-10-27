// ==========================================================================
// CockpitSim — Trainer Dashboard
// Live data: session queue from /api/sessions/queue, real-time tracking via
// GET /api/sessions/{id}/live (trainer-only, SessionReport score:null),
// feedback via /api/trainees/{id}/notes and /api/sessions/{id}/feedback.
// Analytics are queue-derived (active trainees, completion rate, avg session
// length, awaiting-feedback) + real weekly session counts — no dummy data.
// Live panel polls at the scenario rate (hover ~1s, see scenarios.js).
// ponytail: polling, ~1s freshness; upgrade = SignalR if sub-second alerts
// are ever required.
// TODO (per-session feedback coverage): TraineeNoteDto now carries sessionId
//   and GET /api/sessions/feedback-coverage gives exact per-session counts.
//   The trainee-level fallback below stays for older backends.
// ==========================================================================

// Guard: trainers (and admins previewing) only.
const session = requireRole(['trainer', 'admin']);

if (session) {
	document.getElementById('hud-username').textContent = session.username.toUpperCase();

let QUEUE = [];            // raw queue rows from the API
let TRAINTEES = [];        // roster: all assigned trainees (drives dropdown + analytics)
let ALL_TRAINEES = [];     // GET /api/trainees — full assigned roster incl. sessionless
let selectedTraineeId = null;
let selectedSessionId = null; // specific session shown in the feedback snapshot
const FEEDBACK_CACHE = {}; // traineeId -> [{author, time, note, sessionId?}]
let COVERAGE = null;       // GET /api/sessions/feedback-coverage, when available
let SESSION_FILTER = 'all'; // all | in_progress | completed | scheduled

// Real-time tracking state (restored from telemetry-pipeline branch).
let liveTimer = null;
let liveClock = null;
let liveInFlight = false;
let liveSessionId = null;
let liveStartedAt = null;
let liveTimeLimitMinutes = null;
let TRAINEE_SETTINGS = {}; // traineeId -> sessionDurationMinutes (GET /api/trainees)

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

// Build the per-trainee roster. Queue rows supply session data; ALL_TRAINEES
// (GET /api/trainees) guarantees every assigned trainee is listed — even one
// with zero sessions — so newly registered trainees appear immediately.
function buildRoster() {
	const byTrainee = new Map();

	QUEUE.forEach((item) => {
		if (!byTrainee.has(item.traineeId)) byTrainee.set(item.traineeId, []);
		byTrainee.get(item.traineeId).push(item);
	});

	TRAINTEES = [];
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
			sessionCount: sessions.length,
			completedCount: sessions.filter((s) => s.status === 'completed').length,
			hasLive: sessions.some((s) => s.status === 'in_progress'),
		});
	}

	// Assigned trainees with no queue entry yet: add them so they can be
	// selected in the dropdown before their first session.
	ALL_TRAINEES.forEach((t) => {
		if (byTrainee.has(t.traineeId)) return;
		TRAINTEES.push({
			id: t.traineeId,
			fullName: t.fullName,
			callsign: (t.username || '').toUpperCase(),
			status: 'No sessions yet',
			currentExercise: 'Unassigned exercise',
			lastActiveAt: null,
			sessionStateLabel: '—',
			sessionCount: 0,
			completedCount: 0,
			hasLive: false,
		});
	});

	sortRoster();
}

function rosterRank(t) {
	if (t.hasLive) return 0;
	if (t.sessionCount === 0) return 4; // no sessions yet — sort below active trainees
	const notes = FEEDBACK_CACHE[t.id];
	const awaiting = Array.isArray(notes)
		? (t.completedCount > 0 && notes.length === 0)
		: (COVERAGE?.items?.find((i) => i.traineeId === t.id)?.awaitingSessions > 0);
	if (awaiting) return 1;
	if (t.status === 'Needs attention') return 2;
	return 3;
}

function sortRoster() {
	TRAINTEES.sort((a, b) => {
		const r = rosterRank(a) - rosterRank(b);
		if (r !== 0) return r;
		// lastActiveAt can be null for sessionless trainees — treat as oldest.
		const da = a.lastActiveAt ? parseDbDate(a.lastActiveAt).getTime() : 0;
		const db = b.lastActiveAt ? parseDbDate(b.lastActiveAt).getTime() : 0;
		return db - da;
	});
}

function traineeAwaiting(traineeId) {
	if (COVERAGE?.items) {
		const item = COVERAGE.items.find((i) => i.traineeId === traineeId);
		if (item) return item.awaitingSessions > 0;
	}
	const t = TRAINTEES.find((x) => x.id === traineeId);
	const notes = FEEDBACK_CACHE[traineeId];
	if (!t || !Array.isArray(notes)) return false;
	return t.completedCount > 0 && notes.length === 0;
}

function formatShortDate(iso) {
	const d = parseDbDate(iso);
	if (!d || !Number.isFinite(d.getTime())) return '—';
	return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function formatDurationMins(startedAt, endedAt) {
	if (!startedAt || !endedAt) return '—';
	const mins = (parseDbDate(endedAt) - parseDbDate(startedAt)) / 60000;
	if (!Number.isFinite(mins) || mins < 0) return '—';
	if (mins < 1) return '<1 min';
	if (mins < 60) return `${Math.round(mins)} min`;
	return `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m`;
}

function newestSessionFor(traineeId) {
	return QUEUE.find((item) => item.traineeId === traineeId) || null;
}

function sessionScenarioName(sessionId) {
	const s = QUEUE.find((item) => item.sessionId === sessionId);
	return s?.scenario || 'session';
}

function completedDurationsMinutes() {
	return QUEUE
		.filter((item) => item.status === 'completed' && item.startedAt && item.endedAt)
		.map((item) => (parseDbDate(item.endedAt) - parseDbDate(item.startedAt)) / 60000)
		.filter((mins) => Number.isFinite(mins) && mins >= 0);
}

function formatAvgDuration(mins) {
	if (mins.length === 0) return '—';
	const avg = mins.reduce((a, b) => a + b, 0) / mins.length;
	if (avg < 60) return `${Math.round(avg)} min`;
	const h = Math.floor(avg / 60);
	const m = Math.round(avg % 60);
	return `${h}h ${m}m`;
}

function formatTotalDuration(mins) {
	if (mins.length === 0) return 'no completed sessions yet';
	const total = mins.reduce((a, b) => a + b, 0);
	if (total < 60) return `total ${Math.round(total)} min`;
	return `total ${(total / 60).toFixed(1)}h`;
}

// Sessions per week for the last 6 weeks (oldest -> newest), from queue dates.
function sessionsPerWeek() {
	const weeks = [0, 0, 0, 0, 0, 0];
	const starts = [];
	const now = new Date();
	// Monday-start buckets for stable labels.
	const monday = new Date(now);
	const dow = (monday.getDay() + 6) % 7;
	monday.setDate(monday.getDate() - dow);
	monday.setHours(0, 0, 0, 0);
	for (let i = 5; i >= 0; i--) {
		const s = new Date(monday);
		s.setDate(s.getDate() - i * 7);
		starts.unshift(s);
	}
	QUEUE.forEach((item) => {
		if (!item.startedAt) return;
		const t = parseDbDate(item.startedAt).getTime();
		if (!Number.isFinite(t)) return;
		const weeksAgo = Math.floor((now.getTime() - t) / (7 * 24 * 60 * 60 * 1000));
		if (weeksAgo >= 0 && weeksAgo < 6) weeks[5 - weeksAgo] += 1;
	});
	return { counts: weeks, starts };
}

function weekLabel(date) {
	return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// Awaiting-feedback: prefers exact per-session coverage from the backend,
// falls back to trainee-level (completed sessions but zero notes) for older
// backends. Uses the same notes cache as the feedback panel when falling back.
function awaitingFeedbackCount() {
	if (COVERAGE && Number.isFinite(COVERAGE.awaitingTrainees)) return COVERAGE.awaitingTrainees;
	let count = 0;
	for (const trainee of TRAINTEES) {
		const sessions = QUEUE.filter((item) => item.traineeId === trainee.id);
		const hasCompleted = sessions.some((item) => item.status === 'completed');
		if (!hasCompleted) continue;
		const notes = FEEDBACK_CACHE[trainee.id];
		if (Array.isArray(notes) && notes.length === 0) count += 1;
		// notes === undefined = not loaded yet: don't count, caller refreshes after load.
	}
	return count;
}

function awaitingFeedbackDelta(awaiting) {
	if (COVERAGE && Number.isFinite(COVERAGE.awaitingSessions)) {
		if (awaiting === 0) return 'all reviewed';
		return `${COVERAGE.awaitingSessions} sessions • ${COVERAGE.totalCompleted} completed`;
	}
	if (awaiting === 0) return 'all reviewed';
	return 'trainees • completed, no notes yet';
}

function notesLoadedForAll() {
	if (COVERAGE) return true;
	return TRAINTEES.every((t) => Array.isArray(FEEDBACK_CACHE[t.id]));
}

function renderAnalytics() {
	const container = document.getElementById('analytics-cards');
	container.innerHTML = '';

	// Real figures derived from the queue + notes cache.
	const completed = QUEUE.filter((item) => item.status === 'completed').length;
	const completionRate = QUEUE.length > 0 ? Math.round((completed / QUEUE.length) * 100) : 0;
	const durations = completedDurationsMinutes();

	const awaitingReady = notesLoadedForAll();
	const awaiting = awaitingReady ? awaitingFeedbackCount() : null;

	const analytics = [
		{ label: 'Active trainees', value: String(TRAINTEES.length), delta: `${TRAINTEES.length} assigned to you` },
		{ label: 'Completion rate', value: `${completionRate}%`, delta: `${completed}/${QUEUE.length} sessions` },
		{ label: 'Avg session', value: formatAvgDuration(durations), delta: formatTotalDuration(durations) },
		{
			label: 'Awaiting feedback',
			value: awaiting === null ? '…' : String(awaiting),
			delta: awaiting === null ? 'loading notes…' : awaitingFeedbackDelta(awaiting),
		},
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

	// Real weekly volume: sessions per week, last 6 weeks.
	const { counts, starts } = sessionsPerWeek();
	const peak = Math.max(1, ...counts);
	const trendBars = document.getElementById('trend-bars');
	trendBars.innerHTML = '';

	counts.forEach((count, index) => {
		const bar = document.createElement('div');
		bar.className = `trend-bar${index === counts.length - 1 ? ' is-current' : ''}`;
		bar.style.setProperty('--bar-height', `${Math.max(8, Math.round((count / peak) * 100))}%`);
		bar.title = `Week of ${weekLabel(starts[index])}: ${count} session${count === 1 ? '' : 's'}`;
		bar.innerHTML = `<span>${weekLabel(starts[index])}</span>`;
		trendBars.appendChild(bar);
	});
}

async function refreshAwaitingFeedback() {
	// Prefer the exact backend aggregate; fall back to per-trainee notes.
	try {
		const res = await apiRequest('/sessions/feedback-coverage', { auth: true });
		if (res.ok && res.data && Number.isFinite(res.data.awaitingTrainees)) {
			COVERAGE = res.data;
			renderAnalytics();
			populateLiveDropdown();
			return;
		}
	} catch {
		// Older backend or offline — fall through to the notes cache.
	}
	// Load notes for every roster trainee (cached), then re-render cards.
	await Promise.all(TRAINTEES.map((t) => ensureNotesLoaded(t.id)));
	renderAnalytics();
	populateLiveDropdown();
}

// Dropdown replaces the old roster markup but reuses its sort order
// (live-first). One unified selectedTraineeId drives live + feedback +
// sessions — the dropdown, session Select buttons and row clicks all write
// the same variable.
function populateLiveDropdown() {
	const select = document.getElementById('live-trainee-select');
	if (!select) return;
	select.innerHTML = '';

	if (TRAINTEES.length === 0) {
		const opt = document.createElement('option');
		opt.value = '';
		opt.textContent = 'No active trainees';
		opt.disabled = true;
		opt.selected = true;
		select.appendChild(opt);
		select.disabled = true;
		return;
	}

	select.disabled = false;
	sortRoster();
	TRAINTEES.forEach((trainee) => {
		const opt = document.createElement('option');
		opt.value = trainee.id;
		const live = trainee.hasLive ? ' ● LIVE' : '';
		opt.textContent = `${trainee.fullName} — ${trainee.callsign}${live}`;
		if (trainee.id === selectedTraineeId) opt.selected = true;
		select.appendChild(opt);
	});
}

function setSelectedTrainee(traineeId) {
	selectedTraineeId = traineeId;
	// Default to the trainee's live session, else their latest session.
	const mine = QUEUE.filter((item) => item.traineeId === traineeId);
	const pick = mine.find((item) => item.status === 'in_progress') || mine[0] || null;
	selectedSessionId = pick ? pick.sessionId : null;
	populateLiveDropdown();
	updateSelection();
	renderSessions();
	startLiveTracking();
}

// A specific session row was picked: pin both the trainee and that session.
// Live tracking keeps following the trainee's in_progress session (if any);
// the feedback snapshot shows this exact session's stored data.
function setSelectedSession(sessionId) {
	const item = QUEUE.find((i) => i.sessionId === sessionId);
	if (!item) return;
	selectedTraineeId = item.traineeId;
	selectedSessionId = item.sessionId;
	populateLiveDropdown();
	updateSelection();
	renderSessions();
	startLiveTracking();
}

function selectedSession() {
	if (selectedSessionId) {
		const pinned = QUEUE.find((i) => i.sessionId === selectedSessionId);
		if (pinned && pinned.traineeId === selectedTraineeId) return pinned;
	}
	return newestSessionFor(selectedTraineeId);
}

// Restored live-monitor body (old markup/logic from telemetry-pipeline,
// adapted to the dropdown + current SessionReport shape).
function liveSessionForSelected() {
	if (!selectedTraineeId) return null;
	const mine = QUEUE.filter((item) => item.traineeId === selectedTraineeId);
	return mine.find((item) => item.status === 'in_progress') || null;
}

function livePollIntervalMs(session) {
	try {
		const key = (session?.scenario || 'hover').toLowerCase().includes('hover') ? 'hover' : 'hover';
		const def = (typeof scenarioDef === 'function' && scenarioDef(key)) || null;
		if (def && Number.isFinite(def.pollMs)) return def.pollMs;
	} catch { /* fall through to default */ }
	return 1000;
}

function setLiveState(text) {
	const el = document.getElementById('live-state');
	if (el) el.textContent = text;
}

function elapsedText() {
	if (!liveStartedAt) return '—';
	const s = Math.max(0, Math.floor((Date.now() - liveStartedAt.getTime()) / 1000));
	return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// Countdown against the session's configured time limit (null = no limit).
function liveSubmetaText(sessionId) {
	let text = `Elapsed ${elapsedText()}${attemptLabelFor(sessionId)}`;
	if (liveStartedAt && liveTimeLimitMinutes) {
		const rem = Math.max(0, Math.floor(
			liveTimeLimitMinutes * 60 - (Date.now() - liveStartedAt.getTime()) / 1000));
		text += ` • Remaining ${String(Math.floor(rem / 60)).padStart(2, '0')}:${String(rem % 60).padStart(2, '0')}`;
	}
	return text;
}

function attemptLabelFor(sessionId) {
	const s = QUEUE.find((item) => item.sessionId === sessionId);
	if (!s) return '';
	const same = QUEUE.filter((i) => i.traineeId === s.traineeId && (i.scenario || '') === (s.scenario || ''));
	if (same.length <= 1) return '';
	const idx = same.findIndex((i) => i.sessionId === sessionId);
	return idx >= 0 ? ` • Attempt ${idx + 1}` : '';
}

// Tracked aspects for a scenario (from scenarios.js): same rows as live
// data, with actual "—" until telemetry arrives. Shown instead of an empty
// box so the trainer always sees what is being watched.
function scenarioAspectMetrics(scenario) {
	try {
		const key = (scenario || 'hover').toLowerCase().includes('hover') ? 'hover' : 'hover';
		const def = (typeof scenarioDef === 'function' && scenarioDef(key)) || null;
		if (def && Array.isArray(def.metrics)) {
			return def.metrics.map((m) => ({
				key: m.key, label: m.label, unit: m.unit,
				actual: null, target: m.target, tolerance: m.tolerance,
				withinTol: null,
			}));
		}
	} catch { /* fall through to live payload */ }
	return null;
}

function renderLiveMetrics(report, fallbackScenario) {
	const list = document.getElementById('live-stats');
	if (!list) return;
	list.innerHTML = '';
	let metrics = Array.isArray(report?.metrics) ? report.metrics : [];
	if (metrics.length === 0) {
		// No values yet — show the tracked aspects (targets/tolerances)
		// instead of an empty box. Never fake numbers: actual stays "—".
		metrics = scenarioAspectMetrics(fallbackScenario || report?.scenario) || [];
	}
	if (metrics.length === 0) {
		const empty = document.createElement('div');
		empty.className = 'stat-item';
		empty.innerHTML = '<dt>No metrics</dt><dd>—</dd>';
		list.appendChild(empty);
		return;
	}
	metrics.forEach((m) => {
		const row = document.createElement('div');
		const state = m.withinTol === null || m.withinTol === undefined ? '' : (m.withinTol ? ' within-tol' : ' out-of-tol');
		row.className = `stat-item${state}`;
		const actual = (m.actual === null || m.actual === undefined) ? '—' : `${m.actual} ${m.unit || ''}`.trim();
		const hasBand = m.target !== null && m.target !== undefined;
		const band = hasBand ? ` / ${m.target}${m.tolerance !== null && m.tolerance !== undefined ? ` ±${m.tolerance}` : ''} ${m.unit || ''}`.trim() : '';
		row.innerHTML = '<dt></dt><dd></dd>';
		row.querySelector('dt').textContent = m.label || m.key || 'metric';
		row.querySelector('dd').textContent = band ? `${actual}${band}` : actual;
		list.appendChild(row);
	});
}

function renderLiveWarnings(report) {
	const list = document.getElementById('live-warnings');
	if (!list) return;
	list.innerHTML = '';
	const warnings = Array.isArray(report?.warnings) ? report.warnings : [];
	if (warnings.length === 0) {
		const li = document.createElement('li');
		li.className = 'warning-item';
		li.textContent = 'No warnings — all within tolerance.';
		list.appendChild(li);
		return;
	}
	warnings.forEach((w) => {
		const li = document.createElement('li');
		li.className = 'warning-item';
		li.textContent = String(w);
		list.appendChild(li);
	});
}

function renderLiveEmpty(message) {
	const name = document.getElementById('live-trainee-name');
	const meta = document.getElementById('live-trainee-meta');
	const sub = document.getElementById('live-submeta');
	if (name) name.textContent = '—';
	if (meta) meta.textContent = message;
	if (sub) sub.textContent = '';
	renderLiveMetrics({ metrics: [] });
	renderLiveWarnings({ warnings: ['Waiting for telemetry — showing tracked metrics.'] });
}

function renderLiveEnded(trainee, session) {
	const ended = document.getElementById('live-ended');
	if (ended) ended.hidden = false;
	setLiveState('ENDED');
	const name = document.getElementById('live-trainee-name');
	const meta = document.getElementById('live-trainee-meta');
	const sub = document.getElementById('live-submeta');
	if (name) name.textContent = trainee ? trainee.fullName : '—';
	if (meta) meta.textContent = session ? `${session.scenario || 'session'} • Session ended` : 'Session ended';
	if (sub) sub.textContent = 'Final data below. Pick another trainee above.';
}

async function pollLiveOnce() {
	if (liveInFlight) return;
	const trainee = TRAINTEES.find((t) => t.id === selectedTraineeId) || null;
	const target = liveSessionForSelected();
	const ended = document.getElementById('live-ended');
	if (ended) ended.hidden = true;

	if (!trainee || !target) {
		if (!trainee) {
			renderLiveEmpty('No active trainees — start a session from the trainee pre-session page.');
			setLiveState('STANDBY');
		} else {
			// Selected trainee has no in_progress session (ended or never started).
			// Aspects of their latest scenario stay visible; values arrive live.
			const latest = QUEUE.find((i) => i.traineeId === trainee.id) || null;
			renderLiveEnded(trainee, latest);
			renderLiveMetrics({ metrics: [] }, latest?.scenario);
			renderLiveWarnings({ warnings: ['No live session for this trainee — showing tracked metrics. Start the bridge to stream values.'] });
		}
		stopLiveTimers();
		return;
	}

	// New session selected — reset clock anchor.
	if (liveSessionId !== target.sessionId) {
		liveSessionId = target.sessionId;
		liveStartedAt = parseDbDate(target.startedAt);
		liveTimeLimitMinutes = null;
		const name = document.getElementById('live-trainee-name');
		const meta = document.getElementById('live-trainee-meta');
		const sub = document.getElementById('live-submeta');
		if (name) name.textContent = trainee.fullName;
		if (meta) meta.textContent = `${target.scenario || 'session'} • Live`;
		if (sub) sub.textContent = liveSubmetaText(target.sessionId);
		setLiveState('LIVE');
	}

	liveInFlight = true;
	try {
		const res = await apiRequest(`/sessions/${target.sessionId}/live`, { auth: true });
		if (res.ok && res.data) {
			if (res.data.status === 'completed' || res.data.status === 'cancelled') {
				renderLiveMetrics(res.data);
				renderLiveWarnings(res.data);
				renderLiveEnded(trainee, target);
				stopLiveTimers();
				return;
			}
			if (!liveStartedAt && res.data.startedAt) liveStartedAt = parseDbDate(res.data.startedAt);
			const meta = document.getElementById('live-trainee-meta');
			const sub = document.getElementById('live-submeta');
			if (meta) meta.textContent = `${res.data.scenario || target.scenario || 'session'} • Live`;
		if (sub) sub.textContent = liveSubmetaText(target.sessionId);
		setLiveState('LIVE');
		if (res.data.timeLimitMinutes) liveTimeLimitMinutes = res.data.timeLimitMinutes;
		renderLiveMetrics(res.data);
		renderLiveWarnings(res.data);
		} else if (res.status === 404) {
			renderLiveEnded(trainee, target);
			stopLiveTimers();
		} else {
			console.error('[trainer] live poll failed', res.status, res.data);
			setLiveState('RETRY');
		}
	} catch (err) {
		console.error('[trainer] live poll error', err);
		setLiveState('RETRY');
	} finally {
		liveInFlight = false;
	}
}

function stopLiveTimers() {
	if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
	if (liveClock) { clearInterval(liveClock); liveClock = null; }
}

function startLiveTracking() {
	stopLiveTimers();
	const target = liveSessionForSelected();
	if (!target) {
		pollLiveOnce();
		return;
	}
	pollLiveOnce();
	liveTimer = setInterval(pollLiveOnce, livePollIntervalMs(target));
	liveClock = setInterval(() => {
		const sub = document.getElementById('live-submeta');
		if (sub && liveSessionId) {
			const t = QUEUE.find((i) => i.sessionId === liveSessionId);
			sub.textContent = liveSubmetaText(liveSessionId);
		}
	}, 1000);
}

function bindLiveDropdown() {
	const select = document.getElementById('live-trainee-select');
	if (!select) return;
	select.addEventListener('change', () => {
		if (!select.value) return;
		setSelectedTrainee(select.value);
	});
}

function updateSelection() {
	const trainee = TRAINTEES.find((item) => item.id === selectedTraineeId) || TRAINTEES[0] || null;
	const target = document.getElementById('feedback-target');
	const input = document.getElementById('feedback-input');

	// Keep dropdown in sync when selection comes from session table.
	const select = document.getElementById('live-trainee-select');
	if (select && trainee && select.value !== trainee.id) select.value = trainee.id;

	if (!trainee) {
		target.textContent = 'Selected trainee: —';
		if (input) input.placeholder = 'No trainees assigned.';
		selectedSessionId = null;
		const box = document.getElementById('session-snapshot');
		if (box) box.innerHTML = '';
		renderFeedback();
		return;
	}

	const current = selectedSession();
	if (current) {
		selectedSessionId = current.sessionId;
		const when = formatShortDate(current.startedAt);
		const dur = formatDurationMins(current.startedAt, current.endedAt);
		target.textContent = `Selected: ${trainee.fullName} • ${current.scenario || 'session'} • ${when}${dur === '—' ? '' : ` • ${dur}`}`;
		if (input) input.placeholder = `Feedback for ${trainee.fullName} — attaches to ${current.scenario || 'latest session'} (${when})…`;
	} else {
		selectedSessionId = null;
		target.textContent = `Selected: ${trainee.fullName}`;
		if (input) input.placeholder = `Feedback for ${trainee.fullName}…`;
	}

	renderSessionSnapshot();
	renderFeedback();
}

// Previous live-monitoring data for the selected session, shown between the
// "Selected:" line and the feedback box. Reads the stored session-end report
// (GET /api/sessions/{id}/report) — same snapshot the trainee sees post-flight.
async function renderSessionSnapshot() {
	const box = document.getElementById('session-snapshot');
	if (!box) return;
	box.innerHTML = '';

	const current = QUEUE.find((i) => i.sessionId === selectedSessionId);
	if (!current) {
		const empty = document.createElement('div');
		empty.className = 'feedback-empty';
		empty.textContent = 'Select a session from history to preview its data.';
		box.appendChild(empty);
		return;
	}

	if (current.status === 'in_progress') {
		const live = document.createElement('div');
		live.className = 'feedback-empty';
		live.textContent = 'Session in progress — live values stream in Real-Time Tracking above; the graded report appears here after it ends.';
		box.appendChild(live);
		return;
	}

	const loading = document.createElement('div');
	loading.className = 'feedback-empty';
	loading.textContent = 'Loading session data…';
	box.appendChild(loading);

	const res = await apiRequest(`/sessions/${current.sessionId}/report`, { auth: true });
	// Stale response (selection moved on while fetching) — drop it.
	if (selectedSessionId !== current.sessionId) return;
	box.innerHTML = '';

	if (!res.ok || !res.data) {
		const empty = document.createElement('div');
		empty.className = 'feedback-empty';
		empty.textContent = res.status === 404
			? 'No graded report yet — grading runs when the session ends.'
			: 'Could not load session data. Retry shortly.';
		box.appendChild(empty);
		return;
	}

	const report = res.data;
	const head = document.createElement('div');
	head.className = 'snapshot-head';
	head.innerHTML = '<span></span><span class="trainee-pill pill-warn"></span>';
	head.querySelector('span').textContent =
		`${report.scenario || current.scenario || 'session'} • ${formatShortDate(report.startedAt || current.startedAt)}`;
	const scorePill = head.querySelector('.trainee-pill');
	scorePill.textContent = (report.score === null || report.score === undefined) ? 'Score —' : `Score ${report.score}`;
	box.appendChild(head);

	// Visible score calculation (shared renderer; "" when ungraded).
	if (typeof reportScoreBreakdown === 'function') {
		const breakdown = document.createElement('div');
		breakdown.innerHTML = reportScoreBreakdown(report);
		if (breakdown.firstChild) box.appendChild(breakdown.firstChild);
	}

	const metrics = Array.isArray(report.metrics) ? report.metrics : [];
	if (metrics.length === 0) {
		const empty = document.createElement('div');
		empty.className = 'feedback-empty';
		empty.textContent = 'No metrics stored for this session.';
		box.appendChild(empty);
	} else {
		const list = document.createElement('div');
		list.className = 'snapshot-metrics';
		metrics.forEach((m) => {
			const row = document.createElement('div');
			const state = m.withinTol === null || m.withinTol === undefined ? '' : (m.withinTol ? ' within-tol' : ' out-of-tol');
			row.className = `snapshot-metric${state}`;
			const actual = (m.actual === null || m.actual === undefined) ? '—' : `${m.actual} ${m.unit || ''}`.trim();
			const hasBand = m.target !== null && m.target !== undefined;
			const band = hasBand ? ` / ${m.target}${m.tolerance !== null && m.tolerance !== undefined ? ` ±${m.tolerance}` : ''} ${m.unit || ''}`.trim() : '';
			row.innerHTML = '<dt></dt><dd></dd>';
			row.querySelector('dt').textContent = m.label || m.key || 'metric';
			row.querySelector('dd').textContent = band ? `${actual}${band}` : actual;
			list.appendChild(row);
		});
		box.appendChild(list);
	}

	const warnings = Array.isArray(report.warnings) ? report.warnings : [];
	if (warnings.length > 0) {
		const warn = document.createElement('div');
		warn.className = 'snapshot-warnings';
		warn.textContent = `${warnings.length} warning${warnings.length === 1 ? '' : 's'}: ${warnings[0]}`;
		warn.title = warnings.join('\n');
		box.appendChild(warn);
	}
}

function filteredQueue() {
	const rows = SESSION_FILTER === 'all' ? QUEUE : QUEUE.filter((i) => i.status === SESSION_FILTER);
	return rows.slice(0, 30);
}

function renderSessions() {
	const tbody = document.getElementById('session-body');
	tbody.innerHTML = '';

	if (QUEUE.length === 0) {
		const row = document.createElement('tr');
		row.innerHTML = `<td colspan="6">No sessions logged for your trainees yet.</td>`;
		tbody.appendChild(row);
		return;
	}

	const rows = filteredQueue();
	if (rows.length === 0) {
		const row = document.createElement('tr');
		row.innerHTML = `<td colspan="6">No sessions match this filter.</td>`;
		tbody.appendChild(row);
		return;
	}

	rows.forEach((item) => {
		const row = document.createElement('tr');
		row.className = `session-row${item.sessionId === selectedSessionId ? ' is-selected' : ''}`;
		row.tabIndex = 0;
		const pill = item.status === 'in_progress' ? 'pill-ok' : item.status === 'completed' ? 'pill-warn' : 'pill-warn';
		if (item.status === 'cancelled') row.classList.add('is-cancelled');
		row.innerHTML = `
			<td></td>
			<td></td>
			<td><time></time></td>
			<td></td>
			<td><span class="trainee-pill ${pill}"></span></td>
			<td></td>
		`;
		row.children[0].textContent = item.traineeFullName;
		row.children[1].textContent = item.scenario;
		const time = row.querySelector('time');
		time.textContent = relativeTime(item.startedAt);
		try { time.dateTime = parseDbDate(item.startedAt).toISOString(); } catch { /* keep text only */ }
		time.title = parseDbDate(item.startedAt).toLocaleString('en-GB');
		row.children[3].textContent = formatDurationMins(item.startedAt, item.endedAt);
		row.querySelector('.trainee-pill').textContent = stateLabelFor(item.status);
		const open = document.createElement('button');
		open.type = 'button';
		open.className = 'queue-link';
		open.textContent = 'Select';
		open.addEventListener('click', (ev) => {
			ev.stopPropagation();
			setSelectedSession(item.sessionId);
		});
		row.children[5].appendChild(open);
		const select = () => {
			setSelectedSession(item.sessionId);
		};
		row.addEventListener('click', select);
		row.addEventListener('keydown', (ev) => {
			if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(); }
		});
		tbody.appendChild(row);
	});

	const total = document.getElementById('session-count');
	if (total) total.textContent = `${rows.length} of ${QUEUE.length}`;
}

function bindSessionFilters() {
	document.querySelectorAll('.session-filters .chip').forEach((chip) => {
		chip.addEventListener('click', () => {
			document.querySelectorAll('.session-filters .chip').forEach((c) => c.classList.remove('is-active'));
			chip.classList.add('is-active');
			SESSION_FILTER = chip.dataset.filter || 'all';
			renderSessions();
		});
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
			sessionId: n.sessionId || null,
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

	// Group by session when sessionId is known (new backend), else flat list.
	const hasSessionIds = traineeFeedback.some((e) => e.sessionId);
	if (!hasSessionIds) {
		traineeFeedback.forEach((entry) => {
			const item = document.createElement('li');
			item.className = 'feedback-item';
			item.innerHTML = `
				<div class="feedback-item-head"><span></span><span></span></div>
				<div class="feedback-item-body"></div>
			`;
			item.querySelector('.feedback-item-head span').textContent = entry.author;
			item.querySelector('.feedback-item-head span:last-child').textContent = entry.time;
			// textContent avoids injecting anything typed into the note box.
			item.querySelector('.feedback-item-body').textContent = entry.note;
			list.appendChild(item);
		});
		return;
	}

	const groups = new Map(); // sessionId|null -> entries
	traineeFeedback.forEach((entry) => {
		const key = entry.sessionId || 'other';
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(entry);
	});
	for (const [sessionId, entries] of groups) {
		const header = document.createElement('li');
		header.className = 'feedback-group';
		header.textContent = sessionId === 'other'
			? 'Other notes'
			: `${sessionScenarioName(sessionId)} • ${entries.length} note${entries.length === 1 ? '' : 's'}`;
		list.appendChild(header);
		entries.forEach((entry) => {
			const item = document.createElement('li');
			item.className = 'feedback-item';
			item.innerHTML = `
				<div class="feedback-item-head"><span></span><span></span></div>
				<div class="feedback-item-body"></div>
			`;
			item.querySelector('.feedback-item-head span').textContent = entry.author;
			item.querySelector('.feedback-item-head span:last-child').textContent = entry.time;
			item.querySelector('.feedback-item-body').textContent = entry.note;
			list.appendChild(item);
		});
	}
}

function bindFeedbackButton() {
	const button = document.getElementById('send-feedback-btn');
	button.addEventListener('click', async () => {
		const input = document.getElementById('feedback-input');
		const text = input.value.trim();
		if (!text || !selectedTraineeId) return;

		// Feedback attaches to the selected session (pinned by history row),
		// falling back to the trainee's most recent session.
		const target = selectedSession() || newestSessionFor(selectedTraineeId);
		if (!target) return;

		const res = await apiRequest(`/sessions/${target.sessionId}/feedback`, {
			method: 'POST',
			auth: true,
			body: { note: text },
		});

		if (!res.ok) {
			console.error('[trainer] feedback failed', res.status, res.data);
			return;
		}

		delete FEEDBACK_CACHE[selectedTraineeId];
		COVERAGE = null;
		input.value = '';
		await renderFeedback();
		renderAnalytics();
		await refreshAwaitingFeedback();
	});
}

function bindLogoutButton() {
	initLogoutConfirm();
}

// Per-trainee session duration settings (5–60 min, 5-min steps). Roster of
// assigned trainees comes from GET /api/trainees; a trainee with no sessions
// yet still appears here so their duration can be configured up front.
async function loadTraineeSettings() {
	const res = await apiRequest('/trainees', { auth: true });
	if (!res.ok || !Array.isArray(res.data)) return;
	TRAINEE_SETTINGS = {};
	res.data.forEach((t) => { TRAINEE_SETTINGS[t.traineeId] = t.sessionDurationMinutes; });
	renderTraineeSettings(res.data);
}

function renderTraineeSettings(trainees) {
	const host = document.getElementById('trainee-settings');
	if (!host) return;
	if (trainees.length === 0) {
		host.innerHTML = '<p class="feedback-empty">No trainees assigned to you yet.</p>';
		return;
	}
	const options = [];
	for (let m = 5; m <= 60; m += 5) options.push(m);
	host.innerHTML = trainees.map((t) => `
		<div class="trainee-setting-row" data-trainee="${t.traineeId}">
			<span class="trainee-setting-name">${t.fullName} <span class="trainee-setting-user">(${t.username})</span></span>
			<select class="trainee-duration-select" aria-label="Session duration for ${t.fullName}">
				${options.map((m) => `<option value="${m}"${(t.sessionDurationMinutes || 25) === m ? ' selected' : ''}>${m} min</option>`).join('')}
			</select>
			<span class="trainee-setting-status" aria-live="polite"></span>
		</div>`).join('');

	host.querySelectorAll('.trainee-duration-select').forEach((select) => {
		select.addEventListener('change', async () => {
			const row = select.closest('.trainee-setting-row');
			const status = row.querySelector('.trainee-setting-status');
			select.disabled = true;
			status.textContent = 'saving…';
			const res = await apiRequest(`/trainees/${row.dataset.trainee}/session-duration`, {
				method: 'PUT',
				auth: true,
				body: { minutes: Number(select.value) },
			});
			select.disabled = false;
			if (res.ok) {
				TRAINEE_SETTINGS[row.dataset.trainee] = Number(select.value);
				status.textContent = 'saved';
			} else {
				status.textContent = res.data?.message || 'save failed';
			}
			setTimeout(() => { status.textContent = ''; }, 3000);
		});
	});
}

// Static grading guideline (trainer-only): mirrors GradingService rules —
// pass threshold, hover weights, risk bands from the weighted breach rate.
function renderGradingGuidelines() {
	const host = document.getElementById('grading-guidelines');
	if (!host || typeof scenarioDef !== 'function') return;
	const def = scenarioDef('hover');
	if (!def) return;
	const weightRows = Object.entries(def.weights || {})
		.map(([key, w]) => {
			const metric = def.metrics.find((m) => m.key === key);
			return `<tr><td>${metric ? metric.label : key}</td><td>${w}</td></tr>`;
		})
		.join('');
	host.innerHTML = `
		<div class="guideline-panel">
			<h3>Pass / fail</h3>
			<ul>
				<li>Score = Σ (weight × % of session within tolerance) across graded metrics.</li>
				<li><strong>PASS</strong>: score ≥ ${def.passThreshold}. <strong>NEEDS WORK</strong>: below ${def.passThreshold}.</li>
				<li>Score breakdown (weight × within-% = contribution) is shown per session in the snapshot above.</li>
			</ul>
			<table>
				<thead><tr><th>Graded metric</th><th>Weight</th></tr></thead>
				<tbody>${weightRows}</tbody>
			</table>
			<h3>Risk bands</h3>
			<ul>
				<li>Risk is the weighted breach rate: <code>100 − score</code>.</li>
				<li><strong>Low</strong>: breach rate &lt; 10 &nbsp;•&nbsp; <strong>Medium</strong>: 10–29.9 &nbsp;•&nbsp; <strong>High</strong>: ≥ 30.</li>
				<li>Sessions auto-end when the configured time limit expires — an expired session is graded on the telemetry captured up to that point.</li>
			</ul>
		</div>`;
}

async function loadLiveData() {
	// Both calls in parallel: the queue drives sessions/analytics, while
	// /api/trainees guarantees sessionless assigned trainees are rostered.
	const [res, traineesRes] = await Promise.all([
		apiRequest('/sessions/queue', { auth: true }),
		apiRequest('/trainees', { auth: true }),
	]);
	if (!res.ok || !Array.isArray(res.data)) {
		console.error('[trainer] failed to load session queue', res.status, res.data);
		return;
	}
	ALL_TRAINEES = (traineesRes.ok && Array.isArray(traineesRes.data)) ? traineesRes.data : [];

	QUEUE = res.data;
	buildRoster();
	if (!selectedTraineeId || !TRAINTEES.some((t) => t.id === selectedTraineeId)) {
		// Prefer a live trainee on first load, else first in sorted order.
		const liveFirst = TRAINTEES.find((t) => t.hasLive) || TRAINTEES[0];
		selectedTraineeId = liveFirst ? liveFirst.id : null;
	}

	renderAnalytics();
	populateLiveDropdown();
	updateSelection();
	renderSessions();
	startLiveTracking();
	// Fill the awaiting-feedback card once notes arrive (cached for feedback panel).
	refreshAwaitingFeedback();
}

// ==========================================================================
// SPIKE (throwaway): Add Trainee modal — POST /api/trainees.
// Backend stamps AssignedTrainerId from this trainer's JWT.
// ==========================================================================

function openTraineeModal() {
	const overlay = document.getElementById('trainee-modal-overlay');
	if (!overlay) return;
	overlay.hidden = false;
	const first = document.getElementById('trainee-fullName');
	if (first) first.focus();
}

function closeTraineeModal() {
	const overlay = document.getElementById('trainee-modal-overlay');
	if (!overlay) return;
	overlay.hidden = true;
	document.getElementById('trainee-form').reset();
	const err = document.getElementById('trainee-form-error');
	if (err) err.hidden = true;
}

function showTraineeToast(message, isError) {
	const toast = document.getElementById('trainee-toast');
	if (!toast) return;
	toast.textContent = message;
	toast.classList.toggle('is-error', Boolean(isError));
	toast.hidden = false;
	clearTimeout(toast._timer);
	toast._timer = setTimeout(() => { toast.hidden = true; }, 4000);
}

function bindTraineeModal() {
	const btn = document.getElementById('add-trainee-btn');
	if (btn) btn.addEventListener('click', openTraineeModal);

	const cancel = document.getElementById('trainee-cancel-btn');
	if (cancel) cancel.addEventListener('click', closeTraineeModal);

	const overlay = document.getElementById('trainee-modal-overlay');
	if (overlay) overlay.addEventListener('click', (e) => {
		if (e.target === overlay) closeTraineeModal();
	});

	document.getElementById('trainee-form').addEventListener('submit', async (e) => {
		e.preventDefault();
		const errorEl = document.getElementById('trainee-form-error');
		errorEl.hidden = true;

		const fullName = document.getElementById('trainee-fullName').value.trim();
		const email = document.getElementById('trainee-email').value.trim();
		const username = document.getElementById('trainee-username').value.trim();
		const password = document.getElementById('trainee-password').value;

		if (!fullName || !email || !username || !password) {
			errorEl.textContent = 'Fill in all fields.';
			errorEl.hidden = false;
			return;
		}

		try {
			const { ok, data } = await apiRequest('/trainees', {
				auth: true,
				method: 'POST',
				body: { fullName, email, username, password },
			});

			if (!ok) {
				errorEl.textContent = (data && data.message) || 'Failed to create trainee.';
				errorEl.hidden = false;
				return;
			}

			closeTraineeModal();
			showTraineeToast(`Trainee "${username}" created. They can now log in.`);
			// Roster merges GET /api/trainees, so the new trainee appears in
			// the dropdown immediately (marked "No sessions yet").
			loadLiveData();
			loadTraineeSettings();
		} catch (err) {
			console.error('[trainer] trainee creation failed:', err);
			errorEl.textContent = 'Cannot reach the server. Is the backend running?';
			errorEl.hidden = false;
		}
	});
}

document.addEventListener('DOMContentLoaded', () => {
	loadLiveData();
	loadTraineeSettings();
	renderGradingGuidelines();
	bindLiveDropdown();
	bindSessionFilters();
	bindFeedbackButton();
	bindLogoutButton();
	bindTraineeModal();
	window.addEventListener('beforeunload', stopLiveTimers);
});
}
