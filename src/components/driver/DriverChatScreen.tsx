import { useRef, useState, type FormEvent, type RefObject } from "react";
import { FileText, Loader2, Lock, MessageSquare, Paperclip, Search, Send, X } from "lucide-react";
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
    attach: "Attach photo or document",
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
    attach: "Fotoğraf veya belge ekle",
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
    attach: "إرفاق صورة أو مستند",
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
  const [showSearch, setShowSearch] = useState(false);

  if (jobs.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <div className="w-14 h-14 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-center mx-auto">
            <MessageSquare className="w-7 h-7 text-slate-600 shrink-0" />
          </div>
          <div>
            <p className="text-base font-bold text-slate-200">{t.noJobs}</p>
            <p className="text-sm text-slate-500 mt-1.5 max-w-[260px] mx-auto leading-relaxed">{t.noJobsSub}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Job thread selector */}
      <div className="shrink-0 px-3 pt-2 pb-2.5 border-b border-slate-800 bg-slate-950 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-white text-start">{t.title}</h2>
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
              showSearch ? "bg-orange-500/10 border-orange-500/40 text-orange-400" : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
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
                    ? "bg-slate-800 border-slate-600 text-white"
                    : "bg-slate-900 border-slate-800/60 text-slate-400 hover:border-slate-600"
                }`}
              >
                #{job.shipmentNumber}
                {unread > 0 && (
                  <span className="absolute -top-1 -end-1 min-w-[18px] h-[18px] px-1 rounded-full bg-orange-500 text-white text-[10px] font-bold leading-[18px] text-center light-preserve">
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
            <span className="text-xs text-slate-500 font-semibold truncate">
              {activeShipment.loadingCity} → {activeShipment.deliveryCity}
            </span>
          </div>
        )}

        {showSearch && (
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-2xl px-3">
            <Search className="w-4 h-4 text-slate-500 shrink-0" />
            <input
              type="text"
              autoFocus
              placeholder={t.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              className="bg-transparent text-sm text-slate-200 placeholder-slate-600 focus:outline-none w-full min-h-[44px] border-0"
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
              className="text-xs font-bold text-slate-400 hover:text-white bg-slate-900 border border-slate-800 rounded-full px-4 min-h-[36px] cursor-pointer disabled:opacity-50"
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
                  <span className="px-3 py-1 rounded-full bg-slate-900 text-slate-500 text-xs font-semibold">
                    {formatDateSeparatorLabel(msg.timestamp, lang)}
                  </span>
                </div>
              )}
              <div className={`flex flex-col max-w-[85%] ${isMe ? "ms-auto items-end" : "me-auto items-start"}`}>
                <span className={`text-xs font-semibold mb-1 ${isMe ? "text-slate-500" : "text-slate-400"}`}>
                  {isMe ? t.you : `${t.maras} · ${msg.senderName}`}
                </span>
                <div
                  className={`p-3 rounded-2xl text-sm leading-relaxed break-words max-w-full ${
                    isMe
                      ? "bg-orange-600 text-white rounded-se-md light-preserve"
                      : "bg-slate-900 border border-slate-800/50 text-slate-200 rounded-ss-md"
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
                        <FileText className={`w-4 h-4 shrink-0 ${isMe ? "text-white" : "text-slate-300"}`} />
                        <span>{msg.fileName}</span>
                      </a>
                      {((msg.fileCategory === "photo" || msg.fileName?.match(/\.(jpeg|jpg|gif|png|webp)/i)) && msg.fileUrl && msg.fileUrl !== "#") && (
                        <div className="mt-1 rounded-xl overflow-hidden border border-slate-800 max-w-[200px]">
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
                <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-500">
                  <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  {isMe && (
                    <span className={msg.status === "seen" ? "text-emerald-400 font-semibold" : ""}>
                      {msg.status === "seen" ? `✓✓ ${t.seen}` : `✓ ${t.sent}`}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {totalMessageCount === 0 && (
          <div className="py-16 text-center text-slate-500 text-sm px-6">
            {isChatClosed ? t.emptyClosed : t.empty}
          </div>
        )}
        {totalMessageCount > 0 && visibleMessages.length === 0 && (
          <div className="py-10 text-center text-slate-500 text-sm px-6">{t.noResults(searchQuery)}</div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Attachment failure banner (only when the composer is open) */}
      {!isChatClosed && attachmentError && (
        <div className="shrink-0 px-3.5 py-2 bg-slate-950 border-t border-slate-900 flex items-center justify-between gap-2 text-xs font-semibold">
          <span className="text-red-400 text-start">
            {attachmentError === "upload" ? t.uploadFailed : t.sendFailed}
          </span>
          {canRetryAttachment && (
            <button
              type="button"
              onClick={onRetryAttachment}
              disabled={isUploading}
              className="shrink-0 min-h-[36px] px-3 rounded-xl border border-orange-500/40 text-orange-400 hover:text-orange-300 disabled:opacity-50 cursor-pointer"
            >
              {t.retry}
            </button>
          )}
        </div>
      )}

      {/* Composer / read-only lock */}
      {isChatClosed ? (
        <div className="shrink-0 p-4 bg-slate-950 border-t border-slate-800 flex items-center gap-2.5 text-slate-400 text-sm">
          <Lock className="w-4 h-4 shrink-0" />
          <span className="text-start">{t.closedBanner}</span>
        </div>
      ) : (
        <form onSubmit={onSendMessage} className="shrink-0 bg-slate-950 p-3 border-t border-slate-800 flex items-end gap-2">
          <input
            ref={attachmentInputRef}
            type="file"
            accept="image/*,application/pdf,.doc,.docx"
            className="hidden"
            onChange={onAttachmentSelected}
          />
          <button
            type="button"
            onClick={() => attachmentInputRef.current?.click()}
            disabled={isUploading || isSending}
            aria-label={t.attach}
            title={t.attach}
            className="w-12 h-12 shrink-0 bg-slate-900 border border-slate-800 hover:border-slate-600 text-slate-400 hover:text-white rounded-2xl transition-all cursor-pointer flex items-center justify-center active:scale-95 disabled:opacity-50"
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
            className="flex-1 p-3 bg-slate-900 border border-slate-800 focus:border-orange-500/60 outline-none rounded-2xl text-sm text-white placeholder-slate-600 transition-colors disabled:opacity-60 resize-none overflow-y-auto leading-normal"
          />

          <button
            type="submit"
            disabled={!canSubmitChatMessage({ text: newMessageText, hasAttachment: false, isSending, isLocked: isChatClosed })}
            aria-label={t.send}
            className="w-12 h-12 shrink-0 bg-orange-500 hover:bg-orange-600 text-white rounded-2xl transition-all cursor-pointer flex items-center justify-center disabled:opacity-40 active:scale-95 light-preserve"
          >
            <Send className="w-5 h-5 shrink-0 rtl:-scale-x-100" />
          </button>
        </form>
      )}
    </div>
  );
}
