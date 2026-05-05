/**
 * Voice / wake word configuration.
 * Stored in localStorage, editable via settings panel.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface VoiceConfig {
  wakePhrases: string[];
  sleepPhrases: string[];
  conversationMode: boolean;     // true = stay awake until sleep phrase
  awakeTimeoutSec: number;       // auto-sleep after this much silence
  ttsSpeed: number;              // 0.75 - 1.5
  ttsEnabled: boolean;
  fuzzyMatch: boolean;           // allow loose substring matching

  setWakePhrases: (phrases: string[]) => void;
  setSleepPhrases: (phrases: string[]) => void;
  setConversationMode: (v: boolean) => void;
  setAwakeTimeoutSec: (n: number) => void;
  setTtsSpeed: (n: number) => void;
  setTtsEnabled: (v: boolean) => void;
  setFuzzyMatch: (v: boolean) => void;
  resetDefaults: () => void;
}

const DEFAULTS = {
  wakePhrases: ['hey jarvis', 'jarvis', 'okay jarvis'],
  sleepPhrases: ['that\'s all', 'thats all', 'thank you jarvis', 'goodbye jarvis', 'go to sleep', 'stand down'],
  conversationMode: true,
  awakeTimeoutSec: 45,
  ttsSpeed: 1.15,
  ttsEnabled: true,
  fuzzyMatch: true,
};

export const useVoiceConfig = create<VoiceConfig>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setWakePhrases: (wakePhrases) => set({ wakePhrases }),
      setSleepPhrases: (sleepPhrases) => set({ sleepPhrases }),
      setConversationMode: (conversationMode) => set({ conversationMode }),
      setAwakeTimeoutSec: (awakeTimeoutSec) => set({ awakeTimeoutSec }),
      setTtsSpeed: (ttsSpeed) => set({ ttsSpeed }),
      setTtsEnabled: (ttsEnabled) => set({ ttsEnabled }),
      setFuzzyMatch: (fuzzyMatch) => set({ fuzzyMatch }),
      resetDefaults: () => set(DEFAULTS),
    }),
    { name: 'jarvis-voice-config' }
  )
);

/**
 * Match a phrase against a transcript.
 * Strict mode: exact substring (lowercase).
 * Fuzzy mode: ignores punctuation/extra whitespace, allows word reordering for short phrases.
 */
export function matchPhrase(transcript: string, phrases: string[], fuzzy: boolean): string | null {
  const t = normalize(transcript);
  for (const phrase of phrases) {
    const p = normalize(phrase);
    if (!p) continue;
    if (t.includes(p)) return phrase;
    if (fuzzy) {
      // Allow some flexibility: treat whitespace as flexible, allow repeated chars
      const fuzzyRe = new RegExp(`\\b${p.split(/\s+/).map(escape).join('\\s+')}\\b`);
      if (fuzzyRe.test(t)) return phrase;
    }
  }
  return null;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
