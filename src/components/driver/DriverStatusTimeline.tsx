import { Check } from "lucide-react";
import type { Language, Shipment } from "../../types";
import {
  getStatusSequenceForFreightMode,
  resolveFreightMode,
} from "../../lib/shipmentStatusTransitions";
import { localizeShipmentStatus } from "./driverUi";

/**
 * feature/driver-app-comprehensive-redesign — read-only journey timeline
 * for the job details view. Renders the shipment's OWN freight-mode
 * sequence (shipmentStatusTransitions.ts, the same source the server
 * enforces) with completed stages checked, the current stage highlighted,
 * and future stages visible but dimmed. Deliberately non-interactive:
 * a driver can never select a stage here — progression happens only
 * through DriverNextAction's single forward action.
 */
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
          <li key={status} className="flex items-stretch gap-3">
            <div className="flex flex-col items-center">
              <span
                className={`w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 text-[11px] font-bold ${
                  isCurrent
                    ? "bg-orange-500 border-orange-500 text-white light-preserve"
                    : isDone
                    ? "bg-emerald-500/15 border-emerald-500/60 text-emerald-400"
                    : "bg-slate-950 border-slate-700 text-slate-600"
                }`}
              >
                {isDone ? <Check className="w-3.5 h-3.5" /> : index + 1}
              </span>
              {!isLast && (
                <span className={`w-0.5 flex-1 min-h-4 ${isDone ? "bg-emerald-500/40" : "bg-slate-800"}`} />
              )}
            </div>
            <div className={`pb-4 text-start ${isLast ? "pb-0" : ""}`}>
              <p
                className={`text-sm leading-7 ${
                  isCurrent
                    ? "font-bold text-orange-500"
                    : isDone
                    ? "font-semibold text-slate-300"
                    : "font-medium text-slate-600"
                }`}
              >
                {localizeShipmentStatus(status, lang)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
