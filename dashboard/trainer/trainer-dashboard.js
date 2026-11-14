import { gradeLabel, passText, scoreText } from '../shared/js/flight-grade.js';
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
const notesCacheVersions = new Map();
let COVERAGE = null;       // GET /api/sessions/feedback-coverage, when available
let SESSION_FILTER = 'completed';
let sessionVisibleCount = 30;
const feedbackDrafts = new Map();
const durationSaveStates = new Map();
let feedbackDraftSessionId = null;
let feedbackSaving = false;
let notesRequestVersion = 0;

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
	if (status === 'cancelled') return 'Cancelled';
	return status || 'Unknown';
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

function notesLoadedForAll() {
	if (COVERAGE) return true;
	return TRAINTEES.every((t) => Array.isArray(FEEDBACK_CACHE[t.id]));
}

function renderAnalytics() {
	renderRoster();
	const container = document.getElementById('analytics-cards');
	container.innerHTML = '';

	const active = QUEUE.filter((item) => item.status === 'in_progress');
	const awaiting = COVERAGE?.awaitingSessions ?? (notesLoadedForAll() ? TRAINTEES.reduce((count, trainee) =>
		count + (QUEUE.filter((flight) => flight.traineeId === trainee.id && queueFeedback(flight) === 'Awaiting feedback').length ?? 0), 0) : null);
	for (const [label, value] of [['Active flights', active.length], ['Awaiting feedback', awaiting ?? '…'], ['Assigned trainees', TRAINTEES.length]]) {
		const block = document.createElement('div');
		block.className = 'metric-card';
		block.innerHTML = '<span class="metric-label"></span><strong class="metric-value"></strong>';
		block.firstElementChild.textContent = label;
		block.lastElementChild.textContent = value;
		container.append(block);
	}
	const current = document.getElementById('current-flight-summary');
	const flight = active[0];
	current.replaceChildren();
	if (!flight) {
		current.textContent = 'No active flights.';
		return;
	}
	const row = document.createElement('div');
	row.className = 'overview-current-row';
	const name = document.createElement('strong');
	name.textContent = flight.traineeFullName;
	const live = document.createElement('span');
	live.textContent = 'Live';
	row.append(name, live);
	const link = document.createElement('a');
	link.href = '#live-monitor';
	link.textContent = 'Open Live Monitor to inspect current readings →';
	link.addEventListener('click', () => setSelectedTrainee(flight.traineeId));
	current.append(row, link);
}

function renderRoster() {
	const host = document.getElementById('trainer-roster');
	if (!host) return;
	host.replaceChildren();
	if (!TRAINTEES.length) {
		host.textContent = 'No trainees assigned yet. Use Add Trainee to create an account.';
		return;
	}
	TRAINTEES.forEach((trainee) => {
		const row = document.createElement('article');
		row.className = 'roster-row';
		const identity = document.createElement('div');
		const name = document.createElement('strong');
		name.textContent = trainee.fullName;
		const callsign = document.createElement('span');
		const latest = QUEUE.find((flight) => flight.traineeId === trainee.id);
		const exercise = scenarioDef(latest?.scenario)?.title || latest?.scenario;
		callsign.textContent = [exercise, trainee.status].filter(Boolean).join(' · ');
		identity.append(name, callsign);
		const action = document.createElement('button');
		action.type = 'button';
		action.className = 'secondary-action';
		action.textContent = trainee.hasLive ? 'Monitor flight' : 'Review flights';
		action.setAttribute('aria-label', `${action.textContent} — ${trainee.fullName}`);
		action.addEventListener('click', () => {
			setSelectedTrainee(trainee.id);
			if (!trainee.hasLive) {
				document.getElementById('queue-trainee').value = trainee.id;
				renderSessions();
			}
			window.location.hash = trainee.hasLive ? 'live-monitor' : 'sessions';
			document.body.dataset.reviewPane = 'queue';
			document.dispatchEvent(new CustomEvent('trainer:selection'));
		});
		row.append(identity, action);
		host.appendChild(row);
	});
}

function setWorkspaceMessage(message) {
	const host = document.getElementById('workspace-message');
	host.textContent = message;
	host.hidden = !message;
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
	sessionVisibleCount = 30;
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
	const clock = document.getElementById('live-clock');
	clock.hidden = false;
	clock.querySelector('strong').textContent = elapsedText();
	let text = attemptLabelFor(sessionId).replace(/^\s*•\s*/, "");
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
		const key = scenario || 'hover';
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
	const secondary = metrics.filter((metric) => ['collective', 'on_ground'].includes(metric.key));
	const context = document.getElementById('live-footer-metrics');
	context.textContent = secondary.filter((metric) => metric.actual != null).map((metric) =>
		metric.key === 'on_ground' ? (Number(metric.actual) ? 'On ground' : 'Airborne')
			: metric.label + ' ' + metric.actual + (metric.unit || '')).join(' · ');
	metrics.filter((metric) => !secondary.includes(metric)).forEach((m) => {
		const row = document.createElement('div');
		const state = m.withinTol === null || m.withinTol === undefined ? '' : (m.withinTol ? ' within-tol' : ' out-of-tol');
		row.className = `stat-item${state}`;
		const actual = (m.actual === null || m.actual === undefined) ? '—' : `${m.actual} ${m.unit || ''}`.trim();
		const hasBand = m.target !== null && m.target !== undefined;
		const band = hasBand ? `Target ${m.target}${m.tolerance !== null && m.tolerance !== undefined ? ` ±${m.tolerance}` : ''} ${m.unit || ''}`.trim() : '';
		row.innerHTML = '<dt></dt><dd></dd><span class="stat-target"></span>';
		row.querySelector('dt').textContent = m.label || m.key || 'metric';
		row.querySelector('dd').textContent = actual;
				row.querySelector('.stat-target').textContent = typeof m.withinTol === 'boolean'
			? (m.withinTol ? 'Within tolerance' : 'Outside tolerance')
			: hasBand ? band : 'Reference only';
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
		li.textContent = 'No warnings reported.';
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
	document.getElementById('live-clock').hidden = true;
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
	document.getElementById('live-clock').hidden = true;
	const ended = document.getElementById('live-ended');
	if (ended) ended.hidden = false;
	setLiveState('ENDED');
	const name = document.getElementById('live-trainee-name');
	const meta = document.getElementById('live-trainee-meta');
	const sub = document.getElementById('live-submeta');
	if (name) name.textContent = trainee ? trainee.fullName : '—';
	if (meta) meta.textContent = session ? `${session.scenario || 'session'} • Session ended` : 'Session ended';
	if (sub) sub.textContent = session ? `Last session: ${formatSessionDateTime(session.startedAt)}` : 'No sessions recorded yet.';
}

async function pollLiveOnce() {
	const trainee = TRAINTEES.find((t) => t.id === selectedTraineeId) || null;
	const target = liveSessionForSelected();
	const ended = document.getElementById('live-ended');
	if (ended) ended.hidden = true;
	// Returning from an inactive trainee can reuse the same live session ID.
	// Identity follows the current selection, independently of the clock anchor.
	const name = document.getElementById('live-trainee-name');
	if (name && trainee) name.textContent = trainee.fullName;

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
			renderLiveWarnings({ warnings: ['No live values available. Exercise reference targets are shown above.'] });
		}
		stopLiveTimers();
		return;
	}
	if (liveInFlight) return;

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
		// Selection is presentation state: a late response cannot repaint a different trainee.
		if (selectedTraineeId !== trainee.id || liveSessionForSelected()?.sessionId !== target.sessionId) return;
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
			if (meta) meta.textContent = `${trainee.fullName} · ${(typeof scenarioDef === 'function' ? scenarioDef(res.data.scenario || target.scenario)?.title : null) || target.scenario}${attemptLabelFor(target.sessionId)}`;
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
		if (selectedTraineeId !== trainee.id || liveSessionForSelected()?.sessionId !== target.sessionId) return;
		console.error('[trainer] live poll error', err);
		setLiveState('RETRY');
	} finally {
		liveInFlight = false;
		if (selectedTraineeId !== trainee.id || liveSessionForSelected()?.sessionId !== target.sessionId) pollLiveOnce();
	}
}

function stopLiveTimers() {
	if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
	if (liveClock) { clearInterval(liveClock); liveClock = null; }
}

function startLiveTracking() {
	stopLiveTimers();
	const target = liveSessionForSelected();
	if (target && liveInFlight && liveSessionId !== target.sessionId) {
		const trainee = TRAINTEES.find((t) => t.id === selectedTraineeId);
		document.getElementById('live-trainee-name').textContent = trainee?.fullName || '—';
		document.getElementById('live-trainee-meta').textContent = `${target.scenario || 'Session'} • Connecting…`;
		document.getElementById('live-submeta').textContent = '';
		setLiveState('CONNECTING');
		renderLiveMetrics({ metrics: [] }, target.scenario);
		renderLiveWarnings({ warnings: ['Waiting for current session values.'] });
	}
	if (!target) {
		pollLiveOnce();
		return;
	}
	pollLiveOnce();
	liveTimer = setInterval(pollLiveOnce, livePollIntervalMs(target));
	liveClock = setInterval(() => {
		const sub = document.getElementById('live-submeta');
		if (sub && liveSessionId && liveSessionForSelected()?.sessionId === liveSessionId) {
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
	const currentId = selectedSession()?.sessionId || null;
	if (feedbackDraftSessionId !== currentId) {
		if (feedbackDraftSessionId) feedbackDrafts.set(feedbackDraftSessionId, input.value);
		input.value = feedbackDrafts.get(currentId) || '';
		feedbackDraftSessionId = currentId;
		document.getElementById('feedback-save-status').textContent = '';
	}
	input.disabled = !currentId;
	document.getElementById('send-feedback-btn').disabled = !currentId || feedbackSaving;
	document.getElementById('selected-trainee-status').textContent = trainee ? trainee.status : 'No trainees assigned';
	renderTraineeSettings(ALL_TRAINEES);
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

	document.dispatchEvent(new CustomEvent('trainer:selection'));
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
		live.textContent = 'Session in progress. Open Live Monitor for current values; the report will appear after the session ends.';
		box.appendChild(live);
		return;
	}

	const loading = document.createElement('div');
	loading.className = 'feedback-empty';
	loading.textContent = 'Loading session data…';
	box.appendChild(loading);

	let res;
	try {
		res = await apiRequest(`/sessions/${current.sessionId}/report`, { auth: true });
	} catch {
		res = { ok: false, status: 0 };
	}
	// Stale response (selection moved on while fetching) — drop it.
	if (selectedSessionId !== current.sessionId) return;
	box.innerHTML = '';

	if (!res.ok || !res.data) {
		const empty = document.createElement('div');
		empty.className = 'feedback-empty';
		empty.textContent = res.status === 404
			? 'No stored report is available for this session. You can still read and save trainer notes.'
			: 'Could not load session data. Retry shortly.';
		box.appendChild(empty);
		return;
	}

	const report = res.data;
	const head = document.createElement('div');
	head.className = 'snapshot-head';
	const title = document.createElement('h3');
	title.textContent = scenarioDef(report.scenario)?.title || report.scenario || current.scenario;
	const score = document.createElement('strong');
	if (Number.isFinite(report.score)) {
		score.append(gradeLabel(report.score), ' ' + scoreText(report.score) + ' / 100 · ' + passText(report.score));
	} else score.textContent = 'Score unavailable';
	head.append(title, score);
	const controls = document.createElement('div');
	controls.className = 'report-detail-tabs';
	controls.setAttribute('role', 'group');
	controls.setAttribute('aria-label', 'Flight report sections');
	const content = document.createElement('div');
	const previous = QUEUE.find((item) => item.traineeId === current.traineeId && item.scenario === current.scenario
		&& item.status === 'completed' && parseDbDate(item.startedAt) < parseDbDate(current.startedAt));
	const metrics = report.metrics || [];
	const scored = metrics.filter((metric) => Number.isFinite(metric.weight));
	const sections = {
		Overview() {
			const duration = document.createElement('p');
			duration.textContent = 'Duration · ' + formatDurationMins(report.startedAt, report.endedAt);
			const heading = document.createElement('h3');
			heading.textContent = 'Recorded performance';
			const summary = document.createElement('p');
			if (Number.isFinite(previous?.score) && Number.isFinite(report.score)) {
				const change = report.score - previous.score;
				duration.textContent += ' · Previous attempt ' + (change > 0 ? '+' : '') + scoreText(change) + ' points';
			}
			const recorded = scored.filter((metric) => Number.isFinite(metric.withinPct));
			summary.textContent = recorded.length ? recorded.map((metric) =>
				metric.label + ' ' + metric.withinPct + '%').join(' · ') : 'Time within tolerance unavailable.';
			const warning = document.createElement('p');
			warning.className = 'snapshot-notice';
			const count = report.warnings?.length || 0;
			warning.textContent = count ? count + ' recorded warning' + (count === 1 ? '' : 's') + ' · See Timeline' : 'No warnings recorded.';
			content.append(duration, heading, summary, warning);
		},
		Telemetry() {
			renderDetailPages(content, metrics.map((metric) => metric.label + ' · ' +
				(metric.actual == null ? 'Unavailable' : metric.actual + ' ' + (metric.unit || ''))), 'No telemetry stored.');
		},
		Timeline() {
			const seconds = (time) => time.split(':').reduce((total, unit) => total * 60 + Number(unit), 0);
			const events = [...report.timeline || []].sort((a, b) => seconds(a.time) - seconds(b.time));
			renderDetailPages(content, events.map((event) => event.time + ' · ' + event.event), 'No timeline events recorded.');
		},
		Scoring() {
			renderDetailPages(content, scored.map((metric) => metric.label + ' · Weight ' + metric.weight +
				'% · ' + (metric.contribution == null ? 'Unavailable' : metric.contribution + ' points')),
			'No score breakdown stored.');
		},
	};
	for (const [label, render] of Object.entries(sections)) {
		const tab = document.createElement('button');
		tab.type = 'button';
		tab.textContent = label;
		tab.setAttribute('aria-pressed', String(label === 'Overview'));
		tab.addEventListener('click', () => {
			for (const control of controls.children) control.setAttribute('aria-pressed', String(control === tab));
			content.replaceChildren();
			render();
		});
		controls.append(tab);
	}
	box.append(head, controls, content);
	sections.Overview();
}

function renderDetailPages(host, entries, empty) {
	if (!entries.length) {
		host.textContent = empty;
		return;
	}
	const list = document.createElement('ul');
	list.className = 'snapshot-lines';
	const controls = document.createElement('div');
	controls.className = 'detail-pages';
	const back = document.createElement('button');
	const next = document.createElement('button');
	const status = document.createElement('span');
	status.setAttribute('role', 'status');
	back.type = next.type = 'button';
	back.textContent = 'Previous';
	next.textContent = 'Next';
	const pageSize = 5;
	const pages = Math.ceil(entries.length / pageSize);
	let page = 0;
	function render() {
		list.replaceChildren(...entries.slice(page * pageSize, (page + 1) * pageSize).map((entry) => {
			const item = document.createElement('li');
			item.textContent = entry;
			return item;
		}));
		back.disabled = page === 0;
		next.disabled = page + 1 === pages;
		status.textContent = (page + 1) + ' / ' + pages;
	}
	back.addEventListener('click', () => { page--; render(); });
	next.addEventListener('click', () => { page++; render(); });
	controls.append(back, status, next);
	host.append(list);
	if (pages > 1) host.append(controls);
	render();
}

function filteredQueue() {
	const trainee = document.getElementById('queue-trainee').value;
	return QUEUE.filter((item) => (!trainee || item.traineeId === trainee)
		&& (SESSION_FILTER === 'all' || item.status === SESSION_FILTER
			|| (SESSION_FILTER === 'awaiting' && queueFeedback(item) === 'Awaiting feedback')));
}

function queueFeedback(item) {
	if (item.status !== 'completed') return stateLabelFor(item.status);
	const notes = FEEDBACK_CACHE[item.traineeId];
	if (!notes) return 'Checking feedback…';
	return notes.some((note) => note.sessionId === item.sessionId) ? 'Feedback saved' : 'Awaiting feedback';
}

function renderSessions() {
	const tbody = document.getElementById('session-body');
	tbody.innerHTML = '';
	const matches = filteredQueue();
	const rows = matches.slice(0, sessionVisibleCount);
	document.getElementById('session-count').textContent = `${rows.length} of ${matches.length} sessions`;
	document.getElementById('more-sessions-btn').hidden = rows.length >= matches.length;

	if (!rows.length) {
		const cell = tbody.insertRow().insertCell();
		cell.colSpan = 6;
		cell.textContent = QUEUE.length ? 'No sessions match these filters.' : 'No training sessions yet.';
		return;
	}
	for (const item of rows) {
		const row = document.createElement('tr');
		row.className = 'session-row';
		row.dataset.sessionId = item.sessionId;
		row.innerHTML = '<td><strong></strong><small></small></td><td><time></time></td><td></td><td></td><td></td><td></td>';
		row.querySelector('strong').textContent = item.traineeFullName;
		row.querySelector('small').textContent = (scenarioDef(item.scenario)?.title || item.scenario) + attemptLabelFor(item.sessionId);
		row.querySelector('time').textContent = formatSessionDateTime(item.startedAt);
		row.cells[2].textContent = formatDurationMins(item.startedAt, item.endedAt);
		row.cells[3].append(gradeLabel(item.score));
		row.cells[4].textContent = queueFeedback(item);
		row.cells[4].classList.toggle('queue-awaiting', row.cells[4].textContent === 'Awaiting feedback');
		const open = document.createElement('button');
		open.type = 'button';
		open.className = 'queue-link';
		open.textContent = 'Review flight →';
		open.setAttribute('aria-label', `Open ${item.scenario} report, ${formatSessionDateTime(item.startedAt)}`);
		open.addEventListener('click', (ev) => {
			ev.stopPropagation();
			setSelectedSession(item.sessionId);
		});
		row.cells[5].append(open);
		const select = () => {
			setSelectedSession(item.sessionId);
		};
		row.addEventListener('click', select);
		row.addEventListener('keydown', (ev) => {
			if (ev.target === row && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); select(); }
		});
		tbody.appendChild(row);
	}

}

function bindSessionFilters() {
	for (const id of ['queue-trainee', 'queue-status']) {
		document.getElementById(id).addEventListener('change', () => {
			SESSION_FILTER = document.getElementById('queue-status').value;
			renderSessions();
			document.querySelector('.session-table-wrap').scrollTop = 0;
		});
	}
}

async function ensureNotesLoaded(traineeId) {
	if (FEEDBACK_CACHE[traineeId]) return;
	const version = notesCacheVersions.get(traineeId) || 0;

	try {
	const res = await apiRequest(`/trainees/${traineeId}/notes`, { auth: true });
	// A successful save invalidates any notes reads that began before it.
	if (version !== (notesCacheVersions.get(traineeId) || 0)) return ensureNotesLoaded(traineeId);
	if (!res.ok || !Array.isArray(res.data)) return;
	FEEDBACK_CACHE[traineeId] = res.data.map((n) => ({
			author: n.author,
			time: formatSessionDateTime(n.createdAt),
			note: n.note,
			sessionId: n.sessionId || null,
		}));
	} catch { /* Leave cache unset so a later selection retries. */ }
}

async function renderFeedback() {
	const version = ++notesRequestVersion;
	const traineeId = selectedTraineeId;
	const sessionId = selectedSessionId;
	const list = document.getElementById('feedback-stream');
	list.innerHTML = '';

	if (!selectedTraineeId) {
		const empty = document.createElement('li');
		empty.className = 'feedback-empty';
		empty.textContent = 'Select a trainee to view feedback.';
		list.appendChild(empty);
		return;
	}

	list.textContent = 'Loading trainer notes…';
	await ensureNotesLoaded(traineeId);
	if (version !== notesRequestVersion || traineeId !== selectedTraineeId || sessionId !== selectedSessionId) return;
	list.replaceChildren();
	if (!FEEDBACK_CACHE[traineeId]) {
		list.textContent = 'Could not load notes. Select the session again to retry.';
		return;
	}

	const traineeFeedback = FEEDBACK_CACHE[traineeId].filter((entry) => entry.sessionId === sessionId || !entry.sessionId);

	if (traineeFeedback.length === 0) {
		const empty = document.createElement('li');
		empty.className = 'feedback-empty';
		empty.textContent = 'No trainer notes for this session yet.';
		list.appendChild(empty);
		return;
	}

	const entries = [...traineeFeedback].reverse();
	const note = document.createElement('li');
	note.className = 'feedback-item';
	const heading = document.createElement('div');
	heading.className = 'feedback-item-head';
	const body = document.createElement('div');
	body.className = 'feedback-item-body';
	note.append(heading, body);
	list.append(note);
	const controls = document.createElement('div');
	controls.className = 'detail-pages';
	const newer = document.createElement('button');
	const older = document.createElement('button');
	newer.type = older.type = 'button';
	newer.textContent = 'Newer note';
	older.textContent = 'Older note';
	let index = 0;
	function renderNote() {
		const entry = entries[index];
		heading.textContent = entry.author + ' · ' + entry.time + ' · ' + (index + 1) + ' / ' + entries.length;
		body.textContent = entry.note;
		newer.disabled = index === 0;
		older.disabled = index + 1 === entries.length;
	}
	newer.addEventListener('click', () => { index--; renderNote(); });
	older.addEventListener('click', () => { index++; renderNote(); });
	controls.append(newer, older);
	if (entries.length > 1) list.append(controls);
	renderNote();
}

function bindFeedbackButton() {
	const button = document.getElementById('send-feedback-btn');
	button.addEventListener('click', async () => {
		const input = document.getElementById('feedback-input');
		const text = input.value.trim();
		const status = document.getElementById('feedback-save-status');
		if (!text || !selectedTraineeId || feedbackSaving) {
			if (!text) status.textContent = 'Write some feedback first.';
			return;
		}

		// Feedback attaches to the selected session (pinned by history row),
		// falling back to the trainee's most recent session.
		const target = selectedSession() || newestSessionFor(selectedTraineeId);
		if (!target) return;

		const traineeId = selectedTraineeId;
		feedbackSaving = true;
		button.disabled = true;
		status.textContent = 'Saving…';
		try {
		const res = await apiRequest(`/sessions/${target.sessionId}/feedback`, {
			method: 'POST',
			auth: true,
			body: { note: text },
		});

		if (!res.ok) {
			if (selectedSessionId === target.sessionId) status.textContent = res.data?.message || 'Could not save. Your feedback is still here; try again.';
			return;
		}

		delete FEEDBACK_CACHE[traineeId];
		notesCacheVersions.set(traineeId, (notesCacheVersions.get(traineeId) || 0) + 1);
		COVERAGE = null;
		if (selectedSessionId === target.sessionId) {
			// Do not discard text added while the request was being saved.
			if (input.value.trim() === text) input.value = '';
			feedbackDrafts.set(target.sessionId, input.value);
			status.textContent = 'Feedback saved.';
			await renderFeedback();
		} else if (feedbackDrafts.get(target.sessionId)?.trim() === text) {
			feedbackDrafts.delete(target.sessionId);
		}
		renderAnalytics();
		await refreshAwaitingFeedback();
		await ensureNotesLoaded(traineeId);
		renderSessions();
		} catch {
			if (selectedSessionId === target.sessionId) status.textContent = 'Could not reach the server. Your feedback is still here; try again.';
		} finally {
			feedbackSaving = false;
			button.disabled = !selectedSessionId;
		}
	});
}

function bindLogoutButton() {
	initLogoutConfirm();
}

// Per-trainee session duration settings (5–60 min, 5-min steps). Roster of
// assigned trainees comes from GET /api/trainees; a trainee with no sessions
// yet still appears here so their duration can be configured up front.
async function loadTraineeSettings() {
	try {
	const res = await apiRequest('/trainees', { auth: true });
	if (!res.ok || !Array.isArray(res.data)) throw new Error('Settings unavailable');
	ALL_TRAINEES = res.data;
	TRAINEE_SETTINGS = {};
	res.data.forEach((t) => { TRAINEE_SETTINGS[t.traineeId] = t.sessionDurationMinutes; });
	renderTraineeSettings(res.data);
	} catch {
		document.getElementById('trainee-settings').textContent = 'Could not load duration settings. Refresh to retry.';
	}
}

function renderTraineeSettings(trainees) {
	const host = document.getElementById('trainee-settings');
	if (!host) return;
	host.replaceChildren();
	if (!trainees.length) {
		host.textContent = selectedTraineeId ? 'Duration settings unavailable. Refresh on Overview to retry.' : 'No trainees assigned to you yet.';
		return;
	}
	for (const trainee of trainees) {
		const state = durationSaveStates.get(trainee.traineeId);
		const row = document.createElement('div');
		row.className = 'trainee-setting-row';
		const name = document.createElement('span');
		name.className = 'trainee-setting-name';
		name.textContent = trainee.fullName;
		const username = document.createElement('span');
		username.className = 'trainee-setting-user';
		username.textContent = trainee.username;
		name.appendChild(username);
		const select = document.createElement('select');
		select.className = 'trainee-duration-select';
		select.setAttribute('aria-label', `Session duration for ${trainee.fullName}`);
		for (let minutes = 5; minutes <= 60; minutes += 5) {
			const option = document.createElement('option');
			option.value = minutes;
			option.textContent = `${minutes} min`;
			select.appendChild(option);
		}
		select.value = state?.pending ? state.minutes : (TRAINEE_SETTINGS[trainee.traineeId] ?? trainee.sessionDurationMinutes ?? 25);
		select.disabled = Boolean(state?.pending);
		const status = document.createElement('span');
		status.className = 'trainee-setting-status';
		status.setAttribute('aria-live', 'polite');
		status.textContent = state?.message || '';
		select.addEventListener('change', () => saveTraineeDuration(trainee.traineeId, Number(select.value)));
		row.append(name, select, status);
		host.appendChild(row);
	}
}

async function saveTraineeDuration(traineeId, minutes) {
	if (durationSaveStates.get(traineeId)?.pending) return;
	durationSaveStates.set(traineeId, { pending: true, minutes, message: 'Saving…' });
	renderTraineeSettings(ALL_TRAINEES);
	let message;
	try {
		const res = await apiRequest(`/trainees/${traineeId}/session-duration`, {
			method: 'PUT', auth: true, body: { minutes },
		});
		if (res.ok) {
			TRAINEE_SETTINGS[traineeId] = minutes;
			const trainee = ALL_TRAINEES.find((t) => t.traineeId === traineeId);
			if (trainee) trainee.sessionDurationMinutes = minutes;
			message = 'Saved. Applies to the next session.';
		} else message = res.data?.message || 'Could not save. Previous duration restored.';
	} catch {
		message = 'Could not save. Try again.';
	}
	durationSaveStates.set(traineeId, { pending: false, message });
	renderTraineeSettings(ALL_TRAINEES);
}

// Static grading guideline (trainer-only): mirrors GradingService rules —
// pass threshold, hover weights, risk bands from the weighted breach rate.
function renderGradingGuidelines() {
	const host = document.getElementById('grading-guidelines');
	if (!host || typeof scenarioDef !== 'function') return;
	const def = scenarioDef('hover');
	if (!def) return;
	const list = document.createElement('dl');
	list.className = 'grading-rows';
	for (const metric of def.metrics.filter((item) => Number.isFinite(item.target))) {
		const row = document.createElement('div');
		const label = document.createElement('dt');
		label.textContent = metric.label;
		const value = document.createElement('dd');
		value.textContent = metric.target + ' ±' + metric.tolerance + ' ' + metric.unit;
		row.append(label, value);
		list.append(row);
	}
	const weights = document.createElement('p');
	weights.textContent = def.metrics.filter((item) => def.weights[item.key] !== undefined)
		.map((metric) => metric.label + ' ' + def.weights[metric.key] + '%').join(' · ');
	host.replaceChildren(list, weights);
}


async function loadLiveData({ reloadNotes = false } = {}) {
	try {
		// Both calls in parallel: the queue drives sessions/analytics, while
		// /api/trainees guarantees sessionless assigned trainees are rostered.
		const [res, traineesRes] = await Promise.all([
			apiRequest('/sessions/queue', { auth: true }),
			apiRequest('/trainees', { auth: true }),
		]);
		if (!res.ok || !Array.isArray(res.data)) {
			setWorkspaceMessage('Could not load sessions. Use Refresh to retry.');
			return;
		}
		ALL_TRAINEES = (traineesRes.ok && Array.isArray(traineesRes.data)) ? traineesRes.data : [];
		if (traineesRes.ok) ALL_TRAINEES.forEach((item) => { TRAINEE_SETTINGS[item.traineeId] = item.sessionDurationMinutes; });
		setWorkspaceMessage(traineesRes.ok ? '' : 'Could not load the full roster. Showing trainees with recorded sessions.');

		if (reloadNotes) {
			for (const id of new Set([...Object.keys(FEEDBACK_CACHE), ...notesCacheVersions.keys(), ...TRAINTEES.map((item) => item.id)])) {
				delete FEEDBACK_CACHE[id];
				notesCacheVersions.set(id, (notesCacheVersions.get(id) || 0) + 1);
			}
		}
		QUEUE = res.data;
		buildRoster();
		const queueTrainee = document.getElementById('queue-trainee');
		const filter = queueTrainee.value;
		queueTrainee.replaceChildren(new Option('All assigned trainees', ''),
			...TRAINTEES.map((trainee) => new Option(trainee.fullName, trainee.id)));
		queueTrainee.value = TRAINTEES.some((trainee) => trainee.id === filter) ? filter : '';
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
		Promise.all(TRAINTEES.map((trainee) => ensureNotesLoaded(trainee.id))).then(renderSessions);
		return traineesRes.ok;
	} catch {
		setWorkspaceMessage('Could not reach the server. Use Refresh to retry.');
	}
}

// ==========================================================================
// SPIKE (throwaway): Add Trainee modal — POST /api/trainees.
// Backend stamps AssignedTrainerId from this trainer's JWT.
// ==========================================================================

function openTraineeModal() {
	const overlay = document.getElementById('trainee-modal-overlay');
	if (!overlay) return;
	overlay.showModal();
	const first = document.getElementById('trainee-fullName');
	if (first) first.focus();
}

function closeTraineeModal() {
	const overlay = document.getElementById('trainee-modal-overlay');
	if (!overlay) return;
	overlay.close();
}

function resetTraineeModal() {
	document.getElementById('add-trainee-btn').focus();
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
	overlay.addEventListener('close', resetTraineeModal);
	overlay.addEventListener('click', (e) => {
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

	renderGradingGuidelines();
	bindLiveDropdown();
	bindSessionFilters();
	bindFeedbackButton();
	bindLogoutButton();
	bindTraineeModal();
	const refresh = document.getElementById('trainer-refresh-btn');
	const updated = document.getElementById('trainer-updated');
	function showUpdated(success) {
		if (success) updated.textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	}
	loadLiveData().then(showUpdated);
	refresh.addEventListener('click', async () => {
		if (refresh.getAttribute('aria-disabled') === 'true') return;
		refresh.setAttribute('aria-disabled', 'true');
		refresh.textContent = 'Refreshing…';
		try {
			showUpdated(await loadLiveData({ reloadNotes: true }));
		} finally {
			refresh.removeAttribute('aria-disabled');
			refresh.textContent = 'Refresh';
		}
	});
	document.getElementById('more-sessions-btn').addEventListener('click', () => { sessionVisibleCount += 30; renderSessions(); });
	window.addEventListener('beforeunload', stopLiveTimers);
});
}
