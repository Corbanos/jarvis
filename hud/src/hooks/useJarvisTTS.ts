'use client';
import { useEffect, useRef } from 'react';
import { useJarvisStore } from '@/lib/store';
import { stripCards } from '@/components/JarvisCards/parser';
import { attachTTSElement } from '@/lib/audio-level';
import { useVoiceConfig } from '@/lib/voice-config';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

/**
 * Watches store messages and plays Kokoro TTS audio for new Jarvis responses.
 * Strips cards out so only the prose is spoken.
 */
export function useJarvisTTS() {
  const messages = useJarvisStore((s) => s.messages);
  const ttsEnabled = useVoiceConfig((s) => s.ttsEnabled);
  const ttsSpeed = useVoiceConfig((s) => s.ttsSpeed);
  const lastSpokenRef = useRef<string>('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const initialLoadDoneRef = useRef(false);
  const seenIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // First time we see messages (e.g. loaded from history), mark them all as seen
    // so we don't TTS the entire chat log on page load.
    if (!initialLoadDoneRef.current && messages.length > 0) {
      messages.forEach((m) => seenIdsRef.current.add(m.id));
      initialLoadDoneRef.current = true;
      return;
    }

    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    if (seenIdsRef.current.has(last.id)) return;
    seenIdsRef.current.add(last.id);
    lastSpokenRef.current = last.id;

    if (!ttsEnabled) return;

    const speakable = stripCards(last.text).trim();
    if (!speakable || speakable.length < 2 || speakable.length > 1500) return;

    // Cancel any in-flight speech
    audioRef.current?.pause();
    audioRef.current = null;

    let aborted = false;

    fetch(`${API}/api/voice/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: speakable, speed: ttsSpeed }),
    })
      .then(async (res) => {
        if (aborted || !res.ok) return;
        const blob = await res.blob();
        if (aborted) return;

        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.volume = 1.0;
        audio.crossOrigin = 'anonymous';

        // Hook into global audio level tracker so reactor reacts when Jarvis speaks
        attachTTSElement(audio);

        audio.onended = () => URL.revokeObjectURL(url);
        audio.onerror = () => URL.revokeObjectURL(url);

        audio.play().catch((e) => {
          console.warn('[TTS] Autoplay blocked — user interaction required:', e);
          URL.revokeObjectURL(url);
        });
      })
      .catch((e) => console.warn('[TTS] fetch failed:', e));

    return () => { aborted = true; };
  }, [messages, ttsEnabled, ttsSpeed]);
}
