import { describe, it, expect, vi } from "vitest";
import {
  isSelfDeletableRole,
  resolveAccountCollectionName,
  requiresPasswordConfirmation,
  checkPasswordConfirmation,
  resolveOwnerProtectionCandidateRecord,
  isSelfDeletionBlockedByOwnerProtection,
  resolveAccountDeletionLookupOutcome,
  accountDeletionCopy,
} from "./accountDeletion";

describe("isSelfDeletableRole", () => {
  it("accepts driver, client, and admin", () => {
    expect(isSelfDeletableRole("driver")).toBe(true);
    expect(isSelfDeletableRole("client")).toBe(true);
    expect(isSelfDeletableRole("admin")).toBe(true);
  });

  it("rejects any other value without throwing", () => {
    expect(isSelfDeletableRole("vendor")).toBe(false);
    expect(isSelfDeletableRole(undefined)).toBe(false);
    expect(isSelfDeletableRole(null)).toBe(false);
    expect(isSelfDeletableRole(123)).toBe(false);
  });
});

describe("resolveAccountCollectionName", () => {
  it("maps each role to its exact Firestore collection", () => {
    expect(resolveAccountCollectionName("driver")).toBe("drivers");
    expect(resolveAccountCollectionName("client")).toBe("clients");
    expect(resolveAccountCollectionName("admin")).toBe("admins");
  });
});

describe("requiresPasswordConfirmation", () => {
  it("is true for a client/admin record with a stored password", () => {
    expect(requiresPasswordConfirmation("client", { password: "pbkdf2$abc$def" })).toBe(true);
    expect(requiresPasswordConfirmation("admin", { password: "pbkdf2$abc$def" })).toBe(true);
  });

  it("is false when the record has no stored password at all", () => {
    expect(requiresPasswordConfirmation("client", {})).toBe(false);
    expect(requiresPasswordConfirmation("client", null)).toBe(false);
    expect(requiresPasswordConfirmation("admin", undefined)).toBe(false);
  });

  it("is true for a username/password driver (a password on file, no verified Firebase identity)", () => {
    expect(requiresPasswordConfirmation("driver", { password: "pbkdf2$abc$def" })).toBe(true);
  });

  // Review follow-up (critical regression found in review): every driver
  // record gets SOME password hash from POST /api/drivers/self-register,
  // including Google Sign-In drivers, who get a random one they were
  // never shown (see that route's own comment) — `!!record.password`
  // alone is therefore never a safe signal for the driver role. A driver
  // with a VERIFIED firebaseUid (hasVerifiedFirebaseUid) must never be
  // asked for a password they don't know; their "recent authentication"
  // proof is the existing client-side Firebase reauthentication flow
  // instead (driverAccountDeletion.ts).
  it("is false for a Google-linked driver even though a (random, unknown) password hash exists on the record", () => {
    expect(
      requiresPasswordConfirmation("driver", { password: "pbkdf2$random$never-shown-to-user", firebaseUid: "firebase-uid-123" })
    ).toBe(false);
  });

  it("is true for a driver with no verified firebaseUid, even if one is claimed elsewhere on the record as an empty string", () => {
    expect(requiresPasswordConfirmation("driver", { password: "pbkdf2$abc$def", firebaseUid: "" })).toBe(true);
  });

  it("a client/admin record's firebaseUid (which should never exist, but defensively) does not affect the requirement", () => {
    expect(requiresPasswordConfirmation("client", { password: "hash", firebaseUid: "unexpected" } as any)).toBe(true);
  });
});

describe("checkPasswordConfirmation", () => {
  const alwaysTrue = () => true;
  const alwaysFalse = () => false;

  it("passes immediately when the record has no password to check", () => {
    expect(checkPasswordConfirmation("client", {}, undefined, alwaysFalse)).toEqual({ ok: true });
    expect(checkPasswordConfirmation("client", null, "anything", alwaysFalse)).toEqual({ ok: true });
  });

  it("passes immediately for a Google-linked driver, ignoring whatever was (or wasn't) submitted", () => {
    const googleDriver = { password: "pbkdf2$random$never-shown", firebaseUid: "uid-1" };
    expect(checkPasswordConfirmation("driver", googleDriver, undefined, alwaysFalse)).toEqual({ ok: true });
    expect(checkPasswordConfirmation("driver", googleDriver, "", alwaysFalse)).toEqual({ ok: true });
    expect(checkPasswordConfirmation("driver", googleDriver, "wrong-guess", alwaysFalse)).toEqual({ ok: true });
  });

  it("returns 400/missing when a password is required but none was submitted", () => {
    expect(checkPasswordConfirmation("client", { password: "hash" }, undefined, alwaysTrue)).toEqual({
      ok: false,
      status: 400,
      reason: "missing",
    });
    expect(checkPasswordConfirmation("client", { password: "hash" }, "", alwaysTrue)).toEqual({
      ok: false,
      status: 400,
      reason: "missing",
    });
    expect(checkPasswordConfirmation("admin", { password: "hash" }, 12345, alwaysTrue)).toEqual({
      ok: false,
      status: 400,
      reason: "missing",
    });
  });

  it("returns 401/incorrect when verify() rejects the submitted password", () => {
    expect(checkPasswordConfirmation("client", { password: "hash" }, "wrong", alwaysFalse)).toEqual({
      ok: false,
      status: 401,
      reason: "incorrect",
    });
  });

  it("passes when verify() accepts the submitted password", () => {
    expect(checkPasswordConfirmation("admin", { password: "hash" }, "correct", alwaysTrue)).toEqual({ ok: true });
  });

  it("a username/password driver still requires and verifies a password", () => {
    expect(checkPasswordConfirmation("driver", { password: "hash" }, undefined, alwaysTrue)).toEqual({
      ok: false,
      status: 400,
      reason: "missing",
    });
    expect(checkPasswordConfirmation("driver", { password: "hash" }, "correct", alwaysTrue)).toEqual({ ok: true });
  });

  it("calls verify() with exactly the submitted password and the record's stored hash", () => {
    const verify = vi.fn().mockReturnValue(true);
    checkPasswordConfirmation("client", { password: "the-stored-hash" }, "the-submitted-password", verify);
    expect(verify).toHaveBeenCalledWith("the-submitted-password", "the-stored-hash");
  });
});

describe("resolveOwnerProtectionCandidateRecord", () => {
  it("uses the real Firestore record when one exists", () => {
    const record = { email: "sub-admin@example.com", adminType: "operation" as const };
    expect(resolveOwnerProtectionCandidateRecord("admin-1", record)).toBe(record);
  });

  it("falls back to the session id as the candidate email when no record exists (the env-configured owner has no Firestore document)", () => {
    expect(resolveOwnerProtectionCandidateRecord("sardar@maras.iq", null)).toEqual({ email: "sardar@maras.iq" });
    expect(resolveOwnerProtectionCandidateRecord("sardar@maras.iq", undefined)).toEqual({ email: "sardar@maras.iq" });
  });
});

describe("isSelfDeletionBlockedByOwnerProtection", () => {
  const ownerEmail = "sardar@maras.iq";

  it("never blocks driver or client roles, regardless of record content", () => {
    expect(
      isSelfDeletionBlockedByOwnerProtection({
        role: "driver",
        sessionId: "sardar@maras.iq",
        existingRecord: { email: "sardar@maras.iq" },
        ownerEmail,
      })
    ).toBe(false);
    expect(
      isSelfDeletionBlockedByOwnerProtection({
        role: "client",
        sessionId: "sardar@maras.iq",
        existingRecord: { email: "sardar@maras.iq" },
        ownerEmail,
      })
    ).toBe(false);
  });

  it("blocks the real owner even though their session has no Firestore admins document at all", () => {
    expect(
      isSelfDeletionBlockedByOwnerProtection({
        role: "admin",
        sessionId: "sardar@maras.iq",
        existingRecord: null,
        ownerEmail,
      })
    ).toBe(true);
  });

  it("blocks any admin record whose email matches the owner email, case-insensitively", () => {
    expect(
      isSelfDeletionBlockedByOwnerProtection({
        role: "admin",
        sessionId: "admin-x",
        existingRecord: { email: "SARDAR@MARAS.IQ" },
        ownerEmail,
      })
    ).toBe(true);
  });

  it("blocks any admin record with adminType 'super', even if its email doesn't match (defense in depth)", () => {
    expect(
      isSelfDeletionBlockedByOwnerProtection({
        role: "admin",
        sessionId: "demo-owner",
        existingRecord: { email: "someone-else@example.com", adminType: "super" },
        ownerEmail,
      })
    ).toBe(true);
  });

  it("does NOT block a normal operation/accounts sub-admin — every app-created admin account can be deleted", () => {
    expect(
      isSelfDeletionBlockedByOwnerProtection({
        role: "admin",
        sessionId: "admin-42",
        existingRecord: { email: "ops@example.com", adminType: "operation" },
        ownerEmail,
      })
    ).toBe(false);
    expect(
      isSelfDeletionBlockedByOwnerProtection({
        role: "admin",
        sessionId: "admin-43",
        existingRecord: { email: "accts@example.com", adminType: "accounts" },
        ownerEmail,
      })
    ).toBe(false);
  });

  it("does not block a normal admin whose Firestore document is simply missing (already deleted, not the owner)", () => {
    expect(
      isSelfDeletionBlockedByOwnerProtection({
        role: "admin",
        sessionId: "admin-already-gone",
        existingRecord: null,
        ownerEmail,
      })
    ).toBe(false);
  });

  // Review follow-up: an existing-but-malformed/legacy admin record with
  // no `email` field at all is a plausible real state (an admin doc
  // written before some field existed), distinct from "no record found"
  // above — isProtectedOwnerAccount's own `!!email` guard should fall
  // through to "not protected" here (unless adminType is 'super'), never
  // throw or misbehave on the missing field.
  it("does not block an existing admin record with no email field and no adminType", () => {
    expect(
      isSelfDeletionBlockedByOwnerProtection({
        role: "admin",
        sessionId: "admin-legacy",
        existingRecord: {},
        ownerEmail,
      })
    ).toBe(false);
  });

  it("still blocks an existing admin record with no email field if its adminType is 'super' (defense in depth)", () => {
    expect(
      isSelfDeletionBlockedByOwnerProtection({
        role: "admin",
        sessionId: "admin-legacy-super",
        existingRecord: { adminType: "super" },
        ownerEmail,
      })
    ).toBe(true);
  });
});

describe("resolveAccountDeletionLookupOutcome", () => {
  const ownerEmail = "sardar@maras.iq";

  it("owner-protected takes priority: the real owner's missing record is never treated as already-deleted", () => {
    const outcome = resolveAccountDeletionLookupOutcome({
      role: "admin",
      sessionId: "sardar@maras.iq",
      recordExists: false,
      existingRecord: null,
      ownerEmail,
    });
    expect(outcome).toEqual({ ownerProtected: true, alreadyDeleted: false });
  });

  it("a normal admin whose record no longer exists is idempotently already-deleted, not owner-protected", () => {
    const outcome = resolveAccountDeletionLookupOutcome({
      role: "admin",
      sessionId: "admin-1",
      recordExists: false,
      existingRecord: null,
      ownerEmail,
    });
    expect(outcome).toEqual({ ownerProtected: false, alreadyDeleted: true });
  });

  it("an existing normal admin record is neither owner-protected nor already-deleted", () => {
    const outcome = resolveAccountDeletionLookupOutcome({
      role: "admin",
      sessionId: "admin-1",
      recordExists: true,
      existingRecord: { email: "ops@example.com", adminType: "operation", password: "hash" },
      ownerEmail,
    });
    expect(outcome).toEqual({ ownerProtected: false, alreadyDeleted: false });
  });

  it("the owner's EXISTING record (if one somehow exists) is still owner-protected, not treated as a normal deletable record", () => {
    const outcome = resolveAccountDeletionLookupOutcome({
      role: "admin",
      sessionId: "sardar@maras.iq",
      recordExists: true,
      existingRecord: { email: "sardar@maras.iq", adminType: "super" },
      ownerEmail,
    });
    expect(outcome).toEqual({ ownerProtected: true, alreadyDeleted: false });
  });

  it("driver/client missing records are always idempotently already-deleted (no owner concept)", () => {
    expect(
      resolveAccountDeletionLookupOutcome({
        role: "driver",
        sessionId: "driver-1",
        recordExists: false,
        existingRecord: null,
        ownerEmail,
      })
    ).toEqual({ ownerProtected: false, alreadyDeleted: true });
    expect(
      resolveAccountDeletionLookupOutcome({
        role: "client",
        sessionId: "client-1",
        recordExists: false,
        existingRecord: null,
        ownerEmail,
      })
    ).toEqual({ ownerProtected: false, alreadyDeleted: true });
  });

  it("driver/client existing records are neither owner-protected nor already-deleted", () => {
    expect(
      resolveAccountDeletionLookupOutcome({
        role: "driver",
        sessionId: "driver-1",
        recordExists: true,
        existingRecord: { password: "hash" },
        ownerEmail,
      })
    ).toEqual({ ownerProtected: false, alreadyDeleted: false });
  });
});

describe("accountDeletionCopy", () => {
  it("returns distinct, non-empty copy for en, tr, and ar", () => {
    const en = accountDeletionCopy("en");
    const tr = accountDeletionCopy("tr");
    const ar = accountDeletionCopy("ar");
    for (const copy of [en, tr, ar]) {
      expect(copy.sectionTitle.length).toBeGreaterThan(0);
      expect(copy.privacyNotice.length).toBeGreaterThan(0);
      expect(copy.missingPasswordError.length).toBeGreaterThan(0);
      expect(copy.incorrectPasswordError.length).toBeGreaterThan(0);
      expect(copy.rateLimitedError.length).toBeGreaterThan(0);
      expect(copy.ownerProtectedError.length).toBeGreaterThan(0);
      expect(copy.serviceUnavailableError.length).toBeGreaterThan(0);
      expect(copy.genericFailureError.length).toBeGreaterThan(0);
      expect(copy.successMessage.length).toBeGreaterThan(0);
    }
    expect(en.sectionTitle).not.toBe(tr.sectionTitle);
    expect(en.sectionTitle).not.toBe(ar.sectionTitle);
    expect(tr.sectionTitle).not.toBe(ar.sectionTitle);
  });

  it("falls back to English for an unrecognized language", () => {
    expect(accountDeletionCopy("fr" as any)).toEqual(accountDeletionCopy("en"));
  });

  it("uses the exact specced privacy-notice wording for each language", () => {
    expect(accountDeletionCopy("en").privacyNotice).toBe(
      "Deleting your account permanently removes your login and personal profile. This action cannot be undone. Certain shipment, invoice, accounting, security, and legal records may be retained in anonymized form where required."
    );
    expect(accountDeletionCopy("ar").privacyNotice).toBe(
      "يؤدي حذف حسابك إلى إزالة تسجيل الدخول والملف الشخصي نهائيًا، ولا يمكن التراجع عن هذا الإجراء. قد يتم الاحتفاظ ببعض سجلات الشحن والفواتير والمحاسبة والأمان والسجلات القانونية بصورة مجهولة عند الضرورة."
    );
    expect(accountDeletionCopy("tr").privacyNotice).toBe(
      "Hesabınızı silmek, giriş bilgilerinizi ve kişisel profilinizi kalıcı olarak kaldırır. Bu işlem geri alınamaz. Gerekli durumlarda bazı sevkiyat, fatura, muhasebe, güvenlik ve yasal kayıtlar anonimleştirilmiş olarak saklanabilir."
    );
  });
});
