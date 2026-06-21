import { supabase } from './supabaseClient';
import { Driver, TruckClass } from '@/types';

interface RawDriverProfile {
  id: string;
  full_name: string;
  username: string | null;
  phone: string | null;
  plate_number: string;
  truck_class: string;
  driver_status: string;
  avatar_initials: string | null;
  user_profiles?: { email: string } | null;
}

function mapDriver(raw: RawDriverProfile): Driver {
  return {
    id: raw.id,
    fullName: raw.full_name,
    username: raw.username ?? '',
    email: raw.user_profiles?.email ?? '',
    phone: raw.phone ?? '',
    plateNumber: raw.plate_number,
    truckClass: raw.truck_class as TruckClass,
    emailVerified: true, // if they can sign in, they're verified
    status: raw.driver_status as Driver['status'],
    avatarInitials: raw.avatar_initials ?? raw.full_name.substring(0, 2).toUpperCase(),
  };
}

/** Fetch all drivers (admin view) */
export async function fetchAllDrivers(): Promise<{ drivers: Driver[]; error: string | null }> {
  // Fetch driver_profiles and user_profiles in parallel, then merge by id
  const [dpRes, upRes] = await Promise.all([
    supabase.from('driver_profiles').select('*').order('full_name', { ascending: true }),
    supabase.from('user_profiles').select('id, email'),
  ]);

  if (dpRes.error) {
    console.warn('[drivers] fetch error:', dpRes.error.message);
    return { drivers: [], error: dpRes.error.message };
  }

  const emailMap: Record<string, string> = {};
  (upRes.data ?? []).forEach((up: { id: string; email: string }) => { emailMap[up.id] = up.email; });

  const raw = (dpRes.data as RawDriverProfile[]).map(d => ({
    ...d,
    user_profiles: emailMap[d.id] ? { email: emailMap[d.id] } : null,
  }));

  return { drivers: raw.map(mapDriver), error: null };
}

/** Fetch a single driver profile */
export async function fetchDriver(id: string): Promise<{ driver: Driver | null; error: string | null }> {
  const [dpRes, upRes] = await Promise.all([
    supabase.from('driver_profiles').select('*').eq('id', id).maybeSingle(),
    supabase.from('user_profiles').select('id, email').eq('id', id).maybeSingle(),
  ]);

  if (dpRes.error) return { driver: null, error: dpRes.error.message };
  if (!dpRes.data) return { driver: null, error: null }; // no profile row yet
  const raw = { ...dpRes.data as RawDriverProfile, user_profiles: upRes.data ? { email: (upRes.data as { id: string; email: string }).email } : null };
  return { driver: mapDriver(raw), error: null };
}

/** Update driver online status */
export async function updateDriverStatus(id: string, status: 'Active' | 'Idle' | 'Offline'): Promise<string | null> {
  const { error } = await supabase
    .from('driver_profiles')
    .update({ driver_status: status, updated_at: new Date().toISOString() })
    .eq('id', id);
  return error?.message ?? null;
}

export interface UpdateDriverProfileInput {
  fullName?: string;
  phone?: string;
  username?: string;
  plateNumber?: string;
  truckClass?: string;
}

/** Update driver profile fields */
export async function updateDriverProfile(
  id: string,
  input: UpdateDriverProfileInput
): Promise<string | null> {
  // Use a typed object so we can assign null for optional fields
  const updates: Record<string, string | null> = { updated_at: new Date().toISOString() };
  if (input.fullName !== undefined && input.fullName.trim()) {
    updates.full_name = input.fullName.trim();
    updates.avatar_initials = input.fullName.trim().substring(0, 2).toUpperCase();
  }
  if (input.phone !== undefined) updates.phone = input.phone.trim() || null;
  // Convert empty username to NULL to avoid unique constraint violation
  if (input.username !== undefined) updates.username = input.username.trim() || null;
  if (input.plateNumber !== undefined && input.plateNumber.trim()) updates.plate_number = input.plateNumber.trim();
  if (input.truckClass !== undefined && input.truckClass.trim()) updates.truck_class = input.truckClass.trim();

  const { error } = await supabase
    .from('driver_profiles')
    .update(updates)
    .eq('id', id);

  if (error) {
    console.warn('[driverService] updateDriverProfile error:', error.message, error.code);
    return error.message;
  }
  return null;
}
