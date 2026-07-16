import { FileText, Image as ImageIcon, Send } from "lucide-react";
import type { Language, ShipmentDocument } from "../../types";

/**
 * feature/driver-app-comprehensive-redesign — documents section of the
 * job details view. Shows the documents MARAS shared with this driver
 * (the list is already filtered server-side by isDocumentVisibleToDriver
 * — buildShipmentViewForRole; nothing here re-decides visibility). The
 * driver's only upload path remains the chat attachment flow (photo /
 * general document — CMR and other controlled categories are not
 * creatable by drivers, enforced server-side), so the upload action here
 * hands off to chat rather than inventing a second upload pipeline.
 */
const LABELS: Record<Language, {
  empty: string;
  view: string;
  sendViaChat: string;
  sendViaChatSub: string;
}> = {
  en: {
    empty: "No documents shared with you yet.",
    view: "Open",
    sendViaChat: "Send a photo or document",
    sendViaChatSub: "Delivery papers and cargo photos go to MARAS through chat.",
  },
  tr: {
    empty: "Henüz sizinle paylaşılan belge yok.",
    view: "Aç",
    sendViaChat: "Fotoğraf veya belge gönder",
    sendViaChatSub: "Teslimat evrakları ve yük fotoğrafları MARAS'a mesajlaşma üzerinden gönderilir.",
  },
  ar: {
    empty: "لا توجد مستندات تمت مشاركتها معك بعد.",
    view: "فتح",
    sendViaChat: "إرسال صورة أو مستند",
    sendViaChatSub: "تُرسل أوراق التسليم وصور الحمولة إلى MARAS عبر المحادثة.",
  },
};

interface DriverDocumentSectionProps {
  documents: ShipmentDocument[];
  lang: Language;
  /** Opens the chat thread for this job so the driver can attach a file there. */
  onSendDocumentViaChat: () => void;
  /** Hidden once the shipment is closed — chat can no longer accept files. */
  canSendDocuments: boolean;
}

export default function DriverDocumentSection({
  documents,
  lang,
  onSendDocumentViaChat,
  canSendDocuments,
}: DriverDocumentSectionProps) {
  const t = LABELS[lang] ?? LABELS.en;

  return (
    <div className="space-y-3">
      {documents.length > 0 ? (
        <ul className="space-y-2">
          {documents.map((d) => (
            <li key={d.id}>
              <a
                href={d.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 p-3 min-h-[56px] bg-slate-950 border border-slate-800 rounded-2xl hover:border-orange-500/40 transition-colors cursor-pointer"
              >
                <span className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-500 flex items-center justify-center shrink-0">
                  {d.category === "photo" ? <ImageIcon className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                </span>
                <span className="min-w-0 flex-1 text-start">
                  <span className="block text-sm font-semibold text-slate-200 truncate">{d.name}</span>
                  <span className="block text-xs text-slate-500 uppercase mt-0.5">{d.category}</span>
                </span>
                <span className="text-xs font-bold text-slate-400 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 shrink-0">
                  {t.view}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500 text-start py-2">{t.empty}</p>
      )}

      {canSendDocuments && (
        <button
          type="button"
          onClick={onSendDocumentViaChat}
          className="w-full flex items-center gap-3 p-3 min-h-[56px] bg-slate-900 border border-slate-700 border-dashed rounded-2xl hover:border-orange-500/50 text-start transition-colors cursor-pointer"
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
    </div>
  );
}
