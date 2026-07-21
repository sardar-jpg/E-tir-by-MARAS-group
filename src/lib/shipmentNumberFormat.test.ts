import { describe, it, expect } from "vitest";
import {
  CANONICAL_SHIPMENT_NUMBER_REGEX,
  isCanonicalShipmentNumber,
  isObsoleteShipmentNumber,
  padShipmentSequence,
} from "./shipmentNumberFormat";
import { formatShipmentNumber } from "./shipmentNumbering";

// The official and only active business-reference ("Order Number") standard:
// MAR-YYYY-0001, with the sequence portion always EXACTLY four digits,
// zero-padded on the left.

describe("official four-digit MAR reference standard", () => {
  const ref = (year: number, seq: number) => `MAR-${year}-${padShipmentSequence(seq)}`;

  it("(1) the first sequence is MAR-2026-0001", () => {
    expect(ref(2026, 1)).toBe("MAR-2026-0001");
  });
  it("(2) sequence 9 is MAR-2026-0009", () => {
    expect(ref(2026, 9)).toBe("MAR-2026-0009");
  });
  it("(3) sequence 10 is MAR-2026-0010", () => {
    expect(ref(2026, 10)).toBe("MAR-2026-0010");
  });
  it("(4) sequence 100 is MAR-2026-0100", () => {
    expect(ref(2026, 100)).toBe("MAR-2026-0100");
  });
  it("(5) sequence 999 is MAR-2026-0999", () => {
    expect(ref(2026, 999)).toBe("MAR-2026-0999");
  });
  it("(6) sequence 1000 is MAR-2026-1000", () => {
    expect(ref(2026, 1000)).toBe("MAR-2026-1000");
  });

  it("padShipmentSequence zero-pads to exactly four digits across the range", () => {
    expect(padShipmentSequence(1)).toBe("0001");
    expect(padShipmentSequence(9)).toBe("0009");
    expect(padShipmentSequence(10)).toBe("0010");
    expect(padShipmentSequence(99)).toBe("0099");
    expect(padShipmentSequence(100)).toBe("0100");
    expect(padShipmentSequence(999)).toBe("0999");
    expect(padShipmentSequence(1000)).toBe("1000");
  });

  it("rejects invalid sequence inputs (fail closed, never silently mis-formats)", () => {
    expect(() => padShipmentSequence(-1)).toThrow();
    expect(() => padShipmentSequence(NaN)).toThrow();
    expect(() => padShipmentSequence(Infinity)).toThrow();
  });
});

describe("(7)/(8) canonical validation — exactly four sequence digits, three-digit rejected", () => {
  it("accepts canonical four-digit references", () => {
    for (const v of ["MAR-2026-0001", "MAR-2026-0002", "MAR-2026-0010", "MAR-2026-0100", "MAR-2026-1000", "MAR-2026-1001", "MAR-2027-9999"]) {
      expect(isCanonicalShipmentNumber(v)).toBe(true);
      expect(CANONICAL_SHIPMENT_NUMBER_REGEX.test(v)).toBe(true);
    }
  });

  it("rejects the retired ETIR/eTIR format", () => {
    expect(isCanonicalShipmentNumber("ETIR-2026-001")).toBe(false);
    expect(isCanonicalShipmentNumber("eTIR-2026-001")).toBe(false);
    expect(isObsoleteShipmentNumber("ETIR-2026-001")).toBe(true);
    expect(isObsoleteShipmentNumber("eTIR-2026-0001")).toBe(true);
  });

  it("rejects three-digit (and shorter) MAR sequences", () => {
    for (const v of ["MAR-2026-001", "MAR-2026-01", "MAR-2026-1"]) {
      expect(isCanonicalShipmentNumber(v)).toBe(false);
      expect(isObsoleteShipmentNumber(v)).toBe(true);
    }
  });

  it("rejects malformed / non-string inputs", () => {
    for (const v of ["", "MAR-2026-", "MAR-26-0001", "mar-2026-0001", "MAR-2026-00A1", 12345, null, undefined, {}]) {
      expect(isCanonicalShipmentNumber(v as any)).toBe(false);
    }
  });
});

describe("(7) the active generator can never produce a three-digit sequence", () => {
  it("formatShipmentNumber output is always canonical (exactly four digits) across the operational range", () => {
    // Production uses a base-1001 offset, so index 0 → MAR-YYYY-1001. Sweep a
    // wide range of allocation indices; every one must be canonical and never
    // three-digit.
    for (let index = 0; index <= 8998; index += 337) {
      const value = formatShipmentNumber(2026, index);
      expect(isCanonicalShipmentNumber(value)).toBe(true);
      expect(/^MAR-\d{4}-\d{3}$/.test(value)).toBe(false); // not three digits
    }
    expect(formatShipmentNumber(2026, 0)).toBe("MAR-2026-1001");
    expect(isCanonicalShipmentNumber(formatShipmentNumber(2026, 8998))).toBe(true); // MAR-2026-9999
  });
});

describe("(9) historical continuity — production numbering is unchanged (not rewritten)", () => {
  it("the base-1001 scheme still yields MAR-2026-1001 for the first order", () => {
    // Pins that this phase did NOT change production allocation to a
    // zero-padded-from-0001 scheme (which would have collided with stored
    // shipment-1001 records/ids).
    expect(formatShipmentNumber(2026, 0)).toBe("MAR-2026-1001");
    expect(formatShipmentNumber(2026, 183)).toBe("MAR-2026-1184");
  });

  it("classifier functions are pure and never mutate their input", () => {
    const stored = "ETIR-2026-001";
    isObsoleteShipmentNumber(stored);
    isCanonicalShipmentNumber(stored);
    expect(stored).toBe("ETIR-2026-001"); // unchanged
  });
});

describe("(10) single canonical reference system", () => {
  it("production shipmentNumber is the one canonical reference and conforms to the standard", () => {
    // The format standard and the production generator agree that production's
    // first order is a valid canonical reference — one standard, one field
    // (shipmentNumber). No parallel reference generator/field is introduced
    // here; noOrderNumberRegression.test.ts continues to forbid a second field.
    expect(isCanonicalShipmentNumber(formatShipmentNumber(2026, 0))).toBe(true);
    expect(isCanonicalShipmentNumber(`MAR-2026-${padShipmentSequence(1)}`)).toBe(true);
  });
});
