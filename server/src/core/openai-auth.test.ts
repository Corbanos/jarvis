import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** A structurally valid JWT; nothing here verifies signatures. */
const jwt = (claims: Record<string, unknown>) => `${b64url({ alg: 'RS256' })}.${b64url(claims)}.sig`;
const NOW = Math.floor(Date.now() / 1000);

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'jarvis-openai-auth-'));
  process.env['HOME'] = home;
  delete process.env['OPENAI_API_KEY'];
  return home;
}

function writeCodexFixture(home: string, exp = NOW + 3600) {
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(join(home, '.codex', 'auth.json'), JSON.stringify({
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      id_token: jwt({ email: 'hayden@example.com', 'https://api.openai.com/auth': { chatgpt_account_id: 'acct_ABCDEF123', chatgpt_plan_type: 'pro' } }),
      access_token: jwt({ exp, sub: 'u' }),
      refresh_token: 'rt-original',
      account_id: 'acct_ABCDEF123',
    },
    last_refresh: '2026-09-02T04:15:31Z',
  }));
}

const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('id_token claims are read from the namespaced paths the Codex CLI uses', async () => {
  const a = await import('./openai-auth.js');
  const id = jwt({ email: 'x@y.z', 'https://api.openai.com/auth': { chatgpt_account_id: 'acct_1', chatgpt_plan_type: 'plus' } });
  assert.equal(a.accountIdFromIdToken(id), 'acct_1');
  assert.equal(a.emailFromIdToken(id), 'x@y.z');
  assert.equal(a.planFromIdToken(id), 'plus');
  assert.equal(a.jwtExp(jwt({ exp: 123 })), 123);
  assert.equal(a.decodeJwt('not-a-jwt'), null);
});

test('an existing Codex CLI login is imported on first use and stored privately', async () => {
  const home = freshHome();
  writeCodexFixture(home);
  const a = await import('./openai-auth.js');

  assert.equal(a.codexLoginAvailable(), true);
  const t = a.getOAuthTokens();
  assert.equal(t?.accountId, 'acct_ABCDEF123');
  assert.equal(t?.refreshToken, 'rt-original');

  const stored = join(home, '.jarvis', 'openai-auth.json');
  assert.ok(existsSync(stored), 'copied into the Jarvis store');
  assert.equal(statSync(stored).mode & 0o777, 0o600, 'tokens are owner-readable only');

  const s = a.getAuthStatus();
  assert.equal(s.configured, true);
  assert.equal(s.source, 'chatgpt');
  assert.equal(s.email, 'hayden@example.com');
  assert.equal(s.plan, 'pro');
  assert.equal(s.importedFrom, 'codex');
  assert.equal(s.accountIdPreview, 'acct_A…');
});

test('an expiring access token is refreshed with the Codex client id and persisted', async () => {
  const home = freshHome();
  writeCodexFixture(home, NOW + 10); // inside the refresh skew
  const a = await import('./openai-auth.js');

  const calls: Array<{ url: string; body: Record<string, string> }> = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, string>;
    calls.push({ url: String(url), body });
    return jsonResponse(200, { access_token: jwt({ exp: NOW + 3600 }), refresh_token: 'rt-rotated', id_token: jwt({ email: 'hayden@example.com' }) });
  }) as typeof fetch;

  const r = await a.getValidAccessToken(fakeFetch);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, 'https://auth.openai.com/oauth/token');
  assert.equal(calls[0]!.body['grant_type'], 'refresh_token');
  assert.equal(calls[0]!.body['refresh_token'], 'rt-original');
  assert.equal(calls[0]!.body['client_id'], a.OPENAI_CLIENT_ID);
  assert.deepEqual(Object.keys(calls[0]!.body).sort(), ['client_id', 'grant_type', 'refresh_token'], 'exactly the fields the Codex CLI sends');
  assert.equal(r?.accountId, 'acct_ABCDEF123');

  const persisted = JSON.parse(readFileSync(join(home, '.jarvis', 'openai-auth.json'), 'utf-8')) as { tokens: { refreshToken: string }; importedFrom?: string };
  assert.equal(persisted.tokens.refreshToken, 'rt-rotated', 'rotated refresh token saved');
  assert.equal(persisted.importedFrom, 'codex', 'provenance kept across refreshes');

  // Fresh now — no second refresh.
  await a.getValidAccessToken(fakeFetch);
  assert.equal(calls.length, 1);
});

test('sign-in: PKCE authorize URL, real callback server, code exchange, status', async () => {
  freshHome();
  const a = await import('./openai-auth.js');

  const exchanges: Array<Record<string, string>> = [];
  const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    assert.equal((init?.headers as Record<string, string>)['Content-Type'], 'application/x-www-form-urlencoded', 'code exchange is a form post');
    exchanges.push(Object.fromEntries(new URLSearchParams(String(init?.body))));
    return jsonResponse(200, {
      id_token: jwt({ email: 'new@example.com', 'https://api.openai.com/auth': { chatgpt_account_id: 'acct_NEW' } }),
      access_token: jwt({ exp: NOW + 3600 }),
      refresh_token: 'rt-new',
    });
  }) as typeof fetch;

  const start = await a.startLogin({ ports: [0], fetch: fakeFetch });
  assert.equal(start.listening, true);
  const u = new URL(start.url);
  assert.equal(u.origin + u.pathname, 'https://auth.openai.com/oauth/authorize');
  assert.equal(u.searchParams.get('client_id'), a.OPENAI_CLIENT_ID);
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.match(u.searchParams.get('scope') ?? '', /offline_access/);
  assert.equal(u.searchParams.get('redirect_uri'), start.redirectUri);
  assert.match(start.redirectUri, /^http:\/\/localhost:\d+\/auth\/callback$/);
  assert.equal(u.searchParams.get('originator'), 'codex_cli_rs');
  const state = u.searchParams.get('state')!;
  assert.deepEqual(a.loginStatus(), { pending: true, done: false, error: null });

  // The browser redirect, exactly as the IdP would issue it.
  const cb = await fetch(`${start.redirectUri}?code=the-code&state=${encodeURIComponent(state)}`);
  assert.equal(cb.status, 200);
  assert.match(await cb.text(), /SIGNED IN/);

  assert.equal(exchanges.length, 1);
  assert.equal(exchanges[0]!['grant_type'], 'authorization_code');
  assert.equal(exchanges[0]!['code'], 'the-code');
  assert.equal(exchanges[0]!['redirect_uri'], start.redirectUri);
  assert.ok(exchanges[0]!['code_verifier'], 'PKCE verifier sent');

  assert.deepEqual(a.loginStatus(), { pending: false, done: true, error: null });
  const s = a.getAuthStatus();
  assert.equal(s.source, 'chatgpt');
  assert.equal(s.email, 'new@example.com');
  assert.equal(s.accountIdPreview, 'acct_N…');
  assert.equal(s.importedFrom, null, 'a fresh sign-in is not marked as imported');
});

test('paste-back rejects a URL from a different attempt and surfaces IdP errors', async () => {
  freshHome();
  const a = await import('./openai-auth.js');
  const start = await a.startLogin({ ports: [0] });
  const wrong = await a.completeLoginFromUrl(`${start.redirectUri}?code=x&state=not-ours`);
  assert.equal(wrong.ok, false);
  assert.match(wrong.error ?? '', /State mismatch/);

  const denied = await a.completeLoginFromUrl(`${start.redirectUri}?error=access_denied&error_description=User%20cancelled`);
  assert.equal(denied.ok, false);
  assert.match(denied.error ?? '', /cancelled/);
  assert.equal(a.loginStatus().pending, false);
});

test('sign out clears the store; an API key is the fallback auth', async () => {
  const home = freshHome();
  writeCodexFixture(home);
  const a = await import('./openai-auth.js');
  assert.equal(a.getAuthStatus().source, 'chatgpt');

  a.signOut();
  // The Codex file still exists, but signing out means "stop using it" — so
  // remove the fixture to represent an operator who also logged out of Codex.
  writeFileSync(join(home, '.codex', 'auth.json'), '{}');
  assert.equal(a.isConfigured(), false);

  process.env['OPENAI_API_KEY'] = 'sk-test';
  const s = a.getAuthStatus();
  assert.equal(s.source, 'apikey');
  const auth = await a.resolveRequestAuth();
  assert.equal(auth.baseUrl, 'https://api.openai.com/v1');
  assert.equal(auth.headers['Authorization'], 'Bearer sk-test');
  delete process.env['OPENAI_API_KEY'];
});

test('ChatGPT requests carry the account id and originator the Codex backend expects', async () => {
  const home = freshHome();
  writeCodexFixture(home);
  const a = await import('./openai-auth.js');
  const auth = await a.resolveRequestAuth();
  assert.equal(auth.source, 'chatgpt');
  assert.equal(auth.baseUrl, 'https://chatgpt.com/backend-api/codex');
  assert.equal(auth.headers['chatgpt-account-id'], 'acct_ABCDEF123');
  assert.equal(auth.headers['originator'], 'codex_cli_rs');
  assert.match(auth.headers['Authorization'] ?? '', /^Bearer /);
});
