import React, { createContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Driver } from '@/types';
import { fetchAllDrivers } from '@/services/driverService';

interface DriversContextType {
  drivers: Driver[];
  loading: boolean;
  refresh: () => Promise<void>;
}

export const DriversContext = createContext<DriversContextType | undefined>(undefined);

export function DriversProvider({ children }: { children: ReactNode }) {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { drivers: data } = await fetchAllDrivers();
    setDrivers(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Poll every 30s so newly registered drivers appear without manual refresh
  useEffect(() => {
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <DriversContext.Provider value={{ drivers, loading, refresh: load }}>
      {children}
    </DriversContext.Provider>
  );
}
