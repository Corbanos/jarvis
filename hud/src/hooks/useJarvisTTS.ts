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
    next.play().catch(() => {});
    next.onended = () => { playingRef.current = false; playNext(); };
    next.onerror = () => { playingRef.current = false; playNext(); };
  }

  async function speakText(text: string, gen: number) {
    const cleaned = stripCardsForSpeech(text).trim();
    if (cleaned.length < 2) return;
    const slot = nextSlotRef.current++;
    try {
      const res = await authFetch(`${API}/api/voice/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleaned, speed: ttsSpeed }),
      });
      if (gen !== cancelGenRef.current || !res.ok) { advanceSlot(slot, null); return; }
      const blob = await res.blob();
      if (gen !== cancelGenRef.current) { advanceSlot(slot, null); return; }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.volume = 1.0;
      audio.crossOrigin = 'anonymous';
      audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
      audio.addEventListener('error', () => URL.revokeObjectURL(url), { once: true });
      attachTTSElement(audio);
      advanceSlot(slot, audio);
    } catch {
      advanceSlot(slot, null);
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
    if (hasUnclosedCard(unspoken)) return 0;
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

  function consumeFromBuffer(fullText: string, mustFlush: boolean) {
    if (!ttsEnabled) return;
    while (true) {
      const unspoken = fullText.slice(spokenRef.current.length);
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
    if (!last || last.role !== 'assistant') return;
    if (last.id === lastAssistantIdRef.current) return; // nothing new
    lastAssistantIdRef.current = last.id;
    if (!ttsEnabled) return;
    // If we streamed this whole reply already, spokenRef.current should
    // start with last.text; just flush any tail. If we didn't stream at
    // all (e.g. non-streaming source), this speaks the whole message.
    if (!last.text.startsWith(spokenRef.current)) {
      // Stream and final disagree (rare — e.g. server post-processed text).
      // Speak the whole thing fresh.
      resetForNewUtterance();
    }
    consumeFromBuffer(last.text, true);
  }, [messages, ttsEnabled, ttsSpeed]);

  useEffect(() => {
    if (!ttsEnabled) cancelAll();
  }, [ttsEnabled]);
}

function stripCardsForSpeech(s: string): string {
  return stripCards(s)
    .replace(/`{1,3}[\s\S]*?`{1,3}/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/[🟢🔴🟡🔵🟣⚪⚫🟠]/g, '')   // emoji bullets read out as nonsense
    .replace(/\s+/g, ' ')
    .trim();
}

function hasUnclosedCard(s: string): boolean {
  const opens = (s.match(/<jarvis-card\b/g) || []).length;
  const closes = (s.match(/<\/jarvis-card>/g) || []).length;
  return opens > closes;
}
