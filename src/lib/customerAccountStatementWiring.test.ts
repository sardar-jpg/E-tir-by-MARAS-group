import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const SERVER = readFileSync(join(ROOT, "server.ts"), "utf-8");

describe("customer account statement route", () => {
  it("is internal-only (accounting view) and uses the pure builder", () => {
    expect(SERVER).toContain('app.get("/api/customer-accounts/statement", requireCanViewCostStatements');
    expect(SERVER).toContain("buildCustomerAccountStatement({");
    expect(SERVER).toContain("customerStatementCurrencies(");
  });
  it("account statement is never in the public share view", () => {
    const SHARE = readFileSync(join(ROOT, "src", "lib", "publicShareView.ts"), "utf-8");
    expect(SHARE).not.toContain("accountStatement");
    expect(SHARE).not.toContain("closingBalance");
  });
});
