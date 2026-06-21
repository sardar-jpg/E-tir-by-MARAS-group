var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// server.ts
var server_exports = {};
__export(server_exports, {
  db: () => db,
  useMemoryFallback: () => useMemoryFallback
});
module.exports = __toCommonJS(server_exports);
var import_config = require("dotenv/config");
var import_dd_trace = __toESM(require("dd-trace"), 1);
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_vite = require("vite");
var import_app = require("firebase/app");
var import_firestore = require("firebase/firestore");
if (process.env.DD_API_KEY) {
  try {
    import_dd_trace.default.init({
      logInjection: true,
      env: process.env.NODE_ENV || "development",
      service: "e-tir-by-maras-backend"
    });
    console.log("Datadog active monitoring initialized successfully on server backend.");
  } catch (error) {
    console.error("Error during Datadog tracing initialization:", error);
  }
}
var useMemoryFallback = false;
function collection(dbInstance, pathName, ...pathSegments) {
  if (useMemoryFallback || !dbInstance) {
    return { path: pathName + (pathSegments.length ? "/" + pathSegments.join("/") : ""), isCollection: true };
  }
  try {
    return (0, import_firestore.collection)(dbInstance, pathName, ...pathSegments);
  } catch (err) {
    console.warn("Firestore collection wrapper caught error. Switching to Memory Fallback:", err);
    useMemoryFallback = true;
    return { path: pathName + (pathSegments.length ? "/" + pathSegments.join("/") : ""), isCollection: true };
  }
}
function doc(dbInstance, pathName, ...pathSegments) {
  if (useMemoryFallback || !dbInstance) {
    return { path: pathName + (pathSegments.length ? "/" + pathSegments.join("/") : ""), isDoc: true };
  }
  try {
    return (0, import_firestore.doc)(dbInstance, pathName, ...pathSegments);
  } catch (err) {
    console.warn("Firestore doc wrapper caught error. Switching to Memory Fallback:", err);
    useMemoryFallback = true;
    return { path: pathName + (pathSegments.length ? "/" + pathSegments.join("/") : ""), isDoc: true };
  }
}
var memoryStore = null;
function getMemoryStore() {
  if (!memoryStore) {
    memoryStore = {
      drivers: [...initialDrivers || []],
      shipments: [...initialShipments || []],
      chatMessages: [...initialChatMessages || []],
      notifications: [...initialNotifications || []],
      activityLogs: [...initialActivityLogs || []],
      clients: [...initialClients || []],
      vendors: [...initialVendors || []],
      costStatements: [],
      test: [{ id: "connection", status: "ok" }]
    };
  }
  return memoryStore;
}
function parseFirebasePath(ref) {
  const path2 = ref?.path || "";
  const parts = path2.split("/").filter(Boolean);
  return {
    collection: parts[0] || "",
    id: parts[1] || "",
    isDoc: parts.length > 1
  };
}
function handleGetDocsMemory(queryRef) {
  const { collection: colName } = parseFirebasePath(queryRef);
  const mStore = getMemoryStore();
  const items = mStore[colName] || [];
  return {
    empty: items.length === 0,
    size: items.length,
    docs: items.map((item) => ({
      id: item.id || "",
      ref: { path: `${colName}/${item.id}`, id: item.id },
      data: () => item
    }))
  };
}
function handleGetDocMemory(docRef) {
  const { collection: colName, id } = parseFirebasePath(docRef);
  const mStore = getMemoryStore();
  const items = mStore[colName] || [];
  const item = items.find((i) => i.id === id);
  return {
    exists: () => !!item,
    data: () => item,
    id,
    ref: docRef
  };
}
function handleSetDocMemory(docRef, data) {
  const { collection: colName, id } = parseFirebasePath(docRef);
  const mStore = getMemoryStore();
  const items = mStore[colName];
  if (items) {
    const idx = items.findIndex((i) => i.id === id);
    if (idx > -1) {
      items[idx] = { ...items[idx], ...data };
    } else {
      items.push({ id, ...data });
    }
  }
}
async function getDocs(queryRef) {
  if (useMemoryFallback) {
    return handleGetDocsMemory(queryRef);
  }
  try {
    return await (0, import_firestore.getDocs)(queryRef);
  } catch (error) {
    console.warn("Firestore getDocs failed. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    return handleGetDocsMemory(queryRef);
  }
}
async function getDoc(docRef) {
  if (useMemoryFallback) {
    return handleGetDocMemory(docRef);
  }
  try {
    return await (0, import_firestore.getDoc)(docRef);
  } catch (error) {
    console.warn("Firestore getDoc failed. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    return handleGetDocMemory(docRef);
  }
}
async function setDoc(docRef, data, options) {
  if (useMemoryFallback) {
    return handleSetDocMemory(docRef, data);
  }
  try {
    return await (0, import_firestore.setDoc)(docRef, data, options);
  } catch (error) {
    console.warn("Firestore setDoc failed. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    return handleSetDocMemory(docRef, data);
  }
}
var configPath = import_path.default.join(process.cwd(), "firebase-applet-config.json");
var firebaseConfig = null;
var firebaseApp = null;
var db = null;
var initialId = "(default)";
try {
  if (import_fs.default.existsSync(configPath)) {
    firebaseConfig = JSON.parse(import_fs.default.readFileSync(configPath, "utf8"));
  } else if (process.env.FIREBASE_CONFIG) {
    firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
  }
  if (firebaseConfig) {
    firebaseApp = (0, import_app.initializeApp)(firebaseConfig);
    const customId = firebaseConfig.firestoreDatabaseId;
    initialId = customId && customId !== "(default)" ? customId : "(default)";
    db = (0, import_firestore.getFirestore)(firebaseApp, initialId);
  } else {
    console.warn("No Firebase configuration file or environment variable was found. Running using Robust Memory Fallback.");
    useMemoryFallback = true;
  }
} catch (err) {
  console.warn("Firebase initialization failed, utilizing default Memory Fallback. Error:", err instanceof Error ? err.message : String(err));
  useMemoryFallback = true;
}
async function testConnection() {
  if (!db) {
    useMemoryFallback = true;
    return;
  }
  try {
    await (0, import_firestore.getDoc)(doc(db, "test", "connection"));
    console.log("Successfully connected to Firestore Database (" + initialId + ").");
    useMemoryFallback = false;
  } catch (error) {
    console.warn("Firestore test connection error for database (" + initialId + "). Active Robust Memory Fallback. Error:", error instanceof Error ? error.message : String(error));
    useMemoryFallback = true;
  }
}
var initialClients = [
  {
    id: "client-1",
    companyName: "Al-Bahi General Trading Ltd.",
    contactName: "Bahaa Al-Deen",
    phone: "+964 780 111 2233",
    email: "baha@al-bahi-trading.com",
    address: "Karrada, Baghdad, Iraq",
    notes: "Regular importer of high-end appliances and consumer electronics. Strict delivery SLAs.",
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
    createdAt: "2026-05-20T08:15:00Z"
  }
];
var initialVendors = [
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
var initialDrivers = [
  {
    id: "driver-1",
    name: "Murat Y\u0131lmaz",
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
var initialShipments = [
  {
    id: "shipment-1001",
    shipmentNumber: "MAR-2026-1001",
    companyName: "Al-Bahi General Trading Ltd.",
    loadingCountry: "Turkey",
    loadingCity: "Istanbul",
    loadingAddress: "Had\u0131mk\xF6y Logistics Center, Warehouse D, Block 3",
    loadingContactNumber: "+90 212 555 4321",
    deliveryCountry: "Iraq",
    deliveryCity: "Baghdad",
    deliveryAddress: "Shorja Commercial Block, Al-Rasheed St, Warehouse 12",
    deliveryContactNumber: "+964 770 999 8877",
    cargoDescription: "Commercial textile goods, high-grade cotton fabrics, and pre-packaged garments.",
    cargoWeight: 14500,
    truckNumber: "34-MAR-1903",
    assignedDriverId: "driver-1",
    assignedDriverName: "Murat Y\u0131lmaz",
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
        labelTr: "Sevkiyat Olu\u015Fturuldu",
        labelAr: "\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0634\u062D\u0646\u0629",
        detailsEn: "Shipment record initialized in MARAS logistics database.",
        detailsTr: "Sevkiyat kayd\u0131 MARAS lojistik veritaban\u0131nda ba\u015Flat\u0131ld\u0131.",
        detailsAr: "\u062A\u0645 \u0628\u062F\u0621 \u0633\u062C\u0644 \u0627\u0644\u0634\u062D\u0646\u0629 \u0641\u064A \u0642\u0627\u0639\u062F\u0629 \u0628\u064A\u0627\u0646\u0627\u062A \u0645\u0627\u0631\u0627\u0633 \u0644\u0644\u062E\u062F\u0645\u0627\u062A \u0627\u0644\u0644\u0648\u062C\u0633\u062A\u064A\u0629."
      },
      {
        timestamp: "2026-05-30T10:00:00Z",
        status: "Assigned",
        labelEn: "Driver Assigned",
        labelTr: "S\xFCr\xFCc\xFC Atand\u0131",
        labelAr: "\u062A\u0645 \u062A\u0639\u064A\u064A\u0646 \u0627\u0644\u0633\u0627\u0626\u0642",
        detailsEn: "Shipment assigned to Murat Y\u0131lmaz and truck 34-MAR-1903.",
        detailsTr: "Sevkiyat Murat Y\u0131lmaz ve 34-MAR-1903 plakal\u0131 t\u0131r\u0131na atand\u0131.",
        detailsAr: "\u062A\u0645 \u062A\u0639\u064A\u064A\u0646 \u0627\u0644\u0634\u062D\u0646\u0629 \u0625\u0644\u0649 \u0645\u0631\u0627\u062F \u064A\u0644\u0645\u0627\u0632 \u0648\u0627\u0644\u0634\u0627\u062D\u0646\u0629 34-MAR-1903."
      },
      {
        timestamp: "2026-05-30T10:45:00Z",
        status: "Accepted",
        labelEn: "Shipment Accepted",
        labelTr: "Sevkiyat Kabul Edildi",
        labelAr: "\u062A\u0645 \u0642\u0628\u0648\u0644 \u0627\u0644\u0634\u062D\u0646\u0629",
        detailsEn: "Driver accepted transportation order and agreed drivers' fee of 3,200 USD.",
        detailsTr: "S\xFCr\xFCc\xFC ta\u015F\u0131ma talimat\u0131n\u0131 ve 3.200 USD s\xFCr\xFCc\xFC \xFCcretini kabul etti.",
        detailsAr: "\u0642\u0628\u0644 \u0627\u0644\u0633\u0627\u0626\u0642 \u0623\u0645\u0631 \u0627\u0644\u0646\u0642\u0644 \u0648\u0648\u0627\u0641\u0642 \u0639\u0644\u0649 \u0623\u062A\u0639\u0627\u0628 \u0627\u0644\u0633\u0627\u0626\u0642 \u0627\u0644\u0628\u0627\u0644\u063A\u0629 3,200 \u062F\u0648\u0644\u0627\u0631."
      },
      {
        timestamp: "2026-05-31T08:00:00Z",
        status: "Loading",
        labelEn: "Loading in Progress",
        labelTr: "Y\xFCkleme Yap\u0131l\u0131yor",
        labelAr: "\u062C\u0627\u0631\u064A \u0627\u0644\u062A\u062D\u0645\u064A\u0644",
        detailsEn: "Truck arrived at Istanbul Loading Warehouse D.",
        detailsTr: "T\u0131r \u0130stanbul Y\xFCkleme Deposu D'ye ula\u015Ft\u0131.",
        detailsAr: "\u0648\u0635\u0644\u062A \u0627\u0644\u0634\u0627\u062D\u0646\u0629 \u0625\u0644\u0649 \u0645\u0633\u062A\u0648\u062F\u0639 \u0627\u0644\u062A\u062D\u0645\u064A\u0644 \u0641\u064A \u0627\u0633\u0637\u0646\u0628\u0648\u0644 \u062F."
      },
      {
        timestamp: "2026-05-31T11:30:00Z",
        status: "Loaded",
        labelEn: "Cargo Loaded & Secured",
        labelTr: "Y\xFCkleme Tamamland\u0131",
        labelAr: "\u062A\u0645 \u0627\u0644\u062A\u062D\u0645\u064A\u0644 \u0648\u0627\u0644\u062A\u0623\u0645\u064A\u0646",
        detailsEn: "14.5 Tons of textile fabrics successfully secured inside truck bed.",
        detailsTr: "14.5 Ton tekstil kuma\u015F\u0131 t\u0131r kasas\u0131na ba\u015Far\u0131yla sabitlendi.",
        detailsAr: "\u062A\u0645 \u062A\u0623\u0645\u064A\u0646 14.5 \u0637\u0646 \u0645\u0646 \u0627\u0644\u0623\u0642\u0645\u0634\u0629 \u0627\u0644\u0645\u0646\u0633\u0648\u062C\u0629 \u0628\u0646\u062C\u0627\u062D \u062F\u0627\u062E\u0644 \u0627\u0644\u0634\u0627\u062D\u0646\u0629."
      },
      {
        timestamp: "2026-05-31T14:00:00Z",
        status: "In Transit",
        labelEn: "Departed Loading Point",
        labelTr: "Y\xFCkleme Noktas\u0131ndan \xC7\u0131k\u0131\u015F",
        labelAr: "\u063A\u0627\u062F\u0631\u062A \u0646\u0642\u0637\u0629 \u0627\u0644\u062A\u062D\u0645\u064A\u0644",
        detailsEn: "The truck departed Istanbul. Route: Istanbul -> Ankara -> Silopi (Border).",
        detailsTr: "T\u0131r \u0130stanbul'dan hareket etti. G\xFCzergah: \u0130stanbul -> Ankara -> Silopi (S\u0131n\u0131r).",
        detailsAr: "\u063A\u0627\u062F\u0631\u062A \u0627\u0644\u0634\u0627\u062D\u0646\u0629 \u0627\u0633\u0637\u0646\u0628\u0648\u0644. \u0627\u0644\u0645\u0633\u0627\u0631: \u0627\u0633\u0637\u0646\u0628\u0648\u0644 -> \u0623\u0646\u0642\u0631\u0629 -> \u0633\u064A\u0644\u0648\u0628\u064A (\u0627\u0644\u062D\u062F\u0648\u062F)."
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
        labelTr: "Sevkiyat Olu\u015Fturuldu",
        labelAr: "\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0634\u062D\u0646\u0629",
        detailsEn: "Urgent industrial gears shipment registered.",
        detailsTr: "Acil end\xFCstriyel di\u015Fli sevkiyat\u0131 kaydedildi.",
        detailsAr: "\u0634\u062D\u0646\u0629 \u0627\u0644\u062A\u0631\u0648\u0633 \u0627\u0644\u0635\u0646\u0627\u0639\u064A\u0629 \u0627\u0644\u0639\u0627\u062C\u0644\u0629 \u062A\u0645 \u062A\u0633\u062C\u064A\u0644\u0647\u0627."
      },
      {
        timestamp: "2026-05-28T09:00:00Z",
        status: "Assigned",
        labelEn: "Driver Assigned",
        labelTr: "S\xFCr\xFCc\xFC Atand\u0131",
        labelAr: "\u062A\u0645 \u062A\u0639\u064A\u064A\u0646 \u0627\u0644\u0633\u0627\u0626\u0642",
        detailsEn: "Assigned to Ahmed Al-Fadhli.",
        detailsTr: "Ahmed Al-Fadhli atand\u0131.",
        detailsAr: "\u062A\u0645 \u0627\u0644\u062A\u0639\u064A\u064A\u0646 \u0644\u0623\u062D\u0645\u062F \u0627\u0644\u0641\u0636\u0644\u064A."
      },
      {
        timestamp: "2026-05-28T10:10:00Z",
        status: "Accepted",
        labelEn: "Shipment Order Accepted",
        labelTr: "Sipari\u015F Kabul Edildi",
        labelAr: "\u0642\u0628\u0648\u0644 \u0623\u0645\u0631 \u0627\u0644\u0634\u062D\u0646\u0629",
        detailsEn: "Driver accepted Basra route under special weight terms.",
        detailsTr: "S\xFCr\xFCc\xFC \xF6zel a\u011F\u0131rl\u0131k ko\u015Fullar\u0131nda Basra g\xFCzergah\u0131n\u0131 kabul etti.",
        detailsAr: "\u0642\u0628\u0644 \u0627\u0644\u0633\u0627\u0626\u0642 \u0645\u0633\u0627\u0631 \u0627\u0644\u0628\u0635\u0631\u0629 \u0628\u0645\u0648\u062C\u0628 \u0634\u0631\u0648\u0637 \u0627\u0644\u0648\u0632\u0646 \u0627\u0644\u062E\u0627\u0635\u0629."
      },
      {
        timestamp: "2026-05-29T13:00:00Z",
        status: "Loaded",
        labelEn: "Heavy Cargo Loaded",
        labelTr: "A\u011F\u0131r Y\xFCk S\xFCr\xFCld\xFC/Y\xFCklendi",
        labelAr: "\u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u062D\u0645\u0648\u0644\u0629 \u0627\u0644\u062B\u0642\u064A\u0644\u0629",
        detailsEn: "Heavily reinforced chassis loaded at Bursa.",
        detailsTr: "Bursa'da g\xFC\xE7lendirilmi\u015F \u015Fasi y\xFCklendi.",
        detailsAr: "\u062A\u0645 \u062A\u062D\u0645\u064A\u0644 \u0647\u064A\u0643\u0644 \u0627\u0644\u0634\u0627\u062D\u0646\u0629 \u0627\u0644\u0645\u0639\u0632\u0632 \u0641\u064A \u0628\u0648\u0631\u0635\u0629."
      },
      {
        timestamp: "2026-05-30T17:00:00Z",
        status: "Border Crossing",
        labelEn: "Ibrahim Khalil Gate",
        labelTr: "Habur S\u0131n\u0131r Kap\u0131s\u0131",
        labelAr: "\u0645\u0646\u0641\u0630 \u0625\u0628\u0631\u0627\u0647\u064A\u0645 \u0627\u0644\u062E\u0644\u064A\u0644",
        detailsEn: "Arrived at Turkish/Iraqi Habur Border. Cargo inspected.",
        detailsTr: "Habur S\u0131n\u0131r Kap\u0131s\u0131na ula\u015F\u0131ld\u0131. Y\xFCk kontrol\xFC yap\u0131ld\u0131.",
        detailsAr: "\u0627\u0644\u0648\u0635\u0648\u0644 \u0625\u0644\u0649 \u062D\u062F\u0648\u062F \u0627\u0644\u062E\u0627\u0628\u0648\u0631 \u0627\u0644\u062A\u0631\u0643\u064A\u0629 \u0627\u0644\u0639\u0631\u0627\u0642\u064A\u0629. \u062A\u0645 \u0641\u062D\u0635 \u0627\u0644\u0634\u062D\u0646\u0629."
      },
      {
        timestamp: "2026-05-31T10:00:00Z",
        status: "Customs Clearance",
        labelEn: "Customs Inspection In Iraq",
        labelTr: "G\xFCmr\xFCk \u0130\u015Flemleri S\xFCr\xFCyor",
        labelAr: "\u0627\u0644\u062A\u062E\u0644\u064A\u0635 \u0627\u0644\u062C\u0645\u0631\u0643\u064A",
        detailsEn: "Customs clearance paperwork initiated at Zakho customs plaza.",
        detailsTr: "Zaho g\xFCmr\xFCk sahas\u0131nda tescil i\u015Flemleri ba\u015Flat\u0131ld\u0131.",
        detailsAr: "\u0628\u062F\u0621 \u0645\u0639\u0627\u0645\u0644\u0627\u062A \u0627\u0644\u062A\u062E\u0644\u064A\u0635 \u0627\u0644\u062C\u0645\u0631\u0643\u064A \u0641\u064A \u0633\u0627\u062D\u0629 \u062C\u0645\u0627\u0631\u0643 \u0632\u0627\u062E\u0648."
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
    loadingAddress: "Gaziantep G\u0131da Toptanc\u0131lar\u0131 Sitesi, No 77",
    loadingContactNumber: "+90 342 999 1212",
    deliveryCountry: "Iraq",
    deliveryCity: "Erbil",
    deliveryAddress: "Erbil Southern Wholesalers Central, Block B-3",
    deliveryContactNumber: "+964 750 444 5566",
    cargoDescription: "Assorted confectioneries, sunflower oils, and dried nuts.",
    cargoWeight: 19e3,
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
        labelTr: "Sevkiyat Olu\u015Fturuldu",
        labelAr: "\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0634\u062D\u0646\u0629",
        detailsEn: "Food shipment created.",
        detailsTr: "G\u0131da \xFCr\xFCn\xFC sevkiyat\u0131 olu\u015Fturuldu.",
        detailsAr: "\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u0634\u062D\u0646\u0629 \u0627\u0644\u0645\u0648\u0627\u062F \u0627\u0644\u063A\u0630\u0627\u0626\u064A\u0629."
      },
      {
        timestamp: "2026-05-31T14:30:00Z",
        status: "Assigned",
        labelEn: "Assigned to Truck",
        labelTr: "Araca Atand\u0131",
        labelAr: "\u062A\u0645 \u0627\u0644\u062A\u0639\u064A\u064A\u0646 \u0644\u0644\u0634\u0627\u062D\u0646\u0629",
        detailsEn: "Assigned to George Haddad and truck LEB-45210.",
        detailsTr: "George Haddad ve LEB-45210 numaral\u0131 t\u0131r\u0131na atand\u0131.",
        detailsAr: "\u062A\u0645 \u0627\u0644\u062A\u0639\u064A\u064A\u0646 \u0644\u062C\u0648\u0631\u062C \u062D\u062F\u0627\u062F \u0648\u0627\u0644\u0634\u0627\u062D\u0646\u0629 LEB-45210."
      },
      {
        timestamp: "2026-05-31T16:00:00Z",
        status: "Accepted",
        labelEn: "Order Accepted by Driver",
        labelTr: "S\xFCr\xFCc\xFC Sipari\u015Fi Kabul Etti",
        labelAr: "\u062A\u0645 \u0642\u0628\u0648\u0644 \u0627\u0644\u0637\u0644\u0628 \u0645\u0646 \u0627\u0644\u0633\u0627\u0626\u0642",
        detailsEn: "George accepted Erbil cold storage ventilated shipment.",
        detailsTr: "George havaland\u0131rmal\u0131 Erbil sevkiyat\u0131n\u0131 kabul etti.",
        detailsAr: "\u0642\u0628\u0644 \u062C\u0648\u0631\u062C \u0634\u062D\u0646\u0629 \u0623\u0631\u0628\u064A\u0644 \u0627\u0644\u0645\u0647\u0648\u0627\u0629."
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
var initialChatMessages = [
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
    senderName: "Murat Y\u0131lmaz",
    type: "text",
    text: "Received! Thank you. I have already printed the CMR copy. The loading was done quickly, cargo looks stable.",
    timestamp: "2026-05-31T11:45:00Z"
  },
  {
    id: "msg-3",
    shipmentId: "shipment-1001",
    sender: "driver",
    senderName: "Murat Y\u0131lmaz",
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
var initialNotifications = [
  {
    id: "notif-1",
    shipmentId: "shipment-1001",
    shipmentNumber: "MAR-2026-1001",
    titleEn: "Status: In Transit",
    titleTr: "Durum: Yolda",
    titleAr: "\u0627\u0644\u062D\u0627\u0644\u0629: \u0641\u064A \u0627\u0644\u0637\u0631\u064A\u0642",
    messageEn: "Shipment MAR-2026-1001 status changed to In Transit.",
    messageTr: "MAR-2026-1001 numaral\u0131 sevkiyat durumu Yolda olarak g\xFCncellendi.",
    messageAr: "\u062A\u0645 \u062A\u063A\u064A\u064A\u0631 \u062D\u0627\u0644\u0629 \u0627\u0644\u0634\u062D\u0646\u0629 MAR-2026-1001 \u0625\u0644\u0649 \u0641\u064A \u0627\u0644\u0637\u0631\u064A\u0642.",
    type: "status_update",
    timestamp: "2026-05-31T14:00:00Z",
    read: false
  },
  {
    id: "notif-2",
    shipmentId: "shipment-1002",
    shipmentNumber: "MAR-2026-1002",
    titleEn: "Status: Customs Clearance",
    titleTr: "Durum: G\xFCmr\xFCk \u0130\u015Flemleri",
    titleAr: "\u0627\u0644\u062D\u0627\u0644\u0629: \u0627\u0644\u062A\u062E\u0644\u064A\u0635 \u0627\u0644\u062C\u0645\u0631\u0643\u064A",
    messageEn: "Ahmed updated status for heavy industrial components.",
    messageTr: "Ahmet a\u011F\u0131r end\xFCstriyel aksamlar i\xE7in durumu g\xFCncelledi.",
    messageAr: "\u0642\u0627\u0645 \u0623\u062D\u0645\u062F \u0628\u062A\u062D\u062F\u064A\u062B \u0627\u0644\u062D\u0627\u0644\u0629 \u0644\u0642\u0637\u0639 \u0627\u0644\u063A\u064A\u0627\u0631 \u0627\u0644\u0635\u0646\u0627\u0639\u064A\u0629 \u0627\u0644\u062B\u0642\u064A\u0644\u0629.",
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
    titleAr: "\u062A\u0645 \u0642\u0628\u0648\u0644 \u0627\u0644\u0634\u062D\u0646\u0629",
    messageEn: "George Haddad accepted shipment food order to Erbil.",
    messageTr: "George Haddad, Erbil g\u0131da sevkiyat\u0131n\u0131 kabul etti.",
    messageAr: "\u0642\u0628\u0644 \u062C\u0648\u0631\u062C \u062D\u062F\u0627\u062F \u0634\u062D\u0646\u0629 \u0627\u0644\u0645\u0648\u0627\u062F \u0627\u0644\u063A\u0630\u0627\u0626\u064A\u0629 \u0625\u0644\u0649 \u0623\u0631\u0628\u064A\u0644.",
    type: "acceptance",
    timestamp: "2026-05-31T16:00:00Z",
    read: true
  }
];
var initialActivityLogs = [
  {
    id: "log-1",
    shipmentId: "shipment-1001",
    shipmentNumber: "MAR-2026-1001",
    actionEn: "Shipment created for Al-Bahi Trading",
    actionTr: "Al-Bahi Trading i\xE7in sevkiyat olu\u015Fturuldu",
    actionAr: "\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u0634\u062D\u0646\u0629 \u0644\u0634\u0631\u0643\u0629 \u0627\u0644\u0628\u0627\u0647\u064A \u0644\u0644\u062A\u062C\u0627\u0631\u0629",
    actor: "Operations Team (Admin)",
    timestamp: "2026-05-30T09:15:00Z"
  },
  {
    id: "log-2",
    shipmentId: "shipment-1001",
    shipmentNumber: "MAR-2026-1001",
    actionEn: "Assigned driver Murat Y\u0131lmaz",
    actionTr: "Yolcu/S\xFCr\xFCc\xFC Murat Y\u0131lmaz atand\u0131",
    actionAr: "\u062A\u0645 \u062A\u0639\u064A\u064A\u0646 \u0627\u0644\u0633\u0627\u0626\u0642 \u0645\u0631\u0627\u062F \u064A\u0644\u0645\u0627\u0632",
    actor: "Operations Team (Admin)",
    timestamp: "2026-05-30T10:00:00Z"
  },
  {
    id: "log-3",
    shipmentId: "shipment-1001",
    shipmentNumber: "MAR-2026-1001",
    actionEn: "Shipment status updated to In Transit",
    actionTr: "Sevkiyat durumu Yolda olarak g\xFCncellendi",
    actionAr: "\u062A\u0645 \u062A\u062D\u062F\u064A\u062B \u062D\u0627\u0644\u0629 \u0627\u0644\u0634\u062D\u0646\u0629 \u0625\u0644\u0649 \u0641\u064A \u0627\u0644\u0637\u0631\u064A\u0642",
    actor: "Murat Y\u0131lmaz (Driver)",
    timestamp: "2026-05-31T14:00:00Z"
  },
  {
    id: "log-4",
    shipmentId: "shipment-1002",
    shipmentNumber: "MAR-2026-1002",
    actionEn: "Document PackingList_Heavy_Gears.pdf uploaded",
    actionTr: "PackingList_Heavy_Gears.pdf belgesi y\xFCklendi",
    actionAr: "\u062A\u0645 \u062A\u062D\u0645\u064A\u0644 \u0645\u0633\u062A\u0646\u062F \u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u062A\u0639\u0628\u0626\u0629",
    actor: "Operations Team (Admin)",
    timestamp: "2026-05-28T08:15:00Z"
  }
];
async function seedDatabaseIfEmpty() {
  console.log("Validating and seeding Firestore database if empty...");
  try {
    const driverCol = collection(db, "drivers");
    const driverSnap = await getDocs(driverCol);
    if (driverSnap.empty) {
      console.log("Seeding drivers into Firestore...");
      for (const d of initialDrivers) {
        await setDoc(doc(db, "drivers", d.id), d);
      }
    }
    const shipmentCol = collection(db, "shipments");
    const shipmentSnap = await getDocs(shipmentCol);
    if (shipmentSnap.empty) {
      console.log("Seeding shipments into Firestore...");
      for (const s of initialShipments) {
        await setDoc(doc(db, "shipments", s.id), s);
      }
    }
    const chatCol = collection(db, "chatMessages");
    const chatSnap = await getDocs(chatCol);
    if (chatSnap.empty) {
      console.log("Seeding chat messages into Firestore...");
      for (const c of initialChatMessages) {
        await setDoc(doc(db, "chatMessages", c.id), c);
      }
    }
    const notifCol = collection(db, "notifications");
    const notifSnap = await getDocs(notifCol);
    if (notifSnap.empty) {
      console.log("Seeding notifications into Firestore...");
      for (const n of initialNotifications) {
        await setDoc(doc(db, "notifications", n.id), n);
      }
    }
    const logCol = collection(db, "activityLogs");
    const logSnap = await getDocs(logCol);
    if (logSnap.empty) {
      console.log("Seeding activity logs into Firestore...");
      for (const l of initialActivityLogs) {
        await setDoc(doc(db, "activityLogs", l.id), l);
      }
    }
    const clientsCol = collection(db, "clients");
    const clientsSnap = await getDocs(clientsCol);
    if (clientsSnap.empty) {
      console.log("Seeding clients into Firestore...");
      for (const cl of initialClients) {
        await setDoc(doc(db, "clients", cl.id), cl);
      }
    }
    const vendorsCol = collection(db, "vendors");
    const vendorsSnap = await getDocs(vendorsCol);
    if (vendorsSnap.empty) {
      console.log("Seeding vendors into Firestore...");
      for (const v of initialVendors) {
        await setDoc(doc(db, "vendors", v.id), v);
      }
    }
    console.log("Firestore seeding check completed completed successfully.");
  } catch (err) {
    console.error("Error seeding Firestore: ", err);
  }
}
async function logActivity(shipmentId, shipmentNumber, actor, actionEn, actionTr, actionAr) {
  const newLog = {
    id: `log-${Date.now()}-${Math.floor(Math.random() * 1e3)}`,
    shipmentId,
    shipmentNumber,
    actionEn,
    actionTr,
    actionAr,
    actor,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  try {
    await setDoc(doc(db, "activityLogs", newLog.id), newLog);
  } catch (err) {
    console.error("Error writing activity log: ", err);
  }
}
async function pushNotification(shipmentId, shipmentNumber, type, titleEn, titleTr, titleAr, messageEn, messageTr, messageAr) {
  const newNotif = {
    id: `notif-${Date.now()}-${Math.floor(Math.random() * 1e3)}`,
    shipmentId,
    shipmentNumber,
    titleEn,
    titleTr,
    titleAr,
    messageEn,
    messageTr,
    messageAr,
    type,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    read: false
  };
  try {
    await setDoc(doc(db, "notifications", newNotif.id), newNotif);
  } catch (err) {
    console.error("Error writing notification: ", err);
  }
}
var uploadedFiles = /* @__PURE__ */ new Map();
async function startServer() {
  const app = (0, import_express.default)();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3e3;
  app.use(import_express.default.json({ limit: "20mb" }));
  app.use((req, res, next) => {
    const overrideHeader = req.headers["x-http-method-override"];
    if (req.method === "POST" && overrideHeader) {
      req.method = (Array.isArray(overrideHeader) ? overrideHeader[0] : overrideHeader).toUpperCase();
    }
    next();
  });
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
    } else {
      res.header("Access-Control-Allow-Origin", "*");
    }
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-HTTP-Method-Override");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
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
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(fileObj.filename)}"`);
    res.setHeader("Content-Type", fileObj.mimeType);
    res.send(fileObj.buffer);
  });
  await testConnection();
  await seedDatabaseIfEmpty();
  app.get("/api/shipments", async (req, res) => {
    try {
      const col = collection(db, "shipments");
      const snapshot = await getDocs(col);
      let list = snapshot.docs.map((doc2) => doc2.data());
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const driverId = req.query.driverId;
      if (driverId) {
        const filtered = list.filter((s) => s.assignedDriverId === driverId);
        return res.json(filtered);
      }
      res.json(list);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch shipments" });
    }
  });
  app.post("/api/shipments", async (req, res) => {
    try {
      const data = req.body;
      const col = collection(db, "shipments");
      const snapshot = await getDocs(col);
      const count = snapshot.size;
      const year = (/* @__PURE__ */ new Date()).getFullYear();
      const shipmentNumber = `MAR-${year}-${1001 + count}`;
      const id = `shipment-${1001 + count}`;
      const driversCol = collection(db, "drivers");
      const driversSnap = await getDocs(driversCol);
      const driversList = driversSnap.docs.map((doc2) => doc2.data());
      const driver = driversList.find((d) => d.id === data.assignedDriverId);
      const assignedDriverName = driver ? driver.name : "Unassigned";
      const initialStatus = data.status || (data.freightType === "sea" || data.freightType === "air" ? "Booking Confirmed" : data.assignedDriverId ? "Assigned" : "New");
      const initialTimeline = {
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        status: initialStatus,
        labelEn: data.freightType === "sea" || data.freightType === "air" ? "Booking Confirmed" : "Shipment Initialized",
        labelTr: data.freightType === "sea" || data.freightType === "air" ? "Rezervasyon Onayland\u0131" : "Sevkiyat Olu\u015Fturuldu",
        labelAr: data.freightType === "sea" || data.freightType === "air" ? "\u062A\u0645 \u062A\u0623\u0643\u064A\u062F \u0627\u0644\u062D\u062C\u0632" : "\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0634\u062D\u0646\u0629",
        detailsEn: `Created for customer: ${data.companyName}`,
        detailsTr: `M\xFC\u015Fteri i\xE7in olu\u015Fturuldu: ${data.companyName}`,
        detailsAr: `\u062A\u0645 \u0625\u0646\u0634\u0627\u0624\u0647\u0627 \u0644\u0644\u0639\u0645\u064A\u0644: ${data.companyName}`
      };
      const newShipment = {
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
        truckNumber: driver ? driver.truckNumber : data.truckNumber || "",
        assignedDriverId: data.assignedDriverId || "",
        assignedDriverName,
        agreedAmount: Number(data.agreedAmount) || 0,
        currency: data.currency || "USD",
        internalNotes: data.internalNotes || "",
        status: initialStatus,
        documents: [],
        timeline: [initialTimeline],
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
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
        numberOfContainers: data.numberOfContainers !== void 0 ? Number(data.numberOfContainers) : 0,
        containerType: data.containerType || "",
        airline: data.airline || "",
        flightNumber: data.flightNumber || "",
        airWaybillNumber: data.airWaybillNumber || "",
        airportOfDeparture: data.airportOfDeparture || "",
        airportOfArrival: data.airportOfArrival || "",
        grossWeight: data.grossWeight !== void 0 ? Number(data.grossWeight) : 0,
        chargeableWeight: data.chargeableWeight !== void 0 ? Number(data.chargeableWeight) : 0,
        numberOfPackages: data.numberOfPackages !== void 0 ? Number(data.numberOfPackages) : 0
      };
      if (data.assignedDriverId && driver) {
        driver.activeShipmentsCount += 1;
        await setDoc(doc(db, "drivers", driver.id), driver);
        newShipment.timeline.push({
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          status: "Assigned",
          labelEn: "Driver Assigned",
          labelTr: "S\xFCr\xFCc\xFC Atand\u0131",
          labelAr: "\u062A\u0645 \u062A\u0639\u064A\u064A\u0646 \u0627\u0644\u0633\u0627\u0626\u0642",
          detailsEn: `Assigned to driver ${driver.name} with vehicle ${driver.truckNumber}.`,
          detailsTr: `${driver.name} s\xFCr\xFCc\xFCs\xFCne ${driver.truckNumber} plakal\u0131 ara\xE7la atand\u0131.`,
          detailsAr: `\u062A\u0645 \u062A\u0639\u064A\u064A\u0646\u0647 \u0644\u0644\u0633\u0627\u0626\u0642 ${driver.name} \u0648\u0645\u0639\u0647 \u0627\u0644\u0645\u0631\u0643\u0628\u0629 ${driver.truckNumber}.`
        });
        await pushNotification(
          id,
          shipmentNumber,
          "assignment",
          "New Assigned Shipment",
          "Yeni Atanm\u0131\u015F Sevkiyat",
          "\u0634\u062D\u0646\u0629 \u062C\u062F\u064A\u062F\u0629 \u0645\u0639\u064A\u0646\u0629",
          `You have been assigned shipment ${shipmentNumber}.`,
          `Size ${shipmentNumber} numaral\u0131 sevkiyat atand\u0131.`,
          `\u062A\u0645 \u062A\u0639\u064A\u064A\u0646 \u0627\u0644\u0634\u062D\u0646\u0629 ${shipmentNumber} \u0644\u0643.`
        );
      }
      await setDoc(doc(db, "shipments", id), newShipment);
      await logActivity(
        id,
        shipmentNumber,
        "Admin Office",
        `Created shipment ${shipmentNumber}`,
        `${shipmentNumber} numaral\u0131 sevkiyat olu\u015Fturuldu`,
        `\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0634\u062D\u0646\u0629 \u0628\u0646\u062C\u0627\u062D \u0628\u0631\u0642\u0645 ${shipmentNumber}`
      );
      res.status(201).json(newShipment);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create shipment" });
    }
  });
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
  app.put("/api/shipments/:id", async (req, res) => {
    try {
      const sDocRef = doc(db, "shipments", req.params.id);
      const sDoc = await getDoc(sDocRef);
      if (!sDoc.exists()) {
        return res.status(404).json({ error: "Shipment not found" });
      }
      const original = sDoc.data();
      const data = req.body;
      const oldDriverId = original.assignedDriverId;
      const newDriverId = data.assignedDriverId;
      if (oldDriverId !== newDriverId) {
        if (oldDriverId) {
          const odRef = doc(db, "drivers", oldDriverId);
          const odDoc = await getDoc(odRef);
          if (odDoc.exists()) {
            const od = odDoc.data();
            od.activeShipmentsCount = Math.max(0, od.activeShipmentsCount - 1);
            await setDoc(odRef, od);
          }
        }
        if (newDriverId) {
          const ndRef = doc(db, "drivers", newDriverId);
          const ndDoc = await getDoc(ndRef);
          if (ndDoc.exists()) {
            const nd = ndDoc.data();
            nd.activeShipmentsCount += 1;
            await setDoc(ndRef, nd);
          }
        }
      }
      let assignedDriverName = "Unassigned";
      let driverObj = null;
      if (newDriverId) {
        const dDocs = await getDoc(doc(db, "drivers", newDriverId));
        if (dDocs.exists()) {
          driverObj = dDocs.data();
          assignedDriverName = driverObj.name;
        }
      }
      let finalStatus = data.status !== void 0 ? data.status : original.status;
      const timelineCopy = [...original.timeline || []];
      if (data.status !== void 0 && data.status !== original.status) {
        const labelMap = {
          "New": { en: "Initialized", tr: "Olu\u015Fturuldu", ar: "\u062A\u0645 \u0627\u0644\u062A\u0623\u0633\u064A\u0633" },
          "Assigned": { en: "Assigned", tr: "S\xFCr\xFCc\xFC Atand\u0131", ar: "\u062A\u0645 \u0627\u0644\u062A\u0639\u064A\u064A\u0646" },
          "Accepted": { en: "Shipment Accepted", tr: "Sevkiyat Kabul Edildi", ar: "\u062A\u0645 \u0642\u0628\u0648\u0644 \u0627\u0644\u0634\u062D\u0646\u0629" },
          "Loading": { en: "Loading Started", tr: "Y\xFCkleme Ba\u015Flad\u0131", ar: "\u0628\u062F\u0621 \u0627\u0644\u062A\u062D\u0645\u064A\u0644" },
          "Loaded": { en: "Cargo Loaded", tr: "Y\xFCkleme Tamamland\u0131", ar: "\u062A\u0645 \u0627\u0644\u062A\u062D\u0645\u064A\u0644 \u0648\u0627\u0644\u062A\u0639\u0628\u0626\u0629" },
          "In Transit": { en: "On Road (Transit)", tr: "Ta\u015F\u0131ma A\u015Famas\u0131nda", ar: "\u0641\u064A \u0627\u0644\u0637\u0631\u064A\u0642 (\u062A\u0631\u0627\u0646\u0632\u064A\u062A)" },
          "Border Crossing": { en: "Border Processing", tr: "S\u0131n\u0131r Ge\xE7i\u015Finde", ar: "\u0627\u062C\u0631\u0627\u0621\u0627\u062A \u0627\u0644\u0645\u0639\u0628\u0631 \u0627\u0644\u062D\u062F\u0648\u062F\u064A" },
          "Customs Clearance": { en: "Customs Inspection", tr: "G\xFCmr\xFCk \u0130\u015Flemlerinde", ar: "\u0627\u0644\u062A\u062E\u0644\u064A\u0635 \u0627\u0644\u062C\u0645\u0631\u0643\u064A" },
          "Arrived": { en: "Arrived at Destination", tr: "Var\u0131\u015F Noktas\u0131na Ula\u015Ft\u0131", ar: "\u0648\u0635\u0644\u062A \u0625\u0644\u0649 \u0627\u0644\u0648\u062C\u0647\u0629" },
          "Delivered": { en: "Shipment Delivered", tr: "Teslim Edildi", ar: "\u062A\u0645 \u0627\u0644\u062A\u0633\u0644\u064A\u0645" },
          "Closed": { en: "Shipment Closed & Invoiced", tr: "Kapat\u0131ld\u0131 ve Faturaland\u0131r\u0131ld\u0131", ar: "\u0645\u063A\u0644\u0642 \u0648\u0645\u0633\u064A\u0631\u0629 \u0627\u0644\u0641\u0648\u0627\u062A\u064A\u0631" },
          "Booking Confirmed": { en: "Booking Confirmed", tr: "Rezervasyon Onayland\u0131", ar: "\u062A\u0623\u0643\u064A\u062F \u0627\u0644\u062D\u062C\u0632" },
          "Container Released": { en: "Container Released", tr: "Konteyner Serbest B\u0131rak\u0131ld\u0131", ar: "\u0625f\u0631\u0627\u062C \u0627\u0644\u062D\u0627\u0648\u064A\u0629" },
          "Loaded on Vessel": { en: "Loaded on Vessel", tr: "Gemiye Y\xFCklendi", ar: "\u062A\u0645 \u0627\u0644\u0634\u062D\u0646 \u0639\u0644\u0649 \u0627\u0644\u0633\u0641\u064A\u0646\u0629" },
          "Vessel Departed": { en: "Vessel Departed", tr: "Gemi Hareket Etti", ar: "\u0645\u063A\u0627\u062F\u0631\u0629 \u0627\u0644\u0633\u0641\u064A\u0646\u0629" },
          "Arrived at Port": { en: "Arrived at Port", tr: "Limana Ula\u015Ft\u0131", ar: "\u0627\u0644\u0648\u0635\u0648\u0644 \u0625\u0644\u0649 \u0627\u0644\u0645\u064A\u0646\u0627\u0621" },
          "Released": { en: "Released from terminal", tr: "Terminalden \xC7ekildi", ar: "\u0627\u0644\u0625\u0641\u0631\u0627\u062C \u0645\u0646 \u0627\u0644\u0645\u062D\u0637\u0629" },
          "Out for Delivery": { en: "Out for final delivery", tr: "Da\u011F\u0131t\u0131ma \xC7\u0131kt\u0131", ar: "\u062E\u0631\u0648\u062C \u0644\u0644\u062A\u0648\u0635\u064A\u0644 \u0627\u0644\u0646\u0647\u0627\u0626\u064A" },
          "Completed": { en: "Completed & Closed", tr: "Tamamland\u0131 ve Kapat\u0131ld\u0131", ar: "\u0645\u0643\u062A\u0645\u0644 \u0648\u0645\u063A\u0644\u0642" },
          "Cargo Received": { en: "Cargo Received", tr: "Kargo Teslim Al\u0131nd\u0131", ar: "\u062A\u0645 \u0627\u0633\u062A\u0644\u0627\u0645 \u0627\u0644\u0634\u062D\u0646\u0629" },
          "Security Check Completed": { en: "Security Screening Approved", tr: "G\xFCvenlik Taramas\u0131 Onayland\u0131", ar: "\u0627\u0644\u0641\u062D\u0635 \u0627\u0644\u0623\u0645\u0646\u064A \u0648\u0627\u0644\u0631\u0642\u0627\u0628\u064A" },
          "Departed Airport": { en: "Flight Departed", tr: "U\xE7ak Kalk\u0131\u015F Yapt\u0131", ar: "\u0625\u0642\u0644\u0627\u0639 \u0627\u0644\u0637\u0627\u0626\u0631\u0629" },
          "Arrived Airport": { en: "Arrived at Airport Hub", tr: "Havaliman\u0131 Terminaline Ula\u015Ft\u0131", ar: "\u0627\u0644\u0648\u0635\u0648\u0644 \u0625\u0644\u0649 \u0627\u0644\u0645\u0637\u0627\u0631" }
        };
        const labels = labelMap[data.status] || { en: data.status, tr: data.status, ar: data.status };
        timelineCopy.push({
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          status: data.status,
          labelEn: labels.en,
          labelTr: labels.tr,
          labelAr: labels.ar,
          detailsEn: `Status updated manually to ${labels.en} via Operations Panel.`,
          detailsTr: `Durum Operasyon Paneli \xFCzerinden manuel olarak ${labels.tr} olarak g\xFCncellendi.`,
          detailsAr: `\u062A\u0645 \u062A\u062D\u062F\u064A\u062B \u0627\u0644\u062D\u0627\u0644\u0629 \u064A\u062F\u0648\u064A\u0627\u064B \u0625\u0644\u0649 ${labels.ar} \u0639\u0628\u0631 \u0644\u0648\u062D\u0629 \u0627\u0644\u0639\u0645\u0644\u064A\u0627\u062A.`
        });
        await pushNotification(
          original.id,
          original.shipmentNumber,
          "status_update",
          `Status Update: ${data.status}`,
          `Durum G\xFCncellemesi: ${data.status}`,
          `\u062A\u062D\u062F\u064A\u062B \u0627\u0644\u062D\u0627\u0644\u0629: ${data.status}`,
          `Shipment ${original.shipmentNumber} is now ${data.status}.`,
          `Sevkiyat ${original.shipmentNumber} \u015Fu anda ${data.status} konumunda.`,
          `\u0627\u0644\u0634\u062D\u0646\u0629 \u0631\u0642\u0645 ${original.shipmentNumber} \u0627\u0644\u0622\u0646 \u0647\u064A \u0641\u064A \u062D\u0627\u0644\u0629 [${data.status}].`
        );
      }
      const updatedShipment = {
        ...original,
        status: finalStatus,
        timeline: timelineCopy,
        companyName: data.companyName !== void 0 ? data.companyName : original.companyName,
        loadingCountry: data.loadingCountry !== void 0 ? data.loadingCountry : original.loadingCountry,
        loadingCity: data.loadingCity !== void 0 ? data.loadingCity : original.loadingCity,
        loadingAddress: data.loadingAddress !== void 0 ? data.loadingAddress : original.loadingAddress,
        loadingContactNumber: data.loadingContactNumber !== void 0 ? data.loadingContactNumber : original.loadingContactNumber,
        deliveryCountry: data.deliveryCountry !== void 0 ? data.deliveryCountry : original.deliveryCountry,
        deliveryCity: data.deliveryCity !== void 0 ? data.deliveryCity : original.deliveryCity,
        deliveryAddress: data.deliveryAddress !== void 0 ? data.deliveryAddress : original.deliveryAddress,
        deliveryContactNumber: data.deliveryContactNumber !== void 0 ? data.deliveryContactNumber : original.deliveryContactNumber,
        cargoDescription: data.cargoDescription !== void 0 ? data.cargoDescription : original.cargoDescription,
        cargoWeight: data.cargoWeight !== void 0 ? Number(data.cargoWeight) : original.cargoWeight,
        truckNumber: driverObj ? driverObj.truckNumber : data.truckNumber !== void 0 ? data.truckNumber : original.truckNumber,
        assignedDriverId: newDriverId !== void 0 ? newDriverId : original.assignedDriverId,
        assignedDriverName: newDriverId !== void 0 ? assignedDriverName : original.assignedDriverName,
        agreedAmount: data.agreedAmount !== void 0 ? Number(data.agreedAmount) : original.agreedAmount,
        currency: data.currency !== void 0 ? data.currency : original.currency,
        internalNotes: data.internalNotes !== void 0 ? data.internalNotes : original.internalNotes,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        // Add Sea & Air properties to update payload
        freightType: data.freightType !== void 0 ? data.freightType : original.freightType,
        shippingLine: data.shippingLine !== void 0 ? data.shippingLine : original.shippingLine,
        vesselName: data.vesselName !== void 0 ? data.vesselName : original.vesselName,
        containerNumber: data.containerNumber !== void 0 ? data.containerNumber : original.containerNumber,
        bookingNumber: data.bookingNumber !== void 0 ? data.bookingNumber : original.bookingNumber,
        billOfLadingNumber: data.billOfLadingNumber !== void 0 ? data.billOfLadingNumber : original.billOfLadingNumber,
        portOfLoading: data.portOfLoading !== void 0 ? data.portOfLoading : original.portOfLoading,
        portOfDischarge: data.portOfDischarge !== void 0 ? data.portOfDischarge : original.portOfDischarge,
        finalDestination: data.finalDestination !== void 0 ? data.finalDestination : original.finalDestination,
        etd: data.etd !== void 0 ? data.etd : original.etd,
        eta: data.eta !== void 0 ? data.eta : original.eta,
        numberOfContainers: data.numberOfContainers !== void 0 ? Number(data.numberOfContainers) : original.numberOfContainers,
        containerType: data.containerType !== void 0 ? data.containerType : original.containerType,
        airline: data.airline !== void 0 ? data.airline : original.airline,
        flightNumber: data.flightNumber !== void 0 ? data.flightNumber : original.flightNumber,
        airWaybillNumber: data.airWaybillNumber !== void 0 ? data.airWaybillNumber : original.airWaybillNumber,
        airportOfDeparture: data.airportOfDeparture !== void 0 ? data.airportOfDeparture : original.airportOfDeparture,
        airportOfArrival: data.airportOfArrival !== void 0 ? data.airportOfArrival : original.airportOfArrival,
        grossWeight: data.grossWeight !== void 0 ? Number(data.grossWeight) : original.grossWeight,
        chargeableWeight: data.chargeableWeight !== void 0 ? Number(data.chargeableWeight) : original.chargeableWeight,
        numberOfPackages: data.numberOfPackages !== void 0 ? Number(data.numberOfPackages) : original.numberOfPackages
      };
      if (oldDriverId !== newDriverId && newDriverId) {
        if (updatedShipment.status === "New") {
          updatedShipment.status = "Assigned";
          updatedShipment.timeline.push({
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            status: "Assigned",
            labelEn: "Driver Assigned",
            labelTr: "S\xFCr\xFCc\xFC Atand\u0131",
            labelAr: "\u062A\u0645 \u062A\u0639\u064A\u064A\u0646 \u0627\u0644\u0633\u0627\u0626\u0642",
            detailsEn: `Assigned to driver ${assignedDriverName} during shipment update.`,
            detailsTr: `S\xF6zle\u015Fme g\xFCncellemesi s\u0131ras\u0131nda s\xFCr\xFCc\xFC ${assignedDriverName} atand\u0131.`,
            detailsAr: `\u062A\u0645 \u062A\u0639\u064A\u064A\u0646\u0647 \u0644\u0644\u0633\u0627\u0626\u0642  ${assignedDriverName} \u0623\u062B\u0646\u0627\u0621 \u0639\u0645\u0644\u064A\u0629 \u0627\u0644\u062A\u062D\u062F\u064A\u062B.`
          });
          await pushNotification(
            original.id,
            original.shipmentNumber,
            "assignment",
            "New Assignment Assigned",
            "Yeni G\xF6rev Atand\u0131",
            "\u062A\u0645 \u062A\u0639\u064A\u064A\u0646 \u0645\u0647\u0645\u0629 \u062C\u062F\u064A\u062F\u0629",
            `Shipment ${original.shipmentNumber} has been assigned to you.`,
            `Sistem size ${original.shipmentNumber} numaral\u0131 sevkiyat y\xFCk\xFCn\xFC atad\u0131.`,
            `\u062A\u0645 \u062A\u0639\u064A\u064A\u0646 \u0627\u0644\u0634\u062D\u0646\u0629 \u0631\u0642\u0645 ${original.shipmentNumber} \u0644\u0643.`
          );
        }
      }
      await setDoc(sDocRef, updatedShipment);
      await logActivity(
        original.id,
        original.shipmentNumber,
        "Admin Office",
        `Updated shipment parameters for ${original.shipmentNumber}`,
        `${original.shipmentNumber} sevkiyat parametreleri g\xFCncellendi`,
        `\u062A\u0645 \u062A\u062D\u062F\u064A\u062B \u0645\u0639\u0627\u064A\u064A\u0631 \u0627\u0644\u0634\u062D\u0646\u0629 ${original.shipmentNumber}`
      );
      res.json(updatedShipment);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update shipment details" });
    }
  });
  app.put("/api/shipments/:id/status", async (req, res) => {
    try {
      const { status, remarksDesc, updaterName, role } = req.body;
      const shipmentId = req.params.id;
      const sDocRef = doc(db, "shipments", shipmentId);
      const sDoc = await getDoc(sDocRef);
      if (!sDoc.exists()) {
        return res.status(404).json({ error: "Shipment not found" });
      }
      const item = sDoc.data();
      const previousStatus = item.status;
      item.status = status;
      item.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      const labelMap = {
        "New": { en: "Initialized", tr: "Olu\u015Fturuldu", ar: "\u062A\u0645 \u0627\u0644\u062A\u0623\u0633\u064A\u0633" },
        "Assigned": { en: "Assigned", tr: "S\xFCr\xFCc\xFC Atand\u0131", ar: "\u062A\u0645 \u0627\u0644\u062A\u0639\u064A\u064A\u0646" },
        "Accepted": { en: "Shipment Accepted", tr: "Sevkiyat Kabul Edildi", ar: "\u062A\u0645 \u0642\u0628\u0648\u0644 \u0627\u0644\u0634\u062D\u0646\u0629" },
        "Loading": { en: "Loading Started", tr: "Y\xFCkleme Ba\u015Flad\u0131", ar: "\u0628\u062F\u0621 \u0627\u0644\u062A\u062D\u0645\u064A\u0644" },
        "Loaded": { en: "Cargo Loaded", tr: "Y\xFCkleme Tamamland\u0131", ar: "\u062A\u0645 \u0627\u0644\u062A\u062D\u0645\u064A\u0644 \u0648\u0627\u0644\u062A\u0639\u0628\u0626\u0629" },
        "In Transit": { en: "On Road (Transit)", tr: "Ta\u015F\u0131ma A\u015Famas\u0131nda", ar: "\u0641\u064A \u0627\u0644\u0637\u0631\u064A\u0642 (\u062A\u0631\u0627\u0646\u0632\u064A\u062A)" },
        "Border Crossing": { en: "Border Processing", tr: "S\u0131n\u0131r Ge\xE7i\u015Finde", ar: "\u0627\u062C\u0631\u0627\u0621\u0627\u062A \u0627\u0644\u0645\u0639\u0628\u0631 \u0627\u0644\u062D\u062F\u0648\u062F\u064A" },
        "Customs Clearance": { en: "Customs Inspection", tr: "G\xFCmr\xFCk \u0130\u015Flemlerinde", ar: "\u0627\u0644\u062A\u062E\u0644\u064A\u0635 \u0627\u0644\u062C\u0645\u0631\u0643\u064A" },
        "Arrived": { en: "Arrived at Destination", tr: "Var\u0131\u015F Noktas\u0131na Ula\u015Ft\u0131", ar: "\u0648\u0635\u0644\u062A \u0625\u0644\u0649 \u0627\u0644\u0648\u062C\u0647\u0629" },
        "Delivered": { en: "Shipment Delivered", tr: "Teslim Edildi", ar: "\u062A\u0645 \u0627\u0644\u062A\u0633\u0644\u064A\u0645" },
        "Closed": { en: "Shipment Closed & Invoiced", tr: "Kapat\u0131ld\u0131 ve Faturaland\u0131r\u0131ld\u0131", ar: "\u0645\u063A\u0644\u0642 \u0648\u0645\u0633\u064A\u0631\u0629 \u0627\u0644\u0641\u0648\u0627\u062A\u064A\u0631" },
        // Sea status translations
        "Booking Confirmed": { en: "Booking Confirmed", tr: "Rezervasyon Onayland\u0131", ar: "\u062A\u0623\u0643\u064A\u062F \u0627\u0644\u062D\u062C\u0632" },
        "Container Released": { en: "Container Released", tr: "Konteyner Serbest B\u0131rak\u0131ld\u0131", ar: "\u0625\u0641\u0631\u0627\u062C \u0627\u0644\u062D\u0627\u0648\u064A\u0629" },
        "Loaded on Vessel": { en: "Loaded on Vessel", tr: "Gemiye Y\xFCklendi", ar: "\u062A\u0645 \u0627\u0644\u0634\u062D\u0646 \u0639\u0644\u0649 \u0627\u0644\u0633\u0641\u064A\u0646\u0629" },
        "Vessel Departed": { en: "Vessel Departed", tr: "Gemi Hareket Etti", ar: "\u0645\u063A\u0627\u062F\u0631\u0629 \u0627\u0644\u0633\u0641\u064A\u0646\u0629" },
        "Arrived at Port": { en: "Arrived at Port", tr: "Limana Ula\u015Ft\u0131", ar: "\u0627\u0644\u0648\u0635\u0648\u0644 \u0625\u0644\u0649 \u0627\u0644\u0645\u064A\u0646\u0627\u0621" },
        "Released": { en: "Released from terminal", tr: "Terminalden \xC7ekildi", ar: "\u0627\u0644\u0625\u0641\u0631\u0627\u062C \u0645\u0646 \u0627\u0644\u0645\u062D\u0637\u0629" },
        "Out for Delivery": { en: "Out for final delivery", tr: "Da\u011F\u0131t\u0131ma \xC7\u0131kt\u0131", ar: "\u062E\u0631\u0648\u062C \u0644\u0644\u062A\u0648\u0635\u064A\u0644 \u0627\u0644\u0646\u0647\u0627\u0626\u064A" },
        "Completed": { en: "Completed & Closed", tr: "Tamamland\u0131 ve Kapat\u0131ld\u0131", ar: "\u0645\u0643\u062A\u0645\u0644 \u0648\u0645\u063A\u0644\u0642" },
        // Air status translations
        "Cargo Received": { en: "Cargo Received", tr: "Kargo Teslim Al\u0131nd\u0131", ar: "\u062A\u0645 \u0627\u0633\u062A\u0644\u0627\u0645 \u0627\u0644\u0634\u062D\u0646\u0629" },
        "Security Check Completed": { en: "Security Screening Approved", tr: "G\xFCvenlik Taramas\u0131 Onayland\u0131", ar: "\u0627\u0644\u0641\u062D\u0635 \u0627\u0644\u0623\u0645\u0646\u064A \u0648\u0627\u0644\u0631\u0642\u0627\u0628\u064A" },
        "Departed Airport": { en: "Flight Departed", tr: "U\xE7ak Kalk\u0131\u015F Yapt\u0131", ar: "\u0625\u0642\u0644\u0627\u0639 \u0627\u0644\u0637\u0627\u0626\u0631\u0629" },
        "Arrived Airport": { en: "Arrived at Airport Hub", tr: "Havaliman\u0131 Terminaline Ula\u015Ft\u0131", ar: "\u0627\u0644\u0648\u0635\u0648\u0644 \u0625\u0644\u0649 \u0627\u0644\u0645\u0637\u0627\u0631" }
      };
      const labels = labelMap[status] || labelMap["In Transit"];
      item.timeline.push({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        status,
        labelEn: labels.en,
        labelTr: labels.tr,
        labelAr: labels.ar,
        detailsEn: remarksDesc || `Status updated from ${previousStatus} to ${status} by ${updaterName || "System"}.`,
        detailsTr: remarksDesc || `Durum ${updaterName || "Sistem"} taraf\u0131ndan ${previousStatus} seviyesinden ${status} seviyesine \xE7ekildi.`,
        detailsAr: remarksDesc || `\u062A\u0645 \u062A\u062D\u062F\u064A\u062B \u0627\u0644\u062D\u0627\u0644\u0629 \u0645\u0646 ${previousStatus} \u0625\u0644\u0649 ${status} \u0628\u0648\u0627\u0633\u0637\u0629 ${updaterName || "\u0627\u0644\u0646\u0638\u0627\u0645"}.`
      });
      if (status === "Delivered") {
        const dDocRef = doc(db, "drivers", item.assignedDriverId);
        const dDoc = await getDoc(dDocRef);
        if (dDoc.exists()) {
          const driver = dDoc.data();
          driver.activeShipmentsCount = Math.max(0, driver.activeShipmentsCount - 1);
          driver.completedShipmentsCount += 1;
          await setDoc(dDocRef, driver);
        }
      }
      await setDoc(sDocRef, item);
      await pushNotification(
        item.id,
        item.shipmentNumber,
        status === "Accepted" ? "acceptance" : status === "Delivered" ? "delivery" : "status_update",
        `Status Update: ${status}`,
        `Durum G\xFCncellemesi: ${status}`,
        `\u062A\u062D\u062F\u064A\u062B \u0627\u0644\u062D\u0627\u0644\u0629: ${status}`,
        `Shipment ${item.shipmentNumber} is now ${status}.`,
        `Sevkiyat ${item.shipmentNumber} \u015Fu anda ${status} konumunda.`,
        `\u0627\u0644\u0634\u062D\u0646\u0629 \u0631\u0642\u0645 ${item.shipmentNumber} \u0627\u0644\u0622\u0646 \u0647\u064A \u0641\u064A \u062D\u0627\u0644\u0629 [${status}].`
      );
      await logActivity(
        item.id,
        item.shipmentNumber,
        updaterName || role || "System",
        `Changed status of ${item.shipmentNumber} to ${status}`,
        `${item.shipmentNumber} sevkiyat durumunu ${status} olarak g\xFCncelledi`,
        `\u062A\u063A\u064A\u064A\u0631 \u062D\u0627\u0644\u0629 \u0627\u0644\u0634\u062D\u0646\u0629 \u0628\u0631\u0642\u0645 ${item.shipmentNumber} \u0625\u0644\u0649 ${status}`
      );
      res.json(item);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update status" });
    }
  });
  app.get("/api/shipments/:id/chat", async (req, res) => {
    try {
      const col = collection(db, "chatMessages");
      const snapshot = await getDocs(col);
      let msgs = snapshot.docs.map((doc2) => {
        const d = doc2.data();
        return {
          ...d,
          status: d.status || "sent"
        };
      });
      msgs = msgs.filter((m) => m.shipmentId === req.params.id);
      msgs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      res.json(msgs);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to get chat messages" });
    }
  });
  app.post("/api/shipments/:id/chat/seen", async (req, res) => {
    try {
      const shipmentId = req.params.id;
      const { viewer } = req.body;
      if (!viewer) {
        return res.status(400).json({ error: "Viewer is required ('admin' or 'driver')" });
      }
      const col = collection(db, "chatMessages");
      const snapshot = await getDocs(col);
      const batchWrites = [];
      snapshot.docs.forEach((d) => {
        const msg = d.data();
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
  app.post("/api/shipments/:id/chat", async (req, res) => {
    try {
      const shipmentId = req.params.id;
      const { sender, senderName, type, text, fileUrl, fileName, fileCategory } = req.body;
      const sDocRef = doc(db, "shipments", shipmentId);
      const sDoc = await getDoc(sDocRef);
      if (!sDoc.exists()) {
        return res.status(404).json({ error: "Shipment not found" });
      }
      const shipmentItem = sDoc.data();
      const newMessage = {
        id: `msg-${Date.now()}-${Math.floor(Math.random() * 1e3)}`,
        shipmentId,
        sender,
        senderName,
        type,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        status: "sent"
      };
      if (text !== void 0) newMessage.text = text;
      if (fileUrl !== void 0) newMessage.fileUrl = fileUrl;
      if (fileName !== void 0) newMessage.fileName = fileName;
      if (fileCategory !== void 0) newMessage.fileCategory = fileCategory;
      await setDoc(doc(db, "chatMessages", newMessage.id), newMessage);
      if (type === "file" && fileUrl) {
        const docId = `doc-${Date.now()}`;
        const newDoc = {
          id: docId,
          name: fileName || "unnamed_document.bin",
          url: fileUrl,
          category: fileCategory || "other",
          uploadedBy: senderName || (sender === "admin" ? "Admin" : "Driver"),
          uploadedAt: (/* @__PURE__ */ new Date()).toISOString(),
          isSharedExternally: true
        };
        shipmentItem.documents.push(newDoc);
        await setDoc(sDocRef, shipmentItem);
        await logActivity(
          shipmentId,
          shipmentItem.shipmentNumber,
          senderName || sender,
          `Uploaded document [${newDoc.name}] through Chat`,
          `Mesajla\u015Fma paneli \xFCzerinden [${newDoc.name}] belgesini y\xFCkledi`,
          `\u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0645\u0633\u062A\u0646\u062F [${newDoc.name}] \u0645\u0646 \u062E\u0644\u0627\u0644 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629`
        );
        await pushNotification(
          shipmentId,
          shipmentItem.shipmentNumber,
          "doc_upload",
          "New Document Received",
          "Yeni Belge Al\u0131nd\u0131",
          "\u062A\u0645 \u0627\u0633\u062A\u0644\u0627\u0645 \u0645\u0633\u062A\u0646\u062F \u062C\u062F\u064A\u062F",
          `New document '${newDoc.name}' uploaded in shipment ${shipmentItem.shipmentNumber}`,
          `H\u0131zl\u0131 mesajla\u015Fmadan '${newDoc.name}' isimli belge dosyaya kaydedildi.`,
          `\u062A\u0645 \u0625\u0636\u0627\u0641\u0629 \u0645\u0633\u062A\u0646\u062F \u062C\u062F\u064A\u062F \u0628\u0627\u0633\u0645 '${newDoc.name}' \u0641\u064A \u0645\u0644\u0641 \u0627\u0644\u0634\u062D\u0646\u0629 ${shipmentItem.shipmentNumber}`
        );
      } else {
        await pushNotification(
          shipmentId,
          shipmentItem.shipmentNumber,
          "chat",
          `Message: ${senderName}`,
          `Mesaj: ${senderName}`,
          `\u0631\u0633\u0627\u0644\u0629 \u0645\u0646: ${senderName}`,
          text ? text.length > 50 ? `${text.substring(0, 50)}...` : text : "sent an attachment",
          text ? text.length > 50 ? `${text.substring(0, 50)}...` : text : "dosya g\xF6nderildi",
          text ? text.length > 50 ? `${text.substring(0, 50)}...` : text : "\u0623\u0631\u0633\u0644 \u0645\u0644\u0641\u064B\u0627 \u062C\u062F\u064A\u064B\u0627"
        );
      }
      res.status(201).json(newMessage);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to post chat message" });
    }
  });
  app.post("/api/shipments/:id/documents", async (req, res) => {
    try {
      const shipmentId = req.params.id;
      const { name, url, category, uploadedBy, isSharedExternally } = req.body;
      const sDocRef = doc(db, "shipments", shipmentId);
      const sDoc = await getDoc(sDocRef);
      if (!sDoc.exists()) {
        return res.status(404).json({ error: "Shipment not found" });
      }
      const shipmentItem = sDoc.data();
      const docId = `doc-${Date.now()}`;
      const newDoc = {
        id: docId,
        name: name || "document.bin",
        url: url || "#",
        category: category || "other",
        uploadedBy: uploadedBy || "Admin",
        uploadedAt: (/* @__PURE__ */ new Date()).toISOString(),
        isSharedExternally: isSharedExternally !== void 0 ? isSharedExternally : true
      };
      shipmentItem.documents.push(newDoc);
      await setDoc(sDocRef, shipmentItem);
      await logActivity(
        shipmentId,
        shipmentItem.shipmentNumber,
        uploadedBy || "Admin Panel",
        `Uploaded file ${newDoc.name} in Document Center`,
        `Belge Merkezine ${newDoc.name} evrak\u0131n\u0131 y\xFCkledi`,
        `\u062A\u062D\u0645\u064A\u0644 \u0645\u0644\u0641 ${newDoc.name} \u0641\u064A \u0645\u0631\u0643\u0632 \u0627\u0644\u0645\u0633\u062A\u0646\u062F\u0627\u062A \u0644\u0644\u0634\u062D\u0646\u0629`
      );
      res.status(201).json(newDoc);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to upload document" });
    }
  });
  app.put("/api/shipments/:id/documents/:docId/visibility", async (req, res) => {
    try {
      const sDocRef = doc(db, "shipments", req.params.id);
      const sDoc = await getDoc(sDocRef);
      if (!sDoc.exists()) return res.status(404).json({ error: "Shipment not found" });
      const shipment = sDoc.data();
      const docItem = shipment.documents.find((d) => d.id === req.params.docId);
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
  app.post("/api/shipments/:id/share", async (req, res) => {
    try {
      const sDocRef = doc(db, "shipments", req.params.id);
      const sDoc = await getDoc(sDocRef);
      if (!sDoc.exists()) return res.status(404).json({ error: "Shipment not found" });
      const shipment = sDoc.data();
      const { isLinkShared, shareIncludeDocuments, shareIncludePhotos } = req.body;
      if (isLinkShared !== void 0) shipment.isLinkShared = isLinkShared;
      if (shareIncludeDocuments !== void 0) shipment.shareIncludeDocuments = shareIncludeDocuments;
      if (shareIncludePhotos !== void 0) shipment.shareIncludePhotos = shareIncludePhotos;
      await setDoc(sDocRef, shipment);
      res.json(shipment);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to configure share link settings" });
    }
  });
  app.get("/api/share/:token", async (req, res) => {
    try {
      const col = collection(db, "shipments");
      const snapshot = await getDocs(col);
      const list = snapshot.docs.map((doc2) => doc2.data());
      const shipment = list.find((s) => s.shareToken === req.params.token);
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
        documents: shipment.shareIncludeDocuments ? shipment.documents.filter((d) => d.isSharedExternally && d.category !== "photo") : [],
        photos: shipment.shareIncludePhotos ? shipment.documents.filter((d) => d.isSharedExternally && d.category === "photo") : []
      };
      res.json(secureView);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to look up shared tracking link" });
    }
  });
  app.post("/api/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: "Username/Email/Phone and Password are required" });
      }
      const isAdminUser = username.toLowerCase() === "sardar" || username.toLowerCase() === "sardar@maras.iq";
      if (isAdminUser) {
        return res.json({
          success: true,
          role: "admin",
          user: {
            id: "admin",
            name: "MARAS Operations Office",
            username: "admin",
            phone: "+90 212 555 1234",
            email: "sardar@maras.iq"
          }
        });
      }
      const col = collection(db, "drivers");
      const snapshot = await getDocs(col);
      const driversList = snapshot.docs.map((doc2) => doc2.data());
      const normalizedQuery = username.toLowerCase().trim();
      const matchedDriver = driversList.find((d) => {
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
      return res.status(401).json({ error: "Invalid username, email, phone, or password" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Login failed" });
    }
  });
  app.post("/api/verify-session", async (req, res) => {
    try {
      const { role, email, uid, driverId } = req.body;
      const resolvedEmail = (email || "").trim().toLowerCase();
      const isAdminEmail = resolvedEmail === "sardar@maras.iq";
      if (role === "admin" || isAdminEmail) {
        if (!isAdminEmail) {
          return res.status(403).json({
            success: false,
            message: "Forbid: Only the authorized root administrator email is allowed to restore admin sessions."
          });
        }
        return res.json({
          success: true,
          role: "admin",
          user: {
            id: "admin",
            name: "MARAS Operations Office",
            username: "admin",
            phone: "+90 212 555 1234",
            email: "sardar@maras.iq"
          }
        });
      }
      if (role === "driver") {
        const idToCheck = driverId || uid;
        if (!idToCheck) {
          return res.status(400).json({ success: false, message: "Forbid: Missing verification credentials." });
        }
        const col = collection(db, "drivers");
        const snapshot = await getDocs(col);
        const driversList = snapshot.docs.map((doc2) => doc2.data());
        const foundDriver = driversList.find((d) => d.id === idToCheck);
        if (!foundDriver) {
          return res.status(404).json({ success: false, message: "Forbid: Driver ID not found in security system." });
        }
        return res.json({
          success: true,
          role: "driver",
          driver: foundDriver
        });
      }
      return res.status(400).json({ success: false, message: "Invalid session role specified." });
    } catch (err) {
      console.error("Error verifying session server-side:", err);
      res.status(500).json({ error: "Session verification failed.", details: err.message });
    }
  });
  app.get("/api/system/datadog", (req, res) => {
    try {
      const isConfigured = !!process.env.DD_API_KEY;
      const rawKey = process.env.DD_API_KEY || "";
      const maskedKey = rawKey ? rawKey.length > 8 ? rawKey.substring(0, 4) + "..." + rawKey.substring(rawKey.length - 4) : "Configured (Short Format)" : "Not Set";
      res.json({
        enabled: isConfigured,
        service: "e-tir-by-maras-backend",
        env: process.env.NODE_ENV || "development",
        apiKeyMasked: maskedKey,
        status: isConfigured ? "Datadog Tracer online & logging active" : "Tracer offline (add DD_API_KEY to configure)",
        telemetry: {
          runtime: "Node.js",
          version: process.version,
          platform: process.platform
        }
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to retrieve configuration status", details: err.message });
    }
  });
  app.get("/api/drivers", async (req, res) => {
    try {
      const col = collection(db, "drivers");
      const snapshot = await getDocs(col);
      const list = snapshot.docs.map((doc2) => doc2.data());
      res.json(list);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch drivers" });
    }
  });
  app.post("/api/drivers", async (req, res) => {
    try {
      const data = req.body;
      const newDriver = {
        id: data.id || `driver-${Date.now()}`,
        name: data.name || "Unnamed Driver",
        username: data.username || `driver_${Date.now()}`,
        password: data.password || "123456",
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
      const list = snapshot.docs.map((doc2) => doc2.data());
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
      const newClient = {
        id: data.id || `client-${Date.now()}`,
        companyName: data.companyName,
        contactName: data.contactName,
        phone: data.phone || "",
        email: data.email || "",
        address: data.address || "",
        notes: data.notes || "",
        createdAt: data.createdAt || (/* @__PURE__ */ new Date()).toISOString()
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
      const list = snapshot.docs.map((doc2) => doc2.data());
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
      const newVendor = {
        id: data.id || `vendor-${Date.now()}`,
        companyName: data.companyName,
        contactName: data.contactName,
        phone: data.phone || "",
        email: data.email || "",
        address: data.address || "",
        serviceType: data.serviceType,
        notes: data.notes || "",
        createdAt: data.createdAt || (/* @__PURE__ */ new Date()).toISOString()
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
      const { name, username, truckNumber, phone, truckType, latitude, longitude, lastUpdated, avatarUrl } = req.body;
      const dRef = doc(db, "drivers", req.params.id);
      const dDoc = await getDoc(dRef);
      let original = {};
      if (dDoc.exists()) {
        original = dDoc.data();
      } else {
        original = {
          id: req.params.id,
          name: name || "Simulated Specialist",
          username: username || `driver_${req.params.id}`,
          password: "123",
          truckNumber: truckNumber || "TR-7733-IQ",
          phone: phone || "+96400000000",
          truckType: truckType || "reefer",
          activeShipmentsCount: 1,
          completedShipmentsCount: 0
        };
      }
      const updatedDriver = {
        ...original,
        name: name !== void 0 ? name : original.name,
        username: username !== void 0 ? username : original.username,
        truckNumber: truckNumber !== void 0 ? truckNumber : original.truckNumber,
        phone: phone !== void 0 ? phone : original.phone,
        truckType: truckType !== void 0 ? truckType : original.truckType,
        latitude: latitude !== void 0 ? latitude : original.latitude,
        longitude: longitude !== void 0 ? longitude : original.longitude,
        lastUpdated: lastUpdated !== void 0 ? lastUpdated : original.lastUpdated,
        avatarUrl: avatarUrl !== void 0 ? avatarUrl : original.avatarUrl
      };
      await setDoc(dRef, updatedDriver);
      if (name && name !== original.name || truckNumber && truckNumber !== original.truckNumber) {
        const shipCol = collection(db, "shipments");
        const shipSnap = await getDocs(shipCol);
        for (const sDoc of shipSnap.docs) {
          const s = sDoc.data();
          if (s.assignedDriverId === req.params.id) {
            if (name) s.assignedDriverName = name;
            if (truckNumber) s.truckNumber = truckNumber;
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
  app.get("/api/notifications", async (req, res) => {
    try {
      const col = collection(db, "notifications");
      const snapshot = await getDocs(col);
      const list = snapshot.docs.map((doc2) => doc2.data());
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
        const notif = d.data();
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
        const notif = dDoc.data();
        notif.read = true;
        await setDoc(dRef, notif);
      }
      res.json({ status: "success" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to read notification" });
    }
  });
  app.get("/api/cost-statements", async (req, res) => {
    try {
      const col = collection(db, "costStatements");
      const snapshot = await getDocs(col);
      const list = snapshot.docs.map((doc2) => doc2.data());
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
        res.json(dDoc.data());
      } else {
        const sRef = doc(db, "shipments", req.params.shipmentId);
        const sDoc = await getDoc(sRef);
        if (sDoc.exists()) {
          const s = sDoc.data();
          const templateStatement = {
            shipmentId: s.id,
            shipmentNumber: s.shipmentNumber,
            companyName: s.companyName,
            shipmentType: s.freightType || "land",
            date: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
            currency: s.currency || "USD",
            totalCost: 0,
            paidAmount: 0,
            remainingBalance: 0,
            paymentStatus: "Unpaid",
            notes: "",
            items: [],
            createdAt: (/* @__PURE__ */ new Date()).toISOString(),
            updatedAt: (/* @__PURE__ */ new Date()).toISOString()
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
      const data = req.body;
      const sRef = doc(db, "shipments", shipmentId);
      const sDoc = await getDoc(sRef);
      if (!sDoc.exists() && !useMemoryFallback) {
        return res.status(404).json({ error: "Shipment not found" });
      }
      const items = data.items || [];
      const totalCost = items.reduce((sum, item) => sum + (Number(item.totalAmount) || 0), 0);
      const paidAmount = Number(data.paidAmount) || 0;
      const remainingBalance = totalCost - paidAmount;
      const paymentStatus = remainingBalance <= 0 && totalCost > 0 ? "Paid" : paidAmount > 0 ? "Partial" : "Unpaid";
      const finalStatement = {
        shipmentId,
        shipmentNumber: data.shipmentNumber || "",
        companyName: data.companyName || "",
        shipmentType: data.shipmentType || "land",
        date: data.date || (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
        currency: data.currency || "USD",
        totalCost,
        paidAmount,
        remainingBalance,
        paymentStatus,
        notes: data.notes || "",
        items,
        createdAt: data.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      const dRef = doc(db, "costStatements", shipmentId);
      await setDoc(dRef, finalStatement);
      try {
        const logId = `log-${Date.now()}`;
        const logCol = collection(db, "activityLogs");
        const logData = {
          id: logId,
          shipmentId,
          shipmentNumber: finalStatement.shipmentNumber,
          actionEn: `Cost statement updated for shipment ${finalStatement.shipmentNumber}`,
          actionTr: `${finalStatement.shipmentNumber} numaral\u0131 sevkiyat i\xE7in maliyet tablosu g\xFCncellendi`,
          actionAr: `\u062A\u0645 \u062A\u062D\u062F\u064A\u062B \u0643\u0634\u0641 \u0627\u0644\u062A\u0643\u0644\u0641\u0629 \u0644\u0644\u0634\u062D\u0646\u0629 ${finalStatement.shipmentNumber}`,
          actor: "Accounting / Admin",
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
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
  app.get("/api/logs", async (req, res) => {
    try {
      const col = collection(db, "activityLogs");
      const snapshot = await getDocs(col);
      const list = snapshot.docs.map((doc2) => doc2.data());
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
  app.get("/api/chat/unread", async (req, res) => {
    try {
      const col = collection(db, "chatMessages");
      const snapshot = await getDocs(col);
      const unreadMsgs = snapshot.docs.map((doc2) => doc2.data()).filter((m) => m.sender !== "admin" && m.status !== "seen");
      unreadMsgs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      res.json(unreadMsgs);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch unread chat messages", details: err.message });
    }
  });
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Shipment controller server bound and rolling on port ${PORT}`);
  });
}
startServer().catch((err) => {
  console.error("Failed to start MARAS server: ", err);
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  db,
  useMemoryFallback
});
//# sourceMappingURL=server.cjs.map
