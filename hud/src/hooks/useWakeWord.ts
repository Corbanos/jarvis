'use client';
import { useEffect, useRef, useState, useCallback } from 'react';

const WAKE_WORDS = ['hey jarvis', 'jarvis', 'okay jarvis'];
const SILENCE_MS = 2200;        // stop recording after this much silence
const COOLDOWN_MS = 4000;       // min time between triggers (prevents multi-fire)
const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

export type WakeState = 'idle' | 'listening' | 'recording' | 'processing';

interface UseWakeWordOptions {
  onTranscript: (text: string) => void;
  onStateChange?: (state: WakeState) => void;
  enabled?: boolean;
}

export function useWakeWord({ onTranscript, onStateChange, enabled = true }: UseWakeWordOptions) {
  const [state, setState] = useState<WakeState>('idle');
  const [lastTranscript, setLastTranscript] = useState('');

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // These are refs so they're always current inside async callbacks
  const recordingRef = useRef(false);
  const lastTriggerRef = useRef(0);   // timestamp of last wake-word trigger
  const stoppedRef = useRef(false);   // cleanup flag

  const setWakeState = useCallback((s: WakeState) => {
    setState(s);
    onStateChange?.(s);
  }, [onStateChange]);

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const stopRecording = useCallback(() => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    clearSilenceTimer();
    if (mediaRef.current?.state === 'recording') {
      mediaRef.current.stop();
    }
  }, []);

  const startRecording = useCallback(async (stream: MediaStream, inlineCommand: string) => {
    // Hard gate: don't trigger if already recording or in cooldown
    if (recordingRef.current) return;
    const now = Date.now();
    if (now - lastTriggerRef.current < COOLDOWN_MS) return;

    lastTriggerRef.current = now;
    recordingRef.current = true;
    setWakeState('recording');
    chunksRef.current = [];

    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    mediaRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      setWakeState('processing');

      // If SpeechRecognition already gave us clean text after the wake word, use it directly
      if (inlineCommand.trim().length > 2) {
        setLastTranscript(inlineCommand.trim());
        onTranscript(inlineCommand.trim());
        setWakeState('listening');
        return;
      }

      // Otherwise transcribe the recorded audio via whisper
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      if (blob.size < 500) {
        setWakeState('listening');
        return;
      }

      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = (reader.result as string).split(',')[1];
        if (!base64) { setWakeState('listening'); return; }
        try {
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
      reader.readAsDataURL(blob);
    };

    recorder.start(200);

    // Auto-stop after silence
    silenceTimerRef.current = setTimeout(stopRecording, SILENCE_MS);
  }, [onTranscript, setWakeState, stopRecording]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;

    const SpeechRecognition =
      window.SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: typeof window.SpeechRecognition }).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('[WakeWord] SpeechRecognition not supported — use Chrome/Edge.');
      return;
    }

    stoppedRef.current = false;
    let stream: MediaStream | null = null;

    async function init() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        console.error('[WakeWord] Microphone access denied:', e);
        return;
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false; // FINAL results only — prevents multi-fire
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 2;
      recognitionRef.current = recognition;

      recognition.onstart = () => {
        if (!stoppedRef.current) setWakeState('listening');
      };

      recognition.onresult = (event) => {
        // Only process new final results
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (!result?.isFinal) continue;  // skip interim (shouldn't arrive, but belt+suspenders)

          const transcript = Array.from(result)
            .map((r) => r.transcript)
            .join(' ')
            .toLowerCase()
            .trim();

          // Already in cooldown or recording — ignore
          if (recordingRef.current) continue;
          if (Date.now() - lastTriggerRef.current < COOLDOWN_MS) continue;

          const wakeFound = WAKE_WORDS.find((w) => transcript.includes(w));
          if (!wakeFound) continue;

          // Strip wake word to get the command portion
          const afterWake = transcript.split(wakeFound).pop()?.trim() ?? '';
          console.log(`[WakeWord] ▶ "${wakeFound}" detected — command: "${afterWake || '(listening…)'}"`);

          startRecording(stream!, afterWake);
          break; // only trigger once per result batch
        }
      };

      recognition.onerror = (e) => {
        const silent = ['no-speech', 'aborted', 'network', 'audio-capture'];
        if (!silent.includes(e.error)) {
          console.warn('[WakeWord] Error (will retry):', e.error);
        }
      };

      recognition.onend = () => {
        if (!stoppedRef.current) {
          setTimeout(() => {
            try { recognition.start(); } catch { /* already running */ }
          }, 500);
        }
      };

      recognition.start();
    }

    init();

    return () => {
      stoppedRef.current = true;
      recordingRef.current = false;
      clearSilenceTimer();
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [enabled, startRecording, setWakeState]);

  return { state, lastTranscript };
}

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
  }
}
