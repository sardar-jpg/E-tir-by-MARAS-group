import { ArrowRight, FileText, MessageSquare, Phone } from "lucide-react";
import type { Language, Shipment } from "../../types";
import { resolveDriverAgreedAmount, resolveDriverTruckNumber } from "../../lib/driverVisibility";
import { isDriverChatAvailable } from "../../lib/driverJobFlow";
import { BTN_SECONDARY, CARD, INNER_CARD, getStatusChipClasses, localizeShipmentStatus, localizeFreightType } from "./driverUi";

/**
 * feature/driver-app-comprehensive-redesign — the Home screen's active-job
 * card: shipment number, current status, route, truck, and the driver's
 * own agreed amount (resolveDriverAgreedAmount — never another driver's
 * figure, never any customer price). Secondary actions live here (chat /
 * details / call the operational broker contact when one exists); the
 * single primary status action is rendered separately by DriverNextAction
 * so it stays visually dominant.
 */
const LABELS: Record<Language, {
  from: string;
  to: string;
  truck: string;
  payment: string;
  chat: string;
  details: string;
  call: string;
  loadingDate: string;
}> = {
  en: { from: "From", to: "To", truck: "Truck", payment: "Your payment", chat: "Chat", details: "Details", call: "Call contact", loadingDate: "Loading date" },
  tr: { from: "Nereden", to: "Nereye", truck: "Araç", payment: "Ödemeniz", chat: "Mesaj", details: "Detaylar", call: "İrtibatı ara", loadingDate: "Yükleme tarihi" },
  ar: { from: "من", to: "إلى", truck: "الشاحنة", payment: "أجرك المتفق عليه", chat: "محادثة", details: "التفاصيل", call: "اتصال", loadingDate: "تاريخ التحميل" },
};

/**
 * The one operational phone number a driver may call from the app: the
 * customs-broker contacts recorded on the shipment (border broker while
 * crossing, destination broker otherwise). Customer contact numbers are
 * already stripped server-side for drivers and never reach this card.
 */
export function resolveDriverCallContact(
  shipment: Pick<Shipment, "status" | "destinationBrokerPhone" | "iraqBorderBrokerPhone">
): string | null {
  if (shipment.status === "Border Crossing" && shipment.iraqBorderBrokerPhone) {
    return shipment.iraqBorderBrokerPhone;
  }
  return shipment.destinationBrokerPhone || shipment.iraqBorderBrokerPhone || null;
}

interface DriverActiveJobCardProps {
  shipment: Shipment;
  driverId: string;
  lang: Language;
  onOpenChat: () => void;
  onOpenDetails: () => void;
}

export default function DriverActiveJobCard({
  shipment: s,
  driverId,
  lang,
  onOpenChat,
  onOpenDetails,
}: DriverActiveJobCardProps) {
  const t = LABELS[lang] ?? LABELS.en;
  const agreedAmount = resolveDriverAgreedAmount(s, driverId);
  const truckNumber = resolveDriverTruckNumber(s, driverId);
  const callContact = resolveDriverCallContact(s);
  // Shipment chat exists only after the driver accepts the job.
  const chatAvailable = isDriverChatAvailable(s.status);

  return (
    <div className={`${CARD} p-4 space-y-4 shadow-[0_8px_30px_rgba(0,0,0,0.35)]`}>
      {/* Shipment number + status */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base font-bold text-white selectable truncate">#{s.shipmentNumber}</span>
          <span className="text-xs font-semibold text-slate-500 bg-slate-950 border border-slate-800 rounded-lg px-2 py-0.5 shrink-0">
            {localizeFreightType(s.freightType, lang)}
          </span>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-bold border shrink-0 ${getStatusChipClasses(s.status, s.freightType)}`}>
          {localizeShipmentStatus(s.status, lang)}
        </span>
      </div>

      {/* Route */}
      <div className={`${INNER_CARD} p-3.5`}>
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0 text-start">
            <p className="text-xs text-slate-500 font-medium">{t.from}</p>
            <p className="text-base font-bold text-slate-200 truncate mt-0.5">{s.loadingCity || "—"}</p>
            <p className="text-xs text-slate-500 truncate">{s.loadingCountry}</p>
          </div>
          <ArrowRight className="w-5 h-5 text-orange-500 shrink-0 rtl:rotate-180" />
          <div className="flex-1 min-w-0 text-end">
            <p className="text-xs text-slate-500 font-medium">{t.to}</p>
            <p className="text-base font-bold text-slate-200 truncate mt-0.5">{s.deliveryCity || "—"}</p>
            <p className="text-xs text-slate-500 truncate">{s.deliveryCountry}</p>
          </div>
        </div>
        {s.loadingDate && (
          <p className="text-xs text-slate-500 mt-2.5 pt-2.5 border-t border-slate-800 text-start">
            {t.loadingDate}: <span className="font-semibold text-slate-300">{s.loadingDate}</span>
          </p>
        )}
      </div>

      {/* Payment + truck */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-slate-950 rounded-2xl border border-slate-800 p-3 text-start">
          <p className="text-xs text-slate-500 font-medium">{t.payment}</p>
          {agreedAmount !== null ? (
            <p className="text-lg font-bold text-orange-500 mt-0.5">
              {agreedAmount.toLocaleString()} <span className="text-sm">{s.currency || "USD"}</span>
            </p>
          ) : (
            <p className="text-base font-semibold text-slate-500 mt-0.5">—</p>
          )}
        </div>
        <div className="bg-slate-950 rounded-2xl border border-slate-800 p-3 text-start">
          <p className="text-xs text-slate-500 font-medium">{t.truck}</p>
          <p className="text-base font-bold text-slate-200 mt-1 break-all">{truckNumber || "—"}</p>
        </div>
      </div>

      {/* Secondary actions — Chat appears only once the job is accepted */}
      <div className={`grid gap-2 ${chatAvailable && callContact ? "grid-cols-3" : chatAvailable || callContact ? "grid-cols-2" : "grid-cols-1"}`}>
        {chatAvailable && (
          <button
            type="button"
            onClick={onOpenChat}
            className={BTN_SECONDARY}
          >
            <MessageSquare className="w-4 h-4 text-orange-500 shrink-0" />
            <span>{t.chat}</span>
          </button>
        )}
        <button
          type="button"
          onClick={onOpenDetails}
          className={BTN_SECONDARY}
        >
          <FileText className="w-4 h-4 text-orange-500 shrink-0" />
          <span>{t.details}</span>
        </button>
        {callContact && (
          <a
            href={`tel:${callContact}`}
            className={BTN_SECONDARY}
          >
            <Phone className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{t.call}</span>
          </a>
        )}
      </div>
    </div>
  );
}
