import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SERVER = readFileSync(join(__dirname, "..", "..", "server.ts"), "utf-8");

describe("template versioning + issued-document snapshots", () => {
  it("company profile publish/restore are atomic (item 14/15) — archive + version bump in one transaction", () => {
    // Cross-instance safe: read current + version, archive current (immutable),
    // bump version, write new current — all inside runAccountingTransaction.
    expect(SERVER).toContain('tx.set("companyProfileVersions"');
    expect(SERVER).toContain("version: currentVersion + 1");
    expect(SERVER).toContain("sourceRestoredVersion");
  });
  it("template publish/restore are atomic too (items 16/17)", () => {
    expect(SERVER).toContain('tx.set("templateConfigVersions"');
    expect(SERVER).toContain('tx.set("accountingSettings", `template_${docType}`');
  });
  it("version history + restore routes exist (view/super-admin)", () => {
    expect(SERVER).toContain('app.get("/api/admin/accounting/company-profile/versions", requirePermission("accountingCompanyProfile.view")');
    expect(SERVER).toContain('app.post("/api/admin/accounting/company-profile/restore/:version", requirePermission("accountingCompanyProfile.restore")');
  });
  it("issued invoices snapshot the company branding + version at issue time", () => {
    expect(SERVER).toContain("companySnapshot: Object.keys(companySnapshot).length ? companySnapshot : undefined");
    expect(SERVER).toContain("companyProfileVersion:");
  });
  it("companyProfileVersions has a memory-fallback entry (PR #44 lesson)", () => {
    expect(SERVER).toContain("companyProfileVersions: CompanyProfileVersion[];");
    expect(SERVER).toContain("companyProfileVersions: [],");
  });
});
