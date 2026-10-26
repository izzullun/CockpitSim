import { historyEntries, missionFromHistory, profileStats } from './trainee-view-model.js';

const session = requireRole(['trainee', 'admin']);
let currentMission = { scenario: 'hover' };
let launchInProgress = false;

function renderProfile(me, sessions) {
  document.getElementById('profile-name').textContent = me.fullName || me.username || '—';
  document.getElementById('profile-role').textContent = 'Trainee';
  document.getElementById('profile-trainer').textContent = me.assignedTrainerName || 'Unassigned';
  document.getElementById('profile-last-login').textContent = me.lastLoginAt
    ? parseDbDate(me.lastLoginAt).toLocaleString('en-GB', { hour12: false }) : '—';
  document.getElementById('hud-username').textContent = me.fullName || me.username || 'Pilot';
  const stats = profileStats(sessions);
  document.getElementById('profile-sessions').textContent = String(stats.sessionsFlown);
  document.getElementById('profile-flight-time').textContent = `${stats.totalFlightMinutes} min`;
}

function renderMission(mission) {
  currentMission = mission;
  document.getElementById('upcoming-exercise').textContent = mission.title;
  document.getElementById('upcoming-date').textContent = 'On-demand flight';
  document.getElementById('upcoming-duration').textContent = mission.timeLimitMinutes
    ? `${mission.timeLimitMinutes} min` : 'Set when you start';
  const def = scenarioDef(mission.scenario);
  document.getElementById('mission-brief').textContent = def?.objectives?.[0]
    || 'Practise the flight objective and review your result afterwards.';
  const note = document.getElementById('upcoming-notes');
  note.hidden = !mission.trainerNote;
  if (mission.trainerNote) note.textContent = `From your trainer: ${mission.trainerNote}`;

  const host = document.getElementById('weight-list');
  host.replaceChildren();
  if (!def) return;
  document.getElementById('pass-mark').textContent = `Pass mark: ${def.passThreshold}`;
  for (const [key, weight] of Object.entries(def.weights || {})) {
    const row = document.createElement('div');
    row.className = 'weight-item';
    const label = def.metrics.find((metric) => metric.key === key)?.label || key;
    const head = document.createElement('div');
    head.className = 'weight-item-head';
    const name = document.createElement('span');
    name.textContent = label;
    const amount = document.createElement('strong');
    amount.textContent = `${weight}%`;
    head.append(name, amount);
    const track = document.createElement('div');
    track.className = 'weight-track';
    const fill = document.createElement('span');
    fill.className = 'weight-fill';
    fill.style.setProperty('--weight-width', `${Math.min(100, weight / 35 * 100)}%`);
    track.append(fill);
    row.append(head, track);
    host.append(row);
  }
  document.getElementById('scoring-explanation').innerHTML =
    `<p>The score combines each graded metric's time within tolerance with its weight. ` +
    `A score of ${def.passThreshold} or higher passes. The session ends at the trainer's time limit.</p>`;
}

function renderHistory(sessions) {
  const rows = historyEntries(sessions);
  document.getElementById('history-count').textContent = `${rows.length} flight${rows.length === 1 ? '' : 's'}`;
  const body = document.getElementById('history-body');
  body.replaceChildren();
  if (rows.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.className = 'empty-row';
    cell.textContent = 'No flights yet. Your first session will appear here.';
    row.append(cell);
    body.append(row);
    return;
  }
  rows.forEach((entry) => {
    const row = document.createElement('tr');
    const flight = document.createElement('td');
    const scenario = scenarioDef(entry.scenario);
    flight.textContent = `${scenario?.title || entry.scenario || 'Flight'} · #${entry.attempt}`;
    const date = document.createElement('td');
    date.textContent = entry.date;
    const duration = document.createElement('td');
    duration.textContent = entry.durationMinutes === null ? '—' : `${entry.durationMinutes} min`;
    const state = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `outcome-badge${entry.status === 'in_progress' ? ' live' : ''}`;
    badge.textContent = entry.outcome;
    state.append(badge);
    const report = document.createElement('td');
    if (entry.canOpenReport) {
      const link = document.createElement('a');
      link.className = 'report-open';
      link.href = `./post-session.html?session=${encodeURIComponent(entry.sessionId)}`;
      link.textContent = 'View result';
      report.append(link);
    } else report.textContent = '—';
    row.append(flight, date, duration, state, report);
    body.append(row);
  });
}

async function loadDashboard() {
  const [meRes, historyRes] = await Promise.all([
    apiRequest('/me', { auth: true }), apiRequest('/me/sessions', { auth: true }),
  ]);
  const sessions = historyRes.ok && Array.isArray(historyRes.data) ? historyRes.data : [];
  if (!historyRes.ok) {
    document.getElementById('history-body').innerHTML = '<tr><td colspan="5">Could not load flights. Reload to try again.</td></tr>';
  } else renderHistory(sessions);
  const me = meRes.ok && meRes.data ? meRes.data : null;
  if (me) renderProfile(me, sessions);
  else document.getElementById('profile-name').textContent = 'Profile unavailable';
  const mission = missionFromHistory(me, sessions);
  // Trainer notes are exposed on a stored report, not on /me/sessions.
  const previous = [...sessions].reverse().find((item) => item.scenario === mission.scenario && item.status === 'completed');
  if (previous) {
    const reportRes = await apiRequest(`/me/sessions/${previous.sessionId}/report`, { auth: true });
    if (reportRes.ok && Array.isArray(reportRes.data?.notes)) {
      mission.trainerNote = reportRes.data.notes.at(-1)?.note || null;
    }
  }
  renderMission(mission);
}

function requestSimulatorLaunch() {
  try { window.chrome?.webview?.postMessage({ command: 'startSimulator' }); }
  catch (error) { console.warn('[pre-session] simulator launch message failed', error); }
}

async function startSession() {
  if (launchInProgress) return;
  launchInProgress = true;
  const button = document.getElementById('btn-start-session');
  button.disabled = true;
  document.getElementById('hud-status').textContent = 'Starting';
  const res = await apiRequest('/me/sessions/start', {
    method: 'POST', auth: true, body: { scenario: currentMission.scenario },
  });
  if ((res.ok || res.status === 409) && res.data?.sessionId) {
    requestSimulatorLaunch();
    window.location.href = `./session-ongoing.html?session=${encodeURIComponent(res.data.sessionId)}`;
    return;
  }
  launchInProgress = false;
  button.disabled = false;
  document.getElementById('hud-status').textContent = 'Ready';
  document.getElementById('start-help').textContent = 'Could not start the session. Please try again.';
  console.error('[pre-session] start failed', res.status, res.data);
}

if (session) {
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-start-session').addEventListener('click', startSession);
    initLogoutConfirm();
    loadDashboard();
  });
}
