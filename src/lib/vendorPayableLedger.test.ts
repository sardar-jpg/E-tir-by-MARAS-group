import { describe, it, expect } from "vitest";
import {
  vendorLedgerId, buildVendorLedger, decideVendorPayment, applyVendorLedgerDelta,
  reconcileVendorLedger, vendorLedgerStatus, type VendorPayableLedger,
} from "./vendorPayableLedger";
import type { VendorPaymentTransaction, CostItem } from "../types";

const item: Pick<CostItem, "id" | "totalAmount" | "currency"> = { id: "ci1", totalAmount: 1000, currency: "USD" };
const vp = (amount: number, status: "active" | "reversed" = "active"): VendorPaymentTransaction => ({
  id: "v" + Math.random(), shipmentId: "s1", shipmentNumber: "MAR", costStatementId: "s1", costItemId: "ci1",
  vendorName: "V", amount, currency: "USD", paymentDate: "d", paymentMethod: "wire", createdBy: "u", createdAt: "t", status,
});

describe("vendor payable ledger — build/status/decide/apply", () => {
  it("rebuilds from source, excluding reversed payments", () => {
    const l = buildVendorLedger({ shipmentId: "s1", item, payments: [vp(400), vp(300), vp(500, "reversed")], nowIso: "t" });
    expect(l.id).toBe(vendorLedgerId("s1", "ci1"));
    expect(l.paidAmount).toBe(700); // reversed 500 excluded
    expect(l.costAmount).toBe(1000);
    expect(l.status).toBe("partial");
  });
  it("status transitions unpaid → partial → paid → overpaid", () => {
    expect(vendorLedgerStatus(1000, 0)).toBe("unpaid");
    expect(vendorLedgerStatus(1000, 400)).toBe("partial");
    expect(vendorLedgerStatus(1000, 1000)).toBe("paid");
    expect(vendorLedgerStatus(1000, 1200)).toBe("overpaid");
  });
  it("rejects overpay, currency mismatch, and non-positive amounts", () => {
    const ledger = buildVendorLedger({ shipmentId: "s1", item, payments: [vp(700)], nowIso: "t" });
    expect(decideVendorPayment({ ledger, amount: 400, currency: "USD", allowOverpayment: false }).ok).toBe(false); // 700+400 > 1000
    expect(decideVendorPayment({ ledger, amount: 300, currency: "USD", allowOverpayment: false }).ok).toBe(true); // exactly 1000
    expect((decideVendorPayment({ ledger, amount: 100, currency: "EUR", allowOverpayment: false }) as any).code).toBe("currency_mismatch");
    expect((decideVendorPayment({ ledger, amount: 0, currency: "USD", allowOverpayment: false }) as any).code).toBe("invalid_amount");
    expect(decideVendorPayment({ ledger, amount: 400, currency: "USD", allowOverpayment: true }).ok).toBe(true); // authorized overpay
  });
  it("applies create (+) and reverse (−) deltas, bumping revision, never below 0", () => {
    let l = buildVendorLedger({ shipmentId: "s1", item, payments: [], nowIso: "t" });
    l = applyVendorLedgerDelta(l, 400, "t2");
    expect(l.paidAmount).toBe(400); expect(l.revision).toBe(2); expect(l.status).toBe("partial");
    l = applyVendorLedgerDelta(l, -400, "t3");
    expect(l.paidAmount).toBe(0); expect(l.status).toBe("unpaid");
    l = applyVendorLedgerDelta(l, -100, "t4"); // never negative
    expect(l.paidAmount).toBe(0);
  });
  it("reconciles a stored ledger against source", () => {
    const expected = buildVendorLedger({ shipmentId: "s1", item, payments: [vp(700)], nowIso: "t" });
    expect(reconcileVendorLedger(expected, expected)).toBe(true);
    const corrupt: VendorPayableLedger = { ...expected, paidAmount: 999 };
    expect(reconcileVendorLedger(corrupt, expected)).toBe(false);
    expect(reconcileVendorLedger(null, expected)).toBe(false);
  });
});

describe("vendor ledger concurrency — Firestore-tx model (two payments cannot overpay)", () => {
  // Model the runAccountingTransaction critical section: read ledger →
  // decide → write ledger. Firestore serializes commits + retries on the
  // ledger doc, so the loser re-reads the winner's paidAmount.
  it("two concurrent full payments: one commits, the other is rejected by the ledger", () => {
    let ledger = buildVendorLedger({ shipmentId: "s1", item, payments: [], nowIso: "t" });
    const attempt = (amount: number) => {
      const d = decideVendorPayment({ ledger, amount, currency: "USD", allowOverpayment: false });
      if (!d.ok) return { ok: false, code: d.code };
      ledger = applyVendorLedgerDelta(ledger, amount, "t"); // serialized commit
      return { ok: true };
    };
    const a = attempt(1000);
    const b = attempt(1000); // re-reads committed paidAmount=1000 → overpay
    expect([a.ok, b.ok].filter(Boolean).length).toBe(1);
    expect(ledger.paidAmount).toBe(1000); // never 2000
    expect(ledger.status).toBe("paid");
  });
});
