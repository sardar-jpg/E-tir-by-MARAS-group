import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import { GPS_DEFAULT_UPDATE_INTERVAL_MS } from "../../lib/gpsFreshness";
import { buildDriverLocationUpdatePayload } from "../../lib/driverJobFlow";

/**
 * feature/driver-app-comprehensive-redesign — the Driver App's location
 * reporting, extracted from DriverApplication.tsx with two corrections:
 *
 *  1. Every GPS transmission (live and cached-sync) sends ONLY location
 *     fields — buildDriverLocationUpdatePayload's { latitude, longitude,
 *     lastUpdated }. The old code spread the whole locally-cached driver
 *     record into each ping, re-submitting stale profile data on a
 *     15-minute timer. PUT /api/drivers/:id merges per-field, so a
 *     location-only body can never touch the profile.
 *  2. Reporting is keyed to `isActive` — the caller derives it from the
 *     ONE shared active-job rule (useDriverActiveJob), so it keeps
 *     running through "Arrived" and stops exactly when no
 *     driver-submittable status remains (Delivered onward). It is no
 *     longer tied to which shipment the driver happens to have OPEN in
 *     the UI.
 *
 * Everything else is behavior-preserving: eTIR sends a fix every
 * GPS_DEFAULT_UPDATE_INTERVAL_MS (15 min default, battery-friendly — not
 * live per-second tracking), caches fixes locally while offline or
 * rate-limit-cooled-down (429 → 30s cooldown), and syncs the cache back
 * once online.
 */
export interface DriverLocationReporting {
  /** null = not applicable/not yet checked, true = live fix obtained, false = unavailable/denied. */
  gpsAvailable: boolean | null;
  lastGpsCoords: { lat: number; lng: number } | null;
  isSyncing: boolean;
  cachedCount: number;
  /**
   * One-shot fix + transmit for "just accepted a job" moments — the
   * interval loop takes over afterwards. onUnavailable fires when the
   * device can't produce a fix, so the caller can show a plain-language
   * prompt to enable GPS.
   */
  requestImmediateFix: (onUnavailable?: () => void) => void;
}

export function useDriverLocationReporting(options: {
  driverId: string;
  /** Location reporting window — from the shared active-job rule, never UI selection. */
  isActive: boolean;
  /** Developer/offline simulation switch. */
  isForceOffline: boolean;
  /** Surfaced when a full cache sync fails so recent positions haven't reached dispatch. */
  onSyncFailed: () => void;
}): DriverLocationReporting {
  const { driverId, isActive, isForceOffline, onSyncFailed } = options;

  const [gpsAvailable, setGpsAvailable] = useState<boolean | null>(null);
  const [lastGpsCoords, setLastGpsCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncAttemptTime, setLastSyncAttemptTime] = useState(0);
  const gpsCooldownRef = useRef<number>(0);

  const [cachedCoords, setCachedCoords] = useState<{ lat: number; lng: number; timestamp: string }[]>(() => {
    try {
      const saved = localStorage.getItem(`etir_cached_gps_${driverId}`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(`etir_cached_gps_${driverId}`, JSON.stringify(cachedCoords));
    } catch {}
  }, [cachedCoords, driverId]);

  const cachePoint = useCallback((lat: number, lng: number, timestamp: string) => {
    setCachedCoords((prev) => [...prev, { lat, lng, timestamp }].slice(-30));
  }, []);

  const transmitGPS = useCallback(
    async (lat: number, lng: number): Promise<boolean> => {
      const timestamp = new Date().toISOString();
      const isOffline = isForceOffline || !navigator.onLine;

      // Cache locally while offline or under the rate-limit cooldown.
      if (isOffline || Date.now() < gpsCooldownRef.current) {
        cachePoint(lat, lng, timestamp);
        return false;
      }

      try {
        const res = await apiFetch(`/api/drivers/${driverId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          // Location fields ONLY — never a spread of the driver profile.
          body: JSON.stringify(buildDriverLocationUpdatePayload(lat, lng, timestamp)),
        });

        if (res.status === 429) {
          // 30-second client-side cooldown to protect the backend.
          gpsCooldownRef.current = Date.now() + 30000;
          cachePoint(lat, lng, timestamp);
          return false;
        }
        if (!res.ok) {
          throw new Error("HTTP error status " + res.status);
        }
        return true;
      } catch (err: any) {
        console.warn("GPS transmission failed, caching coordinates locally:", err?.message || err);
        cachePoint(lat, lng, timestamp);
        return false;
      }
    },
    [driverId, isForceOffline, cachePoint]
  );

  // Sync cached points back once the connection is restored.
  const triggerGpsSync = useCallback(async () => {
    if (isSyncing || cachedCoords.length === 0) return;
    setIsSyncing(true);
    setLastSyncAttemptTime(Date.now());
    const itemsToSync = [...cachedCoords];
    try {
      let syncedCount = 0;
      for (const item of itemsToSync) {
        const res = await apiFetch(`/api/drivers/${driverId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildDriverLocationUpdatePayload(item.lat, item.lng, item.timestamp)),
        });
        if (res.ok) syncedCount++;
        await new Promise((r) => setTimeout(r, 200));
      }
      if (syncedCount === 0 && itemsToSync.length > 0) {
        onSyncFailed();
      } else {
        setCachedCoords([]);
      }
    } catch (e) {
      console.error("GPS cache synchronization failed:", e);
    } finally {
      setIsSyncing(false);
      setLastSyncAttemptTime(Date.now());
    }
  }, [isSyncing, cachedCoords, driverId, onSyncFailed]);

  // Auto-sync when back online (throttled to one attempt per 15s).
  useEffect(() => {
    const isOnline = !isForceOffline && navigator.onLine;
    const now = Date.now();
    if (isOnline && cachedCoords.length > 0 && !isSyncing && now - lastSyncAttemptTime > 15000) {
      triggerGpsSync();
    }
  }, [isForceOffline, cachedCoords.length, isSyncing, lastSyncAttemptTime, triggerGpsSync]);

  const pollOnce = useCallback(
    (onUnavailable?: () => void) => {
      if (!navigator.geolocation) {
        setGpsAvailable(false);
        onUnavailable?.();
        return;
      }
      try {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            setGpsAvailable(true);
            setLastGpsCoords({ lat, lng });
            transmitGPS(lat, lng);
          },
          (err) => {
            console.warn("[GPS] Location unavailable:", err.message);
            setGpsAvailable(false);
            onUnavailable?.();
          },
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
        );
      } catch (err) {
        console.warn("[GPS] Geolocation blocked:", err);
        setGpsAvailable(false);
        onUnavailable?.();
      }
    },
    [transmitGPS]
  );

  // The reporting loop itself. Runs the whole time a job is underway —
  // through "Arrived" — and stops only when isActive turns false
  // (Delivered onward, or no active job at all).
  useEffect(() => {
    if (!isActive) {
      setGpsAvailable(null);
      return;
    }
    pollOnce();
    const interval = setInterval(() => pollOnce(), GPS_DEFAULT_UPDATE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isActive, driverId, pollOnce]);

  return {
    gpsAvailable,
    lastGpsCoords,
    isSyncing,
    cachedCount: cachedCoords.length,
    requestImmediateFix: pollOnce,
  };
}
