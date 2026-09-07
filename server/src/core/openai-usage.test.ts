import assert from 'node:assert/strict';
import test from 'node:test';

// The payload shape observed live from the Codex backend on 2026-09-07.
const RAW = {
  user_id: 'user-x', account_id: 'acct', email: 'op@example.com', plan_type: 'team',
  rate_limit: {
    allowed: false, limit_reached: true,
    primary_window: { used_percent: 100, limit_window_seconds: 18000, reset_after_seconds: 6392, reset_at: 1788813069 },
    secondary_window: { used_percent: 32, limit_window_seconds: 604800, reset_after_seconds: 558052, reset_at: 1789364729 },
  },
  model_usage: { 'gpt-6-astra': { available: false, available_at: '2026-09-07T20:31:09.796521Z', credits_would_enable: true } },
  credits: { has_credits: false, unlimited: false, balance: null },
};

test('the usage payload normalises into two labelled windows, model availability, and credits', async () => {
  const { normalizeUsage } = await import('./openai-usage.js');
  const u = normalizeUsage(RAW, 1788806677000);
  assert.equal(u.plan, 'team');
  assert.equal(u.limitReached, true);
  assert.equal(u.allowed, false);
  assert.deepEqual(u.primary, { usedPercent: 100, windowSeconds: 18000, resetAt: 1788813069000, resetAfterSeconds: 6392, label: '5H' });
  assert.equal(u.secondary?.label, 'WEEK');
  assert.equal(u.secondary?.usedPercent, 32);
  assert.deepEqual(u.models['gpt-6-astra'], { available: false, availableAt: Date.parse('2026-09-07T20:31:09.796521Z') });
  assert.deepEqual(u.credits, { hasCredits: false, unlimited: false, balance: null });
});

test('window labels read the way the Codex CLI names them', async () => {
  const { windowLabel } = await import('./openai-usage.js');
  assert.equal(windowLabel(18000), '5H');
  assert.equal(windowLabel(604800), 'WEEK');
  assert.equal(windowLabel(3 * 86400), '3D');
  assert.equal(windowLabel(1800), '1H');
});

test('missing windows and odd values degrade gracefully', async () => {
  const { normalizeUsage } = await import('./openai-usage.js');
  const u = normalizeUsage({ plan_type: 'plus', rate_limit: { allowed: true, primary_window: { used_percent: 140.7, limit_window_seconds: 18000 } } }, 1000000);
  assert.equal(u.primary?.usedPercent, 100, 'clamped');
  assert.equal(u.secondary, null);
  assert.equal(u.limitReached, false);
  assert.deepEqual(u.models, {});
});
