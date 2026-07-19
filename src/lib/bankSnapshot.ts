/**
 * bankSnapshot.ts — pure, server-authoritative resolution + snapshotting of the
 * bank account used on an issued invoice (Increment 5, sections 6–7).
 *
 * At issue time the selected (or default-for-currency) bank account is resolved,
 * validated (exists / active / currency-matched), and COPIED into an immutable
 * BankAccountSnapshot stored on the invoice. Issued documents always render from
 * that snapshot, so later edits/deactivation/deletion of the master bank account
 * never change an already-issued invoice. No clock, db, or session.
 */
import type { BankAccount, BankAccountSnapshot, Currency } from "../types";

/** Copy the master bank account into the immutable issued-invoice snapshot. */
export function buildBankAccountSnapshot(account: BankAccount): BankAccountSnapshot {
  return {
    bankAccountId: account.id,
    bankName: account.bankName,
    accountName: account.accountHolderName,
    accountNumber: account.accountNumber,
    iban: account.iban,
    swiftCode: account.swift,
    branchName: account.branch,
    currency: account.currency,
    country: account.country,
    paymentInstructions: account.additionalInstructions,
  };
}

export type BankResolution =
  | { ok: true; account: BankAccount }
  | { ok: false; code: "bank_account_required" | "bank_currency_mismatch"; error: string };

/**
 * Resolve the bank account for issuing an invoice of `invoiceCurrency`:
 *  1. If a bank is explicitly selected, it must exist, be active, and match the
 *     invoice currency (else bank_currency_mismatch / bank_account_required).
 *  2. Otherwise fall back to the ACTIVE default bank for that currency.
 *  3. If none can be resolved, bank_account_required.
 */
export function resolveInvoiceBank(params: {
  accounts: BankAccount[];
  selectedBankId?: string;
  invoiceCurrency: Currency;
}): BankResolution {
  const { accounts, selectedBankId, invoiceCurrency } = params;
  if (selectedBankId) {
    const selected = accounts.find((a) => a.id === selectedBankId);
    if (!selected || !selected.active) {
      return { ok: false, code: "bank_account_required", error: "A valid bank account is required for this invoice currency." };
    }
    if (selected.currency !== invoiceCurrency) {
      return { ok: false, code: "bank_currency_mismatch", error: "The selected bank account currency does not match the invoice currency." };
    }
    return { ok: true, account: selected };
  }
  const def = accounts.find((a) => a.active && a.isDefaultForCurrency && a.currency === invoiceCurrency);
  if (def) return { ok: true, account: def };
  return { ok: false, code: "bank_account_required", error: "A valid bank account is required for this invoice currency." };
}
