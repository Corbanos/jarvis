import type { FastifyInstance } from 'fastify';
import { transcribeBase64, checkWhisperAvailable } from '../modules/voice-vtt.js';
import { synthesizeToBuffer, getVoiceInfo } from '../modules/voice-tts.js';
import { log } from '../core/logger.js';

export async function voiceRoutes(app: FastifyInstance) {
  // VTT — transcribe audio blob
  app.post('/api/voice/transcribe', async (request, reply) => {
    const body = request.body as { audio: string; mimeType?: string };
    if (!body.audio) return reply.status(400).send({ error: 'audio required' });

    log.voice('Transcribing', `${Math.round(body.audio.length * 0.75 / 1024)}KB`);
    try {
      const result = await transcribeBase64(body.audio, body.mimeType ?? 'audio/webm');
      if (result.text) log.vtt(result.text, result.duration);
      else log.warn('VTT', 'Empty transcript');
      return reply.send({ text: result.text, duration: result.duration });
    } catch (err) {
      log.error('VTT', String(err));
      return reply.status(500).send({ error: String(err) });
    }
  });

  // TTS — synthesize audio and stream back to browser
  app.post('/api/voice/synthesize', async (request, reply) => {
    const body = request.body as { text: string; speed?: number };
    if (!body.text) return reply.status(400).send({ error: 'text required' });

    const info = await getVoiceInfo();
    log.tts(body.text, `${info.method} @ ${(body.speed ?? 1.15).toFixed(2)}x`);

    const result = await synthesizeToBuffer(body.text, { speed: body.speed });
    if (!result?.audioBuffer) {
      log.error('TTS', 'synthesis returned no audio');
      return reply.status(500).send({ error: 'synthesis failed' });
    }

    log.voice('TTS done', `${result.method} · ${(result.audioBuffer.length / 1024).toFixed(0)}KB · ${result.duration}ms`);

    reply.header('Content-Type', result.mimeType);
    reply.header('X-TTS-Method', result.method);
    reply.header('X-TTS-Duration', String(result.duration));
    return reply.send(result.audioBuffer);
  });

  // Never play on the host, even for legacy clients or synthesis failures.
  app.post('/api/voice/speak', async (_request, reply) => {
    return reply.status(410).send({ error: 'Host playback disabled. Use /api/voice/synthesize and play the response on the requesting device.' });
  });

  app.get('/api/voice/status', async (_req, reply) => {
    const [whisper, voice] = await Promise.all([checkWhisperAvailable(), getVoiceInfo()]);
    return reply.send({ whisperAvailable: whisper, ...voice });
  });
}
