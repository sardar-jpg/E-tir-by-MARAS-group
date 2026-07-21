/**
 * shipmentNumberFormat.ts — the ONE official format standard for the MARAS
 * business reference, a.k.a. the "Order Number" (audit finding F-4).
 *
 *   Canonical format:  MAR-YYYY-0001
 *     - fixed "MAR" prefix
 *     - four-digit calendar year
 *     - EXACTLY four sequence digits, zero-padded on the left
 *
 *   Valid:   MAR-2026-0001, MAR-2026-0010, MAR-2026-0100, MAR-2026-1000
 *   Invalid: ETIR-2026-001, eTIR-2026-001, MAR-2026-001, MAR-2026-01, MAR-2026-1
 *
 * This module is a FORMAT DEFINITION (validator + zero-padding rule) — NOT a
 * generator and NOT a second business-reference field. The single canonical
 * reference remains `shipmentNumber`, allocated in production by
 * shipmentNumbering.ts's formatShipmentNumber() with a base-1001 offset (so
 * the first order is MAR-YYYY-1001 — already a conformant four-digit value,
 * never a three-digit one). shipmentNumberFormat.test.ts asserts that the
 * production output conforms to this standard and that the base-1001
 * historical scheme is left unchanged. (See noOrderNumberRegression.test.ts:
 * no parallel reference system is introduced here.)
 */

/** Exactly four sequence digits, per the official standard. */
export const CANONICAL_SHIPMENT_NUMBER_REGEX = /^MAR-\d{4}-\d{4}$/;

/** True only for a string that matches the canonical MAR-YYYY-#### format. */
export function isCanonicalShipmentNumber(value: unknown): boolean {
  return typeof value === "string" && CANONICAL_SHIPMENT_NUMBER_REGEX.test(value);
}

/**
 * True for reference strings in an OBSOLETE / non-conformant format that must
 * never be produced anew: the retired ETIR/eTIR prefix, or a MAR value whose
 * sequence is not exactly four digits (e.g. the old three-digit MAR-2026-001).
 * Purely a classifier — it mutates nothing, so historical stored values are
 * never rewritten by calling it.
 */
export function isObsoleteShipmentNumber(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (/^e?TIR-/i.test(value)) return true;
  // A MAR-prefixed value that is not the canonical four-digit form.
  if (/^MAR-\d{4}-\d+$/.test(value) && !CANONICAL_SHIPMENT_NUMBER_REGEX.test(value)) return true;
  return false;
}

/**
 * Zero-pad a raw sequence to the canonical four digits. Sequences at or above
 * 10000 keep their natural width (already ≥ four digits); the operational
 * range (1..9999) always renders as exactly four digits.
 *   1 → "0001", 9 → "0009", 10 → "0010", 100 → "0100", 999 → "0999", 1000 → "1000"
 */
export function padShipmentSequence(sequence: number): string {
  const n = Math.trunc(sequence);
  if (!Number.isFinite(n) || n < 0) {
    throw new RangeError(`Invalid shipment-number sequence: ${sequence}`);
  }
  return String(n).padStart(4, "0");
}
