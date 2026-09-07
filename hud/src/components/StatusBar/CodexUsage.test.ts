import assert from 'node:assert/strict';
import test from 'node:test';
import { countdown } from './CodexUsage.js';

test('reset countdowns read at a glance', () => {
  assert.equal(countdown(6392 * 1000), '1h 46m');
  assert.equal(countdown(558052 * 1000), '6d 11h');
  assert.equal(countdown(12 * 60 * 1000), '12m');
  assert.equal(countdown(30 * 1000), 'now');
  assert.equal(countdown(-5000), 'now', 'a window that already reset');
});
