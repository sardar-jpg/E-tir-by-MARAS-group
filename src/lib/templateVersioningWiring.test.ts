import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SERVER = readFileSync(join(__dirname, "..", "..", "server.ts"), "utf-8");

describe("template versioning + issued-document snapshots", () => {
  it("company profile save archives the prior version and bumps the version", () => {
    expect(SERVER).toContain('doc(db, "companyProfileVersions"');
    expect(SERVER).toContain("version: currentVersion + 1");
  });
  it("version history + restore routes exist (view/super-admin)", () => {
    expect(SERVER).toContain('app.get("/api/admin/accounting/company-profile/versions", requireCanViewCostStatements');
    expect(SERVER).toContain('app.post("/api/admin/accounting/company-profile/restore/:version", requireSuperAdmin');
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
