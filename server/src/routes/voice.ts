import type { FastifyInstance } from 'fastify';
import { transcribeBase64, checkWhisperAvailable } from '../modules/voice-vtt.js';
import { speak, getVoiceInfo } from '../modules/voice-tts.js';
import { log } from '../core/logger.js';

export async function voiceRoutes(app: FastifyInstance) {
  // Transcribe audio blob from browser MediaRecorder
  app.post('/api/voice/transcribe', async (request, reply) => {
    const body = request.body as { audio: string; mimeType?: string };
    if (!body.audio) return reply.status(400).send({ error: 'audio (base64) required' });

    log.voice('Transcribing', `${Math.round(body.audio.length * 0.75 / 1024)}KB audio`);
    try {
      const result = await transcribeBase64(body.audio, body.mimeType ?? 'audio/webm');
      if (result.text) {
        log.vtt(result.text, result.duration);
      } else {
        log.warn('VTT', 'Empty transcript — silence or no speech detected');
      }
      return reply.send({ text: result.text, duration: result.duration });
    } catch (err) {
      log.error('VTT', String(err));
      return reply.status(500).send({ error: String(err) });
    }
  });

  // Transcribe + chat (full voice round-trip)
  app.post('/api/voice/chat', async (request, reply) => {
    const body = request.body as { audio: string; mimeType?: string; sessionId?: string };
    if (!body.audio) return reply.status(400).send({ error: 'audio required' });

    const sessionId = body.sessionId ?? 'voice-default';
    log.voice('Voice chat', `session=${sessionId}`);

    let userText = '';
    try {
      const vtt = await transcribeBase64(body.audio, body.mimeType);
      userText = vtt.text;
      log.vtt(userText, vtt.duration);
    } catch (err) {
      log.error('VTT', String(err));
      return reply.status(500).send({ error: `VTT failed: ${err}` });
    }

    if (!userText.trim()) {
      log.warn('VTT', 'Empty transcript — skipping chat');
      return reply.send({ userText: '', response: '', skipped: true });
    }

    app.ws.broadcast({
      type: 'telemetry',
      payload: { source: 'VOICE', event: 'VTT', data: { text: userText } },
      timestamp: Date.now(),
    });

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    reply.raw.write(`data: ${JSON.stringify({ type: 'vtt', text: userText })}\n\n`);

    try {
      const result = await app.jarvis.chat(userText, sessionId, (token) => {
        reply.raw.write(`data: ${JSON.stringify({ type: 'token', token })}\n\n`);
      }, { speak: true });

      reply.raw.write(`data: ${JSON.stringify({ type: 'done', text: result.text })}\n\n`);
    } catch (err) {
      log.error('Voice chat', String(err));
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: String(err) })}\n\n`);
    }

    reply.raw.end();
  });

  app.post('/api/voice/speak', async (request, reply) => {
    const body = request.body as { text: string };
    if (!body.text) return reply.status(400).send({ error: 'text required' });
    const info = await getVoiceInfo();
    log.tts(body.text, info.kokoroAvailable ? 'Kokoro' : `macOS ${info.voice}`);
    await speak(body.text);
    return reply.send({ ok: true });
  });

  app.get('/api/voice/status', async (_req, reply) => {
    const [whisper, voice] = await Promise.all([checkWhisperAvailable(), getVoiceInfo()]);
    return reply.send({ whisperAvailable: whisper, ...voice });
  });
}
