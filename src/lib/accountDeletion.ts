/**
 * accountDeletion.ts
 *
 * Apple Guideline 5.1.1(v) compliance — consolidated in-app self-service
 * account deletion for every account type that can be created in this app
 * (driver, client/customer, staff/admin), backing DELETE /api/account
 * (server.ts).
 *
 * Before this file existed, each role had its own separate, inconsistent
 * self-delete path: Driver (DELETE /api/drivers/:id, the most complete —
 * see driverAccountDeletion.ts) had server-side Firebase Auth identity
 * cleanup and a retry token; Client (DELETE /api/clients/:id) and Admin
 * (DELETE /api/admins/:id) had neither push-token nor notification-
 * preference cleanup, and Admin additionally hid the delete control
 * entirely for `adminType === 'super'` with no way to even attempt it —
 * exactly the kind of "hide the button for the reviewer's demo account"
 * behavior Apple's guideline does not accept. DELETE /api/account is the
 * one, consolidated self-service entry point for all three roles: it
 * always deletes the CALLER'S OWN account (id/role only ever come from the
 * verified session, never the request body), reuses
 * selectPushTokensForAccountDeletion (pushTokenAccess.ts) and, for
 * drivers, every existing Firebase-identity helper in
 * driverAccountDeletion.ts unchanged. This file holds only the decision
 * logic that is genuinely NEW for this consolidated endpoint — pure and
 * unit-tested so the trickiest parts (owner protection when the owner has
 * no Firestore document at all, and idempotent-retry semantics) don't
 * depend on booting Express or Firestore to verify.
 *
 * DELETE /api/drivers/:id, DELETE /api/clients/:id, and DELETE
 * /api/admins/:id are all left unchanged — those remain the ADMIN-
 * MANAGEMENT deletion paths (an admin removing someone else's account
 * from a roster), a genuinely different operation from this file's
 * self-service scope, and out of scope for the Apple 5.1.1(v) fix this
 * file exists for.
 */
import type { AdminType } from "./adminAccess";
import { isProtectedOwnerAccount } from "./adminAccess";
import { hasVerifiedFirebaseUid } from "./driverAccountDeletion";

export type SelfDeletableRole = "driver" | "client" | "admin";

/** Every role DELETE /api/account is willing to act on. Any other session role (there are none today) is rejected before any of this file's logic runs. */
export function isSelfDeletableRole(role: unknown): role is SelfDeletableRole {
  return role === "driver" || role === "client" || role === "admin";
}

export function resolveAccountCollectionName(role: SelfDeletableRole): "drivers" | "clients" | "admins" {
  if (role === "driver") return "drivers";
  if (role === "client") return "clients";
  return "admins";
}

export interface PasswordConfirmationRecord {
  password?: string;
  firebaseUid?: string;
}

/**
 * Whether DELETE /api/account must require & verify a `currentPassword`
 * in the request body before proceeding.
 *
 * Review follow-up (critical): this is NOT simply "does the record have a
 * stored password hash." POST /api/drivers/self-register (server.ts)
 * unconditionally sets a password hash on every driver record it
 * creates — including Google Sign-In drivers, who get a random,
 * never-shown-to-the-user value (see that route's own comment) purely
 * because the Driver schema's `password` field predates Google Sign-In
 * support. Gating on `!!record.password` alone would therefore ALWAYS
 * require a password from a Google-linked driver too, one they were
 * never given and can never supply — a hard, permanent dead end for
 * exactly the users this Apple 5.1.1(v) fix must not lock out.
 *
 * The correct signal for a driver is whether they have a VERIFIED
 * Firebase identity on file (hasVerifiedFirebaseUid, set only by
 * POST /api/verify-session after adminAuth.verifyIdToken cryptographically
 * confirms it — never a guess): if so, their "recent authentication"
 * proof is the existing client-side Firebase reauthentication flow
 * (driverAccountDeletion.ts's deleteFirebaseIdentityWithRetry), which
 * runs as part of the very same delete flow, not a password. Client and
 * Admin accounts never have a firebaseUid at all (they never sign in via
 * Firebase — see Client's own type definition), so this only ever changes
 * behavior for the driver role.
 */
export function requiresPasswordConfirmation(
  role: SelfDeletableRole,
  record: PasswordConfirmationRecord | null | undefined
): boolean {
  if (!record?.password) return false;
  if (role === "driver" && hasVerifiedFirebaseUid(record)) return false;
  return true;
}

export type PasswordConfirmationResult =
  | { ok: true }
  | { ok: false; status: 400; reason: "missing" }
  | { ok: false; status: 401; reason: "incorrect" };

/**
 * The actual gate DELETE /api/account applies before any destructive
 * write, once the target record is known not to be owner-protected.
 * `verify` is injected (rather than this function importing
 * verifyPassword itself) purely so the branching here is unit-testable
 * without pbkdf2 in the loop — server.ts passes the real verifyPassword.
 */
export function checkPasswordConfirmation(
  role: SelfDeletableRole,
  record: PasswordConfirmationRecord | null | undefined,
  submittedPassword: unknown,
  verify: (plain: string, stored: string | undefined) => boolean
): PasswordConfirmationResult {
  if (!requiresPasswordConfirmation(role, record)) return { ok: true };
  if (typeof submittedPassword !== "string" || submittedPassword.length === 0) {
    return { ok: false, status: 400, reason: "missing" };
  }
  if (!verify(submittedPassword, record?.password)) {
    return { ok: false, status: 401, reason: "incorrect" };
  }
  return { ok: true };
}

export interface OwnerProtectionCandidateRecord {
  email?: string;
  adminType?: AdminType;
}

/**
 * The record isProtectedOwnerAccount (adminAccess.ts) should evaluate for
 * this session — accounting for the one case where "no Firestore
 * document" does NOT mean "nothing to protect": the env-configured root
 * super-admin (SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD_HASH) has no
 * `admins` Firestore document at all (see resolveChatSenderIdentity's own
 * super-admin branch, server.ts — that account's session id IS its email,
 * set directly from SUPER_ADMIN_EMAIL at login, never backed by a
 * document). Without this fallback, that account's DELETE /api/account
 * call would hit "record not found" and take the idempotent
 * already-deleted success path below — reporting success while having
 * deleted nothing, since the real identity lives in an env var no
 * Firestore operation can touch. Any OTHER missing admin record (a normal
 * sub-admin already deleted, or one that never existed) has no such
 * fallback identity and correctly falls through to "nothing to protect."
 */
export function resolveOwnerProtectionCandidateRecord(
  sessionId: string,
  existingRecord: OwnerProtectionCandidateRecord | null | undefined
): OwnerProtectionCandidateRecord {
  return existingRecord || { email: sessionId };
}

export interface OwnerProtectionCheckInput {
  role: SelfDeletableRole;
  sessionId: string;
  existingRecord: OwnerProtectionCandidateRecord | null | undefined;
  ownerEmail: string;
}

/**
 * Owner protection only ever applies to the admin role — driver and
 * client accounts have no "sole platform owner" concept. Reuses
 * isProtectedOwnerAccount (adminAccess.ts) unchanged — the same function
 * DELETE /api/admins/:id already relies on — rather than a second,
 * potentially-diverging definition of "who is the owner."
 */
export function isSelfDeletionBlockedByOwnerProtection(input: OwnerProtectionCheckInput): boolean {
  if (input.role !== "admin") return false;
  const candidate = resolveOwnerProtectionCandidateRecord(input.sessionId, input.existingRecord);
  return isProtectedOwnerAccount(candidate, input.ownerEmail);
}

export interface AccountDeletionLookupOutcome {
  /** True: this session may never complete self-deletion through this endpoint. The route must return 403 and MUST NOT delete anything, regardless of recordExists. */
  ownerProtected: boolean;
  /**
   * True: there is nothing left to delete — either a genuine idempotent
   * retry (a prior call already succeeded) or an account that never had a
   * Firestore document to begin with. The route should skip straight to
   * the (harmless, best-effort) push-token cleanup and report success,
   * never attempting a password check against a record that doesn't
   * exist.
   */
  alreadyDeleted: boolean;
}

/**
 * The single decision DELETE /api/account makes immediately after its
 * pre-delete lookup, combining owner protection with idempotent-retry
 * detection so the two can never be evaluated in the wrong order (owner
 * protection must always be checked using resolveOwnerProtectionCandidateRecord's
 * fallback BEFORE "not found" is ever treated as "already deleted" — see
 * that function's own header comment for why getting this order wrong is
 * a real, dangerous bug for the env-configured owner specifically).
 */
export function resolveAccountDeletionLookupOutcome(input: {
  role: SelfDeletableRole;
  sessionId: string;
  recordExists: boolean;
  existingRecord: (OwnerProtectionCandidateRecord & { password?: string }) | null | undefined;
  ownerEmail: string;
}): AccountDeletionLookupOutcome {
  const ownerProtected = isSelfDeletionBlockedByOwnerProtection({
    role: input.role,
    sessionId: input.sessionId,
    existingRecord: input.recordExists ? input.existingRecord : null,
    ownerEmail: input.ownerEmail,
  });
  return {
    ownerProtected,
    alreadyDeleted: !ownerProtected && !input.recordExists,
  };
}

export interface AccountDeletionCopy {
  sectionTitle: string;
  privacyNotice: string;
  passwordLabel: string;
  passwordPlaceholder: string;
  missingPasswordError: string;
  incorrectPasswordError: string;
  rateLimitedError: string;
  ownerProtectedError: string;
  serviceUnavailableError: string;
  genericFailureError: string;
  networkFailureError: string;
  successMessage: string;
  deletingLabel: string;
}

/**
 * Shared copy for the pieces of the delete-account flow that must read
 * identically across all three roles (the exact privacy notice text this
 * fix was specced with, plus the generic error/success states every
 * role's UI wires into its own existing confirmation dialog). Each role's
 * dialog keeps its own existing title/button wording — only these shared
 * strings are centralized, so the three UIs don't silently drift on the
 * wording that actually carries legal/compliance meaning.
 */
const COPY: Record<"en" | "tr" | "ar", AccountDeletionCopy> = {
  en: {
    sectionTitle: "Delete Account",
    privacyNotice:
      "Deleting your account permanently removes your login and personal profile. This action cannot be undone. Certain shipment, invoice, accounting, security, and legal records may be retained in anonymized form where required.",
    passwordLabel: "Current Password",
    passwordPlaceholder: "Enter your current password to confirm",
    missingPasswordError: "Your current password is required to delete your account.",
    incorrectPasswordError: "Current password is incorrect.",
    rateLimitedError: "Too many attempts. Please wait a few minutes and try again.",
    ownerProtectedError:
      "This account is the platform's sole owner identity and cannot be deleted through the app. Every other account you create can be deleted here in full.",
    serviceUnavailableError: "Account deletion is temporarily unavailable. Please try again shortly.",
    genericFailureError: "Failed to delete your account. Your account was NOT deleted — please try again.",
    networkFailureError: "Could not reach the server. Please check your connection and try again.",
    successMessage: "🗑️ Your account was permanently deleted.",
    deletingLabel: "Deleting…",
  },
  tr: {
    sectionTitle: "Hesabı Sil",
    privacyNotice:
      "Hesabınızı silmek, giriş bilgilerinizi ve kişisel profilinizi kalıcı olarak kaldırır. Bu işlem geri alınamaz. Gerekli durumlarda bazı sevkiyat, fatura, muhasebe, güvenlik ve yasal kayıtlar anonimleştirilmiş olarak saklanabilir.",
    passwordLabel: "Mevcut Şifre",
    passwordPlaceholder: "Onaylamak için mevcut şifrenizi girin",
    missingPasswordError: "Hesabınızı silmek için mevcut şifreniz gereklidir.",
    incorrectPasswordError: "Mevcut şifre yanlış.",
    rateLimitedError: "Çok fazla deneme yapıldı. Lütfen birkaç dakika bekleyip tekrar deneyin.",
    ownerProtectedError:
      "Bu hesap platformun tek sahip kimliğidir ve uygulama üzerinden silinemez. Oluşturduğunuz diğer tüm hesaplar burada tamamen silinebilir.",
    serviceUnavailableError: "Hesap silme işlemi geçici olarak kullanılamıyor. Lütfen kısa süre sonra tekrar deneyin.",
    genericFailureError: "Hesabınız silinemedi. Hesabınız SİLİNMEDİ — lütfen tekrar deneyin.",
    networkFailureError: "Sunucuya ulaşılamadı. Lütfen bağlantınızı kontrol edip tekrar deneyin.",
    successMessage: "🗑️ Hesabınız kalıcı olarak silindi.",
    deletingLabel: "Siliniyor…",
  },
  ar: {
    sectionTitle: "حذف الحساب",
    privacyNotice:
      "يؤدي حذف حسابك إلى إزالة تسجيل الدخول والملف الشخصي نهائيًا، ولا يمكن التراجع عن هذا الإجراء. قد يتم الاحتفاظ ببعض سجلات الشحن والفواتير والمحاسبة والأمان والسجلات القانونية بصورة مجهولة عند الضرورة.",
    passwordLabel: "كلمة المرور الحالية",
    passwordPlaceholder: "أدخل كلمة المرور الحالية للتأكيد",
    missingPasswordError: "كلمة المرور الحالية مطلوبة لحذف حسابك.",
    incorrectPasswordError: "كلمة المرور الحالية غير صحيحة.",
    rateLimitedError: "محاولات كثيرة جدًا. يرجى الانتظار بضع دقائق ثم إعادة المحاولة.",
    ownerProtectedError:
      "هذا الحساب هو هوية المالك الوحيد للمنصة ولا يمكن حذفه عبر التطبيق. يمكن حذف أي حساب آخر تنشئه بالكامل من هنا.",
    serviceUnavailableError: "خدمة حذف الحساب غير متاحة مؤقتًا. يرجى المحاولة مرة أخرى بعد قليل.",
    genericFailureError: "تعذر حذف حسابك. لم يتم حذف حسابك — يرجى المحاولة مرة أخرى.",
    networkFailureError: "تعذر الوصول إلى الخادم. يرجى التحقق من اتصالك والمحاولة مرة أخرى.",
    successMessage: "🗑️ تم حذف حسابك نهائيًا.",
    deletingLabel: "جارٍ الحذف…",
  },
};

export function accountDeletionCopy(lang: "en" | "tr" | "ar"): AccountDeletionCopy {
  return COPY[lang] || COPY.en;
}
