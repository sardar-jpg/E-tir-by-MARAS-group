import { describe, it, expect } from "vitest";
import {
  resolveAccountingStatus, resolveApprovalCycle, canSubmitForApproval,
  validateApproverList, resolveConfiguredApprovers, resolveCycleApprovers, hasCycleApproverSnapshot,
  statusForApproverPosition, approverPositionForStatus, nextStatusAfterPosition,
  canApproveCyclePosition, canRejectCyclePosition, decideCycleFinalization,
  type CostApprovalWorkflowConfig, type CostApprovalState,
} from "./costApprovalWorkflow";

/**
 * Phase 2 end-to-end proof: the submit → approve/reject chain is user-based,
 * ordered, and driven by the CYCLE SNAPSHOT captured at submit — never live
 * settings. This is a faithful pure model of the server routes' atomic
 * decide callbacks (submit / approve / reject in server.ts), so exercising it
 * proves the routing for both persistence modes. Finalization is modelled as a
 * single close step here (its three-phase idempotency is proven separately in
 * costApprovalConcurrency.test.ts).
 */
type Rec = CostApprovalState & Record<string, any>;
type Outcome = { httpStatus: number; body?: any; save?: Rec };

const ACTIVE = ["u1", "u2", "u3", "u9"];

function makeStore(initial: Rec) {
  let doc: Rec = initial;
  return {
    get: () => doc,
    mutate(decide: (s: Rec) => Outcome): Outcome {
      const out = decide(doc);
      if (out.save) doc = out.save;
      return out;
    },
  };
}

/** Faithful model of POST /submit's atomic decide. */
function submit(config: CostApprovalWorkflowConfig, actorId: string) {
  return (stmt: Rec): Outcome => {
    const status = resolveAccountingStatus(stmt);
    const d = canSubmitForApproval(status);
    if (!d.ok) return { httpStatus: 409, body: { code: d.code } };
    const check = validateApproverList({ approverUserIds: resolveConfiguredApprovers(config), activeAdminIds: ACTIVE });
    if (!check.ok) return { httpStatus: 409, body: { code: "workflow_not_configured", error: check.error } };
    const cycleApprovers = check.approverUserIds;
    const cycleNumber = status === "draft" ? 1 : resolveApprovalCycle(stmt);
    return {
      httpStatus: 200,
      save: { ...stmt, accountingStatus: statusForApproverPosition(0), approvalCycle: cycleNumber, cycleApproverUserIds: cycleApprovers, submittedBy: actorId },
    };
  };
}

/** Faithful model of POST /approve's phase-1 decision (+ single-step close). */
function approve(actorId: string, config: CostApprovalWorkflowConfig) {
  return (stmt: Rec): Outcome => {
    const status = resolveAccountingStatus(stmt);
    const storedRevision = stmt.revision || 1;
    const cycleNumber = resolveApprovalCycle(stmt);
    const cycleApprovers = resolveCycleApprovers(stmt, config);
    const snapshotPatch = hasCycleApproverSnapshot(stmt) ? {} : { cycleApproverUserIds: cycleApprovers };
    const position = approverPositionForStatus(status);
    const lastPosition = cycleApprovers.length - 1;
    if (position === lastPosition || status === "finalizing" || status === "final_closed") {
      const fin = decideCycleFinalization({ status, cycleApprovers, actorId, actingRevision: storedRevision, storedRevision, cycle: cycleNumber, existingKey: stmt.finalizationKey, shipmentId: "s1" });
      if (fin.action === "already_closed") return { httpStatus: 200, save: undefined };
      if (fin.action === "reject") return { httpStatus: fin.code === "wrong_approver" ? 403 : 409, body: { code: fin.code } };
      // begin/resume → close (single step for this chain model).
      return { httpStatus: 200, save: { ...stmt, ...snapshotPatch, accountingStatus: "final_closed" } };
    }
    const d = canApproveCyclePosition({ status, cycleApprovers, actorId, actingRevision: storedRevision, storedRevision });
    if (!d.ok) return { httpStatus: d.code === "wrong_approver" ? 403 : 409, body: { code: d.code } };
    return { httpStatus: 200, save: { ...stmt, ...snapshotPatch, accountingStatus: nextStatusAfterPosition(position!, cycleApprovers.length) } };
  };
}

/** Faithful model of POST /reject's atomic decide (clears the cycle snapshot). */
function reject(actorId: string, reason: string, config: CostApprovalWorkflowConfig) {
  return (stmt: Rec): Outcome => {
    const status = resolveAccountingStatus(stmt);
    const cycleApprovers = resolveCycleApprovers(stmt, config);
    const d = canRejectCyclePosition({ status, cycleApprovers, actorId, reason });
    if (!d.ok) return { httpStatus: d.code === "wrong_approver" ? 403 : d.code === "reason_required" ? 400 : 409, body: { code: d.code } };
    return { httpStatus: 200, save: { ...stmt, accountingStatus: "rejected_for_correction", approvalCycle: resolveApprovalCycle(stmt) + 1, cycleApproverUserIds: undefined } };
  };
}

const CONFIG3: CostApprovalWorkflowConfig = { approverUserIds: ["u1", "u2", "u3"] };
const CONFIG2: CostApprovalWorkflowConfig = { approverUserIds: ["u1", "u2"] };

describe("Phase 2 — two-approver workflow", () => {
  it("Approver 1 → Approver 2 → fully approved (finalizes after the second)", () => {
    const store = makeStore({ accountingStatus: "draft", revision: 1 });
    expect(store.mutate(submit(CONFIG2, "author")).httpStatus).toBe(200);
    expect(store.get().accountingStatus).toBe("pending_operations_approval");
    expect(store.get().cycleApproverUserIds).toEqual(["u1", "u2"]);
    // Approver 2 cannot jump ahead.
    expect(store.mutate(approve("u2", CONFIG2)).httpStatus).toBe(403);
    // Approver 1 approves → pending Approver 2.
    expect(store.mutate(approve("u1", CONFIG2)).httpStatus).toBe(200);
    expect(store.get().accountingStatus).toBe("pending_accounts_approval");
    // Approver 2 approves → final_closed (no third stage).
    expect(store.mutate(approve("u2", CONFIG2)).httpStatus).toBe(200);
    expect(store.get().accountingStatus).toBe("final_closed");
  });
});

describe("Phase 2 — three-approver workflow", () => {
  it("Approver 1 → Approver 2 → Approver 3 → fully approved", () => {
    const store = makeStore({ accountingStatus: "draft", revision: 1 });
    store.mutate(submit(CONFIG3, "author"));
    expect(store.get().cycleApproverUserIds).toEqual(["u1", "u2", "u3"]);
    expect(store.mutate(approve("u1", CONFIG3)).httpStatus).toBe(200);
    expect(store.get().accountingStatus).toBe("pending_accounts_approval");
    expect(store.mutate(approve("u2", CONFIG3)).httpStatus).toBe(200);
    expect(store.get().accountingStatus).toBe("pending_managing_director_approval");
    // Wrong approver at the final stage is rejected.
    expect(store.mutate(approve("u1", CONFIG3)).httpStatus).toBe(403);
    expect(store.mutate(approve("u3", CONFIG3)).httpStatus).toBe(200);
    expect(store.get().accountingStatus).toBe("final_closed");
  });
});

describe("Phase 2 — per-cycle snapshot is immutable under settings changes", () => {
  it("an in-progress cycle keeps its captured approvers even after Accounting Settings change", () => {
    const store = makeStore({ accountingStatus: "draft", revision: 1 });
    store.mutate(submit(CONFIG3, "author")); // captured [u1,u2,u3]
    store.mutate(approve("u1", CONFIG3));

    // Settings change mid-cycle: Ahmed → Mahmoud (u1 → u9), now only two approvers.
    const CHANGED: CostApprovalWorkflowConfig = { approverUserIds: ["u1", "u9"] };
    // The newly-configured u9 CANNOT approve this cycle — it uses the snapshot.
    expect(store.mutate(approve("u9", CHANGED)).httpStatus).toBe(403);
    // The captured u2 then u3 finish the ORIGINAL chain.
    expect(store.mutate(approve("u2", CHANGED)).httpStatus).toBe(200);
    expect(store.get().accountingStatus).toBe("pending_managing_director_approval");
    expect(store.mutate(approve("u3", CHANGED)).httpStatus).toBe(200);
    expect(store.get().accountingStatus).toBe("final_closed");
  });

  it("a NEW submission uses the newly-configured approvers", () => {
    const store = makeStore({ accountingStatus: "rejected_for_correction", revision: 2 });
    const CHANGED: CostApprovalWorkflowConfig = { approverUserIds: ["u1", "u9"] };
    store.mutate(submit(CHANGED, "author"));
    expect(store.get().cycleApproverUserIds).toEqual(["u1", "u9"]);
    expect(store.mutate(approve("u9", CHANGED)).httpStatus).toBe(403); // u9 is position 1, not yet pending
    expect(store.mutate(approve("u1", CHANGED)).httpStatus).toBe(200);
    expect(store.mutate(approve("u9", CHANGED)).httpStatus).toBe(200);
    expect(store.get().accountingStatus).toBe("final_closed");
  });
});

describe("Phase 2 — legacy in-flight compatibility", () => {
  it("a legacy cycle with no snapshot captures the current config ONCE, then ignores later settings changes", () => {
    // Legacy statement mid-approval, no cycleApproverUserIds.
    const store = makeStore({ accountingStatus: "pending_operations_approval", approvalCycle: 1, revision: 1 });
    expect(hasCycleApproverSnapshot(store.get())).toBe(false);
    // First approval resolves + captures the current config [u1,u2,u3].
    expect(store.mutate(approve("u1", CONFIG3)).httpStatus).toBe(200);
    expect(store.get().cycleApproverUserIds).toEqual(["u1", "u2", "u3"]);
    // Settings now change — the captured legacy chain is unaffected.
    const CHANGED: CostApprovalWorkflowConfig = { approverUserIds: ["u1", "u9"] };
    expect(store.mutate(approve("u9", CHANGED)).httpStatus).toBe(403);
    expect(store.mutate(approve("u2", CHANGED)).httpStatus).toBe(200);
    expect(store.mutate(approve("u3", CHANGED)).httpStatus).toBe(200);
    expect(store.get().accountingStatus).toBe("final_closed");
  });
  it("a legacy fixed-title config resolves to an ordered chain for capture", () => {
    const store = makeStore({ accountingStatus: "pending_operations_approval", approvalCycle: 1, revision: 1 });
    const LEGACY_CFG: CostApprovalWorkflowConfig = { operations_manager: "u1", accounts_manager: "u2", managing_director: "u3" };
    store.mutate(approve("u1", LEGACY_CFG));
    expect(store.get().cycleApproverUserIds).toEqual(["u1", "u2", "u3"]);
  });
});

describe("Phase 2 — rejection ends the cycle and clears the snapshot", () => {
  it("a captured approver returns for correction; the next submission recaptures the current config", () => {
    const store = makeStore({ accountingStatus: "draft", revision: 1 });
    store.mutate(submit(CONFIG3, "author"));
    store.mutate(approve("u1", CONFIG3)); // now pending Approver 2 (u2)
    // Wrong approver cannot reject.
    expect(store.mutate(reject("u1", "fix", CONFIG3)).httpStatus).toBe(403);
    expect(store.mutate(reject("u2", "fix it", CONFIG3)).httpStatus).toBe(200);
    expect(store.get().accountingStatus).toBe("rejected_for_correction");
    expect(store.get().cycleApproverUserIds).toBeUndefined(); // snapshot cleared
    // A fresh submission under a changed config captures the new list.
    const CHANGED: CostApprovalWorkflowConfig = { approverUserIds: ["u1", "u9"] };
    store.mutate(submit(CHANGED, "author"));
    expect(store.get().cycleApproverUserIds).toEqual(["u1", "u9"]);
  });
});
