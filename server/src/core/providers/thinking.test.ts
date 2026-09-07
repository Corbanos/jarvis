import assert from 'node:assert/strict';
import test from 'node:test';

test('effort maps to adaptive thinking + output_config, clamped to what each Claude model accepts', async () => {
  const { anthropicThinkingParams } = await import('./index.js');
  assert.deepEqual(anthropicThinkingParams('claude-opus-5', 'default'), {}, 'default leaves the request untouched');
  assert.deepEqual(anthropicThinkingParams('claude-opus-5', 'xhigh'), { thinking: { type: 'adaptive' }, output_config: { effort: 'xhigh' } });
  assert.deepEqual(anthropicThinkingParams('claude-fable-5-1', 'max'), { thinking: { type: 'adaptive' }, output_config: { effort: 'max' } });
  assert.deepEqual(anthropicThinkingParams('claude-sonnet-4-6', 'xhigh'), { thinking: { type: 'adaptive' }, output_config: { effort: 'high' } }, '4.6 predates xhigh');
  assert.deepEqual(anthropicThinkingParams('claude-opus-4-6', 'max'), { thinking: { type: 'adaptive' }, output_config: { effort: 'max' } });
  assert.deepEqual(anthropicThinkingParams('claude-haiku-4-5', 'high'), {}, 'Haiku rejects the parameter');
});
