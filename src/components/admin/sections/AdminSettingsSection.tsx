import { useEffect, useState } from 'react';
import { Settings, UserPlus, Mail, ShieldCheck, Ship, Loader2, AlertCircle } from 'lucide-react';
import type { Language } from '../../../types';
import { apiFetch } from '../../../lib/api';
import CostApprovalSettingsCard from '../CostApprovalSettingsCard';
import {
  NOTIFICATION_PREFERENCE_CATEGORIES,
  DEFAULT_ADMIN_NOTIFICATION_PREFERENCES,
  applyPreferenceFieldUpdate,
  type AdminNotificationPreferences,
  type NotificationPreferenceCategory,
} from '../../../lib/notificationPreferences';

interface AdminSettingsSectionProps {
  lang: Language;
  adminEmail: string;
  adminType: string;
  resolvedAdminType: string;
  onNavigateTab: (tabId: 'my_account' | 'team' | 'gmail' | 'audit') => void;
}

const CATEGORY_LABELS: Record<NotificationPreferenceCategory, Record<Language, string>> = {
  shipment_updates: { en: 'Shipment updates', tr: 'Sevkiyat Güncellemeleri', ar: 'تحديثات الشحنات' },
  customer_messages: { en: 'Customer messages', tr: 'Müşteri Mesajları', ar: 'رسائل العملاء' },
  driver_messages: { en: 'Driver messages', tr: 'Sürücü Mesajları', ar: 'رسائل السائقين' },
  document_uploads: { en: 'Document uploads', tr: 'Belge Yüklemeleri', ar: 'رفع المستندات' },
  cmr_pod: { en: 'CMR / POD', tr: 'CMR / POD', ar: 'CMR / POD' },
  delays_border_waiting: { en: 'Delays / border waiting', tr: 'Gecikmeler / Sınır Bekleme', ar: 'التأخيرات / انتظار الحدود' },
  accounting_alerts: { en: 'Accounting alerts', tr: 'Muhasebe Uyarıları', ar: 'تنبيهات المحاسبة' },
  security_system_alerts: { en: 'Security / system alerts', tr: 'Güvenlik / Sistem Uyarıları', ar: 'تنبيهات الأمان / النظام' },
};

/**
 * Notification Preferences Phase 2 (Admin only). A minimal, self-contained
 * toggle switch — no shared Toggle component exists elsewhere in this
 * codebase yet, so this stays local rather than introducing one for a
 * single consumer. Native `<input type="checkbox" role="switch">` for
 * real accessibility semantics (screen readers announce it as a switch,
 * not just a checkbox), styled as a pill via the sr-only + peer pattern.
 */
function NotificationPreferenceToggle({
  checked,
  disabled,
  saving,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  saving?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className={`relative inline-flex items-center shrink-0 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className="sr-only peer"
        checked={checked}
        disabled={disabled || saving}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div className="w-9 h-5 bg-slate-200 peer-checked:bg-indigo-600 rounded-full transition-colors peer-disabled:opacity-50" />
      <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
    </label>
  );
}

/**
 * Settings tab content, extracted from AdminPanel.tsx (PR #78, Admin
 * bundle-size split phase 2) so it can be React.lazy-loaded instead of
 * always shipping in the main AdminPanel chunk. This is a navigation hub
 * only — it links to the existing 'my_account' / 'team' / 'gmail' / 'audit'
 * tabs via onNavigateTab (AdminPanel's setActiveTab) rather than
 * duplicating their UI or logic. Super-admin-only cards are gated by
 * resolvedAdminType === 'super', the same condition AdminPanel already uses
 * to hide those tabs from the sidebar for other admin types, so this
 * component does not grant any admin type new access.
 */
export default function AdminSettingsSection({
  lang,
  adminEmail,
  adminType,
  resolvedAdminType,
  onNavigateTab,
}: AdminSettingsSectionProps) {
  // Notification Preferences Phase 2 (Admin only). Scoped entirely by the
  // caller's own authenticated session on the backend (GET/PUT
  // /api/admin/notification-preferences) — no admin id is sent from here
  // at all, so there is no risk of this component ever reading or writing
  // a different admin's preferences.
  const [preferences, setPreferences] = useState<AdminNotificationPreferences>(DEFAULT_ADMIN_NOTIFICATION_PREFERENCES);
  const [prefsLoading, setPrefsLoading] = useState(true);
  const [prefsLoadError, setPrefsLoadError] = useState<string | null>(null);
  // Only one preference save may be in flight at a time — every toggle is
  // disabled while `savingCategory` is non-null (see the toggles below),
  // so the frontend itself can never fire two overlapping PUT requests.
  // This is the "serialize saves" half of the concurrency fix: it doesn't
  // replace the backend's own atomic field-level writes (server.ts's
  // updateAdminNotificationPreferenceFields still protects against
  // concurrency from OTHER sources — another tab, another device), but it
  // does mean a stale/out-of-order response from THIS component's own
  // requests is not a concern in practice, since there is never more than
  // one outstanding.
  const [savingCategory, setSavingCategory] = useState<NotificationPreferenceCategory | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPrefsLoading(true);
      setPrefsLoadError(null);
      try {
        const res = await apiFetch('/api/admin/notification-preferences');
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = await res.json();
        if (!cancelled && data?.preferences) {
          setPreferences(data.preferences);
        }
      } catch (err) {
        console.error('Failed to load notification preferences:', err);
        if (!cancelled) {
          setPrefsLoadError(
            lang === 'tr'
              ? 'Bildirim tercihleri yüklenemedi.'
              : (lang === 'ar' ? 'تعذّر تحميل تفضيلات الإشعارات.' : 'Could not load notification preferences.')
          );
        }
      } finally {
        if (!cancelled) setPrefsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleTogglePreference = async (category: NotificationPreferenceCategory, next: boolean) => {
    // security_system_alerts is rendered as a disabled, always-on toggle
    // (see the "Always On" row below) and never reaches this handler in
    // normal use — this guard is defense in depth only.
    if (category === 'security_system_alerts') return;
    // Only one save at a time — every toggle is already disabled in the
    // JSX below while this is non-null, so this check is a defense-in-depth
    // backstop against firing a second request before React re-renders.
    if (savingCategory !== null) return;

    const previousValue = preferences[category];
    // Optimistic update touches ONLY this one category — never the whole
    // preferences object — so it can never disturb any other category's
    // already-confirmed value. applyPreferenceFieldUpdate (shared,
    // unit-tested in src/lib/notificationPreferences.test.ts) is the same
    // single-field-merge helper used for the success-merge and
    // failure-rollback below.
    setPreferences((prev) => applyPreferenceFieldUpdate(prev, category, next));
    setSavingCategory(category);
    setSaveError(null);
    try {
      const res = await apiFetch('/api/admin/notification-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [category]: next }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      // Merge ONLY the category we just changed from the confirmed server
      // response — never replace the whole preferences object with it.
      // Trusting the full response here would risk visually reverting a
      // different category if this response were ever processed
      // out of order relative to another save; merging just this one
      // field makes that structurally impossible regardless.
      if (data?.preferences && typeof data.preferences[category] === 'boolean') {
        setPreferences((prev) => applyPreferenceFieldUpdate(prev, category, data.preferences[category]));
      }
    } catch (err) {
      console.error(`Failed to save notification preference "${category}":`, err);
      // Revert ONLY this category back to its pre-toggle value — never
      // the whole preferences object (setPreferences(previous)), which
      // could silently undo a different category's already-successful
      // save if one happened to land in the same render cycle.
      setPreferences((prev) => applyPreferenceFieldUpdate(prev, category, previousValue));
      setSaveError(
        lang === 'tr'
          ? 'Değişiklik kaydedilemedi. Lütfen tekrar deneyin.'
          : (lang === 'ar' ? 'تعذّر حفظ التغيير. يرجى المحاولة مرة أخرى.' : 'Could not save the change. Please try again.')
      );
    } finally {
      setSavingCategory(null);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h2 className="text-lg font-bold text-slate-950 flex items-center gap-2 mb-1">
          <Settings className="w-5 h-5 text-indigo-600" />
          {lang === 'tr' ? 'Ayarlar' : (lang === 'ar' ? 'الإعدادات' : 'Settings')}
        </h2>
        <p className="text-slate-500 text-xs">
          {lang === 'tr'
            ? 'Hesap, bildirim ve sistem tercihleriniz için tek merkez.'
            : (lang === 'ar'
              ? 'المركز الموحّد لإعدادات حسابك والإشعارات والنظام.'
              : 'The central place for your account, notification, and system preferences.')}
        </p>
      </div>

      {/* My Profile + Notification Preferences — visible to all admin
          types, kept prominent as a two-up row on wider screens. */}
      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 h-full">
          <h3 className="text-sm font-bold text-slate-900 mb-2">
            {lang === 'tr' ? 'Profilim' : (lang === 'ar' ? 'ملفي الشخصي' : 'My Profile')}
          </h3>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-slate-700 text-xs font-semibold">{adminEmail}</p>
              <span className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full mt-1 ${
                adminType === 'super' ? 'text-orange-600 bg-orange-50' : adminType === 'accounts' ? 'text-teal-600 bg-teal-50' : 'text-indigo-600 bg-indigo-50'
              }`}>
                {adminType === 'super'
                  ? (lang === 'tr' ? 'Süper Yönetici' : (lang === 'ar' ? 'مسؤول أعلى' : 'Super Admin'))
                  : adminType === 'accounts'
                    ? (lang === 'tr' ? 'Muhasebe Ekibi' : (lang === 'ar' ? 'فريق الحسابات' : 'Accounts Admin'))
                    : (lang === 'tr' ? 'Operasyon Ekibi' : (lang === 'ar' ? 'فريق العمليات' : 'Operations Admin'))}
              </span>
              <p className="text-slate-400 text-[10px] mt-1.5">
                {lang === 'tr'
                  ? 'Dil tercihi üst menüdeki dil seçiciden değiştirilebilir.'
                  : (lang === 'ar'
                    ? 'يمكن تغيير تفضيل اللغة من محدد اللغة في الأعلى.'
                    : 'Language preference can be changed from the language selector in the top header.')}
              </p>
            </div>
            <button
              onClick={() => onNavigateTab('my_account')}
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition cursor-pointer border-0 shrink-0"
            >
              {lang === 'tr' ? 'Şifre ve Hesabı Yönet' : (lang === 'ar' ? 'إدارة كلمة المرور والحساب' : 'Manage Password & Account')}
            </button>
          </div>
        </div>

        {/* Notification Preferences — visible to all admin types. Each
            admin's own preferences (GET/PUT /api/admin/notification-
            preferences), independent of any other admin's — see
            AdminSettingsSection's fetch/save logic above. */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 h-full">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h3 className="text-sm font-bold text-slate-900">
              {lang === 'tr' ? 'Bildirim Tercihleri' : (lang === 'ar' ? 'تفضيلات الإشعارات' : 'Notification Preferences')}
            </h3>
            {savingCategory !== null && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-indigo-500">
                <Loader2 className="w-3 h-3 animate-spin" />
                {lang === 'tr' ? 'Kaydediliyor…' : (lang === 'ar' ? 'جارٍ الحفظ…' : 'Saving…')}
              </span>
            )}
          </div>
          <p className="text-slate-500 text-xs mb-3">
            {lang === 'tr'
              ? 'Bu, yalnızca sizin hesabınız için geçerlidir. Kritik güvenlik/sistem uyarıları her zaman açık kalır ve kapatılamaz.'
              : (lang === 'ar'
                ? 'ينطبق هذا على حسابك فقط. تبقى تنبيهات الأمان/النظام الحرجة مفعّلة دائماً ولا يمكن إيقافها.'
                : 'This applies to your own account only. Critical security/system alerts always stay on and cannot be turned off.')}
          </p>

          {saveError && (
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {saveError}
            </div>
          )}
          {prefsLoadError && (
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {prefsLoadError}
            </div>
          )}

          <div className={`space-y-1.5 ${prefsLoading ? 'opacity-50 pointer-events-none' : ''}`}>
            {NOTIFICATION_PREFERENCE_CATEGORIES.filter((c) => c !== 'security_system_alerts').map((category) => (
              <div key={category} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 border border-slate-100">
                <span className="text-xs font-semibold text-slate-600">{CATEGORY_LABELS[category][lang]}</span>
                <NotificationPreferenceToggle
                  checked={preferences[category]}
                  saving={savingCategory === category}
                  disabled={savingCategory !== null}
                  label={CATEGORY_LABELS[category][lang]}
                  onChange={(next) => handleTogglePreference(category, next)}
                />
              </div>
            ))}
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-amber-50 border border-amber-100">
              <span className="text-xs font-bold text-amber-700">
                {CATEGORY_LABELS.security_system_alerts[lang]}
              </span>
              <span className="text-[9px] font-bold uppercase tracking-widest text-amber-700 bg-white border border-amber-200 px-2 py-0.5 rounded-full">
                {lang === 'tr' ? 'Her Zaman Açık' : (lang === 'ar' ? 'مفعّل دائماً' : 'Always On')}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Staff & Permissions / Google Workspace / Security & Activity —
          super admin only (same gates as the existing 'team' / 'gmail'
          / 'audit' tabs), laid out as a responsive card grid since
          each is just a link, not a full form. */}
      {resolvedAdminType === 'super' && (
        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-1">
                {lang === 'tr' ? 'Personel ve Yetkiler' : (lang === 'ar' ? 'الموظفون والصلاحيات' : 'Staff & Permissions')}
              </h3>
              <p className="text-slate-500 text-xs">
                {lang === 'tr' ? 'Yönetici ekip üyelerini ve rollerini yönetin.' : (lang === 'ar' ? 'إدارة أعضاء فريق الإدارة وأدوارهم.' : 'Manage admin team members and their roles.')}
              </p>
            </div>
            <button onClick={() => onNavigateTab('team')} className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg transition cursor-pointer border-0 flex items-center justify-center gap-1.5">
              <UserPlus className="w-3.5 h-3.5" />
              {lang === 'tr' ? 'Ekibi Yönet' : (lang === 'ar' ? 'إدارة الفريق' : 'Open Staff & Permissions')}
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-1">
                {lang === 'tr' ? 'Google Workspace' : (lang === 'ar' ? 'جوجل وورك سبيس' : 'Google Workspace')}
              </h3>
              <p className="text-slate-500 text-xs">
                {lang === 'tr' ? 'Gmail, Drive ve Takvim entegrasyonlarını görüntüleyin.' : (lang === 'ar' ? 'عرض تكاملات Gmail وDrive والتقويم.' : 'View Gmail, Drive, and Calendar integrations.')}
              </p>
            </div>
            <button onClick={() => onNavigateTab('gmail')} className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg transition cursor-pointer border-0 flex items-center justify-center gap-1.5">
              <Mail className="w-3.5 h-3.5" />
              {lang === 'tr' ? "Google Workspace'i Aç" : (lang === 'ar' ? 'فتح جوجل وورك سبيس' : 'Open Google Workspace')}
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-1">
                {lang === 'tr' ? 'Güvenlik ve Etkinlik' : (lang === 'ar' ? 'الأمان والنشاط' : 'Security & Activity')}
              </h3>
              <p className="text-slate-500 text-xs">
                {lang === 'tr' ? 'Denetim günlüklerini ve sistem etkinliğini görüntüleyin.' : (lang === 'ar' ? 'عرض سجلات التدقيق ونشاط النظام.' : 'View audit logs and system activity.')}
              </p>
            </div>
            <button onClick={() => onNavigateTab('audit')} className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg transition cursor-pointer border-0 flex items-center justify-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              {lang === 'tr' ? 'Denetim Günlüklerini Aç' : (lang === 'ar' ? 'فتح سجلات التدقيق' : 'Open Audit Logs')}
            </button>
          </div>
        </div>
      )}

      {/* Accounting Settings → Cost Approval Workflow (PR #6) — Super
          Admin only. Assigns the three fixed approval stages to active
          employees; the server re-validates every save. */}
      {resolvedAdminType === 'super' && (
        <div className="space-y-2">
          <h3 className="text-sm font-black text-slate-900">
            {lang === 'tr' ? 'Muhasebe Ayarları' : (lang === 'ar' ? 'إعدادات المحاسبة' : 'Accounting Settings')}
          </h3>
          <CostApprovalSettingsCard lang={lang} />
        </div>
      )}

      {/* Company / System Settings — super admin only, read-only
          placeholders for now (per PR #56 scope: no backend changes).
          Kept full width with a wider field grid since it holds more
          fields than the link-only cards above. */}
      {resolvedAdminType === 'super' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h3 className="text-sm font-bold text-slate-900 mb-1">
            {lang === 'tr' ? 'Şirket / Sistem Ayarları' : (lang === 'ar' ? 'إعدادات الشركة / النظام' : 'Company / System Settings')}
          </h3>
          <p className="text-slate-500 text-xs mb-3">
            {lang === 'tr' ? 'Bu alanlar yakında düzenlenebilir olacak.' : (lang === 'ar' ? 'ستصبح هذه الحقول قابلة للتعديل قريباً.' : 'These fields will become editable soon.')}
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {[
              { label: lang === 'tr' ? 'Şirket Adı' : (lang === 'ar' ? 'اسم الشركة' : 'Company name'), value: 'MARAS Group' },
              { label: lang === 'tr' ? 'Destek E-postası' : (lang === 'ar' ? 'بريد الدعم' : 'Support email'), value: 'support@etir.app' },
              { label: lang === 'tr' ? 'Varsayılan Para Birimi' : (lang === 'ar' ? 'العملة الافتراضية' : 'Default currency'), value: lang === 'tr' ? 'Sevkiyat bazında ayarlanır' : (lang === 'ar' ? 'يُحدد حسب الشحنة' : 'Set per shipment') },
              { label: lang === 'tr' ? 'Diller' : (lang === 'ar' ? 'اللغات' : 'Languages'), value: 'EN / TR / AR' },
              { label: lang === 'tr' ? 'Genel Takip Varsayılanları' : (lang === 'ar' ? 'إعدادات التتبع العام' : 'Public tracking defaults'), value: lang === 'tr' ? 'Planlandı' : (lang === 'ar' ? 'مخطط له' : 'Planned') },
              { label: lang === 'tr' ? 'Sipariş Numarası Formatı' : (lang === 'ar' ? 'تنسيق رقم الطلب' : 'Order number format'), value: 'MAR-YYYY-####' },
              { label: lang === 'tr' ? 'Belge Paylaşım Varsayılanları' : (lang === 'ar' ? 'إعدادات مشاركة المستندات' : 'Document sharing defaults'), value: lang === 'tr' ? 'Belge bazında ayarlanır' : (lang === 'ar' ? 'يُحدد حسب المستند' : 'Set per document') },
            ].map((row) => (
              <div key={row.label} className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{row.label}</p>
                <p className="text-xs font-semibold text-slate-600 mt-0.5">{row.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* About eTIR — visible to all admin types. Plain card, not the
          heavy dark treatment used for the Gmail/dashboard hero
          banners, since this is just static reference info. */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h3 className="text-sm font-bold text-slate-900 mb-2 flex items-center gap-2">
          <Ship className="w-4 h-4 text-orange-600" />
          {lang === 'tr' ? 'eTIR Hakkında' : (lang === 'ar' ? 'عن eTIR' : 'About eTIR')}
        </h3>
        <div className="text-xs text-slate-500 space-y-1">
          <p>eTIR by MARAS Group</p>
          <p>etir.app</p>
          <p>support@etir.app</p>
          <p>
            {lang === 'tr' ? 'Ortam' : (lang === 'ar' ? 'البيئة' : 'Environment')}:{' '}
            {(import.meta as any).env?.DEV
              ? (lang === 'tr' ? 'Geliştirme' : (lang === 'ar' ? 'تطوير' : 'Development'))
              : (lang === 'tr' ? 'Üretim' : (lang === 'ar' ? 'إنتاج' : 'Production'))}
          </p>
          <p>{lang === 'tr' ? 'Sürüm' : (lang === 'ar' ? 'الإصدار' : 'Version')}: —</p>
        </div>
      </div>
    </div>
  );
}
