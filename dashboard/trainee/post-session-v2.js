import { resultView, previousSession, metricInsights } from './report-view-model.js';
import { openReportPanel } from './report-panel.js';

const session = requireRole(['trainee', 'admin']);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let currentReport = null;
let pollTimer = null;

function setText(id, value) { document.getElementById(id).textContent = value; }

async function resolveSessionId() {
  const requested = new URLSearchParams(window.location.search).get('session');
  if (requested) return requested;
  const res = await apiRequest('/me/sessions', { auth: true });
  if (!res.ok || !Array.isArray(res.data)) return null;
  return [...res.data].reverse().find((item) => item.status === 'completed')?.sessionId || null;
}

function formatScore(value) { return Number.isInteger(value) ? String(value) : value.toFixed(1); }

function drawScore(score, revealVerdict) {
  const progress = document.getElementById('score-progress');
  const circumference = 2 * Math.PI * 104;
  progress.style.strokeDasharray = String(circumference);
  progress.style.strokeDashoffset = String(circumference);
  if (reducedMotion.matches) {
    progress.style.strokeDashoffset = String(circumference * (1 - score / 100));
    setText('result-score', formatScore(score));
    revealVerdict();
    return;
  }
  window.setTimeout(() => {
    const start = performance.now();
    const duration = 950;
    function tick(now) {
      const fraction = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - fraction) ** 3;
      const shown = score * eased;
      progress.style.strokeDashoffset = String(circumference * (1 - shown / 100));
      setText('result-score', fraction === 1 ? formatScore(score) : String(Math.round(shown)));
      if (fraction < 1) requestAnimationFrame(tick);
      else revealVerdict();
    }
    requestAnimationFrame(tick);
  }, 350);
}

function renderStars(count) {
  const host = document.getElementById('result-stars');
  host.replaceChildren();
  if (!count) return;
  for (let index = 0; index < 3; index++) {
    const star = document.createElement('span');
    star.className = index < count ? 'is-earned' : '';
    star.textContent = '★';
    host.append(star);
  }
  host.setAttribute('aria-label', `${count} out of 3 result stars`);
}

function renderInsights(report) {
  const insight = metricInsights(report.scenario, report.metrics);
  const host = document.getElementById('result-insights');
  host.hidden = !insight.strongest && !insight.focus;
  if (insight.strongest) setText('result-strongest',
    `${insight.strongest.label} · ${insight.strongest.withinPct.toFixed(1)}% in tolerance`);
  if (insight.focus) {
    setText('result-focus', `${insight.focus.label} · ${insight.focus.withinPct.toFixed(1)}% in tolerance`);
    const tip = scenarioDef(report.scenario)?.metrics?.find((metric) => metric.key === insight.focus.key)?.tip;
    setText('result-tip', tip || 'Practise this control on your next flight.');
  }
}

function renderResult(report) {
  currentReport = report;
  const view = resultView(report);
  document.body.dataset.resultState = view.state;
  setText('result-flight-time', view.flightMinutes === null ? '—' : `${view.flightMinutes} min`);
  setText('result-metrics-count', String((report.metrics || []).filter((metric) => metric.actual !== null && metric.actual !== undefined).length));
  setText('result-limit', report.timeLimitMinutes ? `${report.timeLimitMinutes} min` : '—');
  document.getElementById('view-full-report').disabled = false;
  document.getElementById('result-insights').hidden = true;
  document.getElementById('result-comparison').hidden = true;

  if (view.state === 'no-data') {
    setText('result-verdict', 'No flight data captured');
    setText('result-subline', 'We could not score this session. Check the simulator connection before your next flight.');
    setText('result-score', '—');
    renderStars(0);
    return;
  }
  if (view.state === 'pending') {
    setText('result-verdict', 'Awaiting grading');
    setText('result-subline', 'Your flight is finished. Your score will appear when the report is ready.');
    setText('result-score', '—');
    renderStars(0);
    return;
  }

  setText('result-verdict', 'Analysing flight…');
  setText('result-subline', 'Your flight data has been captured. Preparing your result.');
  setText('result-score', '0');
  drawScore(view.score, () => {
    setText('result-verdict', view.state === 'complete' ? 'Mission complete' : 'Needs work');
    setText('result-subline', view.state === 'complete'
      ? `You reached the pass mark of ${view.threshold}. Hold this precision on your next flight.`
      : `Your score is below the pass mark of ${view.threshold}. Use the focus note for your next attempt.`);
    renderStars(view.stars);
    renderInsights(report);
  });
}

async function renderComparison(report, sessions) {
  if (typeof report.score !== 'number') return;
  const previous = previousSession(sessions, report);
  if (!previous) return;
  const response = await apiRequest(`/me/sessions/${previous.sessionId}/report`, { auth: true });
  if (!response.ok || typeof response.data?.score !== 'number') return;
  const change = Math.round((report.score - response.data.score) * 10) / 10;
  const label = change > 0 ? `+${change}` : String(change);
  setText('result-comparison', `${label} points vs your previous ${scenarioDef(report.scenario)?.title || 'flight'} attempt`);
  document.getElementById('result-comparison').hidden = false;
}

async function loadReport(id) {
  const response = await apiRequest(`/me/sessions/${id}/report`, { auth: true });
  if (response.status === 404) {
    setText('result-verdict', 'Preparing your report');
    setText('result-subline', 'Grading is still in progress. This page will update automatically.');
    if (!pollTimer) pollTimer = window.setInterval(() => loadReport(id), 3000);
    return;
  }
  if (!response.ok || !response.data) {
    setText('result-verdict', 'Report unavailable');
    setText('result-subline', 'We could not load this flight report. Reload to try again.');
    return;
  }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  const report = response.data;
  const history = await apiRequest('/me/sessions', { auth: true });
  const sessions = history.ok && Array.isArray(history.data) ? history.data : [];
  const entry = sessions.find((item) => item.sessionId === report.sessionId);
  setText('summary-exercise', `${scenarioDef(report.scenario)?.title || report.scenario || 'Flight'}${entry ? ` · Attempt ${entry.attempt}` : ''}`);
  renderResult(report);
  renderComparison(report, sessions);
}

if (session) {
  document.addEventListener('DOMContentLoaded', async () => {
    setText('hud-username', session.fullName || session.username || 'Pilot');
    document.getElementById('view-full-report').addEventListener('click', () => {
      if (currentReport) openReportPanel(currentReport);
    });
    initLogoutConfirm();
    const id = await resolveSessionId();
    if (id) loadReport(id);
    else {
      setText('result-verdict', 'No completed flights yet');
      setText('result-subline', 'Start a flight from Mission to see your result here.');
    }
  });
}
