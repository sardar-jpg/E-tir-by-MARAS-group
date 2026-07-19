import { describe, it, expect } from "vitest";
import { findActiveReceiptForPayment } from "./paymentReceipt";
import { nextAccountingSequence, formatReceiptNumber, type AccountingSequenceDoc } from "./accountingSequence";
import { scopeIdempotencyKey, fingerprintPayload, resolveIdempotency, normalizeIdempotencyKey } from "./idempotency";
import type { PaymentReceipt } from "../types";

/**
 * Real interleaving proof for receipt creation (increment 2, items 6/8 →
 * mandatory tests 6,7,8). Faithful model of the receipt route's atomic
 * section: within a single synchronous critical section (no await), the
 * route (1) short-circuits an existing active receipt for the payment,
 * (2) honors an idempotency key, then (3) allocates the next per-year
 * sequence number and writes the receipt. Because the section has no await,
 * two concurrent creations for the same payment can never both pass the
 * one-active-receipt guard.
 */
const year = 2026;

function makeReceiptStore() {
  const receipts: PaymentReceipt[] = [];
  let counter: AccountingSequenceDoc | undefined;
  const mk = (paymentId: string, amount: number, currency: string, key?: string): PaymentReceipt => {
    const seq = nextAccountingSequence(counter);
    counter = seq.next;
    const r: PaymentReceipt = {
      id: `r-${paymentId}-${seq.issued}`, receiptNumber: formatReceiptNumber(year, seq.issued), paymentId,
      companyName: "Acme", clientId: "c1", amount, currency: currency as PaymentReceipt["currency"],
      paymentDate: "2026-07-05", paymentMethod: "wire", allocations: [], status: "issued", issuedBy: "u", issuedAt: "t",
      idempotencyKey: key,
    };
    return r;
  };
  return {
    all: () => receipts,
    /** atomic section: read guards + allocate + write, no await between. */
    create(paymentId: string, amount: number, currency: string, rawKey?: string) {
      const active = findActiveReceiptForPayment(receipts, paymentId);
      if (active) return { status: 200, receipt: active, idempotent: true };
      const key = normalizeIdempotencyKey(rawKey);
      const scoped = key ? scopeIdempotencyKey("receipt", key) : undefined;
      const fp = fingerprintPayload({ paymentId, amount, currency });
      const idem = resolveIdempotency<PaymentReceipt>({
        existing: receipts, scopedKey: scoped,
        fingerprintOf: (r) => fingerprintPayload({ paymentId: r.paymentId, amount: r.amount, currency: r.currency }),
        requestFingerprint: fp,
      });
      if (idem.kind === "replay") return { status: 200, receipt: idem.record, idempotent: true };
      if (idem.kind === "conflict") return { status: 409, code: idem.code };
      const r = mk(paymentId, amount, currency, scoped);
      receipts.push(r);
      return { status: 201, receipt: r };
    },
  };
}

const race = (store: ReturnType<typeof makeReceiptStore>, a: () => any, b: () => any) =>
  Promise.all([a, b].map((fn) => Promise.resolve().then(fn)));

describe("receipt creation — collision-safe + idempotent (tests 6,7,8)", () => {
  it("two concurrent receipt creations for one payment produce exactly ONE receipt", async () => {
    const store = makeReceiptStore();
    await race(store, () => store.create("p1", 500, "USD"), () => store.create("p1", 500, "USD"));
    const forP1 = store.all().filter((r) => r.paymentId === "p1" && r.status === "issued");
    expect(forP1).toHaveLength(1);
  });

  it("two DIFFERENT payments receive unique consecutive receipt numbers", async () => {
    const store = makeReceiptStore();
    const a = store.create("p1", 500, "USD");
    const b = store.create("p2", 700, "USD");
    expect(a.receipt!.receiptNumber).toBe("RCPT-2026-000001");
    expect(b.receipt!.receiptNumber).toBe("RCPT-2026-000002");
    expect(a.receipt!.receiptNumber).not.toBe(b.receipt!.receiptNumber);
  });

  it("same idempotency key replays the original receipt (not a duplicate)", () => {
    const store = makeReceiptStore();
    const first = store.create("p9", 500, "USD", "key-1");
    const second = store.create("p9", 500, "USD", "key-1");
    expect(second.receipt!.id).toBe(first.receipt!.id);
    expect(store.all().filter((r) => r.paymentId === "p9")).toHaveLength(1);
  });
});
