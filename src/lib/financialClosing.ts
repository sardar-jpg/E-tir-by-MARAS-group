/**
 * financialClosing.ts — Accounting Phase 6, the official Financial Closing
 * workflow. Financial Closing is the FINAL accounting completion of a
 * shipment, layered ABOVE the Phase 1–5 locks: once financially closed, every
 * accounting mutation (cost edits, vendor payments, customer payments, invoice
 * edits, reopen requests) is read-only until an approved Financial Reopen.
 *
 * It is distinct from Cost Statement approval, Vendor Paid, and Customer Paid —
 * each of those may already be complete; Financial Closing gates on ALL of
 * them together. Pure: no clock, db, or session. Financial Closing NEVER
 * recalculates profit (Issued Invoice − Approved Cost stays untouched).
 *
 * The Financial Reopen approval chain reuses the Phase 3 ReopenCycle model
 * (buildReopenCycle / canDecideReopenPosition / applyReopenApproval /
 * applyReopenRejection) but is stored on its own financialReopenCycles field.
 */
import type { ReopenCycle } from "./costApprovalWorkflow";

export type FinancialStatus = "financial_open" | "financial_closed" | "financial_reopened";

interface FinancialState {
  financialStatus?: string;
  financialReopenCycles?: unknown[];
}

/** A statement with no financialStatus is OPEN — never silently closed. */
export function resolveFinancialStatus(state: FinancialState | undefined | null): FinancialStatus {
  const s = state?.financialStatus;
  return s === "financial_closed" || s === "financial_reopened" ? s : "financial_open";
}

/** True when the statement is in the frozen financial_closed state. */
export function isFinanciallyClosed(state: FinancialState | undefined | null): boolean {
  return resolveFinancialStatus(state) === "financial_closed";
}

/** Human-facing lock message used by every guarded route when closed. */
export const FINANCIAL_CLOSED_LOCK_MESSAGE =
  "This shipment is financially closed. Request a Financial Reopen before making any accounting change.";

// ── Financial Close readiness ──────────────────────────────────────────────
const EPS = 0.001;

export interface FinancialCloseReadinessInput {
  /** Current accounting workflow status (must be final_closed). */
  accountingStatus: string;
  /** Current financial status (must not already be financial_closed). */
  financialStatus: FinancialStatus;
  /** Remaining payable per vendor cost line (all must be ≤ 0). */
  vendorRemaining: number[];
  /** Per ISSUED customer invoice remaining receivable (all must be ≤ 0). */
  invoiceRemaining: number[];
  /** True when any DRAFT customer invoice exists. */
  hasDraftInvoice: boolean;
  /** True when a Phase 3 (accounting) reopen is pending. */
  hasPendingReopen: boolean;
  /** True when a Financial Reopen is already pending. */
  hasPendingFinancialReopen: boolean;
}

export type FinancialCloseDecision = { ok: true } | { ok: false; code: string; error: string };

/**
 * Financial Close is allowed only when ALL conditions hold:
 *   1. cost statement is final_closed,
 *   2. every vendor cost line is fully paid (no remaining balance),
 *   3. every issued customer invoice is fully paid (no remaining balance),
 *   4. no active (accounting) reopen request,
 *   5. no pending approval (subsumed by final_closed),
 *   6. no draft accounting documents (no draft invoice; cost statement is not
 *      draft since it is final_closed).
 * Any failure returns a controlled code, never a partial close.
 */
export function evaluateFinancialCloseReadiness(input: FinancialCloseReadinessInput): FinancialCloseDecision {
  if (input.financialStatus === "financial_closed") {
    return { ok: false, code: "already_financially_closed", error: "This shipment is already financially closed." };
  }
  if (input.hasPendingFinancialReopen) {
    return { ok: false, code: "financial_reopen_pending", error: "A Financial Reopen request is already pending." };
  }
  if (input.accountingStatus !== "final_closed") {
    return { ok: false, code: "cost_not_final", error: "The Cost Statement must be approved and closed (final_closed) before financial closing." };
  }
  if (input.hasPendingReopen) {
    return { ok: false, code: "reopen_active", error: "An accounting reopen request is active. Resolve it before financial closing." };
  }
  if (input.hasDraftInvoice) {
    return { ok: false, code: "draft_invoice", error: "A draft customer invoice exists. Issue or remove it before financial closing." };
  }
  if (input.vendorRemaining.some((r) => r > EPS)) {
    return { ok: false, code: "vendor_balance", error: "A vendor cost line still has an unpaid balance. All vendor payments must be complete." };
  }
  if (input.invoiceRemaining.some((r) => r > EPS)) {
    return { ok: false, code: "customer_balance", error: "A customer invoice still has an outstanding balance. All customer payments must be complete." };
  }
  return { ok: true };
}

// ── Financial Reopen chain (reuses the Phase 3 ReopenCycle model) ───────────
/** The active (pending) financial-reopen cycle, or null. Last pending wins. */
export function activeFinancialReopenCycle(state: FinancialState | undefined | null): ReopenCycle | null {
  const cycles = state?.financialReopenCycles as ReopenCycle[] | undefined;
  if (!Array.isArray(cycles)) return null;
  for (let i = cycles.length - 1; i >= 0; i--) {
    if (cycles[i]?.status === "pending") return cycles[i];
  }
  return null;
}

/** True when a Financial Reopen request is already pending. */
export function hasPendingFinancialReopen(state: FinancialState | undefined | null): boolean {
  return activeFinancialReopenCycle(state) !== null;
}

export type FinancialReopenRequestDecision = { ok: true } | { ok: false; code: string; error: string };

/**
 * Eligibility to REQUEST a Financial Reopen: the statement must be
 * financial_closed, no financial-reopen request already pending, and a
 * non-empty reason is required.
 */
export function canRequestFinancialReopen(params: {
  financialStatus: FinancialStatus;
  hasPendingFinancialReopen: boolean;
  reason: string;
}): FinancialReopenRequestDecision {
  if (params.financialStatus !== "financial_closed") {
    return { ok: false, code: "not_financially_closed", error: "Only a financially closed shipment can be reopened." };
  }
  if (params.hasPendingFinancialReopen) {
    return { ok: false, code: "financial_reopen_pending", error: "A Financial Reopen request is already pending." };
  }
  if (!params.reason || !params.reason.trim()) {
    return { ok: false, code: "reason_required", error: "A Financial Reopen reason is required." };
  }
  return { ok: true };
}
