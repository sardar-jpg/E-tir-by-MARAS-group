import { describe, it, expect } from "vitest";
import { buildBankAccountSnapshot, resolveInvoiceBank } from "./bankSnapshot";
import type { BankAccount } from "../types";

const bank = (over: Partial<BankAccount> = {}): BankAccount => ({
  id: "b-usd", bankName: "Intl Bank", accountHolderName: "MARAS Group", accountNumber: "111222",
  iban: "IQ00INTL", swift: "INTLIQBA", branch: "Main", country: "Iraq", additionalInstructions: "Wire only",
  currency: "USD", active: true, isDefaultForCurrency: true, createdAt: "t", ...over,
});

describe("buildBankAccountSnapshot copies the master into the immutable snapshot", () => {
  it("maps every master field to the canonical snapshot field names", () => {
    const snap = buildBankAccountSnapshot(bank());
    expect(snap).toEqual({
      bankAccountId: "b-usd",
      bankName: "Intl Bank",
      accountName: "MARAS Group",
      accountNumber: "111222",
      iban: "IQ00INTL",
      swiftCode: "INTLIQBA",
      branchName: "Main",
      bankAddress: undefined,
      currency: "USD",
      country: "Iraq",
      paymentInstructions: "Wire only",
    });
  });
  it("a snapshot is a plain copy — later master edits cannot reach it", () => {
    const master = bank();
    const snap = buildBankAccountSnapshot(master);
    // Mutating the master afterwards must not change the already-taken snapshot.
    master.accountNumber = "999999";
    master.active = false;
    expect(snap.accountNumber).toBe("111222");
  });
});

describe("resolveInvoiceBank — selection, default fallback, validation", () => {
  const usd = bank({ id: "b-usd", currency: "USD", isDefaultForCurrency: true });
  const eur = bank({ id: "b-eur", currency: "EUR", isDefaultForCurrency: true, iban: "DE00" });
  const usdInactive = bank({ id: "b-usd-old", currency: "USD", active: false, isDefaultForCurrency: false });
  const accounts = [usd, eur, usdInactive];

  it("resolves the ACTIVE default bank for the invoice currency when none is selected", () => {
    const r = resolveInvoiceBank({ accounts, invoiceCurrency: "USD" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.account.id).toBe("b-usd");
  });
  it("uses an explicitly selected active, currency-matched bank", () => {
    const r = resolveInvoiceBank({ accounts, selectedBankId: "b-usd", invoiceCurrency: "USD" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.account.id).toBe("b-usd");
  });
  it("rejects an inactive selected bank as bank_account_required", () => {
    const r = resolveInvoiceBank({ accounts, selectedBankId: "b-usd-old", invoiceCurrency: "USD" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("bank_account_required");
  });
  it("rejects a currency-mismatched selected bank as bank_currency_mismatch", () => {
    const r = resolveInvoiceBank({ accounts, selectedBankId: "b-eur", invoiceCurrency: "USD" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("bank_currency_mismatch");
  });
  it("returns bank_account_required when no selected or default bank exists for the currency", () => {
    const r = resolveInvoiceBank({ accounts: [usdInactive], invoiceCurrency: "USD" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("bank_account_required");
    const t = resolveInvoiceBank({ accounts, invoiceCurrency: "TRY" });
    expect(t.ok).toBe(false);
    if (!t.ok) expect(t.code).toBe("bank_account_required");
  });
});
