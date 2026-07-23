import type { ComponentType } from "react";

export type KpiTone = "blue" | "rose" | "amber" | "emerald" | "indigo" | "orange" | "slate";

const TONE: Record<KpiTone, { icon: string; bar: string; stroke: string }> = {
  blue: { icon: "bg-blue-50 text-blue-600", bar: "bg-blue-500", stroke: "#2563eb" },
  rose: { icon: "bg-rose-50 text-rose-600", bar: "bg-rose-500", stroke: "#e11d48" },
  amber: { icon: "bg-amber-50 text-amber-600", bar: "bg-amber-500", stroke: "#d97706" },
  emerald: { icon: "bg-emerald-50 text-emerald-600", bar: "bg-emerald-500", stroke: "#059669" },
  indigo: { icon: "bg-indigo-50 text-indigo-600", bar: "bg-indigo-500", stroke: "#4f46e5" },
  orange: { icon: "bg-orange-50 text-orange-600", bar: "bg-orange-500", stroke: "#ea580c" },
  slate: { icon: "bg-slate-100 text-slate-600", bar: "bg-slate-400", stroke: "#64748b" },
};

/** Tiny inline SVG sparkline — only ever rendered with REAL series data. */
function Sparkline({ data, stroke }: { data: number[]; stroke: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = max - min || 1;
  const w = 100;
  const h = 28;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-7 w-full" aria-hidden="true">
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * One compact, equal-height KPI card: label, main value, small supporting
 * text, a semantic icon, and EITHER a real sparkline or a progress bar
 * (never a fabricated trend). Becomes a button when `onClick` is provided,
 * with a tooltip and keyboard focus.
 */
export default function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  sparkline,
  progress,
  onClick,
  title,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: ComponentType<{ className?: string }>;
  tone: KpiTone;
  sparkline?: number[];
  progress?: { value: number; label?: string };
  onClick?: () => void;
  title?: string;
}) {
  const toneCfg = TONE[tone];
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 truncate">{label}</p>
          <p className="mt-1 text-3xl font-black leading-none text-slate-900 tabular-nums">{value}</p>
        </div>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${toneCfg.icon}`}>
          <Icon className="h-4.5 w-4.5" />
        </span>
      </div>
      {hint && <p className="mt-2 text-[11px] font-semibold text-slate-500 truncate">{hint}</p>}
      <div className="mt-auto pt-3">
        {progress ? (
          <div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${toneCfg.bar}`} style={{ width: `${Math.max(0, Math.min(100, progress.value))}%` }} />
            </div>
            {progress.label && <p className="mt-1 text-[10px] font-medium text-slate-400">{progress.label}</p>}
          </div>
        ) : sparkline && sparkline.length >= 2 ? (
          <Sparkline data={sparkline} stroke={toneCfg.stroke} />
        ) : (
          <div className="h-7" />
        )}
      </div>
    </>
  );

  const base = "flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 text-start shadow-sm transition-all";
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title} className={`${base} hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400`}>
        {inner}
      </button>
    );
  }
  return <div className={base} title={title}>{inner}</div>;
}
