import { test } from 'node:test';
import assert from 'node:assert/strict';
import { binomialP, wilson } from '../src/series.js';

test('the series statistics are the textbook ones', () => {
  // 7 of 10 against a fair coin: two-sided exact p = 0.34375.
  assert.ok(Math.abs(binomialP(7, 10) - 0.34375) < 1e-9);
  assert.ok(Math.abs(binomialP(10, 10) - 2 / 1024) < 1e-12);
  assert.equal(binomialP(5, 10), 1);
  // Wilson 95% interval for 7/10 is about 0.397–0.892.
  const [lo, hi] = wilson(7, 10);
  assert.ok(Math.abs(lo - 0.3968) < 1e-3 && Math.abs(hi - 0.8922) < 1e-3, `${lo} ${hi}`);
});
