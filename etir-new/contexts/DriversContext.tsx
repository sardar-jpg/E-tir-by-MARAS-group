import React, { createContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Driver } from '@/types';
import { fetchAllDrivers } from '@/services/driverService';
import { supabase } from '@/services/supabaseClient';

interface DriversContextType {
  drivers: Driver[];
  loading: boolean;
  refresh: () => Promise<void>;
}

export const DriversContext = createContext<DriversContextType | undefined>(undefined);

function isAdminEmail(email: string | null | undefined): boolean {
  const e = email ?? '';
  return e.endsWith('@marasgroup.com') || e.endsWith('@maras.iq');
}

export function DriversProvider({ children }: { children: ReactNode }) {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { drivers: data } = await fetchAllDrivers();
    setDrivers(data);
    setLoading(false);
  }, []);

  // The driver roster includes other drivers' emails/phone numbers — only
  // admins should trigger this fetch. Public routes (/tracking, /customer)
  // and driver sessions must not bulk-load every driver's contact info.
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      const admin = isAdminEmail(session?.user?.email);
      setIsAdmin(admin);
      if (admin) load();
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && isAdminEmail(session?.user?.email)) {
        setIsAdmin(true);
        load();
      } else if (event === 'SIGNED_OUT') {
        setIsAdmin(false);
        setDrivers([]);
        setLoading(false);
      }
    });

    return () => { cancelled = true; subscription.unsubscribe(); };
  }, [load]);

  // Poll every 30s so newly registered drivers appear without manual refresh
  // (admin sessions only — see gating above).
  useEffect(() => {
    if (!isAdmin) return;
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load, isAdmin]);

  return (
    <DriversContext.Provider value={{ drivers, loading, refresh: load }}>
      {children}
    </DriversContext.Provider>
  );
}
