import type { Currency } from "../types";
import type { VendorPaymentTransaction } from "../types";

/**
 * Vendor account statement — the vendor-side mirror of
 * customerAccountStatement.ts. A running-balance ledger of what MARAS owes a
 * single vendor across ALL shipments: vendor BILLS (cost lines billed by the
 * vendor) are debits that increase the payable, vendor PAYMENTS are credits
 * that reduce it. Pure + deterministic so it is unit-testable and identical on
 * the server (statement endpoint) and any client preview. No accounting rule
 * is changed — bills come from the existing cost items and payments from the
 * existing vendorPayments records.
 */

/** One vendor bill (a cost line billed by the vendor), normalized for the ledger. */
export interface VendorBill {
  /** MAR order number the bill belongs to. */
  shipmentNumber: string;
  /** YYYY-MM-DD. */
  date: string;
  description: string;
  amount: number;
  currency: Currency;
}

export interface VendorStatementRow {
  date: string;
  type: "bill" | "payment";
  ref: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface VendorAccountStatement {
  vendorName: string;
  currency: Currency;
  from: string;
  to: string;
  openingBalance: number;
  rows: VendorStatementRow[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const day = (s: string | undefined): string => (s || "").slice(0, 10);

/**
 * Build the vendor statement for a vendor + currency + [from,to] inclusive
 * date window. `from`/`to` are YYYY-MM-DD; empty `from` means "from the
 * beginning" (opening balance 0), empty `to` means "up to now".
 */
export function buildVendorAccountStatement(params: {
  vendorName: string;
  currency: Currency;
  bills: VendorBill[];
  payments: VendorPaymentTransaction[];
  from?: string;
  to?: string;
}): VendorAccountStatement {
  const from = day(params.from);
  const to = (params.to || "9999-12-31").slice(0, 10);
  const inCur = <T extends { currency: Currency }>(x: T) => x.currency === params.currency;

  const bills = params.bills.filter(inCur);
  // Only active (non-reversed) payments count against the payable.
  const payments = params.payments.filter((p) => (p as any).status !== "reversed" && inCur(p));

  // Opening balance = everything strictly before `from`.
  let opening = 0;
  if (from) {
    for (const b of bills) if (day(b.date) < from) opening = round2(opening + b.amount);
    for (const p of payments) if (day(p.paymentDate) < from) opening = round2(opening - p.amount);
  }

  type Ev = { date: string; type: "bill" | "payment"; ref: string; description: string; debit: number; credit: number };
  const events: Ev[] = [];
  for (const b of bills) {
    const d = day(b.date);
    if ((!from || d >= from) && d <= to) events.push({ date: d, type: "bill", ref: b.shipmentNumber, description: b.description || "Vendor bill", debit: round2(b.amount), credit: 0 });
  }
  for (const p of payments) {
    const d = day(p.paymentDate);
    if ((!from || d >= from) && d <= to) events.push({ date: d, type: "payment", ref: p.shipmentNumber || p.id, description: p.paymentMethod ? `Payment (${p.paymentMethod})` : "Payment", debit: 0, credit: round2(p.amount) });
  }
  // Deterministic order: by date, bills before payments same-day, then ref.
  events.sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? a.ref.localeCompare(b.ref) : a.type === "bill" ? -1 : 1));

  let balance = opening;
  let totalDebit = 0;
  let totalCredit = 0;
  const rows: VendorStatementRow[] = events.map((e) => {
    balance = round2(balance + e.debit - e.credit);
    totalDebit = round2(totalDebit + e.debit);
    totalCredit = round2(totalCredit + e.credit);
    return { ...e, balance };
  });

  return {
    vendorName: params.vendorName,
    currency: params.currency,
    from: from || (rows[0]?.date ?? ""),
    to: params.to ? to : (rows[rows.length - 1]?.date ?? ""),
    openingBalance: opening,
    rows,
    totalDebit,
    totalCredit,
    closingBalance: round2(opening + totalDebit - totalCredit),
  };
}

/** The distinct currencies a vendor has activity in (for a currency picker). */
export function vendorStatementCurrencies(bills: VendorBill[], payments: VendorPaymentTransaction[]): Currency[] {
  const set = new Set<Currency>();
  for (const b of bills) set.add(b.currency);
  for (const p of payments) set.add(p.currency);
  return [...set];
}
