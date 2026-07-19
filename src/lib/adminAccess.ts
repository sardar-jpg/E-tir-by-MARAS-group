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

/**
 * GET /api/shipments — the operational shipment registry; hidden from
 * accounts admins in the UI. Also used as the AdminPanel 'shipments'
 * (Shipment Registry) tab's content-render guard — see BUG-26 below.
 */
export function canViewShipmentRegistry(adminType: AdminType | undefined): boolean {
  return adminType === "super" || adminType === "operation";
}

/**
 * GET /api/drivers — the operational driver roster; hidden from accounts
 * admins in the UI. Also used as the AdminPanel 'drivers' (Driver Alliance)
 * tab's content-render guard — see BUG-26 below.
 */
export function canViewDriverRoster(adminType: AdminType | undefined): boolean {
  return adminType === "super" || adminType === "operation";
}

/**
 * BUG-26 (PR #63, GPS Tracking Map / Driver Alliance / Shipment Registry QA
 * review): the AdminPanel 'tracking_map' (GPS Tracking Map) tab was already
 * correctly hidden from accounts admins in `filteredAdminTabs` (sidebar +
 * mobile tab bar), but its content block only checked `activeTab ===
 * 'tracking_map'` — no adminType check, unlike the 'reports'/'audit'/'team'
 * tabs, which already re-check their access function at the content block
 * (defense-in-depth, PR #59/#58/#57 pattern). The Dashboard's "Administrative
 * Operations Quick Links" widget also had an unconditional
 * `setActiveTab('tracking_map')` button.
 *
 * Verified this is not currently reachable by an accounts admin in
 * practice: `activeTab`'s initial state is `isAccountsAdminType ? 'costs' :
 * 'dashboard'`, and 'dashboard' itself is absent from `filteredAdminTabs`
 * for accounts, so an accounts admin never lands on — or has any button
 * that navigates to — the Dashboard tab the quick-link lives in. Both gaps
 * were fixed anyway, matching the existing defense-in-depth convention:
 * relying solely on "no button happens to reach it today" is exactly the
 * kind of assumption a future change (a new quick-link, a different default
 * tab) could quietly invalidate.
 */
export function canViewGpsTracking(adminType: AdminType | undefined): boolean {
  return adminType === "super" || adminType === "operation";
}

/**
 * Logistics Analytics / Reports tab (PR #59): the tab's charts (status
 * distribution, driver agreed amount by currency, completed-shipment
 * trend) are all computed client-side from the `shipments` state, which
 * comes from GET /api/shipments — canViewShipmentRegistry above already
 * restricts that to super/operation, not accounts. filteredAdminTabs used
 * to show 'reports' to accounts anyway, so their Reports page always
 * rendered empty ("No registered shipments info available").
 *
 * Kept narrower than canViewShipmentRegistry (super only, not operation)
 * rather than widening accounts' access or building a scoped
 * accounts-analytics endpoint in this PR:
 *  - there's no cost-statement-based analytics source yet to show accounts
 *    admins instead of an empty shipment-based page
 *  - operation admins have never had this tab, and today's charts include
 *    a financial figure (driver agreed amount), which isn't something to
 *    hand them without a dedicated non-financial view
 * See docs/FOLLOW_UP_ROADMAP.md for the accounts-analytics and
 * operation-safe-analytics follow-ups.
 */
export function canViewLogisticsAnalytics(adminType: AdminType | undefined): boolean {
  return isSuperAdmin(adminType);
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

/**
 * Admin Data Fetch / AdminType Access Review (PR #58): GET /api/cost-statements
 * and GET /api/cost-statements/:shipmentId used requireRole("admin") — any
 * adminType, including 'operation', could fetch the full accounting ledger
 * directly even though the AdminPanel UI's filteredAdminTabs only ever shows
 * the 'costs' tab to 'accounts' and 'super' (see the isAccounts/isOperation
 * split in AdminPanel.tsx). This restricts the server response to the same
 * two types the UI already shows the tab to.
 */
export function canViewCostStatements(adminType: AdminType | undefined): boolean {
  return adminType === "super" || adminType === "accounts";
}

/**
 * PR #61 (Accounts Cost Statement Write Access): POST
 * /api/cost-statements/:shipmentId used requireFullAdmin (super/operation),
 * which blocks 'accounts' — the type the 'costs' tab is shown to for
 * exactly this purpose (see canViewCostStatements above) — from ever
 * saving the statement it can already view. Product decision: Accounts
 * Admin owns accounting end-to-end (cost items, supplier names,
 * quantities, unit prices, totals, paid amount, notes), so write access
 * mirrors read access here. This does not widen any other route —
 * 'operation' remains blocked from cost statements entirely, and
 * 'accounts' still has no access to GET /api/shipments, /api/logs, or
 * /api/admins. See docs/FOLLOW_UP_ROADMAP.md (Option A).
 */
export function canWriteCostStatements(adminType: AdminType | undefined): boolean {
  return adminType === "super" || adminType === "accounts";
}

// ── Named accounting capabilities (full accounting suite) ────────────────
// These NAME the granular accounting actions on top of the existing
// adminType model — they are NOT a new authorization system. Every server
// route already enforces the SAME rule (requireCanWriteCostStatements for
// accounting writes; requireSuperAdmin for template/bank settings). The
// named helpers exist so the Desktop UI shows/hides each action with one
// canonical rule per capability, and so the boundary is documented + tested
// in one place. "Focused permissions only where needed" — no per-user
// capability matrix, matching the product guidance.
//
// Accounting writers (super + accounts): create/edit costs, record vendor
// payments + reversals, set profit + issue/cancel invoices, record customer
// payments + allocation/reversal, generate receipts, view statements.
export const canManageAccounting = canWriteCostStatements;
export const canRecordVendorPayment = canWriteCostStatements;
export const canReverseVendorPayment = canWriteCostStatements;
export const canSetInvoiceProfit = canWriteCostStatements;
export const canIssueInvoice = canWriteCostStatements;
export const canRecordCustomerPayment = canWriteCostStatements;
export const canAllocatePayment = canWriteCostStatements;
export const canReversePaymentAllocation = canWriteCostStatements;
export const canCreateReceipt = canWriteCostStatements;
export const canViewCustomerStatement = canViewCostStatements;

// Template / bank / structural settings are Super-Admin only (never
// ordinary employees) — mirrors requireSuperAdmin on those routes.
export const canManageBankAccounts = isSuperAdmin;
export const canManageTemplates = isSuperAdmin;
export const canPublishTemplate = isSuperAdmin;
export const canRestoreTemplateVersion = isSuperAdmin;
export const canManageApprovalWorkflow = isSuperAdmin;
export const canDecideReopening = isSuperAdmin;

/**
 * Admin Data Fetch / AdminType Access Review (PR #58): GET /api/logs (and the
 * POST that appends to it) used requireRole("admin") — any adminType could
 * read or write the immutable security/activity ledger directly, even though
 * the AdminPanel UI's filteredAdminTabs only ever shows the 'audit' tab to
 * 'super'. Restricting GET to super closes a gap where operation/accounts
 * could otherwise read the full audit trail directly.
 *
 * POST is a separate decision — see canWriteAuditLogs below (PR #82): the
 * "every POST call site is super-only" assumption this comment originally
 * relied on turned out to be false (the Google Workspace 'gmail' tab that
 * writes these entries is reachable by operation admins too, via the
 * Shipments tab's Gmail Alert shortcut — canViewShipmentRegistry, not
 * super-only), so GET and POST now have their own functions.
 */
export function canViewAuditLogs(adminType: AdminType | undefined): boolean {
  return isSuperAdmin(adminType);
}

/**
 * POST /api/logs — appending a new entry to the activity ledger. Broader
 * than canViewAuditLogs on purpose (PR #82, Google Workspace review):
 * operation admins can reach the Google Workspace tab (send Gmail, back up
 * a shipment to Drive, schedule a Calendar event — see the 'gmail' content
 * block's adminType gate in AdminPanel.tsx) and every one of those actions
 * calls this route to record itself. Before this function existed, POST
 * shared canViewAuditLogs (super-only), so every Workspace action an
 * operation admin performed silently failed to be logged at all — a real
 * audit-completeness gap, not an intentional restriction (nothing suggests
 * operation admins' Workspace actions were meant to go unrecorded, and the
 * UI grants them the capability in the first place). Read access is
 * unchanged: operation admins can still never view the full ledger
 * (canViewAuditLogs, GET /api/logs, the 'audit' tab) — only append to it
 * via the specific actions they're already allowed to take.
 */
export function canWriteAuditLogs(adminType: AdminType | undefined): boolean {
  return adminType === "super" || adminType === "operation";
}

/** POST/PUT/DELETE /api/clients — accounts admins are read-only here; only super/operation may create/edit/delete clients. */
export function canManageClients(adminType: AdminType | undefined): boolean {
  return adminType === "super" || adminType === "operation";
}

/** POST/PUT/DELETE /api/vendors — same reasoning as canManageClients. */
export function canManageVendors(adminType: AdminType | undefined): boolean {
  return canManageClients(adminType);
}

/* sanitizeCreatedAdminType was removed in Stage 2 PR 4: its silent
 * downgrade-to-operation fallback violated strict adminType validation.
 * POST /api/admins now uses validateCreatedAdminType
 * (src/lib/accountIdentity.ts), which keeps the same product rule —
 * only "operation"/"accounts" can ever be created; "super" is reserved
 * for the env-configured owner — but rejects missing/unknown/"super"
 * values with an explicit 400 instead of silently mutating them. */

/**
 * Owner-account protection: the account matching the well-known owner
 * identity must never be deletable through the admin-management API,
 * regardless of who is asking (including "self-delete"). Compares against
 * both the env-configured production owner email and the documented local
 * fallback, so the guard also covers the seeded local-dev/demo owner
 * account that has no real SUPER_ADMIN_EMAIL configured.
 */
export function isProtectedOwnerAccount(
  candidate: { email?: string; adminType?: AdminType } | null | undefined,
  ownerEmail: string
): boolean {
  if (!candidate) return false;
  if (candidate.adminType === "super") return true;
  const email = (candidate.email || "").toLowerCase().trim();
  return !!email && !!ownerEmail && email === ownerEmail.toLowerCase().trim();
}

/**
 * DELETE /api/admins/:id — deciding whether a given admin session may
 * delete a given target admin document id. Every admin type may always
 * delete their own record (required so every admin account created
 * through the app's "Create Admin" flow can be self-deleted, per Apple
 * Guideline 5.1.1(v)), but deleting *someone else's* account is
 * restricted to the super-admin: GET /api/admins (the Team roster) is
 * already super-only, so an operation-type admin who isn't allowed to see
 * that roster must not be able to remove an entry from it either.
 */
export function canDeleteAdminAccount(
  session: { role?: string; adminType?: AdminType; id?: string } | null | undefined,
  targetId: string
): boolean {
  if (!session || session.role !== "admin") return false;
  if (session.id === targetId) return true;
  return isSuperAdmin(session.adminType);
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

/**
 * PR #111 review (Admin Status Override / role authorization correction):
 * shipment status management — normal admin progression
 * (PUT /api/shipments/:id/status), the Admin Status Override correction
 * workflow (PUT /api/shipments/:id/status-override), and the
 * Delivered -> Closed/Completed closing transition — is a distinct,
 * dedicated permission from canViewShipmentRegistry above. Viewing the
 * shipment registry is a read permission; changing or closing a shipment
 * is a write/operational permission, and must never be authorized by
 * reusing a read check, even though both happen to allow exactly the same
 * two adminTypes today — a future change to either concept must not
 * accidentally couple them.
 *
 * Only Super Admin and Operations Admin may manage shipment status.
 * Accounts Admin, any other admin adminType, and every non-admin role
 * (driver, client, unauthenticated/public) are rejected.
 */
export function canManageShipmentStatus(
  session: { role?: string; adminType?: AdminType } | null | undefined
): boolean {
  if (!session || session.role !== "admin") return false;
  return session.adminType === "super" || session.adminType === "operation";
}
