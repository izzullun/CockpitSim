import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('returning to a live trainee restores their name after viewing an inactive trainee', async () => {
  const elements = new Map();
  const context = vm.createContext({
    requireRole: () => ({ username: 'trainer' }),
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, { textContent: '', classList: { remove() {}, add() {} } });
        return elements.get(id);
      },
      addEventListener() {},
    },
    parseDbDate: (value) => new Date(value),
    formatSessionDateTime: (value) => value,
    apiRequest: async () => ({ ok: true, data: { status: 'in_progress', metrics: [], warnings: [] } }),
    clearInterval() {},
    console,
  });
  const source = readFileSync(new URL('../trainer-dashboard.js', import.meta.url), 'utf8');
  // Expose the real polling code inside its role guard; no page startup or timers needed.
  const end = source.lastIndexOf('}');
  vm.runInContext(source.slice(0, end) + `
    TRAINTEES = [{ id: 'aisyah', fullName: 'Aisyah Humaira' }, { id: 'adam', fullName: 'Adam Haikal' }];
    QUEUE = [{ traineeId: 'aisyah', sessionId: 'live-aisyah', status: 'in_progress', startedAt: '2026-10-28T14:41:27Z' }];
    renderLiveMetrics = () => {};
    renderLiveWarnings = () => {};
    liveSubmetaText = () => '';
    globalThis.monitor = { async select(id) { selectedTraineeId = id; await pollLiveOnce(); } };
  ` + source.slice(end), context);

  await context.monitor.select('aisyah');
  assert.equal(elements.get('live-trainee-name').textContent, 'Aisyah Humaira');
  await context.monitor.select('adam');
  assert.equal(elements.get('live-trainee-name').textContent, 'Adam Haikal');
  await context.monitor.select('aisyah');
  assert.equal(elements.get('live-trainee-name').textContent, 'Aisyah Humaira');
});
