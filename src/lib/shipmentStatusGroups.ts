/**
 * shipmentStatusGroups.ts
 *
 * Phase 2A follow-up (Firestore scalability audit, shipments/orders —
 * blocking-issue fix: dashboard aggregate accuracy).
 *
 * The four status buckets AdminPanel's dashboard status-breakdown chart
 * has always shown — extracted from AdminPanel.tsx's inline
 * `shipments.filter(...)` calls so the exact same grouping is shared
 * between:
 *  - server.ts's GET /api/shipments/stats (Firestore `where("status",
 *    "in", [...]).count()` aggregate queries, computed over the FULL
 *    accessible scope, not just whatever page happens to be loaded), and
 *  - AdminPanel.tsx's chart rendering.
 *
 * Never changed the actual status names/grouping — this is a pure
 * extraction, not a redesign. Note this grouping does not cover every
 * possible ShipmentStatus (several sea/air-specific statuses like
 * "Booking Confirmed"/"Container Released" fall into none of these four
 * buckets) — a pre-existing gap in the original chart, unchanged here.
 */
export interface ShipmentStatusGroup {
  key: "new" | "assigned" | "transit" | "delivered";
  statuses: string[];
}

export const SHIPMENT_STATUS_GROUPS: ShipmentStatusGroup[] = [
  { key: "new", statuses: ["New"] },
  { key: "assigned", statuses: ["Assigned", "Accepted"] },
  { key: "transit", statuses: ["Loading", "Loaded", "In Transit", "Border Crossing", "Customs Clearance"] },
  { key: "delivered", statuses: ["Arrived", "Delivered", "Closed"] },
];

export function zeroedShipmentStatusGroupCounts(): Record<string, number> {
  return SHIPMENT_STATUS_GROUPS.reduce<Record<string, number>>((acc, g) => {
    acc[g.key] = 0;
    return acc;
  }, {});
}
