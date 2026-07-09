import { describe, it, expect } from "vitest";
import { sanitizeLogInput, maskLoginIdentifier } from "./activityLogInput";

describe("sanitizeLogInput", () => {
  it("trims whitespace on every field", () => {
    const result = sanitizeLogInput({
      shipmentId: "  s-1  ",
      shipmentNumber: "  MAR-1  ",
      actor: "  Ops  ",
      actionEn: "  did a thing  ",
      actionTr: "  bir sey yapti  ",
      actionAr: "  فعل شيئا  ",
    });
    expect(result).toEqual({
      shipmentId: "s-1",
      shipmentNumber: "MAR-1",
      actor: "Ops",
      actionEn: "did a thing",
      actionTr: "bir sey yapti",
      actionAr: "فعل شيئا",
    });
  });

  it("caps every field at 300 characters", () => {
    const long = "a".repeat(500);
    const result = sanitizeLogInput({ actionEn: long });
    expect(result.actionEn).toHaveLength(300);
  });

  it("coerces non-string input to empty string", () => {
    const result = sanitizeLogInput({
      shipmentId: 123 as unknown as string,
      actionEn: { evil: true } as unknown as string,
      actionTr: null,
      actionAr: undefined,
    });
    expect(result.shipmentId).toBe("");
    expect(result.actionEn).toBe("");
    expect(result.actionTr).toBe("");
    expect(result.actionAr).toBe("");
  });

  it("defaults actor to 'Operator' when missing or blank", () => {
    expect(sanitizeLogInput({}).actor).toBe("Operator");
    expect(sanitizeLogInput({ actor: "   " }).actor).toBe("Operator");
  });
});

describe("maskLoginIdentifier", () => {
  it("masks an email, keeping only the first character and domain", () => {
    expect(maskLoginIdentifier("jane.doe@example.com")).toBe("j***@example.com");
  });

  it("masks a phone number, keeping only the last 4 digits", () => {
    expect(maskLoginIdentifier("+90 212 555 1234")).toBe("***1234");
  });

  it("masks a plain username, keeping only the first character", () => {
    expect(maskLoginIdentifier("operationsadmin")).toBe("o******");
  });

  it("returns 'unknown' for empty input", () => {
    expect(maskLoginIdentifier("")).toBe("unknown");
    expect(maskLoginIdentifier(undefined)).toBe("unknown");
    expect(maskLoginIdentifier(null)).toBe("unknown");
  });
});
