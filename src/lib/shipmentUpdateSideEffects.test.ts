import { describe, it, expect, vi } from "vitest";
import { runShipmentUpdateSideEffects } from "./shipmentUpdateSideEffects";

/**
 * fix/shipment-update-concurrency (PR #111 review — Blocker 1)
 *
 * PUT /api/shipments/:id used to run its post-commit side effects
 * (notifications, customer-watcher updates, audit logging, driver-stat
 * bumps) inside the SAME try block as the authoritative Firestore
 * transaction — a side effect throwing after a successful commit made the
 * route answer 500 "Failed to update shipment details" even though the
 * shipment had already been saved. These tests pin the safety net itself:
 * every task always runs to completion, failures are reported (never
 * thrown), and one failing task never prevents another from running.
 */

describe("runShipmentUpdateSideEffects", () => {
  it("returns no failures when every task succeeds", async () => {
    const calls: string[] = [];
    const failures = await runShipmentUpdateSideEffects([
      { name: "a", run: async () => { calls.push("a"); } },
      { name: "b", run: async () => { calls.push("b"); } },
    ]);
    expect(failures).toEqual([]);
    expect(calls).toEqual(["a", "b"]);
  });

  it("never throws, even when every task rejects", async () => {
    await expect(
      runShipmentUpdateSideEffects([
        { name: "a", run: async () => { throw new Error("a failed"); } },
        { name: "b", run: async () => { throw new Error("b failed"); } },
      ])
    ).resolves.toBeDefined();
  });

  it("reports a rejected task's name and the original error, not a generic message", async () => {
    const boom = new Error("notification service unreachable");
    const failures = await runShipmentUpdateSideEffects([
      { name: "customer-watcher-notification", run: async () => { throw boom; } },
    ]);
    expect(failures).toEqual([{ name: "customer-watcher-notification", error: boom }]);
  });

  it("one failing task does not prevent a later, independent task from running", async () => {
    const secondTaskRan = vi.fn();
    const failures = await runShipmentUpdateSideEffects([
      { name: "first-fails", run: async () => { throw new Error("boom"); } },
      { name: "second-succeeds", run: async () => { secondTaskRan(); } },
    ]);
    expect(secondTaskRan).toHaveBeenCalledTimes(1);
    expect(failures).toEqual([{ name: "first-fails", error: expect.any(Error) }]);
  });

  it("a failing task does not stop an earlier, independent task from having already run", async () => {
    const firstTaskRan = vi.fn();
    const failures = await runShipmentUpdateSideEffects([
      { name: "first-succeeds", run: async () => { firstTaskRan(); } },
      { name: "second-fails", run: async () => { throw new Error("boom"); } },
    ]);
    expect(firstTaskRan).toHaveBeenCalledTimes(1);
    expect(failures).toEqual([{ name: "second-fails", error: expect.any(Error) }]);
  });

  it("reports multiple independent failures, one entry per failed task", async () => {
    const failures = await runShipmentUpdateSideEffects([
      { name: "driver-stat-decrement", run: async () => { throw new Error("driver doc missing"); } },
      { name: "audit-log", run: async () => {} },
      { name: "shipment-updated-notification", run: async () => { throw new Error("push failed"); } },
    ]);
    expect(failures.map((f) => f.name).sort()).toEqual(["driver-stat-decrement", "shipment-updated-notification"]);
  });

  it("runs an empty task list without error", async () => {
    const failures = await runShipmentUpdateSideEffects([]);
    expect(failures).toEqual([]);
  });
});
