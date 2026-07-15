/**
 * orderNumbering.ts
 *
 * Accounting Phase A — Canonical Order Reference. Introduces the eTIR
 * order number (`eTIR-000184` — a flat, zero-padded, non-year-scoped
 * sequence), the single business reference every financial document
 * (cost statements, invoices, payments, receipts, credit/debit notes) will
 * link to in later accounting phases. This phase only adds the number
 * itself: generation, formatting, and a one-time backfill for shipments
 * created before this field existed (see server.ts's
 * allocateNextOrderSequence and POST /api/admin/backfill-order-numbers).
 *
 * Deliberately reuses the exact concurrency-safe counter primitives
 * already proven by BUG-15 (nextSequenceFromCounterDoc,
 * InMemorySequenceCounter — both already generic, not shipment-specific,
 * despite living in shipmentNumbering.ts) rather than duplicating them —
 * server.ts's allocateNextOrderSequence mirrors allocateNextShipmentSequence
 * exactly, just against its own `counters/orders` Firestore document, so a
 * shipment's `shipmentNumber` and `orderNumber` sequences are independent
 * of each other and can never collide or interfere.
 *
 * `shipmentNumber` (MAR-YYYY-####) is left completely unchanged in this
 * phase — both fields coexist on Shipment. Whether shipmentNumber is
 * eventually retired in favor of orderNumber alone is a later-phase
 * decision, out of scope here.
 */

/** First order number issued is eTIR-000001 (sequence 0 maps to base 1). */
export const ORDER_NUMBER_BASE = 1;

/** Zero-padded digit count in the canonical eTIR-###### format. */
export const ORDER_NUMBER_PAD_LENGTH = 6;

export const ORDER_NUMBER_PREFIX = "eTIR-";

export function formatOrderNumber(sequence: number): string {
  return `${ORDER_NUMBER_PREFIX}${String(ORDER_NUMBER_BASE + sequence).padStart(ORDER_NUMBER_PAD_LENGTH, "0")}`;
}
