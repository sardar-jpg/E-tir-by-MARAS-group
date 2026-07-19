import { describe, it, expect } from "vitest";
import { deriveCostApprovalUiActions } from "./costApprovalUiActions";
import type { CostApprovalWorkflowConfig } from "./costApprovalWorkflow";

const CONFIG: CostApprovalWorkflowConfig = { operations_manager: "ops1", accounts_manager: "acc1", managing_director: "md1" };
const accountant = { sessionId: "acc1", isSuperAdmin: false, canWriteCostStatements: true };
const superAdmin = { sessionId: "super1", isSuperAdmin: true, canWriteCostStatements: true };

describe("UI action derivation (mirror of server rules)", () => {
  it("draft: an accounting writer may edit and submit; no approve", () => {
    const a = deriveCostApprovalUiActions({ accountingStatus: "draft" }, CONFIG, accountant);
    expect(a.canEditFinancials).toBe(true);
    expect(a.canSubmit).toBe(true);
    expect(a.canApprove).toBe(false);
    expect(a.isReadOnly).toBe(false);
  });
  it("pending stage: only the assigned approver sees approve/reject; fields read-only", () => {
    const opsPending = deriveCostApprovalUiActions({ accountingStatus: "pending_operations_approval" }, CONFIG, { sessionId: "ops1", isSuperAdmin: false, canWriteCostStatements: true });
    expect(opsPending.canApprove).toBe(true);
    expect(opsPending.canReject).toBe(true);
    expect(opsPending.canEditFinancials).toBe(false);
    expect(opsPending.isReadOnly).toBe(true);
    // The accounts manager cannot approve while operations is pending.
    const accViewing = deriveCostApprovalUiActions({ accountingStatus: "pending_operations_approval" }, CONFIG, accountant);
    expect(accViewing.canApprove).toBe(false);
  });
  it("final_closed: read-only, reopen request offered to writers, final PDF viewable", () => {
    const a = deriveCostApprovalUiActions({ accountingStatus: "final_closed", finalPdfUrl: "/api/uploads/x" }, CONFIG, accountant);
    expect(a.isReadOnly).toBe(true);
    expect(a.canEditFinancials).toBe(false);
    expect(a.canRequestReopen).toBe(true);
    expect(a.canViewFinalPdf).toBe(true);
  });
  it("reopen_requested: only a Super Admin who is NOT the requester may decide", () => {
    const state = { accountingStatus: "reopen_requested" as const, reopenRequestedBy: "acc1" };
    expect(deriveCostApprovalUiActions(state, CONFIG, superAdmin).canDecideReopen).toBe(true);
    // The requester (even if they were super) cannot decide their own.
    expect(deriveCostApprovalUiActions(state, CONFIG, { sessionId: "acc1", isSuperAdmin: true, canWriteCostStatements: true }).canDecideReopen).toBe(false);
    // A non-super cannot decide.
    expect(deriveCostApprovalUiActions(state, CONFIG, accountant).canDecideReopen).toBe(false);
  });
  it("legacy statement (no accountingStatus) is treated as editable draft", () => {
    const a = deriveCostApprovalUiActions({}, CONFIG, accountant);
    expect(a.status).toBe("draft");
    expect(a.canEditFinancials).toBe(true);
  });
});
