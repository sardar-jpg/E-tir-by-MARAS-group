/**
 * paymentReceipt.ts — pure logic for customer payment receipts. A receipt
 * is generated once per active payment (idempotent), snapshots the company
 * branding + bank at issue time, and lists the MAR invoices the payment
 * covered. Voided (never deleted) when the payment is reversed. No internal
 * cost/profit is involved — payments carry none — so the receipt is already
 * safe to show a customer.
 */
import type { CustomerPayment, PaymentReceipt } from "../types";

// Receipt numbering moved to a collision-safe, transaction-backed per-year
// sequence (accountingSequence.ts → formatReceiptNumber, "RCPT-YYYY-000001").
// The former count-based buildReceiptNumber(sequenceForCompany) is removed:
// deriving a number from a non-atomic read of how many receipts already
// exist let two concurrent creations hand out the same number.

export type ReceiptDecision = { ok: true } | { ok: false; code: string; error: string };

/** A receipt may be issued only for an active payment. */
export function canIssueReceipt(payment: Pick<CustomerPayment, "status"> | null | undefined): ReceiptDecision {
  if (!payment) return { ok: false, code: "not_found", error: "Payment not found." };
  if (payment.status !== "active") return { ok: false, code: "payment_not_active", error: "A receipt can only be issued for an active payment." };
  return { ok: true };
}

/** The existing active receipt for a payment, if any (idempotency). */
export function findActiveReceiptForPayment(receipts: PaymentReceipt[], paymentId: string): PaymentReceipt | undefined {
  return receipts.find((r) => r.paymentId === paymentId && r.status === "issued");
}

/**
 * Customer-facing projection of a receipt. Receipts contain no internal
 * cost/profit, so this simply guarantees a stable, explicit shape (and
 * omits internal audit fields like issuedBy).
 */
export interface PaymentReceiptView {
  receiptNumber: string;
  companyName: string;
  amount: number;
  currency: string;
  paymentDate: string;
  paymentMethod: string;
  reference?: string;
  bankAccountSnapshot?: string;
  coveredInvoices: { invoiceNumber: string; amount: number }[];
  status: PaymentReceipt["status"];
  issuedAt: string;
}

export function buildReceiptView(receipt: PaymentReceipt): PaymentReceiptView {
  return {
    receiptNumber: receipt.receiptNumber,
    companyName: receipt.companyName,
    amount: receipt.amount,
    currency: receipt.currency,
    paymentDate: receipt.paymentDate,
    paymentMethod: receipt.paymentMethod,
    reference: receipt.reference,
    bankAccountSnapshot: receipt.bankAccountSnapshot,
    coveredInvoices: (receipt.allocations || []).map((a) => ({ invoiceNumber: a.invoiceNumber, amount: a.amount })),
    status: receipt.status,
    issuedAt: receipt.issuedAt,
  };
}
