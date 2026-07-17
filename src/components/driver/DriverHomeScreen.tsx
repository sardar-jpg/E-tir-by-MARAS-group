import { useState } from "react";
import {
  ArrowRight, Bell, Briefcase, ChevronRight, Loader2, MapPin, MapPinOff, Megaphone,
} from "lucide-react";
import type { AppNotification, Driver, Language, Shipment } from "../../types";
import { apiFetch } from "../../lib/api";
import { getDriverNextAction, localizeNextActionLabel } from "../../lib/driverJobFlow";
import { BTN_PRIMARY, CARD, INNER_CARD, SCREEN_TITLE, getStatusChipClasses, localizeShipmentStatus } from "./driverUi";

/**
 * Driver App V2 — Home shows only what matters right now, with ONE
 * primary action:
 *
 *  - No active job: the driver's own "Available for Offers" switch (the
 *    one alliance field a driver session may write — moved here from the
 *    old Account screen so availability is always one tap away), how many
 *    offers are waiting, ONE big Open Job button (the Job section is
 *    where offers live), and a small recent activity list. No dense
 *    dashboard cards.
 *  - Active job: a compact summary (route, current status, next required
 *    action) and the same ONE big Open Job button. Offer actions are hidden —
 *    a driver with an active job cannot answer offers (server-enforced;
 *    Home simply doesn't advertise them).
 *
 * The active job comes from the ONE shared selection rule
 * (useDriverActiveJob → selectDriverActiveJob) — the same job location
 * reporting follows.
 */
const LABELS: Record<Language, {
  greeting: (name: string) => string;
  subtitle: string;
  availability: string;
  availabilityOn: string;
  availabilityOff: string;
  availabilityOnMsg: string;
  availabilityOffMsg: string;
  offersWaiting: (n: number) => string;
  noOffers: string;
  openJob: string;
  activeJob: string;
  nextStep: string;
  respond: string;
  recent: string;
  noRecent: string;
  gpsOn: string;
  gpsOff: string;
  gpsChecking: string;
  gpsIdle: string;
}> = {
  en: {
    greeting: (n) => `Hello, ${n}`,
    subtitle: "MARAS Operations",
    availability: "Available for Offers",
    availabilityOn: "On — you receive transport offers",
    availabilityOff: "Off — no transport offers",
    availabilityOnMsg: "You will now receive transport offers.",
    availabilityOffMsg: "You will no longer receive transport offers.",
    offersWaiting: (n) => (n === 1 ? "1 offer waiting for your price" : `${n} offers waiting for your price`),
    noOffers: "No new offers right now",
    openJob: "Open Job",
    activeJob: "Your active job",
    nextStep: "Next step",
    respond: "Accept or decline this job",
    recent: "Recent activity",
    noRecent: "No recent activity.",
    gpsOn: "Location sharing is working",
    gpsOff: "Location unavailable — check GPS permission",
    gpsChecking: "Checking your location…",
    gpsIdle: "Location sharing starts with your next job",
  },
  tr: {
    greeting: (n) => `Merhaba, ${n}`,
    subtitle: "MARAS Operasyon",
    availability: "Tekliflere Açık",
    availabilityOn: "Açık — taşıma teklifleri alırsınız",
    availabilityOff: "Kapalı — taşıma teklifi gelmez",
    availabilityOnMsg: "Artık taşıma teklifleri alacaksınız.",
    availabilityOffMsg: "Artık taşıma teklifi almayacaksınız.",
    offersWaiting: (n) => `${n} teklif fiyatınızı bekliyor`,
    noOffers: "Şu anda yeni teklif yok",
    openJob: "Sefere Git",
    activeJob: "Aktif seferiniz",
    nextStep: "Sonraki adım",
    respond: "Bu seferi kabul edin veya reddedin",
    recent: "Son hareketler",
    noRecent: "Son hareket yok.",
    gpsOn: "Konum paylaşımı çalışıyor",
    gpsOff: "Konum alınamıyor — GPS iznini kontrol edin",
    gpsChecking: "Konumunuz kontrol ediliyor…",
    gpsIdle: "Konum paylaşımı bir sonraki seferle başlar",
  },
  ar: {
    greeting: (n) => `مرحباً، ${n}`,
    subtitle: "عمليات MARAS",
    availability: "متاح لعروض النقل",
    availabilityOn: "مفعّل — تصلك عروض النقل",
    availabilityOff: "متوقف — لا تصلك عروض النقل",
    availabilityOnMsg: "ستصلك عروض النقل من الآن.",
    availabilityOffMsg: "لن تصلك عروض النقل بعد الآن.",
    offersWaiting: (n) => `${n} عرض بانتظار سعرك`,
    noOffers: "لا توجد عروض جديدة حالياً",
    openJob: "فتح المهمة",
    activeJob: "مهمتك النشطة",
    nextStep: "الخطوة التالية",
    respond: "اقبل هذه المهمة أو ارفضها",
    recent: "آخر النشاطات",
    noRecent: "لا يوجد نشاط حديث.",
    gpsOn: "مشاركة الموقع تعمل",
    gpsOff: "تعذر تحديد الموقع — تحقق من إذن GPS",
    gpsChecking: "جارٍ التحقق من موقعك…",
    gpsIdle: "تبدأ مشاركة الموقع مع مهمتك القادمة",
  },
};

interface DriverHomeScreenProps {
  driverName: string;
  driverId: string;
  driver: Driver | null;
  activeJob: Shipment | null;
  lang: Language;
  /** null = not applicable/not yet checked, true = live fix, false = denied/unavailable. */
  gpsAvailable: boolean | null;
  /** Whether location reporting is supposed to be running right now. */
  isReportingLocation: boolean;
  /** Offers still awaiting this driver's answer. */
  pendingOffersCount: number;
  /** Newest-first; Home shows the top few as the recent-activity summary. */
  recentNotifications: AppNotification[];
  onOpenJob: () => void;
  onDriverUpdated: (driver: Driver) => void;
  onToast: (msg: string) => void;
}

export default function DriverHomeScreen({
  driverName,
  driverId,
  driver,
  activeJob,
  lang,
  gpsAvailable,
  isReportingLocation,
  pendingOffersCount,
  recentNotifications,
  onOpenJob,
  onDriverUpdated,
  onToast,
}: DriverHomeScreenProps) {
  const t = LABELS[lang] ?? LABELS.en;
  const firstName = driverName ? driverName.split(" ")[0] : "";

  // The driver's OWN availability switch (Driver Quote Requests). Absent
  // counts as available, so legacy profiles stay opted in — the exact
  // convention the server and matching use.
  const [isSavingOffers, setIsSavingOffers] = useState(false);
  const offersEnabled = driver?.availableForOffers !== false;

  const handleToggleAvailableForOffers = async () => {
    if (isSavingOffers) return;
    setIsSavingOffers(true);
    try {
      const res = await apiFetch(`/api/drivers/${driverId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ availableForOffers: !offersEnabled }),
      });
      if (res.ok) {
        const updated = await res.json();
        onDriverUpdated(updated);
        onToast(!offersEnabled ? t.availabilityOnMsg : t.availabilityOffMsg);
      } else {
        let msg = "Failed to update. Please try again.";
        try { msg = (await res.json())?.error || msg; } catch {}
        onToast(`❌ ${msg}`);
      }
    } catch (err) {
      console.error(err);
      onToast("❌ Could not reach the server. Please check your connection and try again.");
    } finally {
      setIsSavingOffers(false);
    }
  };

  const gps = !isReportingLocation
    ? { icon: MapPin, text: t.gpsIdle, cls: "text-slate-400 bg-slate-900 border-slate-800" }
    : gpsAvailable === true
    ? { icon: MapPin, text: t.gpsOn, cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30" }
    : gpsAvailable === false
    ? { icon: MapPinOff, text: t.gpsOff, cls: "text-amber-400 bg-amber-500/10 border-amber-500/30" }
    : { icon: Loader2, text: t.gpsChecking, cls: "text-slate-300 bg-slate-900 border-slate-800" };
  const GpsIcon = gps.icon;

  const nextActionText = activeJob
    ? activeJob.status === "Assigned"
      ? t.respond
      : (() => {
          const next = getDriverNextAction(activeJob.status, activeJob.freightType);
          return next ? localizeNextActionLabel(next, lang) : null;
        })()
    : null;

  return (
    <div className="space-y-4 animate-fade-in pb-4">
      {/* Greeting — brand eyebrow above, large name below */}
      <div className="text-start">
        <p className="text-xs font-bold text-orange-400/90 mb-1">{t.subtitle}</p>
        <h2 className={`${SCREEN_TITLE} leading-tight`}>{t.greeting(firstName || "—")}</h2>
      </div>

      {/* Location status in plain words */}
      <div className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl border text-sm font-semibold text-start ${gps.cls}`}>
        <GpsIcon className={`w-4 h-4 shrink-0 ${gpsAvailable === null && isReportingLocation ? "animate-spin" : ""}`} />
        <span>{gps.text}</span>
      </div>

      {activeJob ? (
        /* ── With an active job: summary + ONE primary action. Offer
              actions are hidden entirely. ── */
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-slate-300 text-start">{t.activeJob}</h3>
          <div className={`${CARD} p-4 space-y-3.5`}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-base font-bold text-white selectable truncate">#{activeJob.shipmentNumber}</span>
              <span className={`px-3 py-1 rounded-full text-xs font-bold border shrink-0 ${getStatusChipClasses(activeJob.status, activeJob.freightType)}`}>
                {localizeShipmentStatus(activeJob.status, lang)}
              </span>
            </div>
            <div className={`flex items-center gap-3 ${INNER_CARD} p-3.5`}>
              <span className="flex-1 min-w-0 text-start text-base font-bold text-slate-200 truncate">{activeJob.loadingCity || "—"}</span>
              <ArrowRight className="w-5 h-5 text-orange-500 shrink-0 rtl:rotate-180" />
              <span className="flex-1 min-w-0 text-end text-base font-bold text-slate-200 truncate">{activeJob.deliveryCity || "—"}</span>
            </div>
            {nextActionText && (
              <div className="flex items-center gap-2.5 bg-orange-500/10 border border-orange-500/30 rounded-2xl px-3.5 py-2.5 text-start">
                <ChevronRight className="w-4 h-4 text-orange-400 shrink-0 rtl:rotate-180" />
                <p className="text-sm text-slate-200 min-w-0">
                  <span className="text-slate-400">{t.nextStep}: </span>
                  <span className="font-bold text-orange-400">{nextActionText}</span>
                </p>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onOpenJob}
            className={`w-full ${BTN_PRIMARY}`}
          >
            <Briefcase className="w-5 h-5 shrink-0" />
            <span>{t.openJob}</span>
            <ChevronRight className="w-5 h-5 shrink-0 rtl:rotate-180" />
          </button>
        </div>
      ) : (
        /* ── No active job: availability + offers + ONE primary action. ── */
        <div className="space-y-3">
          {/* Available for Offers switch */}
          <button
            type="button"
            onClick={handleToggleAvailableForOffers}
            disabled={isSavingOffers}
            aria-pressed={offersEnabled}
            className={`w-full flex items-center gap-3 min-h-[60px] px-3.5 border rounded-2xl text-start transition-colors cursor-pointer disabled:opacity-60 ${
              offersEnabled ? "bg-orange-500/10 border-orange-500/40" : "bg-slate-900 border-slate-800"
            }`}
          >
            <Megaphone className={`w-5 h-5 shrink-0 ${offersEnabled ? "text-orange-400" : "text-slate-500"}`} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-slate-200">{t.availability}</span>
              <span className={`block text-xs mt-0.5 ${offersEnabled ? "text-orange-400/90" : "text-slate-500"}`}>
                {offersEnabled ? t.availabilityOn : t.availabilityOff}
              </span>
            </span>
            {isSavingOffers ? (
              <Loader2 className="w-5 h-5 animate-spin text-slate-400 shrink-0" />
            ) : (
              <span
                className={`shrink-0 w-11 h-6 rounded-full relative transition-colors ${offersEnabled ? "bg-orange-500 light-preserve" : "bg-slate-700"}`}
                aria-hidden="true"
              >
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${offersEnabled ? "end-0.5" : "start-0.5"}`} />
              </span>
            )}
          </button>

          {/* Offers now + primary action */}
          <div className={`${CARD} p-5 text-center space-y-4`}>
            <p className={`font-bold ${pendingOffersCount > 0 ? "text-lg text-orange-400" : "text-base text-slate-400"}`}>
              {pendingOffersCount > 0 ? t.offersWaiting(pendingOffersCount) : t.noOffers}
            </p>
            <button
              type="button"
              onClick={onOpenJob}
              className={`w-full ${BTN_PRIMARY}`}
            >
              <Briefcase className="w-5 h-5 shrink-0" />
              <span>{t.openJob}</span>
              <ChevronRight className="w-5 h-5 shrink-0 rtl:rotate-180" />
            </button>
          </div>
        </div>
      )}

      {/* Small recent-activity summary */}
      <section className="space-y-2">
        <h3 className="text-sm font-bold text-slate-400 text-start flex items-center gap-1.5">
          <Bell className="w-3.5 h-3.5" />
          {t.recent}
        </h3>
        {recentNotifications.length === 0 ? (
          <p className="text-sm text-slate-500 text-start">{t.noRecent}</p>
        ) : (
          <ul className="space-y-1.5">
            {recentNotifications.slice(0, 3).map((n) => (
              <li key={n.id} className="bg-slate-900 border border-slate-800 rounded-2xl px-3.5 py-2.5 text-start">
                <p className="text-sm font-semibold text-slate-300 truncate">
                  {lang === "tr" ? n.titleTr || n.titleEn : lang === "ar" ? n.titleAr || n.titleEn : n.titleEn}
                </p>
                <p className="text-xs text-slate-500 truncate mt-0.5">
                  {lang === "tr" ? n.messageTr || n.messageEn : lang === "ar" ? n.messageAr || n.messageEn : n.messageEn}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
