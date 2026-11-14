import { resultView, flightDuration } from './report-view-model.js';
import { gradeLabel, passText, scoreText } from '../shared/js/flight-grade.js';
import { openReportPanel } from './report-panel.js';

const session = requireRole(['trainee', 'admin']);
const setText = (id, value) => { document.getElementById(id).textContent = value; };

async function loadResult(button) {
  try {
    const history = await apiRequest('/me/sessions', { auth: true });
    const sessions = history.ok && Array.isArray(history.data) ? history.data : [];
    const id = new URLSearchParams(location.search).get('session')
      || sessions.findLast((item) => item.status === 'completed')?.sessionId;
    if (!id) {
      setText('result-verdict', history.ok ? 'No completed flights yet' : 'Flight history unavailable');
      return;
    }
    button.addEventListener('click', () => openReportPanel(id, button, 'Back to Result'));
    button.disabled = false;
    const entry = sessions.find((item) => item.sessionId === id);
    async function poll() {
      try {
        const response = await apiRequest('/me/sessions/' + encodeURIComponent(id) + '/report', { auth: true });
        if (response.status === 404) {
          setText('result-verdict', entry?.status === 'cancelled' ? 'Cancelled' : 'Awaiting grading');
          if (entry?.status === 'cancelled') return;
          window.setTimeout(poll, 3000);
          return;
        }
        if (!response.ok || !response.data) throw new Error('Report unavailable');
        const report = response.data;
        const view = resultView(report);
        setText('summary-exercise', [
          scenarioDef(report.scenario)?.title || report.scenario,
          entry && 'Attempt ' + entry.attempt,
          flightDuration(report),
        ].filter(Boolean).join(' · '));
        const status = view.score !== null ? passText(view.score) + ' · Pass mark 70'
          : view.state === 'no-data' ? 'Unscored · No flight data captured'
          : report.status === 'completed' ? 'Unscored' : 'Awaiting grading';
        setText('result-verdict', status);
        if (view.score === null) return;
        document.getElementById('result-grade').append(gradeLabel(view.score));
        document.getElementById('result-score-line').hidden = false;
        setText('result-score', scoreText(view.score));
      } catch {
        setText('result-verdict', 'Flight report unavailable');
      }
    }
    await poll();
  } catch {
    setText('result-verdict', 'Flight history unavailable');
  }
}

if (session) {
  setText('hud-username', session.fullName || session.username || 'Pilot');
  initLogoutConfirm();
  loadResult(document.getElementById('view-full-report'));
}
