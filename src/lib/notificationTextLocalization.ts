/**
 * notificationTextLocalization.ts — Revision A trust fix.
 *
 * Server-generated notification titles/messages in Turkish and Arabic can
 * carry the raw English lifecycle status embedded mid-sentence ("Durum
 * Güncellemesi: In Transit" / "تحديث الحالة: In Transit"). Stored status
 * values must never change (they are the workflow contract), so this is a
 * DISPLAY-TIME fix: replace any known status name inside an already-
 * localized sentence with that status's existing localized label from the
 * same SHIPMENT_STATUS_LABELS map the timeline uses.
 *
 * Pure, deterministic, no I/O. Longest status names are replaced first so
 * "Arrived at Port" never gets half-replaced by "Arrived".
 */
import type { Language, ShipmentStatus } from "../types";
import {
  AIR_STATUS_SEQUENCE,
  LAND_STATUS_SEQUENCE,
  SEA_STATUS_SEQUENCE,
  WAITING_FOR_DRIVER_QUOTES,
  getShipmentStatusLabel,
} from "./shipmentStatusTransitions";

/** Every status name any workflow can produce, longest first. */
const ALL_STATUSES: ShipmentStatus[] = Array.from(
  new Set<ShipmentStatus>([
    ...LAND_STATUS_SEQUENCE,
    ...SEA_STATUS_SEQUENCE,
    ...AIR_STATUS_SEQUENCE,
    WAITING_FOR_DRIVER_QUOTES,
  ])
).sort((a, b) => b.length - a.length);

/**
 * Replace raw English status names inside `text` with their localized
 * labels for `lang`. English text is returned untouched (the English
 * label IS the status name). Case-sensitive on purpose — status names are
 * proper workflow terms and the server writes them verbatim.
 */
export function localizeStatusesInText(text: string, lang: Language): string {
  if (!text || lang === "en") return text;
  let out = text;
  for (const status of ALL_STATUSES) {
    if (!out.includes(status)) continue;
    const label = getShipmentStatusLabel(status);
    const localized = label[lang] ?? label.en;
    if (localized && localized !== status) {
      out = out.split(status).join(localized);
    }
  }
  return out;
}

/** Convenience for the notification card: pick the language field, then localize embedded statuses. */
export function localizedNotificationText(
  n: { titleEn: string; titleTr?: string; titleAr?: string; messageEn: string; messageTr?: string; messageAr?: string },
  lang: Language
): { title: string; message: string } {
  const title = lang === "tr" ? n.titleTr || n.titleEn : lang === "ar" ? n.titleAr || n.titleEn : n.titleEn;
  const message = lang === "tr" ? n.messageTr || n.messageEn : lang === "ar" ? n.messageAr || n.messageEn : n.messageEn;
  return {
    title: localizeStatusesInText(title, lang),
    message: localizeStatusesInText(message, lang),
  };
}
