import { describe, it, expect } from "vitest";
import {
  validateWorkflowConfig, isWorkflowConfigUsable, resolveAccountingStatus, resolveApprovalCycle,
  isFinancialEditingAllowed, isImmutable, canSubmitForApproval, canApproveStage, canRejectStage,
  canRequestReopen, canDecideReopen, pendingStageForStatus, nextStatusAfterApproval, nextStageAfterApproval,
  appendHistory, approvalsForCycle, latestStageApprovals, buildFinalPdfFileName,
  finalizationKeyFor, hasFinalVersionFor, decideFinalization,
  // Phase 2 — user-based ordered approver chains + per-cycle snapshot.
  MIN_APPROVERS, MAX_APPROVERS, validateApproverList, isApproverConfigUsable, resolveConfiguredApprovers,
  resolveCycleApprovers, hasCycleApproverSnapshot, statusForApproverPosition, approverPositionForStatus,
  stageLabelForPosition, nextStatusAfterPosition, nextPositionToNotify,
  canApproveCyclePosition, canRejectCyclePosition, decideCycleFinalization,
  // Phase 3 — issued-invoice lock + reopen approval chain.
  ACTIVE_INVOICE_LOCK_MESSAGE, activeReopenCycle, hasPendingReopen, canRequestReopenChain,
  buildReopenCycle, canDecideReopenPosition, applyReopenApproval, applyReopenRejection, nextReopenPositionToNotify,
  type CostApprovalWorkflowConfig, type ApprovalHistoryEntry, type FinalPdfVersion, type ReopenCycle,
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

// ═══════════════════════════════════════════════════════════════════════════
// Phase 2 — configurable user-based approvers + per-cycle snapshot
// ═══════════════════════════════════════════════════════════════════════════
const ACTIVE2 = ["u1", "u2", "u3", "u4"];

describe("Phase 2 — approver list validation", () => {
  it("bounds are two required, three maximum", () => {
    expect(MIN_APPROVERS).toBe(2);
    expect(MAX_APPROVERS).toBe(3);
  });
  it("accepts two distinct active users", () => {
    const r = validateApproverList({ approverUserIds: ["u1", "u2"], activeAdminIds: ACTIVE2 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.approverUserIds).toEqual(["u1", "u2"]);
  });
  it("accepts three distinct active users", () => {
    expect(validateApproverList({ approverUserIds: ["u1", "u2", "u3"], activeAdminIds: ACTIVE2 }).ok).toBe(true);
  });
  it("rejects a single user (Approver 2 required)", () => {
    const r = validateApproverList({ approverUserIds: ["u1"], activeAdminIds: ACTIVE2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("two approvers");
  });
  it("rejects more than three users", () => {
    const r = validateApproverList({ approverUserIds: ["u1", "u2", "u3", "u4"], activeAdminIds: ACTIVE2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("maximum of three");
  });
  it("rejects a duplicate user", () => {
    const r = validateApproverList({ approverUserIds: ["u1", "u1"], activeAdminIds: ACTIVE2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("more than once");
  });
  it("rejects an inactive/invalid selected user by position", () => {
    const r = validateApproverList({ approverUserIds: ["u1", "ghost"], activeAdminIds: ACTIVE2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Approver 2");
  });
  it("blank entries are ignored (so a cleared Approver 3 leaves a valid two-approver list)", () => {
    const r = validateApproverList({ approverUserIds: ["u1", "u2", ""], activeAdminIds: ACTIVE2 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.approverUserIds).toEqual(["u1", "u2"]);
  });
  it("replacing an approver keeps the list valid", () => {
    const replaced = ["u1", "u2"].map((x) => (x === "u2" ? "u3" : x));
    expect(validateApproverList({ approverUserIds: replaced, activeAdminIds: ACTIVE2 }).ok).toBe(true);
  });
  it("isApproverConfigUsable reflects the resolved list; a legacy 3-title config still resolves", () => {
    expect(isApproverConfigUsable({ approverUserIds: ["u1", "u2"] }, ACTIVE2)).toBe(true);
    expect(isApproverConfigUsable({ approverUserIds: ["u1"] }, ACTIVE2)).toBe(false);
    // legacy fixed-title config → ordered [ops, acc, md].
    expect(resolveConfiguredApprovers({ operations_manager: "u1", accounts_manager: "u2", managing_director: "u3" })).toEqual(["u1", "u2", "u3"]);
    expect(isApproverConfigUsable({ operations_manager: "u1", accounts_manager: "u2", managing_director: "u3" }, ACTIVE2)).toBe(true);
    // approverUserIds takes precedence over legacy fields when both present.
    expect(resolveConfiguredApprovers({ approverUserIds: ["u4", "u1"], operations_manager: "u2" })).toEqual(["u4", "u1"]);
  });
});

describe("Phase 2 — position helpers", () => {
  it("maps positions 0/1/2 to the three internal pending statuses and back", () => {
    expect(statusForApproverPosition(0)).toBe("pending_operations_approval");
    expect(statusForApproverPosition(1)).toBe("pending_accounts_approval");
    expect(statusForApproverPosition(2)).toBe("pending_managing_director_approval");
    expect(approverPositionForStatus("pending_operations_approval")).toBe(0);
    expect(approverPositionForStatus("pending_accounts_approval")).toBe(1);
    expect(approverPositionForStatus("pending_managing_director_approval")).toBe(2);
    expect(approverPositionForStatus("draft")).toBeNull();
    expect(approverPositionForStatus("final_closed")).toBeNull();
  });
  it("stage label per position stays stable for PDF/history compatibility", () => {
    expect(stageLabelForPosition(0)).toBe("operations_manager");
    expect(stageLabelForPosition(1)).toBe("accounts_manager");
    expect(stageLabelForPosition(2)).toBe("managing_director");
  });
  it("finalizes after the LAST position for two- and three-approver chains", () => {
    // Two approvers: position 1 is last → final_closed.
    expect(nextStatusAfterPosition(0, 2)).toBe("pending_accounts_approval");
    expect(nextStatusAfterPosition(1, 2)).toBe("final_closed");
    expect(nextPositionToNotify(0, 2)).toBe(1);
    expect(nextPositionToNotify(1, 2)).toBeNull();
    // Three approvers: position 2 is last → final_closed.
    expect(nextStatusAfterPosition(0, 3)).toBe("pending_accounts_approval");
    expect(nextStatusAfterPosition(1, 3)).toBe("pending_managing_director_approval");
    expect(nextStatusAfterPosition(2, 3)).toBe("final_closed");
    expect(nextPositionToNotify(1, 3)).toBe(2);
    expect(nextPositionToNotify(2, 3)).toBeNull();
  });
});

describe("Phase 2 — per-cycle snapshot resolution", () => {
  it("hasCycleApproverSnapshot requires at least two captured ids", () => {
    expect(hasCycleApproverSnapshot({ cycleApproverUserIds: ["u1", "u2"] })).toBe(true);
    expect(hasCycleApproverSnapshot({ cycleApproverUserIds: ["u1"] })).toBe(false);
    expect(hasCycleApproverSnapshot({})).toBe(false);
    expect(hasCycleApproverSnapshot(undefined)).toBe(false);
  });
  it("prefers the captured snapshot over the current config (settings changes never touch an active cycle)", () => {
    const state = { cycleApproverUserIds: ["u1", "u2", "u3"] };
    const changedConfig: CostApprovalWorkflowConfig = { approverUserIds: ["u4", "u1"] };
    expect(resolveCycleApprovers(state, changedConfig)).toEqual(["u1", "u2", "u3"]);
  });
  it("falls back to the current config ONCE for a legacy in-flight cycle without a snapshot", () => {
    const legacyState = { accountingStatus: "pending_operations_approval" as const };
    expect(resolveCycleApprovers(legacyState, { approverUserIds: ["u1", "u2"] })).toEqual(["u1", "u2"]);
    // legacy fixed-title config resolves too.
    expect(resolveCycleApprovers(legacyState, { operations_manager: "u1", accounts_manager: "u2", managing_director: "u3" })).toEqual(["u1", "u2", "u3"]);
  });
});

describe("Phase 2 — cycle-snapshot approve/reject/finalize decisions", () => {
  const THREE = ["u1", "u2", "u3"];
  const TWO = ["u1", "u2"];
  it("only the captured approver for the pending position may approve; wrong approver / stale revision rejected", () => {
    const base = { status: "pending_operations_approval" as const, cycleApprovers: THREE, actingRevision: 3, storedRevision: 3 };
    expect(canApproveCyclePosition({ ...base, actorId: "u1" }).ok).toBe(true);
    const wrong = canApproveCyclePosition({ ...base, actorId: "u2" });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.code).toBe("wrong_approver");
    const stale = canApproveCyclePosition({ ...base, actorId: "u1", actingRevision: 2, storedRevision: 5 });
    if (!stale.ok) expect(stale.code).toBe("stale_revision");
  });
  it("a position beyond the captured list is not pending (safe for a shortened legacy chain)", () => {
    // A two-approver cycle has no position 2 (pending_managing_director).
    const r = canApproveCyclePosition({ status: "pending_managing_director_approval", cycleApprovers: TWO, actorId: "u1", actingRevision: 1, storedRevision: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("not_pending");
  });
  it("reject requires the captured approver and a reason", () => {
    const base = { status: "pending_accounts_approval" as const, cycleApprovers: THREE };
    expect(canRejectCyclePosition({ ...base, actorId: "u2", reason: "" }).ok).toBe(false);
    expect(canRejectCyclePosition({ ...base, actorId: "u1", reason: "fix" }).ok).toBe(false); // wrong approver
    expect(canRejectCyclePosition({ ...base, actorId: "u2", reason: "fix" }).ok).toBe(true);
  });
  it("two-approver chain finalizes at position 1 (accounts slot); three-approver at position 2", () => {
    // Two-approver: the SECOND approver (position 1) begins finalization.
    const twoFinal = decideCycleFinalization({ status: "pending_accounts_approval", cycleApprovers: TWO, actorId: "u2", actingRevision: 2, storedRevision: 2, cycle: 1, existingKey: undefined, shipmentId: "s1" });
    expect(twoFinal.action).toBe("begin");
    // Position 0 of a two-approver chain is NOT the final stage.
    const twoNotFinal = decideCycleFinalization({ status: "pending_operations_approval", cycleApprovers: TWO, actorId: "u1", actingRevision: 2, storedRevision: 2, cycle: 1, existingKey: undefined, shipmentId: "s1" });
    expect(twoNotFinal.action).toBe("reject");
    if (twoNotFinal.action === "reject") expect(twoNotFinal.code).toBe("not_final_stage");
    // Three-approver: position 2 (third approver) begins finalization.
    const threeFinal = decideCycleFinalization({ status: "pending_managing_director_approval", cycleApprovers: THREE, actorId: "u3", actingRevision: 2, storedRevision: 2, cycle: 1, existingKey: undefined, shipmentId: "s1" });
    expect(threeFinal.action).toBe("begin");
  });
  it("only the captured last approver may resume an in-progress finalization", () => {
    const key = "s1:1:2";
    expect(decideCycleFinalization({ status: "finalizing", cycleApprovers: TWO, actorId: "u2", actingRevision: 2, storedRevision: 2, cycle: 1, existingKey: key, shipmentId: "s1" }).action).toBe("resume");
    const other = decideCycleFinalization({ status: "finalizing", cycleApprovers: TWO, actorId: "u1", actingRevision: 2, storedRevision: 2, cycle: 1, existingKey: key, shipmentId: "s1" });
    expect(other.action).toBe("reject");
    expect(decideCycleFinalization({ status: "final_closed", cycleApprovers: TWO, actorId: "u2", actingRevision: 2, storedRevision: 2, cycle: 1, existingKey: key, shipmentId: "s1" }).action).toBe("already_closed");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3 — issued-invoice lock + reopen approval chain
// ═══════════════════════════════════════════════════════════════════════════
const mkReopenCycle = (over: Partial<ReopenCycle> = {}): ReopenCycle => ({
  reopenCycleNumber: 1, approverUserIds: ["u1", "u2"], currentPosition: 0, status: "pending",
  requestedBy: "author", requestedAt: "t0", reason: "correct a cost", decisions: [], ...over,
});
const actor = (id: string) => ({ id, name: id.toUpperCase(), role: "accounts" });

describe("Phase 3 — reopen request eligibility (active-invoice lock)", () => {
  it("blocks the request while an active invoice exists, with the clear lock message", () => {
    const r = canRequestReopenChain({ status: "final_closed", hasActiveInvoice: true, hasPendingReopen: false, reason: "fix" });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe("active_invoice_lock"); expect(r.error).toBe(ACTIVE_INVOICE_LOCK_MESSAGE); }
  });
  it("allows the request once no active invoice remains and the statement is closed", () => {
    expect(canRequestReopenChain({ status: "final_closed", hasActiveInvoice: false, hasPendingReopen: false, reason: "fix" }).ok).toBe(true);
  });
  it("rejects a blank / whitespace reason", () => {
    expect(canRequestReopenChain({ status: "final_closed", hasActiveInvoice: false, hasPendingReopen: false, reason: "   " }).ok).toBe(false);
  });
  it("rejects a duplicate pending reopen request", () => {
    const r = canRequestReopenChain({ status: "final_closed", hasActiveInvoice: false, hasPendingReopen: true, reason: "fix" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("reopen_already_pending");
  });
  it("rejects when the statement is not finalized (already editable/draft)", () => {
    for (const s of ["draft", "reopened", "rejected_for_correction"] as const) {
      const r = canRequestReopenChain({ status: s, hasActiveInvoice: false, hasPendingReopen: false, reason: "fix" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("not_closed");
    }
  });
});

describe("Phase 3 — reopen cycle state helpers", () => {
  it("activeReopenCycle / hasPendingReopen find the last pending cycle", () => {
    const approved = mkReopenCycle({ reopenCycleNumber: 1, status: "approved" });
    const pending = mkReopenCycle({ reopenCycleNumber: 2, status: "pending" });
    expect(activeReopenCycle({ reopenCycles: [approved] })).toBeNull();
    expect(activeReopenCycle({ reopenCycles: [approved, pending] })?.reopenCycleNumber).toBe(2);
    expect(hasPendingReopen({ reopenCycles: [approved, pending] })).toBe(true);
    // Legacy in-flight reopen (status reopen_requested, no snapshot).
    expect(hasPendingReopen({ accountingStatus: "reopen_requested" })).toBe(true);
    expect(hasPendingReopen({ accountingStatus: "final_closed" })).toBe(false);
  });
});

describe("Phase 3 — two-approver reopen chain", () => {
  it("Approver 1 → Approver 2 → approved; only the pending approver may decide", () => {
    let cycle = mkReopenCycle({ approverUserIds: ["u1", "u2"] });
    // Wrong approver blocked.
    expect(canDecideReopenPosition({ cycle, actorId: "u2" }).ok).toBe(false);
    expect(canDecideReopenPosition({ cycle, actorId: "u1" }).ok).toBe(true);
    let step = applyReopenApproval(cycle, actor("u1"), "ok", "t1");
    expect(step.finalized).toBe(false);
    cycle = step.cycle;
    expect(cycle.currentPosition).toBe(1);
    expect(canDecideReopenPosition({ cycle, actorId: "u1" }).ok).toBe(false); // u1 already acted
    step = applyReopenApproval(cycle, actor("u2"), "ok2", "t2");
    expect(step.finalized).toBe(true);
    expect(step.cycle.status).toBe("approved");
    expect(step.cycle.decisions.map((d) => d.actorId)).toEqual(["u1", "u2"]);
  });
});

describe("Phase 3 — three-approver reopen chain", () => {
  it("Approver 1 → 2 → 3 → approved (finalizes only after the third)", () => {
    let cycle = mkReopenCycle({ approverUserIds: ["u1", "u2", "u3"] });
    let step = applyReopenApproval(cycle, actor("u1"), "", "t1"); cycle = step.cycle;
    expect(step.finalized).toBe(false); expect(cycle.currentPosition).toBe(1);
    step = applyReopenApproval(cycle, actor("u2"), "", "t2"); cycle = step.cycle;
    expect(step.finalized).toBe(false); expect(cycle.currentPosition).toBe(2);
    step = applyReopenApproval(cycle, actor("u3"), "", "t3");
    expect(step.finalized).toBe(true); expect(step.cycle.status).toBe("approved");
  });
});

describe("Phase 3 — reopen rejection", () => {
  it("the pending approver rejects; earlier decisions preserved; cycle ends rejected", () => {
    let cycle = mkReopenCycle({ approverUserIds: ["u1", "u2", "u3"] });
    cycle = applyReopenApproval(cycle, actor("u1"), "ok", "t1").cycle; // u1 approved
    const rejected = applyReopenRejection(cycle, actor("u2"), "not now", "t2");
    expect(rejected.status).toBe("rejected");
    expect(rejected.decisions).toHaveLength(2);
    expect(rejected.decisions[0].action).toBe("approved"); // earlier decision preserved
    expect(rejected.decisions[1].action).toBe("rejected");
    // A rejected cycle is no longer pending → another attempt needs a new cycle.
    expect(canDecideReopenPosition({ cycle: rejected, actorId: "u3" }).ok).toBe(false);
    expect(activeReopenCycle({ reopenCycles: [rejected] })).toBeNull();
  });
});

describe("Phase 3 — notify helper + build", () => {
  it("nextReopenPositionToNotify advances until the last approver", () => {
    expect(nextReopenPositionToNotify(mkReopenCycle({ approverUserIds: ["u1", "u2", "u3"], currentPosition: 0 }))).toBe(1);
    expect(nextReopenPositionToNotify(mkReopenCycle({ approverUserIds: ["u1", "u2", "u3"], currentPosition: 2 }))).toBeNull();
    expect(nextReopenPositionToNotify(mkReopenCycle({ approverUserIds: ["u1", "u2"], currentPosition: 1 }))).toBeNull();
  });
  it("buildReopenCycle captures the ordered list at position 0, pending", () => {
    const c = buildReopenCycle({ approverUserIds: ["u1", "u2", "u3"], requestedBy: "author", requestedAt: "t", reason: "fix", reopenCycleNumber: 2 });
    expect(c).toMatchObject({ reopenCycleNumber: 2, approverUserIds: ["u1", "u2", "u3"], currentPosition: 0, status: "pending", requestedBy: "author", reason: "fix" });
    expect(c.decisions).toEqual([]);
  });
});
