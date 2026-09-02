/**
 * Wolfram|Alpha client.
 *
 * Wolfram exposes several endpoints tuned for different consumers, and JARVIS
 * uses each where it fits:
 *   - LLM API         plain text shaped for a model to read       → tool results
 *   - Full Results    structured pods with plaintext + images     → HUD card / module
 *   - Short Answers   one line                                    → quick lookups
 *   - Spoken Results  a sentence written to be read aloud         → TTS
 *
 * The AppID (WOLFRAM_APP_ID in .env) never leaves the server: the HUD asks this box,
 * this box asks Wolfram.
 */
import { config as loadDotenv } from 'dotenv';

// ── Key ───────────────────────────────────────────────────────────────────

/**
 * WOLFRAM_APP_ID from the environment. If it's missing, .env is re-read: the
 * operator adds the line and the next query just works — no restart, and no
 * second place a secret can live.
 */
export function getAppId(): string | null {
  let id = process.env['WOLFRAM_APP_ID']?.trim();
  if (!id) {
    loadDotenv({ quiet: true }); // fills only unset vars; never overrides
    id = process.env['WOLFRAM_APP_ID']?.trim();
  }
  return id || null;
}

export function isConfigured(): boolean {
  return getAppId() !== null;
}

// ── Result shape shared with the HUD ─────────────────────────────────────

export interface WolframImage { src: string; alt: string; width: number; height: number }
export interface WolframSubpod { plaintext: string; image?: WolframImage }
export interface WolframPod { id: string; title: string; primary: boolean; subpods: WolframSubpod[] }

export interface WolframResult {
  input: string;
  success: boolean;
  /** How Wolfram read the question — worth showing, since it's often the answer to "why did it say that". */
  interpretation?: string;
  /** Plaintext of the pod Wolfram flags as the primary result. */
  primary?: string;
  pods: WolframPod[];
  assumptions: string[];
  didYouMean: string[];
  error?: string;
  timing?: number;
}

interface RawSubpod { title?: string; plaintext?: string; img?: { src?: string; alt?: string; width?: number | string; height?: number | string } }
interface RawPod { id?: string; title?: string; primary?: boolean; error?: boolean; subpods?: RawSubpod[] }
interface RawAssumption { type?: string; word?: string; values?: Array<{ desc?: string }> }
interface RawQueryResult {
  success?: boolean;
  error?: boolean | { code?: string; msg?: string };
  timing?: number;
  pods?: RawPod[];
  assumptions?: RawAssumption | RawAssumption[];
  didyoumeans?: { val?: string } | Array<{ val?: string }>;
}

const asArray = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Pure: Full Results JSON → the shape the HUD renders. Exported for tests. */
export function normalizeFullResult(input: string, raw: unknown): WolframResult {
  const qr = ((raw as { queryresult?: RawQueryResult })?.queryresult) ?? {};
  const base: WolframResult = { input, success: false, pods: [], assumptions: [], didYouMean: [] };

  if (qr.error && typeof qr.error === 'object') {
    return { ...base, error: qr.error.msg ? `Wolfram|Alpha: ${qr.error.msg}` : 'Wolfram|Alpha returned an error' };
  }

  const pods: WolframPod[] = (qr.pods ?? [])
    .filter((p) => !p.error)
    .map((p, i) => ({
      id: p.id ?? `pod-${i}`,
      title: p.title ?? '',
      primary: !!p.primary,
      subpods: (p.subpods ?? []).map((sp) => {
        const sub: WolframSubpod = { plaintext: (sp.plaintext ?? '').trim() };
        if (sp.img?.src) {
          sub.image = {
            src: sp.img.src,
            alt: sp.img.alt ?? sp.title ?? p.title ?? '',
            width: Number(sp.img.width ?? 0),
            height: Number(sp.img.height ?? 0),
          };
        }
        return sub;
      }),
    }));

  const inputPod = pods.find((p) => /^input/i.test(p.title));
  const primaryPod = pods.find((p) => p.primary) ?? pods.find((p) => /^result/i.test(p.title));
  const firstText = (p?: WolframPod) => p?.subpods.map((s) => s.plaintext).find(Boolean);

  const assumptions = asArray(qr.assumptions)
    .map((a) => {
      const desc = a.values?.[0]?.desc;
      if (!desc) return '';
      return a.word ? `"${a.word}" taken as ${desc}` : `${a.type ?? 'assumed'}: ${desc}`;
    })
    .filter(Boolean);

  const didYouMean = asArray(qr.didyoumeans).map((d) => d.val ?? '').filter(Boolean);

  const success = !!qr.success && pods.length > 0;
  return {
    ...base,
    success,
    interpretation: firstText(inputPod),
    primary: firstText(primaryPod),
    pods,
    assumptions,
    didYouMean,
    timing: qr.timing,
    ...(success ? {} : { error: didYouMean.length
      ? `Wolfram|Alpha didn't understand that. Did you mean: ${didYouMean.join(', ')}?`
      : "Wolfram|Alpha didn't understand that." }),
  };
}

// ── HTTP ──────────────────────────────────────────────────────────────────

export interface ClientOpts {
  appId?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface TextAnswer { ok: boolean; text: string; error?: string }

let fetchImpl: typeof fetch = (...args) => fetch(...args);
/** Test seam. */
export function _setFetchForTests(f: typeof fetch | null): void {
  fetchImpl = f ?? ((...args) => fetch(...args));
}

function resolveAppId(opts?: ClientOpts): string {
  const id = opts?.appId ?? getAppId();
  if (!id) throw new WolframNotConfigured();
  return id;
}

export class WolframNotConfigured extends Error {
  constructor() { super('Wolfram|Alpha is not configured — no AppID set.'); this.name = 'WolframNotConfigured'; }
}

/**
 * Wolfram signals "no answer" and "bad key" with status codes rather than
 * bodies, so the same mapping serves every text endpoint.
 */
function describeStatus(status: number, body: string): string {
  if (status === 501) return "Wolfram|Alpha didn't understand that or has no short answer for it.";
  // Observed live: the Short Answers endpoint returns 401 for a bad key; docs say 403. Treat both the same.
  if (status === 401 || status === 403) return 'Wolfram|Alpha rejected the AppID — check WOLFRAM_APP_ID in .env.';
  if (status === 400) return 'Wolfram|Alpha: the query was empty or malformed.';
  if (status === 429) return 'Wolfram|Alpha rate limit reached for this AppID.';
  return `Wolfram|Alpha responded ${status}${body ? `: ${body.slice(0, 200)}` : ''}`;
}

async function getText(url: string, opts?: ClientOpts): Promise<TextAnswer> {
  const f = opts?.fetch ?? fetchImpl;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts?.timeoutMs ?? 20_000);
  try {
    const res = await f(url, { signal: ctl.signal });
    const body = (await res.text()).trim();
    if (!res.ok) return { ok: false, text: '', error: describeStatus(res.status, body) };
    return { ok: true, text: body };
  } catch (err) {
    const e = err as { name?: string; message?: string };
    if (e.name === 'AbortError') return { ok: false, text: '', error: 'Wolfram|Alpha did not respond in time.' };
    return { ok: false, text: '', error: `Could not reach Wolfram|Alpha: ${e.message ?? String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

/** Text written for a model to read — the right thing to hand back as a tool result. */
export function llmAnswer(input: string, opts?: ClientOpts): Promise<TextAnswer> {
  const appid = resolveAppId(opts);
  return getText(`https://www.wolframalpha.com/api/v1/llm-api?${q({ input, appid, maxchars: '6000' })}`, opts);
}

/** One line. */
export function shortAnswer(input: string, opts?: ClientOpts): Promise<TextAnswer> {
  const appid = resolveAppId(opts);
  return getText(`https://api.wolframalpha.com/v1/result?${q({ i: input, appid, units: 'metric' })}`, opts);
}

/** A sentence written to be spoken aloud. */
export function spokenAnswer(input: string, opts?: ClientOpts): Promise<TextAnswer> {
  const appid = resolveAppId(opts);
  return getText(`https://api.wolframalpha.com/v1/spoken?${q({ i: input, appid, units: 'metric' })}`, opts);
}

/** Structured pods for the HUD. Never throws for a bad query — reports via `success`/`error`. */
export async function queryFull(input: string, opts?: ClientOpts): Promise<WolframResult> {
  const appid = resolveAppId(opts);
  const url = `https://api.wolframalpha.com/v2/query?${q({ appid, input, output: 'json', format: 'plaintext,image', units: 'metric', reinterpret: 'true' })}`;
  const f = opts?.fetch ?? fetchImpl;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts?.timeoutMs ?? 25_000);
  try {
    const res = await f(url, { signal: ctl.signal });
    if (!res.ok) {
      return { input, success: false, pods: [], assumptions: [], didYouMean: [], error: describeStatus(res.status, await res.text().catch(() => '')) };
    }
    return normalizeFullResult(input, await res.json());
  } catch (err) {
    const e = err as { name?: string; message?: string };
    const error = e.name === 'AbortError' ? 'Wolfram|Alpha did not respond in time.' : `Could not reach Wolfram|Alpha: ${e.message ?? String(err)}`;
    return { input, success: false, pods: [], assumptions: [], didYouMean: [], error };
  } finally {
    clearTimeout(timer);
  }
}

/** Plaintext rendering of a full result, for when the LLM endpoint is unavailable. */
export function resultToText(r: WolframResult): string {
  if (!r.success) return r.error ?? 'No result.';
  const lines: string[] = [];
  if (r.interpretation) lines.push(`Interpretation: ${r.interpretation}`);
  for (const p of r.pods) {
    if (/^input/i.test(p.title)) continue;
    const text = p.subpods.map((s) => s.plaintext).filter(Boolean).join('\n');
    if (text) lines.push(`${p.title}:\n${text}`);
  }
  if (r.assumptions.length) lines.push(`Assumptions: ${r.assumptions.join('; ')}`);
  return lines.join('\n\n');
}
