/**
 * driverAccountDeletion.ts
 *
 * Apple Guideline 5.1.1(v) fix for the Driver "Delete My Account" flow
 * (DriverApplication.tsx). Previously, `auth.currentUser.delete()` failures
 * (most commonly `auth/requires-recent-login`) were caught and silently
 * logged, while the UI still showed a "completely deleted" success message
 * and logged the user out — leaving the Firebase Authentication identity
 * alive despite the claimed permanent deletion.
 *
 * The async orchestration below is deliberately dependency-injected
 * (`DriverAccountDeletionDeps`) rather than calling `auth`/Firebase directly,
 * so the retry/error-classification logic is unit-testable without a real
 * Firebase project. DriverApplication.tsx supplies the real
 * `auth.currentUser` / `reauthenticateDriverWithGoogle` bindings.
 *
 * Ordering (matches the safer of the two options — see the audit): the
 * backend Firestore delete (which is what actually makes the account
 * unusable, since every login path is gated on that record) always happens
 * first, in the calling component, BEFORE any of this module's logic runs.
 * This module only ever governs the second, best-effort step: removing the
 * Firebase Authentication identity itself.
 */

export type DriverAccountDeletionState =
  | "idle"
  | "complete_success"
  | "backend_failure"
  | "reauthentication_required"
  | "firebase_identity_deletion_failed"
  // Review follow-up: distinct from firebase_identity_deletion_failed —
  // this covers the case where the client had no live Firebase session to
  // even attempt a delete with (so it never saw a concrete error) AND the
  // server's own backstop attempt did not confirm the identity is gone.
  // Neither side can currently prove the Firebase Auth identity is
  // deleted, so this must never be treated as complete_success.
  | "firebase_identity_deletion_unresolved";

/**
 * Firebase Auth error codes meaning "there is no live identity left to
 * delete" — treated as success, not failure, so a retry (or a second delete
 * attempt after the backend already asked the Admin SDK to remove it) never
 * gets stuck reporting an error for an account that is, in fact, already
 * fully gone.
 */
const ALREADY_DELETED_CODES = new Set([
  "auth/user-not-found",
  "auth/user-token-expired",
  "auth/no-current-user",
]);

export function isRequiresRecentLoginError(code: string | null | undefined): boolean {
  return code === "auth/requires-recent-login";
}

export function isAlreadyDeletedError(code: string | null | undefined): boolean {
  return !!code && ALREADY_DELETED_CODES.has(code);
}

export interface DriverRecordForFirebaseDeletion {
  firebaseUid?: string;
}

/**
 * Server-side gate for DELETE /api/drivers/:id: whether a Firebase Auth
 * deletion should even be attempted for this driver record. True only when
 * a non-empty, previously-verified `firebaseUid` is actually stored on the
 * record (see Driver.firebaseUid / POST /api/verify-session, the only
 * place it's ever written, always from a cryptographically-verified
 * adminAuth.verifyIdToken result). This is the single choke point that
 * guarantees a synthetic `driver-<timestamp>` id, an email, a username, or
 * a session id is never mistaken for — or passed as — a Firebase uid.
 */
export function hasVerifiedFirebaseUid(
  driver: DriverRecordForFirebaseDeletion | null | undefined
): boolean {
  return typeof driver?.firebaseUid === "string" && driver.firebaseUid.length > 0;
}

/** Firebase Admin SDK's error code for "no such user" — deleting an already-gone user is success, not failure. */
export function isFirebaseUserNotFoundError(code: string | null | undefined): boolean {
  return code === "auth/user-not-found";
}

export interface ServerFirebaseIdentityDeletionPlan {
  /**
   * True unless the pre-delete driver lookup succeeded and confirmed there
   * was no verified firebaseUid on record. When the lookup itself failed,
   * this is deliberately true (never false) — an unreadable record must
   * never be treated as "confirmed no identity to delete", since that
   * would let a real, undeleted Firebase Auth identity slip through as a
   * false negative.
   */
  hadFirebaseIdentity: boolean;
  /** True only when there is both a confirmed uid to delete AND the Admin SDK is actually available to attempt it with. */
  shouldAttemptDeletion: boolean;
}

/**
 * Server-side planning step for DELETE /api/drivers/:id, extracted as a
 * pure function so the "what do we know, and should we even try" decision
 * is unit-testable without Firebase Admin or Firestore. Review follow-up:
 * the previous inline version defaulted `firebaseAuthDeleted` to `true`
 * whenever the pre-delete lookup failed — indistinguishable from "confirmed
 * nothing to delete". This makes that case explicit instead.
 */
export function planServerFirebaseIdentityDeletion(input: {
  driverLookupFailed: boolean;
  driver: DriverRecordForFirebaseDeletion | null | undefined;
  adminAuthAvailable: boolean;
}): ServerFirebaseIdentityDeletionPlan {
  const hadFirebaseIdentity = input.driverLookupFailed ? true : hasVerifiedFirebaseUid(input.driver);
  return {
    hadFirebaseIdentity,
    shouldAttemptDeletion: hadFirebaseIdentity && !input.driverLookupFailed && input.adminAuthAvailable,
  };
}

export interface DriverAccountDeletionDeps {
  /** True if there is a live Firebase Auth session to delete (false for username/password-only drivers). */
  hasCurrentUser: () => boolean;
  /** Firebase client SDK's `auth.currentUser.delete()`. */
  deleteCurrentUser: () => Promise<void>;
  /** Reauthenticates the current Firebase user via the same Google mechanism already used to sign in. */
  reauthenticate: () => Promise<void>;
}

export type FirebaseIdentityDeletionResult =
  // `attempted` distinguishes "a real deleteCurrentUser() call ran and
  // confirmed the identity is gone" (true) from "there was no live
  // Firebase session on this device to even try with" (false) — the
  // second case tells the caller nothing about whether a Firebase Auth
  // identity actually still exists server-side, so it must not be treated
  // as equivalent proof of deletion. See resolveDriverAccountDeletionOutcome.
  | { ok: true; attempted: boolean }
  | { ok: false; state: "reauthentication_required" | "firebase_identity_deletion_failed" };

/**
 * Deletes the Firebase Authentication identity for the current user, with
 * exactly one reauthenticate-and-retry attempt when (and only when) the
 * first attempt fails with `auth/requires-recent-login`. Any other failure
 * — including a failed reauthentication, or the retry itself failing — is
 * reported back, never silently swallowed and never reported as success.
 */
export async function deleteFirebaseIdentityWithRetry(
  deps: DriverAccountDeletionDeps
): Promise<FirebaseIdentityDeletionResult> {
  if (!deps.hasCurrentUser()) {
    // No live Firebase session on this device — either a username/
    // password-only driver (no Firebase Auth identity ever existed), or a
    // Google-linked driver whose local Firebase session has simply expired
    // or not restored. This function alone cannot tell those two apart;
    // the caller must combine this with the server's own signal (see
    // resolveDriverAccountDeletionOutcome) before ever reporting success.
    return { ok: true, attempted: false };
  }

  try {
    await deps.deleteCurrentUser();
    return { ok: true, attempted: true };
  } catch (err: any) {
    const code = err?.code as string | undefined;

    if (isAlreadyDeletedError(code)) {
      return { ok: true, attempted: true };
    }

    if (!isRequiresRecentLoginError(code)) {
      return { ok: false, state: "firebase_identity_deletion_failed" };
    }

    try {
      await deps.reauthenticate();
    } catch {
      return { ok: false, state: "reauthentication_required" };
    }

    try {
      await deps.deleteCurrentUser();
      return { ok: true, attempted: true };
    } catch (retryErr: any) {
      if (isAlreadyDeletedError(retryErr?.code)) {
        return { ok: true, attempted: true };
      }
      return { ok: false, state: "firebase_identity_deletion_failed" };
    }
  }
}

export interface DriverAccountDeletionServerSignal {
  /** From DELETE /api/drivers/:id's response body — see planServerFirebaseIdentityDeletion. */
  hadFirebaseIdentity: boolean;
  firebaseAuthDeleted: boolean;
  /**
   * Opaque, signed, short-lived token letting a later Retry call
   * POST /api/drivers/finish-firebase-deletion to resume the server-side
   * Admin SDK deletion attempt using the verified uid captured before the
   * Firestore driver record was removed — needed because that record (and
   * its firebaseUid field) no longer exists to look up. Present only when
   * there was a verified identity whose deletion wasn't yet confirmed.
   * This is a purpose-built capability token, not a Driver field — it is
   * never displayed and carries no broader exposure than the driver's own
   * already-known Google sign-in.
   */
  pendingFirebaseDeletionToken?: string;
}

/**
 * Safely parses DELETE /api/drivers/:id's response body. Conservative on
 * anything missing/malformed: an unreadable or unexpected body must never
 * be interpreted as "confirmed deleted" (review follow-up — the previous
 * version's ambiguous `true` default is exactly the bug this replaces).
 */
export function normalizeDriverAccountDeletionServerSignal(body: unknown): DriverAccountDeletionServerSignal {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  return {
    hadFirebaseIdentity: b.hadFirebaseIdentity !== false,
    firebaseAuthDeleted: b.firebaseAuthDeleted === true,
    pendingFirebaseDeletionToken: typeof b.pendingFirebaseDeletionToken === "string" ? b.pendingFirebaseDeletionToken : undefined,
  };
}

/**
 * Combines the client's own Firebase-delete attempt with the server's
 * independent signal into the single, final deletion outcome. This is the
 * fix for the review's critical finding: previously, a client with no live
 * Firebase session (`attempted: false`) reported success unconditionally,
 * even when the server's backstop attempt had failed. Now:
 *   - a client attempt that actually ran (`attempted: true`) is
 *     definitive, whatever the server independently reported — it just
 *     deleted (or confirmed already-deleted) the very identity in question.
 *   - a client attempt that never ran defers entirely to the server: only
 *     "confirmed no identity existed" or "confirmed deleted" counts as
 *     complete. Anything else is unresolved, never success.
 */
export function resolveDriverAccountDeletionOutcome(input: {
  server: DriverAccountDeletionServerSignal;
  clientResult: FirebaseIdentityDeletionResult;
}):
  | { complete: true }
  | { complete: false; state: "reauthentication_required" | "firebase_identity_deletion_failed" | "firebase_identity_deletion_unresolved" } {
  const { server, clientResult } = input;

  if (!clientResult.ok) {
    return { complete: false, state: clientResult.state };
  }

  if (clientResult.attempted) {
    return { complete: true };
  }

  if (!server.hadFirebaseIdentity || server.firebaseAuthDeleted) {
    return { complete: true };
  }

  return { complete: false, state: "firebase_identity_deletion_unresolved" };
}

export interface DriverAccountDeletionCopy {
  backendFailure: string;
  reauthenticationRequired: string;
  firebaseIdentityDeletionFailed: string;
  /**
   * Shown for the "unresolved" state (review follow-up): the Driver record
   * and its data are already gone, but neither this device nor the server
   * has confirmed the linked Firebase sign-in identity was deleted. Must
   * tell the user to retry now, in-app, without pointing them at support
   * as the completion path — Retry is the actual completion path.
   */
  firebaseIdentityDeletionUnresolved: string;
  completeSuccess: string;
  retryButton: string;
  logOutButton: string;
}

const COPY: Record<"en" | "tr" | "ar", DriverAccountDeletionCopy> = {
  en: {
    backendFailure: "Failed to initiate account purge. Your account was NOT deleted — please try again.",
    reauthenticationRequired:
      "Your driver profile was removed, but we need you to confirm your Google sign-in again to finish removing it completely. Tap Retry.",
    firebaseIdentityDeletionFailed:
      "Your driver profile was removed, but we could not finish removing your linked Google sign-in. Tap Retry to try again.",
    firebaseIdentityDeletionUnresolved:
      "Your driver account and data have been removed, but we still need to finish deleting your sign-in identity. Please tap Retry now — don't close the app until this completes.",
    completeSuccess: "🗑️ Account completely deleted from corporate registry.",
    retryButton: "Retry",
    logOutButton: "Log Out",
  },
  tr: {
    backendFailure: "Hesap silme işlemi başlatılamadı. Hesabınız SİLİNMEDİ — lütfen tekrar deneyin.",
    reauthenticationRequired:
      "Sürücü profiliniz kaldırıldı, ancak tamamen kaldırmak için Google girişinizi tekrar onaylamanız gerekiyor. Tekrar Dene'ye dokunun.",
    firebaseIdentityDeletionFailed:
      "Sürücü profiliniz kaldırıldı, ancak bağlı Google girişinizi tamamen kaldıramadık. Tekrar denemek için dokunun.",
    firebaseIdentityDeletionUnresolved:
      "Sürücü hesabınız ve verileriniz kaldırıldı, ancak oturum açma kimliğinizin silinmesini tamamlamamız gerekiyor. Lütfen şimdi Tekrar Dene'ye dokunun — bu işlem tamamlanana kadar uygulamayı kapatmayın.",
    completeSuccess: "🗑️ Hesap kurumsal kayıttan tamamen silindi.",
    retryButton: "Tekrar Dene",
    logOutButton: "Çıkış Yap",
  },
  ar: {
    backendFailure: "تعذر بدء حذف الحساب. لم يتم حذف حسابك — يرجى المحاولة مرة أخرى.",
    reauthenticationRequired:
      "تمت إزالة ملف السائق الخاص بك، لكننا نحتاج إلى تأكيد تسجيل دخولك عبر Google مرة أخرى لإكمال الإزالة بالكامل. اضغط على إعادة المحاولة.",
    firebaseIdentityDeletionFailed:
      "تمت إزالة ملف السائق الخاص بك، لكن تعذر إكمال إزالة تسجيل دخول Google المرتبط به. اضغط لإعادة المحاولة.",
    firebaseIdentityDeletionUnresolved:
      "تمت إزالة حساب السائق وبياناتك، لكن لا يزال يتعين علينا إكمال حذف هوية تسجيل الدخول الخاصة بك. يرجى الضغط على إعادة المحاولة الآن — لا تغلق التطبيق حتى تكتمل هذه العملية.",
    completeSuccess: "🗑️ تم حذف الحساب بالكامل من السجل الرسمي.",
    retryButton: "إعادة المحاولة",
    logOutButton: "تسجيل الخروج",
  },
};

export function driverAccountDeletionCopy(lang: "en" | "tr" | "ar"): DriverAccountDeletionCopy {
  return COPY[lang] || COPY.en;
}
