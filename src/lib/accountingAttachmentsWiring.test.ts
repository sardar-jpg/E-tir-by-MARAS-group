import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Increment 6 — accounting attachment routes + finalized PDF document
 * contracts. Pins the server wiring the pure/behavioral tests cannot see; the
 * end-to-end behavior is verified by the live memory-mode HTTP scenario.
 */
const ROOT = join(__dirname, "..", "..");
const SERVER = readFileSync(join(ROOT, "server.ts"), "utf-8");

describe("accounting attachment routes — permissions + storage + soft-remove", () => {
  it("upload/list/download require view/upload; remove requires remove", () => {
    expect(SERVER).toContain('app.post("/api/accounting/attachments", requirePermission("accountingAttachments.upload")');
    expect(SERVER).toContain('app.get("/api/accounting/attachments", requirePermission("accountingAttachments.view")');
    expect(SERVER).toContain('app.get("/api/accounting/attachments/:id/download", requirePermission("accountingAttachments.view")');
    expect(SERVER).toContain('app.post("/api/accounting/attachments/:id/remove", requirePermission("accountingAttachments.remove")');
  });
  it("validates content by sniff, not client MIME, and rejects with structured codes", () => {
    expect(SERVER).toContain("validateAttachmentUpload(");
    expect(SERVER).toContain("validation.code"); // structured code relayed to the client
    const LIB = readFileSync(join(ROOT, "src", "lib", "accountingAttachments.ts"), "utf-8");
    expect(LIB).toContain("attachment_too_large");
    expect(LIB).toContain("attachment_type_not_allowed");
    expect(LIB).toContain("sniffAttachmentMime"); // client MIME is never trusted
  });
  it("stores bytes via the adapter (Firebase/memory) and metadata (only) in Firestore", () => {
    expect(SERVER).toContain("storeAttachmentBytes(");
    // Firestore write is the metadata document, not the bytes.
    expect(SERVER).toContain('setDoc(doc(db, "accountingAttachments"');
    // Strict production without a bucket fails clearly (never fakes persistence).
    expect(SERVER).toContain("attachment_storage_unavailable");
  });
  it("removal is a soft-remove (reason required; metadata preserved)", () => {
    expect(SERVER).toContain("applyAttachmentRemoval(");
    expect(SERVER).not.toContain('app.delete("/api/accounting/attachments');
  });
  it("accountingAttachments has a memory-fallback entry (PR #44 lesson)", () => {
    expect(SERVER).toContain("accountingAttachments: any[];");
    expect(SERVER).toContain("accountingAttachments: [],");
  });
});

describe("PDF document routes — permissions, internal-only, structured errors", () => {
  it("each document type is gated by its print/export permission", () => {
    expect(SERVER).toContain('invoices/:invoiceId/pdf", requirePermission("invoices.print")');
    expect(SERVER).toContain('receipt/pdf", requirePermission("receipts.print")');
    expect(SERVER).toContain('statement/pdf", requirePermission("customerStatements.export")');
    expect(SERVER).toContain('voucher", requirePermission("vendorPayments.printVoucher")');
    expect(SERVER).toContain('/pdf", requirePermission("costStatements.print")');
  });
  it("issued invoice PDF never resolves the live master bank (snapshot only)", () => {
    const block = SERVER.slice(SERVER.indexOf('invoices/:invoiceId/pdf"'), SERVER.indexOf('receipt/pdf"'));
    expect(block).toContain('invoice.status === "draft" && !invoice.bankAccountSnapshot');
  });
  it("PDF failures return a structured pdf_generation_failed code, not a stack trace", () => {
    expect(SERVER).toContain('code: "pdf_generation_failed"');
    expect(SERVER).toContain('code: "document_not_available"');
  });
});
