import { useContext } from 'react';
import { DriversContext } from '@/contexts/DriversContext';

export function useDrivers() {
  const context = useContext(DriversContext);
  if (!context) throw new Error('useDrivers must be used within DriversProvider');
  return context;
}
