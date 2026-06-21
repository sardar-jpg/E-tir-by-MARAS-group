import { supabase } from './supabaseClient';

export interface LocationPoint {
  id: string;
  lat: number;
  lng: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  recordedAt: string; // ISO string
}

/**
 * Fetch GPS breadcrumbs for a shipment, ordered oldest → newest.
 * Returns at most `limit` points (default 500).
 */
export async function fetchLocationHistory(
  shipmentId: string,
  limit = 500,
): Promise<{ points: LocationPoint[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('location_history')
      .select('id, lat, lng, accuracy, speed, heading, recorded_at')
      .eq('shipment_id', shipmentId)
      .order('recorded_at', { ascending: true })
      .limit(limit);

    if (error) return { points: [], error: error.message };

    const points: LocationPoint[] = (data ?? []).map((row: any) => ({
      id: row.id,
      lat: row.lat,
      lng: row.lng,
      accuracy: row.accuracy ?? undefined,
      speed: row.speed ?? undefined,
      heading: row.heading ?? undefined,
      recordedAt: row.recorded_at,
    }));

    return { points, error: null };
  } catch (e) {
    return { points: [], error: String(e) };
  }
}
