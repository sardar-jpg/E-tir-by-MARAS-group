import { describe, it, expect } from "vitest";
import {
  validateWorkflowConfig, isWorkflowConfigUsable, resolveAccountingStatus, resolveApprovalCycle,
  isFinancialEditingAllowed, isImmutable, canSubmitForApproval, canApproveStage, canRejectStage,
  canRequestReopen, canDecideReopen, pendingStageForStatus, nextStatusAfterApproval, nextStageAfterApproval,
  appendHistory, approvalsForCycle, latestStageApprovals, buildFinalPdfFileName,
  finalizationKeyFor, hasFinalVersionFor, decideFinalization,
  type CostApprovalWorkflowConfig, type ApprovalHistoryEntry, type FinalPdfVersion,
} from "./costApprovalWorkflow";

const ACTIVE = ["ops1", "acc1", "md1", "other"];
const CONFIG: CostApprovalWorkflowConfig = { operations_manager: "ops1", accounts_manager: "acc1", managing_director: "md1" };

describe("workflow settings validation", () => {
  it("requires all three stages assigned", () => {
    expect(validateWorkflowConfig({ operations_manager: "ops1", accounts_manager: "acc1", activeAdminIds: ACTIVE }).ok).toBe(false);
    expect(validateWorkflowConfig({ operations_manager: "ops1", accounts_manager: "acc1", managing_director: "md1", activeAdminIds: ACTIVE }).ok).toBe(true);
  });
  it("rejects duplicate assignment across stages", () => {
    const r = validateWorkflowConfig({ operations_manager: "ops1", accounts_manager: "ops1", managing_director: "md1", activeAdminIds: ACTIVE });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("more than one");
  });
  it("rejects an inactive/unknown employee", () => {
    const r = validateWorkflowConfig({ operations_manager: "ghost", accounts_manager: "acc1", managing_director: "md1", activeAdminIds: ACTIVE });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Operations Manager");
  });
  it("isWorkflowConfigUsable fails when an assignee becomes inactive", () => {
    expect(isWorkflowConfigUsable(CONFIG, ACTIVE)).toBe(true);
    expect(isWorkflowConfigUsable(CONFIG, ["acc1", "md1"])).toBe(false); // ops1 gone
    expect(isWorkflowConfigUsable({}, ACTIVE)).toBe(false);
  });
});

describe("legacy compatibility", () => {
  it("a statement with no accountingStatus is draft, never final", () => {
    expect(resolveAccountingStatus(undefined)).toBe("draft");
    expect(resolveAccountingStatus({})).toBe("draft");
    expect(resolveApprovalCycle(undefined)).toBe(1);
    expect(isImmutable(resolveAccountingStatus({}))).toBe(false);
  });
});

describe("editing lock", () => {
  it("financial editing allowed only in draft / rejected / reopened", () => {
    for (const s of ["draft", "rejected_for_correction", "reopened"] as const) expect(isFinancialEditingAllowed(s)).toBe(true);
    for (const s of ["pending_operations_approval", "pending_accounts_approval", "pending_managing_director_approval", "final_closed", "reopen_requested"] as const) expect(isFinancialEditingAllowed(s)).toBe(false);
  });
  it("final_closed is immutable", () => {
    expect(isImmutable("final_closed")).toBe(true);
    expect(isImmutable("draft")).toBe(false);
  });
});

describe("submission", () => {
  it("draft/rejected/reopened can submit; pending/closed cannot", () => {
    expect(canSubmitForApproval("draft").ok).toBe(true);
    expect(canSubmitForApproval("rejected_for_correction").ok).toBe(true);
    expect(canSubmitForApproval("pending_operations_approval").ok).toBe(false);
    const closed = canSubmitForApproval("final_closed");
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.code).toBe("already_closed");
  });
});

describe("staged approvals — order, approver, revision", () => {
  it("only the assigned Operations Manager can approve stage one", () => {
    const base = { status: "pending_operations_approval" as const, config: CONFIG, actingRevision: 3, storedRevision: 3 };
    expect(canApproveStage({ ...base, actorId: "ops1" }).ok).toBe(true);
    const wrong = canApproveStage({ ...base, actorId: "acc1" });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.code).toBe("wrong_approver");
  });
  it("accounts/MD cannot approve before their stage is active", () => {
    // Accounts stage not active while pending operations.
    expect(canApproveStage({ status: "pending_operations_approval", config: CONFIG, actorId: "acc1", actingRevision: 1, storedRevision: 1 }).ok).toBe(false);
    // MD stage active only at pending_managing_director_approval.
    expect(canApproveStage({ status: "pending_accounts_approval", config: CONFIG, actorId: "md1", actingRevision: 1, storedRevision: 1 }).ok).toBe(false);
    expect(canApproveStage({ status: "pending_managing_director_approval", config: CONFIG, actorId: "md1", actingRevision: 1, storedRevision: 1 }).ok).toBe(true);
  });
  it("a stale revision cannot be approved (double/late approval guard)", () => {
    const r = canApproveStage({ status: "pending_operations_approval", config: CONFIG, actorId: "ops1", actingRevision: 2, storedRevision: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("stale_revision");
  });
  it("approving a non-pending statement is rejected (duplicate/closed guard)", () => {
    expect(canApproveStage({ status: "final_closed", config: CONFIG, actorId: "md1", actingRevision: 1, storedRevision: 1 }).ok).toBe(false);
    expect(canApproveStage({ status: "draft", config: CONFIG, actorId: "ops1", actingRevision: 1, storedRevision: 1 }).ok).toBe(false);
  });
  it("status/stage progression is ops → accounts → MD → final_closed", () => {
    expect(pendingStageForStatus("pending_operations_approval")).toBe("operations_manager");
    expect(nextStatusAfterApproval("operations_manager")).toBe("pending_accounts_approval");
    expect(nextStatusAfterApproval("accounts_manager")).toBe("pending_managing_director_approval");
    expect(nextStatusAfterApproval("managing_director")).toBe("final_closed");
    expect(nextStageAfterApproval("operations_manager")).toBe("accounts_manager");
    expect(nextStageAfterApproval("managing_director")).toBeNull();
  });
});

describe("rejection", () => {
  it("requires a reason and the assigned approver; returns for correction", () => {
    const base = { status: "pending_accounts_approval" as const, config: CONFIG };
    expect(canRejectStage({ ...base, actorId: "acc1", reason: "" }).ok).toBe(false);
    expect(canRejectStage({ ...base, actorId: "acc1", reason: "  " }).ok).toBe(false);
    expect(canRejectStage({ ...base, actorId: "ops1", reason: "fix it" }).ok).toBe(false); // wrong approver
    expect(canRejectStage({ ...base, actorId: "acc1", reason: "fix it" }).ok).toBe(true);
  });
});

describe("reopening — controlled, separation of duty", () => {
  it("only a closed statement with a reason can request reopening", () => {
    expect(canRequestReopen("draft", "x").ok).toBe(false);
    expect(canRequestReopen("final_closed", "").ok).toBe(false);
    expect(canRequestReopen("final_closed", "correction needed").ok).toBe(true);
  });
  it("the requester can never approve their own reopening request", () => {
    const self = canDecideReopen({ status: "reopen_requested", requesterId: "acc1", deciderId: "acc1" });
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.code).toBe("self_decision");
    expect(canDecideReopen({ status: "reopen_requested", requesterId: "acc1", deciderId: "super1" }).ok).toBe(true);
    expect(canDecideReopen({ status: "final_closed", requesterId: "acc1", deciderId: "super1" }).ok).toBe(false);
  });
});

describe("append-only history", () => {
  it("appends entries with server-assigned id/createdAt and preserves prior entries", () => {
    const h1 = appendHistory(undefined, { cycleNumber: 1, stage: "operations_manager", action: "submitted", actorId: "a", actorName: "A", actorRole: "accounts", statementRevision: 1, comment: "" }, "2026-07-19T00:00:00Z", "s");
    const h2 = appendHistory(h1, { cycleNumber: 1, stage: "operations_manager", action: "approved", actorId: "ops1", actorName: "Ops", actorRole: "operation", statementRevision: 1, comment: "ok" }, "2026-07-19T01:00:00Z", "a");
    expect(h2).toHaveLength(2);
    expect(h2[0]).toEqual(h1[0]); // prior entry unchanged
    expect(h2[1].action).toBe("approved");
    expect(h2[1].createdAt).toBe("2026-07-19T01:00:00Z");
  });
  it("cycle filtering and latest-per-stage work for PDF/UI", () => {
    const history: ApprovalHistoryEntry[] = [
      { id: "1", cycleNumber: 1, stage: "operations_manager", action: "approved", actorId: "ops1", actorName: "Ops", actorRole: "op", statementRevision: 1, comment: "", createdAt: "t1" },
      { id: "2", cycleNumber: 1, stage: "accounts_manager", action: "rejected", actorId: "acc1", actorName: "Acc", actorRole: "acc", statementRevision: 1, comment: "no", createdAt: "t2" },
      { id: "3", cycleNumber: 2, stage: "operations_manager", action: "approved", actorId: "ops1", actorName: "Ops", actorRole: "op", statementRevision: 2, comment: "", createdAt: "t3" },
    ];
    expect(approvalsForCycle(history, 2)).toHaveLength(1);
    const latest = latestStageApprovals(history, 1);
    expect(latest.operations_manager?.id).toBe("1");
    expect(latest.accounts_manager).toBeNull(); // rejection is not an approval
    expect(latest.managing_director).toBeNull();
  });
});

describe("final PDF filename sanitization", () => {
  it("produces a safe, revision-tagged name", () => {
    expect(buildFinalPdfFileName("MAR-2026-1001", 3)).toBe("Cost-Statement_MAR-2026-1001_Final_Rev-3.pdf");
    // Path separators become '-'; dots are allowed in filenames.
    expect(buildFinalPdfFileName("../../etc/passwd", 1)).toBe("Cost-Statement_..-..-etc-passwd_Final_Rev-1.pdf");
    expect(buildFinalPdfFileName("../../etc/passwd", 1)).not.toContain("/");
  });
});

describe("idempotent finalization primitives", () => {
  it("finalizationKeyFor is deterministic on shipment + cycle + revision", () => {
    expect(finalizationKeyFor("s1", 1, 2)).toBe("s1:1:2");
    expect(finalizationKeyFor("s1", 1, 2)).toBe(finalizationKeyFor("s1", 1, 2));
    expect(finalizationKeyFor("s1", 2, 2)).not.toBe(finalizationKeyFor("s1", 1, 2));
    expect(finalizationKeyFor("s1", 1, 3)).not.toBe(finalizationKeyFor("s1", 1, 2));
  });
  it("hasFinalVersionFor matches on cycle AND revision", () => {
    const versions = [{ cycleNumber: 1, statementRevision: 2 }] as FinalPdfVersion[];
    expect(hasFinalVersionFor(versions, 1, 2)).toBe(true);
    expect(hasFinalVersionFor(versions, 1, 3)).toBe(false);
    expect(hasFinalVersionFor(versions, 2, 2)).toBe(false);
    expect(hasFinalVersionFor(undefined, 1, 2)).toBe(false);
  });
  it("decideFinalization: a valid MD-stage approval begins finalization", () => {
    const d = decideFinalization({ status: "pending_managing_director_approval", config: CONFIG, actorId: "md1", actingRevision: 2, storedRevision: 2, cycle: 1, existingKey: undefined, shipmentId: "s1" });
    expect(d.action).toBe("begin");
    if (d.action === "begin") expect(d.key).toBe("s1:1:2");
  });
  it("decideFinalization: the wrong approver / wrong stage / stale revision are rejected", () => {
    expect(decideFinalization({ status: "pending_managing_director_approval", config: CONFIG, actorId: "ops1", actingRevision: 2, storedRevision: 2, cycle: 1, existingKey: undefined, shipmentId: "s1" }).action).toBe("reject");
    expect(decideFinalization({ status: "pending_accounts_approval", config: CONFIG, actorId: "md1", actingRevision: 2, storedRevision: 2, cycle: 1, existingKey: undefined, shipmentId: "s1" }).action).toBe("reject");
    expect(decideFinalization({ status: "pending_managing_director_approval", config: CONFIG, actorId: "md1", actingRevision: 1, storedRevision: 2, cycle: 1, existingKey: undefined, shipmentId: "s1" }).action).toBe("reject");
  });
  it("decideFinalization: an already-closed statement is an idempotent no-op", () => {
    expect(decideFinalization({ status: "final_closed", config: CONFIG, actorId: "md1", actingRevision: 2, storedRevision: 2, cycle: 1, existingKey: "s1:1:2", shipmentId: "s1" }).action).toBe("already_closed");
  });
  it("decideFinalization: only the owning MD may resume a matching in-progress finalization", () => {
    const key = "s1:1:2";
    // Same MD + same key → resume (crash recovery).
    expect(decideFinalization({ status: "finalizing", config: CONFIG, actorId: "md1", actingRevision: 2, storedRevision: 2, cycle: 1, existingKey: key, shipmentId: "s1" }).action).toBe("resume");
    // A different actor cannot hijack an in-progress finalization.
    const other = decideFinalization({ status: "finalizing", config: CONFIG, actorId: "acc1", actingRevision: 2, storedRevision: 2, cycle: 1, existingKey: key, shipmentId: "s1" });
    expect(other.action).toBe("reject");
    if (other.action === "reject") expect(other.code).toBe("finalizing_in_progress");
    // A mismatched key (someone else's finalization) is also rejected.
    expect(decideFinalization({ status: "finalizing", config: CONFIG, actorId: "md1", actingRevision: 3, storedRevision: 3, cycle: 1, existingKey: "s1:1:2", shipmentId: "s1" }).action).toBe("reject");
  });
});
