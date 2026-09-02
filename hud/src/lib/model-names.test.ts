import assert from 'node:assert/strict';
import test from 'node:test';
import { formatModelName } from './model-names.js';

test('claude ids become tier + version labels', () => {
  assert.equal(formatModelName('claude-opus-5'), 'Opus 5');
  assert.equal(formatModelName('claude-fable-5-1'), 'Fable 5.1');
  assert.equal(formatModelName('claude-opus-4-8'), 'Opus 4.8');
  assert.equal(formatModelName('claude-sonnet-4-6'), 'Sonnet 4.6');
  assert.equal(formatModelName('claude-haiku-4-5'), 'Haiku 4.5');
});

test('a dated snapshot suffix is dropped from the label', () => {
  assert.equal(formatModelName('claude-haiku-4-5-20251001'), 'Haiku 4.5');
});

test('non-claude ids pass through untouched', () => {
  assert.equal(formatModelName('qwen3:8b'), 'qwen3:8b');
  assert.equal(formatModelName('llama3.1:70b'), 'llama3.1:70b');
  assert.equal(formatModelName(''), '');
});
