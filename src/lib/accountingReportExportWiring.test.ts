import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AUDIT_ACTIONS } from "./accountingAudit";

const ROOT = join(__dirname, "..", "..");
const SERVER = readFileSync(join(ROOT, "server.ts"), "utf-8");
const RENDER = readFileSync(join(ROOT, "src", "lib", "accountingPdfRender.ts"), "utf-8");
const idx = (needle: string) => { const i = SERVER.indexOf(needle); if (i < 0) throw new Error(`not found: ${needle}`); return i; };
const region = (needle: string, length: number) => SERVER.slice(idx(needle), idx(needle) + length);

const EXPORT_PATHS = [
  "/api/accounting/reports/orders/:shipmentId/financial-summary/export",
  "/api/accounting/reports/receivables/export",
  "/api/accounting/reports/payables/export",
  "/api/accounting/reports/profit/export",
  "/api/accounting/reports/cash-movement/export",
  "/api/accounting/reports/customer-receipts/export",
  "/api/accounting/reports/vendor-payments/export",
  "/api/accounting/reports/financial-closing/export",
  "/api/accounting/reports/customers/:customerId/statement/export",
  "/api/accounting/reports/vendors/:vendorId/statement/export",
];

describe("Phase 8 export routes are read-only GETs behind view + export permission", () => {
  it("all ten export routes exist as GET (never a mutation verb)", () => {
    for (const p of EXPORT_PATHS) {
      expect(SERVER).toContain(`app.get("${p}"`);
      expect(SERVER).not.toContain(`app.post("${p}"`);
      expect(SERVER).not.toContain(`app.put("${p}"`);
      expect(SERVER).not.toContain(`app.delete("${p}"`);
    }
  });
  it("profit + cash exports require their SENSITIVE view permission at the route", () => {
    expect(SERVER).toContain('app.get("/api/accounting/reports/profit/export", requirePermission("profitReports.view")');
    expect(SERVER).toContain('app.get("/api/accounting/reports/cash-movement/export", requirePermission("cashReports.view")');
  });
  it("general exports require reports.view at the route", () => {
    expect(SERVER).toContain('app.get("/api/accounting/reports/receivables/export", requirePermission("reports.view")');
    expect(SERVER).toContain('app.get("/api/accounting/reports/payables/export", requirePermission("reports.view")');
  });
  it("the shared export responder additionally re-checks reports.export, so export never bypasses a view gate", () => {
    const RESP = region("async function sendReportExport", 2600);
    expect(RESP).toContain('sessionHasReportPermission(req, "reports.export")');
    expect(RESP).toContain('code: "permission_denied"');
  });
  it("unsupported format returns a controlled 400; oversized report returns 413", () => {
    const RESP = region("async function sendReportExport", 2600);
    expect(RESP).toContain('code: "invalid_format"');
    expect(RESP).toContain("ReportExport.MAX_EXPORT_ROWS");
    expect(RESP).toContain('code: "report_export_too_large"');
    expect(RESP).toContain("413");
  });
  it("PDF response uses application/pdf + attachment + X-Export-Id; CSV uses text/csv", () => {
    const RESP = region("async function sendReportExport", 2800);
    expect(RESP).toContain('"application/pdf"');
    expect(RESP).toContain('"text/csv; charset=utf-8"');
    expect(RESP).toContain('attachment; filename=');
    expect(RESP).toContain('res.setHeader("X-Export-Id"');
    // Output is generated BEFORE the audit + send (no false-success audit).
    expect(RESP).toContain("payload = await renderAccountingPdf");
  });
  it("each successful export writes exactly one report.exported audit (no financial mutation)", () => {
    const RESP = region("async function sendReportExport", 2600);
    expect(RESP).toContain("AUDIT_ACTIONS.reportExported");
    expect(AUDIT_ACTIONS.reportExported).toBe("report.exported");
    // The export block never writes an accounting record.
    const BLOCK = region("Accounting Phase 8 — Professional report exports", 9000);
    expect(BLOCK).not.toContain("mutateCostStatementAtomic");
    expect(BLOCK).not.toContain("runAccountingTransaction");
  });
  it("exports build the SAME Phase 7 report result + shared export model (no PDF-only recompute)", () => {
    const BLOCK = region("Accounting Phase 8 — Professional report exports", 9000);
    expect(BLOCK).toContain("Reports.buildReceivableRows(");
    expect(BLOCK).toContain("ReportExport.receivablesExportModel(");
    expect(BLOCK).toContain("ReportExport.reportExportModelToPdfModel(");
    expect(BLOCK).toContain("renderAccountingPdf(");
  });
  it("the caller's own report permissions are exposed for UI gating", () => {
    expect(SERVER).toContain('app.get("/api/accounting/my-permissions"');
  });
});

describe("shared PDF renderer repeats table headers across pages", () => {
  it("drawTable redraws the header on every page break", () => {
    expect(RENDER).toContain("const drawHeader = ()");
    expect(RENDER).toContain("doc.addPage(); y = 20; drawHeader();");
  });
});
