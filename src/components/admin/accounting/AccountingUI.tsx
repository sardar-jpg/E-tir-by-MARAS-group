import type { ComponentType, ReactNode } from "react";
import type { Language } from "../../../types";

/**
 * Shared building blocks for the Accounting module pages — a small, consistent
 * ERP design system (clean white cards, generous whitespace, rounded-2xl,
 * professional tables) reused by the Dashboard and the Statement pages so every
 * accounting screen looks like one product.
 */
export const money = (v: number, opts: { decimals?: number } = {}): string =>
  (Number.isFinite(v) ? v : 0).toLocaleString(undefined, { minimumFractionDigits: opts.decimals ?? 2, maximumFractionDigits: opts.decimals ?? 2 });

export const pick = <T extends { en: string; tr: string; ar: string }>(l: T, lang: Language): string => l[lang] || l.en;

/** Page header: title + subtitle on the left, actions on the right. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <h1 className="text-[20px] sm:text-[24px] font-black text-slate-900 tracking-tight leading-tight">{title}</h1>
        {subtitle && <p className="text-[12.5px] text-slate-500 mt-1 max-w-2xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
    </div>
  );
}

const KPI_TONE: Record<string, { ring: string; icon: string }> = {
  blue: { ring: "bg-blue-50 text-blue-600", icon: "text-blue-600" },
  emerald: { ring: "bg-emerald-50 text-emerald-600", icon: "text-emerald-600" },
  amber: { ring: "bg-amber-50 text-amber-600", icon: "text-amber-600" },
  violet: { ring: "bg-violet-50 text-violet-600", icon: "text-violet-600" },
  slate: { ring: "bg-slate-100 text-slate-600", icon: "text-slate-600" },
  red: { ring: "bg-red-50 text-red-600", icon: "text-red-600" },
};

/** Executive KPI card: icon chip, label, big value, optional sub / trend line. */
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
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-slate-300 transition-all">
      <div className="flex items-center gap-2.5">
        <span className={`w-9 h-9 rounded-xl ${t.ring} flex items-center justify-center shrink-0`}><Icon className="w-[18px] h-[18px]" /></span>
        <span className="text-[11px] font-black uppercase tracking-wide text-slate-400 leading-tight">{label}</span>
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="text-[26px] font-black text-slate-900 tracking-tight tabular-nums leading-none">{value}</span>
        {unit && <span className="text-[12px] font-bold text-slate-400">{unit}</span>}
      </div>
      {sub && <div className={`mt-2 text-[11.5px] font-bold ${subCls}`}>{sub}</div>}
    </div>
  );
}

/** Framed content card with an optional titled header + action. */
export function Panel({ title, action, children, className = "", bodyClassName = "" }: { title?: string; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
          {title && <h2 className="text-[14px] font-black text-slate-800">{title}</h2>}
          {action}
        </div>
      )}
      <div className={bodyClassName || "p-5"}>{children}</div>
    </section>
  );
}

const PILL: Record<string, string> = {
  paid: "bg-emerald-100 text-emerald-700", issued: "bg-blue-100 text-blue-700",
  partial: "bg-amber-100 text-amber-700", unpaid: "bg-red-100 text-red-700",
  draft: "bg-slate-100 text-slate-600", approved: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700", completed: "bg-emerald-100 text-emerald-700",
};
export function StatusPill({ label, kind }: { label: string; kind: keyof typeof PILL | string }) {
  return <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-[10.5px] font-black uppercase tracking-wide ${PILL[kind] || PILL.draft}`}>{label}</span>;
}

/** Secondary / primary buttons with a consistent look. */
export const btnGhost = "inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50 text-[12.5px] font-bold rounded-lg cursor-pointer transition-all";
export const btnPrimary = "inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-[12.5px] font-bold rounded-lg cursor-pointer border-0 transition-all";
export const inputCls = "w-full text-[13px] border border-slate-300 rounded-lg px-3 py-2 bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition";

export function EmptyState({ icon: Icon, title, body }: { icon: ComponentType<{ className?: string }>; title: string; body?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-12 text-center">
      <Icon className="w-9 h-9 text-slate-300 mx-auto" />
      <p className="mt-3 text-[14px] font-bold text-slate-600">{title}</p>
      {body && <p className="mt-1 text-[12.5px] text-slate-400 max-w-sm mx-auto">{body}</p>}
    </div>
  );
}
