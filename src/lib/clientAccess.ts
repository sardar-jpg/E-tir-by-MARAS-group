/**
 * clientAccess.ts
 *
 * feature/client-staff-accounts-safety-review
 *
 * Client Staff (Client.isEmployee) are employees of the *customer* company —
 * never MARAS employees, despite the historically confusing field name and
 * UI wording. A Client Staff account is its own separate Client Firestore
 * document (own id/username/password), created by a MARAS Admin and
 * attached to an existing company by copying that company's companyName at
 * creation time (companyName is then immutable — see PUT /api/clients/:id
 * in server.ts).
 *
 * Policy: a Client Staff account gets exactly the same customer-safe
 * shipment/document/chat view as the company's own Client owner account
 * (both are session.role === "client", scoped by companyName — see
 * shipmentView.ts, chatVisibility.ts, and the /api/shipments,
 * /api/notifications, /api/drivers routes in server.ts). What it must
 * never do is *manage* anything: it cannot create/edit shipments, change
 * status, approve/share documents, or manage users — including its own
 * account record, which only a MARAS Admin may create, edit, or delete.
 */
import type { Client } from "../types";

/** True if this Client record is a Client Staff (customer-employee) account rather than the company's own owner account. */
export function isClientStaffAccount(client: Pick<Client, "isEmployee">): boolean {
  return !!client.isEmployee;
}

/**
 * Whether a "client" session may delete the given Client record via the
 * self-service DELETE /api/clients/:id "isSelf" path. Only the company
 * owner account may self-delete this way — a Client Staff account is
 * created/managed by MARAS Admin only, so removing one (even the staff
 * member's own login) must go through Admin, not self-service.
 */
export function canClientSelfDeleteAccount(client: Pick<Client, "isEmployee">): boolean {
  return !isClientStaffAccount(client);
}

/**
 * customer-chat-enablement-safety-review: whether a "client" session may
 * send a message/attachment in the existing customer/admin chat (the
 * ClientDashboard "Support inquiries" panel). Unlike self-delete or
 * document/share approval, sending a chat message is not an Admin-managed
 * action — Client Staff gets exactly the same send capability as the
 * company's own owner account here, matching server.ts's
 * /api/shipments/:id/chat and /api/upload routes, which already accept
 * session.viewOnly (Client Staff) the same as the owner. Kept as its own
 * named decision point (rather than inlining `true` at the call site) so a
 * future attempt to reuse isClientStaffAccount/canClientSelfDeleteAccount
 * to gate chat sending is a deliberate, reviewable change to this
 * function instead of a silent regression.
 */
export function canClientSendChatMessage(_client: Pick<Client, "isEmployee">): boolean {
  return true;
}
