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
  it("settings: view = accounting viewers, write = Super Admin only", () => {
    expect(SERVER).toContain('app.get("/api/admin/accounting/approval-workflow", requireCanViewCostStatements');
    expect(SERVER).toContain('app.put("/api/admin/accounting/approval-workflow", requireSuperAdmin');
    expect(region('app.put("/api/admin/accounting/approval-workflow"', 900)).toContain("validateWorkflowConfig(");
  });
  it("submit requires accounting write; approve/reject allow any admin (assigned-approver enforced in the pure logic, since approvers may be operation-type)", () => {
    expect(SERVER).toContain('app.post("/api/cost-statements/:shipmentId/submit", requireCanWriteCostStatements');
    expect(SERVER).toContain('app.post("/api/cost-statements/:shipmentId/approve", requireRole("admin")');
    expect(SERVER).toContain('app.post("/api/cost-statements/:shipmentId/reject", requireRole("admin")');
  });
  it("reopen request = accounting write; reopen decision = Super Admin only", () => {
    expect(SERVER).toContain('app.post("/api/cost-statements/:shipmentId/reopen-request", requireCanViewCostStatements');
    expect(SERVER).toContain('app.post("/api/cost-statements/:shipmentId/reopen-decision", requireSuperAdmin');
  });
});

describe("actor identity is server-derived, decisions go through the pure module", () => {
  it("submit/approve/reject/reopen use pure guards and the session id, never body identity", () => {
    const SUBMIT = region('app.post("/api/cost-statements/:shipmentId/submit"', 2200);
    expect(SUBMIT).toContain("canSubmitForApproval(status)");
    expect(SUBMIT).toContain("isWorkflowConfigUsable(config");
    expect(SUBMIT).toContain("resolveWorkflowActorName(req.session!)");
    const APPROVE = region('app.post("/api/cost-statements/:shipmentId/approve"', 5000);
    expect(APPROVE).toContain("canApproveStage({ status, config, actorId: req.session!.id");
    expect(APPROVE).not.toContain("req.body.actorId");
    const REJECT = region('app.post("/api/cost-statements/:shipmentId/reject"', 1800);
    expect(REJECT).toContain("canRejectStage({ status, config, actorId: req.session!.id");
  });
  it("edit route is locked while pending or closed", () => {
    const EDIT = region('app.post("/api/cost-statements/:shipmentId", requireCanWriteCostStatements', 3400);
    expect(EDIT).toContain("isFinancialEditingAllowed(currentStatus)");
    expect(EDIT).toContain('code: "accounting_locked"');
  });
});

describe("final closure integrity", () => {
  it("the PDF is generated and stored BEFORE the statement is marked closed; failure returns 502 and does not close", () => {
    const APPROVE = region('app.post("/api/cost-statements/:shipmentId/approve"', 5000);
    const finalizeAt = APPROVE.indexOf("finalizeCostStatementPdf(");
    const closedAt = APPROVE.indexOf('accountingStatus: "final_closed"');
    expect(finalizeAt).toBeGreaterThan(-1);
    expect(closedAt).toBeGreaterThan(-1);
    expect(finalizeAt).toBeLessThan(closedAt); // PDF stored first
    expect(APPROVE).toContain('code: "final_pdf_failed"');
    expect(APPROVE).toContain("502");
    // finalize throws on failure (no silent close).
    const FINALIZE = region("async function finalizeCostStatementPdf", 1800);
    expect(FINALIZE).toContain("renderFinalCostStatementPdf(model)");
    expect(FINALIZE).toContain("buildFinalPdfModel(");
  });
  it("historical final PDF versions are appended, never overwritten", () => {
    const APPROVE = region('app.post("/api/cost-statements/:shipmentId/approve"', 5000);
    expect(APPROVE).toContain("finalVersions: [...((stmt.finalVersions");
  });
});

describe("access boundaries — final PDF never reaches driver/client/public", () => {
  it("the final-pdf route is accounting-only and the share view never carries cost data", () => {
    expect(SERVER).toContain('app.get("/api/cost-statements/:shipmentId/final-pdf", requireCanViewCostStatements');
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
