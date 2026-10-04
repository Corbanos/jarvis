import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bc from './browser-control.js';
import { streamStats } from './browser-stream.js';

test('the virtual cursor is recorded and clamped to the viewport', () => {
  const vp = bc.getViewport();
  bc.recordCursor(120, 240);
  assert.deepEqual({ x: bc.getCursor().x, y: bc.getCursor().y }, { x: 120, y: 240 });

  // An element measured mid-navigation can report a box above the fold; the
  // HUD reticle must never leave the frame.
  bc.recordCursor(-40, -975);
  assert.deepEqual({ x: bc.getCursor().x, y: bc.getCursor().y }, { x: 0, y: 0 });
  bc.recordCursor(99999, 99999);
  assert.deepEqual({ x: bc.getCursor().x, y: bc.getCursor().y }, { x: vp.width, y: vp.height });

  assert.equal(bc.getCursor().lastClickAt, 0);
  bc.recordCursor(10, 10, true);
  assert.ok(Date.now() - bc.getCursor().lastClickAt < 1000);
});

test('with no browser launched the stream reports no session rather than throwing', () => {
  assert.equal(bc.getActivePage(), null);
  assert.equal(bc.isRunning(), false);
  assert.deepEqual(streamStats(), { subscribers: 0, attached: false, url: '' });
});

test('active-page subscribers can unsubscribe', () => {
  let calls = 0;
  const off = bc.onActivePageChange(() => { calls += 1; });
  off();
  assert.equal(calls, 0);
});
