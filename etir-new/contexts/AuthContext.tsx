
import React, { createContext, useState, useEffect, useRef, ReactNode } from 'react';
import { AuthUser } from '@/types';
import {
  registerDriver, signInWithEmail, signOut, getSession,
  resolveRole, resolveLoginEmail, fetchDriverProfile,
  ensureDriverProfile, bootstrapAdminUser,
  signInWithGoogle as signInWithGoogleService,
  deleteAccount as deleteAccountService,
} from '@/services/authService';

// Bootstrap admin once per app session (not on every login attempt)
let adminBootstrapped = false;
import { ensureDriverThread } from '@/services/chatService';
import { supabase } from '@/services/supabaseClient';
import {
  registerForPushNotifications, savePushToken, saveDriverPushToken,
  notifyAdminNewDriverRegistration, fetchAdminPushTokens,
} from '@/services/notificationService';

interface RegisterData {
  fullName: string;
  username: string;
  email: string;
  phone: string;
  plateNumber: string;
  truckClass: string;
  password: string;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  pendingVerificationEmail: string | null;
  isPendingApproval: boolean;
  login: (identifier: string, password: string) => Promise<{ success: boolean; error?: string; needsVerification?: boolean; pendingApproval?: boolean }>;
  loginWithGoogle: () => Promise<{ success: boolean; error?: string }>;
  deleteAccount: () => Promise<{ success: boolean; error?: string }>;
  register: (data: RegisterData) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  verifyOtp: (otp: string) => Promise<{ success: boolean; error?: string }>;
  resendVerification: () => Promise<{ success: boolean; error?: string }>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);
  const [isPendingApproval, setIsPendingApproval] = useState(false);

  // Persist registration data until email verified.
  // Also kept in a ref so the onAuthStateChange listener (which has a [] dep array
  // and thus a stale closure) can always read the latest value without re-subscribing.
  const [pendingRegData, setPendingRegData] = useState<RegisterData | null>(null);
  const pendingRegDataRef = useRef<RegisterData | null>(null);

  // Bootstrap: restore session on app launch
  useEffect(() => {
    (async () => {
      try {
        // Ensure admin user exists once per app session — fire and forget
        if (!adminBootstrapped) {
          adminBootstrapped = true;
          bootstrapAdminUser().catch(() => {});
        }

        let session;
        try {
          session = await getSession();
        } catch (sessionErr: any) {
          // Stale / invalid refresh token stored in localStorage — clear it silently
          const msg = sessionErr?.message ?? '';
          if (msg.includes('Refresh Token') || msg.includes('Invalid') || msg.includes('expired')) {
            await supabase.auth.signOut();
          }
          setIsLoading(false);
          return;
        }
        if (session?.user) {
          const email = session.user.email ?? '';
          const role = resolveRole(email);
          // On bootstrap, guard against customer portal sessions being mistaken
          // for driver sessions — only hydrate if a driver_profiles row exists.
          if (role === 'driver') {
            const { data: dp } = await supabase
              .from('driver_profiles')
              .select('id')
              .eq('id', session.user.id)
              .maybeSingle();
            if (!dp) {
              // Customer session — don't touch global driver/admin auth state
              setIsLoading(false);
              return;
            }
          }
          await hydrateUser(session.user.id, email, session.user.email_confirmed_at != null);
        }
      } catch (e) {
        console.warn('[AuthContext] bootstrap error:', e);
      } finally {
        setIsLoading(false);
      }
    })();

    // Listen for auth state changes.
    // NOTE: The listener is intentionally set up with a ref-based pendingRegData
    // accessor to avoid stale closure issues — the [] dependency array means this
    // callback would otherwise always see the initial null value of pendingRegData.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        const confirmed = session.user.email_confirmed_at != null;
        const email = session.user.email ?? '';
        const role = resolveRole(email);

        // For non-admin users, ALWAYS verify a driver_profiles row exists.
        // Customer portal logins trigger SIGNED_IN on this same listener —
        // customers never have driver_profiles rows, so we skip them silently.
        if (role === 'driver') {
          // Read the latest pendingRegData via the ref to avoid stale closure.
          // If pending registration data is present, allow through — profile will
          // be created in hydrateUser. Otherwise check the DB for an existing row.
          const hasPending = pendingRegDataRef.current !== null;
          if (!hasPending) {
            const { data: driverProfile } = await supabase
              .from('driver_profiles')
              .select('id')
              .eq('id', session.user.id)
              .maybeSingle();
            // No driver profile — this is a customer account. Do NOT touch global auth state.
            // Do NOT call signOut — the customer portal manages its own session independently.
            if (!driverProfile) return;
          }
        }

        if (!confirmed) {
          // Block access — show verification screen
          setPendingVerificationEmail(session.user.email ?? null);
          await supabase.auth.signOut();
          setUser(null);
          return;
        }
        await hydrateUser(session.user.id, email, confirmed);
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setPendingRegData(null);
        pendingRegDataRef.current = null;
      }
    });

    return () => subscription.unsubscribe();
  }, []); // Empty dependency array, per the original code's explicit comment.

  const hydrateUser = async (id: string, email: string, emailVerified: boolean) => {
    try {
      const role = resolveRole(email);
      let displayName = email.split('@')[0];
      let driverId: string | undefined;

      if (role === 'driver') {
        // Ensure driver profile exists — try in-memory pending data first,
        // then DB profile, then fall back to user metadata stored at sign-up.
        // Read via ref to avoid stale closure when called from the auth listener.
        const pending = pendingRegDataRef.current;
        if (pending) {
          await ensureDriverProfile(
            id,
            pending.fullName,
            pending.username,
            pending.phone,
            pending.plateNumber,
            pending.truckClass
          );
          displayName = pending.fullName;
          setPendingRegData(null);
          pendingRegDataRef.current = null;
        } else {
          const { profile } = await fetchDriverProfile(id);
          if (profile) {
            displayName = (profile as any).full_name ?? displayName;
            // Block login if driver hasn't been approved yet
            const approvalStatus = (profile as any).approval_status ?? 'approved';
            if (approvalStatus === 'pending') {
              setIsPendingApproval(true);
              await signOut();
              setUser(null);
              return;
            }
            if (approvalStatus === 'rejected') {
              await signOut();
              setUser(null);
              return;
            }
          } else {
            // No profile row — try to recover from user metadata (set at registration).
            // IMPORTANT: only create a driver profile if metadata suggests a driver
            // registration (has plate_number). Otherwise this is a customer account.
            const { data: { user: authUser } } = await supabase.auth.getUser();
            const meta = authUser?.user_metadata ?? {};
            if (meta.plate_number) {
              const fullName = meta.full_name || email.split('@')[0];
              const username = meta.username || '';
              const phone = meta.phone || '';
              const plateNumber = meta.plate_number || 'N/A';
              const truckClass = meta.truck_class || 'Box Truck';
              await ensureDriverProfile(id, fullName, username, phone, plateNumber, truckClass);
              displayName = fullName;
            } else {
              // Customer account — no driver profile needed, bail out of hydrateUser
              // to prevent the driver app from loading for this user.
              return;
            }
          }
        }
        driverId = id;

        // Ensure a chat thread exists for this driver (links by real auth UUID)
        const { profile: latestProfile } = await fetchDriverProfile(id);
        const plateNum = (latestProfile as any)?.plate_number ?? '';
        if (displayName) {
          ensureDriverThread(id, displayName, plateNum).catch(() => {});
        }
      } else {
        displayName = 'MARAS Dispatch';
      }

      const authUser: AuthUser = { id, email, role, displayName, emailVerified, driverId };
      setIsPendingApproval(false);
      setUser(authUser);

      // Register for push notifications after login
      registerForPushNotifications().then(async token => {
        if (!token) return;
        await savePushToken(id, token);
        if (role === 'driver') await saveDriverPushToken(id, token);
      }).catch(() => {});
    } catch (e) {
      console.warn('[AuthContext] hydrateUser error:', e);
      // Only set a fallback user for admin or confirmed driver accounts.
      // Never set user state for customer accounts (no driver_profiles row)
      // as that would trigger the login screen to redirect them to the driver app.
      const role = resolveRole(email);
      if (role === 'admin') {
        setUser({ id, email, role, displayName: 'MARAS Dispatch', emailVerified, driverId: undefined });
      }
      // For driver role, only set fallback if we had pending reg data (actual driver signup)
      else if (role === 'driver' && pendingRegDataRef.current) {
        const fallbackName = pendingRegDataRef.current.fullName || email.split('@')[0];
        setUser({ id, email, role, displayName: fallbackName, emailVerified, driverId: id });
      }
      // Otherwise (customer account) — silently fail, don't set user
    }
  };

  const login = async (identifier: string, password: string) => {
    setIsLoading(true);
    try {
      const email = await resolveLoginEmail(identifier);
      const { user: authUser, error } = await signInWithEmail(email, password);

      if (error) {
        setIsLoading(false);
        return { success: false, error };
      }

      if (authUser && !authUser.email_confirmed_at) {
        setPendingVerificationEmail(authUser.email ?? null);
        await supabase.auth.signOut();
        setIsLoading(false);
        return { success: false, needsVerification: true };
      }

      // Check driver approval status before allowing login
      if (authUser) {
        const role = resolveRole(authUser.email ?? '');
        if (role === 'driver') {
          const { data: dp } = await supabase
            .from('driver_profiles')
            .select('approval_status')
            .eq('id', authUser.id)
            .maybeSingle();
          const approvalStatus = (dp as any)?.approval_status ?? 'approved';
          if (approvalStatus === 'pending') {
            await supabase.auth.signOut();
            setIsPendingApproval(true);
            setIsLoading(false);
            return { success: false, pendingApproval: true };
          }
          if (approvalStatus === 'rejected') {
            await supabase.auth.signOut();
            setIsLoading(false);
            return { success: false, error: 'Your driver account has been rejected. Please contact MARAS dispatch.' };
          }
        }
      }

      setIsLoading(false);
      return { success: true };
    } catch (e: unknown) {
      setIsLoading(false);
      return { success: false, error: 'An unexpected error occurred. Please try again.' };
    }
  };

  const register = async (data: RegisterData) => {
    setIsLoading(true);
    // Store reg data so we can complete profile on first verified login.
    // Update both state AND the ref so the auth listener sees the fresh value
    // even though the listener was created with a stale closure.
    setPendingRegData(data);
    pendingRegDataRef.current = data;
    const { error } = await registerDriver(data);
    setIsLoading(false);
    if (error) {
      setPendingRegData(null);
      pendingRegDataRef.current = null;
      return { success: false, error };
    }
    setPendingVerificationEmail(data.email);
    // Notify admin about new driver registration (fire and forget)
    fetchAdminPushTokens().then(tokens => {
      notifyAdminNewDriverRegistration(data.fullName, data.email, data.plateNumber, tokens);
    }).catch(() => {});
    return { success: true };
  };

  const logout = async () => {
    await signOut();
    setUser(null);
    setPendingVerificationEmail(null);
    setPendingRegData(null);
    pendingRegDataRef.current = null;
    setIsPendingApproval(false);
  };

  const verifyOtp = async (otp: string): Promise<{ success: boolean; error?: string }> => {
    if (!pendingVerificationEmail) return { success: false, error: 'No pending email.' };
    // Try 'signup' first (new driver registration flow), then fall back to 'email' (re-send verification)
    const r1 = await supabase.auth.verifyOtp({
      email: pendingVerificationEmail,
      token: otp.trim(),
      type: 'signup',
    });
    const { data, error } = r1.error
      ? await supabase.auth.verifyOtp({ email: pendingVerificationEmail, token: otp.trim(), type: 'email' })
      : r1;
    if (error) return { success: false, error: error.message };
    if (data.user) {
      await hydrateUser(data.user.id, data.user.email ?? '', true);
      setPendingVerificationEmail(null);
    }
    return { success: true };
  };

  const loginWithGoogle = async (): Promise<{ success: boolean; error?: string }> => {
    setIsLoading(true);
    try {
      const { error } = await signInWithGoogleService();
      if (error) {
        setIsLoading(false);
        return { success: false, error };
      }
      // Auth state change listener will handle hydration
      setIsLoading(false);
      return { success: true };
    } catch (e: unknown) {
      setIsLoading(false);
      return { success: false, error: 'Google sign-in failed. Please try again.' };
    }
  };

  const deleteAccount = async (): Promise<{ success: boolean; error?: string }> => {
    setIsLoading(true);
    try {
      const { error } = await deleteAccountService();
      if (error) {
        setIsLoading(false);
        return { success: false, error };
      }
      setUser(null);
      setIsLoading(false);
      return { success: true };
    } catch (e: unknown) {
      setIsLoading(false);
      return { success: false, error: 'Failed to delete account. Please try again.' };
    }
  };

  const resendVerification = async (): Promise<{ success: boolean; error?: string }> => {
    if (!pendingVerificationEmail) return { success: false, error: 'No pending email.' };
    const { error } = await supabase.auth.resend({ type: 'signup', email: pendingVerificationEmail });
    if (error) return { success: false, error: error.message };
    return { success: true };
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, pendingVerificationEmail, isPendingApproval, login, loginWithGoogle, register, logout, verifyOtp, resendVerification, deleteAccount }}>
      {children}
    </AuthContext.Provider>
  );
}
