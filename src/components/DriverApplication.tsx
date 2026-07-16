import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Shipment,
  Driver,
  ChatMessage,
  AppNotification,
  Language,
  DocumentCategory,
} from "../types";
import { TRANSLATIONS } from "../translations";
import { apiFetch } from "../lib/api";
import { isNotificationReadForUser, addReaderToNotification } from "../lib/notificationAccess";
import { canSubmitChatMessage, isStaleChatPollResponse, planAttachmentSend, isCachedAttachmentForShipment, mergeNewerChatMessages, prependOlderChatMessages } from "../lib/chatComposerState";
import { isShipmentClosed, getDriverSubmittableNextStatus } from "../lib/shipmentStatusTransitions";
import { isNearBottom, computeAutoGrowHeightPx } from "../lib/chatDisplay";
import { encodePageCursor } from "../lib/pagination";
import { mergeShipmentsSince, shouldResetShipmentPagination } from "../lib/shipmentPagination";
import { useIsMobile } from "../hooks/useIsMobile";
import { useDriverActiveJob } from "../hooks/driver/useDriverActiveJob";
import type { DriverOfferView } from "../lib/driverAlliance";
import { useDriverLocationReporting } from "../hooks/driver/useDriverLocationReporting";
import DriverBottomNavigation, { type DriverTab } from "./driver/DriverBottomNavigation";
import DriverHomeScreen from "./driver/DriverHomeScreen";
import DriverJobsScreen from "./driver/DriverJobsScreen";
import DriverJobDetails from "./driver/DriverJobDetails";
import DriverChatScreen from "./driver/DriverChatScreen";
import DriverAccountScreen from "./driver/DriverAccountScreen";
import DriverOffersScreen from "./driver/DriverOffersScreen";
import NotificationBell from "./driver/NotificationBell";
import NotificationsPanel from "./driver/NotificationsPanel";
import { CheckCircle2, Truck, WifiOff, Wifi } from "lucide-react";

interface DriverApplicationProps {
  lang: Language;
  loggedInDriverId?: string | null;
  loggedInDriver?: Driver | null;
  onLogout?: () => void;
  onLanguageChange?: (lang: Language) => void;
  isMobile?: boolean;
}

// feature/chat-ui-ux-phase2: auto-growing composer bounds — one line at
// rest, up to ~5-6 lines before the textarea scrolls internally instead of
// pushing the rest of the panel off-screen.
const DRIVER_COMPOSER_MIN_HEIGHT_PX = 44;
const DRIVER_COMPOSER_MAX_HEIGHT_PX = 128;

/**
 * feature/driver-app-comprehensive-redesign — DriverApplication is now a
 * data/state container only. All rendering moved into the focused
 * components under ./driver (DriverHomeScreen, DriverJobsScreen,
 * DriverJobDetails, DriverChatScreen, DriverAccountScreen,
 * DriverBottomNavigation), and location reporting moved into
 * useDriverLocationReporting. Every server contract, concurrency guard,
 * status-transition rule, and chat-lock rule from PR #111 and the chat
 * safety/scalability phases is preserved here unchanged.
 */
export default function DriverApplication({
  lang,
  loggedInDriverId = null,
  loggedInDriver = null,
  onLogout,
  onLanguageChange,
  isMobile = false
}: DriverApplicationProps) {
  const isMobileMode = isMobile || useIsMobile(768);
  const [showControlsModal, setShowControlsModal] = useState(false);
  const t = (key: keyof typeof TRANSLATIONS['en']) => {
    return TRANSLATIONS[lang][key] || TRANSLATIONS['en'][key] || String(key);
  };

  const isRtl = lang === 'ar';

  // Driver Selector (for local development simulation only — never
  // rendered for a real logged-in driver session)
  const [drivers, setDrivers] = useState<Driver[]>(() => {
    return loggedInDriver ? [loggedInDriver] : [];
  });
  const [selectedDriverId, setSelectedDriverId] = useState<string>(loggedInDriverId || "driver-1");

  const knownNotificationIdsRef = React.useRef<Set<string>>(new Set());
  const knownChatMessageIdsRef = React.useRef<Set<string>>(new Set());
  // fix/chat-safety-reliability-phase1: always holds the CURRENT
  // activeShipment id, checked after an in-flight chat fetch resolves (in
  // both fetchData and fetchChatOnly below) — a request fired for the
  // previously-selected shipment can otherwise resolve after the driver has
  // already switched to a different one and overwrite chatMessages with
  // the wrong thread's data.
  const activeShipmentIdRef = React.useRef<string | null>(null);
  // Phase 4 (Firestore scalability audit): the encoded cursor of the
  // newest chat message this tab has already seen for the active
  // shipment/tab session — null means "no page fetched yet, do a full
  // initial fetch." Reset to null on every shipment/tab switch (see the
  // fast chat-only poll effect below) so re-entering chat always starts
  // with a full latest-page fetch, never a stale cursor from a different
  // shipment's thread.
  const newestChatCursorRef = React.useRef<string | null>(null);
  // Phase 4: cursor/availability for "Load older messages" — set from the
  // initial (non-`since`) page's own `nextCursor`/`hasMore`, consumed by
  // loadOlderChatMessages below. Reset alongside newestChatCursorRef on
  // every shipment/tab switch.
  const olderChatCursorRef = React.useRef<string | null>(null);
  const [hasOlderChatMessages, setHasOlderChatMessages] = useState(false);
  const [isLoadingOlderChat, setIsLoadingOlderChat] = useState(false);
  // In-flight guard for POST /api/notifications/:id/read — the 12s poll
  // (fetchData below) can re-run while a previous mark-as-read request for
  // the same id is still pending, which would otherwise fire a duplicate
  // request. An id is added here right before its request starts and
  // removed once that request settles (success or failure), regardless of
  // outcome.
  const markingNotifsReadRef = React.useRef<Set<string>>(new Set());

  // Keep loggedInDriver in sync with drivers catalog
  useEffect(() => {
    if (loggedInDriver) {
      setDrivers(prev => {
        if (!prev.some(d => d.id === loggedInDriver.id)) {
          return [...prev, loggedInDriver];
        }
        return prev.map(d => d.id === loggedInDriver.id ? { ...d, ...loggedInDriver } : d);
      });
    }
  }, [loggedInDriver]);

  useEffect(() => {
    if (loggedInDriverId) {
      setSelectedDriverId(loggedInDriverId);
    }
  }, [loggedInDriverId]);

  const [shipments, setShipments] = useState<Shipment[]>([]);
  // Phase 2A follow-up (blocking-issue fix): GET /api/shipments now
  // returns only the latest page (default 50) — these track cursor
  // pagination for the explicit "Load Older Shipments" action, and the
  // ref tracks the delta-poll ("since") position for the 12s interval.
  const [shipmentsNextCursor, setShipmentsNextCursor] = useState<string | null>(null);
  const [shipmentsHasMore, setShipmentsHasMore] = useState(false);
  const [shipmentsLoadingMore, setShipmentsLoadingMore] = useState(false);
  const shipmentsSinceCursorRef = React.useRef<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  // Active selected shipment for detail / chat inside driver app
  const [activeShipment, setActiveShipment] = useState<Shipment | null>(null);
  // PR #111 review (Delivered/Closed terminal & chat rules): chat locks
  // only at the shipment's freight-mode-appropriate closing status
  // ("Closed" for Land, "Completed" for Sea/Air) — reaching "Delivered"
  // must NOT close chat, since Admin/Driver still routinely exchange
  // CMR/POD corrections, final remarks, and payment follow-up afterward.
  const isShipmentChatClosed = activeShipment ? isShipmentClosed(activeShipment.status, activeShipment.freightType) : false;

  useEffect(() => {
    activeShipmentIdRef.current = activeShipment?.id ?? null;
  }, [activeShipment?.id]);

  // Phase 2A follow-up (blocking-issue fix): `notifications` state is
  // already scoped to this driver's own shipments server-side (GET
  // /api/notifications — buildDriverOwnedShipmentQueryScopes +
  // fetchOwnedShipmentIds, server.ts), independently of whatever page of
  // GET /api/shipments happens to be loaded into `shipments`.
  const myNotifications = notifications;
  // Notification Phase 1 correction: unread status is per-user
  // (readByUserIds), not the legacy shared `read` flag.
  const unreadNotificationCount = useMemo(
    () => myNotifications.filter(n => !isNotificationReadForUser(n, loggedInDriverId || "")).length,
    [myNotifications, loggedInDriverId]
  );

  // Unread MARAS chat messages per shipment (per-user read state) — the
  // Jobs-screen badges and the Chat tab badge both read from this one map.
  const unreadChatByShipmentId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const n of myNotifications) {
      if (n.type === "chat" && !isNotificationReadForUser(n, loggedInDriverId || "")) {
        map[n.shipmentId] = (map[n.shipmentId] || 0) + 1;
      }
    }
    return map;
  }, [myNotifications, loggedInDriverId]);
  const totalUnreadChat = useMemo(
    () => Object.values(unreadChatByShipmentId).reduce((sum, c) => sum + c, 0),
    [unreadChatByShipmentId]
  );

  // Marks the given notification ids as read via the same authenticated
  // per-notification endpoint every other role already uses
  // (POST /api/notifications/:id/read) — never the admin-only
  // /api/notifications/clear route. Local state (and therefore the unread
  // badge) is only updated for an id once its own request actually
  // succeeds; a failed request leaves that notification unread both on
  // the server and locally, so it's retried the next time this runs
  // instead of silently disappearing from the badge count. Only this
  // driver's own id is added to readByUserIds (addReaderToNotification
  // preserves whatever ids were already there).
  const markNotificationsRead = React.useCallback((ids: string[]) => {
    const toMark = ids.filter(id => !markingNotifsReadRef.current.has(id));
    if (toMark.length === 0) return;
    toMark.forEach(id => markingNotifsReadRef.current.add(id));
    toMark.forEach(async (id) => {
      try {
        const res = await apiFetch(`/api/notifications/${id}/read`, { method: "POST" });
        if (res.ok) {
          setNotifications(prev => prev.map(n => n.id === id
            ? { ...n, readByUserIds: addReaderToNotification(n.readByUserIds, loggedInDriverId || "") }
            : n
          ));
        } else {
          console.error(`Failed to mark notification ${id} as read: ${res.status}`);
        }
      } catch (err) {
        console.error(`Failed to mark notification ${id} as read:`, err);
      } finally {
        markingNotifsReadRef.current.delete(id);
      }
    });
  }, [loggedInDriverId]);

  // The ONE authoritative active-job rule (selectDriverActiveJob) — Home,
  // the Chat default thread, and location reporting all read this. No
  // screen computes its own variant of "active shipment" anymore.
  const { activeJob, isReportingLocation } = useDriverActiveJob(shipments);

  const [activeTab, setActiveTab] = useState<DriverTab>('home');
  const [showNotifications, setShowNotifications] = useState(false);
  // Driver Alliance Phase 1: this driver's own sanitized offer views
  // (server-scoped — a driver can never receive another driver's offers
  // or prices). The offers screen is an overlay from Home; the four-tab
  // navigation is untouched.
  const [allianceOffers, setAllianceOffers] = useState<DriverOfferView[]>([]);
  const [showOffers, setShowOffers] = useState(false);

  // Opening the Notifications screen marks every currently-visible unread
  // notification as read. Re-runs whenever the visible list changes (e.g.
  // a new notification arrives from the 12s poll while the panel is still
  // open) so it also catches unread items that appear after the initial
  // open.
  useEffect(() => {
    if (!showNotifications) return;
    const unreadIds = myNotifications.filter(n => !isNotificationReadForUser(n, loggedInDriverId || "")).map(n => n.id);
    if (unreadIds.length > 0) {
      markNotificationsRead(unreadIds);
    }
  }, [showNotifications, myNotifications, markNotificationsRead, loggedInDriverId]);

  // Reading a chat thread marks that shipment's chat notifications read —
  // this is what clears the per-job unread badge. Same per-user endpoint
  // and in-flight guard as everywhere else.
  useEffect(() => {
    if (activeTab !== 'chat' || !activeShipment) return;
    const unreadIds = myNotifications
      .filter(n => n.type === 'chat' && n.shipmentId === activeShipment.id && !isNotificationReadForUser(n, loggedInDriverId || ""))
      .map(n => n.id);
    if (unreadIds.length > 0) {
      markNotificationsRead(unreadIds);
    }
  }, [activeTab, activeShipment?.id, myNotifications, markNotificationsRead, loggedInDriverId]);

  // Entering Chat with no thread selected opens the active job's thread.
  useEffect(() => {
    if (activeTab === 'chat' && !activeShipment && activeJob) {
      setActiveShipment(activeJob);
    }
  }, [activeTab, activeShipment, activeJob]);

  // Input states
  const [newMessageText, setNewMessageText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const [remarks, setRemarks] = useState("");

  // feature/chat-ui-ux-phase2: smart auto-scroll. messagesContainerRef is
  // the scrollable message list; isNearBottomChatRef tracks (via the
  // onScroll handler below) whether the driver is already close to the
  // bottom — only then does a new message auto-scroll the view. Reading
  // older history and having a new message arrive must never yank the
  // view back down.
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomChatRef = useRef(true);

  // Opening a different shipment (or the chat tab itself) always starts
  // scrolled to its latest messages.
  useEffect(() => {
    isNearBottomChatRef.current = true;
  }, [activeShipment?.id, activeTab]);

  // Auto-scroll chat to bottom — feature/chat-ui-ux-phase2: only when
  // already near the bottom (or just switched shipment/tab, per the reset
  // above).
  useEffect(() => {
    if (activeTab === 'chat' && chatMessages.length > 0 && isNearBottomChatRef.current) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 80);
    }
  }, [chatMessages.length, activeTab, activeShipment?.id]);

  const handleMessagesScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomChatRef.current = isNearBottom(distanceFromBottom);
  };

  // feature/chat-ui-ux-phase2: auto-grow the composer textarea with its
  // content (including shrinking back down after the draft is cleared on
  // send).
  const driverTextareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = driverTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${computeAutoGrowHeightPx(el.scrollHeight, DRIVER_COMPOSER_MIN_HEIGHT_PX, DRIVER_COMPOSER_MAX_HEIGHT_PX)}px`;
  }, [newMessageText]);

  // feature/chat-ui-ux-phase2: computed once and reused for both the
  // rendered list and the "no search results" empty-state check.
  const visibleChatMessages = useMemo(() => {
    const q = chatSearchQuery.toLowerCase().trim();
    if (!q) return chatMessages;
    return chatMessages.filter(
      (msg) =>
        (msg.text || "").toLowerCase().includes(q) ||
        (msg.fileName || "").toLowerCase().includes(q) ||
        (msg.senderName || "").toLowerCase().includes(q)
    );
  }, [chatMessages, chatSearchQuery]);

  // Theme mode switch (light vs dark)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('driver_app_theme');
    return (saved === 'light' || saved === 'dark') ? saved : 'dark';
  });

  useEffect(() => {
    localStorage.setItem('driver_app_theme', theme);
  }, [theme]);

  // Native chat attachment (paperclip -> file input in DriverChatScreen -> auto-send)
  const [isUploading, setIsUploading] = useState(false);
  // fix/chat-safety-reliability-phase1 (follow-up): set when an upload
  // succeeded but the follow-up POST /chat failed — holds the real
  // Storage URL so retrying (handleRetryDriverAttachment) reuses it
  // instead of uploading the file again. Cleared on a confirmed
  // successful send or when a new file is picked; never on a failed send.
  // `shipmentId` is the shipment this attachment was uploaded FOR — a
  // retry must never post it into a different shipment the driver has
  // since switched to.
  const [pendingDriverAttachment, setPendingDriverAttachment] = useState<{
    shipmentId: string;
    fileUrl: string;
    fileName: string;
    fileCategory: DocumentCategory;
  } | null>(null);
  // Distinguishes "the upload itself failed (nothing sent)" from "the
  // upload succeeded but creating the chat message failed" — the two
  // need different, explicit copy.
  const [driverAttachmentError, setDriverAttachmentError] = useState<'' | 'upload' | 'send'>('');

  // fix/chat-safety-reliability-phase1 (follow-up): switching to a
  // different shipment must never carry a pending (failed-to-send)
  // attachment — or its cached upload URL — over to the newly-selected
  // one.
  useEffect(() => {
    setPendingDriverAttachment(null);
    setDriverAttachmentError('');
  }, [activeShipment?.id]);

  const [isForceOffline, setIsForceOffline] = useState<boolean>(false);
  const [toast, setToast] = useState<string | null>(null);

  const triggerToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // Location reporting — see useDriverLocationReporting for the two
  // redesign corrections (location-only payload; lifecycle keyed to the
  // shared active-job rule, running through "Arrived" and stopping only
  // once no driver-submittable status remains).
  const onGpsSyncFailed = React.useCallback(() => {
    triggerToast(
      lang === 'tr'
        ? "⚠️ Konum senkronizasyonu başarısız. Son konumlarınız henüz operasyona ulaşmadı — otomatik olarak yeniden denenecek."
        : lang === 'ar'
        ? "⚠️ فشل مزامنة الموقع. لم تصل مواقعك الأخيرة إلى العمليات بعد — سيُعاد المحاولة تلقائياً."
        : "⚠️ GPS location sync failed. Your recent location updates haven't reached dispatch yet — will retry automatically."
    );
  }, [lang]);

  const { gpsAvailable, requestImmediateFix } = useDriverLocationReporting({
    driverId: selectedDriverId,
    isActive: isReportingLocation,
    isForceOffline,
    onSyncFailed: onGpsSyncFailed,
  });

  // Fetch drivers list & shipment context
  // Phase 2A follow-up (blocking-issue fix): `force` controls whether
  // this reloads the latest-50 page (full replace, resets pagination —
  // initial load, driver/active-shipment switch, and every "just
  // performed an action, refresh now" call site) or fetches only a
  // `since` delta merged into whatever is already loaded (the 12s
  // interval poll below, force=false) — never a recurring full paginated
  // reload.
  const fetchData = async (force = true) => {
    try {
      const safeJson = async (res: Response) => {
        const text = await res.text();
        if (text.trim().startsWith("<")) {
          throw new Error("Received HTML instead of JSON. The backend server might still be initializing.");
        }
        return JSON.parse(text);
      };

      const resDrivers = await apiFetch("/api/drivers");
      if (resDrivers.ok) {
        let driversList = await safeJson(resDrivers);
        if (loggedInDriver && !driversList.some((d: Driver) => d.id === loggedInDriver.id)) {
          driversList = [...driversList, loggedInDriver];
        }
        setDrivers(driversList);
      }

      // Phase 2A follow-up (blocking-issue fix): GET /api/shipments is
      // scoped server-side to this driver's own assigned/additional-driver
      // shipments (buildDriverOwnedShipmentQueryScopes, server.ts). `force`
      // fetches the latest 50 (full replace); otherwise a `since` delta is
      // merged into the existing list by id (mergeShipmentsSince) — an
      // upsert, never a replace/truncate, so already-loaded older pages
      // (from "Load Older Shipments") survive every poll tick.
      let mergedList: Shipment[] = shipments;
      if (force) {
        const url = `/api/shipments?driverId=${selectedDriverId}&limit=50`;
        const res = await apiFetch(url);
        if (res.ok) {
          const data = await safeJson(res);
          const items: Shipment[] = data.items || [];
          mergedList = items;
          setShipments(items);
          setShipmentsNextCursor(data.nextCursor ?? null);
          setShipmentsHasMore(!!data.hasMore);
          const newestUpdated = items.reduce<Shipment | null>(
            (latest, s) => (!latest || s.updatedAt > latest.updatedAt || (s.updatedAt === latest.updatedAt && s.id > latest.id) ? s : latest),
            null
          );
          shipmentsSinceCursorRef.current = newestUpdated
            ? encodePageCursor({ ts: newestUpdated.updatedAt, id: newestUpdated.id })
            : null;
        }
      } else {
        const cursor = shipmentsSinceCursorRef.current;
        if (cursor) {
          const res = await apiFetch(`/api/shipments?driverId=${selectedDriverId}&since=${encodeURIComponent(cursor)}`);
          if (res.ok) {
            const data = await safeJson(res);
            const items: Shipment[] = data.items || [];
            if (items.length > 0) {
              mergedList = mergeShipmentsSince(shipments, items);
              setShipments(mergedList);
              const newestUpdated = items.reduce<Shipment>((latest, s) => (s.updatedAt > latest.updatedAt || (s.updatedAt === latest.updatedAt && s.id > latest.id) ? s : latest), items[0]);
              shipmentsSinceCursorRef.current = encodePageCursor({ ts: newestUpdated.updatedAt, id: newestUpdated.id });
            }
          }
        }
      }

      // update active shipment details dynamically if it is loaded —
      // feature/driver-app-comprehensive-redesign: this no longer touches
      // any GPS state. Location reporting's lifecycle is owned entirely by
      // useDriverLocationReporting, keyed to the shared active-job rule
      // (which correctly keeps reporting through "Arrived").
      if (activeShipment) {
        const fresh = mergedList.find((s: Shipment) => s.id === activeShipment.id);
        if (fresh) {
          setActiveShipment(fresh);
        }
      }

      // Fetch dynamic messages.
      //
      // fix/chat-safety-reliability-phase1: skipped while the faster 3.5s
      // chat-only poll below already owns this shipment's chat (activeTab
      // === 'chat') — the two polls previously ran concurrently against
      // the same endpoint with no coordination between them at all.
      // knownChatMessageIdsRef is kept in sync by that faster poll in the
      // meantime (see fetchChatOnly) specifically so that resuming here
      // after the driver leaves the chat tab doesn't treat every message
      // that arrived while they were on it as "new" and fire a toast for
      // each one.
      if (activeShipment && activeTab !== 'chat') {
        const requestedShipmentId = activeShipment.id;
        const resChat = await apiFetch(`/api/shipments/${requestedShipmentId}/chat`);
        if (resChat.ok) {
          const chatPage = await safeJson(resChat);
          const msgs: ChatMessage[] = Array.isArray(chatPage) ? chatPage : chatPage.items;

          // fix/chat-safety-reliability-phase1: this request was for
          // requestedShipmentId — if the driver has since switched to a
          // different shipment, applying this response would overwrite
          // the new shipment's chat with the old one's.
          if (!isStaleChatPollResponse(activeShipmentIdRef.current, requestedShipmentId)) {
            if (knownChatMessageIdsRef.current.size === 0) {
              const initialIds = new Set<string>();
              msgs.forEach((m) => initialIds.add(m.id));
              knownChatMessageIdsRef.current = initialIds;
            } else {
              for (const m of msgs) {
                if (!knownChatMessageIdsRef.current.has(m.id)) {
                  knownChatMessageIdsRef.current.add(m.id);
                  // Alert only if sender is 'admin' (dispatcher)
                  if (m.sender === 'admin') {
                    const alertMsg = lang === 'en'
                      ? `💬 MARAS: "${m.text}"`
                      : (lang === 'tr' ? `💬 Mesaj: "${m.text}"` : `💬 إشعار: "${m.text}"`);
                    triggerToast(alertMsg);
                  }
                }
              }
            }

            setChatMessages(msgs);
          }
        }
      }

      // Fetch notifications
      const resNotifs = await apiFetch("/api/notifications");
      if (resNotifs.ok) {
        const notifPage = await safeJson(resNotifs);
        const rawList: AppNotification[] = Array.isArray(notifPage) ? notifPage : notifPage.items;

        // Phase 2A follow-up (blocking-issue fix): GET /api/notifications
        // already scopes results to this driver's own
        // assigned/additional-driver shipments server-side, INDEPENDENTLY
        // of GET /api/shipments.
        const list = rawList;

        if (knownNotificationIdsRef.current.size === 0) {
          const initialIds = new Set<string>();
          list.forEach((n) => initialIds.add(n.id));
          knownNotificationIdsRef.current = initialIds;
        } else {
          for (const notif of list) {
            if (!knownNotificationIdsRef.current.has(notif.id)) {
              knownNotificationIdsRef.current.add(notif.id);

              // Chat notifications carry excludeUserId set to the sender's
              // own session id. The backend already omits these from this
              // driver's own GET /api/notifications response, but guard
              // here too so this driver's own message never pops a toast
              // for them.
              const isOwnChatMessage =
                notif.type === "chat" &&
                !!notif.excludeUserId &&
                notif.excludeUserId === loggedInDriverId;
              if (isOwnChatMessage) {
                continue;
              }

              const title = lang === 'en' ? notif.titleEn : (lang === 'tr' ? notif.titleTr : notif.titleAr);
              const msg = lang === 'en' ? notif.messageEn : (lang === 'tr' ? notif.messageTr : notif.messageAr);

              // Trigger toast alert for message/doc_upload/status_update
              triggerToast(`🔔 ${title}: ${msg}`);
            }
          }
        }
        setNotifications(list);
      }

      // Driver Alliance Phase 1: refresh this driver's own offers. Kept
      // on the same poll cadence as everything else — an offer answer is
      // never time-critical enough to need its own faster loop.
      const resOffers = await apiFetch("/api/alliance/offers");
      if (resOffers.ok) {
        const offersPage = await safeJson(resOffers);
        setAllianceOffers(offersPage.items || []);
      }

    } catch (e) {
      console.warn("Data fetch error: ", e);
    }
  };

  // Phase 2A follow-up (blocking-issue fix): explicit "Load Older
  // Shipments" action, same pattern as AdminPanel/ClientDashboard. Always
  // strictly older rows (cursor mode is createdAt DESC from wherever the
  // currently-loaded list ends) — plain concatenation is correct; still
  // de-duplicated by id defensively.
  const handleLoadMoreShipments = async () => {
    if (!shipmentsHasMore || !shipmentsNextCursor || shipmentsLoadingMore) return;
    setShipmentsLoadingMore(true);
    try {
      const res = await apiFetch(`/api/shipments?driverId=${selectedDriverId}&limit=50&cursor=${encodeURIComponent(shipmentsNextCursor)}`);
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

  // Phase 2A follow-up (blocking-issue fix): the recurring 12s poll is
  // always a `since` delta (force=false) — never a full paginated
  // reload. The effect-triggered call itself (on mount, and whenever
  // selectedDriverId/activeShipment?.id changes) stays a full force=true
  // latest-50 load, which is also where pagination state gets reset —
  // explicitly so for a genuine selectedDriverId (account/scope) change,
  // not merely switching which already-loaded shipment is "active."
  const prevSelectedDriverIdRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (shouldResetShipmentPagination(prevSelectedDriverIdRef.current, selectedDriverId)) {
      setShipments([]);
      setShipmentsNextCursor(null);
      setShipmentsHasMore(false);
      shipmentsSinceCursorRef.current = null;
    }
    prevSelectedDriverIdRef.current = selectedDriverId;
    fetchData();
    const interval = setInterval(() => fetchData(false), 12000);
    return () => clearInterval(interval);
  }, [selectedDriverId, activeShipment?.id]);

  // Fast chat-only polling when active tab is chat to support snappy read
  // receipts and messaging updates.
  //
  // Phase 4 (Firestore scalability audit): the initial fetch on
  // shipment/tab entry loads the latest DEFAULT_PAGE_SIZE page (server
  // default: 50) via GET .../chat; every poll tick after that uses
  // `?since=<newest-known cursor>` so a driver sitting on an active chat
  // thread no longer re-fetches the whole thread every 3.5s — only
  // messages newer than the last one this tab has already seen.
  useEffect(() => {
    let interval: any;
    newestChatCursorRef.current = null;
    olderChatCursorRef.current = null;
    setHasOlderChatMessages(false);
    if (activeShipment && activeTab === 'chat') {
      const requestedShipmentId = activeShipment.id;
      const fetchChatOnly = async () => {
        try {
          const cursor = newestChatCursorRef.current;
          const url = cursor
            ? `/api/shipments/${requestedShipmentId}/chat?since=${encodeURIComponent(cursor)}`
            : `/api/shipments/${requestedShipmentId}/chat`;
          const resChat = await apiFetch(url);
          if (resChat.ok) {
            const txt = await resChat.text();
            if (txt.trim() && !txt.trim().startsWith("<")) {
              const parsed = JSON.parse(txt);
              const msgs: ChatMessage[] = Array.isArray(parsed) ? parsed : parsed.items;

              // fix/chat-safety-reliability-phase1: guard against this
              // response landing after the driver has already switched to
              // a different shipment or left the chat tab.
              if (isStaleChatPollResponse(activeShipmentIdRef.current, requestedShipmentId)) return;

              setChatMessages((prev) => (cursor ? mergeNewerChatMessages(prev, msgs) : msgs));
              const newest = msgs[msgs.length - 1];
              if (newest) {
                newestChatCursorRef.current = encodePageCursor({ ts: newest.timestamp, id: newest.id });
              }
              // Only the very first (non-`since`) fetch of a shipment/tab
              // session carries older-history pagination info — a `since`
              // delta response has neither field (see the server route),
              // so this only ever runs once per session, which is exactly
              // right: "load older" always continues from where the
              // initial page left off, never from a delta tick.
              if (!cursor && !Array.isArray(parsed)) {
                olderChatCursorRef.current = parsed.nextCursor ?? null;
                setHasOlderChatMessages(Boolean(parsed.hasMore));
              }
              // Keep knownChatMessageIdsRef in sync while this faster poll
              // owns chat updates — fetchData's own (slower) chat fetch is
              // skipped whenever activeTab === 'chat' (see above), and
              // relies on this ref already reflecting every message seen
              // here once the driver leaves the chat tab.
              msgs.forEach((m) => knownChatMessageIdsRef.current.add(m.id));

              const hasUnseenFromAdmin = msgs.some((m: any) => m.sender === 'admin' && m.status !== 'seen');
              if (hasUnseenFromAdmin) {
                await apiFetch(`/api/shipments/${requestedShipmentId}/chat/seen`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ viewer: "driver" })
                });
              }
            }
          }
        } catch (err) {
          console.warn("Active driver chat fast poll error:", err);
        }
      };

      // Initial trigger and set quick 3.5s interval
      fetchChatOnly();
      interval = setInterval(fetchChatOnly, 3500);
    }
    return () => clearInterval(interval);
  }, [activeShipment?.id, activeTab]);

  // Phase 4 (Firestore scalability audit): explicit "Load older messages"
  // — fetches the next older page via the cursor the initial page handed
  // back and prepends it, never re-fetches (or re-renders) the messages
  // already on screen. isStaleChatPollResponse guards the same
  // shipment-switch-mid-flight race as the poll loops above.
  const loadOlderChatMessages = async () => {
    if (!activeShipment || !olderChatCursorRef.current || isLoadingOlderChat) return;
    const requestedShipmentId = activeShipment.id;
    const cursor = olderChatCursorRef.current;
    setIsLoadingOlderChat(true);
    try {
      const res = await apiFetch(`/api/shipments/${requestedShipmentId}/chat?cursor=${encodeURIComponent(cursor)}`);
      if (res.ok) {
        const page = await res.json();
        if (!isStaleChatPollResponse(activeShipmentIdRef.current, requestedShipmentId)) {
          const older: ChatMessage[] = Array.isArray(page) ? page : page.items;
          setChatMessages((prev) => prependOlderChatMessages(prev, older));
          olderChatCursorRef.current = Array.isArray(page) ? null : page.nextCursor ?? null;
          setHasOlderChatMessages(Array.isArray(page) ? false : Boolean(page.hasMore));
        }
      }
    } catch (err) {
      console.warn("Load older chat messages failed:", err);
    } finally {
      setIsLoadingOlderChat(false);
    }
  };

  // In-flight guard shared by accept/decline/next-status — a double-tap
  // must never fire two status PUTs before the first resolves.
  const [isSubmittingStatus, setIsSubmittingStatus] = useState(false);

  // Handle Order Acceptance
  const handleAcceptAssignment = async (shipment: Shipment) => {
    if (isSubmittingStatus) return;
    setIsSubmittingStatus(true);
    try {
      const res = await apiFetch(`/api/shipments/${shipment.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "Accepted",
          updaterName: getDriverName(),
          remarksDesc: "Assigned shipment order accepted by dispatched driver.",
          role: "driver"
        })
      });
      if (res.ok) {
        triggerToast(t('acceptSuccess'));

        // Attempt a one-shot GPS fix on accept; the reporting loop
        // (useDriverLocationReporting) takes over from here.
        requestImmediateFix(() => {
          triggerToast(
            lang === 'tr'
              ? "📡 Konum alınamıyor — konumunuzu operasyonla paylaşmak için GPS'i açın."
              : lang === 'ar'
              ? "📡 تعذر تحديد الموقع — فعّل GPS لمشاركة موقعك مع العمليات."
              : "📡 Location unavailable — enable GPS to share your position with dispatch."
          );
        });

        fetchData();
      } else {
        let msg = "Failed to accept assignment. Please try again.";
        let body: any = null;
        try { body = await res.json(); msg = body?.error || msg; } catch {}
        // PR #111 review: another status change already committed since
        // this driver last saw the shipment — refresh to the real current
        // status rather than leaving stale local state. Never auto-retried.
        if (res.status === 409 && body?.code === "INVALID_SHIPMENT_STATUS_TRANSITION") {
          fetchData();
        }
        triggerToast(`❌ ${msg}`);
      }
    } catch (e) {
      console.error(e);
      triggerToast("❌ Could not reach the server. Please check your connection and try again.");
    } finally {
      setIsSubmittingStatus(false);
    }
  };

  // Handle Order Rejection — the one deliberate, narrowly-scoped
  // Assigned→New exception (isDriverAssignmentRejection, enforced
  // server-side). This dedicated decline workflow is the ONLY backward
  // movement a driver can ever trigger.
  const handleRejectAssignment = async (shipment: Shipment) => {
    if (isSubmittingStatus) return;
    setIsSubmittingStatus(true);
    try {
      const res = await apiFetch(`/api/shipments/${shipment.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "New", // Reset to New in backend
          updaterName: getDriverName(),
          remarksDesc: `Driver rejected assignment.`,
          role: "driver"
        })
      });
      if (res.ok) {
        triggerToast(t('rejectSuccess'));
        fetchData();
      } else {
        let msg = "Failed to reject assignment. Please try again.";
        let body: any = null;
        try { body = await res.json(); msg = body?.error || msg; } catch {}
        if (res.status === 409 && body?.code === "INVALID_SHIPMENT_STATUS_TRANSITION") {
          fetchData();
        }
        triggerToast(`❌ ${msg}`);
      }
    } catch (e) {
      console.error(e);
      triggerToast("❌ Could not reach the server. Please check your connection and try again.");
    } finally {
      setIsSubmittingStatus(false);
    }
  };

  // Handle the single next-status submission (DriverNextAction's confirm).
  // PR #111 review (forward-only status transitions): derived fresh from
  // the shipment at submit time — there is only ever one valid next
  // status (getDriverSubmittableNextStatus), so no selectable status
  // state exists at all. The server revalidates inside its transaction
  // regardless.
  const handleSubmitNextStatus = async (shipment: Shipment) => {
    if (isSubmittingStatus) return;
    const nextStatus = getDriverSubmittableNextStatus(shipment.status, shipment.freightType);
    if (!nextStatus) return;
    setIsSubmittingStatus(true);
    try {
      const res = await apiFetch(`/api/shipments/${shipment.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: nextStatus,
          remarksDesc: remarks || undefined,
          updaterName: getDriverName(),
          role: "driver"
        })
      });
      if (res.ok) {
        setRemarks("");
        triggerToast(t('statusUpdated'));
        fetchData();
      } else {
        let msg = "Failed to update status. Please try again.";
        let body: any = null;
        try { body = await res.json(); msg = body?.error || msg; } catch {}
        // PR #111 review: another status change already committed since
        // this driver last saw the shipment (a concurrent admin/driver
        // update, or the assignment-rejection exception) — refresh to the
        // real current status rather than leaving the control pointed at a
        // transition that's no longer valid. Never auto-retried.
        if (res.status === 409 && body?.code === "INVALID_SHIPMENT_STATUS_TRANSITION") {
          fetchData();
        }
        triggerToast(`❌ ${msg}`);
      }
    } catch (e) {
      console.error(e);
      triggerToast("❌ Could not reach the server. Please check your connection and try again.");
    } finally {
      setIsSubmittingStatus(false);
    }
  };

  // fix/chat-safety-reliability-phase1: in-flight guard — a
  // double-tap/double-Enter must not fire two POSTs before the first
  // resolves.
  const [isSendingDriverMessage, setIsSendingDriverMessage] = useState(false);

  // Chat message injection
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShipment) return;
    if (!canSubmitChatMessage({ text: newMessageText, hasAttachment: false, isSending: isSendingDriverMessage, isLocked: isShipmentChatClosed })) return;
    setIsSendingDriverMessage(true);

    try {
      const res = await apiFetch(`/api/shipments/${activeShipment.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: "driver",
          senderName: getDriverName(),
          type: "text",
          text: newMessageText
        })
      });

      if (res.ok) {
        setNewMessageText("");
        const msg = await res.json();
        setChatMessages(prev => [...prev, msg]);
      } else {
        // PR #111 review (Delivered/Closed terminal & chat rules): the
        // shipment was closed (by another session) since this driver last
        // saw it — refresh so the composer locks to match, rather than
        // leaving it open for a retry the server will keep rejecting.
        let body: any = null;
        try { body = await res.json(); } catch {}
        if (res.status === 409 && body?.code === "SHIPMENT_CHAT_CLOSED") {
          triggerToast("❌ This shipment is closed. Messages can no longer be sent.");
          fetchData();
        } else {
          triggerToast("❌ Message failed to send. Please try again.");
        }
      }
    } catch (err) {
      console.error(err);
      triggerToast("❌ Could not reach the server. Your message was not sent.");
    } finally {
      setIsSendingDriverMessage(false);
    }
  };

  // fix/chat-safety-reliability-phase1 (follow-up): if upload succeeds but
  // this POST /chat fails, the caller caches { shipmentId, fileUrl,
  // fileName, fileCategory } in pendingDriverAttachment so a retry (see
  // handleRetryDriverAttachment below) reuses that real Storage URL
  // instead of uploading the file a second time. Cleared on a confirmed
  // successful send; left untouched on failure so the retry banner stays
  // actionable.
  //
  // Takes `shipmentId` explicitly rather than reading activeShipment
  // inside this function — this always sends to the shipment the
  // ATTACHMENT belongs to (the one active when it was picked/uploaded),
  // never whichever shipment happens to be active by the time this async
  // call actually runs.
  const sendDriverFileMessage = async (shipmentId: string, fileUrl: string, fileName: string, fileCategory: DocumentCategory) => {
    try {
      const res = await apiFetch(`/api/shipments/${shipmentId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: "driver",
          senderName: getDriverName(),
          type: "file",
          fileName,
          fileCategory,
          fileUrl,
          text: `Sent a document [${fileCategory.toUpperCase()}]: ${fileName}`
        })
      });

      if (res.ok) {
        triggerToast(lang === 'tr' ? "📎 Dosya gönderildi!" : lang === 'ar' ? "📎 تم إرسال الملف!" : "📎 File sent to MARAS!");
        setPendingDriverAttachment(null);
        setDriverAttachmentError('');
        fetchData();
      } else {
        // PR #111 review (Delivered/Closed terminal & chat rules): a
        // closed shipment will keep rejecting this send no matter how
        // many times it's retried — never queue it as a retryable pending
        // attachment (which would let the driver keep re-attempting a send
        // that can never succeed).
        let body: any = null;
        try { body = await res.json(); } catch {}
        if (res.status === 409 && body?.code === "SHIPMENT_CHAT_CLOSED") {
          triggerToast("❌ This shipment is closed. Documents can no longer be sent.");
          fetchData();
        } else {
          setPendingDriverAttachment({ shipmentId, fileUrl, fileName, fileCategory });
          setDriverAttachmentError('send');
        }
      }
    } catch (e) {
      console.error(e);
      setPendingDriverAttachment({ shipmentId, fileUrl, fileName, fileCategory });
      setDriverAttachmentError('send');
    }
  };

  // Native chat attachment: paperclip -> OS file picker -> auto-send to
  // MARAS. Category is derived from the file's MIME type, never chosen by
  // the driver, and is restricted to "photo"/"other" — CMR is not
  // reachable from this flow (see documentAccess.ts / PR #71 server-side
  // rejection).
  const handleAttachmentSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !activeShipment) return;

    // fix/chat-safety-reliability-phase1 (follow-up): captured once, up
    // front — this is the shipment the file was actually picked/uploaded
    // for, and stays fixed for this whole attempt (including the retry it
    // may end up cached for) regardless of whether the driver switches to
    // a different shipment while the upload/send is in flight.
    const shipmentId = activeShipment.id;

    // Picking a new file replaces any previous pending (failed-to-send)
    // attachment — its cached URL belonged to a different file.
    setPendingDriverAttachment(null);
    setDriverAttachmentError('');
    setIsUploading(true);

    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (evt) => resolve(evt.target?.result as string);
        reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });

      const fileCategory: DocumentCategory = file.type.startsWith("image/") ? "photo" : "other";

      try {
        const uploadRes = await apiFetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base64DataUrl: dataUrl,
            filename: file.name
          })
        });
        if (!uploadRes.ok) {
          // fix/chat-safety-reliability-phase1: never send a chat message
          // whose fileUrl points at a file that was never actually saved —
          // block the send outright with a clear error instead.
          setDriverAttachmentError('upload');
          triggerToast("❌ Couldn't upload the file to storage. Your message was not sent — please try again.");
          return;
        }
        const uploadData = await uploadRes.json();
        await sendDriverFileMessage(shipmentId, uploadData.url, file.name, fileCategory);
      } catch (uploadGatewayErr) {
        console.warn("Upload request failed:", uploadGatewayErr);
        setDriverAttachmentError('upload');
        triggerToast("❌ Couldn't upload the file to storage. Your message was not sent — please try again.");
      }
    } catch (e) {
      console.error(e);
      triggerToast("❌ Failed to send attachment.");
    } finally {
      setIsUploading(false);
    }
  };

  // fix/chat-safety-reliability-phase1 (follow-up): reuses the cached
  // Storage URL from pendingDriverAttachment via the same
  // planAttachmentSend decision ChatCenter.tsx/App.tsx use — never
  // re-uploads the file. Verifies pendingDriverAttachment.shipmentId
  // still matches the currently active shipment before reusing anything —
  // if they somehow don't match, the pending attachment is cleared/blocked
  // rather than ever being posted into the wrong shipment.
  const handleRetryDriverAttachment = async () => {
    if (!pendingDriverAttachment || isUploading) return;
    if (!isCachedAttachmentForShipment(pendingDriverAttachment.shipmentId, activeShipment?.id ?? null)) {
      setPendingDriverAttachment(null);
      setDriverAttachmentError('');
      return;
    }
    const plan = planAttachmentSend(pendingDriverAttachment.fileUrl);
    if (plan.action !== "reuse_cached_url") return;
    setIsUploading(true);
    try {
      await sendDriverFileMessage(
        pendingDriverAttachment.shipmentId,
        plan.fileUrl,
        pendingDriverAttachment.fileName,
        pendingDriverAttachment.fileCategory
      );
    } finally {
      setIsUploading(false);
    }
  };

  const currentDriver = drivers.find(d => d.id === selectedDriverId) || null;

  const getDriverName = () => {
    return currentDriver ? currentDriver.name : "Driver";
  };

  // Jobs for the chat thread selector, most recently updated first.
  const chatJobs = useMemo(
    () => [...shipments].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')),
    [shipments]
  );

  // Offers awaiting this driver's answer (invited/viewed on a live offer).
  const pendingOffersCount = useMemo(
    () => allianceOffers.filter(o => o.status === 'broadcast' && (o.myResponse.status === 'invited' || o.myResponse.status === 'viewed')).length,
    [allianceOffers]
  );

  // Audited "Offer Viewed" ping — fire-and-forget, idempotent server-side.
  const handleOpenAllianceOffer = (offerId: string) => {
    apiFetch(`/api/alliance/offers/${offerId}/viewed`, { method: "POST" }).catch(() => {});
  };

  // One answer only: a USD quote (optional note) or a rejection. The
  // server enforces every rule (invited-only, offer still open, no second
  // answer); a rejection here just surfaces the server's message.
  const handleRespondAllianceOffer = async (
    offerId: string,
    action: "quote" | "reject",
    priceUsd?: number,
    note?: string
  ): Promise<boolean> => {
    try {
      const res = await apiFetch(`/api/alliance/offers/${offerId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "quote" ? { action, priceUsd, note, currency: "USD" } : { action }),
      });
      const body: any = await res.json().catch(() => ({}));
      if (res.ok) {
        setAllianceOffers(prev => prev.map(o => (o.id === offerId ? body : o)));
        triggerToast(
          action === "quote"
            ? (lang === 'tr' ? "✅ Fiyatınız MARAS'a gönderildi." : lang === 'ar' ? "✅ تم إرسال سعرك إلى MARAS." : "✅ Your price was sent to MARAS.")
            : (lang === 'tr' ? "Teklifi reddettiniz." : lang === 'ar' ? "رفضت العرض." : "You rejected the offer.")
        );
        return true;
      }
      triggerToast(`❌ ${body?.error || (lang === 'tr' ? "İşlem başarısız oldu." : lang === 'ar' ? "فشلت العملية." : "The action failed. Please try again.")}`);
      fetchData();
      return false;
    } catch (e) {
      console.error(e);
      triggerToast("❌ Could not reach the server. Please check your connection and try again.");
      return false;
    }
  };

  const openJobDetails = (shipment: Shipment) => {
    setActiveShipment(shipment);
    setActiveTab('jobs');
    setShowNotifications(false);
  };

  const openJobChat = (shipment: Shipment) => {
    setActiveShipment(shipment);
    setActiveTab('chat');
    setShowNotifications(false);
  };

  return (
    <div
      className={`${isMobileMode
        ? "w-full h-[100dvh] text-slate-100 flex flex-col bg-slate-950 overflow-hidden relative select-none"
        : "p-4 md:p-8 bg-slate-950 min-h-screen text-slate-100 flex flex-col lg:flex-row gap-8 justify-center items-center font-sans select-none"
      } ${theme === 'light' ? 'theme-light' : ''}`}
      dir={isRtl ? 'rtl' : 'ltr'}
    >

      {/* Local development preview controls — desktop, only when no real
          driver session exists. Plain wording; a logged-in driver never
          sees any of this. */}
      {!loggedInDriverId && !isMobileMode && (
        <div className="w-full lg:w-80 bg-slate-900 p-6 rounded-3xl border border-slate-800 space-y-5 shrink-0 overflow-y-auto">
          <div>
            <span className="text-xs font-bold text-orange-500 block mb-1">Developer preview</span>
            <h3 className="font-bold text-white text-base">Simulated driver account</h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">Local testing only — pick an account and optionally simulate being offline.</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-400 block">Account</label>
            <select
              value={selectedDriverId}
              onChange={(e) => {
                setSelectedDriverId(e.target.value);
                setActiveShipment(null);
                setActiveTab('home');
              }}
              className="w-full p-2.5 bg-slate-950 border border-slate-800 text-slate-200 text-sm font-semibold rounded-xl outline-none cursor-pointer"
            >
              {drivers.map(d => (
                <option key={d.id} value={d.id} className="bg-slate-950 text-slate-200">
                  {d.name} ({d.truckNumber})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setIsForceOffline(prev => !prev)}
            className={`w-full py-2.5 px-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 border cursor-pointer ${
              isForceOffline
                ? 'bg-emerald-600/10 border-emerald-500/30 text-emerald-400'
                : 'bg-amber-600/10 border-amber-500/30 text-amber-500'
            }`}
          >
            {isForceOffline ? <Wifi className="w-4 h-4 shrink-0" /> : <WifiOff className="w-4 h-4 shrink-0" />}
            <span>{isForceOffline ? 'Go back online' : 'Simulate offline'}</span>
          </button>
        </div>
      )}

      {/* Same local preview controls in mobile layout */}
      {isMobileMode && !loggedInDriverId && (
        <div className="fixed bottom-24 end-4 z-[999] flex flex-col items-end gap-2">
          {showControlsModal && (
            <div className="w-72 bg-slate-900 text-slate-100 p-4 rounded-3xl border border-slate-800 shadow-xl space-y-3 text-start">
              <div>
                <span className="text-xs font-bold text-orange-500 block">Developer preview</span>
                <h4 className="font-bold text-sm text-white">Simulated driver account</h4>
              </div>

              <select
                value={selectedDriverId}
                onChange={(e) => {
                  setSelectedDriverId(e.target.value);
                  setActiveShipment(null);
                  setActiveTab('home');
                  setShowControlsModal(false);
                }}
                className="w-full p-2.5 bg-slate-950 border border-slate-800 text-slate-200 text-sm font-semibold rounded-xl outline-none"
              >
                {drivers.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.truckNumber})
                  </option>
                ))}
              </select>

              <button
                onClick={() => {
                  setIsForceOffline(prev => !prev);
                  setShowControlsModal(false);
                }}
                className={`w-full py-2.5 bg-slate-950 border text-sm font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer ${
                  isForceOffline ? 'border-emerald-500/30 text-emerald-400' : 'border-amber-500/30 text-amber-500'
                }`}
              >
                {isForceOffline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
                <span>{isForceOffline ? 'Go back online' : 'Simulate offline'}</span>
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowControlsModal(!showControlsModal)}
            className="w-12 h-12 rounded-full bg-orange-500 hover:bg-orange-600 text-white flex items-center justify-center shadow-lg transition-all border-0 cursor-pointer active:scale-90"
            title="Developer preview controls"
          >
            <Truck className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* MOBILE APP SHELL (desktop keeps the phone-frame preview) */}
      <div
        className={isMobileMode
          ? "w-full h-full flex flex-col justify-between overflow-hidden relative bg-slate-950"
          : "relative mx-auto lg:mx-0 select-none"
        }
      >
        <div
          className={isMobileMode
            ? "w-full h-full flex flex-col justify-between overflow-hidden relative"
            : "w-full max-w-[390px] h-[790px] bg-slate-950 rounded-[50px] p-[10px] shadow-[0_35px_80px_-15px_rgba(0,0,0,0.9)] relative border-[12px] border-slate-800 flex flex-col justify-between overflow-hidden"
          }
        >
          {/* Inner app screen */}
          <div
            className={isMobileMode
              ? "w-full h-full bg-slate-950 text-slate-100 overflow-hidden flex flex-col relative"
              : "w-full h-full bg-slate-950 text-slate-100 rounded-[38px] overflow-hidden flex flex-col pt-6 relative"
            }
          >

            {/* Header */}
            <div className="px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] bg-slate-950 border-b border-slate-800 flex items-center justify-between z-20 relative shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
                  <Truck className="w-4.5 h-4.5 text-orange-500" />
                </div>
                <h1 className="text-white font-bold text-sm">{t('brand')}</h1>
              </div>

              <NotificationBell
                unreadCount={unreadNotificationCount}
                label={t('notifications')}
                onClick={() => setShowNotifications(v => !v)}
              />
            </div>

            {/* Toast */}
            {toast && (
              <div className="absolute top-16 start-4 end-4 bg-orange-600 text-white p-3 rounded-2xl text-sm font-semibold flex items-center gap-2 shadow-lg z-50 light-preserve">
                <CheckCircle2 className="w-4 h-4 text-white shrink-0" />
                <span className="text-start">{toast}</span>
              </div>
            )}

            {/* Content area — Chat manages its own internal scrolling; the
                other screens scroll here. Bottom navigation sits OUTSIDE
                this area, so it can never cover content. */}
            {showNotifications ? (
              <div className="flex-1 overflow-y-auto bg-slate-950 p-4">
                <NotificationsPanel
                  notifications={myNotifications}
                  lang={lang}
                  title={t('notifications')}
                  onBack={() => setShowNotifications(false)}
                />
              </div>
            ) : showOffers ? (
              <div className="flex-1 overflow-y-auto bg-slate-950 p-4">
                <DriverOffersScreen
                  lang={lang}
                  offers={allianceOffers}
                  onBack={() => setShowOffers(false)}
                  onOpenOffer={handleOpenAllianceOffer}
                  onRespond={handleRespondAllianceOffer}
                />
              </div>
            ) : activeTab === 'chat' ? (
              <div className="flex-1 min-h-0 bg-slate-950">
                <DriverChatScreen
                  lang={lang}
                  jobs={chatJobs}
                  activeShipment={activeShipment}
                  onSelectJob={(s) => setActiveShipment(s)}
                  unreadByShipmentId={unreadChatByShipmentId}
                  visibleMessages={visibleChatMessages}
                  totalMessageCount={chatMessages.length}
                  isChatClosed={isShipmentChatClosed}
                  searchQuery={chatSearchQuery}
                  onSearchQueryChange={setChatSearchQuery}
                  hasOlderMessages={hasOlderChatMessages}
                  isLoadingOlder={isLoadingOlderChat}
                  onLoadOlder={loadOlderChatMessages}
                  newMessageText={newMessageText}
                  onNewMessageTextChange={setNewMessageText}
                  onSendMessage={handleSendMessage}
                  isSending={isSendingDriverMessage}
                  isUploading={isUploading}
                  onAttachmentSelected={handleAttachmentSelected}
                  attachmentError={driverAttachmentError}
                  canRetryAttachment={!!pendingDriverAttachment}
                  onRetryAttachment={handleRetryDriverAttachment}
                  messagesContainerRef={messagesContainerRef}
                  messagesEndRef={messagesEndRef}
                  onMessagesScroll={handleMessagesScroll}
                  textareaRef={driverTextareaRef}
                  composerMinHeightPx={DRIVER_COMPOSER_MIN_HEIGHT_PX}
                  composerMaxHeightPx={DRIVER_COMPOSER_MAX_HEIGHT_PX}
                />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto bg-slate-950 p-4">
                {activeTab === 'home' && (
                  <DriverHomeScreen
                    driverName={getDriverName()}
                    driverId={selectedDriverId}
                    activeJob={activeJob}
                    lang={lang}
                    gpsAvailable={gpsAvailable}
                    isReportingLocation={isReportingLocation}
                    isSubmittingStatus={isSubmittingStatus}
                    onSubmitNextStatus={handleSubmitNextStatus}
                    onAccept={handleAcceptAssignment}
                    onDecline={handleRejectAssignment}
                    onOpenChat={openJobChat}
                    onOpenDetails={openJobDetails}
                    onViewJobs={() => setActiveTab('jobs')}
                    pendingOffersCount={pendingOffersCount}
                    onOpenOffers={() => setShowOffers(true)}
                  />
                )}

                {activeTab === 'jobs' && !activeShipment && (
                  <DriverJobsScreen
                    shipments={shipments}
                    driverId={selectedDriverId}
                    lang={lang}
                    unreadByShipmentId={unreadChatByShipmentId}
                    onOpenJob={openJobDetails}
                    hasMore={shipmentsHasMore}
                    isLoadingMore={shipmentsLoadingMore}
                    onLoadMore={handleLoadMoreShipments}
                  />
                )}

                {activeTab === 'jobs' && activeShipment && (
                  <DriverJobDetails
                    shipment={activeShipment}
                    driverId={selectedDriverId}
                    lang={lang}
                    isSubmittingStatus={isSubmittingStatus}
                    remarks={remarks}
                    onRemarksChange={setRemarks}
                    onSubmitNextStatus={() => handleSubmitNextStatus(activeShipment)}
                    onAccept={() => handleAcceptAssignment(activeShipment)}
                    onDecline={() => handleRejectAssignment(activeShipment)}
                    onBack={() => setActiveShipment(null)}
                    onOpenChat={() => openJobChat(activeShipment)}
                  />
                )}

                {activeTab === 'account' && (
                  <DriverAccountScreen
                    lang={lang}
                    driverId={selectedDriverId}
                    driver={currentDriver}
                    theme={theme}
                    onThemeChange={setTheme}
                    onLanguageChange={onLanguageChange}
                    onLogout={onLogout}
                    onDriverUpdated={(updated) => {
                      setDrivers(prev => prev.map(d => d.id === updated.id ? updated : d));
                      fetchData();
                    }}
                    onToast={triggerToast}
                  />
                )}
              </div>
            )}

            {/* Bottom navigation — exactly Home, Jobs, Chat, Account */}
            <DriverBottomNavigation
              activeTab={activeTab}
              lang={lang}
              chatUnreadCount={totalUnreadChat}
              onSelect={(tab) => {
                setShowNotifications(false);
                setShowOffers(false);
                if (tab === 'jobs' && activeTab === 'jobs') {
                  // Re-tapping Jobs from details returns to the list.
                  setActiveShipment(null);
                }
                setActiveTab(tab);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
