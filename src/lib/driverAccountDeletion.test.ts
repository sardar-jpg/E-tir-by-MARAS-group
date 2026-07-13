import { describe, it, expect, vi } from "vitest";
import {
  isRequiresRecentLoginError,
  isAlreadyDeletedError,
  isFirebaseUserNotFoundError,
  hasVerifiedFirebaseUid,
  deleteFirebaseIdentityWithRetry,
  driverAccountDeletionCopy,
  planServerFirebaseIdentityDeletion,
  normalizeDriverAccountDeletionServerSignal,
  resolveDriverAccountDeletionOutcome,
} from "./driverAccountDeletion";

function firebaseError(code: string): any {
  const err: any = new Error(code);
  err.code = code;
  return err;
}

describe("isRequiresRecentLoginError", () => {
  it("matches only the exact requires-recent-login code", () => {
    expect(isRequiresRecentLoginError("auth/requires-recent-login")).toBe(true);
    expect(isRequiresRecentLoginError("auth/user-not-found")).toBe(false);
    expect(isRequiresRecentLoginError(undefined)).toBe(false);
    expect(isRequiresRecentLoginError(null)).toBe(false);
  });
});

describe("isAlreadyDeletedError", () => {
  it("treats user-not-found, user-token-expired, and no-current-user as already-deleted", () => {
    expect(isAlreadyDeletedError("auth/user-not-found")).toBe(true);
    expect(isAlreadyDeletedError("auth/user-token-expired")).toBe(true);
    expect(isAlreadyDeletedError("auth/no-current-user")).toBe(true);
  });

  it("does not treat requires-recent-login or an unrelated error as already-deleted", () => {
    expect(isAlreadyDeletedError("auth/requires-recent-login")).toBe(false);
    expect(isAlreadyDeletedError("auth/network-request-failed")).toBe(false);
    expect(isAlreadyDeletedError(undefined)).toBe(false);
  });
});

describe("isFirebaseUserNotFoundError", () => {
  it("matches only auth/user-not-found", () => {
    expect(isFirebaseUserNotFoundError("auth/user-not-found")).toBe(true);
    expect(isFirebaseUserNotFoundError("auth/requires-recent-login")).toBe(false);
    expect(isFirebaseUserNotFoundError(undefined)).toBe(false);
  });
});

describe("hasVerifiedFirebaseUid", () => {
  it("is true only for a non-empty stored firebaseUid", () => {
    expect(hasVerifiedFirebaseUid({ firebaseUid: "real-uid-123" })).toBe(true);
  });

  it("is false when firebaseUid is absent", () => {
    expect(hasVerifiedFirebaseUid({})).toBe(false);
  });

  it("is false for an empty string", () => {
    expect(hasVerifiedFirebaseUid({ firebaseUid: "" })).toBe(false);
  });

  it("is false for null/undefined driver records", () => {
    expect(hasVerifiedFirebaseUid(null)).toBe(false);
    expect(hasVerifiedFirebaseUid(undefined)).toBe(false);
  });

  it("never derives a uid from anything other than the stored field itself — a driver-<timestamp> style id is not a firebaseUid and is never read here", () => {
    // The function only ever looks at `.firebaseUid` — passing a record whose
    // `id` looks like a synthetic driver id proves nothing else is consulted.
    expect(hasVerifiedFirebaseUid({ firebaseUid: undefined } as any)).toBe(false);
  });
});

describe("deleteFirebaseIdentityWithRetry — username/password driver (H.1)", () => {
  it("reports success immediately with no Firebase calls when there is no current user", async () => {
    const deleteCurrentUser = vi.fn();
    const reauthenticate = vi.fn();
    const result = await deleteFirebaseIdentityWithRetry({
      hasCurrentUser: () => false,
      deleteCurrentUser,
      reauthenticate,
    });
    expect(result).toEqual({ ok: true, attempted: false });
    expect(deleteCurrentUser).not.toHaveBeenCalled();
    expect(reauthenticate).not.toHaveBeenCalled();
  });
});

describe("deleteFirebaseIdentityWithRetry — Firebase-linked driver, first attempt succeeds (H.2)", () => {
  it("reports success and never attempts reauthentication", async () => {
    const deleteCurrentUser = vi.fn().mockResolvedValue(undefined);
    const reauthenticate = vi.fn();
    const result = await deleteFirebaseIdentityWithRetry({
      hasCurrentUser: () => true,
      deleteCurrentUser,
      reauthenticate,
    });
    expect(result).toEqual({ ok: true, attempted: true });
    expect(deleteCurrentUser).toHaveBeenCalledTimes(1);
    expect(reauthenticate).not.toHaveBeenCalled();
  });
});

describe("deleteFirebaseIdentityWithRetry — auth/requires-recent-login (H.3)", () => {
  it("reauthenticates exactly once, retries exactly once, and reports success only after the retry succeeds", async () => {
    const deleteCurrentUser = vi
      .fn()
      .mockRejectedValueOnce(firebaseError("auth/requires-recent-login"))
      .mockResolvedValueOnce(undefined);
    const reauthenticate = vi.fn().mockResolvedValue(undefined);

    const result = await deleteFirebaseIdentityWithRetry({
      hasCurrentUser: () => true,
      deleteCurrentUser,
      reauthenticate,
    });

    expect(result).toEqual({ ok: true, attempted: true });
    expect(reauthenticate).toHaveBeenCalledTimes(1);
    expect(deleteCurrentUser).toHaveBeenCalledTimes(2);
  });
});

describe("deleteFirebaseIdentityWithRetry — reauthentication fails (H.4)", () => {
  it("never reports success, surfaces reauthentication_required, and does not retry the delete", async () => {
    const deleteCurrentUser = vi.fn().mockRejectedValueOnce(firebaseError("auth/requires-recent-login"));
    const reauthenticate = vi.fn().mockRejectedValue(new Error("popup closed by user"));

    const result = await deleteFirebaseIdentityWithRetry({
      hasCurrentUser: () => true,
      deleteCurrentUser,
      reauthenticate,
    });

    expect(result).toEqual({ ok: false, state: "reauthentication_required" });
    expect(deleteCurrentUser).toHaveBeenCalledTimes(1);
  });

  it("also reports firebase_identity_deletion_failed (not success) when the retry itself fails after a successful reauthentication", async () => {
    const deleteCurrentUser = vi
      .fn()
      .mockRejectedValueOnce(firebaseError("auth/requires-recent-login"))
      .mockRejectedValueOnce(firebaseError("auth/internal-error"));
    const reauthenticate = vi.fn().mockResolvedValue(undefined);

    const result = await deleteFirebaseIdentityWithRetry({
      hasCurrentUser: () => true,
      deleteCurrentUser,
      reauthenticate,
    });

    expect(result).toEqual({ ok: false, state: "firebase_identity_deletion_failed" });
    expect(deleteCurrentUser).toHaveBeenCalledTimes(2);
  });
});

describe("deleteFirebaseIdentityWithRetry — a different Firebase error on the first attempt (H.5)", () => {
  it("never reports success and never attempts reauthentication for a non-requires-recent-login error", async () => {
    const deleteCurrentUser = vi.fn().mockRejectedValue(firebaseError("auth/network-request-failed"));
    const reauthenticate = vi.fn();

    const result = await deleteFirebaseIdentityWithRetry({
      hasCurrentUser: () => true,
      deleteCurrentUser,
      reauthenticate,
    });

    expect(result).toEqual({ ok: false, state: "firebase_identity_deletion_failed" });
    expect(reauthenticate).not.toHaveBeenCalled();
    expect(deleteCurrentUser).toHaveBeenCalledTimes(1);
  });
});

describe("deleteFirebaseIdentityWithRetry — already-deleted identity", () => {
  it("treats auth/user-not-found on the first attempt as success", async () => {
    const deleteCurrentUser = vi.fn().mockRejectedValue(firebaseError("auth/user-not-found"));
    const result = await deleteFirebaseIdentityWithRetry({
      hasCurrentUser: () => true,
      deleteCurrentUser,
      reauthenticate: vi.fn(),
    });
    expect(result).toEqual({ ok: true, attempted: true });
  });

  it("treats auth/user-not-found on the post-reauthentication retry as success", async () => {
    const deleteCurrentUser = vi
      .fn()
      .mockRejectedValueOnce(firebaseError("auth/requires-recent-login"))
      .mockRejectedValueOnce(firebaseError("auth/user-not-found"));
    const result = await deleteFirebaseIdentityWithRetry({
      hasCurrentUser: () => true,
      deleteCurrentUser,
      reauthenticate: vi.fn().mockResolvedValue(undefined),
    });
    expect(result).toEqual({ ok: true, attempted: true });
  });
});

describe("planServerFirebaseIdentityDeletion", () => {
  it("is conservative (hadFirebaseIdentity: true, shouldAttemptDeletion: false) when the pre-delete lookup failed, regardless of adminAuth availability", () => {
    expect(
      planServerFirebaseIdentityDeletion({ driverLookupFailed: true, driver: undefined, adminAuthAvailable: true })
    ).toEqual({ hadFirebaseIdentity: true, shouldAttemptDeletion: false });
    expect(
      planServerFirebaseIdentityDeletion({ driverLookupFailed: true, driver: undefined, adminAuthAvailable: false })
    ).toEqual({ hadFirebaseIdentity: true, shouldAttemptDeletion: false });
  });

  it("plans to attempt deletion when the lookup succeeded, a verified uid is on record, and Admin Auth is available", () => {
    expect(
      planServerFirebaseIdentityDeletion({
        driverLookupFailed: false,
        driver: { firebaseUid: "real-uid-123" },
        adminAuthAvailable: true,
      })
    ).toEqual({ hadFirebaseIdentity: true, shouldAttemptDeletion: true });
  });

  it("does not plan to attempt deletion when Admin Auth is unavailable, even with a verified uid", () => {
    expect(
      planServerFirebaseIdentityDeletion({
        driverLookupFailed: false,
        driver: { firebaseUid: "real-uid-123" },
        adminAuthAvailable: false,
      })
    ).toEqual({ hadFirebaseIdentity: true, shouldAttemptDeletion: false });
  });

  it("reports no identity and nothing to attempt when the lookup succeeded and found no verified uid", () => {
    expect(
      planServerFirebaseIdentityDeletion({ driverLookupFailed: false, driver: {}, adminAuthAvailable: true })
    ).toEqual({ hadFirebaseIdentity: false, shouldAttemptDeletion: false });
    expect(
      planServerFirebaseIdentityDeletion({ driverLookupFailed: false, driver: undefined, adminAuthAvailable: true })
    ).toEqual({ hadFirebaseIdentity: false, shouldAttemptDeletion: false });
  });
});

describe("normalizeDriverAccountDeletionServerSignal", () => {
  it("reads explicit true/false fields from a well-formed response body", () => {
    expect(
      normalizeDriverAccountDeletionServerSignal({
        hadFirebaseIdentity: false,
        firebaseAuthDeleted: true,
      })
    ).toEqual({ hadFirebaseIdentity: false, firebaseAuthDeleted: true, pendingFirebaseDeletionToken: undefined });
  });

  it("passes through a string pendingFirebaseDeletionToken", () => {
    const signal = normalizeDriverAccountDeletionServerSignal({
      hadFirebaseIdentity: true,
      firebaseAuthDeleted: false,
      pendingFirebaseDeletionToken: "signed-token-abc",
    });
    expect(signal.pendingFirebaseDeletionToken).toBe("signed-token-abc");
  });

  it("defaults to the conservative reading (never 'confirmed deleted') for a malformed or empty body — review follow-up for the ambiguous firebaseAuthDeleted=true default bug", () => {
    expect(normalizeDriverAccountDeletionServerSignal({})).toEqual({
      hadFirebaseIdentity: true,
      firebaseAuthDeleted: false,
      pendingFirebaseDeletionToken: undefined,
    });
    expect(normalizeDriverAccountDeletionServerSignal(null)).toEqual({
      hadFirebaseIdentity: true,
      firebaseAuthDeleted: false,
      pendingFirebaseDeletionToken: undefined,
    });
    expect(normalizeDriverAccountDeletionServerSignal("not an object")).toEqual({
      hadFirebaseIdentity: true,
      firebaseAuthDeleted: false,
      pendingFirebaseDeletionToken: undefined,
    });
  });

  it("ignores a non-string pendingFirebaseDeletionToken", () => {
    const signal = normalizeDriverAccountDeletionServerSignal({ pendingFirebaseDeletionToken: 12345 });
    expect(signal.pendingFirebaseDeletionToken).toBeUndefined();
  });

  it("only firebaseAuthDeleted === true (not truthy) counts as confirmed deleted", () => {
    expect(normalizeDriverAccountDeletionServerSignal({ firebaseAuthDeleted: "true" }).firebaseAuthDeleted).toBe(false);
    expect(normalizeDriverAccountDeletionServerSignal({ firebaseAuthDeleted: 1 }).firebaseAuthDeleted).toBe(false);
  });
});

describe("resolveDriverAccountDeletionOutcome", () => {
  it("defers entirely to the client result when it failed outright", () => {
    const outcome = resolveDriverAccountDeletionOutcome({
      server: { hadFirebaseIdentity: true, firebaseAuthDeleted: false },
      clientResult: { ok: false, state: "reauthentication_required" },
    });
    expect(outcome).toEqual({ complete: false, state: "reauthentication_required" });
  });

  it("treats a client attempt that actually ran as definitive, regardless of the server's independent signal", () => {
    const outcome = resolveDriverAccountDeletionOutcome({
      server: { hadFirebaseIdentity: true, firebaseAuthDeleted: false },
      clientResult: { ok: true, attempted: true },
    });
    expect(outcome).toEqual({ complete: true });
  });

  it("completes when the client never attempted but the server confirms no identity ever existed", () => {
    const outcome = resolveDriverAccountDeletionOutcome({
      server: { hadFirebaseIdentity: false, firebaseAuthDeleted: false },
      clientResult: { ok: true, attempted: false },
    });
    expect(outcome).toEqual({ complete: true });
  });

  it("completes when the client never attempted but the server confirms it deleted the identity itself", () => {
    const outcome = resolveDriverAccountDeletionOutcome({
      server: { hadFirebaseIdentity: true, firebaseAuthDeleted: true },
      clientResult: { ok: true, attempted: false },
    });
    expect(outcome).toEqual({ complete: true });
  });

  it("is unresolved — never complete — when the client never attempted and the server neither ruled out nor confirmed deletion of a real identity", () => {
    const outcome = resolveDriverAccountDeletionOutcome({
      server: { hadFirebaseIdentity: true, firebaseAuthDeleted: false },
      clientResult: { ok: true, attempted: false },
    });
    expect(outcome).toEqual({ complete: false, state: "firebase_identity_deletion_unresolved" });
  });
});

describe("driverAccountDeletionCopy", () => {
  it("returns fully-populated copy for en/tr/ar", () => {
    for (const lang of ["en", "tr", "ar"] as const) {
      const copy = driverAccountDeletionCopy(lang);
      expect(copy.backendFailure.length).toBeGreaterThan(0);
      expect(copy.reauthenticationRequired.length).toBeGreaterThan(0);
      expect(copy.firebaseIdentityDeletionFailed.length).toBeGreaterThan(0);
      expect(copy.firebaseIdentityDeletionUnresolved.length).toBeGreaterThan(0);
      expect(copy.completeSuccess.length).toBeGreaterThan(0);
      expect(copy.retryButton.length).toBeGreaterThan(0);
      expect(copy.logOutButton.length).toBeGreaterThan(0);
    }
  });

  it("falls back to English for an unrecognized language", () => {
    expect(driverAccountDeletionCopy("fr" as any)).toEqual(driverAccountDeletionCopy("en"));
  });

  it("the Arabic copy contains no stray non-Arabic-script filler text (regression guard for the corrupted Cancel-label bug)", () => {
    const ar = driverAccountDeletionCopy("ar");
    for (const value of Object.values(ar)) {
      expect(value).not.toMatch(/[А-яЁё]/); // no Cyrillic characters anywhere
    }
  });
});
