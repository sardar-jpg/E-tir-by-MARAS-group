import { describe, it, expect } from "vitest";
import { statementToCsv, csvCell } from "./statementExport";

describe("statementExport", () => {
  it("csvCell quotes only when needed and escapes embedded quotes", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(12.5)).toBe("12.5");
  });

  it("serializes header, opening, rows and closing with 2-decimal amounts", () => {
    const csv = statementToCsv({
      title: "Customer Account Statement",
      entity: "ABC Trading",
      currency: "USD",
      from: "2026-01-01",
      to: "2026-06-30",
      openingBalance: 100,
      rows: [
        { date: "2026-02-01", type: "invoice", ref: "MAR-2026-001", description: "Freight", debit: 500, credit: 0, balance: 600 },
        { date: "2026-03-01", type: "payment", ref: "PAY-1", description: "Wire", debit: 0, credit: 200, balance: 400 },
      ],
      totalDebit: 500,
      totalCredit: 200,
      closingBalance: 400,
    });
    const rows = csv.split("\r\n");
    expect(rows[0]).toBe("Customer Account Statement");
    expect(rows).toContain("Date,Type,Reference,Description,Debit,Credit,Balance");
    expect(rows).toContain(",,,Opening balance,,,100.00");
    expect(rows).toContain("2026-02-01,invoice,MAR-2026-001,Freight,500.00,,600.00");
    expect(rows).toContain("2026-03-01,payment,PAY-1,Wire,,200.00,400.00");
    expect(rows).toContain(",,,Totals,500.00,200.00,");
    expect(rows).toContain(",,,Closing balance (USD),,,400.00");
  });

  it("quotes a description containing a comma so columns stay aligned", () => {
    const csv = statementToCsv({
      title: "T", entity: "E", currency: "USD", openingBalance: 0,
      rows: [{ date: "2026-01-01", type: "bill", ref: "R", description: "Sea freight, Mersin", debit: 10, credit: 0, balance: 10 }],
      totalDebit: 10, totalCredit: 0, closingBalance: 10,
    });
    expect(csv).toContain('2026-01-01,bill,R,"Sea freight, Mersin",10.00,,10.00');
  });
});
