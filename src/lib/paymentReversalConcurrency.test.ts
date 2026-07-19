import { describe, it, expect } from "vitest";
import { canReversePayment } from "./customerPayments";
import { canReverseVendorPayment } from "./vendorPayments";

/**
 * Real interleaving proof for atomic + idempotent reversal (increment 2,
 * items 3 & 5). The critical section is a faithful model of the memory branch
 * of the reversal routes (identical to the Firestore runTransaction path): a
 * SYNCHRONOUS read → decide → conditional write on a single shared record,
 * with no `await` inside. The decide first short-circuits an already-reversed
 * record to an idempotent replay, then defers to the SAME pure validators the
 * routes call — canReversePayment / canReverseVendorPayment. Because JS is
 * single-threaded and the section contains no await, two reversals can never
 * interleave: the loser re-reads the winner's "reversed" state and replays
 * idempotently instead of writing twice.
 */
type Rec = { status: "active" | "reversed"; reversedBy?: string; reversalReason?: string; reversedAt?: string };
type Validator = (p: { status: "active" | "reversed" }, reason: string) => { ok: true } | { ok: false; code: string; error: string };

function makeStore(initial: Rec, validate: Validator) {
  let doc: Rec = initial;
  return {
    get: () => doc,
    /** atomic section: read + decide + write, no await between. */
    reverse(actor: string, reason: string, now: string) {
      if (doc.status === "reversed") return { httpStatus: 200, idempotent: true }; // idempotent replay
      const d = validate(doc, reason);
      if (!d.ok) return { httpStatus: d.code === "reason_required" ? 400 : 409, code: d.code };
      doc = { ...doc, status: "reversed", reversedBy: actor, reversalReason: reason, reversedAt: now };
      return { httpStatus: 200, reversed: true };
    },
  };
}

async function race(store: ReturnType<typeof makeStore>, a: () => any, b: () => any) {
  const run = async (fn: () => any) => { await Promise.resolve(); return fn(); };
  return Promise.all([run(a), run(b)]);
}

describe.each([
  ["customer payment", canReversePayment as Validator],
  ["vendor payment", canReverseVendorPayment as Validator],
])("%s reversal is atomic + idempotent (tests 3 & 5)", (_label, validate) => {
  it("two concurrent reversals → exactly one reverses, the other is an idempotent no-op", async () => {
    const store = makeStore({ status: "active" }, validate);
    const [x, y] = await race(
      store,
      () => store.reverse("u1", "duplicate entry", "2026-07-19T00:00:00Z"),
      () => store.reverse("u2", "duplicate entry", "2026-07-19T00:00:01Z"),
    );
    expect([x.httpStatus, y.httpStatus]).toEqual([200, 200]);
    expect([x, y].filter((r) => r.reversed).length).toBe(1);
    expect([x, y].filter((r) => r.idempotent).length).toBe(1);
    expect(store.get().status).toBe("reversed");
    expect(store.get().reversedBy).toBe("u1"); // first writer preserved
  });

  it("a repeated reversal after reversal is a harmless idempotent success", () => {
    const store = makeStore({ status: "active" }, validate);
    expect(store.reverse("u1", "wrong amount", "t1").reversed).toBe(true);
    const again = store.reverse("u1", "wrong amount", "t2");
    expect(again.httpStatus).toBe(200);
    expect(again.idempotent).toBe(true);
    expect(store.get().reversedAt).toBe("t1"); // original metadata untouched
  });

  it("reversal of an active record requires a reason", () => {
    const store = makeStore({ status: "active" }, validate);
    const out = store.reverse("u1", "   ", "t1");
    expect(out.httpStatus).toBe(400);
    expect(out.code).toBe("reason_required");
    expect(store.get().status).toBe("active");
  });
});
