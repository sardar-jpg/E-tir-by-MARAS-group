import { describe, it, expect } from "vitest";
import {
  nextAccountingSequence,
  receiptSequenceDocId,
  accountingYearOf,
  formatReceiptNumber,
  type AccountingSequenceDoc,
} from "./accountingSequence";

describe("accounting sequence — 1-based, collision-safe read-modify-write", () => {
  it("starts at 1 when the counter doc does not exist yet", () => {
    expect(nextAccountingSequence(undefined)).toEqual({ issued: 1, next: { count: 1 } });
  });
  it("increments from the stored last value", () => {
    expect(nextAccountingSequence({ count: 41 })).toEqual({ issued: 42, next: { count: 42 } });
  });
  it("two concurrent callers reading the same doc would compute the SAME issued number", () => {
    // Proves WHY the transaction is required: both compute 6 from count:5;
    // only the wrapping transaction lets one commit and retries the other.
    const doc: AccountingSequenceDoc = { count: 5 };
    const a = nextAccountingSequence(doc);
    const b = nextAccountingSequence(doc);
    expect(a.issued).toBe(6);
    expect(b.issued).toBe(6); // identical → collision without atomic commit
  });
  it("serialized (committed) allocation hands out unique consecutive numbers", () => {
    let stored: AccountingSequenceDoc | undefined;
    const issued: number[] = [];
    for (let i = 0; i < 5; i++) { const r = nextAccountingSequence(stored); stored = r.next; issued.push(r.issued); }
    expect(issued).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("receipt number policy RCPT-YYYY-000001", () => {
  it("formats a per-year, 6-digit zero-padded number", () => {
    expect(formatReceiptNumber(2026, 1)).toBe("RCPT-2026-000001");
    expect(formatReceiptNumber(2026, 42)).toBe("RCPT-2026-000042");
    expect(formatReceiptNumber(2027, 123456)).toBe("RCPT-2027-123456");
  });
  it("derives the counter doc id and year deterministically", () => {
    expect(receiptSequenceDocId(2026)).toBe("receipt-2026");
    expect(accountingYearOf("2026-07-19T00:00:00Z")).toBe(2026);
    expect(accountingYearOf(undefined)).toBe(new Date().getUTCFullYear());
  });
});
