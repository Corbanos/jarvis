'use client';
import { useEffect, useRef, useState, useCallback } from 'react';

const WAKE_WORDS = ['hey jarvis', 'jarvis', 'okay jarvis'];
const SILENCE_MS = 2200;
const COOLDOWN_MS = 5000;
const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

export type WakeState = 'idle' | 'listening' | 'recording' | 'processing';

// ── Module-level locks (survive React re-mounts / StrictMode double-invoke) ──
let _isRecording = false;
let _lastTriggerAt = 0;
let _activeStream: MediaStream | null = null;

function canTrigger(): boolean {
  if (_isRecording) return false;
  if (Date.now() - _lastTriggerAt < COOLDOWN_MS) return false;
  return true;
}

interface UseWakeWordOptions {
  onTranscript: (text: string) => void;
  onStateChange?: (state: WakeState) => void;
  enabled?: boolean;
}

export function useWakeWord({ onTranscript, onStateChange, enabled = true }: UseWakeWordOptions) {
  const [state, setState] = useState<WakeState>('idle');
  const [lastTranscript, setLastTranscript] = useState('');
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);

  const setWakeState = useCallback((s: WakeState) => {
    setState(s);
    onStateChange?.(s);
  }, [onStateChange]);

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
  };

  const stopRecording = useCallback((recorder: MediaRecorder) => {
    clearSilenceTimer();
    if (recorder.state === 'recording') recorder.stop();
  }, []);

  const triggerCommand = useCallback((stream: MediaStream, inlineCommand: string) => {
    if (!canTrigger()) return;

    _isRecording = true;
    _lastTriggerAt = Date.now();
    setWakeState('recording');

    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    recorder.onstop = async () => {
      _isRecording = false;
      setWakeState('processing');

      // Use the inline text from SpeechRecognition if it's meaningful
      if (inlineCommand.trim().length > 2) {
        const text = inlineCommand.trim();
        setLastTranscript(text);
        onTranscript(text);
        setWakeState('listening');
        return;
      }

      // Otherwise send audio to whisper
      const blob = new Blob(chunks, { type: 'audio/webm' });
      if (blob.size < 500) { setWakeState('listening'); return; }

      try {
        const base64 = await blobToBase64(blob);
        const res = await fetch(`${API}/api/voice/transcribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: base64, mimeType: 'audio/webm' }),
        });
        const data = await res.json() as { text?: string };
        const text = data.text?.trim() ?? '';
        if (text.length > 1) {
          setLastTranscript(text);
          onTranscript(text);
        }
      } catch (e) {
        console.warn('[WakeWord] Transcription failed:', e);
      } finally {
        setWakeState('listening');
      }
    };

    recorder.start(200);

    // Auto-stop after silence
    silenceTimerRef.current = setTimeout(() => stopRecording(recorder), SILENCE_MS);
  }, [onTranscript, setWakeState, stopRecording]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const SpeechRecognition =
      window.SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: typeof window.SpeechRecognition }).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('[WakeWord] SpeechRecognition not supported — use Chrome/Edge.');
      return;
    }

    stoppedRef.current = false;
    let localStream: MediaStream | null = null;

    async function init() {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        _activeStream = localStream;
      } catch (e) {
        console.error('[WakeWord] Mic denied:', e);
        return;
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false; // final only
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        if (!stoppedRef.current) setWakeState('listening');
      };

      recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          // Only process final results
          if (!result?.isFinal) continue;

          const transcript = result[0]?.transcript.toLowerCase().trim() ?? '';
          if (!transcript) continue;

          // Gate: don't trigger if in cooldown or recording
          if (!canTrigger()) continue;

          const wakeFound = WAKE_WORDS.find((w) => transcript.includes(w));
          if (!wakeFound) continue;

          const afterWake = transcript.split(wakeFound).pop()?.trim() ?? '';
          console.log(`[WakeWord] ▶ wake="${wakeFound}" command="${afterWake || '(listening)'}"`);

          triggerCommand(localStream!, afterWake);
          break; // one trigger per result batch, always
        }
      };

      recognition.onerror = (e) => {
        const silent = ['no-speech', 'aborted', 'network', 'audio-capture'];
        if (!silent.includes(e.error)) console.warn('[WakeWord] error:', e.error);
      };

      recognition.onend = () => {
        if (!stoppedRef.current) {
          setTimeout(() => { try { recognition.start(); } catch { /* ignore */ } }, 600);
        }
      };

      recognition.start();
    }

    init();

    return () => {
      stoppedRef.current = true;
      _isRecording = false;
      clearSilenceTimer();
      localStream?.getTracks().forEach((t) => t.stop());
      if (_activeStream === localStream) _activeStream = null;
    };
  }, [enabled, triggerCommand, setWakeState]);

  return { state, lastTranscript };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

declare global {
  interface Window { SpeechRecognition: typeof SpeechRecognition; }
}
