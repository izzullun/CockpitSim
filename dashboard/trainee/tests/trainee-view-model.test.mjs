import test from 'node:test';
import assert from 'node:assert/strict';
import { historyEntries, profileStats, missionFromHistory, livePresentation } from '../trainee-view-model.js';

test('empty history does not invent an assigned or scheduled session', () => {
  const mission = missionFromHistory({ sessionDurationMinutes: null }, []);
  assert.equal(mission.scenario, 'hover');
  assert.equal(mission.scheduled, null);
  assert.equal(mission.trainerNote, null);
  assert.equal(mission.timeLimitMinutes, null);
});

test('history labels completion without claiming it passed', () => {
  const rows = historyEntries([
    { sessionId: 'a', scenario: 'hover', status: 'completed', attempt: 2,
      startedAt: '2026-10-20T10:00:00Z', endedAt: '2026-10-20T10:20:00Z' },
  ]);
  assert.equal(rows[0].outcome, 'Completed');
  assert.equal(rows[0].durationMinutes, 20);
  assert.equal(rows[0].canOpenReport, true);
});

test('profile totals only use API session timestamps', () => {
  const stats = profileStats([
    { startedAt: '2026-10-20T10:00:00Z', endedAt: '2026-10-20T10:20:00Z' },
    { startedAt: '2026-10-21T10:00:00Z', endedAt: '2026-10-21T10:10:00Z' },
    { startedAt: '2026-10-22T10:00:00Z', endedAt: null },
  ]);
  assert.deepEqual(stats, { sessionsFlown: 3, totalFlightMinutes: 30 });
});

test('live setup warning stays friendly for trainees', () => {
  const view = livePresentation({
    metrics: [], warnings: ['InfluxDB not configured — INFLUX_TOKEN missing.'],
  });
  assert.equal(view.state, 'waiting');
  assert.equal(view.message, 'Waiting for the simulator…');
  assert.equal(view.showTechnicalDetail, false);
});

test('live status distinguishes breach from waiting and on track', () => {
  assert.equal(livePresentation({ metrics: [{ withinTol: true }], warnings: [] }).state, 'on-track');
  assert.equal(livePresentation({ metrics: [{ withinTol: false }], warnings: [] }).state, 'check');
  assert.equal(livePresentation({ metrics: [{ withinTol: null }], warnings: [] }).state, 'waiting');
});
