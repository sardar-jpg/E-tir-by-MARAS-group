import type { Language, Shipment } from "../../../types";
import { translateShipmentStatus } from "../../../lib/shipmentStatusLabels";

/**
 * Readable shipment status badge. Colour is semantic but never the ONLY
 * signal — the status text is always shown, so meaning does not rely on
 * colour alone (WCAG 1.4.1).
 *
 * Palette: green = delivered/closed, blue = in transit, purple = customs,
 * amber = assigned/pending action, sky = awaiting quotes/cost, emerald =
 * accepted/confirmed, slate = new/neutral.
 */
const TONE: Record<string, string> = {
  green: "bg-green-50 text-green-700 border-green-200",
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  purple: "bg-purple-50 text-purple-700 border-purple-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  sky: "bg-sky-50 text-sky-700 border-sky-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  slate: "bg-slate-50 text-slate-600 border-slate-200",
};

export function statusTone(status: string): keyof typeof TONE {
  switch (status) {
    case "New": return "slate";
    case "Waiting for Driver Quotes": return "sky";
    case "Assigned": return "amber";
    case "Accepted":
    case "Booking Confirmed": return "emerald";
    case "Customs Clearance": return "purple";
    case "Arrived":
    case "Delivered":
    case "Closed":
    case "Completed": return "green";
    default: return "blue"; // In Transit, Container Released, and other in-flight states
  }
}

export default function ShipmentStatusBadge({ status, lang = "en" }: { status: Shipment["status"] | string; lang?: Language }) {
  const tone = statusTone(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-black uppercase leading-none tracking-wide ${TONE[tone]}`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
      {translateShipmentStatus(status, lang)}
    </span>
  );
}
