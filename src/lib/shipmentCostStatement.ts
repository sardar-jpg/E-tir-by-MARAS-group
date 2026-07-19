/**
 * shipmentCostStatement.ts — pure helpers for the invariant "every shipment
 * has exactly one Cost Statement whose document id === shipmentId"
 * (PR #140 review increment 2, item 10).
 *
 * Creation is made all-or-nothing at the call site (a Firestore write batch,
 * or a memory write with rollback). This module holds the pure, deterministic
 * REPAIR planner for legacy shipments that predate that guarantee: given the
 * shipments and the existing cost-statement ids, it reports which shipments
 * are missing a statement — so the repair helper creates ONLY the missing
 * ones and never overwrites an existing statement, and is safe to rerun.
 */

/** Shipment ids that have no cost statement yet (deterministic, sorted). */
export function planCostStatementRepair(
  shipments: Array<{ id: string }>,
  existingCostStatementIds: Iterable<string>
): string[] {
  const have = new Set<string>();
  for (const id of existingCostStatementIds) if (typeof id === "string" && id) have.add(id);
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const s of shipments) {
    if (!s || typeof s.id !== "string" || !s.id) continue;
    if (have.has(s.id) || seen.has(s.id)) continue;
    seen.add(s.id);
    missing.push(s.id);
  }
  return missing.sort();
}
