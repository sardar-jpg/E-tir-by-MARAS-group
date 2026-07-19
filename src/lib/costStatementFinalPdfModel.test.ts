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
  it("carries the exact revision, FINAL label, internal notice, items, and totals", () => {
    const m = buildFinalPdfModel({ statement: statement(), approvalHistory: history, cycleNumber: 1, finalizedAt: "2026-07-19T10:00:00Z", finalStatementRevision: 4 });
    expect(m.finalLabel).toContain("FINAL");
    expect(m.internalNotice).toContain("INTERNAL");
    expect(m.finalStatementRevision).toBe(4);
    expect(m.shipmentNumber).toBe("MAR-2026-1001");
    expect(m.items).toHaveLength(2);
    expect(m.totalCost).toBe(300);
    expect(m.expenseRemaining).toBe(100);
    expect(m.customerReceived).toBe(400);
    expect(m.customerReceivable).toBe(100); // 500 agreed - 400 received
  });

  it("shows gross profit ONLY when currencies match — never converted", () => {
    const same = buildFinalPdfModel({ statement: statement(), approvalHistory: history, cycleNumber: 1, finalizedAt: "t", finalStatementRevision: 4 });
    expect(same.grossProfit).toBe(200); // 500 - 300, both USD
    expect(same.grossProfitNote).toBe("");
    const mixed = buildFinalPdfModel({ statement: statement({ agreedCurrency: "EUR" }), approvalHistory: history, cycleNumber: 1, finalizedAt: "t", finalStatementRevision: 4 });
    expect(mixed.grossProfit).toBeNull();
    expect(mixed.grossProfitNote).toContain("differ");
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
