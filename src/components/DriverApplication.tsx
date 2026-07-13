import React, { useState, useEffect, useRef, useMemo } from "react";
import { 
  Shipment, 
  Driver, 
  ChatMessage, 
  AppNotification, 
  ShipmentStatus,
  Language,
  DocumentCategory,
  TRUCK_TYPES
} from "../types";
import { auth } from "../googleAuth";
import { TRANSLATIONS } from "../translations";
import { apiFetch } from "../lib/api";
import { resolveDriverAgreedAmount, resolveDriverTruckNumber, FREIGHT_TYPE_LABELS } from "../lib/driverVisibility";
import { GPS_DEFAULT_UPDATE_INTERVAL_MS } from "../lib/gpsFreshness";
import { isNotificationForDriver, isNotificationReadForUser, addReaderToNotification } from "../lib/notificationAccess";
import { MAX_CHAT_TEXT_LENGTH } from "../lib/chatMessageValidation";
import { canSubmitChatMessage, isStaleChatPollResponse, planAttachmentSend } from "../lib/chatComposerState";
import { useIsMobile } from "../hooks/useIsMobile";
import DriverBottomNav from "./driver/DriverBottomNav";
import NotificationBell from "./driver/NotificationBell";
import NotificationsPanel from "./driver/NotificationsPanel";
import ShipmentCard from "./driver/ShipmentCard";
import DriverHome from "./driver/DriverHome";
import {
  MessageSquare, Truck, Send, CheckCircle2,
  X, Camera, FileUp, User,
  Edit2, Phone, Shield, Check, Activity, Briefcase, Paperclip, Search,
  Settings, Trash2, ShieldAlert,
  Sun, Moon, Lock
} from 'lucide-react';

const fetch = apiFetch;

interface DriverApplicationProps {
  lang: Language;
  loggedInDriverId?: string | null;
  loggedInDriver?: Driver | null;
  onLogout?: () => void;
  onLanguageChange?: (lang: Language) => void;
  isMobile?: boolean;
}

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

  // Profile translation dictionary
  const profileT = {
    en: {
      profileTitle: "My Driver Profile",
      personalData: "Personal & Vehicle Data",
      fullName: "Full Name",
      username: "Username",
      phone: "Contact phone",
      truckNumber: "Plate Number / Truck ID",
      truckType: "Truck Type / Category",
      saveProfile: "Save Changes",
      profileUpdated: "Profile updated successfully!",
      noActive: "None",
      saveSpinner: "Updating account...",
      logout: "Log Out Account"
    },
    tr: {
      profileTitle: "Sürücü Profilim",
      personalData: "Kişisel ve Araç Bilgileri",
      fullName: "Adı Soyadı",
      username: "Kullanıcı Adı",
      phone: "İrtibat Telefonu",
      truckNumber: "Plaka Numarası / Tır ID",
      truckType: "Tır / Dorse Kategori",
      saveProfile: "Değişiklikleri Kaydet",
      profileUpdated: "Profiliniz başarıyla güncellendi!",
      noActive: "Yok",
      saveSpinner: "Kayıt güncelleniyor...",
      logout: "Güvenli Çıkış Yap"
    },
    ar: {
      profileTitle: "ملفي الشخصي كأخصائي نقل",
      personalData: "البيانات الشخصية وبيانات المركبة",
      fullName: "الاسم الكامل",
      username: "اسم المستخدم",
      phone: "رقم الهاتف",
      truckNumber: "رقم اللوحة / الشاحنة",
      truckType: "صنف ونوع الشاحنة",
      saveProfile: "حفظ التغييرات",
      profileUpdated: "تم تحديث الملف الشخصي بنجاح!",
      noActive: "لا يوجد",
      saveSpinner: "جاري حفظ التعديلات...",
      logout: "تسجيل الخروج"
    }
  }[lang] || {
    profileTitle: "My Driver Profile",
    personalData: "Personal & Vehicle Data",
    fullName: "Full Name",
    username: "Username",
    phone: "Contact phone",
    truckNumber: "Plate Number / Truck ID",
    saveProfile: "Save Changes",
    profileUpdated: "Profile updated successfully!",
    noActive: "None",
    saveSpinner: "Updating account...",
    logout: "Log Out Account"
  };

  // Driver Selector (for mockup simulation simplicity)
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
  const gpsCooldownRef = React.useRef<number>(0);
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
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  
  // Active selected shipment for detail / chat inside driver app
  const [activeShipment, setActiveShipment] = useState<Shipment | null>(null);
  const isShipmentFinished = activeShipment ? (activeShipment.status === 'Delivered' || activeShipment.status === 'Arrived' || activeShipment.status === 'Closed' || activeShipment.status === 'Completed') : false;

  useEffect(() => {
    activeShipmentIdRef.current = activeShipment?.id ?? null;
  }, [activeShipment?.id]);

  // Notifications scoped to this driver's own shipments, plus anything
  // addressed directly to this driver regardless of shipment (e.g.
  // "Driver Approved" — see AppNotification.recipientUserId).
  // isNotificationForDriver is shared with server.ts's own GET
  // /api/notifications scoping so the two can't silently drift apart.
  const myNotifications = useMemo(() => {
    const myShipmentIds = new Set([
      ...shipments.map(s => s.id),
      ...(activeShipment ? [activeShipment.id] : [])
    ]);
    return notifications.filter(n => isNotificationForDriver(n, loggedInDriverId || "", myShipmentIds));
  }, [notifications, shipments, activeShipment, loggedInDriverId]);
  // Notification Phase 1 correction: unread status is per-user
  // (readByUserIds), not the legacy shared `read` flag — reading the
  // shared flag here would mean one driver's (or admin's, or client's)
  // read marks the notification read for every other driver too, since
  // they all read the same underlying document.
  const unreadNotificationCount = useMemo(
    () => myNotifications.filter(n => !isNotificationReadForUser(n, loggedInDriverId || "")).length,
    [myNotifications, loggedInDriverId]
  );

  // Marks the given notification ids as read via the same authenticated
  // per-notification endpoint every other role already uses
  // (POST /api/notifications/:id/read) — never the admin-only
  // /api/notifications/clear route, which this driver session has no
  // permission to call anyway. Local state (and therefore the unread
  // badge) is only updated for an id once its own request actually
  // succeeds; a failed request leaves that notification unread both on
  // the server and locally, so it's retried the next time this runs
  // instead of silently disappearing from the badge count. Only this
  // driver's own id is added to readByUserIds (addReaderToNotification
  // preserves whatever ids were already there) — this driver reading a
  // notification never marks it read for any other driver, admin, or
  // client.
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

  // Determine the primary active job to feature on the Home screen.
  // Priority: Assigned > In Transit / Border Crossing / Customs Clearance > others (most recently updated first).
  const homeActiveJob = useMemo(() => {
    const FINISHED = new Set(['Delivered', 'Arrived', 'Closed', 'Completed']);
    const active = shipments.filter(s => !FINISHED.has(s.status));
    if (active.length === 0) return null;

    const priority = (s: (typeof active)[0]): number => {
      if (s.status === 'Assigned') return 0;
      if (s.status === 'In Transit' || s.status === 'Border Crossing' || s.status === 'Customs Clearance') return 1;
      return 2;
    };

    return [...active].sort((a, b) => {
      const pd = priority(a) - priority(b);
      if (pd !== 0) return pd;
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    })[0];
  }, [shipments]);

  const [activeTab, setActiveTab] = useState<'home' | 'shipments' | 'chat' | 'notifications' | 'profile' | 'menu'>('home');

  // Opening the Notifications screen marks every currently-visible unread
  // notification as read. Re-runs whenever the visible list changes (e.g.
  // a new notification arrives from the 12s poll while this tab is still
  // open) so it also catches unread items that appear after the initial
  // open, not just the ones present at the moment of opening.
  useEffect(() => {
    if (activeTab !== 'notifications') return;
    const unreadIds = myNotifications.filter(n => !isNotificationReadForUser(n, loggedInDriverId || "")).map(n => n.id);
    if (unreadIds.length > 0) {
      markNotificationsRead(unreadIds);
    }
  }, [activeTab, myNotifications, markNotificationsRead, loggedInDriverId]);

  // Profile Form States
  const [profileName, setProfileName] = useState("");
  const [profileUsername, setProfileUsername] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [profileTruckNumber, setProfileTruckNumber] = useState("");
  const [profileTruckType, setProfileTruckType] = useState("reefer");
  const [profileAvatarUrl, setProfileAvatarUrl] = useState("");
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const avatarFileRef = useRef<HTMLInputElement>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);

  const [shipmentsFilter, setShipmentsFilter] = useState<'active' | 'completed'>('active');

  // Input states
  const [newMessageText, setNewMessageText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const statusFormRef = useRef<HTMLFormElement>(null);
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const [remarks, setRemarks] = useState("");
  const [selectedStatusVal, setSelectedStatusVal] = useState<ShipmentStatus>("Accepted");
  
  // Auto-scroll chat to bottom
  useEffect(() => {
    if (activeTab === 'chat' && chatMessages.length > 0) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 80);
    }
  }, [chatMessages.length, activeTab, activeShipment?.id]);
  
  // Theme mode switch (light vs dark)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('driver_app_theme');
    return (saved === 'light' || saved === 'dark') ? saved : 'dark';
  });

  useEffect(() => {
    localStorage.setItem('driver_app_theme', theme);
  }, [theme]);

  // Driver Account Deletion States
  const [showDriverDeleteConfirm, setShowDriverDeleteConfirm] = useState(false);
  const [understandDriverDelete, setUnderstandDriverDelete] = useState(false);
  const [isDeletingDriverAccount, setIsDeletingDriverAccount] = useState(false);

  const handleDeleteDriverAccount = async () => {
    if (!understandDriverDelete) return;
    setIsDeletingDriverAccount(true);
    const targetId = loggedInDriverId || selectedDriverId;
    try {
      // 1. Delete backing collection data
      const response = await apiFetch(`/api/drivers/${targetId}`, {
        method: "DELETE"
      });
      if (response.ok) {
        // 2. Delete user session from Firebase auth (if exists)
        try {
          if (auth.currentUser) {
            await auth.currentUser.delete();
          }
        } catch (authErr) {
          console.warn("Firebase Auth deletion failed or requires reauthentication:", authErr);
        }
        triggerToast("🗑️ Account completely deleted from corporate registry.");
        // Logout user session and clean state
        if (onLogout) {
          onLogout();
        }
      } else {
        triggerToast("❌ Failed to initiate account purge. Try again.");
      }
    } catch (err) {
      console.error(err);
      triggerToast("❌ Purge action failed. Check connection.");
    } finally {
      setIsDeletingDriverAccount(false);
      setShowDriverDeleteConfirm(false);
    }
  };

  // Native chat attachment (paperclip -> hidden file input -> auto-send)
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  // fix/chat-safety-reliability-phase1 (follow-up): set when an upload
  // succeeded but the follow-up POST /chat failed — holds the real
  // Storage URL so retrying (handleRetryDriverAttachment) reuses it
  // instead of uploading the file again. Cleared on a confirmed
  // successful send or when a new file is picked; never on a failed send.
  const [pendingDriverAttachment, setPendingDriverAttachment] = useState<{
    fileUrl: string;
    fileName: string;
    fileCategory: DocumentCategory;
  } | null>(null);
  // Distinguishes "the upload itself failed (nothing sent)" from "the
  // upload succeeded but creating the chat message failed" — the two
  // need different, explicit copy.
  const [driverAttachmentError, setDriverAttachmentError] = useState<'' | 'upload' | 'send'>('');

  // GPS state — null = not yet checked, true = real fix obtained, false = unavailable/denied
  const [gpsAvailable, setGpsAvailable] = useState<boolean | null>(null);
  const [lastGpsCoords, setLastGpsCoords] = useState<{ lat: number; lng: number } | null>(null);

  const [toast, setToast] = useState<string | null>(null);

  // GPS caching and offline simulation states
  const [cachedCoords, setCachedCoords] = useState<{ lat: number; lng: number; timestamp: string }[]>(() => {
    try {
      const saved = localStorage.getItem(`etir_cached_gps_${selectedDriverId}`);
      return saved ? JSON.parse(saved) : [];
    } catch (_) {
      return [];
    }
  });
  const [isForceOffline, setIsForceOffline] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncAttemptTime, setLastSyncAttemptTime] = useState<number>(0);

  useEffect(() => {
    try {
      localStorage.setItem(`etir_cached_gps_${selectedDriverId}`, JSON.stringify(cachedCoords));
    } catch (_) {}
  }, [cachedCoords, selectedDriverId]);

  const triggerToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // Fetch drivers list & shipment context
  const fetchData = async () => {
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

      let activeShipmentsList: Shipment[] = [];
      const resShipments = await apiFetch(`/api/shipments?driverId=${selectedDriverId}`);
      if (resShipments.ok) {
        const list = await safeJson(resShipments);
        activeShipmentsList = list;
        setShipments(list);
        
        // update active shipment details dynamically if it is loaded
        if (activeShipment) {
          const fresh = list.find((s: Shipment) => s.id === activeShipment.id);
          if (fresh) {
            setActiveShipment(fresh);
            const isCompleted = fresh.status === 'Delivered' || fresh.status === 'Arrived' || fresh.status === 'Closed' || fresh.status === 'Completed';
            if (isCompleted) {
              setGpsAvailable(null);
            }
          }
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
          const msgs: ChatMessage[] = await safeJson(resChat);

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
                      ? `💬 Dispatch: "${m.text}"`
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
        const rawList: AppNotification[] = await safeJson(resNotifs);
        
        // Filter list strictly to this driver's shipments, plus anything
        // addressed directly to this driver regardless of shipment (e.g.
        // "Driver Approved" — see AppNotification.recipientUserId). The
        // backend (GET /api/notifications) already scopes both cases the
        // same way via the same isNotificationForDriver helper; this
        // mirrors that so a locally-computed active-job list can't
        // disagree with it.
        const driverShipmentIds = new Set([
          ...activeShipmentsList.map(s => s.id),
          ...(activeShipment ? [activeShipment.id] : [])
        ]);
        const list = rawList.filter(n => isNotificationForDriver(n, loggedInDriverId || "", driverShipmentIds));
        
        if (knownNotificationIdsRef.current.size === 0) {
          const initialIds = new Set<string>();
          list.forEach((n) => initialIds.add(n.id));
          knownNotificationIdsRef.current = initialIds;
        } else {
          for (const notif of list) {
            if (!knownNotificationIdsRef.current.has(notif.id)) {
              knownNotificationIdsRef.current.add(notif.id);

              // Chat notifications carry excludeUserId set to the sender's
              // own session id (req.session.id at send time, i.e. this
              // driver's own driver doc id). The backend already omits
              // these from this driver's own GET /api/notifications
              // response, but guard here too so this driver's own message
              // never pops a toast for them.
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

    } catch (e) {
      console.warn("Telemetry or data fetch error: ", e);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 12000);
    return () => clearInterval(interval);
  }, [selectedDriverId, activeShipment?.id]);

  // Fast chat-only polling when active tab is chat to support snappy read receipts and messaging updates
  useEffect(() => {
    let interval: any;
    if (activeShipment && activeTab === 'chat') {
      const requestedShipmentId = activeShipment.id;
      const fetchChatOnly = async () => {
        try {
          const resChat = await apiFetch(`/api/shipments/${requestedShipmentId}/chat`);
          if (resChat.ok) {
            const txt = await resChat.text();
            if (txt.trim() && !txt.trim().startsWith("<")) {
              const msgs: ChatMessage[] = JSON.parse(txt);

              // fix/chat-safety-reliability-phase1: guard against this
              // response landing after the driver has already switched to
              // a different shipment or left the chat tab.
              if (isStaleChatPollResponse(activeShipmentIdRef.current, requestedShipmentId)) return;

              setChatMessages(msgs);
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

  // Synchronize edit profile drafts when simulated driver or driver catalog changes
  useEffect(() => {
    const dr = drivers.find(d => d.id === selectedDriverId);
    if (dr) {
      setProfileName(dr.name || "");
      setProfileUsername(dr.username || "");
      setProfilePhone(dr.phone || "");
      setProfileTruckNumber(dr.truckNumber || "");
      setProfileTruckType(dr.truckType || "reefer");
      setProfileAvatarUrl(dr.avatarUrl || "");
    }
  }, [selectedDriverId, drivers]);

  // Unified GPS transmission with caching on connection failure and rate limit resilience
  const transmitGPS = async (lat: number, lng: number) => {
    const timestamp = new Date().toISOString();
    const isOffline = isForceOffline || !navigator.onLine;

    // Direct local caching if offline or under rate-limit cooldown
    if (isOffline || Date.now() < gpsCooldownRef.current) {
      const newPoint = { lat, lng, timestamp };
      setCachedCoords(prev => {
        const next = [...prev, newPoint];
        return next.slice(-30);
      });
      if (Date.now() < gpsCooldownRef.current) {
        console.warn("Telemetry transmission postponed due to rate-limit cooldown. Caching coordinates locally:", newPoint);
      } else {
        console.log("Local caching: connection is offline, cached GPS locally.", newPoint);
      }
      return false;
    }

    try {
      const dr = drivers.find(d => d.id === selectedDriverId);
      if (dr) {
        const res = await apiFetch(`/api/drivers/${selectedDriverId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...dr,
            latitude: lat,
            longitude: lng,
            lastUpdated: timestamp
          })
        });

        if (res.status === 429) {
          // Trigger 30-second client-side cooldown to protect the gateway/database
          gpsCooldownRef.current = Date.now() + 30000;
          console.warn("GPS transmission throttled by platform rate limits (429). Storing inside local cache and cooling down live transmitter for 30s.");
          
          const newPoint = { lat, lng, timestamp };
          setCachedCoords(prev => {
            const next = [...prev, newPoint];
            return next.slice(-30);
          });
          return false;
        }

        if (!res.ok) {
          throw new Error("HTTP error status " + res.status);
        }
        return true;
      }
    } catch (err: any) {
      console.warn("Telemetry transmission failed, caching coordinates locally:", err.message || err);
      const newPoint = { lat, lng, timestamp };
      setCachedCoords(prev => {
        const next = [...prev, newPoint];
        return next.slice(-30);
      });
      return false;
    }
    return false;
  };

  // Sync back cached points once connection is restored
  const triggerGpsSync = async () => {
    if (isSyncing || cachedCoords.length === 0) return;
    setIsSyncing(true);
    setLastSyncAttemptTime(Date.now());

    const dr = drivers.find(d => d.id === selectedDriverId);
    if (!dr) {
      setIsSyncing(false);
      return;
    }

    console.log("Background synchronization: Restoring telemetry log...");
    const itemsToSync = [...cachedCoords];

    try {
      let syncedCount = 0;
      for (const item of itemsToSync) {
        const res = await apiFetch(`/api/drivers/${selectedDriverId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...dr,
            latitude: item.lat,
            longitude: item.lng,
            lastUpdated: item.timestamp
          })
        });
        if (res.ok) {
          syncedCount++;
        }
        await new Promise(r => setTimeout(r, 200));
      }

      console.log(`✅ Sync completed: ${syncedCount} GPS points synchronized!`);
      if (syncedCount === 0 && itemsToSync.length > 0) {
        triggerToast("⚠️ GPS location sync failed. Your recent location updates haven't reached dispatch yet — will retry automatically.");
      } else {
        setCachedCoords([]);
      }
    } catch (e) {
      console.error("GPS cache synchronization failed:", e);
    } finally {
      setIsSyncing(false);
      setLastSyncAttemptTime(Date.now());
    }
  };

  // Auto-sync when going online
  useEffect(() => {
    const isOnline = !isForceOffline && navigator.onLine;
    const dr = drivers.find(d => d.id === selectedDriverId);
    const now = Date.now();
    // Only trigger if we are online, have cached points, and are not already syncing/throttled on cooldown
    if (isOnline && cachedCoords.length > 0 && !isSyncing && dr && (now - lastSyncAttemptTime > 15000)) {
      triggerGpsSync();
    }
  }, [isForceOffline, cachedCoords.length, isSyncing, drivers, selectedDriverId, lastSyncAttemptTime]);

  // Smart Tracking GPS transmitter — only runs when there is an active
  // shipment. eTIR sends a GPS fix on GPS_DEFAULT_UPDATE_INTERVAL_MS
  // (15 minutes by default) rather than continuously, to protect driver
  // battery and app performance; this is not live every-second tracking.
  // The immediate poll() call below covers "manual update" moments
  // (e.g. right after accepting a shipment) — see handleAcceptAssignment.
  useEffect(() => {
    if (!activeShipment?.id) return;

    const poll = () => {
      if (!navigator.geolocation) {
        setGpsAvailable(false);
        return;
      }
      try {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            setGpsAvailable(true);
            setLastGpsCoords({ lat, lng });
            transmitGPS(lat, lng);
          },
          (err) => {
            console.warn("[GPS] Location unavailable:", err.message);
            setGpsAvailable(false);
          },
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
        );
      } catch (err) {
        console.warn("[GPS] Geolocation blocked:", err);
        setGpsAvailable(false);
      }
    };

    poll(); // immediate first check when the shipment becomes active
    const interval = setInterval(poll, GPS_DEFAULT_UPDATE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [activeShipment?.id, selectedDriverId, drivers, isForceOffline]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileName.trim()) return;
    setIsSavingProfile(true);
    try {
      const res = await apiFetch(`/api/drivers/${selectedDriverId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profileName,
          username: profileUsername,
          phone: profilePhone,
          truckNumber: profileTruckNumber,
          truckType: profileTruckType,
          avatarUrl: profileAvatarUrl
        })
      });
      if (res.ok) {
        const updated = await res.json();
        // Update local drivers state
        setDrivers(prev => prev.map(d => d.id === selectedDriverId ? updated : d));
        triggerToast(profileT.profileUpdated);
        setIsEditingProfile(false);
        // Refresh all data
        fetchData();
      } else {
        let msg = "Failed to update profile. Please try again.";
        try { msg = (await res.json())?.error || msg; } catch {}
        triggerToast(`❌ ${msg}`);
      }
    } catch (err) {
      console.error(err);
      triggerToast("❌ Could not reach the server. Please check your connection and try again.");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleUploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingAvatar(true);
    
    try {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        const base64DataUrl = evt.target?.result as string;
        if (!base64DataUrl) {
          setIsUploadingAvatar(false);
          return;
        }

        let uploadedUrl = "";
        let uploadedViaGateway = false;

        // Upload via the server, which now writes durably to Firebase
        // Storage itself (see /api/upload in server.ts) — no separate
        // client-side Storage fallback needed or possible anymore, since
        // Storage now requires the server's own dedicated account
        // (see storage.rules).
        try {
          const uploadRes = await apiFetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              base64DataUrl,
              filename: file.name
            })
          });
          if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            uploadedUrl = uploadData.url;
            uploadedViaGateway = true;
            console.log("Avatar uploaded successfully via server upload gateway:", uploadedUrl);
          }
        } catch (gatewayErr) {
          console.warn("Avatar upload request failed:", gatewayErr);
        }

        if (!uploadedViaGateway) {
          triggerToast(lang === 'tr' ? "Yükleme başarısız oldu!" : (lang === 'ar' ? "فشل رفع الصورة!" : "Failed to upload avatar image. Please try again."));
          setIsUploadingAvatar(false);
          return;
        }

        setProfileAvatarUrl(uploadedUrl);

        // Force immediate database update to ensure instant persistence
        const res = await apiFetch(`/api/drivers/${selectedDriverId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: profileName,
            username: profileUsername,
            phone: profilePhone,
            truckNumber: profileTruckNumber,
            truckType: profileTruckType,
            avatarUrl: uploadedUrl
          })
        });
        if (res.ok) {
          const updated = await res.json();
          setDrivers(prev => prev.map(d => d.id === selectedDriverId ? updated : d));
          triggerToast(lang === 'tr' ? "Profil resmi güncellendi!" : (lang === 'ar' ? "تم تحديث الصورة الشخصية!" : "Profile photo updated!"));
          fetchData();
        } else {
          triggerToast(lang === 'tr' ? "Resim yüklendi ama profil kaydedilemedi. Lütfen tekrar deneyin." : (lang === 'ar' ? "تم رفع الصورة لكن فشل حفظ الملف الشخصي. حاول مرة أخرى." : "Photo uploaded but couldn't save to your profile. Please try again."));
        }
        setIsUploadingAvatar(false);
      };

      reader.onerror = () => {
        setIsUploadingAvatar(false);
        triggerToast("Failed to read file.");
      };

      reader.readAsDataURL(file);
    } catch (err) {
      console.error("Avatar upload failed:", err);
      triggerToast("Failed to upload avatar image");
      setIsUploadingAvatar(false);
    }
  };

  // Handle Order Acceptance
  const handleAcceptAssignment = async (shipment: Shipment) => {
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

        // Attempt a one-shot GPS fix on accept; the interval loop will take over from here
        if (navigator.geolocation) {
          try {
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                setGpsAvailable(true);
                setLastGpsCoords({ lat, lng });
                transmitGPS(lat, lng);
              },
              (err) => {
                console.warn("[GPS] Location unavailable on accept:", err.message);
                setGpsAvailable(false);
                triggerToast("📡 Location unavailable — enable GPS to share your position with dispatch.");
              },
              { enableHighAccuracy: true, timeout: 5000 }
            );
          } catch (geoErr) {
            console.warn("[GPS] Geolocation blocked on accept:", geoErr);
            setGpsAvailable(false);
          }
        } else {
          setGpsAvailable(false);
        }

        fetchData();
      } else {
        let msg = "Failed to accept assignment. Please try again.";
        try { msg = (await res.json())?.error || msg; } catch {}
        triggerToast(`❌ ${msg}`);
      }
    } catch (e) {
      console.error(e);
      triggerToast("❌ Could not reach the server. Please check your connection and try again.");
    }
  };

  // Handle Order Rejection
  const handleRejectAssignment = async (shipment: Shipment) => {
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
        try { msg = (await res.json())?.error || msg; } catch {}
        triggerToast(`❌ ${msg}`);
      }
    } catch (e) {
      console.error(e);
      triggerToast("❌ Could not reach the server. Please check your connection and try again.");
    }
  };

  // Handle Custom Status Update Form
  const handleStatusUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShipment) return;
    try {
      const res = await apiFetch(`/api/shipments/${activeShipment.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: selectedStatusVal,
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
        try { msg = (await res.json())?.error || msg; } catch {}
        triggerToast(`❌ ${msg}`);
      }
    } catch (e) {
      console.error(e);
      triggerToast("❌ Could not reach the server. Please check your connection and try again.");
    }
  };

  // fix/chat-safety-reliability-phase1: in-flight guard — previously this
  // had no reentrancy protection at all, so a double-tap/double-Enter
  // could fire two POSTs before the first resolved.
  const [isSendingDriverMessage, setIsSendingDriverMessage] = useState(false);

  // Chat message injection
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShipment) return;
    if (!canSubmitChatMessage({ text: newMessageText, hasAttachment: false, isSending: isSendingDriverMessage })) return;
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
        triggerToast("❌ Message failed to send. Please try again.");
      }
    } catch (err) {
      console.error(err);
      triggerToast("❌ Could not reach the server. Your message was not sent.");
    } finally {
      setIsSendingDriverMessage(false);
    }
  };

  // fix/chat-safety-reliability-phase1 (follow-up): if upload succeeds but
  // this POST /chat fails, the caller caches { fileUrl, fileName,
  // fileCategory } in pendingDriverAttachment (never the caller's own
  // local state again) so a retry (see handleRetryDriverAttachment below)
  // reuses that real Storage URL instead of uploading the file a second
  // time. Cleared on a confirmed successful send; left untouched on
  // failure so the retry banner stays actionable.
  const sendDriverFileMessage = async (fileUrl: string, fileName: string, fileCategory: DocumentCategory) => {
    if (!activeShipment) return;
    try {
      const res = await apiFetch(`/api/shipments/${activeShipment.id}/chat`, {
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
        triggerToast(lang === 'tr' ? "📎 Dosya gönderildi!" : lang === 'ar' ? "📎 تم إرسال الملف!" : "📎 File sent to Admin!");
        setPendingDriverAttachment(null);
        setDriverAttachmentError('');
        fetchData();
      } else {
        setPendingDriverAttachment({ fileUrl, fileName, fileCategory });
        setDriverAttachmentError('send');
      }
    } catch (e) {
      console.error(e);
      setPendingDriverAttachment({ fileUrl, fileName, fileCategory });
      setDriverAttachmentError('send');
    }
  };

  // Native chat attachment: paperclip -> OS file picker -> auto-send to Admin.
  // Category is derived from the file's MIME type, never chosen by the
  // driver, and is restricted to "photo"/"other" — CMR is not reachable
  // from this flow (see documentAccess.ts / PR #71 server-side rejection).
  const handleAttachmentSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !activeShipment) return;

    // fix/chat-safety-reliability-phase1 (follow-up): picking a new file
    // replaces any previous pending (failed-to-send) attachment — its
    // cached URL belonged to a different file.
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
          // fix/chat-safety-reliability-phase1: this previously still sent
          // a chat message with fileUrl: "#" (a dead link) even when the
          // upload failed. Block the send outright instead, consistent
          // with every other chat surface — the driver gets a clear error
          // and can retry by picking the file again, rather than a message
          // going out that references a file that was never actually saved.
          setDriverAttachmentError('upload');
          triggerToast("❌ Couldn't upload the file to storage. Your message was not sent — please try again.");
          return;
        }
        const uploadData = await uploadRes.json();
        await sendDriverFileMessage(uploadData.url, file.name, fileCategory);
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
  // re-uploads the file.
  const handleRetryDriverAttachment = async () => {
    if (!pendingDriverAttachment || isUploading) return;
    const plan = planAttachmentSend(pendingDriverAttachment.fileUrl);
    if (plan.action !== "reuse_cached_url") return;
    setIsUploading(true);
    try {
      await sendDriverFileMessage(
        plan.fileUrl,
        pendingDriverAttachment.fileName,
        pendingDriverAttachment.fileCategory
      );
    } finally {
      setIsUploading(false);
    }
  };

  const getDriverName = () => {
    const dr = drivers.find(d => d.id === selectedDriverId);
    return dr ? dr.name : "Driver";
  };

  const getDriverTruck = () => {
    const dr = drivers.find(d => d.id === selectedDriverId);
    return dr ? dr.truckNumber : "";
  };

  return (
    <div 
      className={`${isMobileMode 
        ? "w-full h-[100dvh] text-slate-100 flex flex-col bg-slate-950 overflow-hidden relative select-none" 
        : "p-4 md:p-8 bg-slate-950 min-h-screen text-slate-100 flex flex-col lg:flex-row gap-8 justify-center items-center bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(249,115,22,0.12),rgba(0,0,0,0))] font-sans select-none"
      } ${theme === 'light' ? 'theme-light' : ''}`}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      
      {/* Simulation Trigger Controller inside screen - Desktop view only */}
      {!loggedInDriverId && !isMobileMode && (
        <div className="w-full lg:w-80 bg-slate-900/85 backdrop-blur-md p-6 rounded-3xl border border-slate-800/70 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.65)] space-y-5 shrink-0 overflow-y-auto">
          <div>
            <span className="text-[10px] uppercase font-black tracking-widest text-[#f97316] font-mono block mb-1">Developer Mode</span>
            <h3 className="font-extrabold text-white text-base tracking-tight">Driver Node Console</h3>
            <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">Select dispatcher nodes to simulate live telemetry synchronizations and offline queues.</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider font-mono">Simulated Account</label>
            <select
              value={selectedDriverId}
              onChange={(e) => {
                setSelectedDriverId(e.target.value);
                setActiveShipment(null);
                setActiveTab('home');
              }}
              className="w-full p-2.5 bg-slate-950 border border-slate-800 text-slate-200 text-xs font-bold rounded-xl outline-none focus:border-amber-500 transition-all cursor-pointer"
            >
              {drivers.map(d => (
                <option key={d.id} value={d.id} className="bg-slate-950 text-slate-200 font-bold">
                  {d.name} ({d.truckNumber})
                </option>
              ))}
            </select>
          </div>

          {/* Simulate Offline Connection Switch */}
          <div className="p-3.5 bg-slate-950/60 rounded-2xl border border-slate-800/60 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase font-mono">Connection State</span>
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-black uppercase font-mono ${
                isForceOffline 
                  ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' 
                  : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isForceOffline ? 'bg-amber-500' : 'bg-emerald-400 animate-pulse'}`}></span>
                {isForceOffline ? 'Offline' : 'Online'}
              </span>
            </div>
            <button
              onClick={() => {
                setIsForceOffline(prev => !prev);
                triggerToast(!isForceOffline ? "Simulated offline storage mode active." : "Network connection re-established, synchronizing queues...");
              }}
              className={`w-full py-2 px-3 rounded-xl text-xs font-bold font-mono uppercase tracking-wider transition-all flex items-center justify-center gap-2 border cursor-pointer ${
                isForceOffline
                  ? 'bg-emerald-600/10 hover:bg-emerald-600/20 border-emerald-500/30 text-emerald-400'
                  : 'bg-amber-600/10 hover:bg-amber-600/20 border-amber-500/30 text-amber-500'
              }`}
            >
              <Shield className="w-3.5 h-3.5 shrink-0" />
              <span>{isForceOffline ? 'Connect Online' : 'Force Offline'}</span>
            </button>
          </div>

          <div className="bg-slate-950/85 p-4 border border-slate-800 rounded-2xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-xl group-hover:bg-amber-500/10 transition-all duration-500" />
            <span className="text-[9px] font-bold tracking-widest text-slate-500 uppercase font-mono block mb-1">Active Profile</span>
            <p className="font-extrabold text-[#f97316] text-xs uppercase tracking-tight">{getDriverName()}</p>
            <p className="text-slate-400 font-mono text-[10px] mt-0.5">{getDriverTruck()}</p>
          </div>
        </div>
      )}

      {/* Floating Gear Workspace controls - ONLY visible if isMobileMode and not logged in as a real driver */}
      {isMobileMode && !loggedInDriverId && (
        <div className="fixed bottom-24 right-4 z-[999] flex flex-col items-end gap-2">
          {showControlsModal && (
            <div className="w-72 bg-slate-900/95 backdrop-blur-md text-slate-100 p-4 rounded-3xl border border-slate-800 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] space-y-3 text-left" dir="ltr">
              <div>
                <span className="text-[8px] tracking-widest uppercase font-mono font-bold text-orange-500 block">Simulation Node Controller</span>
                <h4 className="font-extrabold text-xs text-white">Switch Dispatch Account</h4>
              </div>

              <select
                value={selectedDriverId}
                onChange={(e) => {
                  setSelectedDriverId(e.target.value);
                  setActiveShipment(null);
                  setActiveTab('home');
                  setShowControlsModal(false);
                }}
                className="w-full p-2.5 bg-slate-950 border border-slate-800 text-slate-200 text-xs font-bold rounded-xl outline-none"
              >
                {drivers.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.truckNumber})
                  </option>
                ))}
              </select>

              {/* Mobile quick offline simulation button */}
              <button
                onClick={() => {
                  setIsForceOffline(prev => !prev);
                  triggerToast(!isForceOffline ? "Simulated offline storage mode active." : "Network connection re-established, synchronizing queues...");
                  setShowControlsModal(false);
                }}
                className={`w-full py-2 bg-slate-950 border text-[10px] font-mono tracking-wider uppercase font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer ${
                  isForceOffline ? 'border-emerald-500/30 text-emerald-400' : 'border-amber-500/30 text-amber-500'
                }`}
              >
                <Shield className="w-3 h-3" />
                <span>{isForceOffline ? 'Simulate Online' : 'Simulate Offline'}</span>
              </button>

              <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800/40">
                <p className="font-bold text-orange-500 text-xs">{getDriverName()}</p>
                <p className="text-slate-400 font-mono text-[9px]">{getDriverTruck()}</p>
              </div>
            </div>
          )}
          
          <button 
            type="button"
            onClick={() => setShowControlsModal(!showControlsModal)}
            className="w-12 h-12 rounded-full bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white flex items-center justify-center shadow-[0_4px_20px_rgba(249,115,22,0.35)] transition-all border-0 cursor-pointer active:scale-90"
            title="Workspace Controls"
          >
            <Truck className="w-5 h-5 animate-pulse" />
          </button>
        </div>
      )}

      {/* MOBILE APP PHONE CONTAINER SCREEN WITH GLASS & HARDWARE BUTTON SIMULATIONS */}
      <div 
        className={isMobileMode 
          ? "w-full h-full flex flex-col justify-between overflow-hidden relative bg-slate-950" 
          : "relative mx-auto lg:mx-0 select-none group"
        }
      >
        {/* Physical hardware side active state keys */}
        {!isMobileMode && (
          <>
            {/* Left side mock volume keys */}
            <div className="absolute -left-[14px] top-28 w-[4px] h-11 bg-gradient-to-r from-slate-700 to-slate-800 rounded-l-md border-r border-slate-900 shadow-md"></div>
            <div className="absolute -left-[14px] top-42 w-[4px] h-11 bg-gradient-to-r from-slate-700 to-slate-800 rounded-l-md border-r border-slate-900 shadow-md"></div>
            {/* Right side mock power button toggle */}
            <div className="absolute -right-[14px] top-34 w-[4px] h-16 bg-gradient-to-l from-slate-700 to-slate-800 rounded-r-md border-l border-slate-900 shadow-md"></div>
          </>
        )}

        <div 
          className={isMobileMode 
            ? "w-full h-full flex flex-col justify-between overflow-hidden relative" 
            : "w-full max-w-[390px] h-[790px] bg-slate-950 rounded-[50px] p-[10px] shadow-[0_35px_80px_-15px_rgba(0,0,0,0.98),0_0_50px_rgba(249,115,22,0.08)] relative border-[12px] border-slate-800/95 flex flex-col justify-between overflow-hidden outline outline-[1px] outline-slate-700/60"
          }
        >
          
          {/* Real-looking reflective dynamic camera island with glowing optical pulse */}
          {!isMobileMode && (
            <div className="absolute top-[16px] left-1/2 -translate-x-1/2 w-[110px] h-7 bg-black rounded-full z-[100] flex items-center justify-between px-3.5 shadow-inner">
              <span className="w-2.5 h-2.5 bg-slate-900 rounded-full border border-slate-800/80 shadow-inner flex items-center justify-center">
                <span className="w-[3px] h-[3px] bg-emerald-500 rounded-full animate-pulse"></span>
              </span>
              <span className="w-12 h-1 bg-slate-900 rounded-full"></span>
            </div>
          )}

          {/* Inner Phone Screen */}
          <div 
            className={isMobileMode 
              ? "w-full h-full bg-slate-950 text-slate-100 overflow-hidden flex flex-col justify-between pt-1 pb-4 relative"
              : "w-full h-full bg-slate-950 text-slate-100 rounded-[38px] overflow-hidden flex flex-col justify-between pt-9 pb-4 relative"
            }
          >
            
            {/* Header Mobile Brand */}
            <div className="px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] bg-slate-950 border-b border-slate-900 flex items-center justify-between z-20 relative shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
                  <Truck className="w-4 h-4 text-orange-500" />
                </div>
                <h2 className="text-white font-black text-xs tracking-wider uppercase font-mono">{t('brand')}</h2>
              </div>
              
              <div className="flex items-center gap-1.5">
                <NotificationBell
                  unreadCount={unreadNotificationCount}
                  label={t('notifications')}
                  onClick={() => setActiveTab('notifications')}
                />
              </div>
            </div>

            {/* Active Toast Alert (Mobile screen inline) */}
            {toast && (
              <div className="absolute top-16 left-4 right-4 bg-orange-600 text-white p-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-lg z-50">
                <CheckCircle2 className="w-4 h-4 text-white shrink-0" />
                <span>{toast}</span>
              </div>
            )}

            {/* Core App View Controller */}
            <div className="flex-1 overflow-y-auto bg-slate-950 p-4 relative text-sm">

              {/* HOME TAB */}
              {activeTab === 'home' && (
                <DriverHome
                  driverName={getDriverName()}
                  activeJob={homeActiveJob}
                  driverId={selectedDriverId}
                  onContinueJob={() => {
                    if (homeActiveJob) {
                      setActiveShipment(homeActiveJob);
                      setSelectedStatusVal(homeActiveJob.status);
                    }
                    setActiveTab('shipments');
                  }}
                  onChatWithAdmin={() => {
                    if (homeActiveJob) {
                      setActiveShipment(homeActiveJob);
                      setSelectedStatusVal(homeActiveJob.status);
                    }
                    setActiveTab('chat');
                  }}
                  onViewJobs={() => setActiveTab('shipments')}
                  lang={lang}
                />
              )}

              {/* NOTIFICATION FEED POPUP PANEL */}
              {activeTab === 'notifications' && (
                <NotificationsPanel
                  notifications={myNotifications}
                  lang={lang}
                  title={t('notifications')}
                  onBack={() => setActiveTab('home')}
                />
              )}

              {/* SHIPMENTS LIST VIEW */}
              {activeTab === 'shipments' && !activeShipment && (
                <div className="space-y-4.5 animate-fade-in">
                  
                  {/* Driver identity banner */}
                  <div className="relative overflow-hidden bg-gradient-to-r from-orange-600/95 via-orange-500/90 to-amber-500/95 rounded-3xl p-4 shadow-[0_12px_24px_rgba(249,115,22,0.18)] border border-orange-400/20 text-white shrink-0 light-preserve">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -mr-6 -mt-6" />
                    <div className="flex items-center gap-2 relative z-10">
                      <div className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center text-[13px] font-black tracking-tighter">
                        <Truck className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-black tracking-tight leading-none uppercase">{getDriverName() ? getDriverName().split(" ")[0] : "Driver"}</h4>
                        <span className="text-[9px] text-orange-100/90 font-mono tracking-tight">{getDriverTruck() || "TRUCK"}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-b border-slate-900 pb-2.5">
                    <div>
                      <h3 className="font-extrabold text-[#f97316] text-xs tracking-wide uppercase font-mono">{t('activeShipments')}</h3>
                      <p className="text-[10px] text-slate-500 font-medium">Assigned to your heavy transit fleet</p>
                    </div>
                    <span className="bg-orange-500/10 text-orange-400 font-mono font-black text-[10px] px-2.5 py-0.5 rounded-full border border-orange-500/20">
                      {shipments.filter(s => s.status !== 'Delivered' && s.status !== 'Arrived' && s.status !== 'Closed' && s.status !== 'Completed').length} Active
                    </span>
                  </div>

                  {/* Modern Horizontal Filter Bar */}
                  <div className="flex gap-1.5 overflow-x-auto pb-1 select-none no-scrollbar">
                    {[
                      { id: 'active', en: 'Active Jobs', tr: 'Aktif Seferler', ar: 'المهام النشطة' },
                      { id: 'completed', en: 'Completed', tr: 'Tamamlananlar', ar: 'المكتملة' }
                    ].map(f => {
                      const isActive = shipmentsFilter === f.id;
                      const label = lang === 'tr' ? f.tr : lang === 'ar' ? f.ar : f.en;
                      return (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setShipmentsFilter(f.id as any)}
                          className={`px-3 py-1.5 rounded-xl border font-mono text-[9.5px] font-bold tracking-tight whitespace-nowrap transition-all cursor-pointer ${
                            isActive
                              ? 'bg-orange-600/15 border-orange-500/40 text-orange-400 font-black'
                              : 'bg-slate-950/40 border-slate-800 hover:border-slate-800 text-slate-400'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="space-y-3.5">
                    {shipments
                      .filter(s => {
                        const isFinished = s.status === 'Delivered' || s.status === 'Arrived' || s.status === 'Closed' || s.status === 'Completed';
                        if (shipmentsFilter === 'active') return !isFinished;
                        if (shipmentsFilter === 'completed') return isFinished;
                        return true;
                      })
                      .map((s) => (
                        <ShipmentCard
                          key={s.id}
                          shipment={s}
                          driverId={selectedDriverId}
                          onClick={() => {
                            setActiveShipment(s);
                            setSelectedStatusVal(s.status);
                          }}
                        />
                      ))}

                    {shipments.length === 0 && (
                      <div className="py-20 text-center space-y-3 bg-slate-900/40 rounded-2.5xl p-6 border border-slate-800/80">
                        <div className="w-12 h-12 rounded-full bg-slate-950/80 border border-slate-800 flex items-center justify-center mx-auto text-slate-500">
                          <Truck className="w-6 h-6 shrink-0" />
                        </div>
                        <div>
                          <p className="text-xs text-slate-400 font-bold">{t('noAssignedShipments')}</p>
                          <p className="text-[10px] text-slate-500 mt-1">Check back later for new assignments</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

            {/* EXPANDED SHIPMENT DETAIL & CHAT / STATUS TAB PANEL */}
            {activeTab === 'shipments' && activeShipment && (
              <div className="space-y-4 pb-20">
                {/* Back Link */}
                <div className="flex items-center select-none">
                  <button
                    onClick={() => setActiveShipment(null)}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-white transition-all bg-slate-900/40 hover:bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-full cursor-pointer"
                  >
                    {lang === 'en' ? '← Back to Jobs' : lang === 'tr' ? '← İşlere Geri Dön' : '← العودة إلى المهام'}
                  </button>
                </div>

                {/* Driver views parameters */}
                <div className="p-5 bg-slate-900 border border-slate-800/80 rounded-3xl space-y-4 shadow-[0_4px_25px_rgba(0,0,0,0.3)] relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/5 rounded-full blur-2xl group-hover:bg-orange-500/10 transition-all duration-500" />

                  {/* JOB OVERVIEW */}
                  <div>
                    <span className="text-[8px] font-black text-[#f97316] uppercase tracking-widest font-mono block mb-2">Job Overview</span>
                    <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                      <div className="flex flex-col">
                        <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest font-mono">Shipment ID</span>
                        <span className="font-mono text-sm font-black text-white mt-0.5 selectable">{activeShipment.shipmentNumber}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="bg-slate-950 text-slate-400 text-[9px] font-black uppercase tracking-wider font-mono px-2.5 py-1 rounded-full border border-slate-800">
                          {FREIGHT_TYPE_LABELS[activeShipment.freightType || 'land']}
                        </span>
                        <span className="bg-orange-500/10 text-orange-400 text-[10px] font-black uppercase tracking-wider font-mono px-3 py-1 rounded-full border border-orange-500/25">
                          {activeShipment.status}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3.5 text-xs">
                    {/* ROUTE */}
                    <div>
                      <span className="text-[8px] font-black text-[#f97316] uppercase tracking-widest font-mono block mb-1.5">Route</span>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <span className="text-slate-500 text-[9px] font-bold uppercase tracking-wider font-mono block">Loading Depot</span>
                          <p className="font-extrabold text-slate-200 mt-1">{activeShipment.loadingCity || "Unassigned"}</p>
                          <p className="text-[10px] text-slate-500 font-mono mt-0.5">{activeShipment.loadingCountry || ""}</p>
                        </div>
                        <div>
                          <span className="text-slate-500 text-[9px] font-bold uppercase tracking-wider font-mono block">Delivery Point</span>
                          <p className="font-extrabold text-slate-200 mt-1">{activeShipment.deliveryCity || "Unassigned"}</p>
                          <p className="text-[10px] text-slate-500 font-mono mt-0.5">{activeShipment.deliveryCountry || ""}</p>
                        </div>
                      </div>
                    </div>

                    {/* CARGO / FREIGHT */}
                    <div className="border-t border-slate-800/80 pt-3">
                      <span className="text-[8px] font-black text-[#f97316] uppercase tracking-widest font-mono block mb-1.5">Cargo / Freight</span>
                      <p className="font-extrabold text-slate-100 text-xs leading-normal">{activeShipment.cargoDescription}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <span className="inline-flex items-center gap-1.5 bg-slate-950 text-slate-400 font-mono text-[9px] font-bold px-2 py-1 rounded-lg border border-slate-800">
                          Total Weight: {(activeShipment.cargoWeight ?? 0).toLocaleString()} kg
                        </span>
                        {resolveDriverTruckNumber(activeShipment, selectedDriverId) && (
                          <span className="inline-flex items-center gap-1.5 bg-slate-950 text-slate-400 font-mono text-[9px] font-bold px-2 py-1 rounded-lg border border-slate-800">
                            Truck: {resolveDriverTruckNumber(activeShipment, selectedDriverId)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* PAYMENT / AGREED AMOUNT */}
                    <div className="border-t border-slate-800/80 pt-3">
                      <span className="text-[8px] font-black text-[#f97316] uppercase tracking-widest font-mono block mb-1.5">Payment / Agreed Amount</span>
                      <div className="flex items-center justify-between bg-slate-950/60 p-3 rounded-2xl border border-slate-800/60">
                        <div className="flex flex-col">
                          <span className="text-slate-500 font-bold text-[9px] uppercase tracking-widest font-mono">{t('carrierAmount')}</span>
                          <span className="text-slate-400 text-[10px] mt-0.5">Fixed carrier revenue</span>
                        </div>
                        <span className="text-orange-500 font-mono font-black text-base tracking-tight">
                          {(() => {
                            const amount = resolveDriverAgreedAmount(activeShipment, selectedDriverId);
                            if (amount === null) {
                              return <span className="text-slate-500 text-xs font-bold">Not available</span>;
                            }
                            return (
                              <>
                                {amount.toLocaleString()}{' '}
                                <span className="text-xs">{activeShipment.currency || "USD"}</span>
                              </>
                            );
                          })()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* STATUS ACTIONS CONDITIONAL ROUTING */}
                {(() => {
                  const isShipmentFinished = activeShipment.status === 'Delivered' || activeShipment.status === 'Arrived' || activeShipment.status === 'Closed' || activeShipment.status === 'Completed';
                  if (isShipmentFinished) {
                    return (
                      <div className="p-5 bg-slate-900 border border-slate-800 rounded-3xl text-center space-y-3 shadow-[0_4px_25px_rgba(0,0,0,0.3)] select-none">
                        <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-400">
                          <Lock className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-xs text-emerald-400 font-extrabold font-mono tracking-tight uppercase">
                            {lang === 'tr' ? 'Sefer Tamamlandı ve Kilitlendi' : lang === 'ar' ? 'تم اكتمال المهمة وقفلها' : 'Job Finalized & Locked'}
                          </p>
                          <p className="text-[10px] text-slate-400 leading-normal mt-1">
                            {lang === 'tr' ? 'Bu teslimat tamamlanmıştır, sürücü güncellemelerine kapalıdır.' : lang === 'ar' ? 'تم تسليم هذه الشحنة وإغلاق التحديثات لسلامة البيانات.' : 'This delivery has been successfully finalized. Operational logs are now locked.'}
                          </p>
                        </div>
                      </div>
                    );
                  }
                  if (activeShipment.status === "Assigned") {
                    return (
                      <div className="p-5 bg-slate-900 border border-slate-800 rounded-3xl text-center space-y-4 shadow-[0_4px_25px_rgba(0,0,0,0.3)]">
                        <p className="text-xs text-white font-bold leading-normal">{t('assignDriver')}</p>
                        <div className="grid grid-cols-2 gap-3">
                          <button 
                            onClick={() => handleRejectAssignment(activeShipment)}
                            className="py-2.5 bg-red-950/40 hover:bg-red-900/40 border border-red-500/20 text-red-400 text-xs font-bold rounded-xl transition-all cursor-pointer active:scale-95"
                          >
                            {t('rejectShipment')}
                          </button>
                          <button 
                            onClick={() => handleAcceptAssignment(activeShipment)}
                            className="py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white text-xs font-bold rounded-xl transition-all shadow-[0_4px_15px_rgba(249,115,22,0.3)] cursor-pointer active:scale-95"
                          >
                            {t('acceptShipment')}
                          </button>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <form ref={statusFormRef} onSubmit={handleStatusUpdate} className="p-5 bg-slate-900 border border-slate-800 rounded-3xl space-y-4 shadow-[0_4px_25px_rgba(0,0,0,0.3)]">
                      <div className="border-b border-slate-800 pb-2">
                        <h4 className="font-black text-xs text-white uppercase tracking-wider font-mono">
                          {lang === 'en' ? 'Update Shipment Status' : lang === 'tr' ? 'Sevkiyat Durumunu Güncelle' : 'تحديث حالة الشحنة'}
                        </h4>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest font-mono">Shipment Status</label>
                        <select
                          value={selectedStatusVal}
                          onChange={(e) => setSelectedStatusVal(e.target.value as ShipmentStatus)}
                          className="w-full p-3 bg-slate-950 border border-slate-800 text-xs text-slate-200 font-bold rounded-xl outline-none focus:border-amber-500 transition-all cursor-pointer"
                        >
                          {['Accepted', 'Loading', 'Loaded', 'In Transit', 'Border Crossing', 'Customs Clearance', 'Arrived', 'Delivered'].map(st => (
                            <option key={st} value={st} className="bg-slate-950 text-slate-200 font-bold">{st}</option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest font-mono">Notes to Admin</label>
                        <input
                          type="text" 
                          placeholder={t('remarksPlaceholder')}
                          value={remarks}
                          onChange={(e) => setRemarks(e.target.value)}
                          className="w-full p-2.5 bg-slate-950 border border-slate-800 text-xs text-slate-100 rounded-xl outline-none focus:border-amber-500 transition-all"
                        />
                      </div>

                      <button 
                        type="submit" 
                        className="w-full py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-extrabold text-xs rounded-xl shadow-[0_4px_15px_rgba(249,115,22,0.35)] transition-all cursor-pointer active:scale-95 text-center uppercase tracking-wider font-mono"
                      >
                        {t('updateStatusBtn')}
                      </button>
                    </form>
                  );
                })()}



                {/* Admin Documents — read-only CMR/POD/customs paperwork
                    published by MARAS/Admin (isDocumentVisibleToDriver,
                    documentAccess.ts). Driver never creates, signs, stamps,
                    approves, or uploads a CMR here — only views/downloads
                    what Admin already sent. Sending a photo/file to Admin
                    happens in Chat, not here — this panel is view-only. */}
                <div className="space-y-3 bg-slate-900 border border-slate-800 rounded-3xl p-4 shadow-[0_4px_25px_rgba(0,0,0,0.3)]">
                  <div className="border-b border-slate-800 pb-2 flex flex-col">
                    <span className="text-[8px] font-black text-[#f97316] uppercase tracking-widest font-mono block">Documents</span>
                    <h4 className="text-white font-black text-xs uppercase tracking-wider font-mono text-left">Admin Documents</h4>
                  </div>
                  {activeShipment.documents && activeShipment.documents.length > 0 ? (
                    <div className="space-y-2">
                      {activeShipment.documents.map(d => (
                        <a
                          key={d.id}
                          href={d.url}
                          target="_blank"
                          rel="noreferrer"
                          className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between text-xs hover:border-orange-500/40 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="p-1.5 rounded-lg bg-orange-500/5 border border-orange-500/20 text-orange-500 h-7 w-7 flex items-center justify-center shrink-0">
                              <Paperclip className="w-3.5 h-3.5" />
                            </div>
                            <div className="min-w-0">
                              <span className="truncate max-w-[150px] font-mono text-[10px] text-slate-200 block">{d.name}</span>
                              <span className="text-[8px] text-orange-400 uppercase font-black font-mono tracking-wider">{d.category}</span>
                            </div>
                          </div>
                          <span className="p-1 px-2 bg-slate-900 border border-slate-800 rounded-md text-slate-300 font-extrabold text-[8.5px] uppercase tracking-wider font-mono shrink-0">View</span>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[10px] text-slate-500 italic block text-left py-2">No operational files registered.</p>
                  )}
                </div>

              </div>
            )}

            {/* CHAT TAB PANEL (Shipment Conversation room) */}
            {activeTab === 'chat' && (
              <div className="h-full flex flex-col justify-between pt-1 text-slate-200">
                {activeShipment ? (
                  <div className="flex-1 flex flex-col justify-between overflow-hidden h-[540px]">
                    <div className="bg-slate-900/60 p-3.5 border-b border-slate-800 flex items-center justify-between shrink-0 select-none">
                      <div className="flex items-center gap-2">
                        {isShipmentFinished ? (
                          <span className="relative flex h-2 w-2">
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-500"></span>
                          </span>
                        ) : (
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                          </span>
                        )}
                        <div>
                          <h4 className="font-extrabold text-xs text-white uppercase tracking-wider font-mono">MARAS Admin Chat</h4>
                          <span className="text-[9px] text-[#f97316] font-mono font-bold">
                            {isShipmentFinished
                              ? (lang === 'tr' ? `Tamamlanan Görev #${activeShipment.shipmentNumber}` : lang === 'ar' ? `المهمة المكتملة #${activeShipment.shipmentNumber}` : `Finished Duty #${activeShipment.shipmentNumber}`)
                              : `Transit Duty #${activeShipment.shipmentNumber}`
                            }
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Chat Search Input */}
                    <div className="px-3.5 py-2 bg-slate-950 border-b border-slate-900 flex items-center gap-2 shrink-0 transition-all select-none">
                      <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <input
                        type="text"
                        placeholder={lang === 'tr' ? 'Mesajlarda ara...' : lang === 'ar' ? 'البحث عن رسالة...' : 'Search messages...'}
                        value={chatSearchQuery}
                        onChange={(e) => setChatSearchQuery(e.target.value)}
                        className="bg-transparent text-[10px] text-slate-300 placeholder-slate-700 focus:outline-none w-full font-mono border-0"
                      />
                      {chatSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setChatSearchQuery("")}
                          className="text-slate-400 hover:text-white text-[9px] font-bold px-2 py-0.5 bg-slate-900 border border-slate-800 rounded cursor-pointer border-0"
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    {/* Messages list scrollable */}
                    <div className="flex-1 overflow-y-auto p-2 my-1 space-y-3 max-h-[380px]">
                      {chatMessages
                        .filter(msg => {
                          if (!chatSearchQuery.trim()) return true;
                          const q = chatSearchQuery.toLowerCase().trim();
                          return (msg.text || "").toLowerCase().includes(q) || 
                                 (msg.fileName || "").toLowerCase().includes(q) || 
                                 (msg.senderName || "").toLowerCase().includes(q);
                        })
                        .map((msg) => {
                          const isMe = msg.sender === 'driver';
                          // fix/chat-safety-reliability-phase1: this row
                          // uses items-end/items-start (never stretch), so
                          // a flex child sizes to its own content width
                          // rather than the row's — an unbroken-text
                          // bubble wider than max-w-[85%] overflowed the
                          // whole panel despite break-words alone (found
                          // while smoke-testing the new 5000-char limit).
                          // max-w-full on the bubble gives it something to
                          // wrap against.
                          return (
                            <div key={msg.id} className={`flex flex-col max-w-[85%] ${isMe ? 'ml-auto items-end' : 'mr-auto items-start'}`}>
                              <span className="text-[8px] text-slate-500 font-bold mb-0.5">{msg.senderName}</span>
                              <div className={`p-3 rounded-2xl text-xs leading-relaxed shadow-sm break-words max-w-full ${
                                isMe
                                  ? 'bg-orange-600 text-white rounded-tr-none'
                                  : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-none'
                              }`}>
                                 {msg.type === 'file' ? (
                                  <div className="space-y-2">
                                    <span className="bg-slate-950 text-orange-400 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase block w-max">{msg.fileCategory}</span>
                                    <a 
                                      href={msg.fileUrl || "#"} 
                                      download={msg.fileName || "document.bin"}
                                      onClick={(e) => {
                                        if (!msg.fileUrl || msg.fileUrl === "#") {
                                          e.preventDefault();
                                          triggerToast("Document specimen offline preview active.");
                                        }
                                      }}
                                      className="font-bold underline cursor-pointer flex items-center gap-1 hover:text-orange-200 break-all"
                                    >
                                      <FileUp className="w-3.5 h-3.5 shrink-0 inline text-orange-400" />
                                      <span>{msg.fileName}</span>
                                    </a>

                                    {/* Rich image preview for live cargo photo uploads */}
                                    {((msg.fileCategory === 'photo' || msg.fileName?.match(/\.(jpeg|jpg|gif|png|webp)/i)) && msg.fileUrl && msg.fileUrl !== '#') && (
                                      <div className="mt-2 rounded-lg overflow-hidden border border-slate-800 max-w-[170px]">
                                        <img 
                                          src={msg.fileUrl} 
                                          alt={msg.fileName} 
                                          className="w-full h-auto object-cover max-h-[110px]" 
                                          referrerPolicy="no-referrer"
                                        />
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <p>{msg.text}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5 text-[8px] text-slate-500 font-mono">
                                <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                {isMe && (
                                  <span className={`inline-flex items-center gap-0.5 ${msg.status === 'seen' ? 'text-emerald-400 font-bold' : 'text-slate-500'}`}>
                                    • {msg.status === 'seen' ? '✓✓ Seen' : '✓ Sent'}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}

                      {chatMessages.length === 0 && (
                        <div className="py-20 text-center text-slate-600 italic text-xs">
                          No messaging threads active for shipment {activeShipment.shipmentNumber}. Send a greeting to the admin!
                        </div>
                      )}

                      {chatMessages.length > 0 && chatMessages.filter(msg => {
                        if (!chatSearchQuery.trim()) return true;
                        const q = chatSearchQuery.toLowerCase().trim();
                        return (msg.text || "").toLowerCase().includes(q) || 
                               (msg.fileName || "").toLowerCase().includes(q) || 
                               (msg.senderName || "").toLowerCase().includes(q);
                      }).length === 0 && (
                        <div className="py-10 text-center text-slate-600 text-xs italic">
                          No search results matching "{chatSearchQuery}".
                        </div>
                      )}

                      {/* Thread autoscroll anchor point */}
                      <div ref={messagesEndRef} />
                    </div>

                    {/* fix/chat-safety-reliability-phase1 (follow-up):
                        upload-failed vs upload-succeeded-but-send-failed
                        banner, with a retry action for the latter that
                        reuses the already-uploaded Storage URL rather than
                        uploading the file again. */}
                    {!isShipmentFinished && driverAttachmentError && (
                      <div className="px-3.5 pt-2.5 bg-slate-950 flex items-center justify-between gap-2 text-[10px] font-bold">
                        <span className="text-red-400">
                          {driverAttachmentError === 'upload'
                            ? (lang === 'tr'
                                ? "Dosya depoya yüklenemedi. Mesajınız gönderilmedi."
                                : lang === 'ar'
                                ? "تعذر رفع الملف إلى التخزين. لم يتم إرسال رسالتك."
                                : "Couldn't upload the file to storage. Your message was not sent.")
                            : (lang === 'tr'
                                ? "Dosya yüklendi, ancak mesaj gönderilemedi."
                                : lang === 'ar'
                                ? "تم رفع الملف، ولكن تعذر إرسال الرسالة."
                                : "The file was uploaded, but the message could not be sent.")}
                        </span>
                        {pendingDriverAttachment && (
                          <button
                            type="button"
                            onClick={handleRetryDriverAttachment}
                            disabled={isUploading}
                            className="shrink-0 text-orange-400 hover:text-orange-300 underline disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {lang === 'tr' ? 'Tekrar dene' : lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Message input */}
                    {isShipmentFinished ? (
                      <div className="p-4 bg-slate-950 border-t border-slate-900 text-center text-slate-500 font-mono text-[10px] select-none">
                        ⚠️ Radio connection has been closed for this completed job.
                      </div>
                    ) : (
                      <form onSubmit={handleSendMessage} className="bg-slate-950 p-3.5 border-t border-slate-900 flex items-center gap-2.5 shrink-0 select-none">
                        <input
                          ref={attachmentInputRef}
                          type="file"
                          accept="image/*,application/pdf,.doc,.docx"
                          className="hidden"
                          onChange={handleAttachmentSelected}
                        />
                        <button
                          type="button"
                          onClick={() => attachmentInputRef.current?.click()}
                          disabled={isUploading || isSendingDriverMessage}
                          title={lang === 'tr' ? 'Ekle' : lang === 'ar' ? 'إرفاق' : 'Attach'}
                          className="p-3 bg-slate-900 border border-slate-800 hover:border-slate-700 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl transition-all cursor-pointer inline-flex items-center active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isUploading ? (
                            <div className="w-4 h-4 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <Paperclip className="w-4 h-4 shrink-0" />
                          )}
                        </button>

                        <input
                          type="text"
                          placeholder={lang === 'tr' ? 'Bir mesaj yazın...' : lang === 'ar' ? 'اكتب رسالة...' : 'Type a message...'}
                          value={newMessageText}
                          onChange={(e) => setNewMessageText(e.target.value)}
                          maxLength={MAX_CHAT_TEXT_LENGTH}
                          disabled={isSendingDriverMessage}
                          className="flex-1 p-3 bg-slate-900 border border-slate-800 focus:border-orange-500/50 outline-none rounded-xl text-xs text-white placeholder-slate-600 transition-all font-mono disabled:opacity-60"
                        />
                        <button
                          type="submit"
                          disabled={!canSubmitChatMessage({ text: newMessageText, hasAttachment: false, isSending: isSendingDriverMessage })}
                          aria-label={lang === 'tr' ? 'Gönder' : lang === 'ar' ? 'إرسال' : 'Send message'}
                          className="p-3 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white rounded-xl transition-all cursor-pointer inline-flex items-center disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none select-none active:scale-95 border-0 shadow-[0_2px_10px_rgba(249,115,22,0.2)]"
                        >
                          <Send className="w-4 h-4 shrink-0" />
                        </button>
                      </form>
                    )}
                  </div>
                ) : (
                  <div className="py-24 text-center text-slate-500 space-y-4 px-6 select-none">
                    <div className="w-14 h-14 bg-slate-900 border border-slate-800 rounded-2.5xl flex items-center justify-center mx-auto text-slate-600">
                      <MessageSquare className="w-7 h-7 mx-auto shrink-0" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-bold text-slate-400">No Admin Chat Selected</p>
                      <p className="text-[10px] text-slate-500 max-w-xs mx-auto leading-relaxed">Select any active job inside your assigned shipments directory to open direct chat with MARAS Operations.</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* PROFILE TAB PANEL */}
            {activeTab === 'profile' && (() => {
              const editProfileLabels = {
                en: {
                  editBtn: "Edit Profile Info",
                  cancelBtn: "Cancel",
                  truckSpecs: "Tractor & Trailer specs",
                },
                tr: {
                  editBtn: "Profili Düzenle",
                  cancelBtn: "İptal",
                  truckSpecs: "Tır Teknik Özellikleri",
                },
                ar: {
                  editBtn: "تعديل الملف الشخصي",
                  cancelBtn: "إلغاء",
                  truckSpecs: "مواصفات الشاحنة",
                }
              }[lang] || {
                editBtn: "Edit Profile Info",
                cancelBtn: "Cancel",
                truckSpecs: "Tractor & Trailer specs",
              };

              const initials = profileName
                ? profileName
                    .split(" ")
                    .map(n => n[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()
                : "DR";

              return (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <h3 className="font-extrabold text-sm text-slate-200 tracking-tight">{profileT.profileTitle}</h3>
                    <span className="bg-orange-500/10 text-orange-400 font-mono font-bold text-[10px] px-2 py-0.5 rounded uppercase">
                      ID: {selectedDriverId}
                    </span>
                  </div>

                  {!isEditingProfile ? (
                    // READ ONLY VIEW
                    <div className="space-y-4">
                      {/* Driver Avatar */}
                      <div className="flex flex-col items-center justify-center py-4 text-center">
                        <div className="relative group">
                          <div className="w-20 h-20 rounded-full overflow-hidden flex items-center justify-center text-white font-black text-lg shadow-md border-2 border-slate-800 bg-slate-800">
                            {isUploadingAvatar ? (
                              <div className="flex items-center justify-center w-full h-full bg-slate-950/70">
                                <span className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                              </div>
                            ) : profileAvatarUrl ? (
                              <img src={profileAvatarUrl} alt={profileName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            ) : (
                              <div className="w-full h-full bg-gradient-to-tr from-orange-600 to-amber-500 flex items-center justify-center">
                                {initials}
                              </div>
                            )}
                          </div>
                          
                          {/* File input (invisible) */}
                          <input 
                            type="file" 
                            ref={avatarFileRef} 
                            accept="image/*" 
                            className="hidden" 
                            onChange={handleUploadAvatar} 
                          />

                          {/* Hover camera trigger overlay */}
                          <button
                            type="button"
                            onClick={() => avatarFileRef.current?.click()}
                            disabled={isUploadingAvatar}
                            className="absolute inset-0 bg-black/40 hover:bg-black/65 rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                            title={lang === 'tr' ? "Fotoğrafı Değiştir" : "Change Photo"}
                          >
                            <Camera className="w-5 h-5 text-white" />
                          </button>
                          
                          {/* Pulse indicator for active/online status */}
                          <span className="absolute bottom-1 right-1 w-4 h-4 bg-emerald-500 border-2 border-slate-900 rounded-full animate-pulse z-10" />
                        </div>

                        {/* Direct change trigger */}
                        <button
                          type="button"
                          onClick={() => avatarFileRef.current?.click()}
                          disabled={isUploadingAvatar}
                          className="mt-2.5 text-[10.5px] text-orange-400 hover:text-orange-500 font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                          <Camera className="w-3.5 h-3.5 shrink-0" />
                          <span>{lang === 'tr' ? "Profil Resmini Güncelle" : (lang === 'ar' ? "تحديث الصورة الشخصية" : "Update Profile Photo")}</span>
                        </button>

                        <h4 className="mt-3 font-black text-slate-100 text-sm tracking-tight">{profileName}</h4>
                        <p className="text-[10px] font-mono font-bold text-orange-400">@{profileUsername || "driver"}</p>
                      </div>

                      {/* Personal Info Box */}
                      <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
                        <span className="text-[9.5px] font-bold text-slate-400 block uppercase tracking-wider border-b border-slate-800/65 pb-1.5">{profileT.personalData}</span>
                        
                        <div className="flex items-center justify-between text-xs py-1">
                          <span className="text-slate-500 font-medium flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5 text-slate-500" />
                            {profileT.fullName}
                          </span>
                          <strong className="text-slate-200">{profileName}</strong>
                        </div>

                        <div className="flex items-center justify-between text-xs py-1 border-t border-slate-800">
                          <span className="text-slate-500 font-medium flex items-center gap-1.5">
                            <Briefcase className="w-3.5 h-3.5 text-slate-500" />
                            {profileT.username}
                          </span>
                          <strong className="text-slate-300 font-mono text-[10.5px]">@{profileUsername}</strong>
                        </div>

                        <div className="flex items-center justify-between text-xs py-1 border-t border-slate-800">
                          <span className="text-slate-500 font-medium flex items-center gap-1.5">
                            <Phone className="w-3.5 h-3.5 text-slate-500" />
                            {profileT.phone}
                          </span>
                          <strong className="text-slate-200 font-sans">{profilePhone}</strong>
                        </div>
                      </div>

                      {/* Tractor & Trailer Specifications */}
                      <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
                        <span className="text-[9.5px] font-bold text-slate-400 block uppercase tracking-wider border-b border-slate-800/65 pb-1.5">{editProfileLabels.truckSpecs}</span>
                        
                        <div className="flex items-center justify-between text-xs py-1">
                          <span className="text-slate-500 font-medium flex items-center gap-1.5">
                            <Truck className="w-3.5 h-3.5 text-slate-500" />
                            {profileT.truckNumber}
                          </span>
                          <strong className="text-slate-200 font-mono tracking-wide">{profileTruckNumber}</strong>
                        </div>

                        <div className="flex items-center justify-between text-xs py-1 border-t border-slate-800">
                          <span className="text-slate-500 font-medium flex items-center gap-1.5">
                            <Activity className="w-3.5 h-3.5 text-slate-500" />
                            {profileT.truckType}
                          </span>
                          <strong className="text-orange-400 font-bold uppercase text-[10.5px]">
                            {(() => {
                              const matched = TRUCK_TYPES.find(t => t.id === profileTruckType);
                              if (!matched) return profileTruckType;
                              return lang === 'en' ? matched.en : (lang === 'tr' ? matched.tr : matched.ar);
                            })()}
                          </strong>
                        </div>
                      </div>

                      <button 
                        type="button"
                        onClick={() => setIsEditingProfile(true)}
                        className="w-full p-2.5 bg-orange-600 hover:bg-orange-700 text-white font-extrabold text-xs rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer transition-transform active:scale-[0.98]"
                      >
                        <Edit2 className="w-3.5 h-3.5 shrink-0" />
                        <span>{editProfileLabels.editBtn}</span>
                      </button>
                    </div>
                  ) : (
                    // EDIT FORM VIEW
                    <form onSubmit={handleUpdateProfile} className="space-y-3.5">
                      <div className="space-y-3 p-4 bg-slate-900 border border-slate-800 rounded-2xl text-left">
                        <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider border-b border-slate-800 pb-1.5">{profileT.personalData}</span>
                        
                        {/* Edit Mode Avatar Section */}
                        <div className="flex items-center gap-4 py-2 border-b border-slate-800/40 pb-3">
                          <div className="relative">
                            <div className="w-14 h-14 rounded-full overflow-hidden flex items-center justify-center text-white font-black text-sm shadow border border-slate-800 bg-slate-800">
                              {isUploadingAvatar ? (
                                <div className="flex items-center justify-center w-full h-full bg-slate-900">
                                  <span className="w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                                </div>
                              ) : profileAvatarUrl ? (
                                <img src={profileAvatarUrl} alt="avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              ) : (
                                <div className="w-full h-full bg-gradient-to-tr from-orange-600 to-amber-500 flex items-center justify-center">
                                  {initials}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="space-y-1">
                            <h5 className="text-xs font-bold text-slate-200">
                              {lang === 'tr' ? "Profil Fotoğrafı" : (lang === 'ar' ? "الصورة الشخصية" : "Profile Photo")}
                            </h5>
                            <p className="text-[10px] text-slate-500">
                              {lang === 'tr' ? "PNG veya JPG biçimleri" : (lang === 'ar' ? "يدعم صيغ PNG و JPG" : "Supports PNG and JPG formats")}
                            </p>
                            <button
                              type="button"
                              onClick={() => avatarFileRef.current?.click()}
                              disabled={isUploadingAvatar}
                              className="px-2.5 py-1 bg-slate-950 border border-slate-800 hover:border-orange-500/50 text-orange-400 font-extrabold text-[10px] rounded transition-all cursor-pointer flex items-center gap-1 mt-1"
                            >
                              <Camera className="w-3 h-3 text-orange-400" />
                              <span>{lang === 'tr' ? "Yükle / Değiştir" : (lang === 'ar' ? "رفع / تغيير" : "Upload / Change")}</span>
                            </button>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[9px] text-slate-500 block text-left font-black tracking-wider uppercase font-mono">{profileT.fullName}</label>
                          <input 
                            type="text" 
                            required
                            value={profileName}
                            onChange={(e) => setProfileName(e.target.value)}
                            className="w-full p-2.5 bg-slate-950 border border-slate-800 text-xs text-slate-100 rounded-xl outline-none font-bold focus:border-orange-500 transition-all text-left"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[9px] text-slate-500 block text-left font-black tracking-wider uppercase font-mono">{profileT.username}</label>
                          <input 
                            type="text" 
                            required
                            value={profileUsername}
                            onChange={(e) => setProfileUsername(e.target.value)}
                            className="w-full p-2.5 bg-slate-950 border border-slate-800 text-xs text-slate-100 rounded-xl outline-none font-mono focus:border-orange-500 transition-all text-left hover:border-slate-700"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[9px] text-slate-500 block text-left font-black tracking-wider uppercase font-mono">{profileT.phone}</label>
                          <input 
                            type="text"
                            required 
                            value={profilePhone}
                            onChange={(e) => setProfilePhone(e.target.value)}
                            className="w-full p-2.5 bg-slate-950 border border-slate-800 text-xs text-slate-100 rounded-xl outline-none font-bold focus:border-orange-500 transition-all text-left"
                          />
                        </div>
                      </div>

                      {/* Truck Details Edit fields */}
                      <div className="space-y-4 p-4.5 bg-slate-900 border border-slate-800 rounded-2.5xl text-left">
                        <span className="text-[10px] font-black text-white block uppercase tracking-wider border-b border-slate-800 pb-2 font-mono">{editProfileLabels.truckSpecs}</span>

                        <div className="space-y-1">
                          <label className="text-[9px] text-slate-500 block text-left font-black tracking-wider uppercase font-mono">{profileT.truckNumber}</label>
                          <input 
                            type="text" 
                            required
                            value={profileTruckNumber}
                            onChange={(e) => setProfileTruckNumber(e.target.value)}
                            className="w-full p-2.5 bg-slate-950 border border-slate-800 text-xs text-slate-100 rounded-xl outline-none font-mono focus:border-orange-500 transition-all text-left"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[9px] text-slate-500 block text-left font-black tracking-wider uppercase font-mono">{profileT.truckType}</label>
                          <select 
                            value={profileTruckType}
                            onChange={(e) => setProfileTruckType(e.target.value)}
                            className="w-full p-2.5 bg-slate-950 border border-slate-800 text-xs text-slate-100 rounded-xl outline-none font-bold focus:border-orange-500 transition-all text-left cursor-pointer"
                          >
                            {TRUCK_TYPES.map(type => (
                              <option key={type.id} value={type.id} className="bg-slate-950 text-white font-bold">
                                {lang === 'en' ? type.en : (lang === 'tr' ? type.tr : type.ar)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="flex gap-3 pt-2">
                        <button 
                          type="button"
                          onClick={() => {
                            const dr = drivers.find(d => d.id === selectedDriverId);
                            if (dr) {
                              setProfileName(dr.name || "");
                              setProfileUsername(dr.username || "");
                              setProfilePhone(dr.phone || "");
                              setProfileTruckNumber(dr.truckNumber || "");
                              setProfileTruckType(dr.truckType || "reefer");
                            }
                            setIsEditingProfile(false);
                          }}
                          disabled={isSavingProfile}
                          className="flex-1 py-2.5 bg-slate-950 hover:bg-slate-900 text-slate-400 hover:text-white border border-slate-800 font-bold text-xs rounded-xl transition-all cursor-pointer text-center select-none active:scale-95"
                        >
                          {editProfileLabels.cancelBtn}
                        </button>
                        <button 
                          type="submit" 
                          disabled={isSavingProfile}
                          className="flex-1 py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 disabled:opacity-40 text-white font-extrabold text-xs rounded-xl shadow-[0_4px_15px_rgba(249,115,22,0.3)] transition-all flex items-center justify-center gap-1.5 cursor-pointer select-none active:scale-95 border-0"
                        >
                          {isSavingProfile ? (
                            <span>{profileT.saveSpinner}</span>
                          ) : (
                            <>
                              <Check className="w-3.5 h-3.5 shrink-0" />
                              <span>{profileT.saveProfile}</span>
                            </>
                          )}
                        </button>
                      </div>
                    </form>
                  )}

                  {onLogout && (
                    <button 
                      type="button" 
                      onClick={onLogout}
                      className="w-full py-2.5 bg-slate-950 hover:bg-red-950/40 border border-slate-800 hover:border-red-500/30 text-slate-400 hover:text-red-400 font-extrabold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer mt-1"
                    >
                      <X className="w-4 h-4 shrink-0 text-red-500" />
                      <span>{profileT.logout}</span>
                    </button>
                  )}

                  <div className="mt-4 pt-4 border-t border-slate-900">
                    {!showDriverDeleteConfirm ? (
                      <button 
                        type="button" 
                        onClick={() => {
                          setShowDriverDeleteConfirm(true);
                          setUnderstandDriverDelete(false);
                        }}
                        className="w-full py-2 bg-red-950/10 hover:bg-red-950/30 border border-red-900/30 hover:border-red-500/30 text-red-400 font-extrabold text-[10.5px] uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5 shrink-0" />
                        <span>{lang === 'tr' ? "Hesabımı Tamamen Sil" : (lang === 'ar' ? "حذف الحساب نهائياً" : "Delete My Account")}</span>
                      </button>
                    ) : (
                      <div className="bg-slate-950 p-3.5 rounded-2xl border border-red-900/20 space-y-3 animate-fade-in">
                        <div className="flex items-start gap-2 text-red-400">
                          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 animate-pulse" />
                          <div className="text-left">
                            <h5 className="text-[11px] font-black uppercase tracking-wider font-mono">
                              {lang === 'tr' ? "Kalıcı Hesap Silme İşlemi" : (lang === 'ar' ? "حذف الحساب بشكل نهائي" : "Irreversible Profile Purge")}
                            </h5>
                            <p className="text-[9.5px] text-slate-400 leading-tight mt-0.5">
                              {lang === 'tr' 
                                ? "Bu işlem geri alınamaz. Tüm lojistik geçmişiniz, aktif tır plakanız ve sürücü sevk yetkileriniz sistemden tamamen silinecektir."
                                : (lang === 'ar' 
                                  ? "هذا الإجراء نهائي ولا يمكن التراجع عنه. سيتم مسح تفويض الشاحنة وتاريخ السفر بالكامل من النظم."
                                  : "This cannot be undone. Your active manifests, historical trips, and fleet registry authorization will be permanently wiped.")}
                            </p>
                          </div>
                        </div>

                        <label className="flex items-start gap-2.5 cursor-pointer text-[10.5px] font-bold text-slate-400 hover:text-white">
                          <input
                            type="checkbox"
                            checked={understandDriverDelete}
                            onChange={(e) => setUnderstandDriverDelete(e.target.checked)}
                            className="w-3.5 h-3.5 rounded border-slate-800 bg-slate-900 text-red-500 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-red-500 mt-0.5"
                          />
                          <span className="leading-tight text-left">
                            {lang === 'tr' 
                              ? "Hesabımın silinmesini ve sistemden çıkarılmasını istiyorum."
                              : (lang === 'ar' 
                                ? "أوافق على حذف حسابي بشكل دائم ومسح هويتي التعريفية."
                                : "I consent to permanently purge my account identity and logs.")}
                          </span>
                        </label>

                        <div className="flex gap-2 pt-1">
                          <button
                            type="button"
                            disabled={isDeletingDriverAccount}
                            onClick={() => setShowDriverDeleteConfirm(false)}
                            className="flex-1 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white text-[10px] font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer text-center"
                          >
                            {lang === 'tr' ? "Vazgeç" : (lang === 'ar' ? "إلغاء Действие" : "Cancel")}
                          </button>
                          
                          <button
                            type="button"
                            disabled={isDeletingDriverAccount || !understandDriverDelete}
                            onClick={handleDeleteDriverAccount}
                            className="flex-1 py-1.5 bg-gradient-to-r from-red-600 to-red-600 hover:from-red-600 hover:to-red-700 disabled:opacity-40 text-white font-black text-[10px] rounded-xl uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1 shadow-md border-0"
                          >
                            {isDeletingDriverAccount ? (
                              <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
                            ) : (
                              <Trash2 className="w-3 h-3 shrink-0" />
                            )}
                            <span>{lang === 'tr' ? "Profilimi Sil" : (lang === 'ar' ? "تأكيد الحذف" : "Purge Account")}</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* EXPANDED MENU & PILOT CONSOLE PANEL */}
            {activeTab === 'menu' && (
              <div className="space-y-4 animate-fade-in text-left font-sans">
                {(() => {
                  const menuOptions = {
                    en: {
                      title: "Settings",
                      subtitle: "Manage your driver app preferences",
                      statusActive: "Active & Online",
                      truckId: "Truck ID",
                      activeLang: "Language",
                      activeLangSub: "Choose app language"
                    },
                    tr: {
                      title: "Ayarlar",
                      subtitle: "Sürücü uygulaması tercihlerinizi yönetin",
                      statusActive: "Aktif ve Çevrimiçi",
                      truckId: "Araç Plaka",
                      activeLang: "Dil",
                      activeLangSub: "Uygulama dilini seçin"
                    },
                    ar: {
                      title: "الإعدادات",
                      subtitle: "إدارة تفضيلات تطبيق السائق الخاص بك",
                      statusActive: "نشط ومتصل بالإنترنت",
                      truckId: "رقم الشاحنة",
                      activeLang: "اللغة",
                      activeLangSub: "اختر لغة التطبيق"
                    }
                  };
                  const menuT = menuOptions[lang] || menuOptions.en;

                  const dr = drivers.find(d => d.id === selectedDriverId);

                  return (
                    <>
                      {/* Header Title Block */}
                      <div className="border-b border-slate-900 pb-3 flex items-center">
                        <div>
                          <h3 className="font-extrabold text-sm text-white tracking-tight uppercase font-mono">{menuT.title}</h3>
                          <p className="text-[10px] text-slate-500 mt-0.5">{menuT.subtitle}</p>
                        </div>
                      </div>

                      {/* ACTIVE DRIVER COMPACT BADGE CARD */}
                      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex items-center gap-3.5 relative overflow-hidden shadow-md">
                        <div className="absolute top-0 right-0 w-16 h-16 bg-orange-600/5 rounded-full blur-xl" />
                        <div className="relative">
                          {profileAvatarUrl ? (
                            <img 
                              src={profileAvatarUrl} 
                              alt="Driver Profile" 
                              referrerPolicy="no-referrer"
                              className="w-12 h-12 rounded-full object-cover border-2 border-orange-500/40 shadow-sm"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center border-2 border-orange-500/40 text-white font-extrabold text-sm uppercase">
                              {(profileName || dr?.name || "DR").substring(0, 2)}
                            </div>
                          )}
                          <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-slate-900 animate-pulse" />
                        </div>
                        <div className="flex-1 space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <h4 className="text-xs font-black text-white">{profileName || dr?.name || "Verified Operator"}</h4>
                            <span className="bg-emerald-500/10 text-emerald-400 text-[8px] font-extrabold px-1.5 py-0.5 rounded border border-emerald-500/15 font-mono uppercase">
                              {menuT.statusActive}
                            </span>
                          </div>
                          <p className="text-[9.5px] text-slate-400 font-mono flex items-center gap-2">
                            <span>{menuT.truckId}: <strong className="text-white font-bold">{profileTruckNumber || dr?.truckNumber || "-"}</strong></span>
                            <span className="text-slate-700 font-sans">•</span>
                            <span className="uppercase text-[8.5px] font-semibold text-slate-500">{profileTruckType || dr?.truckType || "reefer"}</span>
                          </p>
                        </div>
                      </div>

                      {/* TOGGLE SETTINGS PANEL */}
                      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3.5 shadow-md">
                        <div className="flex items-center gap-2 pb-1 border-b border-slate-800">
                          <Settings className="w-4 h-4 text-orange-500" />
                          <h4 className="text-xs font-black text-white uppercase tracking-tight">App Preferences</h4>
                        </div>

                        <div className="space-y-3">
                          {/* Daylight/Nighttime View Theme Switcher */}
                          <div className="flex items-center justify-between py-1 bg-slate-950/40 p-2 rounded-xl border border-slate-800 text-xs">
                            <div className="space-y-0.5 text-left">
                              <span className="text-[11px] font-bold text-white block">
                                {lang === 'tr' ? "Görünürlük Kontrast Modu" : lang === 'ar' ? "وضع تباين الرؤية" : "Visibility Contrast Mode"}
                              </span>
                              <span className="text-[9px] text-slate-500 block leading-tight">
                                {lang === 'tr' 
                                  ? "Gündüz Işığı ile Gece Karanlığı arasında geçiş yapın" 
                                  : lang === 'ar' 
                                  ? "التنقل بين الوضع النهاري والوضع الداكن للرؤية" 
                                  : "Toggle between bright Day Light and relaxed Night Dark"}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                const nextTheme = theme === 'dark' ? 'light' : 'dark';
                                setTheme(nextTheme);
                                triggerToast(nextTheme === 'light' ? "☀️ Light mode enabled for bright daylight visibility." : "🌙 Dark mode enabled for relaxed night driving.");
                              }}
                              className="px-3 py-1.5 bg-slate-950 hover:bg-slate-900 border border-slate-800 text-orange-400 font-mono text-[9.5px] uppercase font-black tracking-wider rounded-lg transition-all flex items-center gap-1.5 cursor-pointer animate-fade-in"
                            >
                              {theme === 'dark' ? (
                                <>
                                  <Moon className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                                  <span>Night (Dark)</span>
                                </>
                              ) : (
                                <>
                                  <Sun className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                  <span>Day (Light)</span>
                                </>
                              )}
                            </button>
                          </div>

                          {/* Language Selector */}
                          <div className="py-1 bg-slate-950/40 p-2 rounded-xl border border-slate-800 text-xs text-left space-y-2">
                            <div className="space-y-0.5">
                              <span className="text-[11px] font-bold text-white block">{menuT.activeLang}</span>
                              <span className="text-[9px] text-slate-600 block leading-tight">{menuT.activeLangSub}</span>
                            </div>
                            <div className="grid grid-cols-3 gap-1.5">
                              {([
                                { value: 'en', flag: '🇺🇸', label: 'English' },
                                { value: 'ar', flag: '🇸🇦', label: 'العربية' },
                                { value: 'tr', flag: '🇹🇷', label: 'Türkçe' },
                              ] as { value: Language; flag: string; label: string }[]).map(opt => {
                                const isActive = lang === opt.value;
                                return (
                                  <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => onLanguageChange?.(opt.value)}
                                    aria-pressed={isActive}
                                    className={`px-2 py-2 rounded-lg border font-mono text-[10px] font-bold flex flex-col items-center gap-0.5 transition-all cursor-pointer ${
                                      isActive
                                        ? 'bg-orange-500/15 border-orange-500/40 text-orange-400'
                                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-white'
                                    }`}
                                  >
                                    <span className="text-sm">{opt.flag}</span>
                                    <span>{opt.label}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()}

              </div>
            )}

          </div>

          {/* Bottom Dock Navigation Tabs menu */}
          <DriverBottomNav
            activeTab={activeTab}
            chatDisabled={!activeShipment}
            onSelect={(tab) => {
              setActiveTab(tab);
            }}
          />

          </div>

        </div>

      </div>

    </div>
  );
}
