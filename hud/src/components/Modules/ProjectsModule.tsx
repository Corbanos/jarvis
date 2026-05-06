'use client';
import { useEffect, useState, useCallback } from 'react';
import { authFetch } from '@/lib/auth';
import { summon } from '@/lib/workspace';
import { useJarvisStore } from '@/lib/store';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  description?: string;
  kind: 'app' | 'research' | 'task';
  status: 'active' | 'signed_off' | 'archived';
  created_at: number;
  last_active_at: number;
  signed_off_at?: number;
  summary?: string;
  last_left_off?: string;
}

interface ProjectNote {
  id: number;
  project_id: string;
  kind: 'note' | 'session' | 'sign_off';
  content: string;
  created_at: number;
}

interface AppManifest {
  slug: string;
  name: string;
  ready?: boolean;
  icon?: string;
}

export function ProjectsModule() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [view, setView] = useState<'active' | 'signed_off'>('active');
  const [focused, setFocused] = useState<ProjectRow | null>(null);
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [manifest, setManifest] = useState<AppManifest | null>(null);
  const [signOffOpen, setSignOffOpen] = useState(false);
  const [signOffText, setSignOffText] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const activeProjectId = useJarvisStore((s) => s.activeProjectId);
  const setActiveProject = useJarvisStore((s) => s.setActiveProject);

  const refresh = useCallback(async () => {
    try {
      const r = await authFetch(`${API}/api/projects`);
      const j = await r.json() as { projects: ProjectRow[] };
      setProjects(j.projects);
    } catch { /* ignore */ }
  }, []);

  const loadFocused = useCallback(async (p: ProjectRow) => {
    setFocused(p);
    setSignOffOpen(false);
    setSignOffText('');
    try {
      const r = await authFetch(`${API}/api/projects/${p.id}`);
      const j = await r.json() as { project: ProjectRow; notes: ProjectNote[]; manifest: AppManifest | null };
      setNotes(j.notes);
      setManifest(j.manifest);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    const onProjectsEvent = () => {
      refresh();
      if (focused) loadFocused(focused);
    };
    window.addEventListener('jarvis-projects-event', onProjectsEvent);
    return () => { clearInterval(t); window.removeEventListener('jarvis-projects-event', onProjectsEvent); };
  }, [refresh, focused, loadFocused]);

  async function init(p: ProjectRow) {
    const r = await authFetch(`${API}/api/projects/${p.id}/init`, { method: 'POST' });
    if (r.ok) {
      const j = await r.json() as { active: ProjectRow | null };
      if (j.active) setActiveProject({ id: j.active.id, name: j.active.name });
      await refresh();
      loadFocused(p);
    }
  }

  async function deinit() {
    await authFetch(`${API}/api/projects/active`, { method: 'DELETE' });
    setActiveProject(null);
    await refresh();
    if (focused) loadFocused(focused);
  }

  async function resume(p: ProjectRow) {
    await authFetch(`${API}/api/projects/${p.id}/resume`, { method: 'POST' });
    await refresh();
    loadFocused(p);
  }

  async function signOff() {
    if (!focused || !signOffText.trim()) return;
    await authFetch(`${API}/api/projects/${focused.id}/sign-off`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: signOffText.trim() }),
    });
    if (activeProjectId === focused.id) setActiveProject(null);
    await refresh();
    setSignOffOpen(false);
    setSignOffText('');
    loadFocused(focused);
  }

  async function createProject() {
    if (!newName.trim()) return;
    const r = await authFetch(`${API}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), kind: 'app' }),
    });
    if (r.ok) {
      const j = await r.json() as { project: ProjectRow };
      setNewName('');
      setCreating(false);
      await refresh();
      loadFocused(j.project);
    }
  }

  async function launchApp(slug: string) {
    summon('app', { slug });
  }

  const filtered = projects.filter((p) => p.status === view);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'rgba(0,8,16,0.95)', fontFamily: 'inherit', color: 'var(--text-primary)' }}>

      {/* Active banner — visible across both panes when a project is INITed */}
      {activeProjectId && (
        <div style={{
          padding: '6px 12px',
          background: 'rgba(0,229,255,0.12)',
          borderBottom: '1px solid rgba(0,229,255,0.4)',
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 9, letterSpacing: '0.15em',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#00e5ff', boxShadow: '0 0 8px #00e5ff', animation: 'pulse-glow 1.5s infinite' }} />
          <span style={{ color: 'var(--accent-bright)', fontWeight: 700 }}>● ACTIVE: {activeProjectName(projects, activeProjectId)}</span>
          <span style={{ flex: 1 }} />
          <button onClick={deinit} title="Clear active project (without signing off)" style={miniBtnRedStyle}>END INIT</button>
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Left list */}
        <div style={{ width: focused ? '40%' : '100%', minWidth: 200, borderRight: focused ? '1px solid rgba(0,229,255,0.15)' : 'none', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', gap: 4, padding: '8px 10px', borderBottom: '1px solid rgba(0,229,255,0.15)', alignItems: 'center', flexWrap: 'wrap' }}>
            <Tab active={view === 'active'} onClick={() => setView('active')} count={projects.filter((p) => p.status === 'active').length}>ACTIVE</Tab>
            <Tab active={view === 'signed_off'} onClick={() => setView('signed_off')} count={projects.filter((p) => p.status === 'signed_off').length}>SIGNED OFF</Tab>
            <span style={{ flex: 1 }} />
            <button onClick={() => setCreating((v) => !v)} style={newBtnStyle}>＋ NEW</button>
          </div>

          {creating && (
            <div style={{ padding: '8px 10px', borderBottom: '1px solid rgba(0,229,255,0.1)', display: 'flex', gap: 6 }}>
              <input
                autoFocus
                placeholder="Project name…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') createProject(); if (e.key === 'Escape') { setCreating(false); setNewName(''); } }}
                style={inputStyle}
              />
              <button onClick={createProject} disabled={!newName.trim()} style={confirmBtnStyle}>OK</button>
            </div>
          )}

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 22, textAlign: 'center', color: 'var(--text-dim)' }}>
                <div style={{ fontSize: 28, color: 'var(--accent-primary)', opacity: 0.25, marginBottom: 8 }}>◆</div>
                <div style={{ fontSize: 9, letterSpacing: '0.2em' }}>{view === 'active' ? 'NO ACTIVE PROJECTS' : 'NO SIGNED-OFF PROJECTS'}</div>
                <div style={{ fontSize: 8, marginTop: 8, opacity: 0.7, lineHeight: 1.6 }}>
                  Click <span style={{ color: 'var(--accent-amber)' }}>＋ NEW</span> or ask Jarvis: <span style={{ color: 'var(--accent-amber)' }}>“start a project to make me a tetris game”</span>
                </div>
              </div>
            ) : (
              filtered.map((p) => (
                <ProjectListItem
                  key={p.id}
                  project={p}
                  focused={focused?.id === p.id}
                  isActive={activeProjectId === p.id}
                  onClick={() => loadFocused(p)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right detail */}
        {focused && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(0,229,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ overflow: 'hidden' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-bright)', letterSpacing: '0.05em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {manifest?.icon ?? '◆'}  {focused.name}
                </div>
                <div style={{ fontSize: 8, color: 'var(--text-dim)', letterSpacing: '0.15em', marginTop: 3 }}>
                  {focused.kind.toUpperCase()} · {focused.status.toUpperCase().replace('_', ' ')}
                  {activeProjectId === focused.id && (
                    <span style={{ marginLeft: 8, color: 'var(--accent-primary)' }}>● INITED</span>
                  )}
                </div>
              </div>
              <button onClick={() => setFocused(null)} style={closeBtnStyle}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {focused.description && <Field label="DESCRIPTION" value={focused.description} />}
              {focused.last_left_off && focused.status === 'active' && <Field label="LEFT OFF" value={focused.last_left_off} accent="var(--accent-amber)" />}
              {focused.summary && <Field label={focused.status === 'signed_off' ? 'SIGN-OFF SUMMARY' : 'LAST SUMMARY'} value={focused.summary} accent="var(--accent-green)" />}

              {manifest && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'rgba(0,229,255,0.04)', border: '1px solid rgba(0,229,255,0.15)', borderRadius: 3 }}>
                  <span style={{ fontSize: 16 }}>{manifest.icon ?? '◆'}</span>
                  <div style={{ flex: 1, fontSize: 10 }}>
                    <div style={{ color: 'var(--accent-bright)' }}>{manifest.name}</div>
                    <div style={{ fontSize: 8, color: 'var(--text-dim)', letterSpacing: '0.1em' }}>
                      {manifest.ready ? 'BUILT · READY' : 'NOT YET BUILT'}
                    </div>
                  </div>
                  {manifest.ready && <button onClick={() => launchApp(manifest.slug)} style={launchBtnStyle}>▶ LAUNCH</button>}
                </div>
              )}

              <div>
                <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'var(--text-dim)', marginBottom: 4 }}>NOTES</div>
                {notes.length === 0 ? (
                  <div style={{ fontSize: 9, color: 'var(--text-dim)', fontStyle: 'italic' }}>No notes yet — Jarvis will record session activity here.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {notes.slice(0, 30).map((n) => <NoteRow key={n.id} note={n} />)}
                  </div>
                )}
              </div>
            </div>

            <div style={{ borderTop: '1px solid rgba(0,229,255,0.15)', padding: '8px 12px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {focused.status === 'active' ? (
                <>
                  {activeProjectId === focused.id ? (
                    <button onClick={deinit} title="Stop using this as conversation context" style={deinitBtnStyle}>○ END INIT</button>
                  ) : (
                    <button onClick={() => init(focused)} title="Bind chat conversation to this project — Jarvis edits it directly" style={initBtnStyle}>▶ INIT</button>
                  )}
                  {!signOffOpen ? (
                    <button onClick={() => setSignOffOpen(true)} style={signOffBtnStyle}>● SIGN OFF</button>
                  ) : (
                    <div style={{ display: 'flex', gap: 6, flex: 1, minWidth: 200 }}>
                      <input
                        autoFocus
                        placeholder="One-line wrap-up — what was done?"
                        value={signOffText}
                        onChange={(e) => setSignOffText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') signOff(); if (e.key === 'Escape') setSignOffOpen(false); }}
                        style={inputStyle}
                      />
                      <button onClick={signOff} disabled={!signOffText.trim()} style={confirmBtnStyle}>CONFIRM</button>
                      <button onClick={() => setSignOffOpen(false)} style={cancelBtnStyle}>✕</button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <button onClick={() => resume(focused)} style={resumeBtnStyle}>▸ RESUME</button>
                  <button onClick={() => init(focused)} title="Resume + bind chat to this project" style={initBtnStyle}>▶ INIT</button>
                </>
              )}
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 8, color: 'var(--text-dim)', letterSpacing: '0.1em', alignSelf: 'center' }}>slug: {focused.slug}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function activeProjectName(list: ProjectRow[], id: string): string {
  const p = list.find((x) => x.id === id);
  return p?.name ?? '(unknown)';
}

function ProjectListItem({ project, focused, isActive, onClick }: { project: ProjectRow; focused: boolean; isActive: boolean; onClick: () => void }) {
  const accent = project.status === 'active' ? '#00e5ff' : project.status === 'signed_off' ? '#00ff9d' : '#888';
  return (
    <div onClick={onClick} style={{
      padding: '9px 12px',
      borderBottom: '1px solid rgba(0,229,255,0.06)',
      borderLeft: isActive ? `3px solid var(--accent-primary)` : focused ? `2px solid ${accent}` : '2px solid transparent',
      background: isActive ? 'rgba(0,229,255,0.08)' : focused ? 'rgba(0,229,255,0.05)' : 'transparent',
      cursor: 'pointer',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: accent, boxShadow: `0 0 6px ${accent}` }} />
        <div style={{ flex: 1, fontSize: 10, fontWeight: 600, color: 'var(--accent-bright)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {project.name}
        </div>
        {isActive && (
          <span style={{ fontSize: 7, color: 'var(--accent-primary)', letterSpacing: '0.15em', padding: '1px 6px', border: '1px solid rgba(0,229,255,0.4)', borderRadius: 8 }}>
            INIT
          </span>
        )}
        <div style={{ fontSize: 8, color: 'var(--text-dim)', letterSpacing: '0.1em' }}>{project.kind}</div>
      </div>
      {(project.last_left_off || project.summary) && (
        <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginTop: 4, paddingLeft: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {project.status === 'active' ? (project.last_left_off ?? '') : (project.summary ?? '')}
        </div>
      )}
    </div>
  );
}

function Tab({ active, onClick, count, children }: { active: boolean; onClick: () => void; count: number; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      background: active ? 'rgba(0,229,255,0.15)' : 'transparent',
      border: `1px solid ${active ? 'rgba(0,229,255,0.4)' : 'rgba(0,229,255,0.2)'}`,
      borderRadius: 2, padding: '4px 8px',
      color: active ? 'var(--accent-primary)' : 'var(--text-dim)',
      fontSize: 8, letterSpacing: '0.15em', cursor: 'pointer', fontFamily: 'inherit',
      display: 'flex', alignItems: 'center', gap: 5,
    }}>
      {children}
      <span style={{ background: active ? 'rgba(0,229,255,0.3)' : 'rgba(255,255,255,0.1)', borderRadius: 8, padding: '1px 5px', fontSize: 7 }}>{count}</span>
    </button>
  );
}

function NoteRow({ note }: { note: ProjectNote }) {
  const ts = new Date(note.created_at).toISOString().replace('T', ' ').slice(0, 16);
  const color = note.kind === 'sign_off' ? 'var(--accent-green)' : note.kind === 'session' ? 'var(--accent-amber)' : 'var(--text-secondary)';
  return (
    <div style={{ fontSize: 9, lineHeight: 1.55, padding: '4px 6px', background: 'rgba(0,229,255,0.02)', borderLeft: `2px solid ${color}` }}>
      <span style={{ fontSize: 7, letterSpacing: '0.15em', color: 'var(--text-dim)' }}>{ts}</span>
      <span style={{ fontSize: 7, marginLeft: 6, color }}>{note.kind.toUpperCase()}</span>
      <div style={{ marginTop: 2, color: 'var(--text-primary)' }}>{note.content}</div>
    </div>
  );
}

function Field({ label, value, accent = 'var(--accent-primary)' }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'var(--text-dim)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 10, color: accent, lineHeight: 1.55, padding: '6px 8px', background: 'rgba(0,229,255,0.04)', borderLeft: `2px solid ${accent}` }}>{value}</div>
    </div>
  );
}

const closeBtnStyle: React.CSSProperties = {
  background: 'rgba(255,59,59,0.08)', border: '1px solid rgba(255,59,59,0.3)',
  borderRadius: 3, color: '#ff5577', width: 22, height: 22, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
};
const initBtnStyle: React.CSSProperties = {
  background: 'rgba(0,229,255,0.18)', border: '1px solid rgba(0,229,255,0.55)',
  borderRadius: 3, color: 'var(--accent-bright)',
  padding: '6px 14px', fontSize: 9, letterSpacing: '0.2em', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700,
  boxShadow: '0 0 8px rgba(0,229,255,0.3)',
};
const deinitBtnStyle: React.CSSProperties = {
  background: 'rgba(255,140,0,0.08)', border: '1px solid rgba(255,140,0,0.4)',
  borderRadius: 3, color: 'var(--accent-amber)',
  padding: '6px 14px', fontSize: 9, letterSpacing: '0.2em', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700,
};
const signOffBtnStyle: React.CSSProperties = {
  background: 'rgba(0,255,157,0.1)', border: '1px solid rgba(0,255,157,0.4)',
  borderRadius: 3, color: 'var(--accent-green)',
  padding: '6px 14px', fontSize: 9, letterSpacing: '0.2em', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700,
};
const launchBtnStyle: React.CSSProperties = {
  background: 'rgba(0,229,255,0.15)', border: '1px solid rgba(0,229,255,0.4)',
  borderRadius: 3, color: 'var(--accent-primary)',
  padding: '5px 11px', fontSize: 9, letterSpacing: '0.2em', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700,
};
const resumeBtnStyle: React.CSSProperties = { ...signOffBtnStyle, color: 'var(--accent-primary)', borderColor: 'rgba(0,229,255,0.4)', background: 'rgba(0,229,255,0.1)' };
const newBtnStyle: React.CSSProperties = {
  background: 'rgba(0,229,255,0.08)', border: '1px solid rgba(0,229,255,0.3)',
  borderRadius: 3, color: 'var(--accent-primary)', padding: '4px 9px', fontSize: 9, letterSpacing: '0.15em', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700,
};
const miniBtnRedStyle: React.CSSProperties = {
  background: 'rgba(255,140,0,0.08)', border: '1px solid rgba(255,140,0,0.4)',
  borderRadius: 3, color: 'var(--accent-amber)', padding: '3px 8px', fontSize: 8, letterSpacing: '0.15em', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700,
};
const inputStyle: React.CSSProperties = {
  flex: 1, background: 'rgba(0,15,30,0.8)', border: '1px solid rgba(0,229,255,0.3)',
  borderRadius: 3, padding: '6px 8px', color: 'var(--text-primary)', fontSize: 10, fontFamily: 'inherit', outline: 'none',
};
const confirmBtnStyle: React.CSSProperties = {
  background: 'rgba(0,255,157,0.15)', border: '1px solid rgba(0,255,157,0.5)',
  borderRadius: 3, color: 'var(--accent-green)', padding: '0 10px', fontSize: 9, letterSpacing: '0.15em', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700,
};
const cancelBtnStyle: React.CSSProperties = {
  background: 'rgba(255,59,59,0.08)', border: '1px solid rgba(255,59,59,0.3)',
  borderRadius: 3, color: '#ff5577', padding: '0 8px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
};
