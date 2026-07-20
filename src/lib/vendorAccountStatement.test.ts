import { describe, it, expect } from "vitest";
import { buildVendorAccountStatement, vendorStatementCurrencies, type VendorBill } from "./vendorAccountStatement";

const bill = (over: Partial<VendorBill> = {}): VendorBill => ({
  shipmentNumber: "MAR-2026-001", date: "2026-06-05", description: "Ocean freight", amount: 2000, currency: "USD", ...over,
});
const pay = (over: any = {}): any => ({
  id: "p1", shipmentId: "s1", shipmentNumber: "MAR-2026-001", costStatementId: "s1", costItemId: "c1",
  vendorName: "TransLog Shipping", amount: 500, currency: "USD", paymentDate: "2026-06-10", paymentMethod: "Bank Transfer", status: "active", ...over,
});

describe("buildVendorAccountStatement — running-balance payable ledger", () => {
  it("bills are debits, payments are credits, balance runs correctly", () => {
    const st = buildVendorAccountStatement({
      vendorName: "TransLog Shipping", currency: "USD",
      bills: [bill({ amount: 2000, date: "2026-06-05" }), bill({ amount: 1000, date: "2026-06-08", shipmentNumber: "MAR-2026-002" })],
      payments: [pay({ amount: 500, paymentDate: "2026-06-10" })],
    });
    expect(st.rows).toHaveLength(3);
    expect(st.rows[0]).toMatchObject({ type: "bill", debit: 2000, credit: 0, balance: 2000 });
    expect(st.rows[1]).toMatchObject({ type: "bill", debit: 1000, balance: 3000 });
    expect(st.rows[2]).toMatchObject({ type: "payment", credit: 500, balance: 2500 });
    expect(st.totalDebit).toBe(3000);
    expect(st.totalCredit).toBe(500);
    expect(st.closingBalance).toBe(2500);
  });

  it("same-day ordering puts bills before payments", () => {
    const st = buildVendorAccountStatement({
      vendorName: "V", currency: "USD",
      bills: [bill({ amount: 300, date: "2026-06-05" })],
      payments: [pay({ amount: 100, paymentDate: "2026-06-05" })],
    });
    expect(st.rows.map((r) => r.type)).toEqual(["bill", "payment"]);
  });

  it("filters by currency (never mixes)", () => {
    const st = buildVendorAccountStatement({
      vendorName: "V", currency: "USD",
      bills: [bill({ amount: 2000, currency: "USD" }), bill({ amount: 9999, currency: "EUR" })],
      payments: [pay({ amount: 500, currency: "USD" }), pay({ amount: 7777, currency: "EUR" })],
    });
    expect(st.totalDebit).toBe(2000);
    expect(st.totalCredit).toBe(500);
  });

  it("ignores reversed payments", () => {
    const st = buildVendorAccountStatement({
      vendorName: "V", currency: "USD",
      bills: [bill({ amount: 1000 })],
      payments: [pay({ amount: 400, status: "active" }), pay({ id: "p2", amount: 999, status: "reversed" })],
    });
    expect(st.totalCredit).toBe(400);
    expect(st.closingBalance).toBe(600);
  });

  it("opening balance captures everything strictly before `from`", () => {
    const st = buildVendorAccountStatement({
      vendorName: "V", currency: "USD",
      bills: [bill({ amount: 2000, date: "2026-05-01" }), bill({ amount: 500, date: "2026-06-05" })],
      payments: [pay({ amount: 800, paymentDate: "2026-05-15" })],
      from: "2026-06-01", to: "2026-06-30",
    });
    // opening = 2000 - 800 = 1200 (before June); window adds one 500 bill.
    expect(st.openingBalance).toBe(1200);
    expect(st.rows).toHaveLength(1);
    expect(st.closingBalance).toBe(1700);
  });

  it("vendorStatementCurrencies lists distinct currencies", () => {
    expect(vendorStatementCurrencies([bill({ currency: "USD" }), bill({ currency: "EUR" })], [pay({ currency: "USD" }), pay({ currency: "IQD" })]).sort())
      .toEqual(["EUR", "IQD", "USD"]);
  });
});
