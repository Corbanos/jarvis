'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { startAudioLevels } from '@/lib/audio-level';
import { useVoiceConfig, matchPhrase } from '@/lib/voice-config';

const SILENCE_MS = 2000;        // stop recording after this much silence
const COOLDOWN_MS = 1500;       // brief gap between recordings
const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

export type WakeState = 'asleep' | 'awake' | 'recording' | 'processing';

// ── Module-level locks (survive React re-mounts / StrictMode) ──
let _isRecording = false;
let _lastTriggerAt = 0;
let _isAwake = false;
let _awakeSince = 0;

interface UseWakeWordOptions {
  onTranscript: (text: string) => void;
  onStateChange?: (state: WakeState) => void;
  enabled?: boolean;
}

export function useWakeWord({ onTranscript, onStateChange, enabled = true }: UseWakeWordOptions) {
  const [state, setState] = useState<WakeState>('asleep');
  const [lastTranscript, setLastTranscript] = useState('');

  const wakePhrases = useVoiceConfig((s) => s.wakePhrases);
  const sleepPhrases = useVoiceConfig((s) => s.sleepPhrases);
  const conversationMode = useVoiceConfig((s) => s.conversationMode);
  const awakeTimeoutSec = useVoiceConfig((s) => s.awakeTimeoutSec);
  const fuzzyMatch = useVoiceConfig((s) => s.fuzzyMatch);

  // Refs that the SR callback reads (to avoid re-binding handlers on config change)
  const cfgRef = useRef({ wakePhrases, sleepPhrases, conversationMode, awakeTimeoutSec, fuzzyMatch });
  useEffect(() => {
    cfgRef.current = { wakePhrases, sleepPhrases, conversationMode, awakeTimeoutSec, fuzzyMatch };
  }, [wakePhrases, sleepPhrases, conversationMode, awakeTimeoutSec, fuzzyMatch]);

  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);

  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);
  const sleepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setWakeState = useCallback((s: WakeState) => {
    setState(s);
    onStateChange?.(s);
  }, [onStateChange]);

  // Schedule auto-sleep after inactivity
  const armSleepTimer = useCallback(() => {
    if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
    sleepTimerRef.current = setTimeout(() => {
      if (_isAwake) {
        console.log('[WakeWord] ⏾ Auto-sleep (inactivity)');
        _isAwake = false;
        _awakeSince = 0;
        setWakeState('asleep');
      }
    }, cfgRef.current.awakeTimeoutSec * 1000);
  }, [setWakeState]);

  const goToSleep = useCallback((reason: string) => {
    if (!_isAwake) return;
    console.log(`[WakeWord] ⏾ Sleep: ${reason}`);
    _isAwake = false;
    _awakeSince = 0;
    if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
    setWakeState('asleep');
  }, [setWakeState]);

  const wakeUp = useCallback((reason: string) => {
    if (_isAwake) return;
    console.log(`[WakeWord] ☀ Awake: ${reason}`);
    _isAwake = true;
    _awakeSince = Date.now();
    setWakeState('awake');
    armSleepTimer();
  }, [setWakeState, armSleepTimer]);

  const triggerCommand = useCallback((stream: MediaStream, inlineCommand: string) => {
    if (_isRecording) return;
    if (Date.now() - _lastTriggerAt < COOLDOWN_MS) return;

    _isRecording = true;
    _lastTriggerAt = Date.now();
    setWakeState('recording');
    armSleepTimer();

    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    recorder.onerror = (e) => {
      console.warn('[WakeWord] MediaRecorder error:', e);
      _isRecording = false;
      setWakeState(_isAwake ? 'awake' : 'asleep');
    };

    recorder.onstop = async () => {
      _isRecording = false;
      setWakeState('processing');

      const finishAndReturn = (text: string) => {
        if (text.length > 1) {
          setLastTranscript(text);
          onTranscriptRef.current(text);

          // Check for sleep phrase BEFORE handing off
          const sleepHit = matchPhrase(text, cfgRef.current.sleepPhrases, cfgRef.current.fuzzyMatch);
          if (sleepHit) {
            goToSleep(`heard sleep phrase "${sleepHit}"`);
            return;
          }
        }
        if (_isAwake) {
          armSleepTimer();
          setWakeState('awake');
        } else {
          setWakeState('asleep');
        }
      };

      // Use SpeechRecognition's transcription if it captured the command inline
      if (inlineCommand.trim().length > 2) {
        finishAndReturn(inlineCommand.trim());
        return;
      }

      // Otherwise use whisper for accuracy
      const blob = new Blob(chunks, { type: 'audio/webm' });
      if (blob.size < 500) {
        if (_isAwake) setWakeState('awake'); else setWakeState('asleep');
        return;
      }

      try {
        const base64 = await blobToBase64(blob);
        const res = await fetch(`${API}/api/voice/transcribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: base64, mimeType: 'audio/webm' }),
        });
        const data = await res.json() as { text?: string };
        finishAndReturn((data.text ?? '').trim());
      } catch (e) {
        console.warn('[WakeWord] Transcription failed:', e);
        finishAndReturn('');
      }
    };

    recorder.start(200);
    silenceTimerRef.current = setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, SILENCE_MS);
  }, [setWakeState, armSleepTimer, goToSleep]);

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
    _isRecording = false;
    _lastTriggerAt = 0;
    _isAwake = false;

    let localStream: MediaStream | null = null;

    async function init() {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        startAudioLevels(localStream).catch(() => {});
      } catch (e) {
        console.error('[WakeWord] Mic denied:', e);
        return;
      }

      const recognition = new SpeechRecognition!();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        console.log('[WakeWord] ✓ Speech recognition ACTIVE');
        if (!stoppedRef.current && !_isAwake) setWakeState('asleep');
      };

      recognition.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (!result?.isFinal) continue;

          const transcript = result[0]?.transcript.toLowerCase().trim() ?? '';
          if (!transcript) continue;

          console.log(`[WakeWord] heard: "${transcript}"  (state=${_isAwake ? 'AWAKE' : 'ASLEEP'})`);

          if (_isRecording) continue; // already capturing
          if (Date.now() - _lastTriggerAt < COOLDOWN_MS) continue;

          const cfg = cfgRef.current;

          if (_isAwake) {
            // In conversation mode — every utterance goes to Jarvis
            // Check sleep phrase first; if matches, send it through (handled in finishAndReturn) so Jarvis can reply, then sleep
            const sleepHit = matchPhrase(transcript, cfg.sleepPhrases, cfg.fuzzyMatch);
            if (sleepHit) {
              console.log(`[WakeWord] ▶ Sleep phrase "${sleepHit}" detected — sending then sleeping`);
            }
            triggerCommand(localStream!, transcript);
            break;
          }

          // ASLEEP — only respond to wake phrase
          const wakeHit = matchPhrase(transcript, cfg.wakePhrases, cfg.fuzzyMatch);
          if (!wakeHit) {
            console.log('[WakeWord]   (asleep, no wake match)');
            continue;
          }

          // Strip the wake phrase to extract the command
          const afterWake = transcript.split(wakeHit).pop()?.trim() ?? '';
          console.log(`[WakeWord] ▶ WAKE "${wakeHit}" + command="${afterWake || '(none)'}"`);

          // Wake up
          if (cfg.conversationMode) wakeUp(`wake phrase "${wakeHit}"`);

          // If they said something after the wake word, send it now
          if (afterWake.length > 1) {
            triggerCommand(localStream!, afterWake);
          } else {
            // Just woke up — stay listening for next utterance without re-recording
            setWakeState('awake');
            armSleepTimer();
          }
          break;
        }
      };

      recognition.onerror = (e: any) => {
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
      _isAwake = false;
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
      localStream?.getTracks().forEach((t) => t.stop());
    };
  }, [enabled, triggerCommand, setWakeState, wakeUp, armSleepTimer]);

  return { state, lastTranscript, isAwake: state === 'awake' || state === 'recording' || state === 'processing' };
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

// Browser SpeechRecognition has spotty TS lib coverage; cast loosely.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    SpeechRecognition?: any;
    webkitSpeechRecognition?: any;
  }
}
