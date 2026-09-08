import assert from 'node:assert/strict';
import test from 'node:test';
import { isStaleBuild } from './BuildWatcher.js';

test('a page only counts as stale against a different, known build id', () => {
  assert.equal(isStaleBuild('abc', 'xyz'), true, 'server moved to a new build');
  assert.equal(isStaleBuild('abc', 'abc'), false, 'same build — never reload');
  // The bug this replaced: an unknown id on either side must never trigger a
  // reload, or every window focus reloads the tab.
  assert.equal(isStaleBuild('', 'xyz'), false);
  assert.equal(isStaleBuild('abc', ''), false);
  assert.equal(isStaleBuild('', ''), false);
});
