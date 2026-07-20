import type { ComponentType, ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Language } from "../../../types";

/**
 * Shared building blocks for the Accounting module — a small, consistent
 * enterprise design system (calm neutral surfaces, generous whitespace,
 * restrained semantic colour, tabular figures, professional tables) reused by
 * the Dashboard and the Statement pages so every accounting screen reads as
 * one product. Presentation only — no figure here is ever computed; the pages
 * pass server-authoritative values straight through.
 */
export const money = (v: number, opts: { decimals?: number } = {}): string =>
  (Number.isFinite(v) ? v : 0).toLocaleString(undefined, { minimumFractionDigits: opts.decimals ?? 2, maximumFractionDigits: opts.decimals ?? 2 });

export const pick = <T extends { en: string; tr: string; ar: string }>(l: T, lang: Language): string => l[lang] || l.en;

/* Shared surface token — one definition so every card matches exactly. */
export const CARD = "rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

/** Page header: title + subtitle on the left, actions on the right. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        <h1 className="text-[21px] sm:text-[26px] font-bold text-slate-900 tracking-[-0.02em] leading-tight">{title}</h1>
        {subtitle && <p className="text-[13px] text-slate-500 mt-1.5 max-w-2xl leading-relaxed">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
    </div>
  );
}

const KPI_TONE: Record<string, { chip: string; bar: string }> = {
  blue: { chip: "bg-blue-50 text-blue-600", bar: "bg-blue-500" },
  emerald: { chip: "bg-emerald-50 text-emerald-600", bar: "bg-emerald-500" },
  amber: { chip: "bg-amber-50 text-amber-600", bar: "bg-amber-500" },
  slate: { chip: "bg-slate-100 text-slate-500", bar: "bg-slate-300" },
  red: { chip: "bg-red-50 text-red-600", bar: "bg-red-500" },
};

/** Executive KPI card: label + icon chip, big value, optional sub / trend line. */
export function KpiCard({ icon: Icon, tone = "slate", label, value, unit, sub, subTone }: {
  icon: ComponentType<{ className?: string }>;
  tone?: keyof typeof KPI_TONE;
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  subTone?: "up" | "down" | "muted" | "warn";
}) {
  const t = KPI_TONE[tone] || KPI_TONE.slate;
  const subCls = subTone === "up" ? "text-emerald-600" : subTone === "down" ? "text-red-600" : subTone === "warn" ? "text-amber-600" : "text-slate-400";
  return (
    <div className={`group relative overflow-hidden ${CARD} p-4 hover:border-slate-300 hover:shadow-[0_2px_8px_rgba(15,23,42,0.06)] transition-all`}>
      <span className={`absolute inset-x-0 top-0 h-[3px] ${t.bar} opacity-0 group-hover:opacity-100 transition-opacity`} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 leading-tight">{label}</span>
        <span className={`w-8 h-8 rounded-lg ${t.chip} flex items-center justify-center shrink-0`}><Icon className="w-[17px] h-[17px]" /></span>
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="text-[25px] font-bold text-slate-900 tracking-[-0.02em] tabular-nums leading-none">{value}</span>
        {unit && <span className="text-[12px] font-semibold text-slate-400">{unit}</span>}
      </div>
      {sub && <div className={`mt-2 text-[11.5px] font-semibold ${subCls}`}>{sub}</div>}
    </div>
  );
}

/** Framed content card with an optional titled header + action. */
export function Panel({ title, subtitle, action, children, className = "", bodyClassName = "" }: { title?: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={`${CARD} ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-100">
          <div className="min-w-0">
            {title && <h2 className="text-[13.5px] font-bold text-slate-800 tracking-[-0.01em]">{title}</h2>}
            {subtitle && <p className="text-[11.5px] text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={bodyClassName || "p-5"}>{children}</div>
    </section>
  );
}

const PILL: Record<string, string> = {
  paid: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", issued: "bg-blue-50 text-blue-700 ring-blue-600/20",
  partial: "bg-amber-50 text-amber-700 ring-amber-600/20", unpaid: "bg-red-50 text-red-700 ring-red-600/20",
  draft: "bg-slate-100 text-slate-600 ring-slate-500/20", approved: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  pending: "bg-amber-50 text-amber-700 ring-amber-600/20", completed: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
};
export function StatusPill({ label, kind }: { label: string; kind: keyof typeof PILL | string }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10.5px] font-semibold uppercase tracking-wide ring-1 ring-inset ${PILL[kind] || PILL.draft}`}>{label}</span>;
}

/** Secondary / primary buttons + inputs with a consistent, restrained look. */
export const btnGhost = "inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50 text-[12.5px] font-semibold rounded-lg cursor-pointer transition-all";
export const btnPrimary = "inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-[12.5px] font-semibold rounded-lg cursor-pointer border-0 transition-all";
export const inputCls = "w-full text-[13px] border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-800 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition placeholder:text-slate-400";

export function EmptyState({ icon: Icon, title, body }: { icon: ComponentType<{ className?: string }>; title: string; body?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-14 text-center">
      <span className="inline-flex w-11 h-11 rounded-full bg-white border border-slate-200 items-center justify-center"><Icon className="w-5 h-5 text-slate-300" /></span>
      <p className="mt-3 text-[14px] font-semibold text-slate-600">{title}</p>
      {body && <p className="mt-1 text-[12.5px] text-slate-400 max-w-sm mx-auto">{body}</p>}
    </div>
  );
}

/* ── Statement summary header ─────────────────────────────────────────────
 * A prominent identity + balances band for the Customer / Vendor statement
 * pages: entity name, an ID chip, a headline current balance, and a compact
 * row of debit / credit / closing figures. Pure presentation of values the
 * server already computed. */
export interface StatCell { label: string; value: string; unit?: string; tone?: "neutral" | "debit" | "credit" | "strong" }

export function StatementSummaryHeader({ icon: Icon, name, idLabel, idValue, headline, cells }: {
  icon: ComponentType<{ className?: string }>;
  name: string;
  idLabel: string;
  idValue: string;
  headline: { label: string; value: string; unit?: string; hint?: string };
  cells: StatCell[];
}) {
  const cellTone = (t?: StatCell["tone"]) => t === "credit" ? "text-emerald-700" : t === "strong" ? "text-slate-900" : "text-slate-800";
  return (
    <section className={`${CARD} overflow-hidden`}>
      <div className="p-5 flex flex-col lg:flex-row lg:items-center gap-5">
        {/* Identity */}
        <div className="flex items-center gap-3.5 min-w-0 lg:w-80 shrink-0">
          <span className="w-12 h-12 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0 shadow-sm"><Icon className="w-6 h-6" /></span>
          <div className="min-w-0">
            <p className="text-[16px] font-bold text-slate-900 tracking-[-0.01em] leading-snug line-clamp-2" title={name}>{name}</p>
            <p className="text-[11.5px] text-slate-400 font-medium mt-1">
              <span className="uppercase tracking-wide">{idLabel}</span>{" "}
              <span className="font-mono text-slate-500">{idValue}</span>
            </p>
          </div>
        </div>
        {/* Headline balance */}
        <div className="lg:border-l lg:border-slate-100 lg:pl-5 shrink-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">{headline.label}</p>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-[28px] font-bold text-slate-900 tabular-nums tracking-[-0.02em] leading-none">{headline.value}</span>
            {headline.unit && <span className="text-[13px] font-semibold text-slate-400">{headline.unit}</span>}
          </div>
          {headline.hint && <p className="mt-1.5 text-[11px] font-medium text-slate-400">{headline.hint}</p>}
        </div>
        {/* Figures */}
        <div className="grid grid-cols-3 gap-3 flex-1 lg:border-l lg:border-slate-100 lg:pl-5">
          {cells.map((c) => (
            <div key={c.label} className="min-w-0">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-slate-400 truncate">{c.label}</p>
              <div className="mt-1 flex items-baseline gap-1">
                <span className={`text-[16px] font-bold tabular-nums tracking-[-0.01em] ${cellTone(c.tone)}`}>{c.value}</span>
                {c.unit && <span className="text-[10.5px] font-semibold text-slate-400">{c.unit}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Compact table pagination — page window + prev/next, purely client-side. */
export function Pagination({ page, pageCount, total, from, to, labels, onPrev, onNext }: {
  page: number; pageCount: number; total: number; from: number; to: number;
  labels: { showing: string; of: string; page: string };
  onPrev: () => void; onNext: () => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-100 flex-wrap">
      <p className="text-[11.5px] text-slate-400 font-medium tabular-nums">
        {labels.showing} <span className="text-slate-600 font-semibold">{from}–{to}</span> {labels.of} <span className="text-slate-600 font-semibold">{total}</span>
      </p>
      <div className="flex items-center gap-1.5">
        <button onClick={onPrev} disabled={page <= 1} className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-all bg-white"><ChevronLeft className="w-4 h-4" /></button>
        <span className="text-[11.5px] text-slate-500 font-semibold tabular-nums px-1">{labels.page} {page} / {pageCount}</span>
        <button onClick={onNext} disabled={page >= pageCount} className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-all bg-white"><ChevronRight className="w-4 h-4" /></button>
      </div>
    </div>
  );
}
