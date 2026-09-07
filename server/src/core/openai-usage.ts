/**
 * ChatGPT/Codex subscription usage — the two rolling rate-limit windows the
 * Codex CLI shows in /status (a 5-hour and a weekly one), plus per-model
 * availability and credits. Read from the same backend the sign-in talks to.
 *
 * Only meaningful for ChatGPT sign-in; an API key has no subscription window.
 */
import { resolveRequestAuth, getOAuthTokens } from './openai-auth.js';

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const CACHE_MS = 30_000;

export interface UsageWindow {
  usedPercent: number;
  windowSeconds: number;
  resetAt: number;            // epoch ms
  resetAfterSeconds: number;
  label: string;              // "5H", "WEEK", "3D"
}

export interface CodexUsage {
  available: true;
  fetchedAt: number;
  plan: string | null;
  email: string | null;
  allowed: boolean;
  limitReached: boolean;
  primary: UsageWindow | null;
  secondary: UsageWindow | null;
  models: Record<string, { available: boolean; availableAt: number | null }>;
  credits: { hasCredits: boolean; unlimited: boolean; balance: number | null };
}

export interface UsageUnavailable { available: false; reason: string }

interface RawWindow { used_percent?: number; limit_window_seconds?: number; reset_after_seconds?: number; reset_at?: number }
interface RawUsage {
  plan_type?: string;
  email?: string;
  rate_limit?: { allowed?: boolean; limit_reached?: boolean; primary_window?: RawWindow | null; secondary_window?: RawWindow | null } | null;
  model_usage?: Record<string, { available?: boolean; available_at?: string | null }> | null;
  credits?: { has_credits?: boolean; unlimited?: boolean; balance?: number | null } | null;
}

/** "5H" for a five-hour window, "WEEK" for seven days, "3D" for other multi-day windows. */
export function windowLabel(seconds: number): string {
  if (seconds >= 6 * 86_400) return 'WEEK';
  if (seconds >= 86_400) return `${Math.round(seconds / 86_400)}D`;
  return `${Math.max(1, Math.round(seconds / 3600))}H`;
}

function toWindow(w: RawWindow | null | undefined, now: number): UsageWindow | null {
  if (!w || typeof w.used_percent !== 'number') return null;
  const windowSeconds = w.limit_window_seconds ?? 0;
  const resetAfter = w.reset_after_seconds ?? (w.reset_at ? Math.max(0, w.reset_at - now / 1000) : 0);
  return {
    usedPercent: Math.max(0, Math.min(100, Math.round(w.used_percent))),
    windowSeconds,
    resetAt: w.reset_at ? w.reset_at * 1000 : now + resetAfter * 1000,
    resetAfterSeconds: Math.round(resetAfter),
    label: windowLabel(windowSeconds),
  };
}

/** Pure: the backend payload → what the HUD renders. */
export function normalizeUsage(raw: RawUsage, now = Date.now()): CodexUsage {
  const rl = raw.rate_limit ?? {};
  const models: CodexUsage['models'] = {};
  for (const [slug, m] of Object.entries(raw.model_usage ?? {})) {
    const at = m?.available_at ? Date.parse(m.available_at) : NaN;
    models[slug] = { available: m?.available !== false, availableAt: Number.isFinite(at) ? at : null };
  }
  return {
    available: true,
    fetchedAt: now,
    plan: raw.plan_type ?? null,
    email: raw.email ?? null,
    allowed: rl.allowed !== false,
    limitReached: !!rl.limit_reached,
    primary: toWindow(rl.primary_window, now),
    secondary: toWindow(rl.secondary_window, now),
    models,
    credits: {
      hasCredits: !!raw.credits?.has_credits,
      unlimited: !!raw.credits?.unlimited,
      balance: typeof raw.credits?.balance === 'number' ? raw.credits.balance : null,
    },
  };
}

let cache: { at: number; value: CodexUsage } | null = null;

export async function fetchCodexUsage(f: typeof fetch = fetch, force = false): Promise<CodexUsage | UsageUnavailable> {
  if (!getOAuthTokens()) return { available: false, reason: 'Usage windows exist only for ChatGPT sign-in.' };
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  try {
    const auth = await resolveRequestAuth(f);
    if (auth.source !== 'chatgpt') return { available: false, reason: 'Usage windows exist only for ChatGPT sign-in.' };
    const res = await f(USAGE_URL, { headers: { ...auth.headers, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { available: false, reason: `Usage endpoint responded ${res.status}` };
    const value = normalizeUsage((await res.json()) as RawUsage);
    cache = { at: Date.now(), value };
    return value;
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** Test seam. */
export function _resetUsageCache(): void { cache = null; }
