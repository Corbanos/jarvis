'use client';
import { useEffect, useRef } from 'react';
import { useJarvisStore } from '@/lib/store';
import { stripCards } from '@/components/JarvisCards/parser';
import { attachTTSElement } from '@/lib/audio-level';
import { useVoiceConfig } from '@/lib/voice-config';
import { authFetch } from '@/lib/auth';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

// Tunables
const MIN_CHUNK_LEN = 24;          // don't synthesize tiny fragments
const MAX_CHUNK_LEN = 280;         // force break after this many chars even without punctuation
const SENTENCE_END = /([.!?])(?=\s|$)/; // strict: punctuation followed by whitespace or end
const SOFT_BREAK = /([,;:])(?=\s)/;   // soft break for long runs

/**
 * Streaming TTS: speaks Jarvis's reply *as he types*, one sentence at a time.
 *
 * Strategy:
 *   1. Watch `thinkingTokens` (live stream from server).
 *   2. As tokens arrive, slice off any complete sentence (".", "!", "?")
 *      and dispatch it to /api/voice/synthesize immediately.
 *   3. Queue the resulting audio blobs and play them serially so they line
 *      up in narration order without overlap.
 *   4. Once the final assistant message commits to `messages`, flush any
 *      trailing fragment (the part after the last full stop) — but skip
 *      anything we've already spoken.
 *
 * We strip <jarvis-card>...</jarvis-card> blocks (visual-only) before
 * speaking, but only AFTER they're fully closed in the stream — so we
 * don't accidentally TTS the JSON inside a half-arrived card.
 */
export function useJarvisTTS() {
  const messages = useJarvisStore((s) => s.messages);
  const thinkingTokens = useJarvisStore((s) => s.thinkingTokens);
  const ttsEnabled = useVoiceConfig((s) => s.ttsEnabled);
  const ttsSpeed = useVoiceConfig((s) => s.ttsSpeed);

  // Per-utterance state
  const cursorRef = useRef(0);             // chars already consumed from thinkingTokens
  const queueRef = useRef<HTMLAudioElement[]>([]);
  const playingRef = useRef(false);
  const seenMsgIdsRef = useRef<Set<string>>(new Set());
  const initialLoadDoneRef = useRef(false);
  const inFlightRef = useRef(0);
  const cancelGenRef = useRef(0);
  // Slot bookkeeping so out-of-order synth completions still play in order
  const nextSlotRef = useRef(0);     // monotonic; assigned at chunk dispatch
  const playSlotRef = useRef(0);     // next slot allowed to play
  const pendingRef = useRef<Map<number, HTMLAudioElement>>(new Map());

  function cancelAll() {
    cancelGenRef.current++;
    queueRef.current.forEach((a) => { try { a.pause(); } catch {} });
    queueRef.current = [];
    pendingRef.current.clear();
    nextSlotRef.current = 0;
    playSlotRef.current = 0;
    playingRef.current = false;
  }

  function playNext() {
    if (playingRef.current) return;
    const next = queueRef.current.shift();
    if (!next) return;
    playingRef.current = true;
    next.play().catch(() => { /* autoplay or transient — drop */ });
    next.onended = () => {
      playingRef.current = false;
      playNext();
    };
    next.onerror = () => {
      playingRef.current = false;
      playNext();
    };
  }

  async function speakChunk(text: string, gen: number) {
    const cleaned = stripCardsForSpeech(text).trim();
    if (cleaned.length < 2) return;
    const slot = nextSlotRef.current++;
    inFlightRef.current++;
    try {
      const res = await authFetch(`${API}/api/voice/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleaned, speed: ttsSpeed }),
      });
      if (gen !== cancelGenRef.current) { advanceSlot(slot, null); return; }
      if (!res.ok) { advanceSlot(slot, null); return; }
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
    } finally {
      inFlightRef.current--;
    }
  }

  /**
   * A chunk's synthesis just resolved (or failed: audio=null). Park it in
   * pendingRef and flush any contiguous prefix into the play queue.
   */
  function advanceSlot(slot: number, audio: HTMLAudioElement | null) {
    if (audio) pendingRef.current.set(slot, audio);
    else pendingRef.current.set(slot, null as unknown as HTMLAudioElement);
    while (pendingRef.current.has(playSlotRef.current)) {
      const a = pendingRef.current.get(playSlotRef.current);
      pendingRef.current.delete(playSlotRef.current);
      playSlotRef.current++;
      if (a) {
        queueRef.current.push(a);
      }
    }
    playNext();
  }

  // ── Streaming pass: chew tokens for complete sentences ────────────────
  useEffect(() => {
    if (!ttsEnabled) return;
    const buf = thinkingTokens;

    // Reset cursor when a new utterance starts (buffer shrank or empty).
    if (buf.length < cursorRef.current) {
      cursorRef.current = 0;
    }

    while (cursorRef.current < buf.length) {
      const slice = buf.slice(cursorRef.current);
      // If we're inside a half-finished <jarvis-card>, wait for it to close.
      if (hasUnclosedCard(slice)) break;

      let cutAt = -1;
      const hardMatch = slice.match(SENTENCE_END);
      if (hardMatch && hardMatch.index !== undefined && hardMatch.index >= MIN_CHUNK_LEN) {
        cutAt = hardMatch.index + hardMatch[0].length;
      } else if (slice.length > MAX_CHUNK_LEN) {
        const softMatch = slice.match(SOFT_BREAK);
        cutAt = softMatch && softMatch.index !== undefined && softMatch.index >= MIN_CHUNK_LEN
          ? softMatch.index + softMatch[0].length
          : MAX_CHUNK_LEN;
      } else {
        break; // wait for more tokens
      }

      const chunk = slice.slice(0, cutAt);
      cursorRef.current += cutAt;
      void speakChunk(chunk, cancelGenRef.current);
    }
  }, [thinkingTokens, ttsEnabled, ttsSpeed]);

  // ── Final pass: when the message commits, flush trailing fragment ─────
  useEffect(() => {
    // First time we see persisted history, mark all as seen — don't re-speak.
    if (!initialLoadDoneRef.current && messages.length > 0) {
      messages.forEach((m) => seenMsgIdsRef.current.add(m.id));
      initialLoadDoneRef.current = true;
      return;
    }

    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    if (seenMsgIdsRef.current.has(last.id)) return;
    seenMsgIdsRef.current.add(last.id);

    if (!ttsEnabled) return;

    // Anything we've already streamed is at indices [0, cursorRef.current).
    // Whatever sits after that is the trailing fragment.
    const remainder = last.text.slice(cursorRef.current).trim();
    if (remainder.length >= 2 && remainder.length <= 1500) {
      void speakChunk(remainder, cancelGenRef.current);
    }
    // Reset for the next utterance
    cursorRef.current = 0;
  }, [messages, ttsEnabled, ttsSpeed]);

  // ── Cancel on disable ────────────────────────────────────────────────
  useEffect(() => {
    if (!ttsEnabled) cancelAll();
  }, [ttsEnabled]);
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Strip <jarvis-card>...</jarvis-card> blocks. We assume the caller has
 * already verified the slice has no UNCLOSED card (via hasUnclosedCard).
 */
function stripCardsForSpeech(s: string): string {
  return stripCards(s)
    .replace(/`{1,3}[\s\S]*?`{1,3}/g, '')   // skip code blocks
    .replace(/\*\*([^*]+)\*\*/g, '$1')      // unwrap bold
    .replace(/\*([^*]+)\*/g, '$1')          // unwrap italic
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Returns true if the slice contains a `<jarvis-card` opening tag without
 * a matching `</jarvis-card>` close. Used to defer speaking until the card
 * arrives in full so we never read the JSON aloud.
 */
function hasUnclosedCard(s: string): boolean {
  const opens = (s.match(/<jarvis-card\b/g) || []).length;
  const closes = (s.match(/<\/jarvis-card>/g) || []).length;
  return opens > closes;
}
