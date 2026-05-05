/**
 * Global audio level tracker.
 * Single AudioContext, single mic analyser, optional TTS analyser.
 * Reports peak level (0-1) and source (user|jarvis|silent) at ~60fps.
 */
import { create } from 'zustand';

type Source = 'silent' | 'user' | 'jarvis';

interface AudioLevelState {
  level: number;        // 0-1 normalized peak
  source: Source;
  micActive: boolean;
  set: (level: number, source: Source) => void;
  setMicActive: (v: boolean) => void;
}

export const useAudioLevel = create<AudioLevelState>((set) => ({
  level: 0,
  source: 'silent',
  micActive: false,
  set: (level, source) => set({ level, source }),
  setMicActive: (micActive) => set({ micActive }),
}));

let _ctx: AudioContext | null = null;
let _micAnalyser: AnalyserNode | null = null;
let _ttsAnalyser: AnalyserNode | null = null;
let _micStream: MediaStream | null = null;
let _rafId: number | null = null;
let _started = false;

const SMOOTH = 0.6;          // smoothing factor (0..1, higher = smoother)
const NOISE_FLOOR = 0.04;    // ignore mic levels below this
let _smoothedMic = 0;
let _smoothedTTS = 0;

/**
 * Start global audio level monitoring.
 * Reuses any existing mic stream if provided, otherwise opens its own.
 */
export async function startAudioLevels(existingStream?: MediaStream): Promise<void> {
  if (_started) return;
  _started = true;

  try {
    _ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();

    const stream = existingStream ?? await navigator.mediaDevices.getUserMedia({ audio: true });
    _micStream = stream;

    const source = _ctx.createMediaStreamSource(stream);
    _micAnalyser = _ctx.createAnalyser();
    _micAnalyser.fftSize = 512;
    _micAnalyser.smoothingTimeConstant = 0.4;
    source.connect(_micAnalyser);

    useAudioLevel.getState().setMicActive(true);
    loop();
  } catch (e) {
    console.warn('[AudioLevel] startAudioLevels failed:', e);
    _started = false;
  }
}

/**
 * Attach the TTS audio element so we can read its output level too.
 * Called from useJarvisTTS when it creates an Audio element.
 */
export function attachTTSElement(audio: HTMLAudioElement): void {
  if (!_ctx) return;
  try {
    const src = _ctx.createMediaElementSource(audio);
    const analyser = _ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.4;
    src.connect(analyser);
    src.connect(_ctx.destination); // still play through speakers
    _ttsAnalyser = analyser;

    // Cleanup on end
    audio.addEventListener('ended', () => {
      if (_ttsAnalyser === analyser) _ttsAnalyser = null;
    }, { once: true });
    audio.addEventListener('error', () => {
      if (_ttsAnalyser === analyser) _ttsAnalyser = null;
    }, { once: true });
  } catch (e) {
    // createMediaElementSource throws if same element is connected twice — ok
    console.warn('[AudioLevel] attachTTSElement:', e);
  }
}

function loop(): void {
  if (!_micAnalyser) { _started = false; return; }

  const micLevel = readPeak(_micAnalyser);
  const ttsLevel = _ttsAnalyser ? readPeak(_ttsAnalyser) : 0;

  // Smooth
  _smoothedMic = _smoothedMic * SMOOTH + micLevel * (1 - SMOOTH);
  _smoothedTTS = _smoothedTTS * SMOOTH + ttsLevel * (1 - SMOOTH);

  const micEffective = _smoothedMic > NOISE_FLOOR ? _smoothedMic : 0;
  const ttsEffective = _smoothedTTS;

  // TTS takes priority when active (Jarvis is speaking) since it bleeds into mic
  let level = 0;
  let source: Source = 'silent';
  if (ttsEffective > 0.05) {
    level = ttsEffective;
    source = 'jarvis';
  } else if (micEffective > 0) {
    level = micEffective;
    source = 'user';
  }

  // Only push updates when something changes (cheap-ish guard)
  const cur = useAudioLevel.getState();
  if (Math.abs(cur.level - level) > 0.01 || cur.source !== source) {
    useAudioLevel.getState().set(level, source);
  }

  _rafId = requestAnimationFrame(loop);
}

function readPeak(analyser: AnalyserNode): number {
  const bufferLength = analyser.fftSize;
  const data = new Uint8Array(bufferLength);
  analyser.getByteTimeDomainData(data);

  // Compute peak deviation from 128 (center)
  let peak = 0;
  for (let i = 0; i < bufferLength; i++) {
    const v = Math.abs((data[i] ?? 128) - 128);
    if (v > peak) peak = v;
  }
  return Math.min(1, peak / 128);
}

export function stopAudioLevels(): void {
  if (_rafId !== null) cancelAnimationFrame(_rafId);
  _rafId = null;
  _started = false;
  _micStream?.getTracks().forEach((t) => t.stop());
  _micStream = null;
  _ctx?.close().catch(() => { /* ignore */ });
  _ctx = null;
  _micAnalyser = null;
  _ttsAnalyser = null;
  useAudioLevel.getState().setMicActive(false);
  useAudioLevel.getState().set(0, 'silent');
}
