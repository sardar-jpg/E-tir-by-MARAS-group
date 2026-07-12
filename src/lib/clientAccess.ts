/**
 * clientAccess.ts
 *
 * feature/client-staff-accounts-safety-review, superseded by the
 * fix/client-create-username final account-deletion rule below.
 *
 * Client Staff (Client.isEmployee) are employees of the *customer* company —
 * never MARAS employees, despite the historically confusing field name and
 * UI wording. A Client Staff account is its own separate Client Firestore
 * document (own id/username/password), created by a MARAS Admin and
 * attached to an existing company by copying that company's companyName at
 * creation time (companyName is then immutable — see PUT /api/clients/:id
 * in server.ts).
 *
 * CONFIRMED FINAL POLICY (fix/client-create-username): Client Owner and
 * Client Staff have identical company-level permissions — shipment
 * viewing, chat, documents, uploads, subscriptions, and public share
 * links. Neither can create/edit shipments, change status, or manage
 * *other* accounts. Each may delete only their own personal login account
 * (see resolveClientAccountDeleteAuthorization below) — never another
 * account (Owner or Staff), and never "the company" as a whole. Only a
 * full MARAS Admin (not accounts-restricted) may delete any Client
 * record, Owner or Staff, subject to the existing (non-cascading) delete
 * behavior in DELETE /api/clients/:id — deleting one Client record has
 * never deleted shipments, documents, or other Client records tied to the
 * same companyName, and this fix does not change that.
 */
import type { Client } from "../types";

/** True if this Client record is a Client Staff (customer-employee) account rather than the company's own owner account. */
export function isClientStaffAccount(client: Pick<Client, "isEmployee">): boolean {
  return !!client.isEmployee;
}

/**
 * customer-chat-enablement-safety-review: whether a "client" session may
 * send a message/attachment in the existing customer/admin chat (the
 * ClientDashboard "Support inquiries" panel). Client Staff gets exactly
 * the same send capability as the company's own owner account, matching
 * server.ts's /api/shipments/:id/chat and /api/upload routes. Kept as its
 * own named decision point (rather than inlining `true` at the call site)
 * so a future attempt to reuse isClientStaffAccount to gate chat sending
 * is a deliberate, reviewable change to this function instead of a
 * silent regression.
 */
export function canClientSendChatMessage(_client: Pick<Client, "isEmployee">): boolean {
  return true;
}

/**
 * fix/client-create-username — final confirmed account-deletion rule.
 *
 * Authorizes DELETE /api/clients/:id. The delete TARGET for a client
 * session is always the AUTHENTICATED session's own id, never
 * `requestedId` (the client-supplied URL parameter) — this function only
 * decides whether the request is allowed to proceed at all; server.ts is
 * responsible for actually deleting `session.id`, not `requestedId`, for
 * a client-role caller (see the comment at the DELETE route's call site).
 *
 * Rules:
 * - A "client" session (Owner or Staff — no isEmployee check at all,
 *   deliberately, since both get identical self-delete rights) may only
 *   ever target its OWN id. It can never delete another account (the
 *   Owner, another Staff member) or trigger any broader "delete the
 *   company" operation — there is no such operation for a client session
 *   to reach; self-delete only ever removes the one record matching
 *   session.id.
 * - A full MARAS Admin (adminType !== "accounts") may delete any single
 *   Client record by id — Owner or Staff — matching the same
 *   `requireFullAdmin` gating already used by POST/PUT /api/clients.
 *   This is the only path that can remove the company's Owner record
 *   (the closest analog to "deleting the company" in a data model with no
 *   separate company entity), and it still only deletes that one
 *   Firestore document — no cascade to shipments/documents/other Client
 *   records, unchanged from the existing behavior this fix preserves.
 * - An accounts-restricted admin, or a driver session, is never allowed.
 */
export function resolveClientAccountDeleteAuthorization(params: {
  requestedId: string;
  session: { role: "admin" | "client" | "driver"; id: string; adminType?: string };
}): { allowed: boolean; reason?: string } {
  const { requestedId, session } = params;
  const isFullAdmin = session.role === "admin" && session.adminType !== "accounts";
  if (isFullAdmin) return { allowed: true };
  if (session.role === "client" && session.id === requestedId) return { allowed: true };
  return { allowed: false, reason: "You can only delete your own account." };
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
