import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('precise browser fixes persist privately and expire when stale', async () => {
  const module = await import('./operator-location.js') as Record<string, unknown>;
  const Store = module['OperatorLocationStore'];
  assert.equal(typeof Store, 'function');

  const dataDir = mkdtempSync(join(tmpdir(), 'jarvis-location-'));
  const filePath = join(dataDir, 'operator-location.json');
  let now = 1_800_000_000_000;
  const createStore = () => new (Store as new (
    file: string,
    clock: () => number,
  ) => {
    set(location: Record<string, unknown>): void;
    get(): Record<string, unknown> | null;
    getFresh(maxAgeMs?: number): Record<string, unknown> | null;
    clear(): void;
  })(filePath, () => now);

  const first = createStore();
  first.set({
    lat: 43.641,
    lon: -79.387,
    accuracyM: 12,
    source: 'browser',
    city: 'Toronto',
    region: 'Ontario',
  });

  assert.deepEqual(first.get(), {
    lat: 43.641,
    lon: -79.387,
    accuracyM: 12,
    source: 'browser',
    city: 'Toronto',
    region: 'Ontario',
    updatedAt: now,
  });
  assert.equal(statSync(filePath).mode & 0o777, 0o600);

  const reloaded = createStore();
  assert.deepEqual(reloaded.get(), first.get());
  assert.deepEqual(reloaded.getFresh(), first.get());

  now += 31 * 60_000;
  assert.equal(reloaded.getFresh(), null);

  reloaded.clear();
  assert.equal(reloaded.get(), null);
});

test('browser location input rejects impossible coordinates and accuracy', async () => {
  const module = await import('./operator-location.js') as Record<string, unknown>;
  const parseBrowserLocation = module['parseBrowserLocation'];
  assert.equal(typeof parseBrowserLocation, 'function');

  const parse = parseBrowserLocation as (input: unknown) => Record<string, unknown> | null;
  assert.deepEqual(parse({
    lat: 43.641,
    lon: -79.387,
    accuracyM: 12.4,
    city: ' Toronto ',
    region: ' Ontario ',
  }), {
    lat: 43.641,
    lon: -79.387,
    accuracyM: 12,
    city: 'Toronto',
    region: 'Ontario',
    source: 'browser',
  });

  assert.equal(parse({ lat: 91, lon: -79 }), null);
  assert.equal(parse({ lat: 43, lon: -181 }), null);
  assert.equal(parse({ lat: 43, lon: -79 }), null);
  assert.equal(parse({ lat: 43, lon: -79, accuracyM: -1 }), null);
  assert.equal(parse({ lat: Number.NaN, lon: -79 }), null);
});

test('precise location summary exposes browser coordinates and measured accuracy', async () => {
  const module = await import('./operator-location.js') as Record<string, unknown>;
  const summarizePreciseLocation = module['summarizePreciseLocation'];
  assert.equal(typeof summarizePreciseLocation, 'function');

  const summarize = summarizePreciseLocation as (location: Record<string, unknown> | null) => Record<string, unknown> | null;
  assert.equal(summarize(null), null);
  assert.deepEqual(summarize({
    lat: 43.641,
    lon: -79.387,
    accuracyM: 12,
    source: 'browser',
    city: 'Toronto',
    region: 'Ontario',
    updatedAt: 1_800_000_000_000,
  }), {
    name: 'Toronto, Ontario',
    coordinates: '43.641000,-79.387000',
    accuracyM: 12,
    updatedAt: 1_800_000_000_000,
  });
});
