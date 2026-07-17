import { ArrowRight, Briefcase, ChevronRight, MessageSquare } from "lucide-react";
import type { Language, Shipment } from "../../types";
import type { DriverOfferView } from "../../lib/driverAlliance";
import DriverActiveJobCard from "./DriverActiveJobCard";
import DriverNextAction from "./DriverNextAction";
import DriverStatusTimeline from "./DriverStatusTimeline";
import DriverOffersScreen from "./DriverOffersScreen";
import { isShipmentClosed } from "../../lib/shipmentStatusTransitions";
import { isDriverChatAvailable } from "../../lib/driverJobFlow";
import { getStatusChipClasses, localizeShipmentStatus } from "./driverUi";

/**
 * Driver App V2 — the Job tab is the ONE operational center, in strict
 * priority order:
 *   1. the active/assigned job (step-based: summary, the single next
 *      action — accept/decline included — journey progress, and the
 *      shipment-chat shortcut),
 *   2. new offers awaiting an answer,
 *   3. submitted quotations awaiting MARAS's decision,
 *   4. recently decided offers (read-only),
 *   5. previous jobs, compact and secondary.
 * Offer rendering lives in DriverOffersScreen (embedded, not a tab);
 * status progression logic is untouched — this screen only presents it.
 * Documents flow exclusively through the shipment chat (and the job
 * details view); there is no separate documents section.
 */
const LABELS: Record<Language, {
  title: string;
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
    title: "Job",
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
    title: "Sefer",
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
    title: "المهمة",
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

  return (
    <div className="space-y-5 animate-fade-in pb-4">
      <h2 className="text-2xl font-bold text-white text-start">{t.title}</h2>

      {/* ── 1. The active/assigned job ── */}
      {activeJob ? (
        <div className="space-y-3">
          <DriverActiveJobCard
            shipment={activeJob}
            driverId={driverId}
            lang={lang}
            onOpenChat={() => onOpenChat(activeJob)}
            onOpenDetails={() => onOpenJob(activeJob)}
          />
          <DriverNextAction
            shipment={activeJob}
            lang={lang}
            isSubmitting={isSubmittingStatus}
            onSubmitNextStatus={() => onSubmitNextStatus(activeJob)}
            onAccept={() => onAccept(activeJob)}
            onDecline={() => onDecline(activeJob)}
          />
          <section className="bg-slate-900 border border-slate-800 rounded-3xl p-4">
            <h3 className="text-sm font-bold text-slate-300 text-start mb-3">{t.progress}</h3>
            <DriverStatusTimeline shipment={activeJob} lang={lang} />
          </section>
          {/* One conversation shortcut — everything (documents, photos,
              instructions) travels through the shipment chat. The
              conversation exists only after acceptance; before it, a
              short note says when it opens (kept after closure so the
              read-only history stays reachable). */}
          {isDriverChatAvailable(activeJob.status) ? (
            <button
              type="button"
              onClick={() => onOpenChat(activeJob)}
              className="w-full min-h-[56px] rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-600 text-slate-200 font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer"
            >
              <MessageSquare className="w-4 h-4 text-orange-500 shrink-0" />
              <span>{t.chat}</span>
              {(unreadByShipmentId[activeJob.id] || 0) > 0 && (
                <span className="bg-orange-500 text-white text-xs font-bold rounded-full px-2 py-0.5 light-preserve">
                  {unreadByShipmentId[activeJob.id]}
                </span>
              )}
            </button>
          ) : (
            <p className="text-sm text-slate-500 text-start px-1">{t.chatAfterAccept}</p>
          )}
        </div>
      ) : (
        offers.length === 0 && (
          <div className="py-12 text-center space-y-4 bg-slate-900 rounded-3xl p-6 border border-slate-800">
            <div className="w-14 h-14 rounded-full bg-slate-950 border border-slate-800 flex items-center justify-center mx-auto">
              <Briefcase className="w-7 h-7 text-slate-600 shrink-0" />
            </div>
            <div>
              <p className="text-base font-bold text-slate-200">{t.empty}</p>
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
          <h3 className="text-sm font-bold text-slate-400 text-start">{t.previous}</h3>
          {otherJobs.map((s) => {
            const closed = isShipmentClosed(s.status, s.freightType);
            const unread = unreadByShipmentId[s.id] || 0;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onOpenJob(s)}
                className={`w-full text-start bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2 transition-all cursor-pointer active:scale-[0.99] hover:border-slate-600 ${closed ? "opacity-75" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-white selectable truncate">#{s.shipmentNumber}</span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {unread > 0 && (
                      <span className="inline-flex items-center gap-1 bg-orange-500 text-white text-xs font-bold rounded-full px-2 py-0.5 light-preserve">
                        <MessageSquare className="w-3 h-3" />
                        {unread > 9 ? "9+" : unread}
                      </span>
                    )}
                    {closed && (
                      <span className="text-[11px] font-bold text-slate-400 bg-slate-950 border border-slate-800 rounded-full px-2 py-0.5">
                        {t.closedTag}
                      </span>
                    )}
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${getStatusChipClasses(s.status, s.freightType)}`}>
                      {localizeShipmentStatus(s.status, lang)}
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-2.5 text-sm">
                  <span className="font-bold text-slate-200 truncate">{s.loadingCity || "—"}</span>
                  <ArrowRight className="w-4 h-4 text-orange-500 shrink-0 rtl:rotate-180" />
                  <span className="font-bold text-slate-200 truncate">{s.deliveryCity || "—"}</span>
                  <ChevronRight className="w-4 h-4 text-slate-500 shrink-0 ms-auto rtl:rotate-180" />
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
                className="px-5 min-h-[48px] bg-slate-900 border border-slate-700 hover:border-slate-600 text-slate-300 text-sm font-bold rounded-2xl transition-all disabled:opacity-50 cursor-pointer"
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
