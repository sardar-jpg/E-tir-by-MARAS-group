import { Briefcase, ChevronRight, MessageSquare } from "lucide-react";
import type { Language, Shipment } from "../../types";
import type { DriverOfferView } from "../../lib/driverAlliance";
import RouteBlock from "./RouteBlock";
import DriverNextAction from "./DriverNextAction";
import DriverStatusTimeline from "./DriverStatusTimeline";
import DriverOffersScreen from "./DriverOffersScreen";
import { isShipmentClosed } from "../../lib/shipmentStatusTransitions";
import { resolveDriverAgreedAmount } from "../../lib/driverVisibility";
import { isDriverChatAvailable } from "../../lib/driverJobFlow";
import { BTN_QUIET, CARD, HERO_CARD, LIST_ROW, SCREEN_TITLE, SECTION_LABEL, getJourneyProgress, getStatusChipClasses, localizeShipmentStatus } from "./driverUi";

/**
 * Driver App Revision A — the Job tab is TRIP PROGRESS: where the driver
 * sees the whole journey at a glance, in strict priority order:
 *   1. the active/assigned job — honest step counter ("Step X of Y ·
 *      Based on confirmed steps", derived only from the stored status's
 *      position in its own freight-mode sequence, never GPS, never an
 *      invented percentage), the full confirmed-steps timeline, the
 *      single next action, and the shipment-chat shortcut,
 *   2. new offers awaiting an answer,
 *   3. submitted quotations awaiting MARAS's decision,
 *   4. recently decided offers (read-only),
 *   5. previous jobs, compact and secondary.
 * Offer rendering lives in DriverOffersScreen (embedded, not a tab);
 * status progression logic is untouched — this screen only presents it.
 * Files flow exclusively through the shipment chat (and the job
 * details view); there is no separate files section.
 */
const LABELS: Record<Language, {
  title: string;
  stepOf: (step: number, total: number) => string;
  confirmedNote: string;
  progress: string;
  chat: string;
  chatAfterAccept: string;
  previous: string;
  empty: string;
  emptySub: string;
  loadOlder: string;
  loading: string;
  closedTag: string;
}> = {
  en: {
    title: "Trip Progress",
    stepOf: (s, t2) => `Step ${s} of ${t2}`,
    confirmedNote: "Based on confirmed steps",
    progress: "Journey progress",
    chat: "Shipment Chat",
    chatAfterAccept: "Shipment chat opens after you accept the job.",
    previous: "Previous jobs",
    empty: "No active job right now",
    emptySub: "Answer an offer below, or wait — when MARAS assigns you a job, everything about it will appear here.",
    loadOlder: "Load older jobs",
    loading: "Loading…",
    closedTag: "Read-only",
  },
  tr: {
    title: "Sefer Durumu",
    stepOf: (s, t2) => `Adım ${s} / ${t2}`,
    confirmedNote: "Onaylanan adımlara göre",
    progress: "Yolculuk ilerlemesi",
    chat: "Sevkiyat Mesajları",
    chatAfterAccept: "Sevkiyat sohbeti, işi kabul etmenizden sonra açılır.",
    previous: "Önceki seferler",
    empty: "Şu anda aktif sefer yok",
    emptySub: "Aşağıdan bir teklifi cevaplayın — MARAS size bir sefer atadığında her şey burada görünecek.",
    loadOlder: "Daha eski seferleri yükle",
    loading: "Yükleniyor…",
    closedTag: "Salt okunur",
  },
  ar: {
    title: "تقدم الرحلة",
    stepOf: (s, t2) => `الخطوة ${s} من ${t2}`,
    confirmedNote: "وفق الخطوات المؤكدة",
    progress: "تقدم الرحلة",
    chat: "محادثة الشحنة",
    chatAfterAccept: "تعمل محادثة الشحنة بعد قبول العمل.",
    previous: "المهام السابقة",
    empty: "لا توجد مهمة نشطة حالياً",
    emptySub: "أجب على عرض أدناه — وعندما تخصص لك MARAS مهمة، سيظهر كل شيء عنها هنا.",
    loadOlder: "تحميل مهام أقدم",
    loading: "جارٍ التحميل…",
    closedTag: "للقراءة فقط",
  },
};

interface DriverActiveJobScreenProps {
  shipments: Shipment[];
  driverId: string;
  lang: Language;
  activeJob: Shipment | null;
  unreadByShipmentId: Record<string, number>;
  isSubmittingStatus: boolean;
  onSubmitNextStatus: (shipment: Shipment) => void;
  onAccept: (shipment: Shipment) => void;
  onDecline: (shipment: Shipment) => void;
  onOpenJob: (shipment: Shipment) => void;
  onOpenChat: (shipment: Shipment) => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  /** Offer sections (embedded — Offers is not a navigation tab). */
  offers: DriverOfferView[];
  highlightOfferId?: string | null;
  onOpenOffer: (offerId: string) => void;
  onRespondOffer: (offerId: string, action: "quote" | "reject", priceUsd?: number, note?: string) => Promise<boolean>;
}

export default function DriverActiveJobScreen({
  shipments,
  driverId,
  lang,
  activeJob,
  unreadByShipmentId,
  isSubmittingStatus,
  onSubmitNextStatus,
  onAccept,
  onDecline,
  onOpenJob,
  onOpenChat,
  hasMore,
  isLoadingMore,
  onLoadMore,
  offers,
  highlightOfferId = null,
  onOpenOffer,
  onRespondOffer,
}: DriverActiveJobScreenProps) {
  const t = LABELS[lang] ?? LABELS.en;
  const otherJobs = shipments.filter((s) => s.id !== activeJob?.id);
  const progress = activeJob ? getJourneyProgress(activeJob.status, activeJob.freightType) : null;
  // Honest bar width: position of the CONFIRMED current step within its
  // own sequence. Never GPS-derived, never a guessed percentage.
  const progressPct = progress && progress.total > 0 ? Math.round(((progress.index + 1) / progress.total) * 100) : 0;

  return (
    <div className="space-y-5 animate-fade-in pb-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className={SCREEN_TITLE}>{t.title}</h2>
        {activeJob && (
          <span className="text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-3 py-1 tabular-nums selectable">
            {activeJob.shipmentNumber}
          </span>
        )}
      </div>

      {/* ── 1. The active/assigned job ── */}
      {activeJob ? (
        <div className="space-y-3">
          {progress && progress.index > 0 && (
            <div className={`${HERO_CARD} p-5`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[15px] font-extrabold text-slate-900 tabular-nums">{t.stepOf(progress.index + 1, progress.total)}</span>
                <span className="text-xs font-semibold text-slate-400">{t.confirmedNote}</span>
              </div>
              <div className="h-2.5 rounded-full bg-slate-100 mt-3 overflow-hidden">
                <div
                  className="h-full rounded-full bg-green-600 transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          <section className={`${CARD} p-5`}>
            <h3 className={`${SECTION_LABEL} mb-4`}>{t.progress}</h3>
            <DriverStatusTimeline shipment={activeJob} lang={lang} />
          </section>

          <DriverNextAction
            shipment={activeJob}
            lang={lang}
            isSubmitting={isSubmittingStatus}
            onSubmitNextStatus={() => onSubmitNextStatus(activeJob)}
            onAccept={() => onAccept(activeJob)}
            onDecline={() => onDecline(activeJob)}
            agreedAmount={resolveDriverAgreedAmount(activeJob, driverId)}
            currency={activeJob.currency}
          />

          {/* One conversation shortcut — everything (files, photos,
              instructions) travels through the shipment chat. The
              conversation exists only after acceptance; before it, a
              short note says when it opens (kept after closure so the
              read-only history stays reachable). */}
          {isDriverChatAvailable(activeJob.status) ? (
            <button
              type="button"
              onClick={() => onOpenChat(activeJob)}
              className="w-full min-h-[56px] rounded-2xl bg-white border border-blue-200 text-blue-700 font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer shadow-[0_1px_2px_rgba(15,27,45,0.03)]"
            >
              <MessageSquare className="w-4 h-4 shrink-0" />
              <span>{t.chat}</span>
              {(unreadByShipmentId[activeJob.id] || 0) > 0 && (
                <span className="bg-orange-500 text-white text-xs font-bold rounded-full px-2 py-0.5">
                  {unreadByShipmentId[activeJob.id]}
                </span>
              )}
            </button>
          ) : (
            <p className="text-sm text-slate-400 text-start px-1">{t.chatAfterAccept}</p>
          )}
        </div>
      ) : (
        offers.length === 0 && (
          <div className={`py-12 text-center space-y-4 ${CARD} p-6`}>
            <div className="w-14 h-14 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center mx-auto">
              <Briefcase className="w-7 h-7 text-slate-300 shrink-0" />
            </div>
            <div>
              <p className="text-base font-bold text-slate-800">{t.empty}</p>
              <p className="text-sm text-slate-500 mt-1.5 leading-relaxed max-w-[260px] mx-auto">{t.emptySub}</p>
            </div>
          </div>
        )
      )}

      {/* ── 2–4. Offers: new → submitted → recently decided ── */}
      <DriverOffersScreen
        lang={lang}
        offers={offers}
        hasActiveJob={!!activeJob}
        highlightOfferId={highlightOfferId}
        onOpenOffer={onOpenOffer}
        onRespond={onRespondOffer}
      />

      {/* ── 5. Previous jobs — compact and secondary ── */}
      {otherJobs.length > 0 && (
        <section className="space-y-2.5">
          <h3 className={SECTION_LABEL}>{t.previous}</h3>
          {otherJobs.map((s) => {
            const closed = isShipmentClosed(s.status, s.freightType);
            const unread = unreadByShipmentId[s.id] || 0;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onOpenJob(s)}
                className={`${LIST_ROW} p-3.5 space-y-2 ${closed ? "opacity-70" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-bold text-slate-700 tabular-nums selectable truncate">#{s.shipmentNumber}</span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {unread > 0 && (
                      <span className="inline-flex items-center gap-1 bg-orange-500 text-white text-xs font-bold rounded-full px-2 py-0.5">
                        <MessageSquare className="w-3 h-3" />
                        {unread > 9 ? "9+" : unread}
                      </span>
                    )}
                    {closed && (
                      <span className="text-[11px] font-bold text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-2 py-0.5">
                        {t.closedTag}
                      </span>
                    )}
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${getStatusChipClasses(s.status, s.freightType)}`}>
                      {localizeShipmentStatus(s.status, lang)}
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-2.5 text-sm">
                  <RouteBlock fromCity={s.loadingCity} toCity={s.deliveryCity} />
                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 ms-auto rtl:rotate-180" />
                </div>
              </button>
            );
          })}
          {hasMore && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={onLoadMore}
                disabled={isLoadingMore}
                className={`px-5 ${BTN_QUIET} min-h-[48px] bg-white border border-slate-200 hover:border-slate-300 text-sm`}
              >
                {isLoadingMore ? t.loading : t.loadOlder}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
