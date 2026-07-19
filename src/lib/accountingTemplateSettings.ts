/**
 * accountingTemplateSettings.ts — pure logic for the accounting Template
 * Settings foundation (Company Profile + Bank Accounts). Desktop is the
 * source of truth; these functions are shared by the server (validation +
 * default-bank resolution) so Firestore and memory modes cannot drift, and
 * by any client that renders the configured branding/bank details.
 *
 * No clock, no db, no session — callers pass everything in. Expected
 * rejections return a result object; nothing throws.
 */
import type { BankAccount, CompanyProfile, Currency } from "../types";

export const ALLOWED_ACCOUNTING_CURRENCIES: readonly Currency[] = ["USD", "IQD", "TRY", "EUR"];

function isAllowedCurrency(v: unknown): v is Currency {
  return typeof v === "string" && (ALLOWED_ACCOUNTING_CURRENCIES as readonly string[]).includes(v);
}

function cleanStr(v: unknown, max = 500): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

// ── Company profile ──────────────────────────────────────────────────────
const COMPANY_STRING_FIELDS: (keyof CompanyProfile)[] = [
  "companyName", "companyNameEn", "companyNameAr", "address", "phone", "email",
  "website", "registrationDetails", "taxDetails", "logoUrl", "stampUrl",
  "signatureUrl", "footerText",
];

export type CompanyProfileValidationResult =
  | { ok: true; profile: CompanyProfile }
  | { ok: false; error: string };

/**
 * Normalize a submitted company profile. Every field is optional (a
 * partially-filled profile is valid — MARAS can complete it over time), but
 * when present, companyName and email must be non-empty/well-formed. Unknown
 * keys are dropped; strings are trimmed and length-capped.
 */
export function validateCompanyProfile(input: unknown): CompanyProfileValidationResult {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const profile: CompanyProfile = {};
  for (const field of COMPANY_STRING_FIELDS) {
    const val = cleanStr(body[field], field === "footerText" || field === "address" ? 1000 : 500);
    if (val) (profile as Record<string, string>)[field] = val;
  }
  if (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) {
    return { ok: false, error: "Company email is not a valid email address." };
  }
  return { ok: true, profile };
}

// ── Bank accounts ────────────────────────────────────────────────────────
export type BankAccountValidationResult =
  | { ok: true; value: Omit<BankAccount, "id" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy"> }
  | { ok: false; error: string };

/**
 * Validate a bank-account payload. bankName, accountHolderName,
 * accountNumber, and a valid currency are required; IBAN/SWIFT/branch/etc.
 * are optional. `active` defaults to true; `isDefaultForCurrency` is a
 * request the caller resolves against the rest of the set (see
 * applyDefaultBankExclusivity).
 */
export function validateBankAccount(input: unknown): BankAccountValidationResult {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const bankName = cleanStr(body.bankName, 200);
  const accountHolderName = cleanStr(body.accountHolderName, 200);
  const accountNumber = cleanStr(body.accountNumber, 100);
  if (!bankName) return { ok: false, error: "Bank name is required." };
  if (!accountHolderName) return { ok: false, error: "Account holder name is required." };
  if (!accountNumber) return { ok: false, error: "Account number is required." };
  if (!isAllowedCurrency(body.currency)) {
    return { ok: false, error: "Bank account currency must be one of USD, IQD, TRY, EUR." };
  }
  return {
    ok: true,
    value: {
      bankName,
      accountHolderName,
      accountNumber,
      iban: cleanStr(body.iban, 60) || undefined,
      swift: cleanStr(body.swift, 40) || undefined,
      currency: body.currency,
      branch: cleanStr(body.branch, 200) || undefined,
      country: cleanStr(body.country, 100) || undefined,
      additionalInstructions: cleanStr(body.additionalInstructions, 1000) || undefined,
      active: body.active === undefined ? true : body.active === true,
      isDefaultForCurrency: body.isDefaultForCurrency === true,
    },
  };
}

/**
 * Enforce "at most one active default per currency". Given the full account
 * list and the account that was just made default for a currency, clears
 * the default flag on every OTHER account of that same currency. Returns a
 * NEW array (pure) — the caller persists the ones that changed.
 */
export function applyDefaultBankExclusivity(
  accounts: BankAccount[],
  defaultAccountId: string,
  currency: Currency
): BankAccount[] {
  return accounts.map((a) =>
    a.currency === currency && a.id !== defaultAccountId && a.isDefaultForCurrency
      ? { ...a, isDefaultForCurrency: false }
      : a
  );
}

/**
 * The bank account to suggest for a document in `currency`: the active
 * default for that currency if set, else the first active account of that
 * currency (deterministic by createdAt then id), else null. The authorized
 * user can always override the suggestion before issuing the document.
 */
export function resolveDefaultBankAccountForCurrency(
  accounts: BankAccount[],
  currency: Currency
): BankAccount | null {
  const active = accounts.filter((a) => a.active && a.currency === currency);
  if (active.length === 0) return null;
  const explicit = active.find((a) => a.isDefaultForCurrency);
  if (explicit) return explicit;
  return [...active].sort((a, b) =>
    (a.createdAt || "").localeCompare(b.createdAt || "") || a.id.localeCompare(b.id)
  )[0];
}

/** True when the profile has enough to brand a document (a company name). */
export function isCompanyProfileUsable(profile: CompanyProfile | null | undefined): boolean {
  return !!(profile && (profile.companyName || profile.companyNameEn));
}
