/**
 * customerIdentity.ts — authoritative customer identity for the accounting
 * module (PR #140 review, Phase 1).
 *
 * Customer accounting records (invoices, payments, receipts) are owned by an
 * IMMUTABLE clientId, never by the mutable companyName. companyName remains
 * only a display snapshot and a search label; renaming a company must never
 * move records between customers or break account history. This module is the
 * single place that:
 *   - requires a clientId on every NEW accounting write,
 *   - decides whether two records belong to the same customer (by id only),
 *   - guards payment→invoice allocation against cross-customer leakage.
 *
 * Records are always created with a clientId (the API rejects writes without
 * one), so there is no companyName-based legacy resolution: identity is never
 * inferred from a mutable display name.
 *
 * Pure: no clock, no db, no session.
 */

export type IdentityResolution =
  | { ok: true; clientId: string }
  | { ok: false; code: "unresolved_identity"; error: string };

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Every NEW accounting record MUST carry a clientId. Rejects blank/absent
 * values so companyName can never become the identity of a fresh record.
 */
export function requireClientId(clientId: unknown): IdentityResolution {
  const id = clean(clientId);
  if (id) return { ok: true, clientId: id };
  return { ok: false, code: "unresolved_identity", error: "A customer clientId is required for new accounting records." };
}

/**
 * Same-customer decision by immutable identity ONLY. Two records are the same
 * customer when both carry a clientId and the ids are equal. A missing
 * clientId on either side means "cannot confirm" (false) — identity is never
 * inferred from companyName, so records can never leak across customers.
 */
export function sameCustomerById(a: { clientId?: string; companyName?: string }, b: { clientId?: string; companyName?: string }): boolean {
  const ca = clean(a.clientId);
  const cb = clean(b.clientId);
  return !!ca && !!cb && ca === cb;
}
