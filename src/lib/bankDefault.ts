/**
 * bankDefault.ts — pure logic for "at most one active default bank account
 * per currency" (PR #140 review increment 2, item 7).
 *
 * The exclusivity decision is computed here and applied inside an atomic
 * write (a Firestore batch, or the serialized memory section): the target
 * account becomes the sole default for its currency and every OTHER active
 * account of that currency is demoted in the SAME atomic write. Two
 * concurrent "make X the USD default" requests therefore each set the full
 * currency's flags, so whichever commits last still leaves exactly one
 * default — never two. An inactive account can never be a default.
 * Pure: no clock, db, or session.
 */
import type { BankAccount, Currency } from "../types";

export type DefaultBankDecision =
  | { ok: true; writes: BankAccount[] }
  | { ok: false; code: string; error: string };

/**
 * Decide the writes needed to make `targetId` the sole default for its
 * currency. Returns only the accounts whose default flag actually changes
 * (plus the winner), so the caller writes a minimal, atomic set. Rejects an
 * inactive target (inactive accounts are never selectable as default).
 */
export function decideSetDefaultBank(params: { target: BankAccount; allAccounts: BankAccount[] }): DefaultBankDecision {
  if (!params.target.active) {
    return { ok: false, code: "inactive_default", error: "An inactive bank account cannot be set as the default." };
  }
  const currency = params.target.currency;
  const writes: BankAccount[] = [];
  for (const a of params.allAccounts) {
    if (a.currency !== currency) continue;
    const shouldBeDefault = a.id === params.target.id;
    if (!!a.isDefaultForCurrency !== shouldBeDefault) {
      writes.push({ ...a, isDefaultForCurrency: shouldBeDefault });
    }
  }
  // Guarantee the winner is written even if its stored flag already looked set.
  if (!writes.some((w) => w.id === params.target.id)) {
    writes.push({ ...params.target, isDefaultForCurrency: true });
  }
  return { ok: true, writes };
}

/** Apply an exclusive-default decision to a full account list (for tests / memory). */
export function applyExclusiveDefault(accounts: BankAccount[], targetId: string, currency: Currency): BankAccount[] {
  return accounts.map((a) =>
    a.currency === currency ? { ...a, isDefaultForCurrency: a.id === targetId } : a
  );
}

/** Count active defaults for a currency (invariant check: must be ≤ 1). */
export function countDefaultsForCurrency(accounts: BankAccount[], currency: Currency): number {
  return accounts.filter((a) => a.currency === currency && a.isDefaultForCurrency).length;
}
