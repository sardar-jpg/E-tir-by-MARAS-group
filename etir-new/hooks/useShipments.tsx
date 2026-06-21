import { useContext } from 'react';
import { ShipmentsContext } from '@/contexts/ShipmentsContext';

export function useShipments(driverId?: string) {
  const context = useContext(ShipmentsContext);
  if (!context) throw new Error('useShipments must be used within ShipmentsProvider');

  const shipments = driverId
    ? context.shipments.filter(s => s.driverId === driverId)
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
    selectedShipment: null,
    setSelectedShipment: () => {},
  };
}
