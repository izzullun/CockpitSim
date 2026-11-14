import { flightGrade, passText } from '../../shared/js/flight-grade.js';
import assert from 'node:assert/strict';
import test from 'node:test';

test('raw scores use exact grade boundaries independently of pass status', () => {
  const cases = [[null, null], [0, 'F'], [40, 'F'], [40.01, 'D'], [54.99, 'D'],
    [55, 'C'], [64.99, 'C'], [65, 'B'], [79.99, 'B'], [80, 'A'], [94.99, 'A'], [95, 'S'], [100, 'S']];
  for (const [score, grade] of cases) assert.equal(flightGrade(score), grade);
  assert.equal(flightGrade(68), flightGrade(72));
  assert.equal(passText(68), 'Below pass mark');
  assert.equal(passText(69.99), 'Below pass mark');
  assert.equal(passText(70), 'Passed');
});
