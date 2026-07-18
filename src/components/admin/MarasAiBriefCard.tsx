import { useState, useEffect, useCallback } from "react";
import { RefreshCw, ShieldAlert, ChevronDown, ChevronUp } from "lucide-react";
import type { Language } from "../../types";
import { apiFetch } from "../../lib/api";
import type { DeterministicDashboardBrief, DashboardBriefLine } from "../../lib/dashboardBrief";
import type { AuditPriorityAssessment } from "../../lib/auditEngine";

/**
 * MarasAiBriefCard (PR #132) — the MARAS AI Brief at the top of the
 * unified dashboard. ONE consolidated fetch (GET /api/admin/dashboard/
 * brief) supplies the deterministic brief, attention KPIs, monitoring
 * priority buckets, and top findings — all scope-filtered server-side
 * for the viewer's role. The deterministic content always renders, with
 * or without OpenAI; the cached AI paragraph (if any) merely explains
 * it, and ordinary renders NEVER trigger a provider call — only the
 * explicit Refresh Brief button does, server-side.
 *
 * Failure isolation: any error stays inside this card (an error strip
 * renders here); the rest of the Dashboard is unaffected.
 */

const L: Record<string, { en: string; tr: string; ar: string }> = {
  title: { en: "MARAS AI Brief", tr: "MARAS AI Brifingi", ar: "موجز MARAS AI" },
  scopeAll: { en: "Summarizes all current operations", tr: "Tüm güncel operasyonları özetler", ar: "يلخص جميع العمليات الحالية" },
  lastUpdated: { en: "Last updated", tr: "Son güncelleme", ar: "آخر تحديث" },
  refresh: { en: "Refresh Brief", tr: "Brifingi Yenile", ar: "تحديث الموجز" },
  all_clear: { en: "All clear — no open concerns.", tr: "Her şey yolunda — açık bir sorun yok.", ar: "كل شيء على ما يرام — لا توجد مشاكل مفتوحة." },
  attention: { en: "Attention needed", tr: "Dikkat gerekiyor", ar: "يلزم الانتباه" },
  action_needed: { en: "Action needed today", tr: "Bugün aksiyon gerekiyor", ar: "مطلوب إجراء اليوم" },
  priorities: { en: "Top priorities today", tr: "Bugünün öncelikleri", ar: "أولويات اليوم" },
  nextActions: { en: "Recommended next actions", tr: "Önerilen sonraki adımlar", ar: "الإجراءات التالية الموصى بها" },
  delayed_shipments: { en: "Delayed shipments", tr: "Geciken sevkiyatlar", ar: "شحنات متأخرة" },
  missing_documents: { en: "Shipments missing documents", tr: "Belgesi eksik sevkiyatlar", ar: "شحنات بلا مستندات" },
  unassigned_shipments: { en: "Unassigned shipments", tr: "Sürücüsüz sevkiyatlar", ar: "شحنات بدون سائق" },
  critical_findings: { en: "Critical findings (fix immediately)", tr: "Kritik bulgular (hemen)", ar: "نتائج حرجة (فورًا)" },
  high_findings: { en: "High-priority findings (fix today)", tr: "Yüksek öncelikli bulgular (bugün)", ar: "نتائج عالية الأولوية (اليوم)" },
  accounting_open: { en: "Open accounting findings", tr: "Açık muhasebe bulguları", ar: "نتائج محاسبية مفتوحة" },
  security_technical_open: { en: "Open security/technical findings", tr: "Açık güvenlik/teknik bulgular", ar: "نتائج أمنية/تقنية مفتوحة" },
  act_delayed_shipments: { en: "Contact the assigned drivers and update stale shipment statuses.", tr: "Sürücüleri arayın ve bekleyen sevkiyat durumlarını güncelleyin.", ar: "تواصل مع السائقين وحدّث حالات الشحنات المتوقفة." },
  act_missing_documents: { en: "Collect and upload the missing shipment documents.", tr: "Eksik sevkiyat belgelerini toplayıp yükleyin.", ar: "اجمع مستندات الشحن الناقصة وارفعها." },
  act_unassigned_shipments: { en: "Assign drivers to the dispatched shipments without one.", tr: "Sürücüsüz sevkiyatlara sürücü atayın.", ar: "عيّن سائقين للشحنات التي بلا سائق." },
  act_critical_findings: { en: "Open Monitoring and resolve the critical findings first.", tr: "İzlemeyi açın ve önce kritik bulguları çözün.", ar: "افتح المراقبة وعالج النتائج الحرجة أولًا." },
  act_high_findings: { en: "Work through today's high-priority findings in Monitoring.", tr: "İzlemedeki yüksek öncelikli bulguları bugün ele alın.", ar: "عالج نتائج اليوم عالية الأولوية في المراقبة." },
  act_accounting_open: { en: "Review the open accounting findings with the accounting team.", tr: "Açık muhasebe bulgularını muhasebe ekibiyle inceleyin.", ar: "راجع النتائج المحاسبية المفتوحة مع فريق المحاسبة." },
  act_security_technical_open: { en: "Review the security/technical findings (Super Admin).", tr: "Güvenlik/teknik bulguları inceleyin (Süper Yönetici).", ar: "راجع النتائج الأمنية/التقنية (المشرف العام)." },
  inTransit: { en: "In Transit", tr: "Yolda", ar: "في الطريق" },
  deliveredToday: { en: "Delivered Today", tr: "Bugün Teslim", ar: "سُلّمت اليوم" },
  monitoring: { en: "Open Monitoring", tr: "İzlemeyi Aç", ar: "فتح المراقبة" },
  runAudit: { en: "Run Audit Now", tr: "Şimdi Denetle", ar: "تشغيل التدقيق الآن" },
  topFindings: { en: "Top findings", tr: "Öne çıkan bulgular", ar: "أبرز النتائج" },
  aiSection: { en: "MARAS AI analysis", tr: "MARAS AI analizi", ar: "تحليل MARAS AI" },
  srcSystem: { en: "System Data", tr: "Sistem Verisi", ar: "بيانات النظام" },
  srcCombined: { en: "System Data + AI Analysis", tr: "Sistem Verisi + Yapay Zekâ Analizi", ar: "بيانات النظام + تحليل الذكاء الاصطناعي" },
  showMore: { en: "Show details", tr: "Detayları göster", ar: "عرض التفاصيل" },
  showLess: { en: "Hide details", tr: "Detayları gizle", ar: "إخفاء التفاصيل" },
  loadError: { en: "The brief could not be loaded. The rest of the dashboard is unaffected.", tr: "Brifing yüklenemedi. Panonun geri kalanı etkilenmez.", ar: "تعذر تحميل الموجز. بقية اللوحة تعمل كالمعتاد." },
};
const t = (k: string, lang: Language) => (L[k] ? L[k][lang] || L[k].en : k);

interface BriefTopFinding {
  id: string;
  ruleId: string;
  title: string;
  severity: string;
  recordRef: string;
  recordType: string;
  recordId: string;
  priority: AuditPriorityAssessment;
}

interface BriefResponse {
  brief: DeterministicDashboardBrief;
  topFindings: BriefTopFinding[];
  ai: { text: string; generatedAt: string | null } | null;
  aiError?: string;
  source: "system_data" | "system_data_ai_analysis";
  generatedAt: string;
}

const STATUS_STRIP: Record<string, string> = {
  all_clear: "bg-emerald-50 border-emerald-200 text-emerald-800",
  attention: "bg-amber-50 border-amber-200 text-amber-800",
  action_needed: "bg-red-50 border-red-200 text-red-800",
};

interface MarasAiBriefCardProps {
  lang: Language;
  isMobileMode: boolean;
  isSuper: boolean;
  onOpenMonitoring: () => void;
}

export default function MarasAiBriefCard({ lang, isMobileMode, isSuper, onOpenMonitoring }: MarasAiBriefCardProps) {
  const [data, setData] = useState<BriefResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Progressive disclosure on mobile: summary strip first, details expandable.
  const [expanded, setExpanded] = useState(!isMobileMode);

  const load = useCallback(async (refresh: boolean) => {
    setError("");
    if (refresh) setBusy(true);
    try {
      const res = refresh
        ? await apiFetch("/api/admin/dashboard/brief/refresh", { method: "POST" })
        : await apiFetch("/api/admin/dashboard/brief");
      if (!res.ok) { setError(t("loadError", lang)); return; }
      setData(await res.json());
    } catch {
      setError(t("loadError", lang));
    } finally {
      if (refresh) setBusy(false);
    }
  }, [lang]);

  useEffect(() => { void load(false); }, [load]);

  const runAuditNow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await apiFetch("/api/admin/audit/run", { method: "POST" });
      await load(false);
    } catch { /* card-local */ } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="p-3 rounded-xl border border-slate-200 bg-white text-[11px] font-semibold text-slate-500">
        ✨ {t("title", lang)}: {error}
      </div>
    );
  }
  if (!data) {
    return <div className="p-4 rounded-xl border border-slate-200 bg-white text-xs text-slate-400 animate-pulse">✨ {t("title", lang)}…</div>;
  }

  const { brief } = data;
  const kpiChips: { key: string; label: string; value: number; alarm: boolean }[] = [
    { key: "delayed", label: t("delayed_shipments", lang), value: brief.kpis.delayedShipments, alarm: brief.kpis.delayedShipments > 0 },
    { key: "missingDocs", label: t("missing_documents", lang), value: brief.kpis.missingDocuments, alarm: brief.kpis.missingDocuments > 0 },
    { key: "unassigned", label: t("unassigned_shipments", lang), value: brief.kpis.unassignedShipments, alarm: brief.kpis.unassignedShipments > 0 },
    { key: "inTransit", label: t("inTransit", lang), value: brief.kpis.inTransit, alarm: false },
    { key: "deliveredToday", label: t("deliveredToday", lang), value: brief.kpis.deliveredToday, alarm: false },
    { key: "critical", label: t("critical_findings", lang), value: brief.prioritySummary.critical_now, alarm: brief.prioritySummary.critical_now > 0 },
    { key: "high", label: t("high_findings", lang), value: brief.prioritySummary.high_today, alarm: brief.prioritySummary.high_today > 0 },
  ];

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3 min-w-0">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
            <span>✨</span>
            <span>{t("title", lang)}</span>
          </h2>
          <p className="text-[10px] text-slate-400 font-medium">
            {t("scopeAll", lang)} · {t("lastUpdated", lang)}: {new Date(data.generatedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-[9px] font-black uppercase tracking-wider text-slate-500">
            {data.source === "system_data_ai_analysis" ? t("srcCombined", lang) : t("srcSystem", lang)}
          </span>
          <button
            onClick={() => void load(true)}
            disabled={busy}
            className="flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 bg-white hover:border-orange-300 text-[10px] font-bold text-slate-600 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${busy ? "animate-spin" : ""}`} />
            <span>{t("refresh", lang)}</span>
          </button>
        </div>
      </div>

      {/* Status strip — the one-line answer, always deterministic. */}
      <div className={`px-3 py-2 rounded-lg border text-xs font-bold ${STATUS_STRIP[brief.status]}`}>
        {t(brief.status, lang)}
        {brief.status !== "all_clear" && ` · ${brief.priorities.slice(0, 2).map((p) => `${t(p.kind, lang)}: ${p.count}`).join(" · ")}`}
      </div>

      {/* Compact KPI chips — each is the authoritative derived count. */}
      <div className="flex gap-1.5 flex-wrap">
        {kpiChips.map((c) => (
          <span
            key={c.key}
            className={`px-2 py-1 rounded-lg border text-[10px] font-bold ${c.alarm ? "bg-red-50 border-red-200 text-red-700" : "bg-slate-50 border-slate-200 text-slate-600"}`}
          >
            {c.label}: {c.value}
          </span>
        ))}
      </div>

      {isMobileMode && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-orange-500 bg-transparent border-0 cursor-pointer p-0"
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span>{expanded ? t("showLess", lang) : t("showMore", lang)}</span>
        </button>
      )}

      {expanded && (
        <div className="space-y-3">
          {brief.priorities.length > 0 && (
            <div className="min-w-0">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{t("priorities", lang)}</h3>
              <ol className="list-decimal ps-4 space-y-0.5 text-xs text-slate-700 font-semibold">
                {brief.priorities.map((p: DashboardBriefLine) => (
                  <li key={p.kind}>{t(p.kind, lang)}: {p.count}</li>
                ))}
              </ol>
            </div>
          )}
          {brief.recommendedActions.length > 0 && (
            <div className="min-w-0">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{t("nextActions", lang)}</h3>
              <ul className="list-disc ps-4 space-y-0.5 text-xs text-slate-600">
                {brief.recommendedActions.map((kind) => (
                  <li key={kind}>{t(`act_${kind}`, lang)}</li>
                ))}
              </ul>
            </div>
          )}
          {data.topFindings.length > 0 && (
            <div className="min-w-0">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{t("topFindings", lang)}</h3>
              <div className="space-y-1">
                {data.topFindings.map((f) => (
                  <div key={f.id} className="flex items-center justify-between gap-2 p-2 rounded-lg border border-slate-200 bg-slate-50 flex-wrap">
                    <span className="text-[11px] font-bold text-slate-800 min-w-0 truncate">{f.title} · {f.recordRef}</span>
                    <span className="text-[9px] font-black shrink-0">{f.priority.emoji} {f.priority.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {data.ai && (
            <div className="p-2.5 rounded-lg border border-orange-100 bg-orange-50/50 min-w-0">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-orange-400 mb-1">{t("aiSection", lang)}</h3>
              <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap break-words">{data.ai.text}</p>
            </div>
          )}
          {data.aiError && <p className="text-[10px] text-slate-400 font-medium">{data.aiError}</p>}
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={onOpenMonitoring}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:border-orange-300 text-[11px] font-bold text-slate-700 cursor-pointer"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-orange-500" />
              <span>{t("monitoring", lang)}</span>
            </button>
            {isSuper && (
              <button
                onClick={runAuditNow}
                disabled={busy}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:border-orange-300 text-[11px] font-bold text-slate-700 cursor-pointer disabled:opacity-50"
              >
                {t("runAudit", lang)}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
