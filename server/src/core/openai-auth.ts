/**
 * OpenAI credentials for JARVIS, from either of two sources:
 *
 *   1. ChatGPT sign-in — the same OAuth (PKCE) flow the Codex CLI uses. Tokens
 *      from `codex login` (~/.codex/auth.json) are imported automatically, or
 *      JARVIS runs the flow itself. Requests then go to the Codex backend and
 *      draw on the ChatGPT subscription rather than per-token billing.
 *   2. OPENAI_API_KEY in .env — the standard platform API.
 *
 * Tokens are kept in ~/.jarvis/openai-auth.json and refreshed here; the Codex
 * CLI's own file is only ever read.
 */
import { createHash, randomBytes } from 'crypto';
import { createServer, type Server } from 'http';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { config as loadDotenv } from 'dotenv';
import { log } from './logger.js';

// Constants from the Codex CLI's login crate. Overridable in case they move.
export const OPENAI_ISSUER = process.env['JARVIS_OPENAI_ISSUER'] ?? 'https://auth.openai.com';
export const OPENAI_CLIENT_ID = process.env['JARVIS_OPENAI_CLIENT_ID'] ?? 'app_EMoamEEZ73f0CkXaXp7hrann';
export const ORIGINATOR = 'codex_cli_rs';
export const CHATGPT_BACKEND = 'https://chatgpt.com/backend-api/codex';
export const PLATFORM_API = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access api.connectors.read api.connectors.invoke';
const CALLBACK_PATH = '/auth/callback';
const CALLBACK_PORTS = [1455, 1457];
const LOGIN_TIMEOUT_MS = 10 * 60_000;
const REFRESH_SKEW_S = 60;

const jarvisAuthFile = () => join(homedir(), '.jarvis', 'openai-auth.json');
const codexAuthFile = () => join(homedir(), '.codex', 'auth.json');

export interface OAuthTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  accountId: string | null;
  lastRefresh: string;
}

interface StoredAuth { tokens: OAuthTokens; importedFrom?: 'codex' }

export class OpenAINotConfigured extends Error {
  constructor() { super('OpenAI is not configured — sign in with ChatGPT or set OPENAI_API_KEY.'); this.name = 'OpenAINotConfigured'; }
}

// ── JWT helpers (decode only; the issuer verified these) ──────────────────

export function decodeJwt(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b64 + '='.repeat((4 - (b64.length % 4)) % 4), 'base64').toString('utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function jwtExp(token: string): number | null {
  const exp = decodeJwt(token)?.['exp'];
  return typeof exp === 'number' ? exp : null;
}

const AUTH_NS = 'https://api.openai.com/auth';
const PROFILE_NS = 'https://api.openai.com/profile';

export function accountIdFromIdToken(idToken: string): string | null {
  const c = decodeJwt(idToken);
  const auth = c?.[AUTH_NS] as Record<string, unknown> | undefined;
  const id = auth?.['chatgpt_account_id'] ?? c?.['chatgpt_account_id'];
  return typeof id === 'string' ? id : null;
}

export function emailFromIdToken(idToken: string): string | null {
  const c = decodeJwt(idToken);
  const email = c?.['email'] ?? (c?.[PROFILE_NS] as Record<string, unknown> | undefined)?.['email'];
  return typeof email === 'string' ? email : null;
}

export function planFromIdToken(idToken: string): string | null {
  const auth = decodeJwt(idToken)?.[AUTH_NS] as Record<string, unknown> | undefined;
  const plan = auth?.['chatgpt_plan_type'];
  return typeof plan === 'string' ? plan : null;
}

// ── Storage ───────────────────────────────────────────────────────────────

function readJarvisAuth(): StoredAuth | null {
  const f = jarvisAuthFile();
  if (!existsSync(f)) return null;
  try {
    const j = JSON.parse(readFileSync(f, 'utf-8')) as StoredAuth;
    return j?.tokens?.accessToken ? j : null;
  } catch {
    return null;
  }
}

function writeJarvisAuth(auth: StoredAuth | null): void {
  const f = jarvisAuthFile();
  if (!auth) { if (existsSync(f)) unlinkSync(f); return; }
  mkdirSync(join(homedir(), '.jarvis'), { recursive: true });
  writeFileSync(f, JSON.stringify(auth, null, 2), { mode: 0o600 });
}

/** Tokens the Codex CLI left behind after `codex login`, if any. */
export function readCodexAuth(): OAuthTokens | null {
  const f = codexAuthFile();
  if (!existsSync(f)) return null;
  try {
    const j = JSON.parse(readFileSync(f, 'utf-8')) as {
      tokens?: { id_token?: string; access_token?: string; refresh_token?: string; account_id?: string };
      last_refresh?: string;
    };
    const t = j.tokens;
    if (!t?.access_token || !t.refresh_token || !t.id_token) return null;
    return {
      idToken: t.id_token,
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      accountId: t.account_id ?? accountIdFromIdToken(t.id_token),
      lastRefresh: j.last_refresh ?? new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export function codexLoginAvailable(): boolean {
  return readCodexAuth() !== null;
}

export function importFromCodex(): OAuthTokens | null {
  const tokens = readCodexAuth();
  if (!tokens) return null;
  writeJarvisAuth({ tokens, importedFrom: 'codex' });
  log.check('OpenAI', true, `imported ChatGPT sign-in from ~/.codex/auth.json${emailFromIdToken(tokens.idToken) ? ` (${emailFromIdToken(tokens.idToken)})` : ''}`);
  return tokens;
}

/** Stored ChatGPT tokens, importing the Codex CLI's on first use. */
export function getOAuthTokens(): OAuthTokens | null {
  return readJarvisAuth()?.tokens ?? importFromCodex();
}

export function signOut(): void {
  writeJarvisAuth(null);
  pending = null;
}

export function getApiKey(): string | null {
  let k = process.env['OPENAI_API_KEY']?.trim();
  if (!k) { loadDotenv({ quiet: true }); k = process.env['OPENAI_API_KEY']?.trim(); }
  return k || null;
}

export type OpenAIAuthSource = 'chatgpt' | 'apikey';

export interface OpenAIAuthStatus {
  configured: boolean;
  source: OpenAIAuthSource | null;
  email: string | null;
  plan: string | null;
  accountIdPreview: string | null;
  expiresAt: number | null;
  importedFrom: 'codex' | null;
  codexLoginAvailable: boolean;
  apiKeyPresent: boolean;
  login: { pending: boolean; done: boolean; error: string | null };
}

export function getAuthStatus(): OpenAIAuthStatus {
  const stored = readJarvisAuth() ?? (readCodexAuth() ? { tokens: importFromCodex()!, importedFrom: 'codex' as const } : null);
  const t = stored?.tokens ?? null;
  const key = getApiKey();
  const exp = t ? jwtExp(t.accessToken) : null;
  return {
    configured: !!t || !!key,
    source: t ? 'chatgpt' : key ? 'apikey' : null,
    email: t ? emailFromIdToken(t.idToken) : null,
    plan: t ? planFromIdToken(t.idToken) : null,
    accountIdPreview: t?.accountId ? `${t.accountId.slice(0, 6)}…` : null,
    expiresAt: exp ? exp * 1000 : null,
    importedFrom: stored?.importedFrom ?? null,
    codexLoginAvailable: codexLoginAvailable(),
    apiKeyPresent: !!key,
    login: loginStatus(),
  };
}

export function isConfigured(): boolean {
  return getOAuthTokens() !== null || getApiKey() !== null;
}

// ── Token endpoint ────────────────────────────────────────────────────────

type FetchLike = typeof fetch;

interface TokenResponse { id_token?: string; access_token?: string; refresh_token?: string; error?: string; error_description?: string }

/**
 * Encodings match the Codex CLI per endpoint use: the code exchange is a form
 * post (server.rs), the refresh is JSON (auth/manager.rs).
 */
async function postToken(body: Record<string, string>, encoding: 'json' | 'form', f: FetchLike): Promise<TokenResponse> {
  const url = `${OPENAI_ISSUER}/oauth/token`;
  const res = encoding === 'json'
    ? await f(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    : await f(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok) throw new Error(json.error_description ?? json.error ?? `token endpoint responded ${res.status}`);
  return json;
}

export async function refreshTokens(tokens: OAuthTokens, f: FetchLike = fetch): Promise<OAuthTokens> {
  // Verified against codex-rs/login/src/auth/manager.rs: JSON, these three fields, no scope.
  const j = await postToken({
    client_id: OPENAI_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
  }, 'json', f);
  if (!j.access_token) throw new Error('refresh returned no access token');
  const idToken = j.id_token ?? tokens.idToken;
  const next: OAuthTokens = {
    idToken,
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? tokens.refreshToken,
    accountId: tokens.accountId ?? accountIdFromIdToken(idToken),
    lastRefresh: new Date().toISOString(),
  };
  const stored = readJarvisAuth();
  writeJarvisAuth({ tokens: next, ...(stored?.importedFrom ? { importedFrom: stored.importedFrom } : {}) });
  return next;
}

/** A bearer token good for at least a minute, refreshing if needed. */
export async function getValidAccessToken(f: FetchLike = fetch, force = false): Promise<{ accessToken: string; accountId: string | null } | null> {
  let t = getOAuthTokens();
  if (!t) return null;
  const exp = jwtExp(t.accessToken);
  const stale = force || exp === null || exp - Date.now() / 1000 < REFRESH_SKEW_S;
  if (stale) {
    try {
      t = await refreshTokens(t, f);
      log.info('OpenAI: ChatGPT token refreshed');
    } catch (err) {
      log.warn('OpenAI', `token refresh failed: ${err instanceof Error ? err.message : String(err)}`);
      if (exp !== null && exp * 1000 > Date.now()) { /* still usable for now */ } else throw err;
    }
  }
  return { accessToken: t.accessToken, accountId: t.accountId };
}

// ── Sign in with ChatGPT (PKCE) ───────────────────────────────────────────

interface PendingLogin {
  state: string;
  verifier: string;
  redirectUri: string;
  url: string;
  startedAt: number;
  server: Server | null;
  timer: NodeJS.Timeout | null;
  done: boolean;
  error: string | null;
}

let pending: PendingLogin | null = null;

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function buildAuthorizeUrl(redirectUri: string, challenge: string, state: string): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: OPENAI_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    state,
    originator: ORIGINATOR,
  });
  return `${OPENAI_ISSUER}/oauth/authorize?${q.toString()}`;
}

function listen(port: number): Promise<Server | null> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(null));
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function finishPending(error: string | null): void {
  if (!pending) return;
  pending.done = !error;
  pending.error = error;
  pending.server?.close();
  pending.server = null;
  if (pending.timer) clearTimeout(pending.timer);
  pending.timer = null;
}

async function exchangeCode(code: string, verifier: string, redirectUri: string, f: FetchLike): Promise<OAuthTokens> {
  const j = await postToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: OPENAI_CLIENT_ID,
    code_verifier: verifier,
  }, 'form', f);
  if (!j.access_token || !j.refresh_token || !j.id_token) throw new Error('token response was missing fields');
  return {
    idToken: j.id_token,
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    accountId: accountIdFromIdToken(j.id_token),
    lastRefresh: new Date().toISOString(),
  };
}

const SUCCESS_HTML = `<!doctype html><meta charset="utf-8"><title>JARVIS · signed in</title>
<body style="margin:0;background:#000812;color:#00e5ff;font-family:ui-monospace,Menlo,monospace;display:grid;place-items:center;height:100vh">
<div style="text-align:center;letter-spacing:.2em"><div style="font-size:28px;font-weight:800">SIGNED IN</div>
<div style="font-size:11px;color:#7fb;margin-top:10px">ChatGPT is now linked to JARVIS. You can close this tab.</div></div></body>`;

const FAIL_HTML = (msg: string) => `<!doctype html><meta charset="utf-8"><title>JARVIS · sign-in failed</title>
<body style="margin:0;background:#000812;color:#ff2244;font-family:ui-monospace,Menlo,monospace;display:grid;place-items:center;height:100vh">
<div style="text-align:center;letter-spacing:.15em"><div style="font-size:22px;font-weight:800">SIGN-IN FAILED</div>
<div style="font-size:11px;color:#fa8;margin-top:10px">${msg.replace(/</g, '&lt;')}</div></div></body>`;

export interface StartLoginOpts { fetch?: FetchLike; ports?: number[] }

/**
 * Begins a sign-in. Listens on the Codex CLI's registered callback port so
 * the browser redirect completes the flow on its own; if the browser is on
 * another device (the redirect lands on *its* localhost), the operator pastes
 * that URL back via completeLoginFromUrl.
 */
export async function startLogin(opts: StartLoginOpts = {}): Promise<{ url: string; redirectUri: string; listening: boolean }> {
  finishPending('superseded by a new sign-in');
  const f = opts.fetch ?? fetch;
  const verifier = b64url(randomBytes(64));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(24));

  let server: Server | null = null;
  for (const port of opts.ports ?? CALLBACK_PORTS) {
    server = await listen(port);
    if (server) break;
  }
  const addr = server?.address();
  const port = addr && typeof addr === 'object' ? addr.port : (opts.ports ?? CALLBACK_PORTS)[0]!;
  const redirectUri = `http://localhost:${port}${CALLBACK_PATH}`;

  const login: PendingLogin = {
    state, verifier, redirectUri,
    url: buildAuthorizeUrl(redirectUri, challenge, state),
    startedAt: Date.now(), server, timer: null, done: false, error: null,
  };
  pending = login;

  if (server) {
    server.on('request', async (req, res) => {
      const u = new URL(req.url ?? '/', `http://localhost:${port}`);
      if (u.pathname !== CALLBACK_PATH) { res.statusCode = 404; res.end(); return; }
      const result = await completeLoginFromUrl(u.toString(), f);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.statusCode = result.ok ? 200 : 400;
      res.end(result.ok ? SUCCESS_HTML : FAIL_HTML(result.error ?? 'unknown error'));
    });
  }
  login.timer = setTimeout(() => { if (pending === login && !login.done) finishPending('sign-in timed out'); }, LOGIN_TIMEOUT_MS);

  return { url: login.url, redirectUri, listening: !!server };
}

/** Completes a pending sign-in from the redirect URL — via the callback server or pasted by hand. */
export async function completeLoginFromUrl(redirectUrl: string, f: FetchLike = fetch): Promise<{ ok: boolean; email?: string | null; error?: string }> {
  const login = pending;
  if (!login) return { ok: false, error: 'No sign-in in progress — start one first.' };
  let u: URL;
  try { u = new URL(redirectUrl.trim()); } catch { return { ok: false, error: 'That is not a URL.' }; }

  const err = u.searchParams.get('error');
  if (err) { const msg = u.searchParams.get('error_description') ?? err; finishPending(msg); return { ok: false, error: msg }; }
  const code = u.searchParams.get('code');
  const state = u.searchParams.get('state');
  if (!code || !state) return { ok: false, error: 'The URL has no authorization code — paste the full address the browser landed on.' };
  if (state !== login.state) return { ok: false, error: 'State mismatch — this URL belongs to a different sign-in attempt.' };

  try {
    const tokens = await exchangeCode(code, login.verifier, login.redirectUri, f);
    writeJarvisAuth({ tokens });
    finishPending(null);
    const email = emailFromIdToken(tokens.idToken);
    log.check('OpenAI', true, `signed in with ChatGPT${email ? ` as ${email}` : ''}`);
    return { ok: true, email };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    finishPending(msg);
    return { ok: false, error: msg };
  }
}

export function loginStatus(): { pending: boolean; done: boolean; error: string | null } {
  if (!pending) return { pending: false, done: false, error: null };
  return { pending: !pending.done && !pending.error, done: pending.done, error: pending.error };
}

// ── Per-request auth for the provider ─────────────────────────────────────

export interface RequestAuth { source: OpenAIAuthSource; baseUrl: string; headers: Record<string, string> }

export async function resolveRequestAuth(f: FetchLike = fetch, forceRefresh = false): Promise<RequestAuth> {
  const oauth = await getValidAccessToken(f, forceRefresh);
  if (oauth) {
    return {
      source: 'chatgpt',
      baseUrl: CHATGPT_BACKEND,
      headers: {
        Authorization: `Bearer ${oauth.accessToken}`,
        ...(oauth.accountId ? { 'chatgpt-account-id': oauth.accountId } : {}),
        originator: ORIGINATOR,
        'OpenAI-Beta': 'responses=experimental',
        'User-Agent': `${ORIGINATOR}/0.0.0 (jarvis)`,
      },
    };
  }
  const key = getApiKey();
  if (key) return { source: 'apikey', baseUrl: PLATFORM_API, headers: { Authorization: `Bearer ${key}` } };
  throw new OpenAINotConfigured();
}
