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
 *   - resolves the clientId for a (possibly legacy) record, falling back to
 *     the matching Client in the customers collection — never silently using
 *     companyName as a permanent identity,
 *   - decides whether two records belong to the same customer (by id only),
 *   - guards payment→invoice allocation against cross-customer leakage.
 *
 * Pure: no clock, no db, no session.
 */
import type { Client } from "../types";

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
 * Index the customers collection by normalized companyName → clientId, for
 * legacy resolution. First writer wins on duplicate names (deterministic);
 * ambiguous duplicate company names simply won't resolve to a single id,
 * which is the safe outcome (the caller then rejects the operation).
 */
export function indexClientsByCompany(clients: Pick<Client, "id" | "companyName">[]): Map<string, string> {
  const byName = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const c of clients) {
    const key = clean(c.companyName).toLowerCase();
    const id = clean(c.id);
    if (!key || !id) continue;
    if (byName.has(key) && byName.get(key) !== id) { ambiguous.add(key); continue; }
    if (!byName.has(key)) byName.set(key, id);
  }
  for (const key of ambiguous) byName.delete(key);
  return byName;
}

/**
 * Resolve the authoritative clientId for a record. Prefers the record's own
 * clientId; otherwise resolves the legacy record from the customers index by
 * exact (normalized) companyName. Returns unresolved when neither is
 * available — callers must then reject the operation rather than fall back to
 * companyName as identity.
 */
export function resolveRecordClientId(
  record: { clientId?: string; companyName?: string },
  clientsByCompany: Map<string, string>
): IdentityResolution {
  const own = clean(record.clientId);
  if (own) return { ok: true, clientId: own };
  const key = clean(record.companyName).toLowerCase();
  const resolved = key ? clientsByCompany.get(key) : undefined;
  if (resolved) return { ok: true, clientId: resolved };
  return { ok: false, code: "unresolved_identity", error: "This legacy record has no customer identity and none could be resolved from the customers list." };
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

/**
 * Backfill helper: given accounting records and the customers index, return
 * the records that CAN be assigned a clientId (with the resolved id) and the
 * ones that cannot (unresolved — must be reviewed manually, never guessed
 * from companyName). Deterministic; performs no writes.
 */
export function planClientIdBackfill<T extends { id?: string; clientId?: string; companyName?: string }>(
  records: T[],
  clientsByCompany: Map<string, string>
): { resolved: Array<{ record: T; clientId: string }>; unresolved: T[] } {
  const resolved: Array<{ record: T; clientId: string }> = [];
  const unresolved: T[] = [];
  for (const record of records) {
    if (clean(record.clientId)) continue; // already has identity
    const r = resolveRecordClientId(record, clientsByCompany);
    if (r.ok) resolved.push({ record, clientId: r.clientId });
    else unresolved.push(record);
  }
  return { resolved, unresolved };
}
