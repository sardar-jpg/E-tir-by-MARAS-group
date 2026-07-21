import { describe, it, expect } from "vitest";
import {
  resolveAccountingStatus, resolveApprovalCycle, isFinancialEditingAllowed, canSubmitForApproval,
  validateApproverList, resolveConfiguredApprovers, statusForApproverPosition,
  resolveCycleApprovers, hasCycleApproverSnapshot, canApproveCyclePosition, nextStatusAfterPosition, approverPositionForStatus,
  canRequestReopenChain, buildReopenCycle, activeReopenCycle, hasPendingReopen,
  canDecideReopenPosition, applyReopenApproval, applyReopenRejection,
  type CostApprovalWorkflowConfig, type CostApprovalState, type ReopenCycle,
} from "./costApprovalWorkflow";

/**
 * Phase 3 end-to-end proof of the controlled correction sequence:
 *   active invoice → LOCKED → cancel → request reopen → reopen approval chain →
 *   editing enabled → resubmit → normal chain → new invoice (after re-approval).
 * A faithful pure model of the server routes' atomic decide callbacks (edit,
 * reopen-request, reopen-decision, submit). The reopen chain reads ONLY its
 * captured snapshot, never live settings.
 */
type Rec = CostApprovalState & { reopenCycles?: ReopenCycle[] } & Record<string, any>;
type Outcome = { httpStatus: number; body?: any; save?: Rec };
const ACTIVE = ["u1", "u2", "u3", "u9"];
const actor = (id: string) => ({ id, name: id.toUpperCase(), role: "accounts" });

function makeStore(initial: Rec) {
  let doc = initial;
  return {
    get: () => doc,
    mutate(decide: (s: Rec) => Outcome): Outcome { const o = decide(doc); if (o.save) doc = o.save; return o; },
  };
}
function upsert(existing: ReopenCycle[] | undefined, updated: ReopenCycle): ReopenCycle[] {
  const arr = Array.isArray(existing) ? [...existing] : [];
  const i = arr.findIndex((c) => c.reopenCycleNumber === updated.reopenCycleNumber);
  if (i >= 0) arr[i] = updated; else arr.push(updated);
  return arr;
}

/** Model of POST /:shipmentId (financial edit) + POST /items — invoice-lock aware. */
function edit(hasActiveInvoice: boolean) {
  return (stmt: Rec): Outcome => {
    if (hasActiveInvoice) return { httpStatus: 409, body: { code: "active_invoice_lock" } };
    if (!isFinancialEditingAllowed(resolveAccountingStatus(stmt))) return { httpStatus: 409, body: { code: "accounting_locked" } };
    return { httpStatus: 200, save: { ...stmt, edited: true, revision: (stmt.revision || 1) + 1 } };
  };
}
/** Model of POST /reopen-request. */
function requestReopen(config: CostApprovalWorkflowConfig, actorId: string, reason: string, hasActiveInvoice: boolean) {
  return (stmt: Rec): Outcome => {
    const d = canRequestReopenChain({ status: resolveAccountingStatus(stmt), hasActiveInvoice, hasPendingReopen: hasPendingReopen(stmt), reason });
    if (!d.ok) return { httpStatus: d.code === "reason_required" ? 400 : 409, body: { code: d.code } };
    const check = validateApproverList({ approverUserIds: resolveConfiguredApprovers(config), activeAdminIds: ACTIVE });
    if (!check.ok) return { httpStatus: 409, body: { code: "workflow_not_configured" } };
    const existing = (stmt.reopenCycles as ReopenCycle[] | undefined) || [];
    const cycle = buildReopenCycle({ approverUserIds: check.approverUserIds, requestedBy: actorId, requestedAt: "t", reason, reopenCycleNumber: existing.length + 1 });
    return { httpStatus: 200, save: { ...stmt, accountingStatus: "reopen_requested", reopenCycles: upsert(existing, cycle), reopenRequestedBy: actorId, reopenReason: reason } };
  };
}
/** Model of POST /reopen-decision (with legacy capture-once). */
function decideReopen(actorId: string, approve: boolean, config: CostApprovalWorkflowConfig, note = "") {
  return (stmt: Rec): Outcome => {
    if (resolveAccountingStatus(stmt) !== "reopen_requested") return { httpStatus: 409, body: { code: "not_reopen_requested" } };
    let cycle = activeReopenCycle(stmt);
    let cycles = (stmt.reopenCycles as ReopenCycle[] | undefined) || [];
    if (!cycle) {
      const check = validateApproverList({ approverUserIds: resolveConfiguredApprovers(config), activeAdminIds: ACTIVE });
      if (!check.ok) return { httpStatus: 409, body: { code: "reopen_config_unavailable" } };
      cycle = buildReopenCycle({ approverUserIds: check.approverUserIds, requestedBy: stmt.reopenRequestedBy || actorId, requestedAt: "t", reason: stmt.reopenReason || "", reopenCycleNumber: cycles.length + 1 });
      cycles = upsert(cycles, cycle);
    }
    const guard = canDecideReopenPosition({ cycle, actorId });
    if (!guard.ok) return { httpStatus: guard.code === "wrong_approver" ? 403 : 409, body: { code: guard.code } };
    if (approve) {
      const applied = applyReopenApproval(cycle, actor(actorId), note, "t");
      const next = upsert(cycles, applied.cycle);
      if (applied.finalized) {
        return { httpStatus: 200, save: { ...stmt, accountingStatus: "reopened", approvalCycle: resolveApprovalCycle(stmt) + 1, reopenCycles: next, reopenRequestedBy: undefined, reopenReason: undefined } };
      }
      return { httpStatus: 200, save: { ...stmt, reopenCycles: next } };
    }
    const rejected = applyReopenRejection(cycle, actor(actorId), note, "t");
    return { httpStatus: 200, save: { ...stmt, accountingStatus: "final_closed", reopenCycles: upsert(cycles, rejected), reopenRequestedBy: undefined, reopenReason: undefined } };
  };
}
/** Model of POST /submit — captures a NEW normal snapshot from current config. */
function submit(config: CostApprovalWorkflowConfig) {
  return (stmt: Rec): Outcome => {
    if (!canSubmitForApproval(resolveAccountingStatus(stmt)).ok) return { httpStatus: 409, body: {} };
    const check = validateApproverList({ approverUserIds: resolveConfiguredApprovers(config), activeAdminIds: ACTIVE });
    if (!check.ok) return { httpStatus: 409, body: { code: "workflow_not_configured" } };
    return { httpStatus: 200, save: { ...stmt, accountingStatus: statusForApproverPosition(0), cycleApproverUserIds: check.approverUserIds, approvalCycle: resolveApprovalCycle(stmt) } };
  };
}
/** Model of POST /approve (normal chain, single-step close for the model). */
function approve(actorId: string, config: CostApprovalWorkflowConfig) {
  return (stmt: Rec): Outcome => {
    const status = resolveAccountingStatus(stmt);
    const approvers = resolveCycleApprovers(stmt, config);
    const patch = hasCycleApproverSnapshot(stmt) ? {} : { cycleApproverUserIds: approvers };
    const pos = approverPositionForStatus(status)!;
    const d = canApproveCyclePosition({ status, cycleApprovers: approvers, actorId, actingRevision: stmt.revision || 1, storedRevision: stmt.revision || 1 });
    if (!d.ok) return { httpStatus: d.code === "wrong_approver" ? 403 : 409, body: { code: d.code } };
    const nextStatus = nextStatusAfterPosition(pos, approvers.length);
    return { httpStatus: 200, save: { ...stmt, ...patch, accountingStatus: nextStatus === "final_closed" ? "final_closed" : nextStatus } };
  };
}

const CONFIG3: CostApprovalWorkflowConfig = { approverUserIds: ["u1", "u2", "u3"] };
const CONFIG2: CostApprovalWorkflowConfig = { approverUserIds: ["u1", "u2"] };

describe("Phase 3 — active-invoice lock (backend)", () => {
  it("blocks financial edits while an active invoice exists; allows them once cancelled", () => {
    const store = makeStore({ accountingStatus: "reopened", revision: 1 });
    expect(store.mutate(edit(true)).httpStatus).toBe(409);         // issued/partially_paid/paid → locked
    expect(store.mutate(edit(false)).httpStatus).toBe(200);        // cancelled → editable
  });
});

describe("Phase 3 — reopen eligibility", () => {
  it("Request Reopen is blocked while any active invoice exists, allowed after cancellation", () => {
    const store = makeStore({ accountingStatus: "final_closed", revision: 2 });
    expect(store.mutate(requestReopen(CONFIG3, "author", "fix", true)).body.code).toBe("active_invoice_lock");
    expect(store.get().accountingStatus).toBe("final_closed"); // cancelling alone did not reopen
    expect(store.mutate(requestReopen(CONFIG3, "author", "fix", false)).httpStatus).toBe(200);
    expect(store.get().accountingStatus).toBe("reopen_requested");
  });
  it("blank reason and duplicate pending request are rejected", () => {
    const store = makeStore({ accountingStatus: "final_closed", revision: 2 });
    expect(store.mutate(requestReopen(CONFIG3, "author", "   ", false)).httpStatus).toBe(400);
    store.mutate(requestReopen(CONFIG3, "author", "fix", false));
    expect(store.mutate(requestReopen(CONFIG3, "author", "again", false)).body.code).toBe("reopen_already_pending");
  });
});

describe("Phase 3 — two-user reopen chain enables editing", () => {
  it("Approver 1 → Approver 2 → reopened (editable); no auto-submit", () => {
    const store = makeStore({ accountingStatus: "final_closed", revision: 2, approvalCycle: 1 });
    store.mutate(requestReopen(CONFIG2, "author", "fix", false));
    expect(store.mutate(decideReopen("u2", true, CONFIG2)).httpStatus).toBe(403); // not their turn
    expect(store.mutate(decideReopen("u1", true, CONFIG2)).httpStatus).toBe(200);
    expect(store.get().accountingStatus).toBe("reopen_requested"); // still pending Approver 2
    expect(store.mutate(decideReopen("u2", true, CONFIG2)).httpStatus).toBe(200);
    expect(store.get().accountingStatus).toBe("reopened"); // editing enabled
    // Editing now works; still no invoice; not auto-resubmitted.
    expect(store.mutate(edit(false)).httpStatus).toBe(200);
  });
});

describe("Phase 3 — three-user reopen chain", () => {
  it("Approver 1 → 2 → 3 → reopened", () => {
    const store = makeStore({ accountingStatus: "final_closed", revision: 2, approvalCycle: 1 });
    store.mutate(requestReopen(CONFIG3, "author", "fix", false));
    store.mutate(decideReopen("u1", true, CONFIG3));
    store.mutate(decideReopen("u2", true, CONFIG3));
    expect(store.get().accountingStatus).toBe("reopen_requested");
    store.mutate(decideReopen("u3", true, CONFIG3));
    expect(store.get().accountingStatus).toBe("reopened");
  });
});

describe("Phase 3 — reopen rejection keeps the statement closed", () => {
  it("rejection preserves earlier decisions and requires a new request", () => {
    const store = makeStore({ accountingStatus: "final_closed", revision: 2, approvalCycle: 1 });
    store.mutate(requestReopen(CONFIG3, "author", "fix", false));
    store.mutate(decideReopen("u1", true, CONFIG3)); // Approver 1 approved
    expect(store.mutate(decideReopen("u2", false, CONFIG3, "no")).httpStatus).toBe(200);
    expect(store.get().accountingStatus).toBe("final_closed"); // stays closed/locked
    const cycles = store.get().reopenCycles as ReopenCycle[];
    expect(cycles[0].status).toBe("rejected");
    expect(cycles[0].decisions).toHaveLength(2); // approval + rejection preserved
    // Editing still disabled; another attempt needs a NEW reopen request.
    expect(store.mutate(edit(false)).httpStatus).toBe(409);
    expect(store.mutate(requestReopen(CONFIG3, "author", "try again", false)).httpStatus).toBe(200);
    expect((store.get().reopenCycles as ReopenCycle[]).length).toBe(2); // history preserved + new cycle
  });
});

describe("Phase 3 — reopen snapshot is immutable under settings change", () => {
  it("the active reopen cycle keeps its captured approvers; a later request uses new settings", () => {
    const store = makeStore({ accountingStatus: "final_closed", revision: 2, approvalCycle: 1 });
    store.mutate(requestReopen(CONFIG3, "author", "fix", false)); // captured [u1,u2,u3]
    store.mutate(decideReopen("u1", true, CONFIG3));
    // Settings change mid-reopen: u1 → u9 (two approvers).
    const CHANGED: CostApprovalWorkflowConfig = { approverUserIds: ["u1", "u9"] };
    expect(store.mutate(decideReopen("u9", true, CHANGED)).httpStatus).toBe(403); // not in captured list
    store.mutate(decideReopen("u2", true, CHANGED));
    store.mutate(decideReopen("u3", true, CHANGED));
    expect(store.get().accountingStatus).toBe("reopened");
    // A FUTURE reopen (after re-close) would use the new settings — verified by
    // building from CHANGED here.
    const nextCheck = validateApproverList({ approverUserIds: resolveConfiguredApprovers(CHANGED), activeAdminIds: ACTIVE });
    expect(nextCheck.ok && nextCheck.approverUserIds).toEqual(["u1", "u9"]);
  });
});

describe("Phase 3 — legacy in-flight reopen", () => {
  it("captures the current config once on the first decision, then ignores later changes", () => {
    // Legacy: status reopen_requested, NO reopenCycles snapshot, legacy fields set.
    const store = makeStore({ accountingStatus: "reopen_requested", approvalCycle: 1, revision: 2, reopenRequestedBy: "author", reopenReason: "legacy fix" });
    expect(activeReopenCycle(store.get())).toBeNull();
    // First decision captures [u1,u2,u3] and advances.
    expect(store.mutate(decideReopen("u1", true, CONFIG3)).httpStatus).toBe(200);
    const captured = (store.get().reopenCycles as ReopenCycle[])[0];
    expect(captured.approverUserIds).toEqual(["u1", "u2", "u3"]);
    expect(captured.reason).toBe("legacy fix");
    // Later settings change ignored — continues with captured list.
    const CHANGED: CostApprovalWorkflowConfig = { approverUserIds: ["u1", "u9"] };
    expect(store.mutate(decideReopen("u9", true, CHANGED)).httpStatus).toBe(403);
    store.mutate(decideReopen("u2", true, CHANGED));
    store.mutate(decideReopen("u3", true, CHANGED));
    expect(store.get().accountingStatus).toBe("reopened");
  });
  it("an unusable config leaves a legacy reopen untouched (controlled error, no mutation)", () => {
    const store = makeStore({ accountingStatus: "reopen_requested", approvalCycle: 1, revision: 2, reopenRequestedBy: "author", reopenReason: "x" });
    const bad: CostApprovalWorkflowConfig = { approverUserIds: ["u1"] }; // only one approver
    const out = store.mutate(decideReopen("u1", true, bad));
    expect(out.httpStatus).toBe(409);
    expect(out.body.code).toBe("reopen_config_unavailable");
    expect(store.get().accountingStatus).toBe("reopen_requested"); // unchanged
    expect(store.get().reopenCycles).toBeUndefined();
  });
});

describe("Phase 3 — resubmission after reopen uses a NEW normal snapshot", () => {
  it("reopened → edit → submit captures current settings; old reopen history preserved", () => {
    const store = makeStore({ accountingStatus: "final_closed", revision: 2, approvalCycle: 1, cycleApproverUserIds: ["u1", "u2"] });
    // Original normal cycle used [u1,u2]; now reopen with a 3-approver chain.
    store.mutate(requestReopen(CONFIG3, "author", "fix", false));
    store.mutate(decideReopen("u1", true, CONFIG3));
    store.mutate(decideReopen("u2", true, CONFIG3));
    store.mutate(decideReopen("u3", true, CONFIG3));
    expect(store.get().accountingStatus).toBe("reopened");
    store.mutate(edit(false));
    // Settings are now [u1,u9]; the NEW normal submission must capture them.
    const CHANGED: CostApprovalWorkflowConfig = { approverUserIds: ["u1", "u9"] };
    store.mutate(submit(CHANGED));
    expect(store.get().cycleApproverUserIds).toEqual(["u1", "u9"]); // new normal snapshot
    // Reopen history is preserved.
    expect((store.get().reopenCycles as ReopenCycle[])[0].status).toBe("approved");
    // Complete the new normal chain → final_closed (only then may a new invoice issue).
    expect(store.mutate(approve("u1", CHANGED)).httpStatus).toBe(200);
    expect(store.mutate(approve("u9", CHANGED)).httpStatus).toBe(200);
    expect(store.get().accountingStatus).toBe("final_closed");
  });
});
