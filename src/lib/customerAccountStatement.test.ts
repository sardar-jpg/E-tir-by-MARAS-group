import { describe, it, expect } from "vitest";
import { buildCustomerAccountStatement, customerStatementCurrencies } from "./customerAccountStatement";
import type { CustomerInvoice, CustomerPayment } from "../types";

const inv = (id: string, amount: number, issuedAt: string, over: Partial<CustomerInvoice> = {}): CustomerInvoice => ({
  id, invoiceNumber: id, shipmentId: "s", shipmentNumber: "MAR", companyName: "Acme", currency: "USD",
  pricingMode: "manual", costBasis: 0, sellingAmount: amount, status: "issued", createdAt: issuedAt, issuedAt, ...over,
});
const pay = (id: string, amount: number, paymentDate: string, over: Partial<CustomerPayment> = {}): CustomerPayment => ({
  id, companyName: "Acme", amount, currency: "USD", paymentDate, paymentMethod: "wire", allocations: [],
  status: "active", createdBy: "u", createdAt: paymentDate, ...over,
});

describe("customer account statement (per-currency ledger)", () => {
  const invoices = [inv("MAR-1", 5000, "2026-03-05"), inv("MAR-2", 3000, "2026-03-20")];
  const payments = [pay("P1", 4000, "2026-03-10")];

  it("builds opening, running, and closing balances (customer owes = positive)", () => {
    const s = buildCustomerAccountStatement({ companyName: "Acme", currency: "USD", invoices, payments, from: "2026-03-01", to: "2026-03-31" });
    expect(s.openingBalance).toBe(0);
    expect(s.rows.map((r) => [r.ref, r.debit, r.credit, r.balance])).toEqual([
      ["MAR-1", 5000, 0, 5000],
      ["P1", 0, 4000, 1000],
      ["MAR-2", 3000, 0, 4000],
    ]);
    expect(s.totalDebit).toBe(8000);
    expect(s.totalCredit).toBe(4000);
    expect(s.closingBalance).toBe(4000);
  });

  it("computes opening balance from activity before the window", () => {
    const s = buildCustomerAccountStatement({ companyName: "Acme", currency: "USD", invoices, payments, from: "2026-03-15", to: "2026-03-31" });
    // Before 2026-03-15: MAR-1 (5000) − P1 (4000) = 1000 opening.
    expect(s.openingBalance).toBe(1000);
    expect(s.rows.map((r) => r.ref)).toEqual(["MAR-2"]);
    expect(s.closingBalance).toBe(4000);
  });

  it("never mixes currencies", () => {
    const mixed = [...invoices, inv("EUR-1", 999, "2026-03-06", { currency: "EUR" })];
    const s = buildCustomerAccountStatement({ companyName: "Acme", currency: "USD", invoices: mixed, payments, from: "", to: "" });
    expect(s.rows.some((r) => r.ref === "EUR-1")).toBe(false);
    expect(s.closingBalance).toBe(4000);
  });

  it("excludes cancelled invoices and reversed payments", () => {
    const s = buildCustomerAccountStatement({
      companyName: "Acme", currency: "USD",
      invoices: [...invoices, inv("MAR-3", 9999, "2026-03-25", { status: "cancelled" })],
      payments: [...payments, pay("P2", 1234, "2026-03-28", { status: "reversed" })],
      from: "2026-03-01", to: "2026-03-31",
    });
    expect(s.closingBalance).toBe(4000);
    expect(s.rows.some((r) => r.ref === "MAR-3" || r.ref === "P2")).toBe(false);
  });

  it("lists distinct activity currencies", () => {
    const cur = customerStatementCurrencies([inv("U", 1, "2026-01-01"), inv("E", 1, "2026-01-01", { currency: "EUR" })], []);
    expect(cur).toEqual(["EUR", "USD"]);
  });
});
