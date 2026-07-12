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

/**
 * fix/client-create-username
 *
 * Normalizes a submitted client username the same way POST /api/login
 * normalizes the submitted login identifier (`normalizedQuery =
 * username.toLowerCase().trim()` in server.ts) — trim first, then
 * lowercase. Stored usernames must go through this so a later login with
 * the exact same string always matches, regardless of stray whitespace.
 */
export function normalizeClientUsername(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

/**
 * Builds the optional `username` field for a brand-new Client Firestore
 * record, mirroring the existing conditional-spread pattern already used
 * for `isEmployee`/`password` in POST /api/clients (server.ts) — a
 * blank/whitespace-only/omitted username results in no `username` key at
 * all, rather than storing an empty string that could later collide with
 * another blank-username record or an empty login query.
 */
export function buildClientUsernameField(rawUsername: string | undefined): { username: string } | Record<string, never> {
  const normalized = normalizeClientUsername(rawUsername);
  return normalized ? { username: normalized } : {};
}

/**
 * Builds the optional `password` field for PUT /api/clients/:id, mirroring
 * `buildClientUsernameField`'s pattern: a blank/whitespace-only password
 * results in no `password` key at all — the caller must leave the
 * existing hash untouched, never overwrite it with a hash of an empty
 * string. The Admin Panel's edit form already only includes `password` in
 * its request body when the field is non-blank (`editClientPassword.trim()`
 * in `AdminPanel.tsx`), so this is defense in depth for any other caller
 * of this route, not a behavior change for the existing UI.
 */
export function buildClientPasswordUpdateField(rawPassword: string | undefined): { password: string } | Record<string, never> {
  const trimmed = (rawPassword || "").trim();
  return trimmed ? { password: trimmed } : {};
}

/**
 * True if `normalizedQuery` (already trimmed+lowercased by the caller,
 * matching POST /api/login's own `normalizedQuery`) identifies this
 * client by username, email, or company name — the exact three fields
 * POST /api/login's client-matching branch checks. Extracted so the
 * matching rule itself is unit-testable independent of Firestore/Express.
 *
 * Hardened independently of the route-level guard: POST /api/login
 * rejects a fully empty `username` (`if (!username || !password)`) but
 * NOT a whitespace-only one — `"   "` passes that check and then trims
 * down to `normalizedQuery === ""`. Without the guard below, that blank
 * query would falsy-match any client whose username/email/companyName is
 * itself missing/blank (`("" || "") === ""` is `true`). A blank query can
 * never legitimately identify anyone, so it's rejected here regardless of
 * what the route-level check does or doesn't catch.
 */
export function matchesClientLoginIdentifier(
  client: Pick<Client, "username" | "email" | "companyName">,
  normalizedQuery: string
): boolean {
  if (!normalizedQuery.trim()) return false;
  const uMatch = (client.username || "").toLowerCase() === normalizedQuery;
  const eMatch = (client.email || "").toLowerCase() === normalizedQuery;
  const nameMatch = (client.companyName || "").toLowerCase() === normalizedQuery;
  return uMatch || eMatch || nameMatch;
}

/**
 * True if `candidateUsername` (normalized) already belongs to another
 * Client record — Owner or Staff, checked across all Client accounts
 * together, since POST /api/login's client-matching branch (above) has no
 * concept of scoping the search to one company: a duplicate username
 * anywhere in the `clients` collection would make one of the two
 * colliding accounts unreachable, or ambiguous, at login time, the same
 * risk `findDuplicateDriverField` (driverAccess.ts) documents for
 * drivers. `excludeClientId` lets an edit keep a record's own existing
 * username without flagging itself as a duplicate.
 */
export function hasDuplicateClientUsername(
  existingClients: Pick<Client, "id" | "username">[],
  candidateUsername: string | undefined,
  excludeClientId?: string
): boolean {
  const normalized = normalizeClientUsername(candidateUsername);
  if (!normalized) return false;
  return existingClients.some(
    (c) => c.id !== excludeClientId && normalizeClientUsername(c.username) === normalized
  );
}

/**
 * True if a shipment recorded under `shipmentCompanyName` belongs to the
 * company `clientCompanyName` — the exact rule every client-facing route
 * in server.ts uses to scope shipments/documents/chat/notifications to a
 * Client session (Owner and Staff alike, since both are scoped by
 * companyName the same way — see clientAccess.ts's module doc comment).
 * Extracted purely for unit-testability; intentionally preserves the
 * existing strict, unnormalized `===` comparison used server-side today
 * (server.ts's shipment-access checks do not `.trim()`/`.toLowerCase()`,
 * unlike the admin/client dashboard's own display-side filtering) — this
 * fix does not change that behavior, only makes it independently
 * testable. Note: the admin/client dashboard's own display-side
 * filtering (`AdminClientsSection.tsx`, `ClientDashboard.tsx`) DOES
 * `.toLowerCase().trim()` both sides before comparing — an inconsistency
 * with this server-side strict match, not resolved here (see the
 * fix/client-create-username PR discussion for the full writeup).
 */
export function isShipmentVisibleToClientCompany(
  shipmentCompanyName: string | undefined,
  clientCompanyName: string | undefined
): boolean {
  return !!shipmentCompanyName && shipmentCompanyName === clientCompanyName;
}
