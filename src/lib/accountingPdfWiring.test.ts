import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SERVER = readFileSync(join(__dirname, "..", "..", "server.ts"), "utf-8");

describe("accounting PDF routes", () => {
  it("invoice / receipt / statement / voucher PDFs are internal-only (accounting view)", () => {
    expect(SERVER).toContain('app.get("/api/cost-statements/:shipmentId/invoices/:invoiceId/pdf", requireCanViewCostStatements');
    expect(SERVER).toContain('app.get("/api/customer-accounts/payments/:paymentId/receipt/pdf", requireCanViewCostStatements');
    expect(SERVER).toContain('app.get("/api/customer-accounts/statement/pdf", requireCanViewCostStatements');
    expect(SERVER).toContain('app.get("/api/cost-statements/:shipmentId/vendor-payments/:paymentId/voucher", requireCanViewCostStatements');
  });
  it("all documents render through the single shared renderer from saved data + company profile", () => {
    expect(SERVER).toContain("renderAccountingPdf(");
    expect(SERVER).toContain("buildInvoicePdfModel(");
    expect(SERVER).toContain("buildReceiptPdfModel(");
    expect(SERVER).toContain("buildStatementPdfModel(");
    expect(SERVER).toContain("buildVoucherPdfModel(");
    expect(SERVER).toContain("loadCompanyProfile()");
  });
  it("PDFs stream as application/pdf for clean print + download", () => {
    expect(SERVER).toContain('res.setHeader("Content-Type", "application/pdf")');
    expect(SERVER).toContain('Content-Disposition');
  });
  it("the final cost statement PDF now carries company branding", () => {
    expect(SERVER).toContain("buildFinalPdfModel({ statement: stmt, approvalHistory, cycleNumber, finalizedAt, finalStatementRevision: finalRevision, company");
    const MODEL = readFileSync(join(__dirname, "costStatementFinalPdfModel.ts"), "utf-8");
    expect(MODEL).toContain("brandName");
    expect(MODEL).toContain("brandFooterText");
  });
});
