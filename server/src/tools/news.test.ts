import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseNewsFeed, retrieveNews } from './news.js';
import { isQuickRetrieval, QUICK_RETRIEVAL_POLICY } from '../core/retrieval-policy.js';
import { requestContext } from '../core/request-context.js';
import { toolRegistry } from '../core/tool-registry.js';
import { spawnAgentTool } from './spawn-agent.js';
const item = (date: string, link = 'https://example.org/story') => `<item><title><![CDATA[Test &amp; headline]]></title><link>${link}</link><pubDate>${date}</pubDate><source url="https://example.org">Test Wire</source></item>`;

/** Locate a repo source file without import.meta (server compiles to CommonJS). */
function readSource(relative: string): string {
  for (const base of ['.', '..', 'server', '../server']) {
    const candidate = resolve(process.cwd(), base, relative);
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
  }
  throw new Error(`Could not locate ${relative} from ${process.cwd()}`);
}

test('quick news policy overrides one-tool-only delegation; dispatch forbids spawn for short retrieval', async () => {
  for (const prompt of ['latest news please', 'find today’s Toronto headlines', 'write a short news summary', 'what is the weather?', 'current events']) assert.equal(isQuickRetrieval(prompt), true);
  for (const prompt of ['build a news app', 'debug weather GPS', 'comprehensive news research report', 'install dependencies']) assert.equal(isQuickRetrieval(prompt), false);
  assert.match(QUICK_RETRIEVAL_POLICY, /number of calls is NOT/);
  assert.doesNotMatch(spawnAgentTool.description, /Anything beyond a one-tool-call|ANY multi-step research/);
  const promptSource = readSource('src/core/jarvis.ts');
  assert.match(promptSource, /return out \+ '\\n' \+ QUICK_RETRIEVAL_POLICY/);
  assert.match(promptSource, /inlineRetrieval.*tool\.name !== 'spawn_agent'/);
  assert.match(await requestContext.run({ inlineRetrieval: true }, () => toolRegistry.dispatch('spawn_agent', { goal: 'news' })), /must be retrieved inline/);
});

test('RSS exposes genuine source dates/links, rejects stale, undated, future and unsafe entries', () => {
  const now = Date.now();
  const xml = `<rss><channel>${item(new Date(now - 3600_000).toUTCString())}${item('bad')}${item(new Date(now - 72 * 3600_000).toUTCString())}${item(new Date(now + 3600_000).toUTCString())}${item(new Date(now).toUTCString(), 'javascript:alert(1)')}</channel></rss>`;
  const entries = parseNewsFeed(xml, 'Fallback', now);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.source, 'Test Wire');
  assert.equal(entries[0]?.url, 'https://example.org/story');
  assert.ok(entries[0]?.publishedAt);
});

test('retrieval works without browser/agent and reports failed feeds honestly', async () => {
  const data = await retrieveNews('Toronto', 3, (async () => new Response(`<rss><channel>${item(new Date().toUTCString())}</channel></rss>`)) as typeof fetch);
  assert.equal(data.items.length, 1);
  assert.equal(data.errors.length, 0);
  const failed = await retrieveNews('', 5, (async () => new Response('Unavailable', { status: 503 })) as typeof fetch);
  assert.equal(failed.items.length, 0);
  assert.equal(failed.errors.length, 2);
  assert.match(failed.evidence, /not independently verified/);
});
