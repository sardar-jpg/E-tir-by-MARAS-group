import { useEffect, useState } from 'react';
import { Search, MessageSquare, Lock, Truck, Building2, ExternalLink } from 'lucide-react';
import type { ChatChannel, ChatMessage, Language, Shipment } from '../../types';
import { apiFetch } from '../../lib/api';
import { filterShipmentsBySearch, shipmentRouteLabel, summarizeUnreadForShipment } from '../../lib/chatCenterView';

// UI-only "channel" for the Chat Center tabs. 'internal' has no backing
// data yet — ChatChannel (src/types.ts) only has driver_admin/client_admin
// today, and adding a real internal channel means touching chat security
// (server.ts, chatVisibility.ts), which is out of scope for this PR.
export type ChatCenterChannel = 'internal' | ChatChannel;

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
  internalPlaceholder: string;
  driver: string;
  driverDesc: string;
  customer: string;
  customerDesc: string;
  noMessages: string;
  loading: string;
  continueInChat: string;
}> = {
  en: {
    title: 'Chat Center',
    searchPlaceholder: 'Search shipment number...',
    noShipments: 'No shipments match your search.',
    emptyState: 'Select a shipment to view its conversations.',
    futureDirection: 'Centralized shipment communication will replace external chat tools over time.',
    internal: 'Internal',
    internalDesc: 'MARAS staff only',
    internalPlaceholder: 'Internal staff chat is coming soon. This channel will let MARAS staff discuss this shipment privately, without customer or driver visibility.',
    driver: 'Driver',
    driverDesc: 'Admin ↔ Driver only',
    customer: 'Customer',
    customerDesc: 'Admin ↔ Customer only',
    noMessages: 'No messages yet in this channel.',
    loading: 'Loading messages...',
    continueInChat: 'Continue in full chat',
  },
  tr: {
    title: 'Mesaj Merkezi',
    searchPlaceholder: 'Sevkiyat numarası ara...',
    noShipments: 'Aramanızla eşleşen sevkiyat yok.',
    emptyState: 'Konuşmalarını görmek için bir sevkiyat seçin.',
    futureDirection: 'Merkezi sevkiyat iletişimi zamanla harici sohbet araçlarının yerini alacak.',
    internal: 'Dahili',
    internalDesc: 'Sadece MARAS ekibi',
    internalPlaceholder: 'Dahili ekip sohbeti yakında geliyor. Bu kanal MARAS ekibinin bu sevkiyatı müşteri veya sürücü görmeden özel olarak konuşmasını sağlayacak.',
    driver: 'Sürücü',
    driverDesc: 'Sadece Yönetici ↔ Sürücü',
    customer: 'Müşteri',
    customerDesc: 'Sadece Yönetici ↔ Müşteri',
    noMessages: 'Bu kanalda henüz mesaj yok.',
    loading: 'Mesajlar yükleniyor...',
    continueInChat: 'Tam sohbette devam et',
  },
  ar: {
    title: 'مركز المحادثات',
    searchPlaceholder: 'ابحث برقم الشحنة...',
    noShipments: 'لا توجد شحنات مطابقة لبحثك.',
    emptyState: 'اختر شحنة لعرض محادثاتها.',
    futureDirection: 'سيحل التواصل المركزي للشحنات محل أدوات المحادثة الخارجية مع مرور الوقت.',
    internal: 'داخلي',
    internalDesc: 'لموظفي ماراس فقط',
    internalPlaceholder: 'محادثة الموظفين الداخلية قادمة قريبًا. ستتيح هذه القناة لموظفي ماراس مناقشة هذه الشحنة بشكل خاص دون رؤية العميل أو السائق.',
    driver: 'السائق',
    driverDesc: 'المدير ↔ السائق فقط',
    customer: 'العميل',
    customerDesc: 'المدير ↔ العميل فقط',
    noMessages: 'لا توجد رسائل بعد في هذه القناة.',
    loading: 'جارٍ تحميل الرسائل...',
    continueInChat: 'المتابعة في المحادثة الكاملة',
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
  const [activeChannel, setActiveChannel] = useState<ChatCenterChannel>('internal');
  const [channelMessages, setChannelMessages] = useState<ChatMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

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

  // Read-only preview of the real driver/customer thread — reuses the same
  // admin-scoped GET endpoint the existing chat drawer uses (App.tsx), so
  // no new privacy/filtering logic is introduced here. Sending a reply
  // still only happens via that existing drawer ("Continue in full chat").
  useEffect(() => {
    if (!selectedShipment || activeChannel === 'internal') {
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

  const channelTabs: { id: ChatCenterChannel; label: string; desc: string; icon: typeof Lock }[] = [
    { id: 'internal', label: label.internal, desc: label.internalDesc, icon: Lock },
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
              {activeChannel !== 'internal' && (
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

            <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-slate-50/50">
              {activeChannel === 'internal' ? (
                <div className="h-full flex flex-col items-center justify-center text-center gap-2 py-10">
                  <Lock className="w-6 h-6 text-slate-300" />
                  <p className="text-xs text-slate-400 max-w-sm">{label.internalPlaceholder}</p>
                </div>
              ) : isLoadingMessages ? (
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
          </>
        )}
      </div>
    </div>
  );
}
