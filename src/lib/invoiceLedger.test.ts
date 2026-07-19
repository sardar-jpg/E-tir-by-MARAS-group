import { describe, it, expect } from "vitest";
import {
  invoiceLedgerId, initInvoiceLedgerFromInvoice, buildInvoiceLedger, availableToAllocate,
  applyAllocationDeltas, autoAllocateFromLedgers, type InvoiceAccountingLedger,
} from "./invoiceLedger";
import type { CustomerInvoice, CustomerPayment } from "../types";

const inv = (id: string, amount: number, over: Partial<CustomerInvoice> = {}): CustomerInvoice => ({
  id, invoiceNumber: id, shipmentId: "s", shipmentNumber: "MAR", clientId: "c1", companyName: "Acme", currency: "USD",
  pricingMode: "manual", costBasis: 0, sellingAmount: amount, status: "issued", createdAt: "t", issuedAt: "t", ...over,
});
const pay = (allocs: Array<[string, number]>, status: "active" | "reversed" = "active"): CustomerPayment => ({
  id: "p" + Math.random(), clientId: "c1", companyName: "Acme", amount: 0, currency: "USD", paymentDate: "d",
  paymentMethod: "wire", allocations: allocs.map(([invoiceId, amount]) => ({ invoiceId, invoiceNumber: invoiceId, amount })),
  status, createdBy: "u", createdAt: "t",
});
const ledgerFor = (id: string, invoiced: number, allocated: number, over: Partial<InvoiceAccountingLedger> = {}): InvoiceAccountingLedger =>
  ({ id, invoiceId: id, clientId: "c1", currency: "USD", invoicedAmount: invoiced, allocatedAmount: allocated, status: allocated >= invoiced && invoiced > 0 ? "paid" : "open", revision: 1, updatedAt: "t", ...over });

describe("invoice ledger — init / rebuild / available", () => {
  it("initializes from an invoice (allocated 0)", () => {
    const l = initInvoiceLedgerFromInvoice(inv("I1", 1000), "t");
    expect(l).toMatchObject({ id: invoiceLedgerId("I1"), invoicedAmount: 1000, allocatedAmount: 0, status: "open", clientId: "c1", currency: "USD" });
  });
  it("rebuilds allocatedAmount from active payments, excluding reversed", () => {
    const l = buildInvoiceLedger(inv("I1", 1000), [pay([["I1", 400]]), pay([["I1", 300]]), pay([["I1", 500]], "reversed")], "t");
    expect(l.allocatedAmount).toBe(700); // reversed 500 excluded
    expect(l.status).toBe("open");
  });
  it("available = invoiced − allocated; 0 for cancelled", () => {
    expect(availableToAllocate(ledgerFor("I1", 1000, 600))).toBe(400);
    expect(availableToAllocate(ledgerFor("I1", 1000, 600, { status: "cancelled" }))).toBe(0);
  });
});

describe("applyAllocationDeltas — validation", () => {
  const base = () => new Map<string, InvoiceAccountingLedger>([["I1", ledgerFor("I1", 1000, 200)]]);
  it("rejects over-invoice", () => {
    const r = applyAllocationDeltas({ payerClientId: "c1", currency: "USD", ledgersById: base(), deltas: [{ invoiceId: "I1", delta: 900 }], nowIso: "t" });
    expect(r.ok).toBe(false); expect((r as any).code).toBe("over_invoice");
  });
  it("rejects a different customer", () => {
    const r = applyAllocationDeltas({ payerClientId: "cX", currency: "USD", ledgersById: base(), deltas: [{ invoiceId: "I1", delta: 100 }], nowIso: "t" });
    expect((r as any).code).toBe("customer_mismatch");
  });
  it("rejects a currency mismatch and a cancelled invoice", () => {
    const eur = new Map([["I1", ledgerFor("I1", 1000, 0, { currency: "EUR" })]]);
    expect((applyAllocationDeltas({ payerClientId: "c1", currency: "USD", ledgersById: eur, deltas: [{ invoiceId: "I1", delta: 100 }], nowIso: "t" }) as any).code).toBe("currency_mismatch");
    const cancelled = new Map([["I1", ledgerFor("I1", 1000, 0, { status: "cancelled" })]]);
    expect((applyAllocationDeltas({ payerClientId: "c1", currency: "USD", ledgersById: cancelled, deltas: [{ invoiceId: "I1", delta: 100 }], nowIso: "t" }) as any).code).toBe("invoice_not_billable");
  });
  it("applies a valid add and a valid subtract, bumping revision", () => {
    const add = applyAllocationDeltas({ payerClientId: "c1", currency: "USD", ledgersById: base(), deltas: [{ invoiceId: "I1", delta: 300 }], nowIso: "t2" });
    expect((add as any).ledgers[0].allocatedAmount).toBe(500);
    expect((add as any).ledgers[0].revision).toBe(2);
    const sub = applyAllocationDeltas({ payerClientId: "c1", currency: "USD", ledgersById: base(), deltas: [{ invoiceId: "I1", delta: -200 }], nowIso: "t2" });
    expect((sub as any).ledgers[0].allocatedAmount).toBe(0); // 200 − 200
  });
  it("rejects a subtract that would drive allocated below zero (allocation_conflict)", () => {
    const r = applyAllocationDeltas({ payerClientId: "c1", currency: "USD", ledgersById: base(), deltas: [{ invoiceId: "I1", delta: -1000 }], nowIso: "t2" });
    expect(r.ok).toBe(false); expect((r as any).code).toBe("allocation_conflict");
  });
});

describe("autoAllocateFromLedgers — oldest first, within available", () => {
  it("spreads across invoices and leaves advance credit", () => {
    const candidates = [ledgerFor("I1", 5000, 0), ledgerFor("I2", 3000, 0), ledgerFor("I3", 7000, 0)];
    const r = autoAllocateFromLedgers({ amount: 10000, currency: "USD", payerClientId: "c1", candidates, invoiceNumbers: new Map(), nowIso: "t" });
    expect(r.allocations.map((a) => [a.invoiceId, a.amount])).toEqual([["I1", 5000], ["I2", 3000], ["I3", 2000]]);
    expect(r.unallocated).toBe(0);
    expect(r.ledgers.find((l) => l.id === "I3")!.allocatedAmount).toBe(2000);
  });
  it("overpayment leaves unallocated credit", () => {
    const r = autoAllocateFromLedgers({ amount: 8000, currency: "USD", payerClientId: "c1", candidates: [ledgerFor("I1", 5000, 0)], invoiceNumbers: new Map(), nowIso: "t" });
    expect(r.unallocated).toBe(3000);
  });
});

describe("invoice ledger concurrency — Firestore-tx model (no over-allocation)", () => {
  it("two concurrent full payments to one invoice: one commits, one is rejected", () => {
    let ledger = ledgerFor("I1", 1000, 0);
    const attempt = (amount: number) => {
      const m = new Map([["I1", ledger]]);
      const r = applyAllocationDeltas({ payerClientId: "c1", currency: "USD", ledgersById: m, deltas: [{ invoiceId: "I1", delta: amount }], nowIso: "t" });
      if (!r.ok) return { ok: false, code: r.code };
      ledger = r.ledgers[0]; // serialized commit
      return { ok: true };
    };
    const a = attempt(1000);
    const b = attempt(1000); // re-reads committed allocated=1000 → over_invoice
    expect([a.ok, b.ok].filter(Boolean).length).toBe(1);
    expect(ledger.allocatedAmount).toBe(1000); // never 2000
  });
});
