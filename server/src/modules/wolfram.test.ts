import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Run from a scratch cwd with no .env, so the on-demand .env re-read finds nothing.
process.chdir(mkdtempSync(join(tmpdir(), 'jarvis-wolfram-')));
delete process.env['WOLFRAM_APP_ID'];

/** A realistic Full Results payload: input interpretation, primary result, a plot. */
const FIXTURE = {
  queryresult: {
    success: true,
    error: false,
    timing: 1.23,
    pods: [
      { title: 'Input interpretation', id: 'Input', subpods: [{ plaintext: 'integral x^2 sin(x) dx', img: { src: 'https://w.example/in.png', alt: 'in', width: 200, height: 20 } }] },
      { title: 'Indefinite integral', id: 'IndefiniteIntegral', primary: true, subpods: [{ plaintext: '(2 - x^2) cos(x) + 2 x sin(x) + constant', img: { src: 'https://w.example/res.png', alt: 'res', width: 300, height: 30 } }] },
      { title: 'Plots of the integral', id: 'Plot', subpods: [{ plaintext: '', img: { src: 'https://w.example/plot.png', alt: 'plot', width: 400, height: 220 } }] },
      { title: 'Broken', id: 'Bad', error: true, subpods: [] },
    ],
    assumptions: { type: 'Clash', word: 'x', values: [{ desc: 'a variable' }] },
  },
};

const fakeResponse = (status: number, body: unknown, json = true) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: String(status),
  text: async () => (json ? JSON.stringify(body) : String(body)),
  json: async () => body,
}) as unknown as Response;

test('full results normalise into interpretation, primary, pods, assumptions', async () => {
  const { normalizeFullResult } = await import('./wolfram.js');
  const r = normalizeFullResult('integrate x^2 sin x', FIXTURE);

  assert.equal(r.success, true);
  assert.equal(r.interpretation, 'integral x^2 sin(x) dx');
  assert.equal(r.primary, '(2 - x^2) cos(x) + 2 x sin(x) + constant');
  // The errored pod is dropped; the rest keep order and flags.
  assert.deepEqual(r.pods.map((p) => [p.title, p.primary]), [
    ['Input interpretation', false], ['Indefinite integral', true], ['Plots of the integral', false],
  ]);
  assert.deepEqual(r.pods[2]!.subpods[0]!.image, { src: 'https://w.example/plot.png', alt: 'plot', width: 400, height: 220 });
  assert.deepEqual(r.assumptions, ['"x" taken as a variable']);
  assert.equal(r.timing, 1.23);
});

test('a rejected AppID surfaces as an error, not an empty result', async () => {
  const { normalizeFullResult } = await import('./wolfram.js');
  const r = normalizeFullResult('2+2', { queryresult: { success: false, error: { code: '1', msg: 'Invalid appid' } } });
  assert.equal(r.success, false);
  assert.match(r.error ?? '', /Invalid appid/);
});

test('an ununderstood query offers the suggestions Wolfram sent back', async () => {
  const { normalizeFullResult } = await import('./wolfram.js');
  const r = normalizeFullResult('flurb', { queryresult: { success: false, error: false, pods: [], didyoumeans: [{ val: 'flour' }, { val: 'flub' }] } });
  assert.equal(r.success, false);
  assert.deepEqual(r.didYouMean, ['flour', 'flub']);
  assert.match(r.error ?? '', /Did you mean: flour, flub/);
});

test('text endpoints map Wolfram status codes to actionable messages', async () => {
  const { shortAnswer } = await import('./wolfram.js');
  const withStatus = (status: number) => shortAnswer('x', { appId: 'TEST-KEY', fetch: (async () => fakeResponse(status, 'body', false)) as typeof fetch });

  assert.match((await withStatus(501)).error ?? '', /didn't understand/);
  assert.match((await withStatus(403)).error ?? '', /AppID/);
  assert.match((await withStatus(401)).error ?? '', /AppID/, 'live Wolfram sends 401 for a bad key');
  assert.match((await withStatus(429)).error ?? '', /rate limit/i);
  const ok = await shortAnswer('2+2', { appId: 'TEST-KEY', fetch: (async () => fakeResponse(200, '4', false)) as typeof fetch });
  assert.deepEqual(ok, { ok: true, text: '4' });
});

test('requests carry the AppID and never leak it into the result', async () => {
  const { queryFull } = await import('./wolfram.js');
  let url = '';
  const r = await queryFull('2+2', {
    appId: 'SECRET-123',
    fetch: (async (u: string | URL | Request) => { url = String(u); return fakeResponse(200, FIXTURE); }) as typeof fetch,
  });
  assert.match(url, /appid=SECRET-123/);
  assert.match(url, /output=json/);
  assert.equal(JSON.stringify(r).includes('SECRET-123'), false);
});

test('the tool explains itself when no key is set, instead of erroring', async () => {
  const { wolframTool } = await import('../tools/wolfram.js');
  const { isConfigured } = await import('./wolfram.js');
  assert.equal(isConfigured(), false);
  const out = await wolframTool.handler({ query: '2+2' });
  assert.match(out, /not configured/i);
  assert.match(out, /WOLFRAM_APP_ID/);
});

test('the key comes from the environment, and an added .env line is picked up without a restart', async () => {
  const { getAppId } = await import('./wolfram.js');
  const { writeFileSync, unlinkSync } = await import('node:fs');
  assert.equal(getAppId(), null);

  // Operator adds the line to .env while the server is running.
  writeFileSync('.env', 'WOLFRAM_APP_ID=FROM-DOTENV\n');
  try {
    assert.equal(getAppId(), 'FROM-DOTENV');
  } finally {
    unlinkSync('.env');
    delete process.env['WOLFRAM_APP_ID'];
  }

  process.env['WOLFRAM_APP_ID'] = 'ENV-KEY';
  assert.equal(getAppId(), 'ENV-KEY');
  delete process.env['WOLFRAM_APP_ID'];
});

test('the compute path pushes a card and module to the HUD and returns model-ready text', async () => {
  const wolfram = await import('./wolfram.js');
  const { wolframTool, setWolframBroadcast } = await import('../tools/wolfram.js');

  process.env['WOLFRAM_APP_ID'] = 'TEST-KEY';
  wolfram._setFetchForTests((async (u: string | URL | Request) => {
    const url = String(u);
    if (url.includes('llm-api')) return fakeResponse(200, 'The integral is (2 - x^2) cos(x) + 2 x sin(x) + C.', false);
    return fakeResponse(200, FIXTURE);
  }) as typeof fetch);

  const cards: Array<[string, Record<string, unknown>]> = [];
  const modules: Array<[string, Record<string, unknown>]> = [];
  setWolframBroadcast((t, d) => cards.push([t, d]), (e, p) => modules.push([e, p]));

  try {
    const out = await wolframTool.handler({ query: 'integrate x^2 sin x' });
    assert.match(out, /The integral is/);
    assert.equal(cards.length, 1);
    assert.equal(cards[0]![0], 'wolfram');
    assert.equal((cards[0]![1] as { primary: string }).primary, '(2 - x^2) cos(x) + 2 x sin(x) + constant');
    assert.deepEqual(modules[0]![1]['type'], 'wolfram');
    assert.equal(modules[0]![1]['action'], 'open');
  } finally {
    wolfram._setFetchForTests(null);
    delete process.env['WOLFRAM_APP_ID'];
    setWolframBroadcast(null, null);
  }
});
