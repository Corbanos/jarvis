'use client';
import { useState } from 'react';
import { useVoiceConfig } from '@/lib/voice-config';
import { clearChatHistory } from '@/hooks/useChatHistory';
import { useJarvisStore } from '@/lib/store';

export function SettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Voice settings"
        style={{
          background: 'transparent',
          border: '1px solid rgba(0,229,255,0.25)',
          borderRadius: 3,
          color: 'var(--accent-primary)',
          padding: '4px 10px',
          fontSize: 9,
          letterSpacing: '0.2em',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontWeight: 700,
        }}
      >
        ⚙ VOICE
      </button>
      {open && <SettingsPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const cfg = useVoiceConfig();
  const [wakeText, setWakeText] = useState(cfg.wakePhrases.join('\n'));
  const [sleepText, setSleepText] = useState(cfg.sleepPhrases.join('\n'));

  const save = () => {
    const wakes = wakeText.split('\n').map((s) => s.trim()).filter(Boolean);
    const sleeps = sleepText.split('\n').map((s) => s.trim()).filter(Boolean);
    cfg.setWakePhrases(wakes);
    cfg.setSleepPhrases(sleeps);
    onClose();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 500,
      background: 'rgba(0,0,0,0.85)',
      backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'rgba(0,8,18,0.98)',
          border: '1px solid rgba(0,229,255,0.3)',
          borderRadius: 4,
          width: '100%', maxWidth: 560,
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 0 60px rgba(0,229,255,0.15)',
          position: 'relative',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 20px',
          borderBottom: '1px solid rgba(0,229,255,0.15)',
          background: 'rgba(0,20,40,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 11, letterSpacing: '0.3em', color: 'var(--accent-primary)', fontWeight: 700 }}>
            ◇ VOICE CONFIGURATION
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--accent-red)', fontSize: 16, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>

          <Section title="WAKE PHRASES" hint="One per line. Jarvis activates when any of these are heard.">
            <textarea
              value={wakeText}
              onChange={(e) => setWakeText(e.target.value)}
              rows={4}
              style={textareaStyle}
              placeholder="hey jarvis&#10;jarvis&#10;wake up"
            />
          </Section>

          <Section title="SLEEP PHRASES" hint="One per line. After Jarvis is awake, any of these end the conversation.">
            <textarea
              value={sleepText}
              onChange={(e) => setSleepText(e.target.value)}
              rows={4}
              style={textareaStyle}
              placeholder="that's all&#10;thank you jarvis&#10;goodbye"
            />
          </Section>

          <Section title="CONVERSATION MODE" hint="When ON: after wake word, Jarvis stays awake until you say a sleep phrase or go silent.">
            <Toggle value={cfg.conversationMode} onChange={cfg.setConversationMode} />
          </Section>

          <Section title="AUTO-SLEEP TIMEOUT" hint={`Auto-sleep after ${cfg.awakeTimeoutSec}s of silence.`}>
            <Slider value={cfg.awakeTimeoutSec} onChange={cfg.setAwakeTimeoutSec} min={10} max={120} step={5} suffix="s" />
          </Section>

          <Section title="FUZZY MATCHING" hint="Allow flexible word spacing in wake/sleep phrase detection.">
            <Toggle value={cfg.fuzzyMatch} onChange={cfg.setFuzzyMatch} />
          </Section>

          <div style={{ borderTop: '1px solid rgba(0,229,255,0.15)', paddingTop: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>

            <Section title="TTS ENABLED" hint="Whether Jarvis speaks responses out loud.">
              <Toggle value={cfg.ttsEnabled} onChange={cfg.setTtsEnabled} />
            </Section>

            <Section title="TTS SPEED" hint={`Voice playback rate. ${cfg.ttsSpeed.toFixed(2)}× current.`}>
              <Slider value={cfg.ttsSpeed} onChange={cfg.setTtsSpeed} min={0.75} max={1.5} step={0.05} suffix="×" />
            </Section>

          </div>

        </div>

        <div style={{ padding: 16, borderTop: '1px solid rgba(0,229,255,0.15)', background: 'rgba(0,20,40,0.4)', display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => { cfg.resetDefaults(); setWakeText(cfg.wakePhrases.join('\n')); setSleepText(cfg.sleepPhrases.join('\n')); }}
              style={{ ...btnStyle, color: 'var(--text-dim)', borderColor: 'rgba(255,255,255,0.1)' }}
            >
              RESET DEFAULTS
            </button>
            <button
              onClick={async () => {
                if (!confirm('Erase all chat history? This cannot be undone.')) return;
                await clearChatHistory('default');
                useJarvisStore.getState().clearMessages();
              }}
              style={{ ...btnStyle, color: 'var(--accent-red)', borderColor: 'rgba(255,34,68,0.3)' }}
            >
              CLEAR HISTORY
            </button>
          </div>
          <button onClick={save} style={{ ...btnStyle, color: 'var(--accent-primary)', borderColor: 'rgba(0,229,255,0.4)', background: 'rgba(0,229,255,0.08)' }}>
            APPLY
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 9, letterSpacing: '0.25em', color: 'var(--accent-primary)', fontWeight: 700, marginBottom: 4 }}>
        {title}
      </div>
      {hint && <div style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 8, lineHeight: 1.5 }}>{hint}</div>}
      {children}
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        background: value ? 'rgba(0,255,157,0.1)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${value ? 'rgba(0,255,157,0.5)' : 'rgba(255,255,255,0.15)'}`,
        borderRadius: 3,
        padding: '6px 14px',
        color: value ? 'var(--accent-green)' : 'var(--text-dim)',
        fontSize: 10,
        letterSpacing: '0.2em',
        fontFamily: 'inherit', fontWeight: 700,
        cursor: 'pointer',
        transition: 'all 0.2s',
      }}
    >
      {value ? '● ON' : '○ OFF'}
    </button>
  );
}

function Slider({ value, onChange, min, max, step, suffix }: { value: number; onChange: (v: number) => void; min: number; max: number; step: number; suffix: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: '#00e5ff' }}
      />
      <div style={{ minWidth: 50, textAlign: 'right', color: 'var(--accent-bright)', fontSize: 11, fontWeight: 700 }}>
        {value}{suffix}
      </div>
    </div>
  );
}

const textareaStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(0,15,35,0.8)',
  border: '1px solid rgba(0,229,255,0.2)',
  borderRadius: 3,
  padding: '8px 10px',
  color: 'var(--text-primary)',
  fontSize: 11,
  fontFamily: 'inherit',
  resize: 'vertical',
  outline: 'none',
  letterSpacing: '0.05em',
  lineHeight: 1.6,
};

const btnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid',
  borderRadius: 3,
  padding: '8px 18px',
  fontSize: 10,
  letterSpacing: '0.2em',
  fontFamily: 'inherit',
  fontWeight: 700,
  cursor: 'pointer',
};
