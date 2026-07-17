import { ArrowRight, Briefcase, ChevronRight, FolderOpen, MessageSquare } from "lucide-react";
import type { Language, Shipment } from "../../types";
import DriverActiveJobCard from "./DriverActiveJobCard";
import DriverNextAction from "./DriverNextAction";
import DriverStatusTimeline from "./DriverStatusTimeline";
import { isShipmentClosed } from "../../lib/shipmentStatusTransitions";
import { getStatusChipClasses, localizeShipmentStatus } from "./driverUi";

/**
 * Driver App V2 — the Job tab: a step-based experience for the ONE
 * active job (route, the driver's own agreed payment, current status,
 * progress steps, the single next action, and chat/documents shortcuts).
 * Status progression logic is untouched — DriverNextAction still submits
 * through the exact same forward-only workflow; this screen only changes
 * how it is presented. Earlier jobs stay reachable below as a compact
 * read-mostly list (tap → full details), so nothing the old Jobs list
 * offered is lost.
 */
const LABELS: Record<Language, {
  title: string;
  progress: string;
  chat: string;
  documents: string;
  previous: string;
  empty: string;
  emptySub: string;
  loadOlder: string;
  loading: string;
  closedTag: string;
}> = {
  en: {
    title: "Active Job",
    progress: "Journey progress",
    chat: "Chat with MARAS",
    documents: "Documents",
    previous: "Previous jobs",
    empty: "No active job right now",
    emptySub: "When MARAS assigns you a job, everything about it will appear here.",
    loadOlder: "Load older jobs",
    loading: "Loading…",
    closedTag: "Read-only",
  },
  tr: {
    title: "Aktif Sefer",
    progress: "Yolculuk ilerlemesi",
    chat: "MARAS ile mesajlaş",
    documents: "Belgeler",
    previous: "Önceki seferler",
    empty: "Şu anda aktif sefer yok",
    emptySub: "MARAS size bir sefer atadığında her şey burada görünecek.",
    loadOlder: "Daha eski seferleri yükle",
    loading: "Yükleniyor…",
    closedTag: "Salt okunur",
  },
  ar: {
    title: "المهمة النشطة",
    progress: "تقدم الرحلة",
    chat: "محادثة مع MARAS",
    documents: "المستندات",
    previous: "المهام السابقة",
    empty: "لا توجد مهمة نشطة حالياً",
    emptySub: "عندما تخصص لك MARAS مهمة، سيظهر كل شيء عنها هنا.",
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
  onOpenDocuments: (shipment: Shipment) => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
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
  onOpenDocuments,
  hasMore,
  isLoadingMore,
  onLoadMore,
}: DriverActiveJobScreenProps) {
  const t = LABELS[lang] ?? LABELS.en;
  const otherJobs = shipments.filter((s) => s.id !== activeJob?.id);

  return (
    <div className="space-y-5 animate-fade-in pb-4">
      <h2 className="text-2xl font-bold text-white text-start">{t.title}</h2>

      {activeJob ? (
        <div className="space-y-3">
          {/* Summary: route, payment, status, chat/details shortcuts */}
          <DriverActiveJobCard
            shipment={activeJob}
            driverId={driverId}
            lang={lang}
            onOpenChat={() => onOpenChat(activeJob)}
            onOpenDetails={() => onOpenJob(activeJob)}
          />

          {/* The ONE next action (accept/decline or the single forward step) */}
          <DriverNextAction
            shipment={activeJob}
            lang={lang}
            isSubmitting={isSubmittingStatus}
            onSubmitNextStatus={() => onSubmitNextStatus(activeJob)}
            onAccept={() => onAccept(activeJob)}
            onDecline={() => onDecline(activeJob)}
          />

          {/* Step progress */}
          <section className="bg-slate-900 border border-slate-800 rounded-3xl p-4">
            <h3 className="text-sm font-bold text-slate-300 text-start mb-3">{t.progress}</h3>
            <DriverStatusTimeline shipment={activeJob} lang={lang} />
          </section>

          {/* Shortcuts */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onOpenChat(activeJob)}
              className="min-h-[56px] rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-600 text-slate-200 font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer"
            >
              <MessageSquare className="w-4 h-4 text-orange-500 shrink-0" />
              <span>{t.chat}</span>
              {(unreadByShipmentId[activeJob.id] || 0) > 0 && (
                <span className="bg-orange-500 text-white text-xs font-bold rounded-full px-2 py-0.5 light-preserve">
                  {unreadByShipmentId[activeJob.id]}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => onOpenDocuments(activeJob)}
              className="min-h-[56px] rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-600 text-slate-200 font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer"
            >
              <FolderOpen className="w-4 h-4 text-orange-500 shrink-0" />
              <span>{t.documents}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="py-12 text-center space-y-4 bg-slate-900 rounded-3xl p-6 border border-slate-800">
          <div className="w-14 h-14 rounded-full bg-slate-950 border border-slate-800 flex items-center justify-center mx-auto">
            <Briefcase className="w-7 h-7 text-slate-600 shrink-0" />
          </div>
          <div>
            <p className="text-base font-bold text-slate-200">{t.empty}</p>
            <p className="text-sm text-slate-500 mt-1.5 leading-relaxed max-w-[260px] mx-auto">{t.emptySub}</p>
          </div>
        </div>
      )}

      {/* Previous / other jobs — compact, tap for full details */}
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
