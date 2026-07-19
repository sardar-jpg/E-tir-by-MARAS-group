/**
 * expensePriority.ts — correct urgency modeling for expenses/payments
 * (PR #140 review increment 2, item 12).
 *
 * Urgency is NOT a payment method. Older mobile quick-expense records stored
 * `paymentMethod: "urgent"`, conflating priority with the actual method
 * (wire/cash/card/cheque). This module:
 *   - defines the priority model (normal | urgent),
 *   - normalizes legacy records on READ (a paymentMethod of "urgent" becomes
 *     priority "urgent" with the method cleared),
 *   - guards WRITES so "urgent" is never persisted as a payment method again.
 * Pure: no clock, db, or session.
 */

export type ExpensePriority = "normal" | "urgent";

export interface WithPriority {
  priority?: ExpensePriority;
  isUrgent?: boolean;
  paymentMethod?: string;
}

const isUrgentString = (v: unknown): boolean =>
  typeof v === "string" && v.trim().toLowerCase() === "urgent";

/** Whether a record is urgent, honoring priority, isUrgent, and legacy method. */
export function isUrgentExpense(record: WithPriority): boolean {
  if (record.priority === "urgent") return true;
  if (record.isUrgent === true) return true;
  return isUrgentString(record.paymentMethod);
}

/**
 * Normalize a (possibly legacy) record for READING: derives an explicit
 * `priority`, and if the legacy `paymentMethod` was the sentinel "urgent",
 * clears that invalid method (urgency now lives in `priority`). Never mutates
 * the input.
 */
export function normalizeExpensePriority<T extends WithPriority>(record: T): T & { priority: ExpensePriority } {
  const urgent = isUrgentExpense(record);
  const paymentMethod = isUrgentString(record.paymentMethod) ? "" : record.paymentMethod;
  return { ...record, priority: urgent ? "urgent" : "normal", paymentMethod };
}

/**
 * Sanitize a payment-method value for WRITING: an "urgent" sentinel is
 * rejected (returns "") so it can never be persisted as a method again.
 */
export function sanitizePaymentMethod(v: unknown): string {
  if (typeof v !== "string") return "";
  return isUrgentString(v) ? "" : v.trim().slice(0, 60);
}

/** Resolve an explicit priority from a request body (body.priority / body.isUrgent). */
export function resolveRequestedPriority(body: { priority?: unknown; isUrgent?: unknown }): ExpensePriority {
  if (body.priority === "urgent" || body.isUrgent === true) return "urgent";
  return "normal";
}
