'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { startAudioLevels, useAudioLevel } from '@/lib/audio-level';
import { useVoiceConfig, matchPhrase } from '@/lib/voice-config';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

// Chunk lengths
const ASLEEP_CHUNK_MS = 2500;     // listen for wake word in 2.5s chunks
const COMMAND_CHUNK_MS = 6000;    // capture full command after wake (max length)
const COMMAND_SILENCE_MS = 1500;  // OR stop early after this silence

// Voice activity threshold
const VAD_THRESHOLD = 0.05;       // mic peak below this = silence
const VAD_GRACE_MS = 800;         // require this much continuous silence to stop

const COOLDOWN_MS = 800;          // brief gap between captures

export type WakeState = 'asleep' | 'awake' | 'recording' | 'processing';

// Module-level locks
let _isAwake = false;
let _busy = false; // currently recording or transcribing
let _lastTriggerAt = 0;

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

  const cfgRef = useRef({ wakePhrases, sleepPhrases, conversationMode, awakeTimeoutSec, fuzzyMatch });
  useEffect(() => {
    cfgRef.current = { wakePhrases, sleepPhrases, conversationMode, awakeTimeoutSec, fuzzyMatch };
  }, [wakePhrases, sleepPhrases, conversationMode, awakeTimeoutSec, fuzzyMatch]);

  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);

  const sleepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);

  const setWakeState = useCallback((s: WakeState) => {
    setState(s);
    onStateChange?.(s);
  }, [onStateChange]);

  const armSleepTimer = useCallback(() => {
    if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
    sleepTimerRef.current = setTimeout(() => {
      if (_isAwake) {
        console.log('[WakeWord] ⏾ Auto-sleep (inactivity)');
        _isAwake = false;
        setWakeState('asleep');
      }
    }, cfgRef.current.awakeTimeoutSec * 1000);
  }, [setWakeState]);

  const goToSleep = useCallback((reason: string) => {
    if (!_isAwake) return;
    console.log(`[WakeWord] ⏾ Sleep: ${reason}`);
    _isAwake = false;
    if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
    setWakeState('asleep');
  }, [setWakeState]);

  const wakeUp = useCallback((reason: string) => {
    if (_isAwake) return;
    console.log(`[WakeWord] ☀ Awake: ${reason}`);
    _isAwake = true;
    setWakeState('awake');
    armSleepTimer();
  }, [setWakeState, armSleepTimer]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    stoppedRef.current = false;
    _isAwake = false;
    _busy = false;
    _lastTriggerAt = 0;

    let stream: MediaStream | null = null;
    let activeRecorder: MediaRecorder | null = null;

    /**
     * Record a chunk of audio for `maxMs` (or until silence) and return it.
     */
    async function recordChunk(maxMs: number, allowEarlyStop: boolean): Promise<Blob | null> {
      if (!stream) return null;
      return new Promise((resolve) => {
        const chunks: Blob[] = [];
        const recorder = new MediaRecorder(stream!, { mimeType: 'audio/webm;codecs=opus' });
        activeRecorder = recorder;

        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

        let resolved = false;
        const finish = () => {
          if (resolved) return;
          resolved = true;
          if (silenceCheckId) clearInterval(silenceCheckId);
          if (maxTimer) clearTimeout(maxTimer);
          if (recorder.state === 'recording') {
            try { recorder.stop(); } catch { /* ignore */ }
          }
          activeRecorder = null;
        };

        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: 'audio/webm' });
          resolve(blob.size > 500 ? blob : null);
        };

        recorder.start(200);

        // Hard max
        const maxTimer = setTimeout(finish, maxMs);

        // Voice activity detection — stop early when silence sustained
        let silentSince = 0;
        let heardSpeech = false;
        const silenceCheckId = allowEarlyStop ? setInterval(() => {
          const lvl = useAudioLevel.getState().level;
          if (lvl > VAD_THRESHOLD) {
            heardSpeech = true;
            silentSince = 0;
            return;
          }
          if (!heardSpeech) return;
          if (silentSince === 0) silentSince = Date.now();
          else if (Date.now() - silentSince > VAD_GRACE_MS) {
            console.log('[WakeWord] (silence detected — stopping early)');
            finish();
          }
        }, 100) : null;
      });
    }

    /**
     * Send audio blob to whisper. Returns the transcribed text (lowercase, trimmed).
     */
    async function transcribe(blob: Blob): Promise<string> {
      const base64 = await blobToBase64(blob);
      try {
        const res = await fetch(`${API}/api/voice/transcribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: base64, mimeType: 'audio/webm' }),
        });
        if (!res.ok) return '';
        const data = await res.json() as { text?: string };
        return (data.text ?? '').toLowerCase().trim();
      } catch (e) {
        console.warn('[WakeWord] transcribe error:', e);
        return '';
      }
    }

    /**
     * Main capture loop.
     * - When asleep: record short chunks, look for wake word
     * - When awake: record longer chunks (with VAD), send all speech to Jarvis
     */
    async function captureLoop() {
      while (!stoppedRef.current) {
        const cfg = cfgRef.current;

        // Wait for cooldown
        const wait = COOLDOWN_MS - (Date.now() - _lastTriggerAt);
        if (wait > 0) await sleep(wait);

        // Skip if no actual speech detected (saves whisper calls)
        const lvl = useAudioLevel.getState().level;
        const isSpeaking = lvl > VAD_THRESHOLD;

        if (!_isAwake) {
          // ASLEEP: only listen if actively speaking — saves whisper calls
          if (!isSpeaking) {
            await sleep(150);
            continue;
          }
        }
        // AWAKE: always record, since Jarvis is in conversation mode

        _busy = true;
        setWakeState('recording');

        const chunkMs = _isAwake ? COMMAND_CHUNK_MS : ASLEEP_CHUNK_MS;
        const allowEarlyStop = _isAwake; // VAD only when awake (asleep chunks are short anyway)
        const blob = await recordChunk(chunkMs, allowEarlyStop);

        if (stoppedRef.current) { _busy = false; break; }
        if (!blob) {
          _busy = false;
          setWakeState(_isAwake ? 'awake' : 'asleep');
          continue;
        }

        setWakeState('processing');
        const text = await transcribe(blob);

        if (stoppedRef.current) { _busy = false; break; }

        if (text) {
          console.log(`[WakeWord] [Whisper] "${text}"  (${_isAwake ? 'AWAKE' : 'ASLEEP'})`);
          setLastTranscript(text);
        }

        if (!text || text.length < 2) {
          _busy = false;
          setWakeState(_isAwake ? 'awake' : 'asleep');
          continue;
        }

        _lastTriggerAt = Date.now();

        if (_isAwake) {
          // In conversation mode — every meaningful utterance goes to Jarvis
          const sleepHit = matchPhrase(text, cfg.sleepPhrases, cfg.fuzzyMatch);
          armSleepTimer();
          onTranscriptRef.current(text);
          if (sleepHit) {
            console.log(`[WakeWord] ▶ Sleep phrase "${sleepHit}" — going to sleep after reply`);
            // Schedule sleep after Jarvis has time to reply
            setTimeout(() => goToSleep(`heard "${sleepHit}"`), 4000);
          }
          _busy = false;
          setWakeState('awake');
          continue;
        }

        // ASLEEP: only respond to wake word
        const wakeHit = matchPhrase(text, cfg.wakePhrases, cfg.fuzzyMatch);
        if (!wakeHit) {
          console.log(`[WakeWord]   (no wake word match in: "${text}")`);
          _busy = false;
          setWakeState('asleep');
          continue;
        }

        // Strip the wake phrase to extract the command portion
        const afterWake = text.split(wakeHit).pop()?.trim() ?? '';
        console.log(`[WakeWord] ▶ WAKE "${wakeHit}"  command="${afterWake || '(none — will record next utterance)'}"`);

        if (cfg.conversationMode) wakeUp(`wake phrase "${wakeHit}"`);

        if (afterWake.length > 1) {
          // Command was in the same chunk — fire it now
          onTranscriptRef.current(afterWake);
          armSleepTimer();
        }
        // Otherwise: just wake up; loop will pick up the next utterance

        _busy = false;
        setWakeState(_isAwake ? 'awake' : 'asleep');
      }
    }

    async function init() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        startAudioLevels(stream).catch(() => {});
        console.log('[WakeWord] ✓ Mic open — Whisper-based wake word loop starting');
      } catch (e) {
        console.error('[WakeWord] Mic denied:', e);
        return;
      }

      setWakeState('asleep');
      captureLoop().catch((e) => console.error('[WakeWord] capture loop crashed:', e));
    }

    init();

    return () => {
      stoppedRef.current = true;
      _isAwake = false;
      _busy = false;
      if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
      if (activeRecorder?.state === 'recording') {
        try { activeRecorder.stop(); } catch { /* ignore */ }
      }
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [enabled, setWakeState, wakeUp, armSleepTimer, goToSleep]);

  return { state, lastTranscript, isAwake: state === 'awake' || state === 'recording' || state === 'processing' };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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
