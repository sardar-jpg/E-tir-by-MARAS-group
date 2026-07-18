import React, { useState, useEffect, useCallback } from "react";
import { X, RefreshCw, ShieldAlert, Search } from "lucide-react";
import type { Language } from "../../types";
import { apiFetch } from "../../lib/api";
import type { AuditFinding, AuditSummary, AuditSeverity, AuditCategory, AuditFindingStatus } from "../../lib/auditEngine";

/**
 * MarasAiMonitoringPanel (PR #131) — the MARAS AI Monitoring dashboard,
 * opened from the MARAS AI drawer. Presentation + read-only actions only:
 * every list this panel shows was ALREADY scope-filtered by the server
 * for the viewer's role (super = everything; operation = operational
 * findings only), and every action routes through the audited backend
 * endpoints (acknowledge for viewers, ignore/manual-resolve Super Admin
 * only with a mandatory reason). Nothing here mutates business data.
 *
 * Mobile: full-screen with safe areas, card list. Desktop: the same
 * component in a wide right-side panel — one component, no fork.
 */

const L: Record<string, { en: string; tr: string; ar: string }> = {
  title: { en: "MARAS AI Monitoring", tr: "MARAS AI İzleme", ar: "مراقبة MARAS AI" },
  health: { en: "System Health", tr: "Sistem Sağlığı", ar: "صحة النظام" },
  lastAudit: { en: "Last successful audit", tr: "Son başarılı denetim", ar: "آخر تدقيق ناجح" },
  never: { en: "never", tr: "hiç", ar: "أبدًا" },
  runningNow: { en: "Audit running…", tr: "Denetim çalışıyor…", ar: "التدقيق قيد التشغيل…" },
  runNow: { en: "Run Audit Now", tr: "Şimdi Denetle", ar: "تشغيل التدقيق الآن" },
  openFindings: { en: "open findings", tr: "açık bulgu", ar: "نتائج مفتوحة" },
  all: { en: "All", tr: "Tümü", ar: "الكل" },
  operations: { en: "Operations", tr: "Operasyon", ar: "العمليات" },
  accounting: { en: "Accounting", tr: "Muhasebe", ar: "المحاسبة" },
  data_integrity: { en: "Data Integrity", tr: "Veri Bütünlüğü", ar: "سلامة البيانات" },
  security: { en: "Security", tr: "Güvenlik", ar: "الأمان" },
  technical: { en: "Technical", tr: "Teknik", ar: "تقني" },
  open: { en: "Open", tr: "Açık", ar: "مفتوح" },
  acknowledged: { en: "Acknowledged", tr: "Onaylandı", ar: "مُقِرّ به" },
  resolved: { en: "Resolved", tr: "Çözüldü", ar: "تم الحل" },
  ignored: { en: "Ignored", tr: "Yoksayıldı", ar: "متجاهَل" },
  search: { en: "Search order number or record…", tr: "Sipariş no veya kayıt ara…", ar: "ابحث برقم الطلب أو السجل…" },
  evidence: { en: "Evidence", tr: "Kanıt", ar: "الدليل" },
  action: { en: "Recommended action", tr: "Önerilen işlem", ar: "الإجراء الموصى به" },
  seen: { en: "seen", tr: "görülme", ar: "مرات الرصد" },
  openRecord: { en: "Open Record", tr: "Kaydı Aç", ar: "فتح السجل" },
  acknowledge: { en: "Acknowledge", tr: "Onayla", ar: "إقرار" },
  ignore: { en: "Ignore", tr: "Yoksay", ar: "تجاهل" },
  resolve: { en: "Resolve", tr: "Çöz", ar: "حل" },
  reasonPrompt: { en: "Reason (required, recorded in the audit trail):", tr: "Gerekçe (zorunlu, denetim izine yazılır):", ar: "السبب (إلزامي ويُسجَّل في سجل التدقيق):" },
  empty: { en: "No findings match the current filters.", tr: "Filtrelere uyan bulgu yok.", ar: "لا توجد نتائج مطابقة للمرشحات." },
  loadError: { en: "Could not load monitoring data.", tr: "İzleme verileri yüklenemedi.", ar: "تعذر تحميل بيانات المراقبة." },
};
const t = (key: string, lang: Language) => (L[key] ? L[key][lang] || L[key].en : key);

const SEV_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  low: "bg-slate-100 text-slate-600 border-slate-200",
  info: "bg-slate-50 text-slate-500 border-slate-200",
};
const CATEGORIES: (AuditCategory | "")[] = ["", "operations", "accounting", "data_integrity", "security", "technical"];
const SEVERITIES: (AuditSeverity | "")[] = ["", "critical", "high", "medium", "low", "info"];
const STATUSES: (AuditFindingStatus | "")[] = ["", "open", "acknowledged", "resolved", "ignored"];

interface MarasAiMonitoringPanelProps {
  lang: Language;
  isRtl: boolean;
  isSuper: boolean;
  onClose: () => void;
  /** Opens the shipment details modal for shipment-type findings (closes the panel first). */
  onOpenShipment: (shipmentId: string) => void;
  /** Called after any change that may affect the attention badge. */
  onChanged: () => void;
}

export default function MarasAiMonitoringPanel({ lang, isRtl, isSuper, onClose, onOpenShipment, onChanged }: MarasAiMonitoringPanelProps) {
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [lastSuccessfulRunAt, setLastSuccessfulRunAt] = useState<string | null>(null);
  const [auditRunning, setAuditRunning] = useState(false);
  const [findings, setFindings] = useState<AuditFinding[]>([]);
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("");
  const [status, setStatus] = useState("open");
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (severity) params.set("severity", severity);
      if (status) params.set("status", status);
      if (query.trim()) params.set("q", query.trim());
      const [sumRes, listRes] = await Promise.all([
        apiFetch("/api/admin/audit/summary"),
        apiFetch(`/api/admin/audit/findings?${params.toString()}`),
      ]);
      if (!sumRes.ok || !listRes.ok) { setError(t("loadError", lang)); return; }
      const sumData = await sumRes.json();
      const listData = await listRes.json();
      setSummary(sumData.summary || null);
      setLastSuccessfulRunAt(sumData.lastSuccessfulRunAt || null);
      setAuditRunning(!!sumData.running);
      setFindings(Array.isArray(listData.findings) ? listData.findings : []);
    } catch {
      setError(t("loadError", lang));
    }
  }, [category, severity, status, query, lang]);

  useEffect(() => { void load(); }, [load]);

  const runAuditNow = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch("/api/admin/audit/run", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error || t("loadError", lang));
      }
      await load();
      onChanged();
    } catch {
      setError(t("loadError", lang));
    } finally {
      setBusy(false);
    }
  };

  const act = async (finding: AuditFinding, action: "acknowledge" | "ignore" | "resolve") => {
    if (busy) return;
    let reason = "";
    if (action === "ignore" || action === "resolve") {
      const input = window.prompt(t("reasonPrompt", lang));
      if (input === null) return;
      reason = input.trim();
      if (!reason) return;
    }
    setBusy(true);
    try {
      const res = await apiFetch(`/api/admin/audit/findings/${finding.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error || t("loadError", lang));
      }
      await load();
      onChanged();
    } catch {
      setError(t("loadError", lang));
    } finally {
      setBusy(false);
    }
  };

  const chip = (active: boolean) =>
    `px-2 py-1 rounded-lg border text-[10px] font-bold cursor-pointer transition-all ${active ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-orange-300"}`;

  return (
    <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs z-[210] animate-fade-in" onClick={onClose}>
      <div
        className={`fixed inset-y-0 ${isRtl ? "left-0 border-r" : "right-0 border-l"} w-full lg:max-w-2xl bg-slate-50 shadow-2xl flex flex-col text-slate-900 border-slate-200`}
        onClick={(e) => e.stopPropagation()}
        dir={isRtl ? "rtl" : "ltr"}
      >
        <div className="flex items-start justify-between gap-3 p-4 pt-[max(1rem,env(safe-area-inset-top))] border-b border-slate-800 bg-gradient-to-br from-slate-900 to-slate-800 text-white shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-black tracking-tight flex items-center gap-2">
              <ShieldAlert className="w-4.5 h-4.5 text-orange-400" />
              <span>{t("title", lang)}</span>
            </h2>
            <p className="text-[11px] text-slate-300 font-medium mt-0.5">
              {t("lastAudit", lang)}: {lastSuccessfulRunAt ? new Date(lastSuccessfulRunAt).toLocaleString() : t("never", lang)}
              {auditRunning && <span className="text-orange-300"> · {t("runningNow", lang)}</span>}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isSuper && (
              <button
                onClick={runAuditNow}
                disabled={busy}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-[11px] font-bold cursor-pointer border-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">{t("runNow", lang)}</span>
              </button>
            )}
            <button onClick={onClose} title="Close" className="p-1.5 text-slate-300 hover:text-white hover:bg-white/10 rounded-lg border-0 bg-transparent cursor-pointer">
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-3">
          {/* Health summary */}
          {summary && (
            <div className="p-3 rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t("health", lang)}</span>
                <span className="text-xs font-black">{summary.openTotal} {t("openFindings", lang)}</span>
              </div>
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {(["critical", "high", "medium", "low", "info"] as const).map((sev) => (
                  <span key={sev} className={`px-2 py-0.5 rounded border text-[10px] font-black uppercase ${SEV_BADGE[sev]}`}>
                    {sev}: {summary.bySeverity[sev]}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="space-y-1.5">
            <div className="flex gap-1.5 flex-wrap">
              {CATEGORIES.map((c) => (
                <button key={c || "all"} onClick={() => setCategory(c)} className={chip(category === c)}>
                  {c ? t(c, lang) : t("all", lang)}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {SEVERITIES.map((s) => (
                <button key={s || "all"} onClick={() => setSeverity(s)} className={chip(severity === s)}>
                  {s || t("all", lang)}
                </button>
              ))}
              <span className="w-px bg-slate-200 mx-0.5" />
              {STATUSES.map((s) => (
                <button key={s || "all"} onClick={() => setStatus(s)} className={chip(status === s)}>
                  {s ? t(s, lang) : t("all", lang)}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className={`w-3.5 h-3.5 text-slate-400 absolute top-2.5 ${isRtl ? "right-2.5" : "left-2.5"}`} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("search", lang)}
                className={`w-full py-2 ${isRtl ? "pr-8 pl-3" : "pl-8 pr-3"} text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-orange-500/40 font-medium`}
              />
            </div>
          </div>

          {error && <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5 font-semibold">{error}</div>}

          {/* Findings */}
          {findings.length === 0 && !error && (
            <div className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2.5 py-2">{t("empty", lang)}</div>
          )}
          {findings.map((f) => (
            <div key={f.id} className="p-2.5 rounded-xl border border-slate-200 bg-white space-y-1.5 min-w-0">
              <button
                onClick={() => setExpandedId(expandedId === f.id ? null : f.id)}
                className="w-full flex items-center justify-between gap-2 flex-wrap bg-transparent border-0 cursor-pointer p-0 text-start"
              >
                <span className="text-xs font-black text-slate-900 min-w-0 truncate">{f.title}</span>
                <span className="flex items-center gap-1.5 shrink-0">
                  <span className={`px-1.5 py-0.5 rounded border text-[9px] font-black uppercase ${SEV_BADGE[f.severity]}`}>{f.severity}</span>
                  <span className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase">{t(f.status, lang)}</span>
                </span>
              </button>
              <div className="text-[10px] text-slate-500 flex gap-2 flex-wrap">
                <span className="font-mono">{f.ruleId}</span>
                <span>{t(f.category, lang)}</span>
                <span className="font-semibold text-slate-700">{f.recordRef}</span>
                <span>{t("seen", lang)} x{f.occurrenceCount}</span>
                <span>{new Date(f.lastSeenAt).toLocaleString()}</span>
              </div>
              {expandedId === f.id && (
                <div className="space-y-1.5 pt-1 border-t border-slate-100">
                  <div className="text-[10px] text-slate-600"><span className="font-black uppercase text-slate-400">{t("evidence", lang)}: </span>{f.evidence}</div>
                  <div className="text-[10px] text-slate-600"><span className="font-black uppercase text-slate-400">{t("action", lang)}: </span>{f.recommendedAction}</div>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {f.recordType === "shipment" && f.recordId && (
                      <button onClick={() => onOpenShipment(f.recordId)} className="px-2 py-1 rounded-md border border-orange-300 bg-orange-50 hover:bg-orange-100 text-[10px] font-bold text-orange-700 cursor-pointer">
                        {t("openRecord", lang)}
                      </button>
                    )}
                    {f.status === "open" && (
                      <button onClick={() => act(f, "acknowledge")} disabled={busy} className="px-2 py-1 rounded-md border border-slate-200 bg-white hover:border-orange-300 text-[10px] font-bold text-slate-600 cursor-pointer disabled:opacity-50">
                        {t("acknowledge", lang)}
                      </button>
                    )}
                    {isSuper && f.status !== "resolved" && (
                      <>
                        <button onClick={() => act(f, "ignore")} disabled={busy} className="px-2 py-1 rounded-md border border-slate-200 bg-white hover:border-orange-300 text-[10px] font-bold text-slate-600 cursor-pointer disabled:opacity-50">
                          {t("ignore", lang)}
                        </button>
                        <button onClick={() => act(f, "resolve")} disabled={busy} className="px-2 py-1 rounded-md border border-slate-200 bg-white hover:border-emerald-300 text-[10px] font-bold text-slate-600 cursor-pointer disabled:opacity-50">
                          {t("resolve", lang)}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
