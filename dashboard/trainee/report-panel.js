import { breakdownRows } from './report-view-model.js';

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
  host.append(table);
  if (typeof report.score === 'number') host.append(node('p', 'detail-total',
    `Stored score: ${report.score} / 100 · Pass mark: ${report.passThreshold ?? '—'}`));
}

function buildTimeline(host, report) {
  if (!report.timeline?.length) { addEmpty(host, 'No timeline events were recorded.'); return; }
  const list = node('ol', 'detail-timeline');
  report.timeline.forEach((event) => {
    const item = node('li');
    item.append(node('time', '', event.time), node('span', '', event.event));
    list.append(item);
  });
  host.append(list);
}

function buildNotes(host, report) {
  if (!report.notes?.length) { addEmpty(host, 'No trainer notes yet.'); return; }
  report.notes.forEach((note) => {
    const card = node('article', 'detail-note');
    card.append(node('strong', '', note.author || 'Trainer'), node('p', '', note.note));
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
    list.append(row);
  });
  host.append(list);
  if (report.warnings?.length) {
    const note = node('p', 'detail-warning', report.warnings.join(' '));
    host.append(note);
  }
}

let panel;

export function openReportPanel(report) {
  if (!panel) {
    panel = node('dialog', 'report-drawer');
    panel.setAttribute('aria-label', 'Full flight report');
    document.body.append(panel);
  }
  panel.replaceChildren();
  const header = node('div', 'report-drawer-head');
  const title = node('div');
  title.append(node('span', 'report-drawer-caption', 'Flight report'), node('h2', '', report.scenario || 'Session'));
  const close = node('button', 'report-drawer-close', 'Close');
  close.type = 'button';
  close.addEventListener('click', () => panel.close());
  header.append(title, close);
  panel.append(header);

  const tabs = node('div', 'report-tabs');
  tabs.setAttribute('role', 'tablist');
  const content = node('div', 'report-tab-content');
  const definitions = [
    ['Breakdown', buildBreakdown], ['Timeline', buildTimeline],
    ['Trainer notes', buildNotes], ['Telemetry', buildTelemetry],
  ];
  const buttons = [];
  const sections = [];
  definitions.forEach(([label, render], index) => {
    const button = node('button', 'report-tab', label);
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
    const section = node('section');
    section.setAttribute('role', 'tabpanel');
    section.hidden = index !== 0;
    render(section, report);
    button.addEventListener('click', () => {
      buttons.forEach((tab, i) => tab.setAttribute('aria-selected', i === index ? 'true' : 'false'));
      sections.forEach((pane, i) => { pane.hidden = i !== index; });
    });
    buttons.push(button);
    sections.push(section);
    tabs.append(button);
    content.append(section);
  });
  panel.append(tabs, content);
  panel.showModal();
  close.focus();
}
