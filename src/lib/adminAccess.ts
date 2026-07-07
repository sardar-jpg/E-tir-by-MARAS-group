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

/**
 * BUG-09: the AdminPanel UI shows accounts admins a Clients tab (they need
 * client names to attribute costs/reports), but GET /api/clients used
 * requireFullAdmin, which blocks 'accounts' — so the tab loaded to a wall of
 * fetch errors. Accounts admins may read the client/vendor directory but
 * never write to it — see canManageClients/canManageVendors below.
 */
export function canViewClients(adminType: AdminType | undefined): boolean {
  return adminType === "super" || adminType === "operation" || adminType === "accounts";
}

/** GET /api/vendors — same reasoning as canViewClients. */
export function canViewVendors(adminType: AdminType | undefined): boolean {
  return canViewClients(adminType);
}

/** POST/PUT/DELETE /api/clients — accounts admins are read-only here; only super/operation may create/edit/delete clients. */
export function canManageClients(adminType: AdminType | undefined): boolean {
  return adminType === "super" || adminType === "operation";
}

/** POST/PUT/DELETE /api/vendors — same reasoning as canManageClients. */
export function canManageVendors(adminType: AdminType | undefined): boolean {
  return canManageClients(adminType);
}

/**
 * BUG-17: requireFullAdmin (server.ts) used to fold "no session at all" and
 * "authenticated but the wrong role/adminType" into the same 401 response.
 * A logged-in client/driver, or an accounts-type admin, IS authenticated —
 * they're just not allowed here, which is a 403, not a 401. Extracted as a
 * pure function so the status-code decision is unit testable without
 * booting the server.
 */
export function resolveFullAdminStatus(
  session: { role?: string; adminType?: AdminType } | null | undefined
): 401 | 403 | 200 {
  if (!session) return 401;
  if (session.role !== "admin") return 403;
  if (session.adminType === "accounts") return 403;
  return 200;
}
