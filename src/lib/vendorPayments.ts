/**
 * vendorPayments.ts — pure, server-authoritative logic for vendor payables.
 *
 * A vendor cost (one CostItem) may be settled through MULTIPLE partial
 * payments, so each payment is a discrete VendorPaymentTransaction. Paid /
 * remaining / status are NEVER stored on the item — they are DERIVED here
 * from the active (non-reversed) transactions, so Firestore and memory
 * modes cannot drift. Nothing here reads the clock, db, or session.
 *
 * Currency discipline: a payment's currency MUST equal its cost item's
 * currency (no FX, matching the rest of the accounting module). Overpayment
 * is refused unless the caller explicitly opts in.
 */
import type { CostItem, VendorPaymentTransaction, VendorPayableStatus, Currency } from "../types";

/** Only these count toward totals; reversed payments are retained but excluded. */
export function isActivePayment(p: Pick<VendorPaymentTransaction, "status">): boolean {
  return p.status === "active";
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface VendorPayableSummary {
  costItemId: string;
  currency: Currency;
  costAmount: number;
  totalPaid: number;
  remaining: number;
  status: VendorPayableStatus;
  activePaymentCount: number;
  reversedPaymentCount: number;
}

/**
 * Summarize one cost item's payable state from its payment transactions.
 * `payments` may include payments for other items and reversed ones — both
 * are filtered out. Totals use only same-item, active payments.
 */
export function summarizeVendorPayable(
  item: Pick<CostItem, "id" | "totalAmount" | "currency">,
  payments: VendorPaymentTransaction[]
): VendorPayableSummary {
  const mine = payments.filter((p) => p.costItemId === item.id);
  const active = mine.filter(isActivePayment);
  const totalPaid = round2(active.reduce((s, p) => s + (Number.isFinite(p.amount) ? p.amount : 0), 0));
  const costAmount = round2(Number.isFinite(item.totalAmount) ? item.totalAmount : 0);
  const remaining = round2(costAmount - totalPaid);
  let status: VendorPayableStatus;
  if (totalPaid <= 0) status = "Unpaid";
  else if (totalPaid < costAmount) status = "Partially Paid";
  else if (totalPaid === costAmount) status = "Paid";
  else status = "Overpaid";
  return {
    costItemId: item.id,
    currency: item.currency,
    costAmount,
    totalPaid,
    remaining,
    status,
    activePaymentCount: active.length,
    reversedPaymentCount: mine.length - active.length,
  };
}

export type VendorPaymentValidation =
  | { ok: true; amount: number }
  | { ok: false; code: string; error: string };

/**
 * Validate a proposed payment against the target cost item and the item's
 * existing payments. Enforces: positive finite amount, currency match, and
 * (unless allowOverpayment) that the new active total cannot exceed the
 * cost amount. Pure — the atomic write + persistence happen in the caller.
 */
export function validateVendorPayment(params: {
  item: Pick<CostItem, "id" | "totalAmount" | "currency"> | null | undefined;
  existingPayments: VendorPaymentTransaction[];
  amount: unknown;
  currency: unknown;
  allowOverpayment?: boolean;
}): VendorPaymentValidation {
  const { item } = params;
  if (!item) return { ok: false, code: "item_not_found", error: "The cost line for this payment was not found." };
  const amount = typeof params.amount === "number" && Number.isFinite(params.amount) ? round2(params.amount) : NaN;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, code: "invalid_amount", error: "Payment amount must be a positive number." };
  }
  if (params.currency !== item.currency) {
    return { ok: false, code: "currency_mismatch", error: `Payment currency must match the cost line currency (${item.currency}).` };
  }
  if (!params.allowOverpayment) {
    const summary = summarizeVendorPayable(item, params.existingPayments);
    if (round2(summary.totalPaid + amount) > summary.costAmount) {
      return { ok: false, code: "would_overpay", error: `This payment would exceed the remaining payable (${summary.remaining} ${item.currency}).` };
    }
  }
  return { ok: true, amount };
}

/** A payment can be reversed only if it is currently active and has a reason. */
export function canReverseVendorPayment(
  payment: Pick<VendorPaymentTransaction, "status"> | null | undefined,
  reason: string
): { ok: true } | { ok: false; code: string; error: string } {
  if (!payment) return { ok: false, code: "not_found", error: "Payment not found." };
  if (payment.status !== "active") return { ok: false, code: "not_active", error: "Only an active payment can be reversed." };
  if (!reason || !reason.trim()) return { ok: false, code: "reason_required", error: "A reversal reason is required." };
  return { ok: true };
}

/**
 * Duplicate-submission guard: true when an ACTIVE payment for the same item
 * with the same amount + paymentDate + reference already exists (a
 * double-click / retry). Deterministic, currency already validated.
 */
export function isDuplicateVendorPayment(
  existingPayments: VendorPaymentTransaction[],
  candidate: { costItemId: string; amount: number; paymentDate: string; reference?: string }
): boolean {
  const ref = (candidate.reference || "").trim();
  return existingPayments.some(
    (p) =>
      isActivePayment(p) &&
      p.costItemId === candidate.costItemId &&
      round2(p.amount) === round2(candidate.amount) &&
      (p.paymentDate || "") === (candidate.paymentDate || "") &&
      (p.reference || "").trim() === ref
  );
}

/** Bucket a payable summary for the Unpaid/Partial/Paid/Overdue filters. */
export function matchesPayableFilter(
  summary: VendorPayableSummary,
  filter: "all" | "unpaid" | "partial" | "paid" | "overdue",
  dueDate: string | undefined,
  nowIso: string
): boolean {
  if (filter === "all") return true;
  if (filter === "unpaid") return summary.status === "Unpaid";
  if (filter === "partial") return summary.status === "Partially Paid";
  if (filter === "paid") return summary.status === "Paid" || summary.status === "Overpaid";
  // overdue: past due date AND not fully paid.
  const notFullyPaid = summary.status === "Unpaid" || summary.status === "Partially Paid";
  return notFullyPaid && !!dueDate && dueDate < nowIso.slice(0, 10);
}
