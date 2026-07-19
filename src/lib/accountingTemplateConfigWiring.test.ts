import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SERVER = readFileSync(join(__dirname, "..", "..", "server.ts"), "utf-8");

describe("template customization routes (Phase 11)", () => {
  it("view = accounting view; edit/restore = Super Admin only", () => {
    expect(SERVER).toContain('app.get("/api/admin/accounting/templates/:docType", requireCanViewCostStatements');
    expect(SERVER).toContain('app.put("/api/admin/accounting/templates/:docType", requireSuperAdmin');
    expect(SERVER).toContain('app.get("/api/admin/accounting/templates/:docType/versions", requireCanViewCostStatements');
    expect(SERVER).toContain('app.post("/api/admin/accounting/templates/:docType/restore/:version", requireSuperAdmin');
    expect(SERVER).toContain('app.post("/api/admin/accounting/templates/:docType/preview", requireCanViewCostStatements');
  });
  it("config is validated + versioned; PDFs apply it", () => {
    expect(SERVER).toContain("validateTemplateConfig(");
    // Versioning is now atomic (increment 3, item 16): archived inside the
    // transaction under a deterministic per-version id.
    expect(SERVER).toContain('tx.set("templateConfigVersions"');
    expect(SERVER).toContain("applyTemplateToModel(buildInvoicePdfModel");
    expect(SERVER).toContain("applyTemplateToModel(buildVoucherPdfModel");
    expect(SERVER).toContain("buildSamplePreviewModel(");
  });
});
