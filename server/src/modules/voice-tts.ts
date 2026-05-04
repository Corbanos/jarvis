/**
 * Text-to-Speech module
 * Uses macOS `say` command with Daniel (British English) voice
 * Daniel is built-in, sounds excellent, and closely matches Jarvis
 * 
 * For even higher quality: install Kokoro via Python
 * (will auto-detect and prefer it)
 */
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const execAsync = promisify(exec);

// macOS built-in British voice — sounds very close to Jarvis
const MACOS_VOICE = 'Daniel';
const MACOS_RATE = 175; // words per minute (Jarvis speaks precisely, not rushed)

export interface TTSResult {
  audioBuffer?: Buffer;
  duration: number;
  method: 'macos' | 'kokoro';
}

let _kokoroAvailable: boolean | null = null;

async function checkKokoro(): Promise<boolean> {
  if (_kokoroAvailable !== null) return _kokoroAvailable;
  try {
    await execAsync('python3 -c "import kokoro" 2>/dev/null');
    _kokoroAvailable = true;
  } catch {
    _kokoroAvailable = false;
  }
  return _kokoroAvailable;
}

/**
 * Speak text aloud (non-blocking by default)
 * Returns audio buffer if returnAudio is true
 */
export async function speak(text: string, options: {
  returnAudio?: boolean;
  blocking?: boolean;
} = {}): Promise<TTSResult> {
  const start = Date.now();
  const clean = text
    .replace(/```[\s\S]*?```/g, 'code block omitted.')
    .replace(/`[^`]+`/g, (m) => m.slice(1, -1))
    .replace(/\*\*/g, '')
    .replace(/#{1,6}\s/g, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .trim();

  // Try Kokoro first (higher quality)
  if (await checkKokoro()) {
    return await speakKokoro(clean, start, options.returnAudio);
  }

  // Fallback to macOS Daniel
  return await speakMacOS(clean, start, options);
}

async function speakMacOS(text: string, start: number, options: { returnAudio?: boolean; blocking?: boolean } = {}): Promise<TTSResult> {
  if (options.returnAudio) {
    const outFile = join(tmpdir(), `jarvis-tts-${Date.now()}.aiff`);
    try {
      await execAsync(`say -v "${MACOS_VOICE}" -r ${MACOS_RATE} -o "${outFile}" "${text.replace(/"/g, '\\"').slice(0, 2000)}"`);
      const audioBuffer = existsSync(outFile) ? readFileSync(outFile) : undefined;
      return { audioBuffer, duration: Date.now() - start, method: 'macos' };
    } finally {
      if (existsSync(outFile)) unlinkSync(outFile);
    }
  }

  const cmd = `say -v "${MACOS_VOICE}" -r ${MACOS_RATE} "${text.replace(/"/g, '\\"').slice(0, 2000)}"`;
  if (options.blocking) {
    await execAsync(cmd, { timeout: 60000 });
  } else {
    // Non-blocking: fire and forget
    exec(cmd);
  }

  return { duration: Date.now() - start, method: 'macos' };
}

async function speakKokoro(text: string, start: number, returnAudio?: boolean): Promise<TTSResult> {
  const script = `
import kokoro, sounddevice as sd, numpy as np, sys
pipeline = kokoro.KPipeline(lang_code='a')
gen = pipeline("${text.replace(/"/g, '\\"').slice(0, 2000)}", voice='af_heart', speed=0.9)
audio_chunks = []
for _, _, audio in gen:
    audio_chunks.append(audio)
if audio_chunks:
    audio = np.concatenate(audio_chunks)
    sd.play(audio, 24000)
    sd.wait()
`;
  const tmpScript = join(tmpdir(), `jarvis-kokoro-${Date.now()}.py`);
  writeFileSync(tmpScript, script);
  try {
    await execAsync(`python3 "${tmpScript}"`, { timeout: 60000 });
  } finally {
    if (existsSync(tmpScript)) unlinkSync(tmpScript);
  }
  return { duration: Date.now() - start, method: 'kokoro' };
}

/**
 * Generate audio buffer for streaming to browser
 */
export async function synthesizeToBuffer(text: string): Promise<Buffer | null> {
  const result = await speak(text, { returnAudio: true });
  return result.audioBuffer ?? null;
}

export async function getVoiceInfo(): Promise<{ voice: string; rate: number; kokoroAvailable: boolean }> {
  return {
    voice: MACOS_VOICE,
    rate: MACOS_RATE,
    kokoroAvailable: await checkKokoro(),
  };
}
