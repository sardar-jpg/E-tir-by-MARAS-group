import { supabase } from './supabaseClient';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

export interface RegisterDriverData {
  fullName: string;
  username: string;
  email: string;
  phone: string;
  plateNumber: string;
  truckClass: string;
  password: string;
}

/** One-time bootstrap: create the admin user via edge function */
export async function bootstrapAdminUser(): Promise<void> {
  try {
    const { data, error } = await supabase.functions.invoke('create-admin');
    if (error) {
      let msg = error.message;
      try {
        const text = await (error as any).context?.text?.();
        if (text) msg = text;
      } catch {}
      console.log('[Bootstrap] create-admin error:', msg);
    } else {
      console.log('[Bootstrap] create-admin success:', JSON.stringify(data));
    }
  } catch (e) {
    console.log('[Bootstrap] create-admin exception:', String(e));
  }
}

/** Sign up a new driver — creates auth user + driver_profile row */
export async function registerDriver(data: RegisterDriverData) {
  const initials = data.fullName
    .split(' ')
    .slice(0, 2)
    .map(n => n[0]?.toUpperCase() ?? '')
    .join('');

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: data.email,
    password: data.password,
    options: {
      data: {
        full_name: data.fullName,
        username: data.username,
        phone: data.phone,
        plate_number: data.plateNumber,
        truck_class: data.truckClass,
      },
    },
  });

  if (signUpError) return { user: null, error: signUpError.message };
  if (!authData.user) return { user: null, error: 'Registration failed. Please try again.' };

  // Insert driver_profile row
  const { error: profileError } = await supabase.from('driver_profiles').insert({
    id: authData.user.id,
    full_name: data.fullName,
    username: data.username,
    phone: data.phone,
    plate_number: data.plateNumber,
    truck_class: data.truckClass,
    avatar_initials: initials,
    driver_status: 'Idle',
    approval_status: 'pending',
  });

  if (profileError) {
    // profile insert may fail if user needs email confirmation — that is OK
    console.log('Driver profile insert deferred (needs email confirm):', profileError.message);
  }

  return { user: authData.user, error: null };
}

/** Sign in with email + password */
export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { session: null, user: null, error: error.message };
  return { session: data.session, user: data.user, error: null };
}

/** Sign in with Google OAuth (works on web and native iOS/Android) */
export async function signInWithGoogle(): Promise<{ error: string | null }> {
  if (Platform.OS === 'web') {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
      },
    });
    if (error) return { error: error.message };
    return { error: null };
  }

  const redirectTo = Linking.createURL('auth/callback');

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });
  if (error) return { error: error.message };
  if (!data?.url) return { error: 'Google sign-in failed. Please try again.' };

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

  if (result.type !== 'success' || !result.url) {
    return { error: 'Google sign-in was cancelled.' };
  }

  const url = new URL(result.url.replace('#', '?'));
  const access_token = url.searchParams.get('access_token');
  const refresh_token = url.searchParams.get('refresh_token');

  if (!access_token || !refresh_token) {
    return { error: 'Google sign-in failed. Please try again.' };
  }

  const { error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token });
  if (sessionError) return { error: sessionError.message };

  return { error: null };
}

/** Delete the current user's account permanently (Apple Guideline 5.1.1(v) compliance) */
export async function deleteAccount(): Promise<{ error: string | null }> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) return { error: 'No active session found.' };

    // Call an edge function that uses the service role to delete the user
    // and cascade-delete their related rows (driver_profiles, user_profiles, etc.)
    const { error } = await supabase.functions.invoke('delete-account', {
      body: { userId },
    });

    if (error) {
      return { error: error.message ?? 'Failed to delete account. Please try again.' };
    }

    await supabase.auth.signOut();
    return { error: null };
  } catch (e: any) {
    return { error: e?.message ?? 'Failed to delete account. Please try again.' };
  }
}

/** Sign out */
export async function signOut() {
  await supabase.auth.signOut();
}

/** Get current session */
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/** Resolve login identifier: could be email, username or phone → return email */
export async function resolveLoginEmail(identifier: string): Promise<string> {
  const trimmed = identifier.trim();

  // If it looks like an email, return as-is
  if (trimmed.includes('@') && trimmed.includes('.')) return trimmed;

  // Strip leading @ if user typed @username
  const username = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;

  // Try to find driver by username in driver_profiles
  const { data: byUsername } = await supabase
    .from('driver_profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();

  const driverId = byUsername?.id;

  // Also try phone as fallback if no username match
  let resolvedId = driverId;
  if (!resolvedId) {
    const { data: byPhone } = await supabase
      .from('driver_profiles')
      .select('id')
      .eq('phone', trimmed)
      .maybeSingle();
    resolvedId = byPhone?.id;
  }

  if (resolvedId) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('email')
      .eq('id', resolvedId)
      .maybeSingle();
    if (profile?.email) return profile.email;
  }

  return trimmed; // fallback — let Supabase reject with proper error
}

/** Fetch user role — admin if email matches marasgroup.com or maras.iq domain */
export function resolveRole(email: string): 'admin' | 'driver' {
  return (email.endsWith('@marasgroup.com') || email.endsWith('@maras.iq')) ? 'admin' : 'driver';
}

/** Fetch driver profile by user id */
export async function fetchDriverProfile(userId: string) {
  const { data, error } = await supabase
    .from('driver_profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  return { profile: data as Record<string, string> | null, error };
}

/** Insert driver_profile after email verification (called on first post-verify login) */
export async function ensureDriverProfile(userId: string, fullName: string, username: string, phone: string, plateNumber: string, truckClass: string) {
  const initials = fullName.split(' ').slice(0, 2).map(n => n[0]?.toUpperCase() ?? '').join('');

  // Check if a profile already exists so we don't reset an existing approval_status
  const { data: existing } = await supabase
    .from('driver_profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  const { error } = await supabase.from('driver_profiles').upsert({
    id: userId,
    full_name: fullName,
    username,
    phone,
    plate_number: plateNumber,
    truck_class: truckClass,
    avatar_initials: initials,
    driver_status: 'Idle',
    ...(existing ? {} : { approval_status: 'pending' }),
  }, { onConflict: 'id' });
  return error;
}
