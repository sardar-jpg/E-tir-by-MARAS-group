import { describe, it, expect } from "vitest";
import {
  computeInvoiceSelling,
  computeInvoiceGrossProfit,
  isInvoiceEditable,
  canIssueInvoice,
  canCancelInvoice,
  buildCustomerInvoiceView,
  buildInvoiceNumber,
} from "./customerInvoice";
import type { CustomerInvoice } from "../types";

describe("invoice selling computation (server-authoritative)", () => {
  it("contract uses the contract amount", () => {
    expect(computeInvoiceSelling("contract", { costBasis: 300, contractAmount: 500 })).toEqual({ ok: true, sellingAmount: 500 });
    expect(computeInvoiceSelling("contract", { costBasis: 300 }).ok).toBe(false);
  });
  it("fixed profit adds to cost", () => {
    expect(computeInvoiceSelling("fixed_profit", { costBasis: 300, fixedProfit: 200 })).toEqual({ ok: true, sellingAmount: 500 });
    expect(computeInvoiceSelling("fixed_profit", { costBasis: 300 }).ok).toBe(false);
  });
  it("percentage margin marks up the cost", () => {
    expect(computeInvoiceSelling("percentage_margin", { costBasis: 400, marginPercent: 25 })).toEqual({ ok: true, sellingAmount: 500 });
  });
  it("per-unit modes multiply price × quantity and require both", () => {
    expect(computeInvoiceSelling("per_truck", { costBasis: 0, unitPrice: 250, unitQuantity: 2 })).toEqual({ ok: true, sellingAmount: 500 });
    expect(computeInvoiceSelling("per_container", { costBasis: 0, unitPrice: 100, unitQuantity: 5 })).toEqual({ ok: true, sellingAmount: 500 });
    expect(computeInvoiceSelling("per_service", { costBasis: 0, unitPrice: 500, unitQuantity: 1 })).toEqual({ ok: true, sellingAmount: 500 });
    expect(computeInvoiceSelling("per_truck", { costBasis: 0, unitPrice: 250, unitQuantity: 0 }).ok).toBe(false);
    expect(computeInvoiceSelling("per_truck", { costBasis: 0, unitQuantity: 2 }).ok).toBe(false);
  });
  it("manual uses the manual amount", () => {
    expect(computeInvoiceSelling("manual", { costBasis: 0, manualAmount: 500 })).toEqual({ ok: true, sellingAmount: 500 });
    expect(computeInvoiceSelling("manual", { costBasis: 0 }).ok).toBe(false);
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
    expect(isInvoiceEditable("cancelled")).toBe(false);
  });
  it("issuing requires draft + positive amount; cost-based pricing needs a closed cost statement", () => {
    expect(canIssueInvoice({ status: "draft", pricingMode: "manual", costStatementStatus: "draft", sellingAmount: 500 }).ok).toBe(true);
    expect(canIssueInvoice({ status: "draft", pricingMode: "contract", costStatementStatus: undefined, sellingAmount: 500 }).ok).toBe(true);
    // fixed_profit needs final_closed cost.
    const blocked = canIssueInvoice({ status: "draft", pricingMode: "fixed_profit", costStatementStatus: "pending_operations_approval", sellingAmount: 500 });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("cost_not_approved");
    expect(canIssueInvoice({ status: "draft", pricingMode: "fixed_profit", costStatementStatus: "final_closed", sellingAmount: 500 }).ok).toBe(true);
    // zero amount + non-draft rejected.
    expect(canIssueInvoice({ status: "draft", pricingMode: "manual", costStatementStatus: undefined, sellingAmount: 0 }).ok).toBe(false);
    expect(canIssueInvoice({ status: "issued", pricingMode: "manual", costStatementStatus: undefined, sellingAmount: 500 }).ok).toBe(false);
  });
  it("cancel requires an issued invoice + reason", () => {
    expect(canCancelInvoice("issued", "duplicate").ok).toBe(true);
    expect(canCancelInvoice("issued", "  ").ok).toBe(false);
    expect(canCancelInvoice("draft", "x").ok).toBe(false);
  });
});

describe("customer projection strips internal fields", () => {
  it("never exposes cost basis, gross profit, internal notes, or pricing inputs", () => {
    const inv: CustomerInvoice = {
      id: "i1", invoiceNumber: "MAR-2026-1001", shipmentId: "s1", shipmentNumber: "MAR-2026-1001",
      companyName: "Acme", currency: "USD", pricingMode: "fixed_profit", costBasis: 300, fixedProfit: 200,
      sellingAmount: 500, grossProfit: 200, description: "Freight", notes: "Thanks", internalNotes: "margin ok",
      status: "issued", createdAt: "t", issuedAt: "t2",
    };
    const view = buildCustomerInvoiceView(inv);
    const json = JSON.stringify(view);
    expect(view.amount).toBe(500);
    expect(view.invoiceNumber).toBe("MAR-2026-1001");
    expect(json).not.toContain("300"); // costBasis
    expect(json).not.toContain("margin ok"); // internalNotes
    expect((view as any).costBasis).toBeUndefined();
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
