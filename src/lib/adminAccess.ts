/**
 * adminAccess.ts
 *
 * BUG-08: server-side admin role enforcement was looser than the
 * AdminPanel UI. `filteredAdminTabs` in src/components/AdminPanel.tsx
 * already hides sections per adminType:
 *   super:     everything
 *   operation: dashboard, shipments, tracking_map, drivers, clients,
 *              vendors, my_account
 *   accounts:  costs, reports, clients, vendors, my_account
 * but nothing on the server enforced the same boundaries, so an
 * accounts/operation admin who had a section hidden from them could still
 * call its API route directly (e.g. an accounts admin fetching the
 * operational driver/shipment registry, or an operation admin fetching the
 * super-only Team/admin roster).
 *
 * These are pure decision functions — extracted so the route-permission
 * rules are unit testable without booting the server — used as guards in
 * front of the corresponding routes in server.ts.
 */
export type AdminType = "super" | "operation" | "accounts" | string;

export function isSuperAdmin(adminType: AdminType | undefined): boolean {
  return adminType === "super";
}

/** GET /api/shipments — the operational shipment registry; hidden from accounts admins in the UI. */
export function canViewShipmentRegistry(adminType: AdminType | undefined): boolean {
  return adminType === "super" || adminType === "operation";
}

/** GET /api/drivers — the operational driver roster; hidden from accounts admins in the UI. */
export function canViewDriverRoster(adminType: AdminType | undefined): boolean {
  return adminType === "super" || adminType === "operation";
}

/** GET /api/admins — the Team/admin roster; super-only in the UI. */
export function canViewAdminRoster(adminType: AdminType | undefined): boolean {
  return isSuperAdmin(adminType);
}
