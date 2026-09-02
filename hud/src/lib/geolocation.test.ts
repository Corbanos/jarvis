import assert from 'node:assert/strict';
import test from 'node:test';

test('location publishing sends first, improved, and periodic fixes', async () => {
  let module: Record<string, unknown> = {};
  try {
    module = await import('./geolocation.js') as Record<string, unknown>;
  } catch { /* module does not exist before the feature is implemented */ }
  const shouldPublishLocationFix = module['shouldPublishLocationFix'];
  assert.equal(typeof shouldPublishLocationFix, 'function');

  const shouldPublish = shouldPublishLocationFix as (
    previous: { accuracyM: number; sentAt: number } | null,
    nextAccuracyM: number,
    now: number,
  ) => boolean;

  assert.equal(shouldPublish(null, 80, 1_000), true);
  assert.equal(shouldPublish({ accuracyM: 80, sentAt: 1_000 }, 40, 2_000), true);
  assert.equal(shouldPublish({ accuracyM: 40, sentAt: 1_000 }, 70, 20_000), false);
  assert.equal(shouldPublish({ accuracyM: 40, sentAt: 1_000 }, 70, 61_000), true);
});

test('an insecure LAN page upgrades to https on the bare hostname', async () => {
  const g = globalThis as Record<string, unknown>;
  const saved = g['window'];
  try {
    // Reached on the HUD's dev port over http — TLS is only on the front door's 443.
    g['window'] = {
      isSecureContext: false,
      location: { hostname: 'jarvis.local', pathname: '/', search: '?x=1', hash: '#h' },
    };
    const { secureUpgradeUrl } = await import('./geolocation.js');
    assert.equal(secureUpgradeUrl(), 'https://jarvis.local/?x=1#h');

    g['window'] = { isSecureContext: true, location: { hostname: 'jarvis.local', pathname: '/', search: '', hash: '' } };
    assert.equal(secureUpgradeUrl(), null, 'already secure — nothing to upgrade to');
  } finally {
    if (saved === undefined) delete g['window']; else g['window'] = saved;
  }
});
