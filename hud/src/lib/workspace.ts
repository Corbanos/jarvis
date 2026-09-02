/**
 * Workspace manager — floating draggable modules.
 * Each module has a unique type. Multiple instances of the same type are allowed.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ModuleType =
  | 'chat'
  | 'agents'
  | 'agent-control'
  | 'scheduler'
  | 'telemetry'
  | 'system'
  | 'cad'
  | 'printer'
  | 'worldview'
  | 'browser'
  | 'shell'
  | 'cad-preview'
  | 'weather'
  | 'wolfram'
  | 'projects'
  | 'library'
  | 'app';

export interface ModuleInstance {
  id: string;             // unique instance id
  type: ModuleType;
  title?: string;          // optional override
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
  data?: Record<string, unknown>; // module-specific state (e.g. printer config, cad design id)
}

interface WorkspaceState {
  modules: ModuleInstance[];
  topZ: number;

  open: (type: ModuleType, opts?: Partial<ModuleInstance>) => string;
  close: (id: string) => void;
  closeByType: (type: ModuleType) => void;
  focus: (id: string) => void;
  move: (id: string, x: number, y: number) => void;
  resize: (id: string, width: number, height: number) => void;
  toggleMinimize: (id: string) => void;
  resetLayout: () => void;
  isOpen: (type: ModuleType) => boolean;
}

const DEFAULT_SIZES: Record<ModuleType, { width: number; height: number }> = {
  chat:           { width: 460, height: 560 },
  agents:         { width: 380, height: 480 },
  'agent-control': { width: 680, height: 520 },
  scheduler:      { width: 380, height: 380 },
  telemetry:      { width: 380, height: 380 },
  system:         { width: 280, height: 360 },
  cad:            { width: 480, height: 540 },
  printer:        { width: 360, height: 380 },
  worldview:      { width: 980, height: 640 },
  browser:        { width: 600, height: 480 },
  shell:          { width: 540, height: 380 },
  'cad-preview':  { width: 520, height: 580 },
  weather:        { width: 460, height: 480 },
  wolfram:        { width: 520, height: 580 },
  projects:       { width: 520, height: 560 },
  library:        { width: 540, height: 480 },
  app:            { width: 720, height: 600 },
};

const DEFAULTS: { modules: ModuleInstance[]; topZ: number } = {
  modules: [
    // Chat opens by default at right side
    {
      id: 'chat-default',
      type: 'chat',
      x: 1400,
      y: 80,
      ...DEFAULT_SIZES.chat,
      zIndex: 10,
      minimized: false,
    },
  ],
  topZ: 10,
};

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      modules: DEFAULTS.modules,
      topZ: DEFAULTS.topZ,

      open: (type, opts = {}) => {
        const id = opts.id ?? `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const size = DEFAULT_SIZES[type];
        const top = get().topZ + 1;
        const winW = typeof window !== 'undefined' ? window.innerWidth : 1600;
        const winH = typeof window !== 'undefined' ? window.innerHeight : 900;

        // Cascade position based on existing module count
        const offset = (get().modules.length % 6) * 28;
        const newModule: ModuleInstance = {
          id,
          type,
          x: opts.x ?? Math.max(20, Math.min(winW - size.width - 20, 80 + offset)),
          y: opts.y ?? Math.max(80, Math.min(winH - size.height - 40, 80 + offset)),
          width: opts.width ?? size.width,
          height: opts.height ?? size.height,
          zIndex: top,
          minimized: false,
          title: opts.title,
          data: opts.data,
        };

        set((s) => ({ modules: [...s.modules, newModule], topZ: top }));
        return id;
      },

      close: (id) => set((s) => ({ modules: s.modules.filter((m) => m.id !== id) })),

      closeByType: (type) => set((s) => ({ modules: s.modules.filter((m) => m.type !== type) })),

      focus: (id) => set((s) => {
        const top = s.topZ + 1;
        return {
          modules: s.modules.map((m) => (m.id === id ? { ...m, zIndex: top, minimized: false } : m)),
          topZ: top,
        };
      }),

      move: (id, x, y) => set((s) => ({
        modules: s.modules.map((m) => (m.id === id ? { ...m, x, y } : m)),
      })),

      resize: (id, width, height) => set((s) => ({
        modules: s.modules.map((m) => (m.id === id ? { ...m, width, height } : m)),
      })),

      toggleMinimize: (id) => set((s) => ({
        modules: s.modules.map((m) => (m.id === id ? { ...m, minimized: !m.minimized } : m)),
      })),

      resetLayout: () => set({ ...DEFAULTS }),

      isOpen: (type) => get().modules.some((m) => m.type === type),
    }),
    { name: 'jarvis-workspace' }
  )
);

/**
 * Convenience: ensure a single instance of a module type exists, focused.
 */
export function summon(type: ModuleType, data?: Record<string, unknown>): string {
  const ws = useWorkspace.getState();
  const existing = ws.modules.find((m) => m.type === type);
  if (existing) {
    ws.focus(existing.id);
    return existing.id;
  }
  return ws.open(type, { data });
}
