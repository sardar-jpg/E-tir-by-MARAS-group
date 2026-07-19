import { describe, it, expect } from "vitest";
import { KeyedMutex } from "./asyncMutex";

describe("KeyedMutex serializes per key", () => {
  it("runs same-key tasks strictly one at a time (no overlap)", async () => {
    const mutex = new KeyedMutex();
    let active = 0;
    let maxActive = 0;
    const order: number[] = [];
    const task = (n: number) => mutex.run("k", async () => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5)); // hold the section
      order.push(n);
      active--;
    });
    await Promise.all([task(1), task(2), task(3)]);
    expect(maxActive).toBe(1); // never two in the section at once
    expect(order).toEqual([1, 2, 3]); // FIFO order preserved
  });

  it("different keys run concurrently", async () => {
    const mutex = new KeyedMutex();
    let active = 0;
    let maxActive = 0;
    const task = (key: string) => mutex.run(key, async () => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    await Promise.all([task("a"), task("b"), task("c")]);
    expect(maxActive).toBeGreaterThan(1); // independent keys overlap
  });

  it("a failing task does not wedge the queue for that key", async () => {
    const mutex = new KeyedMutex();
    await expect(mutex.run("k", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    const ok = await mutex.run("k", async () => 42);
    expect(ok).toBe(42);
  });
});
