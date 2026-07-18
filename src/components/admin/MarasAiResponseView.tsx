import React from "react";
import type { Language } from "../../types";
import type {
  MarasAiStructuredResult,
  MarasAiShipmentCardItem,
  MarasAiSeverityTag,
} from "../../lib/marasAiIntents";
import { parseMarasAiMarkdown, type MarasAiInlineNode } from "../../lib/marasAiMarkdown";
import { getShipmentStatusLabel } from "../../lib/shipmentStatusTransitions";

/**
 * MarasAiResponseView (PR #130) — presentation-only rendering for MARAS
 * AI replies, shared by the mobile and desktop drawer (one component, no
 * fork). Structured results from the backend render as compact cards;
 * the model's narrative renders through the SAFE Markdown parser
 * (marasAiMarkdown.ts — typed nodes mapped to React elements, never an
 * HTML string, so no injection surface exists). Plain-text replies and
 * conversations stored before this PR render exactly as before.
 *
 * Navigation actions are read-only shortcuts into existing Admin views:
 * they render ONLY when the caller supplied a handler (AdminPanel gates
 * those by the viewer's existing permissions) AND the item carries a
 * real internal id. Nothing here can modify data.
 */

const LABELS: Record<string, { en: string; tr: string; ar: string }> = {
  delayed_shipments: { en: "Delayed Shipments", tr: "Geciken Sevkiyatlar", ar: "الشحنات المتأخرة" },
  shipments_overview: { en: "Active Shipments", tr: "Aktif Sevkiyatlar", ar: "الشحنات النشطة" },
  missing_documents: { en: "Missing Documents", tr: "Eksik Belgeler", ar: "مستندات ناقصة" },
  operational_risks: { en: "Operational Risks", tr: "Operasyonel Riskler", ar: "المخاطر التشغيلية" },
  driver_performance: { en: "Driver Performance", tr: "Sürücü Performansı", ar: "أداء السائقين" },
  monitoring_alerts: { en: "Monitoring Alerts", tr: "İzleme Uyarıları", ar: "تنبيهات المراقبة" },
  audit_findings: { en: "Audit Findings", tr: "Denetim Bulguları", ar: "نتائج التدقيق" },
  driver: { en: "Driver", tr: "Sürücü", ar: "السائق" },
  customer: { en: "Customer", tr: "Müşteri", ar: "العميل" },
  updated: { en: "Updated", tr: "Güncellendi", ar: "آخر تحديث" },
  openShipment: { en: "Open Shipment", tr: "Sevkiyatı Aç", ar: "فتح الشحنة" },
  openTracking: { en: "Open Tracking", tr: "Takibi Aç", ar: "فتح التتبع" },
  openChat: { en: "Open Chat", tr: "Sohbeti Aç", ar: "فتح المحادثة" },
  more: { en: "more not shown", tr: "tanesi daha gösterilmiyor", ar: "أخرى غير معروضة" },
  none: { en: "None found — all clear.", tr: "Bulunamadı — her şey yolunda.", ar: "لا يوجد — كل شيء على ما يرام." },
  active: { en: "Active", tr: "Aktif", ar: "نشط" },
  delayed: { en: "Delayed", tr: "Geciken", ar: "متأخر" },
  completedLbl: { en: "Completed", tr: "Tamamlanan", ar: "مكتمل" },
  occurrences: { en: "occurrences", tr: "tekrar", ar: "تكرار" },
};

const SEVERITY_BADGE: Record<MarasAiSeverityTag, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  warning: "bg-orange-100 text-orange-700 border-orange-200",
  info: "bg-slate-100 text-slate-600 border-slate-200",
};

const ALERT_SEVERITY_BADGE: Record<string, string> = {
  critical: SEVERITY_BADGE.critical,
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  low: SEVERITY_BADGE.info,
};

interface MarasAiResponseViewProps {
  text: string;
  structured?: MarasAiStructuredResult[];
  lang: Language;
  /** Read-only navigation into existing Admin views — omit any the viewer's role can't use and the button never renders. */
  onOpenShipment?: (shipmentId: string) => void;
  onOpenTracking?: (shipmentId: string) => void;
  onOpenChat?: (shipmentId: string) => void;
}

function label(key: string, lang: Language): string {
  const entry = LABELS[key];
  return entry ? entry[lang] || entry.en : key;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function InlineNodes({ nodes }: { nodes: MarasAiInlineNode[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        if (n.kind === "bold") return <strong key={i} className="font-bold">{n.text}</strong>;
        if (n.kind === "code") return <code key={i} className="px-1 py-0.5 rounded bg-slate-100 text-[11px] font-mono">{n.text}</code>;
        if (n.kind === "link") {
          return (
            <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" className="text-orange-600 underline break-all">
              {n.text}
            </a>
          );
        }
        return <React.Fragment key={i}>{n.text}</React.Fragment>;
      })}
    </>
  );
}

/** The model's narrative, rendered from typed Markdown nodes — markers like ## and ** never appear visibly. */
function MarkdownText({ text }: { text: string }) {
  const blocks = React.useMemo(() => parseMarasAiMarkdown(text), [text]);
  return (
    <div className="space-y-2 min-w-0">
      {blocks.map((b, i) => {
        if (b.kind === "heading") {
          const cls = b.level === 1 ? "text-sm font-black" : b.level === 2 ? "text-[13px] font-extrabold" : "text-xs font-bold";
          return <p key={i} className={`${cls} text-slate-900 mt-1`}><InlineNodes nodes={b.children} /></p>;
        }
        if (b.kind === "list") {
          const ListTag = b.ordered ? "ol" : "ul";
          return (
            <ListTag key={i} className={`${b.ordered ? "list-decimal" : "list-disc"} ps-4 space-y-1`}>
              {b.items.map((item, j) => (
                <li key={j} className="leading-relaxed"><InlineNodes nodes={item} /></li>
              ))}
            </ListTag>
          );
        }
        return <p key={i} className="leading-relaxed"><InlineNodes nodes={b.children} /></p>;
      })}
    </div>
  );
}

function ShipmentCard({
  item, lang, onOpenShipment, onOpenTracking, onOpenChat,
}: { item: MarasAiShipmentCardItem; lang: Language } & Pick<MarasAiResponseViewProps, "onOpenShipment" | "onOpenTracking" | "onOpenChat">) {
  const statusLabel = getShipmentStatusLabel(item.status)[lang] || item.status;
  const hasId = !!item.id;
  const actionCls = "px-2 py-1 rounded-md border border-slate-200 bg-white hover:border-orange-300 hover:bg-orange-50 text-[10px] font-bold text-slate-600 cursor-pointer transition-all";
  return (
    <div className="p-2.5 rounded-lg border border-slate-200 bg-white space-y-1.5 min-w-0">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-black text-slate-900">{item.shipmentNumber}</span>
        <span className={`px-1.5 py-0.5 rounded border text-[9px] font-black uppercase tracking-wide ${SEVERITY_BADGE[item.severity]}`}>
          {statusLabel}
        </span>
      </div>
      {/* Origin → destination. The route line is pinned dir="ltr": mixed
          Latin city names + a neutral arrow form one bidi run, so inside
          an RTL drawer a flipped arrow would end up pointing at the
          ORIGIN. Forcing LTR keeps "origin → destination" unambiguous in
          every language. */}
      {(item.originCity || item.destinationCity) && (
        <div dir="ltr" className="text-[11px] font-semibold text-slate-600 text-start">
          {item.originCity || "?"} → {item.destinationCity || "?"}
        </div>
      )}
      <div className="text-[10px] text-slate-500 space-y-0.5">
        {item.driverName && <div>{label("driver", lang)}: <span className="font-semibold text-slate-700">{item.driverName}</span></div>}
        {item.companyName && <div>{label("customer", lang)}: <span className="font-semibold text-slate-700">{item.companyName}</span></div>}
        {item.updatedAt && <div>{label("updated", lang)}: {formatWhen(item.updatedAt)}</div>}
      </div>
      {item.reason && (
        <div className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-100 rounded px-1.5 py-1">{item.reason}</div>
      )}
      {hasId && (onOpenShipment || onOpenTracking || onOpenChat) && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {onOpenShipment && <button onClick={() => onOpenShipment(item.id)} className={actionCls}>{label("openShipment", lang)}</button>}
          {onOpenTracking && <button onClick={() => onOpenTracking(item.id)} className={actionCls}>{label("openTracking", lang)}</button>}
          {onOpenChat && <button onClick={() => onOpenChat(item.id)} className={actionCls}>{label("openChat", lang)}</button>}
        </div>
      )}
    </div>
  );
}

function StructuredResultView({
  result, lang, onOpenShipment, onOpenTracking, onOpenChat,
}: { result: MarasAiStructuredResult; lang: Language } & Pick<MarasAiResponseViewProps, "onOpenShipment" | "onOpenTracking" | "onOpenChat">) {
  const shown =
    result.responseType === "driver_performance" ? result.drivers.length :
    result.responseType === "monitoring_alerts" ? result.alerts.length :
    result.responseType === "audit_findings" ? result.findings.length :
    result.shipments.length;
  return (
    <div className="space-y-1.5 min-w-0">
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
        {label(result.responseType, lang)} · {result.totalCount}
      </div>
      {result.totalCount === 0 && (
        <div className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2 py-1.5">
          {label("none", lang)}
        </div>
      )}
      {result.responseType === "driver_performance" &&
        result.drivers.map((d, i) => (
          <div key={i} className="p-2.5 rounded-lg border border-slate-200 bg-white flex items-center justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <div className="text-xs font-black text-slate-900 truncate">{d.driverName}</div>
              {d.truckNumber && <div className="text-[10px] text-slate-400 font-mono">{d.truckNumber}</div>}
            </div>
            <div className="flex gap-2 text-[10px] font-bold shrink-0">
              <span className="text-slate-600">{label("active", lang)} {d.activeCount}</span>
              <span className={d.delayedCount > 0 ? "text-red-600" : "text-slate-400"}>{label("delayed", lang)} {d.delayedCount}</span>
              <span className="text-emerald-600">{label("completedLbl", lang)} {d.completedCount}</span>
            </div>
          </div>
        ))}
      {result.responseType === "monitoring_alerts" &&
        result.alerts.map((a, i) => (
          <div key={i} className="p-2.5 rounded-lg border border-slate-200 bg-white space-y-1 min-w-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs font-bold text-slate-900">{a.title}</span>
              <span className={`px-1.5 py-0.5 rounded border text-[9px] font-black uppercase ${ALERT_SEVERITY_BADGE[a.severity] || SEVERITY_BADGE.info}`}>
                {a.severity}
              </span>
            </div>
            <div className="text-[10px] text-slate-500 break-words">{a.area} · {a.count} {label("occurrences", lang)} · {formatWhen(a.time)}</div>
            <div className="text-[10px] text-slate-600">{a.suggestedAction}</div>
          </div>
        ))}
      {result.responseType === "audit_findings" &&
        result.findings.map((f, i) => (
          <div key={i} className="p-2.5 rounded-lg border border-slate-200 bg-white space-y-1 min-w-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs font-bold text-slate-900">{f.title}</span>
              <span className={`px-1.5 py-0.5 rounded border text-[9px] font-black uppercase ${ALERT_SEVERITY_BADGE[f.severity] || SEVERITY_BADGE.info}`}>
                {f.severity}
              </span>
            </div>
            <div className="text-[10px] text-slate-500 break-words">
              <span className="font-mono">{f.ruleId}</span> · {f.recordRef} · x{f.occurrenceCount}
            </div>
            {/* Recommended Priority — server-computed, deterministic; the
                card only displays what the engine assigned. */}
            {f.priorityLabel && (
              <div className="text-[10px] font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded px-1.5 py-1">
                {f.priorityLabel}{f.responseTarget ? ` · ${f.responseTarget}` : ""}
              </div>
            )}
            <div className="text-[10px] text-slate-600">{f.evidence}</div>
            <div className="text-[10px] text-slate-500">{f.recommendedAction}</div>
            {f.recordType === "shipment" && f.recordId && onOpenShipment && (
              <button
                onClick={() => onOpenShipment(f.recordId)}
                className="px-2 py-1 rounded-md border border-slate-200 bg-white hover:border-orange-300 hover:bg-orange-50 text-[10px] font-bold text-slate-600 cursor-pointer transition-all"
              >
                {label("openShipment", lang)}
              </button>
            )}
          </div>
        ))}
      {(result.responseType === "delayed_shipments" ||
        result.responseType === "shipments_overview" ||
        result.responseType === "missing_documents" ||
        result.responseType === "operational_risks") &&
        result.shipments.map((s) => (
          <ShipmentCard key={s.id} item={s} lang={lang} onOpenShipment={onOpenShipment} onOpenTracking={onOpenTracking} onOpenChat={onOpenChat} />
        ))}
      {result.totalCount > shown && (
        <div className="text-[10px] text-slate-400 font-semibold">+{result.totalCount - shown} {label("more", lang)}</div>
      )}
    </div>
  );
}

export default function MarasAiResponseView({ text, structured, lang, onOpenShipment, onOpenTracking, onOpenChat }: MarasAiResponseViewProps) {
  const results = Array.isArray(structured) ? structured : [];
  return (
    <div className="space-y-2.5 min-w-0">
      {results.map((r, i) => (
        <StructuredResultView key={i} result={r} lang={lang} onOpenShipment={onOpenShipment} onOpenTracking={onOpenTracking} onOpenChat={onOpenChat} />
      ))}
      {text && <MarkdownText text={text} />}
    </div>
  );
}
