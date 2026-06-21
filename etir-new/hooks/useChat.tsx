import { useContext } from 'react';
import { ChatContext } from '@/contexts/ChatContext';

export function useChat(driverId?: string, plateNumber?: string) {
  const context = useContext(ChatContext);
  if (!context) throw new Error('useChat must be used within ChatProvider');

  // Match general thread by driverId, then by plate number
  const myThread = driverId
    ? (
        context.threads.find(t => t.driverId === driverId && !t.shipmentId) ??
        (plateNumber ? context.threads.find(t => t.driverPlate === plateNumber && !t.shipmentId) : null) ??
        null
      )
    : null;

  // Shipment-specific thread lookup
  const getShipmentChatThread = (shipmentId: string) =>
    context.threads.find(t => t.shipmentId === shipmentId) ?? null;

  return {
    ...context,
    myThread,
    getShipmentChatThread,
  };
}
