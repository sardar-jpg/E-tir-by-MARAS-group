import { useEffect, useRef, useState } from "react";
import { X, Pause, Play } from "lucide-react";
import type { Language } from "../../../types";

/**
 * OperatorRoomOverlay — the chrome of the Operator Room, a dedicated
 * READ-ONLY monitoring mode for the MARAS operations television (viewed
 * from ~3–5 m). It is NOT a fullscreen trigger: TrackingMap switches into a
 * dedicated layout (map dominant, panel/drawer/filters hidden) and renders
 * this overlay on top of the SAME live map, data, permissions and polling.
 *
 * Strictly presentational and read-only by construction:
 *  - no data fetching, no ETA calls, no chat, no editing controls — every
 *    value arrives pre-derived from TrackingMap's existing honest state;
 *  - a full-area click-capture layer sits over the map so the only
 *    interactions are pause/resume (click) and Exit (button / Escape);
 *  - the wall clock and "last updated" age are real times, and the
 *    live/stale pill is derived from the actual age of the last data
 *    refresh — nothing is fabricated.
 *
 * TV affordances: large high-contrast type, cursor auto-hide after
 * inactivity, and navigator.wakeLock (best-effort, silently degraded where
 * unsupported).
 */

const L = {
  en: { title: "Operator Room", live: "LIVE", stale: "STALE", exit: "Exit", paused: "Paused — click to resume", updated: "Last update" },
  tr: { title: "Operasyon Odası", live: "CANLI", stale: "ESKİ", exit: "Çık", paused: "Duraklatıldı — devam için tıklayın", updated: "Son güncelleme" },
  ar: { title: "غرفة العمليات", live: "مباشر", stale: "قديم", exit: "خروج", paused: "متوقف مؤقتاً — انقر للمتابعة", updated: "آخر تحديث" },
} as const;

/** Data refreshed within this window counts as a live feed on the ribbon. */
const LIVE_THRESHOLD_MS = 45000;

export interface OperatorKpi {
  label: string;
  value: number;
  tone: string; // tailwind text-* class for the value
}

export interface OperatorFocus {
  shipmentNumber: string;
  route: string;
  stateLabel: string;
  stateTone: string; // tailwind text-* class
  lastUpdate: string;
  status: string;
}

export default function OperatorRoomOverlay({
  lang,
  lastDataAt,
  kpis,
  focus,
  paused,
  onTogglePause,
  onExit,
}: {
  lang: Language;
  lastDataAt: Date;
  kpis: OperatorKpi[];
  focus: OperatorFocus | null;
  paused: boolean;
  onTogglePause: () => void;
  onExit: () => void;
}) {
  const t = L[lang] || L.en;

  // Real wall clock + data-age tick (display only).
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const dataAgeMs = now.getTime() - lastDataAt.getTime();
  const isLive = dataAgeMs < LIVE_THRESHOLD_MS;
  const ageSec = Math.max(0, Math.round(dataAgeMs / 1000));

  // Escape leaves the Operator Room.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onExit(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  // Cursor auto-hide after 3s of inactivity.
  const [cursorHidden, setCursorHidden] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const bump = () => {
      setCursorHidden(false);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => setCursorHidden(true), 3000);
    };
    bump();
    window.addEventListener("mousemove", bump);
    return () => {
      window.removeEventListener("mousemove", bump);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, []);

  // Keep the TV awake while the room is open (best-effort; re-acquire when
  // the tab becomes visible again; graceful no-op where unsupported).
  useEffect(() => {
    let lock: { release?: () => Promise<void> } | null = null;
    let disposed = false;
    const acquire = async () => {
      try {
        const wl = (navigator as any).wakeLock;
        if (wl?.request) {
          lock = await wl.request("screen");
        }
      } catch {
        /* unsupported or denied — screen-saver settings apply */
      }
    };
    const onVisibility = () => { if (document.visibilityState === "visible" && !disposed) acquire(); };
    acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      lock?.release?.().catch(() => {});
    };
  }, []);

  return (
    <div className={`fixed inset-0 z-40 pointer-events-none ${cursorHidden ? "cursor-none" : ""}`}>
      {/* Click-capture layer over the map: the ONLY map-area interaction in
          the Operator Room is pausing/resuming the auto-cycle. It blocks
          marker/control clicks, guaranteeing the mode stays read-only. */}
      <div className="absolute inset-0 pointer-events-auto" onClick={onTogglePause} />

      {/* Status ribbon */}
      <div className="absolute top-0 inset-x-0 pointer-events-auto bg-slate-950/90 backdrop-blur-sm border-b border-slate-800 px-6 py-3 flex items-center gap-6">
        <h2 className="text-xl font-black text-white tracking-tight shrink-0">{t.title}</h2>
        <span className={`shrink-0 inline-flex items-center gap-2 rounded-lg px-3 py-1 text-sm font-black tracking-widest ${isLive ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" : "bg-amber-500/15 text-amber-400 border border-amber-500/30"}`}>
          <span className={`w-2.5 h-2.5 rounded-full inline-block ${isLive ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`}></span>
          {isLive ? t.live : t.stale}
        </span>
        <span className="text-slate-400 text-sm font-mono shrink-0">
          {t.updated}: {lastDataAt.toLocaleTimeString()} ({ageSec}s)
        </span>
        <span className="flex-1" />
        <span className="text-3xl font-black text-white font-mono tabular-nums shrink-0" dir="ltr">{now.toLocaleTimeString()}</span>
        <button
          onClick={onExit}
          className="shrink-0 inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white text-base font-bold px-4 py-2 rounded-xl transition-all cursor-pointer"
        >
          <X className="w-5 h-5" />
          {t.exit}
        </button>
      </div>

      {/* KPI strip — the six existing honest counts, TV-scale */}
      <div className="absolute top-[64px] inset-x-0 pointer-events-none px-6 pt-3">
        <div className="grid grid-cols-6 gap-3">
          {kpis.map(k => (
            <div key={k.label} className="bg-slate-950/85 backdrop-blur-sm border border-slate-800 rounded-xl px-4 py-2.5 text-center">
              <p className="text-[13px] font-bold text-slate-400 truncate">{k.label}</p>
              <p className={`text-4xl font-black tabular-nums leading-tight ${k.tone}`}>{k.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Paused indicator */}
      {paused && (
        <div className="absolute top-1/2 inset-x-0 -translate-y-1/2 flex justify-center pointer-events-none">
          <span className="inline-flex items-center gap-2 bg-slate-950/85 border border-slate-700 text-slate-200 text-lg font-bold px-5 py-2.5 rounded-2xl">
            <Pause className="w-5 h-5" /> {t.paused}
          </span>
        </div>
      )}

      {/* Focused-shipment caption — large, real data only */}
      {focus && (
        <div className="absolute bottom-6 inset-x-0 flex justify-center pointer-events-none px-6">
          <div className="bg-slate-950/90 backdrop-blur-sm border border-slate-700 rounded-2xl px-8 py-4 flex items-center gap-8 max-w-full">
            <span className="font-mono text-3xl font-black text-blue-400 shrink-0">{focus.shipmentNumber}</span>
            <span className="text-2xl font-bold text-white truncate">{focus.route}</span>
            <span className={`text-2xl font-black shrink-0 ${focus.stateTone}`}>{focus.stateLabel}</span>
            <span className="text-lg font-semibold text-slate-400 shrink-0">{focus.lastUpdate}</span>
            <span className="text-lg font-bold text-slate-300 border border-slate-700 rounded-lg px-3 py-1 shrink-0">{focus.status}</span>
            {!paused && <Play className="w-5 h-5 text-emerald-500 shrink-0" />}
          </div>
        </div>
      )}
    </div>
  );
}
