import { useMemo, useState } from "react";
import {
  Search, X, Truck, Anchor, Plane, MoreVertical, Share2, MessageSquare, ArrowRight, PackageSearch,
} from "lucide-react";
import type { Shipment, Driver, Language } from "../../../types";
import type { TRANSLATIONS } from "../../../translations";
import ShipmentStatusBadge from "./ShipmentStatusBadge";

type TimingAnalysis = { colorClass: string; textColorClass: string; label: string; subtext: string };

interface Props {
  shipments: Shipment[];
  activeCount: number;
  drivers: Driver[];
  lang: Language;
  isRtl: boolean;
  t: (key: keyof typeof TRANSLATIONS["en"]) => string;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  typeFilter: string;
  setTypeFilter: (v: string) => void;
  onOpenDetails: (id: string) => void;
  onOpenChat: (s: Shipment) => void;
  onCopyLink: (s: Shipment) => void;
  onViewAll: () => void;
  analyzeShipmentTiming: (s: Shipment) => TimingAnalysis;
  getShipmentProgressPercentage: (s: Shipment) => number;
}

const S: Record<string, Record<Language, string>> = {
  title: { en: "Active Shipments", tr: "Aktif Sevkiyatlar", ar: "الشحنات النشطة" },
  orderId: { en: "Order ID", tr: "Sipariş No", ar: "رقم الطلب" },
  route: { en: "Route", tr: "Güzergah", ar: "المسار" },
  driver: { en: "Driver", tr: "Sürücü", ar: "السائق" },
  value: { en: "Value", tr: "Değer", ar: "القيمة" },
  eta: { en: "ETA", tr: "Tahmini Varış", ar: "الوصول المتوقع" },
  progress: { en: "Progress", tr: "İlerleme", ar: "التقدم" },
  notAssigned: { en: "Not assigned", tr: "Atanmadı", ar: "غير مُعيّن" },
  viewAll: { en: "View All Shipments", tr: "Tüm Sevkiyatlar", ar: "عرض كل الشحنات" },
  view: { en: "View", tr: "Görüntüle", ar: "عرض" },
  all: { en: "All", tr: "Tümü", ar: "الكل" },
  land: { en: "Land", tr: "Kara", ar: "بري" },
  sea: { en: "Sea", tr: "Deniz", ar: "بحري" },
  air: { en: "Air", tr: "Hava", ar: "جوي" },
  active: { en: "Active", tr: "Aktif", ar: "نشط" },
  more: { en: "More actions", tr: "Diğer işlemler", ar: "إجراءات إضافية" },
};
const L = (k: string, lang: Language) => S[k]?.[lang] ?? S[k]?.en ?? k;

function FreightIcon({ type }: { type: string }) {
  if (type === "sea") return <span className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-50 text-blue-600" title="Sea"><Anchor className="h-3.5 w-3.5" /></span>;
  if (type === "air") return <span className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-50 text-indigo-600" title="Air"><Plane className="h-3.5 w-3.5" /></span>;
  return <span className="flex h-7 w-7 items-center justify-center rounded-md bg-orange-50 text-orange-600" title="Land"><Truck className="h-3.5 w-3.5" /></span>;
}

/** Secondary actions live behind a 3-dot menu; "View" stays a visible button. */
function RowMenu({ lang, onCopyLink, onChat, copyLabel, chatLabel }: { lang: Language; onCopyLink: () => void; onChat: () => void; copyLabel: string; chatLabel: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={L("more", lang)}
        title={L("more", lang)}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="absolute end-0 top-9 z-20 w-48 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          <button role="menuitem" onClick={(e) => { e.stopPropagation(); setOpen(false); onCopyLink(); }} className="flex w-full items-center gap-2 px-3 py-2 text-start text-xs font-semibold text-slate-700 hover:bg-slate-50">
            <Share2 className="h-3.5 w-3.5 text-slate-400" />{copyLabel}
          </button>
          <button role="menuitem" onClick={(e) => { e.stopPropagation(); setOpen(false); onChat(); }} className="flex w-full items-center gap-2 px-3 py-2 text-start text-xs font-semibold text-slate-700 hover:bg-slate-50">
            <MessageSquare className="h-3.5 w-3.5 text-slate-400" />{chatLabel}
          </button>
        </div>
      )}
    </span>
  );
}

export default function ActiveShipmentsTable(props: Props) {
  const {
    shipments, activeCount, drivers, lang, isRtl, t,
    searchQuery, setSearchQuery, statusFilter, setStatusFilter, typeFilter, setTypeFilter,
    onOpenDetails, onOpenChat, onCopyLink, onViewAll, analyzeShipmentTiming, getShipmentProgressPercentage,
  } = props;

  const phoneById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of drivers) if (d.id) m.set(d.id, d.phone);
    return m;
  }, [drivers]);

  const transportTabs = [
    { id: "all", label: L("all", lang) },
    { id: "land", label: L("land", lang) },
    { id: "sea", label: L("sea", lang) },
    { id: "air", label: L("air", lang) },
  ] as const;

  const ViewBtn = ({ s }: { s: Shipment }) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpenDetails(s.id); }}
      className="rounded-md bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-800 hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
    >
      {L("view", lang)}
    </button>
  );

  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Header + controls */}
      <div className="border-b border-slate-100 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-black tracking-tight text-slate-900">
            {L("title", lang)}
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 tabular-nums">{activeCount}</span>
          </h3>
          <button onClick={onViewAll} className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 text-[11px] font-bold text-orange-600 hover:text-orange-700 hover:underline">
            {L("viewAll", lang)}
            <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
          </button>
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute top-2.5 h-3.5 w-3.5 text-slate-400 start-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("searchShipment")}
              aria-label={t("searchShipment")}
              className="w-full rounded-lg border border-slate-200 bg-white py-1.5 text-xs focus:border-slate-400 focus:outline-none ps-8.5 pe-8"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} aria-label="Clear" className="absolute top-2 text-slate-400 hover:text-slate-700 end-2">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Transport segmented control (wired to typeFilter) */}
            <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
              {transportTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => { setStatusFilter("all"); setTypeFilter(tab.id); }}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-bold transition-all ${typeFilter === tab.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Status filter (wired to statusFilter) */}
            <label className="sr-only" htmlFor="dash-status-filter">{t("status")}</label>
            <select
              id="dash-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white py-1.5 text-[11px] font-bold text-slate-700 focus:border-slate-400 focus:outline-none ps-2.5 pe-6"
            >
              <option value="all">{L("all", lang)}</option>
              <option value="active">{L("active", lang)}</option>
              <option value="In Transit">In Transit</option>
              <option value="Assigned">Assigned</option>
              <option value="Delivered">Delivered</option>
              <option value="New">New</option>
            </select>
          </div>
        </div>
      </div>

      {/* Desktop / tablet table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-start text-xs">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              <th className="p-3 text-start font-bold">{L("orderId", lang)}</th>
              <th className="p-3 text-start font-bold">{t("companyName")}</th>
              <th className="p-3 text-start font-bold">{L("route", lang)}</th>
              <th className="p-3 text-start font-bold">{L("driver", lang)}</th>
              <th className="p-3 text-start font-bold">{L("value", lang)}</th>
              <th className="p-3 text-start font-bold">{t("status")}</th>
              <th className="p-3 text-start font-bold">{L("eta", lang)}</th>
              <th className="p-3 text-start font-bold">{L("progress", lang)}</th>
              <th className="p-3 text-end font-bold">{t("actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shipments.map((s) => {
              const fType = s.freightType || "land";
              const analysis = analyzeShipmentTiming(s);
              const pct = getShipmentProgressPercentage(s);
              const phone = phoneById.get(s.assignedDriverId);
              return (
                <tr
                  key={s.id}
                  onClick={() => onOpenDetails(s.id)}
                  className="cursor-pointer transition-colors hover:bg-slate-50/70"
                >
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <FreightIcon type={fType} />
                      <span className="font-mono text-xs font-bold text-slate-900">#{s.shipmentNumber}</span>
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="max-w-[150px] truncate font-bold text-slate-800">{s.companyName}</div>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-1 text-[11px]">
                      <span className="font-bold text-slate-800">{s.loadingCity}</span>
                      <ArrowRight className="h-3 w-3 shrink-0 text-slate-400 rtl:rotate-180" />
                      <span className="font-bold text-slate-800">{s.deliveryCity}</span>
                    </div>
                    <div className="text-[9.5px] text-slate-400">{s.loadingCountry} → {s.deliveryCountry}</div>
                  </td>
                  <td className="p-3">
                    {s.assignedDriverName ? (
                      <>
                        <div className="font-semibold text-slate-800">{s.assignedDriverName}</div>
                        {phone && <div className="text-[9.5px] text-slate-400">{phone}</div>}
                      </>
                    ) : (
                      <span className="text-[11px] font-medium italic text-slate-400">{L("notAssigned", lang)}</span>
                    )}
                  </td>
                  <td className="p-3">
                    <span className="font-mono text-xs font-black text-slate-900 tabular-nums">{s.agreedAmount.toLocaleString()}</span>
                    <span className="ms-1 text-[10px] font-bold text-slate-400">{s.currency}</span>
                  </td>
                  <td className="p-3"><ShipmentStatusBadge status={s.status} /></td>
                  <td className="p-3">
                    <div className="text-[11px] font-semibold text-slate-700">{analysis.label}</div>
                    <div className="max-w-[110px] truncate text-[9.5px] text-slate-400" title={analysis.subtext}>{analysis.subtext}</div>
                  </td>
                  <td className="p-3">
                    <div className="flex w-24 flex-col gap-1">
                      <div className="flex items-center justify-between text-[9px] font-bold text-slate-400">
                        <span className={analysis.textColorClass}>{pct}%</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div className={`h-full rounded-full ${analysis.colorClass}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1">
                      <ViewBtn s={s} />
                      <RowMenu
                        lang={lang}
                        onCopyLink={() => onCopyLink(s)}
                        onChat={() => onOpenChat(s)}
                        copyLabel={t("copyLink")}
                        chatLabel="Chat"
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="divide-y divide-slate-100 md:hidden">
        {shipments.map((s) => {
          const analysis = analyzeShipmentTiming(s);
          const pct = getShipmentProgressPercentage(s);
          return (
            <button key={s.id} onClick={() => onOpenDetails(s.id)} className="flex w-full flex-col gap-2 p-3 text-start hover:bg-slate-50/70">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FreightIcon type={s.freightType || "land"} />
                  <span className="font-mono text-xs font-bold text-slate-900">#{s.shipmentNumber}</span>
                </div>
                <ShipmentStatusBadge status={s.status} />
              </div>
              <div className="text-xs font-bold text-slate-800">{s.companyName}</div>
              <div className="flex items-center gap-1 text-[11px] text-slate-600">
                <span className="font-semibold">{s.loadingCity}</span>
                <ArrowRight className="h-3 w-3 text-slate-400 rtl:rotate-180" />
                <span className="font-semibold">{s.deliveryCity}</span>
                <span className="ms-auto font-mono font-black text-slate-900">{s.agreedAmount.toLocaleString()} {s.currency}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div className={`h-full rounded-full ${analysis.colorClass}`} style={{ width: `${pct}%` }} />
              </div>
            </button>
          );
        })}
      </div>

      {shipments.length === 0 && (
        <div className="flex flex-col items-center gap-2 p-10 text-center text-slate-400">
          <PackageSearch className="h-8 w-8 text-slate-300" />
          <span className="text-xs italic">{t("noShipmentsMatched")}</span>
        </div>
      )}
    </section>
  );
}
