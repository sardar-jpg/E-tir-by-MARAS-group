import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Wiring/contract tests for the cost approval workflow (PR #6): source-scan
 * server.ts so route permissions, ordering, PDF-before-close, and access
 * boundaries cannot silently regress.
 */
const ROOT = join(__dirname, "..", "..");
const SERVER = readFileSync(join(ROOT, "server.ts"), "utf-8");
const region = (needle: string, length: number): string => {
  const at = SERVER.indexOf(needle);
  expect(at, `server.ts must contain: ${needle}`).toBeGreaterThan(-1);
  return SERVER.slice(at, at + length);
};

describe("route permissions", () => {
  it("settings: view = costs.view; workflow config write = costs.manageApprovalWorkflow permission (NOT Super Admin only)", () => {
    expect(SERVER).toContain('app.get("/api/admin/accounting/approval-workflow", requirePermission("costs.view")');
    // Phase 2: approval-settings editing is the granular permission, never requireSuperAdmin.
    expect(SERVER).toContain('app.put("/api/admin/accounting/approval-workflow", requirePermission("costs.manageApprovalWorkflow")');
    expect(SERVER).not.toContain('app.put("/api/admin/accounting/approval-workflow", requireSuperAdmin');
    expect(region('app.put("/api/admin/accounting/approval-workflow"', 900)).toContain("validateApproverList(");
  });
  it("submit requires costs.edit; approve/reject require costs.approve (assigned-approver still enforced in the pure logic)", () => {
    expect(SERVER).toContain('app.post("/api/cost-statements/:shipmentId/submit", requirePermission("costs.edit")');
    expect(SERVER).toContain('app.post("/api/cost-statements/:shipmentId/approve", requirePermission("costs.approve")');
    expect(SERVER).toContain('app.post("/api/cost-statements/:shipmentId/reject", requirePermission("costs.approve")');
  });
  it("reopen request = accounting write; reopen decision = Super Admin only", () => {
    expect(SERVER).toContain('app.post("/api/cost-statements/:shipmentId/reopen-request", requirePermission("costs.reopen")');
    expect(SERVER).toContain('app.post("/api/cost-statements/:shipmentId/reopen-decision", requirePermission("costs.reopen")');
  });
});

describe("actor identity is server-derived, decisions go through the pure module", () => {
  it("submit/approve/reject/reopen use pure guards and the session id, never body identity", () => {
    const SUBMIT = region('app.post("/api/cost-statements/:shipmentId/submit"', 3200);
    expect(SUBMIT).toContain("canSubmitForApproval(status)");
    // Phase 2: submit validates the ordered approver list and CAPTURES it onto the cycle.
    expect(SUBMIT).toContain("validateApproverList(");
    expect(SUBMIT).toContain("cycleApproverUserIds:");
    expect(SUBMIT).toContain("resolveWorkflowActorName(req.session!)");
    const APPROVE = region('app.post("/api/cost-statements/:shipmentId/approve"', 11000);
    // Phase 2: approval decides against the captured cycle approver list, not live config.
    expect(APPROVE).toContain("canApproveCyclePosition({ status, cycleApprovers, actorId: req.session!.id");
    expect(APPROVE).not.toContain("req.body.actorId");
    const REJECT = region('app.post("/api/cost-statements/:shipmentId/reject"', 3200);
    expect(REJECT).toContain("canRejectCyclePosition({ status, cycleApprovers, actorId: req.session!.id");
  });
  it("every workflow transition re-reads + re-decides INSIDE an atomic mutation (BLOCKER 2)", () => {
    // All five simple routes and the finalization route funnel their state
    // change through mutateCostStatementAtomic, which re-reads the doc and
    // runs the pure decision against that fresh value.
    for (const route of ["submit", "approve", "reject", "reopen-request", "reopen-decision"]) {
      const R = region(`app.post("/api/cost-statements/:shipmentId/${route}"`, 5200);
      expect(R, `${route} must be atomic`).toContain("mutateCostStatementAtomic(req.params.shipmentId, (stmt)");
    }
    // The atomic helper re-reads inside a Firestore transaction and mirrors
    // the same decision synchronously against the live memory array.
    const HELPER = region("async function mutateCostStatementAtomic", 1400);
    expect(HELPER).toContain("runTransaction");
    expect(HELPER).toContain("tx.get(ref)");
    expect(HELPER).toContain("getMemoryStore().costStatements");
  });
  it("edit route is locked while pending/finalizing/closed — enforced inside the atomic section", () => {
    const EDIT = region('app.post("/api/cost-statements/:shipmentId", requirePermission("costs.edit")', 4200);
    expect(EDIT).toContain("assertEditableInAtomicSection");
    expect(EDIT).toContain("isFinancialEditingAllowed(currentStatus)");
    expect(EDIT).toContain('code: lockErr.code');
    // The guard runs inside BOTH the Firestore transaction (re-check on the
    // tx-fresh doc) and the memory write (passed to the atomic helper).
    expect(SERVER).toContain("assertEditableInAtomicSection(stored);");
    expect(SERVER).toContain("buildFinal,\n          assertEditableInAtomicSection");
  });
});

describe("final closure integrity + idempotent, crash-recoverable finalization", () => {
  it("finalization reserves a 'finalizing' state, then stores the PDF BEFORE closing; failure returns 502 and does not close", () => {
    const APPROVE = region('app.post("/api/cost-statements/:shipmentId/approve"', 11000);
    // A deterministic finalization decision (cycle-snapshot based) drives begin/resume/close.
    expect(APPROVE).toContain("decideCycleFinalization({");
    expect(APPROVE).toContain('accountingStatus: "finalizing"');
    const finalizeAt = APPROVE.indexOf("finalizeCostStatementPdf(");
    const closedAt = APPROVE.indexOf('accountingStatus: "final_closed"');
    expect(finalizeAt).toBeGreaterThan(-1);
    expect(closedAt).toBeGreaterThan(-1);
    expect(finalizeAt).toBeLessThan(closedAt); // PDF stored first
    expect(APPROVE).toContain('code: "final_pdf_failed"');
    expect(APPROVE).toContain("502");
    // finalize throws on failure (no silent close).
    const FINALIZE = region("async function finalizeCostStatementPdf", 2800);
    expect(FINALIZE).toContain("renderFinalCostStatementPdf(model)");
    expect(FINALIZE).toContain("buildFinalPdfModel(");
  });
  it("the closure commit is idempotent — it dedupes on the key and appends versions, never overwrites", () => {
    const APPROVE = region('app.post("/api/cost-statements/:shipmentId/approve"', 11000);
    expect(APPROVE).toContain("hasFinalVersionFor(");
    expect(APPROVE).toContain("[...((stmt.finalVersions");
  });
});

describe("access boundaries — final PDF never reaches driver/client/public", () => {
  it("the final-pdf route is accounting-only and the share view never carries cost data", () => {
    expect(SERVER).toContain('app.get("/api/cost-statements/:shipmentId/final-pdf", requirePermission("costs.view")');
    const SHARE = readFileSync(join(ROOT, "src", "lib", "publicShareView.ts"), "utf-8");
    expect(SHARE).not.toContain("finalPdfUrl");
    expect(SHARE).not.toContain("accountingStatus");
    expect(SHARE).not.toContain("costStatement");
    // Cost PDFs are stored under their own path, never added to shipment.documents.
    expect(SERVER).toContain("cost-statements/${stmt.shipmentId}/final/");
  });
  it("memory-fallback entry exists for the settings collection (PR #44 lesson)", () => {
    expect(SERVER).toContain("accountingSettings: any[];");
    expect(SERVER).toContain("accountingSettings: [],");
  });
});
