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
