import { Settings, UserPlus, Mail, ShieldCheck, Ship } from 'lucide-react';
import type { Language } from '../../../types';

interface AdminSettingsSectionProps {
  lang: Language;
  adminEmail: string;
  adminType: string;
  resolvedAdminType: string;
  onNavigateTab: (tabId: 'my_account' | 'team' | 'gmail' | 'audit') => void;
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

        {/* Notification Preferences — visible to all admin types.
            Foundation UI only: no preference is actually wired to a
            backend yet, and security/system alerts cannot be disabled. */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 h-full">
          <h3 className="text-sm font-bold text-slate-900 mb-1">
            {lang === 'tr' ? 'Bildirim Tercihleri' : (lang === 'ar' ? 'تفضيلات الإشعارات' : 'Notification Preferences')}
          </h3>
          <p className="text-slate-500 text-xs mb-3">
            {lang === 'tr'
              ? 'Bu kategoriler yakında ayarlanabilir hale gelecek. Kritik güvenlik/sistem uyarıları her zaman açık kalır ve kapatılamaz.'
              : (lang === 'ar'
                ? 'ستصبح هذه الفئات قابلة للتعديل قريباً. تبقى تنبيهات الأمان/النظام الحرجة مفعّلة دائماً ولا يمكن إيقافها.'
                : 'These categories can be adjusted here soon. Critical security/system alerts always stay on and cannot be turned off.')}
          </p>
          <div className="space-y-1.5">
            {[
              { key: 'shipment', label: lang === 'tr' ? 'Sevkiyat Güncellemeleri' : (lang === 'ar' ? 'تحديثات الشحنات' : 'Shipment updates') },
              { key: 'customer', label: lang === 'tr' ? 'Müşteri Mesajları' : (lang === 'ar' ? 'رسائل العملاء' : 'Customer messages') },
              { key: 'driver', label: lang === 'tr' ? 'Sürücü Mesajları' : (lang === 'ar' ? 'رسائل السائقين' : 'Driver messages') },
              { key: 'documents', label: lang === 'tr' ? 'Belge Yüklemeleri' : (lang === 'ar' ? 'رفع المستندات' : 'Document uploads') },
              { key: 'cmr_pod', label: lang === 'tr' ? 'CMR/POD' : (lang === 'ar' ? 'CMR/POD' : 'CMR / POD') },
              { key: 'delays', label: lang === 'tr' ? 'Gecikmeler/Sınır Bekleme' : (lang === 'ar' ? 'التأخيرات/انتظار الحدود' : 'Delays / border waiting') },
              { key: 'accounting', label: lang === 'tr' ? 'Muhasebe Uyarıları' : (lang === 'ar' ? 'تنبيهات المحاسبة' : 'Accounting alerts') },
            ].map((row) => (
              <div key={row.key} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 border border-slate-100">
                <span className="text-xs font-semibold text-slate-600">{row.label}</span>
                <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 bg-white border border-slate-200 px-2 py-0.5 rounded-full">
                  {lang === 'tr' ? 'Yakında' : (lang === 'ar' ? 'قريباً' : 'Coming soon')}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-amber-50 border border-amber-100">
              <span className="text-xs font-bold text-amber-700">
                {lang === 'tr' ? 'Güvenlik/Sistem Uyarıları' : (lang === 'ar' ? 'تنبيهات الأمان/النظام' : 'Security / system alerts')}
              </span>
              <span className="text-[9px] font-bold uppercase tracking-widest text-amber-700 bg-white border border-amber-200 px-2 py-0.5 rounded-full">
                {lang === 'tr' ? 'Her Zaman Açık' : (lang === 'ar' ? 'مفعّل دائماً' : 'Always on')}
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
