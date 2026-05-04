'use client';
import { useEffect, useRef, useState, useCallback } from 'react';

const WAKE_WORDS = ['hey jarvis', 'jarvis', 'hey j.a.r.v.i.s', 'okay jarvis'];
const SILENCE_MS = 2200; // stop recording after this much silence post-wake
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
  const recordingRef = useRef(false);
  const stateRef = useRef<WakeState>('idle');

  const setWakeState = useCallback((s: WakeState) => {
    setState(s);
    stateRef.current = s;
    onStateChange?.(s);
  }, [onStateChange]);

  const stopRecording = useCallback(async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    if (mediaRef.current?.state === 'recording') {
      mediaRef.current.stop();
    }
  }, []);

  const startRecording = useCallback(async (stream: MediaStream, commandOnly: string) => {
    if (recordingRef.current) return;
    recordingRef.current = true;
    setWakeState('recording');
    chunksRef.current = [];

    // If there's already a command after the wake word, use it directly
    const trimmedCommand = commandOnly.trim();

    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    chunksRef.current = [];
    mediaRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      if (!recordingRef.current && chunksRef.current.length === 0) return;
      setWakeState('processing');

      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });

      // If we already have a command from speech recognition, use it
      if (trimmedCommand.length > 2) {
        onTranscript(trimmedCommand);
        setWakeState('listening');
        return;
      }

      // Otherwise transcribe the audio
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = (reader.result as string).split(',')[1];
        if (!base64 || blob.size < 1000) {
          setWakeState('listening');
          return;
        }
        try {
          const res = await fetch(`${API}/api/voice/transcribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audio: base64, mimeType: 'audio/webm' }),
          });
          const data = await res.json() as { text?: string };
          const text = data.text?.trim() ?? '';
          if (text && text.length > 1) {
            setLastTranscript(text);
            onTranscript(text);
          }
        } catch (e) {
          console.error('[WakeWord] Transcription failed:', e);
        } finally {
          setWakeState('listening');
        }
      };
      reader.readAsDataURL(blob);
    };

    recorder.start(200); // collect chunks every 200ms

    // Auto-stop after silence
    silenceTimerRef.current = setTimeout(() => {
      stopRecording();
    }, SILENCE_MS);
  }, [onTranscript, setWakeState, stopRecording]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;

    const SpeechRecognition = window.SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: typeof window.SpeechRecognition }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[WakeWord] SpeechRecognition not supported in this browser. Use Chrome.');
      return;
    }

    let stream: MediaStream | null = null;
    let stopped = false;

    async function init() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        console.error('[WakeWord] Microphone access denied:', e);
        return;
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 3;
      recognitionRef.current = recognition;

      recognition.onstart = () => {
        if (!stopped) setWakeState('listening');
      };

      recognition.onresult = (event) => {
        if (recordingRef.current) return; // already recording, ignore

        const results = Array.from(event.results).slice(event.resultIndex);
        for (const result of results) {
          const transcript = Array.from(result).map((r) => r.transcript).join(' ').toLowerCase().trim();

          // Check for wake word
          const wakeFound = WAKE_WORDS.find((w) => transcript.includes(w));
          if (wakeFound) {
            // Extract command portion after the wake word
            const afterWake = transcript.split(wakeFound).pop()?.trim() ?? '';
            console.log(`[WakeWord] Wake word detected: "${wakeFound}" → command: "${afterWake}"`);

            // Start recording for the full command
            startRecording(stream!, afterWake);

            // Reset silence timer on each new result while recording
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = setTimeout(() => stopRecording(), SILENCE_MS);
            break;
          }

          // If already recording, extend silence timer on speech
          if (recordingRef.current && result.isFinal) {
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = setTimeout(() => stopRecording(), SILENCE_MS);
          }
        }
      };

      recognition.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        console.error('[WakeWord] Recognition error:', e.error);
      };

      recognition.onend = () => {
        // Auto-restart to keep listening
        if (!stopped) {
          setTimeout(() => {
            try { recognition.start(); } catch { /* ignore if already started */ }
          }, 300);
        }
      };

      recognition.start();
    }

    init();

    return () => {
      stopped = true;
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
      stream?.getTracks().forEach((t) => t.stop());
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    };
  }, [enabled, startRecording, stopRecording, setWakeState]);

  return { state, lastTranscript };
}

// Extend window type for browser compatibility
declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
  }
}
