import { describe, it, expect } from "vitest";
import { formatOrderNumber, ORDER_NUMBER_BASE, ORDER_NUMBER_PAD_LENGTH } from "./orderNumbering";

describe("formatOrderNumber", () => {
  it("Accounting Phase A: first order number is eTIR-000001", () => {
    expect(formatOrderNumber(0)).toBe("eTIR-000001");
  });

  it("matches the confirmed canonical example (eTIR-000184)", () => {
    expect(formatOrderNumber(183)).toBe("eTIR-000184");
  });

  it("zero-pads to exactly 6 digits", () => {
    expect(formatOrderNumber(9)).toBe("eTIR-000010");
    expect(formatOrderNumber(99998)).toBe("eTIR-099999");
  });

  it("grows instead of truncating once the sequence exceeds 6 digits", () => {
    expect(formatOrderNumber(999999)).toBe("eTIR-1000000");
  });

  it("is a pure function: same input always produces the same output", () => {
    expect(formatOrderNumber(183)).toBe(formatOrderNumber(183));
  });

  it("never collides across the first 1000 sequential values", () => {
    const seen = new Set(Array.from({ length: 1000 }, (_, i) => formatOrderNumber(i)));
    expect(seen.size).toBe(1000);
  });

  it("exposes its base/pad constants for callers that need them", () => {
    expect(ORDER_NUMBER_BASE).toBe(1);
    expect(ORDER_NUMBER_PAD_LENGTH).toBe(6);
  });
});
