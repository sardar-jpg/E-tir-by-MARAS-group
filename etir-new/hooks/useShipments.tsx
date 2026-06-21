import { useContext } from 'react';
import { ShipmentsContext } from '@/contexts/ShipmentsContext';

export function useShipments(driverId?: string) {
  const context = useContext(ShipmentsContext);
  if (!context) throw new Error('useShipments must be used within ShipmentsProvider');

  // Include shipments where this driver is the primary driver OR listed as
  // an additional driver (multi-truck Road assignments / Sea arrival-port
  // pickup driver) — matching the filtering already done manually in
  // app/driver.tsx, so any future caller that passes driverId gets the
  // same complete result instead of missing additional-driver assignments.
  const shipments = driverId
    ? context.shipments.filter(s =>
        s.driverId === driverId ||
        (Array.isArray(s.additionalDrivers) && s.additionalDrivers.some(ad => ad.driver_id === driverId))
      )
    : context.shipments;

  return {
    shipments,
    loading: context.loading,
    error: context.error,
    refresh: context.refresh,
    getByToken: context.getByToken,
    getById: context.getById,
    getByTirNumber: context.getByTirNumber,
    updateStatus: context.updateStatus,
    assignDriver: context.assignDriver,
    updateETA: context.updateETA,
    acceptPrice: context.acceptPrice,
    addShipment: context.addShipment,
    getStats: context.getStats,
    setContainersLocal: context.setContainersLocal,
    selectedShipment: null,
    setSelectedShipment: () => {},
  };
}
