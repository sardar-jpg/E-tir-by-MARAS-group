import { CheckCircle2, DollarSign, FileText, UserCheck, AlertTriangle, Activity, ChevronRight, ArrowRight } from "lucide-react";
import type { ActivityLog, Language } from "../../../types";

const S: Record<string, Record<Language, string>> = {
  title: { en: "Recent Activity", tr: "Son Aktivite", ar: "النشاط الأخير" },
  subtitle: { en: "Audit Log", tr: "Denetim Kaydı", ar: "سجل التدقيق" },
  viewAll: { en: "View all", tr: "Tümü", ar: "الكل" },
  goTo: { en: "Go to Audit Log", tr: "Denetim Kaydına Git", ar: "الذهاب إلى سجل التدقيق" },
  empty: { en: "No recent activity yet.", tr: "Henüz aktivite yok.", ar: "لا يوجد نشاط حديث بعد." },
};
const L = (k: string, lang: Language) => S[k]?.[lang] ?? S[k]?.en ?? k;

/** Heuristic semantic icon from the (existing) audit action text. */
function iconFor(actionEn: string): { icon: typeof Activity; cls: string } {
  const a = actionEn.toLowerCase();
  if (a.includes("deliver") || a.includes("complete")) return { icon: CheckCircle2, cls: "bg-emerald-50 text-emerald-600" };
  if (a.includes("payment") || a.includes("paid") || a.includes("invoice")) return { icon: DollarSign, cls: "bg-emerald-50 text-emerald-600" };
  if (a.includes("document") || a.includes("upload") || a.includes("cmr")) return { icon: FileText, cls: "bg-blue-50 text-blue-600" };
  if (a.includes("driver") || a.includes("assign")) return { icon: UserCheck, cls: "bg-indigo-50 text-indigo-600" };
  if (a.includes("critical") || a.includes("finding") || a.includes("alert") || a.includes("delay")) return { icon: AlertTriangle, cls: "bg-rose-50 text-rose-600" };
  return { icon: Activity, cls: "bg-slate-100 text-slate-500" };
}

function timeAgo(iso: string, lang: Language): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(lang === "ar" ? "ar-EG" : lang === "tr" ? "tr-TR" : "en-US", { hour: "2-digit", minute: "2-digit" });
}

export default function RecentActivityCard({
  logs,
  lang,
  onViewAll,
}: {
  logs: ActivityLog[];
  lang: Language;
  onViewAll: () => void;
}) {
  const recent = logs.slice(0, 5);
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label={L("title", lang)}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-black tracking-tight text-slate-900">{L("title", lang)}</h3>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{L("subtitle", lang)}</p>
        </div>
        <button onClick={onViewAll} className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 text-[11px] font-bold text-orange-600 hover:text-orange-700 hover:underline">
          {L("viewAll", lang)}<ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />
        </button>
      </div>

      {recent.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-xs italic text-slate-400">{L("empty", lang)}</p>
      ) : (
        <ol className="flex-1 space-y-1">
          {recent.map((log, i) => {
            const { icon: Icon, cls } = iconFor(log.actionEn || "");
            const text = lang === "ar" ? log.actionAr : lang === "tr" ? log.actionTr : log.actionEn;
            return (
              <li key={log.id || i} className="flex items-start gap-2.5 py-1.5">
                <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${cls}`}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold text-slate-800">{text}</p>
                  <p className="truncate text-[10px] text-slate-400">
                    {log.actor}
                    {log.shipmentNumber ? <span className="ms-1 font-mono text-slate-400">· #{log.shipmentNumber}</span> : null}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-[10px] text-slate-400">{timeAgo(log.timestamp, lang)}</span>
              </li>
            );
          })}
        </ol>
      )}

      <button
        onClick={onViewAll}
        className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
      >
        {L("goTo", lang)}<ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
      </button>
    </section>
  );
}
