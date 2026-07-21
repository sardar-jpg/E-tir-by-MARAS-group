import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Search, MessageSquare, Lock, Truck, Building2, ExternalLink, Send, Paperclip, FileText, Download, AlertTriangle, RefreshCw, Check, CheckCheck, X, ChevronLeft, ChevronRight } from 'lucide-react';
import type { ChatChannel, ChatMessage, DocumentCategory, Language, Shipment } from '../../types';
import { apiFetch } from '../../lib/api';
import { filterShipmentsBySearch, shipmentRouteLabel, summarizeUnreadForShipment, countUnreadForChannel, sortShipmentsByChatActivity } from '../../lib/chatCenterView';
import { formatUnreadBadge } from '../../lib/chatUnreadAccess';
import ImageLightbox, { type ImageLightboxTarget } from '../ImageLightbox';
import { attachBrowserPolling, type AttachedPolling } from '../../hooks/browserPolling';
import { MAX_CHAT_TEXT_LENGTH } from '../../lib/chatMessageValidation';
import {
  canSubmitChatMessage,
  shouldConfirmChannelRead,
  planAttachmentSendForShipment,
  mergeNewerChatMessages,
  prependOlderChatMessages,
  createPendingImage,
  selectPendingImagesForThread,
  markPendingImageFailed,
  markPendingImageRetrying,
  removePendingImage,
  type PendingImageMessage,
} from '../../lib/chatComposerState';
import { optimizeChatImage, isLikelyHeic } from '../../lib/chatImageOptimize';
import { MAX_UPLOAD_BYTES } from '../../lib/uploadValidation';
import { isShipmentClosed } from '../../lib/shipmentStatusTransitions';
import { shouldShowDateSeparator, formatDateSeparatorLabel, isNearBottom, computeAutoGrowHeightPx } from '../../lib/chatDisplay';
import { encodePageCursor } from '../../lib/pagination';

/**
 * Perf Phase 2: a single conversation-list row, memoized.
 *
 * The left rail re-renders on every composer keystroke and on the 3s chat
 * poll. Its props are stable across those renders — `shipment` is a stable
 * element of the (now-memoized) filteredShipments array, `onSelect` is a
 * stable useCallback, and `unreadChatMessages` only changes identity when the
 * unread set actually changes (not on keystrokes). So React.memo lets an
 * unrelated re-render (typing a message) skip re-rendering every row, while a
 * real unread/selection change still updates the affected rows. Unread is
 * computed INSIDE the row so passing a fresh object each render can't defeat
 * the memo. Behavior/markup are identical to the previous inline row.
 */
interface ChatSidebarRowProps {
  shipment: Shipment;
  isSelected: boolean;
  unreadChatMessages: ChatMessage[];
  onSelect: (id: string) => void;
}
const ChatSidebarRow = memo(function ChatSidebarRow({ shipment: s, isSelected, unreadChatMessages, onSelect }: ChatSidebarRowProps) {
  const unread = summarizeUnreadForShipment(unreadChatMessages, s.id);
  const preview = unread.lastMessage?.text || unread.lastMessage?.fileName || null;
  return (
    <button
      type="button"
      onClick={() => onSelect(s.id)}
      className={`w-full text-start px-4 py-3 border-b border-slate-100 transition-colors ${
        isSelected ? 'bg-orange-50 border-s-2 border-s-orange-500' : 'hover:bg-white'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] font-bold text-slate-900 truncate">{s.shipmentNumber}</span>
        {formatUnreadBadge(unread.count) && (
          <span className="shrink-0 min-w-[20px] h-[20px] px-1 rounded-full bg-orange-500 text-white text-[11px] font-bold flex items-center justify-center">
            {formatUnreadBadge(unread.count)}
          </span>
        )}
      </div>
      <p className="text-[11px] text-slate-500 truncate mt-0.5">{s.companyName} · {shipmentRouteLabel(s)}</p>
      {preview && <p className="text-[11px] text-slate-400 truncate mt-1 italic">{preview}</p>}
    </button>
  );
});

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

// fix/admin-mobile-chat-correctness: the mobile Chat Center composes in
// the driver/customer channels too (one mobile chat experience — no
// hand-off to the desktop drawer), where photo attachments are a normal
// part of the workflow, so 'photo' joins the offered categories there.
const CHANNEL_FILE_CATEGORIES: DocumentCategory[] = [...INTERNAL_FILE_CATEGORIES, 'photo'];

/**
 * fix/admin-mobile-chat-correctness: keyboard-aware height for the mobile
 * full-screen conversation. On iOS the on-screen keyboard shrinks the
 * VISUAL viewport but neither `100vh` nor `100dvh` (both track the layout
 * viewport / collapsing toolbar only), so a dvh-sized panel leaves the
 * composer hidden behind the keyboard. window.visualViewport reports the
 * real visible height; falls back to null (callers use 100dvh) where the
 * API doesn't exist.
 */
interface VisualViewportMetrics {
  height: number;
  /** How far iOS has panned the visual viewport down from the layout
      viewport's top (keyboard open) — the overlay translates by this so
      header/tabs/composer stay inside the VISIBLE area instead of being
      scrolled away with the page. */
  offsetTop: number;
}

function useVisualViewportMetrics(enabled: boolean): VisualViewportMetrics | null {
  const [metrics, setMetrics] = useState<VisualViewportMetrics | null>(null);
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !window.visualViewport) {
      setMetrics(null);
      return;
    }
    const vv = window.visualViewport;
    // Identity-preserving read: rAF ticks that observe no change return
    // the same state reference, so the settle loop never re-render-spams.
    const read = () => {
      setMetrics((prev) => {
        const next = { height: Math.round(vv.height), offsetTop: Math.round(vv.offsetTop) };
        return prev && prev.height === next.height && prev.offsetTop === next.offsetTop ? prev : next;
      });
    };
    // fix/admin-chat-keyboard-gap: on a real iPhone, Safari can fire its
    // LAST visualViewport resize BEFORE the keyboard + collapsing bottom
    // chrome finish settling (the classic stale-height quirk, made worse
    // by the position:fixed body lock this overlay uses). A single
    // event-time read then freezes the overlay at an intermediate, too-
    // small height — the composer parks mid-screen with a large blank gap
    // above the keyboard. Every trigger therefore starts a short
    // requestAnimationFrame settle loop (~700ms) that keeps re-reading
    // until the geometry stops moving; focus/blur and orientation changes
    // trigger it too, since those can move geometry without a vv event.
    let raf = 0;
    let settleUntil = 0;
    const tick = () => {
      read();
      if (performance.now() < settleUntil) raf = requestAnimationFrame(tick);
      else raf = 0;
    };
    const settle = () => {
      settleUntil = performance.now() + 700;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    read();
    vv.addEventListener('resize', settle);
    vv.addEventListener('scroll', settle);
    window.addEventListener('focusin', settle);
    window.addEventListener('focusout', settle);
    window.addEventListener('orientationchange', settle);
    return () => {
      vv.removeEventListener('resize', settle);
      vv.removeEventListener('scroll', settle);
      window.removeEventListener('focusin', settle);
      window.removeEventListener('focusout', settle);
      window.removeEventListener('orientationchange', settle);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [enabled]);
  return enabled ? metrics : null;
}

// feature/chat-ui-ux-phase2: auto-growing composer bounds — one line at
// rest, up to ~5-6 lines before the textarea scrolls internally instead of
// pushing the rest of the panel off-screen.
const COMPOSER_MIN_HEIGHT_PX = 40;
const COMPOSER_MAX_HEIGHT_PX = 120;

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
  /** fix/admin-mobile-chat-correctness: on mobile the Chat Center IS the
      one chat experience — a selected shipment opens as a full-screen,
      keyboard-aware conversation that can compose in every permitted
      channel, and the "Continue in full chat" hand-off to the desktop
      drawer is not rendered (two competing mobile chat UIs was one of
      the audited defects). Desktop (lg) keeps the two-pane layout and
      the drawer hand-off unchanged. */
  isMobile: boolean;
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
  sentStatus: string;
  seenStatus: string;
  close: string;
  share: string;
  download: string;
  messagePlaceholder: string;
  heicUnsupported: string;
  imageTooLarge: string;
  uploadingImage: string;
  imageFailed: string;
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
    sentStatus: 'Sent',
    seenStatus: 'Seen',
    close: 'Close',
    share: 'Share',
    download: 'Download',
    messagePlaceholder: 'Type a message…',
    heicUnsupported: 'HEIC/HEIF photos are not supported yet. Please choose a JPEG, PNG, or WebP image.',
    imageTooLarge: 'This image is larger than 15 MB. Please choose a smaller one.',
    uploadingImage: 'Uploading…',
    imageFailed: 'Upload failed',
    category: {
      cmr: 'CMR',
      invoice: 'Invoice',
      packing_list: 'Packing List',
      t1: 'T1',
      tir_carnet: 'TIR Carnet',
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
    sentStatus: 'Gönderildi',
    seenStatus: 'Görüldü',
    close: 'Kapat',
    share: 'Paylaş',
    download: 'İndir',
    messagePlaceholder: 'Bir mesaj yazın…',
    heicUnsupported: 'HEIC/HEIF fotoğraflar henüz desteklenmiyor. Lütfen JPEG, PNG veya WebP seçin.',
    imageTooLarge: 'Bu görsel 15 MB\'tan büyük. Lütfen daha küçük bir görsel seçin.',
    uploadingImage: 'Yükleniyor…',
    imageFailed: 'Yükleme başarısız',
    category: {
      cmr: 'CMR',
      invoice: 'Fatura',
      packing_list: 'Çeki Listesi',
      t1: 'T1',
      tir_carnet: 'TIR Karnesi',
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
    sentStatus: 'تم الإرسال',
    seenStatus: 'تمت المشاهدة',
    close: 'إغلاق',
    share: 'مشاركة',
    download: 'تنزيل',
    messagePlaceholder: 'اكتب رسالة…',
    heicUnsupported: 'صور HEIC/HEIF غير مدعومة بعد. يرجى اختيار صورة JPEG أو PNG أو WebP.',
    imageTooLarge: 'حجم هذه الصورة أكبر من 15 ميغابايت. يرجى اختيار صورة أصغر.',
    uploadingImage: 'جارٍ الرفع…',
    imageFailed: 'فشل الرفع',
    category: {
      cmr: 'CMR',
      invoice: 'فاتورة',
      packing_list: 'قائمة التعبئة',
      t1: 'T1',
      tir_carnet: 'دفتر TIR',
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
  isMobile,
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
  // Perf Phase 1: the active thread's adaptive poller, so sending a message
  // can snap it back to the fast interval for a prompt reply.
  const chatPollerRef = useRef<AttachedPolling | null>(null);
  // Phase 4 (Firestore scalability audit): newest-seen cursor driving the
  // 3s poll's `?since=` catch-up fetch (see fetchAndMarkRead below), and
  // the "Load older messages" cursor/availability from the initial page's
  // own nextCursor/hasMore. Both reset whenever the effect re-runs for a
  // new shipment/channel selection.
  const newestCursorRef = useRef<string | null>(null);
  const olderCursorRef = useRef<string | null>(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  // feature/chat-ui-ux-phase2: smart auto-scroll. messagesContainerRef is
  // the scrollable message list; isNearBottomRef tracks (via the onScroll
  // handler below) whether the admin is already close to the bottom —
  // only then does a newly-arrived message auto-scroll the view. Reading
  // older history and having a new message arrive must never yank the
  // view back down. Defaults to true so the very first load of a
  // channel scrolls to its latest messages.
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  // feature/chat-ui-ux-phase2: auto-growing composer textarea (replaces
  // the previous single-line input) — grows with content up to
  // COMPOSER_MAX_HEIGHT_PX, then scrolls internally rather than taking
  // over the screen for a very long message.
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
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
  // fix/chat-safety-reliability-phase1 (follow-up): the shipment
  // internalUploadedFileUrl was actually uploaded for. A cached URL must
  // never be reused after switching to a different shipment — checked via
  // planAttachmentSendForShipment (chatComposerState.ts) before every
  // send, and proactively cleared (along with the rest of the attachment
  // draft) whenever selectedShipmentId changes, below.
  const [internalUploadShipmentId, setInternalUploadShipmentId] = useState('');
  // Distinguishes "the upload itself failed (message never sent)" from
  // "the upload succeeded but creating the chat message failed" — the two
  // cases in section 2/7 of the phase-1 requirements need different copy.
  const [internalSendError, setInternalSendError] = useState<'' | 'upload' | 'send' | 'closed' | 'heic' | 'too_large'>('');
  const internalFileInputRef = useRef<HTMLInputElement>(null);
  // fix/admin-mobile-chat-correctness: in-app image viewer target — image
  // attachments never navigate the WebView to the raw file URL.
  const [lightboxTarget, setLightboxTarget] = useState<ImageLightboxTarget | null>(null);
  // feature/admin-chat-recent-activity-order: this session's own memory of
  // the newest chat activity per Order — set the instant the current admin
  // sends (immediate reorder, no refresh) and when an opened thread loads
  // its newest page (so reading a LEGACY Order — no lastChatActivityAt
  // field yet — never demotes it once its unread entries clear). Merged
  // with the server field and the unread poll by
  // sortShipmentsByChatActivity (chatCenterView.ts).
  const [localActivity, setLocalActivity] = useState<Record<string, string>>({});
  const recordLocalActivity = (shipmentId: string, timestamp: string | undefined) => {
    if (!timestamp) return;
    setLocalActivity((prev) => (prev[shipmentId] && prev[shipmentId] >= timestamp ? prev : { ...prev, [shipmentId]: timestamp }));
  };

  // feature/admin-chat-mobile-ux-pass: optimistic image sending. Each
  // pending item is LOCAL-ONLY UI state bound at creation to its
  // shipmentId+channel (it never leaks into another room, and never
  // touches unread state or lastChatActivityAt — only the authoritative
  // server message created on success does). The job map holds the
  // non-serializable pieces (blob, cached upload URL for retry).
  const [pendingImages, setPendingImages] = useState<PendingImageMessage[]>([]);
  const pendingJobsRef = useRef(
    new Map<string, {
      originalFile: File;
      optimized?: { blob: Blob; fileName: string; mimeType: string };
      category: DocumentCategory;
      text: string;
      shipmentId: string;
      channel: ChatChannel;
      uploadedUrl?: string;
      running: boolean;
    }>()
  );
  // Every object URL this component created, revoked on unmount (items
  // removed/reconciled earlier revoke immediately and drop out of here).
  const createdObjectUrlsRef = useRef(new Set<string>());
  useEffect(() => () => {
    createdObjectUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    createdObjectUrlsRef.current.clear();
  }, []);
  // What the admin is LOOKING at right now — the job callback compares
  // against this (not a stale closure) to decide whether the reconciled
  // server message should also be appended to the visible thread.
  const viewingRef = useRef<{ shipmentId: string | null; channel: ChatCenterChannel }>({ shipmentId: null, channel: 'internal_staff' });
  useEffect(() => {
    viewingRef.current = { shipmentId: selectedShipmentId, channel: activeChannel };
  }, [selectedShipmentId, activeChannel]);

  const revokePreviewUrl = (url: string | null) => {
    if (!url) return;
    URL.revokeObjectURL(url);
    createdObjectUrlsRef.current.delete(url);
  };

  const blobToDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });

  const runPendingImageJob = async (id: string) => {
    const job = pendingJobsRef.current.get(id);
    if (!job || job.running) return; // duplicate-submission guard per pending item
    job.running = true;
    try {
      // Optimize once (document-safe downscale/re-encode; falls back to
      // the original file on any failure — see chatImageOptimize.ts).
      if (!job.optimized) {
        const opt = await optimizeChatImage(job.originalFile);
        if (opt.kind === 'unsupported_heic') {
          setPendingImages((prev) => markPendingImageFailed(prev, id, 'upload'));
          return;
        }
        job.optimized = { blob: opt.blob, fileName: opt.fileName, mimeType: opt.mimeType };
      }
      // Upload (skipped on retry when the URL is already cached — PR #95 parity).
      if (!job.uploadedUrl) {
        const dataUrl = await blobToDataUrl(job.optimized.blob);
        const uploadRes = await apiFetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64DataUrl: dataUrl, filename: job.optimized.fileName }),
        });
        if (!uploadRes.ok) {
          setPendingImages((prev) => markPendingImageFailed(prev, id, 'upload'));
          return;
        }
        job.uploadedUrl = (await uploadRes.json()).url;
      }
      // Authoritative message — posted to the shipment/channel CAPTURED AT
      // CREATION, never the currently-viewed one.
      const res = await apiFetch(`/api/shipments/${job.shipmentId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: job.channel,
          type: 'file',
          fileName: job.optimized.fileName,
          fileCategory: job.category,
          fileUrl: job.uploadedUrl,
          ...(job.text ? { text: job.text } : {}),
        }),
      });
      if (!res.ok) {
        setPendingImages((prev) => markPendingImageFailed(prev, id, 'send'));
        return;
      }
      const msg = await res.json();
      recordLocalActivity(job.shipmentId, msg.timestamp);
      // Reconcile: the server message (its ID and timestamp) replaces the
      // pending item. mergeNewerChatMessages de-dups by id, so the ~3s
      // thread poll delivering the same message later is a no-op.
      const viewing = viewingRef.current;
      if (viewing.shipmentId === job.shipmentId && viewing.channel === job.channel) {
        isNearBottomRef.current = true;
        setChannelMessages((prev) => mergeNewerChatMessages(prev, [msg]));
      }
      setPendingImages((prev) => {
        const { items, revokedUrl } = removePendingImage(prev, id);
        revokePreviewUrl(revokedUrl);
        return items;
      });
      pendingJobsRef.current.delete(id);
    } catch {
      setPendingImages((prev) => markPendingImageFailed(prev, id, pendingJobsRef.current.get(id)?.uploadedUrl ? 'send' : 'upload'));
    } finally {
      const j = pendingJobsRef.current.get(id);
      if (j) j.running = false;
    }
  };

  const handleRetryPendingImage = (id: string) => {
    setPendingImages((prev) => markPendingImageRetrying(prev, id));
    void runPendingImageJob(id);
  };

  const handleRemovePendingImage = (id: string) => {
    setPendingImages((prev) => {
      const { items, revokedUrl } = removePendingImage(prev, id);
      revokePreviewUrl(revokedUrl);
      return items;
    });
    pendingJobsRef.current.delete(id);
  };

  const startImageSend = (file: File, text: string) => {
    if (!selectedShipment) return;
    if (isLikelyHeic(file)) {
      setInternalSendError('heic');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setInternalSendError('too_large');
      return;
    }
    const id = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const previewUrl = URL.createObjectURL(file);
    createdObjectUrlsRef.current.add(previewUrl);
    pendingJobsRef.current.set(id, {
      originalFile: file,
      category: internalFileCategory,
      text,
      shipmentId: selectedShipment.id,
      channel: activeChannel,
      running: false,
    });
    setPendingImages((prev) => [
      ...prev,
      createPendingImage({ id, shipmentId: selectedShipment.id, channel: activeChannel, previewUrl, fileName: file.name, text }),
    ]);
    // The composer frees up immediately — only THIS pending item is locked
    // against duplicate submission (job.running), the rest of the chat
    // stays fully usable, including further text messages.
    setInternalMessageText('');
    resetInternalAttachment();
    setInternalSendError('');
    isNearBottomRef.current = true;
    if (isMobile) internalTextareaRef.current?.focus();
    void runPendingImageJob(id);
  };
  // Keyboard-aware size/offset for the mobile full-screen conversation.
  const visualViewport = useVisualViewportMetrics(isMobile && Boolean(selectedShipmentId));

  // fix/admin-chat-list-clipping: the mobile shipment-list card used to
  // size itself with a hardcoded `calc(100dvh - 13.5rem)` guess at the
  // surrounding chrome. On a real iPhone the top app bar + browser
  // toolbar + safe areas exceed that guess, so the card's bottom slid
  // UNDER the fixed bottom navigation — the inner list scrolled to its
  // end, but its last row stayed clipped behind the nav. The card is now
  // sized from reality: measure its own top edge, take the live
  // visualViewport height (which tracks the collapsing browser toolbar),
  // and reserve exactly the bottom-nav allowance AdminPanel itself uses
  // (5.5rem + env(safe-area-inset-bottom)) — no more, so there is no
  // excessive blank space either.
  const listRootRef = useRef<HTMLDivElement>(null);
  const [mobileListHeight, setMobileListHeight] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!isMobile || typeof window === 'undefined') {
      setMobileListHeight(null);
      return;
    }
    const update = () => {
      const el = listRootRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const available = Math.max(Math.round(viewportHeight - top), 320);
      setMobileListHeight(`calc(${available}px - 5.5rem - env(safe-area-inset-bottom))`);
    };
    update();
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, [isMobile]);

  // fix/admin-mobile-chat-keyboard-ux: while the mobile conversation is
  // open, the PAGE BEHIND it must not scroll at all — on a real iPhone,
  // focusing the composer made WebKit scroll the underlying document to
  // "reveal" the input, which visually dumped the admin back onto the
  // shipment list behind the overlay. Locking the body (classic
  // position:fixed technique, scroll position preserved and restored)
  // removes the only scrollable thing WebKit could move; combined with
  // the visualViewport translate below, the conversation stays exactly
  // where it is with the keyboard open.
  useEffect(() => {
    if (!isMobile || !selectedShipmentId) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      overflow: body.style.overflow,
    };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.overflow = 'hidden';
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [isMobile, selectedShipmentId]);

  // fix/admin-mobile-chat-keyboard-ux: when the keyboard opens/closes the
  // thread RESIZES (height style below) rather than the page moving — and
  // if the admin was reading the latest messages, keep them pinned to the
  // bottom through the resize instead of stranding the view mid-history.
  useEffect(() => {
    if (!isMobile) return;
    if (!isNearBottomRef.current) return;
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visualViewport?.height, isMobile]);

  // Shortcut buttons (Shipment Details modal) preselect a shipment + channel.
  useEffect(() => {
    if (!focus) return;
    setSelectedShipmentId(focus.shipmentId);
    setActiveChannel(focus.channel);
    onFocusHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // feature/admin-chat-recent-activity-order: WhatsApp-style ordering —
  // search filters first, the surviving rows keep the same
  // recent-activity order (sort is pure: same rows out as in, nothing
  // duplicated or dropped).
  // Perf Phase 2: this list drives the left rail and re-derives a filter +
  // WhatsApp-style activity sort over all shipments. The Chat Center
  // re-renders on every composer keystroke and on the 3s chat poll; without
  // memoization that sort+filter ran on each of those. Memoized on its real
  // inputs only (shipments, the search text, unread set, and local activity),
  // so ordering/behavior is unchanged — it simply doesn't recompute when an
  // unrelated piece of state (e.g. the message draft) changes.
  const filteredShipments = useMemo(
    () => sortShipmentsByChatActivity(
      filterShipmentsBySearch(shipments, searchQuery),
      unreadChatMessages,
      localActivity
    ),
    [shipments, searchQuery, unreadChatMessages, localActivity]
  );
  // Perf Phase 2: stable identity so memoized ChatSidebarRow children don't
  // re-render just because this parent re-rendered (e.g. composer keystrokes).
  const handleSelectShipmentRow = useCallback((id: string) => setSelectedShipmentId(id), []);
  const selectedShipment = selectedShipmentId
    ? shipments.find((s) => s.id === selectedShipmentId) ?? null
    : null;
  // PR #111 review (Delivered/Closed terminal & chat rules): locks only at
  // the freight-mode-appropriate closing status ("Closed" for Land,
  // "Completed" for Sea/Air) — reaching "Delivered" must NOT lock chat.
  const isSelectedShipmentClosed = selectedShipment ? isShipmentClosed(selectedShipment.status, selectedShipment.freightType) : false;

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
    newestCursorRef.current = null;
    olderCursorRef.current = null;
    setHasOlderMessages(false);
    if (!selectedShipment) {
      setChannelMessages([]);
      setPollError(false);
      setHasLoadedMessagesOnce(false);
      return;
    }
    let cancelled = false;
    setPollError(false);
    setHasLoadedMessagesOnce(false);
    // feature/chat-ui-ux-phase2: a freshly-selected shipment/channel
    // always starts scrolled to its latest messages, regardless of where
    // the admin happened to be scrolled to in whatever they were
    // viewing before.
    isNearBottomRef.current = true;

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
    // Phase 4 (Firestore scalability audit): the first fetch of a
    // shipment/channel selection loads the latest page (server default:
    // 50); every poll tick after that uses `?since=` so this Chat Center
    // no longer re-fetches (and the server no longer re-queries) the
    // whole thread every 3s — only messages newer than the last one
    // already shown (merged in, never replacing what's on screen). A
    // status-only update on an already-loaded message (e.g. a read
    // receipt) is picked up on the next full reselect of the
    // shipment/channel, not mid-poll — see this PR's description.
    const fetchAndMarkRead = async (showLoading: boolean): Promise<boolean> => {
      if (showLoading) setIsLoadingMessages(true);
      let changed = false;
      try {
        const cursor = newestCursorRef.current;
        const url = cursor
          ? `/api/shipments/${selectedShipment.id}/chat?channel=${activeChannel}&since=${encodeURIComponent(cursor)}`
          : `/api/shipments/${selectedShipment.id}/chat?channel=${activeChannel}`;
        const res = await apiFetch(url);
        if (!res.ok) throw new Error(`Failed to load chat messages (${res.status})`);
        const parsed = await res.json();
        if (Array.isArray(parsed)) throw new Error('Unexpected chat response shape');
        const data: ChatMessage[] = parsed.items;
        if (cancelled) return false;
        // Perf Phase 1: adaptive-poll change signal (first load + any tick
        // that delivered new messages count as a change → stay fast).
        changed = !cursor || data.length > 0;

        setChannelMessages((prev) => (cursor ? mergeNewerChatMessages(prev, data) : data));
        setHasLoadedMessagesOnce(true);
        setPollError(false);
        const newest = data[data.length - 1];
        if (newest) {
          newestCursorRef.current = encodePageCursor({ ts: newest.timestamp, id: (newest as any).id });
          // feature/admin-chat-recent-activity-order: remember this
          // Order's newest visible message as known activity, so reading
          // it (which clears unread records) never demotes the Order.
          recordLocalActivity(selectedShipment.id, newest.timestamp);
        }
        if (!cursor) {
          olderCursorRef.current = parsed.nextCursor ?? null;
          setHasOlderMessages(Boolean(parsed.hasMore));
        }

        // fix/admin-mobile-chat-correctness: opening the channel IS
        // reading it — the seen call fires unconditionally on the initial
        // load (not only when the fetched page has messages), because a
        // legacy channel-less unread record can exist for a message this
        // channel-filtered view doesn't even display; gating on the
        // fetched page left exactly those records permanently stranded.
        // Poll ticks only re-fire it when new messages actually arrived.
        // The server-side write/delete is idempotent and strictly scoped
        // to this admin + shipment + channel (plus deterministic legacy
        // audience resolution — chatUnreadAccess.ts), so the extra call
        // is safe.
        if (!cursor || data.length > 0) {
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
      return changed;
    };

    retryNowRef.current = () => { fetchAndMarkRead(true); };
    fetchAndMarkRead(true);
    // Perf Phase 1: adaptive, visibility/online-aware polling (was a fixed 3s
    // setInterval that ran even when the Chat Center tab was backgrounded).
    // Pauses while hidden/offline, backs off 3s→…→30s while idle, snaps back
    // to 3s on new messages or on resume.
    const poller = attachBrowserPolling({ poll: () => fetchAndMarkRead(false) });
    chatPollerRef.current = poller;
    return () => {
      cancelled = true;
      poller.stop();
      if (chatPollerRef.current === poller) chatPollerRef.current = null;
    };
  }, [selectedShipment?.id, activeChannel]);

  // Phase 4 (Firestore scalability audit): explicit "Load older messages"
  // — fetches the next older page via the initial page's own cursor and
  // prepends it, never re-fetching what's already on screen.
  const loadOlderMessages = async () => {
    if (!selectedShipment || !olderCursorRef.current || isLoadingOlder) return;
    const requestedShipmentId = selectedShipment.id;
    const requestedChannel = activeChannel;
    const cursor = olderCursorRef.current;
    setIsLoadingOlder(true);
    try {
      const res = await apiFetch(`/api/shipments/${requestedShipmentId}/chat?channel=${requestedChannel}&cursor=${encodeURIComponent(cursor)}`);
      if (res.ok) {
        const page = await res.json();
        if (selectedShipment?.id === requestedShipmentId && activeChannel === requestedChannel && !Array.isArray(page)) {
          setChannelMessages((prev) => prependOlderChatMessages(prev, page.items));
          olderCursorRef.current = page.nextCursor ?? null;
          setHasOlderMessages(Boolean(page.hasMore));
        }
      }
    } catch (err) {
      console.warn('Load older chat messages failed:', err);
    } finally {
      setIsLoadingOlder(false);
    }
  };

  // feature/chat-ui-ux-phase2: smart auto-scroll. Only scrolls to the
  // newest message when the admin was already near the bottom (or this is
  // the first render of a freshly-selected shipment/channel, per the
  // isNearBottomRef reset above) — reading older history and having a new
  // message arrive must never yank the view back down.
  useEffect(() => {
    if (channelMessages.length === 0 && pendingImages.length === 0) return;
    if (!isNearBottomRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [channelMessages.length, pendingImages.length, selectedShipment?.id, activeChannel]);

  const handleMessagesScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = isNearBottom(distanceFromBottom);
  };

  // feature/chat-ui-ux-phase2: auto-grow the composer textarea with its
  // content (including shrinking back down after the draft is cleared on
  // send) — reset to "auto" first so scrollHeight reflects the content
  // alone, not whatever height was previously forced.
  useEffect(() => {
    const el = internalTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${computeAutoGrowHeightPx(el.scrollHeight, COMPOSER_MIN_HEIGHT_PX, COMPOSER_MAX_HEIGHT_PX)}px`;
  }, [internalMessageText]);

  const resetInternalAttachment = () => {
    setInternalFile(null);
    setInternalFileName('');
    setInternalFileCategory('other');
    setInternalFileDataUrl('');
    // fix/chat-safety-reliability-phase1: clear the cached upload only
    // here (explicit remove, or after a confirmed successful send) — never
    // on a failed send, so a retry can reuse it instead of re-uploading.
    setInternalUploadedFileUrl('');
    setInternalUploadShipmentId('');
    if (internalFileInputRef.current) internalFileInputRef.current.value = '';
  };

  // fix/chat-safety-reliability-phase1 (follow-up): switching to a
  // different shipment must never carry a draft attachment (or its cached
  // upload URL) over to the newly-selected one — proactively clears the
  // whole attachment draft, not just the cached URL, on every shipment
  // switch. Combined with the shipment check inside
  // handleSendInternalMessage (belt and suspenders) below.
  useEffect(() => {
    resetInternalAttachment();
    setInternalSendError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedShipmentId]);

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
    setInternalUploadShipmentId('');
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
    if (!canSubmitChatMessage({ text, hasAttachment: Boolean(internalFile), isSending: isSendingInternal, isLocked: isSelectedShipmentClosed })) return;
    // feature/admin-chat-mobile-ux-pass: IMAGE attachments go through the
    // optimistic pending flow (immediate in-thread preview, background
    // optimize+upload, Retry/Remove on failure) instead of blocking the
    // composer. Non-image attachments (PDF/DOC/XLS) keep the existing
    // synchronous path unchanged.
    if (internalFile && (internalFile.type.startsWith('image/') || isLikelyHeic(internalFile))) {
      startImageSend(internalFile, text);
      return;
    }
    setIsSendingInternal(true);
    setInternalSendError('');
    try {
      // fix/admin-mobile-chat-correctness: the composer now serves every
      // channel this surface can compose in (internal everywhere; driver/
      // customer on mobile, where this is the one chat experience). The
      // server still enforces channel permissions and audience rules
      // regardless of what's sent here (resolveOutgoingChatChannel,
      // canAccessInternalStaffChannel).
      const body: Record<string, unknown> = { channel: activeChannel };

      if (internalFile) {
        // fix/chat-safety-reliability-phase1 (follow-up): a cached upload
        // is only reused when it was uploaded for THIS shipment — the
        // proactive clear-on-switch effect above should already guarantee
        // this, but this check is the actual enforcement point, not just
        // a mirror of it.
        const plan = planAttachmentSendForShipment(internalUploadedFileUrl, internalUploadShipmentId, selectedShipment.id);
        let uploadedUrl: string;

        if (plan.action === 'reuse_cached_url') {
          uploadedUrl = plan.fileUrl;
        } else {
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
            setInternalUploadShipmentId(selectedShipment.id);
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
        // feature/admin-chat-recent-activity-order: the send IS activity —
        // this Order moves to the top of the list immediately.
        recordLocalActivity(selectedShipment.id, msg.timestamp);
        // fix/admin-mobile-chat-keyboard-ux: sending always follows your
        // own message to the bottom (smooth, via the length effect) —
        // never leaves the view parked at an older scroll position.
        isNearBottomRef.current = true;
        setChannelMessages((prev) => [...prev, msg]);
        // Perf Phase 1: sending is fresh activity — snap the poller back to the
        // fast interval so a reply is picked up promptly even after idle backoff.
        chatPollerRef.current?.reset(false);
        setInternalMessageText('');
        // feature/admin-chat-mobile-ux-pass: a successful send keeps the
        // conversation going — restore focus so the iOS keyboard stays up
        // (the textarea is no longer disabled during the send, and the
        // Send button's pointerdown guard stops the tap from blurring it;
        // this focus() is the safety net if anything still slipped).
        if (isMobile) internalTextareaRef.current?.focus();
        resetInternalAttachment();
        setInternalSendError('');
      } else {
        // PR #111 review (Delivered/Closed terminal & chat rules): the
        // shipment was closed (by another session) since this list last
        // refreshed — a future refresh of the `shipments` prop will hide
        // this composer entirely (isSelectedShipmentClosed); until then,
        // this specific error avoids the misleading "just retry" framing
        // the generic send-failure message uses, since a retry can never
        // succeed once closed.
        let closedBody: any = null;
        try { closedBody = await res.json(); } catch {}
        if (res.status === 409 && closedBody?.code === 'SHIPMENT_CHAT_CLOSED') {
          setInternalSendError('closed');
        } else {
          // Upload (if any) already succeeded at this point — only the
          // message creation failed. internalUploadedFileUrl stays cached so
          // a retry reuses it instead of uploading the file again.
          setInternalSendError('send');
        }
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

  // fix/admin-mobile-chat-correctness: the Chat Center composes in the
  // internal channel everywhere; on mobile — where this is the ONE chat
  // experience — it composes in the driver/customer channels too. The
  // server still enforces every channel/permission rule regardless.
  const canComposeInActiveChannel = activeChannel === 'internal_staff' || isMobile;

  // fix/admin-chat-keyboard-gap: how much of the layout viewport the
  // keyboard (plus collapsed browser chrome) is covering right now —
  // the standard visualViewport formula, no hardcoded keyboard height.
  // While the keyboard is up it covers the home-indicator area, so the
  // composer's env(safe-area-inset-bottom) reserve would be pure blank
  // space doubled on top of the keyboard inset — suppress it then, and
  // restore it the moment the keyboard closes.
  const keyboardInset = visualViewport
    ? Math.max(0, Math.round(window.innerHeight - visualViewport.height - visualViewport.offsetTop))
    : 0;
  const isKeyboardOpen = keyboardInset > 80;

  // Pending optimistic images for exactly this room+channel — items sent
  // from other shipments/channels never render here.
  const pendingForThread = selectedShipment
    ? selectPendingImagesForThread(pendingImages, selectedShipment.id, activeChannel)
    : [];

  // The selected conversation — one pane shared verbatim by the desktop
  // right-hand column and the mobile full-screen overlay, so the two can
  // never drift into competing chat experiences again.
  const conversationPane = !selectedShipment ? (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-2">
      <MessageSquare className="w-8 h-8 text-slate-300" />
      <p className="text-sm font-semibold text-slate-500">{label.emptyState}</p>
      <p className="text-[11px] text-slate-400 max-w-sm mt-2">{label.futureDirection}</p>
    </div>
  ) : (
    <>
      {/* Compact shipment header — the MAR reference stays the one visible
          business identity of this order-scoped room. */}
      <div className="px-2.5 py-2 lg:p-4 border-b border-slate-200 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={() => setSelectedShipmentId(null)}
            aria-label={label.title}
            className="lg:hidden shrink-0 w-9 h-9 flex items-center justify-center text-slate-500 hover:bg-slate-100 rounded-lg cursor-pointer border-0 bg-transparent"
          >
            <BackIcon className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <span className="font-mono text-xs font-bold text-slate-900">{selectedShipment.shipmentNumber}</span>
            <p className="text-[11px] text-slate-500 truncate">{selectedShipment.companyName} · {shipmentRouteLabel(selectedShipment)}</p>
          </div>
        </div>
        {/* fix/admin-mobile-chat-correctness: the hand-off to the desktop
            drawer is DESKTOP-ONLY — on mobile this full-screen view is the
            complete conversation, and rendering a second entry point to a
            second UI for the same thread was one of the audited defects. */}
        {!isMobile && activeChannel !== 'internal_staff' && (
          <button
            type="button"
            onClick={() => onOpenFullChat(selectedShipment, activeChannel)}
            className="shrink-0 flex items-center gap-1.5 text-[11px] font-bold text-orange-600 hover:text-orange-700 px-3 py-1.5 rounded-lg border border-orange-200 hover:bg-orange-50 transition-colors"
          >
            {label.continueInChat}
            <ExternalLink className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Compact channel tabs — each carries its own unread count, derived
          from the SAME authoritative array as the shipment/global badges
          (countUnreadForChannel, chatCenterView.ts). */}
      <div className="flex border-b border-slate-200 shrink-0">
        {channelTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeChannel === tab.id;
          const tabUnread = selectedShipment ? countUnreadForChannel(unreadChatMessages, selectedShipment.id, tab.id) : 0;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveChannel(tab.id)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 lg:py-2.5 text-xs font-bold border-b-2 transition-colors ${
                isActive ? 'border-orange-500 text-orange-600 bg-orange-50/60' : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
                {formatUnreadBadge(tabUnread) && (
                  <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {formatUnreadBadge(tabUnread)}
                  </span>
                )}
              </span>
              <span className="hidden lg:block text-[10px] font-medium text-slate-400">{tab.desc}</span>
            </button>
          );
        })}
      </div>

      {activeChannel === 'internal_staff' && (
        <div className="px-4 py-1.5 bg-slate-900 text-white text-[11px] font-bold flex items-center gap-1.5 shrink-0">
          <Lock className="w-3 h-3 text-orange-400" />
          {label.internalBanner}
        </div>
      )}

      {/* Thread: the ONE scrollable region — flex-1 min-h-0 so it always
          fills exactly the space between tabs and composer (no fixed-height
          box, no dead space around a short/empty conversation). */}
      <div ref={messagesContainerRef} onScroll={handleMessagesScroll} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 pt-3 pb-2 lg:p-5 bg-slate-50/50">
        {isLoadingMessages ? (
          <p className="text-xs text-slate-400 text-center py-10">{label.loading}</p>
        ) : pollError && !hasLoadedMessagesOnce ? (
          /* fix/chat-safety-reliability-phase1: never had a successful
             fetch for this channel to show anything for — a distinct retry
             state, not the same copy as a genuinely empty conversation. */
          <div className="h-full flex flex-col items-center justify-center text-center gap-2">
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
        ) : channelMessages.length === 0 && pendingForThread.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-2">
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
          /* fix/admin-mobile-chat-keyboard-ux: min-h-full + justify-end
             anchors a short conversation to the BOTTOM of the scroll area
             — the newest message sits right above the composer with no
             dead space, like WhatsApp/Telegram/iMessage. Long
             conversations overflow and scroll exactly as before. */
          <div className="min-h-full flex flex-col justify-end">
            {pollError && (
              /* fix/chat-safety-reliability-phase1: messages we already
                 have stay fully visible — this is just a heads-up that the
                 latest poll failed and is being retried automatically. */
              <div className="sticky top-0 z-10 -mx-3 -mt-3 lg:-mx-5 lg:-mt-5 mb-2 px-5 py-1.5 bg-amber-50 border-b border-amber-200 text-[11px] font-semibold text-amber-700 flex items-center justify-center gap-1.5">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                {label.connectionErrorRetrying}
              </div>
            )}
            {hasOlderMessages && (
              <div className="flex justify-center pb-2">
                <button
                  type="button"
                  onClick={loadOlderMessages}
                  disabled={isLoadingOlder}
                  className="text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-800 bg-white border border-slate-200 rounded-full px-3 py-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isLoadingOlder ? '…' : 'Load older messages'}
                </button>
              </div>
            )}
            {channelMessages.map((msg, index) => {
              const isAdmin = msg.sender === 'admin';
              const formattedTime = new Date(msg.timestamp).toLocaleTimeString(
                lang === 'tr' ? 'tr-TR' : lang === 'ar' ? 'ar-IQ' : 'en-US',
                { hour: '2-digit', minute: '2-digit' }
              );
              // feature/chat-ui-ux-phase2: date separators, grouped by the
              // viewer's local calendar day.
              const showDateSeparator = shouldShowDateSeparator(msg.timestamp, channelMessages[index - 1]?.timestamp);
              // fix/admin-mobile-chat-correctness: consecutive messages
              // from the same sender group — the name header renders once
              // per run, follow-ups sit tighter. Purely visual; nothing
              // about ordering/content changes.
              const prevMsg = index > 0 ? channelMessages[index - 1] : undefined;
              const isGrouped = !showDateSeparator && !!prevMsg && prevMsg.sender === msg.sender && prevMsg.senderName === msg.senderName;
              // Read status only means anything for driver_admin/
              // client_admin — `status` is the single global driver/client-
              // facing read receipt; internal_staff has no such "other
              // party" to read it.
              const showReadStatus = isAdmin && activeChannel !== 'internal_staff';
              const isImageAttachment =
                msg.type === 'file' &&
                !!msg.fileUrl &&
                (msg.fileCategory === 'photo' || !!msg.fileName?.match(/\.(jpe?g|gif|png|webp)$/i));
              return (
                <div key={msg.id} className={index === 0 ? '' : isGrouped ? 'mt-1' : 'mt-3'}>
                  {showDateSeparator && (
                    <div className="flex items-center justify-center py-2">
                      <span className="px-2.5 py-1 rounded-full bg-slate-200/70 text-slate-500 text-[11px] font-bold">
                        {formatDateSeparatorLabel(msg.timestamp, lang)}
                      </span>
                    </div>
                  )}
                  <div className={`flex flex-col max-w-[82%] lg:max-w-[75%] ${isAdmin ? 'ml-auto items-end' : 'mr-auto items-start'}`}>
                    {!isGrouped && (
                      <span className="text-[11px] text-slate-500 font-bold mb-0.5">{msg.senderName}</span>
                    )}
                    {msg.type === 'file' ? (
                      <div className="flex flex-col gap-1.5">
                        {/* fix/admin-mobile-chat-correctness: an IMAGE
                            attachment opens the shared in-app
                            ImageLightbox — never an <a> that navigates the
                            WebView to the raw file URL. Non-image files
                            keep the explicit open/download anchor. */}
                        {isImageAttachment ? (
                          <button
                            type="button"
                            onClick={() => setLightboxTarget({ url: msg.fileUrl!, name: msg.fileName || 'attachment' })}
                            className={`text-left rounded-xl overflow-hidden border cursor-zoom-in p-0 bg-transparent ${
                              isAdmin ? 'border-orange-300' : 'border-slate-200'
                            }`}
                            aria-label={msg.fileName || 'attachment'}
                          >
                            <img
                              src={msg.fileUrl}
                              alt={msg.fileName || 'attachment'}
                              className="block w-full h-auto object-cover max-w-[220px] max-h-[180px]"
                              referrerPolicy="no-referrer"
                              loading="lazy"
                            />
                            <span className={`flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-bold ${
                              isAdmin ? 'bg-orange-500 text-white' : 'bg-white text-slate-700'
                            }`}>
                              <FileText className="w-3.5 h-3.5 shrink-0" />
                              <span className="truncate min-w-0">{msg.fileName || 'Attachment'}</span>
                              {msg.channel === 'internal_staff' && (
                                <span className="shrink-0 flex items-center gap-1 text-[10px] font-bold uppercase bg-slate-900/80 text-orange-300 px-1.5 py-0.5 rounded">
                                  <Lock className="w-2.5 h-2.5" />
                                  {label.internalOnly}
                                </span>
                              )}
                            </span>
                          </button>
                        ) : (
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
                              <span className={`text-[11px] font-mono uppercase block ${isAdmin ? 'text-orange-100' : 'text-slate-400'}`}>
                                {label.category[msg.fileCategory ?? 'other']}
                              </span>
                            </div>
                            {msg.fileUrl && <Download className="w-3.5 h-3.5 shrink-0" />}
                            {msg.channel === 'internal_staff' && (
                              <span className="shrink-0 flex items-center gap-1 text-[11px] font-bold uppercase bg-slate-900/80 text-orange-300 px-1.5 py-0.5 rounded">
                                <Lock className="w-2.5 h-2.5" />
                                {label.internalOnly}
                              </span>
                            )}
                          </a>
                        )}
                        {msg.text && (
                          <div className={`px-3 py-2 rounded-xl text-[13px] leading-relaxed lg:text-xs break-words max-w-full ${isAdmin ? 'bg-orange-500 text-white' : 'bg-white border border-slate-200 text-slate-700'}`}>
                            {msg.text}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className={`px-3 py-2 rounded-xl text-[13px] leading-relaxed lg:text-xs break-words max-w-full ${isAdmin ? 'bg-orange-500 text-white' : 'bg-white border border-slate-200 text-slate-700'}`}>
                        {msg.text}
                      </div>
                    )}
                    <span className="flex items-center gap-1 text-[10px] text-slate-400 font-mono mt-0.5">
                      {formattedTime}
                      {showReadStatus && (
                        <span className={`inline-flex items-center gap-0.5 ${msg.status === 'seen' ? 'text-emerald-500 font-bold' : 'text-slate-400'}`}>
                          {msg.status === 'seen' ? (
                            <CheckCheck className="w-3 h-3" />
                          ) : (
                            <Check className="w-3 h-3" />
                          )}
                          {msg.status === 'seen' ? label.seenStatus : label.sentStatus}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
            {pendingForThread.map((pending) => (
              <div key={pending.id} className="mt-3">
                <div className="flex flex-col max-w-[82%] lg:max-w-[75%] ml-auto items-end">
                  <div className={`relative rounded-xl overflow-hidden border ${pending.status === 'failed' ? 'border-red-300' : 'border-orange-300'}`}>
                    <img
                      src={pending.previewUrl}
                      alt={pending.fileName}
                      className="block w-full h-auto object-cover max-w-[220px] max-h-[180px]"
                    />
                    {pending.status === 'uploading' ? (
                      <div className="absolute inset-0 bg-slate-900/45 flex flex-col items-center justify-center gap-1.5">
                        <RefreshCw className="w-5 h-5 text-white animate-spin" />
                        <span className="text-[11px] font-bold text-white">{label.uploadingImage}</span>
                      </div>
                    ) : (
                      <div className="absolute inset-0 bg-slate-900/55 flex flex-col items-center justify-center gap-1.5 px-2 text-center">
                        <AlertTriangle className="w-5 h-5 text-amber-400" />
                        <span className="text-[11px] font-bold text-white">{label.imageFailed}</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleRetryPendingImage(pending.id)}
                            className="text-[11px] font-bold text-white bg-orange-500 hover:bg-orange-600 px-2.5 py-1 rounded-lg"
                          >
                            {label.retryNow}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemovePendingImage(pending.id)}
                            className="text-[11px] font-bold text-white/90 bg-white/15 hover:bg-white/25 px-2.5 py-1 rounded-lg"
                          >
                            {label.removeAttachment}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  {pending.text && (
                    <div className="mt-1 px-3 py-2 rounded-xl text-[13px] leading-relaxed lg:text-xs break-words max-w-full bg-orange-500/80 text-white">
                      {pending.text}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {canComposeInActiveChannel && isSelectedShipmentClosed && (
        // PR #111 review (Delivered/Closed terminal & chat rules): locks
        // only at the freight-mode-appropriate closing status — never at
        // "Delivered".
        <div className={`border-t border-slate-200 p-3 text-center text-[11px] font-semibold text-slate-500 shrink-0 ${isMobile ? (isKeyboardOpen ? 'pb-2' : 'pb-[max(env(safe-area-inset-bottom),0.75rem)]') : ''}`}>
          This shipment is closed. Chat is now read-only.
        </div>
      )}
      {canComposeInActiveChannel && !isSelectedShipmentClosed && (
        <div className={`border-t border-slate-200 shrink-0 bg-white ${isMobile ? (isKeyboardOpen ? 'pb-1' : 'pb-[max(env(safe-area-inset-bottom),0.5rem)]') : ''}`}>
          {internalSendError === 'upload' && (
            <p className="px-3 pt-2 text-[11px] font-bold text-red-600">{label.uploadFailedError}</p>
          )}
          {internalSendError === 'send' && (
            <p className="px-3 pt-2 text-[11px] font-bold text-red-600">{label.sendFailedError}</p>
          )}
          {internalSendError === 'closed' && (
            <p className="px-3 pt-2 text-[11px] font-bold text-red-600">This shipment is closed. Messages can no longer be sent.</p>
          )}
          {internalSendError === 'heic' && (
            <p className="px-3 pt-2 text-[11px] font-bold text-red-600">{label.heicUnsupported}</p>
          )}
          {internalSendError === 'too_large' && (
            <p className="px-3 pt-2 text-[11px] font-bold text-red-600">{label.imageTooLarge}</p>
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
                {(activeChannel === 'internal_staff' ? INTERNAL_FILE_CATEGORIES : CHANNEL_FILE_CATEGORIES).map((cat) => (
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
            className="p-2.5 lg:p-3 flex items-center gap-2"
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
              onPointerDown={(e) => e.preventDefault()}
              disabled={isSendingInternal}
              title={label.attach}
              aria-label={label.attach}
              className="p-3 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <textarea
              ref={internalTextareaRef}
              rows={1}
              value={internalMessageText}
              onChange={(e) => setInternalMessageText(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter inserts a newline.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendInternalMessage();
                }
              }}
              onFocus={() => {
                // fix/admin-mobile-chat-keyboard-ux: once the iOS keyboard
                // finishes animating in (~250ms), keep the newest messages
                // visible in the shrunken thread.
                if (!isMobile) return;
                setTimeout(() => {
                  const el = messagesContainerRef.current;
                  if (el && isNearBottomRef.current) el.scrollTop = el.scrollHeight;
                }, 300);
              }}
              placeholder={activeChannel === 'internal_staff' ? label.internalInputPlaceholder : label.messagePlaceholder}
              maxLength={MAX_CHAT_TEXT_LENGTH}
              style={{ minHeight: COMPOSER_MIN_HEIGHT_PX, maxHeight: COMPOSER_MAX_HEIGHT_PX }}
              className="flex-1 px-3 py-2.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/40 disabled:opacity-60 resize-none overflow-y-auto leading-normal"
            />
            <button
              type="submit"
              onPointerDown={(e) => e.preventDefault()}
              disabled={!canSubmitChatMessage({ text: internalMessageText, hasAttachment: Boolean(internalFile), isSending: isSendingInternal, isLocked: isSelectedShipmentClosed })}
              className="flex items-center gap-1.5 text-[11px] font-bold text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed px-3.5 py-3 rounded-lg transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
              {label.send}
            </button>
          </form>
        </div>
      )}
    </>
  );

  return (
    <>
      {/* fix/admin-mobile-chat-correctness: no fixed 78dvh-tall box on
          mobile anymore — the list fills the space AdminPanel gives the
          tab (100dvh minus the mobile top bar and bottom nav), and a
          SELECTED conversation renders as the keyboard-aware full-screen
          overlay below instead of squeezing into this in-flow card.
          Desktop (lg) keeps the original two-pane layout and sizing. */}
      <div
        ref={listRootRef}
        className="flex flex-col lg:flex-row min-h-[320px] lg:h-[calc(100vh-220px)] lg:min-h-[520px] bg-white border-0 lg:border border-slate-200 rounded-none lg:rounded-2xl shadow-none -mx-3 lg:mx-0 overflow-hidden"
        style={isMobile && mobileListHeight ? { height: mobileListHeight } : undefined}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Left: shipment conversation list — every row's badge is the
            per-shipment total across channels, from the same authoritative
            unread array as the channel tabs and the global badge. */}
        {/* fix/admin-chat-list-clipping: on mobile this pane must FILL the
            card (flex-1 min-h-0) so the inner list scrolls within it —
            with the previous shrink-0 the pane refused to shrink, grew to
            its full content height, and the card's overflow-hidden simply
            CLIPPED the tail rows (the inner scroller never activated, so
            "scrolled to the end" still hid the last shipment). Desktop
            keeps the fixed 320px side column exactly as before. */}
        <div className="flex w-full flex-1 lg:flex-none lg:w-80 lg:shrink-0 lg:border-e border-slate-200 flex-col min-h-0 bg-white lg:bg-slate-50">
          <div className="p-3 lg:p-4 border-b border-slate-200">
            <h2 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-orange-500" />
              {label.title}
            </h2>
            <div className="relative mt-2.5">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={label.searchPlaceholder}
                className="w-full ps-8 pe-3 py-2 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/40"
              />
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {filteredShipments.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-8 px-4">{label.noShipments}</p>
            )}
            {filteredShipments.map((s) => (
              <ChatSidebarRow
                key={s.id}
                shipment={s}
                isSelected={s.id === selectedShipmentId}
                unreadChatMessages={unreadChatMessages}
                onSelect={handleSelectShipmentRow}
              />
            ))}
          </div>
        </div>

        {/* Desktop right pane — unchanged two-pane experience. */}
        <div className="hidden lg:flex flex-1 flex-col min-w-0 min-h-0">
          {conversationPane}
        </div>
      </div>

      {/* Mobile: the selected conversation as ONE full-screen, keyboard-
          aware view — visualViewport height when the platform reports it
          (the on-screen keyboard shrinks it), 100dvh otherwise. */}
      {isMobile && selectedShipment && (
        <div
          className="fixed inset-x-0 top-0 z-[70] bg-white flex flex-col lg:hidden overscroll-none"
          style={{
            height: visualViewport ? `${visualViewport.height}px` : '100dvh',
            transform: visualViewport && visualViewport.offsetTop > 0 ? `translateY(${visualViewport.offsetTop}px)` : undefined,
            transition: 'height 150ms ease-out',
          }}
          dir={isRtl ? 'rtl' : 'ltr'}
        >
          {conversationPane}
        </div>
      )}

      <ImageLightbox
        target={lightboxTarget}
        onClose={() => setLightboxTarget(null)}
        labels={{ close: label.close, share: label.share, download: label.download }}
      />
    </>
  );
}
