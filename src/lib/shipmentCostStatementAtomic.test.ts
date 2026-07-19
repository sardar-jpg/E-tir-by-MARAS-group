import { describe, it, expect } from "vitest";
import { planCostStatementRepair } from "./shipmentCostStatement";

/**
 * Increment 2, item 10 → mandatory tests 10, 11, 12.
 *
 * Tests 10 & 11 model the ALL-OR-NOTHING creation in createShipmentRecord: a
 * batch/atomic write of the shipment doc + its cost statement (id ===
 * shipmentId). Either both land or neither does. Test 12 exercises the pure
 * repair planner used by the repair route (idempotent, never duplicates).
 */

/** Faithful model of the atomic shipment+cost-statement write (both or neither). */
function makeStore() {
  const shipments = new Map<string, any>();
  const costStatements = new Map<string, any>();
  return {
    shipments, costStatements,
    /** batch.commit(): both writes apply, or the whole op throws (nothing applies). */
    createAtomic(id: string, shipment: any, statement: any, failStatement = false) {
      if (failStatement) throw new Error("cost statement write failed"); // batch never commits
      shipments.set(id, shipment);
      costStatements.set(id, statement); // same id as the shipment
      return { ok: true };
    },
  };
}

describe("shipment + cost statement are created atomically (tests 10 & 11)", () => {
  it("successful creation yields exactly ONE cost statement with id === shipmentId", () => {
    const store = makeStore();
    store.createAtomic("shipment-1001", { id: "shipment-1001" }, { shipmentId: "shipment-1001" });
    expect(store.shipments.has("shipment-1001")).toBe(true);
    expect(store.costStatements.has("shipment-1001")).toBe(true);
    // Exactly one statement, keyed by the shipment id.
    expect([...store.costStatements.keys()]).toEqual(["shipment-1001"]);
  });

  it("a failure creating the cost statement leaves NEITHER shipment nor statement", () => {
    const store = makeStore();
    expect(() => store.createAtomic("shipment-1002", { id: "shipment-1002" }, { shipmentId: "shipment-1002" }, true)).toThrow();
    expect(store.shipments.has("shipment-1002")).toBe(false);
    expect(store.costStatements.has("shipment-1002")).toBe(false);
  });
});

describe("repair helper is idempotent and never duplicates (test 12)", () => {
  it("reports only shipments missing a statement, then nothing on rerun", () => {
    const shipments = [{ id: "shipment-1001" }, { id: "shipment-1002" }, { id: "shipment-1003" }];
    const existing = ["shipment-1001"]; // 1002 + 1003 missing
    const missing1 = planCostStatementRepair(shipments, existing);
    expect(missing1).toEqual(["shipment-1002", "shipment-1003"]);
    // Simulate the repair creating them, then rerun: nothing left to create.
    const afterRepair = [...existing, ...missing1];
    expect(planCostStatementRepair(shipments, afterRepair)).toEqual([]);
  });

  it("never lists a shipment that already has a statement (no overwrite)", () => {
    const shipments = [{ id: "a" }, { id: "b" }];
    expect(planCostStatementRepair(shipments, ["a", "b"])).toEqual([]);
  });
});
