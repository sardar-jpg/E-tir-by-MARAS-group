import { describe, it, expect } from "vitest";
import {
  validateCompanyProfile,
  validateBankAccount,
  applyDefaultBankExclusivity,
  resolveDefaultBankAccountForCurrency,
  isCompanyProfileUsable,
} from "./accountingTemplateSettings";
import type { BankAccount } from "../types";

const acct = (over: Partial<BankAccount>): BankAccount => ({
  id: "b1", bankName: "ITB", accountHolderName: "MARAS", accountNumber: "123",
  currency: "USD", active: true, createdAt: "2026-01-01T00:00:00Z", ...over,
});

describe("company profile validation", () => {
  it("accepts a partial profile and trims/caps strings", () => {
    const r = validateCompanyProfile({ companyName: "  MARAS Group  ", phone: "0000" });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.profile.companyName).toBe("MARAS Group"); expect(r.profile.phone).toBe("0000"); }
  });
  it("drops unknown keys and empty strings", () => {
    const r = validateCompanyProfile({ hacker: "x", companyName: "", website: "https://maras.iq" });
    expect(r.ok).toBe(true);
    if (r.ok) { expect((r.profile as any).hacker).toBeUndefined(); expect(r.profile.companyName).toBeUndefined(); expect(r.profile.website).toBe("https://maras.iq"); }
  });
  it("rejects a malformed email", () => {
    expect(validateCompanyProfile({ email: "not-an-email" }).ok).toBe(false);
    expect(validateCompanyProfile({ email: "info@maras.iq" }).ok).toBe(true);
  });
  it("usable only when a company name is present", () => {
    expect(isCompanyProfileUsable(null)).toBe(false);
    expect(isCompanyProfileUsable({})).toBe(false);
    expect(isCompanyProfileUsable({ companyName: "MARAS" })).toBe(true);
    expect(isCompanyProfileUsable({ companyNameEn: "MARAS" })).toBe(true);
  });
});

describe("bank account validation", () => {
  it("requires bankName, holder, accountNumber, valid currency", () => {
    expect(validateBankAccount({ accountHolderName: "M", accountNumber: "1", currency: "USD" }).ok).toBe(false);
    expect(validateBankAccount({ bankName: "B", accountNumber: "1", currency: "USD" }).ok).toBe(false);
    expect(validateBankAccount({ bankName: "B", accountHolderName: "M", currency: "USD" }).ok).toBe(false);
    expect(validateBankAccount({ bankName: "B", accountHolderName: "M", accountNumber: "1", currency: "GBP" }).ok).toBe(false);
    const ok = validateBankAccount({ bankName: "ITB", accountHolderName: "MARAS", accountNumber: "999", currency: "USD", iban: "IQ..", swift: "ITBH" });
    expect(ok.ok).toBe(true);
    if (ok.ok) { expect(ok.value.active).toBe(true); expect(ok.value.iban).toBe("IQ.."); }
  });
  it("defaults active=true and honors an explicit active=false", () => {
    const r = validateBankAccount({ bankName: "B", accountHolderName: "M", accountNumber: "1", currency: "EUR", active: false });
    expect(r.ok && r.value.active).toBe(false);
  });
});

describe("default-per-currency exclusivity", () => {
  it("clears the default flag on other accounts of the same currency only", () => {
    const accounts = [
      acct({ id: "a", currency: "USD", isDefaultForCurrency: true }),
      acct({ id: "b", currency: "USD", isDefaultForCurrency: false }),
      acct({ id: "c", currency: "EUR", isDefaultForCurrency: true }),
    ];
    const next = applyDefaultBankExclusivity(accounts, "b", "USD");
    expect(next.find((x) => x.id === "a")!.isDefaultForCurrency).toBe(false); // demoted
    expect(next.find((x) => x.id === "c")!.isDefaultForCurrency).toBe(true); // EUR untouched
  });
});

describe("default bank resolution for a document currency", () => {
  it("prefers the explicit active default, else the earliest active, else null", () => {
    const accounts = [
      acct({ id: "old", currency: "USD", createdAt: "2026-01-01T00:00:00Z" }),
      acct({ id: "new", currency: "USD", createdAt: "2026-02-01T00:00:00Z", isDefaultForCurrency: true }),
      acct({ id: "eur", currency: "EUR" }),
    ];
    expect(resolveDefaultBankAccountForCurrency(accounts, "USD")!.id).toBe("new");
    // Remove the explicit default → earliest active USD wins.
    expect(resolveDefaultBankAccountForCurrency(accounts.map((a) => ({ ...a, isDefaultForCurrency: false })), "USD")!.id).toBe("old");
    // No account for a currency → null.
    expect(resolveDefaultBankAccountForCurrency(accounts, "TRY")).toBeNull();
  });
  it("ignores inactive accounts", () => {
    const accounts = [acct({ id: "x", currency: "USD", active: false, isDefaultForCurrency: true })];
    expect(resolveDefaultBankAccountForCurrency(accounts, "USD")).toBeNull();
  });
});
