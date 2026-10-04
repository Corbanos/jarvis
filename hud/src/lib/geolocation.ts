'use client';

import { create } from 'zustand';
import { authFetch } from '@/lib/auth';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';
const PUBLISH_INTERVAL_MS = 60_000;
const REVERSE_GEOCODE_INTERVAL_MS = 15 * 60_000;

export type PreciseLocationStatus =
  | 'checking'
  | 'prompt'
  | 'requesting'
  | 'active'
  | 'denied'
  | 'unavailable'
  | 'error';

interface PublishedFix {
  accuracyM: number;
  sentAt: number;
}

interface PreciseLocationState {
  status: PreciseLocationStatus;
  accuracyM: number | null;
  updatedAt: number | null;
  message: string;
  setState: (state: Partial<Omit<PreciseLocationState, 'setState'>>) => void;
}

export function shouldPublishLocationFix(
  previous: PublishedFix | null,
  nextAccuracyM: number,
  now: number,
): boolean {
  if (!previous) return true;
  if (nextAccuracyM < previous.accuracyM) return true;
  return now - previous.sentAt >= PUBLISH_INTERVAL_MS;
}

export const usePreciseLocation = create<PreciseLocationState>((set) => ({
  status: 'checking',
  accuracyM: null,
  updatedAt: null,
  message: 'Checking browser location permission.',
  setState: (state) => set(state),
}));

let publishQueue: Promise<unknown> = Promise.resolve();
let watchId: number | null = null;
let permissionStatus: PermissionStatus | null = null;
let lastPublished: PublishedFix | null = null;
let lastReverseGeocodeAt = 0;

function update(state: Partial<Omit<PreciseLocationState, 'setState'>>) {
  usePreciseLocation.getState().setState(state);
}

function browserCanLocate(): boolean {
  return typeof window !== 'undefined'
    && window.isSecureContext
    && typeof navigator !== 'undefined'
    && !!navigator.geolocation;
}

/**
 * Browsers only expose geolocation on a secure origin (https://, or
 * localhost). Over plain http:// on the LAN the API simply isn't there.
 * Returns the same page over https:// so the UI can offer the switch, or
 * null when already secure or not in a browser.
 *
 * Uses the bare hostname: the http:// page may have been reached on the HUD's
 * dev port, but TLS is only terminated by the front door on 443.
 */
export function secureUpgradeUrl(): string | null {
  if (typeof window === 'undefined' || window.isSecureContext) return null;
  const { hostname, pathname, search, hash } = window.location;
  if (!hostname) return null;
  return `https://${hostname}${pathname}${search}${hash}`;
}

function revokeLocation(): void {
  lastPublished = null;
  update({ accuracyM: null, updatedAt: null });
  publishQueue = publishQueue.catch(() => {}).then(() => authFetch(`${API}/api/location`, { method: 'DELETE' })).catch(() => {});
}

function markUnavailable(): void {
  revokeLocation();
  const upgrade = secureUpgradeUrl();
  update({
    status: 'unavailable',
    message: upgrade
      ? 'Browsers only share location with https:// pages. Click to reopen the HUD securely — on a phone, first install the certificate from /jarvis-ca.crt.'
      : 'This browser does not support geolocation.',
  });
}

async function publishFix(position: GeolocationPosition, includeLabels = false): Promise<void> {
  const payload: Record<string, unknown> = {
    lat: position.coords.latitude,
    lon: position.coords.longitude,
    accuracyM: Math.round(position.coords.accuracy),
  };

  const response = await authFetch(`${API}/api/location`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`location update failed (${response.status})`);
}

function handlePosition(position: GeolocationPosition): void {
  const now = Date.now();
  const accuracyM = Math.max(0, Math.round(position.coords.accuracy));
  update({
    status: 'active',
    accuracyM,
    updatedAt: now,
    message: `Live browser location is accurate to approximately ${accuracyM} metres.`,
  });

  if (!shouldPublishLocationFix(lastPublished, accuracyM, now)) return;
  lastPublished = { accuracyM, sentAt: now };
  const includeLabels = now - lastReverseGeocodeAt >= REVERSE_GEOCODE_INTERVAL_MS;
  if (includeLabels) lastReverseGeocodeAt = now;
  publishQueue = publishQueue.catch(() => {}).then(() => publishFix(position, includeLabels)).catch(() => {
    lastPublished = null;
    update({ message: 'Precise location acquired, but the Jarvis server did not accept the update.' });
  });
}

function handlePositionError(error: GeolocationPositionError): void {
  if (error.code === error.PERMISSION_DENIED) {
    stopPreciseLocation();
    revokeLocation();
    update({
      status: 'denied',
      message: "Location is blocked. Allow Location for this site and in this device's Location Services, then retry.",
    });
    return;
  }
  update({
    status: error.code === error.POSITION_UNAVAILABLE ? 'unavailable' : 'error',
    message: error.code === error.TIMEOUT
      ? "Location timed out. Check this device's Location Services and retry."
      : 'A precise browser location is currently unavailable.',
  });
}

export function requestPreciseLocation(): void {
  if (!browserCanLocate()) {
    // On an insecure page the only fix is the secure page — take them there.
    const upgrade = secureUpgradeUrl();
    if (upgrade) { window.location.assign(upgrade); return; }
    markUnavailable();
    return;
  }

  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  update({ status: 'requesting', message: 'Waiting for a high-accuracy browser location fix.' });
  watchId = navigator.geolocation.watchPosition(handlePosition, handlePositionError, {
    enableHighAccuracy: true,
    timeout: 30_000,
    maximumAge: 0,
  });
}

export function stopPreciseLocation(): void {
  if (watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId);
  }
  watchId = null;
}

async function loadServerLocation(): Promise<void> {
  try {
    const response = await authFetch(`${API}/api/location`);
    if (!response.ok) return;
    const result = await response.json() as {
      fresh: boolean;
      location: { accuracyM?: number; updatedAt: number; source: string } | null;
    };
    if (result.fresh && result.location?.source === 'browser') {
      update({
        status: 'active',
        accuracyM: result.location.accuracyM ?? null,
        updatedAt: result.location.updatedAt,
        message: 'Using the most recent precise browser location while a live fix starts.',
      });
    }
  } catch { /* server may still be starting */ }
}

export async function initializePreciseLocation(): Promise<void> {
  await loadServerLocation();
  if (!browserCanLocate()) {
    markUnavailable();
    return;
  }

  if (!navigator.permissions?.query) {
    if (usePreciseLocation.getState().status !== 'active') {
      update({ status: 'prompt', message: 'Click to allow precise browser location.' });
    }
    return;
  }

  try {
    permissionStatus = await navigator.permissions.query({ name: 'geolocation' });
    const applyPermission = () => {
      if (permissionStatus?.state === 'granted') requestPreciseLocation();
      else if (permissionStatus?.state === 'denied') {
        stopPreciseLocation();
        revokeLocation();
        update({
          status: 'denied',
          message: "Location is blocked. Allow Location for this site and in this device's Location Services, then retry.",
        });
      } else if (usePreciseLocation.getState().status !== 'active') {
        update({ status: 'prompt', message: 'Click to allow precise browser location.' });
      }
    };
    permissionStatus.onchange = applyPermission;
    applyPermission();
  } catch {
    update({ status: 'prompt', message: 'Click to allow precise browser location.' });
  }
}

export function disposePreciseLocation(): void {
  stopPreciseLocation();
  if (permissionStatus) permissionStatus.onchange = null;
  permissionStatus = null;
}
