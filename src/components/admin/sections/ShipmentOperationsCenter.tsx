/**
 * ShipmentOperationsCenter.tsx
 * ------------------------------------------------------------------
 * Production implementation of the APPROVED "Shipment Operations Center"
 * (Revision 2) design for the Admin Web — royal-blue design language.
 *
 * This is a PRESENTATIONAL desktop shell only. It changes NO business
 * logic: it receives the already-computed shipment lists, the existing
 * filter state + setters, the existing timing/progress helpers, and the
 * existing View / Edit / Chat / Create handlers from AdminPanel and simply
 * renders the approved layout on top of them.
 *
 *  - The single visible internal reference is the Order Number
 *    (shipment.shipmentNumber, MAR-YYYY-0001). No "Shipment #" / ETIR / ID.
 *  - External references (Container / BL / AWB / Booking) are shown as
 *    independent secondary fields, only when present on the record.
 *  - KPI cards / command bar / quick chips are derived from the real
 *    in-memory shipment data (deterministic counts). No fabricated trend
 *    series or backend calls are introduced.
 *  - Advanced interactions with no current backing (Saved Views &
 *    Column-Manager persistence, cross-entity Universal Search indexing,
 *    advanced bulk actions) are built as UI only and are clearly inert —
 *    ready for future integration. See the delivery notes.
 *
 * The existing mobile registry (MobileOrdersList), the Details / Edit /
 * Create modals, chat, permissions and pagination all remain in
 * AdminPanel, untouched — this component is only rendered on desktop.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Search, Truck, Anchor, Plane, MapPin, Users, DollarSign, FileText,
  MessageSquare, Bell, Plus, Filter, ChevronDown, Sparkles, X, Eye,
  Columns, SlidersHorizontal, LayoutGrid, ArrowRight, Check, Clock,
  ShieldCheck, AlertTriangle, Route, Package, Download, Send, Phone,
  Building2, Container, History, Copy, Printer, Layers, Hourglass, Siren,
  UserCheck, ChevronRight, Inbox, GripVertical, Navigation,
} from "lucide-react";
import type { Shipment, Language } from "../../../types";

type Timing = { colorClass: string; textColorClass: string; bgBadgeClass?: string; label: string; subtext: string };

interface Props {
  lang: Language;
  isRtl: boolean;
  /** All currently-loaded shipments — used for the KPI / command-bar counts. */
  shipments: Shipment[];
  /** The result of the existing search/type/status filter pipeline (table body). */
  filteredShipments: Shipment[];
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  typeFilter: string;
  setTypeFilter: (v: "all" | "land" | "sea" | "air") => void;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  analyzeShipmentTiming: (s: Shipment) => Timing;
  getShipmentProgressPercentage: (s: Shipment) => number;
  onView: (id: string) => void;
  onEdit: (s: Shipment) => void;
  onChat: (s: Shipment) => void;
  onCreate: () => void;
}

/* Small tri-lingual literal helper (mirrors AdminPanel's inline pattern). */
const L = (lang: Language, en: string, tr: string, ar: string) => (lang === "tr" ? tr : lang === "ar" ? ar : en);

const CLOSED = new Set(["Delivered", "Closed", "Completed", "Arrived", "Released"]);
const isActive = (s: Shipment) => !CLOSED.has(s.status);

/* Semantic status pill — royal-blue design language, semantic colours kept
   separate from the blue brand accent (never orange/purple). */
function statusPill(status: string): string {
  switch (status) {
    case "Delivered":
    case "Closed":
    case "Completed":
    case "Arrived":
    case "Released":
      return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100";
    case "In Transit":
    case "Vessel Departed":
    case "Departed Airport":
      return "bg-blue-50 text-blue-700 ring-1 ring-blue-100";
    case "New":
    case "Waiting for Driver Quotes":
      return "bg-amber-50 text-amber-700 ring-1 ring-amber-100";
    case "Border Crossing":
    case "Arrived at Port":
    case "Arrived Airport":
      return "bg-teal-50 text-teal-700 ring-1 ring-teal-100";
    case "Customs Clearance":
      return "bg-rose-50 text-rose-700 ring-1 ring-rose-100";
    default:
      return "bg-sky-50 text-sky-700 ring-1 ring-sky-100";
  }
}

function freightIcon(t?: string) {
  if (t === "sea") return <Anchor className="w-3.5 h-3.5" />;
  if (t === "air") return <Plane className="w-3.5 h-3.5" />;
  return <Truck className="w-3.5 h-3.5" />;
}

const isTodayISO = (iso?: string) => {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
};

/* External transport references that actually exist on the record. Never the
   Order Number, never invented (no TIR field exists on the schema). */
function externalRefs(s: Shipment): Array<{ k: string; v: string }> {
  const out: Array<{ k: string; v: string }> = [];
  if (s.containerNumber) out.push({ k: "Container #", v: s.containerNumber });
  if (s.billOfLadingNumber) out.push({ k: "B/L #", v: s.billOfLadingNumber });
  if (s.bookingNumber) out.push({ k: "Booking #", v: s.bookingNumber });
  if (s.airWaybillNumber) out.push({ k: "AWB #", v: s.airWaybillNumber });
  return out;
}

export default function ShipmentOperationsCenter(props: Props) {
  const {
    lang, isRtl, shipments, filteredShipments, searchQuery, setSearchQuery,
    typeFilter, setTypeFilter, statusFilter, setStatusFilter,
    analyzeShipmentTiming, getShipmentProgressPercentage, onView, onEdit, onChat, onCreate,
  } = props;

  const isDelayed = React.useCallback(
    (s: Shipment) => analyzeShipmentTiming(s).colorClass.includes("bg-red"),
    [analyzeShipmentTiming],
  );

  // ── local, presentation-only view state (no business logic) ──
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [panelId, setPanelId] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<string>("overview");
  const [quick, setQuick] = useState<string>("all");
  const [showCols, setShowCols] = useState(false);
  const [showViews, setShowViews] = useState(false);
  const [activeView, setActiveView] = useState("operations");
  const [loading, setLoading] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);

  // Brief skeleton affordance on first mount (matches the approved design);
  // reduced-motion users get content immediately.
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setLoading(false);
      return;
    }
    const id = setTimeout(() => setLoading(false), 380);
    return () => clearTimeout(id);
  }, []);

  // ⌘K / Ctrl-K focuses the universal search.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // FIX 1 — Escape closes the shipment slide-over. The listener exists ONLY
  // while the panel is open (keyed on panelId) and is cleaned up on close /
  // unmount. It only ever clears panelId, so it never touches the ⌘K shortcut
  // (separate listener, different key) or any unrelated dialog.
  useEffect(() => {
    if (!panelId) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setPanelId(null); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [panelId]);

  // ── KPIs (derived from real counts) ──
  const kpis = useMemo(() => {
    const c = (pred: (s: Shipment) => boolean) => shipments.filter(pred).length;
    const total = shipments.length;
    return [
      { key: "total", name: L(lang, "Total Orders", "Toplam Sipariş", "إجمالي الطلبات"), val: total, tint: "blue", icon: <Package className="w-4 h-4" /> },
      { key: "active", name: L(lang, "Active", "Aktif", "نشطة"), val: c(isActive), tint: "green", icon: <LayoutGrid className="w-4 h-4" /> },
      { key: "waiting", name: L(lang, "Waiting Driver", "Sürücü Bekliyor", "بانتظار سائق"), val: c((s) => s.status === "Waiting for Driver Quotes" || (isActive(s) && !s.assignedDriverId)), tint: "amber", icon: <Hourglass className="w-4 h-4" /> },
      { key: "transit", name: L(lang, "In Transit", "Yolda", "قيد النقل"), val: c((s) => s.status === "In Transit"), tint: "blue", icon: <Truck className="w-4 h-4" /> },
      { key: "border", name: L(lang, "At Border", "Sınırda", "على الحدود"), val: c((s) => s.status === "Border Crossing"), tint: "teal", icon: <MapPin className="w-4 h-4" /> },
      { key: "customs", name: L(lang, "Customs", "Gümrük", "الجمارك"), val: c((s) => s.status === "Customs Clearance"), tint: "rose", icon: <ShieldCheck className="w-4 h-4" /> },
      { key: "delivered", name: L(lang, "Delivered", "Teslim", "تم التسليم"), val: c((s) => CLOSED.has(s.status)), tint: "green", icon: <Check className="w-4 h-4" /> },
      { key: "delayed", name: L(lang, "Delayed", "Gecikmiş", "متأخرة"), val: c((s) => isActive(s) && isDelayed(s)), tint: "red", icon: <Siren className="w-4 h-4" /> },
    ];
  }, [shipments, lang, isDelayed]);

  const total = shipments.length || 1;

  // ── command bar (derived) ──
  const cmd = useMemo(() => {
    const delayed = shipments.filter((s) => isActive(s) && isDelayed(s));
    const waiting = shipments.filter((s) => s.status === "Waiting for Driver Quotes" || (isActive(s) && !s.assignedDriverId));
    const missingDocs = shipments.filter((s) => isActive(s) && (s.documents?.length ?? 0) === 0);
    const unassigned = shipments.filter((s) => isActive(s) && !s.assignedDriverId);
    const attention = new Set<string>();
    [...delayed, ...missingDocs, ...unassigned].forEach((s) => attention.add(s.id));
    return [
      { key: "delayed", n: delayed.length, name: L(lang, "Delayed Orders", "Gecikmiş Siparişler", "طلبات متأخرة"), tint: "red", icon: <Siren className="w-[17px] h-[17px]" /> },
      { key: "waiting", n: waiting.length, name: L(lang, "Waiting Driver", "Sürücü Bekliyor", "بانتظار سائق"), tint: "amber", icon: <Hourglass className="w-[17px] h-[17px]" /> },
      { key: "missing_docs", n: missingDocs.length, name: L(lang, "Missing Documents", "Eksik Belgeler", "مستندات ناقصة"), tint: "blue", icon: <FileText className="w-[17px] h-[17px]" /> },
      { key: "unassigned", n: unassigned.length, name: L(lang, "Unassigned", "Atanmamış", "غير مُعيَّنة"), tint: "teal", icon: <UserCheck className="w-[17px] h-[17px]" /> },
      { key: "attention", n: attention.size, name: L(lang, "Needs Attention", "Dikkat Gerekli", "تحتاج انتباه"), tint: "rose", icon: <AlertTriangle className="w-[17px] h-[17px]" /> },
    ];
  }, [shipments, lang, isDelayed]);

  // ── quick chips (client-side view predicate on top of filteredShipments) ──
  const chips = useMemo(() => {
    const cc = (pred: (s: Shipment) => boolean) => filteredShipments.filter(pred).length;
    return [
      { key: "all", label: L(lang, "All", "Tümü", "الكل"), n: filteredShipments.length, dot: "", icon: <Inbox className="w-3.5 h-3.5" /> },
      { key: "today", label: L(lang, "Today", "Bugün", "اليوم"), n: cc((s) => isTodayISO(s.createdAt)), dot: "", icon: <Clock className="w-3.5 h-3.5" /> },
      { key: "delayed", label: L(lang, "Delayed", "Gecikmiş", "متأخرة"), n: cc((s) => isActive(s) && isDelayed(s)), dot: "bg-red-500" },
      { key: "waiting", label: L(lang, "Waiting Driver", "Sürücü Bekliyor", "بانتظار سائق"), n: cc((s) => s.status === "Waiting for Driver Quotes"), dot: "bg-amber-500" },
      { key: "border", label: L(lang, "At Border", "Sınırda", "على الحدود"), n: cc((s) => s.status === "Border Crossing"), dot: "bg-teal-500" },
      { key: "delivered_today", label: L(lang, "Delivered Today", "Bugün Teslim", "تم التسليم اليوم"), n: cc((s) => CLOSED.has(s.status) && isTodayISO(s.updatedAt)), dot: "bg-emerald-500" },
      { key: "urgent", label: L(lang, "High Priority", "Yüksek Öncelik", "أولوية عالية"), n: cc((s) => isActive(s) && (isDelayed(s) || (s.documents?.length ?? 0) === 0)), icon: <AlertTriangle className="w-3.5 h-3.5" /> },
      { key: "missing_docs", label: L(lang, "Missing Documents", "Eksik Belge", "مستندات ناقصة"), n: cc((s) => isActive(s) && (s.documents?.length ?? 0) === 0), icon: <FileText className="w-3.5 h-3.5" /> },
    ];
  }, [filteredShipments, lang, isDelayed]);

  const quickPredicate = React.useCallback((s: Shipment): boolean => {
    switch (quick) {
      case "today": return isTodayISO(s.createdAt);
      case "delayed": return isActive(s) && isDelayed(s);
      case "waiting": return s.status === "Waiting for Driver Quotes";
      case "border": return s.status === "Border Crossing";
      case "delivered_today": return CLOSED.has(s.status) && isTodayISO(s.updatedAt);
      case "urgent": return isActive(s) && (isDelayed(s) || (s.documents?.length ?? 0) === 0);
      case "missing_docs": return isActive(s) && (s.documents?.length ?? 0) === 0;
      default: return true;
    }
  }, [quick, isDelayed]);

  const rows = useMemo(() => filteredShipments.filter(quickPredicate), [filteredShipments, quickPredicate]);

  // FIX 4 — keep selection consistent with the visible dataset. When search /
  // status / transport-mode / quick-filter change the visible rows, prune any
  // selected id that is no longer visible, so the selected count and the
  // "select all" state always reflect what the user can actually see. Returns
  // the previous Set unchanged when nothing needs pruning (no update loop).
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(rows.map((s) => s.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => { if (visible.has(id)) next.add(id); else changed = true; });
      return changed ? next : prev;
    });
  }, [rows]);

  const tintBg: Record<string, string> = {
    blue: "bg-blue-50 text-blue-600", green: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600", teal: "bg-teal-50 text-teal-600",
    rose: "bg-rose-50 text-rose-600", red: "bg-red-50 text-red-600",
  };
  // Explicit static fill classes for the KPI share-bar — no runtime-constructed
  // Tailwind class names (so the JIT scanner always emits them). Same colours.
  const fillClass: Record<string, string> = {
    blue: "bg-blue-500", green: "bg-emerald-500", amber: "bg-amber-500",
    teal: "bg-teal-500", rose: "bg-rose-500", red: "bg-red-500",
  };

  const allVisibleSelected = rows.length > 0 && rows.every((s) => selected.has(s.id));
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) rows.forEach((s) => next.delete(s.id));
      else rows.forEach((s) => next.add(s.id));
      return next;
    });
  };
  const toggleOne = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const statusOptions = typeFilter === "sea"
    ? ["all", "active", "Booking Confirmed", "Container Released", "Loaded on Vessel", "Vessel Departed", "In Transit", "Arrived at Port", "Customs Clearance", "Released", "Out for Delivery", "Delivered", "Completed"]
    : typeFilter === "air"
      ? ["all", "active", "Booking Confirmed", "Cargo Received", "Security Check Completed", "Departed Airport", "In Transit", "Arrived Airport", "Customs Clearance", "Released", "Out for Delivery", "Delivered", "Completed"]
      : ["all", "active", "New", "Waiting for Driver Quotes", "Assigned", "Accepted", "Loading", "Loaded", "In Transit", "Border Crossing", "Customs Clearance", "Arrived", "Delivered", "Closed"];

  const panelShipment = panelId ? shipments.find((s) => s.id === panelId) ?? null : null;

  // Deferred (UI-ready) column set and saved views — presentational only.
  const columns = [
    { n: L(lang, "Status", "Durum", "الحالة"), on: true, pin: true },
    { n: L(lang, "Order Number", "Sipariş No", "رقم الطلب"), on: true, pin: true },
    { n: L(lang, "Customer", "Müşteri", "العميل"), on: true },
    { n: L(lang, "Driver", "Sürücü", "السائق"), on: true },
    { n: L(lang, "Route", "Rota", "المسار"), on: true },
    { n: L(lang, "Progress", "İlerleme", "التقدم"), on: true },
    { n: L(lang, "Amount", "Tutar", "المبلغ"), on: true },
    { n: L(lang, "Container #", "Konteyner", "الحاوية"), on: false },
  ];
  const views = [
    { key: "operations", t: L(lang, "Operations", "Operasyon", "العمليات"), s: L(lang, "All columns · Status sort", "Tüm sütunlar · Durum", "كل الأعمدة · الحالة"), icon: <LayoutGrid className="w-[15px] h-[15px]" /> },
    { key: "dispatch", t: L(lang, "Dispatch", "Sevkiyat", "الإرسال"), s: L(lang, "Driver · ETA · Priority", "Sürücü · ETA", "السائق · الوصول"), icon: <UserCheck className="w-[15px] h-[15px]" /> },
    { key: "customs", t: L(lang, "Customs", "Gümrük", "الجمارك"), s: L(lang, "Border · Docs status", "Sınır · Belgeler", "الحدود · المستندات"), icon: <ShieldCheck className="w-[15px] h-[15px]" /> },
    { key: "management", t: L(lang, "Management", "Yönetim", "الإدارة"), s: L(lang, "KPI-first · Delayed", "KPI · Gecikmiş", "المؤشرات · المتأخر"), icon: <Layers className="w-[15px] h-[15px]" /> },
  ];

  const dir = isRtl ? "rtl" : "ltr";

  return (
    <div dir={dir} className="space-y-4">
      {/* ===== Header row: title + AI Operations + New Order + Saved Views ===== */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-[22px] font-extrabold tracking-tight text-slate-900 leading-none">
            {L(lang, "Shipment Operations Center", "Sevkiyat Operasyon Merkezi", "مركز عمليات الشحن")}
          </h2>
          <p className="mt-1.5 text-[12.5px] font-semibold text-blue-600 flex items-center gap-2 flex-wrap">
            {[L(lang, "Manage", "Yönet", "إدارة"), L(lang, "Track", "İzle", "تتبع"), L(lang, "Assign", "Ata", "تعيين"), L(lang, "Monitor", "Denetle", "مراقبة"), L(lang, "Deliver", "Teslim", "تسليم")].map((w, i) => (
              <React.Fragment key={w}>{i > 0 && <span className="text-slate-300">•</span>}{w}</React.Fragment>
            ))}
          </p>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <button type="button" title={L(lang, "AI Operations (coming soon)", "AI Operasyon (yakında)", "الذكاء التشغيلي (قريباً)")}
            className="inline-flex items-center gap-2 h-[38px] px-3.5 rounded-xl text-[13px] font-semibold text-blue-700 bg-blue-50 border border-blue-100 hover:bg-blue-100 transition-colors cursor-pointer">
            <Sparkles className="w-[15px] h-[15px]" /> {L(lang, "AI Operations", "AI Operasyon", "الذكاء التشغيلي")}
          </button>
          <button type="button" onClick={onCreate}
            className="inline-flex items-center gap-2 h-[38px] px-3.5 rounded-xl text-[13px] font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-sm shadow-blue-600/30 transition-colors cursor-pointer">
            <Plus className="w-4 h-4" /> {L(lang, "New Order", "Yeni Sipariş", "طلب جديد")}
          </button>
          <div className="relative">
            <button type="button" onClick={() => { setShowViews((v) => !v); setShowCols(false); }}
              className="inline-flex items-center gap-2 h-[38px] px-3.5 rounded-xl text-[13px] font-semibold text-slate-700 bg-white border border-slate-200 hover:border-slate-300 shadow-sm transition-colors cursor-pointer">
              <Layers className="w-4 h-4" /> {L(lang, "Saved Views", "Kayıtlı Görünümler", "طرق عرض محفوظة")} <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {showViews && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowViews(false)} />
                <div className="absolute end-0 mt-2 z-50 w-[290px] bg-white border border-slate-200 rounded-2xl shadow-2xl shadow-slate-900/10 p-2">
                  <div className="flex items-center justify-between px-2 pb-2 mb-1.5 border-b border-slate-100">
                    <span className="text-[12.5px] font-bold text-slate-800">{L(lang, "Workspace Views", "Çalışma Görünümleri", "طرق عرض")}</span>
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{L(lang, "Preset", "Hazır", "معد")}</span>
                  </div>
                  {views.map((v) => (
                    <button key={v.key} type="button" onClick={() => { setActiveView(v.key); setShowViews(false); }}
                      className={`w-full flex items-center gap-3 px-2 py-2 rounded-xl text-start transition-colors cursor-pointer ${activeView === v.key ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                      <span className="w-[30px] h-[30px] rounded-lg bg-blue-50 text-blue-600 grid place-items-center shrink-0">{v.icon}</span>
                      <span className="min-w-0"><span className="block text-[12.5px] font-bold text-slate-800">{v.t}</span><span className="block text-[10.5px] text-slate-400 truncate">{v.s}</span></span>
                      {activeView === v.key && <Check className="w-4 h-4 text-blue-600 ms-auto shrink-0" />}
                    </button>
                  ))}
                  <div className="px-1 pt-2 mt-1 border-t border-slate-100">
                    <span className="block text-[10.5px] text-slate-400 px-1">{L(lang, "View presets are visual — persistence lands with the next backend increment.", "Görünüm hazırları görseldir — kalıcılık sonraki sürümde.", "الإعدادات مرئية — الحفظ في التحديث القادم.")}</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ===== KPI cards ===== */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map((k) => {
          const share = Math.round((k.val / total) * 100);
          return (
            <div key={k.key} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">
              <div className="flex items-center gap-2.5 mb-2">
                <span className={`w-[30px] h-[30px] rounded-lg grid place-items-center shrink-0 ${tintBg[k.tint]}`}>{k.icon}</span>
                <span className="text-[12px] font-semibold text-slate-500 truncate">{k.name}</span>
              </div>
              {loading ? (
                <div className="h-7 w-16 rounded bg-slate-100 animate-pulse" />
              ) : (
                <div className="text-[27px] font-extrabold tracking-tight text-slate-900 leading-none tabular-nums">{k.val.toLocaleString()}</div>
              )}
              <div className="mt-2.5 flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className={`h-full rounded-full ${fillClass[k.tint]}`} style={{ width: `${loading ? 0 : Math.max(4, share)}%`, transition: "width .8s cubic-bezier(.22,1,.36,1)" }} />
                </div>
                <span className="text-[10.5px] font-semibold text-slate-400 tabular-nums">{share}%</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ===== Operations Command Bar ===== */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-3.5">
        <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 mb-2.5">{L(lang, "Operations Command Bar", "Operasyon Komut Çubuğu", "شريط أوامر العمليات")}</div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2.5">
          {cmd.map((a) => (
            <div key={a.key} className="flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-200 hover:border-slate-300 hover:shadow-sm transition-all min-w-0">
              <span className={`w-[34px] h-[34px] rounded-lg grid place-items-center shrink-0 ${tintBg[a.tint]}`}>{a.icon}</span>
              <div className="min-w-0">
                <div className="text-[19px] font-extrabold leading-none text-slate-900 tabular-nums">{a.n}</div>
                <div className="text-[11.5px] font-semibold text-slate-500 mt-0.5 leading-tight">{a.name}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ===== Universal Search ===== */}
      <div>
        <div className="flex items-center gap-2.5 bg-white border border-slate-200 rounded-2xl shadow-sm px-3.5 h-[52px] focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-50 transition-all">
          <Search className="w-[19px] h-[19px] text-slate-400 shrink-0" />
          <input ref={searchRef} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={L(lang, "Search anything — Order Number, Customer, Driver, Truck, Container, B/L, AWB, Reference…", "Her şeyi ara — Sipariş No, Müşteri, Sürücü, Tır, Konteyner…", "ابحث عن أي شيء — رقم الطلب، العميل، السائق، الشاحنة، الحاوية…")}
            className="flex-1 min-w-0 bg-transparent outline-none text-[14px] text-slate-900 placeholder:text-slate-400" />
          {searchQuery && <button type="button" onClick={() => setSearchQuery("")} className="text-slate-400 hover:text-slate-700 cursor-pointer"><X className="w-4 h-4" /></button>}
          <span className="hidden sm:inline-flex items-center text-[11px] font-bold text-slate-500 bg-slate-50 border border-slate-200 border-b-2 rounded-md px-1.5 py-0.5">⌘K</span>
        </div>
        <div className="flex items-center gap-1.5 mt-2 px-0.5 flex-wrap">
          <span className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{L(lang, "Searches", "Aranır", "يبحث في")}</span>
          {[L(lang, "Order Number", "Sipariş No", "رقم الطلب"), L(lang, "Customers", "Müşteriler", "العملاء"), L(lang, "Drivers", "Sürücüler", "السائقون"), "Containers", "B/L", "AWB", L(lang, "References", "Referanslar", "المراجع")].map((s) => (
            <span key={s} className="text-[11px] font-medium text-slate-500 bg-white border border-slate-200 rounded-md px-2 py-0.5">{s}</span>
          ))}
        </div>
      </div>

      {/* ===== Quick filter chips ===== */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {chips.map((c) => (
          <button key={c.key} type="button" onClick={() => setQuick(c.key)}
            className={`shrink-0 inline-flex items-center gap-2 h-[34px] px-3 rounded-xl text-[12.5px] font-semibold border transition-all cursor-pointer ${quick === c.key ? "bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-600/30" : "bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:-translate-y-0.5 shadow-sm"}`}>
            {c.dot ? <span className={`w-[7px] h-[7px] rounded-full ${c.dot}`} /> : c.icon}
            {c.label}
            <span className={`text-[11px] font-extrabold rounded-md px-1.5 py-px tabular-nums ${quick === c.key ? "bg-white/20 text-white" : "bg-slate-50 text-slate-500"}`}>{c.n}</span>
          </button>
        ))}
      </div>

      {/* ===== Filter row (Status + Type wired; others UI-ready / deferred) ===== */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-3.5 flex items-center gap-2.5 flex-wrap">
        {/* Type segmented */}
        <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200">
          {([{ id: "all", l: L(lang, "All", "Tümü", "الكل") }, { id: "land", l: L(lang, "Land", "Kara", "بري") }, { id: "sea", l: L(lang, "Sea", "Deniz", "بحري") }, { id: "air", l: L(lang, "Air", "Hava", "جوي") }] as const).map((tt) => (
            <button key={tt.id} type="button" onClick={() => { setStatusFilter("all"); setTypeFilter(tt.id); }}
              className={`px-3 py-1 rounded-md text-[12px] font-semibold transition-all cursor-pointer ${typeFilter === tt.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>{tt.l}</button>
          ))}
        </div>
        {/* Status select (native, wired to existing statusFilter) */}
        <div className="relative">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="appearance-none h-9 ps-3 pe-8 rounded-lg border border-slate-200 bg-white text-[12.5px] font-semibold text-slate-700 hover:border-slate-300 cursor-pointer outline-none focus:border-blue-500">
            {statusOptions.map((st) => <option key={st} value={st}>{st === "all" ? L(lang, "All Statuses", "Tüm Durumlar", "كل الحالات") : st === "active" ? L(lang, "Active", "Aktif", "نشطة") : st}</option>)}
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute end-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
        {/* UI-ready deferred filters (inert, clearly marked) */}
        {[L(lang, "Country", "Ülke", "الدولة"), L(lang, "Customer", "Müşteri", "العميل"), L(lang, "Driver", "Sürücü", "السائق")].map((f) => (
          <button key={f} type="button" title={L(lang, "Advanced filter — ready for backend integration", "Gelişmiş filtre — entegrasyona hazır", "فلتر متقدم — جاهز للربط")}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 text-[12.5px] font-semibold text-slate-400 cursor-default">
            {f} <ChevronDown className="w-3.5 h-3.5" />
          </button>
        ))}
        <div className="ms-auto flex items-center gap-2">
          <button type="button" onClick={() => { setStatusFilter("all"); setTypeFilter("all"); setQuick("all"); setSearchQuery(""); }}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold text-slate-600 hover:border-slate-300 cursor-pointer"><X className="w-3.5 h-3.5" /> {L(lang, "Clear All", "Temizle", "مسح")}</button>
        </div>
      </div>

      {/* ===== Registry table ===== */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-slate-100">
          <button type="button" onClick={toggleAll} role="checkbox" aria-checked={allVisibleSelected}
            aria-label={L(lang, "Select all visible orders", "Görünen tüm siparişleri seç", "تحديد كل الطلبات الظاهرة")}
            className={`w-[17px] h-[17px] rounded-[5px] border grid place-items-center shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${allVisibleSelected ? "bg-blue-600 border-blue-600" : "bg-white border-slate-300"}`}>
            {allVisibleSelected && <Check className="w-3 h-3 text-white" />}
          </button>
          <span className="text-[12.5px] font-semibold text-slate-500">{selected.size} {L(lang, "selected", "seçildi", "محدد")}</span>
          <span className="text-[12px] text-slate-400">· {rows.length} {L(lang, "orders", "sipariş", "طلب")}</span>
          <div className="ms-auto flex items-center gap-2">
            <div className="relative">
              <button type="button" onClick={() => { setShowCols((v) => !v); setShowViews(false); }}
                className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold text-slate-600 hover:border-slate-300 cursor-pointer"><Columns className="w-3.5 h-3.5" /> {L(lang, "Columns", "Sütunlar", "الأعمدة")}</button>
              {showCols && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowCols(false)} />
                  <div className="absolute end-0 mt-2 z-50 w-[260px] bg-white border border-slate-200 rounded-2xl shadow-2xl shadow-slate-900/10 p-2">
                    <div className="flex items-center justify-between px-2 pb-2 mb-1.5 border-b border-slate-100">
                      <span className="text-[12.5px] font-bold text-slate-800">{L(lang, "Manage columns", "Sütunları yönet", "إدارة الأعمدة")}</span>
                      <span className="text-[10px] font-semibold text-slate-400">{L(lang, "Drag to reorder", "Sürükle", "اسحب")}</span>
                    </div>
                    {columns.map((c) => (
                      <div key={c.n} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-slate-50">
                        <GripVertical className="w-3.5 h-3.5 text-slate-300" />
                        <span className={`w-4 h-4 rounded-[5px] grid place-items-center shrink-0 ${c.on ? "bg-blue-600" : "bg-white border border-slate-300"}`}>{c.on && <Check className="w-2.5 h-2.5 text-white" />}</span>
                        <span className="text-[12.5px] font-semibold text-slate-700">{c.n}</span>
                        {c.pin && <MapPin className="w-3.5 h-3.5 text-blue-500 ms-auto" />}
                      </div>
                    ))}
                    <div className="px-1 pt-2 mt-1 border-t border-slate-100"><span className="block text-[10.5px] text-slate-400 px-1">{L(lang, "Layout is visual — saved layouts arrive with backend support.", "Düzen görseldir — kayıt backend ile gelir.", "التخطيط مرئي — الحفظ لاحقاً.")}</span></div>
                  </div>
                </>
              )}
            </div>
            <button type="button" className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold text-slate-600 hover:border-slate-300 cursor-pointer" title={L(lang, "Density (visual)", "Yoğunluk", "الكثافة")}><SlidersHorizontal className="w-3.5 h-3.5" /> {L(lang, "Density", "Yoğunluk", "الكثافة")}</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm min-w-[980px]">
            <thead>
              <tr className="bg-slate-50/60 border-b border-slate-100 text-slate-500 font-semibold text-[10.5px] uppercase tracking-wide">
                <th className="ps-3.5 py-3 w-8"></th>
                <th className="px-3 py-3 text-start">{L(lang, "Status", "Durum", "الحالة")}</th>
                <th className="px-3 py-3 text-start">{L(lang, "Order Number", "Sipariş Numarası", "رقم الطلب")}</th>
                <th className="px-3 py-3 text-start">{L(lang, "Customer", "Müşteri", "العميل")}</th>
                <th className="px-3 py-3 text-start">{L(lang, "Driver", "Sürücü", "السائق")}</th>
                <th className="px-3 py-3 text-start">{L(lang, "Route", "Rota", "المسار")}</th>
                <th className="px-3 py-3 text-start w-[150px]">{L(lang, "Progress", "İlerleme", "التقدم")}</th>
                <th className="px-3 py-3 text-start">{L(lang, "Amount", "Tutar", "المبلغ")}</th>
                <th className="px-3 py-3 text-start">{L(lang, "Docs", "Belge", "مستندات")}</th>
                <th className="px-3 py-3 text-end">{L(lang, "Actions", "İşlemler", "إجراءات")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}><td colSpan={10} className="px-3 py-3"><div className="h-4 rounded bg-slate-100 animate-pulse" /></td></tr>
                ))
              ) : rows.length === 0 ? (
                <tr><td colSpan={10} className="p-12 text-center text-slate-400 italic">
                  <Inbox className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <span>{L(lang, "No orders match the current filters.", "Filtrelere uyan sipariş yok.", "لا توجد طلبات مطابقة.")}</span>
                </td></tr>
              ) : rows.map((s) => {
                const a = analyzeShipmentTiming(s);
                const pct = getShipmentProgressPercentage(s);
                const docs = s.documents?.length ?? 0;
                const on = selected.has(s.id);
                return (
                  <tr key={s.id} className={`transition-colors cursor-pointer ${on ? "bg-blue-50/60" : panelId === s.id ? "bg-blue-50/40" : "hover:bg-blue-50/40"}`} onClick={() => { setPanelId(s.id); setPanelTab("overview"); }}>
                    <td className="ps-3.5 py-3">
                      <button type="button" role="checkbox" aria-checked={on}
                        aria-label={L(lang, `Select order ${s.shipmentNumber}`, `${s.shipmentNumber} siparişini seç`, `تحديد الطلب ${s.shipmentNumber}`)}
                        onClick={(e) => { e.stopPropagation(); toggleOne(s.id); }}
                        className={`w-[17px] h-[17px] rounded-[5px] border grid place-items-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${on ? "bg-blue-600 border-blue-600" : "bg-white border-slate-300"}`}>
                        {on && <Check className="w-3 h-3 text-white" />}
                      </button>
                    </td>
                    <td className="px-3 py-3"><span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap ${statusPill(s.status)}`}><span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />{s.status}</span></td>
                    <td className="px-3 py-3">
                      <button type="button" onClick={(e) => { e.stopPropagation(); setPanelId(s.id); setPanelTab("overview"); }}
                        aria-label={L(lang, `Open order ${s.shipmentNumber}`, `${s.shipmentNumber} siparişini aç`, `فتح الطلب ${s.shipmentNumber}`)}
                        className="inline-flex items-center gap-2 rounded-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1">
                        <span className={`p-1.5 rounded-md shrink-0 ${s.freightType === "sea" ? "bg-blue-50 text-blue-600" : s.freightType === "air" ? "bg-indigo-50 text-indigo-600" : "bg-blue-50 text-blue-600"}`}>{freightIcon(s.freightType)}</span>
                        <span className="font-mono font-bold text-blue-700 hover:underline">{s.shipmentNumber}</span>
                      </button>
                    </td>
                    <td className="px-3 py-3"><span className="font-semibold text-slate-800">{s.companyName}</span></td>
                    <td className="px-3 py-3">{s.assignedDriverName ? <span className="inline-flex items-center gap-1.5 text-slate-700 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />{s.assignedDriverName}</span> : <span className="text-slate-400">{L(lang, "Unassigned", "Atanmamış", "غير معيّن")}</span>}</td>
                    <td className="px-3 py-3"><span className="inline-flex items-center gap-1.5 font-semibold text-slate-600 text-[12px] whitespace-nowrap">{s.loadingCity || s.loadingCountry} <ArrowRight className="w-3.5 h-3.5 text-slate-300" /> {s.deliveryCity || s.deliveryCountry}</span></td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-0.5 w-32">
                        <div className="flex items-center justify-between text-[9px] font-mono font-bold text-slate-400 leading-none"><span>{a.label}</span><span className={a.textColorClass}>{pct}%</span></div>
                        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${a.colorClass}`} style={{ width: `${pct}%`, transition: "width .6s ease" }} /></div>
                        <div className="text-[8px] text-slate-400 font-medium truncate" title={a.subtext}>{a.subtext}</div>
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono font-bold text-slate-900 whitespace-nowrap">{s.agreedAmount.toLocaleString()} {s.currency}</td>
                    <td className="px-3 py-3">{docs > 0 ? <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 rounded-md px-1.5 py-0.5"><FileText className="w-3 h-3" />{docs}</span> : <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 rounded-md px-1.5 py-0.5"><AlertTriangle className="w-3 h-3" />0</span>}</td>
                    <td className="px-3 py-3 text-end whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <span className="inline-flex items-center gap-0.5">
                        <button type="button" onClick={() => onView(s.id)} title={L(lang, "View", "Görüntüle", "عرض")} className="w-7 h-7 rounded-lg grid place-items-center text-slate-500 hover:bg-blue-50 hover:text-blue-600 cursor-pointer"><Eye className="w-[15px] h-[15px]" /></button>
                        <button type="button" onClick={() => onEdit(s)} title={L(lang, "Edit", "Düzenle", "تعديل")} className="w-7 h-7 rounded-lg grid place-items-center text-slate-500 hover:bg-blue-50 hover:text-blue-600 cursor-pointer"><SlidersHorizontal className="w-[15px] h-[15px]" /></button>
                        <button type="button" onClick={() => onChat(s)} title={L(lang, "Chat", "Sohbet", "محادثة")} className="w-7 h-7 rounded-lg grid place-items-center text-slate-500 hover:bg-blue-50 hover:text-blue-600 cursor-pointer"><MessageSquare className="w-[15px] h-[15px]" /></button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== Sticky bulk action bar ===== */}
      {selected.size > 0 && (
        <div className="sticky bottom-4 z-30">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl shadow-slate-900/15 flex items-center gap-3 p-3 flex-wrap">
            <span className="w-[34px] h-[34px] rounded-xl bg-blue-50 text-blue-600 grid place-items-center shrink-0"><Check className="w-[18px] h-[18px]" /></span>
            <div><div className="text-[13px] font-bold text-slate-900">{selected.size} {L(lang, "selected", "seçildi", "محدد")}</div><div className="text-[11.5px] text-slate-500">{L(lang, "Bulk actions are UI-ready for backend integration", "Toplu işlemler entegrasyona hazır", "الإجراءات الجماعية جاهزة للربط")}</div></div>
            <div className="ms-auto flex items-center gap-2 flex-wrap justify-end">
              {[{ i: <UserCheck className="w-3.5 h-3.5" />, l: L(lang, "Assign Driver", "Sürücü Ata", "تعيين سائق") }, { i: <Layers className="w-3.5 h-3.5" />, l: L(lang, "Merge", "Birleştir", "دمج") }, { i: <Copy className="w-3.5 h-3.5" />, l: L(lang, "Duplicate", "Kopyala", "نسخ") }, { i: <FileText className="w-3.5 h-3.5" />, l: L(lang, "Documents", "Belgeler", "المستندات") }, { i: <Printer className="w-3.5 h-3.5" />, l: L(lang, "Print", "Yazdır", "طباعة") }, { i: <Send className="w-3.5 h-3.5" />, l: L(lang, "Notify", "Bildir", "إشعار") }].map((b) => (
                <button key={b.l} type="button" title={L(lang, "Ready for backend integration", "Entegrasyona hazır", "جاهز للربط")} className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold text-slate-600 hover:border-slate-300 cursor-pointer">{b.i} {b.l}</button>
              ))}
              <button type="button" onClick={() => setSelected(new Set())} className="w-8 h-8 rounded-lg grid place-items-center text-slate-500 border border-slate-200 hover:bg-slate-50 cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Right shipment panel (slide-over) ===== */}
      {panelShipment && (
        <ShipmentPanel lang={lang} isRtl={isRtl} s={panelShipment} timing={analyzeShipmentTiming(panelShipment)} progress={getShipmentProgressPercentage(panelShipment)} tab={panelTab} setTab={setPanelTab} onClose={() => setPanelId(null)} onView={onView} onEdit={onEdit} onChat={onChat} />
      )}
    </div>
  );
}

/* ================================================================== */
/*  Right shipment panel — mini operations dashboard (real data)       */
/* ================================================================== */
function ShipmentPanel({ lang, isRtl, s, timing, progress, tab, setTab, onClose, onView, onEdit, onChat }: {
  lang: Language; isRtl: boolean; s: Shipment; timing: Timing; progress: number; tab: string; setTab: (t: string) => void;
  onClose: () => void; onView: (id: string) => void; onEdit: (s: Shipment) => void; onChat: (s: Shipment) => void;
}) {
  const refs = externalRefs(s);
  const tl = [...(s.timeline || [])].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const docs = s.documents || [];
  const tlLabel = (u: { labelEn: string; labelTr: string; labelAr: string }) => (lang === "tr" ? u.labelTr : lang === "ar" ? u.labelAr : u.labelEn) || u.labelEn;
  const tlDetail = (u: { detailsEn?: string; detailsTr?: string; detailsAr?: string }) => (lang === "tr" ? u.detailsTr : lang === "ar" ? u.detailsAr : u.detailsEn) || "";

  const tabs = [
    { k: "overview", l: L(lang, "Overview", "Genel", "نظرة"), i: <Package className="w-3.5 h-3.5" /> },
    { k: "timeline", l: L(lang, "Timeline", "Zaman", "المسار"), i: <Route className="w-3.5 h-3.5" /> },
    { k: "gps", l: "GPS", i: <Navigation className="w-3.5 h-3.5" /> },
    { k: "documents", l: L(lang, "Documents", "Belgeler", "المستندات"), i: <FileText className="w-3.5 h-3.5" /> },
    { k: "payments", l: L(lang, "Payments", "Ödemeler", "المدفوعات"), i: <DollarSign className="w-3.5 h-3.5" /> },
    { k: "chat", l: L(lang, "Chat", "Sohbet", "محادثة"), i: <MessageSquare className="w-3.5 h-3.5" /> },
    { k: "notes", l: L(lang, "Notes", "Notlar", "ملاحظات"), i: <FileText className="w-3.5 h-3.5" /> },
    { k: "driver", l: L(lang, "Driver", "Sürücü", "السائق"), i: <UserCheck className="w-3.5 h-3.5" /> },
  ];

  const KV = ({ k, v, accent }: { k: string; v: React.ReactNode; accent?: boolean }) => (
    <div><div className="text-[10px] uppercase tracking-wide font-bold text-slate-400">{k}</div><div className={`text-[12.5px] font-semibold mt-0.5 ${accent ? "text-blue-700" : "text-slate-900"}`}>{v}</div></div>
  );
  const Card = ({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) => (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-slate-100 bg-slate-50/60 text-[11px] font-bold uppercase tracking-wide text-slate-500">{icon}{title}</div>
      <div className="p-3.5">{children}</div>
    </div>
  );
  const Empty = ({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) => (
    <div className="flex flex-col items-center text-center py-8 gap-1">
      <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-500 grid place-items-center mb-1">{icon}</div>
      <div className="text-[13px] font-bold text-slate-800">{title}</div>
      <div className="text-[11.5px] text-slate-500 max-w-[220px]">{sub}</div>
    </div>
  );

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-[1px] z-40" onClick={onClose} />
      <aside dir={isRtl ? "rtl" : "ltr"} className="fixed top-0 end-0 h-full w-full sm:w-[400px] bg-white z-50 shadow-2xl border-s border-slate-200 flex flex-col animate-[slidein_.2s_ease]">
        <style>{`@keyframes slidein{from{transform:translateX(${isRtl ? "-" : ""}24px);opacity:.6}to{transform:none;opacity:1}}`}</style>
        {/* header */}
        <div className="px-4 pt-4 pb-3 border-b border-slate-100">
          <div className="flex items-start gap-2">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wide font-bold text-slate-400">{L(lang, "Order Number", "Sipariş Numarası", "رقم الطلب")}</div>
              <div className="font-mono text-[16px] font-extrabold text-slate-900 mt-0.5">{s.shipmentNumber}</div>
            </div>
            <button type="button" onClick={onClose} className="ms-auto w-8 h-8 rounded-lg grid place-items-center text-slate-500 border border-slate-200 hover:bg-slate-50 cursor-pointer"><X className="w-4 h-4" /></button>
          </div>
          <div className="flex items-center gap-2 mt-2.5">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${statusPill(s.status)}`}><span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />{s.status}</span>
            <span className="text-[11.5px] font-semibold text-slate-500 tabular-nums">{progress}% {L(lang, "complete", "tamam", "مكتمل")}</span>
          </div>
        </div>
        {/* tabs */}
        <div className="flex gap-0.5 px-2 border-b border-slate-100 overflow-x-auto">
          {tabs.map((tb) => (
            <button key={tb.k} type="button" onClick={() => setTab(tb.k)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-2.5 text-[12.5px] font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${tab === tb.k ? "text-blue-600 border-blue-600" : "text-slate-500 border-transparent hover:text-slate-800"}`}>{tb.i}{tb.l}</button>
          ))}
        </div>
        {/* body */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
          {tab === "overview" && (
            <>
              <Card title={L(lang, "Route", "Rota", "المسار")} icon={<MapPin className="w-3.5 h-3.5 text-blue-600" />}>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <div><div className="text-[10px] uppercase font-bold text-slate-400">{L(lang, "Origin", "Yükleme", "المصدر")}</div><div className="text-[13px] font-bold text-slate-900 mt-0.5">{s.loadingCity}</div><div className="text-[11px] text-slate-500">{s.loadingCountry}</div></div>
                  <ArrowRight className="w-5 h-5 text-slate-300" />
                  <div className="text-end"><div className="text-[10px] uppercase font-bold text-slate-400">{L(lang, "Destination", "Teslim", "الوجهة")}</div><div className="text-[13px] font-bold text-slate-900 mt-0.5">{s.deliveryCity}</div><div className="text-[11px] text-slate-500">{s.deliveryCountry}</div></div>
                </div>
              </Card>
              <Card title={L(lang, "Order Information", "Sipariş Bilgileri", "معلومات الطلب")} icon={<Package className="w-3.5 h-3.5 text-blue-600" />}>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2"><KV k={L(lang, "Order Number", "Sipariş No", "رقم الطلب")} v={<span className="font-mono">{s.shipmentNumber}</span>} accent /></div>
                  <KV k={L(lang, "Customer", "Müşteri", "العميل")} v={s.companyName} />
                  <KV k={L(lang, "Cargo Weight", "Ağırlık", "الوزن")} v={<span className="font-mono">{s.cargoWeight.toLocaleString()} kg</span>} />
                  <div className="col-span-2"><KV k={L(lang, "Cargo", "Kargo", "البضاعة")} v={s.cargoDescription || "—"} /></div>
                  <KV k={L(lang, "Created", "Oluşturuldu", "أُنشئ")} v={<span className="font-mono">{new Date(s.createdAt).toLocaleDateString()}</span>} />
                  <KV k={L(lang, "Agreed Amount", "Anlaşılan", "المبلغ")} v={<span className="font-mono">{s.agreedAmount.toLocaleString()} {s.currency}</span>} />
                </div>
              </Card>
              {refs.length > 0 && (
                <Card title={L(lang, "External References", "Harici Referanslar", "المراجع الخارجية")} icon={<FileText className="w-3.5 h-3.5 text-blue-600" />}>
                  <div className="grid grid-cols-2 gap-3">{refs.map((r) => <KV key={r.k} k={r.k} v={<span className="font-mono">{r.v}</span>} />)}</div>
                </Card>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => onView(s.id)} className="inline-flex items-center justify-center gap-2 h-9 rounded-lg text-[12.5px] font-bold text-blue-700 bg-blue-50 border border-blue-100 hover:bg-blue-100 cursor-pointer"><Eye className="w-[15px] h-[15px]" /> {L(lang, "Full Details", "Tüm Detaylar", "التفاصيل")}</button>
                <button type="button" onClick={() => onChat(s)} className="inline-flex items-center justify-center gap-2 h-9 rounded-lg text-[12.5px] font-bold text-blue-700 bg-blue-50 border border-blue-100 hover:bg-blue-100 cursor-pointer"><MessageSquare className="w-[15px] h-[15px]" /> {L(lang, "Open Chat", "Sohbet", "المحادثة")}</button>
              </div>
            </>
          )}

          {tab === "timeline" && (
            <Card title={L(lang, "Shipment Timeline", "Sevkiyat Zaman Çizelgesi", "المسار الزمني")} icon={<Route className="w-3.5 h-3.5 text-blue-600" />}>
              {tl.length === 0 ? <Empty icon={<Route className="w-6 h-6" />} title={L(lang, "No timeline yet", "Henüz kayıt yok", "لا يوجد مسار بعد")} sub={L(lang, "Status updates will appear here as the order progresses.", "Durum güncellemeleri burada görünecek.", "ستظهر التحديثات هنا.")} /> : (
                <div className="space-y-0">
                  {tl.map((u, i) => (
                    <div key={i} className="grid grid-cols-[22px_1fr] gap-2.5 pb-3 relative">
                      {i < tl.length - 1 && <span className="absolute start-[10px] top-5 bottom-0 w-0.5 bg-slate-100" />}
                      <span className={`w-[22px] h-[22px] rounded-full grid place-items-center z-10 ${i === 0 ? "bg-blue-600" : "bg-emerald-500"}`}><Check className="w-3 h-3 text-white" /></span>
                      <div><div className="text-[12.5px] font-bold text-slate-900">{tlLabel(u)}</div><div className="text-[10.5px] text-slate-500 font-mono">{new Date(u.timestamp).toLocaleString()}</div>{tlDetail(u) && <div className="text-[11.5px] text-slate-500 mt-0.5">{tlDetail(u)}</div>}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {tab === "gps" && (
            <>
              <Card title={L(lang, "Live Telemetry", "Canlı Konum", "التتبع المباشر")} icon={<Navigation className="w-3.5 h-3.5 text-blue-600" />}>
                {(s.timeline && s.timeline.length > 0) || s.eta ? (
                  <div className="grid grid-cols-2 gap-3">
                    {s.eta && <KV k="ETA" v={<span className="font-mono">{new Date(s.eta).toLocaleDateString()}</span>} />}
                    {s.etd && <KV k="ETD" v={<span className="font-mono">{new Date(s.etd).toLocaleDateString()}</span>} />}
                    <KV k={L(lang, "Last Status", "Son Durum", "آخر حالة")} v={s.status} />
                    <KV k={L(lang, "Progress", "İlerleme", "التقدم")} v={`${progress}%`} />
                  </div>
                ) : (
                  <Empty icon={<Navigation className="w-6 h-6" />} title={L(lang, "Live telemetry unavailable", "Canlı veri yok", "التتبع غير متاح")} sub={L(lang, "This order has no live GPS signal yet. Position appears once the driver's device reports in.", "Bu sipariş için henüz GPS sinyali yok.", "لا توجد إشارة GPS بعد.")} />
                )}
              </Card>
              <div className="text-[11px] text-slate-400 px-1">{L(lang, "GPS uses the existing tracking architecture — full live map on the GPS Tracking page.", "GPS mevcut mimariyi kullanır — tam harita GPS sayfasında.", "يستخدم البنية الحالية — الخريطة الكاملة في صفحة التتبع.")}</div>
            </>
          )}

          {tab === "documents" && (
            docs.length === 0 ? <Empty icon={<FileText className="w-6 h-6" />} title={L(lang, "No documents yet", "Belge yok", "لا مستندات")} sub={L(lang, "Invoice, CMR, packing list and other files attached to this order will list here.", "Bu siparişe eklenen belgeler burada listelenir.", "ستظهر المستندات هنا.")} /> : (
              <div className="space-y-2">
                {docs.map((d) => (
                  <div key={d.id} className="flex items-center gap-2.5 p-2.5 border border-slate-200 rounded-xl hover:border-slate-300">
                    <span className="w-[34px] h-[34px] rounded-lg bg-blue-50 text-blue-600 grid place-items-center shrink-0"><FileText className="w-[17px] h-[17px]" /></span>
                    <div className="min-w-0"><div className="text-[12.5px] font-bold text-slate-900 truncate">{d.name}</div><div className="text-[11px] text-slate-500 truncate">{d.category} · {new Date(d.uploadedAt).toLocaleDateString()}</div></div>
                    {d.url && <a href={d.url} target="_blank" rel="noreferrer" className="ms-auto w-8 h-8 rounded-lg grid place-items-center text-slate-500 border border-slate-200 hover:text-blue-600 hover:border-blue-200"><Download className="w-3.5 h-3.5" /></a>}
                  </div>
                ))}
              </div>
            )
          )}

          {tab === "payments" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="border border-slate-200 rounded-xl p-3"><div className="text-[10px] uppercase font-bold text-slate-400">{L(lang, "Agreed Amount", "Anlaşılan Tutar", "المبلغ المتفق")}</div><div className="text-[17px] font-extrabold text-slate-900 mt-1 font-mono">{s.agreedAmount.toLocaleString()} {s.currency}</div></div>
                <div className="border border-slate-200 rounded-xl p-3"><div className="text-[10px] uppercase font-bold text-slate-400">{L(lang, "Currency", "Para Birimi", "العملة")}</div><div className="text-[17px] font-extrabold text-slate-900 mt-1">{s.currency}</div></div>
              </div>
              <div className="border border-blue-100 bg-blue-50/50 rounded-xl p-3.5 flex gap-2.5">
                <DollarSign className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <div className="text-[11.5px] text-slate-600 leading-relaxed">{L(lang, "Full invoices, costs, receivables and payments for this order live in Accounting → Cost Statements. Nothing is duplicated here.", "Bu siparişin tüm faturaları ve ödemeleri Muhasebe → Maliyet Beyanları'ndadır.", "الفواتير والمدفوعات الكاملة في المحاسبة.")}</div>
              </div>
            </>
          )}

          {tab === "chat" && (
            <Card title={L(lang, "Conversations", "Sohbetler", "المحادثات")} icon={<MessageSquare className="w-3.5 h-3.5 text-blue-600" />}>
              <div className="space-y-2">
                <p className="text-[12px] text-slate-500">{L(lang, "This order has three channels — internal staff, driver and customer.", "Bu siparişin üç kanalı var — dahili, sürücü ve müşteri.", "لهذا الطلب ثلاث قنوات.")}</p>
                <button type="button" onClick={() => onChat(s)} className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-lg text-[13px] font-bold text-white bg-blue-600 hover:bg-blue-700 cursor-pointer"><MessageSquare className="w-4 h-4" /> {L(lang, "Open Chat Center", "Sohbet Merkezini Aç", "افتح مركز المحادثة")}</button>
              </div>
            </Card>
          )}

          {tab === "notes" && (
            s.internalNotes ? <Card title={L(lang, "Internal Notes", "Dahili Notlar", "ملاحظات داخلية")} icon={<FileText className="w-3.5 h-3.5 text-blue-600" />}><p className="text-[12.5px] text-slate-700 whitespace-pre-wrap leading-relaxed">{s.internalNotes}</p></Card>
              : <Empty icon={<FileText className="w-6 h-6" />} title={L(lang, "No internal notes", "Not yok", "لا ملاحظات")} sub={L(lang, "Add handling instructions or context via Edit — they show here for the next coordinator.", "Düzenle ile not ekleyin — burada görünür.", "أضف ملاحظات عبر التعديل.")} />
          )}

          {tab === "driver" && (
            s.assignedDriverName ? (
              <>
                <div className="flex items-center gap-3 p-3.5 border border-slate-200 rounded-xl bg-gradient-to-b from-blue-50/60 to-white">
                  <span className="w-12 h-12 rounded-xl bg-blue-600 text-white grid place-items-center font-extrabold text-lg shrink-0">{s.assignedDriverName.slice(0, 2).toUpperCase()}</span>
                  <div className="min-w-0"><div className="text-[14px] font-bold text-slate-900 truncate">{s.assignedDriverName}</div><div className="text-[11.5px] text-slate-500 font-mono">{s.truckNumber || "—"}</div></div>
                </div>
                <Card title={L(lang, "Assignment", "Atama", "التعيين")} icon={<UserCheck className="w-3.5 h-3.5 text-blue-600" />}>
                  <div className="grid grid-cols-2 gap-3">
                    <KV k={L(lang, "Truck", "Tır", "الشاحنة")} v={<span className="font-mono">{s.truckNumber || "—"}</span>} />
                    <KV k={L(lang, "Additional", "Ek Sürücü", "إضافي")} v={(s.additionalDrivers?.length ?? 0) > 0 ? `${s.additionalDrivers!.length}` : "—"} />
                  </div>
                </Card>
              </>
            ) : <Empty icon={<UserCheck className="w-6 h-6" />} title={L(lang, "No driver assigned", "Sürücü atanmadı", "لا سائق")} sub={L(lang, "Assign a driver from the order actions or the Driver Alliance.", "Sipariş işlemlerinden sürücü atayın.", "عيّن سائقاً من الإجراءات.")} />
          )}
        </div>
        {/* footer */}
        <div className="p-3.5 border-t border-slate-100 flex gap-2">
          <button type="button" onClick={() => onView(s.id)} className="flex-1 inline-flex items-center justify-center gap-2 h-11 rounded-xl text-[13.5px] font-bold text-white bg-blue-600 hover:bg-blue-700 cursor-pointer"><Eye className="w-[17px] h-[17px]" /> {L(lang, "View Full Details", "Tüm Detayları Gör", "عرض التفاصيل")}</button>
          <button type="button" onClick={() => onEdit(s)} className="w-11 h-11 rounded-xl grid place-items-center text-slate-600 border border-slate-200 hover:bg-slate-50 cursor-pointer"><SlidersHorizontal className="w-[17px] h-[17px]" /></button>
        </div>
      </aside>
    </>
  );
}
