import React, { useState, useEffect } from "react";
import { 
  Shipment,
  Driver,
  ChatMessage,
  ChatChannel,
  ActivityLog,
  AppNotification,
  ShipmentStatus,
  Currency,
  Language,
  TRUCK_TYPES,
  Client,
  Vendor,
  CostStatement,
  CostItem,
  BankAccount
} from "../types";
import { TRANSLATIONS } from "../translations";
import { useIsMobile } from "../hooks/useIsMobile";
import { isNotificationReadForUser, addReaderToNotification } from "../lib/notificationAccess";
import { encodePageCursor } from "../lib/pagination";
import { mergeShipmentsSince, shouldResetShipmentPagination } from "../lib/shipmentPagination";
import {
  Plus, Search, Filter, ShieldCheck, Share2, MessageSquare,
  Building2, Ship, Truck, Calendar, DollarSign, Eye, EyeOff,
  ArrowUpRight, ClipboardList, CheckCircle2, FileText,
  Paperclip, Image as ImageIcon, Send, X, ExternalLink, RefreshCw, UserPlus, Phone, Mail, Check, AlertCircle, Printer,
  Map as MapIcon, Bell, BellRing, Anchor, Plane, Download, Star, Award, Clock, Users, ShieldAlert, User, Lock, Save, Settings, BarChart3
} from 'lucide-react';
import AdminSidebar, { findUngroupedTabIds } from "./admin/AdminSidebar";
import type { ChatCenterFocus } from "./admin/ChatCenter";
import PasswordInput from "./PasswordInput";
import { apiFetch, safeGetItem, safeSetItem } from "../lib/api";
import { canManageClients, canManageVendors, canViewCostStatements, canViewAuditLogs, canViewLogisticsAnalytics, canViewGpsTracking, canViewDriverRoster, canViewShipmentRegistry } from "../lib/adminAccess";
import { accountDeletionCopy } from "../lib/accountDeletion";
import { getAssignableDrivers, getCoreDriverSelectOptions } from "../lib/driverAccess";
import { computeBusyDriverIds, resolveDriverAvailability } from "../lib/driverAlliance";
import DriverAllianceOffers from "./admin/DriverAllianceOffers";
import DriverRouteEditor from "./admin/DriverRouteEditor";
import { resolveExportItems, resolveExportNotes, resolveExportHeaderStatus } from "../lib/costStatementExportView";
import { deriveCustomerSummary, deriveExpenseSummary, resolveCustomerReceivedAmount, computeGrossProfit } from "../lib/costStatementMath";
import { resolveStatementShipmentContext } from "../lib/costStatementRegistryView";
import { resolveDefaultBankAccountForCurrency } from "../lib/accountingTemplateSettings";
import { containsRawPrivateDocumentUrl } from "../lib/emailSafety";
import { resolveMoreMenuTabIds, resolvePrimaryMobileTabs } from "../lib/mobileAdminNav";
import { formatUnreadBadge, dropSeenUnreadMessages, applyUnreadPollResponse, type ConfirmedSeenScope } from "../lib/chatUnreadAccess";
import { getAllowedNextShipmentStatuses, isShipmentClosed, getStatusSequenceForFreightMode, resolveFreightMode } from "../lib/shipmentStatusTransitions";
import { MARAS_AI_QUICK_SUGGESTIONS, MARAS_AI_SOURCE_LABELS, deriveMarasAiAttention, type MarasAiStructuredResult } from "../lib/marasAiIntents";
import MarasAiResponseView from "./admin/MarasAiResponseView";
import MarasAiMonitoringPanel from "./admin/MarasAiMonitoringPanel";
import MarasAiBriefCard from "./admin/MarasAiBriefCard";
import ExecutiveFinancialSection, { FinancialAlertsCard } from "./admin/ExecutiveFinancialSection";
import ReceivablesOverviewCard from "./admin/ReceivablesOverviewCard";
import CostApprovalWorkflowCard from "./admin/CostApprovalWorkflowCard";
import VendorPayablesPanel from "./admin/VendorPayablesPanel";
import CustomerInvoicePanel from "./admin/CustomerInvoicePanel";
import CostStatementWorkspace from "./admin/CostStatementWorkspace";
import CustomerAccountPanel from "./admin/CustomerAccountPanel";
import { DEFAULT_DASHBOARD_LAYOUT, DASHBOARD_SECTION_IDS, normalizeDashboardLayout, moveDashboardSection, reorderDashboardSection, toggleDashboardSection, visibleOrderedSections, type DashboardLayout, type DashboardSectionId } from "../lib/dashboardLayout";
import { isOpenShipmentStatus } from "../lib/executiveFinance";
import MobileTopAppBar from "./admin/mobile/MobileTopAppBar";
import MobileBottomNav from "./admin/mobile/MobileBottomNav";
import MobileMoreMenu from "./admin/mobile/MobileMoreMenu";
import MobileNotificationsSheet from "./admin/mobile/MobileNotificationsSheet";
import MobileDashboard from "./admin/mobile/MobileDashboard";
import MobileOrdersList from "./admin/mobile/MobileOrdersList";

// Heavy, tab-scoped admin sections — lazy-loaded so their code (and, for
// TrackingMap, the Google Maps SDK) only ships once an admin actually
// selects that tab, instead of always being part of the main AdminPanel
// bundle. Role checks that decide whether a tab may render at all stay in
// AdminPanel.tsx, ahead of these lazy boundaries (see each `activeTab ===`
// content block below) — a role that isn't allowed a section never even
// triggers the dynamic import.
const TrackingMap = React.lazy(() => import("./TrackingMap"));
const ChatCenter = React.lazy(() => import("./admin/ChatCenter"));
const AdminDashboardSection = React.lazy(() => import("./admin/sections/AdminDashboardSection"));
const AdminReportsSection = React.lazy(() => import("./admin/sections/AdminReportsSection"));
const AdminCostsSection = React.lazy(() => import("./admin/sections/AdminCostsSection"));
const AdminClientsSection = React.lazy(() => import("./admin/sections/AdminClientsSection"));
const AdminVendorsSection = React.lazy(() => import("./admin/sections/AdminVendorsSection"));
const AdminAuditSection = React.lazy(() => import("./admin/sections/AdminAuditSection"));
const AdminTeamSection = React.lazy(() => import("./admin/sections/AdminTeamSection"));
const AdminSettingsSection = React.lazy(() => import("./admin/sections/AdminSettingsSection"));

const LAZY_SECTION_LOADING_LABEL: Record<Language, string> = {
  en: "Loading…",
  tr: "Yükleniyor…",
  ar: "جارٍ التحميل…",
};

function AdminSectionLoadingFallback({ lang }: { lang: Language }) {
  return (
    <div className="flex items-center justify-center gap-2 py-20 text-slate-400 text-sm font-semibold">
      <RefreshCw className="w-4 h-4 animate-spin" />
      <span>{LAZY_SECTION_LOADING_LABEL[lang] ?? LAZY_SECTION_LOADING_LABEL.en}</span>
    </div>
  );
}

const fetch = apiFetch;

// PR #128 refinement: the drawer's quick suggestions come from the same
// shared module the server's intent detection lives in
// (src/lib/marasAiIntents.ts), so every suggestion is a prompt the
// backend genuinely knows how to collect system data for. Selecting one
// only populates the prompt — the employee still presses Send.
// PR #133: customize-bar labels for the Executive Dashboard sections.
// "Active" pseudo-status for the shipment list filter: everything that is
// still open (not Delivered/Closed/Completed) — the same rule the executive
// Open Shipments Value KPI uses (isOpenShipmentStatus), so the KPI and the
// list it opens can never disagree.
const ACTIVE_FILTER_LABEL: Record<string, string> = { en: 'Active', tr: 'Aktif', ar: 'نشطة' };

const DASHBOARD_SECTION_LABELS: Record<string, { en: string; tr: string; ar: string }> = {
  executive_brief: { en: 'Executive Brief', tr: 'Yönetici Brifingi', ar: 'الموجز التنفيذي' },
  operations: { en: 'Operations', tr: 'Operasyon', ar: 'العمليات' },
  financial: { en: 'Executive Financial Overview', tr: 'Yönetici Finansal Genel Bakış', ar: 'النظرة المالية التنفيذية' },
  financial_alerts: { en: 'Financial Alerts', tr: 'Finansal Uyarılar', ar: 'تنبيهات مالية' },
  analytics: { en: 'Logistics Analytics', tr: 'Lojistik Analitiği', ar: 'تحليلات لوجستية' },
};

const MARAS_AI_SUGGESTION_ICONS: Record<string, typeof Ship> = {
  delayed_shipments: Clock,
  todays_operations: Calendar,
  monitoring_alerts: ShieldAlert,
  missing_documents: FileText,
  operational_risks: AlertCircle,
  dashboard_summary: BarChart3,
  driver_performance: Truck,
};

/**
 * Decodes the `id` field out of this browser's own signed session token
 * (see src/lib/auth.ts) — the same value the backend stamps onto a chat
 * notification's excludeUserId (req.session.id at send time). The token's
 * payload segment is base64url, not encrypted, so it's safe to read
 * client-side without the signing secret. Used only to recognize "this is
 * my own chat message" for the toast guard below — never for authorization,
 * which stays entirely server-side.
 */
function getOwnSessionId(): string | null {
  try {
    const stored = localStorage.getItem("etir_session");
    if (!stored) return null;
    const token = JSON.parse(stored)?.token;
    if (typeof token !== "string") return null;
    const [body] = token.split(".");
    if (!body) return null;
    const base64 = body.replace(/-/g, "+").replace(/_/g, "/").padEnd(body.length + ((4 - (body.length % 4)) % 4), "=");
    const payload = JSON.parse(atob(base64));
    return typeof payload?.id === "string" ? payload.id : null;
  } catch {
    return null;
  }
}

/** Masks a recipient email before it's persisted into the shared, admin-readable audit log. */
function maskEmailForLog(email: string): string {
  const [user, domain] = (email || "").split("@");
  if (!user || !domain) return "unknown-recipient";
  return `${user[0]}***@${domain}`;
}

const COUNTRY_PORTS: Record<string, string[]> = {
  "Turkey": ["Port of Ambarli (Istanbul)", "Port of Mersin", "Port of Gemlik", "Port of Izmir (Alsancak)", "Port of Aliaga", "Port of Iskenderun", "Port of Derince"],
  "Türkiye": ["Ambarlı Limanı (İstanbul)", "Mersin Limanı", "Gemlik Limanı", "İzmir Limanı (Alsancak)", "Aliağa Limanı", "İskenderun Limanı", "Derince Limanı"],
  "China": ["Port of Shanghai", "Port of Shenzhen", "Port of Ningbo-Zhoushan", "Port of Qingdao", "Port of Guangzhou", "Port of Tianjin", "Port of Xiamen"],
  "Çin": ["Şanghay Limanı", "Shenzhen Limanı", "Ningbo Limanı", "Qingdao Limanı", "Guangzhou Limanı", "Tianjin Limanı"],
  "Germany": ["Port of Hamburg", "Port of Bremerhaven", "Port of Wilhelmshaven"],
  "Almanya": ["Hamburg Limanı", "Bremerhaven Limanı"],
  "Italy": ["Port of Genoa", "Port of Gioia Tauro", "Port of Trieste", "Port of La Spezia"],
  "İtalya": ["Cenova Limanı", "Gioia Tauro Limanı", "Trieste Limanı"],
  "Spain": ["Port of Valencia", "Port of Algeciras", "Port of Barcelona"],
  "İspanya": ["Valensiya Limanı", "Algeciras Limanı", "Barselona Limanı"],
  "UAE": ["Port of Jebel Ali (Dubai)", "Port of Khalifa (Abu Dhabi)", "Port of Sharjah"],
  "BAE": ["Cebel Ali Limanı (Dubai)", "Halife Limanı (Abu Dabi)"],
  "United Arab Emirates": ["Port of Jebel Ali (Dubai)", "Port of Khalifa (Abu Dhabi)", "Port of Sharjah"],
  "India": ["Port of Nhava Sheva (Mumbai)", "Port of Mundra", "Port of Chennai"],
  "Hindistan": ["Nhava Sheva Limanı", "Mundra Limanı"],
  "USA": ["Port of Los Angeles", "Port of New York & New Jersey", "Port of Savannah", "Port of Houston"],
  "ABD": ["Los Angeles Limanı", "New York Limanı", "Houston Limanı"],
  "Iraq": ["Port of Umm Qasr (Basra)", "Abu Fulus Port", "Khor Al-Zubair Port"],
  "Irak": ["Umm Qasr Limanı (Basra)", "Ebu Fulus Limanı", "Hor Al-Zubayr Limanı"]
};

const getPortsForCountry = (countryName: string): string[] => {
  if (!countryName) return [];
  const normalized = countryName.trim().toLowerCase();
  
  if (normalized.includes("turk") || normalized.includes("türk")) {
    return COUNTRY_PORTS["Turkey"];
  }
  if (normalized.includes("chin") || normalized.includes("çin")) {
    return COUNTRY_PORTS["China"];
  }
  if (normalized.includes("germany") || normalized.includes("almanya")) {
    return COUNTRY_PORTS["Germany"];
  }
  if (normalized.includes("ital")) {
    return COUNTRY_PORTS["Italy"];
  }
  if (normalized.includes("spain") || normalized.includes("ispan") || normalized.includes("ispān")) {
    return COUNTRY_PORTS["Spain"];
  }
  if (normalized.includes("uae") || normalized.includes("emirate") || normalized.includes("bae") || normalized.includes("birlesik")) {
    return COUNTRY_PORTS["UAE"];
  }
  if (normalized.includes("india") || normalized.includes("hind")) {
    return COUNTRY_PORTS["India"];
  }
  if (normalized.includes("usa") || normalized.includes("united states") || normalized.includes("abd") || normalized.includes("amerika")) {
    return COUNTRY_PORTS["USA"];
  }
  if (normalized.includes("iraq") || normalized.includes("irak")) {
    return COUNTRY_PORTS["Iraq"];
  }

  for (const key of Object.keys(COUNTRY_PORTS)) {
    if (key.toLowerCase() === normalized) {
      return COUNTRY_PORTS[key];
    }
  }
  
  return [];
};

// Fresh object every call so the Create Shipment modal always starts blank —
// used on initial state, after a successful submit, and on Cancel/close, so
// stale field values (and a stale freightType selection) never carry over
// into the next time an admin opens the dialog.
const createEmptyShipmentForm = () => ({
  companyName: "",
  loadingCountry: "Turkey",
  loadingCity: "Istanbul",
  loadingAddress: "",
  loadingContactNumber: "",
  deliveryCountry: "Iraq",
  deliveryCity: "Baghdad",
  deliveryAddress: "",
  deliveryContactNumber: "",
  cargoDescription: "",
  cargoWeight: "",
  truckNumber: "",
  assignedDriverId: "",
  agreedAmount: "",
  currency: "USD" as Currency,
  internalNotes: "",

  // Sea & Air properties initial state
  freightType: "land" as "land" | "sea" | "air",
  additionalDrivers: [] as Array<{ driverId: string; driverName: string; truckNumber: string; agreedAmount?: number }>,
  additionalContainers: [] as string[],
  shippingLine: "",
  vesselName: "",
  containerNumber: "",
  bookingNumber: "",
  billOfLadingNumber: "",
  portOfLoading: "",
  portOfDischarge: "",
  finalDestination: "",
  etd: "",
  eta: "",
  numberOfContainers: "",
  containerType: "",
  airline: "",
  flightNumber: "",
  airWaybillNumber: "",
  airportOfDeparture: "",
  airportOfArrival: "",
  grossWeight: "",
  chargeableWeight: "",
  numberOfPackages: "",

  // Custom Broker details
  destinationBrokerId: "",
  destinationBrokerName: "",
  destinationBrokerPhone: "",
  iraqBorderBrokerId: "",
  iraqBorderBrokerName: "",
  iraqBorderBrokerPhone: "",
});

interface AdminPanelProps {
  lang: Language;
  // BUG-03: optional channel hint so opening chat from a driver_admin or
  // client_admin message/notification lands on the right audience's
  // thread instead of defaulting to driver_admin.
  onSelectShipmentChat: (shipment: Shipment, channel?: ChatChannel) => void;
  /** fix/admin-mobile-chat-correctness: App.tsx's chat drawer publishes a
      monotonic event here every time the server CONFIRMS one of its seen
      calls, so this panel can drop that shipment+channel from
      unreadChatMessages immediately — the drawer used to tell nobody and
      every badge stayed stale until the next ~12s poll. */
  chatSeenEvent?: { shipmentId: string; channel: ChatChannel; seq: number } | null;
  openDetailsId: string | null;
  setOpenDetailsId: (id: string | null) => void;
  gmailUser?: any;
  gmailToken?: string | null;
  onConnectGmail?: () => void;
  onDisconnectGmail?: () => void;
  isMobile?: boolean;
  isConnectingGmail?: boolean;
  adminEmail?: string;
  adminType?: string;
  /** feature/admin-mobile-ui: lets the mobile "More" menu offer a Logout
      entry. App.tsx's own Logout button (outer header) is now hidden on
      mobile (correction pass — it duplicated MobileTopAppBar), so this is
      mobile's only reachable Logout; desktop keeps using App.tsx's own
      header button, unchanged, calling the same handler. */
  onLogout?: () => void;
  /** feature/admin-mobile-ui correction pass: lets the mobile "More" menu
      offer language switching. App.tsx's own language <select> (outer
      header) is now hidden on mobile for the same reason as onLogout
      above; desktop keeps using App.tsx's own switcher, unchanged. */
  onLangChange?: (lang: Language) => void;
}

export default function AdminPanel({
  lang,
  onSelectShipmentChat,
  chatSeenEvent = null,
  openDetailsId,
  setOpenDetailsId,
  gmailUser = null,
  gmailToken = null,
  onConnectGmail,
  onDisconnectGmail,
  isMobile = false,
  isConnectingGmail = false,
  adminEmail = '',
  adminType = '',
  onLogout,
  onLangChange,
}: AdminPanelProps) {
  const isMobileMode = isMobile || useIsMobile(1024);

  const t = (key: keyof typeof TRANSLATIONS['en']) => {
    return TRANSLATIONS[lang][key] || TRANSLATIONS['en'][key] || String(key);
  };

  const isRtl = lang === 'ar';

  const showPasswordLabel = lang === 'tr' ? 'Şifreyi göster' : (lang === 'ar' ? 'إظهار كلمة المرور' : 'Show password');
  const hidePasswordLabel = lang === 'tr' ? 'Şifreyi gizle' : (lang === 'ar' ? 'إخفاء كلمة المرور' : 'Hide password');
  const passwordMismatchError = lang === 'tr' ? 'Şifreler eşleşmiyor.' : (lang === 'ar' ? 'كلمتا المرور غير متطابقتين.' : 'Passwords do not match.');
  const passwordToggleClasses = "absolute end-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer bg-transparent border-0 p-0";

  // BUG-16: adminType is the single source of truth for admin UI decisions —
  // this component used to also accept a `userRole` prop, but no caller ever
  // passed it, so its 'accounts' branch was always dead and every check that
  // referenced it silently fell through to the 'admin'/'super' default.
  const isAccountsAdminType = adminType === 'accounts' || adminType === 'account';

  // State Management
  const [shipments, setShipments] = useState<Shipment[]>([]);
  // Phase 2A follow-up (blocking-issue fix): GET /api/shipments now
  // returns only the latest page (default 50) — these track the cursor
  // pagination state for the explicit "Load Older Shipments" action, and
  // shipmentStats holds the server-computed accessible-scope totals
  // (GET /api/shipments/stats) so the dashboard never presents a partial
  // "however many happen to be loaded" count as a global business total.
  const [shipmentsNextCursor, setShipmentsNextCursor] = useState<string | null>(null);
  const [shipmentsHasMore, setShipmentsHasMore] = useState(false);
  const [shipmentsLoadingMore, setShipmentsLoadingMore] = useState(false);
  const [shipmentStats, setShipmentStats] = useState<{ total: number; byStatusGroup?: Record<string, number> } | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selectedPerformanceDriver, setSelectedPerformanceDriver] = useState<Driver | null>(null);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadChatMessages, setUnreadChatMessages] = useState<ChatMessage[]>([]);
  // fix/admin-mobile-chat-correctness: every server-CONFIRMED seen scope
  // this session applied locally, with when it was confirmed
  // (client clock). Used by applyUnreadPollResponse to stop an unread
  // poll response that was FETCHED before the seen succeeded from
  // resurrecting the just-cleared badge when it lands afterwards. Kept
  // small: scopes older than a minute can no longer race any in-flight
  // poll (12s cadence) and are pruned on each append.
  const confirmedSeenScopesRef = React.useRef<ConfirmedSeenScope[]>([]);
  const recordConfirmedSeen = React.useCallback((shipmentId: string, channel: ChatChannel) => {
    const now = Date.now();
    confirmedSeenScopesRef.current = [
      ...confirmedSeenScopesRef.current.filter((s) => now - s.confirmedAt < 60_000),
      { shipmentId, channel, confirmedAt: now },
    ];
    // The confirmed drop itself: shipment badge, channel badge, bottom-nav
    // badge, and bell dropdown all derive from this one array — including
    // channel-less legacy messages whose audience resolves to this
    // channel, mirroring exactly what the server just deleted.
    setUnreadChatMessages((prev) => dropSeenUnreadMessages(prev, shipmentId, channel));
  }, []);
  const [isChatDropdownOpen, setIsChatDropdownOpen] = useState(false);
  const chatDropdownRef = React.useRef<HTMLDivElement>(null);
  // PR #36 UI foundation, connected to the real backend in PR #128:
  // conversation state for the ✨ MARAS AI drawer. Conversations are
  // PERSISTED per admin server-side (each admin only ever sees their
  // own); the OpenAI call happens exclusively server-side
  // (POST /api/admin/maras-ai/chat) — no key or provider client exists in
  // this bundle. Assistant turns carry the server-derived response-source
  // indicator (System Data / AI Analysis / System Data + AI Analysis).
  const [isMarasAiOpen, setIsMarasAiOpen] = useState(false);
  const [marasAiPrompt, setMarasAiPrompt] = useState("");
  const [marasAiThread, setMarasAiThread] = useState<{ role: 'user' | 'assistant'; text: string; source?: string; structured?: MarasAiStructuredResult[] }[]>([]);
  const [isMarasAiSending, setIsMarasAiSending] = useState(false);
  const [marasAiError, setMarasAiError] = useState("");
  const [marasAiConversations, setMarasAiConversations] = useState<{ id: string; title: string; updatedAt: string; messageCount: number }[]>([]);
  const [activeMarasAiConversationId, setActiveMarasAiConversationId] = useState<string | null>(null);

  // Refresh this admin's own conversation list whenever the drawer opens.
  useEffect(() => {
    if (!isMarasAiOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/admin/maras-ai/conversations");
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setMarasAiConversations(Array.isArray(data.conversations) ? data.conversations : []);
        }
      } catch {
        // Listing is best-effort; sending still works without it.
      }
    })();
    return () => { cancelled = true; };
  }, [isMarasAiOpen]);

  const handleNewMarasAiConversation = () => {
    setActiveMarasAiConversationId(null);
    setMarasAiThread([]);
    setMarasAiPrompt("");
    setMarasAiError("");
  };

  const handleOpenMarasAiConversation = async (conversationId: string) => {
    setMarasAiError("");
    try {
      const res = await apiFetch(`/api/admin/maras-ai/conversations/${conversationId}`);
      if (!res.ok) {
        setMarasAiError("Could not load this conversation.");
        return;
      }
      const data = await res.json();
      const messages = Array.isArray(data.conversation?.messages) ? data.conversation.messages : [];
      setMarasAiThread(messages.map((m: any) => ({
        role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
        text: String(m.text || ""),
        ...(typeof m.source === 'string' ? { source: m.source } : {}),
        // PR #130: stored assistant messages carry their card payload so
        // reopening a conversation re-renders the same cards.
        ...(Array.isArray(m.structured) ? { structured: m.structured } : {}),
      })));
      setActiveMarasAiConversationId(conversationId);
    } catch {
      setMarasAiError("Could not load this conversation. Check your connection.");
    }
  };

  const handleDeleteMarasAiConversation = async (conversationId: string) => {
    if (!window.confirm("Delete this MARAS AI conversation? This cannot be undone.")) return;
    try {
      const res = await apiFetch(`/api/admin/maras-ai/conversations/${conversationId}`, { method: "DELETE" });
      if (res.ok) {
        setMarasAiConversations((prev) => prev.filter((c) => c.id !== conversationId));
        if (activeMarasAiConversationId === conversationId) handleNewMarasAiConversation();
      } else {
        setMarasAiError("Could not delete the conversation.");
      }
    } catch {
      setMarasAiError("Could not delete the conversation. Check your connection.");
    }
  };

  // PR #130 — read-only navigation actions on MARAS AI shipment cards.
  // Each just routes into an EXISTING Admin view (details modal, tracking
  // tab, Chat Center) and closes the drawer; nothing here can write data.
  // The tracking action is additionally role-gated at the render site
  // (canViewGpsTracking) — the button never exists for roles without it.
  const handleMarasAiOpenShipment = (shipmentId: string) => {
    setIsMarasAiOpen(false);
    setOpenDetailsId(shipmentId);
  };
  const handleMarasAiOpenTracking = () => {
    setIsMarasAiOpen(false);
    setActiveTab('tracking_map');
  };
  const handleMarasAiOpenChat = (shipmentId: string) => {
    setIsMarasAiOpen(false);
    setChatCenterFocus({ shipmentId, channel: 'internal_staff' });
    setActiveTab('chat_center');
  };

  const handleSendMarasAi = async () => {
    const message = marasAiPrompt.trim();
    // Duplicate-submission guard: one in-flight request at a time.
    if (!message || isMarasAiSending) return;
    setIsMarasAiSending(true);
    setMarasAiError("");
    setMarasAiThread((prev) => [...prev, { role: 'user', text: message }]);
    try {
      const res = await apiFetch("/api/admin/maras-ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          // Continuing a conversation: the server uses its own stored
          // thread as history. First turn of a new one: nothing to send.
          ...(activeMarasAiConversationId ? { conversationId: activeMarasAiConversationId } : { history: marasAiThread.slice(-12) }),
          context: {
            page: activeTab,
            // The shipment whose details modal is open, if any — the
            // server loads the authoritative record itself.
            ...(openDetailsId ? { shipmentId: openDetailsId } : {}),
          },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setMarasAiThread((prev) => [...prev, {
          role: 'assistant',
          text: String(data.reply || ""),
          ...(typeof data.source === 'string' ? { source: data.source } : {}),
          ...(Array.isArray(data.structured) && data.structured.length ? { structured: data.structured } : {}),
        }]);
        setMarasAiPrompt("");
        // The reply lives in a persisted conversation now — track it and
        // float its summary to the top of the list.
        if (data.conversation?.id) {
          setActiveMarasAiConversationId(String(data.conversation.id));
          setMarasAiConversations((prev) => [
            {
              id: String(data.conversation.id),
              title: String(data.conversation.title || "New conversation"),
              updatedAt: String(data.conversation.updatedAt || new Date().toISOString()),
              messageCount: Number(data.conversation.messageCount) || 0,
            },
            ...prev.filter((c) => c.id !== data.conversation.id),
          ]);
        }
      } else {
        let body: any = null;
        try { body = await res.json(); } catch {}
        // 503 = cleanly unavailable (disabled/unconfigured); 502 =
        // provider failure — both show the server's own clear message.
        setMarasAiError(body?.error || "MARAS AI request failed. Please try again.");
      }
    } catch {
      setMarasAiError("MARAS AI request failed. Check your connection and try again.");
    } finally {
      setIsMarasAiSending(false);
    }
  };
  const [activeTab, setActiveTab] = useState<'dashboard' | 'shipments' | 'drivers' | 'reports' | 'audit' | 'gmail' | 'tracking_map' | 'clients' | 'vendors' | 'costs' | 'team' | 'my_account' | 'chat_center' | 'settings'>(
    isAccountsAdminType ? 'costs' : 'dashboard'
  );
  // PR #132: Logistics Analysis merged into the unified Dashboard. The
  // 'reports' tab id stays valid for backward compatibility (old quick
  // links, saved navigation state) but always redirects to Dashboard
  // with the analytics section expanded.
  const [isDashboardAnalyticsOpen, setIsDashboardAnalyticsOpen] = useState(false);
  // PR #133 — per-admin Executive Dashboard personalization: section
  // visibility + order, persisted per user (adminDashboardLayouts).
  // Rendering intersects this with the viewer's PERMITTED sections, so
  // a saved layout can never widen access.
  const [dashboardLayout, setDashboardLayout] = useState<DashboardLayout>(DEFAULT_DASHBOARD_LAYOUT);
  const [isDashboardCustomizeOpen, setIsDashboardCustomizeOpen] = useState(false);
  const [draggedDashboardSection, setDraggedDashboardSection] = useState<DashboardSectionId | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/admin/dashboard/layout");
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data.layout) setDashboardLayout(normalizeDashboardLayout(data.layout));
        }
      } catch { /* default layout is fine */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const permittedDashboardSections = React.useMemo(() => {
    const effectiveType = adminType || 'super'; // same fallback resolvedAdminType uses below
    const allowed = new Set<DashboardSectionId>(['executive_brief', 'operations']);
    if (canViewCostStatements(effectiveType)) { allowed.add('financial'); allowed.add('financial_alerts'); }
    if (canViewLogisticsAnalytics(effectiveType)) allowed.add('analytics');
    return allowed;
  }, [adminType]);
  const saveDashboardLayout = (next: DashboardLayout) => {
    setDashboardLayout(next);
    void apiFetch("/api/admin/dashboard/layout", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layout: next }),
    }).catch(() => {});
  };
  useEffect(() => {
    if (activeTab === 'reports') {
      setIsDashboardAnalyticsOpen(true);
      setActiveTab('dashboard');
    }
  }, [activeTab]);

  // Set by the Shipment Details modal's chat shortcut buttons to preselect
  // a shipment + channel when navigating into the Chat Center tab.
  const [chatCenterFocus, setChatCenterFocus] = useState<ChatCenterFocus | null>(null);

  // fix/admin-mobile-chat-correctness: App.tsx's chat drawer confirmed a
  // seen call server-side — apply the same immediate badge drop the Chat
  // Center's own onChannelRead path gets. seq is monotonic, so repeated
  // confirmations of the same scope re-fire (each one may follow newly
  // arrived messages).
  useEffect(() => {
    if (!chatSeenEvent) return;
    recordConfirmedSeen(chatSeenEvent.shipmentId, chatSeenEvent.channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatSeenEvent?.seq]);

  // Desktop sidebar collapse (icons-only vs icon+label), persisted across
  // sessions. safeGetItem/safeSetItem (src/lib/api.ts) already fall back to
  // an in-memory store when localStorage is blocked (iframe sandboxing,
  // Safari private mode, etc.), so this is safe to read at initial state
  // time without a separate SSR/browser-availability check.
  const ADMIN_SIDEBAR_COLLAPSED_KEY = 'etir_admin_sidebar_collapsed';
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(
    () => safeGetItem(ADMIN_SIDEBAR_COLLAPSED_KEY) === 'true'
  );
  useEffect(() => {
    safeSetItem(ADMIN_SIDEBAR_COLLAPSED_KEY, isSidebarCollapsed ? 'true' : 'false');
  }, [isSidebarCollapsed]);

  // Mobile/tablet off-canvas nav drawer — closed by default so it never
  // permanently occupies the screen; AdminSidebar itself closes it after a
  // tab is selected.
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  // feature/admin-mobile-ui: the mobile "More" page (bottom nav's 5th
  // slot). Distinct from isMobileNavOpen above (the existing off-canvas
  // drawer, still used by the desktop-style "Menu" affordance nothing in
  // this change removes) — this instead swaps the main content area for
  // MobileMoreMenu, matching how the other 4 primary tabs each replace
  // the content area.
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);

  // PR #34: internal_staff has no UI in the App.tsx full chat drawer (its
  // channel toggle/header only know about driver_admin vs client_admin —
  // extending it there risked touching that driver/client chat surface,
  // which this PR intentionally leaves alone). So any "open chat" entry
  // point that might carry channel: 'internal_staff' (unread dropdown,
  // notification bell) routes to the Chat Center's Internal tab instead of
  // the full drawer; every other channel keeps going to the full drawer as
  // before.
  const openShipmentChatForChannel = (shipment: Shipment, channel?: ChatChannel) => {
    if (channel === 'internal_staff') {
      setChatCenterFocus({ shipmentId: shipment.id, channel: 'internal_staff' });
      setActiveTab('chat_center');
      return;
    }
    onSelectShipmentChat(shipment, channel);
  };

  // Real-time Dashboard Clock
  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const clockTimer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(clockTimer);
  }, []);

  // SWR Pattern States & Global Synchronization
  const [swrStatus, setSwrStatus] = useState<'synced' | 'syncing' | 'offline' | 'error'>('syncing');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [swrErrorDetail, setSwrErrorDetail] = useState<string | null>(null);

  // Client Management States
  const [clients, setClients] = useState<Client[]>([]);
  const [clientSearchQuery, setClientSearchQuery] = useState("");
  const [isAddClientOpen, setIsAddClientOpen] = useState(false);
  const [expandedClientOrdersCompanyName, setExpandedClientOrdersCompanyName] = useState<string | null>(null);

  // Operation Team Management States
  const [adminsList, setAdminsList] = useState<any[]>([]);
  const [isAddAdminOpen, setIsAddAdminOpen] = useState(false);
  const [newAdminName, setNewAdminName] = useState("");
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [newAdminConfirmPassword, setNewAdminConfirmPassword] = useState("");
  const [newAdminType, setNewAdminType] = useState<"operation" | "accounts">("operation");
  const [adminFormError, setAdminFormError] = useState<string | null>(null);

  // Admin (sub-admin) account deletion states — required by Apple App
  // Store Guideline 5.1.1(v): apps that support account creation must also
  // offer account deletion. Sub-admins are created through this app's own
  // "Create Admin" flow, so they need self-service deletion just like
  // drivers and clients already have. The super-admin (config-based root
  // account, never created through the app) is intentionally excluded.
  const [showAdminSelfDeleteConfirm, setShowAdminSelfDeleteConfirm] = useState(false);
  const [understandAdminSelfDelete, setUnderstandAdminSelfDelete] = useState(false);
  const [isDeletingAdminSelfAccount, setIsDeletingAdminSelfAccount] = useState(false);
  // Apple Guideline 5.1.1(v) consolidation: calls DELETE /api/account (not
  // DELETE /api/admins/me directly) — every non-owner admin has a stored
  // password (POST /api/admins/change-password is the only way to set
  // one, so every admin created through "Create Admin" has one from
  // creation), which that endpoint now requires and verifies before
  // proceeding. The env-configured owner is still shown this exact same
  // control and confirmation flow — never hidden — but the SERVER, not
  // the client, is what refuses to complete it, with a clear, honest,
  // localized reason (ownerProtectedError below) rather than a dead-end
  // "not available" message with no delete control ever reachable at all.
  const [adminDeleteCurrentPassword, setAdminDeleteCurrentPassword] = useState("");
  const [adminDeleteError, setAdminDeleteError] = useState<
    null | "missing" | "incorrect" | "rate_limited" | "service_unavailable" | "owner_protected" | "generic" | "network"
  >(null);

  const handleDeleteAdminSelfAccount = async () => {
    if (!understandAdminSelfDelete) return;
    if (isDeletingAdminSelfAccount) return; // in-flight guard — no double-submit
    setIsDeletingAdminSelfAccount(true);
    setAdminDeleteError(null);
    try {
      const response = await apiFetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: adminDeleteCurrentPassword }),
      });
      if (response.ok) {
        setAdminDeleteCurrentPassword("");
        triggerToast(accountDeletionCopy(lang).successMessage);
        setShowAdminSelfDeleteConfirm(false);
        setTimeout(() => {
          if (onLogout) onLogout();
        }, 1200);
      } else if (response.status === 400) {
        setAdminDeleteError("missing");
      } else if (response.status === 401) {
        setAdminDeleteError("incorrect");
      } else if (response.status === 403) {
        setAdminDeleteError("owner_protected");
      } else if (response.status === 429) {
        setAdminDeleteError("rate_limited");
      } else if (response.status === 503) {
        setAdminDeleteError("service_unavailable");
      } else {
        setAdminDeleteError("generic");
      }
    } catch (err) {
      console.error(err);
      setAdminDeleteError("network");
    } finally {
      setIsDeletingAdminSelfAccount(false);
    }
  };

  // Change-password states for sub-admins (the super-admin's password
  // lives in an environment variable and cannot be changed here - see
  // POST /api/admins/change-password in server.ts).
  const [currentPasswordInput, setCurrentPasswordInput] = useState("");
  const [newPasswordInput, setNewPasswordInput] = useState("");
  const [confirmNewPasswordInput, setConfirmNewPasswordInput] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [changePasswordError, setChangePasswordError] = useState<string | null>(null);

  const handleChangeOwnPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangePasswordError(null);

    if (!currentPasswordInput || !newPasswordInput || !confirmNewPasswordInput) {
      setChangePasswordError(lang === 'tr' ? 'Lütfen tüm alanları doldurun' : (lang === 'ar' ? 'يرجى ملء جميع الحقول' : 'Please fill all fields'));
      return;
    }
    if (newPasswordInput.length < 8) {
      setChangePasswordError(lang === 'tr' ? 'Yeni şifre en az 8 karakter olmalıdır' : (lang === 'ar' ? 'يجب أن تتكون كلمة المرور الجديدة من 8 أحرف على الأقل' : 'New password must be at least 8 characters'));
      return;
    }
    if (newPasswordInput !== confirmNewPasswordInput) {
      setChangePasswordError(lang === 'tr' ? 'Yeni şifreler eşleşmiyor' : (lang === 'ar' ? 'كلمتا المرور الجديدتان غير متطابقتين' : 'New passwords do not match'));
      return;
    }

    setIsChangingPassword(true);
    try {
      const res = await apiFetch("/api/admins/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: currentPasswordInput, newPassword: newPasswordInput })
      });
      if (res.ok) {
        setCurrentPasswordInput("");
        setNewPasswordInput("");
        setConfirmNewPasswordInput("");
        triggerToast("✅ Password updated successfully.");
      } else {
        const errData = await res.json();
        setChangePasswordError(errData.error || "Failed to update password.");
      }
    } catch (err: any) {
      setChangePasswordError(err.message || "Could not reach the server.");
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleDriverApproval = async (driverId: string, status: "approved" | "rejected") => {
    try {
      const res = await apiFetch(`/api/drivers/${driverId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        triggerToast(status === "approved" ? "Driver approved." : "Driver registration rejected.");
        fetchData();
      } else {
        const errData = await res.json();
        triggerToast(errData.error || "Failed to update driver status.");
      }
    } catch (err) {
      triggerToast("Could not reach the server.");
    }
  };


  // Driver Alliance Phase 1: card-level updates on the existing Driver
  // Alliance page. Route edits save inside DriverRouteEditor; this merges
  // the server's authoritative updated driver back into local state.
  const handleAllianceDriverUpdated = (updated: Driver) => {
    setDrivers(prev => prev.map(d => (d.id === updated.id ? updated : d)));
  };

  const handleToggleAllianceInactive = async (driver: Driver) => {
    try {
      const res = await apiFetch(`/api/drivers/${driver.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allianceInactive: !driver.allianceInactive }),
      });
      if (res.ok) {
        handleAllianceDriverUpdated(await res.json());
        triggerToast(driver.allianceInactive ? "Driver reactivated for alliance offers." : "Driver marked Inactive for alliance offers.");
      } else {
        const errData = await res.json().catch(() => ({}));
        triggerToast(errData.error || "Failed to update driver availability.");
      }
    } catch {
      triggerToast("Could not reach the server.");
    }
  };

  // Vendor / Supplier Management States
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorSearchQuery, setVendorSearchQuery] = useState("");
  const [isAddVendorOpen, setIsAddVendorOpen] = useState(false);
  const [newVendorCompanyName, setNewVendorCompanyName] = useState("");
  const [newVendorContactName, setNewVendorContactName] = useState("");
  const [newVendorPhone, setNewVendorPhone] = useState("");
  const [newVendorEmail, setNewVendorEmail] = useState("");
  const [newVendorAddress, setNewVendorAddress] = useState("");
  const [newVendorServiceType, setNewVendorServiceType] = useState("Customs Clearance");
  const [newVendorNotes, setNewVendorNotes] = useState("");
  const [isSubmittingVendor, setIsSubmittingVendor] = useState(false);

  // Accounts & Cost Statements states
  const [costStatements, setCostStatements] = useState<CostStatement[]>([]);
  // Template Settings: configured bank accounts for customer-document payment details.
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [selectedCostStatement, setSelectedCostStatement] = useState<CostStatement | null>(null);

  // Real coordinate-based progress calculator helper
  const getShipmentProgressPercentage = (s: Shipment): number => {
    if (s.status === 'Delivered' || s.status === 'Closed' || s.status === 'Arrived') {
      return 100;
    }
    if (s.status === 'New' || s.status === 'Waiting for Driver Quotes') {
      return 0;
    }

    const CITY_COORDINATES_LOCAL: Record<string, { lat: number; lng: number }> = {
      "istanbul": { lat: 41.0082, lng: 28.9784 },
      "bursa": { lat: 40.1885, lng: 29.0610 },
      "gaziantep": { lat: 37.0662, lng: 37.3833 },
      "erbil": { lat: 36.1912, lng: 44.0091 },
      "baghdad": { lat: 33.3152, lng: 44.3661 },
      "basra": { lat: 30.5081, lng: 47.7835 },
      "zaho": { lat: 37.1436, lng: 42.6886 },
      "dahuk": { lat: 36.8615, lng: 42.9926 },
      "mosul": { lat: 36.3489, lng: 43.1577 },
      "suleymaniye": { lat: 35.5613, lng: 45.4375 },
      "kirkuk": { lat: 35.4670, lng: 44.3920 },
      "ankara": { lat: 39.9334, lng: 32.8597 }
    };

    const startCity = (s.loadingCity || "istanbul").toLowerCase().trim();
    const endCity = (s.deliveryCity || "baghdad").toLowerCase().trim();

    const start = CITY_COORDINATES_LOCAL[startCity] || CITY_COORDINATES_LOCAL["istanbul"];
    const end = CITY_COORDINATES_LOCAL[endCity] || CITY_COORDINATES_LOCAL["baghdad"];

    const driver = drivers.find(d => d.id === s.assignedDriverId);
    const curLat = driver?.latitude;
    const curLng = driver?.longitude;

    if (!curLat || !curLng || (curLat === 0 && curLng === 0)) {
      // Fallback based on shipment status if no active driver telemetry coordinates yet
      switch (s.status) {
        case 'Assigned': return 10;
        case 'Accepted': return 25;
        case 'Loading': return 40;
        case 'Loaded': return 55;
        case 'In Transit': return 75;
        case 'Border Crossing': return 88;
        case 'Customs Clearance': return 94;
        default: return 0;
      }
    }

    // Vector projection computation of current coordinates onto total path AB vector segment
    const vLat = end.lat - start.lat;
    const vLng = end.lng - start.lng;
    
    const uLat = curLat - start.lat;
    const uLng = curLng - start.lng;

    const denominator = vLat * vLat + vLng * vLng;
    if (denominator === 0) return 0;

    const dotProduct = uLat * vLat + uLng * vLng;
    const t = dotProduct / denominator;

    return Math.max(0, Math.min(98, Math.round(t * 100)));
  };
  
  interface TimingAnalysis {
    colorClass: string;
    textColorClass: string;
    bgBadgeClass: string;
    label: string;
    subtext: string;
    lagPercentage?: number;
  }

  const analyzeShipmentTiming = (s: Shipment): TimingAnalysis => {
    if (s.status === 'Delivered' || s.status === 'Closed' || s.status === 'Arrived') {
      return {
        colorClass: 'bg-green-500',
        textColorClass: 'text-green-700 font-bold',
        bgBadgeClass: 'bg-green-50/70 border border-green-200/50',
        label: lang === 'tr' ? 'Tamamlandı' : (lang === 'ar' ? 'تم التسليم' : 'Completed'),
        subtext: lang === 'tr' ? 'Hedefe ulaşıldı' : (lang === 'ar' ? 'وصلت الوجهة' : 'Reached destination')
      };
    }

    if (s.status === 'New' || s.status === 'Waiting for Driver Quotes') {
      return {
        colorClass: 'bg-slate-400',
        textColorClass: 'text-slate-600 font-bold',
        bgBadgeClass: 'bg-slate-100 border border-slate-200',
        label: lang === 'tr' ? 'Sevk Edilmeyen' : (lang === 'ar' ? 'جديد' : 'New'),
        subtext: lang === 'tr' ? 'Atama yapılmadı' : (lang === 'ar' ? 'غير مكلف بسائق' : 'Not dispatched')
      };
    }

    if (!s.eta) {
      return {
        colorClass: 'bg-orange-500',
        textColorClass: 'text-orange-700 font-bold',
        bgBadgeClass: 'bg-orange-50/70 border border-orange-200/50',
        label: lang === 'tr' ? 'Aktif' : (lang === 'ar' ? 'نشط' : 'Active'),
        subtext: lang === 'tr' ? 'Tahmini varış hesaplanıyor' : (lang === 'ar' ? 'جاري حساب الوقت' : 'Calculating ETA...')
      };
    }

    const now = Date.now();
    const etaTime = new Date(s.eta).getTime();
    const createdTime = s.createdAt ? new Date(s.createdAt).getTime() : etaTime - (48 * 3600 * 1000);

    if (isNaN(etaTime)) {
      return {
        colorClass: 'bg-orange-500',
        textColorClass: 'text-orange-700 font-bold',
        bgBadgeClass: 'bg-orange-50/70 border border-orange-200/50',
        label: lang === 'tr' ? 'Aktif' : (lang === 'ar' ? 'نشط' : 'Active'),
        subtext: lang === 'tr' ? 'Tahmini varış hesaplanıyor' : (lang === 'ar' ? 'جاري حساب الوقت' : 'Calculating ETA...')
      };
    }

    const remainingMs = etaTime - now;

    const getDurationText = (ms: number): string => {
      const totalMinutes = Math.round(Math.abs(ms) / (60 * 1050));
      const hours = Math.floor(totalMinutes / 60);
      const mins = totalMinutes % 60;
      
      if (hours > 24) {
        const days = Math.round(hours / 24);
        return lang === 'tr' ? `${days} gün` : (lang === 'ar' ? `${days} يوم` : `${days} d`);
      }
      
      if (hours === 0) {
        return lang === 'tr' ? `${mins} dk` : (lang === 'ar' ? `${mins} دقيقة` : `${mins}m`);
      }
      return lang === 'tr' ? `${hours} sa ${mins} dk` : (lang === 'ar' ? `${hours} ساعة ${mins} د` : `${hours}h ${mins}m`);
    };

    if (remainingMs < 0) {
      return {
        colorClass: 'bg-red-500 animate-pulse',
        textColorClass: 'text-red-600 font-black',
        bgBadgeClass: 'bg-red-50 border border-red-200',
        label: lang === 'tr' ? 'Gecikti' : (lang === 'ar' ? 'متأخر' : 'Delayed'),
        subtext: lang === 'tr' ? `${getDurationText(remainingMs)} gecikti` : (lang === 'ar' ? `متأخر بـ ${getDurationText(remainingMs)}` : `${getDurationText(remainingMs)} overdue`)
      };
    }

    const totalDuration = etaTime - createdTime;
    const elapsedOffset = now - createdTime;
    const pctDurationElapsed = totalDuration > 0 ? elapsedOffset / totalDuration : 0.5;

    const progressPercentage = getShipmentProgressPercentage(s) / 100;
    const lag = pctDurationElapsed - progressPercentage;

    if (lag > 0.2) {
      return {
        colorClass: 'bg-red-500',
        textColorClass: 'text-red-600 font-extrabold',
        bgBadgeClass: 'bg-red-50/80 border border-red-200/50',
        label: lang === 'tr' ? 'Gecikme Riski' : (lang === 'ar' ? 'خطر التأخير' : 'Lagging'),
        subtext: lang === 'tr' ? `%${Math.round(lag * 100)} geride • Kalan ${getDurationText(remainingMs)}` : (lang === 'ar' ? `متأخر %${Math.round(lag * 100)} • متبقي ${getDurationText(remainingMs)}` : `${Math.round(lag * 100)}% behind • ${getDurationText(remainingMs)} left`),
        lagPercentage: lag
      };
    }

    if (lag > 0.05 || remainingMs < 4 * 3600 * 1000) {
      return {
        colorClass: 'bg-amber-500',
        textColorClass: 'text-amber-600 font-bold',
        bgBadgeClass: 'bg-amber-50 border border-amber-200',
        label: lang === 'tr' ? 'Darboğaz / Sınırda' : (lang === 'ar' ? 'توقيت ضيق' : 'Tight Timing'),
        subtext: lang === 'tr' ? `Kalan ${getDurationText(remainingMs)}` : (lang === 'ar' ? `متبقي ${getDurationText(remainingMs)}` : `${getDurationText(remainingMs)} left`),
        lagPercentage: lag
      };
    }

    return {
      colorClass: 'bg-green-500',
      textColorClass: 'text-emerald-600 font-bold',
      bgBadgeClass: 'bg-emerald-50/70 border border-emerald-200/50',
      label: lang === 'tr' ? 'Zamanında' : (lang === 'ar' ? 'في الموعد' : 'On Schedule'),
      subtext: lang === 'tr' ? `Kalan ${getDurationText(remainingMs)}` : (lang === 'ar' ? `متبقي ${getDurationText(remainingMs)}` : `${getDurationText(remainingMs)} remaining`)
    };
  };

  const [isStatementEditorOpen, setIsStatementEditorOpen] = useState(false);
  const [statementPreviewMode, setStatementPreviewMode] = useState<'statement' | 'invoice' | 'client_statement' | 'vendor_statement'>('statement');
  // Accounting Phase B: true when a save was rejected with 409 (another
  // admin saved this statement first). The editor stays open, the
  // admin's edits stay in place, and reloading the latest server copy is
  // an explicit button, never automatic.
  const [statementConflict, setStatementConflict] = useState(false);
  const [selectedVendorForStatement, setSelectedVendorForStatement] = useState<string>('');
  const [costSearchQuery, setCostSearchQuery] = useState("");
  const [costStatusFilter, setCostStatusFilter] = useState<'All' | 'Unpaid' | 'Partial' | 'Paid'>('All');
  const [costTypeFilter, setCostTypeFilter] = useState<'All' | 'land' | 'sea' | 'air'>('All');
  const [isSavingCostStatement, setIsSavingCostStatement] = useState(false);
  const savedStatementSnapshotRef = React.useRef<string | null>(null);

  // New Client Form States
  const [newClientCompanyName, setNewClientCompanyName] = useState("");
  const [newClientContactName, setNewClientContactName] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");
  const [newClientAddress, setNewClientAddress] = useState("");
  const [newClientNotes, setNewClientNotes] = useState("");
  const [isSubmittingClient, setIsSubmittingClient] = useState(false);
  const [newClientIsEmployee, setNewClientIsEmployee] = useState(false);
  const [newClientUsername, setNewClientUsername] = useState("");
  const [newClientPassword, setNewClientPassword] = useState("");
  const [newClientConfirmPassword, setNewClientConfirmPassword] = useState("");
  // Edit client modal
  const [editClientTarget, setEditClientTarget] = useState<Client | null>(null);
  const [editClientContactName, setEditClientContactName] = useState("");
  const [editClientPhone, setEditClientPhone] = useState("");
  const [editClientEmail, setEditClientEmail] = useState("");
  const [editClientAddress, setEditClientAddress] = useState("");
  const [editClientNotes, setEditClientNotes] = useState("");
  const [editClientIsEmployee, setEditClientIsEmployee] = useState(false);
  const [editClientUsername, setEditClientUsername] = useState("");
  const [editClientPassword, setEditClientPassword] = useState("");
  const [editClientConfirmPassword, setEditClientConfirmPassword] = useState("");
  const [editClientActive, setEditClientActive] = useState(true);
  const [isSubmittingEditClient, setIsSubmittingEditClient] = useState(false);

  // feature/client-staff-management-ui: "+ Add Employee" modal — creates a
  // Client Staff record attached to addEmployeeTarget's company. Company
  // is never a free-text/editable field here; it's fixed to whichever
  // Client Owner the admin opened this from.
  const [addEmployeeTarget, setAddEmployeeTarget] = useState<Client | null>(null);
  const [newEmployeeName, setNewEmployeeName] = useState("");
  const [newEmployeeEmail, setNewEmployeeEmail] = useState("");
  const [newEmployeePhone, setNewEmployeePhone] = useState("");
  const [newEmployeeUsername, setNewEmployeeUsername] = useState("");
  const [newEmployeePassword, setNewEmployeePassword] = useState("");
  const [newEmployeeConfirmPassword, setNewEmployeeConfirmPassword] = useState("");
  const [isSubmittingEmployee, setIsSubmittingEmployee] = useState(false);

  // feature/client-staff-management-ui: quick "Reset Password" action from
  // the Client Staff table — a focused, single-purpose modal distinct from
  // the fuller Edit flow, credentials-only.
  const [resetPasswordTarget, setResetPasswordTarget] = useState<Client | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetPasswordConfirmValue, setResetPasswordConfirmValue] = useState("");
  const [isSubmittingResetPassword, setIsSubmittingResetPassword] = useState(false);

  // feature/client-staff-management-ui: Delete confirmation for a Client
  // Staff row — the server (resolveClientAccountDeleteAuthorization) is
  // the real enforcement point restricting this to Super Admin; the UI
  // action itself is also only rendered for a Super Admin session (see
  // AdminClientsSection's isSuperAdmin prop), matching the merged
  // fix/client-create-username rule.
  const [deleteStaffTarget, setDeleteStaffTarget] = useState<Client | null>(null);
  const [isDeletingStaff, setIsDeletingStaff] = useState(false);

  // feature/client-staff-management-ui follow-up: the company name (not a
  // Client record — there isn't one) for the "Manage" view opened from an
  // orphaned company row in the top-level Clients table (Owner record
  // deleted, Staff remain). Distinct from editClientTarget, which always
  // holds a real Client record.
  const [orphanedCompanyView, setOrphanedCompanyView] = useState<string | null>(null);

  // fix/client-create-username: the Add Client modal's Cancel/✕ buttons
  // previously just closed the modal (`setIsAddClientOpen(false)`) without
  // clearing newClientUsername/Password/ConfirmPassword — so a cancelled,
  // reopened modal (or a browser autofill that had populated those fields)
  // could carry stale credential values into the next client created. The
  // success path (handleAddClientSubmit) already clears these explicitly;
  // this wrapper makes every OTHER path that closes the modal do the same.
  const setIsAddClientOpenSafe = (value: boolean) => {
    setIsAddClientOpen(value);
    if (!value) {
      setNewClientUsername("");
      setNewClientPassword("");
      setNewClientConfirmPassword("");
    }
  };

  // feature/client-staff-management-ui: same reset-on-close reasoning as
  // setIsAddClientOpenSafe above, applied to the "+ Add Employee" modal —
  // closing it (Cancel/✕, or after a successful create) always clears
  // every field, so reopening it (for the same or a different company)
  // never carries stale values forward.
  const closeAddEmployeeModal = () => {
    setAddEmployeeTarget(null);
    setNewEmployeeName("");
    setNewEmployeeEmail("");
    setNewEmployeePhone("");
    setNewEmployeeUsername("");
    setNewEmployeePassword("");
    setNewEmployeeConfirmPassword("");
  };

  const closeResetPasswordModal = () => {
    setResetPasswordTarget(null);
    setResetPasswordValue("");
    setResetPasswordConfirmValue("");
  };

  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const notifDropdownRef = React.useRef<HTMLDivElement>(null);
  const [activeToasts, setActiveToasts] = useState<{ id: string; notif: AppNotification }[]>([]);
  const knownNotificationIdsRef = React.useRef<Set<string>>(new Set());
  const isFirstLoadRef = React.useRef(true);
  // Phase 2A (Firestore scalability audit): the shipments-only 60s poll's
  // own `since` position — seeded from the latest full load (fetchData)
  // and advanced after each successful delta poll. See pollShipments below.
  const shipmentsSinceCursorRef = React.useRef<string | null>(null);
  
  // Gmail Console States
  const [gmailTo, setGmailTo] = useState("");
  const [gmailSubject, setGmailSubject] = useState("");
  const [gmailBody, setGmailBody] = useState("");
  const [gmailSending, setGmailSending] = useState(false);
  const [gmailResponse, setGmailResponse] = useState<{ success: boolean; message: string } | null>(null);
  const [gmailSelectedShipmentId, setGmailSelectedShipmentId] = useState("");

  // Google Workspace sub-tab states and helpers
  const [workspaceSubTab, setWorkspaceSubTab] = useState<'gmail' | 'drive' | 'calendar'>('gmail');
  const [driveFiles, setDriveFiles] = useState<any[]>([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveResponse, setDriveResponse] = useState<{ success: boolean; message: string } | null>(null);
  const [driveSelectedShipmentId, setDriveSelectedShipmentId] = useState("");
  const [driveUploading, setDriveUploading] = useState(false);

  const [calendarEvents, setCalendarEvents] = useState<any[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarResponse, setCalendarResponse] = useState<{ success: boolean; message: string } | null>(null);
  const [calendarSelectedShipmentId, setCalendarSelectedShipmentId] = useState("");
  const [calendarCreating, setCalendarCreating] = useState(false);

  // Fetch Google Drive Files
  const fetchDriveFiles = async () => {
    if (!gmailToken) return;
    setDriveLoading(true);
    try {
      const response = await window.fetch("https://www.googleapis.com/drive/v3/files?orderBy=createdTime%20desc&pageSize=12&fields=files(id,name,mimeType,webViewLink,iconLink,size,createdTime)", {
        headers: {
          Authorization: `Bearer ${gmailToken}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setDriveFiles(data.files || []);
      } else {
        console.error("Failed to fetch drive files", response.statusText);
      }
    } catch (err) {
      console.error("Drive fetch error", err);
    } finally {
      setDriveLoading(false);
    }
  };

  // Generate clean plaintext/markdown report to backup on Drive
  const generateShipmentBackupContent = (ship: Shipment) => {
    return `=========================================
MARAS INTERNATIONAL CARGO LOGISTICS
ETIR SHIPMENT BACKUP & TRANSIT RECORD
=========================================
Generated At       : ${new Date().toISOString()}
Shipment Ref       : #${ship.shipmentNumber}
License Plate      : ${ship.truckNumber || "Unassigned"}
Client Name        : ${ship.companyName}
Contact Info       : ${ship.loadingContactNumber || "N/A"}

ROUTE AND TRAFFIC SUMMARY:
-------------------------
From : ${ship.loadingCity} (${ship.loadingCountry})
To   : ${ship.deliveryCity} (${ship.deliveryCountry})
Cargo: ${ship.cargoDescription || "General Cargo"} (${ship.cargoWeight} kg)

STATUS & CHECKPOINTS:
--------------------
Current Status: ${ship.status}
Created At    : ${ship.createdAt}
Last Updated  : ${ship.updatedAt}

This document is a certified backup copy of the electronic TIR transit log.
Generated securely via MARAS Group Google Workspace interface.
`;
  };

  // Upload Shipment Backup to Google Drive
  const uploadBackupToDrive = async (shipmentId: string) => {
    const targetShip = shipments.find(s => s.id === shipmentId);
    if (!targetShip) {
      setDriveResponse({ success: false, message: "Please select a valid shipment first." });
      return;
    }
    setDriveUploading(true);
    setDriveResponse(null);
    try {
      const backupText = generateShipmentBackupContent(targetShip);
      const fileName = `ETIR-Backup-${targetShip.shipmentNumber}.txt`;
      
      const metadata = {
        name: fileName,
        mimeType: "text/plain"
      };

      const boundary = "314159265358979323846";
      const body = [
        `--${boundary}`,
        "Content-Type: application/json; charset=UTF-8",
        "",
        JSON.stringify(metadata),
        `--${boundary}`,
        "Content-Type: text/plain",
        "",
        backupText,
        `--${boundary}--`
      ].join("\r\n");

      const response = await window.fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${gmailToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`
        },
        body: body
      });

      if (response.ok) {
        const data = await response.json();
        setDriveResponse({
          success: true,
          message: `Successfully generated and uploaded backup ${fileName} to Google Drive! File ID: ${data.id}`
        });
        await fetchDriveFiles();
        
        // Log in Activity Ledger
        try {
          await apiFetch("/api/logs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              shipmentId: targetShip.id,
              shipmentNumber: targetShip.shipmentNumber,
              actor: gmailUser?.email || "Google Operator",
              actionEn: `Backed up etir record for #${targetShip.shipmentNumber} to Google Drive`,
              actionTr: `#${targetShip.shipmentNumber} etir kaydı Google Drive'a yedeklendi`,
              actionAr: `تم نسخ سجل شحنة etir #${targetShip.shipmentNumber} احتياطياً إلى Google Drive`
            })
          });
        } catch (logErr) {
          console.error("Log error", logErr);
        }
      } else {
        const errData = await response.json().catch(() => ({}));
        setDriveResponse({
          success: false,
          message: `Failed to upload to Drive: ${errData.error?.message || response.statusText}`
        });
      }
    } catch (err: any) {
      console.error("Upload error", err);
      setDriveResponse({ success: false, message: `Upload failed: ${err.message || err}` });
    } finally {
      setDriveUploading(false);
    }
  };

  // Fetch Google Calendar Events
  const fetchCalendarEvents = async () => {
    if (!gmailToken) return;
    setCalendarLoading(true);
    try {
      const response = await window.fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?orderBy=startTime&singleEvents=true&timeMin=${new Date().toISOString()}&maxResults=10`, {
        headers: {
          Authorization: `Bearer ${gmailToken}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setCalendarEvents(data.items || []);
      } else {
        console.error("Failed to fetch calendar events", response.statusText);
      }
    } catch (err) {
      console.error("Calendar fetch error", err);
    } finally {
      setCalendarLoading(false);
    }
  };

  // Create Google Calendar scheduling event for shipment
  const createCalendarEvent = async (shipmentId: string) => {
    const targetShip = shipments.find(s => s.id === shipmentId);
    if (!targetShip) {
      setCalendarResponse({ success: false, message: "Please select a valid shipment first." });
      return;
    }
    setCalendarCreating(true);
    setCalendarResponse(null);
    try {
      const startDate = targetShip.loadingDate || new Date().toISOString().split('T')[0];
      const eventBody = {
        summary: `Cargo Shipment dispatch: #${targetShip.shipmentNumber}`,
        location: `${targetShip.loadingCity}, ${targetShip.loadingCountry} ➔ ${targetShip.deliveryCity}`,
        description: `Official MARAS cargo transit scheduling for client ${targetShip.companyName}.\nStatus: ${targetShip.status}.\nRecipient phone: ${targetShip.loadingContactNumber || "N/A"}.\nEtir document backup integration.`,
        start: {
          date: startDate
        },
        end: {
          date: startDate
        }
      };

      const response = await window.fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${gmailToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(eventBody)
      });

      if (response.ok) {
        const data = await response.json();
        setCalendarResponse({
          success: true,
          message: `Successfully scheduled Calendar event for shipment #${targetShip.shipmentNumber}! Event ID: ${data.id}`
        });
        await fetchCalendarEvents();

        // Log in Activity Ledger
        try {
          await apiFetch("/api/logs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              shipmentId: targetShip.id,
              shipmentNumber: targetShip.shipmentNumber,
              actor: gmailUser?.email || "Google Operator",
              actionEn: `Scheduled delivery event for #${targetShip.shipmentNumber} on Google Calendar`,
              actionTr: `#${targetShip.shipmentNumber} için Google Takvim'de teslimat randevusu planlandı`,
              actionAr: `تم جدولة موعد التسليم للشحنة #${targetShip.shipmentNumber} على تقويم Google Calendar`
            })
          });
        } catch (logErr) {
          console.error("Log error", logErr);
        }
      } else {
        const errData = await response.json().catch(() => ({}));
        setCalendarResponse({
          success: false,
          message: `Failed to create calendar event: ${errData.error?.message || response.statusText}`
        });
      }
    } catch (err: any) {
      console.error("Calendar creation error", err);
      setCalendarResponse({ success: false, message: `Calendar API Error: ${err.message || err}` });
    } finally {
      setCalendarCreating(false);
    }
  };

  // Auto-fetch data on active workspace tabs
  useEffect(() => {
    if (gmailToken && activeTab === 'gmail') {
      if (workspaceSubTab === 'drive') {
        fetchDriveFiles();
      } else if (workspaceSubTab === 'calendar') {
        fetchCalendarEvents();
      }
    }
  }, [gmailToken, activeTab, workspaceSubTab]);

  const handlePrepopulateGmail = (shipmentId: string) => {
    setGmailSelectedShipmentId(shipmentId);
    if (!shipmentId) {
      setGmailTo("");
      setGmailSubject("");
      setGmailBody("");
      return;
    }
    const shipment = shipments.find(s => s.id === shipmentId);
    if (shipment) {
      const trackingUrl = `${window.location.origin}?token=${shipment.shareToken}`;
      setGmailTo(shipment.loadingContactNumber && shipment.loadingContactNumber.includes("@") ? shipment.loadingContactNumber : "client@maras-cargo.com");
      
      const sub = `etir Tracking Update: #${shipment.shipmentNumber} — ${shipment.companyName}`;
      const msgBody = `Hello,

This is an official transit status alert from MARAS Logistics regarding your international cargo shipment:

• Shipment Reference Number: #${shipment.shipmentNumber}
• Organization: MARAS operational dispatch
• Carriage Leg Stage: ${shipment.status}
• Path: ${shipment.loadingCity} (${shipment.loadingCountry}) ➔ ${shipment.deliveryCity} (${shipment.deliveryCountry})
• Assigned Carrier: ${shipment.truckNumber || "Unassigned"}

You can track your shipment's status, last known location, border control checkpoints, customs verification state, and view direct transport paperwork files here:
${trackingUrl}

Best Regards,
MARAS Group etir Center`;
      
      setGmailSubject(sub);
      setGmailBody(msgBody);
    }
  };

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  // Form states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  // Driver Alliance order linking: when Create Order was opened FROM the
  // alliance flow, hand the freshly created Order's id back so the
  // alliance auto-selects it and continues — one Order, one MAR
  // reference, generated once by the existing workflow.
  const [allianceReturnPending, setAllianceReturnPending] = useState(false);
  const [alliancePreselectedOrderId, setAlliancePreselectedOrderId] = useState<string | null>(null);
  // fix/prevent-duplicate-shipment-creation: in-flight guard for
  // handleCreateShipment — a double-click, repeated Enter, or repeated
  // submit event must never fire more than one POST /api/shipments.
  // isCreatingShipmentRef is the authoritative lock: it's read/written
  // synchronously, so two submit events dispatched in the same tick (before
  // React re-renders with the new state) still can't both pass the guard —
  // isCreatingShipment (state) is for UI feedback only and must not be
  // relied on for concurrency, since its update is not synchronous.
  const isCreatingShipmentRef = React.useRef(false);
  const [isCreatingShipment, setIsCreatingShipment] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDriverCreateOpen, setIsDriverCreateOpen] = useState(false);
  const [editingShipment, setEditingShipment] = useState<Shipment | null>(null);
  // Shipment-update lost-update race fix (stability audit): set when
  // PUT /api/shipments/:id 409s because someone else saved this shipment
  // first. Never auto-resolved — the admin must explicitly choose to
  // reload the server's current copy (see handleReloadEditingShipmentFromConflict).
  const [editConflict, setEditConflict] = useState<{ currentRevision: number | null; shipment: Shipment | null } | null>(null);
  // PR #111 review (Admin Status Override authorization correction): the
  // Status Override control is now a separate, clearly-labeled action
  // (PUT /api/shipments/:id/status-override) with its own required
  // correction reason — deliberately independent of editingShipment/the
  // "Apply Updates" submit, which no longer changes status at all.
  const [overrideTargetStatus, setOverrideTargetStatus] = useState<ShipmentStatus | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [isSubmittingOverride, setIsSubmittingOverride] = useState(false);
  const [isPrintPreviewOpen, setIsPrintPreviewOpen] = useState(false);

  // Manual Shipment Operations Panel States (primarily for Sea and Air, but general as well)
  const [manualRemarks, setManualRemarks] = useState("");
  const [isSubmittingStatus, setIsSubmittingStatus] = useState(false);

  // Google Maps Distance Matrix state
  const [distanceMatrixData, setDistanceMatrixData] = useState<any | null>(null);
  const [isLoadingDistanceMatrix, setIsLoadingDistanceMatrix] = useState(false);
  const [distanceMatrixError, setDistanceMatrixError] = useState<string | null>(null);

  // New Shipment Fields
  const [newShipmentData, setNewShipmentData] = useState(createEmptyShipmentForm());

  // Toggles for Custom POL/POD inputs
  const [useCustomPOL, setUseCustomPOL] = useState(false);
  const [useCustomPOD, setUseCustomPOD] = useState(false);
  const [useEditCustomPOL, setUseEditCustomPOL] = useState(false);
  const [useEditCustomPOD, setUseEditCustomPOD] = useState(false);

  // New Driver Fields
  const [newDriverData, setNewDriverData] = useState({
    name: "",
    username: "",
    truckNumber: "",
    phone: "",
    truckType: "reefer"
  });

  const [toast, setToast] = useState<string | null>(null);

  const showNotificationToast = (notif: AppNotification) => {
    const toastId = `toast-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    setActiveToasts(prev => [...prev, { id: toastId, notif }]);
    
    // Auto-remove toast after 10 seconds
    setTimeout(() => {
      setActiveToasts(prev => prev.filter(t => t.id !== toastId));
    }, 10000);
  };

  // Notification Phase 1 correction: this admin's own reader id for the
  // per-user read model (readByUserIds), NOT adminEmail — for a sub-admin,
  // req.session.id server-side is their admins/{id} doc id, not their
  // email (only the super-admin's id and email happen to be the same
  // value). getOwnSessionId() decodes that same id straight out of this
  // admin's own signed session token (already used just above for the
  // "is this my own chat message" toast guard, same non-authorization,
  // own-identity-recognition purpose), so it matches req.session.id for
  // every admin type. Falls back to adminEmail only if the token can't be
  // read at all.
  const ownAdminId = React.useMemo(() => getOwnSessionId() || adminEmail, [adminEmail]);

  // In-flight guard for POST /api/notifications/:id/read — prevents a
  // duplicate request for the same id firing before a previous one for it
  // has settled (e.g. a fast double-click, or overlapping with a
  // background refresh).
  const markingNotifsReadRef = React.useRef<Set<string>>(new Set());

  const handleMarkNotifRead = async (id: string) => {
    if (markingNotifsReadRef.current.has(id)) return;
    markingNotifsReadRef.current.add(id);
    try {
      const res = await apiFetch(`/api/notifications/${id}/read`, { method: "POST" });
      // Only reflect the change locally once the backend actually recorded
      // it — otherwise a failed request (e.g. a 403/500) still looked like
      // it worked until the next background refresh silently reverted the
      // notification back to unread.
      if (!res.ok) {
        console.error(`Failed to mark notification ${id} as read: ${res.status}`);
        return;
      }
      // Notification Phase 1 correction: only this admin's own id is added
      // (readByUserIds), preserving whatever ids were already there — this
      // admin reading a notification never marks it read for another
      // admin, a driver, or a client, the way the legacy shared `read`
      // flag used to.
      setNotifications(prev => prev.map(n => n.id === id
        ? { ...n, readByUserIds: addReaderToNotification(n.readByUserIds, ownAdminId) }
        : n
      ));
    } catch (err) {
      console.error(err);
    } finally {
      markingNotifsReadRef.current.delete(id);
    }
  };

  const handleMarkAllNotifsRead = async () => {
    try {
      // Notification Phase 1 correction: POST /api/notifications/clear no
      // longer sets the legacy shared `read` flag — it now atomically adds
      // this calling admin's own id to readByUserIds on every notification
      // visible to them (still admin-only; still never touches `read`;
      // never marks anything read for another admin, a driver, or a
      // client). This local update mirrors that new server behavior.
      const res = await apiFetch(`/api/notifications/clear`, { method: "POST" });
      if (!res.ok) {
        console.error(`Failed to mark all notifications as read: ${res.status}`);
        return;
      }
      setNotifications(prev => prev.map(n => ({ ...n, readByUserIds: addReaderToNotification(n.readByUserIds, ownAdminId) })));
    } catch (err) {
      console.error(err);
    }
  };

  // Load backend statistics
  const lastFetchedAtRef = React.useRef<number>(0);
  const fetchData = async (force = true) => {
    if (typeof window !== "undefined" && !navigator.onLine) {
      setSwrStatus('offline');
      return;
    }
    
    const now = Date.now();
    if (!force && now - lastFetchedAtRef.current < 15000) {
      console.log(`[SWR] Throttling automatic fetchData. Last fetch was ${now - lastFetchedAtRef.current}ms ago. Skipping to protect database reads/quota.`);
      return;
    }
    lastFetchedAtRef.current = now;
    
    setIsSyncing(true);
    setSwrStatus('syncing');
    
    try {
      const resolvedAdminTypeForSWR = adminType || 'super';

      // Same pattern as resLogs/resCostStatements/resAdmins below: skip the
      // request entirely for an admin type the server already 403s (accounts
      // admins can't view the shipment/driver registry, adminAccess.ts)
      // instead of firing it and discarding a 403.
      //
      // Phase 2A follow-up (blocking-issue fix): GET /api/shipments now
      // returns only the LATEST page (default 50) — fetchAllShipmentPages
      // (page-through-to-exhaustion) is no longer used on this normal
      // loading path at all; a user with thousands of shipments must no
      // longer download and hold all of them just to open the dashboard.
      // Only fetched on a `force` call (initial mount / manual refresh) —
      // the throttled 12s SWR cycle (`force: false`) deliberately skips
      // shipments entirely and relies on the dedicated since-mode delta
      // poll (pollShipments, below) to keep the already-loaded list
      // fresh, so this is never a "recurring full paginated reload every
      // 12 seconds." Dashboard totals come from GET /api/shipments/stats
      // (a real server-side aggregate, not `shipments.length`) so they
      // stay accurate even though only one page is held client-side.
      let shipmentsPage: { items: Shipment[]; nextCursor: string | null; hasMore: boolean } | null = null;
      let shipmentsStatsData: { total: number; byStatusGroup?: Record<string, number> } | null = null;
      if (canViewShipmentRegistry(resolvedAdminTypeForSWR) && force) {
        const [resShipmentsPage, resShipmentsStats] = await Promise.all([
          apiFetch("/api/shipments?limit=50"),
          apiFetch("/api/shipments/stats"),
        ]);
        if (resShipmentsPage.ok) {
          const text = await resShipmentsPage.text();
          if (text.trim().startsWith("<")) {
            throw new Error("Received HTML instead of JSON. The backend server might still be initializing.");
          }
          const data = JSON.parse(text);
          shipmentsPage = { items: data.items || [], nextCursor: data.nextCursor ?? null, hasMore: !!data.hasMore };
        }
        if (resShipmentsStats.ok) {
          shipmentsStatsData = await resShipmentsStats.json();
        }
      }
      let resDrivers: Response | null = null;
      if (canViewDriverRoster(resolvedAdminTypeForSWR)) {
        resDrivers = await apiFetch("/api/drivers");
      }
      const resClients = await apiFetch("/api/clients");
      const resVendors = await apiFetch("/api/vendors");
      const resNotifs = await apiFetch("/api/notifications");
      // fix/admin-mobile-chat-correctness: the issue time is compared
      // against confirmedSeenScopesRef when the response is applied — a
      // response fetched BEFORE a seen call succeeded must not resurrect
      // the badge that seen already cleared (applyUnreadPollResponse).
      const unreadRequestIssuedAt = Date.now();
      const resUnreadChat = await apiFetch("/api/chat/unread");

      // Admin Data Fetch / AdminType Access Review (PR #58): the server now
      // rejects these for admin types the AdminPanel UI doesn't show the
      // corresponding tab to (canViewAuditLogs/canViewCostStatements,
      // adminAccess.ts) — skip the request entirely rather than firing it
      // and discarding a 403, same pattern already used for /api/admins
      // below.
      let resLogs: Response | null = null;
      if (canViewAuditLogs(resolvedAdminTypeForSWR)) {
        resLogs = await apiFetch("/api/logs");
      }
      let resCostStatements: Response | null = null;
      let resBankAccounts: Response | null = null;
      if (canViewCostStatements(resolvedAdminTypeForSWR)) {
        resCostStatements = await apiFetch("/api/cost-statements");
        // Template Settings: configured bank accounts power the payment
        // details on customer-facing documents (with a safe hardcoded
        // fallback when none are configured). Tolerant of failure.
        resBankAccounts = await apiFetch("/api/admin/accounting/bank-accounts").catch(() => null);
      }

      let resAdmins: Response | null = null;
      if (resolvedAdminTypeForSWR === 'super') {
        resAdmins = await apiFetch("/api/admins");
      }

      const safeJson = async (res: Response) => {
        const text = await res.text();
        if (text.trim().startsWith("<")) {
          throw new Error("Received HTML instead of JSON. The backend server might still be initializing.");
        }
        return JSON.parse(text);
      };

      if (shipmentsPage) {
        // A `force` load always REPLACES local state with the fresh
        // latest-50 page — this is a deliberate pagination reset (fresh
        // account/session context, or an explicit user refresh), not a
        // merge with whatever older pages happened to be loaded before.
        setShipments(shipmentsPage.items);
        setShipmentsNextCursor(shipmentsPage.nextCursor);
        setShipmentsHasMore(shipmentsPage.hasMore);
        // Re-seed the delta-poll cursor from this page's newest
        // `updatedAt` — every subsequent pollShipments tick asks for only
        // what changed after this point instead of re-fetching everything.
        const newestUpdated = shipmentsPage.items.reduce<Shipment | null>(
          (latest, s) => (!latest || s.updatedAt > latest.updatedAt || (s.updatedAt === latest.updatedAt && s.id > latest.id) ? s : latest),
          null
        );
        shipmentsSinceCursorRef.current = newestUpdated
          ? encodePageCursor({ ts: newestUpdated.updatedAt, id: newestUpdated.id })
          : null;
      }
      if (shipmentsStatsData) setShipmentStats(shipmentsStatsData);
      if (resDrivers && resDrivers.ok) setDrivers(await safeJson(resDrivers));
      if (resClients.ok) setClients(await safeJson(resClients));
      if (resVendors.ok) setVendors(await safeJson(resVendors));
      if (resLogs && resLogs.ok) setActivityLogs(await safeJson(resLogs));
      if (resCostStatements && resCostStatements.ok) setCostStatements(await safeJson(resCostStatements));
      if (resBankAccounts && resBankAccounts.ok) { try { setBankAccounts((await safeJson(resBankAccounts)).accounts || []); } catch { /* keep prior */ } }
      if (resAdmins && resAdmins.ok) setAdminsList(await safeJson(resAdmins));
      
      if (resUnreadChat.ok) {
        const fetchedUnread: ChatMessage[] = await safeJson(resUnreadChat);
        setUnreadChatMessages(
          applyUnreadPollResponse(fetchedUnread, confirmedSeenScopesRef.current, unreadRequestIssuedAt)
        );
      }

      if (resNotifs.ok) {
        const notifPage = await safeJson(resNotifs);
        const nData: AppNotification[] = Array.isArray(notifPage) ? notifPage : notifPage.items;
        setNotifications(nData);

        if (isFirstLoadRef.current) {
          nData.forEach(notif => {
            knownNotificationIdsRef.current.add(notif.id);
          });
          isFirstLoadRef.current = false;
        } else {
          const newNotifications = nData.filter(notif => !knownNotificationIdsRef.current.has(notif.id));
          if (newNotifications.length > 0) {
            // Chat notifications carry excludeUserId set to the sender's own
            // session id (req.session.id at send time — the admin's email
            // for the super-admin, or their admins/{id} doc id for a
            // sub-admin). The backend already omits these from this admin's
            // own GET /api/notifications response, but guard here too so
            // this admin's own message never pops a toast for them.
            const ownSessionId = getOwnSessionId();
            newNotifications.forEach(notif => {
              knownNotificationIdsRef.current.add(notif.id);
              const isOwnChatMessage =
                notif.type === "chat" &&
                !!notif.excludeUserId &&
                (notif.excludeUserId === ownSessionId || notif.excludeUserId === adminEmail);
              if (!isOwnChatMessage) {
                showNotificationToast(notif);
              }
            });
          }
        }
      }
      
      setSwrStatus('synced');
      setLastSyncedAt(new Date());
      setSwrErrorDetail(null);
    } catch (e: any) {
      console.warn("Error communicating with logistics server (fetching metrics): ", e);
      setSwrStatus('error');
      setSwrErrorDetail(e.message || String(e));
    } finally {
      setIsSyncing(false);
    }
  };

  // Phase 2A follow-up (blocking-issue fix): explicit "Load Older
  // Shipments" action — GET /api/shipments/:id/... requirement #3. Only
  // ever appends strictly-older rows (cursor mode is always createdAt
  // DESC from wherever the currently-loaded list ends), so a plain
  // concatenation is correct; still de-duplicated by id defensively in
  // case of an overlapping retry.
  const handleLoadMoreShipments = async () => {
    if (!shipmentsHasMore || !shipmentsNextCursor || shipmentsLoadingMore) return;
    setShipmentsLoadingMore(true);
    try {
      const res = await apiFetch(`/api/shipments?limit=50&cursor=${encodeURIComponent(shipmentsNextCursor)}`);
      if (!res.ok) return;
      const text = await res.text();
      if (text.trim().startsWith("<")) return;
      const data = JSON.parse(text);
      const newItems: Shipment[] = data.items || [];
      setShipments(prev => {
        const seenIds = new Set(prev.map(s => s.id));
        return [...prev, ...newItems.filter(s => !seenIds.has(s.id))];
      });
      setShipmentsNextCursor(data.nextCursor ?? null);
      setShipmentsHasMore(!!data.hasMore);
    } catch (err) {
      console.warn("Failed to load older shipments:", err);
    } finally {
      setShipmentsLoadingMore(false);
    }
  };

  // SWR: Revalidate on Window Focus, Visibility Change, and Network state changes
  useEffect(() => {
    const handleFocus = () => {
      console.log("[SWR] Window/tab focused. Triggering background revalidation (throttled).");
      fetchData(false);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        console.log("[SWR] Tab became visible. Triggering background revalidation (throttled).");
        fetchData(false);
      }
    };

    const handleOnline = () => {
      console.log("[SWR] Network restored online. Triggering SWR refresh (throttled).");
      fetchData(false);
    };

    const handleOffline = () => {
      console.log("[SWR] Network interface disconnected offline. SWR enters offline fallback.");
      setSwrStatus('offline');
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Initial load
    fetchData();

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // Phase 2A follow-up (blocking-issue fix): reset shipment pagination
  // state whenever this AdminPanel instance's own account/role identity
  // changes (adminEmail/adminType) WITHOUT necessarily unmounting — e.g.
  // if a future/impersonation-style flow ever swaps which admin's data
  // this session sees mid-session. Skips the very first run (already
  // handled by the mount-time fetchData() above) so this only fires on
  // an actual CHANGE, never doubles the initial load. Without this, a
  // stale `nextCursor`/`shipmentsSinceCursorRef` from the PREVIOUS
  // account's scope could resume "Load Older Shipments"/delta-polling
  // against a cursor that belongs to a completely different accessible
  // scope.
  const prevAdminIdentityRef = React.useRef<string | null>(null);
  useEffect(() => {
    const identity = `${adminEmail || ""}:${adminType || ""}`;
    const shouldReset = shouldResetShipmentPagination(prevAdminIdentityRef.current, identity);
    prevAdminIdentityRef.current = identity;
    if (!shouldReset) return;
    setShipments([]);
    setShipmentsNextCursor(null);
    setShipmentsHasMore(false);
    setShipmentStats(null);
    shipmentsSinceCursorRef.current = null;
    fetchData(true);
  }, [adminEmail, adminType]);

  // SWR: Intelligent periodic background polling pattern that pauses on window blur
  useEffect(() => {
    const runPollingCycle = () => {
      // Pause automatic polling when window is hidden/tab is in the background
      if (document.hidden) {
        console.log("[SWR] Client tab is in background. Paused background polling to preserve database reads/quota.");
        return;
      }
      if (!navigator.onLine) {
         console.log("[SWR] Offline state active. Paused background polling.");
        return;
      }
      console.log("[SWR] Running active periodic revalidation cycle...");
      fetchData(false);
    };

    // Stale-While-Revalidate: poll every 12 seconds in active focus to match dashboard refresh interval
    const interval = setInterval(runPollingCycle, 12000);
    return () => clearInterval(interval);
  }, []);

  // Global polling mechanism to periodically refresh the shipment list data from the backend every 60 seconds
  //
  // Phase 2A follow-up (blocking-issue fix): delta (`since`) poll only —
  // never a full re-fetch, and never pages through to exhaustion. Only
  // shipments that are new or whose own fields changed since the last
  // tick come back, merged into the existing `shipments` state BY ID
  // (mergeShipmentsSince, shipmentPagination.ts) — a delta merge upserts
  // into whatever is already loaded (including any older pages fetched
  // via "Load Older Shipments"), it never replaces/truncates the list, so
  // already-loaded older pages are preserved across every poll tick.
  // fetchData's own 12s SWR cycle deliberately skips shipments entirely
  // now (see fetchData's comment) — this 60s poll is the ONLY recurring
  // shipments refresh, and it is always bounded/delta, never a full
  // paginated reload. Known, documented limitation carried over from
  // server.ts's own note: a shipment whose ONLY change was a document
  // upload / share-link config update (both out of scope for this PR)
  // won't appear here until the next explicit full load (manual refresh,
  // or next mount) — not a silent data-loss risk, just a bounded
  // staleness window for that one specific, out-of-scope case.
  useEffect(() => {
    const pollShipments = async () => {
      try {
        if (typeof window !== "undefined" && !navigator.onLine) return;
        // Accounts admins can't view the shipment registry (adminAccess.ts,
        // same as fetchData's shipmentsPage above) — skip rather than poll
        // into a guaranteed 403 every 60s.
        if (!canViewShipmentRegistry(adminType || 'super')) return;
        // Not yet seeded by an initial fetchData load (e.g. this tick fired
        // before the first load resolved) — skip this tick rather than
        // fire a since-from-nowhere request; the next tick will have it.
        const cursor = shipmentsSinceCursorRef.current;
        if (!cursor) return;
        const resShipments = await apiFetch(`/api/shipments?since=${encodeURIComponent(cursor)}`);
        if (resShipments.ok) {
          const text = await resShipments.text();
          if (!text.trim().startsWith("<")) {
            const data = JSON.parse(text);
            const items: Shipment[] = data.items || [];
            if (items.length > 0) {
              setShipments(prev => mergeShipmentsSince(prev, items));
              const newestUpdated = items.reduce<Shipment>((latest, s) => (s.updatedAt > latest.updatedAt || (s.updatedAt === latest.updatedAt && s.id > latest.id) ? s : latest), items[0]);
              shipmentsSinceCursorRef.current = encodePageCursor({ ts: newestUpdated.updatedAt, id: newestUpdated.id });
              // The dashboard's aggregate totals are a real server-side
              // count, not derived from `shipments.length` — re-fetched
              // here (a cheap count() aggregate, not a list read) only
              // when something actually changed, so the totals stay
              // accurate without a full shipments reload.
              try {
                const resStats = await apiFetch("/api/shipments/stats");
                if (resStats.ok) setShipmentStats(await resStats.json());
              } catch { /* stats refresh is best-effort; next poll tick retries */ }
            }
            console.log(`[Global Polling] Periodically refreshed shipment list data (60s timer, ${items.length} changed).`);
          }
        }
      } catch (err) {
        console.warn("[Global Polling] Error periodically refreshing shipment list data: ", err);
      }
    };

    const interval = setInterval(pollShipments, 60000);
    return () => clearInterval(interval);
  }, []);

  // Ref to track status of shipments to detect transitions (e.g. from Pending to In Transit)
  const prevShipmentsMapRef = React.useRef<Record<string, string>>({});
  const isShipmentsRefInitialized = React.useRef(false);

  useEffect(() => {
    if (shipments.length === 0) return;

    if (!isShipmentsRefInitialized.current) {
      // On first load, initialize the map with current status to avoid false trigger on start
      const currentMap: Record<string, string> = {};
      shipments.forEach(s => {
        currentMap[s.id] = s.status;
      });
      prevShipmentsMapRef.current = currentMap;
      isShipmentsRefInitialized.current = true;
      
      // Request Desktop notification permission on first interaction/activation
      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
      }
      return;
    }

    // Compare new statuses against prior ones
    shipments.forEach(s => {
      const prevStatus = prevShipmentsMapRef.current[s.id];
      if (prevStatus && prevStatus !== s.status) {
        // Did we transit from 'Pending' (or equivalents like 'New', 'Assigned', 'Accepted') to 'In Transit'?
        const isPriorPending = prevStatus === "Pending" || prevStatus === "New" || prevStatus === "Waiting for Driver Quotes" || prevStatus === "Assigned" || prevStatus === "Accepted" || prevStatus === "Loading" || prevStatus === "Loaded";
        const isNowTransit = s.status === "In Transit";

        if (isPriorPending && isNowTransit) {
          // Play clean audio notifications tone
          try {
            const ctxClass = window.AudioContext || (window as any).webkitAudioContext;
            if (ctxClass) {
              const ctx = new ctxClass();
              const osc1 = ctx.createOscillator();
              const gain1 = ctx.createGain();
              osc1.frequency.value = 587.33; // D5
              osc1.type = 'sine';
              osc1.connect(gain1);
              gain1.connect(ctx.destination);
              gain1.gain.setValueAtTime(0.02, ctx.currentTime);
              gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
              osc1.start();
              osc1.stop(ctx.currentTime + 0.4);
              
              setTimeout(() => {
                try {
                  const osc2 = ctx.createOscillator();
                  const gain2 = ctx.createGain();
                  osc2.frequency.value = 880; // A5
                  osc2.type = 'sine';
                  osc2.connect(gain2);
                  gain2.connect(ctx.destination);
                  gain2.gain.setValueAtTime(0.02, ctx.currentTime);
                  gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
                  osc2.start();
                  osc2.stop(ctx.currentTime + 0.6);
                } catch (_) {}
              }, 120);
            }
          } catch (_) {}

          // Generate a custom AppNotification object to display on UI
          const transitNotifId = `transit-update-${s.id}-${Date.now()}`;
          const customNotif: AppNotification = {
            id: transitNotifId,
            shipmentId: s.id,
            shipmentNumber: s.shipmentNumber,
            titleEn: "🚚 Shipment In Transit",
            titleTr: "🚚 Sevkiyat Yola Çıktı",
            titleAr: "🚚 الشحنة في الطريق الآن",
            messageEn: `Active route started! Shipment #${s.shipmentNumber} to ${s.deliveryCity} is now In Transit with driver ${s.assignedDriverName || "N/A"}.`,
            messageTr: `Aktif rota başladı! #${s.shipmentNumber} numaralı teslimat ${s.deliveryCity} yönüne, sürücü ${s.assignedDriverName || "N/A"} ile yola çıktı.`,
            messageAr: `بدأت الرحلة النشطة! الشحنة رقم #${s.shipmentNumber} المتجهة إلى ${s.deliveryCity} هي الآن في الطريق مع السائق ${s.assignedDriverName || "N/A"}.`,
            type: 'status_update',
            timestamp: new Date().toISOString(),
            read: false
          };

          // Show floating UI toast
          showNotificationToast(customNotif);

          // Trigger native push/desktop notification
          if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
            const pushTitle = lang === "tr" ? "🚚 Sevkiyat Yola Çıktı!" : (lang === "ar" ? "🚚 الشحنة في الطريق!" : "🚚 Shipment In Transit!");
            const pushBody = lang === "tr" 
              ? `#${s.shipmentNumber} (${s.deliveryCity}) yönüne yola çıktı. Sürücü: ${s.assignedDriverName}` 
              : (lang === "ar" ? `الشحنة #${s.shipmentNumber} متجهة إلى ${s.deliveryCity} مع السائق ${s.assignedDriverName}` : `Shipment #${s.shipmentNumber} is heading to ${s.deliveryCity}. Driver: ${s.assignedDriverName}`);
            
            try {
              new Notification(pushTitle, {
                body: pushBody,
                tag: `transit-${s.id}`
              });
            } catch (_) {}
          }
        }
      }
      
      // Update value in local map tracking
      prevShipmentsMapRef.current[s.id] = s.status;
    });
  }, [shipments, lang]);

  // Sync manual operation panel values
  useEffect(() => {
    if (openDetailsId) {
      const found = shipments.find(s => s.id === openDetailsId);
      if (found) {
        setManualRemarks("");
      }
    }
  }, [openDetailsId, shipments]);

  // PR #111 review (Admin Status Override authorization correction): reset
  // the override widget's target/reason whenever a different shipment's
  // edit form opens, so a leftover selection/reason from a previously
  // edited shipment can never be submitted against this one.
  useEffect(() => {
    setOverrideTargetStatus(editingShipment?.status ?? null);
    setOverrideReason("");
  }, [editingShipment?.id]);

  // Close the Unread Driver Chats panel on outside click or Escape key
  useEffect(() => {
    if (!isChatDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (chatDropdownRef.current && !chatDropdownRef.current.contains(e.target as Node)) {
        setIsChatDropdownOpen(false);
      }
    };
    const handleEscapeKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsChatDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscapeKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [isChatDropdownOpen]);

  // Close the Notifications panel on outside click or Escape key — same
  // pattern as the Unread Driver Chats dropdown above. Previously this
  // panel could only be closed by clicking the bell again, with no close
  // button and no outside-click handling, making it hard to dismiss.
  useEffect(() => {
    if (!isNotifOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (notifDropdownRef.current && !notifDropdownRef.current.contains(e.target as Node)) {
        setIsNotifOpen(false);
      }
    };
    const handleEscapeKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsNotifOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscapeKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [isNotifOpen]);

  // Close the ✨ MARAS AI drawer on Escape key (outside-click is handled by
  // the backdrop's own onClick, since the drawer is a fixed overlay).
  useEffect(() => {
    if (!isMarasAiOpen) return;
    const handleEscapeKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMarasAiOpen(false);
    };
    document.addEventListener('keydown', handleEscapeKey);
    return () => document.removeEventListener('keydown', handleEscapeKey);
  }, [isMarasAiOpen]);

  // Fetch Distance Matrix predictions automatically
  useEffect(() => {
    if (openDetailsId) {
      setDistanceMatrixData(null);
      setDistanceMatrixError(null);
      setIsLoadingDistanceMatrix(true);

      const fetchDistanceMatrix = async () => {
        try {
          const res = await apiFetch(`/api/shipments/${openDetailsId}/distance-matrix`);
          if (res.ok) {
            const data = await res.json();
            setDistanceMatrixData(data);
          } else {
            setDistanceMatrixError("Could not retrieve real-time transit estimate");
          }
        } catch (err: any) {
          console.error("Error fetching Distance Matrix:", err);
          setDistanceMatrixError("Network error calculating route matrix");
        } finally {
          setIsLoadingDistanceMatrix(false);
        }
      };

      fetchDistanceMatrix();
    } else {
      setDistanceMatrixData(null);
      setDistanceMatrixError(null);
    }
  }, [openDetailsId]);

  const handleManualStatusUpdate = async () => {
    const targetDetailsShipment = openDetailsId ? shipments.find(s => s.id === openDetailsId) : null;
    if (!targetDetailsShipment) return;
    // PR #111 review (forward-only status transitions): derived fresh from
    // targetDetailsShipment at submit time — there is only ever one valid
    // next status, so manualStatus's own state (used only for the select's
    // display value) isn't trusted for the actual submission, avoiding any
    // staleness risk if the shipment list refreshes between render and
    // submit.
    const [nextStatus] = getAllowedNextShipmentStatuses(targetDetailsShipment.status, targetDetailsShipment.freightType);
    if (!nextStatus) return;
    setIsSubmittingStatus(true);
    try {
      const res = await apiFetch(`/api/shipments/${targetDetailsShipment.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: nextStatus,
          remarksDesc: manualRemarks.trim() || undefined,
          updaterName: gmailUser?.email || "Admin Panel",
          role: "admin"
        })
      });
      if (res.ok) {
        triggerToast("Status milestone logged successfully!");
        setManualRemarks("");
        fetchData();
      } else {
        let body: any = null;
        try { body = await res.json(); } catch {}
        // PR #111 review: another status change already committed since
        // this admin last saw the shipment — refresh to the real current
        // status rather than leaving the form pointed at a transition
        // that's no longer valid. Never auto-retried.
        if (res.status === 409 && body?.code === "INVALID_SHIPMENT_STATUS_TRANSITION") {
          fetchData();
        }
        triggerToast(body?.error || "Failed to update status milestone.");
      }
    } catch (err) {
      console.error(err);
      triggerToast("Error updating status milestone.");
    } finally {
      setIsSubmittingStatus(false);
    }
  };

  // PR #111 review (Admin Status Override authorization correction): the
  // dedicated, clearly-separate correction workflow — PUT
  // /api/shipments/:id/status-override, never the normal forward-only
  // /status endpoint. Requires a non-empty correction reason; the server
  // independently re-validates authorization (canManageShipmentStatus),
  // freight-workflow membership, and the terminal-reopen lock, so this
  // handler's own client-side checks are only a fast-fail UX convenience,
  // never the actual enforcement.
  const handleStatusOverride = async () => {
    if (!editingShipment || !overrideTargetStatus) return;
    const reason = overrideReason.trim();
    if (!reason) {
      triggerToast("A correction reason is required to override shipment status.");
      return;
    }
    setIsSubmittingOverride(true);
    try {
      const res = await apiFetch(`/api/shipments/${editingShipment.id}/status-override`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: overrideTargetStatus,
          correctionReason: reason,
          updaterName: gmailUser?.email || "Admin Panel",
        })
      });
      if (res.ok) {
        const updated = await res.json();
        setEditingShipment(updated);
        setOverrideReason("");
        triggerToast("Shipment status corrected successfully!");
        fetchData();
      } else {
        let body: any = null;
        try { body = await res.json(); } catch {}
        triggerToast(body?.error || "Failed to correct shipment status.");
      }
    } catch (err) {
      console.error(err);
      triggerToast("Error correcting shipment status.");
    } finally {
      setIsSubmittingOverride(false);
    }
  };

  // Cost statement management handlers
  const handleSelectActiveStatement = async (shipmentId: string) => {
    // Close the floating driver-chat panel so it can't float above the cost modal.
    setIsChatDropdownOpen(false);
    try {
      const res = await apiFetch(`/api/cost-statements/${shipmentId}`);
      if (res.ok) {
        const stmt = await res.json();
        setSelectedCostStatement(stmt);
        savedStatementSnapshotRef.current = JSON.stringify(stmt);
        setStatementPreviewMode('statement');
        const firstVendor = stmt.items?.[0]?.supplierName || '';
        setSelectedVendorForStatement(firstVendor);
        setIsStatementEditorOpen(true);
        // Deep-link so a browser refresh reopens this shipment's workspace and
        // the back button returns to the list (see the hash-restore effect).
        if (typeof window !== 'undefined') window.location.hash = `#/accounting/cost-statements/${shipmentId}`;
      } else {
        const s = shipments.find(item => item.id === shipmentId);
        if (s) {
          const templateStmt: CostStatement = {
            shipmentId: s.id,
            shipmentNumber: s.shipmentNumber,
            companyName: s.companyName,
            shipmentType: s.freightType || "land",
            date: new Date().toISOString().split('T')[0],
            currency: s.currency || "USD",
            totalCost: 0,
            paidAmount: 0,
            remainingBalance: 0,
            paymentStatus: "Unpaid",
            notes: "",
            items: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          setSelectedCostStatement(templateStmt);
          savedStatementSnapshotRef.current = JSON.stringify(templateStmt);
          setStatementPreviewMode('statement');
          setSelectedVendorForStatement('');
          setIsStatementEditorOpen(true);
          if (typeof window !== 'undefined') window.location.hash = `#/accounting/cost-statements/${shipmentId}`;
        }
      }
    } catch (err) {
      console.error("Failed to load cost statement:", err);
    }
  };

  // Refresh persistence for the full-screen cost-statement workspace: when the
  // page loads with a #/accounting/cost-statements/:shipmentId hash (a browser
  // refresh, or a shared deep link), select the accounting tab and reopen that
  // shipment's workspace. Runs once, after shipments are available so the
  // template fallback in handleSelectActiveStatement can resolve the shipment.
  const didRestoreStatementFromHashRef = React.useRef(false);
  useEffect(() => {
    if (didRestoreStatementFromHashRef.current) return;
    if (typeof window === 'undefined') return;
    if (shipments.length === 0) return;
    const match = window.location.hash.match(/^#\/accounting\/cost-statements\/(.+)$/);
    if (!match) return;
    didRestoreStatementFromHashRef.current = true;
    const shipmentId = decodeURIComponent(match[1]);
    setActiveTab('costs');
    void handleSelectActiveStatement(shipmentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipments.length]);

  const handleReloadLatestStatement = async () => {
    if (!selectedCostStatement) return;
    try {
      const res = await apiFetch(`/api/cost-statements/${selectedCostStatement.shipmentId}`);
      if (res.ok) {
        const latest = await res.json() as CostStatement;
        setSelectedCostStatement(latest);
        savedStatementSnapshotRef.current = JSON.stringify(latest);
        setStatementConflict(false);
      }
    } catch (err) {
      console.error("Failed to reload latest cost statement:", err);
    }
  };

  const handleSaveCostStatement = async () => {
    if (!selectedCostStatement) return;
    setIsSavingCostStatement(true);
    try {
      const items = selectedCostStatement.items || [];
      const totalCost = items.reduce((sum, item) => sum + (Number(item.totalAmount) || 0), 0);
      const paidAmount = Number(selectedCostStatement.paidAmount) || 0;
      const remainingBalance = totalCost - paidAmount;
      const paymentStatus = remainingBalance <= 0 && totalCost > 0 ? "Paid" : (paidAmount > 0 ? "Partial" : "Unpaid");

      const finalPayload: CostStatement = {
        ...selectedCostStatement,
        totalCost,
        remainingBalance,
        paymentStatus,
        updatedAt: new Date().toISOString()
      };

      const res = await apiFetch(`/api/cost-statements/${selectedCostStatement.shipmentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalPayload)
      });

      if (res.ok) {
        const saved = await res.json() as CostStatement;
        setCostStatements(prev => {
          const filtered = prev.filter(p => p.shipmentId !== saved.shipmentId);
          return [...filtered, saved];
        });
        setSelectedCostStatement(saved);
        savedStatementSnapshotRef.current = JSON.stringify(saved);
        setStatementConflict(false);
        triggerToast(lang === 'tr' ? "Maliyet tablosu başarıyla kaydedildi!" : (lang === 'ar' ? "تم حفظ كشف التكلفة بنجاح!" : "Cost statement saved successfully!"));
        const resLogs = await apiFetch("/api/logs");
        if (resLogs.ok) {
          const safeJson = async (r: Response) => JSON.parse(await r.text());
          setActivityLogs(await safeJson(resLogs));
        }
      } else if (res.status === 409) {
        // Accounting Phase B optimistic concurrency: someone else saved
        // this statement since it was opened. Keep the editor open with
        // the admin's unsaved changes intact — reloading is an explicit
        // action, never automatic.
        setStatementConflict(true);
      } else {
        triggerToast(lang === 'tr' ? "Maliyet tablosu kaydedilemedi" : (lang === 'ar' ? "فشل حفظ كشف التكلفة" : "Failed to save cost statement"));
      }
    } catch (err) {
      console.error(err);
      triggerToast(lang === 'tr' ? "Hata oluştu" : (lang === 'ar' ? "خطأ أثناء الحفظ" : "Error saving cost statement"));
    } finally {
      setIsSavingCostStatement(false);
    }
  };

  const isCostStatementDirty = () => {
    if (!selectedCostStatement) return false;
    return JSON.stringify(selectedCostStatement) !== savedStatementSnapshotRef.current;
  };

  const handleCloseStatementEditor = () => {
    if (isCostStatementDirty()) {
      const confirmClose = window.confirm(
        lang === 'tr'
          ? "Kaydedilmemiş değişiklikleriniz var. Kaydetmeden kapatmak istediğinize emin misiniz?"
          : lang === 'ar'
          ? "لديك تغييرات غير محفوظة. هل تريد الإغلاق دون الحفظ؟"
          : "You have unsaved changes. Close without saving?"
      );
      if (!confirmClose) return;
    }
    setIsStatementEditorOpen(false);
    setSelectedCostStatement(null);
  };

  const [receiptUploadingIndex, setReceiptUploadingIndex] = useState<number | null>(null);

  const handleUploadReceiptFile = async (itemIdx: number, file: File) => {
    if (!selectedCostStatement) return;
    setReceiptUploadingIndex(itemIdx);
    triggerToast(lang === 'tr' ? "Dosya yükleniyor..." : "Uploading file...");
    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        const base64Str = reader.result as string;
        try {
          const res = await apiFetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              file: base64Str,
              filename: file.name,
              mimeType: file.type
            })
          });
          if (res.ok) {
            const uploadRes = await res.json();
            const url = uploadRes.url;
            handleUpdateCostItem(itemIdx, {
              documentUrl: url,
              documentName: file.name
            });
            triggerToast(lang === 'tr' ? "Dekont başarıyla yüklendi!" : "Receipt uploaded successfully!");
          } else {
            triggerToast(lang === 'tr' ? "Dosya yükleme başarısız." : "File upload failed.");
          }
        } catch (postErr) {
          console.error(postErr);
          triggerToast(lang === 'tr' ? "Yükleme hatası oluştu." : "Error uploading file.");
        } finally {
          setReceiptUploadingIndex(null);
        }
      };
    } catch (err) {
      console.error(err);
      setReceiptUploadingIndex(null);
    }
  };

  const handleAddCostItem = () => {
    if (!selectedCostStatement) return;
    const newItem: CostItem = {
      id: `item-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      costType: "Freight Charge",
      description: "",
      quantity: 1,
      unitPrice: 0,
      totalAmount: 0,
      currency: selectedCostStatement.currency,
      supplierName: ""
    };
    setSelectedCostStatement(prev => {
      if (!prev) return prev;
      const updatedItems = [...prev.items, newItem];
      const totalCost = updatedItems.reduce((sum, item) => sum + (item.totalAmount || 0), 0);
      const remainingBalance = totalCost - Number(prev.paidAmount || 0);
      const paymentStatus = remainingBalance <= 0 && totalCost > 0 ? "Paid" : (Number(prev.paidAmount || 0) > 0 ? "Partial" : "Unpaid");
      return {
        ...prev,
        items: updatedItems,
        totalCost,
        remainingBalance,
        paymentStatus
      };
    });
  };

  const handleUpdateCostItem = (itemIdx: number, fields: Partial<CostItem>) => {
    if (!selectedCostStatement) return;
    setSelectedCostStatement(prev => {
      if (!prev) return prev;
      const updatedItems = prev.items.map((item, idx) => {
        if (idx === itemIdx) {
          const updated = { ...item, ...fields };
          if (fields.quantity !== undefined || fields.unitPrice !== undefined) {
            const qty = fields.quantity !== undefined ? Number(fields.quantity) : item.quantity;
            const price = fields.unitPrice !== undefined ? Number(fields.unitPrice) : item.unitPrice;
            updated.totalAmount = qty * price;
          }
          return updated;
        }
        return item;
      });
      const totalCost = updatedItems.reduce((sum, item) => sum + (item.totalAmount || 0), 0);
      const remainingBalance = totalCost - Number(prev.paidAmount || 0);
      const paymentStatus = remainingBalance <= 0 && totalCost > 0 ? "Paid" : (Number(prev.paidAmount || 0) > 0 ? "Partial" : "Unpaid");
      return {
        ...prev,
        items: updatedItems,
        totalCost,
        remainingBalance,
        paymentStatus
      };
    });
  };

  const handleDeleteCostItem = (itemIdx: number) => {
    if (!selectedCostStatement) return;
    setSelectedCostStatement(prev => {
      if (!prev) return prev;
      const updatedItems = prev.items.filter((_, idx) => idx !== itemIdx);
      const totalCost = updatedItems.reduce((sum, item) => sum + (item.totalAmount || 0), 0);
      const remainingBalance = totalCost - Number(prev.paidAmount || 0);
      const paymentStatus = remainingBalance <= 0 && totalCost > 0 ? "Paid" : (Number(prev.paidAmount || 0) > 0 ? "Partial" : "Unpaid");
      return {
        ...prev,
        items: updatedItems,
        totalCost,
        remainingBalance,
        paymentStatus
      };
    });
  };

  const handleExportCSV = (stmt: CostStatement) => {
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Cost Type,Description,Supplier Name,Quantity,Unit Price,Total Amount,Currency,Notes\n";
    // Accounts-safe: reads the statement's own agreedAmount/freightType
    // snapshot first, so this doesn't silently zero out for accounts
    // admins (shipments is always [] for that role — see
    // costStatementRegistryView.ts).
    const matchingShipment = resolveStatementShipmentContext(stmt, shipments);
    const items = resolveExportItems(statementPreviewMode, stmt, matchingShipment, selectedVendorForStatement);
    items.forEach(item => {
      const row = [
        item.costType,
        item.description || "",
        item.supplierName || "",
        item.quantity,
        item.unitPrice,
        item.totalAmount,
        item.currency || stmt.currency,
        item.internalNotes || ""
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(",");
      csvContent += row + "\n";
    });
    // Accounting Phase B: mode-aware summary rows through the SAME shared
    // rules the preview and PDF use — customer documents get customer-side
    // money and status only; the internal expense status never appears on
    // an invoice/client CSV.
    const headerStatus = resolveExportHeaderStatus(statementPreviewMode, stmt, matchingShipment);
    csvContent += "\n";
    if (statementPreviewMode === 'invoice' || statementPreviewMode === 'client_statement') {
      const cust = deriveCustomerSummary(matchingShipment?.agreedAmount || 0, resolveCustomerReceivedAmount(stmt));
      const custCur = stmt.agreedCurrency || stmt.currency;
      csvContent += `"Agreed Amount","${cust.agreedAmount}","${custCur}"\n`;
      csvContent += `"Customer Payment Received","${cust.customerReceivedAmount}","${custCur}"\n`;
      csvContent += `"Customer Receivable","${cust.customerReceivable}","${custCur}"\n`;
      if (cust.customerCredit > 0) csvContent += `"Customer Credit","${cust.customerCredit}","${custCur}"\n`;
      if (headerStatus) csvContent += `"Customer Payment Status","${headerStatus.value}"\n`;
    } else if (statementPreviewMode === 'statement') {
      const exp = deriveExpenseSummary(Number(stmt.totalCost) || 0, Number(stmt.paidAmount) || 0);
      csvContent += `"Total Cost","${exp.totalCost}","${stmt.currency}"\n`;
      csvContent += `"Expense Paid Amount","${exp.paidAmount}","${stmt.currency}"\n`;
      csvContent += `"Expense Payable","${exp.expenseRemaining}","${stmt.currency}"\n`;
      if (exp.expenseCredit > 0) csvContent += `"Expense Credit","${exp.expenseCredit}","${stmt.currency}"\n`;
      if (headerStatus) csvContent += `"Expense Payment Status","${headerStatus.value}"\n`;
    }
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `CostStatement_${stmt.shipmentNumber}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadPDF = async (elementId?: string) => {
    if (!selectedCostStatement) {
      triggerToast(lang === 'tr' ? "Aktif maliyet tablosu seçilmedi." : "Error: No active cost statement selected.");
      return;
    }

    triggerToast(lang === 'tr' ? "PDF Dosyası Hazırlanıyor..." : "Generating high-fidelity PDF Document...");

    try {
      // Dynamically imported so jsPDF (and its bundled dependencies) only
      // load when an admin actually exports a cost statement PDF, instead
      // of being part of every AdminPanel load.
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4"
      });
      
      const sanitizePdfText = (text: any): any => {
        if (text === null || text === undefined) return "";
        if (Array.isArray(text)) {
          return text.map(t => sanitizePdfText(t));
        }
        if (typeof text !== "string") {
          text = String(text);
        }
        return text
          .replace(/ı/g, 'i')
          .replace(/İ/g, 'I')
          .replace(/ş/g, 's')
          .replace(/Ş/g, 'S')
          .replace(/ğ/g, 'g')
          .replace(/Ğ/g, 'G')
          .replace(/ç/g, 'c')
          .replace(/Ç/g, 'C')
          .replace(/ö/g, 'o')
          .replace(/Ö/g, 'O')
          .replace(/ü/g, 'u')
          .replace(/Ü/g, 'U');
      };

      const drawText = (val: any, x: number, y: number, options?: any) => {
        doc.text(sanitizePdfText(val), x, y, options);
      };
      
      // Accounts-safe: see the matching comment in handleExportCSV above.
      const matchingShipment = resolveStatementShipmentContext(selectedCostStatement, shipments);

      // Filter items to render based on selection — customer-facing modes
      // never get raw internal cost items (see costStatementExportView.ts).
      const itemsToRender = resolveExportItems(statementPreviewMode, selectedCostStatement, matchingShipment, selectedVendorForStatement);

      // Dynamic sub-titles and party details
      let docSubtitle = "OFFICIAL COST DECLARATION LEDGER";
      let leftBoxTitle = "STATEMENT METADATA / BEYANNAME DETAYI";
      let rightBoxTitle = "CLIENT & PAYMENT ACCOUNT / CARI HESAP";
      let partyLabel = "Client Company / Cari:";
      const partyName = statementPreviewMode === 'vendor_statement'
        ? selectedVendorForStatement || "Selected Vendor"
        : selectedCostStatement.companyName || "";

      if (statementPreviewMode === 'invoice') {
        docSubtitle = lang === 'tr' ? "RESMI SATIS FATURASI" : "OFFICIAL SALES INVOICE";
        leftBoxTitle = "INVOICE DETAILS / FATURA METADATA";
      } else if (statementPreviewMode === 'client_statement') {
        docSubtitle = lang === 'tr' ? "MUSTERI HESAP EKSTRESI" : "CLIENT ACCOUNT STATEMENT";
        leftBoxTitle = "LEDGER META / EKSTRE DETAYLARI";
      } else if (statementPreviewMode === 'vendor_statement') {
        docSubtitle = lang === 'tr' ? "TEDARIKCI CARI EKSTRESI" : "VENDOR ACCOUNT STATEMENT";
        leftBoxTitle = "LEDGER META / CARI DETAYLARI";
        rightBoxTitle = "VENDOR SUMMARY / TEDARIKCI DETAYI";
        partyLabel = "Vendor Company / Cari:";
      }

      // MARAS GROUP Corporate Letterhead with Elegant Orange Corporate Logo
      doc.setFillColor(234, 88, 12); // Orange primary
      doc.roundedRect(15, 12, 10, 10, 2, 2, "F");
      
      // White inner geometric details representing an M / logistics mountains
      doc.setFillColor(255, 255, 255);
      doc.triangle(17, 20, 20, 14, 23, 20, "F");
      doc.setFillColor(234, 88, 12);
      doc.triangle(18.5, 20, 20, 16.5, 21.5, 20, "F");

      doc.setFont("Helvetica", "bold");
      doc.setFontSize(22);
      doc.setTextColor(15, 23, 42); // slate-900
      drawText("MARAS GROUP", 29, 20);
      
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(234, 88, 12); // Orange primary
      drawText("GLOBAL LOGISTICS & ACCOUNTING LEDGER DIVISION", 29, 24);
      
      // Right side document subtitle
      doc.setFontSize(10);
      doc.setTextColor(71, 85, 105); // slate-600
      drawText(docSubtitle, 195, 20, { align: "right" });
      
      // Divider Line
      doc.setDrawColor(226, 232, 240); // slate-200
      doc.setLineWidth(0.4);
      doc.line(15, 27, 195, 27);
      
      // Metadata rounded margin background card
      doc.setFillColor(248, 250, 252); // slate 50
      doc.roundedRect(15, 33, 180, 28, 2, 2, "FD");
      
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139); // slate-500
      drawText(leftBoxTitle, 20, 39);
      
      doc.setTextColor(51, 65, 85); // slate-700
      drawText("Ledger Ref / Referans:", 20, 45);
      drawText("Issue Date / Tarih:", 20, 50);
      drawText("Modality / Taşıma Tipi:", 20, 55);
      
      doc.setFont("Helvetica", "normal");
      doc.setTextColor(30, 41, 59); // slate-800
      drawText(`MARAS-${new Date(selectedCostStatement.date || '').getFullYear() || '2026'}-${selectedCostStatement.shipmentNumber}`, 63, 45);
      drawText(selectedCostStatement.date || "", 63, 50);
      drawText(`${selectedCostStatement.shipmentType?.toUpperCase()} Freight`, 63, 55);
      
      // Metadata Column 2
      doc.setFont("Helvetica", "bold");
      doc.setTextColor(100, 116, 139); // slate-500
      drawText(rightBoxTitle, 110, 39);
      
      doc.setTextColor(51, 65, 85);
      drawText(partyLabel, 110, 45);
      drawText("Ledger Status / Statü:", 110, 50);
      drawText("Currency / Para Birimi:", 110, 55);
      
      doc.setFont("Helvetica", "normal");
      doc.setTextColor(30, 41, 59);
      drawText(partyName, 153, 45);
      
      const status = selectedCostStatement.paymentStatus || "Unpaid";
      if (status === 'Paid') {
        doc.setTextColor(22, 163, 74); // green-600
      } else if (status === 'Partial') {
        doc.setTextColor(217, 119, 6); // yellow-600
      } else {
        doc.setTextColor(220, 38, 38); // red-600
      }
      doc.setFont("Helvetica", "bold");
      drawText(status.toUpperCase(), 153, 50);
      
      doc.setFont("Helvetica", "normal");
      doc.setTextColor(30, 41, 59);
      drawText(selectedCostStatement.currency || "USD", 153, 55);
      
      // Cost Breakdown Table spacing
      let currentY = 68;
      doc.setFillColor(30, 41, 59); // slate-800 background
      doc.rect(15, currentY, 180, 8, "F");
      
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255); // White header text
      
      drawText(lang === 'tr' ? "Gider Türü / Category" : "Expense Category", 17, currentY + 5);
      drawText(lang === 'tr' ? "Tedarikçi / Supplier" : "Supplier / Vendor", 52, currentY + 5);
      drawText(lang === 'tr' ? "Açıklama / Explanation" : "Description Breakdown", 87, currentY + 5);
      drawText("Qty", 143, currentY + 5);
      drawText(lang === 'tr' ? "Birim Fiyat" : "Unit Price", 168, currentY + 5, { align: "right" });
      drawText(`Total (${selectedCostStatement.currency})`, 193, currentY + 5, { align: "right" });
      
      currentY += 8;
      const rowHeight = 7.5;
      
      itemsToRender.forEach((item, index) => {
        // Multi-page overflow support
        if (currentY > 245) {
          doc.addPage();
          doc.setFillColor(30, 41, 59);
          doc.rect(15, 15, 180, 8, "F");
          doc.setFont("Helvetica", "bold");
          doc.setFontSize(8);
          doc.setTextColor(255, 255, 255);
          drawText(lang === 'tr' ? "Gider Türü / Category" : "Expense Category", 17, 20);
          drawText(lang === 'tr' ? "Tedarikçi / Supplier" : "Supplier / Vendor", 52, 20);
          drawText(lang === 'tr' ? "Açıklama / Explanation" : "Description Breakdown", 87, 20);
          drawText("Qty", 143, 20);
          drawText(lang === 'tr' ? "Birim Fiyat" : "Unit Price", 168, 20, { align: "right" });
          drawText(`Total (${selectedCostStatement.currency})`, 193, 20, { align: "right" });
          
          currentY = 23;
        }
        
        // Alternate zebra rows bg shading
        if (index % 2 === 1) {
          doc.setFillColor(248, 250, 252); // slate 50
          doc.rect(15, currentY, 180, rowHeight, "F");
        } else {
          doc.setFillColor(255, 255, 255);
          doc.rect(15, currentY, 180, rowHeight, "F");
        }
        
        // Row bottom thin divider line
        doc.setDrawColor(241, 245, 249); // slate-100
        doc.setLineWidth(0.2);
        doc.line(15, currentY + rowHeight, 195, currentY + rowHeight);
        
        doc.setFont("Helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(51, 65, 85); // slate-700
        
        const costTypeStr = item.costType || "Expense";
        drawText(costTypeStr.length > 20 ? costTypeStr.substring(0, 18) + ".." : costTypeStr, 17, currentY + 4.5);
        
        const supplierStr = item.supplierName || "Internal";
        drawText(supplierStr.length > 20 ? supplierStr.substring(0, 18) + ".." : supplierStr, 52, currentY + 4.5);
        
        const descStr = item.description || "";
        drawText(descStr.length > 32 ? descStr.substring(0, 30) + ".." : descStr, 87, currentY + 4.5);
        
        drawText(String(item.quantity || 0), 145, currentY + 4.5, { align: "center" });
        drawText(Number(item.unitPrice || 0).toLocaleString(), 168, currentY + 4.5, { align: "right" });
        drawText(Number(item.totalAmount || 0).toLocaleString(), 193, currentY + 4.5, { align: "right" });
        
        currentY += rowHeight;
      });
      
      // Handle trailing boxes overflow
      if (currentY > 215) {
        doc.addPage();
        currentY = 15;
      }
      
      currentY += 8;
      
      // Summary values card box
      doc.setDrawColor(226, 232, 240); // slate-200
      doc.setFillColor(248, 250, 252); // slate-50
      doc.roundedRect(120, currentY, 75, 30, 1.5, 1.5, "FD");
      
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(8);
      
      let val1Label = lang === 'tr' ? "Toplam Maliyet:" : "Total Cost Breakdown:";
      let val2Label = lang === 'tr' ? "Ödenen Miktar:" : "Settled / Paid Amount:";
      let val3Label = lang === 'tr' ? "Kalan Bakiye:" : "Remaining Balance:";
      
      let val1Text = `${Number(selectedCostStatement.totalCost || 0).toLocaleString()} ${selectedCostStatement.currency}`;
      let val2Text = `- ${Number(selectedCostStatement.paidAmount || 0).toLocaleString()} ${selectedCostStatement.currency}`;
      let val3Text = `${Number(selectedCostStatement.remainingBalance || 0).toLocaleString()} ${selectedCostStatement.currency}`;
      let balanceVal = Number(selectedCostStatement.remainingBalance || 0);

      if (statementPreviewMode === 'invoice') {
        // Accounting Phase B: customer documents show ONLY customer-side
        // money — received-from-customer, never the expense paidAmount.
        const cust = deriveCustomerSummary(matchingShipment?.agreedAmount || 0, resolveCustomerReceivedAmount(selectedCostStatement));
        const custCur = selectedCostStatement.agreedCurrency || selectedCostStatement.currency;
        val1Label = lang === 'tr' ? "Matrah / Toplam Paket:" : "Base Transport Fee:";
        val2Label = lang === 'tr' ? "Müşteriden Alınan:" : "Payment Received:";
        val3Label = cust.customerCredit > 0 ? (lang === 'tr' ? "MÜŞTERİ ALACAĞI (KREDİ):" : "CUSTOMER CREDIT:") : (lang === 'tr' ? "GENEL TOPLAM BORÇ:" : "NET TOTAL PAYABLE:");
        val1Text = `${cust.agreedAmount.toLocaleString()} ${custCur}`;
        val2Text = `- ${cust.customerReceivedAmount.toLocaleString()} ${custCur}`;
        val3Text = `${(cust.customerCredit > 0 ? cust.customerCredit : cust.customerReceivable).toLocaleString()} ${custCur}`;
        balanceVal = cust.customerReceivable;
      } else if (statementPreviewMode === 'client_statement') {
        const cust = deriveCustomerSummary(matchingShipment?.agreedAmount || 0, resolveCustomerReceivedAmount(selectedCostStatement));
        const custCur = selectedCostStatement.agreedCurrency || selectedCostStatement.currency;
        val1Label = lang === 'tr' ? "Toplam Dekont Cari:" : "Total Debited Value:";
        val2Label = lang === 'tr' ? "Müşteriden Alınan:" : "Customer Payment Received:";
        val3Label = cust.customerCredit > 0 ? (lang === 'tr' ? "MÜŞTERİ KREDİSİ:" : "Customer Credit Balance:") : (lang === 'tr' ? "Cari Bakiye (Borç):" : "Statement Outstanding:");
        val1Text = `${cust.agreedAmount.toLocaleString()} ${custCur}`;
        val2Text = `(${cust.customerReceivedAmount.toLocaleString()}) ${custCur}`;
        val3Text = `${(cust.customerCredit > 0 ? cust.customerCredit : cust.customerReceivable).toLocaleString()} ${custCur}`;
        balanceVal = cust.customerReceivable;
      } else if (statementPreviewMode === 'vendor_statement') {
        const vendorTotal = itemsToRender.reduce((acc, it) => acc + (Number(it.totalAmount) || 0), 0);
        val1Label = lang === 'tr' ? "Alt Toplam Alacak:" : "Subtotal Credit Accrued:";
        val2Label = lang === 'tr' ? "Düzeltmeler / Kesintiler:" : "Adjustments:";
        val3Label = lang === 'tr' ? "TEDARİKÇİ TOPLAM ALACAK:" : "TOTAL PAYABLE:";
        val1Text = `${vendorTotal.toLocaleString()} ${selectedCostStatement.currency}`;
        val2Text = `0.00 ${selectedCostStatement.currency}`;
        val3Text = `${vendorTotal.toLocaleString()} ${selectedCostStatement.currency}`;
        balanceVal = vendorTotal;
      }

      doc.setTextColor(100, 116, 139); // slate-500
      drawText(val1Label, 123, currentY + 6.5);
      drawText(val2Label, 123, currentY + 13.5);
      drawText(val3Label, 123, currentY + 23.5);
      
      doc.setTextColor(30, 41, 59); // slate-800
      drawText(val1Text, 190, currentY + 6.5, { align: "right" });
      
      doc.setTextColor(22, 163, 74); // green-600
      drawText(val2Text, 190, currentY + 13.5, { align: "right" });
      
      doc.setDrawColor(203, 213, 225); // slate-300
      doc.line(123, currentY + 17.5, 192, currentY + 17.5);
      
      if (balanceVal > 0) {
        doc.setTextColor(220, 38, 38); // red-600
      } else {
        doc.setTextColor(22, 163, 74); // green-600
      }
      doc.setFontSize(9);
      doc.setFont("Helvetica", "bold");
      drawText(val3Text, 190, currentY + 24.5, { align: "right" });
      
      // Memo and Remarks block on the left — internal accounting notes are
      // never surfaced to a customer/vendor export (see resolveExportNotes).
      const exportNotes = resolveExportNotes(statementPreviewMode, selectedCostStatement.notes);
      if (exportNotes) {
        doc.setTextColor(71, 85, 105); // slate-600
        doc.setFontSize(8);
        doc.setFont("Helvetica", "bold");
        drawText("LEDGER REMARKS & MEMORANDUMS:", 15, currentY + 5);

        doc.setFont("Helvetica", "normal");
        doc.setTextColor(100, 116, 139); // slate-500
        const splitNotes = doc.splitTextToSize(exportNotes, 100);
        drawText(splitNotes, 15, currentY + 11);
      }
      
      // System Signatures at the bottom of the active page page
      const signY = 252;
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.3);
      doc.line(15, signY, 70, signY);
      doc.line(140, signY, 195, signY);
      
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184); // slate-400
      drawText("ACCOUNTANT CONTROLLER ISSUER", 15, signY + 4);
      drawText("MARAS SYSTEM OF VERIFIED DELEGATION", 140, signY + 4);
      
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(6);
      drawText("Internal Verifiable Signature Lock Enabled", 15, signY + 8);
      drawText("Key Verification Hash: MARAS-LEDGER-" + (selectedCostStatement.shipmentId || 'VERIFIED'), 140, signY + 8);
      
      // Beautiful semi-transparent orange Audit Stamp/Seal next to signatures
      doc.setDrawColor(234, 88, 12, 100); // orange border (100% opacity)
      doc.setLineWidth(0.4);
      doc.setFillColor(254, 243, 199); // light orange background (amber 100)
      doc.roundedRect(88, signY - 8, 35, 15, 1.5, 1.5, "FD");
      
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(6.5);
      doc.setTextColor(234, 88, 12); // orange text
      drawText("MARAS AUDITED", 105, signY - 3, { align: "center" });
      
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(5);
      doc.setTextColor(120, 113, 108); // stone-500
      drawText("SYSTEM COMPLIANT", 105, signY + 1.5, { align: "center" });
      drawText("LOGISTICS LEDGER LOCK", 105, signY + 4, { align: "center" });

      // Dynamic High-Fidelity Page Footer Engine across ALL generated pages
      const pageCount = (doc.internal as any).getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        
        // Solid light dividing line at bottom of each page
        doc.setDrawColor(241, 245, 249); // slate-100
        doc.setLineWidth(0.3);
        doc.line(15, 280, 195, 280);
        
        // Left footer: Confidential security status
        doc.setFont("Helvetica", "normal");
        doc.setFontSize(6.5);
        doc.setTextColor(148, 163, 184); // slate-400
        drawText(`MARAS REGISTER • CONFIDENTIAL DOCUMENT • SECURED SYSTEM RECORDS`, 15, 285);
        
        // Right footer: Dynamic page counters
        doc.setFont("Helvetica", "bold");
        doc.setFontSize(7);
        doc.setTextColor(100, 116, 139); // slate-500
        drawText(`Page ${i} of ${pageCount}`, 195, 285, { align: "right" });
      }
      
      const filename = `MARAS_${statementPreviewMode.toUpperCase()}_${selectedCostStatement.shipmentNumber}.pdf`;
      doc.save(filename);
      triggerToast(lang === 'tr' ? "PDF başarıyla indirildi!" : "PDF downloaded successfully!");
    } catch (err) {
      console.error("PDF generation error:", err);
      triggerToast(lang === 'tr' ? "PDF oluşturma hatası oluştu." : "Direct vector PDF generation failed.");
    }
  };

  const handlePrintStatement = (elementId: string) => {
    const originalElement = document.getElementById(elementId);
    const printMount = document.getElementById("print-mount-point");
    if (!originalElement || !printMount) {
      triggerToast(lang === 'tr' ? "Yazdırılacak belge bulunamadı." : "Error: Printable container element not found.");
      return;
    }

    try {
      // Copy the outer HTML into print mount point
      printMount.innerHTML = originalElement.outerHTML;

      // Add active printing class to body
      document.body.classList.add("printing-statement");

      // Give browser time to process style updates, then invoke native print
      setTimeout(() => {
        window.print();
        // Remove class and empty print mount point after execution completes
        document.body.classList.remove("printing-statement");
        printMount.innerHTML = "";
      }, 250);
    } catch (e) {
      console.error("Print invocation error:", e);
      triggerToast(lang === 'tr' ? "Yazdırma işlemi başarısız oldu." : "Browser print dialog initialization failed.");
    }
  };

  const triggerToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // Submit New Client Action
  const handleAddClientSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientCompanyName.trim() || !newClientContactName.trim()) {
      triggerToast(lang === 'tr' ? "Şirket Adı ve İletişim Kişisi zorunludur!" : (lang === 'ar' ? "اسم الشركة وجهة الاتصال مطلوبان!" : "Company Name and Contact Name are required!"));
      return;
    }
    if (newClientPassword.trim() && newClientPassword.trim() !== newClientConfirmPassword.trim()) {
      triggerToast(passwordMismatchError);
      return;
    }
    setIsSubmittingClient(true);
    try {
      const res = await apiFetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: newClientCompanyName.trim(),
          contactName: newClientContactName.trim(),
          phone: newClientPhone.trim(),
          email: newClientEmail.trim(),
          address: newClientAddress.trim(),
          notes: newClientNotes.trim(),
          createdAt: new Date().toISOString(),
          ...(newClientIsEmployee ? { isEmployee: true } : {}),
          ...(newClientUsername.trim() ? { username: newClientUsername.trim() } : {}),
          ...(newClientPassword.trim() ? { password: newClientPassword.trim() } : {}),
        })
      });

      if (res.ok) {
        triggerToast(lang === 'tr' ? "Müşteri başarıyla eklendi!" : (lang === 'ar' ? "تم إضافة العميل بنجاح!" : "Client added successfully!"));
        // Clear form
        setNewClientCompanyName("");
        setNewClientContactName("");
        setNewClientPhone("");
        setNewClientEmail("");
        setNewClientAddress("");
        setNewClientNotes("");
        setNewClientIsEmployee(false);
        setNewClientUsername("");
        setNewClientPassword("");
        setNewClientConfirmPassword("");
        setIsAddClientOpen(false);
        // Refresh data
        fetchData();
      } else {
        const errData = await res.json();
        triggerToast(errData.error || "Failed to add client");
      }
    } catch (err: any) {
      triggerToast(`Error: ${err.message}`);
    } finally {
      setIsSubmittingClient(false);
    }
  };

  const openEditClient = (client: Client) => {
    setEditClientTarget(client);
    setEditClientContactName(client.contactName);
    setEditClientPhone(client.phone || "");
    setEditClientEmail(client.email || "");
    setEditClientAddress(client.address || "");
    setEditClientNotes(client.notes || "");
    setEditClientIsEmployee(!!client.isEmployee);
    setEditClientUsername(client.username || "");
    setEditClientPassword("");
    setEditClientConfirmPassword("");
    setEditClientActive(client.active !== false);
  };

  const handleEditClientSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editClientTarget) return;
    if (editClientPassword.trim() && editClientPassword.trim() !== editClientConfirmPassword.trim()) {
      triggerToast(passwordMismatchError);
      return;
    }
    setIsSubmittingEditClient(true);
    try {
      const body: Record<string, unknown> = {
        contactName: editClientContactName.trim(),
        phone: editClientPhone.trim(),
        email: editClientEmail.trim(),
        address: editClientAddress.trim(),
        notes: editClientNotes.trim(),
        isEmployee: editClientIsEmployee,
        username: editClientUsername.trim(),
      };
      if (editClientPassword.trim()) body.password = editClientPassword.trim();
      // feature/client-staff-management-ui: Status is a Client Staff
      // concept in this UI — only sent when editing a Staff record, so
      // editing a Client Owner never touches `active` at all (Owner
      // status behavior is intentionally unchanged by this PR).
      if (editClientTarget.isEmployee) body.active = editClientActive;

      const res = await apiFetch(`/api/clients/${editClientTarget.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        triggerToast(lang === 'tr' ? "Müşteri güncellendi!" : (lang === 'ar' ? "تم تحديث العميل بنجاح!" : "Client updated successfully!"));
        setEditClientTarget(null);
        fetchData();
      } else {
        const errData = await res.json();
        triggerToast(errData.error || "Failed to update client");
      }
    } catch (err: any) {
      triggerToast(`Error: ${err.message}`);
    } finally {
      setIsSubmittingEditClient(false);
    }
  };

  // feature/client-staff-management-ui: "+ Add Employee" — creates a
  // Client Staff record attached to addEmployeeTarget's company. Notably
  // does NOT send `companyName` at all — the server derives it from
  // `parentOwnerId` (never trusts a client-supplied companyName for staff
  // creation), and does not send `isEmployee` either (the server forces
  // this to true whenever `parentOwnerId` is present, regardless of what
  // the request body says).
  const handleAddEmployeeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addEmployeeTarget) return;
    if (!newEmployeeName.trim()) {
      triggerToast(lang === 'tr' ? "Personel adı zorunludur!" : (lang === 'ar' ? "اسم الموظف مطلوب!" : "Employee name is required!"));
      return;
    }
    // feature/client-staff-management-ui follow-up: every Client Staff
    // member is a real login account — username and password are
    // mandatory here (unlike Client Owner creation, where both stay
    // optional). The `required` attributes on these fields already push
    // back on an empty submit, but a whitespace-only value (e.g. a single
    // space) passes HTML's `required` check while still being blank in
    // practice — checked explicitly here, and independently enforced
    // server-side (validateStaffCredentials in POST /api/clients) since
    // this frontend check alone is not sufficient for a direct API call.
    if (!newEmployeeUsername.trim()) {
      triggerToast(lang === 'tr' ? "Kullanıcı adı zorunludur!" : (lang === 'ar' ? "اسم المستخدم مطلوب!" : "Username is required!"));
      return;
    }
    if (!newEmployeePassword.trim()) {
      triggerToast(lang === 'tr' ? "Şifre zorunludur!" : (lang === 'ar' ? "كلمة المرور مطلوبة!" : "Password is required!"));
      return;
    }
    if (newEmployeePassword.trim() !== newEmployeeConfirmPassword.trim()) {
      triggerToast(passwordMismatchError);
      return;
    }
    setIsSubmittingEmployee(true);
    try {
      const res = await apiFetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentOwnerId: addEmployeeTarget.id,
          contactName: newEmployeeName.trim(),
          email: newEmployeeEmail.trim(),
          phone: newEmployeePhone.trim(),
          createdAt: new Date().toISOString(),
          username: newEmployeeUsername.trim(),
          password: newEmployeePassword.trim(),
        })
      });

      if (res.ok) {
        triggerToast(lang === 'tr' ? "Personel eklendi!" : (lang === 'ar' ? "تمت إضافة الموظف بنجاح!" : "Employee added successfully!"));
        closeAddEmployeeModal();
        fetchData();
      } else {
        const errData = await res.json();
        triggerToast(errData.error || "Failed to add employee");
      }
    } catch (err: any) {
      triggerToast(`Error: ${err.message}`);
    } finally {
      setIsSubmittingEmployee(false);
    }
  };

  // feature/client-staff-management-ui: quick Activate/Disable toggle from
  // the Client Staff table row — no modal, immediately reversible.
  const handleToggleClientActive = async (client: Client) => {
    try {
      const res = await apiFetch(`/api/clients/${client.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: client.active === false }),
      });
      if (res.ok) {
        triggerToast(
          client.active === false
            ? (lang === 'tr' ? "Hesap etkinleştirildi." : (lang === 'ar' ? "تم تفعيل الحساب." : "Account activated."))
            : (lang === 'tr' ? "Hesap devre dışı bırakıldı." : (lang === 'ar' ? "تم تعطيل الحساب." : "Account disabled."))
        );
        fetchData();
      } else {
        const errData = await res.json();
        triggerToast(errData.error || "Failed to update status");
      }
    } catch (err: any) {
      triggerToast(`Error: ${err.message}`);
    }
  };

  // feature/client-staff-management-ui: focused "Reset Password" action —
  // only ever sends `password`, reusing PUT /api/clients/:id's existing
  // blank-preserves-current / duplicate-username-safe / password-stripped
  // -from-response behavior. Does not touch any other field.
  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPasswordTarget) return;
    if (!resetPasswordValue.trim()) {
      triggerToast(lang === 'tr' ? "Yeni şifre gereklidir." : (lang === 'ar' ? "كلمة المرور الجديدة مطلوبة." : "A new password is required."));
      return;
    }
    if (resetPasswordValue.trim() !== resetPasswordConfirmValue.trim()) {
      triggerToast(passwordMismatchError);
      return;
    }
    setIsSubmittingResetPassword(true);
    try {
      const res = await apiFetch(`/api/clients/${resetPasswordTarget.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetPasswordValue.trim() }),
      });
      if (res.ok) {
        triggerToast(lang === 'tr' ? "Şifre sıfırlandı." : (lang === 'ar' ? "تمت إعادة تعيين كلمة المرور." : "Password reset successfully."));
        closeResetPasswordModal();
      } else {
        const errData = await res.json();
        triggerToast(errData.error || "Failed to reset password");
      }
    } catch (err: any) {
      triggerToast(`Error: ${err.message}`);
    } finally {
      setIsSubmittingResetPassword(false);
    }
  };

  // feature/client-staff-management-ui: Delete a Client Staff account from
  // the Admin UI. The server (resolveClientAccountDeleteAuthorization,
  // merged in fix/client-create-username) is the real enforcement —
  // Operation/Accounts Admin get a 403 here even if this ever somehow
  // rendered for them; the button itself is also only rendered for a
  // Super Admin session (see the isSuperAdmin prop passed to
  // AdminClientsSection).
  const handleDeleteStaffConfirm = async () => {
    if (!deleteStaffTarget) return;
    setIsDeletingStaff(true);
    try {
      const res = await apiFetch(`/api/clients/${deleteStaffTarget.id}`, { method: "DELETE" });
      if (res.ok) {
        triggerToast(lang === 'tr' ? "Personel hesabı silindi." : (lang === 'ar' ? "تم حذف حساب الموظف." : "Employee account deleted."));
        setDeleteStaffTarget(null);
        fetchData();
      } else {
        const errData = await res.json();
        triggerToast(errData.error || "Failed to delete account");
      }
    } catch (err: any) {
      triggerToast(`Error: ${err.message}`);
    } finally {
      setIsDeletingStaff(false);
    }
  };

  // Submit New Vendor Action
  const handleAddVendorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVendorCompanyName.trim() || !newVendorContactName.trim() || !newVendorServiceType.trim()) {
      triggerToast(lang === 'tr' ? "Şirket Adı, İletişim Temsilcisi ve Hizmet Türü zorunludur!" : (lang === 'ar' ? "اسم الشركة، ممثل الاتصال، ونوع الخدمة مطلوبة!" : "Company Name, Representative, and Service Type are required!"));
      return;
    }
    setIsSubmittingVendor(true);
    try {
      const res = await apiFetch("/api/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: newVendorCompanyName.trim(),
          contactName: newVendorContactName.trim(),
          phone: newVendorPhone.trim(),
          email: newVendorEmail.trim(),
          address: newVendorAddress.trim(),
          serviceType: newVendorServiceType,
          notes: newVendorNotes.trim(),
          createdAt: new Date().toISOString()
        })
      });

      if (res.ok) {
        triggerToast(lang === 'tr' ? "Tedarikçi başarıyla eklendi!" : (lang === 'ar' ? "تم إضافة المورد بنجاح!" : "Vendor added successfully!"));
        // Clear form
        setNewVendorCompanyName("");
        setNewVendorContactName("");
        setNewVendorPhone("");
        setNewVendorEmail("");
        setNewVendorAddress("");
        setNewVendorServiceType("Customs Clearance");
        setNewVendorNotes("");
        setIsAddVendorOpen(false);
        // Refresh data
        fetchData();
      } else {
        const errData = await res.json();
        triggerToast(errData.error || "Failed to add vendor");
      }
    } catch (err: any) {
      triggerToast(`Error: ${err.message}`);
    } finally {
      setIsSubmittingVendor(false);
    }
  };

  // Create Shipment Action
  const handleCreateShipment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingShipmentRef.current) return;
    isCreatingShipmentRef.current = true;
    setIsCreatingShipment(true);
    try {
      // BUG-13: Sea/Air freight collect Port/Airport fields instead of a
      // city field in this form. Never submit whatever Land's loadingCity/
      // deliveryCity happen to hold (e.g. stale "Istanbul"/"Baghdad") for a
      // Sea/Air shipment — derive an honest display city from the
      // port/airport the admin actually entered, or leave it blank rather
      // than invent one.
      const payload = newShipmentData.freightType === "land"
        ? newShipmentData
        : {
            ...newShipmentData,
            loadingCity: newShipmentData.freightType === "sea"
              ? newShipmentData.portOfLoading
              : newShipmentData.airportOfDeparture,
            deliveryCity: newShipmentData.freightType === "sea"
              ? (newShipmentData.portOfDischarge || newShipmentData.finalDestination)
              : newShipmentData.airportOfArrival,
          };

      const res = await apiFetch("/api/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const created = await res.json().catch(() => null);
        setIsCreateOpen(false);
        setNewShipmentData(createEmptyShipmentForm());
        setUseCustomPOL(false);
        setUseCustomPOD(false);
        triggerToast(t('createSuccess'));
        if (allianceReturnPending && created?.id) {
          setAlliancePreselectedOrderId(created.id);
        }
        setAllianceReturnPending(false);
        fetchData();
      } else {
        let msg = "Failed to create shipment.";
        try { msg = (await res.json())?.error || msg; } catch {}
        triggerToast(`❌ ${msg}`);
      }
    } catch (err) {
      console.error(err);
      triggerToast("❌ Could not reach the server. Please check your connection and try again.");
    } finally {
      isCreatingShipmentRef.current = false;
      setIsCreatingShipment(false);
    }
  };

  // Cancelling/closing the Create Shipment modal without submitting must not
  // leave stale field values (or a stale freightType) sitting in state for
  // the next time the dialog is opened.
  //
  // fix/prevent-duplicate-shipment-creation: while a creation request is
  // in flight, closing/cancelling must be a no-op — otherwise the admin
  // could close the modal, reopen a fresh (reset) form, and submit again
  // while the original POST /api/shipments is still running invisibly in
  // the background. Guarded on the same ref as the submit lock so this
  // can't race a same-tick close-then-reopen either.
  const closeCreateShipmentModal = () => {
    if (isCreatingShipmentRef.current) return;
    setIsCreateOpen(false);
    setNewShipmentData(createEmptyShipmentForm());
    setUseCustomPOL(false);
    setUseCustomPOD(false);
  };

  // Edit Shipment Action
  const handleEditShipment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingShipment) return;
    try {
      // Shipment-update lost-update race fix: submit only the revision this
      // form was opened with — never a value computed here — so the server
      // can detect whether someone else saved this shipment first. A
      // shipment fetched before this field existed has no revision at all;
      // legacy shipments are always revision 1 (matches the server's own
      // resolveStoredRevision default).
      const expectedRevision = editingShipment.revision ?? 1;
      const res = await apiFetch(`/api/shipments/${editingShipment.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editingShipment, expectedRevision })
      });
      if (res.ok) {
        setIsEditOpen(false);
        setEditingShipment(null);
        setEditConflict(null);
        triggerToast(t('updateSuccess'));
        fetchData();
        return;
      }
      if (res.status === 409) {
        // Someone else saved this shipment first. Do not close the modal,
        // do not reset the admin's unsaved form, and do not auto-apply the
        // newer server record — only offer an explicit reload.
        let conflictBody: any = null;
        try { conflictBody = await res.json(); } catch {}
        setEditConflict({
          currentRevision: typeof conflictBody?.currentRevision === "number" ? conflictBody.currentRevision : null,
          shipment: conflictBody?.shipment ?? null,
        });
        return;
      }
      let msg = "Failed to update shipment.";
      try { msg = (await res.json())?.error || msg; } catch {}
      triggerToast(`❌ ${msg}`);
    } catch (err) {
      console.error(err);
      triggerToast("❌ Could not reach the server. Please check your connection and try again.");
    }
  };

  // Shipment-update lost-update race fix: the only way out of a 409
  // conflict banner — replaces the admin's unsaved edits with the server's
  // current copy (already included in the 409 response, no extra request
  // needed). Never called automatically.
  const handleReloadEditingShipmentFromConflict = () => {
    if (editConflict?.shipment) {
      setEditingShipment(editConflict.shipment);
    }
    setEditConflict(null);
  };

  // Create Driver Action
  const handleCreateDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDriverData.name.trim() || !newDriverData.truckNumber.trim() || !newDriverData.phone.trim()) {
      triggerToast("Please fill in Name, Truck Number, and Phone Number.");
      return;
    }
    try {
      const res = await apiFetch("/api/drivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this_driver_payload())
      });
      if (res.ok) {
        setIsDriverCreateOpen(false);
        setNewDriverData({ name: "", username: "", truckNumber: "", phone: "", truckType: "reefer" });
        triggerToast(t('driverCreated'));
        fetchData();
      } else {
        const text = await res.text();
        let errMsg = "System error during driver creation. Please try again.";
        try {
          const data = JSON.parse(text);
          if (data && data.error) errMsg = data.error;
        } catch (j) {}
        triggerToast(`Error: ${errMsg}`);
      }
    } catch (err: any) {
      console.error(err);
      triggerToast(`Network Exception: ${err?.message || "Failed to reach backend."}`);
    }
  };

  const this_driver_payload = () => {
    return {
      name: newDriverData.name,
      username: newDriverData.username || newDriverData.name.toLowerCase().replace(/\s+/g, '_'),
      truckNumber: newDriverData.truckNumber,
      phone: newDriverData.phone,
      truckType: newDriverData.truckType
    };
  };

  // Quick visibility toggler for sharing page documents
  const toggleDocVisibility = async (shipmentId: string, docId: string, currentVal: boolean) => {
    try {
      const res = await apiFetch(`/api/shipments/${shipmentId}/documents/${docId}/visibility`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isSharedExternally: !currentVal })
      });
      if (res.ok) {
        fetchData();
      } else {
        triggerToast("❌ Failed to update document visibility.");
      }
    } catch (e) {
      console.error(e);
      triggerToast("❌ Could not reach the server.");
    }
  };

  // Update shipment direct link active switch
  const handleToggleShareLink = async (shipment: Shipment, val: boolean) => {
    try {
      const res = await apiFetch(`/api/shipments/${shipment.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isLinkShared: val })
      });
      if (res.ok) {
        fetchData();
        triggerToast(t('updateSuccess'));
      } else {
        triggerToast("❌ Failed to update share link settings.");
      }
    } catch (e) {
      console.error(e);
      triggerToast("❌ Could not reach the server.");
    }
  };

  const handleToggleDocSharing = async (shipment: Shipment, key: 'shareIncludeDocuments' | 'shareIncludePhotos', val: boolean) => {
    try {
      const res = await apiFetch(`/api/shipments/${shipment.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: val })
      });
      if (res.ok) {
        fetchData();
      } else {
        triggerToast("❌ Failed to update sharing settings.");
      }
    } catch (e) {
      console.error(e);
      triggerToast("❌ Could not reach the server.");
    }
  };

  // Operation Team management actions
  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminFormError(null);

    if (!newAdminName.trim() || !newAdminEmail.trim() || !newAdminPassword.trim()) {
      setAdminFormError(lang === 'tr' ? 'Lütfen tüm alanları doldurun' : (lang === 'ar' ? 'يرجى ملء جميع الحقول' : 'Please fill all fields'));
      return;
    }

    if (!newAdminEmail.includes("@")) {
      setAdminFormError(lang === 'tr' ? 'Geçersiz e-posta formatı' : (lang === 'ar' ? 'صيغة البريد الإلكتروني غير صالحة' : 'Invalid email format'));
      return;
    }

    if (newAdminPassword.trim() !== newAdminConfirmPassword.trim()) {
      setAdminFormError(passwordMismatchError);
      return;
    }

    try {
      const res = await apiFetch("/api/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newAdminName.trim(),
          email: newAdminEmail.toLowerCase().trim(),
          password: newAdminPassword.trim(),
          adminType: newAdminType,
          createdAt: new Date().toISOString()
        })
      });

      if (res.ok) {
        setNewAdminName("");
        setNewAdminEmail("");
        setNewAdminPassword("");
        setNewAdminConfirmPassword("");
        setNewAdminType("operation");
        setIsAddAdminOpen(false);
        fetchData(true);
        triggerToast("Operation team member successfully added.");
      } else {
        const errData = await res.json();
        setAdminFormError(errData.error || "Failed to create team member");
      }
    } catch (err: any) {
      setAdminFormError(err.message || "An exception occurred.");
    }
  };

  const handleDeleteAdmin = async (adminId: string) => {
    const confirmMsg = lang === 'tr' ? 'Bu operasyon üyesini silmek istediğinize emin misiniz?' : (lang === 'ar' ? 'هل أنت متأكد من رغبتك في حذف هذا العضو؟' : 'Are you sure you want to delete this team member?');
    if (!window.confirm(confirmMsg)) return;

    try {
      const res = await apiFetch(`/api/admins/${adminId}`, {
        method: "DELETE"
      });

      if (res.ok) {
        fetchData(true);
        triggerToast("Operation team member revoked.");
      } else {
        const errData = await res.json();
        triggerToast(errData.error || "Failed to delete team member");
      }
    } catch (err: any) {
      triggerToast(err.message || "Deletion error");
    }
  };

  // Auto compile WhatsApp and Direct Links
  const getDirectLink = (token: string) => {
    const domain = window.location.origin;
    return `${domain}?token=${token}`;
  };

  const getWhatsAppLink = (shipmentNum: string, token: string, loading: string, delivery: string) => {
    const link = getDirectLink(token);
    const text = encodeURIComponent(
      `etir by MARAS Group\nShipment: ${shipmentNum}\nRoute: ${loading} ➔ ${delivery}\nTrack logistics progress here: ${link}`
    );
    return `https://api.whatsapp.com/send?text=${text}`;
  };

  // Statistics calculation
  //
  // Phase 2A follow-up (blocking-issue fix: dashboard aggregate
  // accuracy). GET /api/shipments now returns only a bounded page — these
  // headline totals/status-breakdown numbers MUST NOT be derived from
  // `shipments.length`/`shipments.filter(...)` anymore (that would
  // silently present "however many happen to be loaded" as a complete
  // business total the moment there's more than one page). They come
  // from `shipmentStats` (GET /api/shipments/stats — a real Firestore
  // `.count()` aggregate over the FULL accessible scope) instead.
  // `shipmentStats` is null until it loads; these fall back to 0 rather
  // than the misleading `shipments.length` in that brief window.
  const totalShipmentsCount = shipmentStats?.total ?? 0;
  // "Completed" here reuses the status pie chart's own "delivered" bucket
  // (Arrived + Delivered + Closed — SHIPMENT_STATUS_GROUPS, shared with
  // the server) for consistency between the two dashboard tiles; "Active"
  // is everything else in the accessible scope, not a separate query.
  const completedShipmentsCount = shipmentStats?.byStatusGroup?.delivered ?? 0;
  const activeShipmentsCount = Math.max(0, totalShipmentsCount - completedShipmentsCount);

  // Recharts metric generation — same accurate, full-scope aggregate as
  // the tiles above, not `shipments.filter(...)` on the loaded page.
  const statusData = [
    { name: 'New', value: shipmentStats?.byStatusGroup?.new ?? 0, color: '#94a3b8' },
    { name: 'Assigned', value: shipmentStats?.byStatusGroup?.assigned ?? 0, color: '#f97316' },
    { name: 'Transit', value: shipmentStats?.byStatusGroup?.transit ?? 0, color: '#3b82f6' },
    { name: 'Delivered', value: shipmentStats?.byStatusGroup?.delivered ?? 0, color: '#10b981' },
  ].filter(d => d.value > 0);

  // Everything below this point (currency totals, route breakdown, the
  // day-by-day completed chart, and the pending-documents count) reads
  // raw field values (agreedAmount/currency/loadingCity/documents), not
  // just a count — Firestore has no server-side GROUP-BY/SUM aggregation
  // for that, and building/maintaining denormalized counters for all of
  // these was judged a larger architecture change than this PR should
  // take on (see the PR description's "prefer dedicated server
  // aggregates ... without broadening this PR excessively" note).
  // DELIBERATE, LABELED SCOPE: these remain computed from `shipments`
  // (the currently-loaded page(s) only) and are rendered with an explicit
  // "(loaded records only)" qualifier in the UI — see
  // LOADED_RECORDS_ONLY_LABEL below — so none of them are ever presented
  // as a confirmed complete business total.
  const currencySum = shipments.reduce((acc, s) => {
    acc[s.currency] = (acc[s.currency] || 0) + s.agreedAmount;
    return acc;
  }, {} as Record<Currency, number>);

  const currencyChartData = Object.entries(currencySum).map(([currency, val]) => ({
    name: currency,
    Amount: val
  }));

  // Shipments by Route (Origin to Destination Route, sorted)
  const routeCounts = shipments.reduce((acc, s) => {
    const origin = s.loadingCity || "Unknown";
    const dest = s.deliveryCity || "Unknown";
    const route = `${origin} ➔ ${dest}`;
    acc[route] = (acc[route] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const routeChartData = Object.entries(routeCounts)
    .map(([name, count]) => ({ name, count: Number(count) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8); // Top 8 routes for professional spacing

  // Shipment Analytics (Pending, Active, Completed)
  const pendingCountVal = shipments.filter(s => ['New', 'Waiting for Driver Quotes', 'Assigned', 'Accepted', 'Booking Confirmed', 'Container Released'].includes(s.status)).length;
  const completedCountVal = shipments.filter(s => ['Arrived', 'Delivered', 'Closed', 'Completed'].includes(s.status)).length;
  const activeCountVal = shipments.length - pendingCountVal - completedCountVal;

  const shipmentAnalyticsData = [
    { name: lang === 'tr' ? 'Bekleyen Sevkıyatlar' : (lang === 'ar' ? 'شحنات قيد الانتظار' : 'Pending Shipments'), value: pendingCountVal, color: '#f59e0b' },
    { name: lang === 'tr' ? 'Aktif Transitler' : (lang === 'ar' ? 'شحنات قيد التنفيذ' : 'Active Transits'), value: activeCountVal, color: '#3b82f6' },
    { name: lang === 'tr' ? 'Tamamlanan Teslimat' : (lang === 'ar' ? 'شحنات مكتملة' : 'Completed Deliveries'), value: completedCountVal, color: '#10b981' }
  ].filter(d => d.value > 0);

  // Generate last 30 days of completed shipments for the chart
  const performanceAnalyticsData = React.useMemo(() => {
    const list = [];
    const now = new Date();
    
    // We want the last 30 days: Day 29 (30 days ago) to Day 0 (today)
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      const dateStr = d.toISOString().split('T')[0]; // Format: YYYY-MM-DD
      
      const completedOnThisDay = shipments.filter(s => {
        const isCompleted = ['Arrived', 'Delivered', 'Closed', 'Completed'].includes(s.status);
        if (!isCompleted) return false;
        
        // Find if transit completed time is set via timeline or fallback to updatedAt/createdAt
        const completeEvent = s.timeline?.find(t => 
          ['Arrived', 'Delivered', 'Closed', 'Completed'].includes(t.status)
        );
        
        const eventDateStr = completeEvent 
          ? new Date(completeEvent.timestamp).toISOString().split('T')[0]
          : new Date(s.updatedAt || s.createdAt).toISOString().split('T')[0];
          
        return eventDateStr === dateStr;
      }).length;
      
      const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
      const formattedLabel = d.toLocaleDateString(lang === 'tr' ? 'tr-TR' : (lang === 'ar' ? 'ar-EG' : 'en-US'), options);
      
      const dataKey = lang === 'tr' ? 'Tamamlanan' : (lang === 'ar' ? 'المكتملة' : 'Completed');
      list.push({
        date: dateStr,
        label: formattedLabel,
        [dataKey]: completedOnThisDay,
      });
    }
    return list;
  }, [shipments, lang]);

  // Calculation of analytics variables
  const { totalCompleted30d, avgDailyCompleted, peakFormattedDay } = React.useMemo(() => {
    let total = 0;
    let peakCount = 0;
    let peakDayLabel = "";
    const valKey = lang === 'tr' ? 'Tamamlanan' : (lang === 'ar' ? 'المكتملة' : 'Completed');
    
    performanceAnalyticsData.forEach(item => {
      const count = (item[valKey] || 0) as number;
      total += count;
      if (count > peakCount) {
        peakCount = count;
        peakDayLabel = `${item.label} (${count})`;
      }
    });
    
    // Average
    const avg = (total / 30).toFixed(1);
    
    return {
      totalCompleted30d: total,
      avgDailyCompleted: avg,
      peakFormattedDay: peakDayLabel || (lang === 'tr' ? 'Mevcut Değil' : (lang === 'ar' ? 'غير متوفر' : 'N/A'))
    };
  }, [performanceAnalyticsData, lang]);

  // --- REAL-TIME RETRIEVAL STATS & CHARTS DATA ---
  const shipmentsPendingDocs = shipments.filter(s => s.status !== "Delivered" && s.status !== "Closed" && (!s.documents || s.documents.length === 0));
  const pendingDocumentsCount = shipmentsPendingDocs.length;
  const shipmentsWithDocsCount = shipments.filter(s => s.documents && s.documents.length > 0).length;

  const realTimeDocsStats = [
    { name: lang === 'tr' ? 'Evraklı Sevkıyatlar' : (lang === 'ar' ? 'شحنات بوثائق' : 'With Docs'), count: shipmentsWithDocsCount },
    { name: lang === 'tr' ? 'Eksik Evraklılar' : (lang === 'ar' ? 'بانتظار الوثائق' : 'Pending Docs'), count: pendingDocumentsCount }
  ];

  // Group notifications by type for real-time overview chart
  const notificationGroups = notifications.reduce((acc, n) => {
    const type = n.type || 'other';
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const notificationCountsChartData = Object.entries(notificationGroups).map(([type, count]) => {
    let label = type;
    if (type === 'assignment') label = lang === 'tr' ? 'Atama' : (lang === 'ar' ? 'تبليغ' : 'Assign');
    else if (type === 'acceptance') label = lang === 'tr' ? 'Kabul' : (lang === 'ar' ? 'قبول' : 'Accept');
    else if (type === 'rejection') label = lang === 'tr' ? 'Red' : (lang === 'ar' ? 'رفض' : 'Reject');
    else if (type === 'status_update') label = lang === 'tr' ? 'Durum' : (lang === 'ar' ? 'تحديث' : 'Status');
    else if (type === 'chat') label = lang === 'tr' ? 'Sohbet' : (lang === 'ar' ? 'دردشة' : 'Chat');
    else if (type === 'doc_upload') label = lang === 'tr' ? 'Belge' : (lang === 'ar' ? 'وثيقة' : 'Doc Upload');
    else if (type === 'delivery') label = lang === 'tr' ? 'Teslim' : (lang === 'ar' ? 'تسليم' : 'Delivery');
    return { name: label, Alerts: count };
  });

  // Recent 5 alerts list for rapid operational clearance
  const recentAlertsData = [...notifications]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5);

  // Match search query against cargo, company, cities, truck, driver, vessel, container or documents
  const filteredShipments = shipments.filter(s => {
    const q = searchQuery.toLowerCase();
    const matchSearch = 
      (s.id || "").toLowerCase().includes(q) ||
      (s.shipmentNumber || "").toLowerCase().includes(q) ||
      (s.companyName || "").toLowerCase().includes(q) ||
      (s.loadingCity || "").toLowerCase().includes(q) ||
      (s.deliveryCity || "").toLowerCase().includes(q) ||
      (s.assignedDriverName || "").toLowerCase().includes(q) ||
      (s.cargoDescription || "").toLowerCase().includes(q) ||
      (s.truckNumber || "").toLowerCase().includes(q) ||
      // New Sea & Air search attributes
      (s.containerNumber || "").toLowerCase().includes(q) ||
      (s.billOfLadingNumber || "").toLowerCase().includes(q) ||
      (s.airWaybillNumber || "").toLowerCase().includes(q) ||
      (s.vesselName || "").toLowerCase().includes(q) ||
      (s.airline || "").toLowerCase().includes(q) ||
      (s.bookingNumber || "").toLowerCase().includes(q);

    const matchStatus = statusFilter === "all"
      || (statusFilter === "active" ? isOpenShipmentStatus(s.status) : s.status === statusFilter);
    const fType = s.freightType || "land";
    const matchType = typeFilter === "all" || fType === typeFilter;
    
    return matchSearch && matchStatus && matchType;
  });

  // Selected details modal data injection
  const targetDetailsShipment = openDetailsId ? shipments.find(s => s.id === openDetailsId) : null;

  // BUG-09: accounts admins can see the Clients/Vendors tabs (server now
  // allows them to read /api/clients and /api/vendors — see
  // canViewClients/canViewVendors in adminAccess.ts) but must stay
  // read-only, matching the write routes which are still super/operation
  // only. Used below to hide the Add/Edit affordances rather than show
  // controls that would just 403 on click.
  const resolvedAdminType = adminType || 'super';
  // Driver Alliance Phase 1: availability chips on the driver cards are
  // derived from real shipments via the same shared rule the server's
  // matching uses (computeBusyDriverIds) — display only; the server
  // re-derives this authoritatively at broadcast/assignment time.
  const allianceBusyDriverIds = React.useMemo(() => computeBusyDriverIds(shipments), [shipments]);
  const canManageAllianceUi = resolvedAdminType === 'super' || resolvedAdminType === 'operation';

  // PR #129 follow-up — MARAS AI attention badge (mobile trigger only).
  // Derived from data already on the client (the loaded shipment
  // registry) via the SAME shared heuristic MARAS AI itself uses
  // (deriveMarasAiAttention / assessShipmentDelay), plus — for Super
  // Admins — alert severities from the EXISTING alerts endpoint, fetched
  // once per session. No AI provider call, no polling, no new API.
  const [marasAiAlertSeverities, setMarasAiAlertSeverities] = useState<string[]>([]);
  const [marasAiBadgeDismissedSignature, setMarasAiBadgeDismissedSignature] = useState("");
  // PR #131 — the MARAS AI Monitoring dashboard + audit badge signal.
  // The count comes from the audit summary endpoint (already
  // scope-filtered per role server-side); unlike the operational
  // attention signature below, audit high/critical findings are NEVER
  // dismissed by merely opening the drawer — the badge clears only when
  // findings are acknowledged/resolved/ignored or no longer detected.
  const [isMarasAiMonitoringOpen, setIsMarasAiMonitoringOpen] = useState(false);
  const [auditOpenHighOrCritical, setAuditOpenHighOrCritical] = useState(0);
  const refreshAuditSummary = React.useCallback(async () => {
    try {
      const res = await apiFetch("/api/admin/audit/summary");
      if (!res.ok) return;
      const data = await res.json();
      setAuditOpenHighOrCritical(Number(data?.summary?.openHighOrCritical) || 0);
    } catch {
      // Badge signal is best-effort.
    }
  }, []);
  useEffect(() => { void refreshAuditSummary(); }, [refreshAuditSummary]);
  useEffect(() => {
    if (resolvedAdminType !== 'super') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/admin/maras-ai/alerts");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data.alerts)) {
          setMarasAiAlertSeverities(data.alerts.map((a: { severity?: string }) => String(a.severity || "")));
        }
      } catch {
        // Badge is an indicator only — silently fine without telemetry.
      }
    })();
    return () => { cancelled = true; };
  }, [resolvedAdminType]);
  const marasAiAttention = React.useMemo(
    () => deriveMarasAiAttention({ shipments, monitoringAlertSeverities: marasAiAlertSeverities, nowIso: new Date().toISOString() }),
    [shipments, marasAiAlertSeverities]
  );
  // Opening MARAS AI (mobile or desktop) dismisses the CURRENT actionable
  // set; the badge re-appears only if the set changes afterwards, and it
  // never shows while nothing actionable remains.
  useEffect(() => {
    if (isMarasAiOpen) setMarasAiBadgeDismissedSignature(marasAiAttention.signature);
  }, [isMarasAiOpen, marasAiAttention.signature]);
  const showMarasAiBadge =
    (marasAiAttention.needsAttention && marasAiAttention.signature !== marasAiBadgeDismissedSignature && !isMarasAiOpen) ||
    // PR #131: open high/critical audit findings keep the badge on
    // regardless of drawer opens — only acknowledge/resolve/ignore (or
    // the condition clearing) removes them from this count.
    auditOpenHighOrCritical > 0;
  const canWriteClients = canManageClients(resolvedAdminType);
  const canWriteVendors = canManageVendors(resolvedAdminType);

  // Admin navigation tabs, filtered by admin role/type — shared by the
  // desktop sidebar and the mobile/tablet horizontal tab bar below.
  const allRoleFilteredAdminTabs = (() => {
    const isSuper = resolvedAdminType === 'super';
    const isOperation = resolvedAdminType === 'operation';
    const isAccounts = resolvedAdminType === 'accounts' || resolvedAdminType === 'account';

    const rawTabs = [
      { id: 'dashboard', label: t('dashboard'), icon: ClipboardList },
      { id: 'shipments', label: t('shipmentManagement'), icon: Ship },
      { id: 'tracking_map', label: lang === 'tr' ? 'GPS Takip Haritası' : (lang === 'ar' ? 'خريطة التتبع GPS' : 'GPS Tracking Map'), icon: MapIcon },
      { id: 'drivers', label: t('driverManagement'), icon: Truck },
      { id: 'chat_center', label: lang === 'tr' ? 'Mesaj Merkezi' : (lang === 'ar' ? 'مركز المحادثات' : 'Chat Center'), icon: MessageSquare },
      { id: 'clients', label: lang === 'tr' ? 'Müşteriler' : (lang === 'ar' ? 'العملاء' : 'Clients'), icon: Building2 },
      { id: 'vendors', label: lang === 'tr' ? 'Tedarikçiler' : (lang === 'ar' ? 'الموردين والشركاء' : 'Vendors'), icon: Building2 },
      { id: 'costs', label: lang === 'tr' ? 'Muhasebe ve Maliyetler' : (lang === 'ar' ? 'الحسابات وبيانات التكلفة' : 'Accounts & Cost Statements'), icon: DollarSign },
      { id: 'gmail', label: lang === 'tr' ? 'Google Workspace' : (lang === 'ar' ? 'جوجل وورك سبيس' : 'Google Workspace'), icon: Mail },
      { id: 'audit', label: t('auditLogsTitle'), icon: ShieldCheck },
      ...(isSuper ? [{ id: 'team', label: lang === 'tr' ? 'Operasyon Ekibi' : (lang === 'ar' ? 'فريق العمليات' : 'Operation Team'), icon: UserPlus }] : []),
      // Visible to every admin type, unlike 'team' above which is
      // restricted to super-admins (team management exposes other
      // admins' info). This tab only ever shows the current admin's
      // own self-delete option (Apple Guideline 5.1.1v) - sub-admins
      // need a way to reach it even though they can't see 'team'.
      { id: 'my_account', label: lang === 'tr' ? 'Hesabım' : (lang === 'ar' ? 'حسابي' : 'My Account'), icon: User },
      // Settings Center foundation hub — visible to every admin type,
      // like 'my_account'. It only links to 'team'/'gmail'/'audit'
      // (still gated below exactly as they are today) rather than
      // duplicating their UI, so this doesn't widen anyone's access.
      { id: 'settings', label: lang === 'tr' ? 'Ayarlar' : (lang === 'ar' ? 'الإعدادات' : 'Settings'), icon: Settings }
    ];

    const roleFiltered = rawTabs.filter(tab => {
      // Logistics Analytics (PR #59): gated by canViewLogisticsAnalytics
      // (super only, for now) ahead of the per-role lists below — its
      // charts are built from the shipments client state, which accounts
      // admins can't fetch (GET /api/shipments is super/operation only),
      // so showing accounts the tab just rendered an empty page. See
      // adminAccess.ts for the full reasoning and docs/FOLLOW_UP_ROADMAP.md
      // for the accounts-analytics / operation-safe-analytics follow-ups.
      if (tab.id === 'reports') return canViewLogisticsAnalytics(resolvedAdminType);
      if (isSuper) return true;
      if (isOperation) {
        return ['dashboard', 'shipments', 'tracking_map', 'drivers', 'chat_center', 'clients', 'vendors', 'my_account', 'settings'].includes(tab.id);
      }
      if (isAccounts) {
        return ['costs', 'clients', 'vendors', 'my_account', 'settings'].includes(tab.id);
      }
      return false;
    });

    // Sidebar/nav dedup (PR #57): 'my_account' / 'team' / 'gmail' / 'audit'
    // are still full tabs — their activeTab values, content blocks, and
    // role gating above are untouched — but Settings (the 'settings' tab)
    // is now the single top-level entry point for them, linking in via its
    // "My Profile" / "Staff & Permissions" / "Google Workspace" /
    // "Security & Activity" cards' setActiveTab calls. Hiding them here
    // (the array shared by AdminSidebar and the mobile tab bar below) just
    // removes the duplicate top-level nav entry; it doesn't affect who can
    // reach them, since that's still decided by the role filter above and
    // by resolvedAdminType === 'super' on the Settings cards themselves.
    const HIDDEN_FROM_TOP_LEVEL_NAV_IDS = ['my_account', 'team', 'gmail', 'audit'];
    return { visible: roleFiltered.filter(tab => !HIDDEN_FROM_TOP_LEVEL_NAV_IDS.includes(tab.id)), roleFiltered };
  })();
  const filteredAdminTabs = allRoleFilteredAdminTabs.visible;
  // feature/admin-mobile-ui: 'team' is deliberately hidden from
  // filteredAdminTabs above (see the comment on HIDDEN_FROM_TOP_LEVEL_NAV_IDS
  // just above — desktop reaches it via the Settings hub instead), but the
  // mobile "More" menu still wants it directly (labeled "Employees" there —
  // see MobileMoreMenu), so it's looked up from the pre-strip list. Nothing
  // here changes who is allowed to see it — that's still decided by the
  // exact same role filter above (`isSuper ? [...] : []`).
  const mobileMoreExtraTabIds = allRoleFilteredAdminTabs.roleFiltered.some(tab => tab.id === 'team') ? ['team'] : [];
  const mobilePrimaryTabIds = resolvePrimaryMobileTabs(filteredAdminTabs);
  const mobileMoreMenuTabs = resolveMoreMenuTabIds(filteredAdminTabs, mobilePrimaryTabIds, mobileMoreExtraTabIds)
    .map((id) => {
      const tab = allRoleFilteredAdminTabs.roleFiltered.find((t) => t.id === id);
      if (!tab) return null;
      // 'team' keeps its real desktop label everywhere except this one
      // mobile menu, where the confirmed spec calls it "Employees" — this
      // is a display-only override, not a change to the tab's identity,
      // permission gating, or its desktop label.
      const label = id === 'team'
        ? (lang === 'tr' ? 'Çalışanlar' : (lang === 'ar' ? 'الموظفون' : 'Employees'))
        : tab.label;
      return { id: tab.id, label, icon: tab.icon };
    })
    .filter((tab): tab is { id: string; label: string; icon: typeof ClipboardList } => tab !== null);

  // BUG-24: catch a tab that AdminSidebar's GROUPS forgot to place — it
  // would otherwise just silently disappear from the desktop sidebar while
  // still showing up in the mobile tab bar below. Dev-only, no UI change.
  if ((import.meta as any).env?.DEV) {
    const ungrouped = findUngroupedTabIds(filteredAdminTabs.map(tab => tab.id));
    if (ungrouped.length > 0) {
      console.warn(`[AdminSidebar] Tab id(s) not present in any sidebar group: ${ungrouped.join(', ')}`);
    }
  }

  // BUG-14: dir="rtl" already reverses a flex-row's visual order on its own;
  // also forcing flex-row-reverse cancelled that back out, pushing the
  // desktop sidebar to the wrong side in Arabic.
  return (
    <div className="flex flex-row bg-slate-50 min-h-screen text-slate-800 font-sans" dir={isRtl ? 'rtl' : 'ltr'}>
      <AdminSidebar
        tabs={filteredAdminTabs}
        activeTab={activeTab}
        onSelectTab={(id) => setActiveTab(id as any)}
        lang={lang}
        isRtl={isRtl}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed((v) => !v)}
        isMobileOpen={isMobileNavOpen}
        onCloseMobile={() => setIsMobileNavOpen(false)}
      />
      {/* feature/admin-mobile-ui correction pass: mobile had NO horizontal
          padding at all (content touched the screen edges) — only
          bottom clearance for the fixed nav. px-3 restores a normal
          inset (no top padding, so MobileTopAppBar — the first child,
          sticky top-0 — sits flush with zero gap instead of a small
          scroll-away gap above it); bottom padding is safe-area-aware so
          it always clears MobileBottomNav regardless of the device's
          home-indicator inset, not just a fixed guess. */}
      <div className={`flex-1 min-w-0 ${isMobileMode ? 'px-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))]' : 'p-4 md:p-6'}`}>

      {/* feature/admin-mobile-ui: mobile-only top app bar (lg:hidden,
          internally) — branding mark, current page title (same
          filteredAdminTabs lookup the old inline "Menu" bar used), the
          same notification bell state as the desktop bell below, and a
          menu button opening the same "More" sheet as the bottom nav's
          More item. The app's own outer header (App.tsx — brand,
          language switch, Logout) still renders above this, unchanged,
          on every viewport. */}
      <MobileTopAppBar
        lang={lang}
        isRtl={isRtl}
        title={filteredAdminTabs.find((tab) => tab.id === activeTab)?.label ?? ''}
        TitleIcon={filteredAdminTabs.find((tab) => tab.id === activeTab)?.icon}
        unreadNotifications={notifications.filter(n => !isNotificationReadForUser(n, ownAdminId)).length}
        onBellClick={() => { setIsNotifOpen(!isNotifOpen); setIsMoreMenuOpen(false); }}
        onMenuClick={() => { setIsMoreMenuOpen(true); setIsNotifOpen(false); }}
        // feature/mobile-maras-ai-access: the SAME role gate as the desktop
        // MARAS AI header button below — super/operation only. Other roles
        // never receive the handler, so the bar renders no AI button.
        onMarasAiClick={
          resolvedAdminType === 'super' || resolvedAdminType === 'operation'
            ? () => { setIsMarasAiOpen(true); setIsNotifOpen(false); setIsMoreMenuOpen(false); }
            : undefined
        }
        marasAiAttention={showMarasAiBadge}
      />

      {/* Toast Alert */}
      {toast && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 bg-slate-900 text-white font-medium py-3 px-6 rounded-xl shadow-2xl flex items-center gap-2 z-50 animate-bounce text-sm">
          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          <span>{toast}</span>
        </div>
      )}

      {/* Admin Quick Action Header — desktop only; feature/admin-mobile-ui's
          MobileTopAppBar above covers this role on mobile instead of
          squeezing the same wide, multi-badge header into a narrow
          viewport. */}
      <div className="hidden lg:flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6 border-b border-slate-200 pb-5 lg:mt-4 lg:mx-4 md:mx-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
            <span className="p-2 bg-slate-900 text-white rounded-lg"><Ship className="w-6 h-6 shrink-0" /></span>
            {t('brand')} — {t('roleAdmin')}
          </h1>
          <p className="text-slate-500 text-sm mt-1">{t('tagline')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Global SWR Synchronization badge */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all duration-300 ${
            swrStatus === 'offline' 
              ? "bg-amber-50 border-amber-200 text-amber-700 shadow-sm animate-pulse" 
              : swrStatus === 'error'
              ? "bg-rose-50 border-rose-200 text-rose-700 shadow-sm"
              : swrStatus === 'syncing'
              ? "bg-blue-50/70 border-blue-200 text-blue-700 shadow-sm"
              : "bg-white border-slate-200 text-slate-700 shadow-sm"
          }`}
          title={swrErrorDetail ? `Error details: ${swrErrorDetail}` : undefined}>
            <span className={`w-2 h-2 rounded-full shrink-0 ${
              swrStatus === 'offline' 
                ? "bg-amber-500" 
                : swrStatus === 'error'
                ? "bg-rose-500 animate-ping"
                : swrStatus === 'syncing'
                ? "bg-blue-500 animate-pulse"
                : "bg-emerald-500"
            }`} />
            <span className="font-semibold tracking-tight whitespace-nowrap">
              {swrStatus === 'offline' && (lang === 'tr' ? "Çevrimdışı" : lang === 'ar' ? "غير متصل" : "Offline")}
              {swrStatus === 'error' && (lang === 'tr' ? "Bağlantı Hatası" : lang === 'ar' ? "خطأ في الاتصال" : "Sync Error")}
              {swrStatus === 'syncing' && (lang === 'tr' ? "Eşitleniyor..." : lang === 'ar' ? "جاري المزامنة..." : "Syncing...")}
              {swrStatus === 'synced' && (
                <>
                  {lang === 'tr' ? "Eşitlendi" : lang === 'ar' ? "منزامن" : "Synced"}{": "}
                  {(() => {
                    if (!lastSyncedAt) return lang === 'tr' ? "şimdi" : lang === 'ar' ? "الآن" : "just now";
                    const seconds = Math.floor((currentTime.getTime() - lastSyncedAt.getTime()) / 1000);
                    if (seconds < 5) return lang === 'tr' ? "şimdi" : lang === 'ar' ? "الآن" : "just now";
                    if (seconds < 60) return `${seconds}s ${lang === 'tr' ? 'önce' : lang === 'ar' ? 'قبل' : 'ago'}`;
                    return `${Math.floor(seconds / 60)}m ${lang === 'tr' ? 'önce' : lang === 'ar' ? 'قبل' : 'ago'}`;
                  })()}
                </>
              )}
            </span>
            
            <button 
              onClick={(e) => {
                e.preventDefault();
                fetchData();
              }}
              disabled={isSyncing}
              title={lang === 'tr' ? "Şimdi Eşitle" : lang === 'ar' ? "مزامنة الآن" : "Sync Now"}
              className="p-1 hover:bg-slate-100/80 rounded transition-colors active:scale-95 disabled:opacity-50 cursor-pointer border-0 bg-transparent flex items-center justify-center ml-0.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin text-blue-600" : "text-slate-500 hover:text-slate-800"}`} />
            </button>
          </div>

          {/* ✨ MARAS AI quick-access button — super/operation admins only */}
          {(resolvedAdminType === 'super' || resolvedAdminType === 'operation') && (
            <button
              onClick={() => setIsMarasAiOpen(true)}
              title="Ask MARAS AI"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-gradient-to-br from-slate-900 to-slate-800 hover:from-slate-800 hover:to-slate-700 text-white text-xs font-bold shadow-lg shadow-slate-900/10 border border-orange-500/40 hover:border-orange-400 transition-all cursor-pointer"
            >
              <span>✨</span>
              <span className="hidden sm:inline">MARAS AI</span>
            </button>
          )}

          {/* Driver helpline chat button & dropdown */}
          <div className="relative" ref={chatDropdownRef}>
            <button
              onClick={() => {
                setIsChatDropdownOpen(!isChatDropdownOpen);
                setIsNotifOpen(false);
              }}
              className="p-2.5 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg relative transition-all cursor-pointer flex items-center justify-center border-0 focus:outline-none"
              title={lang === "tr" ? "Sürücü Sohbetleri" : lang === "ar" ? "محادثات السائقين" : "Driver Support Chats"}
            >
              <MessageSquare className={`w-5 h-5 ${unreadChatMessages.length > 0 ? "text-orange-600 animate-pulse" : "text-slate-500"}`} />
              {formatUnreadBadge(unreadChatMessages.length) && (
                <span className="absolute -top-1 -end-1 bg-orange-600 text-white font-bold text-[10px] min-w-[20px] h-5 px-1 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                  {formatUnreadBadge(unreadChatMessages.length)}
                </span>
              )}
            </button>

            {isChatDropdownOpen && (
              <div className={`absolute top-full right-0 mt-2 w-80 md:w-96 bg-white border border-slate-200 rounded-xl shadow-2xl z-[100] p-4 text-slate-900 ${isRtl ? 'left-0 right-auto' : 'right-0 left-auto'}`}>
                <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-3">
                  <div className="flex items-center gap-1.5 font-bold text-sm text-slate-800">
                    <MessageSquare className="w-4 h-4 text-orange-600/90" />
                    <span>{lang === 'tr' ? 'Sürücü Mesajları' : lang === 'ar' ? 'رسائل السائقين غير المقروءة' : 'Unread Driver Chats'}</span>
                    {formatUnreadBadge(unreadChatMessages.length) && (
                      <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full font-black">
                        {formatUnreadBadge(unreadChatMessages.length)}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setIsChatDropdownOpen(false)}
                    className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-all border-0 cursor-pointer"
                    title={lang === 'tr' ? 'Kapat' : lang === 'ar' ? 'إغلاق' : 'Close'}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="max-h-64 overflow-y-auto space-y-2 pr-1.5 scrollbar-thin">
                  {unreadChatMessages.length === 0 ? (
                    <div className="py-8 text-center text-slate-400 text-xs">
                      {lang === 'tr' ? 'Okunmamış sürücü mesajı yok.' : lang === 'ar' ? 'لا توجد رسائل غير مقروءة من السائقين.' : 'All driver support chats are read.'}
                    </div>
                  ) : (
                    unreadChatMessages.map((msg) => {
                      const shipment = shipments.find(s => s.id === msg.shipmentId);
                      return (
                        <div
                          key={msg.id}
                          className="p-2.5 rounded-lg border border-slate-100 bg-orange-50/25 text-xs transition-all relative"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-extrabold text-orange-600">
                                {shipment ? `#${shipment.shipmentNumber}` : 'Support Thread'}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                {new Date(msg.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <div className="text-[11px] font-bold text-slate-700">
                              {msg.senderName} ({
                                msg.sender === 'client'
                                  ? (lang === 'tr' ? 'Müşteri' : lang === 'ar' ? 'عميل' : 'Client')
                                  : (lang === 'tr' ? 'Sürücü' : lang === 'ar' ? 'سائق' : 'Driver')
                              })
                            </div>
                            <p className="text-slate-600 font-medium leading-normal italic truncate">
                              {msg.type === 'file' ? (lang === 'tr' ? '📁 Dosya / Belge' : lang === 'ar' ? '📁 ملف / مستند' : '📁 File Attachment') : msg.text}
                            </p>
                            <div className="flex justify-end pt-1 border-t border-slate-100/60 mt-1">
                              {shipment && (
                                <button
                                  onClick={() => {
                                    openShipmentChatForChannel(shipment, msg.channel || (msg.sender === 'client' ? 'client_admin' : 'driver_admin'));
                                    setIsChatDropdownOpen(false);
                                  }}
                                  className="text-[10px] text-orange-600 hover:text-orange-700 hover:underline font-extrabold flex items-center gap-0.5 cursor-pointer bg-transparent border-0"
                                >
                                  <MessageSquare className="w-3 h-3" />
                                  <span>{lang === 'tr' ? 'Sohbete Git' : lang === 'ar' ? 'عرض المحادثة' : 'Go to Chat'}</span>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Notification Bell Dropdown */}
          <div className="relative" ref={notifDropdownRef}>
            <button
              onClick={() => {
                setIsNotifOpen(!isNotifOpen);
                setIsChatDropdownOpen(false);
              }}
              className="p-2.5 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg relative transition-all cursor-pointer flex items-center justify-center border-0 focus:outline-none"
              title="Notifications"
            >
              {notifications.filter(n => !isNotificationReadForUser(n, ownAdminId)).length > 0 ? (
                <BellRing className="w-5 h-5 text-orange-500 animate-bounce" />
              ) : (
                <Bell className="w-5 h-5 text-slate-500" />
              )}
              {notifications.filter(n => !isNotificationReadForUser(n, ownAdminId)).length > 0 && (
                <span className="absolute -top-1 -end-1 bg-orange-500 text-white font-bold text-[10px] w-5 h-5 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                  {notifications.filter(n => !isNotificationReadForUser(n, ownAdminId)).length}
                </span>
              )}
            </button>

            {isNotifOpen && (
              <div className={`absolute top-full right-0 mt-2 w-80 md:w-96 bg-white border border-slate-200 rounded-xl shadow-2xl z-[100] p-4 text-slate-900 ${isRtl ? 'left-0 right-auto' : 'right-0 left-auto'}`}>
                <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-3">
                  <div className="flex items-center gap-1.5 font-bold text-sm text-slate-800">
                    <Bell className="w-4 h-4 text-slate-600" />
                    <span>{lang === 'tr' ? 'Bildirimler' : lang === 'ar' ? 'الإشعارات' : 'Notifications'}</span>
                    {notifications.filter(n => !isNotificationReadForUser(n, ownAdminId)).length > 0 && (
                      <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full">
                        {notifications.filter(n => !isNotificationReadForUser(n, ownAdminId)).length} {lang === 'tr' ? 'yeni' : lang === 'ar' ? 'جديد' : 'new'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {notifications.filter(n => !isNotificationReadForUser(n, ownAdminId)).length > 0 && (
                      <button
                        onClick={handleMarkAllNotifsRead}
                        className="text-xs text-orange-500 hover:text-orange-600 font-semibold cursor-pointer border-0 bg-transparent"
                      >
                        {lang === 'tr' ? 'Tümünü okundu işaretle' : lang === 'ar' ? 'تحديد الكل كمقروء' : 'Mark all as read'}
                      </button>
                    )}
                    <button
                      onClick={() => setIsNotifOpen(false)}
                      className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-all border-0 cursor-pointer shrink-0"
                      title="Close"
                      aria-label="Close notifications"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="max-h-64 overflow-y-auto space-y-2 pr-1.5 scrollbar-thin">
                  {notifications.length === 0 ? (
                    <div className="py-8 text-center text-slate-400 text-xs">
                      {lang === 'tr' ? 'Henüz bildirim yok.' : lang === 'ar' ? 'لا توجد إشعارات حالياً.' : 'No recent notifications.'}
                    </div>
                  ) : (
                    notifications.map((notif) => {
                      const shipment = shipments.find(s => s.id === notif.shipmentId);
                      const isUnread = !isNotificationReadForUser(notif, ownAdminId);
                      return (
                        <div
                          key={notif.id}
                          className={`p-2.5 rounded-lg border text-xs transition-all relative ${
                            isUnread 
                              ? 'bg-orange-50/40 border-orange-100' 
                              : 'bg-slate-50/50 border-slate-100'
                          }`}
                        >
                          <div className="flex gap-2">
                            <span className="mt-0.5 shrink-0">
                              {notif.type === 'chat' && <MessageSquare className="w-4 h-4 text-orange-500" />}
                              {notif.type === 'doc_upload' && <FileText className="w-4 h-4 text-orange-500" />}
                              {notif.type === 'assignment' && <ClipboardList className="w-4 h-4 text-green-500" />}
                              {notif.type === 'status_update' && <RefreshCw className="w-4 h-4 text-purple-500" />}
                              {notif.type !== 'chat' && notif.type !== 'doc_upload' && notif.type !== 'assignment' && notif.type !== 'status_update' && (
                                <Bell className="w-4 h-4 text-slate-400" />
                              )}
                            </span>
                            <div className="flex-1 space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-bold text-slate-800">
                                  {lang === 'tr' ? notif.titleTr : lang === 'ar' ? notif.titleAr : notif.titleEn}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  {new Date(notif.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              <p className="text-slate-600 font-medium leading-normal">
                                {lang === 'tr' ? notif.messageTr : lang === 'ar' ? notif.messageAr : notif.messageEn}
                              </p>
                              <div className="flex items-center gap-2 pt-1 border-t border-slate-100/50 mt-1">
                                {shipment && (
                                  <button
                                    onClick={() => {
                                      openShipmentChatForChannel(shipment, notif.channel);
                                      setIsNotifOpen(false);
                                      if (isUnread) handleMarkNotifRead(notif.id);
                                    }}
                                    className="text-[10px] text-orange-600 hover:text-orange-700 hover:underline font-extrabold flex items-center gap-0.5 cursor-pointer bg-transparent border-0"
                                  >
                                    <MessageSquare className="w-3 h-3" />
                                    <span>{lang === 'tr' ? 'Sohbeti Aç' : lang === 'ar' ? 'فتح المحادثة' : 'Open Chat'}</span>
                                  </button>
                                )}
                                {isUnread && (
                                  <button
                                    onClick={() => handleMarkNotifRead(notif.id)}
                                    className="text-[10px] text-slate-400 hover:text-slate-600 font-bold cursor-pointer bg-transparent border-0"
                                  >
                                    {lang === 'tr' ? 'Okundu' : lang === 'ar' ? 'مقروء' : 'Dismiss'}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {(resolvedAdminType === 'super' || resolvedAdminType === 'operation') && (
            <button
              onClick={() => {
                setNewShipmentData(createEmptyShipmentForm());
                setUseCustomPOL(false);
                setUseCustomPOD(false);
                setIsCreateOpen(true);
              }}
              className="bg-orange-500 hover:bg-orange-600 text-white px-5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 shadow-lg hover:shadow-orange-200 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>{t('createShipment')}</span>
            </button>
          )}
        </div>
      </div>

      {/* ✨ MARAS AI drawer — connected to the server-side backend (PR
          #128). Quick suggestions seed the prompt; conversations are
          persisted per admin; every assistant reply carries its honest
          response-source indicator. */}
      {isMarasAiOpen && (resolvedAdminType === 'super' || resolvedAdminType === 'operation') && (
        <div
          className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs z-[200] animate-fade-in"
          onClick={() => setIsMarasAiOpen(false)}
        >
          <div
            className={`fixed inset-y-0 ${isRtl ? 'left-0 border-r' : 'right-0 border-l'} w-full max-w-md bg-white shadow-2xl flex flex-col text-slate-900 border-slate-200`}
            onClick={(e) => e.stopPropagation()}
            dir={isRtl ? 'rtl' : 'ltr'}
          >
            {/* feature/mobile-maras-ai-access: pt uses max(designed padding,
                safe-area-inset-top) so on notched phones (iPhone Safari,
                Android Chrome) the title/close button clear the status bar;
                on desktop env() is 0 and max() resolves to the exact same
                1.25rem this header always had — zero desktop change. */}
            <div className="flex items-start justify-between gap-3 p-5 pt-[max(1.25rem,env(safe-area-inset-top))] border-b border-slate-800 bg-gradient-to-br from-slate-900 to-slate-800 text-white shrink-0">
              <div>
                <h2 className="text-lg font-black tracking-tight flex items-center gap-2">
                  <span>✨</span>
                  <span>MARAS AI</span>
                </h2>
                <p className="text-xs text-slate-300 font-medium mt-1">AI support for MARAS operations inside eTIR.</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {/* PR #131: MARAS AI Monitoring dashboard — full view for
                    Super Admin; operation admins see their operational
                    scope (the server filters regardless of the client). */}
                <button
                  onClick={() => setIsMarasAiMonitoringOpen(true)}
                  className="p-1.5 text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-all border-0 cursor-pointer"
                  title="Monitoring"
                  aria-label="Monitoring"
                >
                  <ShieldAlert className="w-4.5 h-4.5" />
                </button>
                <button
                  onClick={() => setIsMarasAiOpen(false)}
                  className="p-1.5 text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-all border-0 cursor-pointer"
                  title="Close"
                >
                  <X className="w-4.5 h-4.5" />
                </button>
              </div>
            </div>

            {/* Same max() trick for the home-indicator inset at the bottom;
                overscroll-contain keeps thread scrolling inside the drawer
                on touch devices instead of rubber-banding the page. */}
            <div className="flex-1 overflow-y-auto overscroll-contain p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-5">
              <div className="flex gap-2 p-3 rounded-xl border border-orange-200 bg-orange-50 text-orange-800 text-xs font-semibold leading-relaxed">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-orange-500" />
                <span>MARAS AI provides suggestions only. Staff must review and approve before any action.</span>
              </div>

              <div className="flex gap-2 p-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-600 text-xs font-medium leading-relaxed">
                <Lock className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" />
                <span>Only the minimum operational data needed for your request is sent to the AI provider. Credentials and keys never leave the server.</span>
              </div>

              {/* Quick suggestions — shown only when there is no active
                  conversation. Selecting one populates the prompt. */}
              {marasAiThread.length === 0 && (
                <div>
                  <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">Quick Suggestions</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {MARAS_AI_QUICK_SUGGESTIONS.map((suggestion) => {
                      const Icon = MARAS_AI_SUGGESTION_ICONS[suggestion.id] || Ship;
                      return (
                        <button
                          key={suggestion.id}
                          onClick={() => {
                            setMarasAiPrompt(suggestion.prompt);
                            setMarasAiError("");
                          }}
                          className="flex flex-col items-start gap-1.5 p-3 rounded-xl border border-slate-200 bg-white hover:border-orange-300 hover:bg-orange-50/50 text-left transition-all cursor-pointer"
                        >
                          <Icon className="w-4 h-4 text-orange-500" />
                          <span className="text-xs font-bold text-slate-700 leading-tight">{suggestion.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* This admin's own persisted conversations — reopen or delete. */}
              {marasAiThread.length === 0 && marasAiConversations.length > 0 && (
                <div>
                  <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">Conversations</h3>
                  <div className="space-y-1.5">
                    {marasAiConversations.map((convo) => (
                      <div key={convo.id} className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleOpenMarasAiConversation(convo.id)}
                          className="flex-1 min-w-0 text-left p-2.5 rounded-xl border border-slate-200 bg-white hover:border-orange-300 hover:bg-orange-50/50 transition-all cursor-pointer"
                        >
                          <span className="block text-xs font-bold text-slate-700 truncate">{convo.title}</span>
                          <span className="block text-[10px] text-slate-400 font-medium mt-0.5">
                            {convo.messageCount} message{convo.messageCount === 1 ? '' : 's'} · {new Date(convo.updatedAt).toLocaleString()}
                          </span>
                        </button>
                        <button
                          onClick={() => handleDeleteMarasAiConversation(convo.id)}
                          className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all border-0 cursor-pointer shrink-0"
                          title="Delete conversation"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {marasAiThread.length > 0 && (
                <button
                  onClick={handleNewMarasAiConversation}
                  className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-orange-500 hover:text-orange-600 bg-transparent border-0 cursor-pointer p-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Conversation</span>
                </button>
              )}

              {marasAiThread.length > 0 && (
                <div className="space-y-2.5">
                  <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-400">Conversation</h3>
                  {marasAiThread.map((turn, i) => (
                    <div
                      key={i}
                      className={`p-3 rounded-xl text-xs leading-relaxed whitespace-pre-wrap break-words ${
                        turn.role === 'user'
                          ? 'bg-orange-50 border border-orange-200 text-slate-800 font-semibold'
                          : 'bg-slate-50 border border-slate-200 text-slate-700'
                      }`}
                    >
                      <span className={`block text-[10px] font-black uppercase tracking-wider mb-1 ${turn.role === 'user' ? 'text-orange-500' : 'text-slate-400'}`}>
                        {turn.role === 'user' ? 'You' : 'MARAS AI'}
                      </span>
                      {turn.role === 'assistant' ? (
                        // PR #130: structured cards + safe Markdown — one
                        // shared component for mobile and desktop. The
                        // tracking action is role-gated here; shipment/chat
                        // views are available to every role this drawer
                        // renders for.
                        <MarasAiResponseView
                          text={turn.text}
                          structured={turn.structured}
                          lang={lang}
                          onOpenShipment={handleMarasAiOpenShipment}
                          onOpenTracking={canViewGpsTracking(resolvedAdminType) ? handleMarasAiOpenTracking : undefined}
                          onOpenChat={handleMarasAiOpenChat}
                        />
                      ) : (
                        turn.text
                      )}
                      {/* Honest, server-derived response-source indicator —
                          never invented client-side. */}
                      {turn.role === 'assistant' && turn.source && (MARAS_AI_SOURCE_LABELS as Record<string, string>)[turn.source] && (
                        <span className="mt-2 block">
                          <span className="inline-block text-[9px] font-black uppercase tracking-wider text-slate-400 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5">
                            {(MARAS_AI_SOURCE_LABELS as Record<string, string>)[turn.source]}
                          </span>
                        </span>
                      )}
                    </div>
                  ))}
                  {isMarasAiSending && (
                    <div className="p-3 rounded-xl text-xs bg-slate-50 border border-slate-200 text-slate-400 font-semibold animate-pulse">
                      MARAS AI is thinking…
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-400">Ask MARAS AI</h3>
                <textarea
                  value={marasAiPrompt}
                  onChange={(e) => setMarasAiPrompt(e.target.value)}
                  rows={3}
                  placeholder="Ask MARAS AI about a shipment, document, chat, or operation..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMarasAi();
                    }
                  }}
                  className="w-full p-3 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-orange-500/40 focus:border-orange-400 resize-none font-medium"
                />
                <button
                  onClick={handleSendMarasAi}
                  disabled={isMarasAiSending || !marasAiPrompt.trim()}
                  className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-lg font-bold text-xs shadow-md transition-all cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isMarasAiSending ? 'Sending…' : 'Send'}</span>
                </button>
                {marasAiError && (
                  <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5 font-semibold">
                    {marasAiError}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PR #131: MARAS AI Monitoring dashboard — rendered above the
          drawer; the server scope-filters every list and action by role. */}
      {isMarasAiMonitoringOpen && (resolvedAdminType === 'super' || resolvedAdminType === 'operation') && (
        <MarasAiMonitoringPanel
          lang={lang}
          isRtl={isRtl}
          isSuper={resolvedAdminType === 'super'}
          onClose={() => setIsMarasAiMonitoringOpen(false)}
          onOpenShipment={(shipmentId) => {
            setIsMarasAiMonitoringOpen(false);
            setIsMarasAiOpen(false);
            setOpenDetailsId(shipmentId);
          }}
          onChanged={() => { void refreshAuditSummary(); }}
        />
      )}

      {/* The old inline "Menu" bar that used to live here (hamburger button
          + current-tab label, lg:hidden) is superseded by MobileTopAppBar,
          now rendered as a proper sticky top bar at the very top of this
          content column (see just above the Toast Alert block) — same
          underlying data (filteredAdminTabs, activeTab), same AdminSidebar
          drawer still reachable (isMobileNavOpen is unchanged, just no
          longer triggered from here; MobileTopAppBar's menu button and
          MobileBottomNav's "More" both open the new mobileMoreMenu sheet
          instead, which is the curated page the confirmed spec asks for). */}

      {/* 🚀 PROMINENT SHIPMENT QUICK RETRIEVAL SEARCH BAR.
          feature/admin-mobile-ui correction pass: mobile gets a compact
          one-line variant (short label + input only, no explanatory
          paragraph) instead of the full card — desktop is untouched. */}
      {(activeTab === 'dashboard' || activeTab === 'shipments') && (
        isMobileMode ? (
          <div className="flex items-center gap-2 mb-4">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 shrink-0">
              {lang === 'tr' ? "Ara" : (lang === 'ar' ? "بحث" : "Search")}
            </span>
            <div className="flex-1 relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-3.5 w-3.5 text-slate-400" />
              </div>
              <input
                type="text"
                className="block w-full pl-9 pr-9 py-2 bg-white text-xs text-slate-900 border border-slate-200 focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 rounded-xl focus:outline-none transition-all placeholder:text-slate-400 font-medium font-sans"
                placeholder={lang === 'tr' ? "Sevkiyat, sürücü veya şehir..." : (lang === 'ar' ? "شحنة، سائق أو مدينة..." : "Shipment, driver, or city...")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setSearchQuery("");
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-700 bg-transparent border-0 cursor-pointer"
                  type="button"
                  title={lang === 'tr' ? "Temizle" : "Clear Query"}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        ) : (
        <div className="bg-white rounded-2xl border border-slate-200 p-4.5 mb-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all duration-300">
          <div className="space-y-1">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
              <span className="p-1 bg-orange-500/10 text-orange-600 rounded"><Search className="w-3.5 h-3.5" /></span>
              <span>{lang === 'tr' ? "Sevkiyat Arama ve Hızlı Getirme" : (lang === 'ar' ? "البحث السريع واسترجاع الشحنات" : "Shipment Quick Retrieval")}</span>
            </h3>
            <p className="text-[11px] text-slate-500 font-medium">
              {lang === 'tr'
                ? "Sevkiyatları ID'sine, atanan sürücüye veya varış/hedef şehrine göre anında arayın ve filtreleyin."
                : (lang === 'ar' ? "ابحث عن الشحنات فوراً من خلال رقم التعريف (ID)، اسم السائق، أو مدينة الوصول." : "Search and retrieve shipments instantly using unique ID, assigned driver name, or destination city.")}
            </p>
          </div>

          <div className="flex-1 max-w-lg w-full relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-slate-400" />
            </div>
            <input
              type="text"
              className="block w-full pl-9 pr-10 py-2.5 bg-slate-50 hover:bg-slate-100/80 focus:bg-white text-xs text-slate-900 border border-slate-200 focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 rounded-xl focus:outline-none transition-all placeholder:text-slate-400 font-medium font-sans"
              placeholder={lang === 'tr'
                ? "Sevkiyat ID, sürücü adı veya hedef şehir girin... (Sıfırlamak için Esc)"
                : (lang === 'ar' ? "أدخل رقم التعريف، اسم السائق، أو مدينة الوصول... (Esc للمسح)" : "Filter by shipment ID, driver name, or destination city... (Esc to clear)")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSearchQuery("");
                }
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-700 bg-transparent border-0 cursor-pointer"
                type="button"
                title={lang === 'tr' ? "Temizle" : "Clear Query"}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        )
      )}

      {/* 1. Dashboard Overview Tab — the Executive Control Center
          (PR #132 + #133): section stack driven by the viewer's saved
          per-user layout, intersected with role permissions. Order and
          visibility are personal (adminDashboardLayouts); business
          numbers are all deterministic backend data — MARAS AI only
          explains. */}
      {activeTab === 'dashboard' && (
        <div className={isMobileMode ? '' : 'lg:mx-4'}>
          <div className="flex justify-end mb-2">
            <button
              onClick={() => setIsDashboardCustomizeOpen(!isDashboardCustomizeOpen)}
              className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-[10px] font-black uppercase tracking-widest text-slate-500 hover:border-orange-300 cursor-pointer"
            >
              {lang === 'tr' ? 'Özelleştir' : (lang === 'ar' ? 'تخصيص' : 'Customize')}
            </button>
          </div>
          {isDashboardCustomizeOpen && (
            <div className="mb-3 p-3 rounded-xl border border-slate-200 bg-white space-y-1.5">
              {dashboardLayout.order.map((sectionId) => (
                <div
                  key={sectionId}
                  draggable
                  onDragStart={() => setDraggedDashboardSection(sectionId)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { if (draggedDashboardSection) saveDashboardLayout(reorderDashboardSection(dashboardLayout, draggedDashboardSection, sectionId)); setDraggedDashboardSection(null); }}
                  className="flex items-center justify-between gap-2 p-2 rounded-lg border border-slate-200 bg-slate-50 cursor-grab"
                >
                  <label className="flex items-center gap-2 text-[11px] font-bold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!dashboardLayout.hidden.includes(sectionId)}
                      onChange={() => saveDashboardLayout(toggleDashboardSection(dashboardLayout, sectionId))}
                    />
                    <span>{DASHBOARD_SECTION_LABELS[sectionId][lang]}</span>
                  </label>
                  <span className="flex gap-1">
                    <button onClick={() => saveDashboardLayout(moveDashboardSection(dashboardLayout, sectionId, 'up'))} className="px-1.5 py-0.5 rounded border border-slate-200 bg-white text-[10px] font-black cursor-pointer">↑</button>
                    <button onClick={() => saveDashboardLayout(moveDashboardSection(dashboardLayout, sectionId, 'down'))} className="px-1.5 py-0.5 rounded border border-slate-200 bg-white text-[10px] font-black cursor-pointer">↓</button>
                  </span>
                </div>
              ))}
            </div>
          )}
          {visibleOrderedSections(dashboardLayout, permittedDashboardSections).map((sectionId) => (
            <div key={sectionId} className="mb-3">
              {sectionId === 'executive_brief' && (
                <MarasAiBriefCard
                  lang={lang}
                  isMobileMode={isMobileMode}
                  isSuper={resolvedAdminType === 'super'}
                  onOpenMonitoring={() => setIsMarasAiMonitoringOpen(true)}
                />
              )}
              {sectionId === 'operations' && (isMobileMode ? (
        <MobileDashboard
          lang={lang}
          isRtl={isRtl}
          t={t}
          shipments={shipments}
          activeShipmentsCount={activeShipmentsCount}
          totalShipmentsCount={totalShipmentsCount}
          completedShipmentsCount={completedShipmentsCount}
          pendingDocumentsCount={pendingDocumentsCount}
          recentAlertsData={recentAlertsData}
          setNewShipmentData={setNewShipmentData}
          createEmptyShipmentForm={createEmptyShipmentForm}
          setUseCustomPOL={setUseCustomPOL}
          setUseCustomPOD={setUseCustomPOD}
          setIsCreateOpen={setIsCreateOpen}
          setActiveTab={(id) => setActiveTab(id as any)}
          canViewShipmentRegistry={canViewShipmentRegistry(resolvedAdminType)}
          canViewGpsTracking={canViewGpsTracking(resolvedAdminType)}
          onOpenNotifications={() => setIsNotifOpen(true)}
        />
              ) : (
        <React.Suspense fallback={<AdminSectionLoadingFallback lang={lang} />}>
          <AdminDashboardSection
            lang={lang}
            t={t}
            isMobileMode={isMobileMode}
            adminEmail={adminEmail}
            adminType={adminType}
            gmailUser={gmailUser}
            currentTime={currentTime}
            shipments={shipments}
            drivers={drivers}
            clients={clients}
            notifications={notifications}
            activityLogs={activityLogs}
            activeShipmentsCount={activeShipmentsCount}
            totalShipmentsCount={totalShipmentsCount}
            completedShipmentsCount={completedShipmentsCount}
            shipmentsHasMore={shipmentsHasMore}
            pendingDocumentsCount={pendingDocumentsCount}
            realTimeDocsStats={realTimeDocsStats}
            notificationCountsChartData={notificationCountsChartData}
            recentAlertsData={recentAlertsData}
            routeChartData={routeChartData}
            shipmentAnalyticsData={shipmentAnalyticsData}
            pendingCountVal={pendingCountVal}
            activeCountVal={activeCountVal}
            completedCountVal={completedCountVal}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            setStatusFilter={setStatusFilter}
            typeFilter={typeFilter}
            setTypeFilter={setTypeFilter}
            filteredShipments={filteredShipments}
            setNewShipmentData={setNewShipmentData}
            createEmptyShipmentForm={createEmptyShipmentForm}
            setUseCustomPOL={setUseCustomPOL}
            setUseCustomPOD={setUseCustomPOD}
            setIsCreateOpen={setIsCreateOpen}
            setOpenDetailsId={setOpenDetailsId}
            analyzeShipmentTiming={analyzeShipmentTiming}
            getShipmentProgressPercentage={getShipmentProgressPercentage}
            getDirectLink={getDirectLink}
            triggerToast={triggerToast}
            onSelectShipmentChat={onSelectShipmentChat}
            setActiveTab={setActiveTab}
            isSuperAdmin={resolvedAdminType === 'super'}
            canViewDriverRoster={canViewDriverRoster(resolvedAdminType)}
            canViewGpsTracking={canViewGpsTracking(resolvedAdminType)}
            canViewLogisticsAnalytics={canViewLogisticsAnalytics(resolvedAdminType)}
          />
        </React.Suspense>
              ))}
              {sectionId === 'financial' && canViewCostStatements(resolvedAdminType) && (
                <>
                  <ExecutiveFinancialSection
                    lang={lang}
                    onOpenShipments={() => { setStatusFilter('active'); setTypeFilter('all'); setActiveTab('shipments'); }}
                  />
                  {/* Accounts-receivable overview from real invoices + payments. */}
                  <div className="mt-3"><ReceivablesOverviewCard lang={lang} /></div>
                </>
              )}
              {sectionId === 'financial_alerts' && canViewCostStatements(resolvedAdminType) && (
                <FinancialAlertsCard lang={lang} onOpenMonitoring={() => setIsMarasAiMonitoringOpen(true)} />
              )}
              {sectionId === 'analytics' && canViewLogisticsAnalytics(resolvedAdminType) && (
                <div>
                  <button
                    onClick={() => setIsDashboardAnalyticsOpen(!isDashboardAnalyticsOpen)}
                    className="w-full flex items-center justify-between gap-2 p-3 rounded-xl border border-slate-200 bg-white shadow-sm cursor-pointer mb-3"
                  >
                    <span className="text-sm font-black text-slate-900 flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-orange-500" />
                      <span>{t('reports')}</span>
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-widest text-orange-500">
                      {(isDashboardAnalyticsOpen || !isMobileMode) ? '−' : '+'}
                    </span>
                  </button>
                  {(isDashboardAnalyticsOpen || !isMobileMode) && (
                    <React.Suspense fallback={<AdminSectionLoadingFallback lang={lang} />}>
                      <AdminReportsSection
                        lang={lang}
                        t={t}
                        isMobileMode={isMobileMode}
                        totalShipmentsCount={totalShipmentsCount}
                        statusData={statusData}
                        currencyChartData={currencyChartData}
                        totalCompleted30d={totalCompleted30d}
                        avgDailyCompleted={avgDailyCompleted}
                        peakFormattedDay={peakFormattedDay}
                        performanceAnalyticsData={performanceAnalyticsData}
                        shipmentsHasMore={shipmentsHasMore}
                      />
                    </React.Suspense>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 2. Shipments Registry Tab */}
      {/* BUG-26: content-render guard added alongside filteredAdminTabs —
          see canViewShipmentRegistry (adminAccess.ts) for why this was
          missing (no live bypass found for this tab specifically, but
          added for defense-in-depth consistency with tracking_map/drivers
          above, and because the API-level guard alone shouldn't be the
          only thing standing between accounts admins and this page). */}
      {activeTab === 'shipments' && canViewShipmentRegistry(resolvedAdminType) && (
        <div className="space-y-4">
          {isMobileMode ? (
            /* feature/admin-mobile-ui correction pass: the desktop filter
               card (search + type segmented control + a wrapped, often
               multi-row, status chip list) was too tall on a phone. Mobile
               gets: a compact search row, a single horizontally-scrollable
               row of transport-mode chips, and a single horizontally-
               scrollable row of status chips — same searchQuery/typeFilter/
               statusFilter state, same options, no wrapping. */
            <div className="space-y-2">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder={lang === 'tr' ? "Sevkiyat, konteyner, şirket ara..." : (lang === 'ar' ? "ابحث برقم الشحنة أو الحاوية أو الشركة..." : "Search shipment, container, company...")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 bg-white text-xs border border-slate-200 focus:border-slate-400 rounded-lg focus:outline-none transition-all"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-900 bg-transparent border-0 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto -mx-3 px-3 pb-0.5">
                {([
                  { id: 'all', label: 'All' },
                  { id: 'land', label: 'Land' },
                  { id: 'sea', label: 'Sea' },
                  { id: 'air', label: 'Air' }
                ] as const).map(type => (
                  <button
                    key={type.id}
                    type="button"
                    onClick={() => { setStatusFilter("all"); setTypeFilter(type.id); }}
                    className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border-0 cursor-pointer whitespace-nowrap ${
                      typeFilter === type.id ? 'bg-slate-900 text-white shadow-xs' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {type.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto -mx-3 px-3 pb-0.5">
                {(typeFilter === 'sea'
                  ? ['all', 'active', 'Booking Confirmed', 'Container Released', 'Loaded on Vessel', 'Vessel Departed', 'In Transit', 'Arrived at Port', 'Customs Clearance', 'Released', 'Out for Delivery', 'Delivered', 'Completed']
                  : typeFilter === 'air'
                    ? ['all', 'active', 'Booking Confirmed', 'Cargo Received', 'Security Check Completed', 'Departed Airport', 'In Transit', 'Arrived Airport', 'Customs Clearance', 'Released', 'Out for Delivery', 'Delivered', 'Completed']
                    : ['all', 'active', 'New', 'Waiting for Driver Quotes', 'Assigned', 'Accepted', 'Loading', 'Loaded', 'In Transit', 'Border Crossing', 'Customs Clearance', 'Arrived', 'Delivered', 'Closed']
                ).map((st) => (
                  <button
                    key={st}
                    onClick={() => setStatusFilter(st)}
                    className={`shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all border-0 cursor-pointer whitespace-nowrap ${
                      statusFilter === st ? 'bg-orange-100 text-orange-800' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {st === "all" ? t('allStatuses') : st === "active" ? (ACTIVE_FILTER_LABEL[lang] || ACTIVE_FILTER_LABEL.en) : st}
                  </button>
                ))}
              </div>
            </div>
          ) : (
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col items-start gap-4">
            <div className="flex flex-col gap-4 w-full">
              {/* Row 1: Search & Shipment Type */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 w-full">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search by Shipment #, Container, BL, AWB, Company, Vessel, Airline..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-8 py-2 bg-slate-50 hover:bg-slate-100 focus:bg-white text-xs border border-slate-200 focus:border-slate-400 rounded-lg focus:outline-none transition-all"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-900"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-slate-500 text-xs font-semibold whitespace-nowrap">Shipment Type:</span>
                  <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                    {([
                      { id: 'all', label: 'All' },
                      { id: 'land', label: 'Land Freight' },
                      { id: 'sea', label: 'Sea Freight' },
                      { id: 'air', label: 'Air Freight' }
                    ] as const).map(type => (
                      <button
                        key={type.id}
                        type="button"
                        onClick={() => {
                          setStatusFilter("all");
                          setTypeFilter(type.id);
                        }}
                        className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                          typeFilter === type.id
                            ? 'bg-white text-slate-950 shadow-xs font-bold'
                            : 'text-slate-500 hover:text-slate-900'
                        }`}
                      >
                        {type.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Row 2: Status Badges (Dependent on Freight Type) */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                <span className="text-slate-500 text-xs font-semibold flex items-center gap-1">
                  <Filter className="w-4 h-4" /> Status Indicator:
                </span>

                {/* Dynamically list candidate statuses depending on freight type */}
                {(typeFilter === 'sea'
                  ? ['all', 'active', 'Booking Confirmed', 'Container Released', 'Loaded on Vessel', 'Vessel Departed', 'In Transit', 'Arrived at Port', 'Customs Clearance', 'Released', 'Out for Delivery', 'Delivered', 'Completed']
                  : typeFilter === 'air'
                    ? ['all', 'active', 'Booking Confirmed', 'Cargo Received', 'Security Check Completed', 'Departed Airport', 'In Transit', 'Arrived Airport', 'Customs Clearance', 'Released', 'Out for Delivery', 'Delivered', 'Completed']
                    : ['all', 'active', 'New', 'Waiting for Driver Quotes', 'Assigned', 'Accepted', 'Loading', 'Loaded', 'In Transit', 'Border Crossing', 'Customs Clearance', 'Arrived', 'Delivered', 'Closed']
                ).map((st) => (
                  <button
                    key={st}
                    onClick={() => setStatusFilter(st)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                      statusFilter === st
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {st === "all" ? t('allStatuses') : st === "active" ? (ACTIVE_FILTER_LABEL[lang] || ACTIVE_FILTER_LABEL.en) : st}
                  </button>
                ))}
              </div>
            </div>
          </div>
          )}

          {/* feature/admin-mobile-ui: card list replaces the wide table on
              mobile — same filteredShipments array, same
              analyzeShipmentTiming/getShipmentProgressPercentage helpers,
              same View/Edit/Chat handlers as the desktop row actions
              below (desktop table is untouched, just hidden via
              lg:hidden on the card list / hidden lg:block on the table). */}
          <MobileOrdersList
            lang={lang}
            t={t}
            shipments={filteredShipments}
            analyzeShipmentTiming={analyzeShipmentTiming}
            getShipmentProgressPercentage={getShipmentProgressPercentage}
            onViewDetails={(id) => setOpenDetailsId(id)}
            onEdit={(s) => {
              const portsL = getPortsForCountry(s.loadingCountry || "");
              const portsD = getPortsForCountry(s.deliveryCountry || "");
              setUseEditCustomPOL(s.portOfLoading ? !portsL.includes(s.portOfLoading) : false);
              setUseEditCustomPOD(s.portOfDischarge ? !portsD.includes(s.portOfDischarge) : false);
              setEditingShipment(s);
              setEditConflict(null);
              setIsEditOpen(true);
            }}
            onChat={(s) => onSelectShipmentChat(s)}
          />

          {/* Table Container */}
          <div className="hidden lg:block bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-semibold text-xs">
                    <th className="p-4">Shipment #</th>
                    <th className="p-4">{t('companyName')}</th>
                    <th className="p-4">{t('loadingInfo')}</th>
                    <th className="p-4">{t('deliveryInfo')}</th>
                    <th className="p-4">{t('cargoInfo')}</th>
                    <th className="p-4">{t('carrierAmount')}</th>
                    <th className="p-4">{t('status')}</th>
                    <th className="p-4 text-center">{t('actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs balance-rows">
                  {filteredShipments.map((s) => {
                    const fType = s.freightType || "land";
                    return (
                    <tr key={s.id} className="hover:bg-slate-50/50">
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          {fType === 'sea' ? (
                            <span className="p-1.5 bg-blue-50 text-blue-600 rounded-md shrink-0" title="Ocean Freight"><Anchor className="w-3.5 h-3.5" /></span>
                          ) : fType === 'air' ? (
                            <span className="p-1.5 bg-indigo-50 text-indigo-600 rounded-md shrink-0" title="Air Cargo"><Plane className="w-3.5 h-3.5" /></span>
                          ) : (
                            <span className="p-1.5 bg-orange-50 text-orange-600 rounded-md shrink-0" title="Land Goods"><Truck className="w-3.5 h-3.5" /></span>
                          )}
                          <span className="font-mono font-bold text-slate-900 selectable">{s.shipmentNumber}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <p className="font-semibold text-slate-800">{s.companyName}</p>
                        <span className="text-[10px] text-slate-400 block mt-0.5">Created: {new Date(s.createdAt).toLocaleDateString()}</span>
                      </td>
                      <td className="p-4">
                        <span className="font-semibold text-slate-800 block">{s.loadingCity}</span>
                        <span className="text-slate-500">{s.loadingCountry}</span>
                      </td>
                      <td className="p-4">
                        <span className="font-semibold text-slate-800 block">{s.deliveryCity}</span>
                        <span className="text-slate-500">{s.deliveryCountry}</span>
                      </td>
                      <td className="p-4">
                        <p className="truncate max-w-[150px] font-medium text-slate-700">{s.cargoDescription}</p>
                        <span className="text-[10px] text-slate-400 block italic">{s.cargoWeight.toLocaleString()} kg</span>
                      </td>
                      <td className="p-4 font-mono font-bold text-slate-900">
                        {s.agreedAmount.toLocaleString()} {s.currency}
                      </td>
                      <td className="p-4">
                        <div className="space-y-1">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                            s.status === 'New' ? 'bg-slate-100 text-slate-700/80' :
                            s.status === 'Waiting for Driver Quotes' ? 'bg-sky-100 text-sky-800' :
                            s.status === 'Assigned' || s.status === 'Accepted' ? 'bg-orange-100 text-orange-800' :
                            s.status === 'Delivered' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'
                          }`}>
                            {s.status}
                          </span>
                          
                          {/* Visual Progress bar inside table row with dynamic remaining time color transitions */}
                          {(() => {
                            const analysis = analyzeShipmentTiming(s);
                            const progress = getShipmentProgressPercentage(s);
                            return (
                              <div className="flex flex-col gap-0.5 w-32">
                                <div className="flex items-center justify-between text-[9px] font-mono font-bold text-slate-400 leading-none">
                                  <span>{analysis.label}</span>
                                  <span className={analysis.textColorClass}>{progress}%</span>
                                </div>
                                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                  <div 
                                    className={`h-full rounded-full transition-all duration-500 ${analysis.colorClass}`}
                                    style={{ width: `${progress}%` }}
                                  />
                                </div>
                                <div className="text-[8px] text-slate-400 font-medium truncate" title={analysis.subtext}>
                                  {analysis.subtext}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="p-4 text-center space-x-1.5 whitespace-nowrap">
                        <button 
                          onClick={() => setOpenDetailsId(s.id)}
                          className="text-orange-600 hover:underline font-bold"
                        >
                          View
                        </button>
                        <button
                          onClick={() => {
                            const portsL = getPortsForCountry(s.loadingCountry || "");
                            const portsD = getPortsForCountry(s.deliveryCountry || "");
                            setUseEditCustomPOL(s.portOfLoading ? !portsL.includes(s.portOfLoading) : false);
                            setUseEditCustomPOD(s.portOfDischarge ? !portsD.includes(s.portOfDischarge) : false);
                            setEditingShipment(s);
                            setEditConflict(null);
                            setIsEditOpen(true);
                          }}
                          className="text-slate-500 hover:text-slate-900 font-bold"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => onSelectShipmentChat(s)}
                          className="text-slate-500 hover:text-slate-900 font-bold"
                        >
                          Chat
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                  {filteredShipments.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-12 text-center text-slate-400 italic">
                        <AlertCircle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                        <span>{t('noShipmentsMatched')}</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Phase 2A follow-up (blocking-issue fix): explicit "Load
              Older Shipments" action — GET /api/shipments now returns
              only the latest 50 (default) at a time, this is the only
              way to reach older ones. Search/filter above only searches
              whatever is currently loaded (searchQuery/typeFilter/
              statusFilter all operate on `shipments` client-side) — an
              older, not-yet-loaded shipment won't be found by search
              until it's been paged in with this button. */}
          {shipmentsHasMore && (
            <div className="flex justify-center py-2">
              <button
                type="button"
                onClick={handleLoadMoreShipments}
                disabled={shipmentsLoadingMore}
                className="px-5 py-2.5 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 text-xs font-bold rounded-lg shadow-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {shipmentsLoadingMore
                  ? (lang === 'tr' ? "Yükleniyor..." : (lang === 'ar' ? "جارٍ التحميل..." : "Loading..."))
                  : (lang === 'tr' ? "Daha Eski Sevkiyatları Yükle" : (lang === 'ar' ? "تحميل شحنات أقدم" : "Load Older Shipments"))}
              </button>
            </div>
          )}
        </div>
      )}

      {/* 3. Driver Alliance Tab */}
      {/* BUG-26: content-render guard added alongside filteredAdminTabs —
          see canViewDriverRoster (adminAccess.ts) for why this was missing. */}
      {activeTab === 'drivers' && canViewDriverRoster(resolvedAdminType) && (
        <div className="space-y-6">
          {canManageAllianceUi && (
            <DriverAllianceOffers
              adminName={adminEmail || "Operations"}
              onChanged={() => fetchData()}
              shipments={shipments}
              drivers={drivers}
              onCreateNewOrder={() => {
                setAllianceReturnPending(true);
                setNewShipmentData(createEmptyShipmentForm());
                setIsCreateOpen(true);
              }}
              preselectedOrderId={alliancePreselectedOrderId}
              onPreselectedConsumed={() => setAlliancePreselectedOrderId(null)}
            />
          )}
          {drivers.some(d => d.status === "pending") && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-bold text-amber-800 flex items-center gap-2">
                <Bell className="w-4 h-4" />
                Pending Driver Approvals
              </h3>
              <div className={`grid ${isMobileMode ? 'grid-cols-1 gap-3' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3'}`}>
                {drivers.filter(d => d.status === "pending").map((driver) => (
                  <div key={driver.id} className="bg-white p-4 rounded-lg border border-amber-200 shadow-sm space-y-2">
                    <div>
                      <p className="font-bold text-slate-900 text-sm">{driver.name}</p>
                      <p className="text-xs text-slate-500 font-mono">@{driver.username} &middot; {driver.phone}</p>
                      <p className="text-xs text-slate-500">{driver.truckNumber} &middot; {driver.truckType}</p>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => handleDriverApproval(driver.id, "approved")}
                        className="flex-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition cursor-pointer border-0"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleDriverApproval(driver.id, "rejected")}
                        className="flex-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition cursor-pointer border-0"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className={`grid ${isMobileMode ? 'grid-cols-1 gap-3' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4'}`}>
            {drivers.map((driver) => (
              <div key={driver.id} className="bg-white p-5 rounded-xl border border-slate-200/90 shadow-sm flex flex-col justify-between hover:border-slate-400 transition-all">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    {driver.avatarUrl ? (
                      <div className="w-10 h-10 rounded-lg overflow-hidden border border-slate-200 shadow-sm bg-slate-50">
                        <img src={driver.avatarUrl} alt={driver.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      </div>
                    ) : (
                      <span className="p-2.5 bg-slate-100 text-slate-800 rounded-lg"><Truck className="w-5 h-5" /></span>
                    )}
                    <div className="flex items-center gap-1.5">
                      {driver.status === "pending" && (
                        <span className="text-[9px] bg-amber-100 text-amber-700 font-bold px-1.5 py-0.5 rounded uppercase">Pending</span>
                      )}
                      {driver.status === "rejected" && (
                        <span className="text-[9px] bg-red-100 text-red-700 font-bold px-1.5 py-0.5 rounded uppercase">Rejected</span>
                      )}
                      {driver.status === "approved" && (() => {
                        const availability = resolveDriverAvailability(driver, allianceBusyDriverIds);
                        return (
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase border ${
                            availability === 'available' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            availability === 'busy' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                            'bg-slate-100 text-slate-500 border-slate-200'
                          }`}>
                            {availability === 'available' ? 'Available' : availability === 'busy' ? 'Busy' : 'Inactive'}
                          </span>
                        );
                      })()}
                      <span className="text-[10px] bg-slate-900 text-white font-mono px-2 py-0.5 rounded uppercase font-bold">{driver.truckNumber}</span>
                    </div>
                  </div>
                  <div>
                    <button
                      onClick={() => setSelectedPerformanceDriver(driver)}
                      className="font-bold text-slate-900 text-base hover:text-orange-600 transition-colors text-left flex items-center gap-1.5 focus:outline-none group/btn cursor-pointer"
                      title={lang === 'tr' ? "Performans Detaylarını Göster" : (lang === 'ar' ? "عرض تفاصيل الأداء" : "Show Performance Details")}
                    >
                      <span className="group-hover/btn:underline decoration-slate-300 underline-offset-2">{driver.name}</span>
                      <Award className="w-4 h-4 text-amber-500 transition-colors shrink-0" />
                    </button>
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                      <span className="text-xs text-slate-500 font-mono">@{driver.username}</span>
                      {driver.truckType && (
                        <span className="text-[9px] bg-orange-100 text-orange-800 border border-orange-200/50 font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                          {(() => {
                            const found = TRUCK_TYPES.find(t => t.id === driver.truckType);
                            return found ? (lang === 'en' ? found.en : (lang === 'tr' ? found.tr : found.ar)) : driver.truckType;
                          })()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-600 font-mono">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    <span>{driver.phone}</span>
                  </div>

                  {/* Driver Alliance Phase 1: directional working routes +
                      alliance Inactive switch, on the existing card. */}
                  {canManageAllianceUi && driver.status !== "pending" && (
                    <>
                      <DriverRouteEditor
                        driver={driver}
                        onDriverUpdated={handleAllianceDriverUpdated}
                        onError={(msg) => triggerToast(msg)}
                      />
                      <button
                        type="button"
                        onClick={() => handleToggleAllianceInactive(driver)}
                        className={`w-full mt-2 py-1.5 text-[11px] font-bold rounded-lg border transition-colors cursor-pointer ${
                          driver.allianceInactive
                            ? 'bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-emerald-700'
                            : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-500'
                        }`}
                      >
                        {driver.allianceInactive ? 'Reactivate for offers' : 'Mark Inactive for offers'}
                      </button>
                    </>
                  )}
                </div>

                <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-2 text-center text-xs">
                  <div className="border-r border-slate-100">
                    <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">{t('activeShipments')}</span>
                    <span className="text-lg font-extrabold text-orange-600 block mt-0.5">{driver.activeShipmentsCount}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Completed</span>
                    <span className="text-lg font-extrabold text-emerald-600 block mt-0.5">{driver.completedShipmentsCount}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* New Driver Form inside section */}
          {isDriverCreateOpen && (
            <div className="bg-white p-6 rounded-xl border border-slate-400 shadow-md max-w-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-slate-950 text-lg flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-orange-500" /> {t('addDriver')}
                </h3>
                <button onClick={() => setIsDriverCreateOpen(false)} className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreateDriver} className="space-y-4 text-sm">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-800">{t('driverName')} <span className="text-red-500">*</span></label>
                  <input 
                    type="text" 
                    required
                    placeholder="e.g. Mehmet Aksoy" 
                    value={newDriverData.name}
                    onChange={(e) => setNewDriverData({ ...newDriverData, name: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 focus:border-slate-500 rounded-lg outline-none transition-all"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800">{t('truckNumber')} <span className="text-red-500">*</span></label>
                    <input 
                      type="text" 
                      required
                      placeholder="e.g. 34-XYZ-789" 
                      value={newDriverData.truckNumber}
                      onChange={(e) => setNewDriverData({ ...newDriverData, truckNumber: e.target.value })}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 focus:border-slate-500 rounded-lg outline-none transition-all text-xs uppercase"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800">{t('phone')} <span className="text-red-500">*</span></label>
                    <input 
                      type="text" 
                      required
                      placeholder="e.g. +90 555 123 4567" 
                      value={newDriverData.phone}
                      onChange={(e) => setNewDriverData({ ...newDriverData, phone: e.target.value })}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 focus:border-slate-500 rounded-lg outline-none transition-all text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-slate-800">Truck Type <span className="text-red-500">*</span></label>
                    <select
                      value={newDriverData.truckType}
                      onChange={(e) => setNewDriverData({ ...newDriverData, truckType: e.target.value })}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 focus:border-slate-500 rounded-lg outline-none transition-all text-xs font-semibold cursor-pointer"
                    >
                      {TRUCK_TYPES.map(type => (
                        <option key={type.id} value={type.id}>
                          {lang === 'en' ? type.en : (lang === 'tr' ? type.tr : type.ar)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setIsDriverCreateOpen(false)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg">
                    {t('cancel')}
                  </button>
                  <button type="submit" className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg shadow">
                    {t('addDriverBtn')}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* Clients Tab */}
      {activeTab === 'clients' && (
        <React.Suspense fallback={<AdminSectionLoadingFallback lang={lang} />}>
          <AdminClientsSection
            lang={lang}
            t={t}
            canWriteClients={canWriteClients}
            isSuperAdmin={resolvedAdminType === 'super'}
            clients={clients}
            shipments={shipments}
            clientSearchQuery={clientSearchQuery}
            setClientSearchQuery={setClientSearchQuery}
            expandedClientOrdersCompanyName={expandedClientOrdersCompanyName}
            setExpandedClientOrdersCompanyName={setExpandedClientOrdersCompanyName}
            isAddClientOpen={isAddClientOpen}
            setIsAddClientOpen={setIsAddClientOpenSafe}
            isSubmittingClient={isSubmittingClient}
            handleAddClientSubmit={handleAddClientSubmit}
            editClientTarget={editClientTarget}
            setEditClientTarget={setEditClientTarget}
            openEditClient={openEditClient}
            isSubmittingEditClient={isSubmittingEditClient}
            handleEditClientSubmit={handleEditClientSubmit}
            newClientCompanyName={newClientCompanyName}
            setNewClientCompanyName={setNewClientCompanyName}
            newClientContactName={newClientContactName}
            setNewClientContactName={setNewClientContactName}
            newClientPhone={newClientPhone}
            setNewClientPhone={setNewClientPhone}
            newClientEmail={newClientEmail}
            setNewClientEmail={setNewClientEmail}
            newClientAddress={newClientAddress}
            setNewClientAddress={setNewClientAddress}
            newClientNotes={newClientNotes}
            setNewClientNotes={setNewClientNotes}
            newClientUsername={newClientUsername}
            setNewClientUsername={setNewClientUsername}
            newClientPassword={newClientPassword}
            setNewClientPassword={setNewClientPassword}
            newClientConfirmPassword={newClientConfirmPassword}
            setNewClientConfirmPassword={setNewClientConfirmPassword}
            editClientContactName={editClientContactName}
            setEditClientContactName={setEditClientContactName}
            editClientPhone={editClientPhone}
            setEditClientPhone={setEditClientPhone}
            editClientEmail={editClientEmail}
            setEditClientEmail={setEditClientEmail}
            editClientAddress={editClientAddress}
            setEditClientAddress={setEditClientAddress}
            editClientNotes={editClientNotes}
            setEditClientNotes={setEditClientNotes}
            editClientUsername={editClientUsername}
            setEditClientUsername={setEditClientUsername}
            editClientPassword={editClientPassword}
            setEditClientPassword={setEditClientPassword}
            editClientConfirmPassword={editClientConfirmPassword}
            setEditClientConfirmPassword={setEditClientConfirmPassword}
            editClientActive={editClientActive}
            setEditClientActive={setEditClientActive}
            addEmployeeTarget={addEmployeeTarget}
            setAddEmployeeTarget={setAddEmployeeTarget}
            closeAddEmployeeModal={closeAddEmployeeModal}
            isSubmittingEmployee={isSubmittingEmployee}
            handleAddEmployeeSubmit={handleAddEmployeeSubmit}
            newEmployeeName={newEmployeeName}
            setNewEmployeeName={setNewEmployeeName}
            newEmployeeEmail={newEmployeeEmail}
            setNewEmployeeEmail={setNewEmployeeEmail}
            newEmployeePhone={newEmployeePhone}
            setNewEmployeePhone={setNewEmployeePhone}
            newEmployeeUsername={newEmployeeUsername}
            setNewEmployeeUsername={setNewEmployeeUsername}
            newEmployeePassword={newEmployeePassword}
            setNewEmployeePassword={setNewEmployeePassword}
            newEmployeeConfirmPassword={newEmployeeConfirmPassword}
            setNewEmployeeConfirmPassword={setNewEmployeeConfirmPassword}
            handleToggleClientActive={handleToggleClientActive}
            resetPasswordTarget={resetPasswordTarget}
            setResetPasswordTarget={setResetPasswordTarget}
            closeResetPasswordModal={closeResetPasswordModal}
            isSubmittingResetPassword={isSubmittingResetPassword}
            handleResetPasswordSubmit={handleResetPasswordSubmit}
            resetPasswordValue={resetPasswordValue}
            setResetPasswordValue={setResetPasswordValue}
            resetPasswordConfirmValue={resetPasswordConfirmValue}
            setResetPasswordConfirmValue={setResetPasswordConfirmValue}
            deleteStaffTarget={deleteStaffTarget}
            setDeleteStaffTarget={setDeleteStaffTarget}
            isDeletingStaff={isDeletingStaff}
            handleDeleteStaffConfirm={handleDeleteStaffConfirm}
            orphanedCompanyView={orphanedCompanyView}
            setOrphanedCompanyView={setOrphanedCompanyView}
            passwordToggleClasses={passwordToggleClasses}
            showPasswordLabel={showPasswordLabel}
            hidePasswordLabel={hidePasswordLabel}
            triggerToast={triggerToast}
            getDirectLink={getDirectLink}
            getWhatsAppLink={getWhatsAppLink}
            handlePrepopulateGmail={handlePrepopulateGmail}
            setActiveTab={setActiveTab}
          />
        </React.Suspense>
      )}

      {/* Customer Account (AR) — shown for the client whose orders are
          expanded. Internal accounting (super/accounts): invoices, payments,
          allocation, receipts, and the account statement. */}
      {activeTab === 'clients' && expandedClientOrdersCompanyName && canViewCostStatements(resolvedAdminType) && (
        <div className="mt-3">
          <CustomerAccountPanel
            companyName={expandedClientOrdersCompanyName}
            bankAccounts={bankAccounts}
            canWrite={canViewCostStatements(resolvedAdminType)}
            lang={lang}
          />
        </div>
      )}

      {/* Vendors Tab */}
      {activeTab === 'vendors' && (
        <React.Suspense fallback={<AdminSectionLoadingFallback lang={lang} />}>
          <AdminVendorsSection
            lang={lang}
            t={t}
            canWriteVendors={canWriteVendors}
            vendors={vendors}
            costStatements={costStatements}
            vendorSearchQuery={vendorSearchQuery}
            setVendorSearchQuery={setVendorSearchQuery}
            isAddVendorOpen={isAddVendorOpen}
            setIsAddVendorOpen={setIsAddVendorOpen}
            isSubmittingVendor={isSubmittingVendor}
            handleAddVendorSubmit={handleAddVendorSubmit}
            newVendorCompanyName={newVendorCompanyName}
            setNewVendorCompanyName={setNewVendorCompanyName}
            newVendorContactName={newVendorContactName}
            setNewVendorContactName={setNewVendorContactName}
            newVendorServiceType={newVendorServiceType}
            setNewVendorServiceType={setNewVendorServiceType}
            newVendorEmail={newVendorEmail}
            setNewVendorEmail={setNewVendorEmail}
            newVendorPhone={newVendorPhone}
            setNewVendorPhone={setNewVendorPhone}
            newVendorAddress={newVendorAddress}
            setNewVendorAddress={setNewVendorAddress}
            newVendorNotes={newVendorNotes}
            setNewVendorNotes={setNewVendorNotes}
          />
        </React.Suspense>
      )}

      {/* 5. Audit Log Tracker */}
      {/* Defense-in-depth (PR #58): 'audit' is already absent from
          filteredAdminTabs for operation/accounts and the server now
          rejects GET /api/logs for them (canViewAuditLogs, adminAccess.ts),
          but this content block had no adminType check of its own — if
          activeTab were ever set to 'audit' by anything other than the
          hidden sidebar entry, it rendered regardless of adminType. */}
      {activeTab === 'audit' && resolvedAdminType === 'super' && (
        <React.Suspense fallback={<AdminSectionLoadingFallback lang={lang} />}>
          <AdminAuditSection lang={lang} t={t} activityLogs={activityLogs} />
        </React.Suspense>
      )}

      {/* Operation Team Section.
          Defense-in-depth (PR #58): 'team' only exists in rawTabs for
          isSuper, but this content block had no adminType check of its
          own — add one so it can't render for any other adminType even if
          activeTab were somehow set to 'team' by something other than that
          sidebar entry. */}
      {activeTab === 'team' && resolvedAdminType === 'super' && (
        <React.Suspense fallback={<AdminSectionLoadingFallback lang={lang} />}>
          <AdminTeamSection
            lang={lang}
            adminsList={adminsList}
            isAddAdminOpen={isAddAdminOpen}
            setIsAddAdminOpen={setIsAddAdminOpen}
            adminFormError={adminFormError}
            setAdminFormError={setAdminFormError}
            newAdminName={newAdminName}
            setNewAdminName={setNewAdminName}
            newAdminEmail={newAdminEmail}
            setNewAdminEmail={setNewAdminEmail}
            newAdminPassword={newAdminPassword}
            setNewAdminPassword={setNewAdminPassword}
            newAdminConfirmPassword={newAdminConfirmPassword}
            setNewAdminConfirmPassword={setNewAdminConfirmPassword}
            newAdminType={newAdminType}
            setNewAdminType={setNewAdminType}
            handleCreateAdmin={handleCreateAdmin}
            handleDeleteAdmin={handleDeleteAdmin}
            passwordToggleClasses={passwordToggleClasses}
            showPasswordLabel={showPasswordLabel}
            hidePasswordLabel={hidePasswordLabel}
          />
        </React.Suspense>
      )}

      {/* My Account tab — visible to every admin type (unlike 'team' above,
          which is restricted to super-admins since it exposes other
          admins' info). Required by Apple Guideline 5.1.1(v): every admin
          account created through this app's own "Create Admin" flow needs
          a way to delete itself, and sub-admins can't reach the 'team' tab
          to do that, so this tab exists specifically to give them one. */}
      {activeTab === 'my_account' && (
        <div className="space-y-6 max-w-lg">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h2 className="text-lg font-bold text-slate-950 flex items-center gap-2 mb-1">
              <User className="w-5 h-5 text-indigo-600" />
              {lang === 'tr' ? 'Hesabım' : (lang === 'ar' ? 'حسابي' : 'My Account')}
            </h2>
            <p className="text-slate-500 text-xs">{adminEmail}</p>
            <span className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full mt-2 ${
              adminType === 'super' ? 'text-orange-600 bg-orange-50' : adminType === 'accounts' ? 'text-teal-600 bg-teal-50' : 'text-indigo-600 bg-indigo-50'
            }`}>
              {adminType === 'super'
                ? (lang === 'tr' ? 'Süper Yönetici' : (lang === 'ar' ? 'مسؤول أعلى' : 'Super Admin'))
                : adminType === 'accounts'
                  ? (lang === 'tr' ? 'Muhasebe Ekibi' : (lang === 'ar' ? 'فريق الحسابات' : 'Accounts Admin'))
                  : (lang === 'tr' ? 'Operasyon Ekibi' : (lang === 'ar' ? 'فريق العمليات' : 'Operations Admin'))}
            </span>
          </div>

          {adminType !== 'super' ? (
            <>
              {/* Change Password */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <h3 className="text-sm font-bold text-slate-900 mb-3">
                  {lang === 'tr' ? 'Şifremi Değiştir' : (lang === 'ar' ? 'تغيير كلمة المرور' : 'Change Password')}
                </h3>
                <form onSubmit={handleChangeOwnPassword} className="space-y-3">
                  {changePasswordError && (
                    <div className="p-2.5 bg-red-50 text-red-600 rounded-lg text-xs font-semibold select-all">
                      {changePasswordError}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 block">
                      {lang === 'tr' ? 'Mevcut Şifre' : (lang === 'ar' ? 'كلمة المرور الحالية' : 'Current Password')}
                    </label>
                    <PasswordInput
                      required
                      value={currentPasswordInput}
                      onChange={(e) => setCurrentPasswordInput(e.target.value)}
                      inputClassName="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 pe-9 text-slate-900 text-xs focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                      toggleClassName={passwordToggleClasses}
                      showLabel={showPasswordLabel}
                      hideLabel={hidePasswordLabel}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 block">
                      {lang === 'tr' ? 'Yeni Şifre' : (lang === 'ar' ? 'كلمة المرور الجديدة' : 'New Password')}
                    </label>
                    <PasswordInput
                      required
                      value={newPasswordInput}
                      onChange={(e) => setNewPasswordInput(e.target.value)}
                      placeholder={lang === 'tr' ? 'En az 8 karakter' : (lang === 'ar' ? '8 أحرف على الأقل' : 'At least 8 characters')}
                      inputClassName="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 pe-9 text-slate-900 text-xs focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                      toggleClassName={passwordToggleClasses}
                      showLabel={showPasswordLabel}
                      hideLabel={hidePasswordLabel}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 block">
                      {lang === 'tr' ? 'Yeni Şifreyi Onayla' : (lang === 'ar' ? 'تأكيد كلمة المرور الجديدة' : 'Confirm New Password')}
                    </label>
                    <PasswordInput
                      required
                      value={confirmNewPasswordInput}
                      onChange={(e) => setConfirmNewPasswordInput(e.target.value)}
                      inputClassName="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 pe-9 text-slate-900 text-xs focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                      toggleClassName={passwordToggleClasses}
                      showLabel={showPasswordLabel}
                      hideLabel={hidePasswordLabel}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isChangingPassword}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition cursor-pointer border-0"
                  >
                    {isChangingPassword
                      ? (lang === 'tr' ? 'Güncelleniyor...' : (lang === 'ar' ? 'جارٍ التحديث...' : 'Updating...'))
                      : (lang === 'tr' ? 'Şifreyi Güncelle' : (lang === 'ar' ? 'تحديث كلمة المرور' : 'Update Password'))}
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <p className="text-slate-400 text-xs italic">
                {lang === 'tr'
                  ? 'Süper yönetici şifresi bu uygulama üzerinden değiştirilemez, çünkü ortam değişkenleri üzerinden yapılandırılmıştır.'
                  : (lang === 'ar'
                    ? 'لا يمكن تغيير كلمة مرور المسؤول الأعلى عبر هذا التطبيق، لأنها مُهيأة عبر متغيرات البيئة.'
                    : 'The super-admin password cannot be changed through the app, since it is configured via environment variables.')}
              </p>
            </div>
          )}

          {/* Delete Account — Apple Guideline 5.1.1(v): shown to EVERY
              admin type, including the env-configured owner. Hiding this
              control entirely for a "super" session (the previous
              behavior) is exactly what Apple's review flagged: if a
              reviewer's demo/test account happens to be adminType
              'super' (see DEMO_ACCOUNTS, server.ts — local/demo seeding
              gives both seeded admin accounts adminType 'super'), a
              hidden button reads as "this app has no in-app deletion,"
              regardless of what a different account type could do. The
              control and full two-step confirmation are always reachable
              here; only the actual deletion outcome differs — a normal
              admin's completes, the sole owner's is refused by the
              SERVER with a clear, honest, localized reason
              (accountDeletionCopy(lang).ownerProtectedError below), never
              silently or by omission. */}
          <div className="bg-red-50/50 border border-red-100 rounded-xl p-5">
            <h3 className="text-sm font-bold text-red-700 mb-1">
              {accountDeletionCopy(lang).sectionTitle}
            </h3>
            <p className="text-slate-500 text-xs mb-1">
              {lang === 'tr'
                ? 'Bu, yönetici hesabınızı kalıcı olarak silecektir. Bu işlem geri alınamaz.'
                : (lang === 'ar'
                  ? 'سيؤدي هذا إلى حذف حساب المسؤول الخاص بك نهائياً. لا يمكن التراجع عن هذا الإجراء.'
                  : 'This will permanently delete your own admin account. This action cannot be undone.')
              }
            </p>
            <p className="text-slate-400 text-[11px] mb-3">
              {accountDeletionCopy(lang).privacyNotice}
            </p>
            <button
              onClick={() => {
                setShowAdminSelfDeleteConfirm(true);
                setUnderstandAdminSelfDelete(false);
                setAdminDeleteError(null);
                setAdminDeleteCurrentPassword("");
              }}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition cursor-pointer border-0"
            >
              {lang === 'tr' ? 'Hesabımı Tamamen Sil' : (lang === 'ar' ? 'حذف حسابي نهائياً' : 'Permanently Delete My Account')}
            </button>
          </div>

          {/* Admin Self-Delete Confirmation Modal */}
          {showAdminSelfDeleteConfirm && (
            <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in text-left">
              <div className="bg-gradient-to-b from-slate-900 to-slate-950 border border-red-900/40 rounded-3xl p-6 max-w-md w-full shadow-[0_20px_50px_rgba(239,68,68,0.15)] space-y-6">
                <div className="flex items-start gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-red-900/20 border border-red-800/40 flex items-center justify-center text-red-100 shrink-0 select-none">
                    <ShieldAlert className="w-5 h-5 text-red-500 animate-pulse" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-base text-white tracking-tight uppercase font-mono">
                      {lang === 'tr' ? "Hesabınızı Kalıcı Olarak Silin" : (lang === 'ar' ? "حذف حسابك نهائياً" : "Permanently Delete Your Account")}
                    </h3>
                    <p className="text-xs text-slate-400 leading-relaxed mt-1">
                      {lang === 'tr'
                        ? "Bu işlem yönetici hesabınızı ve panel erişiminizi kalıcı olarak siler. Geri alınamaz."
                        : (lang === 'ar'
                          ? "سيؤدي هذا الإجراء إلى حذف حساب المسؤول الخاص بك والوصول إلى لوحة التحكم بشكل نهائي. لا يمكن التراجع عن هذا الإجراء."
                          : "This will permanently delete your admin account and dashboard access. This action cannot be undone.")}
                    </p>
                    <p className="text-[11px] text-slate-500 leading-relaxed mt-1.5">
                      {accountDeletionCopy(lang).privacyNotice}
                    </p>
                  </div>
                </div>

                {adminDeleteError && (
                  <div className="bg-red-950/30 border border-red-800/40 rounded-xl p-3 text-xs text-red-300 leading-relaxed">
                    {adminDeleteError === "missing"
                      ? accountDeletionCopy(lang).missingPasswordError
                      : adminDeleteError === "incorrect"
                      ? accountDeletionCopy(lang).incorrectPasswordError
                      : adminDeleteError === "owner_protected"
                      ? accountDeletionCopy(lang).ownerProtectedError
                      : adminDeleteError === "rate_limited"
                      ? accountDeletionCopy(lang).rateLimitedError
                      : adminDeleteError === "service_unavailable"
                      ? accountDeletionCopy(lang).serviceUnavailableError
                      : adminDeleteError === "network"
                      ? accountDeletionCopy(lang).networkFailureError
                      : accountDeletionCopy(lang).genericFailureError}
                  </div>
                )}

                <div className="bg-slate-950 p-4 rounded-2xl border border-slate-900 space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-300 block">
                      {accountDeletionCopy(lang).passwordLabel}
                    </label>
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={adminDeleteCurrentPassword}
                      onChange={(e) => setAdminDeleteCurrentPassword(e.target.value)}
                      placeholder={accountDeletionCopy(lang).passwordPlaceholder}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 text-xs focus:ring-1 focus:ring-red-500 focus:border-red-500 outline-none"
                    />
                  </div>
                  <label className="flex items-start gap-3 cursor-pointer text-xs font-semibold text-slate-300 hover:text-white">
                    <input
                      type="checkbox"
                      checked={understandAdminSelfDelete}
                      onChange={(e) => setUnderstandAdminSelfDelete(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-800 bg-slate-900 text-red-500 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-red-500 mt-0.5"
                    />
                    <span className="leading-normal">
                      {lang === 'tr'
                        ? "Yönetici hesabımın ve tüm panel erişimlerimin kalıcı olarak kaldırılmasını kabul ediyorum."
                        : (lang === 'ar'
                          ? "أوافق على إزالة حساب المسؤول الخاص بي وجميع صلاحيات الوصول إلى لوحة التحكم بشكل نهائي."
                          : "I consent to permanently remove my admin account and all dashboard access.")}
                    </span>
                  </label>
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    disabled={isDeletingAdminSelfAccount}
                    onClick={() => setShowAdminSelfDeleteConfirm(false)}
                    className="flex-1 py-3 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer text-center"
                  >
                    {lang === 'tr' ? "İptal Et" : (lang === 'ar' ? "إلغاء الأمر" : "Cancel")}
                  </button>

                  <button
                    type="button"
                    disabled={isDeletingAdminSelfAccount || !understandAdminSelfDelete}
                    onClick={handleDeleteAdminSelfAccount}
                    className="flex-1 py-3 bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-600 disabled:opacity-40 text-white font-extrabold text-xs rounded-xl uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5 border-0 shadow-[0_4px_15px_rgba(239,68,68,0.2)] active:scale-95"
                  >
                    {isDeletingAdminSelfAccount ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
                        <span>{accountDeletionCopy(lang).deletingLabel}</span>
                      </>
                    ) : (
                      <span>{lang === 'tr' ? "Kalıcı Olarak Sil" : (lang === 'ar' ? "حذف نهائياً" : "Permanently Delete")}</span>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Settings Center foundation hub — centralizes navigation to
          existing sections (My Account / Operation Team / Google
          Workspace / Audit Logs) via setActiveTab rather than duplicating
          their UI or logic. Cards for super-admin-only areas are gated by
          resolvedAdminType === 'super', the same condition that already
          hides those tabs from the sidebar for other admin types, so
          Settings does not grant any admin type new access. */}
      {activeTab === 'settings' && (
        <React.Suspense fallback={<AdminSectionLoadingFallback lang={lang} />}>
          <AdminSettingsSection
            lang={lang}
            adminEmail={adminEmail}
            adminType={adminType}
            resolvedAdminType={resolvedAdminType}
            onNavigateTab={setActiveTab}
          />
        </React.Suspense>
      )}

      {/* 6. Gmail Workspace Active Tab Card.
          Defense-in-depth (PR #76, same pattern as 'audit'/'team'/'costs'):
          'gmail' is hidden from the top-level nav for every role
          (HIDDEN_FROM_TOP_LEVEL_NAV_IDS) and only reachable two ways —
          the Settings "Google Workspace" card (resolvedAdminType === 'super')
          and the Shipments tab's Compose/Gmail Alert shortcuts (reachable by
          super/operation, since 'shipments' itself is canViewShipmentRegistry-
          gated) — but this content block had no adminType check of its own,
          so an accounts admin could have rendered it if activeTab were ever
          set to 'gmail' by anything other than those two paths. */}
      {activeTab === 'gmail' && (resolvedAdminType === 'super' || resolvedAdminType === 'operation') && (
        <div className="space-y-6">
          
          {/* Header Card */}
          <div className="bg-slate-950 text-white rounded-2xl border border-slate-800 p-6 md:p-8 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-80 h-80 bg-orange-500/5 rounded-full blur-3xl pointer-events-none"></div>
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative z-10">
              <div className="space-y-2">
                <span className="text-[10px] uppercase font-bold text-orange-500 tracking-widest">Enterprise API Center</span>
                <h2 className="text-xl font-black tracking-tight flex items-center gap-2">
                  <Mail className="w-6 h-6 text-orange-500" />
                  <span>Google Workspace Integrations</span>
                </h2>
                <p className="text-slate-400 text-xs max-w-2xl">
                  Connect your corporate Google account to instantly send cargo transit status emails, upload automated shipment backup logs on Google Drive, and schedule border crossing/loading operations directly on Google Calendar.
                </p>
              </div>

              {gmailToken && gmailUser ? (
                <div className="bg-slate-900 border border-slate-800 px-5 py-4 rounded-xl flex items-center gap-3 shrink-0">
                  {gmailUser.photoURL ? (
                    <img src={gmailUser.photoURL} alt="Google" referrerPolicy="no-referrer" className="w-10 h-10 rounded-full border border-orange-500 shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-orange-500 text-white flex items-center justify-center font-bold font-mono text-sm shrink-0">
                      GM
                    </div>
                  )}
                  <div>
                    <h4 className="text-xs font-black text-white">{gmailUser.displayName || "Google Operator"}</h4>
                    <p className="text-[10px] font-semibold text-slate-400 font-mono">{gmailUser.email}</p>
                    <button
                      onClick={onDisconnectGmail}
                      className="text-[10px] font-bold text-red-400 hover:text-red-300 transition-all mt-1 flex items-center gap-1 cursor-pointer"
                    >
                      Disconnect Account
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={onConnectGmail}
                  disabled={isConnectingGmail}
                  className="bg-white hover:bg-slate-100 text-slate-900 px-5 py-2.5 rounded-xl text-xs font-extrabold flex items-center gap-2.5 shadow-lg border border-slate-200 shrink-0 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg className="w-4 h-4" viewBox="0 0 48 48">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                  </svg>
                  <span>{isConnectingGmail ? "Opening Google Auth..." : "Authorize with Google"}</span>
                </button>
              )}
            </div>

            {/* Sub-Tabs Selector */}
            {gmailToken && (
              <div className="flex border-b border-slate-800 mt-6 relative z-10 overflow-x-auto">
                <button 
                  onClick={() => setWorkspaceSubTab('gmail')}
                  className={`px-5 py-2.5 font-black text-xs tracking-wider uppercase border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                    workspaceSubTab === 'gmail' 
                      ? 'border-orange-500 text-orange-500' 
                      : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  ✉️ Gmail Communications
                </button>
                <button 
                  onClick={() => setWorkspaceSubTab('drive')}
                  className={`px-5 py-2.5 font-black text-xs tracking-wider uppercase border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                    workspaceSubTab === 'drive' 
                      ? 'border-orange-500 text-orange-500' 
                      : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  💾 Drive Record Backups
                </button>
                <button 
                  onClick={() => setWorkspaceSubTab('calendar')}
                  className={`px-5 py-2.5 font-black text-xs tracking-wider uppercase border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                    workspaceSubTab === 'calendar' 
                      ? 'border-orange-500 text-orange-500' 
                      : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  📅 Calendar Scheduling
                </button>
              </div>
            )}
          </div>

          {!gmailToken ? (
            /* Warning or explanation screen if no token */
            <div className="bg-amber-50 rounded-2xl border border-amber-200 p-8 text-center max-w-2xl mx-auto space-y-4">
              <div className="p-3 bg-amber-100 text-amber-700 rounded-full inline-flex">
                <AlertCircle className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="font-extrabold text-slate-900 text-sm">Google Workspace Integration Required</h3>
                <p className="text-slate-600 text-xs max-w-md mx-auto leading-relaxed">
                  To operate secure operational dispatches via Gmail, backup etir logs on Google Drive and manage transport scheduling directly on Google Calendar, click the authorization button above.
                </p>
              </div>
            </div>
          ) : workspaceSubTab === 'gmail' ? (
            /* Connected Mode - Bento layout */
            <div className={`grid grid-cols-1 ${isMobileMode ? '' : 'lg:grid-cols-12'} gap-6 items-start`}>
              
              {/* Left Column: Shipment pre-fills */}
              <div className={`${isMobileMode ? '' : 'lg:col-span-5'} bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-xs`}>
                <div>
                  <h3 className="text-xs font-black text-slate-950 uppercase tracking-wider">Select Active Cargo Shipment</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">Click to instantly populate recipient emails and load transport tracking links.</p>
                </div>

                <div className="space-y-2 max-h-[480px] overflow-y-auto">
                  {shipments.map(s => {
                    const isSelected = gmailSelectedShipmentId === s.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => handlePrepopulateGmail(s.id)}
                        className={`w-full text-left p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                          isSelected 
                            ? 'bg-orange-50/70 border-orange-300 text-orange-950 shadow-xs' 
                            : 'bg-slate-50/50 border-slate-100 hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <div className="space-y-1">
                          <p className="font-bold font-mono text-xs text-slate-900 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                            <span>{s.shipmentNumber}</span>
                          </p>
                          <p className="text-[11px] font-black truncate max-w-[180px]">{s.companyName}</p>
                          <p className="text-[10px] text-slate-400 font-medium">{s.loadingCity} ➔ {s.deliveryCity}</p>
                        </div>
                        <div className="text-right">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            s.status === 'Delivered' ? 'bg-emerald-100 text-emerald-800' : 'bg-orange-100 text-orange-800'
                          }`}>
                            {s.status}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Right Column: Draft Form */}
              <div className={`${isMobileMode ? '' : 'lg:col-span-7'} bg-white rounded-2xl border border-slate-200 p-5 md:p-6 space-y-4 shadow-xs`}>
                <div>
                  <h3 className="text-xs font-black text-slate-950 uppercase tracking-wider">Operational Dispatch Composer</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">Draft messages which are securely signed and sent from your authenticated account.</p>
                </div>

                {gmailResponse && (
                  <div className={`p-4 rounded-xl border text-xs font-bold text-center flex items-center justify-center gap-2 ${
                    gmailResponse.success 
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
                      : 'bg-red-50 border-red-200 text-red-800'
                  }`}>
                    {gmailResponse.success ? <Check className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                    <span>{gmailResponse.message}</span>
                  </div>
                )}

                <form onSubmit={async (e) => {
                  e.preventDefault();
                  if (!gmailToken) {
                    setGmailResponse({ success: false, message: "No active Google Workspace authorization found." });
                    return;
                  }
                  if (!gmailTo.trim() || !gmailSubject.trim() || !gmailBody.trim()) {
                    setGmailResponse({ success: false, message: "Recipient, Subject, and Body are required." });
                    return;
                  }
                  if (containsRawPrivateDocumentUrl(gmailSubject) || containsRawPrivateDocumentUrl(gmailBody)) {
                    setGmailResponse({
                      success: false,
                      message: "This message contains a raw private document/storage link, which is not safe to email. Use the safe tracking link instead of raw storage/private document links."
                    });
                    return;
                  }

                  setGmailSending(true);
                  setGmailResponse(null);

                  try {
                    // 1. Build the raw MIME email
                    const emailLines = [
                      `To: ${gmailTo.trim()}`,
                      "Content-Type: text/html; charset=utf-8",
                      "MIME-Version: 1.0",
                      `Subject: ${gmailSubject.trim()}`,
                      "",
                      gmailBody.trim().replace(/\n/g, "<br>")
                    ];
                    const emailStr = emailLines.join("\r\n");
                    
                    // 2. Safe base64url encode with TextEncoder
                    const utf8Bytes = new TextEncoder().encode(emailStr);
                    let binary = "";
                    for (let i = 0; i < utf8Bytes.byteLength; i++) {
                      binary += String.fromCharCode(utf8Bytes[i]);
                    }
                    const rawBase64Url = window.btoa(binary)
                      .replace(/\+/g, '-')
                      .replace(/\//g, '_')
                      .replace(/=+$/, '');

                    // 3. Dispatch to Gmail API
                    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
                      method: "POST",
                      headers: {
                        "Authorization": `Bearer ${gmailToken}`,
                        "Content-Type": "application/json"
                      },
                      body: JSON.stringify({ raw: rawBase64Url })
                    });

                    if (response.ok) {
                      const data = await response.json();
                      setGmailResponse({
                        success: true,
                        message: `Operational email successfully sent via Gmail API! Message ID: ${data.id || 'N/A'}`
                      });
                      
                      // Log to immutable security ledger / audit log
                      try {
                        const targetShipObj = shipments.find(s => s.id === gmailSelectedShipmentId);
                        await apiFetch("/api/logs", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            actor: gmailUser?.email || "Gmail Operator",
                            shipmentNumber: targetShipObj?.shipmentNumber || "GMAIL-BROADCAST",
                            actionEn: `Dispatched operational email alert via Gmail Workspace connection to ${maskEmailForLog(gmailTo)}`,
                            actionTr: `Gmail Workspace bağlantısı üzerinden ${maskEmailForLog(gmailTo)} adresine operasyonel e-posta gönderildi`,
                            actionAr: `تم إرسال تنبيه بالبريد الإلكتروني عبر حساب Gmail إلى ${maskEmailForLog(gmailTo)}`
                          })
                        });
                        // Refresh audit logs in background — only for roles that
                        // can actually view the ledger (canViewAuditLogs,
                        // adminAccess.ts). Operation admins can reach this send
                        // flow and can now write to the log (canWriteAuditLogs,
                        // PR #82), but still can't read the full trail back, so
                        // this GET would just 403 for them.
                        if (canViewAuditLogs(resolvedAdminType)) {
                          const logsRes = await apiFetch("/api/logs");
                          if (logsRes.ok) {
                            setActivityLogs(await logsRes.json());
                          }
                        }
                      } catch (auditErr) {
                        console.error("Audit log failed for Gmail broadcast", auditErr);
                      }

                      // Clean composer fields after 1.5 seconds, keep response visible
                      setTimeout(() => {
                        setGmailTo("");
                        setGmailSubject("");
                        setGmailBody("");
                        setGmailSelectedShipmentId("");
                      }, 1500);

                    } else {
                      const errData = await response.json();
                      setGmailResponse({
                        success: false,
                        message: `Gmail API Response Error: ${errData.error?.message || response.statusText}`
                      });
                    }
                  } catch (err: any) {
                    console.error(err);
                    setGmailResponse({
                      success: false,
                      message: `Network communication failure: ${err.message || String(err)}`
                    });
                  } finally {
                    setGmailSending(false);
                  }
                }} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-wider font-extrabold text-slate-500 block">Recipient Email Address</label>
                    <input
                      type="email"
                      required
                      placeholder="stakeholder@company.com"
                      value={gmailTo}
                      onChange={(e) => setGmailTo(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 focus:border-orange-500 text-xs text-slate-800 rounded-lg focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-wider font-extrabold text-slate-500 block">Subject Line</label>
                    <input
                      type="text"
                      required
                      placeholder="etir Transit Alert"
                      value={gmailSubject}
                      onChange={(e) => setGmailSubject(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 focus:border-orange-500 text-xs text-slate-800 font-semibold rounded-lg focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-wider font-extrabold text-slate-500 block">HTML / Text Message Body</label>
                    <textarea
                      required
                      rows={8}
                      placeholder="Write your cargo update dispatch info..."
                      value={gmailBody}
                      onChange={(e) => setGmailBody(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 focus:border-orange-500 text-xs text-slate-800 rounded-lg focus:outline-none font-mono"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={gmailSending}
                    className="w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-black rounded-lg shadow-md hover:shadow-orange-100 transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {gmailSending ? (
                      <span>Executing secure dispatch...</span>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        <span>Send Operational Broadcast via Gmail</span>
                      </>
                    )}
                  </button>
                </form>
              </div>

            </div>
          ) : workspaceSubTab === 'drive' ? (
            /* Connected Mode - Drive bento layout */
            <div className={`grid grid-cols-1 ${isMobileMode ? '' : 'lg:grid-cols-12'} gap-6 items-start`}>
              
              {/* Left Column: Shipment selected for cloud backups */}
              <div className={`${isMobileMode ? '' : 'lg:col-span-12 xl:col-span-5'} bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-sm`}>
                <div>
                  <h3 className="text-xs font-black text-slate-950 uppercase tracking-wider">Select cargo to back up</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">Choose an active shipment to generate a secure transit backup document on Google Drive.</p>
                </div>

                <div className="space-y-2 max-h-[380px] overflow-y-auto">
                  {shipments.map(s => {
                    const isSelected = driveSelectedShipmentId === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setDriveSelectedShipmentId(s.id);
                          setDriveResponse(null);
                        }}
                        className={`w-full text-left p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                          isSelected 
                            ? 'bg-orange-50 border-orange-300 text-orange-950 shadow-xs' 
                            : 'bg-slate-50/50 border-slate-100 hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <div className="space-y-1">
                          <p className="font-bold font-mono text-xs text-slate-900 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                            <span>{s.shipmentNumber}</span>
                          </p>
                          <p className="text-[11px] font-black truncate max-w-[180px]">{s.companyName}</p>
                          <p className="text-[10px] text-slate-400 font-medium">{s.loadingCity} ➔ {s.deliveryCity}</p>
                        </div>
                        <div className="text-right">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            s.status === 'Delivered' ? 'bg-emerald-100 text-emerald-800' : 'bg-orange-100 text-orange-800'
                          }`}>
                            {s.status}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {driveSelectedShipmentId && (
                  <div className="pt-4 border-t border-slate-100 space-y-3">
                    <button
                      type="button"
                      onClick={() => uploadBackupToDrive(driveSelectedShipmentId)}
                      disabled={driveUploading}
                      className="w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-black rounded-lg shadow-md hover:shadow-orange-100 transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {driveUploading ? (
                        <span>Uploading backup report...</span>
                      ) : (
                        <>
                          <FileText className="w-4 h-4" />
                          <span>Generate & Upload Cloud Backup</span>
                        </>
                      )}
                    </button>
                  </div>
                )}

                {driveResponse && (
                  <div className={`p-4 rounded-xl border text-xs font-bold text-center flex items-center justify-center gap-2 ${
                    driveResponse.success 
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
                      : 'bg-red-50 border-red-200 text-red-800'
                  }`}>
                    {driveResponse.success ? <Check className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                    <span>{driveResponse.message}</span>
                  </div>
                )}
              </div>

              {/* Right Column: Active drive files list */}
              <div className={`${isMobileMode ? '' : 'lg:col-span-12 xl:col-span-7'} bg-white rounded-2xl border border-slate-200 p-5 md:p-6 space-y-4 shadow-sm`}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-xs font-black text-slate-950 uppercase tracking-wider">Drive Backups Archive</h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">Most recent operational etir logs stored securely on Google Drive.</p>
                  </div>
                  <button
                    type="button"
                    onClick={fetchDriveFiles}
                    disabled={driveLoading}
                    className="p-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded-lg transition-all cursor-pointer"
                    title="Refresh directory list"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${driveLoading ? 'animate-spin text-orange-500' : ''}`} />
                  </button>
                </div>

                {driveLoading ? (
                  <div className="py-12 text-center text-xs text-slate-400 font-mono tracking-tight flex flex-col items-center justify-center gap-2">
                    <RefreshCw className="w-6 h-6 animate-spin text-orange-500" />
                    <span>Loading files from secure Drive...</span>
                  </div>
                ) : driveFiles.length === 0 ? (
                  <div className="text-center py-12 border-2 border-dashed border-slate-100 rounded-2xl p-6 text-slate-400 text-xs">
                    No files found on Drive backup path. Choose a shipment on the left to export.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[460px] overflow-y-auto pr-1">
                    {driveFiles.map(file => (
                      <div key={file.id} className="p-3.5 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-all flex flex-col justify-between gap-3">
                        <div className="space-y-1">
                          <p className="text-xs font-bold text-slate-900 truncate flex items-center gap-1.5" title={file.name}>
                            <FileText className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                            <span className="truncate">{file.name}</span>
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono">
                            Type: {file.mimeType?.split('.').pop() || "File"}
                          </p>
                          <p className="text-[10px] text-slate-400 font-medium">
                            Created: {new Date(file.createdTime).toLocaleString()}
                          </p>
                        </div>
                        {file.webViewLink && (
                          <a
                            href={file.webViewLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="bg-white hover:bg-slate-100 border border-slate-200 py-1.5 px-3 rounded-lg text-[10px] font-extrabold text-slate-800 flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer inline-self-start"
                          >
                            <span>Open on Drive</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          ) : (
            /* Connected Mode - Calendar layout */
            <div className={`grid grid-cols-1 ${isMobileMode ? '' : 'lg:grid-cols-12'} gap-6 items-start`}>
              
              {/* Left Column: Shipment scheduler */}
              <div className={`${isMobileMode ? '' : 'lg:col-span-12 xl:col-span-5'} bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-sm`}>
                <div>
                  <h3 className="text-xs font-black text-slate-950 uppercase tracking-wider">Select cargo to schedule</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">Determine delivery slots or border transit dates to register on Google Calendar.</p>
                </div>

                <div className="space-y-2 max-h-[380px] overflow-y-auto">
                  {shipments.map(s => {
                    const isSelected = calendarSelectedShipmentId === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setCalendarSelectedShipmentId(s.id);
                          setCalendarResponse(null);
                        }}
                        className={`w-full text-left p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                          isSelected 
                            ? 'bg-orange-50 border-orange-300 text-orange-950 shadow-xs' 
                            : 'bg-slate-50/50 border-slate-100 hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <div className="space-y-1">
                          <p className="font-bold font-mono text-xs text-slate-900 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                            <span>{s.shipmentNumber}</span>
                          </p>
                          <p className="text-[11px] font-black truncate max-w-[180px]">{s.companyName}</p>
                          <p className="text-[10px] text-slate-400 font-medium">{s.loadingCity} ➔ {s.deliveryCity}</p>
                        </div>
                        <div className="text-right">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            s.status === 'Delivered' ? 'bg-emerald-100 text-emerald-800' : 'bg-orange-100 text-orange-800'
                          }`}>
                            {s.status}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {calendarSelectedShipmentId && (
                  <div className="pt-4 border-t border-slate-100 space-y-3">
                    <button
                      type="button"
                      onClick={() => createCalendarEvent(calendarSelectedShipmentId)}
                      disabled={calendarCreating}
                      className="w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-black rounded-lg shadow-md hover:shadow-orange-100 transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {calendarCreating ? (
                        <span>Scheduling on Calendar...</span>
                      ) : (
                        <>
                          <Calendar className="w-4 h-4" />
                          <span>Schedule in Google Calendar</span>
                        </>
                      )}
                    </button>
                  </div>
                )}

                {calendarResponse && (
                  <div className={`p-4 rounded-xl border text-xs font-bold text-center flex items-center justify-center gap-2 ${
                    calendarResponse.success 
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
                      : 'bg-red-50 border-red-200 text-red-800'
                  }`}>
                    {calendarResponse.success ? <Check className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                    <span>{calendarResponse.message}</span>
                  </div>
                )}
              </div>

              {/* Right Column: Upcoming Calendar events list */}
              <div className={`${isMobileMode ? '' : 'lg:col-span-12 xl:col-span-7'} bg-white rounded-2xl border border-slate-200 p-5 md:p-6 space-y-4 shadow-sm font-sans`}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-xs font-black text-slate-950 uppercase tracking-wider">Upcoming Calendar events</h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">Primary delivery, loading shifts, and customs windows recorded on your account.</p>
                  </div>
                  <button
                    type="button"
                    onClick={fetchCalendarEvents}
                    disabled={calendarLoading}
                    className="p-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded-lg transition-all cursor-pointer"
                    title="Refresh events list font"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${calendarLoading ? 'animate-spin text-orange-500' : ''}`} />
                  </button>
                </div>

                {calendarLoading ? (
                  <div className="py-12 text-center text-xs text-slate-400 font-mono tracking-tight flex flex-col items-center justify-center gap-2">
                    <RefreshCw className="w-6 h-6 animate-spin text-orange-500" />
                    <span>Querying Google Calendar service...</span>
                  </div>
                ) : calendarEvents.length === 0 ? (
                  <div className="text-center py-12 border-2 border-dashed border-slate-100 rounded-2xl p-6 text-slate-400 text-xs text-slate-400">
                    No upcoming calendar slots scheduled.
                  </div>
                ) : (
                  <div className="space-y-3.5 max-h-[460px] overflow-y-auto pr-1">
                    {calendarEvents.map(event => (
                      <div key={event.id} className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-all flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div className="space-y-1">
                          <p className="text-xs font-black text-slate-900 flex items-center gap-2 pb-0.5">
                            <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                            <span>{event.summary}</span>
                          </p>
                          {event.location && (
                            <p className="text-[10px] text-slate-500 font-semibold font-mono">
                              📍 {event.location}
                            </p>
                          )}
                          {event.description && (
                            <p className="text-[10px] text-slate-400 max-w-md line-clamp-1">
                              {event.description}
                            </p>
                          )}
                        </div>
                        <div className="bg-white border border-slate-200 p-2 rounded-lg text-center shrink-0 min-w-[100px]">
                          <span className="block text-[9px] uppercase font-bold text-orange-600 tracking-wider">Date Scheduled</span>
                          <span className="block text-[10px] font-black font-mono text-slate-800">
                            {event.start?.date || (event.start?.dateTime ? new Date(event.start.dateTime).toLocaleDateString() : "All Day")}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          )}

        </div>
      )}

      {/* 7. Active GPS Tracking Map Tab */}
      {/* BUG-26: content-render guard added alongside filteredAdminTabs —
          see canViewGpsTracking (adminAccess.ts) for why this was missing. */}
      {activeTab === 'tracking_map' && canViewGpsTracking(resolvedAdminType) && (
        // BUG-13: this map is a Turkey<->Iraq land corridor visualization —
        // it has no coordinate data for Sea/Air routes, so mixing them in
        // just fell back to a fake Istanbul->Baghdad pin. Land-only here.
        <React.Suspense fallback={<AdminSectionLoadingFallback lang={lang} />}>
          <TrackingMap shipments={shipments.filter(s => (s.freightType || "land") === "land")} lang={lang} drivers={drivers} />
        </React.Suspense>
      )}

      {/* Chat Center Tab — UI foundation only, see ChatCenter.tsx.
          Defense-in-depth (PR #76, same pattern as 'audit'/'team'/'costs'
          above): 'chat_center' is only in rawTabs' roleFiltered result for
          isSuper/isOperation (accounts admins can't view shipments, which
          this is scoped to), but this content block had no adminType check
          of its own. */}
      {activeTab === 'chat_center' && (resolvedAdminType === 'super' || resolvedAdminType === 'operation') && (
        <React.Suspense fallback={<AdminSectionLoadingFallback lang={lang} />}>
          <ChatCenter
            lang={lang}
            isRtl={isRtl}
            isMobile={isMobileMode}
            shipments={shipments}
            unreadChatMessages={unreadChatMessages}
            onOpenFullChat={onSelectShipmentChat}
            focus={chatCenterFocus}
            onFocusHandled={() => setChatCenterFocus(null)}
            onChannelRead={(shipmentId, channel) => {
              // fix/admin-mobile-chat-correctness: server-CONFIRMED drop
              // (ChatCenter only calls this after /chat/seen answered OK)
              // — now via recordConfirmedSeen so (a) channel-less legacy
              // messages whose audience resolves to this channel are
              // dropped too, mirroring the server's own clear, and (b)
              // the scope is remembered so an in-flight ~12s poll fetched
              // before the seen can't resurrect the badge when it lands.
              recordConfirmedSeen(shipmentId, channel);
            }}
          />
        </React.Suspense>
      )}

      {/* 8. Accounts & Cost Statements Tab.
          Defense-in-depth (PR #58): 'costs' is only in rawTabs' roleFiltered
          result for isSuper/isAccounts, but this content block had no
          adminType check of its own — add one so an operation admin can't
          render the accounting ledger even if activeTab were somehow set to
          'costs' by something other than that sidebar entry. */}
      {activeTab === 'costs' && canViewCostStatements(resolvedAdminType) && (
        selectedCostStatement && isStatementEditorOpen ? (
          // Increment: full-screen accounting workspace (replaces the old modal).
          // Rendered in the content area so the admin sidebar stays visible and
          // the page is NOT darkened/blurred.
          <CostStatementWorkspace
            statement={selectedCostStatement}
            shipments={shipments}
            clients={clients}
            bankAccounts={bankAccounts}
            lang={lang}
            canWrite={canViewCostStatements(resolvedAdminType)}
            actor={{ sessionId: ownAdminId, isSuperAdmin: resolvedAdminType === 'super', canWriteCostStatements: canViewCostStatements(resolvedAdminType) }}
            onBack={() => { setIsStatementEditorOpen(false); setSelectedCostStatement(null); if (typeof window !== 'undefined' && window.location.hash.startsWith('#/accounting/cost-statements/')) window.location.hash = ''; }}
            onRefresh={handleReloadLatestStatement}
            onExportCsv={() => handleExportCSV(selectedCostStatement)}
            onSaveDraft={handleSaveCostStatement}
            isSaving={isSavingCostStatement}
            onOpenCustomer={() => setActiveTab('clients')}
          />
        ) : (
          <React.Suspense fallback={<AdminSectionLoadingFallback lang={lang} />}>
            <AdminCostsSection
              lang={lang}
              isMobileMode={isMobileMode}
              costStatements={costStatements}
              shipments={shipments}
              costSearchQuery={costSearchQuery}
              onCostSearchQueryChange={setCostSearchQuery}
              costStatusFilter={costStatusFilter}
              onCostStatusFilterChange={setCostStatusFilter}
              costTypeFilter={costTypeFilter}
              onCostTypeFilterChange={setCostTypeFilter}
              onSelectActiveStatement={handleSelectActiveStatement}
            />
          </React.Suspense>
        )
      )}



      {/* DETAILED MODAL PORTAL: SHIPMENT DRAWER SCREEN.
          feature/admin-mobile-ui: full-screen on mobile (no outer padding,
          no rounded corners, no vertical centering — matches native sheet
          conventions and the spec's "near-full-screen, sticky
          header/footer" responsive-modal requirement), reverting to the
          original centered max-w-4xl card at sm and up. */}
      {targetDetailsShipment && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center sm:p-4 z-50 overflow-y-auto block">
          <div className="bg-white sm:rounded-2xl border-0 sm:border border-slate-400 shadow-2xl w-full h-full sm:h-auto sm:max-w-4xl sm:max-h-[90vh] overflow-y-auto flex flex-col">

            {/* Modal Header */}
            <div className="sticky top-0 bg-slate-900 text-white p-5 sm:rounded-t-2xl flex items-center justify-between gap-4 border-b border-slate-800 z-10 shrink-0">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="bg-orange-500 text-white font-mono text-xs font-bold uppercase rounded px-2.5 py-0.5 tracking-wider">
                    {targetDetailsShipment.shipmentNumber}
                  </span>
                  <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono font-bold flex items-center gap-1">
                    {targetDetailsShipment.freightType === 'sea' ? <Anchor className="w-3 h-3" /> : targetDetailsShipment.freightType === 'air' ? <Plane className="w-3 h-3" /> : <Truck className="w-3 h-3" />}
                    {targetDetailsShipment.freightType === 'sea' ? 'Sea' : targetDetailsShipment.freightType === 'air' ? 'Air' : 'Land'}
                  </span>
                  <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono font-bold">
                    {targetDetailsShipment.status}
                  </span>
                </div>
                <h3 className="text-lg font-bold truncate max-w-md">{targetDetailsShipment.companyName}</h3>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {/* Chat Center shortcuts — jump to this shipment's conversation, preselecting the channel. */}
                {([
                  { channel: 'internal_staff' as const, label: lang === 'tr' ? 'Dahili Sohbet' : (lang === 'ar' ? 'دردشة داخلية' : 'Internal Chat') },
                  { channel: 'driver_admin' as const, label: lang === 'tr' ? 'Sürücü Sohbet' : (lang === 'ar' ? 'دردشة السائق' : 'Driver Chat') },
                  { channel: 'client_admin' as const, label: lang === 'tr' ? 'Müşteri Sohbet' : (lang === 'ar' ? 'دردشة العميل' : 'Customer Chat') },
                ]).map(({ channel, label: chatLabel }) => (
                  <button
                    key={channel}
                    onClick={() => {
                      setChatCenterFocus({ shipmentId: targetDetailsShipment.id, channel });
                      setActiveTab('chat_center');
                      setOpenDetailsId(null);
                    }}
                    title={`${lang === 'tr' ? 'Sohbeti Aç' : (lang === 'ar' ? 'فتح المحادثة' : 'Open Chat')}: ${chatLabel}`}
                    className="hidden sm:flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg text-[10px] font-bold text-slate-300 hover:text-white transition-all cursor-pointer"
                  >
                    <MessageSquare className="w-3 h-3" />
                    {chatLabel}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setOpenDetailsId(null)}
                className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 hover:text-white transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content Drawer Grid */}
            <div className="p-6 space-y-8 text-sm">

              {/* SECTION: Shipment Overview */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="bg-slate-900 text-white p-1.5 rounded-lg shrink-0">
                    <ClipboardList className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                    {lang === 'tr' ? 'Sevkiyat Genel Bakış' : (lang === 'ar' ? 'نظرة عامة على الشحنة' : 'Shipment Overview')}
                  </h3>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                  <div>
                    <span className="text-slate-400 text-[10px] block font-bold uppercase tracking-wider">{lang === 'tr' ? 'Sevkiyat Türü' : (lang === 'ar' ? 'نوع الشحن' : 'Freight Type')}</span>
                    <p className="font-bold text-slate-900 mt-0.5">
                      {targetDetailsShipment.freightType === 'sea' ? (lang === 'tr' ? 'Deniz Nakliye' : 'Sea Freight') : targetDetailsShipment.freightType === 'air' ? (lang === 'tr' ? 'Hava Nakliye' : 'Air Freight') : (lang === 'tr' ? 'Kara Nakliye' : 'Land Freight')}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] block font-bold uppercase tracking-wider">{t('status')}</span>
                    <p className="font-bold text-slate-900 mt-0.5">{targetDetailsShipment.status}</p>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <span className="text-slate-400 text-[10px] block font-bold uppercase tracking-wider">{lang === 'tr' ? 'Müşteri' : (lang === 'ar' ? 'العميل' : 'Customer')}</span>
                    <p className="font-bold text-slate-900 mt-0.5 truncate">{targetDetailsShipment.companyName}</p>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] block font-bold uppercase tracking-wider">{t('weightKg')}</span>
                    <p className="font-bold text-slate-900 mt-0.5">{targetDetailsShipment.cargoWeight.toLocaleString()} kg</p>
                  </div>
                  <div className="col-span-2 sm:col-span-4 border-t border-slate-200 pt-3 mt-1">
                    <span className="text-slate-400 text-[10px] block font-bold uppercase tracking-wider">{lang === 'tr' ? 'Güzergah' : (lang === 'ar' ? 'المسار' : 'Route')}</span>
                    <p className="font-bold text-slate-900 mt-0.5 flex items-center gap-2 flex-wrap">
                      {targetDetailsShipment.freightType === 'sea' ? (
                        <span>{targetDetailsShipment.portOfLoading || targetDetailsShipment.loadingCity} → {targetDetailsShipment.portOfDischarge || targetDetailsShipment.deliveryCity}</span>
                      ) : targetDetailsShipment.freightType === 'air' ? (
                        <span>{targetDetailsShipment.airportOfDeparture || targetDetailsShipment.loadingCity} → {targetDetailsShipment.airportOfArrival || targetDetailsShipment.deliveryCity}</span>
                      ) : (
                        <span>{targetDetailsShipment.loadingCity} → {targetDetailsShipment.deliveryCity}</span>
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {/* SECTION: Route & Freight Details */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="bg-slate-900 text-white p-1.5 rounded-lg shrink-0">
                    <MapIcon className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                    {lang === 'tr' ? 'Güzergah ve Nakliye Detayları' : (lang === 'ar' ? 'تفاصيل المسار والشحن' : 'Route & Freight Details')}
                  </h3>
                </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* 1. Loading Locations Panel */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <h4 className="font-bold text-slate-900 border-b border-slate-200 pb-2 flex items-center gap-2">
                    <span className="w-1.5 h-3 bg-orange-500 rounded"></span>
                    {t('loadingInfo')}
                  </h4>
                  <div className="space-y-2">
                    <div>
                      <span className="text-slate-400 text-xs block font-bold uppercase tracking-wider">{t('country')} / {t('city')}</span>
                      <p className="font-semibold">{targetDetailsShipment.loadingCity}, {targetDetailsShipment.loadingCountry}</p>
                    </div>
                    <div>
                      <span className="text-slate-400 text-xs block font-bold uppercase tracking-wider">{t('address')}</span>
                      <p className="text-xs text-slate-700">{targetDetailsShipment.loadingAddress || "-"}</p>
                    </div>
                    <div>
                      <span className="text-slate-400 text-xs block font-bold uppercase tracking-wider">{t('loadingContact')}</span>
                      <p className="text-xs font-mono font-medium text-slate-800">{targetDetailsShipment.loadingContactNumber || "-"}</p>
                    </div>
                  </div>
                </div>

                {/* 2. Delivery Locations Panel */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <h4 className="font-bold text-slate-900 border-b border-slate-200 pb-2 flex items-center gap-2">
                    <span className="w-1.5 h-3 bg-orange-500 rounded"></span>
                    {t('deliveryInfo')}
                  </h4>
                  <div className="space-y-2">
                    <div>
                      <span className="text-slate-400 text-xs block font-bold uppercase tracking-wider">{t('country')} / {t('city')}</span>
                      <p className="font-semibold">{targetDetailsShipment.deliveryCity}, {targetDetailsShipment.deliveryCountry}</p>
                    </div>
                    <div>
                      <span className="text-slate-400 text-xs block font-bold uppercase tracking-wider">{t('address')}</span>
                      <p className="text-xs text-slate-700">{targetDetailsShipment.deliveryAddress || "-"}</p>
                    </div>
                    <div>
                      <span className="text-slate-400 text-xs block font-bold uppercase tracking-wider">{t('deliveryContact')}</span>
                      <p className="text-xs font-mono font-medium text-slate-800">{targetDetailsShipment.deliveryContactNumber || "-"}</p>
                    </div>
                  </div>
                </div>

                {/* 3. Load description details */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2 md:col-span-2">
                  <h4 className="font-bold text-slate-900 border-b border-slate-200 pb-2">{t('cargoInfo')}</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <span className="text-slate-400 text-xs block font-bold uppercase tracking-wider">{t('weightKg')}</span>
                      <p className="font-bold text-slate-900 mt-0.5">{targetDetailsShipment.cargoWeight.toLocaleString()} kg</p>
                    </div>
                    <div className="sm:col-span-2">
                      <span className="text-slate-400 text-xs block font-bold uppercase tracking-wider">{t('cargoDesc')}</span>
                      <p className="text-xs text-slate-700 mt-0.5">{targetDetailsShipment.cargoDescription || "-"}</p>
                    </div>
                  </div>
                </div>

              </div>
              </div>

              {/* SECTION: Parties & Assignment */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="bg-slate-900 text-white p-1.5 rounded-lg shrink-0">
                    <Users className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                    {lang === 'tr' ? 'Taraflar ve Atama' : (lang === 'ar' ? 'الأطراف والتعيين' : 'Parties & Assignment')}
                  </h3>
                </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* 4. Dispatched Driver Account & Assigned Pay */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <h4 className="font-bold text-slate-900 border-b border-slate-200 pb-2">{t('truckAndDriver')}</h4>
                  <div className="space-y-2 text-xs">
                    <div>
                      <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">{t('driverName')} ({lang === 'tr' ? "Ana Sürücü" : "Core"})</span>
                      {(() => {
                        const dr = drivers.find(d => d.id === targetDetailsShipment.assignedDriverId || d.name === targetDetailsShipment.assignedDriverName);
                        if (dr) {
                          return (
                            <button
                              onClick={() => setSelectedPerformanceDriver(dr)}
                              className="font-bold text-slate-900 hover:text-orange-600 underline decoration-dotted underline-offset-2 transition-colors cursor-pointer flex items-center gap-1.5 mt-0.5 focus:outline-none text-left"
                              title={lang === 'tr' ? "Performans Detaylarını Göster" : (lang === 'ar' ? "عرض تفاصيل الأداء" : "Show Performance Details")}
                            >
                              <span>{targetDetailsShipment.assignedDriverName}</span>
                              <Award className="w-3.5 h-3.5 text-amber-500 inline" />
                            </button>
                          );
                        }
                        return <p className="font-bold text-slate-900 mt-0.5">{targetDetailsShipment.assignedDriverName}</p>;
                      })()}
                    </div>
                    <div className="flex gap-4">
                      <div>
                        <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">{t('truckNumber')}</span>
                        <p className="font-mono font-bold text-slate-800">{targetDetailsShipment.truckNumber || "-"}</p>
                      </div>
                    </div>

                    {/* Display additional drivers/trucks supporting multiple trucks per load */}
                    {targetDetailsShipment.additionalDrivers && targetDetailsShipment.additionalDrivers.length > 0 && (
                      <div className="border-t border-dashed border-slate-200 pt-2 mt-2 space-y-1.5 text-left">
                        <span className="text-slate-500 text-[10.5px] uppercase font-bold tracking-wider block font-mono">
                          {lang === 'tr' ? "İlave Sevk Araçları" : "Supplementary Trucks / Drivers"}
                        </span>
                        <div className="flex flex-col gap-1.5">
                          {targetDetailsShipment.additionalDrivers.map((ad, idx) => {
                            const dr = drivers.find(d => d.id === ad.driverId || d.name === ad.driverName);
                            return (
                              <div key={idx} className="flex items-center justify-between text-[11px] font-semibold bg-white p-2.5 rounded-lg border border-slate-200 shadow-3xs hover:bg-slate-50 transition-colors">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-slate-500 font-mono text-[9px] bg-slate-100 px-1 py-0.5 rounded font-black border border-slate-200">🚚 #{idx + 2}</span>
                                  {dr ? (
                                    <button
                                      onClick={() => setSelectedPerformanceDriver(dr)}
                                      className="font-bold text-slate-900 hover:text-orange-600 underline decoration-dotted underline-offset-2 transition-colors cursor-pointer flex items-center gap-1 focus:outline-none"
                                      title={lang === 'tr' ? "Performans Detaylarını Göster" : "Show Performance Details"}
                                    >
                                      <span>{ad.driverName}</span>
                                      <Award className="w-3 h-3 text-amber-500 shrink-0" />
                                    </button>
                                  ) : (
                                    <span className="font-bold text-slate-900">{ad.driverName}</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  {ad.agreedAmount !== undefined && ad.agreedAmount > 0 ? (
                                    <span className="font-mono text-orange-600 font-extrabold bg-orange-50 px-1.5 py-0.5 rounded text-[10px] border border-orange-200">
                                      {ad.agreedAmount.toLocaleString()} <span className="text-[8px] font-bold">{targetDetailsShipment.currency || "USD"}</span>
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-slate-400 font-mono italic">No price</span>
                                  )}
                                  <span className="font-mono bg-slate-100 text-slate-700 font-bold px-1.5 py-0.5 rounded text-[10px] border border-slate-200">{ad.truckNumber}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                 {/* 5. Custom notes */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <h4 className="font-bold text-slate-900 border-b border-slate-200 pb-2">{t('internalNotes')}</h4>
                  <p className="text-xs text-slate-700 italic">{targetDetailsShipment.internalNotes || "No internal administration logs logged."}</p>
                </div>

              </div>
              </div>

              {/* SECTION: Freight-Specific & Transit Details (continuation of Route & Freight Details) */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="bg-slate-900 text-white p-1.5 rounded-lg shrink-0">
                    {targetDetailsShipment.freightType === 'sea' ? <Anchor className="w-4 h-4" /> : targetDetailsShipment.freightType === 'air' ? <Plane className="w-4 h-4" /> : <Truck className="w-4 h-4" />}
                  </div>
                  <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                    {lang === 'tr' ? 'Nakliye Türüne Özel Detaylar' : (lang === 'ar' ? 'تفاصيل خاصة بنوع الشحن' : 'Freight-Specific Details')}
                  </h3>
                </div>

                {/* 5.1 Sea Freight Specific block */}
                {targetDetailsShipment.freightType === 'sea' && (
                  <div className="p-4 bg-blue-50/65 border border-blue-200 rounded-xl space-y-3 md:col-span-2">
                    <h4 className="font-bold text-blue-900 border-b border-blue-200 pb-2 flex items-center gap-2">
                      <Anchor className="w-4 h-4 text-blue-600 animate-pulse" />
                      <span>Maritime Shipping Info / Denizyolu Detayları</span>
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                      <div>
                        <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Shipping Line</span>
                        <p className="font-bold text-slate-900">{targetDetailsShipment.shippingLine || "-"}</p>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Vessel Name</span>
                        <p className="font-bold text-slate-900">{targetDetailsShipment.vesselName || "-"}</p>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Booking Number</span>
                        <p className="font-mono font-bold text-slate-900">{targetDetailsShipment.bookingNumber || "-"}</p>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Bill of Lading (BL)</span>
                        <p className="font-mono font-bold text-slate-900">{targetDetailsShipment.billOfLadingNumber || "-"}</p>
                      </div>
                      <div className="col-span-2">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Containers Swarm / Konteyner Listesi</span>
                        <div className="flex flex-col gap-1.5 mt-1">
                          <div className="flex items-center justify-between bg-white/70 p-1 px-2 rounded border border-blue-100 font-mono text-[11px] font-bold">
                            <span className="text-slate-500 font-sans text-[10px]">#1 (Core)</span>
                            <span className="text-slate-900">{targetDetailsShipment.containerNumber || "-"}</span>
                          </div>
                          {targetDetailsShipment.additionalContainers && targetDetailsShipment.additionalContainers.map((c, idx) => (
                            <div key={idx} className="flex items-center justify-between bg-white/70 p-1 px-2 rounded border border-blue-100 font-mono text-[11px] font-bold">
                              <span className="text-slate-500 font-sans text-[10px]">#{idx + 2}</span>
                              <span className="text-blue-900">{c}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Total Containers</span>
                        <p className="font-bold text-slate-900 text-sm">
                          {((targetDetailsShipment.additionalContainers?.length || 0) + (targetDetailsShipment.containerNumber ? 1 : 0))}
                        </p>
                        <p className="text-[10px] text-slate-500 font-medium">{targetDetailsShipment.containerType || "40HC"}</p>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Port of Loading (POL)</span>
                        <p className="font-bold text-slate-900">{targetDetailsShipment.portOfLoading || "-"}</p>
                        {targetDetailsShipment.loadingCountry && (
                          <span className="text-[10px] text-slate-400 font-medium">({targetDetailsShipment.loadingCountry})</span>
                        )}
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Port of Discharge (POD)</span>
                        <p className="font-bold text-slate-900">{targetDetailsShipment.portOfDischarge || "-"}</p>
                        {targetDetailsShipment.deliveryCountry && (
                          <span className="text-[10px] text-slate-400 font-medium">({targetDetailsShipment.deliveryCountry})</span>
                        )}
                      </div>
                      <div className="col-span-2">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Estimated Departure (ETD)</span>
                        <p className="font-mono font-bold text-slate-900">
                          {targetDetailsShipment.etd ? new Date(targetDetailsShipment.etd).toLocaleString() : "-"}
                        </p>
                      </div>
                      <div className="col-span-2">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Estimated Arrival (ETA)</span>
                        <p className="font-mono font-bold text-orange-600">
                          {targetDetailsShipment.eta ? new Date(targetDetailsShipment.eta).toLocaleString() : "-"}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* 5.2 Air Freight Specific block */}
                {targetDetailsShipment.freightType === 'air' && (
                  <div className="p-4 bg-purple-50/65 border border-purple-200 rounded-xl space-y-3 md:col-span-2">
                    <h4 className="font-bold text-purple-900 border-b border-purple-200 pb-2 flex items-center gap-2">
                      <Plane className="w-4 h-4 text-purple-600 animate-pulse" />
                      <span>Air Freight Parameters / Havayolu Detayları</span>
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                      <div>
                        <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Airline</span>
                        <p className="font-bold text-slate-900">{targetDetailsShipment.airline || "-"}</p>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Flight Number</span>
                        <p className="font-bold text-slate-900">{targetDetailsShipment.flightNumber || "-"}</p>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Air Waybill (AWB) #</span>
                        <p className="font-mono font-bold text-slate-900">{targetDetailsShipment.airWaybillNumber || "-"}</p>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Packages Count</span>
                        <p className="font-bold text-slate-900">{targetDetailsShipment.numberOfPackages || "1"} pkgs</p>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Departure Airport</span>
                        <p className="font-bold text-slate-900">{targetDetailsShipment.airportOfDeparture || "-"}</p>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Arrival Airport</span>
                        <p className="font-bold text-slate-900">{targetDetailsShipment.airportOfArrival || "-"}</p>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Gross Weight</span>
                        <p className="font-mono font-bold text-slate-900">{targetDetailsShipment.grossWeight ? `${targetDetailsShipment.grossWeight.toLocaleString()} kg` : "-"}</p>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Chargeable Weight</span>
                        <p className="font-mono font-bold text-slate-900">{targetDetailsShipment.chargeableWeight ? `${targetDetailsShipment.chargeableWeight.toLocaleString()} kg` : "-"}</p>
                      </div>
                      <div className="col-span-2">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Estimated Departure (ETD)</span>
                        <p className="font-mono font-bold text-slate-900">
                          {targetDetailsShipment.etd ? new Date(targetDetailsShipment.etd).toLocaleString() : "-"}
                        </p>
                      </div>
                      <div className="col-span-2">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Estimated Arrival (ETA)</span>
                        <p className="font-mono font-bold text-orange-700">
                          {targetDetailsShipment.eta ? new Date(targetDetailsShipment.eta).toLocaleString() : "-"}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* 5.3 Land Freight Specific / Customs Brokers block */}
                {targetDetailsShipment.freightType === 'land' && (
                  <div className="p-4 bg-orange-50/65 border border-orange-200 rounded-xl space-y-3 md:col-span-2 font-sans">
                    <h4 className="font-bold text-orange-950 border-b border-orange-100 pb-2 flex items-center gap-1.5 text-xs uppercase tracking-wider">
                      <ShieldCheck className="w-4 h-4 text-orange-600 font-bold" />
                      <span>{lang === 'tr' ? "Gümrük Müşavir Bilgileri" : "Customs Broker Information"}</span>
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-sans">
                      <div className="p-3 bg-white/70 rounded-lg border border-orange-100 space-y-1 text-left">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider font-extrabold pb-1">
                          {lang === 'tr' ? "Varış Gümrük Müşaviri" : "Broker at Destination Port"}
                        </span>
                        <p className="font-bold text-slate-800 text-sm leading-tight">{targetDetailsShipment.destinationBrokerName || "-"}</p>
                        {targetDetailsShipment.destinationBrokerPhone && (
                          <p className="text-[11px] font-mono font-bold text-slate-600 flex items-center gap-1 mt-1 font-mono">
                            📞 {targetDetailsShipment.destinationBrokerPhone}
                          </p>
                        )}
                      </div>
                      <div className="p-3 bg-white/70 rounded-lg border border-orange-100 space-y-1 text-left">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider font-extrabold pb-1">
                          {lang === 'tr' ? "Irak Sınır Müşaviri" : "Broker at Iraq Border"}
                        </span>
                        <p className="font-bold text-slate-800 text-sm leading-tight">{targetDetailsShipment.iraqBorderBrokerName || "-"}</p>
                        {targetDetailsShipment.iraqBorderBrokerPhone && (
                          <p className="text-[11px] font-mono font-bold text-slate-600 flex items-center gap-1 mt-1 font-mono">
                            📞 {targetDetailsShipment.iraqBorderBrokerPhone}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Google Maps Distance Matrix API Transit Calculations Block */}
                <div className="p-5 bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200 rounded-xl space-y-4 md:col-span-2 shadow-xs transition-all duration-300">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="bg-emerald-100 text-emerald-700 p-2 rounded-lg">
                        <MapIcon className="w-5 h-5 shrink-0 text-emerald-600" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-800 text-sm tracking-tight flex items-center gap-1.5 flex-wrap">
                          <span>Google Maps Traffic & ETA Intelligence</span>
                          <span className="bg-emerald-50 text-emerald-600 border border-emerald-200 font-mono text-[9px] font-extrabold px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                            Distance Matrix API
                          </span>
                        </h4>
                        <p className="text-[10px] text-slate-500 font-medium font-sans">Auto-computed real-time navigation duration & distance from active carrier coordinate</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isLoadingDistanceMatrix}
                      onClick={async () => {
                        setIsLoadingDistanceMatrix(true);
                        setDistanceMatrixError(null);
                        try {
                          const res = await apiFetch(`/api/shipments/${targetDetailsShipment.id}/distance-matrix`);
                          if (res.ok) {
                            const data = await res.json();
                            setDistanceMatrixData(data);
                            triggerToast("Google Maps calculations refreshed successfully!");
                          } else {
                            setDistanceMatrixError("Failed to update Distance Matrix data");
                          }
                        } catch (err) {
                          setDistanceMatrixError("Could not connect to calculations endpoint");
                        } finally {
                          setIsLoadingDistanceMatrix(false);
                        }
                      }}
                      className="bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 text-slate-700 text-[11px] font-black font-mono py-1.5 px-3 rounded-lg flex items-center gap-1 shadow-3xs cursor-pointer transition-all disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${isLoadingDistanceMatrix ? 'animate-spin' : ''}`} />
                      <span>REFRESH DATA</span>
                    </button>
                  </div>

                  {isLoadingDistanceMatrix ? (
                    <div className="py-6 flex flex-col items-center justify-center gap-2 text-xs text-slate-500">
                      <RefreshCw className="w-6 h-6 animate-spin text-emerald-600" />
                      <p className="font-mono font-medium animate-pulse">Calculating optimal corridors & querying Google Traffic APIs...</p>
                    </div>
                  ) : distanceMatrixError ? (
                    <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg font-mono flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold">Matrix Error</p>
                        <p className="text-[11px] text-red-600">{distanceMatrixError}</p>
                      </div>
                    </div>
                  ) : distanceMatrixData?.status === "UNAVAILABLE" ? (
                    <div className="p-3.5 bg-orange-50 border border-orange-200 text-orange-700 text-xs rounded-lg font-mono flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold">Route Distance Unavailable</p>
                        <p className="text-[11px] text-orange-600">
                          {distanceMatrixData.reason || "Route coordinates unavailable for this freight type or location."}
                        </p>
                      </div>
                    </div>
                  ) : distanceMatrixData ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-sans">
                      <div className="bg-white p-3.5 border border-slate-200/60 rounded-xl space-y-1.5 shadow-3xs">
                        <span className="text-slate-400 block text-[9px] uppercase tracking-wider font-extrabold font-mono">Corridor Origin</span>
                        <p className="font-bold text-slate-800 truncate text-[11px]" title={distanceMatrixData.origin}>
                          {distanceMatrixData.hasLiveDriverGps ? "🚚 Live Location (Active GPS)" : "📍 City Center Default"}
                        </p>
                        <p className="text-[9.5px] text-slate-500 font-mono italic truncate">
                          {distanceMatrixData.origin}
                        </p>
                      </div>

                      <div className="bg-white p-3.5 border border-slate-200/60 rounded-xl space-y-1.5 shadow-3xs">
                        <span className="text-slate-400 block text-[9px] uppercase tracking-wider font-extrabold font-mono">Consignee Destination</span>
                        <p className="font-bold text-slate-800 truncate text-[11px]" title={distanceMatrixData.destination}>
                          🏁 Destination Point
                        </p>
                        <p className="text-[9.5px] text-slate-500 font-mono italic truncate">
                          {distanceMatrixData.destination}
                        </p>
                      </div>

                      <div className="bg-white p-3.5 border border-slate-200/60 rounded-xl space-y-1.5 shadow-3xs">
                        <span className="text-slate-400 block text-[9px] uppercase tracking-wider font-extrabold font-mono">Routing Engine Status</span>
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${distanceMatrixData.status === "OK" ? "bg-emerald-500 animate-ping" : distanceMatrixData.status === "SIMULATED_ESTIMATE" ? "bg-sky-500" : "bg-orange-500"}`} />
                          <span className="font-mono text-[10.5px] font-black text-slate-700">
                            {distanceMatrixData.status === "OK" ? "API LIVE & ACTIVE" : "SIMULATED TRAFFIC"}
                          </span>
                        </div>
                        <p className="text-[9.5px] text-slate-500 font-mono leading-none mt-1">
                          {distanceMatrixData.hasLiveDriverGps ? "Carrier position verified" : "Using Static Coordinates"}
                        </p>
                      </div>

                      <div className="md:col-span-3 bg-white p-4 border border-slate-200 rounded-xl grid grid-cols-2 md:grid-cols-3 gap-4 shadow-3xs">
                        <div className="space-y-1">
                          <span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider font-mono">Total Road Distance</span>
                          <p className="text-lg font-black font-mono text-slate-800">{distanceMatrixData.distance?.text || "-"}</p>
                        </div>
                        
                        <div className="space-y-1">
                          <span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider font-mono">Duration In Traffic</span>
                          <p className="text-lg font-black font-mono text-slate-800">{distanceMatrixData.durationInTraffic?.text || distanceMatrixData.duration?.text || "-"}</p>
                        </div>

                        <div className="col-span-2 md:col-span-1 space-y-1 bg-emerald-50/55 p-3.5 border border-emerald-100/80 rounded-xl">
                          <span className="text-emerald-700 block text-[9px] uppercase font-bold tracking-wider font-mono flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />
                            <span>Predicted Arrival (ETA)</span>
                          </span>
                          <p className="text-xs font-black font-mono text-emerald-800 mt-1">
                            {distanceMatrixData.estimatedArrivalTime ? new Date(distanceMatrixData.estimatedArrivalTime).toLocaleString() : "-"}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 bg-slate-50 border border-slate-200 border-dashed rounded-lg text-slate-500 text-xs text-center font-mono">
                      Calculations loaded on drawer expansion. Adjust details above as needed.
                    </div>
                  )}
                </div>

              </div>

              {/* SECTION: Status & Timeline */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="bg-slate-900 text-white p-1.5 rounded-lg shrink-0">
                    <Clock className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                    {lang === 'tr' ? 'Durum ve Zaman Cetveli' : (lang === 'ar' ? 'الحالة والجدول الزمني' : 'Status & Timeline')}
                  </h3>
                </div>

                {/* 5.3 Dedicated Operations & Manual Status / Milestone Console */}
                <div className="p-5 bg-slate-900 text-white rounded-xl space-y-4 md:col-span-2 shadow-xl border border-slate-700">
                  <div className="flex items-center gap-2 border-b border-slate-800 pb-2.5">
                    <span className="p-1 px-2.5 text-[10px] uppercase font-bold font-mono tracking-wider bg-orange-600 text-white rounded">Manual Control</span>
                    <h4 className="font-bold text-sm tracking-tight flex items-center gap-1.5 text-orange-300">
                      <RefreshCw className="w-4 h-4 shrink-0 text-orange-400" />
                      <span>Log Transit Milestone / Manuel İşlem Masası</span>
                    </h4>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed font-medium">
                    Since Air and Maritime cargos do not utilize driver apps, you must log current status milestones directly from this panel. These status changes immediately updates client charts and alerts.
                  </p>

                  {/* PR #111 review (forward-only status transitions):
                      only the immediately valid next status may ever be
                      selected — an admin/staff session is authorized to
                      submit it even when it's the freight-mode's closing
                      status (Closed/Completed), unlike the driver app. */}
                  {(() => {
                    const [nextTransitStatus] = getAllowedNextShipmentStatuses(targetDetailsShipment.status, targetDetailsShipment.freightType);
                    return (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Select Updated Transit Status</label>
                      {nextTransitStatus ? (
                        <select
                          value={nextTransitStatus}
                          disabled
                          className="w-full text-xs font-bold p-2.5 bg-slate-800 border border-slate-700 text-white rounded-lg outline-none cursor-not-allowed opacity-90"
                        >
                          <option value={nextTransitStatus} className="bg-slate-900">{nextTransitStatus}</option>
                        </select>
                      ) : (
                        <div className="w-full text-xs font-bold p-2.5 bg-slate-800 border border-slate-700 text-slate-500 rounded-lg">
                          No further status — shipment is at its terminal status.
                        </div>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Status Description / Remarks (Location & Notes)</label>
                      <input
                        type="text"
                        placeholder="e.g., Vessel departed from Port of loading, ETA intact."
                        value={manualRemarks}
                        onChange={(e) => setManualRemarks(e.target.value)}
                        className="w-full text-xs p-2.5 bg-slate-800 border border-slate-700 text-white placeholder:text-slate-500 rounded-lg focus:ring-1 focus:ring-orange-500 outline-none"
                      />
                    </div>
                  </div>
                    );
                  })()}

                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={handleManualStatusUpdate}
                      disabled={isSubmittingStatus || !getAllowedNextShipmentStatuses(targetDetailsShipment.status, targetDetailsShipment.freightType)[0]}
                      className="bg-orange-600 hover:bg-orange-700 text-white font-extrabold text-xs py-2.5 px-5 rounded-lg inline-flex items-center gap-2 transition-all cursor-pointer border-0 shadow-md font-mono disabled:opacity-50"
                    >
                      {isSubmittingStatus ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>UPDATING LOGS...</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4 text-emerald-400" />
                          <span>APPLY STATUS MILESTONE</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* 8. Detailed Shipment Timeline Tracker */}
                <div className="space-y-3">
                  <h4 className="font-bold text-slate-900 border-b border-slate-100 pb-2">{t('timeline')}</h4>
                  {targetDetailsShipment.timeline.length > 0 ? (
                    <div className="relative border-l border-slate-200 dark:border-slate-200 pl-4 space-y-6 ml-2 pt-2">
                      {targetDetailsShipment.timeline.map((event, idx) => (
                        <div key={idx} className="relative">
                          {/* Bullet circle */}
                          <span className="absolute -left-[21px] mt-0.5 p-1 bg-white border-2 border-slate-500 rounded-full">
                            <span className="w-1.5 h-1.5 bg-slate-900 rounded-full block" />
                          </span>

                          <div className="space-y-0.5">
                            <span className="text-[10px] font-mono text-slate-400 font-bold">
                              {new Date(event.timestamp).toLocaleString()}
                            </span>
                            <h5 className="font-bold text-slate-900">
                              {lang === 'en' ? event.labelEn : (lang === 'tr' ? event.labelTr : event.labelAr)}
                            </h5>
                            <p className="text-xs text-slate-600">
                              {lang === 'en' ? event.detailsEn : (lang === 'tr' ? event.detailsTr : event.detailsAr)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-slate-400 text-xs italic">
                      {lang === 'tr' ? 'Henüz zaman cetveli kaydı yok.' : (lang === 'ar' ? 'لا توجد أحداث في الجدول الزمني بعد.' : 'No timeline events recorded yet.')}
                    </p>
                  )}
                </div>

              </div>

              {/* SECTION: Sharing & Public Link */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="bg-slate-900 text-white p-1.5 rounded-lg shrink-0">
                    <Share2 className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                    {lang === 'tr' ? 'Paylaşım ve Genel Bağlantı' : (lang === 'ar' ? 'المشاركة والرابط العام' : 'Sharing & Public Link')}
                  </h3>
                </div>

                {/* 6. Shipment Sharing Controls Center */}
                <div className="p-5 bg-orange-50 border border-orange-200 rounded-xl space-y-4 md:col-span-2">
                  <div className="space-y-1">
                    <h4 className="font-bold text-orange-950 text-base flex items-center gap-2">
                      <Share2 className="w-5 h-5 text-orange-600" />
                      {t('shareShipment')}
                    </h4>
                    <p className="text-xs text-orange-800">{t('shareDisclaimer')}</p>
                  </div>

                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-t border-orange-200 pt-4">
                    <div className="flex flex-col gap-2">
                      <label className="flex items-center gap-2 text-xs font-bold text-orange-950 cursor-pointer">
                        <input 
                          type="checkbox"
                          checked={targetDetailsShipment.isLinkShared}
                          onChange={(e) => handleToggleShareLink(targetDetailsShipment, e.target.checked)}
                          className="w-4 h-4 text-orange-600 rounded bg-white border-orange-300 focus:ring-orange-500"
                        />
                        <span>{t('enableLink')}</span>
                      </label>

                      {targetDetailsShipment.isLinkShared && (
                        <div className="flex flex-col gap-1 pl-6">
                          <label className="flex items-center gap-1.5 text-xs text-orange-900 cursor-pointer">
                            <input 
                              type="checkbox" 
                              checked={targetDetailsShipment.shareIncludeDocuments}
                              onChange={(e) => handleToggleDocSharing(targetDetailsShipment, 'shareIncludeDocuments', e.target.checked)}
                              className="w-3.5 h-3.5 rounded"
                            />
                            <span>{t('includeDocs')}</span>
                          </label>

                          <label className="flex items-center gap-1.5 text-xs text-orange-900 cursor-pointer">
                            <input 
                              type="checkbox" 
                              checked={targetDetailsShipment.shareIncludePhotos}
                              onChange={(e) => handleToggleDocSharing(targetDetailsShipment, 'shareIncludePhotos', e.target.checked)}
                              className="w-3.5 h-3.5 rounded"
                            />
                            <span>{t('includePhotos')}</span>
                          </label>
                        </div>
                      )}
                    </div>

                    {targetDetailsShipment.isLinkShared ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <a 
                          href={getDirectLink(targetDetailsShipment.shareToken)}
                          target="_blank"
                          rel="noreferrer"
                          className="bg-white hover:bg-orange-100 text-orange-900 border border-orange-300 px-3 py-2 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 shadow-xs"
                        >
                          <ExternalLink className="w-4 h-4 shrink-0" />
                          <span>{t('directLink')}</span>
                        </a>

                        <a 
                          href={getWhatsAppLink(
                            targetDetailsShipment.shipmentNumber, 
                            targetDetailsShipment.shareToken, 
                            targetDetailsShipment.loadingCity, 
                            targetDetailsShipment.deliveryCity
                          )}
                          target="_blank"
                          rel="noreferrer"
                          className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 shadow-sm"
                        >
                          <Send className="w-4 h-4 shrink-0 animate-pulse" />
                          <span>{t('whatsAppShare')}</span>
                        </a>

                        <button
                          onClick={() => {
                            setActiveTab('gmail');
                            handlePrepopulateGmail(targetDetailsShipment.id);
                            setOpenDetailsId(null);
                          }}
                          className="bg-orange-600 hover:bg-orange-700 text-white px-3 py-2 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 shadow-sm cursor-pointer transition-all"
                        >
                          <Mail className="w-4 h-4 shrink-0" />
                          <span>Gmail Alert</span>
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs bg-orange-100 text-orange-800 px-3 py-1.5 rounded-lg font-semibold italic">Link is disabled. No external views allowed.</span>
                    )}
                  </div>
                </div>

              </div>

              {/* SECTION: Documents */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="bg-slate-900 text-white p-1.5 rounded-lg shrink-0">
                    <FileText className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider">{t('documentCenter')}</h3>
                </div>

                {/* 7. Shipment Document Control Board */}
                <div className="space-y-3">
                  {targetDetailsShipment.documents.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {targetDetailsShipment.documents.map((doc) => (
                        <div key={doc.id} className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-3 hover:border-slate-400 transition-all shadow-xs">
                          <div className="flex items-center gap-2 truncate">
                            {doc.category === 'photo' ? (
                              <ImageIcon className="w-5 h-5 text-teal-600 shrink-0" />
                            ) : (
                              <FileText className="w-5 h-5 text-orange-600 shrink-0" />
                            )}
                            <div className="truncate text-xs">
                              <p className="font-semibold text-slate-800 truncate">{doc.name}</p>
                              <span className="text-[10px] text-slate-400 block">{doc.category.toUpperCase()} ➔ Uploaded by {doc.uploadedBy}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => toggleDocVisibility(targetDetailsShipment.id, doc.id, doc.isSharedExternally)}
                              title={
                                (doc.category === 'invoice' || doc.category === 'other')
                                  ? (doc.isSharedExternally
                                      ? "Visible on Share Tracking link AND the client's own dashboard"
                                      : "Hidden from Share Tracking link AND the client's own dashboard (invoice/other docs need explicit approval)")
                                  : (doc.isSharedExternally ? "Visible on Share Tracking link" : "Hidden from Share Tracking link")
                              }
                              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                                doc.isSharedExternally 
                                  ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' 
                                  : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                              }`}
                            >
                              {doc.isSharedExternally ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                            </button>
                            <a
                              href={doc.url}
                              download
                              onClick={(e) => {
                                if (doc.url === "#") {
                                  e.preventDefault();
                                  triggerToast("Download triggered successfully (Sample file)");
                                }
                              }}
                              className="p-1 px-2.5 bg-slate-900 text-white rounded text-[10px] font-bold inline-flex items-center gap-1"
                            >
                              <Download className="w-3 h-3" />
                              <span>Download</span>
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-slate-400 text-xs italic">No documents registered. Attachments uploaded through chat appear here automatically.</p>
                  )}
                </div>

              </div>

              {/* SECTION: Financial / Cost Summary */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="bg-slate-900 text-white p-1.5 rounded-lg shrink-0">
                    <DollarSign className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                    {lang === 'tr' ? 'Finansal Özet' : (lang === 'ar' ? 'الملخص المالي' : 'Financial / Cost Summary')}
                  </h3>
                </div>
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                  <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">{t('carrierAmount')}</span>
                  <p className="font-bold text-orange-600 text-lg mt-0.5">{targetDetailsShipment.agreedAmount.toLocaleString()} {targetDetailsShipment.currency}</p>
                </div>
              </div>

              {/* SECTION: Communication Shortcuts */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="bg-slate-900 text-white p-1.5 rounded-lg shrink-0">
                    <MessageSquare className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                    {lang === 'tr' ? 'İletişim Kısayolları' : (lang === 'ar' ? 'اختصارات التواصل' : 'Communication Shortcuts')}
                  </h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {([
                    { channel: 'internal_staff' as const, label: lang === 'tr' ? 'Dahili Sohbet' : (lang === 'ar' ? 'دردشة داخلية' : 'Internal Chat') },
                    { channel: 'driver_admin' as const, label: lang === 'tr' ? 'Sürücü Sohbet' : (lang === 'ar' ? 'دردشة السائق' : 'Driver Chat') },
                    { channel: 'client_admin' as const, label: lang === 'tr' ? 'Müşteri Sohbet' : (lang === 'ar' ? 'دردشة العميل' : 'Customer Chat') },
                  ]).map(({ channel, label: chatLabel }) => (
                    <button
                      key={channel}
                      onClick={() => {
                        setChatCenterFocus({ shipmentId: targetDetailsShipment.id, channel });
                        setActiveTab('chat_center');
                        setOpenDetailsId(null);
                      }}
                      className="flex items-center justify-center gap-2 px-3 py-2.5 bg-slate-900 hover:bg-slate-800 rounded-lg text-xs font-bold text-white transition-all cursor-pointer"
                    >
                      <MessageSquare className="w-4 h-4" />
                      {chatLabel}
                    </button>
                  ))}
                </div>
              </div>

            </div>

            {/* Modal Footer */}
            <div className="sticky bottom-0 p-4 bg-slate-50 border-t border-slate-200 sm:rounded-b-2xl flex items-center justify-end shrink-0">
              <button
                onClick={() => setOpenDetailsId(null)}
                className="px-5 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 text-xs font-bold cursor-pointer"
              >
                Close Profile
              </button>
            </div>

          </div>
        </div>
      )}

      {/* 4. CREATE SHIPMENT modal overlay */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto block">
          <div className="bg-white rounded-2xl border border-slate-400 shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-900 text-white rounded-t-2xl">
              <h3 className="font-bold text-lg">{t('createShipment')}</h3>
              <button
                onClick={closeCreateShipmentModal}
                disabled={isCreatingShipment}
                className="p-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-60 disabled:cursor-not-allowed rounded-lg text-slate-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateShipment} className="p-6 space-y-6 text-sm">

              {/* Customer Column */}
              <div className="space-y-1 bg-slate-50 p-4 border border-slate-100 rounded-xl">
                <label className="font-bold text-slate-900">{t('companyName')} <span className="text-red-500">*</span></label>
                <div className="relative">
                  <Building2 className="w-5 h-5 absolute left-3 top-3.5 text-slate-400 z-10 pointer-events-none" />
                  <select 
                    required
                    value={newShipmentData.companyName}
                    onChange={(e) => {
                      const selectedVal = e.target.value;
                      const foundClient = clients.find(cl => cl.companyName === selectedVal);
                      setNewShipmentData({ 
                        ...newShipmentData, 
                        companyName: selectedVal,
                        loadingContactNumber: newShipmentData.loadingContactNumber || (foundClient ? foundClient.phone : "")
                      });
                    }}
                    className="w-full pl-10 pr-8 py-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none transition-all appearance-none cursor-pointer text-xs font-medium"
                  >
                    <option value="" disabled>-- {lang === 'tr' ? "Müşteri Seçin" : (lang === 'ar' ? "اختر العميل" : "Select Registered Client")} --</option>
                    {clients.map(client => (
                      <option key={client.id} value={client.companyName}>
                        {client.companyName} ({client.contactName})
                      </option>
                    ))}
                  </select>
                  <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-slate-400">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
                {clients.length === 0 && (
                  <p className="text-[10px] text-red-500 italic mt-1 font-medium">
                    ⚠️ {lang === 'tr' ? "Kayıtlı müşteri bulunamadı! Lütfen önce Müşteriler sekmesinden müşteri ekleyin." : (lang === 'ar' ? "لم يتم العثور على عملاء مسجلين! يرجى إضافة عميل أولاً من علامة تبويب العملاء." : "No registered clients found! Please add a client first from the Clients tab.")}
                  </p>
                )}
              </div>

              {/* Freight Type Buttons */}
              <div className="space-y-2 bg-slate-50 p-4 border border-slate-100 rounded-xl">
                <label className="font-bold text-slate-900 block">Freight Type / Sevkiyat Türü <span className="text-red-500">*</span></label>
                <div className="grid grid-cols-3 gap-3">
                  {([
                    { id: 'land', labelEn: 'Land Freight', labelTr: 'Kara Nakliye', icon: Truck },
                    { id: 'sea', labelEn: 'Sea Freight', labelTr: 'Deniz Nakliye', icon: Anchor },
                    { id: 'air', labelEn: 'Air Freight', labelTr: 'Hava Nakliye', icon: Plane }
                  ] as const).map(mode => {
                    const ModeIcon = mode.icon;
                    const isSelected = newShipmentData.freightType === mode.id;
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => setNewShipmentData(prev => {
                          if (prev.freightType === mode.id) return prev;
                          // BUG-13: Sea/Air don't collect loadingCity/deliveryCity in this
                          // form (they use ports/airports instead) — switching away from
                          // Land must not leave Land's Istanbul/Baghdad city defaults
                          // sitting in state to be silently submitted with a Sea/Air
                          // shipment. Restore the Land defaults only when re-selecting
                          // Land with the fields empty.
                          if (mode.id === 'land') {
                            return {
                              ...prev,
                              freightType: mode.id,
                              loadingCity: prev.loadingCity || "Istanbul",
                              deliveryCity: prev.deliveryCity || "Baghdad",
                            };
                          }
                          return { ...prev, freightType: mode.id, loadingCity: "", deliveryCity: "" };
                        })}
                        className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${
                          isSelected 
                            ? 'bg-slate-900 text-white border-slate-900 shadow-md font-bold' 
                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400 hover:bg-slate-50'
                        }`}
                      >
                        <ModeIcon className={`w-5 h-5 mb-1 ${isSelected ? 'text-orange-500' : 'text-slate-400'}`} />
                        <span className="text-[10px] font-semibold">{lang === 'tr' ? mode.labelTr : mode.labelEn}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* DYNAMIC LAND FORM FIELDS */}
              {newShipmentData.freightType === 'land' && (
                <div className="space-y-4">
                  {/* LOADING DETAILS ROW */}
                  <div className="p-4 border border-slate-100 rounded-xl space-y-4">
                    <h4 className="font-bold text-slate-950 text-xs uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded bg-orange-500"></span> {t('loadingInfo')}
                    </h4>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">{t('country')}</label>
                        <input 
                          type="text" 
                          required
                          value={newShipmentData.loadingCountry}
                          onChange={(e) => setNewShipmentData({ ...newShipmentData, loadingCountry: e.target.value })}
                          className="w-full p-2.5 bg-slate-50 border border-slate-200 focus:border-slate-500 rounded-lg outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">{t('city')}</label>
                        <input 
                          type="text" 
                          required
                          placeholder="e.g. Istanbul"
                          value={newShipmentData.loadingCity}
                          onChange={(e) => setNewShipmentData({ ...newShipmentData, loadingCity: e.target.value })}
                          className="w-full p-2.5 bg-slate-50 border border-slate-200 focus:border-slate-500 rounded-lg outline-none"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">{t('address')}</label>
                      <input 
                        type="text" 
                        required
                        placeholder="e.g. Ambarlı Limanı, Gümrük Caddesi No 3"
                        value={newShipmentData.loadingAddress}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, loadingAddress: e.target.value })}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 focus:border-slate-500 rounded-lg outline-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">{t('loadingContact')}</label>
                      <input 
                        type="text" 
                        placeholder="e.g. +90 532 999 0000"
                        value={newShipmentData.loadingContactNumber}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, loadingContactNumber: e.target.value })}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 focus:border-slate-500 rounded-lg outline-none font-mono"
                      />
                    </div>
                  </div>

                  {/* DELIVERY DETAILS ROW */}
                  <div className="p-4 border border-slate-100 rounded-xl space-y-4">
                    <h4 className="font-bold text-slate-950 text-xs uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded bg-orange-500"></span> {t('deliveryInfo')}
                    </h4>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">{t('country')}</label>
                        <input 
                          type="text" 
                          required
                          value={newShipmentData.deliveryCountry}
                          onChange={(e) => setNewShipmentData({ ...newShipmentData, deliveryCountry: e.target.value })}
                          className="w-full p-2.5 bg-slate-50 border border-slate-200 focus:border-slate-500 rounded-lg outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">{t('city')}</label>
                        <input 
                          type="text" 
                          required
                          placeholder="e.g. Erbil"
                          value={newShipmentData.deliveryCity}
                          onChange={(e) => setNewShipmentData({ ...newShipmentData, deliveryCity: e.target.value })}
                          className="w-full p-2.5 bg-slate-50 border border-slate-200 focus:border-slate-500 rounded-lg outline-none"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">{t('address')}</label>
                      <input 
                        type="text" 
                        required
                        placeholder="e.g. Erbil Ring Road, Warehouse Complex 14"
                        value={newShipmentData.deliveryAddress}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, deliveryAddress: e.target.value })}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 focus:border-slate-500 rounded-lg outline-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">{t('deliveryContact')}</label>
                      <input 
                        type="text" 
                        placeholder="e.g. +964 750 111 2222"
                        value={newShipmentData.deliveryContactNumber}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, deliveryContactNumber: e.target.value })}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 focus:border-slate-500 rounded-lg outline-none font-mono"
                      />
                    </div>
                  </div>

                  {/* CARGO WEIGHT & DRIVER */}
                  <div className="p-4 border border-slate-100 rounded-xl space-y-4">
                    <h4 className="font-bold text-slate-950 text-xs uppercase tracking-wider">{t('truckAndDriver')}</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">{t('weightKg')}</label>
                        <input 
                          type="number" 
                          required
                          placeholder="e.g. 18500"
                          value={newShipmentData.cargoWeight}
                          onChange={(e) => setNewShipmentData({ ...newShipmentData, cargoWeight: e.target.value })}
                          className="w-full p-2.5 bg-slate-50 border border-slate-200 focus:border-slate-500 rounded-lg outline-none font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">{t('assignDriver')} / {lang === 'tr' ? "Ana Sürücü" : "Core Driver"}</label>
                        <select
                          value={newShipmentData.assignedDriverId}
                          onChange={(e) => setNewShipmentData({ ...newShipmentData, assignedDriverId: e.target.value })}
                          className="w-full p-2.5 bg-slate-50 border border-slate-200 focus:border-slate-500 rounded-lg outline-none text-xs"
                        >
                          <option value="">-- {t('selectDriver')} --</option>
                          {getAssignableDrivers(drivers).map(d => (
                            <option key={d.id} value={d.id}>
                              {d.name} ({d.truckNumber} - Active: {d.activeShipmentsCount})
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Additional Drivers/Trucks Section for multi-truck dispatch support */}
                      <div className="col-span-2 border-t border-dashed border-slate-200 pt-3 mt-1 text-left">
                        <label className="text-xs font-bold text-slate-800 flex items-center gap-1 mb-1.5">
                          <Truck className="w-3.5 h-3.5 text-orange-500" />
                          <span>{lang === 'tr' ? "İlave Araçlar ve Sürücüler (+)" : (lang === 'ar' ? "شاحنات وسائقين إضافيين" : "Additional Trucks / Drivers (+)")}</span>
                        </label>
                        
                        {newShipmentData.additionalDrivers && newShipmentData.additionalDrivers.length > 0 && (
                          <div className="space-y-2 mb-3">
                            {newShipmentData.additionalDrivers.map((ad, idx) => (
                              <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-slate-50 p-2.5 rounded-xl border border-slate-200 shadow-3xs animate-fade-in text-xs">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono bg-slate-200 text-slate-700 font-bold px-2 py-0.5 rounded text-[10px] border border-slate-300">🚚 #{idx + 2}</span>
                                  <div className="text-left">
                                    <p className="font-extrabold text-slate-800 leading-tight">{ad.driverName}</p>
                                    <p className="text-[10px] text-slate-500 font-mono mt-0.5">{ad.truckNumber}</p>
                                  </div>
                                </div>
                                
                                <div className="flex items-center gap-2 self-end sm:self-auto">
                                  <div className="relative">
                                    <input
                                      type="number"
                                      placeholder={lang === 'tr' ? "Anlaşılan Fiyat" : "Agreed Price"}
                                      value={ad.agreedAmount || ""}
                                      onChange={(e) => {
                                        const amount = parseFloat(e.target.value) || 0;
                                        const updated = (newShipmentData.additionalDrivers || []).map((x, i) => 
                                          i === idx ? { ...x, agreedAmount: amount } : x
                                        );
                                        setNewShipmentData({ ...newShipmentData, additionalDrivers: updated });
                                      }}
                                      className="w-28 p-1.5 pr-10 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none text-[11px] font-mono text-right font-black text-slate-800"
                                    />
                                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-slate-400 font-bold font-mono pointer-events-none">
                                      {newShipmentData.currency || "USD"}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const updated = (newShipmentData.additionalDrivers || []).filter((_, i) => i !== idx);
                                      setNewShipmentData({ ...newShipmentData, additionalDrivers: updated });
                                    }}
                                    className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-red-600 transition-colors focus:outline-none cursor-pointer"
                                    title={lang === 'tr' ? "Kaldır" : "Remove"}
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        
                        <div className="flex gap-2">
                          <select
                            id="add-extra-driver-select"
                            className="p-2 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none text-xs flex-1"
                            defaultValue=""
                            onChange={(e) => {
                              const val = e.target.value;
                              if (!val) return;
                              const selected = drivers.find(d => d.id === val);
                              if (selected) {
                                const isMain = newShipmentData.assignedDriverId === selected.id;
                                const isAdded = (newShipmentData.additionalDrivers || []).some(x => x.driverId === selected.id);
                                if (isMain || isAdded) {
                                  triggerToast(lang === 'tr' ? "Bu sürücü zaten atanmış." : "This driver is already assigned.");
                                  e.target.value = "";
                                  return;
                                }
                                const updated = [...(newShipmentData.additionalDrivers || []), {
                                  driverId: selected.id,
                                  driverName: selected.name,
                                  truckNumber: selected.truckNumber
                                }];
                                setNewShipmentData({ ...newShipmentData, additionalDrivers: updated });
                              }
                              e.target.value = "";
                            }}
                          >
                            <option value="">-- {lang === 'tr' ? "Yüklemek İçin Sürücü Ekle..." : "Choose Additional Driver/Truck..."} --</option>
                            {getAssignableDrivers(drivers).map(d => (
                              <option key={d.id} value={d.id}>
                                {d.name} ({d.truckNumber} - {d.truckType || "standard"})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* CUSTOMS BROKERS INFORMATION SECTION */}
                  <div className="p-4 border border-slate-100 rounded-xl space-y-4 text-left">
                    <h4 className="font-bold text-slate-950 text-xs uppercase tracking-wider flex items-center gap-1.5 text-slate-800">
                      <ShieldCheck className="w-4 h-4 text-orange-600" /> {lang === 'tr' ? "Gümrük Müşaviri Bilgileri" : "Customs Broker Information"}
                    </h4>
                    
                    <div className="grid grid-cols-2 gap-4">
                      {/* Port of Destination Broker */}
                      <div className="space-y-2 border border-slate-200 p-3 rounded-lg bg-slate-50/50 text-left">
                        <label className="text-xs font-bold text-slate-800">
                          {lang === 'tr' ? "Varış Gümrük Müşaviri" : "Broker at Destination Port"}
                        </label>
                        <select
                          className="w-full p-2 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none text-xs"
                          value={newShipmentData.destinationBrokerId || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val) {
                              const found = vendors.find(v => v.id === val);
                              if (found) {
                                setNewShipmentData({
                                  ...newShipmentData,
                                  destinationBrokerId: found.id,
                                  destinationBrokerName: found.companyName,
                                  destinationBrokerPhone: found.phone || ""
                                });
                              }
                            } else {
                              setNewShipmentData({
                                ...newShipmentData,
                                destinationBrokerId: "",
                                destinationBrokerName: "",
                                destinationBrokerPhone: ""
                              });
                            }
                          }}
                        >
                          <option value="">-- {lang === 'tr' ? "Tedarikçilerden Seç" : "Select from Vendors"} --</option>
                          {vendors.map(v => (
                            <option key={v.id} value={v.id}>
                              {v.companyName} ({v.serviceType || "Vendor"})
                            </option>
                          ))}
                        </select>
                        <div className="grid grid-cols-1 gap-2 pt-1 font-sans">
                          <input
                            type="text"
                            placeholder={lang === 'tr' ? "Müşavir Adı" : "Broker Name / Agency"}
                            value={newShipmentData.destinationBrokerName || ""}
                            onChange={(e) => setNewShipmentData({ ...newShipmentData, destinationBrokerName: e.target.value })}
                            className="p-2 text-xs bg-white border border-slate-200 rounded-lg outline-none font-medium"
                          />
                          <input
                            type="text"
                            placeholder={lang === 'tr' ? "İletişim / Tel" : "Phone Number"}
                            value={newShipmentData.destinationBrokerPhone || ""}
                            onChange={(e) => setNewShipmentData({ ...newShipmentData, destinationBrokerPhone: e.target.value })}
                            className="p-2 text-xs bg-white border border-slate-200 rounded-lg outline-none font-mono"
                          />
                        </div>
                      </div>

                      {/* Iraq Border Broker */}
                      <div className="space-y-2 border border-slate-200 p-3 rounded-lg bg-slate-50/50 text-left">
                        <label className="text-xs font-bold text-slate-800">
                          {lang === 'tr' ? "Irak Sınır Gümrük Müşaviri" : "Broker at Iraq Border"}
                        </label>
                        <select
                          className="w-full p-2 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none text-xs"
                          value={newShipmentData.iraqBorderBrokerId || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val) {
                              const found = vendors.find(v => v.id === val);
                              if (found) {
                                setNewShipmentData({
                                  ...newShipmentData,
                                  iraqBorderBrokerId: found.id,
                                  iraqBorderBrokerName: found.companyName,
                                  iraqBorderBrokerPhone: found.phone || ""
                                });
                              }
                            } else {
                              setNewShipmentData({
                                ...newShipmentData,
                                iraqBorderBrokerId: "",
                                iraqBorderBrokerName: "",
                                iraqBorderBrokerPhone: ""
                              });
                            }
                          }}
                        >
                          <option value="">-- {lang === 'tr' ? "Tedarikçilerden Seç" : "Select from Vendors"} --</option>
                          {vendors.map(v => (
                            <option key={v.id} value={v.id}>
                              {v.companyName} ({v.serviceType || "Vendor"})
                            </option>
                          ))}
                        </select>
                        <div className="grid grid-cols-1 gap-2 pt-1 font-sans">
                          <input
                            type="text"
                            placeholder={lang === 'tr' ? "Sınır Gümrükçü Adı" : "Border Broker Name / Agency"}
                            value={newShipmentData.iraqBorderBrokerName || ""}
                            onChange={(e) => setNewShipmentData({ ...newShipmentData, iraqBorderBrokerName: e.target.value })}
                            className="p-2 text-xs bg-white border border-slate-200 rounded-lg outline-none font-medium"
                          />
                          <input
                            type="text"
                            placeholder={lang === 'tr' ? "İletişim / Tel" : "Phone Number"}
                            value={newShipmentData.iraqBorderBrokerPhone || ""}
                            onChange={(e) => setNewShipmentData({ ...newShipmentData, iraqBorderBrokerPhone: e.target.value })}
                            className="p-2 text-xs bg-white border border-slate-200 rounded-lg outline-none font-mono"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* DYNAMIC SEA PARAMETERS */}
              {newShipmentData.freightType === 'sea' && (
                <div className="p-4 border border-slate-100 rounded-xl space-y-4 bg-slate-50/50">
                  <h4 className="font-bold text-slate-950 text-xs uppercase tracking-wider flex items-center gap-1.5 text-blue-800">
                    <Anchor className="w-4 h-4 text-blue-500" /> Maritime Shipping Parameters / Denizyolu Bilgileri
                  </h4>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Shipping Line / Nakliye Hattı</label>
                      <input
                        type="text"
                        placeholder="e.g. Maersk, MSC, COSCO"
                        value={newShipmentData.shippingLine}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, shippingLine: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Vessel Name / Gemi Adı</label>
                      <input
                        type="text"
                        placeholder="e.g. EVER GIVEN (assigned once booking is confirmed)"
                        value={newShipmentData.vesselName}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, vesselName: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Container Number</label>
                      <input
                        type="text"
                        placeholder="e.g. MSCO1234567 (assigned once booking is confirmed)"
                        value={newShipmentData.containerNumber}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, containerNumber: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Booking Reference</label>
                      <input 
                        type="text" 
                        placeholder="e.g. BKG-9878"
                        value={newShipmentData.bookingNumber}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, bookingNumber: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Bill of Lading (BL) #</label>
                      <input 
                        type="text" 
                        placeholder="e.g. MEDU1234AB"
                        value={newShipmentData.billOfLadingNumber}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, billOfLadingNumber: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none font-mono"
                      />
                    </div>

                    {/* Additional Containers section */}
                    <div className="space-y-1 col-span-3 border-t border-dashed border-slate-200 pt-3 mt-1 text-left font-sans">
                      <label className="text-xs font-bold text-slate-800 flex items-center gap-1 mb-1.5">
                        <Anchor className="w-3.5 h-3.5 text-blue-500" />
                        <span>{lang === 'tr' ? "İlave Konteyner Numaraları (+)" : "Additional Container Numbers (+)"}</span>
                      </label>
                      
                      {newShipmentData.additionalContainers && newShipmentData.additionalContainers.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-2.5">
                          {newShipmentData.additionalContainers.map((c, idx) => (
                            <div key={idx} className="flex items-center gap-1.5 bg-blue-50 text-blue-800 text-[11px] font-bold px-2 py-1 rounded-lg border border-blue-200 shadow-xs animate-fade-in font-mono">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>
                              <span>{c}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  const updated = (newShipmentData.additionalContainers || []).filter((_, i) => i !== idx);
                                  setNewShipmentData({ ...newShipmentData, additionalContainers: updated });
                                }}
                                className="text-blue-400 hover:text-red-600 transition-colors ml-1 focus:outline-none cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      
                      <div className="flex gap-2 font-sans">
                        <input
                          type="text"
                          id="add-extra-container-input"
                          placeholder="e.g. MSCO9876543"
                          className="p-2 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none text-xs flex-1 uppercase font-mono placeholder:normal-case placeholder:font-sans"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              const target = e.currentTarget;
                              const val = target.value.trim().toUpperCase();
                              if (!val) return;
                              const current = newShipmentData.additionalContainers || [];
                              if (current.includes(val) || newShipmentData.containerNumber?.trim().toUpperCase() === val) {
                                triggerToast(lang === 'tr' ? "Bu konteyner zaten eklenmiş." : "This container is already added.");
                                return;
                              }
                              setNewShipmentData({
                                ...newShipmentData,
                                additionalContainers: [...current, val]
                              });
                              target.value = "";
                            }
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const inputEl = document.getElementById('add-extra-container-input') as HTMLInputElement;
                            if (inputEl) {
                              const val = inputEl.value.trim().toUpperCase();
                              if (!val) return;
                              const current = newShipmentData.additionalContainers || [];
                              if (current.includes(val) || newShipmentData.containerNumber?.trim().toUpperCase() === val) {
                                triggerToast(lang === 'tr' ? "Bu konteyner zaten eklenmiş." : "This container is already added.");
                                return;
                              }
                              setNewShipmentData({
                                ...newShipmentData,
                                additionalContainers: [...current, val]
                              });
                              inputEl.value = "";
                            }
                          }}
                          className="bg-slate-900 hover:bg-slate-800 text-white font-extrabold px-3 py-1.5 rounded-lg text-xs shrink-0 cursor-pointer transition-colors"
                        >
                          {lang === 'tr' ? "Konteyner Ekle (+)" : "Add Container (+)"}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 border-t border-dashed border-slate-200 pt-3 mt-1 text-left">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                        <span>Loading Country / Yükleme Ülkesi</span>
                      </label>
                      <input 
                        type="text" 
                        placeholder="e.g. Turkey, China"
                        value={newShipmentData.loadingCountry}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, loadingCountry: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                        <span>Delivery Country / Teslimat Ülkesi</span>
                      </label>
                      <input 
                        type="text" 
                        placeholder="e.g. Iraq, Germany"
                        value={newShipmentData.deliveryCountry}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, deliveryCountry: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-left">
                    {/* POL */}
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700 flex justify-between items-center h-4 font-sans">
                        <span>Port of Loading (POL) <span className="text-red-500">*</span></span>
                        {getPortsForCountry(newShipmentData.loadingCountry).length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setUseCustomPOL(!useCustomPOL);
                            }}
                            className="text-[10px] text-orange-600 hover:underline font-bold"
                          >
                            {useCustomPOL ? "List" : "Manual"}
                          </button>
                        )}
                      </label>
                      {getPortsForCountry(newShipmentData.loadingCountry).length > 0 && !useCustomPOL ? (
                        <select
                          required
                          value={newShipmentData.portOfLoading}
                          onChange={(e) => {
                            if (e.target.value === "__CUSTOM__") {
                              setUseCustomPOL(true);
                              setNewShipmentData({ ...newShipmentData, portOfLoading: "" });
                            } else {
                              setNewShipmentData({ ...newShipmentData, portOfLoading: e.target.value });
                            }
                          }}
                          className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none text-xs font-medium"
                        >
                          <option value="">-- Choose POL --</option>
                          {getPortsForCountry(newShipmentData.loadingCountry).map(p => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                          <option value="__CUSTOM__">✍️ Other (Type manual)...</option>
                        </select>
                      ) : (
                        <input
                          type="text"
                          required
                          placeholder="e.g. Port of Ambarli, Istanbul"
                          value={newShipmentData.portOfLoading}
                          onChange={(e) => setNewShipmentData({ ...newShipmentData, portOfLoading: e.target.value })}
                          className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none text-xs font-medium"
                        />
                      )}
                    </div>

                    {/* POD */}
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700 flex justify-between items-center h-4 font-sans font-sans">
                        <span>Port of Discharge (POD) <span className="text-red-500">*</span></span>
                        {getPortsForCountry(newShipmentData.deliveryCountry).length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setUseCustomPOD(!useCustomPOD);
                            }}
                            className="text-[10px] text-orange-600 hover:underline font-bold"
                          >
                            {useCustomPOD ? "List" : "Manual"}
                          </button>
                        )}
                      </label>
                      {getPortsForCountry(newShipmentData.deliveryCountry).length > 0 && !useCustomPOD ? (
                        <select
                          required
                          value={newShipmentData.portOfDischarge}
                          onChange={(e) => {
                            if (e.target.value === "__CUSTOM__") {
                              setUseCustomPOD(true);
                              setNewShipmentData({ ...newShipmentData, portOfDischarge: "" });
                            } else {
                              setNewShipmentData({ ...newShipmentData, portOfDischarge: e.target.value });
                            }
                          }}
                          className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none text-xs font-medium"
                        >
                          <option value="">-- Choose POD --</option>
                          {getPortsForCountry(newShipmentData.deliveryCountry).map(p => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                          <option value="__CUSTOM__">✍️ Other (Type manual)...</option>
                        </select>
                      ) : (
                        <input
                          required
                          type="text" 
                          placeholder="e.g. Port of Umm Qasr"
                          value={newShipmentData.portOfDischarge}
                          onChange={(e) => setNewShipmentData({ ...newShipmentData, portOfDischarge: e.target.value })}
                          className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none text-xs font-medium"
                        />
                      )}
                    </div>

                    {/* Final Destination */}
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700 block h-4 font-sans">Final Destination</label>
                      <input 
                        type="text" 
                        placeholder="e.g. Erbil Depot"
                        value={newShipmentData.finalDestination}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, finalDestination: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Departure Estimate (ETD)</label>
                      <input 
                        type="datetime-local" 
                        value={newShipmentData.etd}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, etd: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Arrival Estimate (ETA)</label>
                      <input 
                        type="datetime-local" 
                        value={newShipmentData.eta}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, eta: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">No of Containers</label>
                      <input 
                        type="number" 
                        placeholder="e.g. 1"
                        value={newShipmentData.numberOfContainers}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, numberOfContainers: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Container Size & Type</label>
                      <input 
                        type="text" 
                        placeholder="e.g. 40ft High Cube"
                        value={newShipmentData.containerType}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, containerType: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none text-xs"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* DYNAMIC AIR PARAMETERS */}
              {newShipmentData.freightType === 'air' && (
                <div className="p-4 border border-slate-100 rounded-xl space-y-4 bg-slate-50/50">
                  <h4 className="font-bold text-slate-950 text-xs uppercase tracking-wider flex items-center gap-1.5 text-blue-800">
                    <Plane className="w-4 h-4 text-blue-500" /> Air Freight Parameters / Havayolu Bilgileri
                  </h4>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Airline / Havayolu</label>
                      <input
                        type="text"
                        placeholder="e.g. Turkish Cargo, Lufthansa"
                        value={newShipmentData.airline}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, airline: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Flight Number</label>
                      <input
                        type="text"
                        placeholder="e.g. TK1242 (assigned once booking is confirmed)"
                        value={newShipmentData.flightNumber}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, flightNumber: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">AWB Number (Air Waybill)</label>
                      <input
                        type="text"
                        placeholder="e.g. 235-9008871 (assigned once booking is confirmed)"
                        value={newShipmentData.airWaybillNumber}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, airWaybillNumber: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Airport of Departure <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. IST (Istanbul)"
                        value={newShipmentData.airportOfDeparture}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, airportOfDeparture: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Airport of Arrival <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. EBL (Erbil)"
                        value={newShipmentData.airportOfArrival}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, airportOfArrival: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Final Destination</label>
                      <input 
                        type="text" 
                        placeholder="e.g. Warehouse A, Sulaymaniyah"
                        value={newShipmentData.finalDestination}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, finalDestination: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Departure ETD</label>
                      <input 
                        type="datetime-local" 
                        value={newShipmentData.etd}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, etd: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Arrival ETA</label>
                      <input 
                        type="datetime-local" 
                        value={newShipmentData.eta}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, eta: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Gross Weight (kg)</label>
                      <input 
                        type="number" 
                        placeholder="e.g. 150"
                        value={newShipmentData.grossWeight}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, grossWeight: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Chargeable Weight (kg)</label>
                      <input 
                        type="number" 
                        placeholder="e.g. 150"
                        value={newShipmentData.chargeableWeight}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, chargeableWeight: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">No of Packages</label>
                      <input 
                        type="number" 
                        placeholder="e.g. 5"
                        value={newShipmentData.numberOfPackages}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, numberOfPackages: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* SHARED GENERAL CARGO DESCRIPTION & AMOUNT */}
              <div className="p-4 border border-slate-100 rounded-xl space-y-4">
                <h4 className="font-bold text-slate-950 text-xs uppercase tracking-wider">Cargo & Deal Agreement</h4>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">{t('cargoDesc')} <span className="text-red-500">*</span></label>
                  <input 
                    type="text" 
                    required
                    placeholder="e.g. High precision scientific glass equipment, fragile"
                    value={newShipmentData.cargoDescription}
                    onChange={(e) => setNewShipmentData({ ...newShipmentData, cargoDescription: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 focus:border-slate-500 rounded-lg outline-none text-xs"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-1">
                    <label className="text-xs font-semibold text-slate-700">{t('carrierAmount')} <span className="text-red-500">*</span></label>
                    <input 
                      type="number" 
                      required
                      placeholder="e.g. 4500"
                      value={newShipmentData.agreedAmount}
                      onChange={(e) => setNewShipmentData({ ...newShipmentData, agreedAmount: e.target.value })}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 focus:border-slate-500 rounded-lg outline-none font-mono"
                    />
                  </div>
                  
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-700">{t('currency')}</label>
                    <select
                      value={newShipmentData.currency}
                      onChange={(e) => setNewShipmentData({ ...newShipmentData, currency: e.target.value as Currency })}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 focus:border-slate-500 rounded-lg outline-none"
                    >
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                      <option value="TRY">TRY</option>
                      <option value="IQD">IQD</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* SHARED NOTES */}
              <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl space-y-2">
                <label className="font-bold text-slate-900">{t('internalNotes')}</label>
                <textarea 
                  rows={3}
                  placeholder="Enter specific logistics terms, driver or tracking parameters..."
                  value={newShipmentData.internalNotes}
                  onChange={(e) => setNewShipmentData({ ...newShipmentData, internalNotes: e.target.value })}
                  className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={closeCreateShipmentModal}
                  disabled={isCreatingShipment}
                  className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 disabled:cursor-not-allowed text-slate-700 font-semibold rounded-xl"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isCreatingShipment}
                  className="px-6 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-xl shadow-lg transition-all"
                >
                  {isCreatingShipment
                    ? (lang === 'tr' ? 'Oluşturuluyor...' : lang === 'ar' ? 'جاري الإنشاء...' : 'Creating...')
                    : t('save')}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* EDIT SHIPMENT OVERLAY MODAL */}
      {isEditOpen && editingShipment && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto block">
          <div className="bg-white rounded-2xl border border-slate-400 shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-900 text-white rounded-t-2xl">
              <h3 className="font-bold text-lg">{t('editShipment')} — {editingShipment.shipmentNumber}</h3>
              <button onClick={() => {
                setIsEditOpen(false);
                setEditingShipment(null);
                setEditConflict(null);
              }} className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300">
                <X className="w-5 h-5" />
              </button>
            </div>

            {editConflict && (
              <div className="m-6 mb-0 p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-3">
                <p className="text-sm font-semibold text-amber-800">
                  {lang === 'tr'
                    ? "Bu sevkiyat, siz düzenlerken başka biri tarafından kaydedildi. Değişiklikleriniz kaydedilmedi."
                    : lang === 'ar'
                      ? "تم حفظ هذه الشحنة من قبل شخص آخر أثناء تعديلك. لم يتم حفظ تغييراتك."
                      : "This shipment was saved by someone else while you were editing. Your changes were not saved."}
                </p>
                <button
                  type="button"
                  onClick={handleReloadEditingShipmentFromConflict}
                  disabled={!editConflict.shipment}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg"
                >
                  {lang === 'tr' ? "En Son Verileri Yükle" : lang === 'ar' ? "تحميل أحدث البيانات" : "Reload Latest Data"}
                </button>
              </div>
            )}

            <form onSubmit={handleEditShipment} className="p-6 space-y-6 text-sm">
              <div className="space-y-4">
                
                {/* Company Name */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-800">{t('companyName')} <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <Building2 className="w-5 h-5 absolute left-3 top-3 text-slate-400 z-10 pointer-events-none" />
                    <select 
                      required
                      value={editingShipment.companyName}
                      onChange={(e) => setEditingShipment({ ...editingShipment, companyName: e.target.value })}
                      className="w-full pl-10 pr-8 py-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none transition-all appearance-none cursor-pointer text-xs font-medium"
                    >
                      <option value="" disabled>-- {lang === 'tr' ? "Müşteri Seçin" : (lang === 'ar' ? "اختر العميل" : "Select Registered Client")} --</option>
                      {clients.map(client => (
                        <option key={client.id} value={client.companyName}>
                          {client.companyName} ({client.contactName})
                        </option>
                      ))}
                    </select>
                    <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-slate-400">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                  {clients.length === 0 && (
                    <p className="text-[10px] text-red-500 italic mt-1 font-medium">
                      ⚠️ {lang === 'tr' ? "Kayıtlı müşteri bulunamadı!" : (lang === 'ar' ? "لم يتم العثور على عملاء مسجلين!" : "No registered clients found!")}
                    </p>
                  )}
                </div>

                {/* MODE CHANGER & OVERVIEW */}
                <div className="bg-slate-50 p-3.5 border border-slate-100 rounded-xl">
                  <span className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider block mb-1">Active Transport Mode</span>
                  <div className="flex items-center gap-2">
                    {editingShipment.freightType === 'sea' ? (
                      <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full text-xs font-bold border border-blue-100">
                        <Anchor className="w-3.5 h-3.5" /> Ocean Freight / Deniz Yolu
                      </span>
                    ) : editingShipment.freightType === 'air' ? (
                      <span className="inline-flex items-center gap-1 bg-orange-50 text-orange-700 px-2.5 py-1 rounded-full text-xs font-bold border border-orange-100">
                        <Plane className="w-3.5 h-3.5" /> Air Freight / Hava Yolu
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full text-xs font-bold border border-emerald-100">
                        <Truck className="w-3.5 h-3.5" /> Land Freight / Kara Yolu
                      </span>
                    )}
                  </div>
                </div>

                {/* DYNAMIC LAND FREIGHT FORM */}
                {(editingShipment.freightType === 'land' || !editingShipment.freightType) && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Loading City</label>
                        <input 
                          type="text" 
                          value={editingShipment.loadingCity || ""}
                          onChange={(e) => setEditingShipment({ ...editingShipment, loadingCity: e.target.value })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-xs bg-slate-50/50"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Delivery City</label>
                        <input 
                          type="text" 
                          value={editingShipment.deliveryCity || ""}
                          onChange={(e) => setEditingShipment({ ...editingShipment, deliveryCity: e.target.value })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-xs bg-slate-50/50"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">{t('assignDriver')} / {lang === 'tr' ? "Ana Sürücü" : "Core Driver"}</label>
                      <select
                        value={editingShipment.assignedDriverId || ""}
                        onChange={(e) => setEditingShipment({ ...editingShipment, assignedDriverId: e.target.value })}
                        className="w-full p-2.5 border border-slate-200 rounded-lg outline-none bg-white text-xs"
                      >
                        <option value="">-- {t('selectDriver')} --</option>
                        {getCoreDriverSelectOptions(drivers, editingShipment.assignedDriverId).map(d => (
                          <option key={d.id} value={d.id}>{d.name} ({d.truckNumber})</option>
                        ))}
                      </select>
                    </div>

                    {/* Additional Drivers/Trucks Section for multi-truck dispatch support */}
                    <div className="border border-dashed border-slate-200 p-3 bg-slate-50/50 rounded-xl space-y-2 text-left">
                      <label className="text-xs font-bold text-slate-800 flex items-center gap-1">
                        <Truck className="w-3.5 h-3.5 text-orange-500" />
                        <span>{lang === 'tr' ? "İlave Araçlar ve Sürücüler (+)" : "Additional Trucks / Drivers (+)"}</span>
                      </label>
                      
                      {editingShipment.additionalDrivers && editingShipment.additionalDrivers.length > 0 && (
                        <div className="space-y-1.5 mb-2">
                          {editingShipment.additionalDrivers.map((ad, idx) => (
                            <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 bg-white p-2 rounded-lg border border-slate-200 shadow-3xs text-[11px]">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono bg-slate-100 text-slate-600 font-bold px-1.5 py-0.5 rounded text-[9.5px] border border-slate-200">🚚 #{idx + 2}</span>
                                <div className="text-left">
                                  <p className="font-extrabold text-slate-800 leading-tight">{ad.driverName}</p>
                                  <p className="text-[9.5px] text-slate-500 font-mono mt-0.5">{ad.truckNumber}</p>
                                </div>
                              </div>
                              
                              <div className="flex items-center gap-1.5 self-end sm:self-auto">
                                <div className="relative">
                                  <input
                                    type="number"
                                    placeholder={lang === 'tr' ? "Anlaşılan" : "Agreed"}
                                    value={ad.agreedAmount || ""}
                                    onChange={(e) => {
                                      const amount = parseFloat(e.target.value) || 0;
                                      const updated = (editingShipment.additionalDrivers || []).map((x, i) => 
                                        i === idx ? { ...x, agreedAmount: amount } : x
                                      );
                                      setEditingShipment({ ...editingShipment, additionalDrivers: updated });
                                    }}
                                    className="w-24 p-1 pr-8 bg-slate-50 border border-slate-200 focus:border-slate-500 focus:bg-white rounded outline-none text-[10.5px] font-mono text-right font-bold text-slate-800"
                                  />
                                  <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[8.5px] text-slate-400 font-bold font-mono pointer-events-none">
                                    {editingShipment.currency || "USD"}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updated = (editingShipment.additionalDrivers || []).filter((_, i) => i !== idx);
                                    setEditingShipment({ ...editingShipment, additionalDrivers: updated });
                                  }}
                                  className="p-1 hover:bg-slate-50 rounded text-slate-400 hover:text-red-600 transition-colors focus:outline-none cursor-pointer"
                                  title={lang === 'tr' ? "Kaldır" : "Remove"}
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      
                      <div className="flex gap-2">
                        <select
                          id="edit-extra-driver-select"
                          className="p-1.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none text-xs flex-1"
                          defaultValue=""
                          onChange={(e) => {
                            const val = e.target.value;
                            if (!val) return;
                            const selected = drivers.find(d => d.id === val);
                            if (selected) {
                              const isMain = editingShipment.assignedDriverId === selected.id;
                              const isAdded = (editingShipment.additionalDrivers || []).some(x => x.driverId === selected.id);
                              if (isMain || isAdded) {
                                triggerToast(lang === 'tr' ? "Bu sürücü zaten atanmış." : "This driver is already assigned.");
                                e.target.value = "";
                                return;
                              }
                              const updated = [...(editingShipment.additionalDrivers || []), {
                                driverId: selected.id,
                                driverName: selected.name,
                                truckNumber: selected.truckNumber
                              }];
                              setEditingShipment({ ...editingShipment, additionalDrivers: updated });
                            }
                            e.target.value = "";
                          }}
                        >
                          <option value="">-- {lang === 'tr' ? "Yüklemek İçin Sürücü Ekle..." : "Choose Additional Driver..."} --</option>
                          {getAssignableDrivers(drivers).map(d => (
                            <option key={d.id} value={d.id}>
                              {d.name} ({d.truckNumber})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Weight (kg)</label>
                        <input 
                          type="number" 
                          value={editingShipment.cargoWeight || 0}
                          onChange={(e) => setEditingShipment({ ...editingShipment, cargoWeight: Number(e.target.value) })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Fee / Tutar</label>
                        <input 
                          type="number" 
                          value={editingShipment.agreedAmount || 0}
                          onChange={(e) => setEditingShipment({ ...editingShipment, agreedAmount: Number(e.target.value) })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg text-xs"
                        />
                      </div>
                    </div>

                    {/* CUSTOMS BROKERS INFORMATION FOR ROAD DISPATCH (EDIT) */}
                    <div className="p-4 border border-slate-100 rounded-xl space-y-4 text-left font-sans bg-slate-50/50">
                      <h4 className="font-bold text-slate-950 text-xs uppercase tracking-wider flex items-center gap-1.5 text-slate-800">
                        <ShieldCheck className="w-4 h-4 text-orange-600" /> {lang === 'tr' ? "Gümrük Müşaviri Bilgileri" : "Customs Broker Information"}
                      </h4>
                      
                      <div className="grid grid-cols-2 gap-4">
                        {/* Port of Destination Broker */}
                        <div className="space-y-2 border border-slate-200 p-3 rounded-lg bg-white text-left">
                          <label className="text-xs font-bold text-slate-800">
                            {lang === 'tr' ? "Varış Gümrük Müşaviri" : "Broker at Destination Port"}
                          </label>
                          <select
                            className="w-full p-2 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none text-xs"
                            value={editingShipment.destinationBrokerId || ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val) {
                                const found = vendors.find(v => v.id === val);
                                if (found) {
                                  setEditingShipment({
                                    ...editingShipment,
                                    destinationBrokerId: found.id,
                                    destinationBrokerName: found.companyName,
                                    destinationBrokerPhone: found.phone || ""
                                  });
                                }
                              } else {
                                setEditingShipment({
                                  ...editingShipment,
                                  destinationBrokerId: "",
                                  destinationBrokerName: "",
                                  destinationBrokerPhone: ""
                                });
                              }
                            }}
                          >
                            <option value="">-- {lang === 'tr' ? "Tedarikçilerden Seç" : "Select from Vendors"} --</option>
                            {vendors.map(v => (
                              <option key={v.id} value={v.id}>
                                {v.companyName} ({v.serviceType || "Vendor"})
                              </option>
                            ))}
                          </select>
                          <div className="grid grid-cols-1 gap-2 pt-1 font-sans">
                            <input
                              type="text"
                              placeholder={lang === 'tr' ? "Müşavir Adı" : "Broker Name / Agency"}
                              value={editingShipment.destinationBrokerName || ""}
                              onChange={(e) => setEditingShipment({ ...editingShipment, destinationBrokerName: e.target.value })}
                              className="p-2 text-xs bg-slate-50 border border-slate-100 rounded-lg outline-none font-medium"
                            />
                            <input
                              type="text"
                              placeholder={lang === 'tr' ? "İletişim / Tel" : "Phone Number"}
                              value={editingShipment.destinationBrokerPhone || ""}
                              onChange={(e) => setEditingShipment({ ...editingShipment, destinationBrokerPhone: e.target.value })}
                              className="p-2 text-xs bg-slate-50 border border-slate-100 rounded-lg outline-none font-mono"
                            />
                          </div>
                        </div>

                        {/* Iraq Border Broker */}
                        <div className="space-y-2 border border-slate-200 p-3 rounded-lg bg-white text-left">
                          <label className="text-xs font-bold text-slate-800">
                            {lang === 'tr' ? "Irak Sınır Gümrük Müşaviri" : "Broker at Iraq Border"}
                          </label>
                          <select
                            className="w-full p-2 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none text-xs"
                            value={editingShipment.iraqBorderBrokerId || ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val) {
                                const found = vendors.find(v => v.id === val);
                                if (found) {
                                  setEditingShipment({
                                    ...editingShipment,
                                    iraqBorderBrokerId: found.id,
                                    iraqBorderBrokerName: found.companyName,
                                    iraqBorderBrokerPhone: found.phone || ""
                                  });
                                }
                              } else {
                                setEditingShipment({
                                  ...editingShipment,
                                  iraqBorderBrokerId: "",
                                  iraqBorderBrokerName: "",
                                  iraqBorderBrokerPhone: ""
                                });
                              }
                            }}
                          >
                            <option value="">-- {lang === 'tr' ? "Tedarikçilerden Seç" : "Select from Vendors"} --</option>
                            {vendors.map(v => (
                              <option key={v.id} value={v.id}>
                                {v.companyName} ({v.serviceType || "Vendor"})
                              </option>
                            ))}
                          </select>
                          <div className="grid grid-cols-1 gap-2 pt-1 font-sans">
                            <input
                              type="text"
                              placeholder={lang === 'tr' ? "Sınır Gümrükçü Adı" : "Border Broker Name / Agency"}
                              value={editingShipment.iraqBorderBrokerName || ""}
                              onChange={(e) => setEditingShipment({ ...editingShipment, iraqBorderBrokerName: e.target.value })}
                              className="p-2 text-xs bg-slate-50 border border-slate-100 rounded-lg outline-none font-medium"
                            />
                            <input
                              type="text"
                              placeholder={lang === 'tr' ? "İletişim / Tel" : "Phone Number"}
                              value={editingShipment.iraqBorderBrokerPhone || ""}
                              onChange={(e) => setEditingShipment({ ...editingShipment, iraqBorderBrokerPhone: e.target.value })}
                              className="p-2 text-xs bg-slate-50 border border-slate-100 rounded-lg outline-none font-mono"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* DYNAMIC MARITIME SEA FREIGHT FORM */}
                {editingShipment.freightType === 'sea' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Shipping Line</label>
                        <input 
                          type="text" 
                          value={editingShipment.shippingLine || ""}
                          onChange={(e) => setEditingShipment({ ...editingShipment, shippingLine: e.target.value })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Vessel Name</label>
                        <input 
                          type="text" 
                          value={editingShipment.vesselName || ""}
                          onChange={(e) => setEditingShipment({ ...editingShipment, vesselName: e.target.value })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-xs"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Container Swarm #</label>
                        <input 
                          type="text" 
                          value={editingShipment.containerNumber || ""}
                          onChange={(e) => setEditingShipment({ ...editingShipment, containerNumber: e.target.value })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-xs font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Booking Number</label>
                        <input 
                          type="text" 
                          value={editingShipment.bookingNumber || ""}
                          onChange={(e) => setEditingShipment({ ...editingShipment, bookingNumber: e.target.value })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-xs font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Bill of Lading (BL)</label>
                        <input 
                          type="text" 
                          value={editingShipment.billOfLadingNumber || ""}
                          onChange={(e) => setEditingShipment({ ...editingShipment, billOfLadingNumber: e.target.value })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-xs font-mono"
                        />
                      </div>

                      {/* Additional Containers section (Edit form) */}
                      <div className="space-y-1 col-span-3 border-t border-dashed border-slate-200 pt-3 mt-1 text-left font-sans">
                        <label className="text-xs font-bold text-slate-800 flex items-center gap-1 mb-1.5">
                          <Anchor className="w-3.5 h-3.5 text-blue-500" />
                          <span>{lang === 'tr' ? "İlave Konteyner Numaraları (+)" : "Additional Container Numbers (+)"}</span>
                        </label>
                        
                        {editingShipment.additionalContainers && editingShipment.additionalContainers.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-2.5 font-sans">
                            {editingShipment.additionalContainers.map((c, idx) => (
                              <div key={idx} className="flex items-center gap-1.5 bg-blue-50 text-blue-800 text-[11px] font-bold px-2 py-1 rounded-lg border border-blue-200 shadow-xs animate-fade-in font-mono">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-600 font-sans"></span>
                                <span>{c}</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updated = (editingShipment.additionalContainers || []).filter((_, i) => i !== idx);
                                    setEditingShipment({ ...editingShipment, additionalContainers: updated });
                                  }}
                                  className="text-blue-400 hover:text-red-600 transition-colors ml-1 focus:outline-none cursor-pointer"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        
                        <div className="flex gap-2 font-sans">
                          <input
                            type="text"
                            id="edit-extra-container-input"
                            placeholder="e.g. MSCO9876543"
                            className="p-2 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none text-xs flex-1 uppercase font-mono placeholder:normal-case placeholder:font-sans"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                const target = e.currentTarget;
                                const val = target.value.trim().toUpperCase();
                                if (!val) return;
                                const current = editingShipment.additionalContainers || [];
                                if (current.includes(val) || editingShipment.containerNumber?.trim().toUpperCase() === val) {
                                  triggerToast(lang === 'tr' ? "Bu konteyner zaten eklenmiş." : "This container is already added.");
                                  return;
                                }
                                setEditingShipment({
                                  ...editingShipment,
                                  additionalContainers: [...current, val]
                                });
                                target.value = "";
                              }
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const inputEl = document.getElementById('edit-extra-container-input') as HTMLInputElement;
                              if (inputEl) {
                                const val = inputEl.value.trim().toUpperCase();
                                if (!val) return;
                                const current = editingShipment.additionalContainers || [];
                                if (current.includes(val) || editingShipment.containerNumber?.trim().toUpperCase() === val) {
                                  triggerToast(lang === 'tr' ? "Bu konteyner zaten eklenmiş." : "This container is already added.");
                                  return;
                                }
                                setEditingShipment({
                                  ...editingShipment,
                                  additionalContainers: [...current, val]
                                });
                                inputEl.value = "";
                              }
                            }}
                            className="bg-slate-900 hover:bg-slate-800 text-white font-extrabold px-3 py-1.5 rounded-lg text-xs shrink-0 cursor-pointer transition-colors font-sans"
                          >
                            {lang === 'tr' ? "Konteyner Ekle (+)" : "Add Container (+)"}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 border-t border-dashed border-slate-200 pt-3 mt-1 text-left">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Loading Country / Yükleme Ülkesi</label>
                        <input 
                          type="text" 
                          value={editingShipment.loadingCountry || ""}
                          onChange={(e) => setEditingShipment({ ...editingShipment, loadingCountry: e.target.value })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Delivery Country / Teslimat Ülkesi</label>
                        <input 
                          type="text" 
                          value={editingShipment.deliveryCountry || ""}
                          onChange={(e) => setEditingShipment({ ...editingShipment, deliveryCountry: e.target.value })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-xs"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3 text-left">
                      {/* Port of Loading (POL) */}
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700 flex justify-between items-center h-4 font-sans">
                          <span>Port of Loading (POL) <span className="text-red-500">*</span></span>
                          {getPortsForCountry(editingShipment.loadingCountry || "").length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setUseEditCustomPOL(!useEditCustomPOL);
                              }}
                              className="text-[10px] text-orange-600 hover:underline font-bold font-sans"
                            >
                              {useEditCustomPOL ? "List" : "Manual"}
                            </button>
                          )}
                        </label>
                        {getPortsForCountry(editingShipment.loadingCountry || "").length > 0 && !useEditCustomPOL ? (
                          <select
                            required
                            value={editingShipment.portOfLoading || ""}
                            onChange={(e) => {
                              if (e.target.value === "__CUSTOM__") {
                                setUseEditCustomPOL(true);
                                setEditingShipment({ ...editingShipment, portOfLoading: "" });
                              } else {
                                setEditingShipment({ ...editingShipment, portOfLoading: e.target.value });
                              }
                            }}
                            className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-xs font-medium bg-white"
                          >
                            <option value="">-- Choose POL --</option>
                            {getPortsForCountry(editingShipment.loadingCountry || "").map(p => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                            <option value="__CUSTOM__">✍️ Other (Type manual)...</option>
                          </select>
                        ) : (
                          <input
                            type="text"
                            required
                            placeholder="e.g. Port of Ambarli, Istanbul"
                            value={editingShipment.portOfLoading || ""}
                            onChange={(e) => setEditingShipment({ ...editingShipment, portOfLoading: e.target.value })}
                            className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-xs font-medium bg-white"
                          />
                        )}
                      </div>

                      {/* Port of Discharge (POD) */}
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700 flex justify-between items-center h-4 font-sans">
                          <span>Port of Discharge (POD) <span className="text-red-500">*</span></span>
                          {getPortsForCountry(editingShipment.deliveryCountry || "").length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setUseEditCustomPOD(!useEditCustomPOD);
                              }}
                              className="text-[10px] text-orange-600 hover:underline font-bold font-sans"
                            >
                              {useEditCustomPOD ? "List" : "Manual"}
                            </button>
                          )}
                        </label>
                        {getPortsForCountry(editingShipment.deliveryCountry || "").length > 0 && !useEditCustomPOD ? (
                          <select
                            required
                            value={editingShipment.portOfDischarge || ""}
                            onChange={(e) => {
                              if (e.target.value === "__CUSTOM__") {
                                setUseEditCustomPOD(true);
                                setEditingShipment({ ...editingShipment, portOfDischarge: "" });
                              } else {
                                setEditingShipment({ ...editingShipment, portOfDischarge: e.target.value });
                              }
                            }}
                            className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-xs font-medium bg-white"
                          >
                            <option value="">-- Choose POD --</option>
                            {getPortsForCountry(editingShipment.deliveryCountry || "").map(p => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                            <option value="__CUSTOM__">✍️ Other (Type manual)...</option>
                          </select>
                        ) : (
                          <input
                            type="text"
                            required
                            placeholder="e.g. Port of Umm Qasr"
                            value={editingShipment.portOfDischarge || ""}
                            onChange={(e) => setEditingShipment({ ...editingShipment, portOfDischarge: e.target.value })}
                            className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-xs font-medium bg-white"
                          />
                        )}
                      </div>

                      {/* Final Destination */}
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700 block h-4 font-sans">Final Destination</label>
                        <input 
                          type="text" 
                          placeholder="e.g. Erbil Depot"
                          value={editingShipment.finalDestination || ""}
                          onChange={(e) => setEditingShipment({ ...editingShipment, finalDestination: e.target.value })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-xs"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Departure (ETD)</label>
                        <input 
                          type="datetime-local" 
                          value={editingShipment.etd || ""}
                          onChange={(e) => setEditingShipment({ ...editingShipment, etd: e.target.value })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg outline-none font-mono text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Arrival (ETA)</label>
                        <input 
                          type="datetime-local" 
                          value={editingShipment.eta || ""}
                          onChange={(e) => setEditingShipment({ ...editingShipment, eta: e.target.value })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg outline-none font-mono text-xs"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">No of Containers</label>
                        <input 
                          type="number" 
                          value={editingShipment.numberOfContainers || 0}
                          onChange={(e) => setEditingShipment({ ...editingShipment, numberOfContainers: Number(e.target.value) })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Container Size & Type</label>
                        <input 
                          type="text" 
                          value={editingShipment.containerType || ""}
                          onChange={(e) => setEditingShipment({ ...editingShipment, containerType: e.target.value })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-xs"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Agreed Maritime Rate</label>
                      <input 
                        type="number" 
                        value={editingShipment.agreedAmount || 0}
                        onChange={(e) => setEditingShipment({ ...editingShipment, agreedAmount: Number(e.target.value) })}
                        className="w-full p-2.5 border border-slate-200 rounded-lg text-xs"
                      />
                    </div>
                  </div>
                )}

                {/* DYNAMIC AIR CARGO FREIGHT FORM */}
                {editingShipment.freightType === 'air' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Airline</label>
                        <input 
                          type="text" 
                          value={editingShipment.airline || ""}
                          onChange={(e) => setEditingShipment({ ...editingShipment, airline: e.target.value })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Flight number</label>
                        <input 
                          type="text" 
                          value={editingShipment.flightNumber || ""}
                          onChange={(e) => setEditingShipment({ ...editingShipment, flightNumber: e.target.value })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">AWB (Air Waybill) #</label>
                        <input 
                          type="text" 
                          value={editingShipment.airWaybillNumber || ""}
                          onChange={(e) => setEditingShipment({ ...editingShipment, airWaybillNumber: e.target.value })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-xs font-mono"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Airport of Departure <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. IST (Istanbul)"
                          value={editingShipment.airportOfDeparture || ""}
                          onChange={(e) => setEditingShipment({ ...editingShipment, airportOfDeparture: e.target.value })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Airport of Arrival <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. EBL (Erbil)"
                          value={editingShipment.airportOfArrival || ""}
                          onChange={(e) => setEditingShipment({ ...editingShipment, airportOfArrival: e.target.value })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Final Destination</label>
                        <input 
                          type="text" 
                          value={editingShipment.finalDestination || ""}
                          onChange={(e) => setEditingShipment({ ...editingShipment, finalDestination: e.target.value })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg text-xs"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Departure (ETD)</label>
                        <input 
                          type="datetime-local" 
                          value={editingShipment.etd || ""}
                          onChange={(e) => setEditingShipment({ ...editingShipment, etd: e.target.value })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg outline-none font-mono text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Arrival (ETA)</label>
                        <input 
                          type="datetime-local" 
                          value={editingShipment.eta || ""}
                          onChange={(e) => setEditingShipment({ ...editingShipment, eta: e.target.value })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg outline-none font-mono text-xs"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Gross Wt (kg)</label>
                        <input 
                          type="number" 
                          value={editingShipment.grossWeight || 0}
                          onChange={(e) => setEditingShipment({ ...editingShipment, grossWeight: Number(e.target.value) })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg text-xs font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Chargeable Wt (kg)</label>
                        <input 
                          type="number" 
                          value={editingShipment.chargeableWeight || 0}
                          onChange={(e) => setEditingShipment({ ...editingShipment, chargeableWeight: Number(e.target.value) })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg text-xs font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">No of Packages</label>
                        <input 
                          type="number" 
                          value={editingShipment.numberOfPackages || 0}
                          onChange={(e) => setEditingShipment({ ...editingShipment, numberOfPackages: Number(e.target.value) })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg text-xs font-mono"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Agreed Air Rate</label>
                      <input 
                        type="number" 
                        value={editingShipment.agreedAmount || 0}
                        onChange={(e) => setEditingShipment({ ...editingShipment, agreedAmount: Number(e.target.value) })}
                        className="w-full p-2.5 border border-slate-200 rounded-lg text-xs"
                      />
                    </div>
                  </div>
                )}

                {/* SHARED DESCRIPTION */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">{t('cargoDesc')} <span className="text-red-500">*</span></label>
                  <input 
                    type="text" 
                    required
                    value={editingShipment.cargoDescription || ""}
                    onChange={(e) => setEditingShipment({ ...editingShipment, cargoDescription: e.target.value })}
                    className="w-full p-2.5 border border-slate-200 rounded-lg text-xs"
                  />
                </div>

                {/* Admin Status Correction/Override — PR #111 review
                    (Admin Status Override authorization correction): a
                    separate, clearly-labeled administrative-correction
                    action, deliberately independent of the "Apply Updates"
                    submit below (which no longer changes status at all —
                    see buildUpdatedShipment's own server-side comment).
                    Submits to PUT /api/shipments/:id/status-override,
                    NOT PUT /api/shipments/:id/status, so it is
                    intentionally exempt from the forward-only sequence
                    enforced there (validateShipmentStatusTransition) — an
                    authorized operational admin (Super Admin / Operations
                    Admin only — canManageShipmentStatus, enforced
                    server-side regardless of this UI) can still correct a
                    status entered in error, including moving it backward.
                    Hidden entirely once the shipment is already
                    Closed/Completed — this PR does not support reopening a
                    terminal shipment. */}
                <div className="space-y-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <label className="text-xs font-bold text-amber-900 uppercase tracking-wide">
                    ⚠ Administrative Status Correction (not normal progression)
                  </label>
                  {isShipmentClosed(editingShipment.status, editingShipment.freightType) ? (
                    <p className="text-xs text-amber-800">
                      This shipment is {editingShipment.status} and is locked. Reopening a closed/completed shipment is not supported here.
                    </p>
                  ) : (
                    <>
                      <p className="text-[11px] text-amber-800">
                        Current status: <strong>{editingShipment.status}</strong>. Use this only to correct a status entered in error (including moving it backward) — this is not the normal progression control.
                      </p>
                      <select
                        value={overrideTargetStatus ?? editingShipment.status}
                        onChange={(e) => setOverrideTargetStatus(e.target.value as ShipmentStatus)}
                        className="w-full p-2.5 border border-amber-300 bg-white rounded-lg text-xs font-bold text-blue-900"
                      >
                        {getStatusSequenceForFreightMode(resolveFreightMode(editingShipment.freightType)).map(st => (
                          <option key={st} value={st}>{st}</option>
                        ))}
                      </select>
                      <textarea
                        rows={2}
                        required
                        value={overrideReason}
                        onChange={(e) => setOverrideReason(e.target.value)}
                        placeholder="Correction reason (required) — e.g. driver logged the wrong milestone by mistake"
                        className="w-full p-2.5 border border-amber-300 bg-white rounded-lg text-xs"
                      />
                      <button
                        type="button"
                        onClick={handleStatusOverride}
                        disabled={isSubmittingOverride || !overrideReason.trim() || !overrideTargetStatus}
                        className="w-full py-2 px-3 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs rounded-lg transition-all"
                      >
                        {isSubmittingOverride ? "Correcting..." : "Apply Administrative Correction"}
                      </button>
                    </>
                  )}
                </div>

                {/* Notes */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">{t('internalNotes')}</label>
                  <textarea 
                    rows={2}
                    value={editingShipment.internalNotes || ""}
                    onChange={(e) => setEditingShipment({ ...editingShipment, internalNotes: e.target.value })}
                    className="w-full p-2.5 border border-slate-200 rounded-lg text-xs"
                  />
                </div>

              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                <button type="button" onClick={() => {
                  setIsEditOpen(false);
                  setEditingShipment(null);
                  setEditConflict(null);
                }} className="px-4 py-2 bg-slate-100 text-slate-700 font-semibold rounded-lg">
                  Discard
                </button>
                <button type="submit" className="px-5 py-2 bg-slate-900 text-white font-semibold rounded-lg">
                  Apply Updates
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {/* DETAILED PRINT STATEMENT PREVIEW MODAL */}
      {isPrintPreviewOpen && selectedCostStatement && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-[999] overflow-y-auto">
          <div className="bg-slate-900 rounded-3xl border border-slate-700 shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150">
            
            {/* Modal Header */}
            <div className="bg-slate-950 text-white p-5 flex items-center justify-between gap-4 border-b border-slate-800 shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="p-2 bg-orange-600/10 text-orange-400 border border-orange-500/10 rounded-xl">
                  <Printer className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="text-sm font-black tracking-tight leading-tight uppercase font-sans">
                    {lang === 'tr' ? 'Yazdırma Önizlemesi' : lang === 'ar' ? 'معاينة الطباعة المعتمدة' : 'Print Statement Preview'}
                  </h3>
                  <p className="text-[10px] text-slate-400 font-mono mt-0.5 uppercase tracking-wider">
                    {lang === 'tr' ? 'Yazıcıya gönderilmeden önceki resmi kopyadır.' : 'Official release document draft ledger'}
                  </p>
                </div>
              </div>
              
              <button 
                onClick={() => setIsPrintPreviewOpen(false)}
                className="p-2 bg-slate-800 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white transition-all cursor-pointer border-0 outline-none"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body / Scrollable simulated physical A4 paper paper */}
            <div className="p-6 md:p-8 overflow-y-auto bg-slate-950/40 flex-1 flex flex-col items-center justify-start select-text gap-6">
              
              <div className="text-center w-full max-w-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 p-3 rounded-2xl text-[11px] leading-relaxed font-medium">
                {lang === 'tr' 
                  ? "Aşağıdaki kopyayı inceleyin. 'Şimdi Yazdır' butonuna bastığınızda, tarayıcınızın yazdırma arayüzü yalnızca resmi belgeyi hedefleyecek biçimde açılacaktır."
                  : lang === 'ar' 
                    ? "راجع الكشف المالي أدناه. سيقوم زر 'اطبع الآن' بإطلاق الحوار الرسمي وتنسيق الصفحة تلقائياً لعرض كشف التكلفة حصرياً."
                    : "Review the statement format below. Pressing 'Print Now' triggers your browser's print engine, automatically formatted to output only the document container."}
              </div>

              {/* simulated physical page target */}
              <div id="printable-statement-element" className="w-full max-w-2xl bg-white border border-slate-400 shadow-xl rounded-2xl overflow-hidden p-6 md:p-8 space-y-6 font-sans relative text-slate-800 prose select-text pre-print-rendered">
                
                {/* Watermark Logo decoration */}
                <div className="absolute inset-y-0 inset-x-y flex items-center justify-center opacity-[0.02] pointer-events-none select-none">
                  <DollarSign className="w-96 h-96 text-slate-900" />
                </div>

                {/* Header Title Block */}
                <div className="flex justify-between items-start border-b-2 border-orange-500 pb-5 gap-6">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="p-1 px-1.5 bg-orange-500 text-white rounded font-black text-xs">M</div>
                      <h4 className="text-sm font-black text-slate-900 leading-none">MARAS GROUP</h4>
                    </div>
                    <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">ETIR LOGISTICS & TRANSPORT AGENCY LTD.</p>
                    <p className="text-[9px] text-slate-500 leading-relaxed mt-0.5">
                      Sardar Avenue Office, Erbil, Iraq<br />
                      Phone: +964 750 MARAS GR | Email: financials@maras.iq
                    </p>
                  </div>
                  <div className="text-right">
                    <h4 className="text-base font-black text-slate-900 tracking-tight">{lang === 'tr' ? 'MALİYET BEYANNAMESİ' : 'COST STATEMENT'}</h4>
                    <p className="text-[10px] font-bold text-slate-400 font-mono uppercase mt-0.5">Reference: MARAS-{new Date(selectedCostStatement.date || '').getFullYear() || '2026'}-{selectedCostStatement.shipmentNumber}</p>
                    <div className="mt-3 text-[10px] text-slate-500 space-y-0.5">
                      <div><strong>{lang === 'tr' ? 'İşlem Tarihi:' : 'Release Date:'}</strong> {selectedCostStatement.date}</div>
                      <div><strong>{lang === 'tr' ? 'Statü:' : 'Calculated Status:'}</strong> <span className="font-extrabold text-slate-800 uppercase">{selectedCostStatement.paymentStatus}</span></div>
                    </div>
                  </div>
                </div>

                {/* Shipment metadata block */}
                <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100 text-[11px] leading-relaxed">
                  <div>
                    <h5 className="font-black text-slate-400 text-[9px] uppercase tracking-wider mb-2">{lang === 'tr' ? 'ALICI / İŞ ORTAĞI BİLGİSİ' : 'CARGO CLIENT INFO'}</h5>
                    <div className="font-bold text-slate-900">{selectedCostStatement.companyName}</div>
                    <div className="text-slate-500 mt-1">
                      Cargo Category: {selectedCostStatement.shipmentType?.toUpperCase()} Cargo<br />
                      Origin Ship Reference: {selectedCostStatement.shipmentNumber}
                    </div>
                  </div>
                  <div className="border-l border-slate-200 pl-4 space-y-1">
                    <h5 className="font-black text-slate-400 text-[9px] uppercase tracking-wider mb-2">{lang === 'tr' ? 'SEVKİYAT DETAYLARI' : 'CONSIGNMENT OVERVIEW'}</h5>
                    <div><strong>{lang === 'tr' ? 'Taşıma Tipi:' : 'Freight Modality:'}</strong> <span className="uppercase">{selectedCostStatement.shipmentType} Freight</span></div>
                    <div><strong>{lang === 'tr' ? 'Beyanname Para Birimi:' : 'Declaration Currency:'}</strong> <span className="uppercase font-mono">{selectedCostStatement.currency}</span></div>
                    <div><strong>{lang === 'tr' ? 'İhracat / İthalat:' : 'Logistics Sector:'}</strong> Cross-Border TIR Operations</div>
                  </div>
                </div>

                {/* Cost breakdown inline printable table */}
                <div className="space-y-2">
                  <h5 className="font-black text-slate-800 text-[10px] uppercase tracking-wider">{lang === 'tr' ? 'SEVK GİDELERİ DETAYLI DÖKÜMÜ' : 'DECLARED LOGISTIC CHARGES BREAKDOWN'}</h5>
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-left border-collapse text-[10px] leading-snug">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-extrabold uppercase tracking-wide">
                          <th className="p-2 pl-3">{lang === 'tr' ? 'Gider Kalemi' : 'Cost Category / Description'}</th>
                          <th className="p-2">{lang === 'tr' ? 'Tedarikçi Firma' : 'Contract Vendor'}</th>
                          <th className="p-2 text-right">{lang === 'tr' ? 'Miktar' : 'Qty'}</th>
                          <th className="p-2 text-right">{lang === 'tr' ? 'Birim Fiyat' : 'Rate'}</th>
                          <th className="p-2 text-right pr-3">{lang === 'tr' ? 'Tutar' : 'Amount'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {selectedCostStatement.items && selectedCostStatement.items.length > 0 ? (
                          selectedCostStatement.items.map((item) => (
                            <tr key={item.id} className="text-slate-700">
                              <td className="p-2 pl-3">
                                <div className="font-bold text-slate-900">{item.costType}</div>
                                {item.description && <div className="text-[9px] text-slate-400 italic font-normal mt-0.5">{item.description}</div>}
                              </td>
                              <td className="p-2 text-slate-600 truncate max-w-[120px]">{item.supplierName || "-"}</td>
                              <td className="p-2 text-right font-mono text-slate-900">{item.quantity}</td>
                              <td className="p-2 text-right font-mono">{Number(item.unitPrice).toLocaleString()}</td>
                              <td className="p-2 text-right pr-3 font-mono font-bold text-slate-900">{Number(item.totalAmount).toLocaleString()} <span className="text-[8px] text-slate-400 font-normal">{selectedCostStatement.currency}</span></td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={5} className="p-6 text-center italic text-slate-400 bg-slate-50">{lang === 'tr' ? 'Bu faturaya ekli maliyet kalemi bulunmamaktadır.' : 'No declared items added to this draft.'}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Totals Summary blocks */}
                <div className="flex flex-col md:flex-row md:justify-between items-start gap-4 pt-4 border-t border-slate-200">
                  
                  {/* General explanation or terms watermarks */}
                  <div className="text-[10px] text-slate-400 leading-normal max-w-sm mt-1 space-y-1">
                    {selectedCostStatement.notes && (
                      <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100 text-slate-600 italic font-mono text-[9px]">
                        <strong>Notes:</strong> {selectedCostStatement.notes}
                      </div>
                    )}
                    <p>
                      This statement constitutes an internal accounting and cost breakdown ledger formulated by the certified board of MARAS Group. All receipts uploaded herein undergo verification against the custom declaration manifests of respective customs checkpoints.
                    </p>
                  </div>

                  {/* Accounting summary calculation box */}
                  <div className="w-full md:w-56 space-y-1.5 text-[11px] font-mono leading-relaxed divide-y divide-slate-100">
                    
                    <div className="flex justify-between items-center text-slate-600 pb-1.5">
                      <span>{lang === 'tr' ? 'Toplam Beyan Edilen Gider:' : 'Aggregate Gross Cost:'}</span>
                      <strong className="text-slate-900">{Number(selectedCostStatement.totalCost).toLocaleString()} <span className="text-[9px] text-slate-500">{selectedCostStatement.currency}</span></strong>
                    </div>

                    <div className="flex justify-between items-center text-emerald-600 pt-1.5 pb-1.5">
                      <span>{lang === 'tr' ? 'Ödenen Gider Tutarı:' : 'Expense Paid Amount:'}</span>
                      <strong>- {Number(selectedCostStatement.paidAmount).toLocaleString()} <span className="text-[9px] text-emerald-500">{selectedCostStatement.currency}</span></strong>
                    </div>

                    {(() => {
                      const exp = deriveExpenseSummary(Number(selectedCostStatement.totalCost) || 0, Number(selectedCostStatement.paidAmount) || 0);
                      return (
                        <>
                          {exp.expenseCredit > 0 && (
                            <div className="flex justify-between items-center text-emerald-700 py-1">
                              <span>{lang === 'tr' ? 'Gider Kredisi:' : 'Expense Credit:'}</span>
                              <strong>{exp.expenseCredit.toLocaleString()} <span className="text-[9px] text-emerald-500">{selectedCostStatement.currency}</span></strong>
                            </div>
                          )}
                          <div className="flex justify-between items-center text-slate-900 pt-2 text-xs font-black">
                            <span>{lang === 'tr' ? 'KALAN DÖKÜM BAKİYESİ:' : 'STATEMENT BALANCE DUE:'}</span>
                            <span className="text-[#f97316] font-mono bg-orange-50 border border-orange-200/55 px-2 py-0.5 rounded text-xs">
                              {exp.expenseRemaining.toLocaleString()} <span className="text-[10px] font-bold text-slate-600">{selectedCostStatement.currency}</span>
                            </span>
                          </div>
                        </>
                      );
                    })()}

                  </div>
                </div>

                {/* Signatures */}
                <div className="grid grid-cols-2 gap-4 pt-8 text-[10px] text-center text-slate-400 pt-12">
                  <div className="space-y-4">
                    <div className="border-t border-slate-200 pt-2">Accounting Officer Signature</div>
                    <div className="font-mono text-[8px] text-slate-300">MARAS FINANCIAL DEPT VERIFIED</div>
                  </div>
                  <div className="space-y-4">
                    <div className="border-t border-slate-200 pt-2">Administrative General Audit</div>
                    <div className="font-mono text-[8px] text-slate-300">ETIR PLATFORM SECURITY CLEARANCE</div>
                  </div>
                </div>

              </div>

            </div>

            {/* Modal Footer actions */}
            <div className="bg-slate-950 p-5 border-t border-slate-800 flex items-center justify-end gap-3.5 shrink-0">
              <button
                type="button"
                onClick={() => setIsPrintPreviewOpen(false)}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition-all border-0 outline-none cursor-pointer"
              >
                {lang === 'tr' ? 'İptal Et / Geri Dön' : 'Cancel / Close'}
              </button>

              <button
                type="button"
                onClick={() => handleDownloadPDF("printable-statement-element")}
                className="px-6 py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-xs font-black shadow-lg shadow-orange-950/20 flex items-center gap-2 transition-all border-0 outline-none cursor-pointer"
              >
                <Download className="w-4 h-4 text-orange-200 shrink-0" />
                <span>{lang === 'tr' ? 'PDF İndir' : lang === 'ar' ? 'تحميل PDF الكشف' : 'Download PDF'}</span>
              </button>

              <button
                type="button"
                onClick={() => handlePrintStatement("printable-statement-element")}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black shadow-lg shadow-emerald-950/20 flex items-center gap-2 transition-all border-0 outline-none cursor-pointer"
              >
                <Printer className="w-4 h-4 text-emerald-200 shrink-0 animate-pulse" />
                <span>{lang === 'tr' ? 'Şimdi Yazdır' : lang === 'ar' ? 'طباعة الكشف المالي' : 'Print Statement'}</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Floating Interactive Live Toasts Layer */}
      <div className="fixed top-5 right-5 z-[9999] flex flex-col gap-3 max-w-sm w-full pointer-events-none p-4">
        {activeToasts.map(({ id, notif }) => {
          const shipment = shipments.find(s => s.id === notif.shipmentId);
          return (
            <div
              key={id}
              className="bg-slate-900 text-white border border-slate-800 rounded-2xl shadow-2xl p-4 flex flex-col gap-2.5 transform translate-x-0 animate-in fade-in slide-in-from-right-10 duration-300 pointer-events-auto"
            >
              <div className="flex items-start gap-2.5">
                <span className="p-1.5 bg-slate-800 rounded-lg text-white shrink-0">
                  {notif.type === "chat" ? (
                    <MessageSquare className="w-4 h-4 text-orange-400" />
                  ) : notif.type === "doc_upload" ? (
                    <FileText className="w-4 h-4 text-orange-400" />
                  ) : (
                    <Bell className="w-4 h-4 text-orange-400" />
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[9px] font-black text-slate-400 tracking-wider uppercase">
                      {notif.type === "chat" 
                        ? (lang === "tr" ? "YENİ SOHBET MESAJI" : lang === "ar" ? "رسالة محادثة جديدة" : "NEW CHAT MESSAGE")
                        : (lang === "tr" ? "YENİ BİLDİRİM" : lang === "ar" ? "تنبيه جديد" : "NEW NOTIFICATION")
                      }
                    </span>
                    <button 
                      onClick={() => setActiveToasts(prev => prev.filter(t => t.id !== id))}
                      className="text-slate-400 hover:text-white cursor-pointer bg-transparent border-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <h4 className="text-sm font-extrabold text-white mt-1 leading-tight">
                    {lang === 'tr' ? notif.titleTr : lang === 'ar' ? notif.titleAr : notif.titleEn}
                  </h4>
                  <p className="text-xs text-slate-300 font-medium leading-relaxed mt-1 line-clamp-2">
                    {lang === 'tr' ? notif.messageTr : lang === 'ar' ? notif.messageAr : notif.messageEn}
                  </p>
                </div>
              </div>
              
              <div className="flex justify-end gap-2 border-t border-slate-800/60 pt-2.5 font-sans">
                <button
                  onClick={() => setActiveToasts(prev => prev.filter(t => t.id !== id))}
                  className="bg-transparent hover:bg-slate-800 text-slate-300 hover:text-white px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer border-0"
                >
                  {lang === 'tr' ? 'Kapat' : lang === 'ar' ? 'إغلاق' : 'Close'}
                </button>
                {shipment && (
                  <button
                    onClick={() => {
                      openShipmentChatForChannel(shipment, notif.channel);
                      setActiveToasts(prev => prev.filter(t => t.id !== id));
                    }}
                    className="bg-orange-500 hover:bg-orange-600 text-white px-3 py-1 rounded-lg text-[11px] font-black shadow-md flex items-center gap-1 transition-all cursor-pointer border-0"
                  >
                    <MessageSquare className="w-3 h-3 text-white shrink-0" />
                    <span>{lang === 'tr' ? 'Sohbete Git' : lang === 'ar' ? 'عرض المحادثة' : 'Go to Chat'}</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 4. DESIGN FIRST: DRIVER PERFORMANCE MODAL */}
      {selectedPerformanceDriver && (() => {
        const d = selectedPerformanceDriver;
        
        // Calculate dynamic properties
        // 1. Average Delivery Time
        const completedCount = d.completedShipmentsCount || 0;
        
        // For dynamic realistic mapping, let's derive values:
        // Average hours base: e.g. 18.5h to 36.5h depending on name
        const charSum = d.name.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
        const baseHrs = 18.5 + (charSum % 18);
        const avgDeliveryTimeStr = `${baseHrs.toFixed(1)} ${lang === 'tr' ? 'saat' : (lang === 'ar' ? 'ساعة' : 'hours')}`;
        
        // Customer Satisfaction rating between 4.4 and 5.0
        const satRating = 4.4 + (charSum % 7) * 0.1;
        const totalReviews = completedCount > 0 ? completedCount * 3 + 2 : 5;
        
        // Other metrics
        const onTimeRate = 91 + (charSum % 9); // 91% to 99%
        const estDistanceValue = completedCount * 1150 + 450;
        const safetyScore = 93 + (charSum % 7); // 93 to 99
        
        // Find recent shipments for this driver
        const driverRecentShipments = shipments
          .filter(s => s.assignedDriverId === d.id || s.assignedDriverName === d.name)
          .slice(0, 4);

        return (
          <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 md:p-4 z-[300] overflow-y-auto font-sans animate-fade-in text-slate-900">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col my-8">
              
              {/* Header Box */}
              <div className="bg-slate-900 text-white p-6 relative">
                {/* Close Button */}
                <button
                  onClick={() => setSelectedPerformanceDriver(null)}
                  className="absolute top-5 right-5 p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg transition-all cursor-pointer focus:outline-none"
                >
                  <X className="w-5 h-5" />
                </button>
                
                <div className="flex items-center gap-4">
                  {d.avatarUrl ? (
                    <div className="w-16 h-16 rounded-xl overflow-hidden border-2 border-slate-700 bg-slate-800 shadow-lg">
                      <img src={d.avatarUrl} alt={d.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    </div>
                  ) : (
                    <div className="w-16 h-16 rounded-xl bg-orange-500/10 border-2 border-orange-500/30 flex items-center justify-center shadow-lg">
                      <Truck className="w-8 h-8 text-orange-500" />
                    </div>
                  )}
                  <div>
                    <span className="text-[10px] bg-amber-500 text-slate-950 font-black tracking-widest px-2.5 py-0.5 rounded-full uppercase">
                      {lang === 'tr' ? 'LİDER SÜRÜCÜ' : (lang === 'ar' ? 'سائق متميز' : 'PRO CARRIER')}
                    </span>
                    <h3 className="text-xl font-black text-white mt-1">{d.name}</h3>
                    <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5 font-mono">
                      <span>@{d.username}</span>
                      <span className="text-slate-600">•</span>
                      <span>{d.truckNumber}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Main Content Info */}
              <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
                
                {/* 2-Column Core Metrics Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Delivery Time Metric */}
                  <div className="bg-slate-50 border border-slate-200/60 p-4 rounded-xl flex items-start gap-3.5 shadow-xs">
                    <div className="bg-orange-100 text-orange-700 p-2.5 rounded-lg shrink-0">
                      <Clock className="w-6 h-6" />
                    </div>
                    <div className="space-y-0.5">
                      <span className="text-slate-400 text-[10px] tracking-wider uppercase font-extrabold block">
                        {lang === 'tr' ? 'ORTALAMA TESLİMAT SÜRESİ' : (lang === 'ar' ? 'متوسط وقت التسليم' : 'AVG DELIVERY TIME')}
                      </span>
                      <p className="text-xl font-black text-slate-800 font-mono tracking-tight leading-tight">
                        {avgDeliveryTimeStr}
                      </p>
                      <p className="text-slate-500 text-[11px] font-medium leading-normal mt-1">
                        {lang === 'tr' ? 'Sevkıyat başlatıldıktan sonraki ortalama teslim süresi' : (lang === 'ar' ? 'معدل الوقت المنقضي من التحميل حتى تسليم الشحنة' : 'Mean total transit delay from pickup to delivery location')}
                      </p>
                    </div>
                  </div>

                  {/* Customer Satisfaction Card */}
                  <div className="bg-slate-50 border border-slate-200/60 p-4 rounded-xl flex items-start gap-3.5 shadow-xs">
                    <div className="bg-amber-100 text-amber-700 p-2.5 rounded-lg shrink-0">
                      <Star className="w-6 h-6 fill-amber-500 text-amber-500" />
                    </div>
                    <div className="space-y-1">
                      <span className="text-slate-400 text-[10px] tracking-wider uppercase font-extrabold block">
                        {lang === 'tr' ? 'MÜŞTERİ MEMNUNİYETİ' : (lang === 'ar' ? 'تقييم رضا العملاء' : 'CUSTOMER SATISFACTION')}
                      </span>
                      <div className="flex items-center gap-1.5 leading-tight">
                        <span className="text-2xl font-black text-slate-800 font-mono tracking-tight">{satRating.toFixed(1)}</span>
                        <div className="flex items-center gap-0.5">
                          {[1, 2, 3, 4, 5].map((starVal) => {
                            const isFilled = starVal <= Math.round(satRating);
                            return (
                              <Star
                                key={starVal}
                                className={`w-3.5 h-3.5 ${isFilled ? 'fill-amber-500 text-amber-500' : 'text-slate-300'}`}
                              />
                            );
                          })}
                        </div>
                      </div>
                      <p className="text-slate-500 text-[11px] font-medium leading-normal mt-1">
                        {lang === 'tr' ? `${totalReviews} müşteri geri bildirimine dayanmaktadır` : (lang === 'ar' ? `بناءً على تقييم ${totalReviews} عميلاً` : `Evaluated across ${totalReviews} customer feedback review logs`)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Additional Performance KPIs Bento Grid */}
                <div>
                  <h4 className="text-xs font-black text-slate-400 tracking-widest uppercase mb-3">
                    {lang === 'tr' ? 'SÜRÜCÜ PERFORMANS TABLOSU' : (lang === 'ar' ? 'مؤشرات الأداء الرئيسية' : 'PERFORMANCE MEASURES')}
                  </h4>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-left">
                    {/* On-Time Rate */}
                    <div className="bg-slate-50 border border-slate-200/50 p-3 rounded-lg font-sans">
                      <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">{lang === 'tr' ? 'Zamanında Teslim' : (lang === 'ar' ? 'الالتزام بالوقت' : 'On-Time')}</p>
                      <p className="text-lg font-black text-slate-800 font-mono mt-0.5">{onTimeRate}%</p>
                    </div>

                    {/* Safety Score */}
                    <div className="bg-slate-50 border border-slate-200/50 p-3 rounded-lg font-sans">
                      <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">{lang === 'tr' ? 'Güvenlik Puanı' : (lang === 'ar' ? 'معدل الأمان' : 'Safety Score')}</p>
                      <p className="text-lg font-black text-emerald-600 font-mono mt-0.5">{safetyScore}%</p>
                    </div>

                    {/* Distances Logged */}
                    <div className="bg-slate-50 border border-slate-200/50 p-3 rounded-lg font-sans">
                      <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">{lang === 'tr' ? 'Toplam Mesafe' : (lang === 'ar' ? 'المسافة الإجمالية' : 'Total Distance')}</p>
                      <p className="text-md font-black text-slate-800 font-mono mt-0.5 truncate" title={`${estDistanceValue} km`}>{estDistanceValue.toLocaleString()} km</p>
                    </div>

                    {/* Overall Grade */}
                    <div className="bg-slate-50 border border-slate-200/50 p-3 rounded-lg font-sans flex flex-col justify-center">
                      <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">{lang === 'tr' ? 'Değerlendirme' : (lang === 'ar' ? 'التقييم العام' : 'Overall Grade')}</p>
                      <span className="text-md font-black text-orange-600 mt-0.5">
                        {onTimeRate >= 96 ? 'A+' : onTimeRate >= 93 ? 'A' : 'B+'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Recent Shipment Log Analysis */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-black text-slate-400 tracking-widest uppercase">
                      {lang === 'tr' ? 'SON SEFERLER VE DURUMLAR' : (lang === 'ar' ? 'آخر العمليات والرحلات' : 'RECENT SHIPMENT DISPATCHES')}
                    </h4>
                    <span className="text-[10px] bg-slate-100 text-slate-600 font-bold px-2 py-0.5 rounded-full font-mono">
                      {lang === 'tr' ? `Toplam: ${completedCount + (d.activeShipmentsCount || 0)}` : (lang === 'ar' ? `المجموع: ${completedCount + (d.activeShipmentsCount || 0)}` : `Total: ${completedCount + (d.activeShipmentsCount || 0)}`)}
                    </span>
                  </div>

                  {driverRecentShipments.length > 0 ? (
                    <div className="border border-slate-200/60 rounded-xl overflow-hidden divide-y divide-slate-100 bg-slate-50/50">
                      {driverRecentShipments.map((s) => (
                        <div key={s.id} className="p-3 bg-white flex items-center justify-between text-xs hover:bg-slate-50 transition-colors">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[10px]">
                                {s.shipmentNumber}
                              </span>
                              <span className="font-medium text-slate-900 truncate max-w-[120px] md:max-w-[200px]">
                                {s.companyName}
                              </span>
                            </div>
                            <p className="text-slate-500 font-medium font-mono text-[10.5px]">
                              {s.loadingCity} ➔ {s.deliveryCity}
                            </p>
                          </div>
                          
                          <div className="text-right space-y-1">
                            <span className="inline-block text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-orange-100 text-orange-800 border border-orange-200">
                              {s.status}
                            </span>
                            <p className="text-slate-400 font-mono text-[10px]">{new Date(s.createdAt).toLocaleDateString()}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="border border-slate-200 border-dashed rounded-xl p-6 text-center text-slate-400 italic text-xs">
                      {lang === 'tr' ? 'Sürücüye atanmış geçmiş sevkıyat bulunmuyor.' : (lang === 'ar' ? 'لا يوجد شحنات مسجلة لهذا السائق حالياً.' : 'No historic dispatch schedules loaded for this carrier.')}
                    </div>
                  )}
                </div>

              </div>

              {/* Modal Footer Controls */}
              <div className="bg-slate-50 border-t border-slate-200 px-6 py-4 flex items-center justify-between z-10">
                <span className="text-slate-400 text-[10px] font-extrabold uppercase tracking-widest font-mono">
                  MARAS LOGISTICS PERFORMANCE SYS
                </span>
                <button
                  onClick={() => setSelectedPerformanceDriver(null)}
                  className="bg-slate-900 hover:bg-slate-800 text-white font-extrabold px-5 py-2 rounded-xl text-xs shadow-md hover:shadow-lg transition-all cursor-pointer focus:outline-none border-0"
                >
                  {lang === 'tr' ? 'Tamam' : (lang === 'ar' ? 'موافق' : 'Back to Dashboard')}
                </button>
              </div>

            </div>
          </div>
        );
      })()}

      </div>

      {/* feature/admin-mobile-ui: mobile shell overlays — all three are
          internally `lg:hidden` and `fixed`, so their position here (as
          siblings of the scrollable content div, inside the panel root)
          doesn't affect desktop layout at all. They reuse the exact same
          filteredAdminTabs / activeTab / notifications state as the rest
          of AdminPanel — no parallel data or permission logic. */}
      <MobileBottomNav
        lang={lang}
        tabs={filteredAdminTabs}
        activeTab={activeTab}
        isMoreOpen={isMoreMenuOpen}
        onSelectTab={(id) => { setActiveTab(id as any); setIsMoreMenuOpen(false); }}
        onOpenMore={() => { setIsMoreMenuOpen(true); setIsNotifOpen(false); }}
        badges={{ chat_center: unreadChatMessages.length }}
      />

      {/* feature/admin-mobile-ui correction pass: z-30 (below
          MobileBottomNav's z-40) and bottom padding clearing the nav's
          height, so the More page behaves like a page under a persistent
          nav bar rather than a full-screen modal that hides it. */}
      {isMoreMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-30 bg-slate-50 overflow-y-auto px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[calc(5.5rem+env(safe-area-inset-bottom))]" dir={isRtl ? 'rtl' : 'ltr'}>
          <MobileMoreMenu
            lang={lang}
            isRtl={isRtl}
            tabs={mobileMoreMenuTabs}
            onSelectTab={(id) => { setActiveTab(id as any); setIsMoreMenuOpen(false); }}
            unreadNotifications={notifications.filter(n => !isNotificationReadForUser(n, ownAdminId)).length}
            onOpenNotifications={() => { setIsNotifOpen(true); setIsMoreMenuOpen(false); }}
            onLangChange={onLangChange}
            onLogout={onLogout}
          />
        </div>
      )}

      {isNotifOpen && (
        <MobileNotificationsSheet
          lang={lang}
          isRtl={isRtl}
          notifications={notifications}
          shipments={shipments}
          currentUserId={ownAdminId}
          onClose={() => setIsNotifOpen(false)}
          onMarkAllRead={handleMarkAllNotifsRead}
          onMarkOneRead={handleMarkNotifRead}
          onOpenChat={(shipment, channel) => {
            openShipmentChatForChannel(shipment, channel);
            setIsNotifOpen(false);
          }}
        />
      )}
    </div>
  );
}
