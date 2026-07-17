/**
 * driverUi.ts — tiny shared presentation helpers for the redesigned
 * Driver App screens. Status labels come from the same
 * SHIPMENT_STATUS_LABELS map the server writes timeline entries with, so
 * a driver always reads the identical wording in their own language;
 * chip styling keys off the driver job group (driverJobFlow.ts), and the
 * chip always carries the text label too — color is never the only
 * signal.
 */
import type { Language, ShipmentStatus } from "../../types";
import { getShipmentStatusLabel, isShipmentClosed } from "../../lib/shipmentStatusTransitions";
import { getDriverJobGroup } from "../../lib/driverJobFlow";

export function localizeShipmentStatus(status: ShipmentStatus, lang: Language): string {
  const label = getShipmentStatusLabel(status);
  return label[lang] ?? label.en;
}

/**
 * Chip classes per job phase — distinct hues for waiting / underway /
 * delivered / closed, always paired with the translated status text.
 */
export function getStatusChipClasses(status: ShipmentStatus, freightType?: string | null): string {
  if (isShipmentClosed(status, freightType)) {
    return "bg-slate-800 text-slate-300 border-slate-700";
  }
  const group = getDriverJobGroup(status, freightType);
  if (group === "completed") {
    // Delivered (not yet closed): success green.
    return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
  }
  if (group === "upcoming") {
    return "bg-amber-500/10 text-amber-400 border-amber-500/30";
  }
  return "bg-sky-500/10 text-sky-400 border-sky-500/30";
}

/** Freight mode label, localized (Land is the driver's normal world). */
export function localizeFreightType(freightType: string | null | undefined, lang: Language): string {
  const key = freightType === "sea" ? "sea" : freightType === "air" ? "air" : "land";
  const labels: Record<string, Record<Language, string>> = {
    land: { en: "Land", tr: "Kara", ar: "بري" },
    sea: { en: "Sea", tr: "Deniz", ar: "بحري" },
    air: { en: "Air", tr: "Hava", ar: "جوي" },
  };
  return labels[key][lang] ?? labels[key].en;
}

// ── Shared visual tokens (UI polish pass) ───────────────────────────
//
// One place for the Driver App's card, button, and title styling so all
// four sections (Home / Job / Chat / Profile) stay visually identical:
// same radius, same borders, same touch-target heights, same primary
// orange. Purely presentational — no behavior, data, or layout-direction
// logic lives here (RTL comes from logical utilities at the call sites).

/** Screen-level title — identical size/weight on every section. */
export const SCREEN_TITLE = "text-2xl font-bold text-white text-start";

/** Major card surface. */
export const CARD = "bg-slate-900 border border-slate-800 rounded-3xl";

/** Sunken inner surface used inside a CARD. */
export const INNER_CARD = "bg-slate-950 border border-slate-800 rounded-2xl";

/**
 * The ONE primary action per screen: large, orange, glove-friendly.
 * Callers add sizing context (w-full etc.); min height is baked in so a
 * primary action can never shrink below a comfortable touch target.
 */
export const BTN_PRIMARY =
  "min-h-[60px] rounded-2xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-lg flex items-center justify-center gap-2 shadow-[0_6px_18px_rgba(249,115,22,0.35)] transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50 light-preserve";

/** Secondary actions — quiet dark buttons, still ≥52px touch targets. */
export const BTN_SECONDARY =
  "min-h-[52px] rounded-2xl bg-slate-950 border border-slate-800 hover:border-slate-600 text-slate-200 font-bold text-sm flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer disabled:opacity-50";
