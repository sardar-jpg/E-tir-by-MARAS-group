import { describe, it, expect } from "vitest";
import { SHIPMENT_STATUS_GROUPS, zeroedShipmentStatusGroupCounts } from "./shipmentStatusGroups";

describe("shipmentStatusGroups — Phase 2A follow-up (dashboard aggregate accuracy)", () => {
  it("has exactly the four groups AdminPanel's status chart has always shown, in order", () => {
    expect(SHIPMENT_STATUS_GROUPS.map((g) => g.key)).toEqual(["new", "assigned", "transit", "delivered"]);
  });

  it("no status appears in more than one group — each shipment can only ever be counted once", () => {
    const seen = new Set<string>();
    for (const group of SHIPMENT_STATUS_GROUPS) {
      for (const status of group.statuses) {
        expect(seen.has(status)).toBe(false);
        seen.add(status);
      }
    }
  });

  it("zeroedShipmentStatusGroupCounts returns a zero for every group key, nothing else", () => {
    const zeroed = zeroedShipmentStatusGroupCounts();
    expect(Object.keys(zeroed).sort()).toEqual(["assigned", "delivered", "new", "transit"]);
    expect(Object.values(zeroed).every((v) => v === 0)).toBe(true);
  });
});
