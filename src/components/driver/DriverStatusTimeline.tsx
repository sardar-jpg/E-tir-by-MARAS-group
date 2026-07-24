import { Check } from "lucide-react";
import type { Language, Shipment } from "../../types";
import {
  getStatusSequenceForFreightMode,
  resolveFreightMode,
} from "../../lib/shipmentStatusTransitions";
import { localizeShipmentStatus } from "./driverUi";

/**
 * feature/driver-app-comprehensive-redesign (Revision A) — read-only
 * journey timeline. Renders the shipment's OWN freight-mode sequence
 * (shipmentStatusTransitions.ts, the same source the server enforces)
 * with completed stages checked green, the current stage highlighted
 * blue with a "you are here" line, and future stages visible but
 * dimmed. Progress is derived ONLY from the confirmed stored status —
 * never GPS, never invented percentages. Deliberately non-interactive:
 * a driver can never select a stage here — progression happens only
 * through DriverNextAction's single forward action.
 */
const HERE_LABEL: Record<Language, string> = {
  en: "You are here",
  tr: "Şu an buradasınız",
  ar: "أنت هنا الآن",
};
const PENDING_LABEL: Record<Language, string> = {
  en: "Pending",
  tr: "Bekliyor",
  ar: "قادم",
};
const DONE_LABEL: Record<Language, string> = {
  en: "Completed",
  tr: "Tamamlandı",
  ar: "مكتمل",
};

interface DriverStatusTimelineProps {
  shipment: Pick<Shipment, "status" | "freightType">;
  lang: Language;
}

export default function DriverStatusTimeline({ shipment, lang }: DriverStatusTimelineProps) {
  const sequence = getStatusSequenceForFreightMode(resolveFreightMode(shipment.freightType));
  const currentIndex = sequence.indexOf(shipment.status);

  return (
    <ol className="space-y-0">
      {sequence.map((status, index) => {
        const isDone = currentIndex >= 0 && index < currentIndex;
        const isCurrent = index === currentIndex;
        const isLast = index === sequence.length - 1;
        return (
          <li key={status} className="flex items-stretch gap-3.5">
            <div className="flex flex-col items-center">
              <span
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-[12px] font-bold ${
                  isCurrent
                    ? "bg-blue-600 text-white shadow-[0_0_0_5px_rgba(37,99,235,0.12)]"
                    : isDone
                    ? "bg-green-600 text-white"
                    : "bg-white border-2 border-slate-200 text-slate-400"
                }`}
              >
                {isDone ? <Check className="w-4 h-4" /> : index + 1}
              </span>
              {!isLast && (
                <span className={`w-0.5 flex-1 min-h-4 ${isDone ? "bg-green-500" : "bg-slate-200"}`} />
              )}
            </div>
            <div className={`pb-4 text-start ${isLast ? "pb-0" : ""}`}>
              <p
                className={`text-[15px] leading-8 ${
                  isCurrent
                    ? "font-extrabold text-slate-900"
                    : isDone
                    ? "font-bold text-slate-700"
                    : "font-semibold text-slate-400"
                }`}
              >
                {localizeShipmentStatus(status, lang)}
              </p>
              <p className={`text-xs font-semibold -mt-1 ${isCurrent ? "text-blue-600" : "text-slate-400"}`}>
                {isCurrent ? (HERE_LABEL[lang] ?? HERE_LABEL.en) : isDone ? (DONE_LABEL[lang] ?? DONE_LABEL.en) : (PENDING_LABEL[lang] ?? PENDING_LABEL.en)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
