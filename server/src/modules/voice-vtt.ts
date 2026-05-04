/**
 * Voice-to-Text module
 * Uses whisper-cli (whisper.cpp) to transcribe audio
 * Audio is recorded via sox (if available) or browser MediaRecorder
 */
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const execAsync = promisify(exec);

const WHISPER_CLI = '/opt/homebrew/bin/whisper-cli';
const WHISPER_MODEL = '/opt/homebrew/Cellar/whisper-cpp/1.8.4/share/whisper-cpp/models/ggml-base.en.bin';

export interface VTTResult {
  text: string;
  duration: number;
}

/**
 * Transcribe a WAV/PCM audio buffer using whisper.cpp
 */
export async function transcribeBuffer(audioBuffer: Buffer): Promise<VTTResult> {
  const start = Date.now();
  const tmpFile = join(tmpdir(), `jarvis-audio-${Date.now()}.wav`);

  try {
    writeFileSync(tmpFile, audioBuffer);
    const { stdout } = await execAsync(
      `"${WHISPER_CLI}" -m "${WHISPER_MODEL}" -f "${tmpFile}" --output-txt --no-prints 2>/dev/null`,
      { timeout: 30000 }
    );

    const text = stdout
      .replace(/\[\d+:\d+:\d+\.\d+ --> \d+:\d+:\d+\.\d+\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return { text, duration: Date.now() - start };
  } finally {
    if (existsSync(tmpFile)) unlinkSync(tmpFile);
    const txtFile = tmpFile.replace('.wav', '.txt');
    if (existsSync(txtFile)) unlinkSync(txtFile);
  }
}

/**
 * Transcribe a base64-encoded audio blob (from browser MediaRecorder)
 */
export async function transcribeBase64(base64Audio: string, mimeType = 'audio/webm'): Promise<VTTResult> {
  const start = Date.now();
  const ext = mimeType.includes('webm') ? 'webm' : 'wav';
  const inputFile = join(tmpdir(), `jarvis-in-${Date.now()}.${ext}`);
  const wavFile = join(tmpdir(), `jarvis-wav-${Date.now()}.wav`);

  try {
    writeFileSync(inputFile, Buffer.from(base64Audio, 'base64'));

    // Convert to 16kHz mono WAV (whisper requirement)
    await execAsync(
      `ffmpeg -i "${inputFile}" -ar 16000 -ac 1 -c:a pcm_s16le "${wavFile}" -y 2>/dev/null`,
      { timeout: 15000 }
    );

    const { stdout } = await execAsync(
      `"${WHISPER_CLI}" -m "${WHISPER_MODEL}" -f "${wavFile}" --output-txt --no-prints 2>/dev/null`,
      { timeout: 30000 }
    );

    const text = stdout
      .replace(/\[\d+:\d+:\d+\.\d+ --> \d+:\d+:\d+\.\d+\]/g, '')
      .replace(/\(.*?\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return { text, duration: Date.now() - start };
  } finally {
    [inputFile, wavFile, wavFile.replace('.wav', '.txt')].forEach((f) => {
      if (existsSync(f)) unlinkSync(f);
    });
  }
}

export async function checkWhisperAvailable(): Promise<boolean> {
  return existsSync(WHISPER_CLI) && existsSync(WHISPER_MODEL);
}
