import test from 'node:test';
import assert from 'node:assert/strict';
import { resultView, previousSession, metricInsights, breakdownRows } from '../report-view-model.js';

// Exercise the WebView's Malaysian timezone; all-Z fixtures hide mixed-kind bugs.
process.env.TZ = 'Asia/Kuala_Lumpur';

const base = {
  sessionId: 'current', scenario: 'hover', status: 'completed',
  startedAt: '2026-10-20T10:00:00Z', endedAt: '2026-10-20T10:20:00Z',
  passThreshold: 70, score: null, metrics: [], warnings: [], timeline: [], notes: [],
};

test('flight time treats suffixless database timestamps as UTC', () => {
  assert.equal(resultView({ ...base,
    startedAt: '2026-10-27T12:00:00', endedAt: '2026-10-27T12:04:00Z',
  }).flightMinutes, 4);
});

test('flight time preserves explicit timezone offsets', () => {
  assert.equal(resultView({ ...base,
    startedAt: '2026-10-27T20:00:00+08:00', endedAt: '2026-10-27T12:04:00Z',
  }).flightMinutes, 4);
});

test('missing or invalid flight timestamps do not invent a duration', () => {
  assert.equal(resultView({ ...base, endedAt: null }).flightMinutes, null);
  assert.equal(resultView({ ...base, startedAt: 'invalid' }).flightMinutes, null);
});

test('previous flight comparison orders mixed UTC timestamp formats correctly', () => {
  const current = { ...base, startedAt: '2026-10-27T12:04:00' };
  const sessions = [
    { ...base, sessionId: 'previous', startedAt: '2026-10-27T12:03:00Z' },
    { ...base, sessionId: 'future', startedAt: '2026-10-27T12:05:00Z' },
  ];
  assert.equal(previousSession(sessions, current)?.sessionId, 'previous');
});

test('a missing score stays pending instead of showing a perfect completion', () => {
  assert.equal(resultView(base).state, 'pending');
  assert.equal(resultView(base).score, null);
});

test('a report without captured telemetry has its own honest state', () => {
  const view = resultView({ ...base, warnings: ['No telemetry was captured for this session.'] });
  assert.equal(view.state, 'no-data');
  assert.equal(view.stars, 0);
});

test('verdict uses the pass mark supplied by the report', () => {
  const view = resultView({ ...base, score: 72, passThreshold: 75,
    metrics: [{ key: 'radar_alt', actual: 5, withinPct: 72 }] });
  assert.equal(view.state, 'needs-work');
  assert.equal(view.score, 72);
  assert.equal(view.stars, 2);
});

test('three stars begin at 90 and a score of zero remains graded', () => {
  assert.equal(resultView({ ...base, score: 90, metrics: [{ actual: 5 }] }).stars, 3);
  assert.equal(resultView({ ...base, score: 0, metrics: [{ actual: 5 }] }).state, 'needs-work');
});

test('previous comparison selects only an earlier flight of the same scenario', () => {
  const sessions = [
    { sessionId: 'hover-old', scenario: 'hover', status: 'completed', startedAt: '2026-10-01T10:00:00Z' },
    { sessionId: 'turns', scenario: 'turns', status: 'completed', startedAt: '2026-10-15T10:00:00Z' },
    { sessionId: 'current', scenario: 'hover', status: 'completed', startedAt: '2026-10-20T10:00:00Z' },
  ];
  assert.equal(previousSession(sessions, base)?.sessionId, 'hover-old');
});

test('metric callouts use backend within-tolerance percentages', () => {
  const insight = metricInsights('hover', [
    { key: 'radar_alt', label: 'Radar Alt', withinPct: 92 },
    { key: 'ground_speed', label: 'Ground Speed', withinPct: 35 },
    { key: 'heading', label: 'Heading', withinPct: null },
  ]);
  assert.equal(insight.strongest.label, 'Radar Alt');
  assert.equal(insight.focus.label, 'Ground Speed');
});

test('breakdown displays stored contribution instead of recalculating it', () => {
  const rows = breakdownRows([{ key: 'radar_alt', label: 'Radar Alt', weight: 35, withinPct: 82, contribution: 28.7 }]);
  assert.deepEqual(rows, [{ label: 'Radar Alt', weight: '35', within: '82.0%', contribution: '28.7' }]);
});
