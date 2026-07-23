import { useEffect, useMemo, useState } from "react";
import { Truck, Clock, FolderOpen, ShieldAlert, CheckCircle2, Gauge } from "lucide-react";
import type { Shipment, Driver, ActivityLog, Language } from "../../../types";
import type { TRANSLATIONS } from "../../../translations";
import { getAssignableDrivers } from "../../../lib/driverAccess";
import { apiFetch } from "../../../lib/api";

import DashboardHeader, { rangeStartMs, type DashboardRange } from "../dashboard/DashboardHeader";
import KpiGrid from "../dashboard/KpiGrid";
import KpiCard from "../dashboard/KpiCard";
import LiveOperationsMap from "../dashboard/LiveOperationsMap";
import ActionCenterCard, { type DecoratedFinding } from "../dashboard/ActionCenterCard";
import FinancialSnapshotCard from "../dashboard/FinancialSnapshotCard";
import ActiveShipmentsTable from "../dashboard/ActiveShipmentsTable";
import RecentActivityCard from "../dashboard/RecentActivityCard";

type TimingAnalysis = { colorClass: string; textColorClass: string; label: string; subtext: string; lagPercentage?: number };

const K: Record<string, Record<Language, string>> = {
  activeShipments: { en: "Active Shipments", tr: "Aktif Sevkiyatlar", ar: "الشحنات النشطة" },
  inTransit: { en: "in transit", tr: "yolda", ar: "قيد النقل" },
  delayed: { en: "Delayed Shipments", tr: "Geciken Sevkiyatlar", ar: "الشحنات المتأخرة" },
  needAttention: { en: "need attention", tr: "dikkat gerekiyor", ar: "تحتاج انتباه" },
  missingDocs: { en: "Missing Documents", tr: "Eksik Belgeler", ar: "مستندات ناقصة" },
  requiresAttention: { en: "requires attention", tr: "ilgi bekliyor", ar: "يتطلب اهتمامًا" },
  criticalFindings: { en: "Critical Findings", tr: "Kritik Bulgular", ar: "نتائج حرجة" },
  fixImmediately: { en: "fix immediately", tr: "hemen düzeltin", ar: "أصلح فورًا" },
  completed: { en: "Completed Deliveries", tr: "Tamamlanan Teslimatlar", ar: "تسليمات مكتملة" },
  ofTotal: { en: "of total shipments", tr: "toplam sevkiyatın", ar: "من إجمالي الشحنات" },
  fleet: { en: "Fleet Utilization", tr: "Filo Kullanımı", ar: "استخدام الأسطول" },
  vehicles: { en: "vehicles", tr: "araç", ar: "مركبات" },
  loadedNotice: {
    en: "Delayed, Missing Documents, and Fleet Utilization reflect only the shipments currently loaded — more exist beyond what's shown here.",
    tr: "Geciken, Eksik Belge ve Filo Kullanımı yalnızca şu anda yüklü sevkiyatları yansıtır — daha fazlası mevcut.",
    ar: "المتأخرة والمستندات الناقصة واستخدام الأسطول تعكس فقط الشحنات المحمّلة حاليًا — يوجد المزيد.",
  },
};
const L = (k: string, lang: Language) => K[k]?.[lang] ?? K[k]?.en ?? k;

interface AdminDashboardSectionProps {
  lang: Language;
  isRtl: boolean;
  t: (key: keyof typeof TRANSLATIONS["en"]) => string;
  currentTime: Date;
  lastSyncedAt: Date | null;

  shipments: Shipment[];
  drivers: Driver[];
  activityLogs: ActivityLog[];

  activeShipmentsCount: number;
  totalShipmentsCount: number;
  completedShipmentsCount: number;
  pendingDocumentsCount: number;
  shipmentsHasMore: boolean;

  searchQuery: string;
  setSearchQuery: (v: string) => void;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  typeFilter: string;
  setTypeFilter: (v: string) => void;
  filteredShipments: Shipment[];

  setOpenDetailsId: (id: string | null) => void;
  analyzeShipmentTiming: (s: Shipment) => TimingAnalysis;
  getShipmentProgressPercentage: (s: Shipment) => number;
  getDirectLink: (token: string) => string;
  triggerToast: (msg: string) => void;
  onSelectShipmentChat: (s: Shipment) => void;

  canViewFinancial: boolean;
  canViewGpsTracking: boolean;
  canViewAudit: boolean;
  onViewAllShipments: () => void;
  onOpenTrackingMap: () => void;
  onOpenAudit: () => void;
  onOpenFinancialDetails: () => void;
  onOpenActionCenter: () => void;
}

/** Buckets a per-day count series (oldest→newest) over the last `days` days. */
function dailySeries(shipments: Shipment[], days: number, dateOf: (s: Shipment) => string | undefined): number[] {
  const buckets = new Array(days).fill(0);
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const startMs = startOfToday.getTime();
  const day = 86_400_000;
  for (const s of shipments) {
    const iso = dateOf(s);
    if (!iso) continue;
    const ms = new Date(iso).getTime();
    if (Number.isNaN(ms)) continue;
    const idx = days - 1 - Math.floor((startMs - ms) / day);
    if (idx >= 0 && idx < days) buckets[idx] += 1;
  }
  return buckets;
}

/**
 * Dashboard Overview (desktop/tablet) — a concise, decision-focused
 * command view that fits mostly within one viewport: six KPIs, the live
 * operations map, the action center, a currency-tabbed financial snapshot,
 * active shipments, and recent activity. Every figure is REAL data passed
 * from AdminPanel or fetched from the existing accounting/audit APIs; no
 * mocks. The long analytics/brief/executive sections that used to stack
 * here now live on their own tabs/pages (kept fully accessible), which is
 * what makes this page dramatically shorter than before.
 *
 * The phone experience is served by MobileDashboard (AdminPanel decides);
 * this component is still fully responsive down to small widths.
 */
export default function AdminDashboardSection(props: AdminDashboardSectionProps) {
  const {
    lang, isRtl, t, currentTime, lastSyncedAt,
    shipments, drivers, activityLogs,
    activeShipmentsCount, totalShipmentsCount, completedShipmentsCount, pendingDocumentsCount, shipmentsHasMore,
    searchQuery, setSearchQuery, statusFilter, setStatusFilter, typeFilter, setTypeFilter, filteredShipments,
    setOpenDetailsId, analyzeShipmentTiming, getShipmentProgressPercentage, getDirectLink, triggerToast, onSelectShipmentChat,
    canViewFinancial, canViewGpsTracking, canViewAudit,
    onViewAllShipments, onOpenTrackingMap, onOpenAudit, onOpenFinancialDetails, onOpenActionCenter,
  } = props;

  const [range, setRange] = useState<DashboardRange>("30d");

  // --- Open audit findings (drive the Action Center + Critical KPI). One
  //     fetch here, viewer-filtered + priority-ordered by the server. ---
  const [findings, setFindings] = useState<DecoratedFinding[]>([]);
  const [findingsLoading, setFindingsLoading] = useState(true);
  const [findingsError, setFindingsError] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiFetch("/api/admin/audit/findings?status=open");
        if (!alive) return;
        if (!res.ok) { setFindingsError(true); setFindingsLoading(false); return; }
        const body = await res.json();
        if (!alive) return;
        setFindings(Array.isArray(body.findings) ? body.findings : []);
        setFindingsLoading(false);
      } catch {
        if (alive) { setFindingsError(true); setFindingsLoading(false); }
      }
    })();
    return () => { alive = false; };
  }, []);

  const criticalCount = useMemo(() => findings.filter((f) => f.priority?.priority === "critical_now").length, [findings]);
  const dueTodayCount = useMemo(() => findings.filter((f) => f.priority?.priority === "high_today").length, [findings]);

  // Delayed = loaded shipments whose timing analysis is red (Delayed/Lagging).
  const delayedCount = useMemo(
    () => shipments.filter((s) => analyzeShipmentTiming(s).colorClass.startsWith("bg-red-500")).length,
    [shipments, analyzeShipmentTiming]
  );

  // Fleet utilization from assignable drivers currently carrying live jobs.
  const { fleetPct, fleetBusy, fleetTotal } = useMemo(() => {
    const fleet = getAssignableDrivers(drivers);
    const busy = fleet.filter((d) => shipments.some((s) => s.assignedDriverId === d.id && s.status !== "Delivered" && s.status !== "Closed")).length;
    return { fleetPct: fleet.length ? Math.round((busy / fleet.length) * 100) : 0, fleetBusy: busy, fleetTotal: fleet.length };
  }, [drivers, shipments]);

  const completedTrend = useMemo(() => dailySeries(shipments, 14, (s) =>
    ["Arrived", "Delivered", "Closed", "Completed"].includes(s.status) ? (s.updatedAt || s.createdAt) : undefined
  ), [shipments]);
  const activeTrend = useMemo(() => dailySeries(shipments, 14, (s) => s.createdAt), [shipments]);

  const completedPct = totalShipmentsCount > 0 ? Math.round((completedShipmentsCount / totalShipmentsCount) * 100) : 0;
  const liveTransit = useMemo(() => shipments.filter((s) => s.status === "In Transit").length, [shipments]);

  // Recent activity windowed by the header's date range (client-side, honest).
  const windowedLogs = useMemo(() => {
    const startMs = rangeStartMs(range, Date.now());
    return activityLogs.filter((l) => {
      const ms = new Date(l.timestamp).getTime();
      return Number.isNaN(ms) ? true : ms >= startMs;
    });
  }, [activityLogs, range]);

  const dashboardShipments = filteredShipments.slice(0, 5);

  const onCopyLink = async (s: Shipment) => {
    try {
      await navigator.clipboard.writeText(getDirectLink(s.shareToken));
      triggerToast(t("copied"));
    } catch { /* clipboard unavailable — silently ignore */ }
  };

  return (
    <div className="space-y-4" dir={isRtl ? "rtl" : "ltr"}>
      <DashboardHeader lang={lang} lastSyncedAt={lastSyncedAt} currentTime={currentTime} range={range} onRangeChange={setRange} />

      {shipmentsHasMore && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[11px] font-medium text-amber-800">
          <span className="mt-0.5">ℹ️</span>
          <span>{L("loadedNotice", lang)}</span>
        </div>
      )}

      {/* KPI row */}
      <KpiGrid>
        <KpiCard label={L("activeShipments", lang)} value={activeShipmentsCount} hint={`${liveTransit} ${L("inTransit", lang)}`} icon={Truck} tone="blue" sparkline={activeTrend} onClick={onViewAllShipments} title={L("activeShipments", lang)} />
        <KpiCard label={L("delayed", lang)} value={delayedCount} hint={L("needAttention", lang)} icon={Clock} tone="rose" onClick={onViewAllShipments} title={L("delayed", lang)} />
        <KpiCard label={L("missingDocs", lang)} value={pendingDocumentsCount} hint={L("requiresAttention", lang)} icon={FolderOpen} tone="amber" onClick={onViewAllShipments} title={L("missingDocs", lang)} />
        <KpiCard label={L("criticalFindings", lang)} value={criticalCount} hint={L("fixImmediately", lang)} icon={ShieldAlert} tone="rose" onClick={onOpenActionCenter} title={L("criticalFindings", lang)} />
        <KpiCard label={L("completed", lang)} value={completedShipmentsCount} hint={`${completedPct}% ${L("ofTotal", lang)}`} icon={CheckCircle2} tone="emerald" sparkline={completedTrend} />
        <KpiCard label={L("fleet", lang)} value={`${fleetPct}%`} icon={Gauge} tone="indigo" progress={{ value: fleetPct, label: `${fleetBusy} / ${fleetTotal} ${L("vehicles", lang)}` }} />
      </KpiGrid>

      {/* Row 2: Map · Action Center · Financial Snapshot. Spans adapt to the
          viewer's permissions so there is never an empty gap: the map only
          shows to GPS-permitted roles, the financial snapshot only to
          accounting roles, and the Action Center takes up the remainder. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {canViewGpsTracking && (
          <div className={canViewFinancial ? "lg:col-span-5" : "lg:col-span-8"}>
            <LiveOperationsMap shipments={shipments} drivers={drivers} lang={lang} onViewAll={onOpenTrackingMap} />
          </div>
        )}
        <div className={
          canViewGpsTracking && canViewFinancial ? "lg:col-span-3"
            : canViewGpsTracking ? "lg:col-span-4"
            : canViewFinancial ? "lg:col-span-5"
            : "lg:col-span-12"
        }>
          <ActionCenterCard
            findings={findings}
            loading={findingsLoading}
            error={findingsError}
            criticalCount={criticalCount}
            dueTodayCount={dueTodayCount}
            delayedCount={delayedCount}
            lang={lang}
            onOpenFinding={onOpenActionCenter}
            onViewAll={onOpenActionCenter}
          />
        </div>
        {canViewFinancial && (
          <div className={canViewGpsTracking ? "lg:col-span-4" : "lg:col-span-7"}>
            <FinancialSnapshotCard lang={lang} onViewDetails={onOpenFinancialDetails} />
          </div>
        )}
      </div>

      {/* Row 3: Active Shipments · Recent Activity. The audit feed stays
          super-admin-only (same gate as the previous Operational Activity
          Stream); other roles get the full-width shipments table. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className={canViewAudit ? "lg:col-span-8" : "lg:col-span-12"}>
          <ActiveShipmentsTable
            shipments={dashboardShipments}
            activeCount={activeShipmentsCount}
            drivers={drivers}
            lang={lang}
            isRtl={isRtl}
            t={t}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            typeFilter={typeFilter}
            setTypeFilter={setTypeFilter}
            onOpenDetails={(id) => setOpenDetailsId(id)}
            onOpenChat={onSelectShipmentChat}
            onCopyLink={onCopyLink}
            onViewAll={onViewAllShipments}
            analyzeShipmentTiming={analyzeShipmentTiming}
            getShipmentProgressPercentage={getShipmentProgressPercentage}
          />
        </div>
        {canViewAudit && (
          <div className="lg:col-span-4">
            <RecentActivityCard logs={windowedLogs} lang={lang} onViewAll={onOpenAudit} />
          </div>
        )}
      </div>
    </div>
  );
}
