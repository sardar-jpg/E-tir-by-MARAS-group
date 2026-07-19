/**
 * idempotency.ts — pure, deterministic retry safety for financial POST
 * operations (PR #140 review, Phase 2).
 *
 * Financial uniqueness must NOT depend on Date.now()+Math.random(). Instead a
 * client sends a stable idempotencyKey per user action; the server stores it
 * on the created record. Replaying the same key returns the ORIGINAL record;
 * replaying the same key with a CONFLICTING payload is rejected (409). A key
 * is scoped by action type (e.g. "customer-payment", "receipt") so the same
 * client-generated key can't collide across different operations.
 *
 * Pure: no clock, no db. The server layer supplies the already-loaded records.
 */

export interface IdempotentRecord {
  idempotencyKey?: string;
}

export type IdempotencyOutcome<T> =
  | { kind: "proceed" }
  | { kind: "replay"; record: T }
  | { kind: "conflict"; code: "idempotency_conflict"; error: string };

/** Normalize a client-supplied key (trim, cap length); undefined when blank. */
export function normalizeIdempotencyKey(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const k = v.trim().slice(0, 200);
  return k || undefined;
}

/** Scope a raw key by action type so keys can't collide across operations. */
export function scopeIdempotencyKey(action: string, key: string): string {
  return `${action}:${key}`;
}

/**
 * A stable fingerprint of a request's financially-significant payload. Keys
 * are sorted so field order can't change the fingerprint; values are
 * normalized to strings. Two requests with the same idempotencyKey but
 * different fingerprints are a conflict.
 */
export function fingerprintPayload(fields: Record<string, unknown>): string {
  const norm = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
    if (typeof v === "boolean") return v ? "1" : "0";
    return String(v).trim();
  };
  return Object.keys(fields)
    .sort()
    .map((k) => `${k}=${norm(fields[k])}`)
    .join("|");
}

/**
 * Decide the outcome for an incoming request given the existing records that
 * carry a (scoped) idempotencyKey. When no key is supplied, always proceed
 * (idempotency is opt-in per action). When a stored record shares the key:
 * identical fingerprint → replay the original; different fingerprint →
 * conflict.
 */
export function resolveIdempotency<T extends IdempotentRecord>(params: {
  existing: T[];
  scopedKey: string | undefined;
  fingerprintOf: (record: T) => string;
  requestFingerprint: string;
}): IdempotencyOutcome<T> {
  if (!params.scopedKey) return { kind: "proceed" };
  const prior = params.existing.find((r) => r.idempotencyKey === params.scopedKey);
  if (!prior) return { kind: "proceed" };
  if (params.fingerprintOf(prior) !== params.requestFingerprint) {
    return { kind: "conflict", code: "idempotency_conflict", error: "This idempotency key was already used with a different request." };
  }
  return { kind: "replay", record: prior };
}
