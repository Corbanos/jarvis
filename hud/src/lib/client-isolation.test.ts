import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { acceptWSEvent, getClientId } from './client-identity.js';
import { readChatStream } from './chat-stream.js';

function response(text: string, wait: number) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({ async start(controller) {
    const raw = `data: ${JSON.stringify({ type: 'token', token: text })}\n\ndata: ${JSON.stringify({ type: 'done', text })}\n\n`;
    for (const chunk of [raw.slice(0, 13), raw.slice(13, 40), raw.slice(40)]) {
      await new Promise((resolve) => setTimeout(resolve, wait));
      controller.enqueue(encoder.encode(chunk));
    }
    controller.close();
  } });
}

test('concurrent chat HTTP streams deliver speech only to their own receiver, irrespective of WS reconnect', async () => {
  const heardA: string[] = [], heardB: string[] = [];
  await Promise.all([
    readChatStream(response('Phone reply', 2), (event) => { if (event.type === 'token') heardA.push(event.token); }),
    readChatStream(response('Laptop reply', 1), (event) => { if (event.type === 'token') heardB.push(event.token); }),
  ]);
  assert.deepEqual(heardA, ['Phone reply']);
  assert.deepEqual(heardB, ['Laptop reply']);
  assert.equal(getClientId(), getClientId(), 'identity stable across reconnect calls');
  for (const type of ['thinking', 'message']) {
    assert.equal(acceptWSEvent({ type }, 'phone'), false, 'unattributed broadcasts never speak');
    assert.equal(acceptWSEvent({ type, payload: { clientId: 'phone' } }, 'phone'), false, 'even targeted WS cannot duplicate SSE audio');
  }
  assert.equal(acceptWSEvent({ type: 'worldview', payload: { clientId: 'laptop' } }, 'phone'), false);
  assert.equal(acceptWSEvent({ type: 'worldview', payload: { clientId: 'phone' } }, 'phone'), true);
});

test('interrupted streams fail explicitly, without replaying audio from another transport', async () => {
  await assert.rejects(readChatStream(new ReadableStream({ start(c) { c.close(); } }), () => {}), /interrupted/);
});

test('history, agent notifications and errors cannot autoplay; host playback is disabled', () => {
  const tts = readFileSync(new URL('../hooks/useJarvisTTS.ts', import.meta.url), 'utf8');
  assert.match(tts, /!last.speakable/);
  assert.match(tts, /currentAudioRef.current\?\.pause/);
  assert.match(tts, /if \(gen !== cancelGenRef.current\) return/);
  const voice = readFileSync(new URL('../../../server/src/modules/voice-tts.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(voice, /afplay|export async function speak\(/);
  assert.match(voice, /execFile\('say',.*'-o', out/);
  assert.match(voice, /randomUUID\(\)/);
  const status = readFileSync(new URL('../components/StatusBar/index.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(status, /Math.random|label="POWER"|label="CPU"/);
});
