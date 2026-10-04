'use client';
import { useEffect, useRef } from 'react';
import { useJarvisStore } from '@/lib/store';
import { stripCards } from '@/components/JarvisCards/parser';
import { attachTTSElement } from '@/lib/audio-level';
import { useVoiceConfig } from '@/lib/voice-config';
import { authFetch } from '@/lib/auth';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

const MIN_CHUNK_LEN = 24;
const MAX_CHUNK_LEN = 280;
const SENTENCE_END = /([.!?])(?=\s|$)/;
const SOFT_BREAK = /([,;:])(?=\s)/;

/**
 * Streaming TTS: speaks Jarvis's reply *as he generates*, sentence by sentence.
 *
 * Single source of truth: `spokenText` — a per-utterance accumulator of
 * what we've already dispatched to Kokoro. We compare the live stream
 * (`thinkingTokens`) AND the final committed message text against this
 * one buffer, so we never speak the same prefix twice.
 *
 * Reset rule: spokenText resets to '' when (a) a new user message lands
 * (next assistant turn), or (b) TTS is toggled off.
 */
export function useJarvisTTS() {
  const messages = useJarvisStore((s) => s.messages);
  const thinkingTokens = useJarvisStore((s) => s.thinkingTokens);
  const ttsEnabled = useVoiceConfig((s) => s.ttsEnabled);
  const ttsSpeed = useVoiceConfig((s) => s.ttsSpeed);

  // Already-spoken text for the current assistant reply.
  const spokenRef = useRef<string>('');
  // Bookkeeping for play-order despite out-of-order synth.
  const queueRef = useRef<HTMLAudioElement[]>([]);
  const playingRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const nextSlotRef = useRef(0);
  const playSlotRef = useRef(0);
  const pendingRef = useRef<Map<number, HTMLAudioElement | null>>(new Map());
  const cancelGenRef = useRef(0);
  // Tracks the id of the last assistant message we processed, so if
  // a fresh user message lands we know to reset spoken state.
  const lastAssistantIdRef = useRef<string>('');
  const lastUserIdRef = useRef<string>('');
  // First time we see persisted messages (page reload), don't re-speak.
  const initialLoadDoneRef = useRef(false);

  function cancelAll() {
    cancelGenRef.current++;
    currentAudioRef.current?.pause();
    currentAudioRef.current = null;
    queueRef.current.forEach((a) => { try { a.pause(); } catch {} });
    queueRef.current = [];
    pendingRef.current.clear();
    nextSlotRef.current = 0;
    playSlotRef.current = 0;
    playingRef.current = false;
  }

  function resetForNewUtterance() {
    cancelAll();
    spokenRef.current = '';
  }

  function playNext() {
    if (playingRef.current) return;
    const next = queueRef.current.shift();
    if (!next) return;
    playingRef.current = true;
    currentAudioRef.current = next;
    const finish = () => { currentAudioRef.current = null; playingRef.current = false; playNext(); };
    next.onended = finish;
    next.onerror = finish;
    next.play().catch(finish);
  }

  async function speakText(text: string, gen: number) {
    // `text` is already a slice of the speakable view — cards and code were
    // removed before chunking, so no further stripping is needed here.
    const cleaned = text.trim();
    if (cleaned.length < 2) return;
    const slot = nextSlotRef.current++;
    try {
      const res = await authFetch(`${API}/api/voice/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleaned, speed: ttsSpeed }),
      });
      if (gen !== cancelGenRef.current) return;
      if (!res.ok) { advanceSlot(slot, null); return; }
      const blob = await res.blob();
      if (gen !== cancelGenRef.current) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.volume = 1.0;
      audio.crossOrigin = 'anonymous';
      audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
      audio.addEventListener('error', () => URL.revokeObjectURL(url), { once: true });
      attachTTSElement(audio);
      advanceSlot(slot, audio);
    } catch {
      if (gen === cancelGenRef.current) advanceSlot(slot, null);
    }
  }

  function advanceSlot(slot: number, audio: HTMLAudioElement | null) {
    pendingRef.current.set(slot, audio);
    while (pendingRef.current.has(playSlotRef.current)) {
      const a = pendingRef.current.get(playSlotRef.current);
      pendingRef.current.delete(playSlotRef.current);
      playSlotRef.current++;
      if (a) queueRef.current.push(a);
    }
    playNext();
  }

  /**
   * Try to extract the next speakable chunk from `unspoken`. Returns the
   * length consumed (or 0 if we should wait for more text). Honours
   * card-still-streaming guard.
   */
  function nextChunkLen(unspoken: string, mustFlush: boolean): number {
    const hard = unspoken.match(SENTENCE_END);
    if (hard && hard.index !== undefined && hard.index >= MIN_CHUNK_LEN) {
      return hard.index + hard[0].length;
    }
    if (unspoken.length > MAX_CHUNK_LEN) {
      const soft = unspoken.match(SOFT_BREAK);
      return soft && soft.index !== undefined && soft.index >= MIN_CHUNK_LEN
        ? soft.index + soft[0].length
        : MAX_CHUNK_LEN;
    }
    if (mustFlush && unspoken.trim().length >= 2) return unspoken.length;
    return 0;
  }

  function consumeFromBuffer(rawText: string, mustFlush: boolean) {
    if (!ttsEnabled) return;
    // Reduce to prose BEFORE chunking. Chunking first and stripping each chunk
    // afterwards leaks card/code bodies: a chunk cut at a sentence boundary
    // inside a card holds an opening tag with no closing tag, so the strip
    // regex can't match it and Kokoro reads the raw JSON aloud.
    const speakable = toSpeakable(rawText);
    while (true) {
      if (spokenRef.current.length >= speakable.length) return;
      const unspoken = speakable.slice(spokenRef.current.length);
      if (!unspoken.length) return;
      const take = nextChunkLen(unspoken, mustFlush);
      if (!take) return;
      const chunk = unspoken.slice(0, take);
      spokenRef.current += chunk;
      void speakText(chunk, cancelGenRef.current);
    }
  }

  // ── New user message means a new utterance is coming ─────────────────
  useEffect(() => {
    if (!initialLoadDoneRef.current && messages.length > 0) {
      messages.forEach((m) => {
        if (m.role === 'assistant') lastAssistantIdRef.current = m.id;
        if (m.role === 'user') lastUserIdRef.current = m.id;
      });
      initialLoadDoneRef.current = true;
      return;
    }
    const last = messages[messages.length - 1];
    if (!last) return;
    if (last.role === 'user' && last.id !== lastUserIdRef.current) {
      lastUserIdRef.current = last.id;
      resetForNewUtterance();
    }
  }, [messages]);

  // ── Streaming pass ───────────────────────────────────────────────────
  useEffect(() => {
    if (!ttsEnabled) return;
    if (!thinkingTokens) return;
    consumeFromBuffer(thinkingTokens, false);
    // depend on length so React re-runs as tokens append
  }, [thinkingTokens, ttsEnabled, ttsSpeed]);

  // ── Final-message commit pass: flush any trailing fragment ───────────
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant' || !last.speakable) return;
    if (last.id === lastAssistantIdRef.current) return; // nothing new
    lastAssistantIdRef.current = last.id;
    if (!ttsEnabled) return;
    // spokenRef holds a prefix of the *speakable* view, so compare against
    // that same view rather than the raw text (which still has cards in it).
    if (!toSpeakable(last.text).startsWith(spokenRef.current)) {
      // Stream and final disagree (rare — e.g. server post-processed text).
      // Speak the whole thing fresh.
      resetForNewUtterance();
    }
    consumeFromBuffer(last.text, true);
  }, [messages, ttsEnabled, ttsSpeed]);

  useEffect(() => () => cancelAll(), []);

  useEffect(() => {
    if (!ttsEnabled) cancelAll();
  }, [ttsEnabled]);
}

/**
 * Raw reply text → the prose a human should hear.
 *
 * Applied to the WHOLE accumulated text on every pass (not per-chunk), so the
 * result is a stable prefix as more tokens stream in: everything already
 * spoken stays byte-identical, and only the tail grows.
 *
 * A card or fenced block that is still streaming has no closing delimiter yet,
 * so the strip regexes below cannot see it. Truncating at the dangling opener
 * keeps its body out of speech until it closes — at which point the strip pass
 * removes it wholesale and the prose after it becomes speakable.
 */
function toSpeakable(s: string): string {
  return stripCardsForSpeech(dropUnclosedTail(s));
}

/** Cut the text at an opening <jarvis-card> / ``` fence that never closes. */
function dropUnclosedTail(s: string): string {
  let out = s;
  const card = out.lastIndexOf('<jarvis-card');
  if (card !== -1 && out.indexOf('</jarvis-card>', card) === -1) out = out.slice(0, card);
  // An odd number of ``` fences means the last one is still open.
  const fences = out.match(/```/g);
  if (fences && fences.length % 2 === 1) out = out.slice(0, out.lastIndexOf('```'));
  return out;
}

function stripCardsForSpeech(s: string): string {
  return stripCards(s)
    .replace(/```[\s\S]*?```/g, '')      // fenced blocks
    .replace(/`[^`\n]*`/g, '')           // inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/[🟢🔴🟡🔵🟣⚪⚫🟠]/g, '')   // emoji bullets read out as nonsense
    .replace(/\s+/g, ' ')
    .trimStart();                        // NOT trim() — a trailing trim would
                                         // shift the prefix as tokens arrive
}
