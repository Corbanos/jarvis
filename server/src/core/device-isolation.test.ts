import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { setTimeout as delay } from 'node:timers/promises';
import { registerWS } from '../ws.js';
import { locationRoutes } from '../routes/location.js';
import { chatRoutes } from '../routes/chat.js';
import { requestContext } from './request-context.js';
import { getFreshLocation, clearOperatorLocation, setOperatorLocation } from './operator-location.js';
import { worldviewTool, setWorldviewBroadcast } from '../tools/worldview.js';
import { weatherTool } from '../tools/weather.js';

const a = 'client-phone-a';
const b = 'client-laptop-b';
const headers = (id: string) => ({ 'x-jarvis-client-id': id, 'x-jarvis-session-id': `session-${id}` });

test('two HTTP clients keep distinct GPS, nearby origins and request-scoped WS events under concurrency/reconnect', async (t) => {
  const app = Fastify();
  const hub = await registerWS(app);
  app.decorate('ws', hub);
  setWorldviewBroadcast((type, payload) => hub.broadcast({ type: type as never, payload, timestamp: Date.now() }));
  // Exercise the production HTTP attribution wrapper with an interleaving tool runner.
  app.decorate('jarvis', {
    async chat(_message: string, sessionId: string, onToken?: (token: string) => void) {
      const clientId = requestContext.getStore()?.clientId;
      await delay(clientId === a ? 15 : 1);
      const result = await worldviewTool.handler({ action: 'nearby', query: 'cafe', limit: 1 });
      onToken?.(`${clientId}: ${result}`);
      hub.broadcast({ type: 'thinking', payload: { token: clientId, sessionId }, timestamp: Date.now() });
      return { text: `${clientId}: ${result}`, toolCalls: [] };
    },
    getModel: () => '', setModel: () => {},
  });
  await app.register(locationRoutes);
  await app.register(chatRoutes);
  await app.ready();
  t.after(() => app.close());
  const wsA = await app.injectWS(`/ws?clientId=${a}`);
  const wsB = await app.injectWS(`/ws?clientId=${b}`);
  const eventsA: any[] = [], eventsB: any[] = [];
  wsA.on('message', (data) => eventsA.push(JSON.parse(data.toString())));
  wsB.on('message', (data) => eventsB.push(JSON.parse(data.toString())));
  t.after(() => { wsA.terminate(); wsB.terminate(); });

  const originalFetch = globalThis.fetch;
  const queries: Array<{ client?: string; query: string }> = [];
  globalThis.fetch = (async (_url, init) => {
    const client = requestContext.getStore()?.clientId;
    const query = decodeURIComponent(String(init?.body).slice(5));
    queries.push({ client, query });
    await delay(1);
    const fix = getFreshLocation()!;
    return new Response(JSON.stringify({ elements: [{ lat: fix.lat + 0.001, lon: fix.lon, tags: { name: `${client} Cafe` } }] }));
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; clearOperatorLocation(a); clearOperatorLocation(b); });

  for (const [id, lat, lon] of [[a, 43.65, -79.38], [b, 49.28, -123.12]] as const) {
    const pushed = await app.inject({ method: 'POST', url: '/api/location', headers: headers(id), payload: { lat, lon, accuracyM: 8 } });
    assert.equal(pushed.statusCode, 200);
    assert.equal(pushed.json().location.lat, lat);
  }
  assert.equal((await app.inject({ url: '/api/location' })).statusCode, 400);
  assert.equal((await app.inject({ url: '/api/location', headers: headers('unknown-device') })).json().location, null);
  assert.equal((await app.inject({ url: '/api/location', headers: headers(a) })).json().location.lat, 43.65);
  assert.equal((await app.inject({ url: '/api/location', headers: headers(b) })).json().location.lat, 49.28);

  const [replyA, replyB] = await Promise.all([a, b].map((id) => app.inject({ method: 'POST', url: '/api/chat', headers: headers(id), payload: { message: 'nearest cafe', sessionId: 'default' } })));
  await delay(20);
  assert.match(replyA.body, /client-phone-a Cafe/);
  assert.doesNotMatch(replyA.body, /client-laptop-b/);
  assert.match(replyB.body, /client-laptop-b Cafe/);
  assert.doesNotMatch(replyB.body, /client-phone-a/);
  for (const { client, query } of queries) {
    assert.ok(query.includes(client === a ? ',43.65,-79.38)' : ',49.28,-123.12)'));
  }
  for (const [id, events] of [[a, eventsA], [b, eventsB]] as const) {
    const scoped = events.filter((e) => e.type === 'worldview' || e.type === 'thinking');
    assert.ok(scoped.length >= 3);
    assert.ok(scoped.every((e) => e.payload.clientId === id && e.payload.requestId));
    const pin = scoped.find((e) => e.payload.action === 'pins').payload.pins[0];
    assert.equal(pin.lat, id === a ? 43.65 : 49.28);
  }
  wsA.terminate();
  const reconnect = await app.injectWS(`/ws?clientId=${a}`);
  t.after(() => reconnect.terminate());
  const reconnected: any[] = [];
  reconnect.on('message', (data) => reconnected.push(JSON.parse(data.toString())));
  requestContext.run({ clientId: a, requestId: 'reconnected-request' }, () => hub.broadcast({ type: 'dismiss', payload: {}, timestamp: Date.now() }));
  await delay(10);
  assert.equal(reconnected.filter((e) => e.type === 'dismiss').length, 1);
  assert.equal(eventsB.filter((e) => e.type === 'dismiss').length, 0);
  // Background/scheduler output cannot become blanket autoplay on any client.
  hub.broadcast({ type: 'message', payload: { text: 'background' }, timestamp: Date.now() });
  await delay(10);
  assert.ok(!eventsB.some((e) => e.payload.text === 'background'));
  await app.inject({ method: 'DELETE', url: '/api/location', headers: headers(a) });
  assert.equal((await app.inject({ url: '/api/location', headers: headers(a) })).json().location, null);
  assert.equal((await app.inject({ url: '/api/location', headers: headers(b) })).json().location.lat, 49.28);
});

test('unattributed, expired and denied fixes never use host IP, legacy global GPS or another client', async () => {
  setWorldviewBroadcast(() => {});
  setOperatorLocation({ lat: 10, lon: 20, accuracyM: 1, source: 'browser' }, b);
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('No IP/network fallback allowed'); };
  try {
    assert.equal(getFreshLocation(), null);
    await requestContext.run({ clientId: a }, async () => {
      assert.match(await worldviewTool.handler({ action: 'where-am-i' }), /unavailable/);
      assert.match(await worldviewTool.handler({ action: 'nearby', query: 'cafe' }), /No host-IP/);
      assert.match(await worldviewTool.handler({ action: 'flights-near' }), /no host-IP/);
      assert.match(await weatherTool.handler({}), /No host-IP/);
      setOperatorLocation({ lat: 1, lon: 2, accuracyM: 1, source: 'browser' });
      assert.equal(getFreshLocation(-1), null, 'expired fix rejected');
      clearOperatorLocation();
    });
  } finally { globalThis.fetch = original; clearOperatorLocation(b); }
});
