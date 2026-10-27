import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

process.env.TZ = 'Asia/Kuala_Lumpur';
const api = vm.createContext({ window: { location: { port: '5247', origin: 'http://localhost:5247' } } });
vm.runInContext(readFileSync(new URL('../api.js', import.meta.url), 'utf8'), api);

test('trainer session date shows the local calendar date and time', () => {
  assert.equal(vm.runInContext('formatSessionDateTime("2026-10-27T16:04:00")', api),
    '28 Oct 2026, 00:04');
});

test('trainer session date preserves explicit offsets', () => {
  assert.equal(vm.runInContext('formatSessionDateTime("2026-10-28T00:04:00+08:00")', api),
    '28 Oct 2026, 00:04');
});

test('missing or invalid trainer session dates show an empty value', () => {
  assert.equal(vm.runInContext('formatSessionDateTime(null)', api), '—');
  assert.equal(vm.runInContext('formatSessionDateTime("invalid")', api), '—');
});
