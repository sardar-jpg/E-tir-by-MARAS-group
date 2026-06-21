/**
 * shipmentStatusGroups.ts
 *
 * Canonical status-bucketing helpers shared by the dashboard, fleet map,
 * control panel, and sidebar badge counters.
 *
 * IMPORTANT: ShipmentStatus values are shared across all three shipment
 * types (Road / Sea / Air) — see types/index.ts. Several admin views were
 * historically written only against the Road status set and silently
 * miscounted Sea/Air shipments when those types were added later. These
 * helpers are the single source of truth for "what bucket is this status
 * in" so that gap can't reappear file-by-file.
 *
 * Terminal/exception statuses ('Arrived', 'Arrived at Hub', 'Detained')
 * are intentionally excluded from isActiveStatus — they are not in-transit.
 */
import { ShipmentStatus } from '@/types';

/** Shipment is actively moving (not at customs, not arrived, not detained). */
const ACTIVE_STATUSES: ShipmentStatus[] = [
  // Road
  'Loaded', 'Dispatched', 'In Transit', 'Border Crossing',
  // Sea
  'Booked', 'At Port of Loading', 'Vessel Departed', 'At Sea', 'At Port of Discharge',
  // Air
  'Awaiting Flight', 'In Flight',
];

/** Shipment is held at any customs checkpoint, regardless of transport mode. */
const CUSTOMS_STATUSES: ShipmentStatus[] = [
  'Customs Clearance', 'Customs Pending', 'Port Customs',
];

/** Shipment has reached its final destination. */
const ARRIVED_STATUSES: ShipmentStatus[] = [
  'Arrived', 'Arrived at Hub',
];

export function isActiveStatus(status: ShipmentStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export function isCustomsStatus(status: ShipmentStatus): boolean {
  return CUSTOMS_STATUSES.includes(status);
}

export function isArrivedStatus(status: ShipmentStatus): boolean {
  return ARRIVED_STATUSES.includes(status);
}

export function isDetainedStatus(status: ShipmentStatus): boolean {
  return status === 'Detained';
}
