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
  it("reopen_requested (Phase 3): only the captured pending reopen approver may decide — not super-admin-by-role", () => {
    // A pending reopen cycle captured [ops1, acc1]; position 0 (ops1) pends.
    const reopenCycle = {
      reopenCycleNumber: 1, approverUserIds: ["ops1", "acc1"], currentPosition: 0, status: "pending" as const,
      requestedBy: "author", requestedAt: "t", reason: "fix", decisions: [],
    };
    const state = { accountingStatus: "reopen_requested" as const, reopenCycles: [reopenCycle] };
    // The pending captured approver (ops1) may decide — regardless of super/role.
    expect(deriveCostApprovalUiActions(state, CONFIG, { sessionId: "ops1", isSuperAdmin: false, canWriteCostStatements: true }).canDecideReopen).toBe(true);
    // A Super Admin who is NOT the pending approver may NOT decide (no more super-only bypass).
    expect(deriveCostApprovalUiActions(state, CONFIG, superAdmin).canDecideReopen).toBe(false);
    // The NEXT approver cannot decide before their turn.
    expect(deriveCostApprovalUiActions(state, CONFIG, accountant).canDecideReopen).toBe(false);
  });
  it("Phase 3: an active invoice locks editing + hides the reopen request", () => {
    const closed = { accountingStatus: "final_closed" as const };
    // Without an active invoice a writer may request reopen.
    expect(deriveCostApprovalUiActions(closed, CONFIG, accountant, false).canRequestReopen).toBe(true);
    // With an active invoice: locked, no reopen request.
    const locked = deriveCostApprovalUiActions(closed, CONFIG, accountant, true);
    expect(locked.canRequestReopen).toBe(false);
    expect(locked.isLockedByInvoice).toBe(true);
    // A reopened statement with an active invoice is still not editable.
    expect(deriveCostApprovalUiActions({ accountingStatus: "reopened" }, CONFIG, accountant, true).canEditFinancials).toBe(false);
  });
  it("legacy statement (no accountingStatus) is treated as editable draft", () => {
    const a = deriveCostApprovalUiActions({}, CONFIG, accountant);
    expect(a.status).toBe("draft");
    expect(a.canEditFinancials).toBe(true);
  });
});
