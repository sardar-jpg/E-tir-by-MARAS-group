import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Increment 5 — server-authoritative invoice lifecycle, atomic + idempotent
 * issue, bank snapshot/validation, and preserved permission enforcement.
 * These pin route contracts that the pure tests cannot observe; the end-to-end
 * behavior is verified separately by the live memory-mode HTTP scenario.
 */
const ROOT = join(__dirname, "..", "..");
const SERVER = readFileSync(join(ROOT, "server.ts"), "utf-8");

describe("issue is atomic + idempotent, with server-side bank resolution", () => {
  it("runs inside a transaction, re-validates draft state, and writes invoice + ledger + idempotency together", () => {
    const issueBlock = SERVER.slice(SERVER.indexOf('invoices/:invoiceId/issue"'), SERVER.indexOf('invoices/:invoiceId/cancel"'));
    expect(issueBlock).toContain("runAccountingTransaction");
    expect(issueBlock).toContain('current.status !== "draft"');
    expect(issueBlock).toContain('tx.set("customerInvoices"');
    expect(issueBlock).toContain('tx.set("invoiceAccountingLedgers"');
    expect(issueBlock).toContain('scopeIdempotencyKey("invoice-issue"');
    // Idempotent replay returns the already-issued invoice, no second number.
    expect(issueBlock).toContain("idempotent: true");
  });
  it("resolves + validates the bank (default-by-currency, active, currency match) with structured errors", () => {
    const issueBlock = SERVER.slice(SERVER.indexOf('invoices/:invoiceId/issue"'), SERVER.indexOf('invoices/:invoiceId/cancel"'));
    expect(issueBlock).toContain("resolveInvoiceBank(");
    expect(issueBlock).toContain("buildBankAccountSnapshot(");
    // The pure resolver emits both structured codes.
    const BANK = readFileSync(join(ROOT, "src", "lib", "bankSnapshot.ts"), "utf-8");
    expect(BANK).toContain('"bank_account_required"');
    expect(BANK).toContain('"bank_currency_mismatch"');
  });
});

describe("payment-derived status is recalculated by the server, never set by the client", () => {
  it("payment create / allocate / reverse restage invoice status from the ledger", () => {
    expect(SERVER).toContain("deriveInvoiceStatus");
    // The helper is invoked in all three ledger-mutating transactions.
    const occurrences = SERVER.split("stageInvoiceStatusUpdates(tx,").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });
  it("allocation candidates include partially_paid invoices (still receivable)", () => {
    expect(SERVER).toContain("isAllocatableInvoiceStatus(i.status)");
  });
});

describe("final pricing model — legacy fields rejected, never dual-read", () => {
  it("rejects the removed pricing mode and legacy fields", () => {
    expect(SERVER).toContain("invalid_pricing_mode");
    expect(SERVER).toContain("legacy_field_rejected");
    expect(SERVER).toContain("computeInvoicePricing(");
    expect(SERVER).not.toContain("computeInvoiceSelling(");
  });
});

describe("cancellation rules", () => {
  it("blocks cancellation while active allocations exist (invoice_has_allocations)", () => {
    expect(SERVER).toContain('code: "invoice_has_allocations"');
    expect(SERVER).toContain("Reverse all invoice allocations before cancellation.");
  });
});

describe("permissions preserved (Increment 4) + correct bank permission split", () => {
  it("issue/cancel/print/editDraft each require their own permission", () => {
    expect(SERVER).toContain('invoices/:invoiceId/issue", requirePermission("invoices.issue")');
    expect(SERVER).toContain('invoices/:invoiceId/cancel", requirePermission("invoices.cancel")');
    expect(SERVER).toContain('invoices/:invoiceId/pdf", requirePermission("invoices.print")');
    expect(SERVER).toContain('invoices/:invoiceId", requirePermission("invoices.editDraft")');
  });
  it("issuing selects an existing bank via loadBankAccounts (bankAccounts.view), NOT bankAccounts.manage", () => {
    const issueBlock = SERVER.slice(SERVER.indexOf('invoices/:invoiceId/issue"'), SERVER.indexOf('invoices/:invoiceId/cancel"'));
    expect(issueBlock).toContain("loadBankAccounts()");
    expect(issueBlock).not.toContain('requirePermission("bankAccounts.manage")');
  });
  it("issued invoices are immutable — only a draft edit route exists, no delete route", () => {
    expect(SERVER).toContain("isInvoiceEditable(existing.status)");
    expect(SERVER).not.toContain('app.delete("/api/cost-statements/:shipmentId/invoices');
  });
});
