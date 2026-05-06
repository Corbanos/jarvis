'use client';
import { useEffect } from 'react';
import { useJarvisStore } from '@/lib/store';
import { authFetch } from '@/lib/auth';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

/**
 * On HUD mount, fetch the current active project (set last session). The
 * server is the source of truth — we just hydrate the zustand slice so
 * the ChatBadge, ProjectsModule etc. show it immediately. Server pushes
 * future updates via 'projects' WS events (handled in useJarvisWS).
 */
export function useActiveProject() {
  const setActiveProject = useJarvisStore((s) => s.setActiveProject);
  useEffect(() => {
    let stopped = false;
    authFetch(`${API}/api/projects/active`)
      .then((r) => r.json())
      .then((d: { active: { id: string; name: string } | null }) => {
        if (stopped) return;
        setActiveProject(d.active ? { id: d.active.id, name: d.active.name } : null);
      })
      .catch(() => { /* ignore */ });
    return () => { stopped = true; };
  }, [setActiveProject]);
}
