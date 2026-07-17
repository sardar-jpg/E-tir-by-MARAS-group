import { FileText, FolderOpen, Image as ImageIcon, Send } from "lucide-react";
import type { Language, Shipment, ShipmentDocument } from "../../types";
import { getDocumentCategoryPolicy, listDocumentCategories } from "../../lib/shipmentDocuments";

/**
 * Driver App V2 — the Documents tab: ONE simple list of the current
 * job's documents, grouped by category. Built entirely on the unified
 * Shipment Documents model: groups, order, labels, and icons all come
 * from the DOCUMENT_CATEGORY_POLICIES registry — no category (CMR
 * included) has special UI logic here, and adding a category later
 * changes nothing in this file. The list itself is already filtered
 * server-side by the existing visibility policy
 * (isDocumentVisibleToDriver via buildShipmentViewForRole); nothing here
 * re-decides visibility. The driver's only upload path remains the chat
 * attachment flow (enforced server-side), so the upload action hands off
 * to chat rather than inventing a second upload pipeline.
 */
const LABELS: Record<Language, {
  title: string;
  forJob: string;
  empty: string;
  noJob: string;
  noJobSub: string;
  open: string;
  by: string;
  sendViaChat: string;
  sendViaChatSub: string;
}> = {
  en: {
    title: "Documents",
    forJob: "Job",
    empty: "No documents shared with you yet.",
    noJob: "No job selected",
    noJobSub: "Documents for your jobs appear here once MARAS assigns you one.",
    open: "Open",
    by: "By",
    sendViaChat: "Send a photo or document",
    sendViaChatSub: "Delivery papers and cargo photos go to MARAS through chat.",
  },
  tr: {
    title: "Belgeler",
    forJob: "Sefer",
    empty: "Henüz sizinle paylaşılan belge yok.",
    noJob: "Seçili sefer yok",
    noJobSub: "MARAS size bir sefer atadığında belgeleri burada görünecek.",
    open: "Aç",
    by: "Gönderen",
    sendViaChat: "Fotoğraf veya belge gönder",
    sendViaChatSub: "Teslimat evrakları ve yük fotoğrafları MARAS'a mesajlaşma üzerinden gönderilir.",
  },
  ar: {
    title: "المستندات",
    forJob: "المهمة",
    empty: "لا توجد مستندات تمت مشاركتها معك بعد.",
    noJob: "لا توجد مهمة محددة",
    noJobSub: "ستظهر هنا مستندات مهامك عندما تخصص لك MARAS مهمة.",
    open: "فتح",
    by: "من",
    sendViaChat: "إرسال صورة أو مستند",
    sendViaChatSub: "تُرسل أوراق التسليم وصور الحمولة إلى MARAS عبر المحادثة.",
  },
};

interface DriverDocumentsScreenProps {
  lang: Language;
  /** The job whose documents are listed (active job by default). */
  shipment: Shipment | null;
  onSendDocumentViaChat: () => void;
  /** Hidden once the shipment is closed — chat can no longer accept files. */
  canSendDocuments: boolean;
}

function DocumentRow({ doc, lang }: { doc: ShipmentDocument; lang: Language }) {
  const t = LABELS[lang] ?? LABELS.en;
  const policy = getDocumentCategoryPolicy(doc.category);
  const Icon = policy.sharesAsPhoto ? ImageIcon : FileText;
  return (
    <li>
      <a
        href={doc.url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-3 p-3 min-h-[60px] bg-slate-950 border border-slate-800 rounded-2xl hover:border-orange-500/40 transition-colors cursor-pointer"
      >
        <span className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-500 flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5" />
        </span>
        <span className="min-w-0 flex-1 text-start">
          <span className="block text-sm font-semibold text-slate-200 truncate">{doc.name}</span>
          <span className="block text-xs text-slate-500 truncate mt-0.5">
            {t.by} {doc.uploadedBy} · {new Date(doc.uploadedAt).toLocaleDateString()}
          </span>
        </span>
        <span className="text-xs font-bold text-slate-400 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 shrink-0">
          {t.open}
        </span>
      </a>
    </li>
  );
}

export default function DriverDocumentsScreen({
  lang,
  shipment,
  onSendDocumentViaChat,
  canSendDocuments,
}: DriverDocumentsScreenProps) {
  const t = LABELS[lang] ?? LABELS.en;
  const documents = shipment?.documents || [];

  return (
    <div className="space-y-4 animate-fade-in pb-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-2xl font-bold text-white text-start">{t.title}</h2>
        {shipment && (
          <span className="text-xs font-bold text-slate-400 bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 selectable">
            {t.forJob} #{shipment.shipmentNumber}
          </span>
        )}
      </div>

      {!shipment ? (
        <div className="py-12 text-center space-y-4 bg-slate-900 rounded-3xl p-6 border border-slate-800">
          <div className="w-14 h-14 rounded-full bg-slate-950 border border-slate-800 flex items-center justify-center mx-auto">
            <FolderOpen className="w-7 h-7 text-slate-600 shrink-0" />
          </div>
          <div>
            <p className="text-base font-bold text-slate-200">{t.noJob}</p>
            <p className="text-sm text-slate-500 mt-1.5 leading-relaxed max-w-[260px] mx-auto">{t.noJobSub}</p>
          </div>
        </div>
      ) : (
        <>
          {documents.length === 0 ? (
            <div className="py-10 text-center bg-slate-900 rounded-3xl p-6 border border-slate-800">
              <p className="text-sm text-slate-400 leading-relaxed max-w-[280px] mx-auto">{t.empty}</p>
            </div>
          ) : (
            /* One list, grouped by category, in registry order — every
               category (CMR included) rendered by the same code path. */
            listDocumentCategories().map((policy) => {
              const inCategory = documents.filter((d) => getDocumentCategoryPolicy(d.category).id === policy.id);
              if (inCategory.length === 0) return null;
              return (
                <section key={policy.id} className="space-y-2">
                  <h3 className="text-sm font-bold text-slate-400 text-start flex items-center gap-2">
                    {policy.label}
                    <span className="text-xs font-semibold text-slate-500 bg-slate-900 border border-slate-800 rounded-full px-2 py-0.5">
                      {inCategory.length}
                    </span>
                  </h3>
                  <ul className="space-y-2">
                    {inCategory.map((d) => (
                      <DocumentRow key={d.id} doc={d} lang={lang} />
                    ))}
                  </ul>
                </section>
              );
            })
          )}

          {canSendDocuments && (
            <button
              type="button"
              onClick={onSendDocumentViaChat}
              className="w-full flex items-center gap-3 p-3 min-h-[60px] bg-slate-900 border border-slate-700 border-dashed rounded-2xl hover:border-orange-500/50 text-start transition-colors cursor-pointer"
            >
              <span className="w-10 h-10 rounded-xl bg-slate-950 border border-slate-800 text-orange-500 flex items-center justify-center shrink-0">
                <Send className="w-5 h-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-slate-200">{t.sendViaChat}</span>
                <span className="block text-xs text-slate-500 mt-0.5 leading-snug">{t.sendViaChatSub}</span>
              </span>
            </button>
          )}
        </>
      )}
    </div>
  );
}
