/**
 * vendorPayableLedger.ts — deterministic, transaction-safe per-cost-item
 * ledger (PR #140 review increment 3, item 6).
 *
 * The ledger (vendorPayableLedgers/{shipmentId}_{costItemId}) is a REBUILDABLE
 * aggregate of a cost item's payable state. It is read and written INSIDE a
 * Firestore transaction so Firestore — not an in-process mutex — enforces the
 * no-overpayment invariant across server instances. It never replaces the
 * source vendorPayments records: those remain authoritative and the ledger can
 * always be recomputed from them (buildVendorLedger / reconcileVendorLedger).
 * Pure: no clock, db, or session.
 */
import type { Currency, CostItem, VendorPaymentTransaction } from "../types";

export type VendorLedgerStatus = "unpaid" | "partial" | "paid" | "overpaid";

export interface VendorPayableLedger {
  id: string; // `${shipmentId}_${costItemId}`
  shipmentId: string;
  costItemId: string;
  currency: Currency;
  costAmount: number;
  paidAmount: number;
  status: VendorLedgerStatus;
  revision: number;
  updatedAt: string;
}

const round2 = (n: number): number => Math.round(((Number.isFinite(n) ? n : 0) + Number.EPSILON) * 100) / 100;

export function vendorLedgerId(shipmentId: string, costItemId: string): string {
  return `${shipmentId}_${costItemId}`;
}

export function vendorLedgerStatus(costAmount: number, paidAmount: number): VendorLedgerStatus {
  const cost = round2(costAmount);
  const paid = round2(paidAmount);
  if (paid <= 0) return "unpaid";
  if (paid < cost) return "partial";
  if (paid === cost) return "paid";
  return "overpaid";
}

/** Build/rebuild a ledger from the cost item + its ACTIVE vendor payments (the source of truth). */
export function buildVendorLedger(params: {
  shipmentId: string;
  item: Pick<CostItem, "id" | "totalAmount" | "currency">;
  payments: VendorPaymentTransaction[];
  nowIso: string;
  revision?: number;
}): VendorPayableLedger {
  const paid = round2(
    params.payments
      .filter((p) => p.costItemId === params.item.id && p.status === "active")
      .reduce((s, p) => s + (Number.isFinite(p.amount) ? p.amount : 0), 0)
  );
  const cost = round2(Number.isFinite(params.item.totalAmount) ? params.item.totalAmount : 0);
  return {
    id: vendorLedgerId(params.shipmentId, params.item.id),
    shipmentId: params.shipmentId,
    costItemId: params.item.id,
    currency: params.item.currency,
    costAmount: cost,
    paidAmount: paid,
    status: vendorLedgerStatus(cost, paid),
    revision: params.revision ?? 1,
    updatedAt: params.nowIso,
  };
}

export type VendorLedgerDecision =
  | { ok: true; nextPaid: number }
  | { ok: false; code: string; error: string };

/** Decide whether a new vendor payment of `amount` is allowed against the ledger. */
export function decideVendorPayment(params: {
  ledger: VendorPayableLedger;
  amount: number;
  currency: Currency;
  allowOverpayment: boolean;
}): VendorLedgerDecision {
  if (!Number.isFinite(params.amount) || params.amount <= 0) return { ok: false, code: "invalid_amount", error: "Amount must be a positive number." };
  if (params.currency !== params.ledger.currency) return { ok: false, code: "currency_mismatch", error: "Payment currency must match the cost item currency." };
  const nextPaid = round2(params.ledger.paidAmount + round2(params.amount));
  if (!params.allowOverpayment && nextPaid > params.ledger.costAmount) {
    return { ok: false, code: "overpay", error: "Payment exceeds the remaining payable balance." };
  }
  return { ok: true, nextPaid };
}

/** Apply a paid-amount delta (create → +amount, reverse → −amount), bumping revision. */
export function applyVendorLedgerDelta(ledger: VendorPayableLedger, deltaPaid: number, nowIso: string): VendorPayableLedger {
  const paid = round2(Math.max(0, ledger.paidAmount + deltaPaid));
  return { ...ledger, paidAmount: paid, status: vendorLedgerStatus(ledger.costAmount, paid), revision: (ledger.revision || 1) + 1, updatedAt: nowIso };
}

/** Reconciliation check for repair/tests: does a stored ledger match the source? */
export function reconcileVendorLedger(stored: VendorPayableLedger | null, expected: VendorPayableLedger): boolean {
  return !!stored &&
    round2(stored.paidAmount) === round2(expected.paidAmount) &&
    round2(stored.costAmount) === round2(expected.costAmount) &&
    stored.status === expected.status;
}
