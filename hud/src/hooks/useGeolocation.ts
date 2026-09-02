'use client';
import { useEffect } from 'react';
import { disposePreciseLocation, initializePreciseLocation } from '@/lib/geolocation';

/**
 * Start live location automatically only when browser permission was already
 * granted. Otherwise the status bar presents a user-initiated permission flow.
 */
export function useGeolocation() {
  useEffect(() => {
    void initializePreciseLocation();
    return disposePreciseLocation;
  }, []);
}
