import { useEffect, useRef, useState } from 'react';
import { Search, MessageSquare, Lock, Truck, Building2, ExternalLink, Send, Paperclip, FileText, Download, AlertTriangle, RefreshCw, X, ChevronLeft, ChevronRight } from 'lucide-react';
import type { ChatChannel, ChatMessage, DocumentCategory, Language, Shipment } from '../../types';
import { apiFetch } from '../../lib/api';
import { filterShipmentsBySearch, shipmentRouteLabel, summarizeUnreadForShipment } from '../../lib/chatCenterView';
import { formatUnreadBadge } from '../../lib/chatUnreadAccess';
import { MAX_CHAT_TEXT_LENGTH } from '../../lib/chatMessageValidation';
import {
  canSubmitChatMessage,
  applySuccessfulChatPoll,
  shouldConfirmChannelRead,
} from '../../lib/chatComposerState';

// Categories offered for Internal Staff attachments (PR #35). Subset of
// DocumentCategory — 'photo' is left out here since these are staff
// document attachments, not the driver-facing cargo photos elsewhere in
// the app; 'other' remains the safe default.
const INTERNAL_FILE_CATEGORIES: DocumentCategory[] = [
  'cmr',
  'invoice',
  'packing_list',
  'delivery_proof',
  'customs',
  'other',
];

// 'internal_staff' (src/types.ts) is a real, admin-only chat channel — see
// server.ts chat routes and chatVisibility.ts for the read/write gating.
// Kept as its own exported alias since callers (AdminPanel.tsx) import it
// by this name for the Chat Center tab focus/shortcut wiring.
export type ChatCenterChannel = ChatChannel;

export interface ChatCenterFocus {
  shipmentId: string;
  channel: ChatCenterChannel;
}

interface ChatCenterProps {
  lang: Language;
  isRtl: boolean;
  shipments: Shipment[];
  unreadChatMessages: ChatMessage[];
  onOpenFullChat: (shipment: Shipment, channel?: ChatChannel) => void;
  focus?: ChatCenterFocus | null;
  onFocusHandled?: () => void;
  /** feature/admin-mobile-ui correction pass: called right after this
      channel is marked read server-side (POST /chat/seen, per-admin —
      src/lib/chatUnreadAccess.ts), so AdminPanel can optimistically drop
      those messages from its own unreadChatMessages state immediately —
      every badge (shipment row, bottom nav, notification bell) sourced
      from that same state updates without waiting for the next poll. */
  onChannelRead?: (shipmentId: string, channel: ChatCenterChannel) => void;
}

const LABELS: Record<Language, {
  title: string;
  searchPlaceholder: string;
  noShipments: string;
  emptyState: string;
  futureDirection: string;
  internal: string;
  internalDesc: string;
  internalBanner: string;
  internalInputPlaceholder: string;
  driver: string;
  driverDesc: string;
  customer: string;
  customerDesc: string;
  noMessages: string;
  loading: string;
  continueInChat: string;
  send: string;
  attach: string;
  removeAttachment: string;
  internalOnly: string;
  uploadFailedError: string;
  sendFailedError: string;
  connectionError: string;
  connectionErrorRetrying: string;
  retryNow: string;
  category: Record<DocumentCategory, string>;
}> = {
  en: {
    title: 'Chat Center',
    searchPlaceholder: 'Search shipment number...',
    noShipments: 'No shipments match your search.',
    emptyState: 'Select a shipment to view its conversations.',
    futureDirection: 'Centralized shipment communication will replace external chat tools over time.',
    internal: 'Internal',
    internalDesc: 'MARAS staff only',
    internalBanner: 'Internal MARAS Staff Only',
    internalInputPlaceholder: 'Message MARAS staff about this shipment...',
    driver: 'Driver',
    driverDesc: 'Admin ↔ Driver only',
    customer: 'Customer',
    customerDesc: 'Admin ↔ Customer only',
    noMessages: 'No messages yet in this channel.',
    loading: 'Loading messages...',
    continueInChat: 'Continue in full chat',
    send: 'Send',
    attach: 'Attach file',
    removeAttachment: 'Remove attachment',
    internalOnly: 'Internal Only',
    uploadFailedError: "Couldn't upload the file to storage. Your message was not sent — please try again.",
    sendFailedError: 'The file was uploaded, but the message could not be sent. Please try again.',
    connectionError: "Couldn't load messages. Check your connection and try again.",
    connectionErrorRetrying: 'Connection lost — retrying…',
    retryNow: 'Retry now',
    category: {
      cmr: 'CMR',
      invoice: 'Invoice',
      packing_list: 'Packing List',
      customs: 'Customs Document',
      delivery_proof: 'Delivery Proof',
      photo: 'Photo',
      other: 'Other',
    },
  },
  tr: {
    title: 'Mesaj Merkezi',
    searchPlaceholder: 'Sevkiyat numarası ara...',
    noShipments: 'Aramanızla eşleşen sevkiyat yok.',
    emptyState: 'Konuşmalarını görmek için bir sevkiyat seçin.',
    futureDirection: 'Merkezi sevkiyat iletişimi zamanla harici sohbet araçlarının yerini alacak.',
    internal: 'Dahili',
    internalDesc: 'Sadece MARAS ekibi',
    internalBanner: 'Sadece MARAS Ekibi İçin Dahili',
    internalInputPlaceholder: 'Bu sevkiyat hakkında MARAS ekibine mesaj yazın...',
    driver: 'Sürücü',
    driverDesc: 'Sadece Yönetici ↔ Sürücü',
    customer: 'Müşteri',
    customerDesc: 'Sadece Yönetici ↔ Müşteri',
    noMessages: 'Bu kanalda henüz mesaj yok.',
    loading: 'Mesajlar yükleniyor...',
    continueInChat: 'Tam sohbette devam et',
    send: 'Gönder',
    attach: 'Dosya ekle',
    removeAttachment: 'Eki kaldır',
    internalOnly: 'Sadece Dahili',
    uploadFailedError: 'Dosya depoya yüklenemedi. Mesajınız gönderilmedi — lütfen tekrar deneyin.',
    sendFailedError: 'Dosya yüklendi, ancak mesaj gönderilemedi. Lütfen tekrar deneyin.',
    connectionError: 'Mesajlar yüklenemedi. Bağlantınızı kontrol edip tekrar deneyin.',
    connectionErrorRetrying: 'Bağlantı kesildi — yeniden deneniyor…',
    retryNow: 'Şimdi tekrar dene',
    category: {
      cmr: 'CMR',
      invoice: 'Fatura',
      packing_list: 'Çeki Listesi',
      customs: 'Gümrük Belgesi',
      delivery_proof: 'Teslimat Kanıtı',
      photo: 'Fotoğraf',
      other: 'Diğer',
    },
  },
  ar: {
    title: 'مركز المحادثات',
    searchPlaceholder: 'ابحث برقم الشحنة...',
    noShipments: 'لا توجد شحنات مطابقة لبحثك.',
    emptyState: 'اختر شحنة لعرض محادثاتها.',
    futureDirection: 'سيحل التواصل المركزي للشحنات محل أدوات المحادثة الخارجية مع مرور الوقت.',
    internal: 'داخلي',
    internalDesc: 'لموظفي ماراس فقط',
    internalBanner: 'داخلي لموظفي ماراس فقط',
    internalInputPlaceholder: 'راسل فريق ماراس بخصوص هذه الشحنة...',
    driver: 'السائق',
    driverDesc: 'المدير ↔ السائق فقط',
    customer: 'العميل',
    customerDesc: 'المدير ↔ العميل فقط',
    noMessages: 'لا توجد رسائل بعد في هذه القناة.',
    loading: 'جارٍ تحميل الرسائل...',
    continueInChat: 'المتابعة في المحادثة الكاملة',
    send: 'إرسال',
    attach: 'إرفاق ملف',
    removeAttachment: 'إزالة المرفق',
    internalOnly: 'داخلي فقط',
    uploadFailedError: 'تعذر رفع الملف إلى التخزين. لم يتم إرسال رسالتك — يرجى المحاولة مرة أخرى.',
    sendFailedError: 'تم رفع الملف، ولكن تعذر إرسال الرسالة. يرجى المحاولة مرة أخرى.',
    connectionError: 'تعذر تحميل الرسائل. تحقق من اتصالك وحاول مرة أخرى.',
    connectionErrorRetrying: 'انقطع الاتصال — جارٍ إعادة المحاولة…',
    retryNow: 'إعادة المحاولة الآن',
    category: {
      cmr: 'CMR',
      invoice: 'فاتورة',
      packing_list: 'قائمة التعبئة',
      customs: 'مستند جمركي',
      delivery_proof: 'إثبات التسليم',
      photo: 'صورة',
      other: 'أخرى',
    },
  },
};

export default function ChatCenter({
  lang,
  isRtl,
  shipments,
  unreadChatMessages,
  onOpenFullChat,
  focus,
  onFocusHandled,
  onChannelRead,
}: ChatCenterProps) {
  const label = LABELS[lang] ?? LABELS.en;

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null);
  const [activeChannel, setActiveChannel] = useState<ChatCenterChannel>('internal_staff');
  const [channelMessages, setChannelMessages] = useState<ChatMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  // fix/chat-safety-reliability-phase1: distinguishes "never successfully
  // loaded this channel yet" from "loaded, then a later poll failed" — used
  // below to tell a genuine empty conversation apart from a connection
  // failure, instead of collapsing both into the same empty-state copy.
  const [hasLoadedMessagesOnce, setHasLoadedMessagesOnce] = useState(false);
  // True whenever the most recent fetch (initial or background poll)
  // failed. Deliberately never clears channelMessages by itself — the last
  // successfully-fetched messages stay on screen while this is true.
  const [pollError, setPollError] = useState(false);
  const retryNowRef = useRef<() => void>(() => {});
  const [internalMessageText, setInternalMessageText] = useState('');
  const [isSendingInternal, setIsSendingInternal] = useState(false);
  const [internalFile, setInternalFile] = useState<File | null>(null);
  const [internalFileName, setInternalFileName] = useState('');
  const [internalFileCategory, setInternalFileCategory] = useState<DocumentCategory>('other');
  const [internalFileDataUrl, setInternalFileDataUrl] = useState('');
  // fix/chat-safety-reliability-phase1: the real Storage URL from a
  // successful POST /api/upload, cached so a retry after a failed POST
  // /chat reuses it instead of uploading the same file again. Cleared only
  // on a successful send or when the user removes/replaces the attachment
  // (see resetInternalAttachment / handleInternalFileSelected) — never on a
  // failed send.
  const [internalUploadedFileUrl, setInternalUploadedFileUrl] = useState('');
  // Distinguishes "the upload itself failed (message never sent)" from
  // "the upload succeeded but creating the chat message failed" — the two
  // cases in section 2/7 of the phase-1 requirements need different copy.
  const [internalSendError, setInternalSendError] = useState<'' | 'upload' | 'send'>('');
  const internalFileInputRef = useRef<HTMLInputElement>(null);

  // Shortcut buttons (Shipment Details modal) preselect a shipment + channel.
  useEffect(() => {
    if (!focus) return;
    setSelectedShipmentId(focus.shipmentId);
    setActiveChannel(focus.channel);
    onFocusHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const filteredShipments = filterShipmentsBySearch(shipments, searchQuery);
  const selectedShipment = selectedShipmentId
    ? shipments.find((s) => s.id === selectedShipmentId) ?? null
    : null;

  // Loads the selected channel's real messages from the same admin-scoped
  // GET endpoint the existing chat drawer uses (App.tsx). For driver_admin
  // and client_admin this is a read-only preview — sending a reply still
  // only happens via that existing drawer ("Continue in full chat"). For
  // internal_staff, this Chat Center tab is the primary surface: it also
  // supports sending (see handleSendInternalMessage below), since there is
  // no other UI for it and it's the one channel this drawer doesn't
  // support (driver/client-only labels and greeting copy throughout
  // App.tsx's drawer assume one of those two audiences).
  useEffect(() => {
    if (!selectedShipment) {
      setChannelMessages([]);
      setPollError(false);
      setHasLoadedMessagesOnce(false);
      return;
    }
    let cancelled = false;
    setPollError(false);
    setHasLoadedMessagesOnce(false);

    // feature/admin-mobile-ui correction pass: marks this channel read
    // for the signed-in admin (per-admin — src/lib/chatUnreadAccess.ts,
    // NOT the old shared-across-every-admin `status` flag) as soon as its
    // messages are visible, same pattern/cadence (3s poll while a
    // channel stays open) already established in App.tsx's own chat
    // drawer — so a message that arrives while this exact shipment+
    // channel is already open still gets picked up and marked read
    // without the admin having to reselect anything.
    //
    // fix/chat-safety-reliability-phase1: a failed fetch (non-OK response
    // or thrown error, on the initial load OR any background poll) now
    // only sets `pollError` — it never clears `channelMessages`. A
    // transient network blip or a 500 must never make a populated thread
    // look empty. `hasLoadedMessagesOnce` distinguishes a genuine empty
    // conversation (loaded fine, zero messages) from "never successfully
    // loaded, nothing to show yet."
    const fetchAndMarkRead = async (showLoading: boolean) => {
      if (showLoading) setIsLoadingMessages(true);
      try {
        const res = await apiFetch(`/api/shipments/${selectedShipment.id}/chat?channel=${activeChannel}`);
        if (!res.ok) throw new Error(`Failed to load chat messages (${res.status})`);
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error('Unexpected chat response shape');
        if (cancelled) return;

        const next = applySuccessfulChatPoll<ChatMessage>(data);
        setChannelMessages(next.messages);
        setHasLoadedMessagesOnce(next.hasLoadedOnce);
        setPollError(next.pollError);

        const hasMessageFromOtherParty = data.some((m: ChatMessage) => m.sender !== 'admin');
        if (hasMessageFromOtherParty) {
          const seenRes = await apiFetch(`/api/shipments/${selectedShipment.id}/chat/seen`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ viewer: 'admin', channel: activeChannel }),
          });
          // fix/chat-safety-reliability-phase1: only tell the parent this
          // channel was marked read when the server actually confirmed it
          // (res.ok). Previously this fired unconditionally, so a failed
          // mark-seen write could still optimistically clear this admin's
          // local unread badge even though the server never recorded it.
          if (!cancelled && shouldConfirmChannelRead(seenRes.ok)) {
            onChannelRead?.(selectedShipment.id, activeChannel);
          }
        }
      } catch {
        // Matches applyFailedChatPoll's contract (see chatComposerState.ts
        // and its tests): a failed poll only ever flips pollError — it
        // never touches channelMessages or hasLoadedMessagesOnce, which is
        // exactly what NOT calling their setters here achieves.
        if (!cancelled) setPollError(true);
      } finally {
        if (!cancelled && showLoading) setIsLoadingMessages(false);
      }
    };

    retryNowRef.current = () => { fetchAndMarkRead(true); };
    fetchAndMarkRead(true);
    const interval = setInterval(() => fetchAndMarkRead(false), 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedShipment?.id, activeChannel]);

  const resetInternalAttachment = () => {
    setInternalFile(null);
    setInternalFileName('');
    setInternalFileCategory('other');
    setInternalFileDataUrl('');
    // fix/chat-safety-reliability-phase1: clear the cached upload only
    // here (explicit remove, or after a confirmed successful send) — never
    // on a failed send, so a retry can reuse it instead of re-uploading.
    setInternalUploadedFileUrl('');
    if (internalFileInputRef.current) internalFileInputRef.current.value = '';
  };

  // Best-effort category guess from the filename, same heuristic used by
  // the driver_admin/client_admin attachment flow in App.tsx.
  const guessCategoryFromFile = (file: File): DocumentCategory => {
    const name = file.name.toLowerCase();
    if (file.type.startsWith('image/')) return 'photo';
    if (name.includes('cmr')) return 'cmr';
    if (name.includes('invoice')) return 'invoice';
    if (name.includes('packing')) return 'packing_list';
    if (name.includes('customs')) return 'customs';
    if (name.includes('delivery') || name.includes('pod')) return 'delivery_proof';
    return 'other';
  };

  const handleInternalFileSelected = (file: File) => {
    setInternalFile(file);
    setInternalFileName(file.name);
    setInternalFileCategory(guessCategoryFromFile(file));
    // fix/chat-safety-reliability-phase1: a newly-picked file invalidates
    // any previously-cached upload (it belonged to a different file) and
    // any previous error state.
    setInternalUploadedFileUrl('');
    setInternalSendError('');
    const reader = new FileReader();
    reader.onload = (evt) => {
      setInternalFileDataUrl((evt.target?.result as string) || '');
    };
    reader.readAsDataURL(file);
  };

  // fix/chat-safety-reliability-phase1: rewritten to (1) never fall back to
  // sending the raw base64 data: URL as fileUrl when the upload fails —
  // the send is blocked outright instead, (2) cache the real Storage URL
  // from a successful upload so a retry after a failed message-send reuses
  // it rather than uploading the same file twice, and (3) surface a
  // distinct, translated error for "upload failed" vs. "upload succeeded
  // but the message wasn't created," instead of silently swallowing either
  // case. The draft text and the selected attachment are only ever cleared
  // on a confirmed successful send (see resetInternalAttachment above).
  const handleSendInternalMessage = async () => {
    const text = internalMessageText.trim();
    if (!selectedShipment) return;
    if (!canSubmitChatMessage({ text, hasAttachment: Boolean(internalFile), isSending: isSendingInternal })) return;
    setIsSendingInternal(true);
    setInternalSendError('');
    try {
      const body: Record<string, unknown> = { channel: 'internal_staff' };

      if (internalFile) {
        let uploadedUrl = internalUploadedFileUrl;

        if (!uploadedUrl) {
          if (!internalFileDataUrl) {
            // FileReader hasn't finished reading the file yet — nothing to
            // upload. Bail out rather than send a malformed request; the
            // attachment stays selected so the admin can just hit Send again.
            setInternalSendError('upload');
            return;
          }
          try {
            const uploadRes = await apiFetch('/api/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ base64DataUrl: internalFileDataUrl, filename: internalFileName }),
            });
            if (!uploadRes.ok) {
              setInternalSendError('upload');
              return;
            }
            const uploadData = await uploadRes.json();
            uploadedUrl = uploadData.url;
            setInternalUploadedFileUrl(uploadedUrl);
          } catch {
            setInternalSendError('upload');
            return;
          }
        }

        body.type = 'file';
        body.fileName = internalFileName;
        body.fileCategory = internalFileCategory;
        body.fileUrl = uploadedUrl;
        if (text) body.text = text;
      } else {
        body.type = 'text';
        body.text = text;
      }

      const res = await apiFetch(`/api/shipments/${selectedShipment.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const msg = await res.json();
        setChannelMessages((prev) => [...prev, msg]);
        setInternalMessageText('');
        resetInternalAttachment();
        setInternalSendError('');
      } else {
        // Upload (if any) already succeeded at this point — only the
        // message creation failed. internalUploadedFileUrl stays cached so
        // a retry reuses it instead of uploading the file again.
        setInternalSendError('send');
      }
    } catch {
      setInternalSendError('send');
    } finally {
      setIsSendingInternal(false);
    }
  };

  const channelTabs: { id: ChatCenterChannel; label: string; desc: string; icon: typeof Lock }[] = [
    { id: 'internal_staff', label: label.internal, desc: label.internalDesc, icon: Lock },
    { id: 'driver_admin', label: label.driver, desc: label.driverDesc, icon: Truck },
    { id: 'client_admin', label: label.customer, desc: label.customerDesc, icon: Building2 },
  ];

  const BackIcon = isRtl ? ChevronRight : ChevronLeft;

  return (
    /* feature/admin-mobile-ui correction pass: taller on mobile now that
       App.tsx's dark header/footer are hidden there (freed-up viewport
       height — see AdminPanel.tsx's mobile content padding).
       fix/chat-safety-reliability-phase1: dvh (not vh) so the iOS on-screen
       keyboard/collapsing address bar can't leave the composer hidden
       below the fold — vh is computed against the layout viewport, which
       doesn't shrink when the keyboard opens. */
    <div className="flex flex-col lg:flex-row h-[78dvh] lg:h-[calc(100vh-220px)] lg:min-h-[520px] bg-white border border-slate-200 rounded-2xl overflow-hidden" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Left: shipment conversation list.
          feature/admin-mobile-ui: on mobile this list and the selected
          conversation (below) are shown one at a time — list when nothing
          is selected, full-screen detail once a shipment is picked — via
          the same selectedShipmentId state this component already owns.
          lg: always shows both side-by-side, unchanged. */}
      <div className={`${selectedShipmentId ? 'hidden' : 'flex'} lg:flex w-full lg:w-80 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 flex-col bg-slate-50`}>
        <div className="p-4 border-b border-slate-200">
          <h2 className="font-bold text-slate-900 text-sm flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-orange-500" />
            {label.title}
          </h2>
          <div className="relative mt-3">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 left-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={label.searchPlaceholder}
              className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/40"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredShipments.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-8 px-4">{label.noShipments}</p>
          )}
          {filteredShipments.map((s) => {
            const isSelected = s.id === selectedShipmentId;
            const unread = summarizeUnreadForShipment(unreadChatMessages, s.id);
            const preview = unread.lastMessage?.text || unread.lastMessage?.fileName || null;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedShipmentId(s.id)}
                className={`w-full text-left px-4 py-3 border-b border-slate-100 transition-colors ${
                  isSelected ? 'bg-orange-50 border-l-2 border-l-orange-500' : 'hover:bg-white'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] font-bold text-slate-900 truncate">{s.shipmentNumber}</span>
                  {formatUnreadBadge(unread.count) && (
                    <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center">
                      {formatUnreadBadge(unread.count)}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 truncate mt-0.5">{s.companyName} · {shipmentRouteLabel(s)}</p>
                {preview && <p className="text-[11px] text-slate-400 truncate mt-1 italic">{preview}</p>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main: channel tabs + selected conversation */}
      <div className={`${selectedShipmentId ? 'flex' : 'hidden'} lg:flex flex-1 flex-col min-w-0`}>
        {!selectedShipment ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-2">
            <MessageSquare className="w-8 h-8 text-slate-300" />
            <p className="text-sm font-semibold text-slate-500">{label.emptyState}</p>
            <p className="text-[11px] text-slate-400 max-w-sm mt-2">{label.futureDirection}</p>
          </div>
        ) : (
          <>
            <div className="p-3 lg:p-4 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() => setSelectedShipmentId(null)}
                  aria-label={label.title}
                  className="lg:hidden shrink-0 w-8 h-8 flex items-center justify-center text-slate-500 hover:bg-slate-100 rounded-lg cursor-pointer border-0 bg-transparent"
                >
                  <BackIcon className="w-4.5 h-4.5" />
                </button>
                <div className="min-w-0">
                  <span className="font-mono text-xs font-bold text-slate-900">{selectedShipment.shipmentNumber}</span>
                  <p className="text-[11px] text-slate-500 truncate">{selectedShipment.companyName} · {shipmentRouteLabel(selectedShipment)}</p>
                </div>
              </div>
              {activeChannel !== 'internal_staff' && (
                <button
                  type="button"
                  onClick={() => onOpenFullChat(selectedShipment, activeChannel)}
                  className="flex items-center gap-1.5 text-[11px] font-bold text-orange-600 hover:text-orange-700 px-3 py-1.5 rounded-lg border border-orange-200 hover:bg-orange-50 transition-colors"
                >
                  {label.continueInChat}
                  <ExternalLink className="w-3 h-3" />
                </button>
              )}
            </div>

            <div className="flex border-b border-slate-200">
              {channelTabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeChannel === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveChannel(tab.id)}
                    className={`flex-1 flex flex-col items-center gap-1 py-2 lg:py-2.5 text-xs font-bold border-b-2 transition-colors ${
                      isActive ? 'border-orange-500 text-orange-600 bg-orange-50/60' : 'border-transparent text-slate-400 hover:text-slate-600'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Icon className="w-3.5 h-3.5" />
                      {tab.label}
                    </span>
                    {/* feature/admin-mobile-ui correction pass: hidden on
                        mobile — 3 tabs at 2 lines each was tall vertical
                        space on a phone; the icon + short label alone is
                        still unambiguous. */}
                    <span className="hidden lg:block text-[10px] font-medium text-slate-400">{tab.desc}</span>
                  </button>
                );
              })}
            </div>

            {activeChannel === 'internal_staff' && (
              <div className="px-4 py-2 bg-slate-900 text-white text-[11px] font-bold flex items-center gap-1.5">
                <Lock className="w-3 h-3 text-orange-400" />
                {label.internalBanner}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-slate-50/50">
              {isLoadingMessages ? (
                <p className="text-xs text-slate-400 text-center py-10">{label.loading}</p>
              ) : pollError && !hasLoadedMessagesOnce ? (
                /* fix/chat-safety-reliability-phase1: never had a
                   successful fetch for this channel to show anything for —
                   a distinct retry state, not the same copy as a
                   genuinely empty conversation (which requires having
                   loaded successfully at least once). */
                <div className="h-full flex flex-col items-center justify-center text-center gap-2 py-10">
                  <AlertTriangle className="w-6 h-6 text-amber-500" />
                  <p className="text-xs font-semibold text-slate-500">{label.connectionError}</p>
                  <button
                    type="button"
                    onClick={() => retryNowRef.current()}
                    className="mt-1 inline-flex items-center gap-1.5 text-[11px] font-bold text-orange-600 hover:text-orange-700 px-3 py-2 rounded-lg border border-orange-200 hover:bg-orange-50 transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {label.retryNow}
                  </button>
                </div>
              ) : channelMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center gap-2 py-10">
                  {pollError && (
                    <p className="text-[11px] font-semibold text-amber-600 flex items-center gap-1.5 mb-1">
                      <AlertTriangle className="w-3 h-3" />
                      {label.connectionErrorRetrying}
                    </p>
                  )}
                  <MessageSquare className="w-6 h-6 text-slate-300" />
                  <p className="text-xs text-slate-400">{label.noMessages}</p>
                </div>
              ) : (
                <>
                  {pollError && (
                    /* fix/chat-safety-reliability-phase1: messages we
                       already have stay fully visible — this is just a
                       small heads-up that the latest poll failed and is
                       being retried automatically, not a replacement for
                       the thread. */
                    <div className="sticky top-0 z-10 -mx-5 -mt-5 mb-2 px-5 py-1.5 bg-amber-50 border-b border-amber-200 text-[11px] font-semibold text-amber-700 flex items-center justify-center gap-1.5">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      {label.connectionErrorRetrying}
                    </div>
                  )}
                  {channelMessages.map((msg) => {
                    const isAdmin = msg.sender === 'admin';
                    const formattedTime = new Date(msg.timestamp).toLocaleTimeString(
                      lang === 'tr' ? 'tr-TR' : lang === 'ar' ? 'ar-IQ' : 'en-US',
                      { hour: '2-digit', minute: '2-digit' }
                    );
                    const isImageAttachment =
                      msg.type === 'file' &&
                      !!msg.fileUrl &&
                      (msg.fileCategory === 'photo' || !!msg.fileName?.match(/\.(jpe?g|gif|png|webp)$/i));
                    // fix/chat-safety-reliability-phase1: this row is
                    // `items-end`/`items-start` (never `stretch`), so a
                    // flex child here sizes to its own content width, not
                    // the row's — a bubble with unbroken text longer than
                    // the row's max-w-[75%] (found while smoke-testing the
                    // new 5000-char limit with a no-whitespace string)
                    // rendered at full content width and overflowed the
                    // whole panel, `break-words` alone had nothing to
                    // shrink into. `max-w-full` on the bubble itself
                    // (below) gives it something to wrap against.
                    return (
                      <div key={msg.id} className={`flex flex-col max-w-[75%] ${isAdmin ? 'ml-auto items-end' : 'mr-auto items-start'}`}>
                        <span className="text-[11px] text-slate-500 font-bold mb-0.5">{msg.senderName}</span>
                        {msg.type === 'file' ? (
                          <div className="flex flex-col gap-1.5">
                            {/* fix/chat-safety-reliability-phase1: a real,
                                clickable open/download control — this used
                                to be a plain, non-interactive div with no
                                way to open or download the attached file. */}
                            <a
                              href={msg.fileUrl || undefined}
                              target="_blank"
                              rel="noreferrer"
                              download={msg.fileName || undefined}
                              onClick={(e) => {
                                if (!msg.fileUrl) e.preventDefault();
                              }}
                              aria-disabled={!msg.fileUrl}
                              className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs border transition-colors ${
                                isAdmin
                                  ? 'bg-orange-500 border-orange-500 text-white hover:bg-orange-600'
                                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                              } ${msg.fileUrl ? 'cursor-pointer' : 'cursor-default opacity-80'}`}
                            >
                              <FileText className="w-4 h-4 shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="font-bold truncate underline decoration-dotted underline-offset-2">{msg.fileName || 'Attachment'}</p>
                                <span className={`text-[10px] font-mono uppercase block ${isAdmin ? 'text-orange-100' : 'text-slate-400'}`}>
                                  {label.category[msg.fileCategory ?? 'other']}
                                </span>
                              </div>
                              {msg.fileUrl && <Download className="w-3.5 h-3.5 shrink-0" />}
                              {msg.channel === 'internal_staff' && (
                                <span className="shrink-0 flex items-center gap-1 text-[10px] font-bold uppercase bg-slate-900/80 text-orange-300 px-1.5 py-0.5 rounded">
                                  <Lock className="w-2.5 h-2.5" />
                                  {label.internalOnly}
                                </span>
                              )}
                            </a>
                            {isImageAttachment && (
                              <a
                                href={msg.fileUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="block rounded-lg overflow-hidden border border-slate-200 max-w-[180px]"
                              >
                                <img
                                  src={msg.fileUrl}
                                  alt={msg.fileName || 'attachment'}
                                  className="w-full h-auto object-cover max-h-[140px]"
                                  referrerPolicy="no-referrer"
                                />
                              </a>
                            )}
                            {msg.text && (
                              <div className={`px-3 py-2 rounded-xl text-xs break-words max-w-full ${isAdmin ? 'bg-orange-500 text-white' : 'bg-white border border-slate-200 text-slate-700'}`}>
                                {msg.text}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className={`px-3 py-2 rounded-xl text-xs break-words max-w-full ${isAdmin ? 'bg-orange-500 text-white' : 'bg-white border border-slate-200 text-slate-700'}`}>
                            {msg.text}
                          </div>
                        )}
                        <span className="text-[10px] text-slate-400 font-mono mt-0.5">{formattedTime}</span>
                      </div>
                    );
                  })}
                </>
              )}
            </div>

            {activeChannel === 'internal_staff' && (
              <div className="border-t border-slate-200">
                {internalSendError === 'upload' && (
                  <p className="px-3 pt-2 text-[11px] font-bold text-red-600">{label.uploadFailedError}</p>
                )}
                {internalSendError === 'send' && (
                  <p className="px-3 pt-2 text-[11px] font-bold text-red-600">{label.sendFailedError}</p>
                )}
                {internalFile && (
                  <div className="mx-3 mt-2 flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs">
                    <FileText className="w-4 h-4 text-slate-500 shrink-0" />
                    <span className="flex-1 truncate font-semibold text-slate-700">{internalFileName}</span>
                    <select
                      value={internalFileCategory}
                      onChange={(e) => setInternalFileCategory(e.target.value as DocumentCategory)}
                      className="text-[11px] border border-slate-200 rounded-md px-1.5 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/40"
                    >
                      {INTERNAL_FILE_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>{label.category[cat]}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={resetInternalAttachment}
                      aria-label={label.removeAttachment}
                      title={label.removeAttachment}
                      className="p-2 -m-1 text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendInternalMessage();
                  }}
                  className="p-3 flex items-center gap-2"
                >
                  <input
                    ref={internalFileInputRef}
                    type="file"
                    accept="image/*,application/pdf,.doc,.docx"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleInternalFileSelected(file);
                    }}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => internalFileInputRef.current?.click()}
                    disabled={isSendingInternal}
                    title={label.attach}
                    aria-label={label.attach}
                    className="p-3 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>
                  <input
                    type="text"
                    value={internalMessageText}
                    onChange={(e) => setInternalMessageText(e.target.value)}
                    placeholder={label.internalInputPlaceholder}
                    maxLength={MAX_CHAT_TEXT_LENGTH}
                    disabled={isSendingInternal}
                    className="flex-1 px-3 py-2.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/40 disabled:opacity-60"
                  />
                  <button
                    type="submit"
                    disabled={!canSubmitChatMessage({ text: internalMessageText, hasAttachment: Boolean(internalFile), isSending: isSendingInternal })}
                    className="flex items-center gap-1.5 text-[11px] font-bold text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed px-3.5 py-3 rounded-lg transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {label.send}
                  </button>
                </form>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
