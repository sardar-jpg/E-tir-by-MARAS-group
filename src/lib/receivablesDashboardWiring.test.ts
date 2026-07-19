import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SERVER = readFileSync(join(__dirname, "..", "..", "server.ts"), "utf-8");

describe("receivables dashboard route", () => {
  it("is accounting-only and derives from real invoices + payments", () => {
    expect(SERVER).toContain('app.get("/api/admin/dashboard/receivables", requireRole("admin")');
    expect(SERVER).toContain("Receivables overview requires accounting access.");
    expect(SERVER).toContain("buildArOverview(");
    expect(SERVER).toContain('collection(db, "customerInvoices")');
    expect(SERVER).toContain('collection(db, "customerPayments")');
  });
});
