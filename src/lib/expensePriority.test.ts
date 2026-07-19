import { describe, it, expect } from "vitest";
import {
  isUrgentExpense,
  normalizeExpensePriority,
  sanitizePaymentMethod,
  resolveRequestedPriority,
} from "./expensePriority";

describe("urgency is a priority, not a payment method", () => {
  it("detects urgency from priority, isUrgent, or the legacy method sentinel", () => {
    expect(isUrgentExpense({ priority: "urgent" })).toBe(true);
    expect(isUrgentExpense({ isUrgent: true })).toBe(true);
    expect(isUrgentExpense({ paymentMethod: "urgent" })).toBe(true);
    expect(isUrgentExpense({ paymentMethod: "URGENT" })).toBe(true);
    expect(isUrgentExpense({ paymentMethod: "wire" })).toBe(false);
    expect(isUrgentExpense({})).toBe(false);
  });

  it("normalizes a legacy paymentMethod=urgent record safely on read", () => {
    const legacy = { id: "e1", paymentMethod: "urgent", amount: 100 };
    const norm = normalizeExpensePriority(legacy);
    expect(norm.priority).toBe("urgent");
    expect(norm.paymentMethod).toBe(""); // invalid method cleared
    expect(norm.amount).toBe(100); // other fields preserved
    // input not mutated
    expect(legacy.paymentMethod).toBe("urgent");
  });

  it("preserves a real method and marks priority normal", () => {
    const norm = normalizeExpensePriority({ paymentMethod: "wire" });
    expect(norm.priority).toBe("normal");
    expect(norm.paymentMethod).toBe("wire");
  });

  it("never lets 'urgent' be written back as a payment method", () => {
    expect(sanitizePaymentMethod("urgent")).toBe("");
    expect(sanitizePaymentMethod(" Urgent ")).toBe("");
    expect(sanitizePaymentMethod("wire")).toBe("wire");
    expect(sanitizePaymentMethod(123 as unknown)).toBe("");
  });

  it("resolves requested priority from the body", () => {
    expect(resolveRequestedPriority({ priority: "urgent" })).toBe("urgent");
    expect(resolveRequestedPriority({ isUrgent: true })).toBe("urgent");
    expect(resolveRequestedPriority({ priority: "normal" })).toBe("normal");
    expect(resolveRequestedPriority({})).toBe("normal");
  });
});
