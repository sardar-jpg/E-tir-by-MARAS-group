/**
 * identityReservation.ts — transactional identity uniqueness (PR #137
 * review item 2).
 *
 * The collection-wide scan (accountIdentity.ts) is a LEGACY-account guard
 * only: legacy data is static, so a scan reliably blocks collisions with
 * accounts that predate reservations. What the scan cannot do is stop TWO
 * CONCURRENT requests claiming the same NEW identity — both scans pass,
 * both create. The authoritative uniqueness mechanism is therefore a
 * reservation-key collection:
 *
 *   accountIdentityKeys/{field}_{sha256(normalizedValue).slice(0,40)}
 *     → { id, field, source, accountId, valueHash, reservedAt }
 *
 * One deterministic key document per nonblank identity value. Records
 * hold minimum metadata only: owning collection + account id + field +
 * the hash — never the raw value, never passwords/tokens.
 *
 * Atomicity:
 *   - Firestore mode: server.ts runs claim/release + the account write in
 *     ONE db.runTransaction — a losing concurrent claimant aborts with a
 *     conflict and writes nothing (no orphan reservations, no account).
 *   - Memory fallback: applyIdentityReservationMemory below is fully
 *     SYNCHRONOUS (no await between check and mutation), which on the
 *     Node event loop gives equivalent atomic semantics within one
 *     process.
 *
 * The protected owner participates as owner-source reservations that are
 * created idempotently at startup and can never be claimed or released by
 * any account.
 */
import crypto from "crypto";
import {
  normalizeIdentityUsername,
  normalizeIdentityEmail,
  normalizeIdentityPhone,
  buildOwnerIdentityRecord,
  type IdentityField,
  type IdentityCandidate,
} from "./accountIdentity";

export const IDENTITY_KEYS_COLLECTION = "accountIdentityKeys";
export const OWNER_RESERVATION_SOURCE = "owner";

export interface IdentityKeyClaim {
  field: IdentityField;
  keyId: string;
  valueHash: string;
}

export interface IdentityReservationRecord {
  id: string;
  field: IdentityField;
  source: string;
  accountId: string;
  valueHash: string;
  reservedAt: string;
}

export class IdentityConflictError extends Error {
  field: IdentityField;
  constructor(field: IdentityField) {
    super(`identity_conflict:${field}`);
    this.field = field;
  }
}

const normalizeFor = (field: IdentityField, value: string | undefined): string =>
  field === "username" ? normalizeIdentityUsername(value)
  : field === "email" ? normalizeIdentityEmail(value)
  : normalizeIdentityPhone(value);

/** Deterministic, Firestore-safe key id; null for blank values. */
export function buildIdentityKeyId(field: IdentityField, rawValue: string | undefined): string | null {
  const normalized = normalizeFor(field, rawValue);
  if (!normalized) return null;
  const hash = crypto.createHash("sha256").update(`${field}:${normalized}`).digest("hex");
  return `${field}_${hash.slice(0, 40)}`;
}

/** Claims for every nonblank field of a candidate. */
export function computeIdentityClaims(candidate: IdentityCandidate): IdentityKeyClaim[] {
  const claims: IdentityKeyClaim[] = [];
  for (const field of ["username", "email", "phone"] as const) {
    const keyId = buildIdentityKeyId(field, candidate[field]);
    if (keyId) claims.push({ field, keyId, valueHash: keyId.slice(field.length + 1) });
  }
  return claims;
}

export function buildReservationRecord(
  claim: IdentityKeyClaim,
  owner: { source: string; accountId: string },
  nowIso: string
): IdentityReservationRecord {
  return { id: claim.keyId, field: claim.field, source: owner.source, accountId: owner.accountId, valueHash: claim.valueHash, reservedAt: nowIso };
}

/**
 * Update diffing: which keys to newly reserve and which to release, given
 * the account's previous and next identity. Unchanged values appear in
 * neither list (their reservation simply stays).
 */
export function diffIdentityClaims(
  previous: IdentityCandidate,
  next: IdentityCandidate
): { toReserve: IdentityKeyClaim[]; toReleaseKeyIds: string[] } {
  const prevClaims = computeIdentityClaims(previous);
  const nextClaims = computeIdentityClaims(next);
  const prevIds = new Set(prevClaims.map((c) => c.keyId));
  const nextIds = new Set(nextClaims.map((c) => c.keyId));
  return {
    toReserve: nextClaims.filter((c) => !prevIds.has(c.keyId)),
    toReleaseKeyIds: prevClaims.map((c) => c.keyId).filter((id) => !nextIds.has(id)),
  };
}

/**
 * Conflict decision shared by both persistence modes: an existing
 * reservation with a DIFFERENT owner (including the permanent owner-source
 * reservations) blocks the claim; the account's own reservation does not.
 */
export function findClaimConflict(
  claims: IdentityKeyClaim[],
  existing: Map<string, Pick<IdentityReservationRecord, "source" | "accountId">>,
  owner: { source: string; accountId: string }
): IdentityField | null {
  for (const claim of claims) {
    const current = existing.get(claim.keyId);
    if (current && !(current.source === owner.source && current.accountId === owner.accountId)) {
      return claim.field;
    }
  }
  return null;
}

/** A release is only honored for the exact owning account — and NEVER for owner-source reservations. */
export function canReleaseReservation(
  record: Pick<IdentityReservationRecord, "source" | "accountId"> | null | undefined,
  owner: { source: string; accountId: string }
): boolean {
  if (!record) return false;
  if (record.source === OWNER_RESERVATION_SOURCE) return false;
  return record.source === owner.source && record.accountId === owner.accountId;
}

/** The permanently reserved owner claims (email + username form). */
export function computeOwnerClaims(ownerEmail: string): IdentityKeyClaim[] {
  const ownerRecord = buildOwnerIdentityRecord(ownerEmail);
  return computeIdentityClaims({ username: ownerRecord.username, email: ownerRecord.email });
}

export interface MemoryReservationStores {
  /** The memoryStore.accountIdentityKeys array (mutated in place). */
  keys: IdentityReservationRecord[];
  /** The target account collection array (mutated in place), or null for release-only operations. */
  accounts: Array<Record<string, unknown> & { id?: string }> | null;
}

/**
 * Memory-fallback atomic apply: check + reserve + release + account write
 * with NO awaits — atomic within one Node process by construction. Throws
 * IdentityConflictError before ANY mutation on conflict (no orphans).
 */
export function applyIdentityReservationMemory(
  stores: MemoryReservationStores,
  op: {
    owner: { source: string; accountId: string };
    claims: IdentityKeyClaim[];
    releaseKeyIds: string[];
    accountWrite?: Record<string, unknown> & { id: string };
    accountDeleteId?: string;
  }
): void {
  const byId = new Map(stores.keys.map((k) => [k.id, k]));
  const conflict = findClaimConflict(op.claims, byId, op.owner);
  if (conflict) throw new IdentityConflictError(conflict);

  const nowIso = new Date().toISOString();
  for (const claim of op.claims) {
    const idx = stores.keys.findIndex((k) => k.id === claim.keyId);
    const record = buildReservationRecord(claim, op.owner, nowIso);
    if (idx >= 0) stores.keys[idx] = record;
    else stores.keys.push(record);
  }
  for (const keyId of op.releaseKeyIds) {
    const idx = stores.keys.findIndex((k) => k.id === keyId);
    if (idx >= 0 && canReleaseReservation(stores.keys[idx], op.owner)) stores.keys.splice(idx, 1);
  }
  if (op.accountWrite && stores.accounts) {
    const idx = stores.accounts.findIndex((a) => a.id === op.accountWrite!.id);
    if (idx >= 0) stores.accounts[idx] = op.accountWrite;
    else stores.accounts.push(op.accountWrite);
  }
  if (op.accountDeleteId && stores.accounts) {
    const idx = stores.accounts.findIndex((a) => a.id === op.accountDeleteId);
    if (idx >= 0) stores.accounts.splice(idx, 1);
  }
}
