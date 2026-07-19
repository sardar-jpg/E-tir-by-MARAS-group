/**
 * accountIdentity.ts — canonical, cross-role identity normalization and
 * collision checking (Stage 2 PR 4).
 *
 * One module decides what "the same username/email/phone" means for EVERY
 * account type — admins, drivers, clients (Owners and Staff live in the
 * same `clients` collection), and the env-configured protected owner. A
 * collision in a DIFFERENT role is still a collision: a driver cannot
 * register with an admin's email, a client staff account cannot take a
 * driver's username, an admin cannot reuse a client's phone number.
 *
 * Normalization matches the project's existing login/duplicate semantics
 * (see driverAccess.findDuplicateDriverField and POST /api/login):
 *   username/email → trim + lowercase
 *   phone          → strip all whitespace (NO country-code invention)
 * Blank/missing values are ignored on the candidate side, and an update
 * excludes the record's own identity (same source collection + id).
 *
 * Conflict messages name ONLY the field type — never the conflicting
 * account, its role, or its collection.
 */

export type IdentityField = "username" | "email" | "phone";

export interface IdentityRecord {
  /** Source collection ("admins" | "drivers" | "clients" | "owner"). */
  source: string;
  id: string;
  username?: string;
  email?: string;
  phone?: string;
}

export interface IdentityCandidate {
  username?: string;
  email?: string;
  phone?: string;
}

export const normalizeIdentityUsername = (v: string | undefined): string => (v || "").trim().toLowerCase();
export const normalizeIdentityEmail = (v: string | undefined): string => (v || "").trim().toLowerCase();
export const normalizeIdentityPhone = (v: string | undefined): string => (v || "").replace(/\s+/g, "");

/**
 * The protected owner participates in collision checks as a virtual
 * record: its email, and its email's local part (POST /api/login accepts
 * that local part as the owner's username), can never be claimed by any
 * account of any role.
 */
export function buildOwnerIdentityRecord(ownerEmail: string): IdentityRecord {
  const email = normalizeIdentityEmail(ownerEmail);
  return {
    source: "owner",
    id: "owner",
    email,
    username: email.includes("@") ? email.split("@")[0] : email,
  };
}

/**
 * First colliding field, or null. Candidate blanks are ignored; the
 * excluded key (an update's own record) never collides with itself.
 */
export function findGlobalIdentityCollision(
  candidate: IdentityCandidate,
  records: IdentityRecord[],
  exclude?: { source: string; id: string }
): IdentityField | null {
  const username = normalizeIdentityUsername(candidate.username);
  const email = normalizeIdentityEmail(candidate.email);
  const phone = normalizeIdentityPhone(candidate.phone);
  for (const r of records) {
    if (exclude && r.source === exclude.source && r.id === exclude.id) continue;
    if (username && normalizeIdentityUsername(r.username) === username) return "username";
    if (email && normalizeIdentityEmail(r.email) === email) return "email";
    if (phone && normalizeIdentityPhone(r.phone) === phone) return "phone";
  }
  return null;
}

/** Field type only — never the conflicting account, role, or collection. */
export function identityConflictMessage(field: IdentityField): string {
  const label = field === "username" ? "username" : field === "email" ? "email address" : "phone number";
  return `This ${label} is already in use by another account.`;
}

/** The one canonical admin-type list. */
export const ADMIN_TYPES = ["super", "operation", "accounts"] as const;
export type CanonicalAdminType = (typeof ADMIN_TYPES)[number];

/**
 * Strict parse: the exact strings "super" | "operation" | "accounts" and
 * nothing else. No trimming, no case folding (the existing API never
 * normalized these), no fallback — "Super", " operation ", "admin", "",
 * null, and 42 all return null.
 */
export function parseAdminType(value: unknown): CanonicalAdminType | null {
  return value === "super" || value === "operation" || value === "accounts" ? value : null;
}

/**
 * Validation for the admin-CREATION route. Preserves the standing product
 * rule that no new Super Admin can be created through the API (the owner
 * is env-configured) — but as an EXPLICIT rejection, never the old silent
 * downgrade-to-operation fallback.
 */
export function validateCreatedAdminType(
  value: unknown
): { ok: true; adminType: "operation" | "accounts" } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") {
    return { ok: false, error: "adminType is required (operation or accounts)." };
  }
  const parsed = parseAdminType(value);
  if (!parsed) {
    return { ok: false, error: "Unknown adminType. Allowed values: operation, accounts." };
  }
  if (parsed === "super") {
    return { ok: false, error: "New Super Admin accounts cannot be created through this API." };
  }
  return { ok: true, adminType: parsed };
}
