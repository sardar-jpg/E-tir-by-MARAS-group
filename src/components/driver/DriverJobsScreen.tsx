import { ArrowRight, Briefcase, ChevronRight, MessageSquare } from "lucide-react";
import type { Language, Shipment } from "../../types";
import {
  getDriverJobGroup,
  getDriverNextAction,
  localizeNextActionLabel,
  type DriverJobGroup,
} from "../../lib/driverJobFlow";
import { resolveDriverAgreedAmount, resolveDriverTruckNumber } from "../../lib/driverVisibility";
import { isShipmentClosed } from "../../lib/shipmentStatusTransitions";
import { getStatusChipClasses, localizeShipmentStatus } from "./driverUi";

/**
 * feature/driver-app-comprehensive-redesign — Jobs screen with three
 * clear groups: Active (underway, INCLUDING "Arrived" — the Delivered
 * submission is still the driver's), Upcoming (assigned, awaiting
 * accept/decline, or back with dispatch), and Completed (nothing left
 * for the driver to submit — Delivered / Closed). Grouping comes from
 * getDriverJobGroup so it can never disagree with Home or GPS about
 * what "active" means.
 */
const LABELS: Record<Language, {
  title: string;
  groups: Record<DriverJobGroup, string>;
  nextStep: string;
  respond: string;
  waitingDispatch: string;
  empty: string;
  emptySub: string;
  loadOlder: string;
  loading: string;
  closedTag: string;
}> = {
  en: {
    title: "My Jobs",
    groups: { active: "Active", upcoming: "Upcoming", completed: "Completed" },
    nextStep: "Next step",
    respond: "Accept or decline this job",
    waitingDispatch: "Waiting for dispatch",
    empty: "No jobs yet",
    emptySub: "Jobs assigned to you by MARAS will appear here.",
    loadOlder: "Load older jobs",
    loading: "Loading…",
    closedTag: "Read-only",
  },
  tr: {
    title: "Seferlerim",
    groups: { active: "Aktif", upcoming: "Yaklaşan", completed: "Tamamlanan" },
    nextStep: "Sonraki adım",
    respond: "Bu seferi kabul edin veya reddedin",
    waitingDispatch: "Operasyon bekleniyor",
    empty: "Henüz sefer yok",
    emptySub: "MARAS tarafından size atanan seferler burada görünecek.",
    loadOlder: "Daha eski seferleri yükle",
    loading: "Yükleniyor…",
    closedTag: "Salt okunur",
  },
  ar: {
    title: "مهامي",
    groups: { active: "النشطة", upcoming: "القادمة", completed: "المكتملة" },
    nextStep: "الخطوة التالية",
    respond: "اقبل هذه المهمة أو ارفضها",
    waitingDispatch: "بانتظار العمليات",
    empty: "لا توجد مهام بعد",
    emptySub: "ستظهر هنا المهام التي تخصصها لك MARAS.",
    loadOlder: "تحميل مهام أقدم",
    loading: "جارٍ التحميل…",
    closedTag: "للقراءة فقط",
  },
};

const GROUP_ORDER: DriverJobGroup[] = ["active", "upcoming", "completed"];

interface DriverJobsScreenProps {
  shipments: Shipment[];
  driverId: string;
  lang: Language;
  /** Unread MARAS chat messages per shipment id. */
  unreadByShipmentId: Record<string, number>;
  onOpenJob: (shipment: Shipment) => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
}

function JobCard({
  shipment: s,
  driverId,
  lang,
  unreadCount,
  onOpen,
}: {
  shipment: Shipment;
  driverId: string;
  lang: Language;
  unreadCount: number;
  onOpen: () => void;
}) {
  const t = LABELS[lang] ?? LABELS.en;
  const group = getDriverJobGroup(s.status, s.freightType);
  const closed = isShipmentClosed(s.status, s.freightType);
  const nextAction = getDriverNextAction(s.status, s.freightType);
  const agreedAmount = resolveDriverAgreedAmount(s, driverId);
  const truckNumber = resolveDriverTruckNumber(s, driverId);

  const nextStepText =
    s.status === "Assigned"
      ? t.respond
      : s.status === "New"
      ? t.waitingDispatch
      : nextAction
      ? localizeNextActionLabel(nextAction, lang)
      : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full text-start bg-slate-900 border rounded-3xl p-4 space-y-3 transition-all cursor-pointer active:scale-[0.99] ${
        closed
          ? "border-slate-800 opacity-75"
          : group === "completed"
          ? "border-emerald-500/20"
          : "border-slate-800 hover:border-orange-500/40"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-white selectable truncate">#{s.shipmentNumber}</span>
        <span className="flex items-center gap-1.5 shrink-0">
          {unreadCount > 0 && (
            <span className="inline-flex items-center gap-1 bg-orange-500 text-white text-xs font-bold rounded-full px-2 py-0.5 light-preserve">
              <MessageSquare className="w-3 h-3" />
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
          {closed && (
            <span className="text-[11px] font-bold text-slate-400 bg-slate-950 border border-slate-800 rounded-full px-2 py-0.5">
              {t.closedTag}
            </span>
          )}
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${getStatusChipClasses(s.status, s.freightType)}`}>
            {localizeShipmentStatus(s.status, lang)}
          </span>
        </span>
      </div>

      <div className="flex items-center gap-2.5 text-sm">
        <span className="font-bold text-slate-200 truncate">{s.loadingCity || "—"}</span>
        <ArrowRight className="w-4 h-4 text-orange-500 shrink-0 rtl:rotate-180" />
        <span className="font-bold text-slate-200 truncate">{s.deliveryCity || "—"}</span>
      </div>

      {nextStepText && !closed && group !== "completed" && (
        <p className="text-sm text-slate-300 flex items-center gap-1.5">
          <span className="text-slate-500">{t.nextStep}:</span>
          <span className="font-semibold text-orange-400">{nextStepText}</span>
        </p>
      )}

      <div className="flex items-center justify-between pt-2.5 border-t border-slate-800 text-sm">
        <span className="font-bold text-orange-500">
          {agreedAmount !== null ? `${agreedAmount.toLocaleString()} ${s.currency || "USD"}` : "—"}
        </span>
        <span className="flex items-center gap-2 text-slate-400 min-w-0">
          {truckNumber && <span className="font-semibold truncate">{truckNumber}</span>}
          <ChevronRight className="w-4 h-4 shrink-0 rtl:rotate-180" />
        </span>
      </div>
    </button>
  );
}

export default function DriverJobsScreen({
  shipments,
  driverId,
  lang,
  unreadByShipmentId,
  onOpenJob,
  hasMore,
  isLoadingMore,
  onLoadMore,
}: DriverJobsScreenProps) {
  const t = LABELS[lang] ?? LABELS.en;

  const grouped: Record<DriverJobGroup, Shipment[]> = { active: [], upcoming: [], completed: [] };
  for (const s of shipments) {
    grouped[getDriverJobGroup(s.status, s.freightType)].push(s);
  }

  return (
    <div className="space-y-5 animate-fade-in pb-4">
      <h2 className="text-xl font-bold text-white text-start">{t.title}</h2>

      {shipments.length === 0 ? (
        <div className="py-14 text-center space-y-4 bg-slate-900 rounded-3xl p-6 border border-slate-800">
          <div className="w-14 h-14 rounded-full bg-slate-950 border border-slate-800 flex items-center justify-center mx-auto">
            <Briefcase className="w-7 h-7 text-slate-600 shrink-0" />
          </div>
          <div>
            <p className="text-base font-bold text-slate-200">{t.empty}</p>
            <p className="text-sm text-slate-500 mt-1.5">{t.emptySub}</p>
          </div>
        </div>
      ) : (
        GROUP_ORDER.map((group) =>
          grouped[group].length === 0 ? null : (
            <section key={group} className="space-y-2.5">
              <h3 className="text-sm font-bold text-slate-400 text-start flex items-center gap-2">
                {t.groups[group]}
                <span className="text-xs font-semibold text-slate-500 bg-slate-900 border border-slate-800 rounded-full px-2 py-0.5">
                  {grouped[group].length}
                </span>
              </h3>
              {grouped[group].map((s) => (
                <JobCard
                  key={s.id}
                  shipment={s}
                  driverId={driverId}
                  lang={lang}
                  unreadCount={unreadByShipmentId[s.id] || 0}
                  onOpen={() => onOpenJob(s)}
                />
              ))}
            </section>
          )
        )
      )}

      {hasMore && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="px-5 min-h-[48px] bg-slate-900 border border-slate-700 hover:border-slate-600 text-slate-300 text-sm font-bold rounded-2xl transition-all disabled:opacity-50 cursor-pointer"
          >
            {isLoadingMore ? t.loading : t.loadOlder}
          </button>
        </div>
      )}
    </div>
  );
}
