/**
 * accountingSequence.ts — collision-safe accounting document sequences
 * (PR #140 review increment 2, item 6).
 *
 * Receipt numbering policy (documented + stable):
 *   RCPT-YYYY-000001  (per-YEAR sequence, 6-digit zero-padded, 1-based)
 *
 * The sequence is handed out from a single counter document per year
 * (`counters/receipt-<year>`), incremented inside a Firestore transaction
 * (or the single-threaded in-memory counter when Firestore is unavailable) —
 * exactly like the shipment-number allocator (shipmentNumbering.ts). This
 * pure module holds the format + the read-modify-write step so it can be
 * unit-tested without a real transaction; the atomicity guarantee comes from
 * WHERE it is called (server.ts allocateNextReceiptSequence).
 */

/** The stored counter document shape (mirrors ShipmentSequenceCounterDoc). */
export interface AccountingSequenceDoc {
  count: number;
}

/**
 * Pure read-modify-write for an accounting counter document. `count` is the
 * last number handed out; the next caller gets count+1 (1-based). Returns the
 * number to use plus the doc to write back. Because two concurrent callers
 * that read the same `existing` both try to commit count+1, the transaction
 * that wraps this retries the loser against the winner's committed value — so
 * a number can only ever be handed out once.
 */
export function nextAccountingSequence(existing: AccountingSequenceDoc | undefined): { issued: number; next: AccountingSequenceDoc } {
  const last = existing && Number.isFinite(existing.count) ? existing.count : 0;
  const issued = last + 1;
  return { issued, next: { count: issued } };
}

/** Counter document id for a given year's receipt sequence. */
export function receiptSequenceDocId(year: number): string {
  return `receipt-${year}`;
}

/** The (UTC) year an accounting document belongs to, from an ISO date/time. */
export function accountingYearOf(iso: string | undefined): number {
  const d = iso ? new Date(iso) : new Date();
  const y = d.getUTCFullYear();
  return Number.isFinite(y) ? y : new Date().getUTCFullYear();
}

/** Format a receipt number for a year + 1-based sequence. */
export function formatReceiptNumber(year: number, sequence: number): string {
  return `RCPT-${year}-${String(Math.max(1, Math.trunc(sequence))).padStart(6, "0")}`;
}
