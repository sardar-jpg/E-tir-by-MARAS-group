import "dotenv/config";
import tracer from "dd-trace";

if (process.env.DD_API_KEY) {
  try {
    tracer.init({
      logInjection: true,
      env: process.env.NODE_ENV || "development",
      service: "etir-by-maras-backend"
    });
    console.log("Datadog active monitoring initialized successfully on server backend.");
  } catch (error) {
    console.error("Error during Datadog tracing initialization:", error);
  }
}

import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { initializeApp } from "firebase/app";
import { 
  getFirestore, 
  initializeFirestore,
  collection as rawCollection, 
  doc as rawDoc, 
  getDocs as rawGetDocs, 
  getDoc as rawGetDoc, 
  setDoc as rawSetDoc, 
  updateDoc as rawUpdateDoc, 
  deleteDoc as rawDeleteDoc, 
  addDoc as rawAddDoc, 
  query, 
  where, 
  orderBy, 
  limit
} from "firebase/firestore";

export let useMemoryFallback = false;

// Custom safe wrappers for collection and doc to prevent crash if db is null or offline
function collection(dbInstance: any, pathName: string, ...pathSegments: string[]): any {
  if (useMemoryFallback || !dbInstance) {
    return { path: pathName + (pathSegments.length ? "/" + pathSegments.join("/") : ""), isCollection: true };
  }
  try {
    return rawCollection(dbInstance, pathName, ...pathSegments);
  } catch (err) {
    console.warn("Firestore collection wrapper caught error. Switching to Memory Fallback:", err);
    useMemoryFallback = true;
    return { path: pathName + (pathSegments.length ? "/" + pathSegments.join("/") : ""), isCollection: true };
  }
}

function doc(dbInstance: any, pathName: string, ...pathSegments: string[]): any {
  if (useMemoryFallback || !dbInstance) {
    return { path: pathName + (pathSegments.length ? "/" + pathSegments.join("/") : ""), isDoc: true };
  }
  try {
    return rawDoc(dbInstance, pathName, ...pathSegments);
  } catch (err) {
    console.warn("Firestore doc wrapper caught error. Switching to Memory Fallback:", err);
    useMemoryFallback = true;
    return { path: pathName + (pathSegments.length ? "/" + pathSegments.join("/") : ""), isDoc: true };
  }
}
// Global wrappers to catch permission errors and raise structured errors
export type OperationType = 'create' | 'update' | 'delete' | 'list' | 'get' | 'write';

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {},
    operationType,
    path
  };
  const errString = JSON.stringify(errInfo);
  console.error("Firestore Error: ", errString);
  throw new Error(errString);
}


let memoryStore: {
  drivers: Driver[];
  shipments: Shipment[];
  chatMessages: ChatMessage[];
  notifications: AppNotification[];
  activityLogs: ActivityLog[];
  clients: Client[];
  vendors: Vendor[];
  costStatements: CostStatement[];
  test: any[];
} | null = null;

function getMemoryStore() {
  if (!memoryStore) {
    memoryStore = {
      drivers: [...(initialDrivers || [])],
      shipments: [...(initialShipments || [])],
      chatMessages: [...(initialChatMessages || [])],
      notifications: [...(initialNotifications || [])],
      activityLogs: [...(initialActivityLogs || [])],
      clients: [...(initialClients || [])],
      vendors: [...(initialVendors || [])],
      costStatements: [],
      test: [{ id: "connection", status: "ok" }]
    };
  }
  return memoryStore;
}

function parseFirebasePath(ref: any) {
  const path = ref?.path || "";
  const parts = path.split("/").filter(Boolean);
  return {
    collection: parts[0] || "",
    id: parts[1] || "",
    isDoc: parts.length > 1
  };
}

function handleGetDocsMemory(queryRef: any) {
  const { collection: colName } = parseFirebasePath(queryRef);
  const mStore = getMemoryStore();
  const items = (mStore[colName as keyof typeof mStore] as any[]) || [];
  return {
    empty: items.length === 0,
    size: items.length,
    docs: items.map(item => ({
      id: item.id || "",
      ref: { path: `${colName}/${item.id}`, id: item.id },
      data: () => item
    }))
  };
}

function handleGetDocMemory(docRef: any) {
  const { collection: colName, id } = parseFirebasePath(docRef);
  const mStore = getMemoryStore();
  const items = (mStore[colName as keyof typeof mStore] as any[]) || [];
  const item = items.find(i => i.id === id);
  return {
    exists: () => !!item,
    data: () => item,
    id,
    ref: docRef
  };
}

function handleSetDocMemory(docRef: any, data: any) {
  const { collection: colName, id } = parseFirebasePath(docRef);
  const mStore = getMemoryStore();
  const items = mStore[colName as keyof typeof mStore] as any[];
  if (items) {
    const idx = items.findIndex(i => i.id === id);
    if (idx > -1) {
      items[idx] = { ...items[idx], ...data };
    } else {
      items.push({ id, ...data });
    }
  }
}

function handleUpdateDocMemory(docRef: any, data: any) {
  const { collection: colName, id } = parseFirebasePath(docRef);
  const mStore = getMemoryStore();
  const items = mStore[colName as keyof typeof mStore] as any[];
  if (items) {
    const idx = items.findIndex(i => i.id === id);
    if (idx > -1) {
      items[idx] = { ...items[idx], ...data };
    }
  }
}

function handleDeleteDocMemory(docRef: any) {
  const { collection: colName, id } = parseFirebasePath(docRef);
  const mStore = getMemoryStore();
  const items = mStore[colName as keyof typeof mStore] as any[];
  if (items) {
    const idx = items.findIndex(i => i.id === id);
    if (idx > -1) {
      items.splice(idx, 1);
    }
  }
}

function handleAddDocMemory(colRef: any, data: any) {
  const { collection: colName } = parseFirebasePath(colRef);
  const docId = `doc-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const mStore = getMemoryStore();
  const items = mStore[colName as keyof typeof mStore] as any[];
  const newItem = { id: docId, ...data };
  if (items) {
    items.push(newItem);
  }
  return {
    id: docId,
    path: `${colName}/${docId}`,
    getDoc: () => ({
      exists: () => true,
      data: () => newItem
    })
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutErrorMsg: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(timeoutErrorMsg));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

async function getDocs(queryRef: any) {
  if (useMemoryFallback) {
    return handleGetDocsMemory(queryRef);
  }
  try {
    return await withTimeout(rawGetDocs(queryRef), 5000, "Firestore getDocs query timed out");
  } catch (error) {
    console.warn("Firestore getDocs failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    return handleGetDocsMemory(queryRef);
  }
}

async function getDoc(docRef: any) {
  if (useMemoryFallback) {
    return handleGetDocMemory(docRef);
  }
  try {
    return await withTimeout(rawGetDoc(docRef), 5000, "Firestore getDoc query timed out");
  } catch (error) {
    console.warn("Firestore getDoc failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    return handleGetDocMemory(docRef);
  }
}

function cleanUndefined(obj: any): any {
  if (obj === undefined) {
    return null;
  }
  if (obj === null) {
    return null;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => cleanUndefined(item));
  }
  if (typeof obj === 'object') {
    // If it is a native/Firestore class instance, do not clean its keys as it might break it
    if (obj.constructor && obj.constructor.name !== 'Object' && obj.constructor.name !== 'Array') {
      return obj;
    }
    const cleaned: any = {};
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val !== undefined && val !== null) {
        cleaned[key] = cleanUndefined(val);
      } else if (val === null) {
        cleaned[key] = null;
      }
    }
    return cleaned;
  }
  return obj;
}

async function setDoc(docRef: any, data: any, options?: any) {
  const cleanedData = cleanUndefined(data);
  if (useMemoryFallback) {
    return handleSetDocMemory(docRef, cleanedData);
  }
  try {
    return await withTimeout(rawSetDoc(docRef, cleanedData, options), 5000, "Firestore setDoc timed out");
  } catch (error) {
    console.warn("Firestore setDoc failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    return handleSetDocMemory(docRef, cleanedData);
  }
}

async function updateDoc(docRef: any, data: any) {
  const cleanedData = cleanUndefined(data);
  if (useMemoryFallback) {
    return handleUpdateDocMemory(docRef, cleanedData);
  }
  try {
    return await withTimeout(rawUpdateDoc(docRef, cleanedData), 5000, "Firestore updateDoc timed out");
  } catch (error) {
    console.warn("Firestore updateDoc failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    return handleUpdateDocMemory(docRef, cleanedData);
  }
}

async function deleteDoc(docRef: any) {
  if (useMemoryFallback) {
    return handleDeleteDocMemory(docRef);
  }
  try {
    return await withTimeout(rawDeleteDoc(docRef), 5000, "Firestore deleteDoc timed out");
  } catch (error) {
    console.warn("Firestore deleteDoc failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    return handleDeleteDocMemory(docRef);
  }
}

async function addDoc(colRef: any, data: any) {
  const cleanedData = cleanUndefined(data);
  if (useMemoryFallback) {
    return handleAddDocMemory(colRef, cleanedData);
  }
  try {
    return await withTimeout(rawAddDoc(colRef, cleanedData), 5000, "Firestore addDoc timed out");
  } catch (error) {
    console.warn("Firestore addDoc failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    return handleAddDocMemory(colRef, cleanedData);
  }
}
import { 
  Shipment, 
  Driver, 
  ChatMessage, 
  ActivityLog, 
  AppNotification, 
  ShipmentStatus, 
  Currency,
  DocumentCategory,
  LocationUpdate,
  Client,
  Vendor,
  CostItem,
  CostStatement
} from "./src/types";

// Initialize Firebase
const configPath = path.join(process.cwd(), "firebase-applet-config.json");
let firebaseConfig: any = null;
let firebaseApp: any = null;
export let db: any = null;
let initialId = "(default)";

try {
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } else if (process.env.FIREBASE_CONFIG) {
    firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
  }
  
  if (firebaseConfig) {
    firebaseApp = initializeApp(firebaseConfig);
    const customId = firebaseConfig.firestoreDatabaseId;
    initialId = customId && customId !== "(default)" ? customId : "(default)";
    if (customId && customId !== "(default)") {
      db = initializeFirestore(firebaseApp, { experimentalForceLongPolling: true }, customId);
    } else {
      db = initializeFirestore(firebaseApp, { experimentalForceLongPolling: true });
    }
  } else {
    console.warn("No Firebase configuration file or environment variable was found. Running using Robust Memory Fallback.");
    useMemoryFallback = true;
  }
} catch (err: any) {
  console.warn("Firebase initialization failed, utilizing default Memory Fallback. Error:", err instanceof Error ? err.message : String(err));
  useMemoryFallback = true;
}

// Test Firestore Connection
async function testConnection() {
  if (!db) {
    useMemoryFallback = true;
    return;
  }
  try {
    await withTimeout(
      rawGetDoc(rawDoc(db, "test", "connection")),
      3500,
      "Firestore connection test timed out"
    );
    console.log("Successfully connected to Firestore Database (" + initialId + ").");
    useMemoryFallback = false;
  } catch (error: any) {
    console.warn("Firestore test connection error for database (" + initialId + "). Active Robust Memory Fallback. Error:", error instanceof Error ? error.message : String(error));
    useMemoryFallback = true;
  }
}

// Initial seed datasets (in case Firestore is empty)
const initialClients: Client[] = [
  {
    id: "client-1",
    companyName: "Al-Bahi General Trading Ltd.",
    contactName: "Bahaa Al-Deen",
    phone: "+964 780 111 2233",
    email: "baha@al-bahi-trading.com",
    address: "Karrada, Baghdad, Iraq",
    notes: "Regular importer of high-end appliances and consumer electronics. Strict delivery SLAs.",
    username: "bahi",
    password: "client123",
    createdAt: "2026-05-01T10:00:00Z"
  },
  {
    id: "client-2",
    companyName: "Uruk Industrial Spares Group",
    contactName: "Sinan Ibrahim",
    phone: "+49 176 999 888",
    email: "s.ibrahim@uruk-spares.de",
    address: "Frankfurt, Germany",
    notes: "German-Iraqi industrial supply partner. Ships specialized machinery parts.",
    username: "uruk",
    password: "client123",
    createdAt: "2026-05-15T14:30:00Z"
  },
  {
    id: "client-3",
    companyName: "Karwan Foods & Cold Chain",
    contactName: "Nibras Al-Yasiri",
    phone: "+964 770 555 4444",
    email: "nibras@karwan-foods.iq",
    address: "Basra, Iraq",
    notes: "Requires reefer refrigerated transport for dairy, meat, and frozen confectionery products.",
    username: "karwan",
    password: "client123",
    createdAt: "2026-05-20T08:15:00Z"
  }
];

const initialVendors: Vendor[] = [
  {
    id: "vendor-1",
    companyName: "Erbil Gate Customs Clearance",
    contactName: "Firas Kurdish",
    phone: "+964 750 222 3456",
    email: "firas@erbil-gate-customs.com",
    address: "Ibrahim Khalil Border Crossing, Iraq",
    serviceType: "Customs Clearance",
    notes: "Primary customs broker at the Turkish-Iraqi border crossing. Highly reliable.",
    createdAt: "2026-05-01T11:00:00Z"
  },
  {
    id: "vendor-2",
    companyName: "Al-Mesul Port Services",
    contactName: "Mustafa Al-Meshhadani",
    phone: "+964 770 444 8888",
    email: "ops@almesul-port.iq",
    address: "Umm Qasr Port, Terminal 2, Basra, Iraq",
    serviceType: "Port Services",
    notes: "Handles container unloading, custom inspections, and terminal release at Umm Qasr.",
    createdAt: "2026-05-10T09:00:00Z"
  },
  {
    id: "vendor-3",
    companyName: "Mersin Ocean Shipping Agency",
    contactName: "Cem Karaca",
    phone: "+90 324 233 4455",
    email: "booking@mersin-ocean.com.tr",
    address: "Mersin Port District, Mersin, Turkey",
    serviceType: "Shipping Line",
    notes: "Coordinates sea freight bookings and container releases with Mediterranean carriers.",
    createdAt: "2026-05-12T14:00:00Z"
  },
  {
    id: "vendor-4",
    companyName: "Zahko Transport & Fuel Station",
    contactName: "Saman Ahmed",
    phone: "+964 750 999 1122",
    email: "saman.ahmed@zahko-fuel.iq",
    address: "Zakho Highway, Dohuk Governorate, Iraq",
    serviceType: "Transit & Fuel",
    notes: "Fleet refueling partner. Provides drivers with bulk transit tickets and diesel top-ups.",
    createdAt: "2026-05-18T10:30:00Z"
  }
];

const initialDrivers: Driver[] = [
  {
    id: "driver-1",
    name: "Murat Yılmaz",
    username: "murat_yilmaz",
    password: "123456",
    truckNumber: "34-MAR-1903",
    phone: "+90 532 111 2233",
    activeShipmentsCount: 1,
    completedShipmentsCount: 12,
    truckType: "curtainsider"
  },
  {
    id: "driver-2",
    name: "Ahmed Al-Fadhli",
    username: "ahmed_alfadhli",
    password: "123456",
    truckNumber: "BG-98745-IQ",
    phone: "+964 770 123 4567",
    activeShipmentsCount: 1,
    completedShipmentsCount: 28,
    truckType: "reefer"
  },
  {
    id: "driver-3",
    name: "Kamal Al-Sabah",
    username: "kamal_sabah",
    password: "123456",
    truckNumber: "BG-44321-IQ",
    phone: "+964 780 987 6543",
    activeShipmentsCount: 0,
    completedShipmentsCount: 5,
    truckType: "flatbed"
  },
  {
    id: "driver-4",
    name: "George Haddad",
    username: "george_haddad",
    password: "123456",
    truckNumber: "LEB-45210",
    phone: "+961 3 124 567",
    activeShipmentsCount: 1,
    completedShipmentsCount: 19,
    truckType: "lowboy"
  }
];

const initialShipments: Shipment[] = [
  {
    id: "shipment-1001",
    shipmentNumber: "MAR-2026-1001",
    companyName: "Al-Bahi General Trading Ltd.",
    loadingCountry: "Turkey",
    loadingCity: "Istanbul",
    loadingAddress: "Hadımköy Logistics Center, Warehouse D, Block 3",
    loadingContactNumber: "+90 212 555 4321",
    deliveryCountry: "Iraq",
    deliveryCity: "Baghdad",
    deliveryAddress: "Shorja Commercial Block, Al-Rasheed St, Warehouse 12",
    deliveryContactNumber: "+964 770 999 8877",
    cargoDescription: "Commercial textile goods, high-grade cotton fabrics, and pre-packaged garments.",
    cargoWeight: 14500,
    truckNumber: "34-MAR-1903",
    assignedDriverId: "driver-1",
    assignedDriverName: "Murat Yılmaz",
    agreedAmount: 3200,
    currency: "USD",
    internalNotes: "Agreed on quick delivery. Ensure custom documents at Ibrahim Khalil border are processed under expedited clearance scheme.",
    status: "In Transit",
    documents: [
      {
        id: "doc-1",
        name: "CMR_MAR-2026-1001.pdf",
        url: "#",
        category: "cmr",
        uploadedBy: "Admin",
        uploadedAt: "2026-05-30T09:12:00Z",
        isSharedExternally: true
      },
      {
        id: "doc-2",
        name: "Invoice_Al-Bahi-9912.pdf",
        url: "#",
        category: "invoice",
        uploadedBy: "Admin",
        uploadedAt: "2026-05-30T09:13:00Z",
        isSharedExternally: false
      }
    ],
    timeline: [
      {
        timestamp: "2026-05-30T09:15:00Z",
        status: "New",
        labelEn: "Shipment Created",
        labelTr: "Sevkiyat Oluşturuldu",
        labelAr: "تم إنشاء الشحنة",
        detailsEn: "Shipment record initialized in MARAS logistics database.",
        detailsTr: "Sevkiyat kaydı MARAS lojistik veritabanında başlatıldı.",
        detailsAr: "تم بدء سجل الشحنة في قاعدة بيانات ماراس للخدمات اللوجستية."
      },
      {
        timestamp: "2026-05-30T10:00:00Z",
        status: "Assigned",
        labelEn: "Driver Assigned",
        labelTr: "Sürücü Atandı",
        labelAr: "تم تعيين السائق",
        detailsEn: "Shipment assigned to Murat Yılmaz and truck 34-MAR-1903.",
        detailsTr: "Sevkiyat Murat Yılmaz ve 34-MAR-1903 plakalı tırına atandı.",
        detailsAr: "تم تعيين الشحنة إلى مراد يلماز والشاحنة 34-MAR-1903."
      },
      {
        timestamp: "2026-05-30T10:45:00Z",
        status: "Accepted",
        labelEn: "Shipment Accepted",
        labelTr: "Sevkiyat Kabul Edildi",
        labelAr: "تم قبول الشحنة",
        detailsEn: "Driver accepted transportation order and agreed drivers' fee of 3,200 USD.",
        detailsTr: "Sürücü taşıma talimatını ve 3.200 USD sürücü ücretini kabul etti.",
        detailsAr: "قبل السائق أمر النقل ووافق على أتعاب السائق البالغة 3,200 دولار."
      },
      {
        timestamp: "2026-05-31T08:00:00Z",
        status: "Loading",
        labelEn: "Loading in Progress",
        labelTr: "Yükleme Yapılıyor",
        labelAr: "جاري التحميل",
        detailsEn: "Truck arrived at Istanbul Loading Warehouse D.",
        detailsTr: "Tır İstanbul Yükleme Deposu D'ye ulaştı.",
        detailsAr: "وصلت الشاحنة إلى مستودع التحميل في اسطنبول د."
      },
      {
        timestamp: "2026-05-31T11:30:00Z",
        status: "Loaded",
        labelEn: "Cargo Loaded & Secured",
        labelTr: "Yükleme Tamamlandı",
        labelAr: "تم التحميل والتأمين",
        detailsEn: "14.5 Tons of textile fabrics successfully secured inside truck bed.",
        detailsTr: "14.5 Ton tekstil kumaşı tır kasasına başarıyla sabitlendi.",
        detailsAr: "تم تأمين 14.5 طن من الأقمشة المنسوجة بنجاح داخل الشاحنة."
      },
      {
        timestamp: "2026-05-31T14:00:00Z",
        status: "In Transit",
        labelEn: "Departed Loading Point",
        labelTr: "Yükleme Noktasından Çıkış",
        labelAr: "غادرت نقطة التحميل",
        detailsEn: "The truck departed Istanbul. Route: Istanbul -> Ankara -> Silopi (Border).",
        detailsTr: "Tır İstanbul'dan hareket etti. Güzergah: İstanbul -> Ankara -> Silopi (Sınır).",
        detailsAr: "غادرت الشاحنة اسطنبول. المسار: اسطنبول -> أنقرة -> سيلوبي (الحدود)."
      }
    ],
    createdAt: "2026-05-30T09:15:00Z",
    updatedAt: "2026-05-31T14:00:00Z",
    isLinkShared: true,
    shareToken: "token-1001",
    shareIncludeDocuments: true,
    shareIncludePhotos: true
  },
  {
    id: "shipment-1002",
    shipmentNumber: "MAR-2026-1002",
    companyName: "Uruk Industrial Spares Group",
    loadingCountry: "Turkey",
    loadingCity: "Bursa",
    loadingAddress: "Bursa Organized Industrial Zone, St 14, Alley 5",
    loadingContactNumber: "+90 224 888 7766",
    deliveryCountry: "Iraq",
    deliveryCity: "Basra",
    deliveryAddress: "Basra Port Free Zone, Sector C, Plot 22",
    deliveryContactNumber: "+964 780 112 2334",
    cargoDescription: "Heavy machinery steel components, spare gears, and hydraulic pumps.",
    cargoWeight: 22800,
    truckNumber: "BG-98745-IQ",
    assignedDriverId: "driver-2",
    assignedDriverName: "Ahmed Al-Fadhli",
    agreedAmount: 4500,
    currency: "USD",
    internalNotes: "Heavy load, requires special route permissions and careful braking checks.",
    status: "Customs Clearance",
    documents: [
      {
        id: "doc-3",
        name: "PackingList_Heavy_Gears.pdf",
        url: "#",
        category: "packing_list",
        uploadedBy: "Admin",
        uploadedAt: "2026-05-28T08:15:00Z",
        isSharedExternally: true
      }
    ],
    timeline: [
      {
        timestamp: "2026-05-28T08:15:00Z",
        status: "New",
        labelEn: "Shipment Created",
        labelTr: "Sevkiyat Oluşturuldu",
        labelAr: "تم إنشاء الشحنة",
        detailsEn: "Urgent industrial gears shipment registered.",
        detailsTr: "Acil endüstriyel dişli sevkiyatı kaydedildi.",
        detailsAr: "شحنة التروس الصناعية العاجلة تم تسجيلها."
      },
      {
        timestamp: "2026-05-28T09:00:00Z",
        status: "Assigned",
        labelEn: "Driver Assigned",
        labelTr: "Sürücü Atandı",
        labelAr: "تم تعيين السائق",
        detailsEn: "Assigned to Ahmed Al-Fadhli.",
        detailsTr: "Ahmed Al-Fadhli atandı.",
        detailsAr: "تم التعيين لأحمد الفضلي."
      },
      {
        timestamp: "2026-05-28T10:10:00Z",
        status: "Accepted",
        labelEn: "Shipment Order Accepted",
        labelTr: "Sipariş Kabul Edildi",
        labelAr: "قبول أمر الشحنة",
        detailsEn: "Driver accepted Basra route under special weight terms.",
        detailsTr: "Sürücü özel ağırlık koşullarında Basra güzergahını kabul etti.",
        detailsAr: "قبل السائق مسار البصرة بموجب شروط الوزن الخاصة."
      },
      {
        timestamp: "2026-05-29T13:00:00Z",
        status: "Loaded",
        labelEn: "Heavy Cargo Loaded",
        labelTr: "Ağır Yük Sürüldü/Yüklendi",
        labelAr: "تحميل الحمولة الثقيلة",
        detailsEn: "Heavily reinforced chassis loaded at Bursa.",
        detailsTr: "Bursa'da güçlendirilmiş şasi yüklendi.",
        detailsAr: "تم تحميل هيكل الشاحنة المعزز في بورصة."
      },
      {
        timestamp: "2026-05-30T17:00:00Z",
        status: "Border Crossing",
        labelEn: "Ibrahim Khalil Gate",
        labelTr: "Habur Sınır Kapısı",
        labelAr: "منفذ إبراهيم الخليل",
        detailsEn: "Arrived at Turkish/Iraqi Habur Border. Cargo inspected.",
        detailsTr: "Habur Sınır Kapısına ulaşıldı. Yük kontrolü yapıldı.",
        detailsAr: "الوصول إلى حدود الخابور التركية العراقية. تم فحص الشحنة."
      },
      {
        timestamp: "2026-05-31T10:00:00Z",
        status: "Customs Clearance",
        labelEn: "Customs Inspection In Iraq",
        labelTr: "Gümrük İşlemleri Sürüyor",
        labelAr: "التخليص الجمركي",
        detailsEn: "Customs clearance paperwork initiated at Zakho customs plaza.",
        detailsTr: "Zaho gümrük sahasında tescil işlemleri başlatıldı.",
        detailsAr: "بدء معاملات التخليص الجمركي في ساحة جمارك زاخو."
      }
    ],
    createdAt: "2026-05-28T08:15:00Z",
    updatedAt: "2026-05-31T10:00:00Z",
    isLinkShared: true,
    shareToken: "token-1002",
    shareIncludeDocuments: true,
    shareIncludePhotos: false
  },
  {
    id: "shipment-1003",
    shipmentNumber: "MAR-2026-1003",
    companyName: "Karwan Foods & Cold Chain",
    loadingCountry: "Turkey",
    loadingCity: "Gaziantep",
    loadingAddress: "Gaziantep Gıda Toptancıları Sitesi, No 77",
    loadingContactNumber: "+90 342 999 1212",
    deliveryCountry: "Iraq",
    deliveryCity: "Erbil",
    deliveryAddress: "Erbil Southern Wholesalers Central, Block B-3",
    deliveryContactNumber: "+964 750 444 5566",
    cargoDescription: "Assorted confectioneries, sunflower oils, and dried nuts.",
    cargoWeight: 19000,
    truckNumber: "LEB-45210",
    assignedDriverId: "driver-4",
    assignedDriverName: "George Haddad",
    agreedAmount: 2800,
    currency: "TRY",
    internalNotes: "Needs temperature tracking, even though products are shelf-stable, keep ventilated.",
    status: "Accepted",
    documents: [],
    timeline: [
      {
        timestamp: "2026-05-31T09:00:00Z",
        status: "New",
        labelEn: "Shipment Created",
        labelTr: "Sevkiyat Oluşturuldu",
        labelAr: "تم إنشاء الشحنة",
        detailsEn: "Food shipment created.",
        detailsTr: "Gıda ürünü sevkiyatı oluşturuldu.",
        detailsAr: "تم إنشاء شحنة المواد الغذائية."
      },
      {
        timestamp: "2026-05-31T14:30:00Z",
        status: "Assigned",
        labelEn: "Assigned to Truck",
        labelTr: "Araca Atandı",
        labelAr: "تم التعيين للشاحنة",
        detailsEn: "Assigned to George Haddad and truck LEB-45210.",
        detailsTr: "George Haddad ve LEB-45210 numaralı tırına atandı.",
        detailsAr: "تم التعيين لجورج حداد والشاحنة LEB-45210."
      },
      {
        timestamp: "2026-05-31T16:00:00Z",
        status: "Accepted",
        labelEn: "Order Accepted by Driver",
        labelTr: "Sürücü Siparişi Kabul Etti",
        labelAr: "تم قبول الطلب من السائق",
        detailsEn: "George accepted Erbil cold storage ventilated shipment.",
        detailsTr: "George havalandırmalı Erbil sevkiyatını kabul etti.",
        detailsAr: "قبل جورج شحنة أربيل المهواة."
      }
    ],
    createdAt: "2026-05-31T09:00:00Z",
    updatedAt: "2026-05-31T16:00:00Z",
    isLinkShared: false,
    shareToken: "token-1003",
    shareIncludeDocuments: false,
    shareIncludePhotos: false
  }
];

const initialChatMessages: ChatMessage[] = [
  {
    id: "msg-1",
    shipmentId: "shipment-1001",
    sender: "admin",
    senderName: "MARAS Operations Office",
    type: "text",
    text: "Hello Murat, we have loaded your CMR document. Please make sure to download it and keep a physical copy on hand at the Habur Border crossing.",
    timestamp: "2026-05-30T10:05:00Z"
  },
  {
    id: "msg-2",
    shipmentId: "shipment-1001",
    sender: "driver",
    senderName: "Murat Yılmaz",
    type: "text",
    text: "Received! Thank you. I have already printed the CMR copy. The loading was done quickly, cargo looks stable.",
    timestamp: "2026-05-31T11:45:00Z"
  },
  {
    id: "msg-3",
    shipmentId: "shipment-1001",
    sender: "driver",
    senderName: "Murat Yılmaz",
    type: "text",
    text: "I am currently passing Bolu and maintaining speed. The road conditions are good.",
    timestamp: "2026-05-31T15:30:00Z"
  },
  {
    id: "msg-4",
    shipmentId: "shipment-1002",
    sender: "admin",
    senderName: "MARAS Operations Office",
    type: "text",
    text: "Ahmed, the custom broker in Zakho tells us they need the hard copy packing list. Do you have it with you?",
    timestamp: "2026-05-31T10:15:00Z"
  },
  {
    id: "msg-5",
    shipmentId: "shipment-1002",
    sender: "driver",
    senderName: "Ahmed Al-Fadhli",
    type: "text",
    text: "Yes, I have the original sealed packing list in my cabin. I am handing it over to the clearance officer now.",
    timestamp: "2026-05-31T10:22:00Z"
  }
];

const initialNotifications: AppNotification[] = [
  {
    id: "notif-1",
    shipmentId: "shipment-1001",
    shipmentNumber: "MAR-2026-1001",
    titleEn: "Status: In Transit",
    titleTr: "Durum: Yolda",
    titleAr: "الحالة: في الطريق",
    messageEn: "Shipment MAR-2026-1001 status changed to In Transit.",
    messageTr: "MAR-2026-1001 numaralı sevkiyat durumu Yolda olarak güncellendi.",
    messageAr: "تم تغيير حالة الشحنة MAR-2026-1001 إلى في الطريق.",
    type: "status_update",
    timestamp: "2026-05-31T14:00:00Z",
    read: false
  },
  {
    id: "notif-2",
    shipmentId: "shipment-1002",
    shipmentNumber: "MAR-2026-1002",
    titleEn: "Status: Customs Clearance",
    titleTr: "Durum: Gümrük İşlemleri",
    titleAr: "الحالة: التخليص الجمركي",
    messageEn: "Ahmed updated status for heavy industrial components.",
    messageTr: "Ahmet ağır endüstriyel aksamlar için durumu güncelledi.",
    messageAr: "قام أحمد بتحديث الحالة لقطع الغيار الصناعية الثقيلة.",
    type: "status_update",
    timestamp: "2026-05-31T10:00:00Z",
    read: false
  },
  {
    id: "notif-3",
    shipmentId: "shipment-1003",
    shipmentNumber: "MAR-2026-1003",
    titleEn: "Shipment Accepted",
    titleTr: "Sevkiyat Kabul Edildi",
    titleAr: "تم قبول الشحنة",
    messageEn: "George Haddad accepted shipment food order to Erbil.",
    messageTr: "George Haddad, Erbil gıda sevkiyatını kabul etti.",
    messageAr: "قبل جورج حداد شحنة المواد الغذائية إلى أربيل.",
    type: "acceptance",
    timestamp: "2026-05-31T16:00:00Z",
    read: true
  }
];

const initialActivityLogs: ActivityLog[] = [
  {
    id: "log-1",
    shipmentId: "shipment-1001",
    shipmentNumber: "MAR-2026-1001",
    actionEn: "Shipment created for Al-Bahi Trading",
    actionTr: "Al-Bahi Trading için sevkiyat oluşturuldu",
    actionAr: "تم إنشاء شحنة لشركة الباهي للتجارة",
    actor: "Operations Team (Admin)",
    timestamp: "2026-05-30T09:15:00Z"
  },
  {
    id: "log-2",
    shipmentId: "shipment-1001",
    shipmentNumber: "MAR-2026-1001",
    actionEn: "Assigned driver Murat Yılmaz",
    actionTr: "Yolcu/Sürücü Murat Yılmaz atandı",
    actionAr: "تم تعيين السائق مراد يلماز",
    actor: "Operations Team (Admin)",
    timestamp: "2026-05-30T10:00:00Z"
  },
  {
    id: "log-3",
    shipmentId: "shipment-1001",
    shipmentNumber: "MAR-2026-1001",
    actionEn: "Shipment status updated to In Transit",
    actionTr: "Sevkiyat durumu Yolda olarak güncellendi",
    actionAr: "تم تحديث حالة الشحنة إلى في الطريق",
    actor: "Murat Yılmaz (Driver)",
    timestamp: "2026-05-31T14:00:00Z"
  },
  {
    id: "log-4",
    shipmentId: "shipment-1002",
    shipmentNumber: "MAR-2026-1002",
    actionEn: "Document PackingList_Heavy_Gears.pdf uploaded",
    actionTr: "PackingList_Heavy_Gears.pdf belgesi yüklendi",
    actionAr: "تم تحميل مستند قائمة التعبئة",
    actor: "Operations Team (Admin)",
    timestamp: "2026-05-28T08:15:00Z"
  }
];

// Seed collection items helper
async function seedDatabaseIfEmpty() {
  if (!db || useMemoryFallback) {
    console.warn("Firestore db is null or memory fallback is active. Skipping live Firestore seeding.");
    return;
  }
  console.log("Validating and seeding Firestore database if empty using raw methods...");

  // 1. Seed drivers
  try {
    const driverCol = rawCollection(db, "drivers");
    const driverSnap = await rawGetDocs(driverCol);
    if (driverSnap.empty) {
      console.log("Seeding drivers into Firestore...");
      for (const d of initialDrivers) {
        const cleaned = cleanUndefined(d);
        try {
          await rawSetDoc(rawDoc(db, "drivers", d.id), cleaned);
          console.log(`Successfully seeded driver: ${d.id}`);
        } catch (subErr) {
          console.error(`Failed to write driver ${d.id}:`, subErr);
        }
      }
    } else {
      console.log("Drivers collection already seeded. Ensuring usernames and passwords are set...");
      for (const d of initialDrivers) {
        try {
          await rawSetDoc(rawDoc(db, "drivers", d.id), {
            username: d.username,
            password: d.password,
            phone: d.phone,
            name: d.name,
            truckNumber: d.truckNumber,
            truckType: d.truckType
          }, { merge: true });
          console.log(`Successfully merged credentials for driver: ${d.id} (${d.username})`);
        } catch (subErr) {
          console.error(`Failed to merge credentials for driver ${d.id}:`, subErr);
        }
      }
    }
  } catch (err) {
    console.error("Error reading/seeding drivers: ", err);
  }

  // 2. Seed shipments
  try {
    const shipmentCol = rawCollection(db, "shipments");
    const shipmentSnap = await rawGetDocs(shipmentCol);
    if (shipmentSnap.empty) {
      console.log("Seeding shipments into Firestore...");
      for (const s of initialShipments) {
        const cleaned = cleanUndefined(s);
        try {
          await rawSetDoc(rawDoc(db, "shipments", s.id), cleaned);
          console.log(`Successfully seeded shipment: ${s.id}`);
        } catch (subErr) {
          console.error(`Failed to write shipment ${s.id}:`, subErr);
        }
      }
    } else {
      console.log("Shipments collection already seeded.");
    }
  } catch (err) {
    console.error("Error reading/seeding shipments: ", err);
  }

  // 3. Seed chatMessages
  try {
    const chatCol = rawCollection(db, "chatMessages");
    const chatSnap = await rawGetDocs(chatCol);
    if (chatSnap.empty) {
      console.log("Seeding chat messages into Firestore...");
      for (const c of initialChatMessages) {
        const cleaned = cleanUndefined(c);
        try {
          await rawSetDoc(rawDoc(db, "chatMessages", c.id), cleaned);
          console.log(`Successfully seeded chat message: ${c.id}`);
        } catch (subErr) {
          console.error(`Failed to write chat message ${c.id}:`, subErr);
        }
      }
    } else {
      console.log("ChatMessages collection already seeded.");
    }
  } catch (err) {
    console.error("Error reading/seeding chat messages: ", err);
  }

  // 4. Seed notifications
  try {
    const notifCol = rawCollection(db, "notifications");
    const notifSnap = await rawGetDocs(notifCol);
    if (notifSnap.empty) {
      console.log("Seeding notifications into Firestore...");
      for (const n of initialNotifications) {
        const cleaned = cleanUndefined(n);
        try {
          await rawSetDoc(rawDoc(db, "notifications", n.id), cleaned);
          console.log(`Successfully seeded notification: ${n.id}`);
        } catch (subErr) {
          console.error(`Failed to write notification ${n.id}:`, subErr);
        }
      }
    } else {
      console.log("Notifications collection already seeded.");
    }
  } catch (err) {
    console.error("Error reading/seeding notifications: ", err);
  }

  // 5. Seed activityLogs
  try {
    const logCol = rawCollection(db, "activityLogs");
    const logSnap = await rawGetDocs(logCol);
    if (logSnap.empty) {
      console.log("Seeding activity logs into Firestore...");
      for (const l of initialActivityLogs) {
        const cleaned = cleanUndefined(l);
        try {
          await rawSetDoc(rawDoc(db, "activityLogs", l.id), cleaned);
          console.log(`Successfully seeded activity log: ${l.id}`);
        } catch (subErr) {
          console.error(`Failed to write activity log ${l.id}:`, subErr);
        }
      }
    } else {
      console.log("ActivityLogs collection already seeded.");
    }
  } catch (err) {
    console.error("Error reading/seeding activity logs: ", err);
  }

  // 6. Seed clients
  try {
    const clientsCol = rawCollection(db, "clients");
    const clientsSnap = await rawGetDocs(clientsCol);
    if (clientsSnap.empty) {
      console.log("Seeding clients into Firestore...");
      for (const cl of initialClients) {
        const cleaned = cleanUndefined(cl);
        try {
          await rawSetDoc(rawDoc(db, "clients", cl.id), cleaned);
          console.log(`Successfully seeded client: ${cl.id}`);
        } catch (subErr) {
          console.error(`Failed to write client ${cl.id}:`, subErr);
        }
      }
    } else {
      console.log("Clients collection already seeded. Ensuring usernames and passwords are set...");
      for (const cl of initialClients) {
        try {
          await rawSetDoc(rawDoc(db, "clients", cl.id), {
            username: cl.username,
            password: cl.password,
            email: cl.email,
            companyName: cl.companyName,
            contactName: cl.contactName,
            phone: cl.phone,
            address: cl.address,
            notes: cl.notes,
            createdAt: cl.createdAt
          }, { merge: true });
          console.log(`Successfully merged credentials for client: ${cl.id} (${cl.username})`);
        } catch (subErr) {
          console.error(`Failed to merge credentials for client ${cl.id}:`, subErr);
        }
      }
    }
  } catch (err) {
    console.error("Error reading/seeding clients: ", err);
  }

  // 7. Seed vendors
  try {
    const vendorsCol = rawCollection(db, "vendors");
    const vendorsSnap = await rawGetDocs(vendorsCol);
    if (vendorsSnap.empty) {
      console.log("Seeding vendors into Firestore...");
      for (const v of initialVendors) {
        const cleaned = cleanUndefined(v);
        try {
          await rawSetDoc(rawDoc(db, "vendors", v.id), cleaned);
          console.log(`Successfully seeded vendor: ${v.id}`);
        } catch (subErr) {
          console.error(`Failed to write vendor ${v.id}:`, subErr);
        }
      }
    } else {
      console.log("Vendors collection already seeded.");
    }
  } catch (err) {
    console.error("Error reading/seeding vendors: ", err);
  }

  // 8. Propagate Google Maps API key
  try {
    const mapsKey = process.env.GOOGLE_MAPS_PLATFORM_KEY || "";
    if (mapsKey) {
      console.log("Syncing active Google Maps API key into Firestore config collection...");
      await rawSetDoc(rawDoc(db, "configs", "google_maps"), { key: mapsKey });
      console.log("Successfully seeded Google Maps key config.");
    }
  } catch (err) {
    console.error("Error propagating Google Maps key to Firestore: ", err);
  }

  console.log("Firestore seeding check completed with comprehensive logs.");
}

// Helpers to write to Firestore
async function logActivity(shipmentId: string, shipmentNumber: string, actor: string, actionEn: string, actionTr: string, actionAr: string) {
  const newLog: ActivityLog = {
    id: `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    shipmentId,
    shipmentNumber,
    actionEn,
    actionTr,
    actionAr,
    actor,
    timestamp: new Date().toISOString()
  };
  try {
    await setDoc(doc(db, "activityLogs", newLog.id), newLog);
  } catch (err) {
    console.error("Error writing activity log: ", err);
  }
}

async function pushNotification(
  shipmentId: string, 
  shipmentNumber: string, 
  type: 'assignment' | 'acceptance' | 'rejection' | 'status_update' | 'chat' | 'doc_upload' | 'delivery',
  titleEn: string, titleTr: string, titleAr: string,
  messageEn: string, messageTr: string, messageAr: string
) {
  const newNotif: AppNotification = {
    id: `notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    shipmentId,
    shipmentNumber,
    titleEn,
    titleTr,
    titleAr,
    messageEn,
    messageTr,
    messageAr,
    type,
    timestamp: new Date().toISOString(),
    read: false
  };
  try {
    await setDoc(doc(db, "notifications", newNotif.id), newNotif);
  } catch (err) {
    console.error("Error writing notification: ", err);
  }
}

async function notifyCustomerWatchers(shipment: any, eventType: string, title: string, message: string) {
  if (!shipment.customerEmails || shipment.customerEmails.length === 0) return;
  
  if (!shipment.customerNotificationHistory) {
    shipment.customerNotificationHistory = [];
  }
  
  for (const email of shipment.customerEmails) {
    const alertId = `cnh-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const newAlert = {
      id: alertId,
      timestamp: new Date().toISOString(),
      type: eventType,
      title,
      message,
      email,
      channel: 'email' as const
    };
    shipment.customerNotificationHistory.push(newAlert);
    console.log(`[CUSTOMER NOTICE SENT] Channel: EMAIL, Target: ${email}, Msg: "${message}"`);
  }
}

interface UploadedFileStore {
  filename: string;
  mimeType: string;
  buffer: Buffer;
}
const uploadedFiles = new Map<string, UploadedFileStore>();

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // Use JSON middleware with reasonable limits for inline file mock uploads (base64)
  app.use(express.json({ limit: "20mb" }));

  // Support X-HTTP-Method-Override header for envs where PUT/DELETE/etc are blocked or filtered
  app.use((req, res, next) => {
    const overrideHeader = req.headers["x-http-method-override"];
    if (req.method === "POST" && overrideHeader) {
      req.method = (Array.isArray(overrideHeader) ? overrideHeader[0] : overrideHeader).toUpperCase();
    }
    next();
  });

  // Custom CORS middleware to support external frontends querying this backend
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
    } else {
      res.header("Access-Control-Allow-Origin", "*");
    }
    res.header("Access-Control-Allow-Credentials", "true");
    
    // Dynamically allow requested headers to prevent any CORS failures, while maintaining clean fallbacks
    const reqHeaders = req.headers["access-control-request-headers"];
    if (reqHeaders) {
      res.header("Access-Control-Allow-Headers", reqHeaders);
    } else {
      res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-HTTP-Method-Override");
    }
    
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    
    if (req.method === "OPTIONS") {
      res.header("Access-Control-Max-Age", "86400"); // cache preflight for 24 hours
      return res.status(204).end();
    }
    next();
  });

  // Media uploading endpoints
  app.post("/api/upload", (req, res) => {
    try {
      const base64DataUrl = req.body.base64DataUrl || req.body.file || req.body.base64;
      const filename = req.body.filename;
      if (!base64DataUrl) {
        return res.status(400).json({ error: "Missing base64DataUrl or file data" });
      }

      const match = base64DataUrl.match(/^data:(.*?);base64,(.*)$/);
      if (!match) {
        return res.status(400).json({ error: "Invalid data URL format" });
      }

      const mimeType = match[1];
      const base64Data = match[2];
      const buffer = Buffer.from(base64Data, "base64");
      const fileId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      uploadedFiles.set(fileId, { filename: filename || "upload.bin", mimeType, buffer });
      console.log(`Server-side file upload successful: ${filename} as ID ${fileId}`);
      res.json({ url: `/api/uploads/${fileId}` });
    } catch (err) {
      console.error("Upload handler failed:", err);
      res.status(500).json({ error: "Upload failed" });
    }
  });

  app.get("/api/uploads/:id", (req, res) => {
    const fileId = req.params.id;
    const fileObj = uploadedFiles.get(fileId);
    if (!fileObj) {
      return res.status(404).send("File not found");
    }
    // Set appropriate content type of the uploaded file
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(fileObj.filename)}"`);
    res.setHeader("Content-Type", fileObj.mimeType);
    res.send(fileObj.buffer);
  });

  // API Endpoints

  // 1. Get Shipments (from Firestore)
  app.get("/api/shipments", async (req, res) => {
    try {
      const col = collection(db, "shipments");
      const snapshot = await getDocs(col);
      let list = snapshot.docs.map(doc => doc.data() as Shipment);
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      const driverId = req.query.driverId as string;
      if (driverId) {
        const filtered = list.filter(s => 
          s.assignedDriverId === driverId || 
          (s.additionalDrivers && s.additionalDrivers.some((ad: any) => ad.driverId === driverId))
        );
        return res.json(filtered);
      }
      res.json(list);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch shipments" });
    }
  });

  // 2. Create Shipment (Admin Only - writes to Firestore)
  app.post("/api/shipments", async (req, res) => {
    try {
      const data = req.body;
      
      // Auto generate shipment number (MAR-Year-Count)
      const col = collection(db, "shipments");
      const snapshot = await getDocs(col);
      const count = snapshot.size;
      const year = new Date().getFullYear();
      const shipmentNumber = `MAR-${year}-${1001 + count}`;
      const id = `shipment-${1001 + count}`;
      
      // Load drivers to find assignee
      const driversCol = collection(db, "drivers");
      const driversSnap = await getDocs(driversCol);
      const driversList = driversSnap.docs.map(doc => doc.data() as Driver);
      
      const driver = driversList.find(d => d.id === data.assignedDriverId);
      const assignedDriverName = driver ? driver.name : "Unassigned";

      const initialStatus = data.status || (data.freightType === "sea" || data.freightType === "air" ? "Booking Confirmed" : (data.assignedDriverId ? "Assigned" : "New"));
      const initialTimeline: LocationUpdate = {
        timestamp: new Date().toISOString(),
        status: initialStatus as ShipmentStatus,
        labelEn: data.freightType === "sea" || data.freightType === "air" ? "Booking Confirmed" : "Shipment Initialized",
        labelTr: data.freightType === "sea" || data.freightType === "air" ? "Rezervasyon Onaylandı" : "Sevkiyat Oluşturuldu",
        labelAr: data.freightType === "sea" || data.freightType === "air" ? "تم تأكيد الحجز" : "تم إنشاء الشحنة",
        detailsEn: `Created for customer: ${data.companyName}`,
        detailsTr: `Müşteri için oluşturuldu: ${data.companyName}`,
        detailsAr: `تم إنشاؤها للعميل: ${data.companyName}`
      };

      const newShipment: Shipment = {
        id,
        shipmentNumber,
        companyName: data.companyName || "",
        loadingCountry: data.loadingCountry || "",
        loadingCity: data.loadingCity || "",
        loadingAddress: data.loadingAddress || "",
        loadingContactNumber: data.loadingContactNumber || "",
        deliveryCountry: data.deliveryCountry || "",
        deliveryCity: data.deliveryCity || "",
        deliveryAddress: data.deliveryAddress || "",
        deliveryContactNumber: data.deliveryContactNumber || "",
        cargoDescription: data.cargoDescription || "",
        cargoWeight: Number(data.cargoWeight) || 0,
        truckNumber: driver ? driver.truckNumber : (data.truckNumber || ""),
        assignedDriverId: data.assignedDriverId || "",
        assignedDriverName,
        agreedAmount: Number(data.agreedAmount) || 0,
        currency: (data.currency as Currency) || "USD",
        internalNotes: data.internalNotes || "",
        status: initialStatus as ShipmentStatus,
        documents: [],
        timeline: [initialTimeline],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isLinkShared: true,
        shareToken: `token-${1001 + count}`,
        shareIncludeDocuments: true,
        shareIncludePhotos: true,
        
        // Add Sea & Air properties
        freightType: data.freightType || "land",
        shippingLine: data.shippingLine || "",
        vesselName: data.vesselName || "",
        containerNumber: data.containerNumber || "",
        bookingNumber: data.bookingNumber || "",
        billOfLadingNumber: data.billOfLadingNumber || "",
        portOfLoading: data.portOfLoading || "",
        portOfDischarge: data.portOfDischarge || "",
        finalDestination: data.finalDestination || "",
        etd: data.etd || "",
        eta: data.eta || "",
        numberOfContainers: data.numberOfContainers !== undefined ? Number(data.numberOfContainers) : 0,
        containerType: data.containerType || "",
        airline: data.airline || "",
        flightNumber: data.flightNumber || "",
        airWaybillNumber: data.airWaybillNumber || "",
        airportOfDeparture: data.airportOfDeparture || "",
        airportOfArrival: data.airportOfArrival || "",
        grossWeight: data.grossWeight !== undefined ? Number(data.grossWeight) : 0,
        chargeableWeight: data.chargeableWeight !== undefined ? Number(data.chargeableWeight) : 0,
        numberOfPackages: data.numberOfPackages !== undefined ? Number(data.numberOfPackages) : 0,
        additionalDrivers: data.additionalDrivers || [],
        additionalContainers: data.additionalContainers || [],
        
        // Broker details for land shipments
        destinationBrokerId: data.destinationBrokerId || "",
        destinationBrokerName: data.destinationBrokerName || "",
        destinationBrokerPhone: data.destinationBrokerPhone || "",
        iraqBorderBrokerId: data.iraqBorderBrokerId || "",
        iraqBorderBrokerName: data.iraqBorderBrokerName || "",
        iraqBorderBrokerPhone: data.iraqBorderBrokerPhone || "",
      };

      if (data.assignedDriverId && driver) {
        // update driver stats
        driver.activeShipmentsCount += 1;
        await setDoc(doc(db, "drivers", driver.id), driver);
        
        newShipment.timeline.push({
          timestamp: new Date().toISOString(),
          status: "Assigned",
          labelEn: "Driver Assigned",
          labelTr: "Sürücü Atandı",
          labelAr: "تم تعيين السائق",
          detailsEn: `Assigned to driver ${driver.name} with vehicle ${driver.truckNumber}.`,
          detailsTr: `${driver.name} sürücüsüne ${driver.truckNumber} plakalı araçla atandı.`,
          detailsAr: `تم تعيينه للسائق ${driver.name} ومعه المركبة ${driver.truckNumber}.`
        });

        await pushNotification(
          id,
          shipmentNumber,
          "assignment",
          "New Assigned Shipment",
          "Yeni Atanmış Sevkiyat",
          "شحنة جديدة معينة",
          `You have been assigned shipment ${shipmentNumber}.`,
          `Size ${shipmentNumber} numaralı sevkiyat atandı.`,
          `تم تعيين الشحنة ${shipmentNumber} لك.`
        );
      }

      await setDoc(doc(db, "shipments", id), newShipment);

      await logActivity(
        id,
        shipmentNumber,
        "Admin Office",
        `Created shipment ${shipmentNumber}`,
        `${shipmentNumber} numaralı sevkiyat oluşturuldu`,
        `تم إنشاء الشحنة بنجاح برقم ${shipmentNumber}`
      );

      res.status(201).json(newShipment);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create shipment" });
    }
  });

  // 3. Get Shipment Profile
  app.get("/api/shipments/:id", async (req, res) => {
    try {
      const sDoc = await getDoc(doc(db, "shipments", req.params.id));
      if (!sDoc.exists()) {
        return res.status(404).json({ error: "Shipment not found" });
      }
      res.json(sDoc.data());
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch shipment details" });
    }
  });

  // 3.5. Calculate distance, duration, and estimated arrival time using Google Maps Distance Matrix API
  app.get("/api/shipments/:id/distance-matrix", async (req, res) => {
    try {
      const sRef = doc(db, "shipments", req.params.id);
      const sDoc = await getDoc(sRef);
      if (!sDoc.exists()) {
        return res.status(404).json({ error: "Shipment not found" });
      }

      const shipment = sDoc.data() as any;
      let originStr = "";
      let destinationStr = "";

      // Determine default origin location
      if (shipment.freightType === "air") {
        originStr = shipment.airportOfDeparture || shipment.loadingCity || "Istanbul";
      } else if (shipment.freightType === "sea") {
        originStr = shipment.portOfLoading || shipment.loadingCity || "Istanbul";
      } else {
        originStr = shipment.loadingCity || "Istanbul";
      }

      // Determine default destination location
      if (shipment.freightType === "air") {
        destinationStr = shipment.airportOfArrival || shipment.deliveryCity || "Baghdad";
      } else if (shipment.freightType === "sea") {
        destinationStr = shipment.portOfDischarge || shipment.deliveryCity || "Baghdad";
      } else {
        destinationStr = shipment.deliveryCity || "Baghdad";
      }

      // Check if land freight has an assigned driver with real-time cached GPS coordinates
      let hasLiveDriverGps = false;
      let liveGpsLocation = null;
      if (shipment.assignedDriverId) {
        const dDoc = await getDoc(doc(db, "drivers", shipment.assignedDriverId));
        if (dDoc.exists()) {
          const driverData = dDoc.data();
          if (driverData.latitude !== undefined && driverData.longitude !== undefined) {
            originStr = `${driverData.latitude},${driverData.longitude}`;
            hasLiveDriverGps = true;
            liveGpsLocation = { lat: Number(driverData.latitude), lng: Number(driverData.longitude) };
          }
        }
      }

      const mapsKey = process.env.GOOGLE_MAPS_PLATFORM_KEY || "";
      if (!mapsKey) {
        // Precise Haversine distance geodetic / routing model fallback
        const CITY_CODRD: Record<string, { lat: number; lng: number }> = {
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

        const getHaversine = (lat1: number, lon1: number, lat2: number, lon2: number) => {
          const R = 6371;
          const dLat = (lat2 - lat1) * Math.PI / 180;
          const dLon = (lon2 - lon1) * Math.PI / 180;
          const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          return R * c;
        };

        let startLat = 41.0082, startLng = 28.9784;
        let endLat = 33.3152, endLng = 44.3661;

        if (hasLiveDriverGps && liveGpsLocation) {
          startLat = liveGpsLocation.lat;
          startLng = liveGpsLocation.lng;
        } else {
          const normOrigin = originStr.toLowerCase().trim();
          const matchKey = Object.keys(CITY_CODRD).find(k => normOrigin.includes(k) || k.includes(normOrigin));
          if (matchKey) {
            startLat = CITY_CODRD[matchKey].lat;
            startLng = CITY_CODRD[matchKey].lng;
          }
        }

        const normDest = destinationStr.toLowerCase().trim();
        const matchDestKey = Object.keys(CITY_CODRD).find(k => normDest.includes(k) || k.includes(normDest));
        if (matchDestKey) {
          endLat = CITY_CODRD[matchDestKey].lat;
          endLng = CITY_CODRD[matchDestKey].lng;
        }

        // Multiply by 1.25 to account for real roadways curvature (routing coefficient factor)
        const distanceKm = Math.round(getHaversine(startLat, startLng, endLat, endLng) * 1.25);
        const averageSpeedKmh = 72; // default safe cargo speed index 
        const durationSeconds = Math.round((distanceKm / averageSpeedKmh) * 3600);
        const durationInTrafficSeconds = Math.round(durationSeconds * 1.08); // Add 8% transit delay 

        const calculatedEta = new Date(Date.now() + durationInTrafficSeconds * 1000).toISOString();

        // Update shipment profile metadata with fallback estimation
        try {
          await updateDoc(sRef, {
            eta: calculatedEta,
            lastCalculatedEta: calculatedEta,
            lastCalculatedDistance: `${distanceKm} km`,
            lastCalculatedDuration: `${Math.round(durationInTrafficSeconds / 3600)} hrs ${Math.round((durationInTrafficSeconds % 3600) / 60)} mins`
          });
        } catch (dbErr) {
          console.warn("Could not save computed fallback ETA:", dbErr);
        }

        return res.json({
          origin: originStr,
          destination: destinationStr,
          distance: { text: `${distanceKm} km`, value: distanceKm * 1000 },
          duration: { text: `${Math.round(durationSeconds / 3600)} hrs ${Math.round((durationSeconds % 3600) / 60)} mins`, value: durationSeconds },
          durationInTraffic: { text: `${Math.round(durationInTrafficSeconds / 3600)} hrs ${Math.round((durationInTrafficSeconds % 3600) / 60)} mins`, value: durationInTrafficSeconds },
          estimatedArrivalTime: calculatedEta,
          status: "SIMULATED_ESTIMATE",
          hasLiveDriverGps
        });
      }

      // Query real Google Maps Distance Matrix API
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(originStr)}&destinations=${encodeURIComponent(destinationStr)}&departure_time=now&traffic_model=best_guess&key=${mapsKey}`;
      const response = await fetch(url);
      const data = await response.json() as any;

      if (data && data.status === "OK" && data.rows?.[0]?.elements?.[0]?.status === "OK") {
        const element = data.rows[0].elements[0];
        const distObj = element.distance;
        const durObj = element.duration;
        const durInTrafficObj = element.duration_in_traffic || durObj;

        const calculatedEta = new Date(Date.now() + durInTrafficObj.value * 1000).toISOString();

        // Automatically update the document ETA field in the firestore database
        try {
          await updateDoc(sRef, {
            eta: calculatedEta,
            lastCalculatedEta: calculatedEta,
            lastCalculatedDistance: distObj.text,
            lastCalculatedDuration: durInTrafficObj.text
          });
        } catch (dbErr) {
          console.warn("Failed to auto-update Firestore shipment ETA:", dbErr);
        }

        return res.json({
          origin: originStr,
          destination: destinationStr,
          distance: distObj,
          duration: durObj,
          durationInTraffic: durInTrafficObj,
          estimatedArrivalTime: calculatedEta,
          status: "OK",
          hasLiveDriverGps
        });
      } else {
        // Standard high-reliability fallback if Google API response has no routes (e.g. islands, water bounds)
        const distanceKm = 850; // generic fallback Istanbul-Baghdad corridor
        const durationInTrafficSeconds = 41000;
        const calculatedEta = new Date(Date.now() + durationInTrafficSeconds * 1000).toISOString();

        return res.json({
          origin: originStr,
          destination: destinationStr,
          distance: { text: `${distanceKm} km`, value: distanceKm * 1000 },
          duration: { text: "11 hrs 20 mins", value: durationInTrafficSeconds },
          durationInTraffic: { text: "11 hrs 25 mins", value: durationInTrafficSeconds },
          estimatedArrivalTime: calculatedEta,
          status: "ZERO_RESULTS_FALLBACK",
          hasLiveDriverGps
        });
      }
    } catch (err: any) {
      console.error("Error in Distance Matrix Endpoint:", err);
      res.status(500).json({ error: "Failed to process distance matrix", details: err?.message });
    }
  });

  // 4. Update Shipment Profile
  app.put("/api/shipments/:id", async (req, res) => {
    try {
      const sDocRef = doc(db, "shipments", req.params.id);
      const sDoc = await getDoc(sDocRef);
      if (!sDoc.exists()) {
        return res.status(404).json({ error: "Shipment not found" });
      }

      const original = sDoc.data() as Shipment;
      const data = req.body;

      const oldDriverId = original.assignedDriverId;
      const newDriverId = data.assignedDriverId;

      // Handle shift in driver statistics
      if (oldDriverId !== newDriverId) {
        if (oldDriverId) {
          const odRef = doc(db, "drivers", oldDriverId);
          const odDoc = await getDoc(odRef);
          if (odDoc.exists()) {
            const od = odDoc.data() as Driver;
            od.activeShipmentsCount = Math.max(0, od.activeShipmentsCount - 1);
            await setDoc(odRef, od);
          }
        }
        if (newDriverId) {
          const ndRef = doc(db, "drivers", newDriverId);
          const ndDoc = await getDoc(ndRef);
          if (ndDoc.exists()) {
            const nd = ndDoc.data() as Driver;
            nd.activeShipmentsCount += 1;
            await setDoc(ndRef, nd);
          }
        }
      }

      let assignedDriverName = "Unassigned";
      let driverObj: Driver | null = null;
      if (newDriverId) {
        const dDocs = await getDoc(doc(db, "drivers", newDriverId));
        if (dDocs.exists()) {
          driverObj = dDocs.data() as Driver;
          assignedDriverName = driverObj.name;
        }
      }

      let finalStatus = data.status !== undefined ? data.status : original.status;
      const timelineCopy = [...(original.timeline || [])];

      if (data.status !== undefined && data.status !== original.status) {
        const labelMap: Record<string, { en: string; tr: string; ar: string }> = {
          'New': { en: "Initialized", tr: "Oluşturuldu", ar: "تم التأسيس" },
          'Assigned': { en: "Assigned", tr: "Sürücü Atandı", ar: "تم التعيين" },
          'Accepted': { en: "Shipment Accepted", tr: "Sevkiyat Kabul Edildi", ar: "تم قبول الشحنة" },
          'Loading': { en: "Loading Started", tr: "Yükleme Başladı", ar: "بدء التحميل" },
          'Loaded': { en: "Cargo Loaded", tr: "Yükleme Tamamlandı", ar: "تم التحميل والتعبئة" },
          'In Transit': { en: "On Road (Transit)", tr: "Taşıma Aşamasında", ar: "في الطريق (ترانزيت)" },
          'Border Crossing': { en: "Border Processing", tr: "Sınır Geçişinde", ar: "اجراءات المعبر الحدودي" },
          'Customs Clearance': { en: "Customs Inspection", tr: "Gümrük İşlemlerinde", ar: "التخليص الجمركي" },
          'Arrived': { en: "Arrived at Destination", tr: "Varış Noktasına Ulaştı", ar: "وصلت إلى الوجهة" },
          'Delivered': { en: "Shipment Delivered", tr: "Teslim Edildi", ar: "تم التسليم" },
          'Closed': { en: "Shipment Closed & Invoiced", tr: "Kapatıldı ve Faturalandırıldı", ar: "مغلق ومسيرة الفواتير" },

          'Booking Confirmed': { en: "Booking Confirmed", tr: "Rezervasyon Onaylandı", ar: "تأكيد الحجز" },
          'Container Released': { en: "Container Released", tr: "Konteyner Serbest Bırakıldı", ar: "إfراج الحاوية" },
          'Loaded on Vessel': { en: "Loaded on Vessel", tr: "Gemiye Yüklendi", ar: "تم الشحن على السفينة" },
          'Vessel Departed': { en: "Vessel Departed", tr: "Gemi Hareket Etti", ar: "مغادرة السفينة" },
          'Arrived at Port': { en: "Arrived at Port", tr: "Limana Ulaştı", ar: "الوصول إلى الميناء" },
          'Released': { en: "Released from terminal", tr: "Terminalden Çekildi", ar: "الإفراج من المحطة" },
          'Out for Delivery': { en: "Out for final delivery", tr: "Dağıtıma Çıktı", ar: "خروج للتوصيل النهائي" },
          'Completed': { en: "Completed & Closed", tr: "Tamamlandı ve Kapatıldı", ar: "مكتمل ومغلق" },

          'Cargo Received': { en: "Cargo Received", tr: "Kargo Teslim Alındı", ar: "تم استلام الشحنة" },
          'Security Check Completed': { en: "Security Screening Approved", tr: "Güvenlik Taraması Onaylandı", ar: "الفحص الأمني والرقابي" },
          'Departed Airport': { en: "Flight Departed", tr: "Uçak Kalkış Yaptı", ar: "إقلاع الطائرة" },
          'Arrived Airport': { en: "Arrived at Airport Hub", tr: "Havalimanı Terminaline Ulaştı", ar: "الوصول إلى المطار" }
        };
        const labels = labelMap[data.status as string] || { en: data.status, tr: data.status, ar: data.status };

        timelineCopy.push({
          timestamp: new Date().toISOString(),
          status: data.status,
          labelEn: labels.en,
          labelTr: labels.tr,
          labelAr: labels.ar,
          detailsEn: `Status updated manually to ${labels.en} via Operations Panel.`,
          detailsTr: `Durum Operasyon Paneli üzerinden manuel olarak ${labels.tr} olarak güncellendi.`,
          detailsAr: `تم تحديث الحالة يدوياً إلى ${labels.ar} عبر لوحة العمليات.`
        });

        await pushNotification(
          original.id,
          original.shipmentNumber,
          "status_update",
          `Status Update: ${data.status}`,
          `Durum Güncellemesi: ${data.status}`,
          `تحديث الحالة: ${data.status}`,
          `Shipment ${original.shipmentNumber} is now ${data.status}.`,
          `Sevkiyat ${original.shipmentNumber} şu anda ${data.status} konumunda.`,
          `الشحنة رقم ${original.shipmentNumber} الآن هي في حالة [${data.status}].`
        );
      }

      const updatedShipment: Shipment = {
        ...original,
        status: finalStatus,
        timeline: timelineCopy,
        companyName: data.companyName !== undefined ? data.companyName : original.companyName,
        loadingCountry: data.loadingCountry !== undefined ? data.loadingCountry : original.loadingCountry,
        loadingCity: data.loadingCity !== undefined ? data.loadingCity : original.loadingCity,
        loadingAddress: data.loadingAddress !== undefined ? data.loadingAddress : original.loadingAddress,
        loadingContactNumber: data.loadingContactNumber !== undefined ? data.loadingContactNumber : original.loadingContactNumber,
        deliveryCountry: data.deliveryCountry !== undefined ? data.deliveryCountry : original.deliveryCountry,
        deliveryCity: data.deliveryCity !== undefined ? data.deliveryCity : original.deliveryCity,
        deliveryAddress: data.deliveryAddress !== undefined ? data.deliveryAddress : original.deliveryAddress,
        deliveryContactNumber: data.deliveryContactNumber !== undefined ? data.deliveryContactNumber : original.deliveryContactNumber,
        cargoDescription: data.cargoDescription !== undefined ? data.cargoDescription : original.cargoDescription,
        cargoWeight: data.cargoWeight !== undefined ? Number(data.cargoWeight) : original.cargoWeight,
        truckNumber: driverObj ? driverObj.truckNumber : (data.truckNumber !== undefined ? data.truckNumber : original.truckNumber),
        assignedDriverId: newDriverId !== undefined ? newDriverId : original.assignedDriverId,
        assignedDriverName: newDriverId !== undefined ? assignedDriverName : original.assignedDriverName,
        agreedAmount: data.agreedAmount !== undefined ? Number(data.agreedAmount) : original.agreedAmount,
        currency: data.currency !== undefined ? data.currency : original.currency,
        internalNotes: data.internalNotes !== undefined ? data.internalNotes : original.internalNotes,
        updatedAt: new Date().toISOString(),
        
        // Add Sea & Air properties to update payload
        freightType: data.freightType !== undefined ? data.freightType : original.freightType,
        shippingLine: data.shippingLine !== undefined ? data.shippingLine : original.shippingLine,
        vesselName: data.vesselName !== undefined ? data.vesselName : original.vesselName,
        containerNumber: data.containerNumber !== undefined ? data.containerNumber : original.containerNumber,
        bookingNumber: data.bookingNumber !== undefined ? data.bookingNumber : original.bookingNumber,
        billOfLadingNumber: data.billOfLadingNumber !== undefined ? data.billOfLadingNumber : original.billOfLadingNumber,
        portOfLoading: data.portOfLoading !== undefined ? data.portOfLoading : original.portOfLoading,
        portOfDischarge: data.portOfDischarge !== undefined ? data.portOfDischarge : original.portOfDischarge,
        finalDestination: data.finalDestination !== undefined ? data.finalDestination : original.finalDestination,
        etd: data.etd !== undefined ? data.etd : original.etd,
        eta: data.eta !== undefined ? data.eta : original.eta,
        numberOfContainers: data.numberOfContainers !== undefined ? Number(data.numberOfContainers) : original.numberOfContainers,
        containerType: data.containerType !== undefined ? data.containerType : original.containerType,
        airline: data.airline !== undefined ? data.airline : original.airline,
        flightNumber: data.flightNumber !== undefined ? data.flightNumber : original.flightNumber,
        airWaybillNumber: data.airWaybillNumber !== undefined ? data.airWaybillNumber : original.airWaybillNumber,
        airportOfDeparture: data.airportOfDeparture !== undefined ? data.airportOfDeparture : original.airportOfDeparture,
        airportOfArrival: data.airportOfArrival !== undefined ? data.airportOfArrival : original.airportOfArrival,
        grossWeight: data.grossWeight !== undefined ? Number(data.grossWeight) : original.grossWeight,
        chargeableWeight: data.chargeableWeight !== undefined ? Number(data.chargeableWeight) : original.chargeableWeight,
        numberOfPackages: data.numberOfPackages !== undefined ? Number(data.numberOfPackages) : original.numberOfPackages,
        additionalDrivers: data.additionalDrivers !== undefined ? data.additionalDrivers : original.additionalDrivers,
        additionalContainers: data.additionalContainers !== undefined ? data.additionalContainers : original.additionalContainers,
        
        // Broker details mapping for land shipments
        destinationBrokerId: data.destinationBrokerId !== undefined ? data.destinationBrokerId : original.destinationBrokerId,
        destinationBrokerName: data.destinationBrokerName !== undefined ? data.destinationBrokerName : original.destinationBrokerName,
        destinationBrokerPhone: data.destinationBrokerPhone !== undefined ? data.destinationBrokerPhone : original.destinationBrokerPhone,
        iraqBorderBrokerId: data.iraqBorderBrokerId !== undefined ? data.iraqBorderBrokerId : original.iraqBorderBrokerId,
        iraqBorderBrokerName: data.iraqBorderBrokerName !== undefined ? data.iraqBorderBrokerName : original.iraqBorderBrokerName,
        iraqBorderBrokerPhone: data.iraqBorderBrokerPhone !== undefined ? data.iraqBorderBrokerPhone : original.iraqBorderBrokerPhone,
      };

      // Set status to Assigned if first assigned
      if (oldDriverId !== newDriverId && newDriverId) {
        if (updatedShipment.status === "New") {
          updatedShipment.status = "Assigned";
          updatedShipment.timeline.push({
            timestamp: new Date().toISOString(),
            status: "Assigned",
            labelEn: "Driver Assigned",
            labelTr: "Sürücü Atandı",
            labelAr: "تم تعيين السائق",
            detailsEn: `Assigned to driver ${assignedDriverName} during shipment update.`,
            detailsTr: `Sözleşme güncellemesi sırasında sürücü ${assignedDriverName} atandı.`,
            detailsAr: `تم تعيينه للسائق  ${assignedDriverName} أثناء عملية التحديث.`
          });
          
          await pushNotification(
            original.id,
            original.shipmentNumber,
            "assignment",
            "New Assignment Assigned",
            "Yeni Görev Atandı",
            "تم تعيين مهمة جديدة",
            `Shipment ${original.shipmentNumber} has been assigned to you.`,
            `Sistem size ${original.shipmentNumber} numaralı sevkiyat yükünü atadı.`,
            `تم تعيين الشحنة رقم ${original.shipmentNumber} لك.`
          );
        }
      }

      // Notify customer watchers of configuration or status updates
      const updatedDiffTexts: string[] = [];
      if (data.status !== undefined && data.status !== original.status) {
        updatedDiffTexts.push(`Status is now: ${data.status}.`);
      }
      if (data.eta !== undefined && data.eta !== original.eta) {
        updatedDiffTexts.push(`Estimated Time of Arrival (ETA) updated to ${data.eta}.`);
      }
      if (data.etd !== undefined && data.etd !== original.etd) {
        updatedDiffTexts.push(`Estimated Time of Departure (ETD) updated to ${data.etd}.`);
      }
      if (data.vesselName !== undefined && data.vesselName !== original.vesselName) {
        updatedDiffTexts.push(`Transit Vessel updated to ${data.vesselName}.`);
      }
      if (data.flightNumber !== undefined && data.flightNumber !== original.flightNumber) {
        updatedDiffTexts.push(`Flight Number updated to ${data.flightNumber}.`);
      }

      const diffMsg = updatedDiffTexts.length > 0 
        ? updatedDiffTexts.join(" • ") 
        : "Some shipment parameters were updated by operations office.";

      await notifyCustomerWatchers(
        updatedShipment,
        "edit",
        "Shipment Parameters Updated",
        `Attention: Your shipment #${original.shipmentNumber} was updated by central operations. ${diffMsg}`
      );

      // In-app notification for the customer application
      await pushNotification(
        original.id,
        original.shipmentNumber,
        "status_update",
        "Shipment Updated",
        "Sevkiyat Güncellendi",
        "تم تحديث الشحنة",
        `Attention: Your shipment #${original.shipmentNumber} was updated: ${diffMsg}`,
        `Yükünüz #${original.shipmentNumber} güncellendi: ${diffMsg}`,
        `تنبيه: تم تحديث شحنتكم رقم #${original.shipmentNumber}: ${diffMsg}`
      );

      await setDoc(sDocRef, updatedShipment);

      await logActivity(
        original.id,
        original.shipmentNumber,
        "Admin Office",
        `Updated shipment parameters for ${original.shipmentNumber}`,
        `${original.shipmentNumber} sevkiyat parametreleri güncellendi`,
        `تم تحديث معايير الشحنة ${original.shipmentNumber}`
      );

      res.json(updatedShipment);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update shipment details" });
    }
  });

  // 5. Update Status
  app.put("/api/shipments/:id/status", async (req, res) => {
    try {
      const { status, remarksDesc, updaterName, role } = req.body;
      const shipmentId = req.params.id;
      const sDocRef = doc(db, "shipments", shipmentId);
      const sDoc = await getDoc(sDocRef);

      if (!sDoc.exists()) {
        return res.status(404).json({ error: "Shipment not found" });
      }

      const item = sDoc.data() as Shipment;
      const previousStatus = item.status;
      item.status = status as ShipmentStatus;
      item.updatedAt = new Date().toISOString();

      const labelMap: Record<string, { en: string; tr: string; ar: string }> = {
        'New': { en: "Initialized", tr: "Oluşturuldu", ar: "تم التأسيس" },
        'Assigned': { en: "Assigned", tr: "Sürücü Atandı", ar: "تم التعيين" },
        'Accepted': { en: "Shipment Accepted", tr: "Sevkiyat Kabul Edildi", ar: "تم قبول الشحنة" },
        'Loading': { en: "Loading Started", tr: "Yükleme Başladı", ar: "بدء التحميل" },
        'Loaded': { en: "Cargo Loaded", tr: "Yükleme Tamamlandı", ar: "تم التحميل والتعبئة" },
        'In Transit': { en: "On Road (Transit)", tr: "Taşıma Aşamasında", ar: "في الطريق (ترانزيت)" },
        'Border Crossing': { en: "Border Processing", tr: "Sınır Geçişinde", ar: "اجراءات المعبر الحدودي" },
        'Customs Clearance': { en: "Customs Inspection", tr: "Gümrük İşlemlerinde", ar: "التخليص الجمركي" },
        'Arrived': { en: "Arrived at Destination", tr: "Varış Noktasına Ulaştı", ar: "وصلت إلى الوجهة" },
        'Delivered': { en: "Shipment Delivered", tr: "Teslim Edildi", ar: "تم التسليم" },
        'Closed': { en: "Shipment Closed & Invoiced", tr: "Kapatıldı ve Faturalandırıldı", ar: "مغلق ومسيرة الفواتير" },
        // Sea status translations
        'Booking Confirmed': { en: "Booking Confirmed", tr: "Rezervasyon Onaylandı", ar: "تأكيد الحجز" },
        'Container Released': { en: "Container Released", tr: "Konteyner Serbest Bırakıldı", ar: "إفراج الحاوية" },
        'Loaded on Vessel': { en: "Loaded on Vessel", tr: "Gemiye Yüklendi", ar: "تم الشحن على السفينة" },
        'Vessel Departed': { en: "Vessel Departed", tr: "Gemi Hareket Etti", ar: "مغادرة السفينة" },
        'Arrived at Port': { en: "Arrived at Port", tr: "Limana Ulaştı", ar: "الوصول إلى الميناء" },
        'Released': { en: "Released from terminal", tr: "Terminalden Çekildi", ar: "الإفراج من المحطة" },
        'Out for Delivery': { en: "Out for final delivery", tr: "Dağıtıma Çıktı", ar: "خروج للتوصيل النهائي" },
        'Completed': { en: "Completed & Closed", tr: "Tamamlandı ve Kapatıldı", ar: "مكتمل ومغلق" },
        // Air status translations
        'Cargo Received': { en: "Cargo Received", tr: "Kargo Teslim Alındı", ar: "تم استلام الشحنة" },
        'Security Check Completed': { en: "Security Screening Approved", tr: "Güvenlik Taraması Onaylandı", ar: "الفحص الأمني والرقابي" },
        'Departed Airport': { en: "Flight Departed", tr: "Uçak Kalkış Yaptı", ar: "إقلاع الطائرة" },
        'Arrived Airport': { en: "Arrived at Airport Hub", tr: "Havalimanı Terminaline Ulaştı", ar: "الوصول إلى المطار" }
      };

      const labels = labelMap[status as ShipmentStatus] || labelMap['In Transit'];

      item.timeline.push({
        timestamp: new Date().toISOString(),
        status: status as ShipmentStatus,
        labelEn: labels.en,
        labelTr: labels.tr,
        labelAr: labels.ar,
        detailsEn: remarksDesc || `Status updated from ${previousStatus} to ${status} by ${updaterName || 'System'}.`,
        detailsTr: remarksDesc || `Durum ${updaterName || 'Sistem'} tarafından ${previousStatus} seviyesinden ${status} seviyesine çekildi.`,
        detailsAr: remarksDesc || `تم تحديث الحالة من ${previousStatus} إلى ${status} بواسطة ${updaterName || 'النظام'}.`
      });

      // Handle delivery statistics
      if (status === "Delivered") {
        const dDocRef = doc(db, "drivers", item.assignedDriverId);
        const dDoc = await getDoc(dDocRef);
        if (dDoc.exists()) {
          const driver = dDoc.data() as Driver;
          driver.activeShipmentsCount = Math.max(0, driver.activeShipmentsCount - 1);
          driver.completedShipmentsCount += 1;
          await setDoc(dDocRef, driver);
        }
      }

      // Notify customer watchers of status update
      await notifyCustomerWatchers(
        item,
        status === "Delivered" ? "delivery" : "status_update",
        `Shipment Status Updated: ${status}`,
        `Good day, your shipment #${item.shipmentNumber} status is now: ${status}. Remarks: ${remarksDesc || 'No remarks recorded.'}`
      );

      await setDoc(sDocRef, item);

      await pushNotification(
        item.id,
        item.shipmentNumber,
        status === "Accepted" ? "acceptance" : (status === "Delivered" ? "delivery" : "status_update"),
        `Status Update: ${status}`,
        `Durum Güncellemesi: ${status}`,
        `تحديث الحالة: ${status}`,
        `Shipment ${item.shipmentNumber} is now ${status}.`,
        `Sevkiyat ${item.shipmentNumber} şu anda ${status} konumunda.`,
        `الشحنة رقم ${item.shipmentNumber} الآن هي في حالة [${status}].`
      );

      await logActivity(
        item.id,
        item.shipmentNumber,
        updaterName || role || "System",
        `Changed status of ${item.shipmentNumber} to ${status}`,
        `${item.shipmentNumber} sevkiyat durumunu ${status} olarak güncelledi`,
        `تغيير حالة الشحنة برقم ${item.shipmentNumber} إلى ${status}`
      );

      res.json(item);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update status" });
    }
  });

  // 5b. Subscribe Customer to Cargo Updates
  app.post("/api/shipments/:id/subscribe-customer", async (req, res) => {
    try {
      const { email, channel } = req.body;
      if (!email || !email.includes("@")) {
        return res.status(400).json({ error: "A valid email address is required" });
      }

      const shipmentId = req.params.id;
      const sDocRef = doc(db, "shipments", shipmentId);
      const sDoc = await getDoc(sDocRef);

      if (!sDoc.exists()) {
        return res.status(404).json({ error: "Shipment not found" });
      }

      const item = sDoc.data() as Shipment;
      
      if (!item.customerEmails) {
        item.customerEmails = [];
      }

      const cleanEmail = email.trim().toLowerCase();
      if (!item.customerEmails.includes(cleanEmail)) {
        item.customerEmails.push(cleanEmail);
      }

      if (!item.customerNotificationHistory) {
        item.customerNotificationHistory = [];
      }

      // Add subscription confirmation alert entry
      const alertId = `cnh-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      item.customerNotificationHistory.push({
        id: alertId,
        timestamp: new Date().toISOString(),
        type: "setup",
        title: "Subscribed Successfully",
        message: `Your alert subscription for shipment #${item.shipmentNumber} has been successfully verified. You will receive real-time updates directly.`,
        email: cleanEmail,
        channel: channel || "email"
      });

      await setDoc(sDocRef, item);

      await logActivity(
        item.id,
        item.shipmentNumber,
        cleanEmail,
        `Subscribed to real-time cargo updates`,
        `${cleanEmail} e-posta ile canlı güncellemelere abone oldu`,
        `قام العميل بالاشتراك في تحديثات الشحنة المباشرة`
      );

      res.json(item);
    } catch (err) {
      console.error("Error subscribing customer: ", err);
      res.status(500).json({ error: "Failed to join notification server registration scheme" });
    }
  });

  // 6. Get Chat Messages
  app.get("/api/shipments/:id/chat", async (req, res) => {
    try {
      const col = collection(db, "chatMessages");
      const snapshot = await getDocs(col);
      let msgs = snapshot.docs.map(doc => {
        const d = doc.data() as ChatMessage;
        return {
          ...d,
          status: d.status || "sent"
        };
      });
      msgs = msgs.filter(m => m.shipmentId === req.params.id);
      msgs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      res.json(msgs);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to get chat messages" });
    }
  });

  // 6b. Mark Chat Messages as Seen
  app.post("/api/shipments/:id/chat/seen", async (req, res) => {
    try {
      const shipmentId = req.params.id;
      const { viewer } = req.body; // 'admin' or 'driver'
      if (!viewer) {
        return res.status(400).json({ error: "Viewer is required ('admin' or 'driver')" });
      }

      const col = collection(db, "chatMessages");
      const snapshot = await getDocs(col);
      const batchWrites: Promise<void>[] = [];

      snapshot.docs.forEach((d) => {
        const msg = d.data() as ChatMessage;
        // If message is for this shipment, was sent by the opposite party, and is not already 'seen'
        if (msg.shipmentId === shipmentId && msg.sender !== viewer && msg.status !== "seen") {
          batchWrites.push(
            setDoc(doc(db, "chatMessages", d.id), { ...msg, status: "seen" })
          );
        }
      });

      if (batchWrites.length > 0) {
        await Promise.all(batchWrites);
      }

      res.json({ success: true, updatedCount: batchWrites.length });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to mark messages as seen" });
    }
  });

  // 7. Post Chat Message & Handle Document Savings
  app.post("/api/shipments/:id/chat", async (req, res) => {
    try {
      const shipmentId = req.params.id;
      const { sender, senderName, type, text, fileUrl, fileName, fileCategory } = req.body;

      const sDocRef = doc(db, "shipments", shipmentId);
      const sDoc = await getDoc(sDocRef);
      if (!sDoc.exists()) {
        return res.status(404).json({ error: "Shipment not found" });
      }
      const shipmentItem = sDoc.data() as Shipment;

      const newMessage: ChatMessage = {
        id: `msg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        shipmentId,
        sender,
        senderName,
        type,
        timestamp: new Date().toISOString(),
        status: "sent"
      };

      if (text !== undefined) newMessage.text = text;
      if (fileUrl !== undefined) newMessage.fileUrl = fileUrl;
      if (fileName !== undefined) newMessage.fileName = fileName;
      if (fileCategory !== undefined) newMessage.fileCategory = fileCategory;

      await setDoc(doc(db, "chatMessages", newMessage.id), newMessage);

      // Save file inside shipment documents
      if (type === "file" && fileUrl) {
        const docId = `doc-${Date.now()}`;
        const newDoc = {
          id: docId,
          name: fileName || "unnamed_document.bin",
          url: fileUrl,
          category: fileCategory || "other",
          uploadedBy: senderName || (sender === "admin" ? "Admin" : "Driver"),
          uploadedAt: new Date().toISOString(),
          isSharedExternally: true
        };

        shipmentItem.documents.push(newDoc);
        await setDoc(sDocRef, shipmentItem);

        await logActivity(
          shipmentId,
          shipmentItem.shipmentNumber,
          senderName || sender,
          `Uploaded document [${newDoc.name}] through Chat`,
          `Mesajlaşma paneli üzerinden [${newDoc.name}] belgesini yükledi`,
          `تحميل المستند [${newDoc.name}] من خلال المحادثة`
        );

        await pushNotification(
          shipmentId,
          shipmentItem.shipmentNumber,
          "doc_upload",
          "New Document Received",
          "Yeni Belge Alındı",
          "تم استلام مستند جديد",
          `New document '${newDoc.name}' uploaded in shipment ${shipmentItem.shipmentNumber}`,
          `Hızlı mesajlaşmadan '${newDoc.name}' isimli belge dosyaya kaydedildi.`,
          `تم إضافة مستند جديد باسم '${newDoc.name}' في ملف الشحنة ${shipmentItem.shipmentNumber}`
        );
      } else {
        await pushNotification(
          shipmentId,
          shipmentItem.shipmentNumber,
          "chat",
          `Message: ${senderName}`,
          `Mesaj: ${senderName}`,
          `رسالة من: ${senderName}`,
          text ? (text.length > 50 ? `${text.substring(0, 50)}...` : text) : "sent an attachment",
          text ? (text.length > 50 ? `${text.substring(0, 50)}...` : text) : "dosya gönderildi",
          text ? (text.length > 50 ? `${text.substring(0, 50)}...` : text) : "أرسل ملفًا جديًا"
        );
      }

      res.status(201).json(newMessage);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to post chat message" });
    }
  });

  // 8. Upload Document Directly (Admin Center)
  app.post("/api/shipments/:id/documents", async (req, res) => {
    try {
      const shipmentId = req.params.id;
      const { name, url, category, uploadedBy, isSharedExternally } = req.body;

      const sDocRef = doc(db, "shipments", shipmentId);
      const sDoc = await getDoc(sDocRef);
      if (!sDoc.exists()) {
        return res.status(404).json({ error: "Shipment not found" });
      }
      const shipmentItem = sDoc.data() as Shipment;

      const docId = `doc-${Date.now()}`;
      const newDoc = {
        id: docId,
        name: name || "document.bin",
        url: url || "#",
        category: (category as DocumentCategory) || "other",
        uploadedBy: uploadedBy || "Admin",
        uploadedAt: new Date().toISOString(),
        isSharedExternally: isSharedExternally !== undefined ? isSharedExternally : true
      };

      shipmentItem.documents.push(newDoc);
      await setDoc(sDocRef, shipmentItem);

      await logActivity(
        shipmentId,
        shipmentItem.shipmentNumber,
        uploadedBy || "Admin Panel",
        `Uploaded file ${newDoc.name} in Document Center`,
        `Belge Merkezine ${newDoc.name} evrakını yükledi`,
        `تحميل ملف ${newDoc.name} في مركز المستندات للشحنة`
      );

      res.status(201).json(newDoc);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to upload document" });
    }
  });

  // 9. Toggle Document Visibility
  app.put("/api/shipments/:id/documents/:docId/visibility", async (req, res) => {
    try {
      const sDocRef = doc(db, "shipments", req.params.id);
      const sDoc = await getDoc(sDocRef);
      if (!sDoc.exists()) return res.status(404).json({ error: "Shipment not found" });

      const shipment = sDoc.data() as Shipment;
      const docItem = shipment.documents.find(d => d.id === req.params.docId);
      if (!docItem) return res.status(404).json({ error: "Document not found" });

      const { isSharedExternally } = req.body;
      docItem.isSharedExternally = isSharedExternally;
      await setDoc(sDocRef, shipment);
      res.json(docItem);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to toggle document visibility" });
    }
  });

  // 10. Configure Sharing Page Link
  app.post("/api/shipments/:id/share", async (req, res) => {
    try {
      const sDocRef = doc(db, "shipments", req.params.id);
      const sDoc = await getDoc(sDocRef);
      if (!sDoc.exists()) return res.status(404).json({ error: "Shipment not found" });

      const shipment = sDoc.data() as Shipment;
      const { isLinkShared, shareIncludeDocuments, shareIncludePhotos } = req.body;
      
      if (isLinkShared !== undefined) shipment.isLinkShared = isLinkShared;
      if (shareIncludeDocuments !== undefined) shipment.shareIncludeDocuments = shareIncludeDocuments;
      if (shareIncludePhotos !== undefined) shipment.shareIncludePhotos = shareIncludePhotos;

      await setDoc(sDocRef, shipment);
      res.json(shipment);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to configure share link settings" });
    }
  });

  // 11. Public Shared Link lookups
  app.get("/api/share/:token", async (req, res) => {
    try {
      const col = collection(db, "shipments");
      const snapshot = await getDocs(col);
      const list = snapshot.docs.map(doc => doc.data() as Shipment);
      const shipment = list.find(s => s.shareToken === req.params.token);

      if (!shipment || !shipment.isLinkShared) {
        return res.status(404).json({ error: "Shared shipment path is inactive or invalid." });
      }

      const secureView = {
        shipmentNumber: shipment.shipmentNumber,
        status: shipment.status,
        loadingCountry: shipment.loadingCountry,
        loadingCity: shipment.loadingCity,
        loadingAddress: shipment.loadingAddress,
        loadingContactNumber: shipment.loadingContactNumber,
        deliveryCountry: shipment.deliveryCountry,
        deliveryCity: shipment.deliveryCity,
        deliveryAddress: shipment.deliveryAddress,
        deliveryContactNumber: shipment.deliveryContactNumber,
        cargoDescription: shipment.cargoDescription,
        cargoWeight: shipment.cargoWeight,
        truckNumber: shipment.truckNumber,
        timeline: shipment.timeline,
        updatedAt: shipment.updatedAt,
        assignedDriverName: shipment.assignedDriverName,
        
        // Sea & Air precise properties
        freightType: shipment.freightType || "land",
        shippingLine: shipment.shippingLine || "",
        vesselName: shipment.vesselName || "",
        containerNumber: shipment.containerNumber || "",
        bookingNumber: shipment.bookingNumber || "",
        billOfLadingNumber: shipment.billOfLadingNumber || "",
        portOfLoading: shipment.portOfLoading || "",
        portOfDischarge: shipment.portOfDischarge || "",
        finalDestination: shipment.finalDestination || "",
        etd: shipment.etd || "",
        eta: shipment.eta || "",
        numberOfContainers: shipment.numberOfContainers || 0,
        containerType: shipment.containerType || "",
        airline: shipment.airline || "",
        flightNumber: shipment.flightNumber || "",
        airWaybillNumber: shipment.airWaybillNumber || "",
        airportOfDeparture: shipment.airportOfDeparture || "",
        airportOfArrival: shipment.airportOfArrival || "",
        grossWeight: shipment.grossWeight || 0,
        chargeableWeight: shipment.chargeableWeight || 0,
        numberOfPackages: shipment.numberOfPackages || 0,

        documents: shipment.shareIncludeDocuments 
          ? shipment.documents.filter(d => d.isSharedExternally && d.category !== "photo")
          : [],
        photos: shipment.shareIncludePhotos
          ? shipment.documents.filter(d => d.isSharedExternally && d.category === "photo")
          : []
      };

      res.json(secureView);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to look up shared tracking link" });
    }
  });

  // 12. Drivers List
  app.post("/api/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: "Username/Email/Phone and Password are required" });
      }

      // 1. Admin login check
      const isAdminUser = 
        username.toLowerCase() === "sardar" || 
        username.toLowerCase() === "sardar@maras.iq";

      if (isAdminUser) {
        if (password === "maras123" || password === "admin123") {
          return res.json({
            success: true,
            role: "admin",
            adminType: "super",
            user: {
              id: "admin",
              name: "MARAS Operations Office",
              username: "admin",
              phone: "+90 212 555 1234",
              email: "sardar@maras.iq",
              adminType: "super"
            }
          });
        }
      }

      // Check sub-admins
      try {
        const adminsCol = collection(db, "admins");
        const adminsSnapshot = await getDocs(adminsCol);
        const adminsList = adminsSnapshot.docs.map(doc => doc.data() as any);
        const subAdmin = adminsList.find((a: any) => (a.email || "").toLowerCase().trim() === username.toLowerCase().trim());

        if (subAdmin) {
          if (subAdmin.password === password) {
            return res.json({
              success: true,
              role: "admin",
              adminType: subAdmin.adminType,
              user: {
                id: subAdmin.id,
                name: subAdmin.name || (subAdmin.adminType === "operation" ? "MARAS Operations Admin" : "MARAS Accounts Admin"),
                username: subAdmin.email.split("@")[0],
                phone: subAdmin.phone || "",
                email: subAdmin.email,
                adminType: subAdmin.adminType
              }
            });
          } else {
            return res.status(401).json({ error: "Incorrect password for admin user." });
          }
        }
      } catch (err) {
        console.warn("Could not check additional admins collection in login backend:", err);
      }

      // 2. Driver login check - fetch drivers list and try to match username or phone
      const col = collection(db, "drivers");
      const snapshot = await getDocs(col);
      const driversList = snapshot.docs.map(doc => doc.data() as Driver);
      
      const normalizedQuery = username.toLowerCase().trim();
      const matchedDriver = driversList.find(d => {
        const uMatch = (d.username || "").toLowerCase() === normalizedQuery;
        const pMatch = (d.phone || "").replace(/\s+/g, "") === normalizedQuery.replace(/\s+/g, "");
        const nameMatch = (d.name || "").toLowerCase() === normalizedQuery;
        return uMatch || pMatch || nameMatch;
      });

      if (matchedDriver) {
        const storedPassword = matchedDriver.password || "123456";
        if (storedPassword === password) {
          return res.json({
            success: true,
            role: "driver",
            driver: matchedDriver
          });
        }
      }

      // 3. Client login check - fetch clients list and match email or username
      const clientsCol = collection(db, "clients");
      const clientsSnapshot = await getDocs(clientsCol);
      const clientsList = clientsSnapshot.docs.map(doc => doc.data() as Client);
      
      const matchedClient = clientsList.find(c => {
        const uMatch = (c.username || "").toLowerCase() === normalizedQuery;
        const eMatch = (c.email || "").toLowerCase() === normalizedQuery;
        const nameMatch = (c.companyName || "").toLowerCase() === normalizedQuery;
        return uMatch || eMatch || nameMatch;
      });

      if (matchedClient) {
        const storedPassword = matchedClient.password || "client123";
        if (storedPassword === password) {
          return res.json({
            success: true,
            role: "client",
            client: matchedClient
          });
        }
      }

      return res.status(401).json({ error: "Invalid username, email, phone, or password" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // Secure server-side session verification to authorize valid email and roles
  app.post("/api/verify-session", async (req, res) => {
    try {
      const { role, email, uid, driverId, clientId } = req.body;
      
      const resolvedEmail = (email || "").trim().toLowerCase();
      const isAdminEmail = resolvedEmail === "sardar@maras.iq";
      
      if (role === "admin" || isAdminEmail) {
        if (isAdminEmail || resolvedEmail === "sardar") {
          return res.json({ 
            success: true, 
            role: "admin",
            adminType: "super",
            user: {
              id: "admin",
              name: "MARAS Operations Office",
              username: "admin",
              phone: "+90 212 555 1234",
              email: "sardar@maras.iq",
              adminType: "super"
            }
          });
        }

        // Check sub-admins
        try {
          const adminsCol = collection(db, "admins");
          const adminsSnapshot = await getDocs(adminsCol);
          const adminsList = adminsSnapshot.docs.map(doc => doc.data() as any);
          const subAdmin = adminsList.find((a: any) => (a.email || "").toLowerCase().trim() === resolvedEmail);

          if (subAdmin) {
            return res.json({
              success: true,
              role: "admin",
              adminType: subAdmin.adminType,
              user: {
                id: subAdmin.id,
                name: subAdmin.name || (subAdmin.adminType === "operation" ? "MARAS Operations Admin" : "MARAS Accounts Admin"),
                username: subAdmin.email.split("@")[0],
                phone: subAdmin.phone || "",
                email: subAdmin.email,
                adminType: subAdmin.adminType
              }
            });
          }
        } catch (err) {
          console.warn("Could not check additional admins during verify-session backend lookup:", err);
        }

        return res.status(403).json({ 
          success: false, 
          message: "Forbid: Only authorized administrators are allowed to restore admin sessions." 
        });
      }
      
      if (role === "driver") {
        const idToCheck = driverId || uid;
        if (!idToCheck) {
          return res.status(400).json({ success: false, message: "Forbid: Missing verification credentials." });
        }
        
        const col = collection(db, "drivers");
        const snapshot = await getDocs(col);
        const driversList = snapshot.docs.map(doc => doc.data() as Driver);
        const foundDriver = driversList.find(d => d.id === idToCheck);
        
        if (!foundDriver) {
          return res.status(404).json({ success: false, message: "Forbid: Driver ID not found in security system." });
        }
        
        return res.json({ 
          success: true, 
          role: "driver",
          driver: foundDriver
        });
      }

      if (role === "client") {
        const idToCheck = clientId || uid;
        if (!idToCheck) {
          return res.status(400).json({ success: false, message: "Forbid: Missing client credentials." });
        }

        const col = collection(db, "clients");
        const snapshot = await getDocs(col);
        const clientsList = snapshot.docs.map(doc => doc.data() as Client);
        const foundClient = clientsList.find(c => c.id === idToCheck);

        if (!foundClient) {
          return res.status(404).json({ success: false, message: "Forbid: Client ID not found in security system." });
        }

        return res.json({
          success: true,
          role: "client",
          client: foundClient
        });
      }
      
      return res.status(400).json({ success: false, message: "Invalid session role specified." });
    } catch (err: any) {
      console.error("Error verifying session server-side:", err);
      res.status(500).json({ error: "Session verification failed.", details: err.message });
    }
  });

  app.get("/api/system/datadog", (req, res) => {
    try {
      const isConfigured = !!process.env.DD_API_KEY;
      const rawKey = process.env.DD_API_KEY || "";
      const maskedKey = rawKey 
        ? rawKey.length > 8 
          ? rawKey.substring(0, 4) + "..." + rawKey.substring(rawKey.length - 4) 
          : "Configured (Short Format)" 
        : "Not Set";

      res.json({
        enabled: isConfigured,
        service: "etir-by-maras-backend",
        env: process.env.NODE_ENV || "development",
        apiKeyMasked: maskedKey,
        status: isConfigured ? "Datadog Tracer online & logging active" : "Tracer offline (add DD_API_KEY to configure)",
        telemetry: {
          runtime: "Node.js",
          version: process.version,
          platform: process.platform,
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to retrieve configuration status", details: err.message });
    }
  });

  app.get("/api/maps-key", (req, res) => {
    res.json({
      key: process.env.GOOGLE_MAPS_PLATFORM_KEY || ""
    });
  });

  app.get("/api/admins", async (req, res) => {
    try {
      const col = collection(db, "admins");
      const snapshot = await getDocs(col);
      const list = snapshot.docs.map(doc => doc.data());
      res.json(list);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch admins" });
    }
  });

  app.post("/api/admins", async (req, res) => {
    try {
      const data = req.body;
      const newAdmin = {
        id: data.id || `admin-${Date.now()}`,
        name: data.name || "MARAS Team Member",
        email: data.email || "",
        password: data.password || "123456",
        adminType: data.adminType || "operation",
        createdAt: data.createdAt || new Date().toISOString()
      };
      await setDoc(doc(db, "admins", newAdmin.id), newAdmin);
      res.status(201).json(newAdmin);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create admin" });
    }
  });

  app.delete("/api/admins/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const docRef = doc(db, "admins", id);
      await deleteDoc(docRef);
      res.json({ success: true, message: "Admin deleted successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to delete admin" });
    }
  });

  app.delete("/api/drivers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const docRef = doc(db, "drivers", id);
      await deleteDoc(docRef);
      res.json({ success: true, message: "Driver deleted successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to delete driver" });
    }
  });

  app.delete("/api/clients/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const docRef = doc(db, "clients", id);
      await deleteDoc(docRef);
      res.json({ success: true, message: "Client deleted successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to delete client" });
    }
  });

  app.get("/api/drivers", async (req, res) => {
    try {
      const col = collection(db, "drivers");
      const snapshot = await getDocs(col);
      const list = snapshot.docs.map(doc => doc.data() as Driver);
      res.json(list);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch drivers" });
    }
  });

  app.post("/api/drivers", async (req, res) => {
    try {
      const data = req.body;
      const newDriver: Driver = {
        id: data.id || `driver-${Date.now()}`,
        name: data.name || "Unnamed Driver",
        username: data.username || `driver_${Date.now()}`,
        password: data.password || "123456",
        email: data.email || "",
        truckNumber: data.truckNumber || "Unassigned",
        phone: data.phone || "No phone",
        activeShipmentsCount: 0,
        completedShipmentsCount: 0,
        truckType: data.truckType || "reefer"
      };
      await setDoc(doc(db, "drivers", newDriver.id), newDriver);
      res.status(201).json(newDriver);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create driver" });
    }
  });

  app.get("/api/clients", async (req, res) => {
    try {
      const col = collection(db, "clients");
      const snapshot = await getDocs(col);
      const list = snapshot.docs.map(doc => doc.data() as Client);
      res.json(list);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch clients" });
    }
  });

  app.post("/api/clients", async (req, res) => {
    try {
      const data = req.body;
      if (!data.companyName || !data.contactName) {
        return res.status(400).json({ error: "Company name and contact name are required" });
      }
      const newClient: Client = {
        id: data.id || `client-${Date.now()}`,
        companyName: data.companyName,
        contactName: data.contactName,
        phone: data.phone || "",
        email: data.email || "",
        address: data.address || "",
        notes: data.notes || "",
        createdAt: data.createdAt || new Date().toISOString()
      };
      await setDoc(doc(db, "clients", newClient.id), newClient);
      res.status(201).json(newClient);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create client" });
    }
  });

  app.get("/api/vendors", async (req, res) => {
    try {
      const col = collection(db, "vendors");
      const snapshot = await getDocs(col);
      const list = snapshot.docs.map(doc => doc.data() as Vendor);
      res.json(list);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch vendors" });
    }
  });

  app.post("/api/vendors", async (req, res) => {
    try {
      const data = req.body;
      if (!data.companyName || !data.contactName || !data.serviceType) {
        return res.status(400).json({ error: "Company name, contact name, and service type are required" });
      }
      const newVendor: Vendor = {
        id: data.id || `vendor-${Date.now()}`,
        companyName: data.companyName,
        contactName: data.contactName,
        phone: data.phone || "",
        email: data.email || "",
        address: data.address || "",
        serviceType: data.serviceType,
        notes: data.notes || "",
        createdAt: data.createdAt || new Date().toISOString()
      };
      await setDoc(doc(db, "vendors", newVendor.id), newVendor);
      res.status(201).json(newVendor);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create vendor" });
    }
  });

  app.put("/api/drivers/:id", async (req, res) => {
    try {
      const { name, username, email, truckNumber, phone, truckType, latitude, longitude, lastUpdated, avatarUrl } = req.body;
      const dRef = doc(db, "drivers", req.params.id);
      const dDoc = await getDoc(dRef);
      
      let original: any = {};
      if (dDoc.exists()) {
        original = dDoc.data();
      } else {
        // Auto-create base profile if not found
        original = {
          id: req.params.id,
          name: name || "Simulated Specialist",
          username: username || `driver_${req.params.id}`,
          password: "123",
          email: email || "",
          truckNumber: truckNumber || "TR-7733-IQ",
          phone: phone || "+96400000000",
          truckType: truckType || "reefer",
          activeShipmentsCount: 1,
          completedShipmentsCount: 0
        };
      }

      const updatedDriver: any = {
        ...original
      };
      if (name !== undefined) updatedDriver.name = name;
      if (username !== undefined) updatedDriver.username = username;
      if (email !== undefined) updatedDriver.email = email;
      if (truckNumber !== undefined) updatedDriver.truckNumber = truckNumber;
      if (phone !== undefined) updatedDriver.phone = phone;
      if (truckType !== undefined) updatedDriver.truckType = truckType;
      if (latitude !== undefined) updatedDriver.latitude = latitude;
      if (longitude !== undefined) updatedDriver.longitude = longitude;
      if (lastUpdated !== undefined) updatedDriver.lastUpdated = lastUpdated;
      if (avatarUrl !== undefined) updatedDriver.avatarUrl = avatarUrl;

      await setDoc(dRef, updatedDriver);

      // If name or truck updated, automatically update assigned shipments references
      if ((name && name !== original.name) || (truckNumber && truckNumber !== original.truckNumber)) {
        const shipCol = collection(db, "shipments");
        const shipSnap = await getDocs(shipCol);
        for (const sDoc of shipSnap.docs) {
          const s = sDoc.data() as Shipment;
          let changed = false;
          if (s.assignedDriverId === req.params.id) {
            if (name) s.assignedDriverName = name;
            if (truckNumber) s.truckNumber = truckNumber;
            changed = true;
          }
          if (s.additionalDrivers && s.additionalDrivers.length > 0) {
            s.additionalDrivers = s.additionalDrivers.map((ad: any) => {
              if (ad.driverId === req.params.id) {
                changed = true;
                return {
                  ...ad,
                  driverName: name || ad.driverName,
                  truckNumber: truckNumber || ad.truckNumber
                };
              }
              return ad;
            });
          }
          if (changed) {
            await setDoc(sDoc.ref, s);
          }
        }
      }

      res.json(updatedDriver);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update driver" });
    }
  });

  // 13. System Notifications
  app.get("/api/notifications", async (req, res) => {
    try {
      const col = collection(db, "notifications");
      const snapshot = await getDocs(col);
      const list = snapshot.docs.map(doc => doc.data() as AppNotification);
      list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      res.json(list);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to get notifications" });
    }
  });

  app.post("/api/notifications/clear", async (req, res) => {
    try {
      const col = collection(db, "notifications");
      const snapshot = await getDocs(col);
      for (const d of snapshot.docs) {
        const notif = d.data() as AppNotification;
        if (!notif.read) {
          notif.read = true;
          await setDoc(d.ref, notif);
        }
      }
      res.json({ status: "success" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to clear notifications" });
    }
  });

  app.post("/api/notifications/:id/read", async (req, res) => {
    try {
      const dRef = doc(db, "notifications", req.params.id);
      const dDoc = await getDoc(dRef);
      if (dDoc.exists()) {
        const notif = dDoc.data() as AppNotification;
        notif.read = true;
        await setDoc(dRef, notif);
      }
      res.json({ status: "success" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to read notification" });
    }
  });

  // Cost Statements APIs
  app.get("/api/cost-statements", async (req, res) => {
    try {
      const col = collection(db, "costStatements");
      const snapshot = await getDocs(col);
      const list = snapshot.docs.map(doc => doc.data() as CostStatement);
      res.json(list);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch cost statements" });
    }
  });

  app.get("/api/cost-statements/:shipmentId", async (req, res) => {
    try {
      const dRef = doc(db, "costStatements", req.params.shipmentId);
      const dDoc = await getDoc(dRef);
      if (dDoc.exists()) {
        res.json(dDoc.data() as CostStatement);
      } else {
        // Find the associated shipment to initialize standard default values
        const sRef = doc(db, "shipments", req.params.shipmentId);
        const sDoc = await getDoc(sRef);
        if (sDoc.exists()) {
          const s = sDoc.data() as Shipment;
          const templateStatement: CostStatement = {
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
          return res.json(templateStatement);
        }
        res.status(404).json({ error: "Shipment not found" });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch cost statement" });
    }
  });

  app.post("/api/cost-statements/:shipmentId", async (req, res) => {
    try {
      const { shipmentId } = req.params;
      const data = req.body as Partial<CostStatement>;
      
      const sRef = doc(db, "shipments", shipmentId);
      const sDoc = await getDoc(sRef);
      if (!sDoc.exists() && !useMemoryFallback) {
        return res.status(404).json({ error: "Shipment not found" });
      }
      
      const items = data.items || [];
      const totalCost = items.reduce((sum, item) => sum + (Number(item.totalAmount) || 0), 0);
      const paidAmount = Number(data.paidAmount) || 0;
      const remainingBalance = totalCost - paidAmount;
      const paymentStatus = remainingBalance <= 0 && totalCost > 0 ? "Paid" : (paidAmount > 0 ? "Partial" : "Unpaid");
      
      const finalStatement: CostStatement = {
        shipmentId,
        shipmentNumber: data.shipmentNumber || "",
        companyName: data.companyName || "",
        shipmentType: data.shipmentType || "land",
        date: data.date || new Date().toISOString().split('T')[0],
        currency: data.currency || "USD",
        totalCost,
        paidAmount,
        remainingBalance,
        paymentStatus,
        notes: data.notes || "",
        items,
        createdAt: data.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      const dRef = doc(db, "costStatements", shipmentId);
      await setDoc(dRef, finalStatement);

      try {
        const logId = `log-${Date.now()}`;
        const logCol = collection(db, "activityLogs");
        const logData = {
          id: logId,
          shipmentId: shipmentId,
          shipmentNumber: finalStatement.shipmentNumber,
          actionEn: `Cost statement updated for shipment ${finalStatement.shipmentNumber}`,
          actionTr: `${finalStatement.shipmentNumber} numaralı sevkiyat için maliyet tablosu güncellendi`,
          actionAr: `تم تحديث كشف التكلفة للشحنة ${finalStatement.shipmentNumber}`,
          actor: "Accounting / Admin",
          timestamp: new Date().toISOString()
        };
        await setDoc(doc(db, "activityLogs", logId), logData);
      } catch (logErr) {
        console.error("Failed to write cost log:", logErr);
      }

      res.json(finalStatement);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update cost statement" });
    }
  });

  // 14. Activity Logs
  app.get("/api/logs", async (req, res) => {
    try {
      const col = collection(db, "activityLogs");
      const snapshot = await getDocs(col);
      const list = snapshot.docs.map(doc => doc.data() as ActivityLog);
      list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      res.json(list);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch logs" });
    }
  });

  app.post("/api/logs", async (req, res) => {
    try {
      const { shipmentId, shipmentNumber, actor, actionEn, actionTr, actionAr } = req.body;
      await logActivity(
        shipmentId || "",
        shipmentNumber || "",
        actor || "Operator",
        actionEn || "",
        actionTr || "",
        actionAr || ""
      );
      res.status(201).json({ status: "success" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create audit log" });
    }
  });

  // 15. Get Unread/Unseen Driver Chat Messages and counts
  app.get("/api/chat/unread", async (req, res) => {
    try {
      const col = collection(db, "chatMessages");
      const snapshot = await getDocs(col);
      const unreadMsgs = snapshot.docs
        .map(doc => doc.data() as ChatMessage)
        .filter(m => m.sender !== "admin" && m.status !== "seen");
      
      // Sort messages by timestamp descending
      unreadMsgs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      
      res.json(unreadMsgs);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch unread chat messages", details: err.message });
    }
  });


  // Serve frontend files (Vite integration)
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Shipment controller server bound and rolling on port ${PORT}`);

    // Background async database validation & seeding
    (async () => {
      try {
        console.log("Starting async background database connection check and self-seeding...");
        await testConnection();
        await seedDatabaseIfEmpty();
        console.log("Background database initialization completed successfully.");
      } catch (err) {
        console.error("Non-blocking background database initialization failed:", err);
      }
    })();
  });
}

startServer().catch((err) => {
  console.error("Failed to start MARAS server: ", err);
});
