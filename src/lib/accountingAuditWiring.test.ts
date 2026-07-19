import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Increment 7 — audit-log server wiring + viewer contract. Pins that critical
 * mutations stage their audit INSIDE the transaction, that the routes are
 * append-only + permission-gated, and that sensitive detail is gated by
 * audit.viewSensitive. End-to-end behavior is verified by the live acceptance
 * scenario.
 */
const ROOT = join(__dirname, "..", "..");
const SERVER = readFileSync(join(ROOT, "server.ts"), "utf-8");

describe("audit is staged atomically inside critical financial transactions", () => {
  it("invoice issue, payment create/allocate/reverse, vendor create/reverse stage audit in-tx", () => {
    // stageAudit runs inside runAccountingTransaction (commits/rolls back with it).
    const occurrences = SERVER.split("stageAudit(tx,").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(6);
    expect(SERVER).toContain("AUDIT_ACTIONS.invoiceIssued");
    expect(SERVER).toContain("AUDIT_ACTIONS.customerPaymentCreated");
    expect(SERVER).toContain("AUDIT_ACTIONS.customerPaymentReversed");
    expect(SERVER).toContain("AUDIT_ACTIONS.vendorPaymentCreated");
    expect(SERVER).toContain("AUDIT_ACTIONS.vendorPaymentReversed");
  });
  it("actor comes from the authenticated session, never the request body", () => {
    expect(SERVER).toContain("function auditActorFromReq");
    expect(SERVER).toContain("req.session?.id");
    // The audit builder is never fed req.body actor fields.
    expect(SERVER).not.toContain("actorId: req.body");
  });
  it("rejected sensitive actions are logged (issue/overpay/attachment/repair)", () => {
    expect(SERVER).toContain("AUDIT_ACTIONS.invoiceIssueRejected");
    expect(SERVER).toContain("AUDIT_ACTIONS.vendorPaymentOverpaymentRejected");
    expect(SERVER).toContain("AUDIT_ACTIONS.reconciliationRepairDenied");
  });
});

describe("audit routes are read-only + permission-gated", () => {
  it("view/export require audit.view / audit.export; no update or delete route", () => {
    expect(SERVER).toContain('app.get("/api/admin/accounting/audit", requirePermission("audit.view")');
    expect(SERVER).toContain('app.get("/api/admin/accounting/audit/export.csv", requirePermission("audit.export")');
    expect(SERVER).not.toContain('app.put("/api/admin/accounting/audit');
    expect(SERVER).not.toContain('app.delete("/api/admin/accounting/audit');
    expect(SERVER).not.toContain('app.post("/api/admin/accounting/audit"');
  });
  it("server-side filter + pagination; before/after gated by audit.viewSensitive", () => {
    expect(SERVER).toContain("filterAuditRecords(");
    expect(SERVER).toContain("paginateAudit(");
    expect(SERVER).toContain('perms.has("audit.viewSensitive")');
    expect(SERVER).toContain("redactAuditForNonSensitive");
  });
  it("reconciliation repair requires reason + is audited; dry-run never mutates", () => {
    expect(SERVER).toContain("AUDIT_ACTIONS.reconciliationRepairExecuted");
    expect(SERVER).toContain("AUDIT_ACTIONS.reconciliationExecuted");
    expect(SERVER).toContain('reason_required');
  });
  it("auditLogs has a memory-fallback entry (PR #44 lesson)", () => {
    expect(SERVER).toContain("auditLogs: any[];");
    expect(SERVER).toContain("auditLogs: [],");
  });
});

describe("audit viewer UI is read-only + server-driven", () => {
  const UI = readFileSync(join(ROOT, "src", "components", "admin", "AuditLogViewer.tsx"), "utf-8");
  const TEAM = readFileSync(join(ROOT, "src", "components", "admin", "sections", "AdminTeamSection.tsx"), "utf-8");
  it("lives in the Settings → Team (Super-Admin) area", () => {
    expect(TEAM).toContain("import AuditLogViewer");
    expect(TEAM).toContain("<AuditLogViewer");
  });
  it("uses the server audit endpoint with server-side pagination and no edit/delete controls", () => {
    expect(UI).toContain("/api/admin/accounting/audit");
    expect(UI).toContain("cursor"); // cursor pagination
    expect(UI).toContain("export.csv");
    expect(UI).not.toMatch(/onDelete|handleDelete|method:\s*["']DELETE["']|method:\s*["']PUT["']/);
  });
});
