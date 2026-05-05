'use client';
import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/auth';

interface Job {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  scheduleType: string;
  nextRun: number;
  lastRun?: number;
  enabled: boolean;
}

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

export function SchedulerPanel() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchJobs = async () => {
    try {
      const res = await authFetch(`${API}/api/jobs`);
      const data = await res.json() as Job[];
      setJobs(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchJobs();
    const t = setInterval(fetchJobs, 10000);
    return () => clearInterval(t);
  }, []);

  const deleteJob = async (id: string) => {
    await authFetch(`${API}/api/jobs/${id}`, { method: 'DELETE' });
    fetchJobs();
  };

  const toggleJob = async (id: string, enabled: boolean) => {
    await authFetch(`${API}/api/jobs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    fetchJobs();
  };

  const timeUntil = (ts: number) => {
    const diff = ts - Date.now();
    if (diff < 0) return 'overdue';
    const m = Math.floor(diff / 60000);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d ${h % 24}h`;
    if (h > 0) return `${h}h ${m % 60}m`;
    return `${m}m`;
  };

  if (loading) {
    return <div style={{ padding: 12, color: 'var(--text-dim)', fontSize: 10, letterSpacing: '0.15em' }}>LOADING...</div>;
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Timeline */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {jobs.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 10, letterSpacing: '0.15em', textAlign: 'center', marginTop: 20 }}>
            NO SCHEDULED TASKS
          </div>
        ) : (
          jobs.map((job) => <JobRow key={job.id} job={job} onDelete={deleteJob} onToggle={toggleJob} timeUntil={timeUntil} />)
        )}
      </div>

      {/* Footer: quick stats */}
      <div style={{
        borderTop: '1px solid rgba(0,229,255,0.1)',
        padding: '6px 12px',
        display: 'flex',
        gap: 16,
        fontSize: 9,
        color: 'var(--text-dim)',
        letterSpacing: '0.12em',
      }}>
        <span>TOTAL: {jobs.length}</span>
        <span style={{ color: 'var(--accent-green)' }}>ACTIVE: {jobs.filter((j) => j.enabled).length}</span>
        <span style={{ color: 'var(--accent-amber)' }}>NEXT: {jobs.filter((j) => j.enabled).sort((a, b) => a.nextRun - b.nextRun)[0]?.name ?? '—'}</span>
      </div>
    </div>
  );
}

function JobRow({ job, onDelete, onToggle, timeUntil }: {
  job: Job;
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  timeUntil: (ts: number) => string;
}) {
  const color = job.enabled ? 'var(--accent-primary)' : 'var(--text-dim)';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 8px',
      background: 'rgba(0,20,40,0.4)',
      border: `1px solid ${job.enabled ? 'rgba(0,229,255,0.12)' : 'rgba(255,255,255,0.04)'}`,
      borderRadius: 2,
      animation: 'slide-in-right 0.2s ease',
    }}>
      {/* Status dot */}
      <div style={{
        width: 5, height: 5, borderRadius: '50%',
        background: job.enabled ? 'var(--accent-green)' : 'var(--text-dim)',
        flexShrink: 0,
      }} />

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, color, fontWeight: 600, letterSpacing: '0.08em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {job.name}
        </div>
        <div style={{ fontSize: 8, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {job.prompt.slice(0, 50)}
        </div>
      </div>

      {/* Time */}
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 10, color: 'var(--accent-amber)', fontWeight: 600 }}>{timeUntil(job.nextRun)}</div>
        <div style={{ fontSize: 8, color: 'var(--text-dim)' }}>{job.scheduleType.toUpperCase()}</div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <button
          onClick={() => onToggle(job.id, !job.enabled)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: job.enabled ? 'var(--accent-amber)' : 'var(--accent-green)', fontSize: 10, padding: '2px 4px' }}
        >
          {job.enabled ? '⏸' : '▶'}
        </button>
        <button
          onClick={() => onDelete(job.id)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', fontSize: 10, padding: '2px 4px' }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
