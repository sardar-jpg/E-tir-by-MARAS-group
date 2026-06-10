import React, { useState, useEffect } from "react";
import { 
  Shipment, 
  Driver, 
  ChatMessage, 
  ActivityLog, 
  AppNotification, 
  ShipmentStatus, 
  Currency, 
  DocumentCategory,
  Language,
  TRUCK_TYPES,
  Client,
  Vendor,
  CostStatement,
  CostItem
} from "../types";
import { TRANSLATIONS } from "../translations";
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, Legend
} from 'recharts';
import { 
  Plus, Search, Filter, ShieldCheck, Share2, MessageSquare, 
  Building2, Ship, Truck, Calendar, DollarSign, Eye, EyeOff, 
  Edit3, ArrowUpRight, ClipboardList, CheckCircle2, FileText, 
  Paperclip, Image as ImageIcon, Send, X, ExternalLink, RefreshCw, UserPlus, Phone, Mail, Check, AlertCircle, Printer,
  Map as MapIcon, Bell, BellRing, Anchor, Plane, Download
} from 'lucide-react';
import TrackingMap from "./TrackingMap";
import { apiFetch } from "../lib/api";
import { jsPDF } from "jspdf";

const fetch = apiFetch;

interface AdminPanelProps {
  lang: Language;
  onSelectShipmentChat: (shipment: Shipment) => void;
  openDetailsId: string | null;
  setOpenDetailsId: (id: string | null) => void;
  gmailUser?: any;
  gmailToken?: string | null;
  onConnectGmail?: () => void;
  onDisconnectGmail?: () => void;
  userRole?: 'admin' | 'accounts';
}

export default function AdminPanel({ 
  lang, 
  onSelectShipmentChat, 
  openDetailsId, 
  setOpenDetailsId,
  gmailUser = null,
  gmailToken = null,
  onConnectGmail,
  onDisconnectGmail,
  userRole = 'admin'
}: AdminPanelProps) {
  const t = (key: keyof typeof TRANSLATIONS['en']) => {
    return TRANSLATIONS[lang][key] || TRANSLATIONS['en'][key] || String(key);
  };

  const isRtl = lang === 'ar';

  // State Management
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadChatMessages, setUnreadChatMessages] = useState<ChatMessage[]>([]);
  const [isChatDropdownOpen, setIsChatDropdownOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'shipments' | 'drivers' | 'reports' | 'audit' | 'gmail' | 'tracking_map' | 'clients' | 'vendors' | 'costs'>(
    userRole === 'accounts' ? 'costs' : 'dashboard'
  );

  // Real-time Dashboard Clock
  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const clockTimer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(clockTimer);
  }, []);

  // Client Management States
  const [clients, setClients] = useState<Client[]>([]);
  const [clientSearchQuery, setClientSearchQuery] = useState("");
  const [isAddClientOpen, setIsAddClientOpen] = useState(false);
  const [expandedClientOrdersCompanyName, setExpandedClientOrdersCompanyName] = useState<string | null>(null);

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
  const [selectedCostStatement, setSelectedCostStatement] = useState<CostStatement | null>(null);
  const [isStatementEditorOpen, setIsStatementEditorOpen] = useState(false);
  const [costSearchQuery, setCostSearchQuery] = useState("");
  const [costStatusFilter, setCostStatusFilter] = useState<'All' | 'Unpaid' | 'Partial' | 'Paid'>('All');
  const [costTypeFilter, setCostTypeFilter] = useState<'All' | 'land' | 'sea' | 'air'>('All');
  const [isSavingCostStatement, setIsSavingCostStatement] = useState(false);

  // New Client Form States
  const [newClientCompanyName, setNewClientCompanyName] = useState("");
  const [newClientContactName, setNewClientContactName] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");
  const [newClientAddress, setNewClientAddress] = useState("");
  const [newClientNotes, setNewClientNotes] = useState("");
  const [isSubmittingClient, setIsSubmittingClient] = useState(false);

  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [activeToasts, setActiveToasts] = useState<{ id: string; notif: AppNotification }[]>([]);
  const knownNotificationIdsRef = React.useRef<Set<string>>(new Set());
  const isFirstLoadRef = React.useRef(true);
  
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
E-TIR SHIPMENT BACKUP & TRANSIT RECORD
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
      const fileName = `E-TIR-Backup-${targetShip.shipmentNumber}.txt`;
      
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
          await fetch("/api/logs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              shipmentId: targetShip.id,
              shipmentNumber: targetShip.shipmentNumber,
              actor: gmailUser?.email || "Google Operator",
              actionEn: `Backed up e-tir record for #${targetShip.shipmentNumber} to Google Drive`,
              actionTr: `#${targetShip.shipmentNumber} e-tir kaydı Google Drive'a yedeklendi`,
              actionAr: `تم نسخ سجل شحنة e-tir #${targetShip.shipmentNumber} احتياطياً إلى Google Drive`
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
        description: `Official MARAS cargo transit scheduling for client ${targetShip.companyName}.\nStatus: ${targetShip.status}.\nRecipient phone: ${targetShip.loadingContactNumber || "N/A"}.\nE-Tir document backup integration.`,
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
          await fetch("/api/logs", {
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
      
      const sub = `e-tir Tracking Update: #${shipment.shipmentNumber} — ${shipment.companyName}`;
      const msgBody = `Hello,

This is an official transit status alert from MARAS Logistics regarding your international cargo shipment:

• Shipment Reference Number: #${shipment.shipmentNumber}
• Organization: MARAS operational dispatch
• Carriage Leg Stage: ${shipment.status}
• Path: ${shipment.loadingCity} (${shipment.loadingCountry}) ➔ ${shipment.deliveryCity} (${shipment.deliveryCountry})
• Assigned Carrier: ${shipment.truckNumber || "Unassigned"}

You can track your real-time GPS location coordinates, border control checkpoints, customs verification state, and view direct transport paperwork files here:
${trackingUrl}

Best Regards,
MARAS Group e-tir Center`;
      
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
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDriverCreateOpen, setIsDriverCreateOpen] = useState(false);
  const [editingShipment, setEditingShipment] = useState<Shipment | null>(null);
  const [isPrintPreviewOpen, setIsPrintPreviewOpen] = useState(false);

  // Manual Shipment Operations Panel States (primarily for Sea and Air, but general as well)
  const [manualStatus, setManualStatus] = useState<ShipmentStatus>("New");
  const [manualRemarks, setManualRemarks] = useState("");
  const [isSubmittingStatus, setIsSubmittingStatus] = useState(false);

  // New Shipment Fields
  const [newShipmentData, setNewShipmentData] = useState({
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
    numberOfPackages: ""
  });

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

  const handleMarkNotifRead = async (id: string) => {
    try {
      await fetch(`/api/notifications/${id}/read`, { method: "POST" });
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    } catch (err) {
      console.error(err);
    }
  };

  const handleMarkAllNotifsRead = async () => {
    try {
      await fetch(`/api/notifications/clear`, { method: "POST" });
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch (err) {
      console.error(err);
    }
  };

  // Load backend statistics
  const fetchData = async () => {
    try {
      const resShipments = await fetch("/api/shipments");
      const resDrivers = await fetch("/api/drivers");
      const resClients = await fetch("/api/clients");
      const resVendors = await fetch("/api/vendors");
      const resLogs = await fetch("/api/logs");
      const resNotifs = await fetch("/api/notifications");
      const resUnreadChat = await fetch("/api/chat/unread");
      const resCostStatements = await fetch("/api/cost-statements");

      const safeJson = async (res: Response) => {
        const text = await res.text();
        if (text.trim().startsWith("<")) {
          throw new Error("Received HTML instead of JSON. The backend server might still be initializing.");
        }
        return JSON.parse(text);
      };

      if (resShipments.ok) setShipments(await safeJson(resShipments));
      if (resDrivers.ok) setDrivers(await safeJson(resDrivers));
      if (resClients.ok) setClients(await safeJson(resClients));
      if (resVendors.ok) setVendors(await safeJson(resVendors));
      if (resLogs.ok) setActivityLogs(await safeJson(resLogs));
      if (resCostStatements.ok) setCostStatements(await safeJson(resCostStatements));
      
      if (resUnreadChat.ok) {
        setUnreadChatMessages(await safeJson(resUnreadChat));
      }

      if (resNotifs.ok) {
        const nData: AppNotification[] = await safeJson(resNotifs);
        setNotifications(nData);

        if (isFirstLoadRef.current) {
          nData.forEach(notif => {
            knownNotificationIdsRef.current.add(notif.id);
          });
          isFirstLoadRef.current = false;
        } else {
          const newNotifications = nData.filter(notif => !knownNotificationIdsRef.current.has(notif.id));
          if (newNotifications.length > 0) {
            newNotifications.forEach(notif => {
              knownNotificationIdsRef.current.add(notif.id);
              showNotificationToast(notif);
            });
          }
        }
      }
    } catch (e) {
      console.warn("Error communicating with logistics server (fetching metrics): ", e);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 12000);
    return () => clearInterval(interval);
  }, []);

  // Sync manual operation panel values
  useEffect(() => {
    if (openDetailsId) {
      const found = shipments.find(s => s.id === openDetailsId);
      if (found) {
        setManualStatus(found.status);
        setManualRemarks("");
      }
    }
  }, [openDetailsId, shipments]);

  const handleManualStatusUpdate = async () => {
    const targetDetailsShipment = openDetailsId ? shipments.find(s => s.id === openDetailsId) : null;
    if (!targetDetailsShipment) return;
    setIsSubmittingStatus(true);
    try {
      const res = await fetch(`/api/shipments/${targetDetailsShipment.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: manualStatus,
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
        triggerToast("Failed to update status milestone.");
      }
    } catch (err) {
      console.error(err);
      triggerToast("Error updating status milestone.");
    } finally {
      setIsSubmittingStatus(false);
    }
  };

  // Cost statement management handlers
  const handleSelectActiveStatement = async (shipmentId: string) => {
    try {
      const res = await fetch(`/api/cost-statements/${shipmentId}`);
      if (res.ok) {
        const stmt = await res.json();
        setSelectedCostStatement(stmt);
        setIsStatementEditorOpen(true);
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
          setIsStatementEditorOpen(true);
        }
      }
    } catch (err) {
      console.error("Failed to load cost statement:", err);
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

      const res = await fetch(`/api/cost-statements/${selectedCostStatement.shipmentId}`, {
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
        triggerToast(lang === 'tr' ? "Maliyet tablosu başarıyla kaydedildi!" : (lang === 'ar' ? "تم حفظ كشف التكلفة بنجاح!" : "Cost statement saved successfully!"));
        const resLogs = await fetch("/api/logs");
        if (resLogs.ok) {
          const safeJson = async (r: Response) => JSON.parse(await r.text());
          setActivityLogs(await safeJson(resLogs));
        }
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
          const res = await fetch("/api/upload", {
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
    const items = stmt.items || [];
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
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `CostStatement_${stmt.shipmentNumber}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadPDF = (elementId?: string) => {
    if (!selectedCostStatement) {
      triggerToast(lang === 'tr' ? "Aktif maliyet tablosu seçilmedi." : "Error: No active cost statement selected.");
      return;
    }
    
    triggerToast(lang === 'tr' ? "PDF Dosyası Hazırlanıyor..." : "Generating high-fidelity PDF Document...");
    
    try {
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4"
      });
      
      // MARAS GROUP Corporate Letterhead
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(22);
      doc.setTextColor(15, 23, 42); // slate-900
      doc.text("MARAS GROUP", 15, 20);
      
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(234, 88, 12); // Orange primary
      doc.text("GLOBAL LOGISTICS & ACCOUNTING LEDGER DIVISION", 15, 24);
      
      // Right side document subtitle
      doc.setFontSize(10);
      doc.setTextColor(71, 85, 105); // slate-600
      doc.text(lang === 'tr' ? "RESMI BEYANNAME MALÝ TABLOSU" : "OFFICIAL COST DECLARATION LEDGER", 195, 20, { align: "right" });
      
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
      doc.text("STATEMENT METADATA / BEYANNAME DETAYI", 20, 39);
      
      doc.setTextColor(51, 65, 85); // slate-700
      doc.text("Ledger Ref / Referans:", 20, 45);
      doc.text("Issue Date / Tarih:", 20, 50);
      doc.text("Modality / Taşıma Tipi:", 20, 55);
      
      doc.setFont("Helvetica", "normal");
      doc.setTextColor(30, 41, 59); // slate-800
      doc.text(`MARAS-${new Date(selectedCostStatement.date || '').getFullYear() || '2026'}-${selectedCostStatement.shipmentNumber}`, 55, 45);
      doc.text(selectedCostStatement.date || "", 55, 50);
      doc.text(`${selectedCostStatement.shipmentType?.toUpperCase()} Freight`, 55, 55);
      
      // Metadata Column 2
      doc.setFont("Helvetica", "bold");
      doc.setTextColor(100, 116, 139); // slate-500
      doc.text("CLIENT & PAYMENT ACCOUNT / CARI HESAP", 110, 39);
      
      doc.setTextColor(51, 65, 85);
      doc.text("Client Company / Cari:", 110, 45);
      doc.text("Ledger Status / Statü:", 110, 50);
      doc.text("Currency / Para Birimi:", 110, 55);
      
      doc.setFont("Helvetica", "normal");
      doc.setTextColor(30, 41, 59);
      doc.text(selectedCostStatement.companyName || "", 145, 45);
      
      const status = selectedCostStatement.paymentStatus || "Unpaid";
      if (status === 'Paid') {
        doc.setTextColor(22, 163, 74); // green-600
      } else if (status === 'Partial') {
        doc.setTextColor(217, 119, 6); // yellow-600
      } else {
        doc.setTextColor(220, 38, 38); // red-600
      }
      doc.setFont("Helvetica", "bold");
      doc.text(status.toUpperCase(), 145, 50);
      
      doc.setFont("Helvetica", "normal");
      doc.setTextColor(30, 41, 59);
      doc.text(selectedCostStatement.currency || "USD", 145, 55);
      
      // Cost Breakdown Table spacing
      let currentY = 68;
      doc.setFillColor(30, 41, 59); // slate-800 background
      doc.rect(15, currentY, 180, 8, "F");
      
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255); // White header text
      
      doc.text(lang === 'tr' ? "Gider Türü / Category" : "Expense Category", 17, currentY + 5);
      doc.text(lang === 'tr' ? "Tedarikçi / Supplier" : "Supplier / Vendor", 52, currentY + 5);
      doc.text(lang === 'tr' ? "Açıklama / Explanation" : "Description Breakdown", 87, currentY + 5);
      doc.text("Qty", 143, currentY + 5);
      doc.text(lang === 'tr' ? "Birim Fiyat" : "Unit Price", 168, currentY + 5, { align: "right" });
      doc.text(`Total (${selectedCostStatement.currency})`, 193, currentY + 5, { align: "right" });
      
      currentY += 8;
      const rowHeight = 7.5;
      
      (selectedCostStatement.items || []).forEach((item, index) => {
        // Multi-page overflow support
        if (currentY > 245) {
          doc.addPage();
          doc.setFillColor(30, 41, 59);
          doc.rect(15, 15, 180, 8, "F");
          doc.setFont("Helvetica", "bold");
          doc.setFontSize(8);
          doc.setTextColor(255, 255, 255);
          doc.text(lang === 'tr' ? "Gider Türü / Category" : "Expense Category", 17, 20);
          doc.text(lang === 'tr' ? "Tedarikçi / Supplier" : "Supplier / Vendor", 52, 20);
          doc.text(lang === 'tr' ? "Açıklama / Explanation" : "Description Breakdown", 87, 20);
          doc.text("Qty", 143, 20);
          doc.text(lang === 'tr' ? "Birim Fiyat" : "Unit Price", 168, 20, { align: "right" });
          doc.text(`Total (${selectedCostStatement.currency})`, 193, 20, { align: "right" });
          
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
        doc.text(costTypeStr.length > 20 ? costTypeStr.substring(0, 18) + ".." : costTypeStr, 17, currentY + 4.5);
        
        const supplierStr = item.supplierName || "Internal";
        doc.text(supplierStr.length > 20 ? supplierStr.substring(0, 18) + ".." : supplierStr, 52, currentY + 4.5);
        
        const descStr = item.description || "";
        doc.text(descStr.length > 32 ? descStr.substring(0, 30) + ".." : descStr, 87, currentY + 4.5);
        
        doc.text(String(item.quantity || 0), 145, currentY + 4.5, { align: "center" });
        doc.text(Number(item.unitPrice || 0).toLocaleString(), 168, currentY + 4.5, { align: "right" });
        doc.text(Number(item.totalAmount || 0).toLocaleString(), 193, currentY + 4.5, { align: "right" });
        
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
      doc.setTextColor(100, 116, 139); // slate-500
      doc.text(lang === 'tr' ? "Toplam Maliyet:" : "Total Cost Breakdown:", 123, currentY + 6.5);
      doc.text(lang === 'tr' ? "Ödenen Miktar:" : "Settled / Paid Amount:", 123, currentY + 13.5);
      doc.text(lang === 'tr' ? "Kalan Bakiye:" : "Remaining Balance:", 123, currentY + 23.5);
      
      doc.setTextColor(30, 41, 59); // slate-800
      doc.text(`${Number(selectedCostStatement.totalCost || 0).toLocaleString()} ${selectedCostStatement.currency}`, 190, currentY + 6.5, { align: "right" });
      
      doc.setTextColor(22, 163, 74); // green-600
      doc.text(`- ${Number(selectedCostStatement.paidAmount || 0).toLocaleString()} ${selectedCostStatement.currency}`, 190, currentY + 13.5, { align: "right" });
      
      doc.setDrawColor(203, 213, 225); // slate-300
      doc.line(123, currentY + 17.5, 192, currentY + 17.5);
      
      const balanceVal = Number(selectedCostStatement.remainingBalance || 0);
      if (balanceVal > 0) {
        doc.setTextColor(220, 38, 38); // red-600
      } else {
        doc.setTextColor(22, 163, 74); // green-600
      }
      doc.setFontSize(9);
      doc.setFont("Helvetica", "bold");
      doc.text(`${balanceVal.toLocaleString()} ${selectedCostStatement.currency}`, 190, currentY + 24.5, { align: "right" });
      
      // Memo and Remarks block on the left
      if (selectedCostStatement.notes) {
        doc.setTextColor(71, 85, 105); // slate-600
        doc.setFontSize(8);
        doc.setFont("Helvetica", "bold");
        doc.text("LEDGER REMARKS & MEMORANDUMS:", 15, currentY + 5);
        
        doc.setFont("Helvetica", "normal");
        doc.setTextColor(100, 116, 139); // slate-500
        const splitNotes = doc.splitTextToSize(selectedCostStatement.notes, 100);
        doc.text(splitNotes, 15, currentY + 11);
      }
      
      // System Signatures at the bottom of the active page page
      const signY = 262;
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.3);
      doc.line(15, signY, 70, signY);
      doc.line(140, signY, 195, signY);
      
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184); // slate-400
      doc.text("ACCOUNTANT CONTROLLER ISSUER", 15, signY + 4);
      doc.text("MARAS SYSTEM OF VERIFIED DELEGATION", 140, signY + 4);
      
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(6);
      doc.text("Internal Verifiable Signature Lock Enabled", 15, signY + 8);
      doc.text("Key Verification Hash: MARAS-LEDGER-" + selectedCostStatement.shipmentId, 140, signY + 8);
      
      // Trigger Instant browser file save download that bypasses iframe popup blocked issues!
      doc.save(`MARAS_CostStatement_${selectedCostStatement.shipmentNumber}.pdf`);
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
    setIsSubmittingClient(true);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: newClientCompanyName.trim(),
          contactName: newClientContactName.trim(),
          phone: newClientPhone.trim(),
          email: newClientEmail.trim(),
          address: newClientAddress.trim(),
          notes: newClientNotes.trim(),
          createdAt: new Date().toISOString()
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

  // Submit New Vendor Action
  const handleAddVendorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVendorCompanyName.trim() || !newVendorContactName.trim() || !newVendorServiceType.trim()) {
      triggerToast(lang === 'tr' ? "Şirket Adı, İletişim Temsilcisi ve Hizmet Türü zorunludur!" : (lang === 'ar' ? "اسم الشركة، ممثل الاتصال، ونوع الخدمة مطلوبة!" : "Company Name, Representative, and Service Type are required!"));
      return;
    }
    setIsSubmittingVendor(true);
    try {
      const res = await fetch("/api/vendors", {
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
    try {
      const res = await fetch("/api/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newShipmentData)
      });
      if (res.ok) {
        setIsCreateOpen(false);
        setNewShipmentData({
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
          currency: "USD",
          internalNotes: "",
          
          freightType: "land",
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
          numberOfPackages: ""
        });
        triggerToast(t('createSuccess'));
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Edit Shipment Action
  const handleEditShipment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingShipment) return;
    try {
      const res = await fetch(`/api/shipments/${editingShipment.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingShipment)
      });
      if (res.ok) {
        setIsEditOpen(false);
        setEditingShipment(null);
        triggerToast(t('updateSuccess'));
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Create Driver Action
  const handleCreateDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDriverData.name.trim() || !newDriverData.truckNumber.trim() || !newDriverData.phone.trim()) {
      triggerToast("Please fill in Name, Truck Number, and Phone Number.");
      return;
    }
    try {
      const res = await fetch("/api/drivers", {
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
      const res = await fetch(`/api/shipments/${shipmentId}/documents/${docId}/visibility`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isSharedExternally: !currentVal })
      });
      if (res.ok) {
        fetchData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Update shipment direct link active switch
  const handleToggleShareLink = async (shipment: Shipment, val: boolean) => {
    try {
      const res = await fetch(`/api/shipments/${shipment.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isLinkShared: val })
      });
      if (res.ok) {
        fetchData();
        triggerToast(t('updateSuccess'));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggleDocSharing = async (shipment: Shipment, key: 'shareIncludeDocuments' | 'shareIncludePhotos', val: boolean) => {
    try {
      const res = await fetch(`/api/shipments/${shipment.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: val })
      });
      if (res.ok) {
        fetchData();
      }
    } catch (e) {
      console.error(e);
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
      `e-tir by MARAS Group\nShipment: ${shipmentNum}\nRoute: ${loading} ➔ ${delivery}\nTrack logistics progress in real-time here: ${link}`
    );
    return `https://api.whatsapp.com/send?text=${text}`;
  };

  // Statistics calculation
  const totalShipmentsCount = shipments.length;
  const activeShipmentsCount = shipments.filter(s => s.status !== "Delivered" && s.status !== "Closed").length;
  const completedShipmentsCount = shipments.filter(s => s.status === "Delivered" || s.status === "Closed").length;
  
  // Calculate revenue total by currency (converting approx to USD for single KPI overview)
  const totalRevenueUSD = shipments.reduce((acc, s) => {
    let amt = s.agreedAmount;
    if (s.currency === "IQD") amt = s.agreedAmount / 1450; // Approximations
    if (s.currency === "TRY") amt = s.agreedAmount / 32;
    return acc + amt;
  }, 0);

  // Recharts metric generation
  const statusData = [
    { name: 'New', value: shipments.filter(s => s.status === 'New').length, color: '#94a3b8' },
    { name: 'Assigned', value: shipments.filter(s => s.status === 'Assigned' || s.status === 'Accepted').length, color: '#f97316' },
    { name: 'Transit', value: shipments.filter(s => ['Loading', 'Loaded', 'In Transit', 'Border Crossing', 'Customs Clearance'].includes(s.status)).length, color: '#3b82f6' },
    { name: 'Delivered', value: shipments.filter(s => s.status === 'Arrived' || s.status === 'Delivered' || s.status === 'Closed').length, color: '#10b981' },
  ].filter(d => d.value > 0);

  // Currency summary list
  const currencySum = shipments.reduce((acc, s) => {
    acc[s.currency] = (acc[s.currency] || 0) + s.agreedAmount;
    return acc;
  }, {} as Record<Currency, number>);

  const currencyChartData = Object.entries(currencySum).map(([currency, val]) => ({
    name: currency,
    Amount: val
  }));

  // Match search query against cargo, company, cities, truck, driver, vessel, container or documents
  const filteredShipments = shipments.filter(s => {
    const q = searchQuery.toLowerCase();
    const matchSearch = 
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

    const matchStatus = statusFilter === "all" || s.status === statusFilter;
    const fType = s.freightType || "land";
    const matchType = typeFilter === "all" || fType === typeFilter;
    
    return matchSearch && matchStatus && matchType;
  });

  // Selected details modal data injection
  const targetDetailsShipment = openDetailsId ? shipments.find(s => s.id === openDetailsId) : null;

  return (
    <div className={`p-4 md:p-6 bg-slate-50 min-h-screen text-slate-800 ${isRtl ? 'font-sans' : 'font-sans'}`} dir={isRtl ? 'rtl' : 'ltr'}>
      
      {/* Toast Alert */}
      {toast && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 bg-slate-900 text-white font-medium py-3 px-6 rounded-xl shadow-2xl flex items-center gap-2 z-50 animate-bounce text-sm">
          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          <span>{toast}</span>
        </div>
      )}

      {/* Admin Quick Action Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
            <span className="p-2 bg-slate-900 text-white rounded-lg"><Ship className="w-6 h-6 shrink-0" /></span>
            {t('brand')} — {t('roleAdmin')}
          </h1>
          <p className="text-slate-500 text-sm mt-1">{t('tagline')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Driver helpline chat button & dropdown */}
          <div className="relative">
            <button
              onClick={() => {
                setIsChatDropdownOpen(!isChatDropdownOpen);
                setIsNotifOpen(false);
              }}
              className="p-2.5 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg relative transition-all cursor-pointer flex items-center justify-center border-0 focus:outline-none"
              title={lang === "tr" ? "Sürücü Sohbetleri" : lang === "ar" ? "محادثات السائقين" : "Driver Support Chats"}
            >
              <MessageSquare className={`w-5 h-5 ${unreadChatMessages.length > 0 ? "text-blue-600 animate-pulse" : "text-slate-500"}`} />
              {unreadChatMessages.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-blue-600 text-white font-bold text-[10px] w-5 h-5 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                  {unreadChatMessages.length}
                </span>
              )}
            </button>

            {isChatDropdownOpen && (
              <div className={`absolute top-full right-0 mt-2 w-80 md:w-96 bg-white border border-slate-200 rounded-xl shadow-2xl z-[100] p-4 text-slate-900 ${isRtl ? 'left-0 right-auto' : 'right-0 left-auto'}`}>
                <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-3">
                  <div className="flex items-center gap-1.5 font-bold text-sm text-slate-800">
                    <MessageSquare className="w-4 h-4 text-blue-600/90" />
                    <span>{lang === 'tr' ? 'Sürücü Mesajları' : lang === 'ar' ? 'رسائل السائقين غير المقروءة' : 'Unread Driver Chats'}</span>
                    {unreadChatMessages.length > 0 && (
                      <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full font-black">
                        {unreadChatMessages.length}
                      </span>
                    )}
                  </div>
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
                          className="p-2.5 rounded-lg border border-slate-100 bg-blue-50/25 text-xs transition-all relative"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-extrabold text-blue-600">
                                {shipment ? `#${shipment.shipmentNumber}` : 'Support Thread'}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                {new Date(msg.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <div className="text-[11px] font-bold text-slate-700">
                              {msg.senderName} ({lang === 'tr' ? 'Sürücü' : lang === 'ar' ? 'سائق' : 'Driver'})
                            </div>
                            <p className="text-slate-600 font-medium leading-normal italic truncate">
                              {msg.type === 'file' ? (lang === 'tr' ? '📁 Dosya / Belge' : lang === 'ar' ? '📁 ملف / مستند' : '📁 File Attachment') : msg.text}
                            </p>
                            <div className="flex justify-end pt-1 border-t border-slate-100/60 mt-1">
                              {shipment && (
                                <button
                                  onClick={() => {
                                    onSelectShipmentChat(shipment);
                                    setIsChatDropdownOpen(false);
                                  }}
                                  className="text-[10px] text-blue-600 hover:text-blue-700 hover:underline font-extrabold flex items-center gap-0.5 cursor-pointer bg-transparent border-0"
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
          <div className="relative">
            <button
              onClick={() => {
                setIsNotifOpen(!isNotifOpen);
                setIsChatDropdownOpen(false);
              }}
              className="p-2.5 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg relative transition-all cursor-pointer flex items-center justify-center border-0 focus:outline-none"
              title="Notifications"
            >
              {notifications.filter(n => !n.read).length > 0 ? (
                <BellRing className="w-5 h-5 text-orange-500 animate-bounce" />
              ) : (
                <Bell className="w-5 h-5 text-slate-500" />
              )}
              {notifications.filter(n => !n.read).length > 0 && (
                <span className="absolute -top-1 -right-1 bg-orange-500 text-white font-bold text-[10px] w-5 h-5 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                  {notifications.filter(n => !n.read).length}
                </span>
              )}
            </button>

            {isNotifOpen && (
              <div className={`absolute top-full right-0 mt-2 w-80 md:w-96 bg-white border border-slate-200 rounded-xl shadow-2xl z-[100] p-4 text-slate-900 ${isRtl ? 'left-0 right-auto' : 'right-0 left-auto'}`}>
                <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-3">
                  <div className="flex items-center gap-1.5 font-bold text-sm text-slate-800">
                    <Bell className="w-4 h-4 text-slate-600" />
                    <span>{lang === 'tr' ? 'Bildirimler' : lang === 'ar' ? 'الإشعارات' : 'Notifications'}</span>
                    {notifications.filter(n => !n.read).length > 0 && (
                      <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full">
                        {notifications.filter(n => !n.read).length} {lang === 'tr' ? 'yeni' : lang === 'ar' ? 'جديد' : 'new'}
                      </span>
                    )}
                  </div>
                  {notifications.filter(n => !n.read).length > 0 && (
                    <button
                      onClick={handleMarkAllNotifsRead}
                      className="text-xs text-orange-500 hover:text-orange-600 font-semibold cursor-pointer border-0 bg-transparent"
                    >
                      {lang === 'tr' ? 'Tümünü okundu işaretle' : lang === 'ar' ? 'تحديد الكل كمقروء' : 'Mark all as read'}
                    </button>
                  )}
                </div>

                <div className="max-h-64 overflow-y-auto space-y-2 pr-1.5 scrollbar-thin">
                  {notifications.length === 0 ? (
                    <div className="py-8 text-center text-slate-400 text-xs">
                      {lang === 'tr' ? 'Henüz bildirim yok.' : lang === 'ar' ? 'لا توجد إشعارات حالياً.' : 'No recent notifications.'}
                    </div>
                  ) : (
                    notifications.map((notif) => {
                      const shipment = shipments.find(s => s.id === notif.shipmentId);
                      const isUnread = !notif.read;
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
                              {notif.type === 'chat' && <MessageSquare className="w-4 h-4 text-blue-500" />}
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
                                      onSelectShipmentChat(shipment);
                                      setIsNotifOpen(false);
                                      if (isUnread) handleMarkNotifRead(notif.id);
                                    }}
                                    className="text-[10px] text-blue-600 hover:text-blue-700 hover:underline font-extrabold flex items-center gap-0.5 cursor-pointer bg-transparent border-0"
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

          {userRole === 'admin' && (
            <button 
              onClick={() => setIsCreateOpen(true)}
              className="bg-orange-500 hover:bg-orange-600 text-white px-5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 shadow-lg hover:shadow-orange-200 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>{t('createShipment')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Admin Module Tabs */}
      <div className="flex items-center gap-1 bg-slate-100 p-1.5 rounded-xl border border-slate-200 mb-6 overflow-x-auto max-w-full">
        {([
          { id: 'dashboard', label: t('dashboard'), icon: ClipboardList },
          { id: 'shipments', label: t('shipmentManagement'), icon: Ship },
          { id: 'tracking_map', label: lang === 'tr' ? 'GPS Takip Haritası' : (lang === 'ar' ? 'خريطة التتبع GPS' : 'GPS Tracking Map'), icon: MapIcon },
          { id: 'drivers', label: t('driverManagement'), icon: Truck },
          { id: 'clients', label: lang === 'tr' ? 'Müşteriler' : (lang === 'ar' ? 'العملاء' : 'Clients'), icon: Building2 },
          { id: 'vendors', label: lang === 'tr' ? 'Tedarikçiler' : (lang === 'ar' ? 'الموردين والشركاء' : 'Vendors'), icon: Building2 },
          { id: 'costs', label: lang === 'tr' ? 'Muhasebe ve Maliyetler' : (lang === 'ar' ? 'الحسابات وبيانات التكلفة' : 'Accounts & Cost Statements'), icon: DollarSign },
          { id: 'reports', label: t('reports'), icon: BarChart },
          { id: 'gmail', label: lang === 'tr' ? 'Google Workspace' : (lang === 'ar' ? 'جوجل وورك سبيس' : 'Google Workspace'), icon: Mail },
          { id: 'audit', label: t('auditLogsTitle'), icon: ShieldCheck }
        ] as const).filter(tab => userRole === 'admin' || tab.id === 'costs').map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${
                isActive 
                  ? 'bg-slate-900 text-white shadow-sm' 
                  : 'text-slate-600 hover:text-slate-950 hover:bg-slate-200/50'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* 1. Dashboard Overview Tab */}
      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          {/* Elegant Top Welcome Header with live clock & status */}
          <div className="bg-slate-900 text-white rounded-2xl p-6 shadow-xl relative overflow-hidden flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border border-slate-800">
            {/* Background decoration */}
            <div className="absolute right-0 top-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute left-1/3 bottom-0 w-64 h-64 bg-orange-500/5 rounded-full blur-3xl pointer-events-none" />
            
            <div className="space-y-2 relative z-10">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-black uppercase tracking-wider animate-pulse">
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                  {lang === 'tr' ? "Sistem Aktif" : (lang === 'ar' ? "النظام نشط" : "Gateway Active")}
                </span>
                <span className="text-slate-400 font-mono text-xs">v2.4.1 SECURE</span>
              </div>
              <h2 className="text-2xl font-black tracking-tight text-white mb-1">
                {lang === 'tr' ? "Lojistik Kontrol Merkezi" : (lang === 'ar' ? "مركز المراقبة والتحكم" : "Logistics Command Hub")}
              </h2>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-300 font-semibold">
                <span className="flex items-center gap-1.5">
                  <Building2 className="w-4 h-4 text-slate-400" />
                  <span>MARAS Cargo HQ</span>
                </span>
                <span className="text-slate-600">•</span>
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>{gmailUser?.email || "sardar@maras.iq"} ({lang === 'tr' ? 'Seçkin Yönetici' : lang === 'ar' ? 'إداري أول' : 'Senior Administrator'})</span>
                </span>
              </div>
            </div>

            {/* Premium Live Clock and date */}
            <div className="flex flex-col items-start md:items-end bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 min-w-[220px] relative z-10 self-stretch md:self-auto justify-center">
              <span className="text-[10px] text-slate-500 font-black tracking-widest uppercase mb-1">
                {lang === 'tr' ? "HERZ DAHİLİ COĞRAFİ ZAMAN" : (lang === 'ar' ? "التوقيت العالمي الموحد" : "OPERATIONAL SYSTEM TIME (UTC)")}
              </span>
              <div className="font-mono text-xl md:text-2xl font-black text-blue-400 leading-none tracking-tight">
                {currentTime.toLocaleTimeString(lang === 'ar' ? 'ar-EG' : (lang === 'tr' ? 'tr-TR' : 'en-US'), { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
              <div className="text-xs text-slate-400 font-bold mt-1 text-right">
                {currentTime.toLocaleDateString(lang === 'ar' ? 'ar-EG' : (lang === 'tr' ? 'tr-TR' : 'en-US'), { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
              </div>
            </div>
          </div>

          {/* KPI Summary Banner */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Active Shipments KPI */}
            <div className="bg-white p-5 rounded-xl border border-slate-200/80 hover:border-slate-300 shadow-xs flex items-center justify-between transition-all group hover:-translate-y-0.5">
              <div className="space-y-1">
                <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">{t('activeShipments')}</span>
                <p className="text-3xl font-black text-slate-900">{activeShipmentsCount}</p>
                <div className="flex items-center gap-1 text-[10px] font-bold text-orange-550">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-ping"></span>
                  <span>
                    {lang === 'tr' ? `${shipments.filter(s => s.status === 'In Transit').length} yolda aktif` : (lang === 'ar' ? `${shipments.filter(s => s.status === 'In Transit').length} في الطريق` : `${shipments.filter(s => s.status === 'In Transit').length} in active transit`)}
                  </span>
                </div>
              </div>
              <div className="p-3 bg-blue-50 text-blue-600 rounded-lg group-hover:bg-blue-100 transition-colors">
                <RefreshCw className="w-6 h-6 animate-spin-slow text-blue-600" />
              </div>
            </div>

            {/* Total Shipments Registry KPI */}
            <div className="bg-white p-5 rounded-xl border border-slate-200/80 hover:border-slate-300 shadow-xs flex items-center justify-between transition-all group hover:-translate-y-0.5">
              <div className="space-y-1">
                <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">{t('totalShipments')}</span>
                <p className="text-3xl font-black text-slate-800">{totalShipmentsCount}</p>
                <div className="text-[10px] font-bold text-slate-500 flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-slate-400"></span>
                  <span>
                    {lang === 'tr' ? `${shipments.filter(s => s.freightType === 'sea').length} Deniz • ${shipments.filter(s => s.freightType === 'air').length} Hava` : (lang === 'ar' ? `${shipments.filter(s => s.freightType === 'sea').length} بحري • ${shipments.filter(s => s.freightType === 'air').length} جوي` : `${shipments.filter(s => s.freightType === 'sea').length} Sea • ${shipments.filter(s => s.freightType === 'air').length} Air`)}
                  </span>
                </div>
              </div>
              <div className="p-3 bg-slate-100 text-slate-700 rounded-lg group-hover:bg-slate-200 transition-colors">
                <Ship className="w-6 h-6 text-slate-700" />
              </div>
            </div>

            {/* Successful Deliveries KPI */}
            <div className="bg-white p-5 rounded-xl border border-slate-200/80 hover:border-slate-300 shadow-xs flex items-center justify-between transition-all group hover:-translate-y-0.5">
              <div className="space-y-1">
                <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">{t('completedDelivery')}</span>
                <p className="text-3xl font-black text-emerald-600">{completedShipmentsCount}</p>
                <div className="text-[10px] font-bold text-emerald-600 flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" />
                  <span>
                    {lang === 'tr' ? "Eksiksiz tamamlandı" : (lang === 'ar' ? "تم التسليم بنجاح" : "100% successful rate")}
                  </span>
                </div>
              </div>
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg group-hover:bg-emerald-100 transition-colors">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              </div>
            </div>

            {/* Fleet & Resource Capacity KPI */}
            <div className="bg-white p-5 rounded-xl border border-slate-200/80 hover:border-slate-300 shadow-xs flex items-center justify-between transition-all group hover:-translate-y-0.5">
              <div className="space-y-1">
                <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">
                  {lang === 'tr' ? "Sürücü Doluluk Oranı" : (lang === 'ar' ? "إشغال أسطول السائقين" : "Fleet Utilization")}
                </span>
                <p className="text-3xl font-black text-indigo-655">
                  {drivers.length > 0 ? `${Math.round((drivers.filter(d => shipments.some(s => s.assignedDriverId === d.id && s.status !== "Delivered" && s.status !== "Closed")).length / drivers.length) * 100)}%` : "0%"}
                </p>
                <div className="text-[10px] font-bold text-slate-500">
                  <span>{drivers.filter(d => shipments.some(s => s.assignedDriverId === d.id && s.status !== "Delivered" && s.status !== "Closed")).length} / {drivers.length} {lang === 'tr' ? "aktif sürücü görevde" : (lang === 'ar' ? "سائل مكلف حالياً" : "capacity allocated")}</span>
                </div>
              </div>
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-lg group-hover:bg-indigo-100 transition-colors">
                <Truck className="w-6 h-6 text-indigo-600" />
              </div>
            </div>
          </div>

          {/* New Interactive Bento Layout (3-Column Layout) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Left & Center 2 Columns: Live Control Center Table */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full">
              
              {/* Header and Filter Controls */}
              <div className="p-5 border-b border-slate-100 bg-slate-50/40">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-ping"></span>
                      <span>{lang === 'tr' ? "Anlık Transit Takip İstasyon İzleme" : (lang === 'ar' ? "مراقبة مسار الشحنات الميدانية" : "Live Cargo Transit Monitoring")}</span>
                    </h3>
                    <p className="text-slate-500 text-xs mt-0.5 font-medium">
                      {lang === 'tr' ? "E-TIR entegrasyonuyla canlı durum ve evrak doğrulaması" : (lang === 'ar' ? "التحقق المباشر من وثائق الشحنات البرية والبحرية والجوية" : "Real-time dispatch control and document validation for logistics operations")}
                    </p>
                  </div>
                  
                  {/* Action short-cut to register dispatch */}
                  <button 
                    onClick={() => {
                      setNewShipmentData(prev => ({ ...prev, freightType: "land" }));
                      setIsCreateOpen(true);
                    }}
                    className="self-start sm:self-auto px-3.5 py-1.5 bg-slate-950 hover:bg-slate-800 text-white font-extrabold rounded-lg text-xs tracking-wide transition-all shadow-sm hover:shadow-md flex items-center gap-1.5 border-0 focus:outline-none cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{t('createShipment')}</span>
                  </button>
                </div>

                {/* Direct Filter Pill Bars */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-4 pt-4 border-t border-slate-100">
                  <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 max-w-max">
                    {([
                      { id: 'all', label: lang === 'tr' ? 'Tümü' : 'All' },
                      { id: 'land', label: lang === 'tr' ? 'Kara' : 'Land' },
                      { id: 'sea', label: lang === 'tr' ? 'Deniz' : 'Sea' },
                      { id: 'air', label: lang === 'tr' ? 'Hava' : 'Air' }
                    ] as const).map(type => (
                      <button
                        key={type.id}
                        type="button"
                        onClick={() => {
                          setStatusFilter("all");
                          setTypeFilter(type.id);
                        }}
                        className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all border-0 cursor-pointer ${
                          typeFilter === type.id
                            ? 'bg-white text-slate-950 shadow-xs font-black'
                            : 'text-slate-500 hover:text-slate-900 bg-transparent'
                        }`}
                      >
                        {type.label}
                      </button>
                    ))}
                  </div>

                  <div className="relative flex-1 sm:max-w-xs">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-2 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder={t('searchShipment')}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-8.5 pr-8 py-1 bg-white hover:bg-slate-50 focus:bg-white text-xs border border-slate-200 focus:border-slate-400 rounded-lg focus:outline-none transition-all"
                    />
                    {searchQuery && (
                      <button 
                        onClick={() => setSearchQuery("")}
                        className="absolute right-2 top-1.5 text-slate-400 hover:text-slate-900 bg-transparent border-0 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Enhanced Interactive table */}
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                      <th className="p-4">{lang === 'tr' ? "Yük No" : (lang === 'ar' ? "رقم الشحنة" : "Ref / Waybill")}</th>
                      <th className="p-4">{t('companyName')}</th>
                      <th className="p-4">{lang === 'tr' ? "Güzergah" : (lang === 'ar' ? "المسار" : "Transit Leg Route")}</th>
                      <th className="p-4">{t('carrierAmount')}</th>
                      <th className="p-4">{t('status')}</th>
                      <th className="p-4 text-right">{t('actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredShipments.map((shipment) => {
                      const fType = shipment.freightType || "land";
                      return (
                        <tr key={shipment.id} className="hover:bg-slate-50/65 transition-colors">
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              {/* Freight type icon */}
                              {fType === 'sea' ? (
                                <span className="p-1.5 bg-blue-50 text-blue-600 rounded-md" title="Ocean Freight"><Anchor className="w-3.5 h-3.5" /></span>
                              ) : fType === 'air' ? (
                                <span className="p-1.5 bg-indigo-50 text-indigo-600 rounded-md" title="Air Cargo"><Plane className="w-3.5 h-3.5" /></span>
                              ) : (
                                <span className="p-1.5 bg-orange-50 text-orange-600 rounded-md" title="Land Goods"><Truck className="w-3.5 h-3.5" /></span>
                              )}
                              <div>
                                <span className="font-mono font-bold text-slate-900 text-xs block">#{shipment.shipmentNumber}</span>
                                <span className="text-[9.5px] text-slate-400 capitalize font-medium">{fType} Transit</span>
                              </div>
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="font-extrabold text-slate-800 leading-snug">{shipment.companyName}</div>
                            <span className="text-[10px] text-slate-400 block truncate max-w-[170px] italic">
                              {shipment.cargoDescription || "General Cargo Shipment"}
                            </span>
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-1.5">
                              <div>
                                <span className="font-bold text-slate-800 block text-xs">{shipment.loadingCity}</span>
                                <span className="text-[9.5px] text-slate-400 block">{shipment.loadingCountry}</span>
                              </div>
                              <span className="text-slate-400 font-bold">➔</span>
                              <div>
                                <span className="font-bold text-slate-800 block text-xs">{shipment.deliveryCity}</span>
                                <span className="text-[9.5px] text-slate-400 block">{shipment.deliveryCountry}</span>
                              </div>
                            </div>
                          </td>
                          <td className="p-4 font-mono font-bold text-slate-900">
                            <span className="text-slate-900 block font-black text-xs">
                              {shipment.agreedAmount.toLocaleString()} {shipment.currency}
                            </span>
                            <span className="text-[9px] text-slate-450 font-medium block">Cleared Settlement</span>
                          </td>
                          <td className="p-4">
                            <div className="space-y-1">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-black uppercase border tracking-wider leading-none ${
                                shipment.status === 'New' ? 'bg-slate-50 text-slate-600 border-slate-200' :
                                shipment.status === 'Assigned' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                shipment.status === 'Accepted' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                shipment.status === 'Arrived' || shipment.status === 'Delivered' ? 'bg-green-50 text-green-800 border-green-200' :
                                'bg-blue-50 text-blue-700 border-blue-200'
                              }`}>
                                <span className="w-1 h-1 rounded-full bg-current mr-1 shrink-0 animate-pulse"></span>
                                {shipment.status}
                              </span>
                              
                              {/* Micro shipment progress state */}
                              <div className="w-24 h-1 bg-slate-100 rounded-full overflow-hidden">
                                <div 
                                  className={`h-full rounded-full ${
                                    shipment.status === 'Delivered' || shipment.status === 'Closed' ? 'bg-green-500' :
                                    ['Border Crossing', 'Customs Clearance'].includes(shipment.status) ? 'bg-amber-400' : 'bg-blue-500'
                                  }`}
                                  style={{ 
                                    width: 
                                      shipment.status === 'New' ? '12%' :
                                      shipment.status === 'Assigned' ? '28%' :
                                      shipment.status === 'Accepted' ? '38%' :
                                      shipment.status === 'Loading' ? '48%' :
                                      shipment.status === 'Loaded' ? '65%' :
                                      shipment.status === 'In Transit' ? '78%' :
                                      ['Border Crossing', 'Customs Clearance'].includes(shipment.status) ? '88%' : '100%'
                                  }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="p-4 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1">
                              <button 
                                onClick={() => setOpenDetailsId(shipment.id)}
                                className="p-1 px-2.5 text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-800 rounded font-bold transition-all border-0 cursor-pointer"
                              >
                                {lang === 'tr' ? "Detay" : (lang === 'ar' ? "التفاصيل" : "Details")}
                              </button>
                              
                              {/* Quick Track Link Copy */}
                              <button
                                onClick={async () => {
                                  const trackLink = getDirectLink(shipment.shareToken);
                                  await navigator.clipboard.writeText(trackLink);
                                  triggerToast(t('copied'));
                                }}
                                className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-all border-0 bg-transparent cursor-pointer"
                                title={t('copyLink')}
                              >
                                <Share2 className="w-3.5 h-3.5" />
                              </button>

                              <button 
                                onClick={() => onSelectShipmentChat(shipment)}
                                className="p-1.5 text-slate-400 hover:text-slate-850 hover:bg-slate-100 rounded transition-all border-0 bg-transparent cursor-pointer"
                                title="Chat Session"
                              >
                                <MessageSquare className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredShipments.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-12 text-center text-slate-450 italic">
                          <AlertCircle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                          <span>{t('noShipmentsMatched')}</span>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right Widget Column: Central Control panel & Activity logging */}
            <div className="space-y-6">
              
              {/* Widget A: Real-Time Operational Activity Logging */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col justify-between">
                <div className="p-4 border-b border-slate-100 bg-slate-50/30 flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-black uppercase text-slate-850 tracking-wider flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-indigo-600"></span>
                      <span>{lang === 'tr' ? "Canlı Güvenlik Logları" : (lang === 'ar' ? "سجل النشاط الإداري" : "Operational Activity Stream")}</span>
                    </h4>
                    <p className="text-[10px] text-slate-500 font-medium">Real-time immutable control ledger</p>
                  </div>
                  <button 
                    onClick={() => setActiveTab('audit')} 
                    className="text-[10px] text-blue-600 hover:underline font-black uppercase tracking-wider bg-transparent border-0 cursor-pointer"
                  >
                    {lang === 'tr' ? "Tümünü Gör" : (lang === 'ar' ? "الكل" : "Full Audit")}
                  </button>
                </div>

                <div className="p-4 divide-y divide-slate-100 max-h-[290px] overflow-y-auto scrollbar-thin space-y-3">
                  {activityLogs.length === 0 ? (
                    <div className="py-12 text-center text-slate-400 text-xs italic">
                      No operational logs registered yet.
                    </div>
                  ) : (
                    activityLogs.slice(0, 5).map((log, idx) => (
                      <div key={log.id || idx} className="pt-2 pb-1.5 text-[11px] first:pt-0">
                        <div className="flex items-center justify-between text-slate-405 text-[10px] mb-0.5">
                          <span className="font-bold text-slate-700 truncate max-w-[120px] bg-slate-100 px-1.5 py-0.5 rounded">
                            {log.actor}
                          </span>
                          <span className="font-mono">
                            {new Date(log.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-slate-605 font-semibold leading-relaxed">
                          {lang === 'tr' ? log.actionTr : (lang === 'ar' ? log.actionAr : log.actionEn)}
                        </p>
                        {log.shipmentNumber && (
                          <span className="text-[9.5px] text-indigo-600 font-extrabold mt-0.5 block">
                            Shipment Ref: #{log.shipmentNumber}
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Widget B: Fast Navigation Operations Drawer */}
              <div className="bg-slate-955 bg-slate-900 text-white rounded-xl p-5 border border-slate-800 shadow-lg flex flex-col justify-between">
                <div>
                  <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider mb-1">
                    {lang === 'tr' ? "Hızlı Lojistik Eylemleri" : (lang === 'ar' ? "إجراءات إدارية سريعة" : "Administrative Operations Quick Links")}
                  </h4>
                  <p className="text-[11px] text-slate-300 font-medium mb-4 leading-relaxed">
                    Access secondary configuration systems with one click:
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    onClick={() => setActiveTab('clients')}
                    className="p-3 text-left bg-slate-800/80 hover:bg-slate-800 rounded-lg border border-slate-700/60 transition-all text-xs group cursor-pointer"
                  >
                    <Building2 className="w-4 h-4 text-blue-400 mb-1.5 group-hover:scale-105 transition-transform" />
                    <p className="font-bold text-slate-200">{lang === 'tr' ? "Müşteri Portalı" : (lang === 'ar' ? "قاعدة العملاء" : "Clients Registry")}</p>
                    <span className="text-[9px] text-slate-400 block font-normal">{clients.length} corporate partners</span>
                  </button>

                  <button
                    onClick={() => setActiveTab('drivers')}
                    className="p-3 text-left bg-slate-800/80 hover:bg-slate-800 rounded-lg border border-slate-700/60 transition-all text-xs group cursor-pointer"
                  >
                    <Truck className="w-4 h-4 text-orange-400 mb-1.5 group-hover:scale-105 transition-transform" />
                    <p className="font-bold text-slate-200">{lang === 'tr' ? "Sürücü Birliği" : (lang === 'ar' ? "تحالف السائقين" : "Active Driver Fleet")}</p>
                    <span className="text-[9px] text-slate-400 block font-normal">{drivers.length} registered vehicles</span>
                  </button>

                  <button
                    onClick={() => setActiveTab('tracking_map')}
                    className="p-3 text-left bg-slate-800/80 hover:bg-slate-800 rounded-lg border border-slate-700/60 transition-all text-xs group cursor-pointer"
                  >
                    <MapIcon className="w-4 h-4 text-emerald-400 mb-1.5 group-hover:scale-105 transition-transform" />
                    <p className="font-bold text-slate-200">{lang === 'tr' ? "Canlı Harita" : (lang === 'ar' ? "خريطة التتبع" : "GIS Tracking Map")}</p>
                    <span className="text-[9px] text-slate-400 block font-normal">Real-time GPS nodes</span>
                  </button>

                  <button
                    onClick={() => setActiveTab('reports')}
                    className="p-3 text-left bg-slate-800/80 hover:bg-slate-800 rounded-lg border border-slate-700/60 transition-all text-xs group cursor-pointer"
                  >
                    <ClipboardList className="w-4 h-4 text-indigo-400 mb-1.5 group-hover:scale-105 transition-transform" />
                    <p className="font-bold text-slate-200">{lang === 'tr' ? "Lojistik Raporlar" : (lang === 'ar' ? "الإحصاءات المالية" : "Financial Reports")}</p>
                    <span className="text-[9px] text-slate-400 block font-normal">Revenue breakdowns</span>
                  </button>
                </div>
              </div>

            </div>

          </div>

        </div>
      )}

      {/* 2. Shipments Registry Tab */}
      {activeTab === 'shipments' && (
        <div className="space-y-4">
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
                  ? ['all', 'Booking Confirmed', 'Container Released', 'Loaded on Vessel', 'Vessel Departed', 'In Transit', 'Arrived at Port', 'Customs Clearance', 'Released', 'Out for Delivery', 'Delivered', 'Completed']
                  : typeFilter === 'air'
                    ? ['all', 'Booking Confirmed', 'Cargo Received', 'Security Check Completed', 'Departed Airport', 'In Transit', 'Arrived Airport', 'Customs Clearance', 'Released', 'Out for Delivery', 'Delivered', 'Completed']
                    : ['all', 'New', 'Assigned', 'Accepted', 'Loading', 'Loaded', 'In Transit', 'Border Crossing', 'Customs Clearance', 'Arrived', 'Delivered', 'Closed']
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
                    {st === "all" ? t('allStatuses') : st}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Table Container */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
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
                  {filteredShipments.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/50">
                      <td className="p-4 font-mono font-bold text-slate-900">{s.shipmentNumber}</td>
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
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                          s.status === 'New' ? 'bg-slate-100 text-slate-700/80' :
                          s.status === 'Assigned' || s.status === 'Accepted' ? 'bg-orange-100 text-orange-850' :
                          s.status === 'Delivered' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'
                        }`}>
                          {s.status}
                        </span>
                      </td>
                      <td className="p-4 text-center space-x-1.5 whitespace-nowrap">
                        <button 
                          onClick={() => setOpenDetailsId(s.id)}
                          className="text-blue-600 hover:underline font-bold"
                        >
                          View
                        </button>
                        <button 
                          onClick={() => {
                            setEditingShipment(s);
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
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 3. Driver Alliance Tab */}
      {activeTab === 'drivers' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {drivers.map((driver) => (
              <div key={driver.id} className="bg-white p-5 rounded-xl border border-slate-200/90 shadow-sm flex flex-col justify-between hover:border-slate-350 transition-all">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    {driver.avatarUrl ? (
                      <div className="w-10 h-10 rounded-lg overflow-hidden border border-slate-200 shadow-sm bg-slate-50">
                        <img src={driver.avatarUrl} alt={driver.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      </div>
                    ) : (
                      <span className="p-2.5 bg-slate-100 text-slate-800 rounded-lg"><Truck className="w-5 h-5" /></span>
                    )}
                    <span className="text-[10px] bg-slate-900 text-white font-mono px-2 py-0.5 rounded uppercase font-bold">{driver.truckNumber}</span>
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">{driver.name}</h3>
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                      <span className="text-xs text-slate-500 font-mono">@{driver.username}</span>
                      {driver.truckType && (
                        <span className="text-[9px] bg-orange-100 text-orange-850 border border-orange-200/50 font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
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
                </div>

                <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-2 text-center text-xs">
                  <div className="border-r border-slate-100">
                    <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">{t('activeShipments')}</span>
                    <span className="text-lg font-extrabold text-blue-600 block mt-0.5">{driver.activeShipmentsCount}</span>
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
            <div className="bg-white p-6 rounded-xl border border-slate-350 shadow-md max-w-xl">
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

      {/* 4. Reports Tab */}
      {activeTab === 'reports' && (
        <div className="space-y-6">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-6">
            <div>
              <h2 className="text-xl font-bold text-slate-900">{t('operationsReport')}</h2>
              <p className="text-slate-500 text-sm">Dynamic metrics of currency allocations and shipment statuses</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-5">
              {/* Status breakdown Pie */}
              <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 flex flex-col justify-between">
                <h3 className="font-bold text-slate-800 text-sm mb-4">{t('statusDistribution')}</h3>
                <div className="h-64">
                  {statusData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={statusData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          label
                        >
                          {statusData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-slate-400 italic">No registered shipments info available.</div>
                  )}
                </div>
              </div>

              {/* Currency chart */}
              <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 flex flex-col justify-between">
                <h3 className="font-bold text-slate-800 text-sm mb-4">{t('currencyDistribution')}</h3>
                <div className="h-64">
                  {currencyChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={currencyChartData}>
                        <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                        <Tooltip formatter={(value) => [`${Number(value).toLocaleString()}`, 'Total Sum']} />
                        <Bar dataKey="Amount" fill="#f97316" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-slate-400 italic">No currency statistics found.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Clients Tab */}
      {activeTab === 'clients' && (
        <div className="space-y-6 animate-fade-in font-sans">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <div>
              <h2 className="text-xl font-bold text-slate-900 leading-tight">
                {lang === 'tr' ? "Müşteri Veritabanı" : (lang === 'ar' ? "قاعدة بيانات العملاء" : "Clients Database")}
              </h2>
              <p className="text-slate-500 text-xs mt-0.5 font-medium">
                {lang === 'tr' ? "Sistemdeki tüm kayıtlı göndericileri yönetin, siparişlerini ve takip bağlantılarını inceleyin." : (lang === 'ar' ? "إدارة شاحني البضائع المسجلين، والتحقق من طلباتهم، ومشاركة روابط التتبع." : "Manage corporate freight shippers, check order histories, and share real-time tracking links.")}
              </p>
            </div>
            <button
              onClick={() => setIsAddClientOpen(true)}
              className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-lg shadow-sm hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer border-0"
            >
              <UserPlus className="w-4 h-4" />
              <span>{lang === 'tr' ? "Yeni Müşteri Ekle" : (lang === 'ar' ? "إضافة عميل جديد" : "Add New Client")}</span>
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Search and Filters Bar */}
            <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder={lang === 'tr' ? "Müşteri veya yetkili ara..." : (lang === 'ar' ? "البحث عن عميل أو جهة اتصال..." : "Search client company, contact...")}
                  value={clientSearchQuery}
                  onChange={(e) => setClientSearchQuery(e.target.value)}
                  className="pl-9 pr-4 py-2 w-full text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500"
                />
              </div>
              <div className="text-xs text-slate-500 font-semibold">
                {clients.filter(c => 
                  c.companyName.toLowerCase().includes(clientSearchQuery.toLowerCase()) ||
                  c.contactName.toLowerCase().includes(clientSearchQuery.toLowerCase()) ||
                  c.email.toLowerCase().includes(clientSearchQuery.toLowerCase())
                ).length} {lang === 'tr' ? "müşteri bulundu" : (lang === 'ar' ? "العملاء الذين تم العثور عليهم" : "clients found")}
              </div>
            </div>

            {/* Clients Grid/Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs md:text-sm">
                <thead className="bg-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-5 py-3.5">{lang === 'tr' ? "Şirket / Kuruluş" : (lang === 'ar' ? "الشركة / المؤسسة" : "Company / Organization")}</th>
                    <th className="px-5 py-3.5">{lang === 'tr' ? "Yetkili Temsilci" : (lang === 'ar' ? "جهة الاتصال" : "Representative")}</th>
                    <th className="px-5 py-3.5">{lang === 'tr' ? "İletişim Bilgileri" : (lang === 'ar' ? "معلومات الاتصال" : "Contact Details")}</th>
                    <th className="px-5 py-3.5">{lang === 'tr' ? "Sipariş Sayısı" : (lang === 'ar' ? "عدد الطلبات" : "Orders Count")}</th>
                    <th className="px-5 py-3.5 text-right">{lang === 'tr' ? "İşlemler" : (lang === 'ar' ? "الإجراءات" : "Actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {clients.filter(c => 
                    c.companyName.toLowerCase().includes(clientSearchQuery.toLowerCase()) ||
                    c.contactName.toLowerCase().includes(clientSearchQuery.toLowerCase()) ||
                    c.email.toLowerCase().includes(clientSearchQuery.toLowerCase())
                  ).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-slate-400 text-xs">
                        {lang === 'tr' ? "Herhangi bir kayıtlı müşteri bulunamadı." : (lang === 'ar' ? "لم يتم العثور على أي عملاء مسجلين." : "No registered clients found matching filter.")}
                      </td>
                    </tr>
                  ) : (
                    clients
                      .filter(c => 
                        c.companyName.toLowerCase().includes(clientSearchQuery.toLowerCase()) ||
                        c.contactName.toLowerCase().includes(clientSearchQuery.toLowerCase()) ||
                        c.email.toLowerCase().includes(clientSearchQuery.toLowerCase())
                      )
                      .map((client) => {
                        const clientShipments = shipments.filter(s => s.companyName.toLowerCase().trim() === client.companyName.toLowerCase().trim());
                        const isExpanded = expandedClientOrdersCompanyName === client.companyName;
                        
                        return (
                          <React.Fragment key={client.id}>
                            <tr className={`hover:bg-slate-50/50 transition-colors ${isExpanded ? 'bg-orange-50/10' : ''}`}>
                              <td className="px-5 py-4">
                                <div className="font-extrabold text-slate-800 leading-snug">{client.companyName}</div>
                                <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                                  {lang === 'tr' ? "Kayıt:" : (lang === 'ar' ? "التسجيل:" : "Registered:")} {new Date(client.createdAt).toLocaleDateString()}
                                </div>
                                {client.notes && (
                                  <div className="text-[10px] text-slate-500 italic mt-1 max-w-xs truncate" title={client.notes}>
                                    {client.notes}
                                  </div>
                                )}
                              </td>
                              <td className="px-5 py-4 font-bold text-slate-700">
                                {client.contactName}
                              </td>
                              <td className="px-5 py-4 space-y-0.5">
                                <div className="flex items-center gap-1.5 text-xs text-slate-600">
                                  <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                  <span className="font-medium">{client.email || '—'}</span>
                                </div>
                                <div className="flex items-center gap-1.5 text-xs text-slate-600">
                                  <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                  <span className="font-mono">{client.phone || '—'}</span>
                                </div>
                              </td>
                              <td className="px-5 py-4">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-black ${
                                  clientShipments.length > 0 
                                    ? "bg-orange-50 text-orange-600 border border-orange-100" 
                                    : "bg-slate-50 text-slate-400 border border-slate-100"
                                }`}>
                                  {clientShipments.length} {lang === 'tr' ? "Sipariş" : (lang === 'ar' ? "طلبات" : "Orders")}
                                </span>
                              </td>
                              <td className="px-5 py-4 text-right">
                                <button
                                  onClick={() => {
                                    setExpandedClientOrdersCompanyName(isExpanded ? null : client.companyName);
                                  }}
                                  className="px-2.5 py-1.5 bg-orange-100 hover:bg-orange-200 text-orange-700 hover:text-orange-850 rounded-lg text-xs font-black cursor-pointer inline-flex items-center gap-1 border-0"
                                >
                                  <ClipboardList className="w-3.5 h-3.5" />
                                  <span>
                                    {isExpanded 
                                      ? (lang === 'tr' ? "Gizle" : (lang === 'ar' ? "إخفاء" : "Hide Details"))
                                      : (lang === 'tr' ? "İncele" : (lang === 'ar' ? "عرض الطلبات" : "Check Orders"))
                                    }
                                  </span>
                                </button>
                              </td>
                            </tr>

                            {/* Expanded Client Orders Section */}
                            {isExpanded && (
                              <tr>
                                <td colSpan={5} className="px-5 py-4 bg-slate-50/50">
                                  <div className="border border-slate-200 rounded-xl bg-white p-4 shadow-xs space-y-3">
                                    <h4 className="font-extrabold text-sm text-slate-800 flex items-center gap-1.5">
                                      <Ship className="w-4 h-4 text-orange-500" />
                                      <span>{client.companyName} — {lang === 'tr' ? "Sipariş Geçmişi" : (lang === 'ar' ? "سجل الطلبات" : "Shipment Order History")}</span>
                                    </h4>

                                    {clientShipments.length === 0 ? (
                                      <div className="py-6 text-center text-xs text-slate-400 italic">
                                        {lang === 'tr' ? "Bu müşteriye ait aktif sipariş bulunmamaktadır." : (lang === 'ar' ? "لا يوجد أي طلبات بضائع لهذا العميل حالياً." : "No orders are currently linked with this client company name.")}
                                      </div>
                                    ) : (
                                      <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto pr-1">
                                        {clientShipments.map((shipment) => {
                                          return (
                                            <div key={shipment.id} className="py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                                              <div className="space-y-1">
                                                <div className="flex items-center gap-2">
                                                  <span className="font-black text-slate-800 text-sm">#{shipment.shipmentNumber}</span>
                                                  <span className={`px-1.5 py-0.5 rounded-sm font-bold text-[10px] uppercase border ${
                                                    shipment.status === "Delivered" || shipment.status === "Closed"
                                                      ? "bg-green-50 text-green-700 border-green-200"
                                                      : shipment.status === "Pending"
                                                      ? "bg-blue-50 text-blue-700 border-blue-200"
                                                      : "bg-orange-50 text-orange-700 border-orange-200"
                                                  }`}>
                                                    {shipment.status}
                                                  </span>
                                                </div>
                                                <div className="text-slate-600 font-extrabold">
                                                  {shipment.loadingCity} ({shipment.loadingCountry}) ➔ {shipment.deliveryCity} ({shipment.deliveryCountry})
                                                </div>
                                                <div className="text-[10px] text-slate-400">
                                                  {lang === 'tr' ? "Yük:" : (lang === 'ar' ? "الحمولة:" : "Cargo:")} {shipment.cargoDescription} ({shipment.cargoWeight} kg)
                                                </div>
                                              </div>

                                              {/* Actions: Copy or Share tracking links */}
                                              <div className="flex items-center flex-wrap gap-2 pt-2 md:pt-0">
                                                {/* Direct Link */}
                                                <button
                                                  onClick={() => {
                                                    const link = getDirectLink(shipment.shareToken);
                                                    navigator.clipboard.writeText(link);
                                                    triggerToast(lang === 'tr' ? "Takip linki kopyalandı!" : (lang === 'ar' ? "تم نسخ رابط التتبع بالنجاح!" : "Tracking link copied to clipboard!"));
                                                  }}
                                                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 rounded-md font-bold text-[11px] inline-flex items-center gap-1 cursor-pointer border-0"
                                                  title={lang === "tr" ? "Link Kopyala" : (lang === "ar" ? "نسخ الرابط" : "Copy Shared Link")}
                                                >
                                                  <Share2 className="w-3.5 h-3.5" />
                                                  <span>{lang === 'tr' ? "Linki Kopyala" : (lang === 'ar' ? "نسخ" : "Copy Link")}</span>
                                                </button>

                                                {/* WhatsApp Share */}
                                                <a
                                                  href={getWhatsAppLink(shipment.shipmentNumber, shipment.shareToken, shipment.loadingCity, shipment.deliveryCity)}
                                                  target="_blank"
                                                  rel="noreferrer"
                                                  className="px-2.5 py-1.5 bg-green-50 hover:bg-green-100 text-green-700 hover:text-green-800 rounded-md font-bold text-[11px] inline-flex items-center gap-1 cursor-pointer border-0 no-underline"
                                                >
                                                  <MessageSquare className="w-3.5 h-3.5" />
                                                  <span>WhatsApp</span>
                                                </a>

                                                {/* Gmail Prepopulate */}
                                                <button
                                                  onClick={() => {
                                                    handlePrepopulateGmail(shipment.id);
                                                    setActiveTab('gmail');
                                                    triggerToast(lang === 'tr' ? "Gmail Konsolu yüklendi!" : (lang === 'ar' ? "تم التجهيز في لوحة Gmail!" : "Loaded inside Gmail Console!"));
                                                  }}
                                                  className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 hover:text-blue-800 rounded-md font-bold text-[11px] inline-flex items-center gap-1 cursor-pointer border-0"
                                                  title={lang === 'tr' ? 'Müşteriye Gmail Gönder' : (lang === 'ar' ? 'إرسال بريد Gmail' : 'Compose Operator Gmail')}
                                                >
                                                  <Mail className="w-3.5 h-3.5" />
                                                  <span>{lang === 'tr' ? 'E-Posta Hazırla' : (lang === 'ar' ? 'تجهيز' : 'Compose')}</span>
                                                </button>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Add Client Modal */}
          {isAddClientOpen && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[200] p-4 animate-fade-in">
              <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                    <UserPlus className="text-orange-500 w-5 h-5" />
                    <span>{lang === 'tr' ? "Yeni Müşteri Oluştur" : (lang === 'ar' ? "تسجيل عميل جديد" : "Create New Customer / Client")}</span>
                  </h3>
                  <button 
                    onClick={() => setIsAddClientOpen(false)}
                    className="p-1 px-2 text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 border-0 cursor-pointer text-xs font-bold rounded-md"
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={handleAddClientSubmit} className="space-y-4 text-xs font-sans">
                  <div className="space-y-1.5">
                    <label className="block font-bold text-slate-700">{lang === 'tr' ? "Şirket Adı" : (lang === 'ar' ? "اسم الشركة" : "Company / Corporate Name")} *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Al-Mansour Industries"
                      value={newClientCompanyName}
                      onChange={(e) => setNewClientCompanyName(e.target.value)}
                      className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-medium"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block font-bold text-slate-700">{lang === 'tr' ? "Yetkili Kişi" : (lang === 'ar' ? "اسم جهة الاتصال" : "Contact Representative Name")} *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Ahmad Al-Mansour"
                      value={newClientContactName}
                      onChange={(e) => setNewClientContactName(e.target.value)}
                      className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-medium"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="block font-bold text-slate-700">{lang === 'tr' ? "E-Posta Adresi" : (lang === 'ar' ? "البريد الإلكتروني" : "Email Address")}</label>
                      <input
                        type="email"
                        placeholder="e.g. contact@domain.com"
                        value={newClientEmail}
                        onChange={(e) => setNewClientEmail(e.target.value)}
                        className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-medium font-mono"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block font-bold text-slate-700">{lang === 'tr' ? "Telefon Numarası" : (lang === 'ar' ? "رقم الهاتف" : "Phone Number")}</label>
                      <input
                        type="text"
                        placeholder="e.g. +964 770 111 2233"
                        value={newClientPhone}
                        onChange={(e) => setNewClientPhone(e.target.value)}
                        className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-medium font-mono"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block font-bold text-slate-700">{lang === 'tr' ? "Ofis Adresi" : (lang === 'ar' ? "العنوان" : "Physical Office Address")}</label>
                    <input
                      type="text"
                      placeholder="e.g. Karrada District, Baghdad"
                      value={newClientAddress}
                      onChange={(e) => setNewClientAddress(e.target.value)}
                      className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-medium"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block font-bold text-slate-700">{lang === 'tr' ? "Dahili Notlar" : (lang === 'ar' ? "ملاحظات إضافية" : "Internal Notes")}</label>
                    <textarea
                      placeholder="Special logistics preferences, VIP rating..."
                      value={newClientNotes}
                      onChange={(e) => setNewClientNotes(e.target.value)}
                      rows={2}
                      className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-medium opacity-90"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setIsAddClientOpen(false)}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg cursor-pointer border-0"
                    >
                      {t('cancel')}
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmittingClient}
                      className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg shadow-sm disabled:opacity-50 cursor-pointer border-0 inline-flex items-center gap-1"
                    >
                      {isSubmittingClient ? (lang === 'tr' ? "Kaydediliyor..." : (lang === 'ar' ? "جاري الحفظ..." : "Saving Client...")) : (lang === 'tr' ? "Müşteriyi Kaydet" : (lang === 'ar' ? "حفظ ملف العميل" : "Save Client"))}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Vendors Tab */}
      {activeTab === 'vendors' && (
        <div className="space-y-6 animate-fade-in font-sans">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <div>
              <h2 className="text-xl font-bold text-slate-900 leading-tight">
                {lang === 'tr' ? "Tedarikçi ve Çözüm Ortakları" : (lang === 'ar' ? "قاعدة بيانات الموردين" : "Vendor & Partner Directory")}
              </h2>
              <p className="text-slate-500 text-xs mt-0.5 font-medium">
                {lang === 'tr' ? "Gümrük acenteleri, limanlar, armatörler ve nakliye tedarikçilerinizi yönetin, maliyet ilişkilendirmelerini inceleyin." : (lang === 'ar' ? "إدارة مخلصي الجمارك، والموانئ، وخطوط الشحن، والموردين الخارجيين مع رصد لبيانات التكلفة." : "Manage customs clearance dispatchers, harbor terminals, shipping lines, and operational trade vendors.")}
              </p>
            </div>
            <button
              onClick={() => setIsAddVendorOpen(true)}
              className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-lg shadow-sm hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer border-0 w-full sm:w-auto"
            >
              <UserPlus className="w-4 h-4" />
              <span>{lang === 'tr' ? "Yeni Tedarikçi Ekle" : (lang === 'ar' ? "إضافة مورد جديد" : "Add New Vendor")}</span>
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Search and Filters Bar */}
            <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder={lang === 'tr' ? "Tedarikçi veya yetkili ara..." : (lang === 'ar' ? "البحث عن مورد أو شريك..." : "Search corporate vendors, custom brokers...")}
                  value={vendorSearchQuery}
                  onChange={(e) => setVendorSearchQuery(e.target.value)}
                  className="pl-9 pr-4 py-2 w-full text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-semibold"
                />
              </div>
              <div className="text-xs text-slate-500 font-semibold">
                {vendors.filter(v => 
                  v.companyName.toLowerCase().includes(vendorSearchQuery.toLowerCase()) ||
                  v.contactName.toLowerCase().includes(vendorSearchQuery.toLowerCase()) ||
                  v.serviceType.toLowerCase().includes(vendorSearchQuery.toLowerCase())
                ).length} {lang === 'tr' ? "tedarikçi bulundu" : (lang === 'ar' ? "الموردين الذين تم العثور عليهم" : "vendors found")}
              </div>
            </div>

            {/* Vendors Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs md:text-sm">
                <thead className="bg-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-5 py-3.5">{lang === 'tr' ? "Tedarikçi Adı" : (lang === 'ar' ? "اسم المورد" : "Partner Name")}</th>
                    <th className="px-5 py-3.5">{lang === 'tr' ? "Hizmet Türü" : (lang === 'ar' ? "نوع الخدمة" : "Service Category")}</th>
                    <th className="px-5 py-3.5">{lang === 'tr' ? "Yetkili Kişi" : (lang === 'ar' ? "جهة الاتصال" : "Representative")}</th>
                    <th className="px-5 py-3.5">{lang === 'tr' ? "İletişim" : (lang === 'ar' ? "الاتصال" : "Contact Details")}</th>
                    <th className="px-5 py-3.5">{lang === 'tr' ? "Kayıtlı Gider" : (lang === 'ar' ? "المصاريف المرتبطة" : "Linked Expenses")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {vendors.filter(v => 
                    v.companyName.toLowerCase().includes(vendorSearchQuery.toLowerCase()) ||
                    v.contactName.toLowerCase().includes(vendorSearchQuery.toLowerCase()) ||
                    v.serviceType.toLowerCase().includes(vendorSearchQuery.toLowerCase())
                  ).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-slate-400 text-xs">
                        {lang === 'tr' ? "Kriterlere uygun kayıtlı tedarikçi bulunamadı." : (lang === 'ar' ? "لم يتم العثور على أي موردين مطابقين." : "No registered partners found matching filter.")}
                      </td>
                    </tr>
                  ) : (
                    vendors
                      .filter(v => 
                        v.companyName.toLowerCase().includes(vendorSearchQuery.toLowerCase()) ||
                        v.contactName.toLowerCase().includes(vendorSearchQuery.toLowerCase()) ||
                        v.serviceType.toLowerCase().includes(vendorSearchQuery.toLowerCase())
                      )
                      .map((vendor) => {
                        // Calculate Linked Expenses
                        const linkedItemsCount = costStatements
                          .flatMap(cs => cs.items || [])
                          .filter(item => (item.supplierName || '').toLowerCase().trim() === vendor.companyName.toLowerCase().trim()).length;
                        
                        // Get beautiful service type colors
                        const getServiceTypeColor = (type: string) => {
                          const t = type.toLowerCase();
                          if (t.includes('customs')) return 'bg-purple-50 text-purple-700 border-purple-100';
                          if (t.includes('port')) return 'bg-cyan-50 text-cyan-700 border-cyan-100';
                          if (t.includes('sea') || t.includes('ship')) return 'bg-blue-50 text-blue-700 border-blue-100';
                          if (t.includes('transit') || t.includes('fuel')) return 'bg-amber-50 text-amber-700 border-amber-100';
                          if (t.includes('truck') || t.includes('road') || t.includes('land')) return 'bg-emerald-50 text-emerald-700 border-emerald-100';
                          return 'bg-slate-50 text-slate-600 border-slate-100';
                        };

                        return (
                          <tr key={vendor.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-5 py-4">
                              <div className="font-extrabold text-slate-800 leading-snug">{vendor.companyName}</div>
                              <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                                Registered: {new Date(vendor.createdAt).toLocaleDateString()}
                              </div>
                              {vendor.address && (
                                <div className="text-[10px] text-slate-500 mt-1 max-w-xs truncate" title={vendor.address}>
                                  📍 {vendor.address}
                                </div>
                              )}
                              {vendor.notes && (
                                <div className="text-[10px] text-slate-400 italic mt-0.5 max-w-xs truncate" title={vendor.notes}>
                                  Note: {vendor.notes}
                                </div>
                              )}
                            </td>
                            <td className="px-5 py-4">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black border uppercase tracking-wider ${getServiceTypeColor(vendor.serviceType)}`}>
                                {vendor.serviceType}
                              </span>
                            </td>
                            <td className="px-5 py-4 font-bold text-slate-700">
                              {vendor.contactName}
                            </td>
                            <td className="px-5 py-4 space-y-0.5">
                              {vendor.email && (
                                <div className="flex items-center gap-1.5 text-xs text-slate-600">
                                  <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                  <span className="font-medium font-mono">{vendor.email}</span>
                                </div>
                              )}
                              {vendor.phone && (
                                <div className="flex items-center gap-1.5 text-xs text-slate-600">
                                  <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                  <span className="font-mono">{vendor.phone}</span>
                                </div>
                              )}
                            </td>
                            <td className="px-5 py-4">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-black ${
                                linkedItemsCount > 0 
                                  ? "bg-orange-50 text-orange-600 border border-orange-100" 
                                  : "bg-slate-50 text-slate-400 border border-slate-100"
                              }`}>
                                {linkedItemsCount} {lang === 'tr' ? "Maliyet Satırı" : (lang === 'ar' ? "بنود التكلفة" : "Cost Items")}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Add New Vendor slideover/Modal Overlay */}
          {isAddVendorOpen && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in text-slate-900">
              <div className="bg-white rounded-2xl border border-slate-100 shadow-2xl w-full max-w-lg overflow-hidden animate-scale-up">
                <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
                  <div>
                    <h3 className="font-black text-sm tracking-tight uppercase text-orange-500">
                      {lang === 'tr' ? "Yeni Tedarikçi Tanımla" : (lang === 'ar' ? "إضافة شريك توريد" : "Register Freight Supplier")}
                    </h3>
                    <h2 className="text-xl font-black">
                      {lang === 'tr' ? "Sistem Tedarikçi Kartı" : (lang === 'ar' ? "بطاقة المورد الجديدة" : "Add New Logistics Supplier")}
                    </h2>
                  </div>
                  <button 
                    onClick={() => setIsAddVendorOpen(false)}
                    className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer border-0"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleAddVendorSubmit} className="p-6 space-y-4 text-xs font-sans">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5 md:col-span-2 text-slate-900">
                      <label className="block font-bold text-slate-700">{lang === 'tr' ? "Şirket / Kuruluş Adı" : (lang === 'ar' ? "اسم الشركة" : "Company / Firm Name")} *</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Erbil Transit Customs Brokerage"
                        value={newVendorCompanyName}
                        onChange={(e) => setNewVendorCompanyName(e.target.value)}
                        className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-bold bg-white text-slate-900"
                      />
                    </div>

                    <div className="space-y-1.5 text-slate-900">
                      <label className="block font-bold text-slate-700">{lang === 'tr' ? "Yetkili Temsilci" : (lang === 'ar' ? "الشخص المسؤول" : "Contact Representative")} *</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Saman Ahmed"
                        value={newVendorContactName}
                        onChange={(e) => setNewVendorContactName(e.target.value)}
                        className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-medium bg-white text-slate-900"
                      />
                    </div>

                    <div className="space-y-1.5 text-slate-900 overflow-hidden">
                      <label className="block font-bold text-slate-700">{lang === 'tr' ? "Hizmet Kategorisi" : (lang === 'ar' ? "تصنيف الخدمة" : "Service Category")} *</label>
                      <select
                        value={newVendorServiceType}
                        onChange={(e) => setNewVendorServiceType(e.target.value)}
                        className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 bg-white font-bold text-slate-900"
                      >
                        <option value="Customs Clearance">{lang === 'tr' ? "Gümrük Müşavirliği" : "Customs Clearance"}</option>
                        <option value="Port Services">{lang === 'tr' ? "Liman Hizmetleri" : "Port Services"}</option>
                        <option value="Shipping Line">{lang === 'tr' ? "Denizyolu Acentesi" : "Shipping Line"}</option>
                        <option value="Transit & Fuel">{lang === 'tr' ? "Transit Geçiş & Yakıt" : "Transit & Fuel"}</option>
                        <option value="Inland Trucking">{lang === 'tr' ? "Çekici & Dorse Nakliye" : "Inland Trucking"}</option>
                        <option value="Other Service">{lang === 'tr' ? "Diğer Hizmet Sağlayıcı" : "Other Service"}</option>
                      </select>
                    </div>

                    <div className="space-y-1.5 text-slate-900">
                      <label className="block font-bold text-slate-700">{lang === 'tr' ? "E-posta Adresi" : (lang === 'ar' ? "البريد الإلكتروني" : "Email Address")}</label>
                      <input
                        type="email"
                        placeholder="e.g. ops@erbilcustoms.iq"
                        value={newVendorEmail}
                        onChange={(e) => setNewVendorEmail(e.target.value)}
                        className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-medium font-mono bg-white text-slate-900"
                      />
                    </div>

                    <div className="space-y-1.5 text-slate-900">
                      <label className="block font-bold text-slate-700">{lang === 'tr' ? "Telefon Numarası" : (lang === 'ar' ? "رقم الهاتف" : "Phone Number")} *</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. +964 750 111 2233"
                        value={newVendorPhone}
                        onChange={(e) => setNewVendorPhone(e.target.value)}
                        className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-medium font-mono bg-white text-slate-900"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5 text-slate-900">
                    <label className="block font-bold text-slate-700">{lang === 'tr' ? "Hizmet / Ofis Adresi" : (lang === 'ar' ? "العنوان بالتفصيل" : "Operational Office Address")}</label>
                    <input
                      type="text"
                      placeholder="e.g. Ibrahim Khalil Border Gate Office #4, Zakho"
                      value={newVendorAddress}
                      onChange={(e) => setNewVendorAddress(e.target.value)}
                      className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-medium bg-white text-slate-900"
                    />
                  </div>

                  <div className="space-y-1.5 text-slate-900">
                    <label className="block font-bold text-slate-700">{lang === 'tr' ? "Ek Notlar / Anlaşma Detayları" : (lang === 'ar' ? "ملاحظات وشروط" : "Internal Notes & Credit Terms")}</label>
                    <textarea
                      placeholder="e.g. 30 days payment credit term. Net cash only for borders."
                      value={newVendorNotes}
                      onChange={(e) => setNewVendorNotes(e.target.value)}
                      rows={2}
                      className="w-full p-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-medium opacity-90 bg-white text-slate-900"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 text-slate-900">
                    <button
                      type="button"
                      onClick={() => setIsAddVendorOpen(false)}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg cursor-pointer border-0"
                    >
                      {t('cancel')}
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmittingVendor}
                      className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg shadow-sm disabled:opacity-50 cursor-pointer border-0 inline-flex items-center gap-1"
                    >
                      {isSubmittingVendor ? (lang === 'tr' ? "Kaydediliyor..." : "Saving Vendor...") : (lang === 'tr' ? "Çözüm Ortağını Kaydet" : "Save Vendor")}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 5. Audit Log Tracker */}
      {activeTab === 'audit' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-950 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-orange-500" />
                {t('auditLogsTitle')}
              </h2>
              <p className="text-slate-500 text-xs">Immutable security operations logs of ship authorizations and file modifications</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs md:text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-semibold">
                  <th className="p-4">{t('actor')}</th>
                  <th className="p-4">Shipment #</th>
                  <th className="p-4">{t('action')}</th>
                  <th className="p-4 text-right">{t('time')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-xs">
                {activityLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/50">
                    <td className="p-4 font-bold text-slate-800">{log.actor}</td>
                    <td className="p-4 text-blue-600 font-bold">#{log.shipmentNumber}</td>
                    <td className="p-4 text-slate-700">
                      {lang === 'en' ? log.actionEn : (lang === 'tr' ? log.actionTr : log.actionAr)}
                    </td>
                    <td className="p-4 text-right text-slate-400">{new Date(log.timestamp).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 6. Gmail Workspace Active Tab Card */}
      {activeTab === 'gmail' && (
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
                  className="bg-white hover:bg-slate-100 text-slate-900 px-5 py-2.5 rounded-xl text-xs font-extrabold flex items-center gap-2.5 shadow-lg border border-slate-200 shrink-0 transition-all cursor-pointer"
                >
                  <svg className="w-4 h-4" viewBox="0 0 48 48">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                  </svg>
                  <span>Authorize with Google</span>
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
                      ? 'border-orange-500 text-orange-550' 
                      : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  ✉️ Gmail Communications
                </button>
                <button 
                  onClick={() => setWorkspaceSubTab('drive')}
                  className={`px-5 py-2.5 font-black text-xs tracking-wider uppercase border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                    workspaceSubTab === 'drive' 
                      ? 'border-orange-500 text-orange-550' 
                      : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  💾 Drive Record Backups
                </button>
                <button 
                  onClick={() => setWorkspaceSubTab('calendar')}
                  className={`px-5 py-2.5 font-black text-xs tracking-wider uppercase border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                    workspaceSubTab === 'calendar' 
                      ? 'border-orange-500 text-orange-550' 
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
                  To operate secure operational dispatches via Gmail, backup e-TIR logs on Google Drive and manage transport scheduling directly on Google Calendar, click the authorization button above.
                </p>
              </div>
            </div>
          ) : workspaceSubTab === 'gmail' ? (
            /* Connected Mode - Bento layout */
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              
              {/* Left Column: Shipment pre-fills */}
              <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-xs">
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
                            : 'bg-slate-50/50 border-slate-150 hover:bg-slate-50 text-slate-700'
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
                            s.status === 'Delivered' ? 'bg-emerald-100 text-emerald-800' : 'bg-orange-100 text-orange-850'
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
              <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-5 md:p-6 space-y-4 shadow-xs">
                <div>
                  <h3 className="text-xs font-black text-slate-950 uppercase tracking-wider">Operational Dispatch Composer</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">Draft messages which are securely signed and sent from your authenticated account.</p>
                </div>

                {gmailResponse && (
                  <div className={`p-4 rounded-xl border text-xs font-bold text-center flex items-center justify-center gap-2 ${
                    gmailResponse.success 
                      ? 'bg-emerald-50 border-emerald-250 text-emerald-800' 
                      : 'bg-red-50 border-red-250 text-red-800'
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
                        await fetch("/api/logs", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            actor: gmailUser?.email || "Gmail Operator",
                            shipmentNumber: targetShipObj?.shipmentNumber || "GMAIL-BROADCAST",
                            actionEn: `Dispatched operational email alert via Gmail Workspace connection to ${gmailTo}`,
                            actionTr: `Gmail Workspace bağlantısı üzerinden ${gmailTo} adresine operasyonel e-posta gönderildi`,
                            actionAr: `تم إرسال تنبيه بالبريد الإلكتروني عبر حساب Gmail إلى ${gmailTo}`
                          })
                        });
                        // Refresh audit logs in background
                        const logsRes = await fetch("/api/logs");
                        if (logsRes.ok) {
                          setActivityLogs(await logsRes.json());
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
                      placeholder="e-tir Transit Alert"
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
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              
              {/* Left Column: Shipment selected for cloud backups */}
              <div className="lg:col-span-12 xl:col-span-5 bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-sm">
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
                            : 'bg-slate-50/50 border-slate-150 hover:bg-slate-50 text-slate-700'
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
                            s.status === 'Delivered' ? 'bg-emerald-100 text-emerald-800' : 'bg-orange-100 text-orange-850'
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
                      ? 'bg-emerald-50 border-emerald-250 text-emerald-800' 
                      : 'bg-red-50 border-red-250 text-red-800'
                  }`}>
                    {driveResponse.success ? <Check className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                    <span>{driveResponse.message}</span>
                  </div>
                )}
              </div>

              {/* Right Column: Active drive files list */}
              <div className="lg:col-span-12 xl:col-span-7 bg-white rounded-2xl border border-slate-200 p-5 md:p-6 space-y-4 shadow-sm">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-xs font-black text-slate-950 uppercase tracking-wider">Drive Backups Archive</h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">Most recent operational e-TIR logs stored securely on Google Drive.</p>
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
                  <div className="text-center py-12 border-2 border-dashed border-slate-150 rounded-2xl p-6 text-slate-400 text-xs">
                    No files found on Drive backup path. Choose a shipment on the left to export.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[460px] overflow-y-auto pr-1">
                    {driveFiles.map(file => (
                      <div key={file.id} className="p-3.5 rounded-xl border border-slate-150 bg-slate-50/50 hover:bg-slate-50 transition-all flex flex-col justify-between gap-3">
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
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              
              {/* Left Column: Shipment scheduler */}
              <div className="lg:col-span-12 xl:col-span-5 bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-sm">
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
                            : 'bg-slate-50/50 border-slate-150 hover:bg-slate-50 text-slate-700'
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
                            s.status === 'Delivered' ? 'bg-emerald-100 text-emerald-800' : 'bg-orange-100 text-orange-850'
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
                      ? 'bg-emerald-50 border-emerald-250 text-emerald-800' 
                      : 'bg-red-50 border-red-250 text-red-800'
                  }`}>
                    {calendarResponse.success ? <Check className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                    <span>{calendarResponse.message}</span>
                  </div>
                )}
              </div>

              {/* Right Column: Upcoming Calendar events list */}
              <div className="lg:col-span-12 xl:col-span-7 bg-white rounded-2xl border border-slate-200 p-5 md:p-6 space-y-4 shadow-sm font-sans">
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
                  <div className="text-center py-12 border-2 border-dashed border-slate-150 rounded-2xl p-6 text-slate-400 text-xs text-slate-400">
                    No upcoming calendar slots scheduled.
                  </div>
                ) : (
                  <div className="space-y-3.5 max-h-[460px] overflow-y-auto pr-1">
                    {calendarEvents.map(event => (
                      <div key={event.id} className="p-4 rounded-xl border border-slate-150 bg-slate-50/50 hover:bg-slate-50 transition-all flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
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
      {activeTab === 'tracking_map' && (
        <TrackingMap shipments={shipments} lang={lang} drivers={drivers} />
      )}

      {/* 8. Accounts & Cost Statements Tab */}
      {activeTab === 'costs' && (() => {
        // Compute dynamic metrics
        const totalCostsByCurrency = costStatements.reduce((acc, s) => {
          const cur = s.currency || "USD";
          if (!acc[cur]) acc[cur] = { total: 0, paid: 0, balance: 0 };
          acc[cur].total += Number(s.totalCost || 0);
          acc[cur].paid += Number(s.paidAmount || 0);
          acc[cur].balance += Number(s.remainingBalance || 0);
          return acc;
        }, {} as Record<string, { total: number, paid: number, balance: number }>);

        const statusCounts = costStatements.reduce((acc, s) => {
          const status = s.paymentStatus || "Unpaid";
          acc[status] = (acc[status] || 0) + 1;
          return acc;
        }, { Paid: 0, Partial: 0, Unpaid: 0 } as Record<string, number>);

        // Recharts Analytics
        const freightCosts = costStatements.reduce((acc, s) => {
          const type = s.shipmentType || "land";
          acc[type] = (acc[type] || 0) + Number(s.totalCost || 0);
          return acc;
        }, {} as Record<string, number>);
        const freightChartData = Object.entries(freightCosts).map(([name, value]) => ({ 
          name: name === 'land' ? (lang === 'tr' ? 'Karayolu' : 'Land Freight') : name === 'sea' ? (lang === 'tr' ? 'Denizyolu' : 'Sea Freight') : (lang === 'tr' ? 'Havayolu' : 'Air Freight'), 
          value 
        }));

        const customerCosts = costStatements.reduce((acc, s) => {
          const name = s.companyName || "Unknown";
          acc[name] = (acc[name] || 0) + Number(s.totalCost || 0);
          return acc;
        }, {} as Record<string, number>);
        const customerChartData = Object.entries(customerCosts)
          .map(([name, value]) => ({ name, value }))
          .sort((a,b) => Number(b.value) - Number(a.value))
          .slice(0, 5);

        const supplierCosts = {} as Record<string, number>;
        costStatements.forEach(s => {
          (s.items || []).forEach(item => {
            const name = item.supplierName || (lang === 'tr' ? 'Diğer Vendor' : 'Other Vendor');
            supplierCosts[name] = (supplierCosts[name] || 0) + Number(item.totalAmount || 0);
          });
        });
        const supplierChartData = Object.entries(supplierCosts)
          .map(([name, value]) => ({ name, value }))
          .sort((a,b) => Number(b.value) - Number(a.value))
          .slice(0, 5);

        // Core dynamic filter query
        const filteredShipmentsCosts = shipments.filter(sh => {
          const query = costSearchQuery.toLowerCase().trim();
          const stmt = costStatements.find(cs => cs.shipmentId === sh.id);
          
          if (query) {
            const hasSupplierMatch = stmt?.items?.some(item => 
              item.supplierName?.toLowerCase().includes(query) ||
              item.costType?.toLowerCase().includes(query) ||
              item.description?.toLowerCase().includes(query)
            );
            const numMatch = sh.shipmentNumber?.toLowerCase().includes(query);
            const clientMatch = sh.companyName?.toLowerCase().includes(query);
            const truckMatch = sh.truckNumber?.toLowerCase().includes(query);
            
            if (!numMatch && !clientMatch && !truckMatch && !hasSupplierMatch) {
              return false;
            }
          }

          if (costStatusFilter !== 'All') {
            const status = stmt?.paymentStatus || "Unpaid";
            if (status !== costStatusFilter) return false;
          }

          if (costTypeFilter !== 'All') {
            const type = sh.freightType || "land";
            if (type !== costTypeFilter) return false;
          }

          return true;
        });

        const activeCurrencies = Object.keys(totalCostsByCurrency);

        return (
          <div className="space-y-6">
            
            {/* Header Title Bar */}
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
              <div>
                <h2 className="text-xl font-bold font-sans text-slate-900 flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-orange-500 bg-orange-100 p-1 rounded-full shrink-0" />
                  <span>{lang === 'tr' ? 'Hesaplar ve Maliyet Beyannameleri' : (lang === 'ar' ? 'الحسابات وبيانات التكلفة' : 'Accounts & Cost Statements')}</span>
                </h2>
                <p className="text-slate-500 text-xs mt-1 leading-relaxed">
                  {lang === 'tr' 
                    ? 'Muhasebe paneli: maliyet girdilerini ekleyin, her sevkiyat için döküm hazırlayın, faturaları saklayın ve beyanname PDF’i üretin.' 
                    : (lang === 'ar' ? 'القسم المحاسبي الداخلي لإضافة النفقات وتفصيل كشوف التكلفة وإرفاق المستندات.' : 'Internal accounting panel to declare shipment expenses, breakdown costs, store receipts, and print statements.')}
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-100 p-2 rounded-xl border border-slate-200 self-start lg:self-center font-mono">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="font-bold">{lang === 'tr' ? 'Sadece Yetkili Personel' : (lang === 'ar' ? 'حساب محاسب معتمد' : 'Authorized Role: Accounts & Admin')}</span>
              </div>
            </div>

            {/* Financial Overview Stats Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {activeCurrencies.length > 0 ? (
                activeCurrencies.map((cur) => {
                  const values = totalCostsByCurrency[cur];
                  return (
                    <div key={cur} className="bg-slate-950 text-white rounded-xl p-4 border border-slate-800 shadow-md space-y-3 relative overflow-hidden">
                      <div className="absolute top-2 right-2 bg-orange-600/10 border border-orange-500/20 text-orange-400 text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-widest">{cur}</div>
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{lang === 'tr' ? 'Bütçe Özeti' : 'Budget Summary'} ({cur})</span>
                      <div className="grid grid-cols-3 gap-2 divide-x divide-slate-800 pt-1">
                        <div>
                          <p className="text-[9px] text-slate-400 uppercase font-semibold">{lang === 'tr' ? 'Toplam' : 'Total'}</p>
                          <p className="text-sm font-black text-white">{Number(values.total).toLocaleString()} <span className="text-[10px] text-slate-400">{cur}</span></p>
                        </div>
                        <div className="pl-2">
                          <p className="text-[9px] text-slate-400 uppercase font-semibold">{lang === 'tr' ? 'Ödenen' : 'Paid'}</p>
                          <p className="text-sm font-bold text-emerald-400">{Number(values.paid).toLocaleString()} <span className="text-[9px] text-slate-400">{cur}</span></p>
                        </div>
                        <div className="pl-2">
                          <p className="text-[9px] text-slate-400 uppercase font-semibold">{lang === 'tr' ? 'Kalan' : 'Due'}</p>
                          <p className="text-sm font-bold text-orange-400">{Number(values.balance).toLocaleString()} <span className="text-[9px] text-slate-400">{cur}</span></p>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="bg-slate-950 text-white rounded-xl p-4 border border-slate-800 shadow-md flex items-center justify-center p-6 italic text-xs text-slate-400">
                  {lang === 'tr' ? 'Kayıtlı maliyet bulunmamaktadır.' : 'No declared costs available.'}
                </div>
              )}

              {/* Counts Bento card */}
              <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm flex flex-col justify-between">
                <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{lang === 'tr' ? 'Beyanname Durumları' : 'Statement Statuses'}</span>
                <div className="flex items-center justify-between gap-2 pt-2">
                  <div className="text-center bg-emerald-50 border border-emerald-200 rounded-lg p-2 flex-1">
                    <p className="text-xs text-emerald-800 font-bold">{lang === 'tr' ? 'Ödenen' : 'Paid'}</p>
                    <p className="text-lg font-black text-emerald-900 mt-0.5">{statusCounts.Paid || 0}</p>
                  </div>
                  <div className="text-center bg-orange-50 border border-orange-200 rounded-lg p-2 flex-1">
                    <p className="text-xs text-orange-850 font-bold">{lang === 'tr' ? 'Kısmi' : 'Partial'}</p>
                    <p className="text-lg font-black text-orange-950 mt-0.5">{statusCounts.Partial || 0}</p>
                  </div>
                  <div className="text-center bg-red-50 border border-red-200 rounded-lg p-2 flex-1">
                    <p className="text-xs text-slate-700 font-bold">{lang === 'tr' ? 'Ödenmemiş' : 'Unpaid'}</p>
                    <p className="text-lg font-black text-slate-900 mt-0.5">{statusCounts.Unpaid || 0}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Visual Analytics Charts Panel */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Cost by Freight Type */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col">
                <h3 className="font-bold text-slate-800 text-xs mb-3 flex items-center gap-1.5 uppercase tracking-wide">
                  <BarChart className="w-4 h-4 text-slate-500" />
                  <span>{lang === 'tr' ? 'Yük Tipine Göre Maliyet' : 'Maliyet Dağılımı (Segment)'}</span>
                </h3>
                <div className="h-44 mt-auto">
                  {freightChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={freightChartData}>
                        <XAxis dataKey="name" fontSize={10} stroke="#64748b" tickLine={false} axisLine={false} />
                        <YAxis fontSize={10} stroke="#64748b" tickLine={false} axisLine={false} />
                        <Tooltip formatter={(value) => [`${Number(value).toLocaleString()} Total`, 'Cost']} />
                        <Bar dataKey="value" fill="#f97316" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-slate-400 italic text-xs">No analytics data available.</div>
                  )}
                </div>
              </div>

              {/* Cost by Customer (Top 5) */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col">
                <h3 className="font-bold text-slate-800 text-xs mb-3 flex items-center gap-1.5 uppercase tracking-wide">
                  <ClipboardList className="w-4 h-4 text-slate-500" />
                  <span>{lang === 'tr' ? 'Müşterilere Göre Maliyet (En Yüksek 5)' : 'Top 5 Customers by Expense Volume'}</span>
                </h3>
                <div className="h-44 mt-auto">
                  {customerChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={customerChartData} layout="vertical">
                        <XAxis type="number" fontSize={9} stroke="#64748b" tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="name" width={80} fontSize={9} stroke="#64748b" tickLine={false} axisLine={false} />
                        <Tooltip formatter={(val) => [`${Number(val).toLocaleString()}`, 'Total Cost']} />
                        <Bar dataKey="value" fill="#0f172a" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-slate-400 italic text-xs">No analytics data available.</div>
                  )}
                </div>
              </div>

              {/* Cost by Supplier (Top 5) */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col">
                <h3 className="font-bold text-slate-800 text-xs mb-3 flex items-center gap-1.5 uppercase tracking-wide">
                  <Building2 className="w-4 h-4 text-slate-500" />
                  <span>{lang === 'tr' ? 'Tedarikçilere Göre Ödemeler (En Yüksek 5)' : 'Top Suppliers by Declared Costs'}</span>
                </h3>
                <div className="h-44 mt-auto">
                  {supplierChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={supplierChartData}>
                        <XAxis dataKey="name" fontSize={9} stroke="#64748b" tickLine={false} axisLine={false} />
                        <YAxis fontSize={9} stroke="#64748b" tickLine={false} axisLine={false} />
                        <Tooltip formatter={(val) => [`${Number(val).toLocaleString()}`, 'Settlements']} />
                        <Bar dataKey="value" fill="#14532d" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-slate-400 italic text-xs">No supplier entries recorded.</div>
                  )}
                </div>
              </div>

            </div>

            {/* Interactive Filters and Registry */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-4 p-4">
              
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                
                {/* Search Bar matching ship / customer / supplier */}
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    value={costSearchQuery}
                    onChange={(e) => setCostSearchQuery(e.target.value)}
                    placeholder={lang === 'tr' ? "Sevkiyat No, müşteri, tedarikçi adı, plaka ile ara..." : "Search by shipment, customer, supplier name, truck plate..."}
                    className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:bg-white focus:border-slate-400 font-sans shadow-inner"
                  />
                  {costSearchQuery && (
                    <button 
                      onClick={() => setCostSearchQuery("")}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 font-bold text-xs"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Filters */}
                <div className="flex items-center gap-2 flex-wrap">
                  
                  {/* Status Drop Filter */}
                  <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl text-xs">
                    <span className="text-slate-500 font-semibold">{lang === 'tr' ? 'Ödeme Durumu:' : 'Payment:'}</span>
                    <select
                      value={costStatusFilter}
                      onChange={(e) => setCostStatusFilter(e.target.value as any)}
                      className="bg-transparent font-bold outline-none cursor-pointer"
                    >
                      <option value="All">{lang === 'tr' ? 'Tümü' : 'All'}</option>
                      <option value="Paid">{lang === 'tr' ? 'Ödenen' : 'Paid'}</option>
                      <option value="Partial">{lang === 'tr' ? 'Kısmi' : 'Partial'}</option>
                      <option value="Unpaid">{lang === 'tr' ? 'Ödenmemiş' : 'Unpaid'}</option>
                    </select>
                  </div>

                  {/* Freight Segment Filter */}
                  <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl text-xs">
                    <span className="text-slate-500 font-semibold">{lang === 'tr' ? 'Sevkiyat Segmenti:' : 'Segment:'}</span>
                    <select
                      value={costTypeFilter}
                      onChange={(e) => setCostTypeFilter(e.target.value as any)}
                      className="bg-transparent font-bold outline-none cursor-pointer text-xs"
                    >
                      <option value="All">{lang === 'tr' ? 'Tümü' : 'All'}</option>
                      <option value="land">{lang === 'tr' ? 'Karayolu' : 'Land'}</option>
                      <option value="sea">{lang === 'tr' ? 'Denizyolu' : 'Sea'}</option>
                      <option value="air">{lang === 'tr' ? 'Havayolu' : 'Air'}</option>
                    </select>
                  </div>

                </div>

              </div>

              {/* Shipment Registry List */}
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                      <th className="p-3 font-semibold">{lang === 'tr' ? 'Sevkiyat / Yük Detayı' : 'Shipment Details'}</th>
                      <th className="p-3 font-semibold">{lang === 'tr' ? 'Müşteri / Firma' : 'Shipper / Client'}</th>
                      <th className="p-3 font-semibold text-center">{lang === 'tr' ? 'Yük Tipi' : 'Freight Type'}</th>
                      <th className="p-3 font-semibold text-right">{lang === 'tr' ? 'Öngörülen Tutar' : 'Contract Agreed Amount'}</th>
                      <th className="p-3 font-semibold text-right">{lang === 'tr' ? 'Toplam Maliyetlerin' : 'Total Expense Declared'}</th>
                      <th className="p-3 font-semibold text-right">{lang === 'tr' ? 'Ödenen / Bakiye' : 'Paid / Balance'}</th>
                      <th className="p-3 font-semibold text-center">{lang === 'tr' ? 'Fatura Durumu' : 'Budget Status'}</th>
                      <th className="p-3 font-semibold text-center">{lang === 'tr' ? 'İşlemler' : 'Action Tool'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {filteredShipmentsCosts.length > 0 ? (
                      filteredShipmentsCosts.map((sh) => {
                        const stmt = costStatements.find(cs => cs.shipmentId === sh.id);
                        const freightType = sh.freightType || "land";
                        
                        return (
                          <tr key={sh.id} className="hover:bg-slate-50/50 transition-colors">
                            
                            {/* Shipment Details */}
                            <td className="p-3">
                              <div className="font-extrabold text-slate-900 group-hover:text-orange-600 transition-colors uppercase tracking-tight">{sh.shipmentNumber}</div>
                              <div className="text-[10px] text-slate-400 mt-0.5 max-w-xs truncate">{sh.cargoDescription || "General cargo goods"}</div>
                            </td>

                            {/* Client Name */}
                            <td className="p-3 font-semibold text-slate-800">{sh.companyName}</td>

                            {/* Freight Segment Type */}
                            <td className="p-3 text-center">
                              <span className="inline-flex items-center justify-center p-1.5 bg-slate-100 border border-slate-200 text-slate-600 rounded-lg">
                                {freightType === 'land' ? <Truck className="w-3.5 h-3.5" /> : freightType === 'sea' ? <Ship className="w-3.5 h-3.5 text-blue-600" /> : <Plane className="w-3.5 h-3.5 text-violet-600" />}
                              </span>
                            </td>

                            {/* Contract amount agreed with customer */}
                            <td className="p-3 text-right font-mono font-bold text-slate-700">
                              {Number(sh.agreedAmount || 0).toLocaleString()} <span className="text-[10px] text-slate-400">{sh.currency || "USD"}</span>
                            </td>

                            {/* Declared total costs */}
                            <td className="p-3 text-right">
                              {stmt ? (
                                <span className="font-mono font-extrabold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                                  {Number(stmt.totalCost).toLocaleString()} <span className="text-[10px] text-slate-500">{stmt.currency}</span>
                                </span>
                              ) : (
                                <span className="text-slate-400 italic text-[11px] font-mono">0.00 {sh.currency || "USD"}</span>
                              )}
                            </td>

                            {/* Paid and Remaining Balance block */}
                            <td className="p-3 text-right font-mono font-medium">
                              {stmt ? (
                                <div className="space-y-0.5">
                                  <div className="text-emerald-600 font-bold">{Number(stmt.paidAmount).toLocaleString()} <span className="text-[9px] text-slate-400">{stmt.currency}</span></div>
                                  <div className="text-orange-600 font-bold text-[10px]">{Number(stmt.remainingBalance).toLocaleString()} <span className="text-[9px] text-slate-400">Due</span></div>
                                </div>
                              ) : (
                                <span className="text-slate-300">-</span>
                              )}
                            </td>

                            {/* Budget payment status */}
                            <td className="p-3 text-center">
                              {stmt ? (
                                <span className={`inline-block text-[10px] font-black uppercase px-2.5 py-1 rounded-full tracking-wide ${
                                  stmt.paymentStatus === 'Paid' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200/50' : stmt.paymentStatus === 'Partial' ? 'bg-orange-100 text-orange-850 border border-orange-200/50' : 'bg-red-100 text-red-800 border border-red-200/50'
                                }`}>
                                  {stmt.paymentStatus}
                                </span>
                              ) : (
                                <span className="inline-block text-[10px] font-bold text-slate-400 bg-slate-50 border border-slate-200/60 px-2.5 py-1 rounded-full">{lang === 'tr' ? 'Eklenmedi' : 'Unconfigured'}</span>
                              )}
                            </td>

                            {/* Action to create or view cost statement */}
                            <td className="p-3 text-center">
                              <button
                                onClick={() => handleSelectActiveStatement(sh.id)}
                                className={`text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-xl border transition-all cursor-pointer inline-flex items-center gap-1 shrink-0 ${
                                  stmt 
                                    ? 'bg-slate-900 border-slate-800 text-white hover:bg-slate-800' 
                                    : 'bg-white border-orange-500/40 hover:border-orange-500 text-orange-600 hover:bg-orange-500/5'
                                }`}
                              >
                                {stmt ? <Edit3 className="w-3 h-3 text-orange-400" /> : <Plus className="w-3 h-3 text-orange-500 animate-pulse" />}
                                <span>{stmt ? (lang === 'tr' ? 'Düzenle / İncele' : 'Manage Costs') : (lang === 'tr' ? 'Tablo Oluştur' : 'Add Costs')}</span>
                              </button>
                            </td>

                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-slate-400 italic font-medium">
                          {lang === 'tr' ? 'Aranan bütçe kriterlerine uygun sevkiyat bulunamadı.' : 'No matched shipments found.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

            </div>

          </div>
        );
      })()}

      {/* CORE INTEGRATED DIALOG: LIVE-BUILT DUAL COLUMN COST STATEMENT EDITOR & PDF PREVIEW GENERATOR */}
      {selectedCostStatement && isStatementEditorOpen && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-2 md:p-4 z-50 overflow-y-auto block font-sans">
          <div className="bg-slate-100 rounded-3xl border border-slate-350 shadow-2xl w-full max-w-7xl h-[95vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            
            {/* Modal Header bar */}
            <div className="bg-slate-950 text-white p-4 shrink-0 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-500 text-white rounded-xl">
                  <DollarSign className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-orange-400 font-extrabold uppercase bg-orange-600/10 px-2 py-0.5 rounded border border-orange-500/20">{selectedCostStatement.shipmentNumber}</span>
                    <span className="text-[10px] text-slate-400 italic">Statement Draft ID: cs-{selectedCostStatement.shipmentId}</span>
                  </div>
                  <h3 className="text-sm font-black text-white mt-0.5 leading-none">{lang === 'tr' ? 'Maliyet Giriş Modülü & Canlı Beyanname Faturası' : 'Shipment Expenses Declaration & Statement Generator'}</h3>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDownloadPDF("live-statement-preview-draft")}
                  className="px-3 py-1.5 bg-[#f97316] text-white hover:bg-orange-600 border-0 text-xs font-black rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shadow-md"
                  title="Download cost statement as PDF"
                >
                  <Download className="w-3.5 h-3.5 text-orange-200" />
                  <span>{lang === 'tr' ? 'PDF İndir' : 'Download PDF'}</span>
                </button>
                <button
                  onClick={() => handlePrintStatement("live-statement-preview-draft")}
                  className="px-3 py-1.5 bg-emerald-600 text-white hover:bg-emerald-700 border-0 text-xs font-black rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shadow-md"
                  title="Print cost statement to printer"
                >
                  <Printer className="w-3.5 h-3.5 text-emerald-200" />
                  <span>{lang === 'tr' ? 'Yazdır' : 'Print'}</span>
                </button>
                <button
                  onClick={() => handleExportCSV(selectedCostStatement)}
                  className="px-3 py-1.5 bg-slate-900 border border-slate-800 text-xs font-bold rounded-xl text-slate-300 hover:text-white hover:bg-slate-850 flex items-center gap-1 transition-all cursor-pointer"
                  title="Export records to CSV formatted file"
                >
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
                  <span>CSV Export</span>
                </button>
                <button 
                  onClick={() => {
                    setIsStatementEditorOpen(false);
                    setSelectedCostStatement(null);
                  }}
                  className="p-1.5 bg-slate-900 hover:bg-red-950 hover:text-red-400 rounded-xl text-slate-400 transition-all border border-slate-850 cursor-pointer"
                  title="Close module draft"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Split Screen Master View */}
            <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0 bg-slate-100">
              
              {/* LEFT COLUMN: SCROLLABLE DATA ENTRY SYSTEM & FORM BLOCK */}
              <div className="w-full lg:w-1/2 p-4 md:p-6 overflow-y-auto space-y-6 lg:border-r border-slate-300">
                
                {/* Section header */}
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-4">
                  <h4 className="text-xs font-extrabold text-slate-800 uppercase tracking-widest border-b border-slate-150 pb-2 flex items-center justify-between">
                    <span>{lang === 'tr' ? '1. Temel Muhasebe Verileri' : '1. Core Accounting Parameters'}</span>
                    <span className="text-[10px] text-slate-400 font-mono normal-case">Linked cargo: {selectedCostStatement.companyName}</span>
                  </h4>
                  
                  <div className="grid grid-cols-2 gap-4">
                    
                    {/* Date Gird */}
                    <div>
                      <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">{lang === 'tr' ? 'Fatura / İşlem Tarih' : 'Statement Date'}</label>
                      <input
                        type="date"
                        value={selectedCostStatement.date}
                        onChange={(e) => setSelectedCostStatement(prev => prev ? { ...prev, date: e.target.value } : null)}
                        className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:bg-white focus:border-slate-400"
                      />
                    </div>

                    {/* Currency select */}
                    <div>
                      <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">{lang === 'tr' ? 'Hesap Para Bökümü' : 'Primary Currency'}</label>
                      <select
                        value={selectedCostStatement.currency}
                        onChange={(e) => {
                          const cur = e.target.value as Currency;
                          setSelectedCostStatement(prev => {
                            if (!prev) return prev;
                            const updatedItems = prev.items.map(it => ({ ...it, currency: cur }));
                            return { ...prev, currency: cur, items: updatedItems };
                          });
                        }}
                        className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:bg-white focus:border-slate-400 cursor-pointer"
                      >
                        <option value="USD">USD ($) United States Dollar</option>
                        <option value="IQD">IQD (د.ع) Iraqi Dinar</option>
                        <option value="TRY">TRY (₺) Turkish Lira</option>
                      </select>
                    </div>

                    {/* Paid Amount */}
                    <div>
                      <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">{lang === 'tr' ? 'Tahsil Edilen (Müşteri Ödemesi)' : 'Paid Amount (Received from Customer)'}</label>
                      <div className="relative">
                        <input
                          type="number"
                          value={selectedCostStatement.paidAmount || ""}
                          onChange={(e) => {
                            const val = Number(e.target.value) || 0;
                            setSelectedCostStatement(prev => {
                              if (!prev) return prev;
                              const bal = Number(prev.totalCost || 0) - val;
                              const st = bal <= 0 && prev.totalCost > 0 ? "Paid" : (val > 0 ? "Partial" : "Unpaid");
                              return {
                                ...prev,
                                paidAmount: val,
                                remainingBalance: bal,
                                paymentStatus: st
                              };
                            });
                          }}
                          placeholder="0.00"
                          className="w-full p-2 pr-12 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:bg-white focus:border-slate-400"
                        />
                        <span className="absolute right-2.5 top-2 bg-slate-200 text-slate-700 font-mono text-[9px] font-black px-1.5 py-0.5 rounded uppercase">{selectedCostStatement.currency}</span>
                      </div>
                    </div>

                    {/* Calculated paymentStatus readout */}
                    <div>
                      <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">{lang === 'tr' ? 'Güncel Ödeme Statüsü' : 'Calculated Budget Status'}</label>
                      <div className="p-2 border border-slate-200 rounded-xl text-xs bg-slate-50 font-bold uppercase tracking-wider flex items-center justify-between">
                        <span>{selectedCostStatement.paymentStatus}</span>
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                          selectedCostStatement.paymentStatus === 'Paid' ? 'bg-emerald-500' : selectedCostStatement.paymentStatus === 'Partial' ? 'bg-orange-500' : 'bg-red-500'
                        }`} />
                      </div>
                    </div>

                  </div>
                </div>

                {/* COST BREAKDOWN ACCORDION BLOCK OR EDITABLE LIST */}
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-4">
                  
                  <div className="flex items-center justify-between border-b border-slate-150 pb-2">
                    <div>
                      <h4 className="text-xs font-extrabold text-slate-800 uppercase tracking-widest">{lang === 'tr' ? '2. Maliyet Girdi Kalemleri' : '2. Expense Items Breakdown'}</h4>
                      <p className="text-[10px] text-slate-400 mt-0.5">{lang === 'tr' ? 'Port, gümrük, navlun, depo, demuraj vb. tüm işlem masraflarını buraya ekleyebilirsiniz.' : 'Enter all logistic transactions, including fees, custom clearances, taxes and border penalties here.'}</p>
                    </div>
                    <button
                      onClick={handleAddCostItem}
                      className="px-3 py-1 bg-orange-500 hover:bg-orange-600 font-bold text-white text-xs rounded-xl flex items-center gap-1 transition-all cursor-pointer border-0 inline-flex"
                    >
                      <Plus className="w-4.5 h-4.5" />
                      <span>{lang === 'tr' ? 'Öğe Ekle' : 'Add Item'}</span>
                    </button>
                  </div>

                  {/* Items form list */}
                  <div className="space-y-4">
                    {selectedCostStatement.items && selectedCostStatement.items.length > 0 ? (
                      selectedCostStatement.items.map((item, idx) => {
                        return (
                          <div key={item.id} className="p-3 border border-slate-200 rounded-2xl bg-slate-50/50 space-y-3 relative group/item">
                            
                            {/* Delete specific item tab */}
                            <button
                              onClick={() => handleDeleteCostItem(idx)}
                              className="absolute top-2.5 right-2.5 p-1 bg-transparent hover:bg-red-500 text-slate-400 hover:text-white rounded-lg transition-all border-0 cursor-pointer"
                              title="Delete cost item"
                            >
                              <X className="w-3.5 h-3.5 font-bold" />
                            </button>

                            {/* Item Number Tracker */}
                            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-250 pb-1.5 max-w-sm">Expense Item #{idx + 1}</div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                              
                              {/* Cost Type Category */}
                              <div>
                                <label className="block text-[9px] uppercase font-bold text-slate-400 mb-0.5">{lang === 'tr' ? 'Harcama Tipi' : 'Expense Category'}</label>
                                <select
                                  value={item.costType}
                                  onChange={(e) => handleUpdateCostItem(idx, { costType: e.target.value })}
                                  className="w-full p-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none cursor-pointer"
                                >
                                  <option value="Freight Charge">{lang === 'tr' ? 'Navlun Ücreti' : 'Freight Charge'}</option>
                                  <option value="Customs Clearance">{lang === 'tr' ? 'Gümrük İşlemleri' : 'Customs Clearance'}</option>
                                  <option value="Border Charges">{lang === 'tr' ? 'Sınır Kapısı Giderleri' : 'Border Charges'}</option>
                                  <option value="Port Charges">{lang === 'tr' ? 'Liman Hizmetleri' : 'Port Charges'}</option>
                                  <option value="Terminal Handling Charges">{lang === 'tr' ? 'Terminal Depolama ve THC' : 'Terminal Handling Charges'}</option>
                                  <option value="Trucking Cost">{lang === 'tr' ? 'Çekici Nakliye Maliyeti' : 'Trucking Cost'}</option>
                                  <option value="Loading / Unloading">{lang === 'tr' ? 'Yükleme / Tahliye' : 'Loading / Unloading'}</option>
                                  <option value="Storage">{lang === 'tr' ? 'Depolama Ücretleri' : 'Storage'}</option>
                                  <option value="Demurrage">{lang === 'tr' ? 'Demuraj Bedeli (Bekleme)' : 'Demurrage'}</option>
                                  <option value="Documentation Fee">{lang === 'tr' ? 'Evrak ve Tescil Harcı' : 'Documentation Fee'}</option>
                                  <option value="Inspection Fee">{lang === 'tr' ? 'Muayene ve Karantina' : 'Inspection Fee'}</option>
                                  <option value="Delivery Cost">{lang === 'tr' ? 'Teslimat Bedeli' : 'Delivery Cost'}</option>
                                  <option value="Other Charges">{lang === 'tr' ? 'Diğer Harcamalar' : 'Other Charges'}</option>
                                </select>
                              </div>

                              {/* Supplier Supplier Name */}
                              <div>
                                <label className="block text-[9px] uppercase font-bold text-slate-400 mb-0.5">{lang === 'tr' ? 'Tedarikçi / Gümrükçü Firma' : 'Supplier / Vendor Name'}</label>
                                <input
                                  type="text"
                                  list="vendor-options"
                                  value={item.supplierName || ""}
                                  onChange={(e) => handleUpdateCostItem(idx, { supplierName: e.target.value })}
                                  placeholder={lang === 'tr' ? "Örn: Erbil Gümrük Müşavirliği" : "e.g. Al-Mesul Port Services"}
                                  className="w-full p-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none text-slate-900"
                                />
                                <datalist id="vendor-options">
                                  {vendors.map((v) => (
                                    <option key={v.id} value={v.companyName}>{v.serviceType}</option>
                                  ))}
                                </datalist>
                              </div>

                              {/* Description */}
                              <div className="md:col-span-2">
                                <label className="block text-[9px] uppercase font-bold text-slate-400 mb-0.5">{lang === 'tr' ? 'Açıklama / Notlar' : 'Detailed Notes / Description'}</label>
                                <input
                                  type="text"
                                  value={item.description || ""}
                                  onChange={(e) => handleUpdateCostItem(idx, { description: e.target.value })}
                                  placeholder={lang === 'tr' ? "Masraf dökümü ve harcama nedeni..." : "Line-item description detail..."}
                                  className="w-full p-2 bg-white border border-slate-200 rounded-xl text-xs font-medium outline-none"
                                />
                              </div>

                              {/* Math: Quantity, UnitPrice, TotalAmount */}
                              <div>
                                <label className="block text-[9px] uppercase font-bold text-slate-400 mb-0.5">{lang === 'tr' ? 'Miktar (Adet/Ton)' : 'Quantity'}</label>
                                <input
                                  type="number"
                                  value={item.quantity || ""}
                                  onChange={(e) => handleUpdateCostItem(idx, { quantity: Number(e.target.value) || 0 })}
                                  placeholder="1"
                                  className="w-full p-2 bg-white border border-slate-200 rounded-xl text-xs font-mono font-bold outline-none"
                                />
                              </div>

                              <div>
                                <label className="block text-[9px] uppercase font-bold text-slate-400 mb-0.5">{lang === 'tr' ? 'Birim Fiyat' : 'Unit Price'}</label>
                                <div className="relative">
                                  <input
                                    type="number"
                                    value={item.unitPrice || ""}
                                    onChange={(e) => handleUpdateCostItem(idx, { unitPrice: Number(e.target.value) || 0 })}
                                    placeholder="0"
                                    className="w-full p-2 pr-10 bg-white border border-slate-200 rounded-xl text-xs font-mono font-bold outline-none"
                                  />
                                  <span className="absolute right-2 top-2 text-[9px] bg-slate-100 p-0.5 rounded font-black text-slate-500 uppercase">{selectedCostStatement.currency}</span>
                                </div>
                              </div>

                              {/* Upload item Receipt/Document */}
                              <div className="md:col-span-2 p-2.5 bg-white border border-slate-200 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                                <div className="flex items-center gap-2">
                                  <Paperclip className="w-4 h-4 text-slate-400 shrink-0" />
                                  <div className="truncate max-w-xs md:max-w-md">
                                    <span className="font-bold block text-[11px] text-slate-500 uppercase tracking-widest">{lang === 'tr' ? 'İŞLEM DEKONTU VEYA FATURA' : 'RECEIPT / PROOF DOCUMENT'}</span>
                                    {item.documentUrl ? (
                                      <a
                                        href={item.documentUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-orange-600 hover:underline font-extrabold flex items-center gap-1.5 mt-0.5 shrink-0"
                                      >
                                        <FileText className="w-3.5 h-3.5 shrink-0" />
                                        <span className="truncate">{item.documentName || "Receipt_Document.pdf"}</span>
                                      </a>
                                    ) : (
                                      <span className="text-[11px] text-slate-400 italic font-medium">{lang === 'tr' ? 'Belge yüklenmedi.' : 'No proof file attached yet.'}</span>
                                    )}
                                  </div>
                                </div>

                                <div className="space-x-1 flex items-center shrink-0">
                                  {item.documentUrl && (
                                    <button
                                      onClick={() => handleUpdateCostItem(idx, { documentUrl: undefined, documentName: undefined })}
                                      className="px-2.5 py-1 text-[10px] text-red-500 bg-red-50 hover:bg-red-100 rounded-lg transition-all border-0 font-bold cursor-pointer"
                                    >
                                      ✕ Clear
                                    </button>
                                  )}
                                  <label className={`px-3 py-1 rounded-lg text-[11px] font-black tracking-wide border cursor-pointer inline-flex items-center justify-center transition-all ${
                                    receiptUploadingIndex === idx 
                                      ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed' 
                                      : 'bg-slate-900 border-slate-800 text-white hover:bg-slate-800'
                                  }`}>
                                    {receiptUploadingIndex === idx ? (
                                      <span className="animate-pulse">{lang === 'tr' ? 'Yükleniyor...' : 'Uploading...'}</span>
                                    ) : (
                                      <>
                                        <span>{item.documentUrl ? (lang === 'tr' ? 'Değiştir' : 'Replace File') : (lang === 'tr' ? 'Yükle / Seç' : 'Upload Receipt')}</span>
                                        <input
                                          type="file"
                                          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                                          className="hidden"
                                          onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) handleUploadReceiptFile(idx, file);
                                          }}
                                          disabled={receiptUploadingIndex === idx}
                                        />
                                      </>
                                    )}
                                  </label>
                                </div>
                              </div>

                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="p-8 border-2 border-dashed border-slate-200 rounded-2xl text-center text-slate-400 space-y-2 bg-slate-50">
                        <DollarSign className="w-10 h-10 mx-auto text-slate-300 animate-bounce" />
                        <p className="text-xs font-bold leading-relaxed">{lang === 'tr' ? 'Maliyet kırılımı bulunmamaktadır.' : 'No expenses added yet.'}</p>
                        <p className="text-[10px] text-slate-400">{lang === 'tr' ? 'Sağ üst köşedeki "Öğe Ekle" butonunu kullanarak navlun, gümrük vb. kalemi ekleyebilirsiniz.' : 'Use the "Add Item" button above to register border charges, trucking logs, or custom agency clearance.'}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Optional broad notes section */}
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-2">
                  <label className="block text-[10px] uppercase font-bold text-slate-500">{lang === 'tr' ? 'Kapatma / Beyanname Notları' : 'Notes / Closing remarks'}</label>
                  <textarea
                    value={selectedCostStatement.notes}
                    onChange={(e) => setSelectedCostStatement(prev => prev ? { ...prev, notes: e.target.value } : null)}
                    placeholder={lang === 'tr' ? "Ödeme koşulları veya genel durum açıklamaları..." : "e.g. Terms of payment and local customs validation remarks..."}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:bg-white focus:border-slate-400 h-16 font-medium"
                  />
                </div>

                {/* Submitting Actions */}
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between gap-4 sticky bottom-0 border-t z-10">
                  <div className="text-xs font-mono text-slate-400">
                    {lang === 'tr' ? 'Otomatik güncellenir:' : 'Calculated Live Summary:'} <span className="font-bold text-slate-800">{selectedCostStatement.items?.length || 0} items</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setIsStatementEditorOpen(false);
                        setSelectedCostStatement(null);
                      }}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition-all border-0 cursor-pointer"
                    >
                      {lang === 'tr' ? 'İptal Et' : 'Cancel'}
                    </button>
                    <button
                      onClick={handleSaveCostStatement}
                      disabled={isSavingCostStatement}
                      className={`px-5 py-2 bg-orange-500 hover:bg-orange-600 text-white text-xs font-black rounded-xl shadow-lg border-0 cursor-pointer transition-all inline-flex items-center gap-1.5 ${
                        isSavingCostStatement ? 'opacity-50 cursor-not-allowed' : ''
                      }`}
                    >
                      {isSavingCostStatement ? (
                        <span className="animate-pulse">{lang === 'tr' ? 'Kaydediliyor...' : 'Saving Statements...'}</span>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          <span>{lang === 'tr' ? 'Beyannameyi Kaydet' : 'Save Sheet Statement'}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

              </div>

              {/* RIGHT COLUMN: REAL TIME INVOICE-STYLE PRINTABLE PDF STATEMENT PREVIEW */}
              <div className="w-full lg:w-1/2 p-4 md:p-6 overflow-y-auto bg-slate-50 flex flex-col items-center justify-start max-h-screen">
                
                {/* Print button on top */}
                <div className="w-full max-w-2xl flex items-center justify-between pl-1 pb-4 shrink-0">
                  <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">{lang === 'tr' ? 'Müşteri Beyanname Çıktısı (PDF)' : 'Live Document Statement'}</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleDownloadPDF("live-statement-preview-draft")}
                      className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-850 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer shadow-md border border-slate-300"
                    >
                      <Download className="w-4 h-4 shrink-0 text-orange-500" />
                      <span>{lang === 'tr' ? 'PDF İndir' : 'Download PDF'}</span>
                    </button>
                    <button
                      onClick={() => handlePrintStatement("live-statement-preview-draft")}
                      className="px-3.5 py-1.5 bg-slate-900 text-white hover:bg-slate-800 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer shadow-md border-0"
                    >
                      <Printer className="w-4 h-4 shrink-0 text-orange-500" />
                      <span>{lang === 'tr' ? 'Yazdır' : 'Print'}</span>
                    </button>
                    <button
                      onClick={() => setIsPrintPreviewOpen(true)}
                      className="px-3.5 py-1.5 bg-[#f97316] text-white hover:bg-orange-600 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer shadow-md border-0"
                    >
                      <Eye className="w-4 h-4 shrink-0 font-extrabold" />
                      <span>{lang === 'tr' ? 'Yazdırma Önizlemesi' : 'Print Preview'}</span>
                    </button>
                  </div>
                </div>

                {/* Printable physical page simulation container */}
                <div id="live-statement-preview-draft" className="w-full max-w-2xl bg-white border border-slate-300 shadow-lg rounded-2xl overflow-hidden p-6 md:p-8 space-y-6 font-sans relative text-slate-800 prose select-text print:shadow-none print:border-none print:rounded-none">
                  
                  {/* Watermark Logo decoration - fully hidden on print if requested but nice decoration */}
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
                      <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">E-TIR LOGISTICS & TRANSPORT AGENCY LTD.</p>
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
                        <div><strong>{lang === 'tr' ? 'Statü:' : 'Calculated Status:'}</strong> <span className="font-extrabold text-slate-850 uppercase">{selectedCostStatement.paymentStatus}</span></div>
                      </div>
                    </div>
                  </div>

                  {/* Shipment metadata block */}
                  <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-150 text-[11px] leading-relaxed">
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
                        <span>{lang === 'tr' ? 'Alınan Ödeme (Tahsil):' : 'Amount Received:'}</span>
                        <strong>- {Number(selectedCostStatement.paidAmount).toLocaleString()} <span className="text-[9px] text-emerald-500">{selectedCostStatement.currency}</span></strong>
                      </div>

                      <div className="flex justify-between items-center text-slate-900 pt-2 text-xs font-black">
                        <span>{lang === 'tr' ? 'KALAN DÖKÜM BAKİYESİ:' : 'STATEMENT BALANCE DUE:'}</span>
                        <span className="text-[#f97316] font-mono bg-orange-50 border border-orange-200/55 px-2 py-0.5 rounded text-xs">
                          {Number(selectedCostStatement.remainingBalance).toLocaleString()} <span className="text-[10px] font-bold text-slate-600">{selectedCostStatement.currency}</span>
                        </span>
                      </div>

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
                      <div className="font-mono text-[8px] text-slate-300">E-TIR PLATFORM SECURITY CLEARANCE</div>
                    </div>
                  </div>

                </div>

              </div>

            </div>

          </div>
        </div>
      )}


      {/* DETAILED MODAL PORTAL: SHIPMENT DRAWER SCREEN */}
      {targetDetailsShipment && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto block">
          <div className="bg-white rounded-2xl border border-slate-350 shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            
            {/* Modal Header */}
            <div className="sticky top-0 bg-slate-900 text-white p-5 rounded-t-2xl flex items-center justify-between gap-4 border-b border-slate-800 z-10">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="bg-orange-500 text-white font-mono text-xs font-bold uppercase rounded px-2.5 py-0.5 tracking-wider">
                    {targetDetailsShipment.shipmentNumber}
                  </span>
                  <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono font-bold">
                    {targetDetailsShipment.status}
                  </span>
                </div>
                <h3 className="text-lg font-bold truncate max-w-md">{targetDetailsShipment.companyName}</h3>
              </div>
              <button 
                onClick={() => setOpenDetailsId(null)}
                className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 hover:text-white transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content Drawer Grid */}
            <div className="p-6 space-y-6 text-sm">
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
                    <span className="w-1.5 h-3 bg-blue-500 rounded"></span>
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

                {/* 4. Dispatched Driver Account & Assigned Pay */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <h4 className="font-bold text-slate-900 border-b border-slate-200 pb-2">{t('truckAndDriver')}</h4>
                  <div className="space-y-2 text-xs">
                    <div>
                      <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">{t('driverName')}</span>
                      <p className="font-bold text-slate-900">{targetDetailsShipment.assignedDriverName}</p>
                    </div>
                    <div className="flex gap-4">
                      <div>
                        <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">{t('truckNumber')}</span>
                        <p className="font-mono font-bold text-slate-800">{targetDetailsShipment.truckNumber || "-"}</p>
                      </div>
                      <div>
                        <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">{t('carrierAmount')}</span>
                        <p className="font-bold text-orange-600">{targetDetailsShipment.agreedAmount.toLocaleString()} {targetDetailsShipment.currency}</p>
                      </div>
                    </div>
                  </div>
                </div>

                 {/* 5. Custom notes */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <h4 className="font-bold text-slate-900 border-b border-slate-200 pb-2">{t('internalNotes')}</h4>
                  <p className="text-xs text-slate-700 italic">{targetDetailsShipment.internalNotes || "No internal administration logs logged."}</p>
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
                      <div>
                        <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Container Number</span>
                        <p className="font-mono font-bold text-slate-900">{targetDetailsShipment.containerNumber || "-"}</p>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">No of Containers</span>
                        <p className="font-bold text-slate-900">{targetDetailsShipment.numberOfContainers || 1} ({targetDetailsShipment.containerType || "40HC"})</p>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Port of Loading (POL)</span>
                        <p className="font-bold text-slate-905">{targetDetailsShipment.portOfLoading || "-"}</p>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Port of Discharge (POD)</span>
                        <p className="font-bold text-slate-905">{targetDetailsShipment.portOfDischarge || "-"}</p>
                      </div>
                      <div className="col-span-2">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Estimated Departure (ETD)</span>
                        <p className="font-mono font-bold text-slate-900">
                          {targetDetailsShipment.etd ? new Date(targetDetailsShipment.etd).toLocaleString() : "-"}
                        </p>
                      </div>
                      <div className="col-span-2">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Estimated Arrival (ETA)</span>
                        <p className="font-mono font-bold text-orange-650">
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
                        <p className="font-mono font-bold text-orange-655">
                          {targetDetailsShipment.eta ? new Date(targetDetailsShipment.eta).toLocaleString() : "-"}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* 5.3 Dedicated Operations & Manual Status / Milestone Console */}
                <div className="p-5 bg-slate-900 text-white rounded-xl space-y-4 md:col-span-2 shadow-xl border border-slate-700">
                  <div className="flex items-center gap-2 border-b border-slate-800 pb-2.5">
                    <span className="p-1 px-2.5 text-[10px] uppercase font-bold font-mono tracking-wider bg-blue-600 text-white rounded">Manual Control</span>
                    <h4 className="font-bold text-sm tracking-tight flex items-center gap-1.5 text-blue-300">
                      <RefreshCw className="w-4 h-4 shrink-0 text-blue-400" />
                      <span>Log Transit Milestone / Manuel İşlem Masası</span>
                    </h4>
                  </div>
                  <p className="text-[11px] text-slate-350 leading-relaxed font-medium">
                    Since Air and Maritime cargos do not utilize driver apps, you must log current status milestones directly from this panel. These status changes immediately updates client charts and alerts.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Select Updated Transit Status</label>
                      <select
                        value={manualStatus}
                        onChange={(e) => setManualStatus(e.target.value as ShipmentStatus)}
                        className="w-full text-xs font-bold p-2.5 bg-slate-800 border border-slate-750 text-white rounded-lg focus:ring-1 focus:ring-blue-500 outline-none cursor-pointer"
                      >
                        {(targetDetailsShipment.freightType === 'sea'
                          ? ['Booking Confirmed', 'Container Released', 'Loaded on Vessel', 'Vessel Departed', 'In Transit', 'Arrived at Port', 'Customs Clearance', 'Released', 'Out for Delivery', 'Delivered', 'Completed']
                          : targetDetailsShipment.freightType === 'air'
                            ? ['Booking Confirmed', 'Cargo Received', 'Security Check Completed', 'Departed Airport', 'In Transit', 'Arrived Airport', 'Customs Clearance', 'Released', 'Out for Delivery', 'Delivered', 'Completed']
                            : ['New', 'Assigned', 'Accepted', 'Loading', 'Loaded', 'In Transit', 'Border Crossing', 'Customs Clearance', 'Arrived', 'Delivered', 'Closed']
                        ).map((st) => (
                          <option key={st} value={st} className="bg-slate-900">{st}</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Status Description / Remarks (Location & Notes)</label>
                      <input
                        type="text"
                        placeholder="e.g., Vessel departed from Port of loading, ETA intact."
                        value={manualRemarks}
                        onChange={(e) => setManualRemarks(e.target.value)}
                        className="w-full text-xs p-2.5 bg-slate-800 border border-slate-750 text-white placeholder:text-slate-500 rounded-lg focus:ring-1 focus:ring-blue-500 outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={handleManualStatusUpdate}
                      disabled={isSubmittingStatus}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs py-2.5 px-5 rounded-lg inline-flex items-center gap-2 transition-all cursor-pointer border-0 shadow-md font-mono disabled:opacity-50"
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
                          <label className="flex items-center gap-1.5 text-xs text-orange-905 cursor-pointer">
                            <input 
                              type="checkbox" 
                              checked={targetDetailsShipment.shareIncludeDocuments}
                              onChange={(e) => handleToggleDocSharing(targetDetailsShipment, 'shareIncludeDocuments', e.target.checked)}
                              className="w-3.5 h-3.5 rounded"
                            />
                            <span>{t('includeDocs')}</span>
                          </label>

                          <label className="flex items-center gap-1.5 text-xs text-orange-905 cursor-pointer">
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
                          className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 shadow-sm cursor-pointer transition-all"
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

                {/* 7. Shipment Document Control Board */}
                <div className="md:col-span-2 space-y-3">
                  <h4 className="font-bold text-slate-900 border-b border-slate-100 pb-2">{t('documentCenter')}</h4>
                  
                  {targetDetailsShipment.documents.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {targetDetailsShipment.documents.map((doc) => (
                        <div key={doc.id} className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-3 hover:border-slate-350 transition-all shadow-xs">
                          <div className="flex items-center gap-2 truncate">
                            {doc.category === 'photo' ? (
                              <ImageIcon className="w-5 h-5 text-teal-600 shrink-0" />
                            ) : (
                              <FileText className="w-5 h-5 text-blue-600 shrink-0" />
                            )}
                            <div className="truncate text-xs">
                              <p className="font-semibold text-slate-800 truncate">{doc.name}</p>
                              <span className="text-[10px] text-slate-400 block">{doc.category.toUpperCase()} ➔ Uploaded by {doc.uploadedBy}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => toggleDocVisibility(targetDetailsShipment.id, doc.id, doc.isSharedExternally)}
                              title={doc.isSharedExternally ? "Visible on Share Tracking link" : "Hidden from Share Tracking link"}
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
                              className="p-1 px-2.5 bg-slate-900 text-white rounded text-[10px] font-bold"
                            >
                              Get
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-slate-400 text-xs italic">No documents registered. Attachments uploaded through chat appear here automatically.</p>
                  )}
                </div>

                {/* 8. Detailed Shipment Timeline Tracker */}
                <div className="md:col-span-2 space-y-3">
                  <h4 className="font-bold text-slate-900 border-b border-slate-150 pb-2">{t('timeline')}</h4>
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
                </div>

              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 rounded-b-2xl flex items-center justify-end">
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
          <div className="bg-white rounded-2xl border border-slate-350 shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-900 text-white rounded-t-2xl">
              <h3 className="font-bold text-lg">{t('createShipment')}</h3>
              <button onClick={() => setIsCreateOpen(false)} className="p-1.5 bg-slate-850 hover:bg-slate-700 rounded-lg text-slate-300">
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
                        onClick={() => setNewShipmentData({ 
                          ...newShipmentData, 
                          freightType: mode.id,
                        })}
                        className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${
                          isSelected 
                            ? 'bg-slate-900 text-white border-slate-900 shadow-md font-bold' 
                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-350 hover:bg-slate-50'
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
                  <div className="p-4 border border-slate-150 rounded-xl space-y-4">
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
                  <div className="p-4 border border-slate-150 rounded-xl space-y-4">
                    <h4 className="font-bold text-slate-950 text-xs uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded bg-blue-500"></span> {t('deliveryInfo')}
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
                  <div className="p-4 border border-slate-150 rounded-xl space-y-4">
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
                        <label className="text-xs font-semibold text-slate-700">{t('assignDriver')}</label>
                        <select
                          value={newShipmentData.assignedDriverId}
                          onChange={(e) => setNewShipmentData({ ...newShipmentData, assignedDriverId: e.target.value })}
                          className="w-full p-2.5 bg-slate-50 border border-slate-250 focus:border-slate-500 rounded-lg outline-none text-xs"
                        >
                          <option value="">-- {t('selectDriver')} --</option>
                          {drivers.map(d => (
                            <option key={d.id} value={d.id}>
                              {d.name} ({d.truckNumber} - Active: {d.activeShipmentsCount})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* DYNAMIC SEA PARAMETERS */}
              {newShipmentData.freightType === 'sea' && (
                <div className="p-4 border border-slate-150 rounded-xl space-y-4 bg-slate-50/50">
                  <h4 className="font-bold text-slate-950 text-xs uppercase tracking-wider flex items-center gap-1.5 text-blue-800">
                    <Anchor className="w-4 h-4 text-blue-500" /> Maritime Shipping Parameters / Denizyolu Bilgileri
                  </h4>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Shipping Line / Nakliye Hattı <span className="text-red-500">*</span></label>
                      <input 
                        type="text" 
                        required
                        placeholder="e.g. Maersk, MSC, COSCO"
                        value={newShipmentData.shippingLine}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, shippingLine: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Vessel Name / Gemi Adı <span className="text-red-500">*</span></label>
                      <input 
                        type="text" 
                        required
                        placeholder="e.g. EVER GIVEN"
                        value={newShipmentData.vesselName}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, vesselName: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Container Number <span className="text-red-500">*</span></label>
                      <input 
                        type="text" 
                        required
                        placeholder="e.g. MSCO1234567"
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
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Port of Loading (POL)</label>
                      <input 
                        type="text" 
                        placeholder="e.g. Port of Ambarli, Istanbul"
                        value={newShipmentData.portOfLoading}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, portOfLoading: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Port of Discharge (POD)</label>
                      <input 
                        type="text" 
                        placeholder="e.g. Port of Umm Qasr"
                        value={newShipmentData.portOfDischarge}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, portOfDischarge: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Final Destination</label>
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
                <div className="p-4 border border-slate-150 rounded-xl space-y-4 bg-slate-50/50">
                  <h4 className="font-bold text-slate-950 text-xs uppercase tracking-wider flex items-center gap-1.5 text-blue-800">
                    <Plane className="w-4 h-4 text-blue-500" /> Air Freight Parameters / Havayolu Bilgileri
                  </h4>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Airline / Havayolu Havuz <span className="text-red-500">*</span></label>
                      <input 
                        type="text" 
                        required
                        placeholder="e.g. Turkish Cargo, Lufthansa"
                        value={newShipmentData.airline}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, airline: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Flight number <span className="text-red-500">*</span></label>
                      <input 
                        type="text" 
                        required
                        placeholder="e.g. TK1242"
                        value={newShipmentData.flightNumber}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, flightNumber: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">AWB Number (Air Waybill) <span className="text-red-500">*</span></label>
                      <input 
                        type="text" 
                        required
                        placeholder="e.g. 235-9008871"
                        value={newShipmentData.airWaybillNumber}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, airWaybillNumber: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Airport of Departure</label>
                      <input 
                        type="text" 
                        placeholder="e.g. IST (Istanbul)"
                        value={newShipmentData.airportOfDeparture}
                        onChange={(e) => setNewShipmentData({ ...newShipmentData, airportOfDeparture: e.target.value })}
                        className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Airport of Arrival</label>
                      <input 
                        type="text" 
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
              <div className="p-4 border border-slate-150 rounded-xl space-y-4">
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
                      <option value="TRY">TRY</option>
                      <option value="IQD">IQD</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* SHARED NOTES */}
              <div className="p-4 bg-slate-50 border border-slate-150 rounded-xl space-y-2">
                <label className="font-bold text-slate-900">{t('internalNotes')}</label>
                <textarea 
                  rows={3}
                  placeholder="Enter specific logistics terms, driver or tracking parameters..."
                  value={newShipmentData.internalNotes}
                  onChange={(e) => setNewShipmentData({ ...newShipmentData, internalNotes: e.target.value })}
                  className="w-full p-2.5 bg-white border border-slate-200 focus:border-slate-500 rounded-lg outline-none text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-150">
                <button type="button" onClick={() => setIsCreateOpen(false)} className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl">
                  {t('cancel')}
                </button>
                <button type="submit" className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-lg transition-all">
                  {t('save')}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* EDIT SHIPMENT OVERLAY MODAL */}
      {isEditOpen && editingShipment && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto block">
          <div className="bg-white rounded-2xl border border-slate-350 shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-900 text-white rounded-t-2xl">
              <h3 className="font-bold text-lg">{t('editShipment')} — {editingShipment.shipmentNumber}</h3>
              <button onClick={() => {
                setIsEditOpen(false);
                setEditingShipment(null);
              }} className="p-1.5 bg-slate-850 hover:bg-slate-700 rounded-lg text-slate-300">
                <X className="w-5 h-5" />
              </button>
            </div>

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
                      <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full text-xs font-bold border border-blue-150">
                        <Anchor className="w-3.5 h-3.5" /> Ocean Freight / Deniz Yolu
                      </span>
                    ) : editingShipment.freightType === 'air' ? (
                      <span className="inline-flex items-center gap-1 bg-orange-50 text-orange-700 px-2.5 py-1 rounded-full text-xs font-bold border border-orange-150">
                        <Plane className="w-3.5 h-3.5" /> Air Freight / Hava Yolu
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full text-xs font-bold border border-emerald-150">
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
                      <label className="text-xs font-semibold text-slate-700">{t('assignDriver')}</label>
                      <select
                        value={editingShipment.assignedDriverId || ""}
                        onChange={(e) => setEditingShipment({ ...editingShipment, assignedDriverId: e.target.value })}
                        className="w-full p-2.5 border border-slate-200 rounded-lg outline-none bg-white text-xs"
                      >
                        <option value="">-- {t('selectDriver')} --</option>
                        {drivers.map(d => (
                          <option key={d.id} value={d.id}>{d.name} ({d.truckNumber})</option>
                        ))}
                      </select>
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
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">POL (Loading Port)</label>
                        <input 
                          type="text" 
                          value={editingShipment.portOfLoading || ""}
                          onChange={(e) => setEditingShipment({ ...editingShipment, portOfLoading: e.target.value })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">POD (Discharge Port)</label>
                        <input 
                          type="text" 
                          value={editingShipment.portOfDischarge || ""}
                          onChange={(e) => setEditingShipment({ ...editingShipment, portOfDischarge: e.target.value })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg outline-none text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Final Destination</label>
                        <input 
                          type="text" 
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
                        <label className="text-xs font-semibold text-slate-700">Airport of Departure</label>
                        <input 
                          type="text" 
                          value={editingShipment.airportOfDeparture || ""}
                          onChange={(e) => setEditingShipment({ ...editingShipment, airportOfDeparture: e.target.value })}
                          className="w-full p-2.5 border border-slate-200 rounded-lg text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-700">Airport of Arrival</label>
                        <input 
                          type="text" 
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

                {/* Status selector (Admin override) */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-750">Status Override / Durum Güncelle</label>
                  <select
                    value={editingShipment.status}
                    onChange={(e) => setEditingShipment({ ...editingShipment, status: e.target.value as ShipmentStatus })}
                    className="w-full p-2.5 border border-slate-250 bg-white rounded-lg text-xs font-bold text-blue-900"
                  >
                    {(editingShipment.freightType === 'sea' 
                      ? ['Booking Confirmed', 'Container Released', 'Loaded on Vessel', 'Vessel Departed', 'In Transit', 'Arrived at Port', 'Customs Clearance', 'Released', 'Out for Delivery', 'Delivered', 'Completed']
                      : editingShipment.freightType === 'air'
                        ? ['Booking Confirmed', 'Cargo Received', 'Security Check Completed', 'Departed Airport', 'In Transit', 'Arrived Airport', 'Customs Clearance', 'Released', 'Out for Delivery', 'Delivered', 'Completed']
                        : ['New', 'Assigned', 'Accepted', 'Loading', 'Loaded', 'In Transit', 'Border Crossing', 'Customs Clearance', 'Arrived', 'Delivered', 'Closed']
                    ).map(st => (
                      <option key={st} value={st}>{st}</option>
                    ))}
                  </select>
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
          <div className="bg-slate-900 rounded-3xl border border-slate-750 shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150">
            
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
                className="p-2 bg-slate-850 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white transition-all cursor-pointer border-0 outline-none"
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
              <div id="printable-statement-element" className="w-full max-w-2xl bg-white border border-slate-350 shadow-xl rounded-2xl overflow-hidden p-6 md:p-8 space-y-6 font-sans relative text-slate-800 prose select-text pre-print-rendered">
                
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
                    <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">E-TIR LOGISTICS & TRANSPORT AGENCY LTD.</p>
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
                      <div><strong>{lang === 'tr' ? 'Statü:' : 'Calculated Status:'}</strong> <span className="font-extrabold text-slate-850 uppercase">{selectedCostStatement.paymentStatus}</span></div>
                    </div>
                  </div>
                </div>

                {/* Shipment metadata block */}
                <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-150 text-[11px] leading-relaxed">
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
                      <span>{lang === 'tr' ? 'Alınan Ödeme (Tahsil):' : 'Amount Received:'}</span>
                      <strong>- {Number(selectedCostStatement.paidAmount).toLocaleString()} <span className="text-[9px] text-emerald-500">{selectedCostStatement.currency}</span></strong>
                    </div>

                    <div className="flex justify-between items-center text-slate-900 pt-2 text-xs font-black">
                      <span>{lang === 'tr' ? 'KALAN DÖKÜM BAKİYESİ:' : 'STATEMENT BALANCE DUE:'}</span>
                      <span className="text-[#f97316] font-mono bg-orange-50 border border-orange-200/55 px-2 py-0.5 rounded text-xs">
                        {Number(selectedCostStatement.remainingBalance).toLocaleString()} <span className="text-[10px] font-bold text-slate-600">{selectedCostStatement.currency}</span>
                      </span>
                    </div>

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
                    <div className="font-mono text-[8px] text-slate-300">E-TIR PLATFORM SECURITY CLEARANCE</div>
                  </div>
                </div>

              </div>

            </div>

            {/* Modal Footer actions */}
            <div className="bg-slate-950 p-5 border-t border-slate-800 flex items-center justify-end gap-3.5 shrink-0">
              <button
                type="button"
                onClick={() => setIsPrintPreviewOpen(false)}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition-all border-0 outline-none cursor-pointer"
              >
                {lang === 'tr' ? 'İptal Et / Geri Dön' : 'Cancel / Close'}
              </button>

              <button
                type="button"
                onClick={() => handleDownloadPDF("printable-statement-element")}
                className="px-6 py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-xs font-black shadow-lg shadow-orange-950/20 flex items-center gap-2 transition-all border-0 outline-none cursor-pointer"
              >
                <Download className="w-4 h-4 text-orange-250 shrink-0" />
                <span>{lang === 'tr' ? 'PDF İndir' : lang === 'ar' ? 'تحميل PDF الكشف' : 'Download PDF'}</span>
              </button>

              <button
                type="button"
                onClick={() => handlePrintStatement("printable-statement-element")}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black shadow-lg shadow-emerald-950/20 flex items-center gap-2 transition-all border-0 outline-none cursor-pointer"
              >
                <Printer className="w-4 h-4 text-emerald-250 shrink-0 animate-pulse" />
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
                    <MessageSquare className="w-4 h-4 text-blue-400" />
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
                      onSelectShipmentChat(shipment);
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

    </div>
  );
}
