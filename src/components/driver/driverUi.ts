/**
 * driverUi.ts — the Driver App Design System ("MARAS Cockpit").
 *
 * ONE module defines the complete visual language for every driver
 * screen: surfaces, typography, buttons, chips, list rows, status
 * presentation, and journey progress. Purely presentational — no
 * behavior, data, or layout-direction logic lives here (RTL comes from
 * logical utilities at the call sites; the light theme comes from the
 * existing .theme-light slate-class remapping in index.css, which is
 * why every token stays inside the slate-* class family).
 *
 * Depth model — tone, not borders:
 *   CANVAS  (slate-950)  the screen background
 *   SURFACE (slate-900)  cards, one tonal step up, hairline border
 *   HERO    (slate-900+) the ONE most important card per screen —
 *                        brighter border + ambient shadow
 *   INSET   (slate-950)  wells and fields inside a card, one step down
 *
 * Color discipline:
 *   Orange is reserved for exactly two things — the primary action and
 *   the active navigation item. Everything else is tonal slate, with a
 *   small semantic set for status: amber = the driver's answer is
 *   needed, sky = in motion, emerald = done, slate = closed/idle.
 *   Money and route cities are white display type — the value is the
 *   emphasis, never a color.
 *
 * Status labels come from the same SHIPMENT_STATUS_LABELS map the
 * server writes timeline entries with, so a driver always reads the
 * identical wording in their own language.
 */
import type { Language, ShipmentStatus } from "../../types";
import {
  getShipmentStatusLabel,
  getStatusSequenceForFreightMode,
  isShipmentClosed,
  resolveFreightMode,
} from "../../lib/shipmentStatusTransitions";
import { getDriverJobGroup } from "../../lib/driverJobFlow";

export function localizeShipmentStatus(status: ShipmentStatus, lang: Language): string {
  const label = getShipmentStatusLabel(status);
  return label[lang] ?? label.en;
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

// ── Status presentation ──────────────────────────────────────────────

/**
 * Chip classes per job phase — distinct hues for waiting / underway /
 * delivered / closed, always paired with the translated status text
 * (color is never the only signal).
 */
export function getStatusChipClasses(status: ShipmentStatus, freightType?: string | null): string {
  if (isShipmentClosed(status, freightType)) {
    return "bg-slate-800/80 text-slate-400 border-slate-700/60";
  }
  const group = getDriverJobGroup(status, freightType);
  if (group === "completed") {
    return "bg-emerald-500/10 text-emerald-400 border-emerald-500/25";
  }
  if (group === "upcoming") {
    return "bg-amber-500/10 text-amber-400 border-amber-500/25";
  }
  return "bg-sky-500/10 text-sky-400 border-sky-500/25";
}

/**
 * Stage rail — a colored logical-start edge on the hero card that makes
 * the job's phase readable from across the cab. Same amber/sky/emerald/
 * slate semantics as the chip; border-s flips sides automatically under
 * RTL.
 */
export function getStatusRailClasses(status: ShipmentStatus, freightType?: string | null): string {
  if (isShipmentClosed(status, freightType)) return "border-s-4 border-s-slate-600";
  const group = getDriverJobGroup(status, freightType);
  if (group === "completed") return "border-s-4 border-s-emerald-500";
  if (group === "upcoming") return "border-s-4 border-s-amber-400";
  return "border-s-4 border-s-sky-400";
}

/**
 * Journey position for the stage-dot row: how far through its own
 * freight-mode sequence this status sits. Derived from the existing
 * authoritative sequences — presentation only. Statuses outside the
 * sequence (a driver never holds one) report position 0.
 */
export function getJourneyProgress(
  status: ShipmentStatus,
  freightType?: string | null
): { index: number; total: number } {
  const sequence = getStatusSequenceForFreightMode(resolveFreightMode(freightType));
  const index = sequence.indexOf(status);
  return { index: index < 0 ? 0 : index, total: sequence.length };
}

// ── Surfaces ─────────────────────────────────────────────────────────

/** Card — one tonal step above the canvas, hairline border. */
export const CARD = "bg-slate-900 border border-slate-800/60 rounded-3xl";

/** Hero — the ONE most important card on a screen. */
export const HERO_CARD =
  "bg-slate-900 border border-slate-700/50 rounded-3xl shadow-[0_18px_50px_-16px_rgba(0,0,0,0.7)]";

/** Inset well inside a card — one tonal step down, borderless. */
export const INNER_CARD = "bg-slate-950 rounded-2xl";

/** Legacy alias kept for the few nested surfaces that still want a faint edge. */
export const INNER_CARD_EDGED = "bg-slate-950 border border-slate-800/60 rounded-2xl";

// ── Typography system ────────────────────────────────────────────────
//
// The complete named scale. Weight is used intelligently: extrabold is
// reserved for the two display levels (payment, route cities), bold for
// titles and data values, semibold for headings/labels, regular for
// body. Numerals are always tabular where figures appear. Under Arabic
// RTL the shell swaps to IBM Plex Sans Arabic and neutralizes the
// Latin-only tight tracking (see index.css).
//
//   DISPLAY_XL  32  payment figure
//   DISPLAY_L   26  route cities
//   TITLE       22  screen titles
//   HEADING     15  card headings (semibold)
//   BODY        15  body copy (regular)
//   BODY_SM     13  secondary body / section labels
//   CAPTION     12  captions and helper lines
//   METADATA    11  chips, references, unit labels

/** Display XL — the payment figure. */
export const TYPE_DISPLAY_XL = "text-[32px] leading-9 font-extrabold text-white tracking-tight tabular-nums";

/** Display L — route cities. */
export const TYPE_DISPLAY = "text-[26px] leading-8 font-extrabold text-white tracking-tight tabular-nums";

/** Screen title — identical on every section. */
export const SCREEN_TITLE = "text-[22px] leading-7 font-bold text-white text-start tracking-tight";

/** Card heading — semibold, never shouts. */
export const TYPE_HEADING = "text-[15px] font-semibold text-slate-100";

/** Body. */
export const TYPE_BODY = "text-[15px] text-slate-300";

/** Section label above a group of cards/rows. */
export const SECTION_LABEL = "text-[13px] font-semibold text-slate-400 text-start";

/** Caption / helper line. */
export const TYPE_CAPTION = "text-xs text-slate-500";

/** Metadata — references, units, chips. */
export const TYPE_METADATA = "text-[11px] font-semibold text-slate-500 tabular-nums";

// ── Buttons — exactly four recipes ───────────────────────────────────

/** THE primary action: large, orange, glove-friendly. Add w-full/context at the call site. */
export const BTN_PRIMARY =
  "min-h-[60px] rounded-2xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-lg flex items-center justify-center gap-2 shadow-[0_10px_28px_-8px_rgba(249,115,22,0.55)] transition-all duration-150 active:scale-[0.98] cursor-pointer disabled:opacity-50 light-preserve";

/** Secondary — quiet tonal button, still ≥52px. */
export const BTN_SECONDARY =
  "min-h-[52px] rounded-2xl bg-slate-950 border border-slate-800/60 hover:border-slate-600 text-slate-200 font-bold text-sm flex items-center justify-center gap-1.5 transition-all duration-150 active:scale-95 cursor-pointer disabled:opacity-50";

/** Danger — decline/reject confirm actions. */
export const BTN_DANGER =
  "min-h-[52px] rounded-2xl bg-slate-950 border border-red-500/30 hover:border-red-500/60 text-red-400 font-bold text-sm flex items-center justify-center gap-1.5 transition-all duration-150 active:scale-95 cursor-pointer disabled:opacity-50";

/** Quiet — tertiary text-level actions (load more, collapse). */
export const BTN_QUIET =
  "min-h-[44px] rounded-2xl text-slate-400 hover:text-white font-bold text-xs transition-colors cursor-pointer disabled:opacity-50";

// ── Small parts ──────────────────────────────────────────────────────

/** Reference / freight-mode chip (monospace-feel metadata). */
export const CHIP_META =
  "text-xs font-semibold text-slate-500 bg-slate-950 border border-slate-800/60 rounded-lg px-2 py-0.5";

/** Tappable list row — previous jobs, settings entries. */
export const LIST_ROW =
  "w-full text-start bg-slate-900 border border-slate-800/60 rounded-2xl transition-all duration-150 cursor-pointer active:scale-[0.99] hover:border-slate-600";
