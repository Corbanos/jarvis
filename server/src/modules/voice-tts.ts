/**
 * Text-to-Speech — Kokoro neural TTS (pure JS, no Python)
 * Falls back to macOS `say` if Kokoro fails to initialize.
 *
 * Voices: af_heart (warm female), bm_george (British male — closest to Jarvis),
 *         bm_lewis (British male, deeper), am_adam (american male)
 */
import { exec } from 'child_process';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { log } from '../core/logger.js';

const JARVIS_VOICE = 'bm_george';   // British male, formal — Jarvis's voice
const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

let _kokoro: { generate: (text: string, opts: { voice: string; speed?: number }) => Promise<{ audio: Float32Array; sampling_rate: number }> } | null = null;
let _kokoroLoading: Promise<void> | null = null;
let _kokoroFailed = false;

async function loadKokoro(): Promise<void> {
  if (_kokoro || _kokoroFailed) return;
  if (_kokoroLoading) return _kokoroLoading;

  _kokoroLoading = (async () => {
    try {
      log.info('Loading Kokoro TTS (first run downloads ~80MB model)...');
      const { KokoroTTS } = await import('kokoro-js');
      _kokoro = await KokoroTTS.from_pretrained(KOKORO_MODEL_ID, { dtype: 'q8' });
      log.check('Kokoro TTS', true, `voice=${JARVIS_VOICE} (British male)`);
    } catch (err) {
      _kokoroFailed = true;
      log.warn('Kokoro', `Failed to load: ${err instanceof Error ? err.message : String(err)} — falling back to macOS say`);
    }
  })();

  return _kokoroLoading;
}

// Start loading in background on import
loadKokoro().catch(() => { /* logged */ });

export interface TTSResult {
  audioBuffer?: Buffer;
  duration: number;
  method: 'kokoro' | 'macos';
  mimeType: string;
}

/**
 * Generate WAV audio for the given text.
 * Returns null only on hard failure.
 */
export async function synthesizeToBuffer(text: string): Promise<TTSResult | null> {
  const start = Date.now();
  const clean = sanitize(text);
  if (!clean) return null;

  // Wait for Kokoro to finish loading if currently loading
  if (_kokoroLoading && !_kokoro && !_kokoroFailed) {
    await _kokoroLoading;
  }

  if (_kokoro) {
    try {
      const result = await _kokoro.generate(clean, { voice: JARVIS_VOICE, speed: 1.0 });
      const wav = floatToWav(result.audio, result.sampling_rate);
      return {
        audioBuffer: wav,
        duration: Date.now() - start,
        method: 'kokoro',
        mimeType: 'audio/wav',
      };
    } catch (err) {
      log.warn('Kokoro', `synth failed: ${err}`);
    }
  }

  // Fallback: macOS say → AIFF buffer
  return await synthesizeMacOS(clean, start);
}

async function synthesizeMacOS(text: string, start: number): Promise<TTSResult | null> {
  const out = join(tmpdir(), `jarvis-tts-${Date.now()}.aiff`);
  return new Promise((resolve) => {
    exec(
      `say -v "Daniel" -r 175 -o "${out}" "${text.replace(/"/g, '\\"').slice(0, 2000)}"`,
      (err) => {
        try {
          if (err || !existsSync(out)) return resolve(null);
          const buf = readFileSync(out);
          unlinkSync(out);
          resolve({ audioBuffer: buf, duration: Date.now() - start, method: 'macos', mimeType: 'audio/aiff' });
        } catch { resolve(null); }
      }
    );
  });
}

/**
 * Speak text out loud on the SERVER (used for scheduled tasks etc.)
 * Browser TTS (preferred) is handled by the /api/voice/speak endpoint
 * which streams the buffer back to the browser.
 */
export async function speak(text: string): Promise<void> {
  // For server-side speaking, use macOS say (non-blocking)
  const clean = sanitize(text);
  if (!clean) return;
  if (_kokoro) {
    // Kokoro can't directly play audio on server; just synth and play via afplay
    try {
      const result = await synthesizeToBuffer(clean);
      if (result?.audioBuffer && result.method === 'kokoro') {
        const tmp = join(tmpdir(), `jarvis-play-${Date.now()}.wav`);
        writeFileSync(tmp, result.audioBuffer);
        exec(`afplay "${tmp}" && rm "${tmp}"`);
        return;
      }
    } catch { /* fall through */ }
  }
  exec(`say -v "Daniel" -r 175 "${clean.replace(/"/g, '\\"').slice(0, 2000)}"`);
}

export async function getVoiceInfo() {
  if (_kokoroLoading && !_kokoro && !_kokoroFailed) await _kokoroLoading;
  return {
    voice: _kokoro ? JARVIS_VOICE : 'Daniel',
    method: _kokoro ? 'Kokoro (neural)' : 'macOS say',
    kokoroAvailable: !!_kokoro,
    kokoroFailed: _kokoroFailed,
  };
}

// ── Helpers ──────────────────────────────────────────────────

function sanitize(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' code block omitted. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/#{1,6}\s/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<jarvis-card[\s\S]*?<\/jarvis-card>/g, '') // strip cards from speech
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Encode a Float32Array (-1..1) into a 16-bit PCM WAV Buffer.
 */
function floatToWav(samples: Float32Array, sampleRate: number): Buffer {
  const bytesPerSample = 2;
  const numChannels = 1;
  const dataSize = samples.length * bytesPerSample;
  const buf = Buffer.alloc(44 + dataSize);

  // RIFF header
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);

  // fmt chunk
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);          // chunk size
  buf.writeUInt16LE(1, 20);           // PCM format
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28); // byte rate
  buf.writeUInt16LE(numChannels * bytesPerSample, 32);              // block align
  buf.writeUInt16LE(16, 34);          // bits per sample

  // data chunk
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  // Samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    buf.writeInt16LE(Math.round(s * 32767), offset);
    offset += 2;
  }

  return buf;
}
