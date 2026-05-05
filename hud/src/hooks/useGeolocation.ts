'use client';
import { useEffect } from 'react';
import { authFetch } from '@/lib/auth';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

/**
 * On HUD mount, ask the browser for a precise geolocation fix, reverse-geocode
 * it for a human-readable city/region, and push it to the Jarvis server. The
 * server uses this for "near me" queries (worldview.nearby, weather, etc.).
 *
 * - One-shot, NOT a watch — keeps battery and privacy noise low.
 * - Re-runs every 15 minutes if the page stays open.
 * - Silent on permission denied (we just fall through to IP-locate).
 */
export function useGeolocation() {
  useEffect(() => {
    let stopped = false;

    async function pushFix() {
      if (stopped) return;
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        console.warn('[Geo] navigator.geolocation unavailable (insecure context?)');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          const accuracyM = Math.round(pos.coords.accuracy);
          let city: string | undefined;
          let region: string | undefined;
          try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14&accept-language=en`, {
              headers: { 'Accept': 'application/json' },
              signal: AbortSignal.timeout(5000),
            });
            const j = await res.json() as { address?: Record<string, string> };
            const a = j.address || {};
            city = a['city'] || a['town'] || a['village'] || a['suburb'] || a['neighbourhood'];
            region = a['state'] || a['region'] || a['province'];
          } catch { /* reverse lookup is best-effort */ }
          try {
            await authFetch(`${API}/api/location`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ lat, lon, accuracyM, city, region }),
            });
            console.log(`[Geo] ✓ Pushed fix: ${city || lat.toFixed(4)}, ${region || lon.toFixed(4)} (±${accuracyM}m)`);
          } catch { /* server might be down */ }
        },
        (err) => {
          console.warn(`[Geo] permission denied / error:`, err.code, err.message);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 5 * 60_000 }
      );
    }

    // Initial push, then refresh every 15 min while the tab is open.
    pushFix();
    const t = setInterval(pushFix, 15 * 60_000);
    return () => { stopped = true; clearInterval(t); };
  }, []);
}
