import { describe, it, expect } from "vitest";
import { buildReceiptNumber, canIssueReceipt, findActiveReceiptForPayment, buildReceiptView } from "./paymentReceipt";
import type { CustomerPayment, PaymentReceipt } from "../types";

const payment = (over: Partial<CustomerPayment> = {}): CustomerPayment => ({
  id: "p1", companyName: "Acme", amount: 1000, currency: "USD", paymentDate: "2026-02-01",
  paymentMethod: "wire", allocations: [], status: "active", createdBy: "u", createdAt: "t", ...over,
});
const receipt = (over: Partial<PaymentReceipt> = {}): PaymentReceipt => ({
  id: "r1", receiptNumber: "RCPT-0001", paymentId: "p1", companyName: "Acme", amount: 1000, currency: "USD",
  paymentDate: "2026-02-01", paymentMethod: "wire", allocations: [{ invoiceId: "I1", invoiceNumber: "MAR-2026-1001", amount: 1000 }],
  status: "issued", issuedBy: "u", issuedAt: "t", ...over,
});

describe("receipt number + issue guards", () => {
  it("numbers by per-company sequence, zero-padded", () => {
    expect(buildReceiptNumber(1)).toBe("RCPT-0001");
    expect(buildReceiptNumber(42)).toBe("RCPT-0042");
  });
  it("only active payments can be receipted", () => {
    expect(canIssueReceipt(payment()).ok).toBe(true);
    expect(canIssueReceipt(payment({ status: "reversed" })).ok).toBe(false);
    expect(canIssueReceipt(null).ok).toBe(false);
  });
  it("finds an existing active receipt for idempotency", () => {
    const receipts = [receipt({ status: "void" }), receipt({ id: "r2" })];
    expect(findActiveReceiptForPayment(receipts, "p1")!.id).toBe("r2");
    expect(findActiveReceiptForPayment([receipt({ status: "void" })], "p1")).toBeUndefined();
  });
});

describe("customer receipt view", () => {
  it("exposes the covered MAR invoices and omits internal audit fields", () => {
    const v = buildReceiptView(receipt({ issuedBy: "secret-user" }));
    expect(v.receiptNumber).toBe("RCPT-0001");
    expect(v.coveredInvoices).toEqual([{ invoiceNumber: "MAR-2026-1001", amount: 1000 }]);
    expect((v as any).issuedBy).toBeUndefined();
    expect(JSON.stringify(v)).not.toContain("secret-user");
  });
});
