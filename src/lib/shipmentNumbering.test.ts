import { describe, it, expect } from "vitest";
import {
  formatShipmentNumber,
  formatShipmentId,
  nextSequenceFromCounterDoc,
  InMemorySequenceCounter,
} from "./shipmentNumbering";

describe("formatShipmentNumber / formatShipmentId", () => {
  it("BUG-15: keeps the existing visible format (MAR-<year>-<1001+n>)", () => {
    expect(formatShipmentNumber(2026, 0)).toBe("MAR-2026-1001");
    expect(formatShipmentNumber(2026, 183)).toBe("MAR-2026-1184");
  });

  it("keeps the existing id format (shipment-<1001+n>)", () => {
    expect(formatShipmentId(0)).toBe("shipment-1001");
    expect(formatShipmentId(183)).toBe("shipment-1184");
  });
});

describe("nextSequenceFromCounterDoc", () => {
  it("BUG-15: uses the bootstrap count when the counter doc doesn't exist yet", () => {
    const { current, next } = nextSequenceFromCounterDoc(undefined, 42);
    expect(current).toBe(42);
    expect(next).toEqual({ count: 43 });
  });

  it("BUG-15: increments from the existing counter doc, ignoring the bootstrap count", () => {
    const { current, next } = nextSequenceFromCounterDoc({ count: 100 }, 0);
    expect(current).toBe(100);
    expect(next).toEqual({ count: 101 });
  });

  it("BUG-15: sequential allocation increments by exactly one each time with no gaps or repeats", () => {
    let doc: { count: number } | undefined = undefined;
    const seen: number[] = [];
    for (let i = 0; i < 10; i++) {
      const { current, next } = nextSequenceFromCounterDoc(doc, 0);
      seen.push(current);
      doc = next;
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("InMemorySequenceCounter", () => {
  it("BUG-15: starts from the given bootstrap value", () => {
    const counter = new InMemorySequenceCounter(1001);
    expect(counter.next()).toBe(1001);
    expect(counter.next()).toBe(1002);
  });

  it("BUG-15: memory fallback cannot duplicate a sequence number across normal sequential calls", () => {
    const counter = new InMemorySequenceCounter(0);
    const values = Array.from({ length: 50 }, () => counter.next());
    expect(new Set(values).size).toBe(values.length);
    expect(values).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it("BUG-15: two callers sharing one counter instance never receive the same number", async () => {
    // Two "request handlers" each grabbing 25 numbers from the same
    // counter, scheduled via microtasks the way concurrent async request
    // handlers would be. next() itself has no await in it, so even
    // though the two callers' work is interleaved by the event loop, no
    // single next() call can be split in half and observe a stale count -
    // which is exactly what let the old snapshot.size-based read/
    // increment/write hand out duplicates.
    const counter = new InMemorySequenceCounter(0);
    const callerA = await Promise.all(Array.from({ length: 25 }, () => Promise.resolve().then(() => counter.next())));
    const callerB = await Promise.all(Array.from({ length: 25 }, () => Promise.resolve().then(() => counter.next())));
    const all = [...callerA, ...callerB];
    expect(new Set(all).size).toBe(all.length);
  });
});
