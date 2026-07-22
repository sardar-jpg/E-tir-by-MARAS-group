import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveFinancialStatus, isFinanciallyClosed, FINANCIAL_CLOSED_LOCK_MESSAGE,
  evaluateFinancialCloseReadiness, activeFinancialReopenCycle, hasPendingFinancialReopen,
  canRequestFinancialReopen,
} from "./financialClosing";
import {
  buildReopenCycle, canDecideReopenPosition, applyReopenApproval, applyReopenRejection,
  type ReopenCycle,
} from "./costApprovalWorkflow";
import {
  ACCOUNTING_PERMISSION_KEYS, ACCOUNTING_PERMISSION_GROUPS, SENSITIVE_ACCOUNTING_PERMISSIONS,
  LEGACY_ACCOUNTS_DEFAULT_PERMISSIONS, resolveEffectivePermissions, hasPermission, isKnownAccountingPermission,
} from "./accountingPermissions";
import { computeShipmentProfit } from "./costStatementMath";

/**
 * Accounting Phase 6 — Financial Closing workflow. Financial Closing is the
 * final accounting completion of a shipment: a top-level freeze gated on ALL
 * of cost-final + vendor-paid + customer-paid + no-draft + no-active-reopen.
 * Once closed everything is read-only until an approved Financial Reopen
 * (sequential user-based chain). Profit is never recalculated.
 */
const READY = {
  accountingStatus: "final_closed",
  financialStatus: "financial_open" as const,
  vendorRemaining: [0, 0],
  invoiceRemaining: [0],
  hasDraftInvoice: false,
  hasPendingReopen: false,
  hasPendingFinancialReopen: false,
};

describe("Phase 6 — financial status resolution + lock", () => {
  it("defaults to financial_open; recognizes closed/reopened; isFinanciallyClosed only when closed", () => {
    expect(resolveFinancialStatus(undefined)).toBe("financial_open");
    expect(resolveFinancialStatus({})).toBe("financial_open");
    expect(resolveFinancialStatus({ financialStatus: "financial_closed" })).toBe("financial_closed");
    expect(resolveFinancialStatus({ financialStatus: "financial_reopened" })).toBe("financial_reopened");
    expect(resolveFinancialStatus({ financialStatus: "garbage" })).toBe("financial_open");
    expect(isFinanciallyClosed({ financialStatus: "financial_closed" })).toBe(true);
    expect(isFinanciallyClosed({ financialStatus: "financial_reopened" })).toBe(false);
    expect(isFinanciallyClosed({})).toBe(false);
    expect(FINANCIAL_CLOSED_LOCK_MESSAGE).toContain("financially closed");
  });
});

describe("Phase 6 — financial close readiness", () => {
  it("succeeds when all conditions hold", () => {
    expect(evaluateFinancialCloseReadiness(READY).ok).toBe(true);
  });
  it("rejects when the cost statement is not final_closed", () => {
    for (const s of ["draft", "pending_operations_approval", "reopened", "reopen_requested"]) {
      const r = evaluateFinancialCloseReadiness({ ...READY, accountingStatus: s });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("cost_not_final");
    }
  });
  it("rejects a remaining vendor balance", () => {
    const r = evaluateFinancialCloseReadiness({ ...READY, vendorRemaining: [0, 250] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("vendor_balance");
  });
  it("rejects a remaining customer balance", () => {
    const r = evaluateFinancialCloseReadiness({ ...READY, invoiceRemaining: [600] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("customer_balance");
  });
  it("rejects a draft invoice", () => {
    const r = evaluateFinancialCloseReadiness({ ...READY, hasDraftInvoice: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("draft_invoice");
  });
  it("rejects an active accounting reopen", () => {
    const r = evaluateFinancialCloseReadiness({ ...READY, hasPendingReopen: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("reopen_active");
  });
  it("rejects re-closing an already-closed shipment and a pending financial reopen", () => {
    expect((evaluateFinancialCloseReadiness({ ...READY, financialStatus: "financial_closed" }) as any).code).toBe("already_financially_closed");
    expect((evaluateFinancialCloseReadiness({ ...READY, hasPendingFinancialReopen: true }) as any).code).toBe("financial_reopen_pending");
  });
  it("tolerates rounding noise below 0.001 as paid", () => {
    expect(evaluateFinancialCloseReadiness({ ...READY, vendorRemaining: [0.0005], invoiceRemaining: [0.0009] }).ok).toBe(true);
  });
});

describe("Phase 6 — Financial Reopen chain (reuses the Phase 3 model)", () => {
  const cycle = (over: Partial<ReopenCycle> = {}): ReopenCycle => ({
    reopenCycleNumber: 1, approverUserIds: ["u1", "u2"], currentPosition: 0, status: "pending",
    requestedBy: "author", requestedAt: "t", reason: "correct a payment", decisions: [], ...over,
  });
  it("activeFinancialReopenCycle / hasPendingFinancialReopen read financialReopenCycles", () => {
    const state = { financialReopenCycles: [cycle({ reopenCycleNumber: 1, status: "approved" }), cycle({ reopenCycleNumber: 2, status: "pending" })] };
    expect(activeFinancialReopenCycle(state)?.reopenCycleNumber).toBe(2);
    expect(hasPendingFinancialReopen(state)).toBe(true);
    expect(hasPendingFinancialReopen({ financialReopenCycles: [cycle({ status: "approved" })] })).toBe(false);
    expect(hasPendingFinancialReopen({})).toBe(false);
  });
  it("request eligibility: must be financially closed, not already pending, reason required", () => {
    expect(canRequestFinancialReopen({ financialStatus: "financial_open", hasPendingFinancialReopen: false, reason: "x" }).ok).toBe(false);
    expect((canRequestFinancialReopen({ financialStatus: "financial_open", hasPendingFinancialReopen: false, reason: "x" }) as any).code).toBe("not_financially_closed");
    expect(canRequestFinancialReopen({ financialStatus: "financial_closed", hasPendingFinancialReopen: true, reason: "x" }).ok).toBe(false);
    expect(canRequestFinancialReopen({ financialStatus: "financial_closed", hasPendingFinancialReopen: false, reason: "  " }).ok).toBe(false);
    expect(canRequestFinancialReopen({ financialStatus: "financial_closed", hasPendingFinancialReopen: false, reason: "fix a reversal" }).ok).toBe(true);
  });
  it("two-approver chain: only the pending approver may decide; finalizes after the last", () => {
    let c = buildReopenCycle({ approverUserIds: ["u1", "u2"], requestedBy: "author", requestedAt: "t", reason: "fix", reopenCycleNumber: 1 });
    expect(canDecideReopenPosition({ cycle: c, actorId: "u2" }).ok).toBe(false); // not their turn
    expect(canDecideReopenPosition({ cycle: c, actorId: "u1" }).ok).toBe(true);
    let step = applyReopenApproval(c, { id: "u1", name: "U1", role: "accounts" }, "", "t1");
    expect(step.finalized).toBe(false); c = step.cycle;
    step = applyReopenApproval(c, { id: "u2", name: "U2", role: "accounts" }, "", "t2");
    expect(step.finalized).toBe(true);
    expect(step.cycle.status).toBe("approved");
  });
  it("rejection ends the cycle, preserving earlier decisions", () => {
    let c = buildReopenCycle({ approverUserIds: ["u1", "u2", "u3"], requestedBy: "a", requestedAt: "t", reason: "fix", reopenCycleNumber: 1 });
    c = applyReopenApproval(c, { id: "u1", name: "U1", role: "x" }, "", "t1").cycle;
    const rej = applyReopenRejection(c, { id: "u2", name: "U2", role: "x" }, "no", "t2");
    expect(rej.status).toBe("rejected");
    expect(rej.decisions).toHaveLength(2);
    expect(rej.decisions[0].action).toBe("approved");
  });
});

describe("Phase 6 — permissions (financialClose / financialReopen)", () => {
  const superAdmin = { role: "admin", adminType: "super" };
  const accounts = (over: Record<string, unknown> = {}) => ({ role: "admin", adminType: "accounts", ...over });
  it("both keys are registered, grouped exactly once, sensitive, and not a legacy default", () => {
    expect(isKnownAccountingPermission("accounting.financialClose")).toBe(true);
    expect(isKnownAccountingPermission("accounting.financialReopen")).toBe(true);
    const grouped = ACCOUNTING_PERMISSION_GROUPS.flatMap((g) => g.permissions.map((x) => x.key));
    expect([...grouped].sort()).toEqual([...ACCOUNTING_PERMISSION_KEYS].sort());
    for (const k of ["accounting.financialClose", "accounting.financialReopen"] as const) {
      expect(SENSITIVE_ACCOUNTING_PERMISSIONS).toContain(k);
      expect(LEGACY_ACCOUNTS_DEFAULT_PERMISSIONS).not.toContain(k);
    }
  });
  it("Super Admin has both; an explicit grant enables them; a default accounts admin does not (not super-only)", () => {
    expect(hasPermission(superAdmin, "accounting.financialClose")).toBe(true);
    expect(hasPermission(superAdmin, "accounting.financialReopen")).toBe(true);
    const granted = accounts({ permissions: ["costs.view", "accounting.financialClose", "accounting.financialReopen"] });
    expect(hasPermission(granted, "accounting.financialClose")).toBe(true);
    expect(hasPermission(granted, "accounting.financialReopen")).toBe(true);
    expect(hasPermission(accounts(), "accounting.financialClose")).toBe(false);
    // resolveEffectivePermissions gives Super Admin the full set including the new keys.
    const eff = resolveEffectivePermissions(superAdmin);
    expect(eff.has("accounting.financialClose") && eff.has("accounting.financialReopen")).toBe(true);
  });
});

describe("Phase 6 — profit is never recalculated by financial closing", () => {
  it("computeShipmentProfit is unchanged and has no financial-status input", () => {
    const before = computeShipmentProfit({ issuedInvoiceTotal: 1000, invoiceCurrency: "USD", costsApproved: true, approvedCostTotal: 700, costCurrency: "USD" });
    expect(before.profit).toBe(300);
    // Financial closing is a status flag only; it never feeds the profit math.
    expect(evaluateFinancialCloseReadiness(READY).ok).toBe(true);
    expect(computeShipmentProfit({ issuedInvoiceTotal: 1000, invoiceCurrency: "USD", costsApproved: true, approvedCostTotal: 700, costCurrency: "USD" })).toEqual(before);
  });
});

// ── Route wiring ───────────────────────────────────────────────────────────
const ROOT = join(__dirname, "..", "..");
const SERVER = readFileSync(join(ROOT, "server.ts"), "utf-8");
const region = (needle: string, length: number): string => {
  const at = SERVER.indexOf(needle);
  expect(at, `server.ts must contain: ${needle}`).toBeGreaterThan(-1);
  return SERVER.slice(at, at + length);
};

describe("Phase 6 — server wiring", () => {
  it("financial-close/reopen routes use the granular permissions (not Super Admin only)", () => {
    expect(SERVER).toContain('app.post("/api/cost-statements/:shipmentId/financial-close", requirePermission("accounting.financialClose")');
    expect(SERVER).toContain('app.post("/api/cost-statements/:shipmentId/financial-reopen-request", requirePermission("accounting.financialReopen")');
    expect(SERVER).toContain('app.post("/api/cost-statements/:shipmentId/financial-reopen-decision", requirePermission("accounting.financialReopen")');
    expect(SERVER).toContain('app.get("/api/cost-statements/:shipmentId/financial-status", requirePermission("costs.view")');
    expect(SERVER).not.toContain('financial-close", requireSuperAdmin');
  });
  it("financial close evaluates readiness inside the atomic mutation and audits", () => {
    const CLOSE = region('app.post("/api/cost-statements/:shipmentId/financial-close"', 2600);
    expect(CLOSE).toContain("evaluateFinancialCloseReadiness(");
    expect(CLOSE).toContain('financialStatus: "financial_closed"');
    expect(CLOSE).toContain("AUDIT_ACTIONS.financialClosed");
  });
  it("financial reopen chain captures a snapshot and finalizes to financial_reopened", () => {
    const REQ = region('app.post("/api/cost-statements/:shipmentId/financial-reopen-request"', 2200);
    expect(REQ).toContain("canRequestFinancialReopen(");
    expect(REQ).toContain("buildReopenCycle(");
    expect(REQ).toContain("financialReopenCycles");
    const DEC = region('app.post("/api/cost-statements/:shipmentId/financial-reopen-decision"', 3200);
    expect(DEC).toContain("activeFinancialReopenCycle(stmt");
    expect(DEC).toContain("canDecideReopenPosition({ cycle, actorId: req.session!.id");
    expect(DEC).toContain('financialStatus: "financial_reopened"');
  });
  it("every accounting mutation route rejects while financially closed (financial_closed_lock)", () => {
    const count = (SERVER.match(/financial_closed_lock/g) || []).length;
    // edit, items, vendor create, vendor reverse, invoice create, invoice edit,
    // invoice issue-gate-not-needed, invoice cancel, reopen-request, per-invoice
    // customer create, shared reversal core — many guarded sites.
    expect(count).toBeGreaterThanOrEqual(9);
    // Concrete key sites:
    expect(SERVER).toContain('code: "financial_closed_lock"');
    const REVCORE = region("async function performCustomerPaymentReversal", 1400);
    expect(REVCORE).toContain("financial_closed_lock");
  });
});
