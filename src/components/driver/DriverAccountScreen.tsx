import { useEffect, useRef, useState } from "react";
import {
  ArrowRight, Camera, Check, Edit2, Globe, Loader2, LogOut, Megaphone, Moon,
  Phone, Route, Shield, ShieldAlert, Sun, Trash2, Truck, User, X,
} from "lucide-react";
import type { Driver, Language } from "../../types";
import { TRUCK_TYPES } from "../../types";
import { apiFetch } from "../../lib/api";
import { auth, reauthenticateDriverWithGoogle } from "../../googleAuth";
import {
  deleteFirebaseIdentityWithRetry,
  driverAccountDeletionCopy,
  normalizeDriverAccountDeletionServerSignal,
  resolveDriverAccountDeletionOutcome,
  type DriverAccountDeletionState,
} from "../../lib/driverAccountDeletion";
import { accountDeletionCopy } from "../../lib/accountDeletion";
import PrivacyPolicyModal from "../PrivacyPolicyModal";
import { SCREEN_TITLE } from "./driverUi";

/**
 * feature/driver-app-comprehensive-redesign — one Account screen merging
 * the old separate Profile and Menu tabs: profile + truck details,
 * language, appearance, privacy, logout, and account deletion. All copy
 * is plain operational language — no developer or infrastructure
 * jargon. The deletion flow is the existing protected workflow moved
 * here unchanged in behavior:
 *
 * Apple Guideline 5.1.1(v). Ordering: the backend Firestore delete runs
 * first (that's what actually makes the account unusable, since every
 * login path is gated on that record — see POST /api/login and
 * /api/verify-session in server.ts), then the Firebase Authentication
 * identity is removed. "Complete success" (and logout) is only ever
 * reported once BOTH steps are done; a Firebase-side failure (including
 * auth/requires-recent-login) is never silently swallowed and never
 * reported as success — see deleteFirebaseIdentityWithRetry.
 */
const LABELS: Record<Language, {
  title: string;
  profile: string;
  fullName: string;
  username: string;
  phone: string;
  truck: string;
  truckNumber: string;
  truckType: string;
  edit: string;
  cancel: string;
  save: string;
  saving: string;
  saved: string;
  photoUpdated: string;
  changePhoto: string;
  settings: string;
  offersToggle: string;
  offersOn: string;
  offersOff: string;
  statusOnHome: string;
  routes: string;
  routesEmpty: string;
  routesManaged: string;
  language: string;
  appearance: string;
  lightMode: string;
  darkMode: string;
  privacy: string;
  privacySub: string;
  logout: string;
  deleteTitle: string;
  deleteButton: string;
  deleteWarning: string;
  deleteConsent: string;
  confirmDelete: string;
  keepAccount: string;
}> = {
  en: {
    title: "Profile",
    profile: "Profile",
    fullName: "Full name",
    username: "Username",
    phone: "Phone",
    truck: "Truck",
    truckNumber: "Plate number",
    truckType: "Truck type",
    edit: "Edit profile",
    cancel: "Cancel",
    save: "Save changes",
    saving: "Saving…",
    saved: "Profile updated.",
    photoUpdated: "Profile photo updated.",
    changePhoto: "Change photo",
    settings: "Settings",
    offersToggle: "Available for Offers",
    offersOn: "On — you receive transport offers",
    offersOff: "Off — no transport offers",
    statusOnHome: "Change on Home",
    routes: "Registered routes",
    routesEmpty: "No routes registered yet.",
    routesManaged: "Routes are managed by MARAS Operations.",
    language: "Language",
    appearance: "Appearance",
    lightMode: "Light — for daylight",
    darkMode: "Dark — for night driving",
    privacy: "Privacy policy",
    privacySub: "How your data is used",
    logout: "Log out",
    deleteTitle: "Delete account",
    deleteButton: "Delete my account",
    deleteWarning: "This cannot be undone. Your account, job history, and access will be permanently removed.",
    deleteConsent: "I understand my account will be permanently deleted.",
    confirmDelete: "Delete permanently",
    keepAccount: "Keep my account",
  },
  tr: {
    title: "Profil",
    profile: "Profil",
    fullName: "Ad Soyad",
    username: "Kullanıcı adı",
    phone: "Telefon",
    truck: "Araç",
    truckNumber: "Plaka numarası",
    truckType: "Araç tipi",
    edit: "Profili düzenle",
    cancel: "İptal",
    save: "Değişiklikleri kaydet",
    saving: "Kaydediliyor…",
    saved: "Profil güncellendi.",
    photoUpdated: "Profil fotoğrafı güncellendi.",
    changePhoto: "Fotoğrafı değiştir",
    settings: "Ayarlar",
    offersToggle: "Tekliflere Açık",
    offersOn: "Açık — taşıma teklifleri alırsınız",
    offersOff: "Kapalı — taşıma teklifi gelmez",
    statusOnHome: "Ana Sayfa'dan değiştirin",
    routes: "Kayıtlı güzergahlar",
    routesEmpty: "Henüz kayıtlı güzergah yok.",
    routesManaged: "Güzergahlar MARAS Operasyon tarafından yönetilir.",
    language: "Dil",
    appearance: "Görünüm",
    lightMode: "Açık — gün ışığı için",
    darkMode: "Koyu — gece sürüşü için",
    privacy: "Gizlilik politikası",
    privacySub: "Verilerinizin nasıl kullanıldığı",
    logout: "Çıkış yap",
    deleteTitle: "Hesabı sil",
    deleteButton: "Hesabımı sil",
    deleteWarning: "Bu işlem geri alınamaz. Hesabınız, sefer geçmişiniz ve erişiminiz kalıcı olarak silinir.",
    deleteConsent: "Hesabımın kalıcı olarak silineceğini anlıyorum.",
    confirmDelete: "Kalıcı olarak sil",
    keepAccount: "Hesabımı koru",
  },
  ar: {
    title: "الملف الشخصي",
    profile: "الملف الشخصي",
    fullName: "الاسم الكامل",
    username: "اسم المستخدم",
    phone: "الهاتف",
    truck: "الشاحنة",
    truckNumber: "رقم اللوحة",
    truckType: "نوع الشاحنة",
    edit: "تعديل الملف الشخصي",
    cancel: "إلغاء",
    save: "حفظ التغييرات",
    saving: "جارٍ الحفظ…",
    saved: "تم تحديث الملف الشخصي.",
    photoUpdated: "تم تحديث الصورة الشخصية.",
    changePhoto: "تغيير الصورة",
    settings: "الإعدادات",
    offersToggle: "متاح لعروض النقل",
    offersOn: "مفعّل — تصلك عروض النقل",
    offersOff: "متوقف — لا تصلك عروض النقل",
    statusOnHome: "غيّره من الرئيسية",
    routes: "المسارات المسجلة",
    routesEmpty: "لا توجد مسارات مسجلة بعد.",
    routesManaged: "تُدار المسارات من قبل عمليات MARAS.",
    language: "اللغة",
    appearance: "المظهر",
    lightMode: "فاتح — لضوء النهار",
    darkMode: "داكن — للقيادة الليلية",
    privacy: "سياسة الخصوصية",
    privacySub: "كيف تُستخدم بياناتك",
    logout: "تسجيل الخروج",
    deleteTitle: "حذف الحساب",
    deleteButton: "حذف حسابي",
    deleteWarning: "لا يمكن التراجع عن هذا الإجراء. سيتم حذف حسابك وسجل مهامك وصلاحية دخولك نهائياً.",
    deleteConsent: "أفهم أن حسابي سيُحذف نهائياً.",
    confirmDelete: "حذف نهائي",
    keepAccount: "الاحتفاظ بحسابي",
  },
};

interface DriverAccountScreenProps {
  lang: Language;
  driverId: string;
  driver: Driver | null;
  theme: "light" | "dark";
  onThemeChange: (theme: "light" | "dark") => void;
  onLanguageChange?: (lang: Language) => void;
  onLogout?: () => void;
  onDriverUpdated: (driver: Driver) => void;
  onToast: (msg: string) => void;
}

export default function DriverAccountScreen({
  lang,
  driverId,
  driver,
  theme,
  onThemeChange,
  onLanguageChange,
  onLogout,
  onDriverUpdated,
  onToast,
}: DriverAccountScreenProps) {
  const t = LABELS[lang] ?? LABELS.en;

  // ── Profile state ──
  const [profileName, setProfileName] = useState("");
  const [profileUsername, setProfileUsername] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [profileTruckNumber, setProfileTruckNumber] = useState("");
  const [profileTruckType, setProfileTruckType] = useState("reefer");
  const [profileAvatarUrl, setProfileAvatarUrl] = useState("");
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
  const avatarFileRef = useRef<HTMLInputElement>(null);

  const syncFromDriver = () => {
    if (!driver) return;
    setProfileName(driver.name || "");
    setProfileUsername(driver.username || "");
    setProfilePhone(driver.phone || "");
    setProfileTruckNumber(driver.truckNumber || "");
    setProfileTruckType(driver.truckType || "reefer");
    setProfileAvatarUrl(driver.avatarUrl || "");
  };

  useEffect(() => {
    syncFromDriver();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.id, driver?.name, driver?.username, driver?.phone, driver?.truckNumber, driver?.truckType, driver?.avatarUrl]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileName.trim()) return;
    setIsSavingProfile(true);
    try {
      const res = await apiFetch(`/api/drivers/${driverId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profileName,
          username: profileUsername,
          phone: profilePhone,
          truckNumber: profileTruckNumber,
          truckType: profileTruckType,
          avatarUrl: profileAvatarUrl,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        onDriverUpdated(updated);
        onToast(t.saved);
        setIsEditingProfile(false);
      } else {
        let msg = "Failed to update profile. Please try again.";
        try { msg = (await res.json())?.error || msg; } catch {}
        onToast(`❌ ${msg}`);
      }
    } catch (err) {
      console.error(err);
      onToast("❌ Could not reach the server. Please check your connection and try again.");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleUploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setIsUploadingAvatar(true);
    try {
      const base64DataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (evt) => resolve(evt.target?.result as string);
        reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });

      // Upload via the server, which writes durably to Firebase Storage
      // itself (see /api/upload in server.ts) — Storage requires the
      // server's own dedicated account (see storage.rules).
      const uploadRes = await apiFetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64DataUrl, filename: file.name }),
      });
      if (!uploadRes.ok) {
        onToast("❌ Photo upload failed. Please try again.");
        return;
      }
      const uploadData = await uploadRes.json();
      setProfileAvatarUrl(uploadData.url);

      const res = await apiFetch(`/api/drivers/${driverId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: uploadData.url }),
      });
      if (res.ok) {
        const updated = await res.json();
        onDriverUpdated(updated);
        onToast(t.photoUpdated);
      } else {
        onToast("❌ Photo uploaded but couldn't be saved to your profile. Please try again.");
      }
    } catch (err) {
      console.error("Avatar upload failed:", err);
      onToast("❌ Photo upload failed. Please try again.");
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  // ── Availability status (Driver Quote Requests) ──
  // Read-only here: the interactive "Available for Offers" switch lives
  // on Home (one tap away at all times). Absent counts as available, so
  // legacy profiles stay opted in — the same convention matching uses.
  const offersEnabled = driver?.availableForOffers !== false;

  // ── Account deletion state (existing protected workflow) ──
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [understandDelete, setUnderstandDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletionState, setDeletionState] = useState<DriverAccountDeletionState>("idle");
  // Set once the backend Firestore record is confirmed gone, so a Retry
  // tap (after a Firebase-identity-only failure) skips straight to the
  // Firebase step instead of calling the backend delete a second time.
  const [backendRecordDeleted, setBackendRecordDeleted] = useState(false);
  // Signed capability token from DELETE /api/account (or a subsequent
  // finish-firebase-deletion response), letting Retry resume the
  // server-side Firebase deletion attempt when this device has no live
  // Firebase session to retry with itself. Only ever set from a server
  // response — never fabricated client-side.
  const [pendingFirebaseDeletionToken, setPendingFirebaseDeletionToken] = useState<string | null>(null);
  // DELETE /api/account requires the caller's current password for any
  // account that has one on file — a Google Sign-In driver
  // (auth.currentUser truthy) never set a local password at all, so the
  // field is only shown/required for username/password drivers.
  const [deleteCurrentPassword, setDeleteCurrentPassword] = useState("");
  const [deletePasswordStepError, setDeletePasswordStepError] = useState<
    null | "missing" | "incorrect" | "rate_limited" | "service_unavailable" | "generic"
  >(null);

  const applyDeletionOutcome = (
    outcome: ReturnType<typeof resolveDriverAccountDeletionOutcome>,
    serverToken: string | undefined
  ) => {
    if (outcome.complete) {
      setDeletionState("complete_success");
      setPendingFirebaseDeletionToken(null);
      onToast(driverAccountDeletionCopy(lang).completeSuccess);
      setShowDeleteConfirm(false);
      // Logout user session and clean state — only once every required
      // deletion step has actually completed.
      if (onLogout) onLogout();
      return;
    }

    setDeletionState(outcome.state);
    if (outcome.state === "firebase_identity_deletion_unresolved") {
      // A fresh server response's own token (possibly absent) always
      // wins; otherwise preserve whatever token is already stored rather
      // than clobbering a still-valid one with null on a retry path that
      // made no new server round-trip.
      setPendingFirebaseDeletionToken((prev) => (serverToken !== undefined ? serverToken : prev));
    } else {
      setPendingFirebaseDeletionToken(null);
    }
    const copy = driverAccountDeletionCopy(lang);
    onToast(
      outcome.state === "reauthentication_required"
        ? copy.reauthenticationRequired
        : outcome.state === "firebase_identity_deletion_unresolved"
        ? copy.firebaseIdentityDeletionUnresolved
        : copy.firebaseIdentityDeletionFailed
    );
    // Deliberately do NOT close the confirmation panel or log out here —
    // the backend record is already gone, but the Firebase identity isn't
    // confirmed deleted, so the user needs the Retry affordance to stay
    // visible instead of a false "complete" signal.
  };

  const handleDeleteAccount = async () => {
    if (!understandDelete) return;
    if (isDeleting) return; // in-flight guard — no double-submit
    setIsDeleting(true);
    setDeletePasswordStepError(null);
    try {
      let serverBody: unknown = {};
      if (!backendRecordDeleted) {
        // DELETE /api/account derives the target from the verified
        // session — never a client-supplied id — so this always deletes
        // the caller's own driver account.
        const response = await apiFetch("/api/account", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentPassword: deleteCurrentPassword }),
        });
        if (!response.ok) {
          if (response.status === 400) setDeletePasswordStepError("missing");
          else if (response.status === 401) setDeletePasswordStepError("incorrect");
          else if (response.status === 429) setDeletePasswordStepError("rate_limited");
          else if (response.status === 503) setDeletePasswordStepError("service_unavailable");
          else setDeletePasswordStepError("generic");
          return;
        }
        serverBody = await response.json().catch(() => ({}));
        setBackendRecordDeleted(true);
        // Never keep a submitted password in memory longer than the one
        // request that needed it.
        setDeleteCurrentPassword("");
      }

      const server = normalizeDriverAccountDeletionServerSignal(serverBody);
      const clientResult = await deleteFirebaseIdentityWithRetry({
        hasCurrentUser: () => !!auth.currentUser,
        deleteCurrentUser: () => auth.currentUser!.delete(),
        reauthenticate: reauthenticateDriverWithGoogle,
      });

      applyDeletionOutcome(
        resolveDriverAccountDeletionOutcome({ server, clientResult }),
        server.pendingFirebaseDeletionToken
      );
    } catch (err) {
      console.error(err);
      // backendRecordDeleted is only true once the Firestore delete is
      // confirmed done — an exception past that point is a
      // Firebase-identity problem, not a backend one, so it must not be
      // mislabeled as "your account was not deleted".
      if (backendRecordDeleted) {
        setDeletionState("firebase_identity_deletion_failed");
        onToast(driverAccountDeletionCopy(lang).firebaseIdentityDeletionFailed);
      } else {
        setDeletePasswordStepError("generic");
        onToast(accountDeletionCopy(lang).networkFailureError);
      }
    } finally {
      setIsDeleting(false);
    }
  };

  // Resumes the Firebase identity deletion server-side when there is no
  // live Firebase session on this device to retry with — relies entirely
  // on the signed pendingFirebaseDeletionToken rather than a fresh lookup.
  const handleFinishFirebaseDeletion = async () => {
    if (isDeleting) return;
    if (!pendingFirebaseDeletionToken) {
      onToast(driverAccountDeletionCopy(lang).firebaseIdentityDeletionUnresolved);
      return;
    }
    setIsDeleting(true);
    try {
      const response = await apiFetch("/api/drivers/finish-firebase-deletion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: pendingFirebaseDeletionToken }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        onToast(driverAccountDeletionCopy(lang).firebaseIdentityDeletionUnresolved);
        return;
      }
      const server = normalizeDriverAccountDeletionServerSignal(body);
      applyDeletionOutcome(
        resolveDriverAccountDeletionOutcome({ server, clientResult: { ok: true, attempted: false } }),
        server.pendingFirebaseDeletionToken
      );
    } catch (err) {
      console.error(err);
      onToast(accountDeletionCopy(lang).networkFailureError);
    } finally {
      setIsDeleting(false);
    }
  };

  const initials = (profileName || "DR")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const truckTypeLabel = (() => {
    const matched = TRUCK_TYPES.find((tt) => tt.id === profileTruckType);
    if (!matched) return profileTruckType;
    return lang === "en" ? matched.en : lang === "tr" ? matched.tr : matched.ar;
  })();

  return (
    <div className="space-y-4 animate-fade-in pb-4">
      <h2 className={SCREEN_TITLE}>{t.title}</h2>

      {/* ── Profile card ── */}
      <section className="bg-slate-900 border border-slate-800/60 rounded-3xl p-5 space-y-4">
        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            <div className="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center text-white font-bold text-lg border-2 border-slate-800 bg-slate-800">
              {isUploadingAvatar ? (
                <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
              ) : profileAvatarUrl ? (
                <img src={profileAvatarUrl} alt={profileName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-full h-full bg-orange-500 flex items-center justify-center light-preserve">{initials}</div>
              )}
            </div>
            <input type="file" ref={avatarFileRef} accept="image/*" className="hidden" onChange={handleUploadAvatar} />
            <button
              type="button"
              onClick={() => avatarFileRef.current?.click()}
              disabled={isUploadingAvatar}
              aria-label={t.changePhoto}
              className="absolute -bottom-1 -end-1 w-8 h-8 rounded-full bg-slate-950 border border-slate-700 text-orange-500 flex items-center justify-center cursor-pointer active:scale-95"
            >
              <Camera className="w-4 h-4" />
            </button>
          </div>
          <div className="min-w-0 text-start">
            <h3 className="text-lg font-bold text-white truncate tracking-tight">{profileName || "—"}</h3>
            <p className="text-sm text-slate-400 truncate">@{profileUsername || "driver"}</p>
            <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-bold text-slate-200 bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 tabular-nums">
              <Truck className="w-3.5 h-3.5 shrink-0 text-slate-500" />
              <span className="truncate">{profileTruckNumber || "—"}</span>
            </p>
          </div>
        </div>

        {!isEditingProfile ? (
          <>
            <dl className="space-y-0 text-sm">
              {[
                { icon: User, label: t.fullName, value: profileName },
                { icon: Phone, label: t.phone, value: profilePhone },
                { icon: Truck, label: t.truckNumber, value: profileTruckNumber },
                { icon: Truck, label: t.truckType, value: truckTypeLabel },
              ].map((row, i) => (
                <div key={row.label} className={`flex items-center justify-between gap-3 py-2.5 ${i > 0 ? "border-t border-slate-800/60" : ""}`}>
                  <dt className="text-slate-500 flex items-center gap-2 shrink-0">
                    <row.icon className="w-4 h-4" />
                    {row.label}
                  </dt>
                  <dd className="font-semibold text-slate-200 text-end truncate selectable">{row.value || "—"}</dd>
                </div>
              ))}
            </dl>
            <button
              type="button"
              onClick={() => setIsEditingProfile(true)}
              className="w-full min-h-[48px] bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-200 font-bold text-sm rounded-2xl transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
            >
              <Edit2 className="w-4 h-4 shrink-0" />
              <span>{t.edit}</span>
            </button>
          </>
        ) : (
          <form onSubmit={handleSaveProfile} className="space-y-3">
            {[
              { label: t.fullName, value: profileName, set: setProfileName },
              { label: t.username, value: profileUsername, set: setProfileUsername },
              { label: t.phone, value: profilePhone, set: setProfilePhone },
              { label: t.truckNumber, value: profileTruckNumber, set: setProfileTruckNumber },
            ].map((field) => (
              <div key={field.label} className="text-start">
                <label className="text-xs font-semibold text-slate-400 block mb-1">{field.label}</label>
                <input
                  type="text"
                  required
                  value={field.value}
                  onChange={(e) => field.set(e.target.value)}
                  className="w-full min-h-[48px] px-3.5 bg-slate-950 border border-slate-800 focus:border-orange-500/60 text-sm text-slate-200 rounded-2xl outline-none transition-colors"
                />
              </div>
            ))}
            <div className="text-start">
              <label className="text-xs font-semibold text-slate-400 block mb-1">{t.truckType}</label>
              <select
                value={profileTruckType}
                onChange={(e) => setProfileTruckType(e.target.value)}
                className="w-full min-h-[48px] px-3.5 bg-slate-950 border border-slate-800 text-sm text-slate-200 rounded-2xl outline-none cursor-pointer"
              >
                {TRUCK_TYPES.map((type) => (
                  <option key={type.id} value={type.id} className="bg-slate-950 text-white">
                    {lang === "en" ? type.en : lang === "tr" ? type.tr : type.ar}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  syncFromDriver();
                  setIsEditingProfile(false);
                }}
                disabled={isSavingProfile}
                className="flex-1 min-h-[48px] bg-slate-950 border border-slate-700 text-slate-300 font-bold text-sm rounded-2xl transition-all cursor-pointer active:scale-95"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={isSavingProfile}
                className="flex-1 min-h-[48px] bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold text-sm rounded-2xl transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 light-preserve"
              >
                {isSavingProfile ? <span>{t.saving}</span> : (<><Check className="w-4 h-4 shrink-0" /><span>{t.save}</span></>)}
              </button>
            </div>
          </form>
        )}
      </section>

      {/* ── Settings ── */}
      <section className="bg-slate-900 border border-slate-800/60 rounded-3xl p-5 space-y-4">
        <h3 className="text-sm font-bold text-slate-200 text-start">{t.settings}</h3>

        {/* Availability status — read-only; the switch itself is on Home */}
        <div
          className={`w-full flex items-center gap-3 min-h-[52px] px-3.5 border rounded-2xl text-start ${
            offersEnabled ? "bg-orange-500/10 border-orange-500/40" : "bg-slate-950 border-slate-800"
          }`}
        >
          <Megaphone className={`w-5 h-5 shrink-0 ${offersEnabled ? "text-orange-400" : "text-slate-500"}`} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-slate-200">{t.offersToggle}</span>
            <span className={`block text-xs ${offersEnabled ? "text-orange-400/90" : "text-slate-500"}`}>
              {offersEnabled ? t.offersOn : t.offersOff}
            </span>
          </span>
          <span className={`shrink-0 text-xs font-bold rounded-full px-2.5 py-1 border ${
            offersEnabled ? "bg-orange-500/10 border-orange-500/40 text-orange-400" : "bg-slate-900 border-slate-700 text-slate-400"
          }`}>
            {t.statusOnHome}
          </span>
        </div>

        {/* Registered routes — managed by MARAS Operations, read-only here */}
        <div className="text-start space-y-2">
          <p className="text-sm text-slate-400 flex items-center gap-2">
            <Route className="w-4 h-4" />
            {t.routes}
          </p>
          {(driver?.workingRoutes || []).filter((r) => r.active).length === 0 ? (
            <p className="text-xs text-slate-500">{t.routesEmpty}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {(driver?.workingRoutes || []).filter((r) => r.active).map((r) => (
                <span key={r.id} className="inline-flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-200">
                  <span>{r.from}</span>
                  <ArrowRight className="w-3 h-3 text-orange-500 rtl:rotate-180" />
                  <span>{r.to}</span>
                </span>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-500">{t.routesManaged}</p>
        </div>

        {/* Language */}
        <div className="text-start space-y-2">
          <p className="text-sm text-slate-400 flex items-center gap-2">
            <Globe className="w-4 h-4" />
            {t.language}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {([
              { value: "en", label: "English" },
              { value: "ar", label: "العربية" },
              { value: "tr", label: "Türkçe" },
            ] as { value: Language; label: string }[]).map((opt) => {
              const isActive = lang === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onLanguageChange?.(opt.value)}
                  aria-pressed={isActive}
                  className={`min-h-[48px] rounded-2xl border text-sm font-bold transition-colors cursor-pointer ${
                    isActive
                      ? "bg-orange-500/10 border-orange-500/50 text-orange-400"
                      : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-600"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Appearance */}
        <div className="text-start space-y-2">
          <p className="text-sm text-slate-400 flex items-center gap-2">
            {theme === "dark" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            {t.appearance}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onThemeChange("light")}
              aria-pressed={theme === "light"}
              className={`min-h-[48px] rounded-2xl border text-sm font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                theme === "light"
                  ? "bg-orange-500/10 border-orange-500/50 text-orange-400"
                  : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-600"
              }`}
            >
              <Sun className="w-4 h-4 shrink-0" />
              <span className="text-start leading-tight">{t.lightMode}</span>
            </button>
            <button
              type="button"
              onClick={() => onThemeChange("dark")}
              aria-pressed={theme === "dark"}
              className={`min-h-[48px] rounded-2xl border text-sm font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                theme === "dark"
                  ? "bg-orange-500/10 border-orange-500/50 text-orange-400"
                  : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-600"
              }`}
            >
              <Moon className="w-4 h-4 shrink-0" />
              <span className="text-start leading-tight">{t.darkMode}</span>
            </button>
          </div>
        </div>

        {/* Privacy */}
        <button
          type="button"
          onClick={() => setShowPrivacyPolicy(true)}
          className="w-full flex items-center gap-3 min-h-[52px] px-3.5 bg-slate-950 border border-slate-800 hover:border-slate-600 rounded-2xl text-start transition-colors cursor-pointer"
        >
          <Shield className="w-5 h-5 text-orange-500 shrink-0" />
          <span className="min-w-0">
            <span className="block text-sm font-bold text-slate-200">{t.privacy}</span>
            <span className="block text-xs text-slate-500">{t.privacySub}</span>
          </span>
        </button>
      </section>

      {/* ── Logout ── */}
      {onLogout && (
        <button
          type="button"
          onClick={onLogout}
          className="w-full min-h-[52px] bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 font-bold text-sm rounded-2xl transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
        >
          <LogOut className="w-4 h-4 shrink-0 text-red-400 rtl:-scale-x-100" />
          <span>{t.logout}</span>
        </button>
      )}

      {/* ── Delete account (existing protected workflow) ── */}
      <section className="pt-2 border-t border-slate-800">
        {!showDeleteConfirm ? (
          <button
            type="button"
            onClick={() => {
              setShowDeleteConfirm(true);
              setUnderstandDelete(false);
              setDeletionState("idle");
              setBackendRecordDeleted(false);
              setDeletePasswordStepError(null);
              setDeleteCurrentPassword("");
            }}
            className="w-full min-h-[52px] bg-red-950/20 hover:bg-red-950/40 border border-red-900/40 text-red-400 font-bold text-sm rounded-2xl transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Trash2 className="w-4 h-4 shrink-0" />
            <span>{t.deleteButton}</span>
          </button>
        ) : (
          <div className="bg-slate-900 p-4 rounded-3xl border border-red-900/30 space-y-3 animate-fade-in">
            <div className="flex items-start gap-2.5 text-red-400">
              <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="text-start">
                <h4 className="text-sm font-bold">{t.deleteTitle}</h4>
                <p className="text-xs text-slate-400 leading-snug mt-1">{t.deleteWarning}</p>
                <p className="text-xs text-slate-500 leading-snug mt-2 pt-2 border-t border-slate-800">
                  {accountDeletionCopy(lang).privacyNotice}
                </p>
              </div>
            </div>

            {!auth.currentUser && !backendRecordDeleted && (
              <div className="text-start">
                <label className="text-xs font-semibold text-slate-400 block mb-1">
                  {accountDeletionCopy(lang).passwordLabel}
                </label>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={deleteCurrentPassword}
                  onChange={(e) => setDeleteCurrentPassword(e.target.value)}
                  placeholder={accountDeletionCopy(lang).passwordPlaceholder}
                  className="w-full min-h-[48px] px-3.5 bg-slate-950 border border-slate-800 focus:border-red-500/60 text-sm text-slate-200 rounded-2xl outline-none transition-colors"
                />
              </div>
            )}

            {deletePasswordStepError && (
              <div className="bg-red-950/30 border border-red-800/40 rounded-2xl p-3 text-xs text-red-300 leading-snug text-start">
                {deletePasswordStepError === "missing"
                  ? accountDeletionCopy(lang).missingPasswordError
                  : deletePasswordStepError === "incorrect"
                  ? accountDeletionCopy(lang).incorrectPasswordError
                  : deletePasswordStepError === "rate_limited"
                  ? accountDeletionCopy(lang).rateLimitedError
                  : deletePasswordStepError === "service_unavailable"
                  ? accountDeletionCopy(lang).serviceUnavailableError
                  : accountDeletionCopy(lang).genericFailureError}
              </div>
            )}

            <label className="flex items-start gap-2.5 cursor-pointer text-sm text-slate-300">
              <input
                type="checkbox"
                checked={understandDelete}
                disabled={backendRecordDeleted}
                onChange={(e) => setUnderstandDelete(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded border-slate-700 bg-slate-950 accent-red-500 cursor-pointer disabled:opacity-60"
              />
              <span className="leading-snug text-start">{t.deleteConsent}</span>
            </label>

            {(deletionState === "backend_failure" ||
              deletionState === "reauthentication_required" ||
              deletionState === "firebase_identity_deletion_failed" ||
              deletionState === "firebase_identity_deletion_unresolved") && (
              <div className="bg-red-950/30 border border-red-800/40 rounded-2xl p-3 text-xs text-red-300 leading-snug text-start">
                {deletionState === "backend_failure"
                  ? driverAccountDeletionCopy(lang).backendFailure
                  : deletionState === "reauthentication_required"
                  ? driverAccountDeletionCopy(lang).reauthenticationRequired
                  : deletionState === "firebase_identity_deletion_unresolved"
                  ? driverAccountDeletionCopy(lang).firebaseIdentityDeletionUnresolved
                  : driverAccountDeletionCopy(lang).firebaseIdentityDeletionFailed}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => {
                  if (backendRecordDeleted) {
                    // The backend record is already gone at this point —
                    // there is nothing left to "cancel" back to, so
                    // leaving this panel now means leaving the app.
                    if (onLogout) onLogout();
                    return;
                  }
                  setShowDeleteConfirm(false);
                }}
                className="flex-1 min-h-[48px] bg-slate-950 border border-slate-700 text-slate-300 text-sm font-bold rounded-2xl transition-all cursor-pointer"
              >
                {backendRecordDeleted ? driverAccountDeletionCopy(lang).logOutButton : t.keepAccount}
              </button>
              <button
                type="button"
                disabled={isDeleting || !understandDelete}
                onClick={deletionState === "firebase_identity_deletion_unresolved" ? handleFinishFirebaseDeletion : handleDeleteAccount}
                className="flex-1 min-h-[48px] bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white font-bold text-sm rounded-2xl transition-all cursor-pointer flex items-center justify-center gap-1.5 light-preserve"
              >
                {isDeleting ? (
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                ) : deletionState === "reauthentication_required" ||
                  deletionState === "firebase_identity_deletion_failed" ||
                  deletionState === "firebase_identity_deletion_unresolved" ? (
                  <span>{driverAccountDeletionCopy(lang).retryButton}</span>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 shrink-0" />
                    <span>{t.confirmDelete}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </section>

      <PrivacyPolicyModal isOpen={showPrivacyPolicy} onClose={() => setShowPrivacyPolicy(false)} lang={lang} />
    </div>
  );
}
