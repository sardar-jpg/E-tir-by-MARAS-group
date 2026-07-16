import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Box,
  ChevronDown,
  FileText,
  ListChecks,
  MapPin,
  Navigation,
  Phone,
  Wallet,
} from "lucide-react";
import type { Language, Shipment } from "../../types";
import { resolveDriverAgreedAmount, resolveDriverTruckNumber } from "../../lib/driverVisibility";
import { isShipmentClosed } from "../../lib/shipmentStatusTransitions";
import DriverNextAction from "./DriverNextAction";
import DriverStatusTimeline from "./DriverStatusTimeline";
import DriverDocumentSection from "./DriverDocumentSection";
import { resolveDriverCallContact } from "./DriverActiveJobCard";
import { getStatusChipClasses, localizeShipmentStatus, localizeFreightType } from "./driverUi";

/**
 * feature/driver-app-comprehensive-redesign — job details, reorganized
 * into clear sections: Route, Cargo, Your Payment, Documents, Journey
 * timeline, and the latest operational note. Only driver-safe data is
 * rendered — the shipment object itself already arrived through
 * buildShipmentViewForRole (no customer identity/prices, no internal
 * notes), and this view never reaches for any of those fields. Status
 * progression happens exclusively through DriverNextAction below.
 */
const LABELS: Record<Language, {
  back: string;
  route: string;
  loading: string;
  delivery: string;
  navigate: string;
  callBroker: string;
  loadingDate: string;
  cargo: string;
  weight: string;
  container: string;
  packages: string;
  payment: string;
  paymentSub: string;
  notAvailable: string;
  truck: string;
  documents: string;
  timeline: string;
  latestNote: string;
  noteToMaras: string;
  notePlaceholder: string;
}> = {
  en: {
    back: "Back to jobs",
    route: "Route",
    loading: "Loading",
    delivery: "Delivery",
    navigate: "Open in Maps",
    callBroker: "Call contact",
    loadingDate: "Loading date",
    cargo: "Cargo",
    weight: "Weight",
    container: "Container",
    packages: "Packages",
    payment: "Your payment",
    paymentSub: "Amount agreed with MARAS",
    notAvailable: "Not available",
    truck: "Truck",
    documents: "Documents",
    timeline: "Journey progress",
    latestNote: "Latest update",
    noteToMaras: "Note to MARAS (optional)",
    notePlaceholder: "Add a short note with your next update…",
  },
  tr: {
    back: "Seferlere dön",
    route: "Güzergah",
    loading: "Yükleme",
    delivery: "Teslimat",
    navigate: "Haritada aç",
    callBroker: "İrtibatı ara",
    loadingDate: "Yükleme tarihi",
    cargo: "Yük",
    weight: "Ağırlık",
    container: "Konteyner",
    packages: "Paketler",
    payment: "Ödemeniz",
    paymentSub: "MARAS ile anlaşılan tutar",
    notAvailable: "Belirtilmemiş",
    truck: "Araç",
    documents: "Belgeler",
    timeline: "Sefer ilerlemesi",
    latestNote: "Son güncelleme",
    noteToMaras: "MARAS'a not (isteğe bağlı)",
    notePlaceholder: "Bir sonraki güncellemenizle kısa bir not ekleyin…",
  },
  ar: {
    back: "العودة إلى المهام",
    route: "المسار",
    loading: "التحميل",
    delivery: "التسليم",
    navigate: "فتح في الخرائط",
    callBroker: "اتصال",
    loadingDate: "تاريخ التحميل",
    cargo: "الحمولة",
    weight: "الوزن",
    container: "الحاوية",
    packages: "الطرود",
    payment: "أجرك المتفق عليه",
    paymentSub: "المبلغ المتفق عليه مع MARAS",
    notAvailable: "غير متوفر",
    truck: "الشاحنة",
    documents: "المستندات",
    timeline: "تقدم الرحلة",
    latestNote: "آخر تحديث",
    noteToMaras: "ملاحظة إلى MARAS (اختياري)",
    notePlaceholder: "أضف ملاحظة قصيرة مع تحديثك القادم…",
  },
};

function Section({
  icon,
  title,
  children,
  collapsible = false,
  defaultOpen = true,
  badge,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  badge?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden">
      <button
        type="button"
        disabled={!collapsible}
        onClick={() => collapsible && setOpen((v) => !v)}
        className={`w-full flex items-center gap-2.5 p-4 text-start ${collapsible ? "cursor-pointer" : "cursor-default"}`}
      >
        <span className="w-8 h-8 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-500 flex items-center justify-center shrink-0">
          {icon}
        </span>
        <span className="flex-1 text-sm font-bold text-slate-200">{title}</span>
        {badge && (
          <span className="text-xs font-bold text-slate-400 bg-slate-950 border border-slate-800 rounded-full px-2 py-0.5">
            {badge}
          </span>
        )}
        {collapsible && (
          <ChevronDown className={`w-5 h-5 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} />
        )}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}

function mapsUrl(city: string, country: string, address?: string): string {
  const query = [address, city, country].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

interface DriverJobDetailsProps {
  shipment: Shipment;
  driverId: string;
  lang: Language;
  isSubmittingStatus: boolean;
  remarks: string;
  onRemarksChange: (value: string) => void;
  onSubmitNextStatus: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onBack: () => void;
  onOpenChat: () => void;
}

export default function DriverJobDetails({
  shipment: s,
  driverId,
  lang,
  isSubmittingStatus,
  remarks,
  onRemarksChange,
  onSubmitNextStatus,
  onAccept,
  onDecline,
  onBack,
  onOpenChat,
}: DriverJobDetailsProps) {
  const t = LABELS[lang] ?? LABELS.en;
  const agreedAmount = resolveDriverAgreedAmount(s, driverId);
  const truckNumber = resolveDriverTruckNumber(s, driverId);
  const callContact = resolveDriverCallContact(s);
  const closed = isShipmentClosed(s.status, s.freightType);
  const latestTimelineEntry = s.timeline && s.timeline.length > 0 ? s.timeline[s.timeline.length - 1] : null;
  const latestNote =
    latestTimelineEntry &&
    (lang === "tr" ? latestTimelineEntry.detailsTr : lang === "ar" ? latestTimelineEntry.detailsAr : latestTimelineEntry.detailsEn);
  const showNoteInput = !closed && s.status !== "Assigned" && s.status !== "New";

  return (
    <div className="space-y-3.5 animate-fade-in pb-4">
      {/* Back + header */}
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 min-h-[44px] px-3.5 text-sm font-bold text-slate-300 hover:text-white bg-slate-900 border border-slate-800 rounded-2xl transition-all cursor-pointer active:scale-95"
      >
        <ArrowLeft className="w-4 h-4 shrink-0 rtl:rotate-180" />
        <span>{t.back}</span>
      </button>

      <div className="flex items-center justify-between gap-2 flex-wrap text-start">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-white selectable truncate">#{s.shipmentNumber}</h2>
          <p className="text-xs text-slate-500 font-semibold mt-0.5">{localizeFreightType(s.freightType, lang)}</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-bold border shrink-0 ${getStatusChipClasses(s.status, s.freightType)}`}>
          {localizeShipmentStatus(s.status, lang)}
        </span>
      </div>

      {/* Primary action */}
      <DriverNextAction
        shipment={s}
        lang={lang}
        isSubmitting={isSubmittingStatus}
        onSubmitNextStatus={onSubmitNextStatus}
        onAccept={onAccept}
        onDecline={onDecline}
      />

      {showNoteInput && (
        <div className="text-start">
          <label className="text-xs font-semibold text-slate-400 block mb-1.5">{t.noteToMaras}</label>
          <input
            type="text"
            value={remarks}
            onChange={(e) => onRemarksChange(e.target.value)}
            placeholder={t.notePlaceholder}
            className="w-full min-h-[48px] px-3.5 bg-slate-900 border border-slate-800 focus:border-orange-500/60 text-sm text-slate-200 rounded-2xl outline-none transition-colors placeholder-slate-600"
          />
        </div>
      )}

      {/* A. Route */}
      <Section icon={<MapPin className="w-4 h-4" />} title={t.route}>
        <div className="space-y-3">
          {[
            { label: t.loading, city: s.loadingCity, country: s.loadingCountry, address: s.loadingAddress },
            { label: t.delivery, city: s.deliveryCity, country: s.deliveryCountry, address: s.deliveryAddress },
          ].map((stop) => (
            <div key={stop.label} className="bg-slate-950 border border-slate-800 rounded-2xl p-3.5 text-start">
              <p className="text-xs text-slate-500 font-semibold">{stop.label}</p>
              <p className="text-base font-bold text-slate-200 mt-0.5">
                {stop.city || "—"}
                {stop.country ? <span className="text-slate-400 font-semibold">, {stop.country}</span> : null}
              </p>
              {stop.address && <p className="text-sm text-slate-400 mt-1 leading-snug selectable">{stop.address}</p>}
              {(stop.city || stop.address) && (
                <a
                  href={mapsUrl(stop.city, stop.country, stop.address)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 mt-2.5 min-h-[40px] px-3 bg-slate-900 border border-slate-800 hover:border-slate-600 rounded-xl text-sm font-bold text-slate-200 transition-all cursor-pointer active:scale-95"
                >
                  <Navigation className="w-4 h-4 text-orange-500 shrink-0" />
                  <span>{t.navigate}</span>
                </a>
              )}
            </div>
          ))}
          {s.loadingDate && (
            <p className="text-sm text-slate-400 text-start">
              {t.loadingDate}: <span className="font-semibold text-slate-200">{s.loadingDate}</span>
            </p>
          )}
          {callContact && (
            <a
              href={`tel:${callContact}`}
              className="flex items-center justify-center gap-2 min-h-[52px] bg-slate-950 border border-slate-800 hover:border-emerald-500/40 rounded-2xl text-sm font-bold text-slate-200 transition-all cursor-pointer active:scale-95"
            >
              <Phone className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{t.callBroker}</span>
              <span dir="ltr" className="text-slate-400 font-semibold selectable">{callContact}</span>
            </a>
          )}
        </div>
      </Section>

      {/* B. Cargo */}
      <Section icon={<Box className="w-4 h-4" />} title={t.cargo}>
        <div className="space-y-2.5 text-start">
          <p className="text-sm font-semibold text-slate-200 leading-relaxed">{s.cargoDescription || "—"}</p>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-slate-300">
              {t.weight}: <strong>{typeof s.cargoWeight === "number" ? `${s.cargoWeight.toLocaleString()} kg` : t.notAvailable}</strong>
            </span>
            {s.containerNumber && (
              <span className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-slate-300">
                {t.container}: <strong className="selectable">{s.containerNumber}</strong>
              </span>
            )}
            {typeof s.numberOfPackages === "number" && s.numberOfPackages > 0 && (
              <span className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-slate-300">
                {t.packages}: <strong>{s.numberOfPackages}</strong>
              </span>
            )}
            {truckNumber && (
              <span className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-slate-300">
                {t.truck}: <strong className="selectable">{truckNumber}</strong>
              </span>
            )}
          </div>
        </div>
      </Section>

      {/* C. Driver payment — the driver's own agreed amount only; customer
          pricing/costs/invoices are never present on a driver-scoped
          shipment view and are never rendered here. */}
      <Section icon={<Wallet className="w-4 h-4" />} title={t.payment}>
        <div className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-2xl p-3.5">
          <span className="text-sm text-slate-400 text-start">{t.paymentSub}</span>
          {agreedAmount !== null ? (
            <span className="text-xl font-bold text-orange-500">
              {agreedAmount.toLocaleString()} <span className="text-sm">{s.currency || "USD"}</span>
            </span>
          ) : (
            <span className="text-sm font-semibold text-slate-500">{t.notAvailable}</span>
          )}
        </div>
      </Section>

      {/* D. Documents */}
      <Section
        icon={<FileText className="w-4 h-4" />}
        title={t.documents}
        collapsible
        defaultOpen={(s.documents?.length || 0) > 0}
        badge={String(s.documents?.length || 0)}
      >
        <DriverDocumentSection
          documents={s.documents || []}
          lang={lang}
          canSendDocuments={!closed}
          onSendDocumentViaChat={onOpenChat}
        />
      </Section>

      {/* E. Timeline */}
      <Section icon={<ListChecks className="w-4 h-4" />} title={t.timeline} collapsible defaultOpen={false}>
        <DriverStatusTimeline shipment={s} lang={lang} />
      </Section>

      {/* F. Latest operational note (from the shipment's own driver-visible timeline) */}
      {latestNote && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 text-start">
          <p className="text-xs font-semibold text-slate-500 mb-1">{t.latestNote}</p>
          <p className="text-sm text-slate-300 leading-relaxed">{latestNote}</p>
        </div>
      )}
    </div>
  );
}
