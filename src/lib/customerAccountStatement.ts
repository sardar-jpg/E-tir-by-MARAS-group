/**
 * customerAccountStatement.ts — pure builder for a customer-facing account
 * statement (distinct from the internal Cost Statement). Shows, for ONE
 * currency, the opening balance, issued invoices (debits) and received
 * payments (credits) within a date range, a running balance, and the
 * closing balance. Never mixes currencies.
 *
 * Balance convention: a positive balance = the customer OWES MARAS
 * (invoices increase it; payments decrease it). Only issued invoices and
 * active (non-reversed) payments count.
 */
import type { CustomerInvoice, CustomerPayment, Currency } from "../types";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
const invoiceDate = (i: CustomerInvoice): string => (i.issuedAt || i.createdAt || "").slice(0, 10);
const paymentDate = (p: CustomerPayment): string => (p.paymentDate || p.createdAt || "").slice(0, 10);

export interface StatementRow {
  date: string;
  type: "invoice" | "payment";
  ref: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface CustomerAccountStatement {
  companyName: string;
  currency: Currency;
  from: string;
  to: string;
  openingBalance: number;
  rows: StatementRow[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
}

/**
 * Build the statement for a company + currency + [from,to] inclusive date
 * window. `from`/`to` are YYYY-MM-DD; empty `from` means "from the
 * beginning" (opening balance 0), empty `to` means "up to now".
 */
export function buildCustomerAccountStatement(params: {
  companyName: string;
  currency: Currency;
  invoices: CustomerInvoice[];
  payments: CustomerPayment[];
  from?: string;
  to?: string;
}): CustomerAccountStatement {
  const from = (params.from || "").slice(0, 10);
  const to = (params.to || "9999-12-31").slice(0, 10);
  const inCur = <T extends { currency: Currency }>(x: T) => x.currency === params.currency;

  const issuedInvoices = params.invoices.filter((i) => i.status === "issued" && inCur(i));
  const activePayments = params.payments.filter((p) => p.status === "active" && inCur(p));

  // Opening balance = everything strictly before `from`.
  let opening = 0;
  if (from) {
    for (const i of issuedInvoices) if (invoiceDate(i) < from) opening = round2(opening + i.sellingAmount);
    for (const p of activePayments) if (paymentDate(p) < from) opening = round2(opening - p.amount);
  }

  type Ev = { date: string; type: "invoice" | "payment"; ref: string; description: string; debit: number; credit: number };
  const events: Ev[] = [];
  for (const i of issuedInvoices) {
    const d = invoiceDate(i);
    if ((!from || d >= from) && d <= to) events.push({ date: d, type: "invoice", ref: i.invoiceNumber, description: i.description || "Invoice", debit: round2(i.sellingAmount), credit: 0 });
  }
  for (const p of activePayments) {
    const d = paymentDate(p);
    if ((!from || d >= from) && d <= to) events.push({ date: d, type: "payment", ref: p.reference || p.id, description: p.paymentMethod ? `Payment (${p.paymentMethod})` : "Payment", debit: 0, credit: round2(p.amount) });
  }
  // Deterministic order: by date, invoices before payments same-day, then ref.
  events.sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? a.ref.localeCompare(b.ref) : a.type === "invoice" ? -1 : 1));

  let balance = opening;
  let totalDebit = 0;
  let totalCredit = 0;
  const rows: StatementRow[] = events.map((e) => {
    balance = round2(balance + e.debit - e.credit);
    totalDebit = round2(totalDebit + e.debit);
    totalCredit = round2(totalCredit + e.credit);
    return { ...e, balance };
  });

  return {
    companyName: params.companyName,
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

/** The distinct currencies a customer has activity in (for a currency picker). */
export function customerStatementCurrencies(invoices: CustomerInvoice[], payments: CustomerPayment[]): Currency[] {
  const set = new Set<Currency>();
  for (const i of invoices) if (i.status === "issued") set.add(i.currency);
  for (const p of payments) if (p.status === "active") set.add(p.currency);
  return [...set].sort();
}
