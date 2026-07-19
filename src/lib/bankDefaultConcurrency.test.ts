import { describe, it, expect } from "vitest";
import { decideSetDefaultBank, applyExclusiveDefault, countDefaultsForCurrency } from "./bankDefault";
import type { BankAccount } from "../types";

const acct = (id: string, over: Partial<BankAccount> = {}): BankAccount => ({
  id, bankName: id, accountHolderName: "MARAS", accountNumber: "1234", currency: "USD",
  active: true, createdAt: "t", ...over,
});

describe("default bank exclusivity (item 7 / test 9)", () => {
  it("rejects an inactive account as default", () => {
    const target = acct("A", { active: false });
    const d = decideSetDefaultBank({ target, allAccounts: [target] });
    expect(d.ok).toBe(false);
    expect((d as { code: string }).code).toBe("inactive_default");
  });

  it("making X default demotes all other same-currency defaults in one write", () => {
    const accounts = [acct("A", { isDefaultForCurrency: true }), acct("B"), acct("C", { currency: "EUR", isDefaultForCurrency: true })];
    const d = decideSetDefaultBank({ target: accounts[1], allAccounts: accounts });
    expect(d.ok).toBe(true);
    const writes = (d as { writes: BankAccount[] }).writes;
    // A demoted, B promoted; the EUR default C is untouched.
    expect(writes.find((w) => w.id === "A")!.isDefaultForCurrency).toBe(false);
    expect(writes.find((w) => w.id === "B")!.isDefaultForCurrency).toBe(true);
    expect(writes.some((w) => w.id === "C")).toBe(false);
  });

  it("two concurrent USD default changes leave EXACTLY ONE default", () => {
    // Model the atomic section: each request applies the full currency's
    // flags. Whichever commits LAST wins entirely — never two defaults.
    let store: BankAccount[] = [acct("A", { isDefaultForCurrency: true }), acct("B"), acct("D", { currency: "EUR", isDefaultForCurrency: true })];
    // Request 1: make B default. Request 2: make A default. Apply in either
    // interleaving; the invariant (≤ 1 USD default) must hold after each.
    store = applyExclusiveDefault(store, "B", "USD");
    expect(countDefaultsForCurrency(store, "USD")).toBe(1);
    store = applyExclusiveDefault(store, "A", "USD");
    expect(countDefaultsForCurrency(store, "USD")).toBe(1);
    expect(store.find((a) => a.id === "A")!.isDefaultForCurrency).toBe(true);
    expect(store.find((a) => a.id === "B")!.isDefaultForCurrency).toBe(false);
    // The EUR default is never disturbed by USD changes.
    expect(countDefaultsForCurrency(store, "EUR")).toBe(1);
  });
});
