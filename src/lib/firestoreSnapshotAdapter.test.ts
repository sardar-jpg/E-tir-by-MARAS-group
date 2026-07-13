import { describe, it, expect } from "vitest";
import { adaptDocSnapshot } from "./firestoreSnapshotAdapter";

describe("adaptDocSnapshot", () => {
  it("turns a boolean exists property into a callable exists() returning true", () => {
    const raw = { exists: true, data: () => ({ id: "shipment-1" }), id: "shipment-1", ref: { path: "shipments/shipment-1" } };
    const adapted = adaptDocSnapshot(raw);
    expect(typeof adapted.exists).toBe("function");
    expect(adapted.exists()).toBe(true);
  });

  it("turns a boolean exists property into a callable exists() returning false", () => {
    const raw = { exists: false, data: () => undefined, id: "missing", ref: { path: "shipments/missing" } };
    const adapted = adaptDocSnapshot(raw);
    expect(adapted.exists()).toBe(false);
  });

  it("passes id and ref straight through", () => {
    const ref = { path: "drivers/driver-1" };
    const raw = { exists: true, data: () => ({}), id: "driver-1", ref };
    const adapted = adaptDocSnapshot(raw);
    expect(adapted.id).toBe("driver-1");
    expect(adapted.ref).toBe(ref);
  });

  it("delegates data() to the underlying snapshot's data()", () => {
    const payload = { companyName: "Demo Client Co." };
    const raw = { exists: true, data: () => payload, id: "client-1", ref: {} };
    const adapted = adaptDocSnapshot(raw);
    expect(adapted.data()).toBe(payload);
  });

  it("matches the shape produced by the memory-fallback snapshot (handleGetDocMemory in server.ts)", () => {
    // handleGetDocMemory returns: { exists: () => !!item, data: () => item, id, ref: docRef }
    // — the live-path adapter must expose the exact same call surface so
    // every existing `snap.exists()`/`snap.data()` call site in server.ts
    // works identically against either source.
    const raw = { exists: true, data: () => ({ ok: true }), id: "x", ref: {} };
    const adapted = adaptDocSnapshot(raw);
    const memoryShapeKeys = ["exists", "data", "id", "ref"];
    for (const key of memoryShapeKeys) {
      expect(adapted).toHaveProperty(key);
    }
    expect(typeof adapted.exists).toBe("function");
    expect(typeof adapted.data).toBe("function");
  });
});
