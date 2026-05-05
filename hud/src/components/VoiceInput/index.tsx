'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import { authFetch } from '@/lib/auth';

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  onListeningChange?: (listening: boolean) => void;
}

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

export function VoiceInput({ onTranscript, onListeningChange }: VoiceInputProps) {
  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState('');
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animRef = useRef<number>(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Audio level animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function drawWave() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (analyserRef.current) {
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setLevel(avg / 255);

        // Draw frequency bars
        const bars = 32;
        const slice = Math.floor(data.length / bars);
        const barW = canvas.width / bars;
        for (let i = 0; i < bars; i++) {
          const val = data[i * slice] ?? 0;
          const h = (val / 255) * canvas.height * 0.8;
          const alpha = listening ? 0.8 : 0.3;
          ctx.fillStyle = `rgba(0,229,255,${alpha})`;
          ctx.fillRect(i * barW + 1, canvas.height - h, barW - 2, h);
        }
      } else {
        // Idle animation
        const t = Date.now() / 1000;
        for (let i = 0; i < 32; i++) {
          const h = (Math.sin(t * 2 + i * 0.4) * 0.5 + 0.5) * 4 + 1;
          ctx.fillStyle = 'rgba(0,229,255,0.15)';
          ctx.fillRect(i * (canvas.width / 32) + 1, canvas.height - h, (canvas.width / 32) - 2, h);
        }
      }
      animRef.current = requestAnimationFrame(drawWave);
    }

    drawWave();
    return () => cancelAnimationFrame(animRef.current);
  }, [listening]);

  const startListening = useCallback(async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Audio analyser
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        analyserRef.current = null;
        stream.getTracks().forEach((t) => t.stop());
        audioCtx.close();

        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(',')[1];
          if (!base64) return;
          setProcessing(true);
          try {
            const res = await authFetch(`${API}/api/voice/transcribe`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ audio: base64, mimeType: 'audio/webm' }),
            });
            const data = await res.json() as { text?: string };
            if (data.text?.trim()) {
              onTranscript(data.text.trim());
            }
          } catch (e) {
            setError('Transcription failed');
            console.error(e);
          } finally {
            setProcessing(false);
          }
        };
        reader.readAsDataURL(blob);
      };

      recorder.start();
      mediaRef.current = recorder;
      setListening(true);
      onListeningChange?.(true);
    } catch (e) {
      setError('Microphone access denied');
      console.error(e);
    }
  }, [onTranscript, onListeningChange]);

  const stopListening = useCallback(() => {
    mediaRef.current?.stop();
    mediaRef.current = null;
    setListening(false);
    onListeningChange?.(false);
  }, [onListeningChange]);

  const toggle = () => {
    if (listening) stopListening();
    else startListening();
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {/* Waveform canvas */}
      <canvas
        ref={canvasRef}
        width={120}
        height={32}
        style={{ display: 'block', borderRadius: 2 }}
      />

      {/* Mic button */}
      <button
        onClick={toggle}
        disabled={processing}
        title={listening ? 'Stop recording' : 'Start voice input'}
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: `1.5px solid ${listening ? 'var(--accent-amber)' : 'rgba(0,229,255,0.4)'}`,
          background: listening
            ? 'rgba(255,140,0,0.15)'
            : processing
            ? 'rgba(0,229,255,0.1)'
            : 'transparent',
          cursor: processing ? 'wait' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          transition: 'all 0.2s',
          boxShadow: listening ? '0 0 12px rgba(255,140,0,0.4)' : 'none',
          animation: listening ? 'pulse-glow 1.5s infinite' : 'none',
          flexShrink: 0,
        }}
      >
        {processing ? '⟳' : listening ? '⏹' : '🎤'}
      </button>

      {error && (
        <span style={{ fontSize: 9, color: 'var(--accent-red)', letterSpacing: '0.1em' }}>{error}</span>
      )}
    </div>
  );
}
