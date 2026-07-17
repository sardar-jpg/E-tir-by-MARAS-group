import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area
} from 'recharts';
import {
  Plus, Search, ShieldCheck, Share2, MessageSquare,
  Building2, Ship, Truck, CheckCircle2, FileText,
  X, RefreshCw, Check, AlertCircle,
  Map as MapIcon, BellRing, Anchor, Plane, Clock, TrendingUp, ClipboardList
} from 'lucide-react';
import type { Shipment, Driver, Client, ActivityLog, AppNotification, ChatChannel, Language } from '../../../types';
import { TRANSLATIONS } from '../../../translations';
import { getAssignableDrivers } from '../../../lib/driverAccess';

type TimingAnalysis = {
  colorClass: string;
  textColorClass: string;
  bgBadgeClass: string;
  label: string;
  subtext: string;
  lagPercentage?: number;
};

interface AdminDashboardSectionProps {
  lang: Language;
  t: (key: keyof typeof TRANSLATIONS['en']) => string;
  isMobileMode: boolean;
  adminEmail?: string;
  adminType?: string;
  gmailUser?: any;
  currentTime: Date;

  shipments: Shipment[];
  drivers: Driver[];
  clients: Client[];
  notifications: AppNotification[];
  activityLogs: ActivityLog[];

  activeShipmentsCount: number;
  totalShipmentsCount: number;
  completedShipmentsCount: number;
  /** Phase 2A follow-up (blocking-issue fix): true when more shipments
      exist beyond what's currently loaded (GET /api/shipments' own
      `hasMore`) — gates the "loaded records only" notice below. */
  shipmentsHasMore: boolean;
  pendingDocumentsCount: number;
  realTimeDocsStats: { name: string; count: number }[];
  notificationCountsChartData: { name: string; Alerts: number }[];
  recentAlertsData: AppNotification[];
  routeChartData: { name: string; count: number }[];
  shipmentAnalyticsData: { name: string; value: number; color: string }[];
  pendingCountVal: number;
  activeCountVal: number;
  completedCountVal: number;

  searchQuery: string;
  setSearchQuery: (value: string) => void;
  setStatusFilter: (value: string) => void;
  typeFilter: string;
  setTypeFilter: (value: string) => void;
  filteredShipments: Shipment[];

  setNewShipmentData: (data: any) => void;
  createEmptyShipmentForm: () => any;
  setUseCustomPOL: (value: boolean) => void;
  setUseCustomPOD: (value: boolean) => void;
  setIsCreateOpen: (value: boolean) => void;
  setOpenDetailsId: (id: string | null) => void;

  analyzeShipmentTiming: (s: Shipment) => TimingAnalysis;
  getShipmentProgressPercentage: (s: Shipment) => number;
  getDirectLink: (token: string) => string;
  triggerToast: (msg: string) => void;
  onSelectShipmentChat: (shipment: Shipment, channel?: ChatChannel) => void;

  setActiveTab: (tabId: 'audit' | 'clients' | 'drivers' | 'tracking_map' | 'reports') => void;
  isSuperAdmin: boolean;
  canViewDriverRoster: boolean;
  canViewGpsTracking: boolean;
  canViewLogisticsAnalytics: boolean;
}

/**
 * Dashboard Overview tab content, extracted from AdminPanel.tsx (PR #81,
 * Admin bundle-size follow-up to PR #76/#78) so it can be React.lazy-loaded
 * instead of always shipping in the main AdminPanel chunk — this was the
 * single largest remaining lever from that pass, since recharts couldn't
 * drop out of AdminPanel's own chunk while the Dashboard rendered its
 * charts inline (see docs/FOLLOW_UP_ROADMAP.md).
 *
 * The tab has no adminType gate of its own (every admin type lands here),
 * so the `<Suspense>` boundary in AdminPanel.tsx is simply `activeTab ===
 * 'dashboard'` — but several widgets *within* the tab are still role-gated
 * (the Operational Activity Stream is super-only; three of the four Quick
 * Links buttons are gated per adminType). Those decisions stay in
 * AdminPanel.tsx, computed once via the existing adminAccess.ts functions
 * and passed down here as plain booleans (`isSuperAdmin`,
 * `canViewDriverRoster`, `canViewGpsTracking`, `canViewLogisticsAnalytics`)
 * — this component never imports adminAccess.ts or decides access itself,
 * matching every other extracted section's convention.
 *
 * All metrics/chart data (routeChartData, shipmentAnalyticsData, etc.) are
 * computed in AdminPanel.tsx exactly as before and passed down already-
 * computed — no business logic duplicated here. The shipment
 * search/filter state (searchQuery/typeFilter) is shared with the
 * Shipments Registry tab (the search bar above this tab's content is
 * rendered once in AdminPanel.tsx for both tabs), so it stays lifted there
 * and is passed down as value/setter props, same as `newShipmentData`/
 * `useCustomPOL`/`useCustomPOD`/`openDetailsId` (all owned by modals that
 * live outside this component).
 */
export default function AdminDashboardSection({
  lang,
  t,
  isMobileMode,
  adminEmail,
  adminType,
  gmailUser,
  currentTime,
  shipments,
  drivers,
  clients,
  notifications,
  activityLogs,
  activeShipmentsCount,
  totalShipmentsCount,
  completedShipmentsCount,
  shipmentsHasMore,
  pendingDocumentsCount,
  realTimeDocsStats,
  notificationCountsChartData,
  recentAlertsData,
  routeChartData,
  shipmentAnalyticsData,
  pendingCountVal,
  activeCountVal,
  completedCountVal,
  searchQuery,
  setSearchQuery,
  setStatusFilter,
  typeFilter,
  setTypeFilter,
  filteredShipments,
  setNewShipmentData,
  createEmptyShipmentForm,
  setUseCustomPOL,
  setUseCustomPOD,
  setIsCreateOpen,
  setOpenDetailsId,
  analyzeShipmentTiming,
  getShipmentProgressPercentage,
  getDirectLink,
  triggerToast,
  onSelectShipmentChat,
  setActiveTab,
  isSuperAdmin,
  canViewDriverRoster,
  canViewGpsTracking,
  canViewLogisticsAnalytics,
}: AdminDashboardSectionProps) {
  return (
    <div className="space-y-6">
      {/* Elegant Top Welcome Header with live clock & status */}
      <div className={`bg-slate-900 text-white rounded-2xl ${isMobileMode ? 'p-4' : 'p-6'} shadow-xl relative overflow-hidden flex flex-col ${isMobileMode ? 'gap-3' : 'md:flex-row md:items-center'} justify-between gap-4 border border-slate-800`}>
        {/* Background decoration */}
        <div className="absolute right-0 top-0 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute left-1/3 bottom-0 w-64 h-64 bg-orange-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="space-y-2 relative z-10">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-black uppercase tracking-wider animate-pulse">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              {lang === 'tr' ? "Sistem Aktif" : (lang === 'ar' ? "النظام نشط" : "Gateway Active")}
            </span>
          </div>
          <h2 className="text-2xl font-black tracking-tight text-white mb-1">
            {lang === 'tr' ? "Lojistik Kontrol Merkezi" : (lang === 'ar' ? "مركز المراقبة والتحكم" : "Logistics Command Hub")}
          </h2>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-300 font-semibold">
            <span className="flex items-center gap-1.5">
              <Building2 className="w-4 h-4 text-slate-400" />
              <span>MARAS Cargo HQ</span>
            </span>
            <span className="text-slate-600">•</span>
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>
                {adminEmail || gmailUser?.email || (lang === 'tr' ? 'MARAS Yöneticisi' : lang === 'ar' ? 'مسؤول MARAS' : 'MARAS Admin')}
                {' '}(
                {adminType === 'super'
                  ? (lang === 'tr' ? 'Süper Yönetici' : (lang === 'ar' ? 'مسؤول أعلى' : 'Super Admin'))
                  : adminType === 'accounts'
                    ? (lang === 'tr' ? 'Muhasebe Ekibi' : (lang === 'ar' ? 'فريق الحسابات' : 'Accounts Admin'))
                    : (lang === 'tr' ? 'Operasyon Ekibi' : (lang === 'ar' ? 'فريق العمليات' : 'Operations Admin'))}
                )
              </span>
            </span>
          </div>
        </div>

        {/* Premium Live Clock and date */}
        <div className="flex flex-col items-start md:items-end bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 min-w-[220px] relative z-10 self-stretch md:self-auto justify-center">
          <span className="text-[10px] text-slate-500 font-black tracking-widest uppercase mb-1">
            {lang === 'tr' ? "HERZ DAHİLİ COĞRAFİ ZAMAN" : (lang === 'ar' ? "التوقيت العالمي الموحد" : "OPERATIONAL SYSTEM TIME (UTC)")}
          </span>
          <div className="font-mono text-xl md:text-2xl font-black text-orange-400 leading-none tracking-tight">
            {currentTime.toLocaleTimeString(lang === 'ar' ? 'ar-EG' : (lang === 'tr' ? 'tr-TR' : 'en-US'), { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
          <div className="text-xs text-slate-400 font-bold mt-1 text-right">
            {currentTime.toLocaleDateString(lang === 'ar' ? 'ar-EG' : (lang === 'tr' ? 'tr-TR' : 'en-US'), { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
          </div>
        </div>
      </div>

      {/* 📊 REAL-TIME OPERATIONS & DOCUMENT INTEGRITY HUB (RECHARTS CHARTS) */}
      <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/60 pb-3">
          <div className="space-y-1">
            <h3 className="text-sm font-black text-slate-900 tracking-tight flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-orange-500 rounded-full animate-pulse"></span>
              <span>{lang === 'tr' ? "Canlı Operasyonlar ve Belge Yönetimi" : (lang === 'ar' ? "لوحة الإحصائيات الفورية وتكامل الوثائق" : "Real-Time Operations & Document Integrity Hub")}</span>
            </h3>
            <p className="text-[11px] text-slate-500 font-medium">
              {lang === 'tr'
                ? "Sistem genelindeki aktif yük dağılımlarını, eksik evrak durumlarını ve anlık sürücü uyarılarını izleyin."
                : (lang === 'ar' ? "تتبع توزيع الأحمال النشطة، حالة تسليم الأوراق، وتواتر التنبيهات الفورية الواردة من السائقين." : "Provides live analytics on shipments, pending digital documents (etir backups), and incoming operational alert types.")}
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-orange-100 hover:bg-orange-200 text-orange-800 text-[10px] font-bold rounded-lg tracking-wider font-mono uppercase cursor-default self-start sm:self-auto select-none">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Live telemetry status</span>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Card A: Active Shipments Distribution */}
          <div className="bg-white p-4.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">{lang === 'tr' ? "Aktif Sevkiyat Dağılımı" : (lang === 'ar' ? "الشحنات النشطة حالياً" : "Active Cargo Loading")}</span>
                <h4 className="text-base font-black text-slate-900 tracking-tight flex items-baseline gap-1.5">
                  <span>{activeShipmentsCount}</span>
                  <span className="text-[10px] text-slate-400 font-mono font-medium">{lang === 'tr' ? "yük yolda" : "active loads"}</span>
                </h4>
              </div>
              <span className="p-2 bg-orange-500/10 text-orange-600 rounded-lg"><Truck className="w-4 h-4" /></span>
            </div>

            <div className="h-28 w-full select-none">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={[
                    { name: lang === 'tr' ? 'Karayolu' : 'Road', value: shipments.filter(s => s.status !== "Delivered" && s.status !== "Closed" && s.freightType === "land").length },
                    { name: lang === 'tr' ? 'Denizyolu' : 'Sea', value: shipments.filter(s => s.status !== "Delivered" && s.status !== "Closed" && s.freightType === "sea").length },
                    { name: lang === 'tr' ? 'Havayolu' : 'Air', value: shipments.filter(s => s.status !== "Delivered" && s.status !== "Closed" && s.freightType === "air").length }
                  ]}
                  margin={{ top: 5, right: 10, left: -20, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="colorActive" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563eb" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="name" stroke="#94a3b8" fontSize={9} tickLine={false} axisLine={false} />
                  <YAxis stroke="#94a3b8" fontSize={9} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: '#0f172a', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '10px' }} />
                  <Area type="monotone" dataKey="value" name={lang === 'tr' ? 'Sevkiyat' : 'Shipments'} stroke="#2563eb" strokeWidth={2} fillOpacity={1} fill="url(#colorActive)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Card B: Document Integrity Check */}
          <div className="bg-white p-4.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">{lang === 'tr' ? "Belge Güvence Takibi" : (lang === 'ar' ? "تكامل وثائق الشحن" : "Document Integrity")}</span>
                <h4 className="text-base font-black text-amber-600 tracking-tight flex items-baseline gap-1.5">
                  <span>{pendingDocumentsCount}</span>
                  <span className="text-[10px] text-slate-400 font-mono font-medium">{lang === 'tr' ? "ihbar var" : "need etir doc"}</span>
                </h4>
              </div>
              <span className="p-2 bg-gradient-to-tr from-amber-500/10 to-orange-500/10 text-amber-600 rounded-lg"><FileText className="w-4 h-4" /></span>
            </div>

            <div className="h-28 w-full select-none">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={realTimeDocsStats}
                  margin={{ top: 5, right: 10, left: -25, bottom: 0 }}
                  barSize={16}
                >
                  <XAxis dataKey="name" stroke="#94a3b8" fontSize={9} tickLine={false} axisLine={false} />
                  <YAxis stroke="#94a3b8" fontSize={9} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: '#0f172a', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '10px' }} />
                  <Bar dataKey="count" name={lang === 'tr' ? 'Miktar' : 'Count'} radius={[4, 4, 0, 0]}>
                    <Cell fill="#10b981" />
                    <Cell fill="#f59e0b" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Card C: Recent Notifications Distribution */}
          <div className="bg-white p-4.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">{lang === 'tr' ? "Bildirim Tipi Dağılımı" : (lang === 'ar' ? "تواتر تنبيهات النظام" : "Notification Volume")}</span>
                <h4 className="text-base font-black text-rose-600 tracking-tight flex items-baseline gap-1.5">
                  <span>{notifications.length}</span>
                  <span className="text-[10px] text-slate-400 font-mono font-medium">{lang === 'tr' ? "toplam bildirim" : "total notifications"}</span>
                </h4>
              </div>
              <span className="p-2 bg-gradient-to-tr from-rose-500/10 to-red-500/10 text-rose-600 rounded-lg"><BellRing className="w-4 h-4 animate-bounce" /></span>
            </div>

            <div className="h-28 w-full select-none">
              {notificationCountsChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={notificationCountsChartData.slice(0, 4)}
                    margin={{ top: 5, right: 10, left: -25, bottom: 0 }}
                    barSize={12}
                  >
                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={8.5} tickLine={false} axisLine={false} />
                    <YAxis stroke="#94a3b8" fontSize={9} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ background: '#0f172a', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '10px' }} />
                    <Bar dataKey="Alerts" name={lang === 'tr' ? 'Uyarı' : 'Alerts'} fill="#f43f5e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-400 text-[10px] italic">
                  {lang === 'tr' ? "Aktif uyarı bulunmamaktadır." : "No live system alerts found."}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Micro alert feed row for rapid response */}
        {recentAlertsData.length > 0 && (
          <div className="bg-slate-100 rounded-xl p-3 border border-slate-200/60 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <span className="font-bold text-slate-700 tracking-tight uppercase text-[10px] font-mono flex items-center gap-1.5 select-none shrink-0">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
              <span>{lang === 'tr' ? "En Son Sinyaller:" : "Immediate Action Feed:"}</span>
            </span>
            <div className="flex-1 overflow-hidden">
              <div className="text-[11px] text-slate-600 font-medium truncate">
                {lang === 'ar' ? recentAlertsData[0].messageAr : lang === 'tr' ? recentAlertsData[0].messageTr : recentAlertsData[0].messageEn}
              </div>
            </div>
            <span className="text-[9.5px] text-slate-400 font-mono whitespace-nowrap select-none">
              {new Date(recentAlertsData[0].timestamp).toLocaleTimeString(lang === 'tr' ? 'tr-TR' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        )}
      </div>

      {/* Phase 2A follow-up (blocking-issue fix): GET /api/shipments now
          returns only a bounded page — "Total Shipments," "Completed
          Deliveries," "Active Shipments," and the Status Breakdown chart
          below are real, full-scope server aggregates (GET
          /api/shipments/stats), never a partial count presented as
          complete. Everything else on this page (routes, fleet
          utilization, freight-type split, currency totals) is computed
          from whichever shipments are currently loaded in this session —
          this notice only shows while more exist beyond that. */}
      {shipmentsHasMore && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-[11px] text-amber-800 font-medium flex items-start gap-2">
          <span className="mt-0.5">ℹ️</span>
          <span>
            {lang === 'tr'
              ? "Toplam Sevkiyat, Tamamlanan Teslimat, Aktif Sevkiyat ve Durum Dağılımı grafiği tam ve doğru toplam rakamlardır. Bu sayfadaki diğer tüm metrikler (rotalar, filo doluluğu, para birimi toplamları) yalnızca şu anda yüklenmiş sevkiyatları yansıtır — daha fazlası mevcut."
              : lang === 'ar'
                ? "إجمالي الشحنات، التسليمات المكتملة، الشحنات النشطة، ورسم توزيع الحالة أدناه هي إجماليات دقيقة وكاملة. جميع المقاييس الأخرى في هذه الصفحة (المسارات، إشغال الأسطول، إجماليات العملات) تعكس فقط الشحنات المحمّلة حالياً — يوجد المزيد."
                : "Total Shipments, Completed Deliveries, Active Shipments, and the Status Breakdown chart below are exact, complete totals. Every other metric on this page (routes, fleet utilization, currency totals) reflects only the shipments currently loaded — more exist beyond what's shown here."}
          </span>
        </div>
      )}

      {/* KPI Summary Banner */}
      <div className={`grid ${isMobileMode ? 'grid-cols-1 gap-3' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'}`}>
        {/* Active Shipments KPI */}
        <div className="bg-white p-5 rounded-xl border border-slate-200/80 hover:border-slate-300 shadow-xs flex items-center justify-between transition-all group hover:-translate-y-0.5">
          <div className="space-y-1">
            <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">{t('activeShipments')}</span>
            <p className="text-3xl font-black text-slate-900">{activeShipmentsCount}</p>
            <div className="flex items-center gap-1 text-[10px] font-bold text-orange-500">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-ping"></span>
              <span>
                {lang === 'tr' ? `${shipments.filter(s => s.status === 'In Transit').length} yolda aktif` : (lang === 'ar' ? `${shipments.filter(s => s.status === 'In Transit').length} في الطريق` : `${shipments.filter(s => s.status === 'In Transit').length} in active transit`)}
              </span>
            </div>
          </div>
          <div className="p-3 bg-orange-50 text-orange-600 rounded-lg group-hover:bg-orange-100 transition-colors">
            <RefreshCw className="w-6 h-6 animate-spin-slow text-orange-600" />
          </div>
        </div>

        {/* Total Shipments Registry KPI */}
        <div className="bg-white p-5 rounded-xl border border-slate-200/80 hover:border-slate-300 shadow-xs flex items-center justify-between transition-all group hover:-translate-y-0.5">
          <div className="space-y-1">
            <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">{t('totalShipments')}</span>
            <p className="text-3xl font-black text-slate-800">{totalShipmentsCount}</p>
            <div className="text-[10px] font-bold text-slate-500 flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-slate-400"></span>
              <span>
                {lang === 'tr' ? `${shipments.filter(s => s.freightType === 'sea').length} Deniz • ${shipments.filter(s => s.freightType === 'air').length} Hava` : (lang === 'ar' ? `${shipments.filter(s => s.freightType === 'sea').length} بحري • ${shipments.filter(s => s.freightType === 'air').length} جوي` : `${shipments.filter(s => s.freightType === 'sea').length} Sea • ${shipments.filter(s => s.freightType === 'air').length} Air`)}
              </span>
            </div>
          </div>
          <div className="p-3 bg-slate-100 text-slate-700 rounded-lg group-hover:bg-slate-200 transition-colors">
            <Ship className="w-6 h-6 text-slate-700" />
          </div>
        </div>

        {/* Successful Deliveries KPI */}
        <div className="bg-white p-5 rounded-xl border border-slate-200/80 hover:border-slate-300 shadow-xs flex items-center justify-between transition-all group hover:-translate-y-0.5">
          <div className="space-y-1">
            <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">{t('completedDelivery')}</span>
            <p className="text-3xl font-black text-emerald-600">{completedShipmentsCount}</p>
            <div className="text-[10px] font-bold text-emerald-600 flex items-center gap-1">
              <Check className="w-3.5 h-3.5" />
              <span>
                {(() => {
                  const pct = totalShipmentsCount > 0 ? Math.round((completedShipmentsCount / totalShipmentsCount) * 100) : 0;
                  return lang === 'tr' ? `Toplam sevkiyatın %${pct}'i` : (lang === 'ar' ? `${pct}% من إجمالي الشحنات` : `${pct}% of total shipments`);
                })()}
              </span>
            </div>
          </div>
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg group-hover:bg-emerald-100 transition-colors">
            <CheckCircle2 className="w-6 h-6 text-emerald-600" />
          </div>
        </div>

        {/* Fleet & Resource Capacity KPI */}
        <div className="bg-white p-5 rounded-xl border border-slate-200/80 hover:border-slate-300 shadow-xs flex items-center justify-between transition-all group hover:-translate-y-0.5">
          <div className="space-y-1">
            <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">
              {lang === 'tr' ? "Sürücü Doluluk Oranı" : (lang === 'ar' ? "إشغال أسطول السائقين" : "Fleet Utilization")}
            </span>
            <p className="text-3xl font-black text-indigo-700">
              {(() => {
                const activeFleet = getAssignableDrivers(drivers);
                return activeFleet.length > 0 ? `${Math.round((activeFleet.filter(d => shipments.some(s => s.assignedDriverId === d.id && s.status !== "Delivered" && s.status !== "Closed")).length / activeFleet.length) * 100)}%` : "0%";
              })()}
            </p>
            <div className="text-[10px] font-bold text-slate-500">
              {(() => {
                const activeFleet = getAssignableDrivers(drivers);
                return <span>{activeFleet.filter(d => shipments.some(s => s.assignedDriverId === d.id && s.status !== "Delivered" && s.status !== "Closed")).length} / {activeFleet.length} {lang === 'tr' ? "aktif sürücü görevde" : (lang === 'ar' ? "سائل مكلف حالياً" : "capacity allocated")}</span>;
              })()}
            </div>
          </div>
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-lg group-hover:bg-indigo-100 transition-colors">
            <Truck className="w-6 h-6 text-indigo-600" />
          </div>
        </div>
      </div>

      {/* Key Operational Metrics Visualization */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Column 1 & 2 (Span 2): Shipments by Route */}
        <div className="lg:col-span-2 bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-orange-500"></span>
              <span>
                {lang === 'tr' ? "Seferlere Göre Sevkıyat Dağılımı" : (lang === 'ar' ? "توزيع الشحنات حسب مسار النقل" : "Shipment Volume by Route")}
              </span>
            </h3>
            <p className="text-slate-500 text-xs mt-0.5 font-medium">
              {lang === 'tr' ? "En çok tercih edilen yükleme ve teslimat rotalarının analizi" : (lang === 'ar' ? "تحليل الكثافة التشغيلية لأكثر مسارات النقل استخداماً" : "Top active loading/discharge logistics channels sorted by volume")}
            </p>
          </div>

          <div className="h-64 mt-6">
            {routeChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={routeChartData}
                  margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                >
                  <XAxis type="number" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    stroke="#475569"
                    fontSize={10.5}
                    fontFamily="monospace"
                    tickLine={false}
                    axisLine={false}
                    width={130}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(241, 245, 249, 0.6)' }}
                    contentStyle={{
                      background: '#0f172a',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#fff',
                      fontSize: '11px',
                      fontWeight: 'bold',
                    }}
                  />
                  <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={12}>
                    {routeChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#3b82f6' : '#2563eb'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400 italic text-xs font-semibold">
                {lang === 'tr' ? "Aktif rota bilgisi bulunamadı." : (lang === 'ar' ? "لا يوجد بيانات للمسارات النشطة" : "No active route statistics available.")}
              </div>
            )}
          </div>
        </div>

        {/* Column 3: Shipment Analytics */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between relative">
          <div>
            <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-orange-500"></span>
              <span>
                {lang === 'tr' ? "Sevkiyat Analizi" : (lang === 'ar' ? "تحليلات الشحنات" : "Shipment Analytics")}
              </span>
            </h3>
            <p className="text-slate-500 text-xs mt-0.5 font-medium">
              {lang === 'tr' ? "Bekleyen, aktif ve tamamlanan sevkiyatların genel dağılımı" : (lang === 'ar' ? "توزيع الشحنات الكلي بين شحنات معلقة، نشطة ومكتملة" : "Comprehensive breakdown of pending, active, and completed shipments")}
            </p>
          </div>

          <div className="h-64 mt-4 relative flex items-center justify-center">
            {shipmentAnalyticsData.length > 0 ? (
              <div className="w-full h-full relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={shipmentAnalyticsData}
                      cx="50%"
                      cy="48%"
                      innerRadius={65}
                      outerRadius={85}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {shipmentAnalyticsData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: '#0f172a',
                        border: 'none',
                        borderRadius: '8px',
                        color: '#fff',
                        fontSize: '11px',
                        fontWeight: 'bold',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* Inner Center Statistics Indicator */}
                <div className="absolute top-[41%] left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none select-none">
                  <p className="text-[10px] text-slate-500 font-extrabold uppercase tracking-widest">{lang === 'tr' ? "TOPLAM" : "TOTAL"}</p>
                  <p className="text-2xl font-black text-slate-800 leading-none">
                    {shipments.length}
                  </p>
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400 italic text-xs font-semibold">
                {lang === 'tr' ? "Aktif sevkiyat bilgi bulunamadı." : (lang === 'ar' ? "لا توجد بيانات متاحة للشحنات" : "No shipment analytics data found.")}
              </div>
            )}
          </div>

          {/* Status Shares & Breakdown */}
          <div className="grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 mt-2 select-none">
            <div className="text-center">
              <div className="flex items-center justify-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0"></span>
                <span className="text-[10px] text-slate-500 font-extrabold uppercase tracking-tight">
                  {lang === 'tr' ? 'Bekleyen' : (lang === 'ar' ? 'معلقة' : 'Pending')}
                </span>
              </div>
              <p className="text-sm font-black text-slate-800 mt-0.5">{pendingCountVal}</p>
              <p className="text-[9px] text-slate-400 font-medium font-mono">
                {shipments.length > 0 ? `${Math.round((pendingCountVal / shipments.length) * 100)}%` : '0%'}
              </p>
            </div>

            <div className="text-center border-x border-slate-100">
              <div className="flex items-center justify-center gap-1">
                <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0"></span>
                <span className="text-[10px] text-slate-500 font-extrabold uppercase tracking-tight">
                  {lang === 'tr' ? 'Aktif' : (lang === 'ar' ? 'نشطة' : 'Active')}
                </span>
              </div>
              <p className="text-sm font-black text-slate-800 mt-0.5">{activeCountVal}</p>
              <p className="text-[9px] text-slate-400 font-medium font-mono">
                {shipments.length > 0 ? `${Math.round((activeCountVal / shipments.length) * 100)}%` : '0%'}
              </p>
            </div>

            <div className="text-center">
              <div className="flex items-center justify-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
                <span className="text-[10px] text-slate-500 font-extrabold uppercase tracking-tight">
                  {lang === 'tr' ? 'Tamamlanan' : (lang === 'ar' ? 'مكتملة' : 'Completed')}
                </span>
              </div>
              <p className="text-sm font-black text-slate-800 mt-0.5">{completedCountVal}</p>
              <p className="text-[9px] text-slate-400 font-medium font-mono">
                {shipments.length > 0 ? `${Math.round((completedCountVal / shipments.length) * 100)}%` : '0%'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* New Interactive Bento Layout (3-Column Layout) */}
      <div className={`grid grid-cols-1 ${isMobileMode ? '' : 'lg:grid-cols-3'} gap-6`}>

        {/* Left & Center 2 Columns: Live Control Center Table */}
        <div className={`${isMobileMode ? '' : 'lg:col-span-2'} bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full`}>

          {/* Header and Filter Controls */}
          <div className="p-5 border-b border-slate-100 bg-slate-50/40">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-orange-500 animate-ping"></span>
                  <span>{lang === 'tr' ? "Anlık Transit Takip İstasyon İzleme" : (lang === 'ar' ? "مراقبة مسار الشحنات الميدانية" : "Live Cargo Transit Monitoring")}</span>
                </h3>
                <p className="text-slate-500 text-xs mt-0.5 font-medium">
                  {lang === 'tr' ? "etir entegrasyonuyla canlı durum ve evrak doğrulaması" : (lang === 'ar' ? "التحقق المباشر من وثائق الشحنات البرية والبحرية والجوية" : "Real-time dispatch control and document validation for logistics operations")}
                </p>
              </div>

              {/* Action short-cut to register dispatch */}
              <button
                onClick={() => {
                  setNewShipmentData(createEmptyShipmentForm());
                  setUseCustomPOL(false);
                  setUseCustomPOD(false);
                  setIsCreateOpen(true);
                }}
                className="self-start sm:self-auto px-3.5 py-1.5 bg-slate-950 hover:bg-slate-800 text-white font-extrabold rounded-lg text-xs tracking-wide transition-all shadow-sm hover:shadow-md flex items-center gap-1.5 border-0 focus:outline-none cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>{t('createShipment')}</span>
              </button>
            </div>

            {/* Direct Filter Pill Bars */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-4 pt-4 border-t border-slate-100">
              <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 max-w-max">
                {([
                  { id: 'all', label: lang === 'tr' ? 'Tümü' : 'All' },
                  { id: 'land', label: lang === 'tr' ? 'Kara' : 'Land' },
                  { id: 'sea', label: lang === 'tr' ? 'Deniz' : 'Sea' },
                  { id: 'air', label: lang === 'tr' ? 'Hava' : 'Air' }
                ] as const).map(type => (
                  <button
                    key={type.id}
                    type="button"
                    onClick={() => {
                      setStatusFilter("all");
                      setTypeFilter(type.id);
                    }}
                    className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all border-0 cursor-pointer ${
                      typeFilter === type.id
                        ? 'bg-white text-slate-950 shadow-xs font-black'
                        : 'text-slate-500 hover:text-slate-900 bg-transparent'
                    }`}
                  >
                    {type.label}
                  </button>
                ))}
              </div>

              <div className="relative flex-1 sm:max-w-xs">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2 text-slate-400" />
                <input
                  type="text"
                  placeholder={t('searchShipment')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8.5 pr-8 py-1 bg-white hover:bg-slate-50 focus:bg-white text-xs border border-slate-200 focus:border-slate-400 rounded-lg focus:outline-none transition-all"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1.5 text-slate-400 hover:text-slate-900 bg-transparent border-0 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Enhanced Interactive table */}
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                  <th className="p-4">{lang === 'tr' ? "Yük No" : (lang === 'ar' ? "رقم الشحنة" : "Ref / Waybill")}</th>
                  <th className="p-4">{t('companyName')}</th>
                  <th className="p-4">{lang === 'tr' ? "Güzergah" : (lang === 'ar' ? "المسار" : "Transit Leg Route")}</th>
                  <th className="p-4">{t('carrierAmount')}</th>
                  <th className="p-4">{t('status')}</th>
                  <th className="p-4 text-right">{t('actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredShipments.map((shipment) => {
                  const fType = shipment.freightType || "land";
                  return (
                    <tr key={shipment.id} className="hover:bg-slate-50/65 transition-colors">
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          {/* Freight type icon */}
                          {fType === 'sea' ? (
                            <span className="p-1.5 bg-blue-50 text-blue-600 rounded-md" title="Ocean Freight"><Anchor className="w-3.5 h-3.5" /></span>
                          ) : fType === 'air' ? (
                            <span className="p-1.5 bg-indigo-50 text-indigo-600 rounded-md" title="Air Cargo"><Plane className="w-3.5 h-3.5" /></span>
                          ) : (
                            <span className="p-1.5 bg-orange-50 text-orange-600 rounded-md" title="Land Goods"><Truck className="w-3.5 h-3.5" /></span>
                          )}
                          <div>
                            <span className="font-mono font-bold text-slate-900 text-xs block selectable">#{shipment.shipmentNumber}</span>
                            <span className="text-[9.5px] text-slate-400 capitalize font-medium">{fType} Transit</span>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="font-extrabold text-slate-800 leading-snug">{shipment.companyName}</div>
                        <span className="text-[10px] text-slate-400 block truncate max-w-[170px] italic">
                          {shipment.cargoDescription || "General Cargo Shipment"}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-1.5">
                          <div>
                            <span className="font-bold text-slate-800 block text-xs">{shipment.loadingCity}</span>
                            <span className="text-[9.5px] text-slate-400 block">{shipment.loadingCountry}</span>
                          </div>
                          <span className="text-slate-400 font-bold">➔</span>
                          <div>
                            <span className="font-bold text-slate-800 block text-xs">{shipment.deliveryCity}</span>
                            <span className="text-[9.5px] text-slate-400 block">{shipment.deliveryCountry}</span>
                          </div>
                        </div>
                      </td>
                      <td className="p-4 font-mono font-bold text-slate-900">
                        <span className="text-slate-900 block font-black text-xs">
                          {shipment.agreedAmount.toLocaleString()} {shipment.currency}
                        </span>
                        <span className="text-[9px] text-slate-400 font-medium block">Agreed Amount</span>
                      </td>
                      <td className="p-4">
                        <div className="space-y-1">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-black uppercase border tracking-wider leading-none ${
                            shipment.status === 'New' ? 'bg-slate-50 text-slate-600 border-slate-200' :
                            shipment.status === 'Waiting for Driver Quotes' ? 'bg-sky-50 text-sky-700 border-sky-200' :
                            shipment.status === 'Assigned' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                            shipment.status === 'Accepted' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            shipment.status === 'Arrived' || shipment.status === 'Delivered' ? 'bg-green-50 text-green-800 border-green-200' :
                            'bg-blue-50 text-blue-700 border-blue-200'
                          }`}>
                            <span className="w-1 h-1 rounded-full bg-current mr-1 shrink-0 animate-pulse"></span>
                            {shipment.status}
                          </span>

                          {/* Micro shipment progress state */}
                          {(() => {
                            const analysis = analyzeShipmentTiming(shipment);
                            return (
                              <div className="flex flex-col gap-1 w-28">
                                <div className="flex items-center justify-between text-[9px] text-slate-400 font-mono font-bold">
                                  <span className="flex items-center gap-1">
                                    <Clock className="w-2.5 h-2.5 inline shrink-0" />
                                    <span>{analysis.label}</span>
                                  </span>
                                  <span className={`${analysis.textColorClass}`}>{getShipmentProgressPercentage(shipment)}%</span>
                                </div>
                                <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all duration-500 ${analysis.colorClass}`}
                                    style={{ width: `${getShipmentProgressPercentage(shipment)}%` }}
                                  />
                                </div>
                                <div className="text-[8px] text-slate-400 font-medium truncate" title={analysis.subtext}>
                                  {analysis.subtext}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="p-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setOpenDetailsId(shipment.id)}
                            className="p-1 px-2.5 text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-800 rounded font-bold transition-all border-0 cursor-pointer"
                          >
                            {lang === 'tr' ? "Detay" : (lang === 'ar' ? "التفاصيل" : "Details")}
                          </button>

                          {/* Quick Track Link Copy */}
                          <button
                            onClick={async () => {
                              const trackLink = getDirectLink(shipment.shareToken);
                              await navigator.clipboard.writeText(trackLink);
                              triggerToast(t('copied'));
                            }}
                            className="p-1.5 text-slate-400 hover:text-orange-600 hover:bg-orange-50 rounded transition-all border-0 bg-transparent cursor-pointer"
                            title={t('copyLink')}
                          >
                            <Share2 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => onSelectShipmentChat(shipment)}
                            className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded transition-all border-0 bg-transparent cursor-pointer"
                            title="Chat Session"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredShipments.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-12 text-center text-slate-400 italic">
                      <AlertCircle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <span>{t('noShipmentsMatched')}</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Widget Column: Central Control panel & Activity logging */}
        <div className="space-y-6">

          {/* Widget A: Real-Time Operational Activity Logging.
              Audit/activity log content is super-only (canViewAuditLogs,
              adminAccess.ts) — this widget used to render unconditionally
              on the Dashboard, which every admin type sees, and its "Full
              Audit" button opened the 'audit' tab despite that tab being
              hidden from operation/accounts in filteredAdminTabs. Gate it
              the same way the 'reports' quick link below already is. */}
          {isSuperAdmin && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col justify-between">
              <div className="p-4 border-b border-slate-100 bg-slate-50/30 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-black uppercase text-slate-800 tracking-wider flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-indigo-600"></span>
                    <span>{lang === 'tr' ? "Canlı Güvenlik Logları" : (lang === 'ar' ? "سجل النشاط الإداري" : "Operational Activity Stream")}</span>
                  </h4>
                  <p className="text-[10px] text-slate-500 font-medium">Real-time immutable control ledger</p>
                </div>
                <button
                  onClick={() => setActiveTab('audit')}
                  className="text-[10px] text-orange-600 hover:underline font-black uppercase tracking-wider bg-transparent border-0 cursor-pointer"
                >
                  {lang === 'tr' ? "Tümünü Gör" : (lang === 'ar' ? "الكل" : "Full Audit")}
                </button>
              </div>

              <div className="p-4 divide-y divide-slate-100 max-h-[290px] overflow-y-auto scrollbar-thin space-y-3">
                {activityLogs.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 text-xs italic">
                    No operational logs registered yet.
                  </div>
                ) : (
                  activityLogs.slice(0, 5).map((log, idx) => (
                    <div key={log.id || idx} className="pt-2 pb-1.5 text-[11px] first:pt-0">
                      <div className="flex items-center justify-between text-slate-400 text-[10px] mb-0.5">
                        <span className="font-bold text-slate-700 truncate max-w-[120px] bg-slate-100 px-1.5 py-0.5 rounded">
                          {log.actor}
                        </span>
                        <span className="font-mono">
                          {new Date(log.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-slate-600 font-semibold leading-relaxed">
                        {lang === 'tr' ? log.actionTr : (lang === 'ar' ? log.actionAr : log.actionEn)}
                      </p>
                      {log.shipmentNumber && (
                        <span className="text-[9.5px] text-indigo-600 font-extrabold mt-0.5 block">
                          Shipment Ref: #{log.shipmentNumber}
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Widget B: Fast Navigation Operations Drawer */}
          <div className="bg-slate-950 bg-slate-900 text-white rounded-xl p-5 border border-slate-800 shadow-lg flex flex-col justify-between">
            <div>
              <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider mb-1">
                {lang === 'tr' ? "Hızlı Lojistik Eylemleri" : (lang === 'ar' ? "إجراءات إدارية سريعة" : "Administrative Operations Quick Links")}
              </h4>
              <p className="text-[11px] text-slate-300 font-medium mb-4 leading-relaxed">
                Access secondary configuration systems with one click:
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={() => setActiveTab('clients')}
                className="p-3 text-left bg-slate-800/80 hover:bg-slate-800 rounded-lg border border-slate-700/60 transition-all text-xs group cursor-pointer"
              >
                <Building2 className="w-4 h-4 text-orange-400 mb-1.5 group-hover:scale-105 transition-transform" />
                <p className="font-bold text-slate-200">{lang === 'tr' ? "Müşteri Portalı" : (lang === 'ar' ? "قاعدة العملاء" : "Clients Registry")}</p>
                <span className="text-[9px] text-slate-400 block font-normal">{clients.length} corporate partners</span>
              </button>

              {/* BUG-26: 'drivers' (Driver Alliance) is super/operation-only per
                  canViewDriverRoster (adminAccess.ts) and hidden from accounts admins
                  in the sidebar (filteredAdminTabs). This shortcut used to be
                  unconditional — not currently reachable by an accounts admin in
                  practice (they never land on this Dashboard tab at all, see
                  isAccountsAdminType above), but gated anyway for defense-in-depth,
                  consistent with the 'reports' shortcut below. */}
              {canViewDriverRoster && (
                <button
                  onClick={() => setActiveTab('drivers')}
                  className="p-3 text-left bg-slate-800/80 hover:bg-slate-800 rounded-lg border border-slate-700/60 transition-all text-xs group cursor-pointer"
                >
                  <Truck className="w-4 h-4 text-orange-400 mb-1.5 group-hover:scale-105 transition-transform" />
                  <p className="font-bold text-slate-200">{lang === 'tr' ? "Sürücü Birliği" : (lang === 'ar' ? "تحالف السائقين" : "Active Driver Fleet")}</p>
                  <span className="text-[9px] text-slate-400 block font-normal">{drivers.length} registered vehicles</span>
                </button>
              )}

              {/* BUG-26: same gap as 'drivers' above, for the GPS Tracking Map —
                  see canViewGpsTracking (adminAccess.ts). */}
              {canViewGpsTracking && (
                <button
                  onClick={() => setActiveTab('tracking_map')}
                  className="p-3 text-left bg-slate-800/80 hover:bg-slate-800 rounded-lg border border-slate-700/60 transition-all text-xs group cursor-pointer"
                >
                  <MapIcon className="w-4 h-4 text-emerald-400 mb-1.5 group-hover:scale-105 transition-transform" />
                  <p className="font-bold text-slate-200">{lang === 'tr' ? "Akıllı Takip Haritası" : (lang === 'ar' ? "خريطة التتبع" : "GIS Tracking Map")}</p>
                  <span className="text-[9px] text-slate-400 block font-normal">Smart Tracking</span>
                </button>
              )}

              {/* 'reports' is gated by canViewLogisticsAnalytics (super-only,
                  for now — see adminAccess.ts) and hidden from operation AND
                  accounts admins in the sidebar (filteredAdminTabs); this
                  shortcut used `resolvedAdminType !== 'operation'`, which let
                  it through for accounts too even though accounts can't view
                  Reports (canViewLogisticsAnalytics returns false for them —
                  not reachable today since accounts never lands on this
                  Dashboard tab, but fixed for the same defense-in-depth reason
                  as the other quick links here). */}
              {canViewLogisticsAnalytics && (
                <button
                  onClick={() => setActiveTab('reports')}
                  className="p-3 text-left bg-slate-800/80 hover:bg-slate-800 rounded-lg border border-slate-700/60 transition-all text-xs group cursor-pointer"
                >
                  <ClipboardList className="w-4 h-4 text-indigo-400 mb-1.5 group-hover:scale-105 transition-transform" />
                  <p className="font-bold text-slate-200">{lang === 'tr' ? "Lojistik Raporlar" : (lang === 'ar' ? "الإحصاءات المالية" : "Financial Reports")}</p>
                  <span className="text-[9px] text-slate-400 block font-normal">Revenue breakdowns</span>
                </button>
              )}
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
