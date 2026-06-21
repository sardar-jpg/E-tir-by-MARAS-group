/**
 * locationService.ts
 *
 * Provides foreground + background GPS tracking for driver shipments.
 *
 * Background strategy:
 *  - Uses expo-task-manager + Location.startLocationUpdatesAsync so GPS
 *    continues when the driver locks their phone or switches apps.
 *  - Shipment ID and Driver ID are persisted in AsyncStorage so the
 *    background task can read them without component context.
 *  - The TaskManager.defineTask call MUST be at module top-level so Expo
 *    can register it during app boot before any component mounts.
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { supabase } from './supabaseClient';

// ── Constants ──────────────────────────────────────────────────────────────
export const BACKGROUND_LOCATION_TASK = 'ETIR_BACKGROUND_LOCATION';

const STORAGE_KEY_SHIPMENT_ID = '@etir_bg_shipment_id';
const STORAGE_KEY_DRIVER_ID   = '@etir_bg_driver_id';

// ── Types ──────────────────────────────────────────────────────────────────
export interface LocationCoords {
  lat: number;
  lng: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
}

export interface TrackingState {
  coords: LocationCoords;
  updatedAt: Date;
  updateCount: number;
  lastPersistOk: boolean;
  isBackground?: boolean;
}

// ── Module-level state (foreground) ───────────────────────────────────────
let _watchSubscription: Location.LocationSubscription | null = null;
let _shipmentId: string | null = null;
let _onUpdate: ((coords: LocationCoords) => void) | null = null;
let _onTrackingState: ((state: TrackingState) => void) | null = null;
let _updateCount = 0;

// ── Background task definition ─────────────────────────────────────────────
// This MUST be at module top-level — Expo registers tasks on boot.
if (Platform.OS !== 'web') {
  TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: any) => {
    if (error) {
      console.log('[GPS BG] Task error:', error.message);
      return;
    }

    const locations: Location.LocationObject[] = data?.locations ?? [];
    if (!locations.length) return;

    // Read persisted context from AsyncStorage
    let shipmentId: string | null = null;
    let driverId: string | null = null;
    try {
      [shipmentId, driverId] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY_SHIPMENT_ID),
        AsyncStorage.getItem(STORAGE_KEY_DRIVER_ID),
      ]);
    } catch (e) {
      console.log('[GPS BG] AsyncStorage read failed:', String(e));
      return;
    }

    if (!shipmentId) {
      console.log('[GPS BG] No shipment ID stored — skipping update');
      return;
    }

    // Use the most recent location from the batch
    const pos = locations[locations.length - 1];
    const coords: LocationCoords = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy ?? undefined,
      heading: pos.coords.heading ?? undefined,
      speed: pos.coords.speed ?? undefined,
    };

    const now = new Date().toISOString();

    // Update live position on shipment row
    try {
      await supabase
        .from('shipments')
        .update({ lat: coords.lat, lng: coords.lng, updated_at: now })
        .eq('id', shipmentId);
    } catch (e) {
      console.log('[GPS BG] Failed to update shipment position:', String(e));
    }

    // Log breadcrumb to location_history
    try {
      await supabase.from('location_history').insert({
        shipment_id: shipmentId,
        driver_id: driverId,
        lat: coords.lat,
        lng: coords.lng,
        accuracy: coords.accuracy ?? null,
        speed: coords.speed ?? null,
        heading: coords.heading ?? null,
        recorded_at: now,
      });
    } catch (e) {
      console.log('[GPS BG] Failed to log history breadcrumb:', String(e));
    }

    console.log(`[GPS BG] Update logged for ${shipmentId} — ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`);
  });
}

// ── Permission helpers ─────────────────────────────────────────────────────

/** Request foreground + background location permissions */
export async function requestLocationPermission(): Promise<{
  foreground: boolean;
  background: boolean;
}> {
  if (Platform.OS === 'web') return { foreground: false, background: false };

  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return { foreground: false, background: false };

  // Background permission is only needed on native
  let bgGranted = false;
  try {
    const bg = await Location.requestBackgroundPermissionsAsync();
    bgGranted = bg.status === 'granted';
  } catch {
    // Some Expo Go versions don't support background — continue with foreground only
    bgGranted = false;
  }

  return { foreground: true, background: bgGranted };
}

/** Get current position once */
export async function getCurrentLocation(): Promise<LocationCoords | null> {
  if (Platform.OS === 'web') return null;
  const { foreground } = await requestLocationPermission();
  if (!foreground) return null;
  try {
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy ?? undefined,
      heading: pos.coords.heading ?? undefined,
      speed: pos.coords.speed ?? undefined,
    };
  } catch {
    return null;
  }
}

// ── Background task control ────────────────────────────────────────────────

/** Start the background location task (registered with expo-task-manager) */
async function startBackgroundTask(shipmentId: string, driverId: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  try {
    // Persist context for the background task
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEY_SHIPMENT_ID, shipmentId),
      AsyncStorage.setItem(STORAGE_KEY_DRIVER_ID, driverId),
    ]);

    const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
    if (alreadyRunning) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {});
    }

    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 15000,        // 15 seconds minimum interval
      distanceInterval: 50,       // or 50 metres displacement
      showsBackgroundLocationIndicator: true, // iOS blue bar
      foregroundService: {         // Android foreground service notification
        notificationTitle: 'e-tir Gateway — GPS Active',
        notificationBody: 'Live location sharing is active for your shipment.',
        notificationColor: '#2F81F7',
      },
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.AutomotiveNavigation,
      deferredUpdatesInterval: 0,
      deferredUpdatesDistance: 0,
    });

    return true;
  } catch (e) {
    console.log('[GPS BG] Failed to start background task:', String(e));
    return false;
  }
}

/** Stop the background location task */
async function stopBackgroundTask(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const running = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
    if (running) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
  } catch (e) {
    console.log('[GPS BG] Failed to stop background task:', String(e));
  }
  try {
    await Promise.all([
      AsyncStorage.removeItem(STORAGE_KEY_SHIPMENT_ID),
      AsyncStorage.removeItem(STORAGE_KEY_DRIVER_ID),
    ]);
  } catch {}
}

/** Returns true if the background location task is currently registered and running */
export async function isBackgroundTrackingActive(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  } catch {
    return false;
  }
}

// ── Main tracking API ─────────────────────────────────────────────────────

/**
 * Start continuous GPS tracking for a shipment.
 *
 * Behaviour:
 *  1. Requests foreground + background permissions.
 *  2. Fires an immediate position fix.
 *  3. Starts the background task (works when app is backgrounded/locked).
 *  4. Starts a foreground watchPosition for live UI updates in-app.
 *
 * @returns `{ ok, backgroundEnabled }` — `ok` means tracking started;
 *          `backgroundEnabled` indicates whether the background task is active.
 */
export async function startTracking(
  shipmentId: string,
  onUpdate?: (coords: LocationCoords) => void,
  onTrackingState?: (state: TrackingState) => void,
): Promise<{ ok: boolean; backgroundEnabled: boolean }> {
  if (Platform.OS === 'web') return { ok: false, backgroundEnabled: false };

  // Clean up any previous session first
  await _cleanupForeground();
  await stopBackgroundTask();

  const { foreground, background } = await requestLocationPermission();
  if (!foreground) return { ok: false, backgroundEnabled: false };

  // Get current user for driver ID
  let driverId = '';
  try {
    const { data: { user } } = await supabase.auth.getUser();
    driverId = user?.id ?? '';
  } catch {}

  _shipmentId = shipmentId;
  _onUpdate = onUpdate ?? null;
  _onTrackingState = onTrackingState ?? null;
  _updateCount = 0;

  // Immediate first fix
  const initial = await getCurrentLocation();
  if (initial) {
    _onUpdate?.(initial);
    await _persistForeground(shipmentId, driverId, initial);
  }

  // Start background task (handles locked screen / app switch)
  let backgroundEnabled = false;
  if (background) {
    backgroundEnabled = await startBackgroundTask(shipmentId, driverId);
  }

  // Start foreground watcher for live UI updates
  try {
    _watchSubscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 15000,
        distanceInterval: 50,
      },
      async (pos) => {
        const coords: LocationCoords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? undefined,
          heading: pos.coords.heading ?? undefined,
          speed: pos.coords.speed ?? undefined,
        };
        _onUpdate?.(coords);
        // Only persist from foreground if background task is NOT running
        // (avoid double-writes; background task handles its own persistence)
        if (!backgroundEnabled) {
          await _persistForeground(shipmentId, driverId, coords);
        } else {
          // Still fire the UI callback with fresh data
          _updateCount += 1;
          _onTrackingState?.({
            coords,
            updatedAt: new Date(),
            updateCount: _updateCount,
            lastPersistOk: true,
            isBackground: backgroundEnabled,
          });
        }
      },
    );
  } catch (e) {
    console.log('[GPS FG] watchPositionAsync error:', String(e));
    // If foreground watcher fails but background task is running, that's still ok
    if (!backgroundEnabled) return { ok: false, backgroundEnabled: false };
  }

  return { ok: true, backgroundEnabled };
}

/** Stop GPS tracking completely (foreground + background) */
export async function stopTracking(): Promise<void> {
  await _cleanupForeground();
  await stopBackgroundTask();
}

/** Returns true if the foreground watcher is currently active */
export function isTracking(): boolean {
  return _watchSubscription !== null;
}

// ── Internal helpers ───────────────────────────────────────────────────────

function _cleanupForeground(): Promise<void> {
  _watchSubscription?.remove();
  _watchSubscription = null;
  _shipmentId = null;
  _onUpdate = null;
  _onTrackingState = null;
  _updateCount = 0;
  return Promise.resolve();
}

/** Write lat/lng to shipments table + log to location_history; fires UI callback */
async function _persistForeground(
  shipmentId: string,
  driverId: string,
  coords: LocationCoords,
): Promise<void> {
  _updateCount += 1;
  let ok = true;
  const now = new Date().toISOString();

  try {
    const { error } = await supabase
      .from('shipments')
      .update({ lat: coords.lat, lng: coords.lng, updated_at: now })
      .eq('id', shipmentId);
    if (error) {
      ok = false;
      console.log('[GPS FG] Supabase persist error:', error.message);
    }
  } catch (e) {
    ok = false;
    console.log('[GPS FG] Failed to persist location:', String(e));
  }

  // Log breadcrumb
  try {
    await supabase.from('location_history').insert({
      shipment_id: shipmentId,
      driver_id: driverId || null,
      lat: coords.lat,
      lng: coords.lng,
      accuracy: coords.accuracy ?? null,
      speed: coords.speed ?? null,
      heading: coords.heading ?? null,
      recorded_at: now,
    });
  } catch (e) {
    console.log('[GPS FG] Failed to log history breadcrumb:', String(e));
  }

  _onTrackingState?.({
    coords,
    updatedAt: new Date(),
    updateCount: _updateCount,
    lastPersistOk: ok,
    isBackground: false,
  });
}

// ── Formatting utilities ──────────────────────────────────────────────────

/** Format speed in km/h from m/s */
export function formatSpeed(mps: number | undefined): string {
  if (mps == null || mps < 0) return '—';
  return `${Math.round(mps * 3.6)} km/h`;
}

/** Format heading as compass direction */
export function formatHeading(deg: number | undefined): string {
  if (deg == null || deg < 0) return '—';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

/** Format accuracy in metres */
export function formatAccuracy(m: number | undefined): string {
  if (m == null) return '—';
  return m < 10 ? `±${m.toFixed(1)} m` : `±${Math.round(m)} m`;
}
