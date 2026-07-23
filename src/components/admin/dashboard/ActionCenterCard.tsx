import { AlertTriangle, ArrowRight, CheckCircle2, Truck, Wallet, Database, ShieldAlert, Wrench, ChevronRight } from "lucide-react";
import type { Language } from "../../../types";
import type { AuditFinding, AuditPriorityAssessment, AuditCategory } from "../../../lib/auditEngine";

export type DecoratedFinding = AuditFinding & { priority?: AuditPriorityAssessment };

const S: Record<string, Record<Language, string>> = {
  title: { en: "Action Center", tr: "Eylem Merkezi", ar: "مركز الإجراءات" },
  viewAll: { en: "View all", tr: "Tümü", ar: "الكل" },
  critical: { en: "Critical", tr: "Kritik", ar: "حرِج" },
  dueToday: { en: "Due Today", tr: "Bugün", ar: "اليوم" },
  delayed: { en: "Delayed", tr: "Geciken", ar: "متأخر" },
  topActions: { en: "Top actions required", tr: "Öncelikli eylemler", ar: "أهم الإجراءات المطلوبة" },
  goTo: { en: "Go to Action Center", tr: "Eylem Merkezine Git", ar: "الذهاب إلى مركز الإجراءات" },
  allClear: { en: "No open actions. All clear.", tr: "Açık eylem yok. Her şey yolunda.", ar: "لا إجراءات مفتوحة. كل شيء على ما يرام." },
  error: { en: "Action items could not be loaded.", tr: "Eylemler yüklenemedi.", ar: "تعذّر تحميل الإجراءات." },
};
const L = (k: string, lang: Language) => S[k]?.[lang] ?? S[k]?.en ?? k;

const CATEGORY_ICON: Record<AuditCategory, typeof Truck> = {
  operations: Truck,
  accounting: Wallet,
  data_integrity: Database,
  security: ShieldAlert,
  technical: Wrench,
};

const PRIORITY_BADGE: Record<string, string> = {
  critical_now: "bg-red-100 text-red-700",
  high_today: "bg-orange-100 text-orange-700",
  medium_soon: "bg-amber-100 text-amber-700",
  low_monitor: "bg-sky-100 text-sky-700",
};

function SummaryStat({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="flex-1 rounded-xl border border-slate-100 bg-slate-50/70 px-2 py-2 text-center">
      <div className={`text-xl font-black tabular-nums ${tone}`}>{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}

/**
 * Compact Action Center for the Dashboard: a Critical / Due Today /
 * Delayed summary and the TOP FIVE required actions (the deterministic
 * audit findings, priority-ordered worst-first by the server). Each row
 * links to the finding's record. Data is fetched once by the parent and
 * passed in — this card is presentational.
 */
export default function ActionCenterCard({
  findings,
  loading,
  error,
  criticalCount,
  dueTodayCount,
  delayedCount,
  lang,
  onOpenFinding,
  onViewAll,
}: {
  findings: DecoratedFinding[];
  loading: boolean;
  error: boolean;
  criticalCount: number;
  dueTodayCount: number;
  delayedCount: number;
  lang: Language;
  onOpenFinding: (f: DecoratedFinding) => void;
  onViewAll: () => void;
}) {
  const top = findings.slice(0, 5);
  const openTotal = findings.length;

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label={L("title", lang)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-black tracking-tight text-slate-900">
          {L("title", lang)}
          {openTotal > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-600 tabular-nums">{openTotal}</span>}
        </h3>
        <button onClick={onViewAll} className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 text-[11px] font-bold text-orange-600 hover:text-orange-700 hover:underline">
          {L("viewAll", lang)}<ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />
        </button>
      </div>

      <div className="flex items-stretch gap-2">
        <SummaryStat value={criticalCount} label={L("critical", lang)} tone="text-red-600" />
        <SummaryStat value={dueTodayCount} label={L("dueToday", lang)} tone="text-orange-600" />
        <SummaryStat value={delayedCount} label={L("delayed", lang)} tone="text-amber-600" />
      </div>

      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{L("topActions", lang)}</p>

      <div className="flex-1 space-y-1.5">
        {loading ? (
          [0, 1, 2, 3].map((i) => <div key={i} className="h-11 animate-pulse rounded-lg bg-slate-100" />)
        ) : error ? (
          <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-3 text-xs font-semibold text-slate-500">
            <AlertTriangle className="h-4 w-4 text-slate-400" />{L("error", lang)}
          </div>
        ) : top.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-3 text-xs font-semibold text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />{L("allClear", lang)}
          </div>
        ) : (
          top.map((f) => {
            const Icon = CATEGORY_ICON[f.category] || AlertTriangle;
            const badge = f.priority ? PRIORITY_BADGE[f.priority.priority] || "bg-slate-100 text-slate-600" : "bg-slate-100 text-slate-600";
            return (
              <button
                key={f.id}
                onClick={() => onOpenFinding(f)}
                className="flex w-full items-center gap-2.5 rounded-lg border border-slate-100 px-2.5 py-2 text-start transition-colors hover:border-slate-200 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold text-slate-800">{f.title}</span>
                  <span className="block truncate font-mono text-[10px] text-slate-400">{f.recordRef}</span>
                </span>
                {f.priority && (
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-black uppercase ${badge}`}>
                    {f.priority.label}
                  </span>
                )}
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-300 rtl:rotate-180" />
              </button>
            );
          })
        )}
      </div>

      <button
        onClick={onViewAll}
        className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
      >
        {L("goTo", lang)}<ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
      </button>
    </section>
  );
}
