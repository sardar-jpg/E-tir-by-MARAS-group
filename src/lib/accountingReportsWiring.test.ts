import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACCOUNTING_PERMISSION_KEYS, SENSITIVE_ACCOUNTING_PERMISSIONS, LEGACY_ACCOUNTS_DEFAULT_PERMISSIONS,
  resolveEffectivePermissions, ACCOUNTING_PERMISSION_GROUPS,
} from "./accountingPermissions";

const ROOT = join(__dirname, "..", "..");
const SERVER = readFileSync(join(ROOT, "server.ts"), "utf-8");
const idx = (needle: string) => { const i = SERVER.indexOf(needle); if (i < 0) throw new Error(`not found: ${needle}`); return i; };
const region = (needle: string, length: number) => SERVER.slice(idx(needle), idx(needle) + length);

// ── 38.9 Permissions ─────────────────────────────────────────────────────────
describe("Phase 7 report permissions", () => {
  it("registers the four report permission keys, grouped and non-duplicated", () => {
    for (const k of ["reports.view", "reports.export", "profitReports.view", "cashReports.view"]) {
      expect(ACCOUNTING_PERMISSION_KEYS).toContain(k);
    }
    const reportsGroup = ACCOUNTING_PERMISSION_GROUPS.find((g) => g.id === "reports");
    expect(reportsGroup?.permissions.map((p) => p.key).sort()).toEqual(["cashReports.view", "profitReports.view", "reports.export", "reports.view"]);
  });
  it("Official Profit + Cash reports are SENSITIVE and never in the legacy default", () => {
    expect(SENSITIVE_ACCOUNTING_PERMISSIONS).toContain("profitReports.view");
    expect(SENSITIVE_ACCOUNTING_PERMISSIONS).toContain("cashReports.view");
    expect(LEGACY_ACCOUNTS_DEFAULT_PERMISSIONS).not.toContain("profitReports.view");
    expect(LEGACY_ACCOUNTS_DEFAULT_PERMISSIONS).not.toContain("cashReports.view");
  });
  it("general report view + export ARE in the legacy default (matches statement export policy)", () => {
    expect(LEGACY_ACCOUNTS_DEFAULT_PERMISSIONS).toContain("reports.view");
    expect(LEGACY_ACCOUNTS_DEFAULT_PERMISSIONS).toContain("reports.export");
  });
  it("super admin has every report permission; a report-only grant is not super-only", () => {
    const superPerms = resolveEffectivePermissions({ role: "admin", adminType: "super" });
    for (const k of ["reports.view", "reports.export", "profitReports.view", "cashReports.view"]) expect(superPerms.has(k as any)).toBe(true);
    const granted = resolveEffectivePermissions({ role: "admin", adminType: "accounts", permissions: ["reports.view", "profitReports.view"] });
    expect(granted.has("reports.view")).toBe(true);
    expect(granted.has("profitReports.view")).toBe(true);
    expect(granted.has("cashReports.view")).toBe(false); // not granted → denied
  });
  it("a default (never-configured) accounts user gets general reports but NOT profit/cash", () => {
    const acc = resolveEffectivePermissions({ role: "admin", adminType: "accounts" });
    expect(acc.has("reports.view")).toBe(true);
    expect(acc.has("profitReports.view")).toBe(false);
    expect(acc.has("cashReports.view")).toBe(false);
  });
  it("an operation-role user with no explicit permissions gets no reports", () => {
    const op = resolveEffectivePermissions({ role: "admin", adminType: "operation" });
    expect(op.has("reports.view")).toBe(false);
  });
});

// ── 38.10 Read-only + correct permission gates on every report route ─────────
describe("Phase 7 report routes are read-only GETs behind the right permissions", () => {
  it("all report routes are GET (no report route mutates)", () => {
    for (const path of [
      "/api/accounting/reports/orders/:shipmentId/financial-summary",
      "/api/accounting/reports/receivables", "/api/accounting/reports/payables",
      "/api/accounting/reports/profit", "/api/accounting/reports/customer-receipts",
      "/api/accounting/reports/vendor-payments", "/api/accounting/reports/cash-movement",
      "/api/accounting/reports/financial-closing", "/api/accounting/reports/overview",
    ]) {
      expect(SERVER).toContain(`app.get("${path}"`);
      expect(SERVER).not.toContain(`app.post("${path}"`);
      expect(SERVER).not.toContain(`app.put("${path}"`);
      expect(SERVER).not.toContain(`app.delete("${path}"`);
    }
  });
  it("receivables/payables/receipts/vendor-payments/closing/overview require reports.view", () => {
    expect(SERVER).toContain('app.get("/api/accounting/reports/receivables", requirePermission("reports.view")');
    expect(SERVER).toContain('app.get("/api/accounting/reports/payables", requirePermission("reports.view")');
    expect(SERVER).toContain('app.get("/api/accounting/reports/customer-receipts", requirePermission("reports.view")');
    expect(SERVER).toContain('app.get("/api/accounting/reports/vendor-payments", requirePermission("reports.view")');
    expect(SERVER).toContain('app.get("/api/accounting/reports/financial-closing", requirePermission("reports.view")');
    expect(SERVER).toContain('app.get("/api/accounting/reports/overview", requirePermission("reports.view")');
  });
  it("profit report requires the SENSITIVE profitReports.view; cash movement requires cashReports.view", () => {
    expect(SERVER).toContain('app.get("/api/accounting/reports/profit", requirePermission("profitReports.view")');
    expect(SERVER).toContain('app.get("/api/accounting/reports/cash-movement", requirePermission("cashReports.view")');
  });
  it("CSV export re-checks reports.export inside the shared list responder and audits report.exported", () => {
    const RESP = region("async function respondReportList", 1400);
    expect(RESP).toContain('sessionHasReportPermission(req, "reports.export")');
    expect(RESP).toContain("AUDIT_ACTIONS.reportExported");
    expect(RESP).toContain('res.setHeader("Content-Type", "text/csv; charset=utf-8")');
  });
  it("list routes validate the date range → controlled 400, and sort is whitelisted", () => {
    const REC = region('app.get("/api/accounting/reports/receivables"', 2400);
    expect(REC).toContain("Reports.validateDateRange(");
    expect(REC).toContain('res.status(400).json({ code: range.code');
    const RESP = region("async function respondReportList", 1400);
    expect(RESP).toContain("Reports.applySort(");
    expect(RESP).toContain('code: "invalid_sort"');
  });
  it("cash movement report is explicitly NOT profit (carries the disclaimer note)", () => {
    const CASH = region('app.get("/api/accounting/reports/cash-movement"', 1400);
    expect(CASH).toContain("is not the Official Profit calculation");
    expect(CASH).toContain("Reports.buildCashMovement(");
  });
  it("reports load the dataset ONCE per request (indexed maps, no N+1)", () => {
    expect(SERVER).toContain("async function loadReportingDataset()");
    expect(SERVER).toContain("invoicesByShipment");
    expect(SERVER).toContain("vendorPaymentsByShipment");
  });
});
