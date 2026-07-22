import { describe, it, expect } from "vitest";
import { buildFinalPdfModel } from "./costStatementFinalPdfModel";
import type { ApprovalHistoryEntry } from "./costApprovalWorkflow";
import type { CostStatement } from "../types";

const statement = (over: Partial<CostStatement> = {}): CostStatement => ({
  shipmentId: "s1", shipmentNumber: "MAR-2026-1001", companyName: "Client Ltd", shipmentType: "land",
  date: "2026-07-19", currency: "USD", totalCost: 300, paidAmount: 200, remainingBalance: 100,
  paymentStatus: "Partial", customerReceivedAmount: 400, agreedAmount: 500, agreedCurrency: "USD",
  revision: 4, notes: "handle with care", items: [
    { id: "i1", costType: "fuel", description: "Fuel", quantity: 2, unitPrice: 100, totalAmount: 200, currency: "USD", supplierName: "PO" },
    { id: "i2", costType: "customs", description: "Customs", quantity: 1, unitPrice: 100, totalAmount: 100, currency: "USD", supplierName: "Broker" },
  ], createdAt: "t", updatedAt: "t", ...over,
});

const history: ApprovalHistoryEntry[] = [
  { id: "1", cycleNumber: 1, stage: "operations_manager", action: "approved", actorId: "ops1", actorName: "Omar Ops", actorRole: "operation", statementRevision: 4, comment: "", createdAt: "2026-07-19T08:00:00Z" },
  { id: "2", cycleNumber: 1, stage: "accounts_manager", action: "approved", actorId: "acc1", actorName: "Aisha Acc", actorRole: "accounts", statementRevision: 4, comment: "", createdAt: "2026-07-19T09:00:00Z" },
  { id: "3", cycleNumber: 1, stage: "managing_director", action: "approved", actorId: "md1", actorName: "Musa MD", actorRole: "super", statementRevision: 4, comment: "", createdAt: "2026-07-19T10:00:00Z" },
];

describe("final PDF model — built from the authoritative snapshot only", () => {
  it("carries the exact revision, FINAL label, internal notice, items, totals, and INVOICE-based customer figures", () => {
    const m = buildFinalPdfModel({ statement: statement(), approvalHistory: history, cycleNumber: 1, finalizedAt: "2026-07-19T10:00:00Z", finalStatementRevision: 4, issuedInvoiceTotal: 500, issuedInvoiceCurrency: "USD" });
    expect(m.finalLabel).toContain("FINAL");
    expect(m.internalNotice).toContain("INTERNAL");
    expect(m.finalStatementRevision).toBe(4);
    expect(m.shipmentNumber).toBe("MAR-2026-1001");
    expect(m.items).toHaveLength(2);
    expect(m.totalCost).toBe(300);
    expect(m.expenseRemaining).toBe(100);
    expect(m.customerReceived).toBe(400);
    expect(m.customerReceivable).toBe(100); // 500 INVOICE − 400 received (agreedAmount ignored)
    expect(m.invoiceCurrency).toBe("USD");
    // agreedAmount is carried only as a reference value, never as a customer/profit input.
    expect(m.agreedAmount).toBe(500);
  });

  it("profit = issued invoice − approved cost; agreedAmount is ignored", () => {
    const m = buildFinalPdfModel({ statement: statement({ agreedAmount: 9999 }), approvalHistory: history, cycleNumber: 1, finalizedAt: "t", finalStatementRevision: 4, issuedInvoiceTotal: 500, issuedInvoiceCurrency: "USD" });
    expect(m.grossProfit).toBe(200); // 500 invoice − 300 cost (NOT 9999 agreed)
    expect(m.grossProfitNote).toBe("");
  });

  it("shows Profit Pending — No Issued Customer Invoice when uninvoiced", () => {
    const m = buildFinalPdfModel({ statement: statement(), approvalHistory: history, cycleNumber: 1, finalizedAt: "t", finalStatementRevision: 4, issuedInvoiceTotal: null });
    expect(m.grossProfit).toBeNull();
    expect(m.grossProfitNote).toContain("Profit Pending");
    expect(m.customerReceivable).toBe(0); // no invoice → no customer balance from agreedAmount
  });

  it("profit is unavailable (never converted) when invoice and cost currencies differ", () => {
    const m = buildFinalPdfModel({ statement: statement(), approvalHistory: history, cycleNumber: 1, finalizedAt: "t", finalStatementRevision: 4, issuedInvoiceTotal: 500, issuedInvoiceCurrency: "EUR" });
    expect(m.grossProfit).toBeNull();
    expect(m.grossProfitNote).toContain("differ");
  });

  it("renders the three-stage approval record with approver names and times", () => {
    const m = buildFinalPdfModel({ statement: statement(), approvalHistory: history, cycleNumber: 1, finalizedAt: "t", finalStatementRevision: 4 });
    expect(m.approvals.map((a) => a.name)).toEqual(["Omar Ops", "Aisha Acc", "Musa MD"]);
    expect(m.approvals.every((a) => a.status === "Approved")).toBe(true);
    expect(m.approvals[0].approvedAt).toBe("2026-07-19T08:00:00Z");
  });

  it("uses the requested cycle's approvals only (re-finalization after reopening)", () => {
    const cycle2: ApprovalHistoryEntry[] = [
      ...history,
      { id: "4", cycleNumber: 2, stage: "operations_manager", action: "approved", actorId: "ops1", actorName: "Omar Ops", actorRole: "operation", statementRevision: 6, comment: "", createdAt: "t" },
    ];
    const m = buildFinalPdfModel({ statement: statement({ revision: 6 }), approvalHistory: cycle2, cycleNumber: 2, finalizedAt: "t", finalStatementRevision: 6 });
    // Only cycle-2 ops approval exists; accounts/MD show as pending markers.
    expect(m.approvals[0].name).toBe("Omar Ops");
    expect(m.approvals[1].name).toBe("—");
  });
});
