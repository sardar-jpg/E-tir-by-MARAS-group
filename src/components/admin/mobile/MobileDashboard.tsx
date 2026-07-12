import { Plus, Truck, Ship, CheckCircle2, FileText, Map as MapIcon, MessageSquare, ClipboardList, Bell, ChevronRight, ChevronLeft } from 'lucide-react';
import type { AppNotification, Language, Shipment } from '../../../types';
import { TRANSLATIONS } from '../../../translations';

interface MobileDashboardProps {
  lang: Language;
  isRtl: boolean;
  t: (key: keyof typeof TRANSLATIONS['en']) => string;
  shipments: Shipment[];
  activeShipmentsCount: number;
  totalShipmentsCount: number;
  completedShipmentsCount: number;
  pendingDocumentsCount: number;
  recentAlertsData: AppNotification[];
  setNewShipmentData: (data: any) => void;
  createEmptyShipmentForm: () => any;
  setUseCustomPOL: (value: boolean) => void;
  setUseCustomPOD: (value: boolean) => void;
  setIsCreateOpen: (value: boolean) => void;
  setActiveTab: (tabId: string) => void;
  canViewShipmentRegistry: boolean;
  canViewGpsTracking: boolean;
  onOpenNotifications: () => void;
}

/**
 * feature/admin-mobile-ui: Dashboard content for mobile, rendered instead
 * of (not alongside) AdminDashboardSection when isMobileMode is true — the
 * desktop dashboard's dense recharts/table bento layout doesn't reduce to
 * something usable on a phone even single-columned, so this is a separate,
 * mobile-first stat-card + quick-action layout built from the exact same
 * pre-computed counts/data AdminPanel already passes to
 * AdminDashboardSection (activeShipmentsCount, totalShipmentsCount,
 * completedShipmentsCount, pendingDocumentsCount, recentAlertsData) — no
 * new counting/business logic, just a different presentation. Because this
 * renders in place of AdminDashboardSection (not beside it), its
 * React.lazy chunk — and the recharts library it pulls in — is never
 * fetched on mobile at all, which is a bonus for mobile load time.
 *
 * "New Sales Inquiry" from the confirmed quick-action wishlist isn't
 * included: there is no such feature anywhere in this codebase (same gap
 * already surfaced as "Coming Soon" in MobileMoreMenu), so it's left out
 * here rather than wired to a page that doesn't exist.
 */
export default function MobileDashboard({
  lang,
  isRtl,
  shipments,
  activeShipmentsCount,
  totalShipmentsCount,
  pendingDocumentsCount,
  recentAlertsData,
  setNewShipmentData,
  createEmptyShipmentForm,
  setUseCustomPOL,
  setUseCustomPOD,
  setIsCreateOpen,
  setActiveTab,
  canViewShipmentRegistry,
  canViewGpsTracking,
  onOpenNotifications,
}: MobileDashboardProps) {
  const ChevronIcon = isRtl ? ChevronLeft : ChevronRight;

  // Derived from the same `shipments` array/`updatedAt` field the desktop
  // dashboard already uses elsewhere — no dedicated delivery-date field
  // exists on Shipment, so "today" is approximated as: currently
  // Delivered and last updated today.
  const deliveredTodayCount = shipments.filter((s) => {
    if (s.status !== 'Delivered') return false;
    const updated = new Date(s.updatedAt);
    const now = new Date();
    return updated.toDateString() === now.toDateString();
  }).length;

  const STAT_CARDS = [
    {
      key: 'active',
      label: { en: 'Active Shipments', ar: 'الشحنات النشطة', tr: 'Aktif Sevkiyatlar' },
      value: activeShipmentsCount,
      icon: Truck,
      color: 'text-orange-600 bg-orange-50',
    },
    {
      key: 'total',
      label: { en: 'Total Shipments', ar: 'إجمالي الشحنات', tr: 'Toplam Sevkiyat' },
      value: totalShipmentsCount,
      icon: Ship,
      color: 'text-slate-700 bg-slate-100',
    },
    {
      key: 'delivered_today',
      label: { en: 'Delivered Today', ar: 'تم التسليم اليوم', tr: 'Bugün Teslim Edilen' },
      value: deliveredTodayCount,
      icon: CheckCircle2,
      color: 'text-emerald-600 bg-emerald-50',
    },
    {
      key: 'pending_docs',
      label: { en: 'Pending Documents', ar: 'مستندات معلقة', tr: 'Bekleyen Belgeler' },
      value: pendingDocumentsCount,
      icon: FileText,
      color: 'text-amber-600 bg-amber-50',
    },
  ];

  const QUICK_ACTIONS = [
    {
      key: 'create_order',
      label: { en: 'Create Order', ar: 'إنشاء طلب', tr: 'Sipariş Oluştur' },
      icon: Plus,
      show: true,
      onClick: () => {
        setNewShipmentData(createEmptyShipmentForm());
        setUseCustomPOL(false);
        setUseCustomPOD(false);
        setIsCreateOpen(true);
      },
    },
    {
      key: 'assign_driver',
      label: { en: 'Assign Driver', ar: 'تعيين سائق', tr: 'Sürücü Ata' },
      icon: ClipboardList,
      show: canViewShipmentRegistry,
      onClick: () => setActiveTab('shipments'),
    },
    {
      key: 'open_tracking',
      label: { en: 'Open Tracking', ar: 'فتح التتبع', tr: 'Takibi Aç' },
      icon: MapIcon,
      show: canViewGpsTracking,
      onClick: () => setActiveTab('tracking_map'),
    },
    {
      key: 'open_chat',
      label: { en: 'Open Chat', ar: 'فتح المحادثة', tr: 'Sohbeti Aç' },
      icon: MessageSquare,
      show: true,
      onClick: () => setActiveTab('chat_center'),
    },
  ].filter((a) => a.show);

  return (
    <div className="lg:hidden space-y-5">
      <div className="grid grid-cols-2 gap-3">
        {STAT_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.key} className="bg-white rounded-xl border border-slate-200 shadow-xs p-3.5 space-y-2">
              <span className={`w-8 h-8 flex items-center justify-center rounded-lg ${card.color}`}>
                <Icon className="w-4 h-4" />
              </span>
              <p className="text-2xl font-black text-slate-900 leading-none">{card.value}</p>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide leading-tight">
                {card.label[lang] ?? card.label.en}
              </p>
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 px-1">
          {lang === 'tr' ? 'Hızlı Eylemler' : lang === 'ar' ? 'إجراءات سريعة' : 'Quick Actions'}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.key}
                type="button"
                onClick={action.onClick}
                className="flex items-center gap-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl px-3 py-2.5 text-left cursor-pointer border-0 min-h-[44px] transition-colors"
              >
                <span className="w-7 h-7 shrink-0 flex items-center justify-center rounded-lg bg-white/10 text-orange-400">
                  <Icon className="w-3.5 h-3.5" />
                </span>
                <span className="text-xs font-bold leading-tight truncate">{action.label[lang] ?? action.label.en}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <button
          type="button"
          onClick={onOpenNotifications}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50/40 cursor-pointer border-0 text-left"
        >
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
            <Bell className="w-3.5 h-3.5 text-slate-400" />
            <span>{lang === 'tr' ? 'Son Uyarılar' : lang === 'ar' ? 'آخر التنبيهات' : 'Recent Alerts'}</span>
          </h3>
          <ChevronIcon className="w-4 h-4 text-slate-300 shrink-0" />
        </button>
        <div className="divide-y divide-slate-100">
          {recentAlertsData.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-xs italic">
              {lang === 'tr' ? 'Aktif uyarı bulunmamaktadır.' : lang === 'ar' ? 'لا توجد تنبيهات نشطة.' : 'No active alerts.'}
            </div>
          ) : (
            recentAlertsData.slice(0, 5).map((notif) => (
              <div key={notif.id} className="px-4 py-2.5 text-xs space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-800 truncate">
                    {lang === 'tr' ? notif.titleTr : lang === 'ar' ? notif.titleAr : notif.titleEn}
                  </span>
                  <span className="text-[10px] text-slate-400 shrink-0">
                    {new Date(notif.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-slate-500 font-medium truncate">
                  {lang === 'tr' ? notif.messageTr : lang === 'ar' ? notif.messageAr : notif.messageEn}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
