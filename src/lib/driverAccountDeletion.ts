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
  | "firebase_identity_deletion_failed";

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

export interface DriverAccountDeletionDeps {
  /** True if there is a live Firebase Auth session to delete (false for username/password-only drivers). */
  hasCurrentUser: () => boolean;
  /** Firebase client SDK's `auth.currentUser.delete()`. */
  deleteCurrentUser: () => Promise<void>;
  /** Reauthenticates the current Firebase user via the same Google mechanism already used to sign in. */
  reauthenticate: () => Promise<void>;
}

export type FirebaseIdentityDeletionResult =
  | { ok: true }
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
    // Username/password-only driver — no Firebase Auth identity ever
    // existed, so there is nothing left to delete. The backend Firestore
    // delete (already done by the caller) is sufficient on its own.
    return { ok: true };
  }

  try {
    await deps.deleteCurrentUser();
    return { ok: true };
  } catch (err: any) {
    const code = err?.code as string | undefined;

    if (isAlreadyDeletedError(code)) {
      return { ok: true };
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
      return { ok: true };
    } catch (retryErr: any) {
      if (isAlreadyDeletedError(retryErr?.code)) {
        return { ok: true };
      }
      return { ok: false, state: "firebase_identity_deletion_failed" };
    }
  }
}

export interface DriverAccountDeletionCopy {
  backendFailure: string;
  reauthenticationRequired: string;
  firebaseIdentityDeletionFailed: string;
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
    completeSuccess: "🗑️ تم حذف الحساب بالكامل من السجل الرسمي.",
    retryButton: "إعادة المحاولة",
    logOutButton: "تسجيل الخروج",
  },
};

export function driverAccountDeletionCopy(lang: "en" | "tr" | "ar"): DriverAccountDeletionCopy {
  return COPY[lang] || COPY.en;
}
