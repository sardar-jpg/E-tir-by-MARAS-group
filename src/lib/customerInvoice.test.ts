import { describe, it, expect } from "vitest";
import {
  computeInvoicePricing,
  computeInvoiceGrossProfit,
  isInvoiceEditable,
  isReceivableInvoiceStatus,
  isActiveInvoiceStatus,
  hasActiveCustomerInvoice,
  isAllocatableInvoiceStatus,
  canIssueInvoice,
  canCancelInvoice,
  buildCustomerInvoiceView,
  buildInvoiceNumber,
  isInvoicePricingMode,
  INVOICE_PRICING_MODES,
} from "./customerInvoice";
import type { CustomerInvoice } from "../types";

describe("final pricing model — manual | cost_plus (server-authoritative)", () => {
  it("exposes exactly the two final modes", () => {
    expect([...INVOICE_PRICING_MODES]).toEqual(["manual", "cost_plus"]);
    expect(isInvoicePricingMode("manual")).toBe(true);
    expect(isInvoicePricingMode("cost_plus")).toBe(true);
    expect(isInvoicePricingMode("percentage_margin")).toBe(false);
    expect(isInvoicePricingMode("fixed_profit")).toBe(false);
    expect(isInvoicePricingMode("contract")).toBe(false);
  });

  it("manual uses the manual amount only (no markup, no cost exposure)", () => {
    const r = computeInvoicePricing("manual", { manualAmount: 500 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.pricing).toEqual({ costBaseAmount: 0, markupAmount: 0, sellingAmount: 500 });
    expect(computeInvoicePricing("manual", {}).ok).toBe(false);
    expect(computeInvoicePricing("manual", { manualAmount: -1 }).ok).toBe(false);
  });

  it("cost_plus percentage markup: markupAmount = base × value / 100", () => {
    const r = computeInvoicePricing("cost_plus", { costBaseAmount: 400, markupType: "percentage", markupValue: 25 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pricing.markupAmount).toBe(100);
      expect(r.pricing.sellingAmount).toBe(500);
      expect(r.pricing.markupType).toBe("percentage");
    }
  });

  it("cost_plus fixed markup: markupAmount = value", () => {
    const r = computeInvoicePricing("cost_plus", { costBaseAmount: 800, markupType: "fixed", markupValue: 200 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pricing.markupAmount).toBe(200);
      expect(r.pricing.sellingAmount).toBe(1000);
      expect(r.pricing.markupType).toBe("fixed");
    }
  });

  it("cost_plus requires a valid base, markup type and value", () => {
    expect(computeInvoicePricing("cost_plus", { markupType: "percentage", markupValue: 10 }).ok).toBe(false); // no base
    expect(computeInvoicePricing("cost_plus", { costBaseAmount: 100, markupValue: 10 } as any).ok).toBe(false); // no type
    expect(computeInvoicePricing("cost_plus", { costBaseAmount: 100, markupType: "percentage" }).ok).toBe(false); // no value
  });

  it("rejects any removed/unknown pricing mode", () => {
    expect(computeInvoicePricing("percentage_margin" as any, {}).ok).toBe(false);
    expect(computeInvoicePricing("contract" as any, {}).ok).toBe(false);
  });
});

describe("gross profit is currency-safe and private", () => {
  it("computes when currencies match, null when they differ", () => {
    expect(computeInvoiceGrossProfit({ sellingAmount: 500, costBasis: 300, invoiceCurrency: "USD", costCurrency: "USD" })).toBe(200);
    expect(computeInvoiceGrossProfit({ sellingAmount: 500, costBasis: 300, invoiceCurrency: "USD", costCurrency: "EUR" })).toBeNull();
  });
});

describe("lifecycle guards", () => {
  it("only drafts are editable", () => {
    expect(isInvoiceEditable("draft")).toBe(true);
    expect(isInvoiceEditable("issued")).toBe(false);
    expect(isInvoiceEditable("partially_paid")).toBe(false);
    expect(isInvoiceEditable("paid")).toBe(false);
    expect(isInvoiceEditable("cancelled")).toBe(false);
  });
  it("receivable + allocatable status helpers", () => {
    expect(["issued", "partially_paid", "paid"].every(isReceivableInvoiceStatus as any)).toBe(true);
    expect(isReceivableInvoiceStatus("draft")).toBe(false);
    expect(isReceivableInvoiceStatus("cancelled")).toBe(false);
    expect(isAllocatableInvoiceStatus("issued")).toBe(true);
    expect(isAllocatableInvoiceStatus("partially_paid")).toBe(true);
    expect(isAllocatableInvoiceStatus("paid")).toBe(false);
  });

  it("Phase 3 active-invoice lock: issued/partially_paid/paid lock; draft/cancelled never do", () => {
    for (const s of ["issued", "partially_paid", "paid"] as const) expect(isActiveInvoiceStatus(s)).toBe(true);
    expect(isActiveInvoiceStatus("draft")).toBe(false);
    expect(isActiveInvoiceStatus("cancelled")).toBe(false);
    // hasActiveCustomerInvoice across a related set (multiple invoices allowed).
    expect(hasActiveCustomerInvoice([{ status: "draft" }, { status: "cancelled" }])).toBe(false);
    expect(hasActiveCustomerInvoice([{ status: "cancelled" }, { status: "issued" }])).toBe(true);
    expect(hasActiveCustomerInvoice([{ status: "partially_paid" }])).toBe(true);
    expect(hasActiveCustomerInvoice([])).toBe(false);
  });
  it("issuing requires draft + positive amount + an APPROVED (final_closed) cost statement (Phase 3, all modes)", () => {
    // Phase 3: an invoice may be issued ONLY after the cost statement is
    // approved and closed — for manual AND cost_plus. A draft/pending/reopened
    // statement blocks issuance (so a new invoice can only follow re-approval).
    const manualUnapproved = canIssueInvoice({ status: "draft", pricingMode: "manual", costStatementStatus: "draft", sellingAmount: 500 });
    expect(manualUnapproved.ok).toBe(false);
    if (!manualUnapproved.ok) expect(manualUnapproved.code).toBe("cost_not_approved");
    // Reopened (editing) also blocks issuance until the new normal chain closes.
    expect(canIssueInvoice({ status: "draft", pricingMode: "manual", costStatementStatus: "reopened", sellingAmount: 500 }).ok).toBe(false);
    const blocked = canIssueInvoice({ status: "draft", pricingMode: "cost_plus", costStatementStatus: "pending_operations_approval", sellingAmount: 500 });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("cost_not_approved");
    // Approved → issuable, in both modes.
    expect(canIssueInvoice({ status: "draft", pricingMode: "cost_plus", costStatementStatus: "final_closed", sellingAmount: 500 }).ok).toBe(true);
    expect(canIssueInvoice({ status: "draft", pricingMode: "manual", costStatementStatus: "final_closed", sellingAmount: 500 }).ok).toBe(true);
    // Zero amount and non-draft invoice still rejected.
    expect(canIssueInvoice({ status: "draft", pricingMode: "manual", costStatementStatus: "final_closed", sellingAmount: 0 }).ok).toBe(false);
    expect(canIssueInvoice({ status: "issued", pricingMode: "manual", costStatementStatus: "final_closed", sellingAmount: 500 }).ok).toBe(false);
  });
  it("cancel requires an issued-and-live invoice + reason (draft/cancelled rejected)", () => {
    expect(canCancelInvoice("issued", "duplicate").ok).toBe(true);
    expect(canCancelInvoice("partially_paid", "correction").ok).toBe(true);
    expect(canCancelInvoice("paid", "correction").ok).toBe(true);
    expect(canCancelInvoice("issued", "  ").ok).toBe(false); // reason required
    expect(canCancelInvoice("draft", "x").ok).toBe(false);
    expect(canCancelInvoice("cancelled", "x").ok).toBe(false);
  });
});

describe("customer projection strips internal fields", () => {
  it("never exposes cost basis, cost-plus markup, gross profit, internal notes", () => {
    const inv: CustomerInvoice = {
      id: "i1", invoiceNumber: "MAR-2026-1001", shipmentId: "s1", shipmentNumber: "MAR-2026-1001",
      companyName: "Acme", currency: "USD", pricingMode: "cost_plus", costBasis: 300, costBaseAmount: 300,
      markupType: "fixed", markupValue: 200, markupAmount: 200,
      sellingAmount: 500, grossProfit: 200, description: "Freight", notes: "Thanks", internalNotes: "margin ok",
      status: "issued", createdAt: "t", issuedAt: "t2",
    };
    const view = buildCustomerInvoiceView(inv);
    const json = JSON.stringify(view);
    expect(view.amount).toBe(500);
    expect(view.invoiceNumber).toBe("MAR-2026-1001");
    expect(json).not.toContain("300"); // costBasis / costBaseAmount
    expect(json).not.toContain("margin ok"); // internalNotes
    expect((view as any).costBasis).toBeUndefined();
    expect((view as any).costBaseAmount).toBeUndefined();
    expect((view as any).markupAmount).toBeUndefined();
    expect((view as any).grossProfit).toBeUndefined();
    expect((view as any).internalNotes).toBeUndefined();
    expect(view.notes).toBe("Thanks");
  });
});

describe("invoice number derives from MAR (no second numbering system)", () => {
  it("first invoice = MAR number, subsequent = MAR/n", () => {
    expect(buildInvoiceNumber("MAR-2026-1001", 1)).toBe("MAR-2026-1001");
    expect(buildInvoiceNumber("MAR-2026-1001", 2)).toBe("MAR-2026-1001/2");
  });
});
