import { describe, it, expect } from "vitest";
import { deriveInvoiceStatus, initInvoiceLedgerFromInvoice, applyAllocationDeltas } from "./invoiceLedger";
import { buildInvoicePdfModel } from "./accountingPdfModel";
import { buildBankAccountSnapshot } from "./bankSnapshot";
import type { BankAccount, CustomerInvoice } from "../types";

/**
 * Increment 5 — payment-derived invoice status (server-authoritative) and
 * issue-time bank-snapshot immutability, exercised through the same pure
 * functions the server transactions call.
 */

const invoice = (over: Partial<CustomerInvoice> = {}): CustomerInvoice => ({
  id: "i1", invoiceNumber: "MAR-2026-1001", shipmentId: "s1", shipmentNumber: "MAR-2026-1001",
  clientId: "c1", companyName: "Acme", currency: "USD", pricingMode: "manual", costBasis: 600,
  manualAmount: 1000, sellingAmount: 1000, status: "issued", createdAt: "t", issuedAt: "t2", ...over,
});

describe("deriveInvoiceStatus — server recalculates from the ledger only", () => {
  it("zero allocation → issued", () => {
    expect(deriveInvoiceStatus("issued", 1000, 0)).toBe("issued");
  });
  it("partial allocation → partially_paid", () => {
    expect(deriveInvoiceStatus("issued", 1000, 400)).toBe("partially_paid");
    expect(deriveInvoiceStatus("partially_paid", 1000, 400)).toBe("partially_paid");
  });
  it("full allocation → paid", () => {
    expect(deriveInvoiceStatus("issued", 1000, 1000)).toBe("paid");
    expect(deriveInvoiceStatus("partially_paid", 1000, 1000)).toBe("paid");
  });
  it("reversal recalculates downward: paid → partially_paid → issued", () => {
    expect(deriveInvoiceStatus("paid", 1000, 400)).toBe("partially_paid");
    expect(deriveInvoiceStatus("partially_paid", 1000, 0)).toBe("issued");
  });
  it("a cancelled invoice never changes from a ledger recalculation", () => {
    expect(deriveInvoiceStatus("cancelled", 1000, 0)).toBe("cancelled");
    expect(deriveInvoiceStatus("cancelled", 1000, 500)).toBe("cancelled");
    expect(deriveInvoiceStatus("cancelled", 1000, 1000)).toBe("cancelled");
  });
  it("a draft never becomes a payment-derived status", () => {
    expect(deriveInvoiceStatus("draft", 1000, 500)).toBe("draft");
  });
});

describe("end-to-end status recalculation over a ledger allocate/reverse cycle", () => {
  it("issued → partial → paid → (reverse) partial → (reverse) issued", () => {
    const inv = invoice();
    const now = "t";
    let ledger = initInvoiceLedgerFromInvoice(inv, now); // allocated 0
    expect(deriveInvoiceStatus(inv.status, ledger.invoicedAmount, ledger.allocatedAmount)).toBe("issued");

    // Allocate 400 → partially_paid.
    let ledgers = new Map([[inv.id, ledger]]);
    let r = applyAllocationDeltas({ payerClientId: "c1", currency: "USD", ledgersById: ledgers, deltas: [{ invoiceId: inv.id, delta: 400 }], nowIso: now });
    expect(r.ok).toBe(true);
    if (r.ok) ledger = r.ledgers[0];
    expect(deriveInvoiceStatus("issued", ledger.invoicedAmount, ledger.allocatedAmount)).toBe("partially_paid");

    // Allocate remaining 600 → paid.
    ledgers = new Map([[inv.id, ledger]]);
    r = applyAllocationDeltas({ payerClientId: "c1", currency: "USD", ledgersById: ledgers, deltas: [{ invoiceId: inv.id, delta: 600 }], nowIso: now });
    if (r.ok) ledger = r.ledgers[0];
    expect(deriveInvoiceStatus("partially_paid", ledger.invoicedAmount, ledger.allocatedAmount)).toBe("paid");

    // Reverse 600 → partially_paid.
    ledgers = new Map([[inv.id, ledger]]);
    r = applyAllocationDeltas({ payerClientId: "c1", currency: "USD", ledgersById: ledgers, deltas: [{ invoiceId: inv.id, delta: -600 }], nowIso: now });
    if (r.ok) ledger = r.ledgers[0];
    expect(deriveInvoiceStatus("paid", ledger.invoicedAmount, ledger.allocatedAmount)).toBe("partially_paid");

    // Reverse 400 → issued.
    ledgers = new Map([[inv.id, ledger]]);
    r = applyAllocationDeltas({ payerClientId: "c1", currency: "USD", ledgersById: ledgers, deltas: [{ invoiceId: inv.id, delta: -400 }], nowIso: now });
    if (r.ok) ledger = r.ledgers[0];
    expect(deriveInvoiceStatus("partially_paid", ledger.invoicedAmount, ledger.allocatedAmount)).toBe("issued");
  });
});

describe("issued invoices render from the immutable bank snapshot, not the master", () => {
  const master: BankAccount = {
    id: "b1", bankName: "Original Bank", accountHolderName: "MARAS", accountNumber: "AAA-111",
    swift: "ORIGSWFT", currency: "USD", active: true, isDefaultForCurrency: true, createdAt: "t",
  };
  it("the PDF model uses invoice.bankAccountSnapshot even if a different live bank is passed", () => {
    const snapshot = buildBankAccountSnapshot(master);
    const inv = invoice({ bankAccountSnapshot: snapshot });
    // Simulate the master being later edited to a completely different account.
    const editedMaster: BankAccount = { ...master, accountNumber: "ZZZ-999", bankName: "Renamed Bank", active: false };
    const model = buildInvoicePdfModel({ invoice: inv, company: null, bank: editedMaster, language: "en", nowIso: "t" });
    expect(model.bank?.accountNumber).toBe("AAA-111"); // from the snapshot, NOT the edited master
    expect(model.bank?.bankName).toBe("Original Bank");
  });
  it("a draft with no snapshot may preview the current master bank", () => {
    const inv = invoice({ status: "draft", bankAccountSnapshot: undefined });
    const model = buildInvoicePdfModel({ invoice: inv, company: null, bank: master, language: "en", nowIso: "t" });
    expect(model.bank?.accountNumber).toBe("AAA-111");
  });
});

describe("cost-plus internal cost + markup never reach the customer PDF", () => {
  it("only the selling total appears; cost base and markup are absent", () => {
    const inv = invoice({ pricingMode: "cost_plus", costBasis: 800, costBaseAmount: 800, markupType: "fixed", markupValue: 200, markupAmount: 200, sellingAmount: 1000, grossProfit: 200, manualAmount: undefined });
    const model = buildInvoicePdfModel({ invoice: inv, company: null, bank: null, language: "en", nowIso: "t" });
    const json = JSON.stringify(model);
    expect(model.totals?.[0].value).toContain("1,000.00");
    expect(json).not.toContain("800"); // costBaseAmount / costBasis
    expect(json).not.toContain("markup");
  });
});
