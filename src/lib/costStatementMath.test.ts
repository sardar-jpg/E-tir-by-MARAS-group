import { describe, it, expect } from "vitest";
import type { CostStatement } from "../types";
import {
  ALLOWED_COST_CURRENCIES,
  applyCostStatementRevisionedWriteMemory,
  computeGrossProfit,
  CostStatementRevisionConflictError,
  decideStatementRevision,
  deriveCustomerSummary,
  deriveExpenseSummary,
  resolveCustomerReceivedAmount,
  resolveStatementRevision,
  validateCostStatementInput,
} from "./costStatementMath";

/**
 * Accounting Phase B — behavioral tests for the pure accounting rules the
 * server route, the editor, and every export path share. These are REAL
 * calculation tests, not source scans.
 */

const item = (over: Partial<CostStatement["items"][number]> = {}) => ({
  id: "i1",
  costType: "Freight",
  description: "leg",
  quantity: 2,
  unitPrice: 100,
  totalAmount: 999999, // deliberately wrong — the server must ignore it
  currency: "USD" as const,
  supplierName: "Vendor A",
  ...over,
});

describe("expense side — money MARAS pays", () => {
  it("derives Unpaid / Partial / Paid from paidAmount vs totalCost", () => {
    expect(deriveExpenseSummary(1000, 0).paymentStatus).toBe("Unpaid");
    expect(deriveExpenseSummary(1000, 400).paymentStatus).toBe("Partial");
    expect(deriveExpenseSummary(1000, 1000).paymentStatus).toBe("Paid");
    expect(deriveExpenseSummary(0, 0).paymentStatus).toBe("Unpaid");
  });

  it("overpayment becomes an expense CREDIT — payable never goes negative", () => {
    const s = deriveExpenseSummary(100, 5000);
    expect(s.expenseRemaining).toBe(0);
    expect(s.expenseCredit).toBe(4900);
    expect(s.paymentStatus).toBe("Paid");
    // legacy stored field keeps the raw arithmetic for compatibility
    expect(s.remainingBalance).toBe(-4900);
  });
});

describe("customer side — money MARAS receives (independent of expenses)", () => {
  it("derives Unpaid / Partial / Paid / Credit from customerReceivedAmount vs agreedAmount", () => {
    expect(deriveCustomerSummary(5000, 0).customerStatus).toBe("Unpaid");
    expect(deriveCustomerSummary(5000, 2000).customerStatus).toBe("Partial");
    expect(deriveCustomerSummary(5000, 5000).customerStatus).toBe("Paid");
    expect(deriveCustomerSummary(5000, 6000).customerStatus).toBe("Credit");
  });

  it("receivable and credit are never negative; overpayment is kept as credit, not discarded", () => {
    const over = deriveCustomerSummary(5000, 6000);
    expect(over.customerReceivable).toBe(0);
    expect(over.customerCredit).toBe(1000);
    const partial = deriveCustomerSummary(5000, 2000);
    expect(partial.customerReceivable).toBe(3000);
    expect(partial.customerCredit).toBe(0);
  });

  it("an EXPENSE payment never reduces the customer receivable (full separation)", () => {
    // MARAS paid vendors 4,900 — the customer still owes everything.
    const expenses = deriveExpenseSummary(5000, 4900);
    const customer = deriveCustomerSummary(5000, 0);
    expect(expenses.paidAmount).toBe(4900);
    expect(customer.customerReceivable).toBe(5000);
    expect(customer.customerStatus).toBe("Unpaid");
  });

  it("a CUSTOMER receipt never reduces the expense payable (full separation)", () => {
    const customer = deriveCustomerSummary(5000, 5000);
    const expenses = deriveExpenseSummary(3000, 0);
    expect(customer.customerStatus).toBe("Paid");
    expect(expenses.expenseRemaining).toBe(3000);
    expect(expenses.paymentStatus).toBe("Unpaid");
  });

  it("legacy statements without customerReceivedAmount resolve to 0", () => {
    expect(resolveCustomerReceivedAmount({} as CostStatement)).toBe(0);
    expect(resolveCustomerReceivedAmount({ customerReceivedAmount: undefined })).toBe(0);
    expect(resolveCustomerReceivedAmount({ customerReceivedAmount: 250 })).toBe(250);
  });
});

describe("gross profit — internal only, one currency only", () => {
  it("computes agreedAmount − totalCost when currencies match", () => {
    expect(computeGrossProfit(5000, "USD", 3200, "USD")).toBe(1800);
  });
  it("refuses to subtract unlike currencies (returns null, never converts)", () => {
    expect(computeGrossProfit(5000, "USD", 3200, "IQD")).toBeNull();
    expect(computeGrossProfit(5000, undefined, 3200, "USD")).toBeNull();
  });
});

describe("server input validation — nothing client-computed is trusted", () => {
  const base = { currency: "USD", paidAmount: 0, customerReceivedAmount: 0 };

  it("recomputes item totalAmount from quantity × unitPrice, ignoring the submitted value", () => {
    const r = validateCostStatementInput({ ...base, items: [item()] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.items[0].totalAmount).toBe(200); // 2 × 100, not 999999
      expect(r.input.totalCost).toBe(200);
    }
  });

  it("rejects negative quantity, unit price, paidAmount, and customerReceivedAmount", () => {
    expect(validateCostStatementInput({ ...base, items: [item({ quantity: -1 })] }).ok).toBe(false);
    expect(validateCostStatementInput({ ...base, items: [item({ unitPrice: -5 })] }).ok).toBe(false);
    expect(validateCostStatementInput({ ...base, paidAmount: -1, items: [] }).ok).toBe(false);
    expect(validateCostStatementInput({ ...base, customerReceivedAmount: -1, items: [] }).ok).toBe(false);
  });

  it("rejects non-finite and non-numeric money values instead of coercing them to zero", () => {
    expect(validateCostStatementInput({ ...base, paidAmount: Number.NaN, items: [] }).ok).toBe(false);
    expect(validateCostStatementInput({ ...base, paidAmount: Infinity, items: [] }).ok).toBe(false);
    expect(validateCostStatementInput({ ...base, items: [item({ quantity: "2" as unknown as number })] }).ok).toBe(false);
  });

  it("rejects unknown currencies — only USD/IQD/TRY/EUR exist", () => {
    expect(ALLOWED_COST_CURRENCIES).toEqual(["USD", "IQD", "TRY", "EUR"]);
    expect(validateCostStatementInput({ ...base, currency: "DOGE", items: [] }).ok).toBe(false);
    expect(validateCostStatementInput({ ...base, items: [item({ currency: "DOGE" as never })] }).ok).toBe(false);
  });

  it("rejects mixed-currency statements — every item must match the statement currency", () => {
    const r = validateCostStatementInput({
      ...base,
      items: [item(), item({ id: "i2", currency: "IQD" as const, quantity: 1, unitPrice: 500000 })],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Mixed-currency");
  });

  it("missing paidAmount / customerReceivedAmount default to 0 (legacy client compatibility)", () => {
    const r = validateCostStatementInput({ currency: "USD", items: [] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.paidAmount).toBe(0);
      expect(r.input.customerReceivedAmount).toBe(0);
    }
  });
});

describe("optimistic concurrency — one rule for Firestore and memory", () => {
  const stored = { revision: 3 } as CostStatement;

  it("legacy statements without a revision resolve to 1", () => {
    expect(resolveStatementRevision(undefined)).toBe(1);
    expect(resolveStatementRevision({} as CostStatement)).toBe(1);
    expect(resolveStatementRevision({ revision: 7 })).toBe(7);
  });

  it("creation starts at revision 1; matching update increments by exactly one", () => {
    expect(decideStatementRevision(undefined, undefined)).toEqual({ ok: true, nextRevision: 1 });
    expect(decideStatementRevision(stored, 3)).toEqual({ ok: true, nextRevision: 4 });
    // legacy stored (no revision) + legacy client (no revision) still saves
    expect(decideStatementRevision({} as CostStatement, undefined)).toEqual({ ok: true, nextRevision: 2 });
  });

  it("a stale submitted revision is refused", () => {
    expect(decideStatementRevision(stored, 2)).toEqual({ ok: false, storedRevision: 3 });
    expect(decideStatementRevision(stored, 4)).toEqual({ ok: false, storedRevision: 3 });
  });

  it("memory-mode write path: conflict throws (nothing written), success replaces and increments once", () => {
    const store: CostStatement[] = [
      { shipmentId: "s1", revision: 2, totalCost: 0 } as CostStatement,
    ];
    // Stale client (loaded revision 1) — rejected, store untouched.
    expect(() =>
      applyCostStatementRevisionedWriteMemory(store, "s1", 1, (rev) => ({ shipmentId: "s1", revision: rev } as CostStatement))
    ).toThrow(CostStatementRevisionConflictError);
    expect(store[0].revision).toBe(2);
    // Fresh client — accepted, exactly one increment.
    const saved = applyCostStatementRevisionedWriteMemory(store, "s1", 2, (rev, existing) => ({
      ...(existing as CostStatement),
      revision: rev,
    }));
    expect(saved.revision).toBe(3);
    expect(store).toHaveLength(1);
    // New statement — created at revision 1.
    const created = applyCostStatementRevisionedWriteMemory(store, "s2", undefined, (rev) => ({ shipmentId: "s2", revision: rev } as CostStatement));
    expect(created.revision).toBe(1);
    expect(store).toHaveLength(2);
    // The stored memory copy must carry the shim lookup key (`id` =
    // shipmentId) so server.ts's generic handleGetDocMemory (which finds
    // records by `item.id`) can read the statement back in memory mode.
    expect((store[0] as CostStatement & { id?: string }).id).toBe("s1");
    expect((store[1] as CostStatement & { id?: string }).id).toBe("s2");
  });
});
