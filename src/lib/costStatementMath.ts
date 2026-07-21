/**
 * costStatementMath.ts — Accounting Phase B (Minimal Correctness and
 * Separation): the ONE place that defines what every accounting number
 * means and how it is derived. Pure functions only — unit-tested
 * directly, and shared by the server route (authoritative enforcement),
 * the statement editor, the on-screen previews, and the PDF/CSV export
 * paths so they can never drift from each other.
 *
 * The two sides of a shipment's money are strictly separated:
 *
 *   EXPENSE SIDE — money MARAS PAYS (vendors/suppliers):
 *     totalCost          Σ item.quantity × item.unitPrice (server-derived)
 *     paidAmount         Expense Paid Amount — what MARAS has paid toward
 *                        those costs. NEVER money from the customer.
 *     expenseRemaining   max(0, totalCost − paidAmount)  (payable)
 *     expenseCredit      max(0, paidAmount − totalCost)  (overpayment)
 *     paymentStatus      Unpaid / Partial / Paid — expense-side only.
 *
 *   CUSTOMER SIDE — money MARAS RECEIVES (Accounting Phase 1: revenue is the
 *   ISSUED CUSTOMER INVOICE total, never the driver's agreedAmount):
 *     customerInvoiceTotal    the issued customer invoice total (the customer's
 *                             billed revenue for the shipment)
 *     customerReceivedAmount  what the customer has actually paid MARAS
 *                             (legacy statements without it resolve to 0)
 *     customerReceivable      max(0, customerInvoiceTotal − customerReceivedAmount)
 *     customerCredit          max(0, customerReceivedAmount − customerInvoiceTotal)
 *     customerStatus          Unpaid / Partial / Paid / Credit — derived
 *                             from the customer side ONLY; the internal
 *                             expense paymentStatus is never reused here.
 *
 *   PROFITABILITY (internal-only, never persisted as authoritative,
 *   never shown to drivers/clients/public/customer exports):
 *     Canonical profit = computeShipmentProfit (issued customer invoice total
 *     − approved cost), same-currency only — this module refuses to subtract
 *     unlike currencies (no FX engine exists by design). The legacy
 *     agreedAmount-based computeGrossProfit is deprecated and unused.
 */
import type { CostItem, CostStatement, Currency } from "../types";

export const ALLOWED_COST_CURRENCIES: readonly Currency[] = ["USD", "IQD", "TRY", "EUR"];

export function isAllowedCostCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (ALLOWED_COST_CURRENCIES as readonly string[]).includes(value);
}

/** Finite number ≥ 0 — the only shape any submitted money/quantity may have. */
export function isValidMoneyNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

// ── Expense side ─────────────────────────────────────────────────────

export type ExpensePaymentStatus = "Unpaid" | "Partial" | "Paid";

export interface ExpenseSummary {
  totalCost: number;
  /** Expense Paid Amount — money MARAS paid out. */
  paidAmount: number;
  /** Stored legacy field: may go negative on overpayment (kept for compatibility). */
  remainingBalance: number;
  /** What is actually still payable — never negative. */
  expenseRemaining: number;
  /** Overpayment held as credit with the vendor side — never negative. */
  expenseCredit: number;
  paymentStatus: ExpensePaymentStatus;
}

export function deriveExpenseSummary(totalCost: number, paidAmount: number): ExpenseSummary {
  const remainingBalance = totalCost - paidAmount;
  return {
    totalCost,
    paidAmount,
    remainingBalance,
    expenseRemaining: Math.max(0, remainingBalance),
    expenseCredit: Math.max(0, -remainingBalance),
    paymentStatus:
      remainingBalance <= 0 && totalCost > 0 ? "Paid" : paidAmount > 0 ? "Partial" : "Unpaid",
  };
}

// ── Customer side ────────────────────────────────────────────────────

export type CustomerPaymentStatus = "Unpaid" | "Partial" | "Paid" | "Credit";

export interface CustomerSummary {
  /** The issued customer invoice total (customer-billed revenue), NOT agreedAmount. */
  customerInvoiceTotal: number;
  customerReceivedAmount: number;
  customerReceivable: number;
  customerCredit: number;
  customerStatus: CustomerPaymentStatus;
}

/** Legacy statements have no customerReceivedAmount — it always resolves to 0. */
export function resolveCustomerReceivedAmount(
  statement: Pick<CostStatement, "customerReceivedAmount">
): number {
  const v = statement.customerReceivedAmount;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

export function deriveCustomerSummary(
  customerInvoiceTotal: number,
  customerReceivedAmount: number
): CustomerSummary {
  const received = Number.isFinite(customerReceivedAmount) ? customerReceivedAmount : 0;
  const invoiceTotal = Number.isFinite(customerInvoiceTotal) ? customerInvoiceTotal : 0;
  return {
    customerInvoiceTotal: invoiceTotal,
    customerReceivedAmount: received,
    customerReceivable: Math.max(0, invoiceTotal - received),
    customerCredit: Math.max(0, received - invoiceTotal),
    customerStatus:
      received <= 0
        ? "Unpaid"
        : received < invoiceTotal
          ? "Partial"
          : received === invoiceTotal
            ? "Paid"
            : "Credit",
  };
}

// ── Profitability (internal only) ────────────────────────────────────

/**
 * @deprecated Accounting Phase 1 (invoice-based profit). This computed
 * "profit" from the DRIVER's agreedAmount, which is NOT a customer selling
 * price and must never drive accounting profit. It is retained only so its
 * unit test and any external caller keep compiling; no accounting surface
 * calls it any more. Use computeShipmentProfit below (issued invoice minus
 * approved cost). Do not reintroduce this into any profit/margin display.
 */
export function computeGrossProfit(
  agreedAmount: number,
  agreedCurrency: Currency | undefined,
  totalCost: number,
  statementCurrency: Currency | undefined
): number | null {
  if (!agreedCurrency || !statementCurrency || agreedCurrency !== statementCurrency) return null;
  if (!Number.isFinite(agreedAmount) || !Number.isFinite(totalCost)) return null;
  return agreedAmount - totalCost;
}

/**
 * Canonical shipment profit (Accounting Phase 1).
 *
 *   Shipment Profit = Issued Customer Invoice Total − Approved Cost Statement Total
 *
 * agreedAmount is deliberately NOT a parameter — it can never influence this.
 * Profit is only a real number when ALL of these hold; otherwise it is a
 * pending / unavailable state (never a fabricated figure):
 *   - an issued customer invoice exists (issuedInvoiceTotal is a finite number),
 *   - the cost statement is fully approved (costsApproved),
 *   - the invoice currency and the cost currency match (no FX is guessed here).
 */
export type ShipmentProfitStatus =
  | "available"
  | "pending_no_invoice"
  | "pending_not_approved"
  | "unavailable_currency";

export interface ShipmentProfitResult {
  status: ShipmentProfitStatus;
  /** The profit amount, or null in any pending/unavailable state. */
  profit: number | null;
  /** The currency the profit is expressed in when available, else null. */
  currency: Currency | null;
}

export function computeShipmentProfit(input: {
  issuedInvoiceTotal: number | null | undefined;
  invoiceCurrency: Currency | null | undefined;
  costsApproved: boolean;
  approvedCostTotal: number;
  costCurrency: Currency | null | undefined;
}): ShipmentProfitResult {
  const { issuedInvoiceTotal, invoiceCurrency, costsApproved, approvedCostTotal, costCurrency } = input;
  if (issuedInvoiceTotal == null || !Number.isFinite(issuedInvoiceTotal)) {
    return { status: "pending_no_invoice", profit: null, currency: null };
  }
  if (!costsApproved) {
    return { status: "pending_not_approved", profit: null, currency: null };
  }
  if (!invoiceCurrency || !costCurrency || invoiceCurrency !== costCurrency) {
    return { status: "unavailable_currency", profit: null, currency: null };
  }
  if (!Number.isFinite(approvedCostTotal)) {
    return { status: "unavailable_currency", profit: null, currency: null };
  }
  const profit = Math.round((issuedInvoiceTotal - approvedCostTotal + Number.EPSILON) * 100) / 100;
  return { status: "available", profit, currency: invoiceCurrency };
}

// ── Revision (optimistic concurrency) ────────────────────────────────

/** Legacy statements without a revision resolve as revision 1. */
export function resolveStatementRevision(statement: { revision?: number } | undefined | null): number {
  const r = statement?.revision;
  return typeof r === "number" && Number.isFinite(r) && r >= 1 ? Math.floor(r) : 1;
}

export type RevisionDecision =
  | { ok: true; nextRevision: number }
  | { ok: false; storedRevision: number };

/**
 * The one concurrency rule, identical in Firestore and memory mode
 * because both call THIS function inside their atomic section:
 *  - creating a statement (no stored doc) starts at revision 1;
 *  - updating requires the submitted revision to equal the stored one
 *    (legacy statements and legacy clients both resolve to 1);
 *  - a successful update increments the revision by exactly one.
 */
export function decideStatementRevision(
  stored: { revision?: number } | undefined | null,
  submittedRevision: unknown
): RevisionDecision {
  if (!stored) return { ok: true, nextRevision: 1 };
  const storedRevision = resolveStatementRevision(stored);
  const submitted =
    typeof submittedRevision === "number" && Number.isFinite(submittedRevision) && submittedRevision >= 1
      ? Math.floor(submittedRevision)
      : 1;
  if (submitted !== storedRevision) return { ok: false, storedRevision };
  return { ok: true, nextRevision: storedRevision + 1 };
}

// ── Server-side input validation & normalization ─────────────────────

export interface NormalizedCostStatementInput {
  currency: Currency;
  paidAmount: number;
  customerReceivedAmount: number;
  /** Items with server-recomputed totalAmount = quantity × unitPrice. */
  items: CostItem[];
  totalCost: number;
}

export type CostStatementInputResult =
  | { ok: true; input: NormalizedCostStatementInput }
  | { ok: false; error: string };

/**
 * Validates and normalizes a submitted Cost Statement body. The server
 * NEVER trusts client-computed money: item totalAmount is recomputed
 * from quantity × unitPrice; totalCost is recomputed from the items;
 * malformed values are rejected with a clear message (never silently
 * coerced to zero); every item currency must equal the statement
 * currency (no mixed-currency statements, no FX conversion).
 */
export function validateCostStatementInput(body: {
  currency?: unknown;
  paidAmount?: unknown;
  customerReceivedAmount?: unknown;
  items?: unknown;
}): CostStatementInputResult {
  if (!isAllowedCostCurrency(body.currency)) {
    return { ok: false, error: "Statement currency must be one of USD, IQD, TRY, EUR." };
  }
  const currency = body.currency;

  const paidRaw = body.paidAmount === undefined || body.paidAmount === null ? 0 : body.paidAmount;
  if (!isValidMoneyNumber(paidRaw)) {
    return { ok: false, error: "Expense paid amount must be a non-negative number." };
  }

  const receivedRaw =
    body.customerReceivedAmount === undefined || body.customerReceivedAmount === null
      ? 0
      : body.customerReceivedAmount;
  if (!isValidMoneyNumber(receivedRaw)) {
    return { ok: false, error: "Customer received amount must be a non-negative number." };
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items: CostItem[] = [];
  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i] as Partial<CostItem>;
    if (!isValidMoneyNumber(raw.quantity)) {
      return { ok: false, error: `Cost line ${i + 1}: quantity must be a non-negative number.` };
    }
    if (!isValidMoneyNumber(raw.unitPrice)) {
      return { ok: false, error: `Cost line ${i + 1}: unit price must be a non-negative number.` };
    }
    if (!isAllowedCostCurrency(raw.currency)) {
      return { ok: false, error: `Cost line ${i + 1}: currency must be one of USD, IQD, TRY, EUR.` };
    }
    if (raw.currency !== currency) {
      return {
        ok: false,
        error: `Cost line ${i + 1}: item currency (${raw.currency}) must match the statement currency (${currency}). Mixed-currency statements are not allowed.`,
      };
    }
    items.push({
      id: typeof raw.id === "string" && raw.id ? raw.id : `item-${Date.now()}-${i}`,
      costType: typeof raw.costType === "string" ? raw.costType : "",
      description: typeof raw.description === "string" ? raw.description : "",
      quantity: raw.quantity,
      unitPrice: raw.unitPrice,
      // Server-recomputed — a submitted totalAmount is always ignored.
      totalAmount: raw.quantity * raw.unitPrice,
      currency: raw.currency,
      supplierName: typeof raw.supplierName === "string" ? raw.supplierName : "",
      ...(typeof raw.documentUrl === "string" && raw.documentUrl ? { documentUrl: raw.documentUrl } : {}),
      ...(typeof raw.documentName === "string" && raw.documentName ? { documentName: raw.documentName } : {}),
      ...(typeof raw.internalNotes === "string" && raw.internalNotes ? { internalNotes: raw.internalNotes } : {}),
    });
  }

  const totalCost = items.reduce((sum, item) => sum + item.totalAmount, 0);
  return {
    ok: true,
    input: { currency, paidAmount: paidRaw, customerReceivedAmount: receivedRaw, items, totalCost },
  };
}

/**
 * Expected application-level rejection for a stale revision — the route
 * answers 409 and runs no side effects. Distinct from any infrastructure
 * error (same contract as ShipmentRevisionConflictError).
 */
export class CostStatementRevisionConflictError extends Error {
  readonly code = "COST_STATEMENT_REVISION_CONFLICT";
  readonly storedRevision: number;
  constructor(storedRevision: number) {
    super("This cost statement was changed by someone else since you opened it. Reload the latest data and re-apply your changes.");
    this.name = "CostStatementRevisionConflictError";
    this.storedRevision = storedRevision;
  }
}

/**
 * Expected application-level rejection when a financial edit is attempted
 * while the statement is locked by the approval workflow (pending, being
 * finalized, or closed). Thrown INSIDE the atomic section so an edit that
 * races an approval — which does not bump the revision — is still rejected
 * instead of corrupting a now-pending/closed statement. The route answers
 * 409 `accounting_locked` and runs no side effects.
 */
export class CostStatementAccountingLockedError extends Error {
  readonly code = "accounting_locked";
  readonly accountingStatus: string;
  constructor(accountingStatus: string, message: string) {
    super(message);
    this.name = "CostStatementAccountingLockedError";
    this.accountingStatus = accountingStatus;
  }
}

/**
 * Memory-mode revisioned write: read + decide + replace happen
 * SYNCHRONOUSLY against the live memory array (no awaits in between), so
 * the decision is atomic within the Node event loop — the same guarantee
 * the Firestore path gets from db.runTransaction, both funneled through
 * decideStatementRevision so the two persistence modes can never
 * disagree. Throws CostStatementRevisionConflictError on a stale
 * submitted revision. Returns the stored statement.
 */
export function applyCostStatementRevisionedWriteMemory(
  store: CostStatement[],
  shipmentId: string,
  submittedRevision: unknown,
  build: (nextRevision: number, existing: CostStatement | undefined) => CostStatement,
  /**
   * Optional guard run against the freshly-read stored record INSIDE the
   * atomic section (before the revision decision). It should throw to
   * reject the write — used to enforce the approval-workflow edit lock so
   * an edit that races an approval cannot corrupt a now-pending statement.
   */
  guard?: (existing: CostStatement | undefined) => void
): CostStatement {
  const idx = store.findIndex((s) => s.shipmentId === shipmentId);
  const existing = idx >= 0 ? store[idx] : undefined;
  if (guard) guard(existing);
  const decision = decideStatementRevision(existing, submittedRevision);
  if (!decision.ok) throw new CostStatementRevisionConflictError(decision.storedRevision);
  const finalStatement = build(decision.nextRevision, existing);
  // The stored memory copy carries an injected `id` (= shipmentId, the
  // document key) because server.ts's generic memory read shims
  // (handleGetDocMemory/handleGetDocsMemory) locate records by `item.id`
  // — exactly the shape the legacy setDoc shim stored. Without it, a
  // statement saved through this path would be invisible to the GET
  // routes in memory mode. The returned statement stays clean.
  const storedRecord = { ...finalStatement, id: shipmentId } as CostStatement;
  if (idx >= 0) store[idx] = storedRecord;
  else store.push(storedRecord);
  return finalStatement;
}
