import { describe, it, expect } from "vitest";
import { buildCostItemFromInput, decideItemAppend } from "./costStatementItem";
import type { CostItem } from "../types";

describe("buildCostItemFromInput — validation + urgency normalization (items 10/12)", () => {
  it("requires a description, a positive amount, and a valid currency", () => {
    expect((buildCostItemFromInput({ amount: 10, currency: "USD" }, "i1") as any).code).toBe("missing_description");
    expect((buildCostItemFromInput({ description: "x", amount: 0, currency: "USD" }, "i1") as any).code).toBe("invalid_amount");
    expect((buildCostItemFromInput({ description: "x", amount: 10, currency: "ZZZ" }, "i1") as any).code).toBe("invalid_currency");
  });
  it("builds a normalized single-line item (amount = line total, qty 1)", () => {
    const r = buildCostItemFromInput({ description: "Fuel", amount: 123.456, currency: "USD", supplierName: "Shell" }, "i1");
    expect(r.ok).toBe(true);
    const item = (r as any).item as CostItem;
    expect(item).toMatchObject({ id: "i1", quantity: 1, unitPrice: 123.46, totalAmount: 123.46, currency: "USD", supplierName: "Shell", priority: "normal" });
  });
  it("normalizes a paymentMethod of 'urgent' into priority (never stored as a method)", () => {
    const r = buildCostItemFromInput({ description: "Tow", amount: 50, currency: "USD", paymentMethod: "urgent" }, "i1");
    expect((r as any).item.priority).toBe("urgent");
    expect((r as any).item).not.toHaveProperty("paymentMethod");
  });
  it("accepts an explicit priority/isUrgent flag", () => {
    expect((buildCostItemFromInput({ description: "a", amount: 1, currency: "USD", priority: "urgent" }, "i") as any).item.priority).toBe("urgent");
    expect((buildCostItemFromInput({ description: "a", amount: 1, currency: "USD", isUrgent: true }, "i") as any).item.priority).toBe("urgent");
  });
});

const item = (id: string, key?: string): CostItem => ({ id, costType: "expense", description: id, quantity: 1, unitPrice: 1, totalAmount: 1, currency: "USD", supplierName: "", idempotencyKey: key });

describe("decideItemAppend — revision + idempotency (item 11)", () => {
  it("appends when revision matches (or is omitted)", () => {
    expect(decideItemAppend({ items: [], storedRevision: 3, expectedRevision: 3 }).kind).toBe("append");
    expect(decideItemAppend({ items: [], storedRevision: 3 }).kind).toBe("append");
  });
  it("rejects a stale expectedRevision with revision_conflict", () => {
    const d = decideItemAppend({ items: [], storedRevision: 4, expectedRevision: 3 });
    expect(d.kind).toBe("conflict");
    expect((d as any).code).toBe("revision_conflict");
  });
  it("replays when the same idempotencyKey already added an item (no duplicate)", () => {
    const d = decideItemAppend({ items: [item("a", "cost-item:k1")], storedRevision: 5, scopedIdempotencyKey: "cost-item:k1" });
    expect(d.kind).toBe("replay");
    expect((d as any).item.id).toBe("a");
  });
});

describe("two concurrent item additions preserve BOTH items (test 13)", () => {
  // Model the atomic append section (mutateCostStatementAtomic): read items +
  // revision → decide → write [...items, item], revision+1. No await inside, so
  // the second add re-reads the first's committed items and appends after it.
  it("both land; neither overwrites the other", () => {
    let stmt = { items: [] as CostItem[], revision: 1 };
    const add = (id: string, expectedRevision?: number) => {
      const d = decideItemAppend({ items: stmt.items, storedRevision: stmt.revision, expectedRevision });
      if (d.kind !== "append") return { ok: false };
      stmt = { items: [...stmt.items, item(id)], revision: stmt.revision + 1 };
      return { ok: true };
    };
    add("a"); // no expectedRevision → always appends
    add("b");
    expect(stmt.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(stmt.revision).toBe(3);
  });
});
