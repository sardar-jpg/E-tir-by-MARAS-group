import React, { createContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Shipment, ShipmentStatus, ContainerEntry } from '@/types';
import { fetchAllShipments, fetchShipmentByToken, updateShipmentStatus, updateShipmentETA, assignDriverToShipment, createShipment, acceptAgreedPrice, CreateShipmentInput } from '@/services/shipmentService';
import { fetchDriverPushToken, notifyDriverStatusChange } from '@/services/notificationService';
import { supabase } from '@/services/supabaseClient';
import { isActiveStatus, isCustomsStatus, isArrivedStatus } from '@/services/shipmentStatusGroups';

interface ShipmentsContextType {
  shipments: Shipment[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  getByToken: (token: string) => Shipment | null;
  getById: (id: string) => Shipment | null;
  getByTirNumber: (tirNumber: string) => Shipment | null;
  updateStatus: (id: string, status: ShipmentStatus) => Promise<void>;
  assignDriver: (id: string, driverId: string | null, driverName: string, plateNumber: string) => Promise<void>;
  updateETA: (id: string, estimatedArrival: string) => Promise<void>;
  acceptPrice: (id: string) => Promise<void>;
  addShipment: (input: CreateShipmentInput) => Promise<{ error: string | null }>;
  getStats: () => { total: number; active: number; pending: number; arrived: number };
  /** Sync containers into shared state after they've already been persisted elsewhere (no DB call). */
  setContainersLocal: (id: string, containers: ContainerEntry[]) => void;
}

export const ShipmentsContext = createContext<ShipmentsContextType | undefined>(undefined);

export function ShipmentsProvider({ children }: { children: ReactNode }) {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { shipments: data, error: fetchError } = await fetchAllShipments();
    if (fetchError) {
      console.warn('[ShipmentsContext] fetch failed:', fetchError);
      setError(typeof fetchError === 'string' ? fetchError : 'Failed to load shipments.');
    } else {
      setShipments(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // Only load shipments once a session exists (admin or driver). Public/
    // unauthenticated routes (e.g. /tracking, /customer pre-login) must not
    // trigger a bulk fetch of every shipment — they look up a single
    // shipment via fetchShipmentByTirNumber/fetchShipmentById instead.
    let cancelled = false;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session?.user) load();
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        load();
      } else if (event === 'SIGNED_OUT') {
        setShipments([]);
        setLoading(false);
      }
    });

    return () => { cancelled = true; subscription.unsubscribe(); };
  }, [load]);

  const getByToken = useCallback(
    (token: string) => shipments.find(s => s.token === token) ?? null,
    [shipments]
  );

  const getById = useCallback(
    (id: string) => shipments.find(s => s.id === id) ?? null,
    [shipments]
  );

  const getByTirNumber = useCallback(
    (tirNumber: string) => shipments.find(s => s.tirNumber.toLowerCase() === tirNumber.trim().toLowerCase()) ?? null,
    [shipments]
  );

  // Canonical timestamp formatter — ISO-based, locale-independent
  const nowTimestamp = () => new Date().toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const updateStatus = useCallback(async (id: string, status: ShipmentStatus) => {
    await updateShipmentStatus(id, status);
    setShipments(prev => {
      const updated = prev.map(s => s.id === id ? { ...s, status, updatedAt: nowTimestamp() } : s);
      // Send push notification to driver
      const shipment = updated.find(s => s.id === id);
      if (shipment?.driverId) {
        fetchDriverPushToken(shipment.driverId).then(token => {
          notifyDriverStatusChange(shipment.tirNumber, status, token);
        }).catch(() => {});
      }
      return updated;
    });
  }, []);

  const assignDriver = useCallback(async (id: string, driverId: string | null, driverName: string, plateNumber: string) => {
    await assignDriverToShipment(id, driverId, driverName, plateNumber);
    setShipments(prev =>
      prev.map(s => s.id === id ? { ...s, driverId: driverId ?? '', driverName, plateNumber, updatedAt: nowTimestamp() } : s)
    );
  }, []);

  const updateETA = useCallback(async (id: string, estimatedArrival: string) => {
    await updateShipmentETA(id, estimatedArrival);
    setShipments(prev =>
      prev.map(s => s.id === id ? { ...s, estimatedArrival, updatedAt: nowTimestamp() } : s)
    );
  }, []);

  const addShipment = useCallback(async (input: CreateShipmentInput) => {
    const { shipment, error } = await createShipment(input);
    if (error) return { error };
    if (shipment) setShipments(prev => [shipment, ...prev]);
    return { error: null };
  }, []);

  const acceptPrice = useCallback(async (id: string) => {
    await acceptAgreedPrice(id);
    const now = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    setShipments(prev =>
      prev.map(s => s.id === id ? { ...s, priceAccepted: true, priceAcceptedAt: now } : s)
    );
  }, []);

  const getStats = useCallback(() => {
    const total = shipments.length;
    // 'active' = shipments actively moving across any transport mode (Road/Sea/Air).
    // Customs-held statuses are excluded — they are their own 'pending' bucket.
    const active = shipments.filter(s => isActiveStatus(s.status)).length;
    // 'pending' = shipments held at any customs checkpoint (Road/Sea/Air all have one).
    const pending = shipments.filter(s => isCustomsStatus(s.status)).length;
    // 'arrived' = shipment reached final destination, for any transport mode.
    const arrived = shipments.filter(s => isArrivedStatus(s.status)).length;
    return { total, active, pending, arrived };
  }, [shipments]);

  const setContainersLocal = useCallback((id: string, containers: ContainerEntry[]) => {
    setShipments(prev => prev.map(s => s.id === id ? { ...s, containers } : s));
  }, []);

  return (
    <ShipmentsContext.Provider value={{ shipments, loading, error, refresh: load, getByToken, getById, getByTirNumber, updateStatus, assignDriver, updateETA, acceptPrice, addShipment, getStats, setContainersLocal }}>
      {children}
    </ShipmentsContext.Provider>
  );
}
