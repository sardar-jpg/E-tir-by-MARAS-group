import { describe, it, expect } from "vitest";
import { advanceCycle, selectCycleTargets, OPERATOR_CYCLE_INTERVAL_MS } from "./operatorCycle";

describe("advanceCycle", () => {
  it("returns -1 when there is nothing to cycle", () => {
    expect(advanceCycle(0, 0)).toBe(-1);
    expect(advanceCycle(-1, 0)).toBe(-1);
    expect(advanceCycle(3, -2)).toBe(-1);
  });

  it("starts at 0 when entering a non-empty cycle from nothing focused", () => {
    expect(advanceCycle(-1, 3)).toBe(0);
  });

  it("advances one step and wraps around", () => {
    expect(advanceCycle(0, 3)).toBe(1);
    expect(advanceCycle(1, 3)).toBe(2);
    expect(advanceCycle(2, 3)).toBe(0);
  });

  it("recovers to 0 from an out-of-range index (e.g. targets shrank)", () => {
    expect(advanceCycle(7, 3)).toBe(0);
  });

  it("single-target cycle stays on 0", () => {
    expect(advanceCycle(0, 1)).toBe(0);
  });
});

describe("selectCycleTargets", () => {
  const ships = [
    { id: "a", placeable: true },
    { id: "b", placeable: false },
    { id: "c", placeable: true },
  ];

  it("keeps only placeable shipments, preserving order", () => {
    expect(selectCycleTargets(ships, s => s.placeable).map(s => s.id)).toEqual(["a", "c"]);
  });

  it("returns empty for no placeable shipments (never fabricates a target)", () => {
    expect(selectCycleTargets(ships, () => false)).toEqual([]);
    expect(selectCycleTargets([], () => true)).toEqual([]);
  });
});

describe("cycle pacing", () => {
  it("dwell interval is slow enough for a control-room TV (>= 8s)", () => {
    expect(OPERATOR_CYCLE_INTERVAL_MS).toBeGreaterThanOrEqual(8000);
  });
});
