import { useEffect, useState } from 'react';
import { Search, MessageSquare, Lock, Truck, Building2, ExternalLink, Send } from 'lucide-react';
import type { ChatChannel, ChatMessage, Language, Shipment } from '../../types';
import { apiFetch } from '../../lib/api';
import { filterShipmentsBySearch, shipmentRouteLabel, summarizeUnreadForShipment } from '../../lib/chatCenterView';

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
}: ChatCenterProps) {
  const label = LABELS[lang] ?? LABELS.en;

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null);
  const [activeChannel, setActiveChannel] = useState<ChatCenterChannel>('internal_staff');
  const [channelMessages, setChannelMessages] = useState<ChatMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [internalMessageText, setInternalMessageText] = useState('');
  const [isSendingInternal, setIsSendingInternal] = useState(false);

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
      return;
    }
    let cancelled = false;
    setIsLoadingMessages(true);
    apiFetch(`/api/shipments/${selectedShipment.id}/chat?channel=${activeChannel}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!cancelled) setChannelMessages(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setChannelMessages([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingMessages(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedShipment?.id, activeChannel]);

  const handleSendInternalMessage = async () => {
    const text = internalMessageText.trim();
    if (!selectedShipment || !text || isSendingInternal) return;
    setIsSendingInternal(true);
    try {
      const res = await apiFetch(`/api/shipments/${selectedShipment.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'text', text, channel: 'internal_staff' }),
      });
      if (res.ok) {
        const msg = await res.json();
        setChannelMessages((prev) => [...prev, msg]);
        setInternalMessageText('');
      }
    } catch {
      // Swallow — the message simply won't appear; the input keeps the
      // draft text so the admin can retry.
    } finally {
      setIsSendingInternal(false);
    }
  };

  const channelTabs: { id: ChatCenterChannel; label: string; desc: string; icon: typeof Lock }[] = [
    { id: 'internal_staff', label: label.internal, desc: label.internalDesc, icon: Lock },
    { id: 'driver_admin', label: label.driver, desc: label.driverDesc, icon: Truck },
    { id: 'client_admin', label: label.customer, desc: label.customerDesc, icon: Building2 },
  ];

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-220px)] min-h-[520px] bg-white border border-slate-200 rounded-2xl overflow-hidden" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Left: shipment conversation list */}
      <div className="w-full lg:w-80 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col bg-slate-50">
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
                  {unread.count > 0 && (
                    <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center">
                      {unread.count}
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
      <div className="flex-1 flex flex-col min-w-0">
        {!selectedShipment ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-2">
            <MessageSquare className="w-8 h-8 text-slate-300" />
            <p className="text-sm font-semibold text-slate-500">{label.emptyState}</p>
            <p className="text-[11px] text-slate-400 max-w-sm mt-2">{label.futureDirection}</p>
          </div>
        ) : (
          <>
            <div className="p-4 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <span className="font-mono text-xs font-bold text-slate-900">{selectedShipment.shipmentNumber}</span>
                <p className="text-[11px] text-slate-500">{selectedShipment.companyName} · {shipmentRouteLabel(selectedShipment)}</p>
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
                    className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-xs font-bold border-b-2 transition-colors ${
                      isActive ? 'border-orange-500 text-orange-600 bg-orange-50/60' : 'border-transparent text-slate-400 hover:text-slate-600'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Icon className="w-3.5 h-3.5" />
                      {tab.label}
                    </span>
                    <span className="text-[10px] font-medium text-slate-400">{tab.desc}</span>
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
              ) : channelMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center gap-2 py-10">
                  <MessageSquare className="w-6 h-6 text-slate-300" />
                  <p className="text-xs text-slate-400">{label.noMessages}</p>
                </div>
              ) : (
                channelMessages.map((msg) => {
                  const isAdmin = msg.sender === 'admin';
                  return (
                    <div key={msg.id} className={`flex flex-col max-w-[75%] ${isAdmin ? 'ml-auto items-end' : 'mr-auto items-start'}`}>
                      <span className="text-[9px] text-slate-500 font-bold mb-0.5">{msg.senderName}</span>
                      <div className={`px-3 py-2 rounded-xl text-xs ${isAdmin ? 'bg-orange-500 text-white' : 'bg-white border border-slate-200 text-slate-700'}`}>
                        {msg.type === 'file' ? (msg.fileName || 'Attachment') : msg.text}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {activeChannel === 'internal_staff' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendInternalMessage();
                }}
                className="p-3 border-t border-slate-200 flex items-center gap-2"
              >
                <input
                  type="text"
                  value={internalMessageText}
                  onChange={(e) => setInternalMessageText(e.target.value)}
                  placeholder={label.internalInputPlaceholder}
                  className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/40"
                />
                <button
                  type="submit"
                  disabled={!internalMessageText.trim() || isSendingInternal}
                  className="flex items-center gap-1.5 text-[11px] font-bold text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 rounded-lg transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />
                  {label.send}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
