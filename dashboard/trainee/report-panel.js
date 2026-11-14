import { gradeLabel, passText, scoreText } from '../shared/js/flight-grade.js';
import { breakdownRows, flightDuration, previousSession, resultView } from './report-view-model.js';

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function addEmpty(host, text) { host.append(node('p', 'report-empty', text)); }

function buildBreakdown(host, report) {
  const rows = breakdownRows(report.metrics);
  if (rows.length === 0) { addEmpty(host, 'No score breakdown is stored for this flight.'); return; }
  const table = node('table', 'detail-table');
  const thead = node('thead');
  const heading = node('tr');
  ['Metric', 'Weight', 'Within tolerance', 'Contribution'].forEach((label) => heading.append(node('th', '', label)));
  thead.append(heading);
  const body = node('tbody');
  rows.forEach((row) => {
    const tr = node('tr');
    [row.label, row.weight, row.within, row.contribution].forEach((value) => tr.append(node('td', '', value)));
    body.append(tr);
  });
  table.append(thead, body);
  host.append(node('p', 'report-empty', 'Each contribution is its weight multiplied by the percentage of time within tolerance.'), table);
  if (report.scoreFormula) host.append(node('p', 'detail-total', report.scoreFormula));
  if (typeof report.score === 'number') host.append(node('p', 'detail-total',
    `Stored score: ${report.score} / 100 · Pass mark: ${report.passThreshold ?? '—'}`));
}

function buildTimeline(host, report) {
  if (!report.timeline?.length) { addEmpty(host, 'No timeline events were recorded.'); return; }
  const list = node('ol', 'detail-timeline');
  const seconds = (time) => time.split(':').reduce((total, part) => total * 60 + Number(part), 0);
  [...report.timeline].sort((a, b) => seconds(a.time) - seconds(b.time)).forEach((event) => {
    const item = node('li');
    const warning = /left tolerance|warning|breach/i.test(event.event);
    item.append(node('time', '', event.time), node('span', warning ? 'detail-warning' : '',
      warning ? 'Warning · ' + event.event : event.event));
    list.append(item);
  });
  host.append(list);
}

function buildNotes(host, report) {
  if (report.notes === null) { addEmpty(host, 'Trainer notes unavailable.'); return; }
  if (!report.notes?.length) { addEmpty(host, 'No trainer notes yet.'); return; }
  report.notes.forEach((note) => {
    const card = node('article', 'detail-note');
    card.append(node('strong', '', note.author || 'Trainer'), node('time', '', ' · ' + formatSessionDateTime(note.createdAt)), node('p', '', note.note));
    host.append(card);
  });
}

function buildTelemetry(host, report) {
  if (!report.metrics?.length) { addEmpty(host, 'No telemetry values were stored.'); return; }
  const list = node('dl', 'detail-metrics');
  report.metrics.forEach((metric) => {
    const row = node('div');
    row.append(node('dt', '', metric.label), node('dd', '',
      metric.actual === null || metric.actual === undefined ? '—' : `${metric.actual} ${metric.unit || ''}`.trim()));
    if (Number.isFinite(metric.target) && Number.isFinite(metric.tolerance)) {
      const unit = metric.unit || '';
      const details = node('dd', 'metric-target',
        'Target ' + metric.target + ' ±' + metric.tolerance + ' ' + unit);
      if (Number.isFinite(metric.actual) && metric.tolerance > 0) {
        const track = node('div', 'tolerance-track');
        const marker = node('span', 'tolerance-marker');
        const offset = (metric.actual - metric.target) / metric.tolerance;
        marker.style.left = Math.min(98, Math.max(2, 50 + offset * 25)) + '%';
        track.setAttribute('aria-hidden', 'true');
        track.append(marker);
        details.append(track, node('span', '', Math.abs(offset) <= 1 ? 'Aggregate within tolerance' : 'Aggregate outside tolerance'));
      }
      row.append(details);
    }
    list.append(row);
  });
  host.append(list);
  if (report.warnings?.length) {
    const note = node('p', 'detail-warning', report.warnings.join(' '));
    host.append(note);
  }
}


function buildOverview(host, report, entry, previousScore, showBreakdown) {
  const view = resultView(report);
  const left = node('div');
  const summary = node('section', 'report-summary');
  const information = node('div');
  information.append(
    node('h3', '', scenarioDef(report.scenario)?.title || report.scenario || 'Flight'),
    node('p', 'report-meta', [entry && 'Attempt ' + entry.attempt, formatSessionDateTime(report.startedAt)].filter(Boolean).join(' · ')),
  );
  const duration = node('div', 'report-duration');
  duration.append(node('span', '', 'Flight duration'), node('strong', '', flightDuration(report) || 'Unavailable'));
  if (report.timeLimitMinutes) duration.append(node('span', '', 'Time limit'), node('strong', '', report.timeLimitMinutes + ' min'));
  information.append(duration);
  const outcome = node('div', 'report-outcome');
  if (view.score !== null) {
    outcome.append(gradeLabel(view.score), node('strong', '', scoreText(view.score) + ' / 100'),
      node('p', '', passText(view.score)));
  } else {
    outcome.append(node('p', '', view.state === 'no-data' ? 'Unscored · No flight data' : 'Score unavailable'));
  }
  summary.append(information, outcome);
  left.append(summary);

  const facts = node('div', 'report-facts');
  if (Number.isFinite(previousScore) && view.score !== null) {
    const delta = Number((view.score - previousScore).toFixed(1));
    const comparison = node('div');
    comparison.append(node('p', 'report-meta', 'Previous ' + (scenarioDef(report.scenario)?.title || 'flight') + ' attempt'),
      node('strong', '', (delta > 0 ? '+' : '') + delta + ' points'),
      node('p', '', scoreText(previousScore) + ' → ' + scoreText(view.score) + ' / 100'));
    facts.append(comparison);
  }
  const recorded = (report.metrics || []).filter((metric) => Number.isFinite(metric.weight));
  const measured = recorded.filter((metric) => Number.isFinite(metric.withinPct));
  if (measured.length) {
    const highest = Math.max(...measured.map((metric) => metric.withinPct));
    const strongest = measured.filter((metric) => metric.withinPct === highest);
    const control = node('div');
    control.append(node('p', 'report-meta', strongest.length > 1 ? 'Strongest control · joint highest' : 'Strongest control'),
      node('strong', '', strongest.map((metric) => metric.label).join(' & ')),
      node('p', '', highest + '% of scored time in tolerance'));
    facts.append(control);
  }
  left.append(facts);

  const performance = node('section', 'report-performance');
  summary.setAttribute('data-cockpit-outline', '');
  performance.setAttribute('data-cockpit-outline', '');
  performance.append(node('h3', '', 'Performance summary'),
    node('p', 'report-meta', 'Time within tolerance during the scored flight.'));
  if (!measured.length) addEmpty(performance, 'Time within tolerance unavailable.');
  recorded.forEach((metric) => {
    const item = node('div', 'performance-metric');
    const label = node('div');
    label.append(node('span', '', metric.label), node('strong', '',
      Number.isFinite(metric.withinPct) ? metric.withinPct + '%' : 'Unavailable'));
    item.append(label);
    if (Number.isFinite(metric.withinPct)) {
      const track = node('progress');
      track.max = 100;
      track.value = metric.withinPct;
      track.setAttribute('aria-label', metric.label + ' time within tolerance');
      item.append(track);
    }
    performance.append(item);
  });
  const link = node('button', 'report-breakdown-link', 'View score breakdown →');
  link.type = 'button';
  link.addEventListener('click', showBreakdown);
  performance.append(link);
  host.classList.add('report-overview');
  host.append(left, performance);
}

function buildTabs(host, report, entry, previousScore) {
  const tabs = node('div', 'report-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Flight report sections');
  const content = node('div', 'report-tab-content');
  const definitions = [
    ['Overview', (section) => buildOverview(section, report, entry, previousScore, () => select(4, true))],
    ['Telemetry', buildTelemetry], ['Timeline', buildTimeline],
    ['Trainer Notes', buildNotes], ['Score Breakdown', buildBreakdown],
  ];
  const buttons = [];
  const sections = [];
  function select(index, focus = false) {
    buttons.forEach((button, i) => {
      button.setAttribute('aria-selected', String(i === index));
      button.tabIndex = i === index ? 0 : -1;
      sections[i].hidden = i !== index;
    });
    if (focus) buttons[index].focus();
  }
  definitions.forEach(([label, render], index) => {
    const button = node('button', 'report-tab', label);
    button.type = 'button';
    button.id = 'flight-report-tab-' + index;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', 'flight-report-pane-' + index);
    button.addEventListener('click', () => select(index));
    button.addEventListener('keydown', (event) => {
      const count = definitions.length;
      const next = { ArrowLeft: (index + count - 1) % count, ArrowRight: (index + 1) % count,
        Home: 0, End: count - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      select(next, true);
    });
    const section = node('section');
    section.id = 'flight-report-pane-' + index;
    section.tabIndex = 0;
    section.setAttribute('role', 'tabpanel');
    section.setAttribute('aria-labelledby', button.id);
    render(section, report);
    buttons.push(button);
    sections.push(section);
    tabs.append(button);
    content.append(section);
  });
  host.append(tabs, content);
  select(0);
}

let panel;

export async function openReportPanel(id, opener, backLabel) {
  if (panel?.open) return;
  if (!panel) {
    panel = node('dialog', 'report-drawer');
    panel.setAttribute('aria-labelledby', 'flight-report-title');
    document.body.append(panel);
  }
  const header = node('header', 'report-drawer-head');
  const heading = node('div');
  const title = node('h2', '', 'Flight Report');
  title.id = 'flight-report-title';
  const subtitle = node('p', 'report-meta');
  heading.append(title, subtitle);
  const close = node('button', 'report-drawer-close', backLabel);
  close.type = 'button';
  close.addEventListener('click', () => panel.close());
  header.append(heading, close);
  const status = node('p', 'report-load', 'Loading flight report…');
  status.setAttribute('role', 'status');
  panel.replaceChildren(header, status);
  panel.addEventListener('close', () => opener.focus(), { once: true });
  panel.showModal();
  close.focus();

  const getReport = (sessionId) => apiRequest('/me/sessions/' + encodeURIComponent(sessionId) + '/report', { auth: true });
  try {
    const [response, history] = await Promise.all([
      getReport(id),
      apiRequest('/me/sessions', { auth: true }).catch(() => null),
    ]);
    if (!status.isConnected || !panel.open) return;
    const sessions = history?.ok && Array.isArray(history.data) ? history.data : [];
    const entry = sessions.find((session) => session.sessionId === id);
    const historical = response.status === 404 && backLabel === 'Back to Flight Log' && entry?.status === 'completed';
    if ((!response.ok || !response.data) && !historical) {
      status.textContent = response.status === 404 ? 'This flight report is pending.' : 'Flight report unavailable.';
      return;
    }
    let report = response.data;
    if (historical) {
      const notes = await apiRequest('/me/sessions/' + encodeURIComponent(id) + '/notes', { auth: true });
      if (!status.isConnected || !panel.open) return;
      report = { ...entry, notes: notes.ok && Array.isArray(notes.data) ? notes.data : null };
    }
    const previous = previousSession(sessions, report);
    subtitle.textContent = [scenarioDef(report.scenario)?.title || report.scenario,
      formatSessionDateTime(report.startedAt)].join(' · ');
    const body = node('div', 'report-body');
    buildTabs(body, report, entry, previous?.score);
    status.replaceWith(body);
  } catch {
    status.textContent = 'Could not load this flight report. Close it and try again.';
  }
}
