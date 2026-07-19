import { useState, useEffect, useCallback } from "react";
import { ScrollText, Loader2, Download, ChevronDown, ChevronRight } from "lucide-react";
import type { Language } from "../../types";
import { apiFetch } from "../../lib/api";

/**
 * Audit Log Viewer (Increment 7) — read-only. Lives in the Settings → accounting
 * area. Filtering + pagination are SERVER-SIDE (the browser never loads the whole
 * collection): every filter/cursor round-trips to /api/admin/accounting/audit.
 * There are NO edit/delete controls — the audit log is append-only. Before/after
 * detail is only present when the server includes it (audit.viewSensitive).
 */
interface AuditRow {
  auditId: string; occurredAt: string; actorId: string; actorNameSnapshot?: string;
  action: string; entityType: string; entityId: string; result: string; source: string;
  errorCode?: string; reason?: string; requestId?: string; correlationId?: string;
  beforeSnapshot?: Record<string, unknown>; afterSnapshot?: Record<string, unknown>; changedFields?: string[];
}
const T = {
  title: { en: "Audit Log", ar: "سجل التدقيق", tr: "Denetim Günlüğü" },
  intro: { en: "Read-only history of sensitive accounting actions. Filtering and paging happen on the server.", ar: "سجل للقراءة فقط لإجراءات المحاسبة الحساسة. تتم التصفية والصفحات على الخادم.", tr: "Hassas muhasebe işlemlerinin salt okunur geçmişi. Filtreleme ve sayfalama sunucuda yapılır." },
  action: { en: "Action", ar: "الإجراء", tr: "İşlem" },
  actor: { en: "Actor", ar: "المنفذ", tr: "Kullanıcı" },
  result: { en: "Result", ar: "النتيجة", tr: "Sonuç" },
  more: { en: "Load more", ar: "تحميل المزيد", tr: "Daha fazla" },
  export: { en: "Export CSV", ar: "تصدير CSV", tr: "CSV dışa aktar" },
  none: { en: "No audit records match.", ar: "لا توجد سجلات مطابقة.", tr: "Eşleşen kayıt yok." },
};
const tr = (k: keyof typeof T, lang: Language) => T[k][lang] || T[k].en;
const RESULT_STYLE: Record<string, string> = { success: "bg-emerald-100 text-emerald-700", rejected: "bg-amber-100 text-amber-700", failed: "bg-red-100 text-red-700" };

export default function AuditLogViewer({ lang, canExport }: { lang: Language; canExport?: boolean }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [filters, setFilters] = useState({ action: "", actorId: "", result: "", reference: "", from: "", to: "" });

  const qs = useCallback((extra: Record<string, string> = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filters, ...extra })) if (v) p.set(k, v);
    return p.toString();
  }, [filters]);

  const load = useCallback(async (reset: boolean) => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/admin/accounting/audit?${qs(reset ? {} : (cursor ? { cursor } : {}))}`);
      if (res.ok) {
        const data = await res.json();
        setRows((prev) => (reset ? data.records : [...prev, ...data.records]));
        setCursor(data.nextCursor || null);
      }
    } catch { /* panel-isolated */ } finally { setLoading(false); }
  }, [qs, cursor]);

  useEffect(() => { void load(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filters]);

  const exportCsv = () => { window.open(`/api/admin/accounting/audit/export.csv?${qs()}`, "_blank"); };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5"><ScrollText className="w-4 h-4 text-orange-600" />{tr("title", lang)}</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">{tr("intro", lang)}</p>
        </div>
        {canExport && <button onClick={exportCsv} className="px-2.5 py-1.5 bg-slate-900 text-white text-[11px] font-bold rounded-lg cursor-pointer border-0 flex items-center gap-1"><Download className="w-3.5 h-3.5" />{tr("export", lang)}</button>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-1.5">
        <input placeholder={tr("action", lang)} value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} className="text-xs border border-slate-200 rounded px-2 py-1" />
        <input placeholder={tr("actor", lang)} value={filters.actorId} onChange={(e) => setFilters({ ...filters, actorId: e.target.value })} className="text-xs border border-slate-200 rounded px-2 py-1" />
        <select value={filters.result} onChange={(e) => setFilters({ ...filters, result: e.target.value })} className="text-xs border border-slate-200 rounded px-2 py-1 bg-white">
          <option value="">{tr("result", lang)}</option><option value="success">success</option><option value="rejected">rejected</option><option value="failed">failed</option>
        </select>
        <input placeholder="reference" value={filters.reference} onChange={(e) => setFilters({ ...filters, reference: e.target.value })} className="text-xs border border-slate-200 rounded px-2 py-1" />
        <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} className="text-xs border border-slate-200 rounded px-2 py-1" />
        <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} className="text-xs border border-slate-200 rounded px-2 py-1" />
      </div>

      {rows.length === 0 && !loading && <p className="text-[11px] text-slate-400 italic">{tr("none", lang)}</p>}
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.auditId} className="rounded-lg border border-slate-200 text-xs">
            <button onClick={() => setExpanded((e) => ({ ...e, [r.auditId]: !e[r.auditId] }))} className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 bg-transparent border-0 cursor-pointer text-left">
              {expanded[r.auditId] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <span className="font-mono text-slate-500">{r.occurredAt.slice(0, 19).replace("T", " ")}</span>
              <span className="font-black text-slate-800">{r.action}</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${RESULT_STYLE[r.result] || ""}`}>{r.result}</span>
              <span className="text-slate-500">{r.actorNameSnapshot || r.actorId}</span>
              <span className="ml-auto text-slate-400">{r.entityType}:{r.entityId}</span>
            </button>
            {expanded[r.auditId] && (
              <div className="px-6 py-2 border-t border-slate-100 bg-slate-50/60 space-y-1 text-[11px] text-slate-600">
                {r.errorCode && <div>errorCode: <span className="font-mono">{r.errorCode}</span></div>}
                {r.reason && <div>reason: {r.reason}</div>}
                {r.correlationId && <div>correlationId: <span className="font-mono">{r.correlationId}</span></div>}
                {r.changedFields && <div>changedFields: {r.changedFields.join(", ")}</div>}
                {r.beforeSnapshot && <div>before: <span className="font-mono">{JSON.stringify(r.beforeSnapshot)}</span></div>}
                {r.afterSnapshot && <div>after: <span className="font-mono">{JSON.stringify(r.afterSnapshot)}</span></div>}
              </div>
            )}
          </div>
        ))}
      </div>

      {loading && <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="w-4 h-4 animate-spin" />…</div>}
      {cursor && !loading && <button onClick={() => load(false)} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-[11px] font-bold rounded-lg cursor-pointer">{tr("more", lang)}</button>}
    </div>
  );
}
