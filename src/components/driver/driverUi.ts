/**
 * driverUi.ts — the Driver App Design System (Revision A, light-first).
 *
 * ONE module defines the complete visual language for every driver
 * screen: surfaces, typography, buttons, chips, list rows, status
 * presentation, and journey progress. Purely presentational — no
 * behavior, data, or layout-direction logic lives here (RTL comes from
 * logical utilities at the call sites).
 *
 * Revision A depth model — light professional, readable in daylight
 * inside a truck cab:
 *   CANVAS  (slate-100/50)  the screen background — soft light gray
 *   SURFACE (white)         cards, hairline border, soft shadow
 *   HERO    (white+)        the ONE most important card per screen
 *   INSET   (slate-50)      wells and fields inside a card
 *
 * Color discipline (approved visual system):
 *   BLUE   = identity & information (active nav, info chips, links)
 *   GREEN  = valid primary progress actions (THE one big button)
 *   ORANGE = eTIR brand accents & badges only
 *   RED    = destructive actions only
 *   Everything else is tonal slate on white.
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
 * (color is never the only signal). Light-surface tones.
 */
export function getStatusChipClasses(status: ShipmentStatus, freightType?: string | null): string {
  if (isShipmentClosed(status, freightType)) {
    return "bg-slate-100 text-slate-500 border-slate-200";
  }
  const group = getDriverJobGroup(status, freightType);
  if (group === "completed") {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
  if (group === "upcoming") {
    return "bg-amber-50 text-amber-700 border-amber-200";
  }
  return "bg-blue-50 text-blue-700 border-blue-200";
}

/**
 * Stage rail — a colored logical-start edge on the hero card that makes
 * the job's phase readable from across the cab. Same amber/blue/emerald/
 * slate semantics as the chip; border-s flips sides automatically under
 * RTL.
 */
export function getStatusRailClasses(status: ShipmentStatus, freightType?: string | null): string {
  if (isShipmentClosed(status, freightType)) return "border-s-4 border-s-slate-300";
  const group = getDriverJobGroup(status, freightType);
  if (group === "completed") return "border-s-4 border-s-emerald-500";
  if (group === "upcoming") return "border-s-4 border-s-amber-400";
  return "border-s-4 border-s-blue-500";
}

/**
 * Journey position for progress presentation: how far through its own
 * freight-mode sequence this status sits. Derived from the existing
 * authoritative sequences — presentation only, never GPS, never
 * invented percentages. Statuses outside the sequence (a driver never
 * holds one) report position 0.
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

/** Card — white surface, hairline border, soft ambient shadow. */
export const CARD = "bg-white border border-slate-200 rounded-3xl shadow-[0_1px_2px_rgba(15,27,45,0.03),0_10px_30px_-12px_rgba(15,27,45,0.08)]";

/** Hero — the ONE most important card on a screen. */
export const HERO_CARD =
  "bg-white border border-slate-200 rounded-3xl shadow-[0_2px_4px_rgba(15,27,45,0.04),0_18px_44px_-14px_rgba(15,27,45,0.12)]";

/** Inset well inside a card — one tonal step down, borderless. */
export const INNER_CARD = "bg-slate-50 rounded-2xl";

/** Legacy alias kept for the few nested surfaces that still want a faint edge. */
export const INNER_CARD_EDGED = "bg-slate-50 border border-slate-200 rounded-2xl";

// ── Typography system ────────────────────────────────────────────────
//
// The complete named scale on light surfaces. Weight carries hierarchy:
// extrabold for the two display levels (payment, route cities), bold for
// titles and data values, semibold for headings/labels, regular for
// body. Numerals are always tabular where figures appear. Under Arabic
// RTL the shell swaps to IBM Plex Sans Arabic and neutralizes the
// Latin-only tight tracking (see index.css).

/** Display XL — the payment figure. */
export const TYPE_DISPLAY_XL = "text-[32px] leading-9 font-extrabold text-slate-900 tracking-tight tabular-nums";

/** Display L — route cities. */
export const TYPE_DISPLAY = "text-[26px] leading-8 font-extrabold text-slate-900 tracking-tight tabular-nums";

/** Screen title — identical on every section. */
export const SCREEN_TITLE = "text-[22px] leading-7 font-bold text-slate-900 text-start tracking-tight";

/** Card heading — semibold, never shouts. */
export const TYPE_HEADING = "text-[15px] font-semibold text-slate-800";

/** Body. */
export const TYPE_BODY = "text-[15px] text-slate-600";

/** Section label above a group of cards/rows. */
export const SECTION_LABEL = "text-[13px] font-semibold text-slate-500 text-start";

/** Caption / helper line. */
export const TYPE_CAPTION = "text-xs text-slate-400";

/** Metadata — references, units, chips. */
export const TYPE_METADATA = "text-[11px] font-semibold text-slate-400 tabular-nums";

// ── Buttons — exactly four recipes ───────────────────────────────────

/**
 * THE primary action: large, GREEN (valid forward progress), glove-
 * friendly. One per screen. Add w-full/context at the call site.
 */
export const BTN_PRIMARY =
  "min-h-[60px] rounded-2xl bg-green-600 hover:bg-green-700 text-white font-bold text-lg flex items-center justify-center gap-2 shadow-[0_10px_24px_-8px_rgba(22,163,74,0.45)] transition-all duration-150 active:scale-[0.98] cursor-pointer disabled:opacity-50";

/** Secondary — quiet white button, still ≥52px. */
export const BTN_SECONDARY =
  "min-h-[52px] rounded-2xl bg-white border border-slate-200 hover:border-slate-300 text-slate-700 font-bold text-sm flex items-center justify-center gap-1.5 transition-all duration-150 active:scale-95 cursor-pointer disabled:opacity-50";

/** Danger — decline/reject confirm actions. */
export const BTN_DANGER =
  "min-h-[52px] rounded-2xl bg-white border border-red-200 hover:border-red-300 text-red-600 font-bold text-sm flex items-center justify-center gap-1.5 transition-all duration-150 active:scale-95 cursor-pointer disabled:opacity-50";

/** Quiet — tertiary text-level actions (load more, collapse). */
export const BTN_QUIET =
  "min-h-[44px] rounded-2xl text-slate-500 hover:text-slate-900 font-bold text-xs transition-colors cursor-pointer disabled:opacity-50";

// ── Small parts ──────────────────────────────────────────────────────

/** Reference / freight-mode chip (monospace-feel metadata). */
export const CHIP_META =
  "text-xs font-semibold text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2 py-0.5";

/** Tappable list row — previous jobs, settings entries. */
export const LIST_ROW =
  "w-full text-start bg-white border border-slate-200 rounded-2xl transition-all duration-150 cursor-pointer active:scale-[0.99] hover:border-slate-300 shadow-[0_1px_2px_rgba(15,27,45,0.03)]";
