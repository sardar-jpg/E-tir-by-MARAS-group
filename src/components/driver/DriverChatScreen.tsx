import { useRef, useState, type FormEvent, type RefObject } from "react";
import { Camera, FileText, Image as ImageIcon, Loader2, Lock, MessageSquare, Paperclip, Search, Send, X } from "lucide-react";
import type { ChatMessage, Language, Shipment } from "../../types";
import { MAX_CHAT_TEXT_LENGTH } from "../../lib/chatMessageValidation";
import { canSubmitChatMessage } from "../../lib/chatComposerState";
import { shouldShowDateSeparator, formatDateSeparatorLabel } from "../../lib/chatDisplay";
import { getStatusChipClasses, localizeShipmentStatus } from "./driverUi";

/**
 * feature/driver-app-comprehensive-redesign — the Chat screen, shaped
 * like a normal messenger: job thread selector on top, clear MARAS vs
 * driver bubbles, one attachment button for photos and documents, and a
 * composer that locks the moment the shipment is closed (server-side
 * SHIPMENT_CHAT_CLOSED remains authoritative — the container refreshes
 * and this composer locks on a 409). Delivered does NOT lock chat; only
 * the freight-mode closing status does (isShipmentClosed via the
 * container's isChatClosed prop). All polling/pagination/upload/retry
 * logic stays in the container — this component only renders state.
 */
const LABELS: Record<Language, {
  title: string;
  noJobs: string;
  noJobsSub: string;
  empty: string;
  emptyClosed: string;
  searchPlaceholder: string;
  searchToggle: string;
  noResults: (q: string) => string;
  loadOlder: string;
  closedBanner: string;
  typeMessage: string;
  attach: string;
  attachSheetTitle: string;
  attachSheetNote: string;
  attachCamera: string;
  attachGallery: string;
  attachFiles: string;
  recentAttachments: string;
  send: string;
  seen: string;
  sent: string;
  maras: string;
  you: string;
  retry: string;
  uploadFailed: string;
  sendFailed: string;
  loadingOlder: string;
}> = {
  en: {
    title: "Chat with MARAS",
    noJobs: "No conversations yet",
    noJobsSub: "When you have a job, you can message MARAS Operations here.",
    empty: "No messages yet. Say hello to MARAS Operations!",
    emptyClosed: "No messages in this conversation.",
    searchPlaceholder: "Search messages…",
    searchToggle: "Search",
    noResults: (q) => `No messages match "${q}".`,
    loadOlder: "Load older messages",
    closedBanner: "This job is closed. The conversation is now read-only.",
    typeMessage: "Type a message…",
    attach: "Attach",
    attachSheetTitle: "Attach to chat",
    attachSheetNote: "Files and photos you attach here are shared with MARAS Operations in this chat.",
    attachCamera: "Camera",
    attachGallery: "Gallery",
    attachFiles: "Files",
    recentAttachments: "Recent attachments",
    send: "Send",
    seen: "Seen",
    sent: "Sent",
    maras: "MARAS",
    you: "You",
    retry: "Retry",
    uploadFailed: "The file couldn't be uploaded. Nothing was sent — please try again.",
    sendFailed: "The file was uploaded but the message didn't send.",
    loadingOlder: "Loading…",
  },
  tr: {
    title: "MARAS ile Mesajlaş",
    noJobs: "Henüz konuşma yok",
    noJobsSub: "Bir seferiniz olduğunda MARAS Operasyon ile buradan yazışabilirsiniz.",
    empty: "Henüz mesaj yok. MARAS Operasyon'a merhaba deyin!",
    emptyClosed: "Bu konuşmada mesaj yok.",
    searchPlaceholder: "Mesajlarda ara…",
    searchToggle: "Ara",
    noResults: (q) => `"${q}" ile eşleşen mesaj yok.`,
    loadOlder: "Eski mesajları yükle",
    closedBanner: "İş kapatıldı. Görüşme artık salt okunur.",
    typeMessage: "Bir mesaj yazın…",
    attach: "Ekle",
    attachSheetTitle: "Sohbete ekle",
    attachSheetNote: "Buradan eklediğiniz dosya ve fotoğraflar bu sohbette MARAS Operasyon ile paylaşılır.",
    attachCamera: "Kamera",
    attachGallery: "Galeri",
    attachFiles: "Dosyalar",
    recentAttachments: "Son ekler",
    send: "Gönder",
    seen: "Görüldü",
    sent: "Gönderildi",
    maras: "MARAS",
    you: "Siz",
    retry: "Tekrar dene",
    uploadFailed: "Dosya yüklenemedi. Hiçbir şey gönderilmedi — lütfen tekrar deneyin.",
    sendFailed: "Dosya yüklendi ancak mesaj gönderilemedi.",
    loadingOlder: "Yükleniyor…",
  },
  ar: {
    title: "مراسلة MARAS",
    noJobs: "لا توجد محادثات بعد",
    noJobsSub: "عندما تكون لديك مهمة، يمكنك مراسلة عمليات MARAS هنا.",
    empty: "لا توجد رسائل بعد. رحّب بعمليات MARAS!",
    emptyClosed: "لا توجد رسائل في هذه المحادثة.",
    searchPlaceholder: "البحث في الرسائل…",
    searchToggle: "بحث",
    noResults: (q) => `لا توجد رسائل مطابقة لـ "${q}".`,
    loadOlder: "تحميل الرسائل الأقدم",
    closedBanner: "تم إغلاق العمل. أصبحت المحادثة للقراءة فقط.",
    typeMessage: "اكتب رسالة…",
    attach: "إرفاق",
    attachSheetTitle: "إرفاق إلى الدردشة",
    attachSheetNote: "الملفات والصور التي ترفقها هنا تُشارك مع عمليات MARAS في هذه المحادثة.",
    attachCamera: "الكاميرا",
    attachGallery: "المعرض",
    attachFiles: "الملفات",
    recentAttachments: "آخر المرفقات",
    send: "إرسال",
    seen: "تمت المشاهدة",
    sent: "تم الإرسال",
    maras: "MARAS",
    you: "أنت",
    retry: "إعادة المحاولة",
    uploadFailed: "تعذر رفع الملف. لم يتم إرسال أي شيء — حاول مرة أخرى.",
    sendFailed: "تم رفع الملف لكن تعذر إرسال الرسالة.",
    loadingOlder: "جارٍ التحميل…",
  },
};

interface DriverChatScreenProps {
  lang: Language;
  jobs: Shipment[];
  activeShipment: Shipment | null;
  onSelectJob: (shipment: Shipment) => void;
  unreadByShipmentId: Record<string, number>;
  visibleMessages: ChatMessage[];
  totalMessageCount: number;
  isChatClosed: boolean;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  hasOlderMessages: boolean;
  isLoadingOlder: boolean;
  onLoadOlder: () => void;
  newMessageText: string;
  onNewMessageTextChange: (value: string) => void;
  onSendMessage: (e: FormEvent) => void;
  isSending: boolean;
  isUploading: boolean;
  onAttachmentSelected: (e: React.ChangeEvent<HTMLInputElement>) => void;
  attachmentError: "" | "upload" | "send";
  canRetryAttachment: boolean;
  onRetryAttachment: () => void;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onMessagesScroll: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  composerMinHeightPx: number;
  composerMaxHeightPx: number;
}

export default function DriverChatScreen(props: DriverChatScreenProps) {
  const {
    lang, jobs, activeShipment, onSelectJob, unreadByShipmentId,
    visibleMessages, totalMessageCount, isChatClosed,
    searchQuery, onSearchQueryChange,
    hasOlderMessages, isLoadingOlder, onLoadOlder,
    newMessageText, onNewMessageTextChange, onSendMessage, isSending,
    isUploading, onAttachmentSelected, attachmentError, canRetryAttachment, onRetryAttachment,
    messagesContainerRef, messagesEndRef, onMessagesScroll,
    textareaRef, composerMinHeightPx, composerMaxHeightPx,
  } = props;
  const t = LABELS[lang] ?? LABELS.en;
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [showSearch, setShowSearch] = useState(false);
  // Revision A: the paperclip opens an in-chat "Attach to chat" sheet
  // (Camera / Gallery / Files) — all three routes feed the SAME existing
  // onAttachmentSelected upload flow; nothing new is stored anywhere else.
  const [showAttachSheet, setShowAttachSheet] = useState(false);
  const recentAttachments = visibleMessages.filter((m) => m.type === "file").slice(-2).reverse();

  if (jobs.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <div className="w-14 h-14 bg-white border border-slate-200 rounded-2xl flex items-center justify-center mx-auto">
            <MessageSquare className="w-7 h-7 text-slate-600 shrink-0" />
          </div>
          <div>
            <p className="text-base font-bold text-slate-800">{t.noJobs}</p>
            <p className="text-sm text-slate-400 mt-1.5 max-w-[260px] mx-auto leading-relaxed">{t.noJobsSub}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0 relative">
      {/* Job thread selector */}
      <div className="shrink-0 px-3 pt-2 pb-2.5 border-b border-slate-200 bg-slate-50 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-900 text-start">{t.title}</h2>
          <button
            type="button"
            aria-label={t.searchToggle}
            onClick={() => {
              setShowSearch((v) => {
                if (v) onSearchQueryChange("");
                return !v;
              });
            }}
            className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-colors cursor-pointer ${
              showSearch ? "bg-orange-50 border-orange-200 text-orange-600" : "bg-white border-slate-200 text-slate-500 hover:text-slate-900"
            }`}
          >
            {showSearch ? <X className="w-4 h-4" /> : <Search className="w-4 h-4" />}
          </button>
        </div>

        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {jobs.map((job) => {
            const isActive = activeShipment?.id === job.id;
            const unread = unreadByShipmentId[job.id] || 0;
            return (
              <button
                key={job.id}
                type="button"
                onClick={() => onSelectJob(job)}
                className={`relative shrink-0 px-3 min-h-[44px] rounded-2xl border text-sm font-bold transition-colors cursor-pointer ${
                  isActive
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
                }`}
              >
                #{job.shipmentNumber}
                {unread > 0 && (
                  <span className="absolute -top-1 -end-1 min-w-[18px] h-[18px] px-1 rounded-full bg-orange-500 text-white text-[10px] font-bold leading-[18px] text-center">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {activeShipment && (
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${getStatusChipClasses(activeShipment.status, activeShipment.freightType)}`}>
              {localizeShipmentStatus(activeShipment.status, lang)}
            </span>
            <span className="text-xs text-slate-400 font-semibold truncate">
              {activeShipment.loadingCity} → {activeShipment.deliveryCity}
            </span>
          </div>
        )}

        {showSearch && (
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-2xl px-3">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              type="text"
              autoFocus
              placeholder={t.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              className="bg-transparent text-sm text-slate-800 placeholder-slate-400 focus:outline-none w-full min-h-[44px] border-0"
            />
          </div>
        )}
      </div>

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        onScroll={onMessagesScroll}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3"
      >
        {hasOlderMessages && !searchQuery.trim() && (
          <div className="flex justify-center pb-1">
            <button
              type="button"
              onClick={onLoadOlder}
              disabled={isLoadingOlder}
              className="text-xs font-bold text-slate-500 hover:text-slate-900 bg-white border border-slate-200 rounded-full px-4 min-h-[36px] cursor-pointer disabled:opacity-50"
            >
              {isLoadingOlder ? t.loadingOlder : t.loadOlder}
            </button>
          </div>
        )}

        {visibleMessages.map((msg, index) => {
          const isMe = msg.sender === "driver";
          const showDateSeparator = shouldShowDateSeparator(msg.timestamp, visibleMessages[index - 1]?.timestamp);
          return (
            <div key={msg.id}>
              {showDateSeparator && (
                <div className="flex items-center justify-center py-2">
                  <span className="px-3 py-1 rounded-full bg-white text-slate-400 text-xs font-semibold">
                    {formatDateSeparatorLabel(msg.timestamp, lang)}
                  </span>
                </div>
              )}
              <div className={`flex flex-col max-w-[85%] ${isMe ? "ms-auto items-end" : "me-auto items-start"}`}>
                <span className={`text-xs font-semibold mb-1 ${isMe ? "text-slate-400" : "text-slate-500"}`}>
                  {isMe ? t.you : `${t.maras} · ${msg.senderName}`}
                </span>
                <div
                  className={`px-3.5 py-2.5 rounded-2xl text-[15px] leading-relaxed break-words max-w-full ${
                    isMe
                      ? "bg-blue-600 text-white rounded-se-md"
                      : "bg-white border border-slate-200 text-slate-800 rounded-ss-md"
                  }`}
                >
                  {msg.type === "file" ? (
                    <div className="space-y-2">
                      <a
                        href={msg.fileUrl || "#"}
                        target="_blank"
                        rel="noreferrer"
                        download={msg.fileName || "document"}
                        className="font-bold underline cursor-pointer flex items-center gap-1.5 break-all"
                      >
                        <FileText className={`w-4 h-4 shrink-0 ${isMe ? "text-white" : "text-slate-500"}`} />
                        <span>{msg.fileName}</span>
                      </a>
                      {((msg.fileCategory === "photo" || msg.fileName?.match(/\.(jpeg|jpg|gif|png|webp)/i)) && msg.fileUrl && msg.fileUrl !== "#") && (
                        <div className="mt-1 rounded-xl overflow-hidden border border-slate-200 max-w-[200px]">
                          <img
                            src={msg.fileUrl}
                            alt={msg.fileName}
                            className="w-full h-auto object-cover max-h-[140px]"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="selectable">{msg.text}</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-400 tabular-nums">
                  <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  {isMe && (
                    <span className={msg.status === "seen" ? "text-emerald-600 font-semibold" : ""}>
                      {msg.status === "seen" ? `✓✓ ${t.seen}` : `✓ ${t.sent}`}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {totalMessageCount === 0 && (
          <div className="py-16 text-center text-slate-400 text-sm px-6">
            {isChatClosed ? t.emptyClosed : t.empty}
          </div>
        )}
        {totalMessageCount > 0 && visibleMessages.length === 0 && (
          <div className="py-10 text-center text-slate-400 text-sm px-6">{t.noResults(searchQuery)}</div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Attachment failure banner (only when the composer is open) */}
      {!isChatClosed && attachmentError && (
        <div className="shrink-0 px-3.5 py-2 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2 text-xs font-semibold">
          <span className="text-red-600 text-start">
            {attachmentError === "upload" ? t.uploadFailed : t.sendFailed}
          </span>
          {canRetryAttachment && (
            <button
              type="button"
              onClick={onRetryAttachment}
              disabled={isUploading}
              className="shrink-0 min-h-[36px] px-3 rounded-xl border border-orange-200 text-orange-600 hover:text-orange-300 disabled:opacity-50 cursor-pointer"
            >
              {t.retry}
            </button>
          )}
        </div>
      )}

      {/* Composer / read-only lock */}
      {isChatClosed ? (
        <div className="shrink-0 p-4 bg-slate-50 border-t border-slate-200 flex items-center gap-2.5 text-slate-500 text-sm">
          <Lock className="w-4 h-4 shrink-0" />
          <span className="text-start">{t.closedBanner}</span>
        </div>
      ) : (
        <form onSubmit={onSendMessage} className="shrink-0 bg-slate-50 p-3 border-t border-slate-200 flex items-end gap-2">
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => { setShowAttachSheet(false); onAttachmentSelected(e); }}
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { setShowAttachSheet(false); onAttachmentSelected(e); }}
          />
          <input
            ref={attachmentInputRef}
            type="file"
            accept="image/*,application/pdf,.doc,.docx"
            className="hidden"
            onChange={(e) => { setShowAttachSheet(false); onAttachmentSelected(e); }}
          />
          <button
            type="button"
            onClick={() => setShowAttachSheet(true)}
            disabled={isUploading || isSending}
            aria-label={t.attach}
            title={t.attach}
            className="w-12 h-12 shrink-0 bg-white border border-slate-200 hover:border-slate-300 text-slate-500 hover:text-slate-900 rounded-full transition-all cursor-pointer flex items-center justify-center active:scale-95 disabled:opacity-50"
          >
            {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Paperclip className="w-5 h-5 shrink-0" />}
          </button>

          <textarea
            ref={textareaRef}
            rows={1}
            placeholder={t.typeMessage}
            value={newMessageText}
            onChange={(e) => onNewMessageTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSendMessage(e);
              }
            }}
            maxLength={MAX_CHAT_TEXT_LENGTH}
            disabled={isSending}
            style={{ minHeight: composerMinHeightPx, maxHeight: composerMaxHeightPx }}
            className="flex-1 px-4 py-3 bg-white border border-slate-200 focus:border-blue-400 outline-none rounded-3xl text-[15px] text-slate-900 placeholder-slate-400 transition-colors disabled:opacity-60 resize-none overflow-y-auto leading-normal"
          />

          <button
            type="submit"
            disabled={!canSubmitChatMessage({ text: newMessageText, hasAttachment: false, isSending, isLocked: isChatClosed })}
            aria-label={t.send}
            className="w-12 h-12 shrink-0 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-[0_6px_16px_-6px_rgba(37,99,235,0.55)] transition-all cursor-pointer flex items-center justify-center disabled:opacity-40 active:scale-95"
          >
            <Send className="w-5 h-5 shrink-0 rtl:-scale-x-100" />
          </button>
        </form>
      )}

      {/* ── "Attach to chat" sheet (Revision A) — neutral wording only.
          All three routes feed the SAME existing attachment upload flow;
          files stay inside this shipment chat. No Documents module. ── */}
      {showAttachSheet && !isChatClosed && (
        <div className="absolute inset-0 z-[60] flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={t.attachSheetTitle}>
          <button
            type="button"
            aria-label={t.attachSheetTitle}
            onClick={() => setShowAttachSheet(false)}
            className="absolute inset-0 bg-slate-900/45 cursor-pointer border-0"
          />
          <div className="relative bg-white rounded-t-3xl px-5 pt-2.5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_-20px_60px_rgba(15,27,45,0.25)] animate-fade-in">
            <div className="w-11 h-1.5 rounded-full bg-slate-200 mx-auto mb-3.5" />
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-extrabold text-slate-900 text-start">{t.attachSheetTitle}</h3>
              <button
                type="button"
                aria-label={t.attachSheetTitle}
                onClick={() => setShowAttachSheet(false)}
                className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200 text-slate-500 flex items-center justify-center cursor-pointer active:scale-95"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[13px] text-slate-500 font-medium mt-1 text-start leading-snug">{t.attachSheetNote}</p>
            <div className="grid grid-cols-3 gap-2.5 mt-4">
              {[
                { icon: Camera, label: t.attachCamera, color: "text-blue-600", onPick: () => cameraInputRef.current?.click() },
                { icon: ImageIcon, label: t.attachGallery, color: "text-emerald-600", onPick: () => galleryInputRef.current?.click() },
                { icon: FileText, label: t.attachFiles, color: "text-amber-600", onPick: () => attachmentInputRef.current?.click() },
              ].map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={opt.onPick}
                  className="flex flex-col items-center gap-2 py-3.5 rounded-2xl bg-slate-50 border border-slate-200 hover:border-slate-300 transition-colors cursor-pointer active:scale-95"
                >
                  <opt.icon className={`w-6 h-6 ${opt.color}`} />
                  <span className="text-xs font-bold text-slate-600">{opt.label}</span>
                </button>
              ))}
            </div>
            {recentAttachments.length > 0 && (
              <>
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mt-5 mb-2 text-start">{t.recentAttachments}</p>
                <ul className="space-y-1.5">
                  {recentAttachments.map((m) => (
                    <li key={m.id}>
                      <a
                        href={m.fileUrl || "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-3 py-2 px-1 text-start cursor-pointer"
                      >
                        <span className="w-9 h-9 rounded-xl bg-red-50 text-red-500 flex items-center justify-center shrink-0">
                          <FileText className="w-4 h-4" />
                        </span>
                        <span className="min-w-0 flex-1 text-sm font-bold text-slate-800 truncate">{m.fileName}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
