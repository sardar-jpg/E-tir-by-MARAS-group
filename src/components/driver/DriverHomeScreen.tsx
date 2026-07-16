import { Briefcase, ChevronRight, Megaphone, MapPin, MapPinOff, Loader2 } from "lucide-react";
import type { Language, Shipment } from "../../types";
import DriverActiveJobCard from "./DriverActiveJobCard";
import DriverNextAction from "./DriverNextAction";

/**
 * feature/driver-app-comprehensive-redesign — Home answers, at a glance:
 * what is my active job, where am I going, what must I do next, can I
 * reach MARAS, and is my location reporting working. The active job comes
 * from the ONE shared selection rule (useDriverActiveJob →
 * selectDriverActiveJob) — the same job location reporting follows.
 */
const LABELS: Record<Language, {
  greeting: (name: string) => string;
  subtitle: string;
  activeJob: string;
  noJob: string;
  noJobSub: string;
  viewJobs: string;
  gpsOn: string;
  gpsOff: string;
  gpsChecking: string;
  gpsIdle: string;
  offersBanner: (n: number) => string;
}> = {
  en: {
    greeting: (n) => `Hello, ${n}`,
    subtitle: "MARAS Operations",
    activeJob: "Your active job",
    noJob: "No active job right now",
    noJobSub: "New jobs from MARAS Operations will appear here.",
    viewJobs: "See all jobs",
    gpsOn: "Location sharing is working",
    gpsOff: "Location unavailable — check GPS permission",
    gpsChecking: "Checking your location…",
    gpsIdle: "Location sharing starts with your next job",
    offersBanner: (n) => (n === 1 ? "1 new transport offer — tap to answer" : `${n} new transport offers — tap to answer`),
  },
  tr: {
    greeting: (n) => `Merhaba, ${n}`,
    subtitle: "MARAS Operasyon",
    activeJob: "Aktif seferiniz",
    noJob: "Şu anda aktif sefer yok",
    noJobSub: "MARAS Operasyon'dan yeni seferler burada görünecek.",
    viewJobs: "Tüm seferleri gör",
    gpsOn: "Konum paylaşımı çalışıyor",
    gpsOff: "Konum alınamıyor — GPS iznini kontrol edin",
    gpsChecking: "Konumunuz kontrol ediliyor…",
    gpsIdle: "Konum paylaşımı bir sonraki seferle başlar",
    offersBanner: (n) => `${n} yeni taşıma teklifi — cevaplamak için dokunun`,
  },
  ar: {
    greeting: (n) => `مرحباً، ${n}`,
    subtitle: "عمليات MARAS",
    activeJob: "مهمتك النشطة",
    noJob: "لا توجد مهمة نشطة حالياً",
    noJobSub: "ستظهر هنا المهام الجديدة من عمليات MARAS.",
    viewJobs: "عرض كل المهام",
    gpsOn: "مشاركة الموقع تعمل",
    gpsOff: "تعذر تحديد الموقع — تحقق من إذن GPS",
    gpsChecking: "جارٍ التحقق من موقعك…",
    gpsIdle: "تبدأ مشاركة الموقع مع مهمتك القادمة",
    offersBanner: (n) => `${n} عرض نقل جديد — اضغط للرد`,
  },
};

interface DriverHomeScreenProps {
  driverName: string;
  driverId: string;
  activeJob: Shipment | null;
  lang: Language;
  /** null = not applicable/not yet checked, true = live fix, false = denied/unavailable. */
  gpsAvailable: boolean | null;
  /** Whether location reporting is supposed to be running right now. */
  isReportingLocation: boolean;
  isSubmittingStatus: boolean;
  onSubmitNextStatus: (shipment: Shipment) => void;
  onAccept: (shipment: Shipment) => void;
  onDecline: (shipment: Shipment) => void;
  onOpenChat: (shipment: Shipment) => void;
  onOpenDetails: (shipment: Shipment) => void;
  onViewJobs: () => void;
  /** Driver Alliance Phase 1: offers awaiting this driver's answer. */
  pendingOffersCount: number;
  onOpenOffers: () => void;
}

export default function DriverHomeScreen({
  driverName,
  driverId,
  activeJob,
  lang,
  gpsAvailable,
  isReportingLocation,
  isSubmittingStatus,
  onSubmitNextStatus,
  onAccept,
  onDecline,
  onOpenChat,
  onOpenDetails,
  onViewJobs,
  pendingOffersCount,
  onOpenOffers,
}: DriverHomeScreenProps) {
  const t = LABELS[lang] ?? LABELS.en;
  const firstName = driverName ? driverName.split(" ")[0] : "";

  const gps = !isReportingLocation
    ? { icon: MapPin, text: t.gpsIdle, cls: "text-slate-400 bg-slate-900 border-slate-800" }
    : gpsAvailable === true
    ? { icon: MapPin, text: t.gpsOn, cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30" }
    : gpsAvailable === false
    ? { icon: MapPinOff, text: t.gpsOff, cls: "text-amber-400 bg-amber-500/10 border-amber-500/30" }
    : { icon: Loader2, text: t.gpsChecking, cls: "text-slate-300 bg-slate-900 border-slate-800" };
  const GpsIcon = gps.icon;

  return (
    <div className="space-y-4 animate-fade-in pb-4">
      {/* Greeting */}
      <div className="text-start">
        <h2 className="text-xl font-bold text-white leading-tight">{t.greeting(firstName || "—")}</h2>
        <p className="text-sm text-slate-400 mt-0.5">{t.subtitle}</p>
      </div>

      {/* Connectivity / GPS status in plain words */}
      <div className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl border text-sm font-semibold text-start ${gps.cls}`}>
        <GpsIcon className={`w-4 h-4 shrink-0 ${gpsAvailable === null && isReportingLocation ? "animate-spin" : ""}`} />
        <span>{gps.text}</span>
      </div>

      {/* Driver Alliance Phase 1: pending transport offers — one tap to
          answer. Rendered above the job so a new offer is never missed,
          without adding a navigation tab. */}
      {pendingOffersCount > 0 && (
        <button
          type="button"
          onClick={onOpenOffers}
          className="w-full flex items-center gap-3 px-3.5 min-h-[56px] rounded-2xl bg-orange-500/10 border border-orange-500/40 text-start transition-all cursor-pointer active:scale-[0.99]"
        >
          <span className="w-10 h-10 rounded-xl bg-orange-500 text-white flex items-center justify-center shrink-0 light-preserve">
            <Megaphone className="w-5 h-5" />
          </span>
          <span className="flex-1 text-sm font-bold text-orange-400 leading-snug">{t.offersBanner(pendingOffersCount)}</span>
          <ChevronRight className="w-5 h-5 text-orange-500 shrink-0 rtl:rotate-180" />
        </button>
      )}

      {activeJob ? (
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-slate-300 text-start">{t.activeJob}</h3>
          <DriverActiveJobCard
            shipment={activeJob}
            driverId={driverId}
            lang={lang}
            onOpenChat={() => onOpenChat(activeJob)}
            onOpenDetails={() => onOpenDetails(activeJob)}
          />
          <DriverNextAction
            shipment={activeJob}
            lang={lang}
            isSubmitting={isSubmittingStatus}
            onSubmitNextStatus={() => onSubmitNextStatus(activeJob)}
            onAccept={() => onAccept(activeJob)}
            onDecline={() => onDecline(activeJob)}
          />
        </div>
      ) : (
        <div className="py-10 text-center space-y-4 bg-slate-900 rounded-3xl p-6 border border-slate-800">
          <div className="w-14 h-14 rounded-full bg-slate-950 border border-slate-800 flex items-center justify-center mx-auto">
            <Briefcase className="w-7 h-7 text-slate-600 shrink-0" />
          </div>
          <div>
            <p className="text-base font-bold text-slate-200">{t.noJob}</p>
            <p className="text-sm text-slate-500 mt-1.5 leading-relaxed max-w-[260px] mx-auto">{t.noJobSub}</p>
          </div>
          <button
            type="button"
            onClick={onViewJobs}
            className="inline-flex items-center gap-2 px-5 min-h-[48px] bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-200 text-sm font-bold rounded-2xl transition-all cursor-pointer active:scale-95"
          >
            <Briefcase className="w-4 h-4 text-orange-500" />
            <span>{t.viewJobs}</span>
          </button>
        </div>
      )}
    </div>
  );
}
