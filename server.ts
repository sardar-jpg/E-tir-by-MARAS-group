import "./src/lib/loadEnv";
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
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { initializeApp as initializeAdminApp, getApps as getAdminApps } from "firebase-admin/app";
import { getMessaging, Messaging } from "firebase-admin/messaging";
import { getAuth as getAdminAuth, Auth as AdminAuth } from "firebase-admin/auth";
import {
  SessionRole as AuthSessionRole,
  SessionPayload as AuthSessionPayload,
  SESSION_TTL_MS as AUTH_SESSION_TTL_MS,
  signSessionToken as signSessionTokenImpl,
  verifySessionToken as verifySessionTokenImpl,
  hashPassword,
  verifyPassword,
  verifyPasswordWithMigration,
  GENERIC_LOGIN_ERROR,
} from "./src/lib/auth";
import { buildShipmentViewForRole } from "./src/lib/shipmentView";
import {
  filterChatMessagesByRole,
  resolveOutgoingChatChannel,
  resolveSeenChannelFilter,
  shouldNotifyChatParty,
  isChatNotificationVisibleToRole,
  canAccessInternalStaffChannel,
  shouldSaveChatFileAsShipmentDocument
} from "./src/lib/chatVisibility";
import { stripPassword } from "./src/lib/sanitize";
import { sanitizeDriver, scopeDriverListForSession } from "./src/lib/driverVisibility";
import { findDuplicateDriverField, resolveDriverLoginBlock, isDriverAssignmentSafe } from "./src/lib/driverAccess";
import { canViewShipmentRegistry, canViewDriverRoster, canViewAdminRoster, canViewClients, canViewVendors, canViewCostStatements, canWriteCostStatements, canViewAuditLogs, canWriteAuditLogs, resolveFullAdminStatus, sanitizeCreatedAdminType, isProtectedOwnerAccount, canDeleteAdminAccount } from "./src/lib/adminAccess";
import { resolveCorsOrigin, parseAllowedOriginsFromEnv } from "./src/lib/cors";
import { isDocumentVisibleForShare, resolveNewDocumentSharedExternally, canDriverUploadDocumentCategory } from "./src/lib/documentAccess";
import { resolveClientAccountDeleteAuthorization, buildClientUsernameField, buildClientPasswordUpdateField, normalizeClientUsername, matchesClientLoginIdentifier, hasDuplicateClientUsername, isShipmentVisibleToClientCompany, isClientAccountActive, resolveClientCreationCompany, validateStaffCredentials } from "./src/lib/clientAccess";
import { canDeletePushToken } from "./src/lib/pushTokenAccess";
import { buildSecureShareView } from "./src/lib/publicShareView";
import { computePersistenceReadiness } from "./src/lib/persistenceReadiness";
import { validateUpload } from "./src/lib/uploadValidation";
import { sanitizeLogInput, maskLoginIdentifier } from "./src/lib/activityLogInput";
import {
  resolveRouteCoords,
  haversineKm,
  isLandFreight,
  UNAVAILABLE_DISTANCE_MATRIX_RESPONSE,
} from "./src/lib/distanceMatrix";
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
  runTransaction as rawRunTransaction,
  query,
  where,
  orderBy,
  limit
} from "firebase/firestore";
import {
  formatShipmentNumber,
  formatShipmentId,
  nextSequenceFromCounterDoc,
  InMemorySequenceCounter,
  ShipmentSequenceCounterDoc,
} from "./src/lib/shipmentNumbering";

export let useMemoryFallback = false;

// Memory-fallback data safety controls.
// STRICT_PERSISTENCE is ON by default. When Firestore is unavailable,
// writes must not silently fall back to volatile in-memory storage.
const STRICT_PERSISTENCE = process.env.STRICT_PERSISTENCE !== "false";

// Demo seed data is OFF by default so production outages never show
// fabricated/demo records as real operational data.
const SEED_DEMO_DATA = process.env.SEED_DEMO_DATA === "true";

// Local-dev login safety net: when SERVER_FIREBASE_EMAIL/PASSWORD are
// missing, the app falls back to the in-memory store above, but nothing
// seeds it unless SEED_DEMO_DATA=true — so a fresh `npm run dev` checkout
// has no accounts to log in with. This is independent of SEED_DEMO_DATA
// (which seeds a large realistic dataset): it seeds exactly one demo
// account per role, hashed with the same pbkdf2 hashPassword() the real
// login flow uses, and only outside production, whether or not the
// fallback is active — getMemoryStore() is only ever reached once the
// fallback already is.
const IS_LOCAL_DEV = process.env.NODE_ENV !== "production";
const DEMO_ACCOUNTS = IS_LOCAL_DEV
  ? {
      admin: { email: "admin@demo.local", password: "DemoAdmin123!" },
      // Local-only alias so the real owner email can be used to log into the
      // memory fallback without touching SUPER_ADMIN_EMAIL/PASSWORD_HASH
      // (the production super-admin credentials). Never a real password;
      // only ever seeded outside production, alongside the other demo
      // accounts above.
      owner: { email: "sardar@maras.iq", password: "LocalOwner123!" },
      driver: { username: "demo_driver", email: "driver@demo.local", password: "DemoDriver123!" },
      client: { username: "demo_client", email: "client@demo.local", password: "DemoClient123!" },
      // Client Staff (Client.isEmployee) demo login, tied to the same
      // "Demo Client Co." company as the demo_client owner account above —
      // see clientAccess.ts for why this is a separate Firestore/memory
      // record rather than a flag on the owner. Local/dev-only, same as
      // every other DEMO_ACCOUNTS entry.
      clientStaff: { username: "demo_client_staff", email: "client.staff@demo.local", password: "DemoClientStaff123!" },
    }
  : null;

class ServiceUnavailableError extends Error {
  readonly code = "SERVICE_UNAVAILABLE";
  readonly retryable = true;

  constructor(message = "Database temporarily unavailable. Please try again.") {
    super(message);
    this.name = "ServiceUnavailableError";
  }
}


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
    scheduleFirestoreRecovery(30_000);
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
    scheduleFirestoreRecovery(30_000);
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
  admins: any[];
  costStatements: CostStatement[];
  // PR #44: was missing from this store entirely — every read/write
  // against the "pushTokens" collection (register, delete, and the
  // admin-token lookup pushNotification does before sending) resolved
  // against `mStore[colName]` being undefined and silently no-opped, so
  // push token registration was a no-op and push notifications could
  // never be sent while running on the memory fallback (no live
  // Firestore credentials, e.g. local dev). Every other collection this
  // server writes to already has an entry here; this one was just missed.
  pushTokens: any[];
  test: any[];
  // BUG-15: allocates shipment sequence numbers when running on the
  // memory fallback. Lazily created (see getShipmentSequenceCounter)
  // rather than seeded here, since its initial value depends on how many
  // shipments are already in memoryStore.shipments at first use.
  shipmentSequenceCounter: InMemorySequenceCounter | null;
} | null = null;

function getMemoryStore() {
  if (!memoryStore) {
    memoryStore = {
      drivers: [...(SEED_DEMO_DATA ? (initialDrivers || []) : [])],
      shipments: [...(SEED_DEMO_DATA ? (initialShipments || []) : [])],
      chatMessages: [...(SEED_DEMO_DATA ? (initialChatMessages || []) : [])],
      notifications: [...(SEED_DEMO_DATA ? (initialNotifications || []) : [])],
      activityLogs: [...(SEED_DEMO_DATA ? (initialActivityLogs || []) : [])],
      clients: [...(SEED_DEMO_DATA ? (initialClients || []) : [])],
      vendors: [...(SEED_DEMO_DATA ? (initialVendors || []) : [])],
      admins: [],
      costStatements: [],
      pushTokens: [],
      test: [{ id: "connection", status: "ok" }],
      shipmentSequenceCounter: null
    };

    if (DEMO_ACCOUNTS) {
      memoryStore.admins.push({
        id: "demo-admin",
        name: "Demo Admin",
        email: DEMO_ACCOUNTS.admin.email,
        password: hashPassword(DEMO_ACCOUNTS.admin.password),
        adminType: "super",
        createdAt: new Date().toISOString(),
      });
      memoryStore.admins.push({
        id: "demo-owner",
        name: "Sardar (Local Owner)",
        email: DEMO_ACCOUNTS.owner.email,
        password: hashPassword(DEMO_ACCOUNTS.owner.password),
        adminType: "super",
        createdAt: new Date().toISOString(),
      });
      memoryStore.drivers.push({
        id: "demo-driver",
        name: "Demo Driver",
        username: DEMO_ACCOUNTS.driver.username,
        email: DEMO_ACCOUNTS.driver.email,
        password: hashPassword(DEMO_ACCOUNTS.driver.password),
        truckNumber: "DEMO-0001",
        phone: "+1 000 000 0000",
        activeShipmentsCount: 0,
        completedShipmentsCount: 0,
        status: "approved",
      });
      memoryStore.clients.push({
        id: "demo-client",
        companyName: "Demo Client Co.",
        contactName: "Demo Client",
        phone: "+1 000 000 0001",
        email: DEMO_ACCOUNTS.client.email,
        address: "N/A",
        username: DEMO_ACCOUNTS.client.username,
        password: hashPassword(DEMO_ACCOUNTS.client.password),
        createdAt: new Date().toISOString(),
      });
      // Client Staff demo login: its own Client record (own id/username/
      // password), attached to the same "Demo Client Co." companyName as
      // the owner above so it gets identical customer-safe shipment/chat
      // scoping, with isEmployee: true purely to identify it as staff
      // (isClientStaffAccount) — it can self-delete its own login exactly
      // like the owner (resolveClientAccountDeleteAuthorization), but
      // still cannot manage/delete any *other* account.
      memoryStore.clients.push({
        id: "demo-client-staff",
        companyName: "Demo Client Co.",
        contactName: "Demo Client Staff (local/demo only)",
        phone: "+1 000 000 0002",
        email: DEMO_ACCOUNTS.clientStaff.email,
        address: "N/A",
        username: DEMO_ACCOUNTS.clientStaff.username,
        password: hashPassword(DEMO_ACCOUNTS.clientStaff.password),
        isEmployee: true,
        createdAt: new Date().toISOString(),
      });

      console.log("\n[local dev] Memory fallback is active — seeded demo accounts for local login:");
      console.log(`  Admin        -> username: ${DEMO_ACCOUNTS.admin.email}   password: ${DEMO_ACCOUNTS.admin.password}`);
      console.log(`  Owner        -> username: ${DEMO_ACCOUNTS.owner.email}   password: ${DEMO_ACCOUNTS.owner.password}`);
      console.log(`  Driver       -> username: ${DEMO_ACCOUNTS.driver.username}   password: ${DEMO_ACCOUNTS.driver.password}`);
      console.log(`  Client       -> username: ${DEMO_ACCOUNTS.client.username}   password: ${DEMO_ACCOUNTS.client.password}`);
      console.log(`  Client Staff -> username: ${DEMO_ACCOUNTS.clientStaff.username}   password: ${DEMO_ACCOUNTS.clientStaff.password}\n`);
    }
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
    // PR #84 (Firebase production readiness): every write wrapper below
    // (setDoc/updateDoc/deleteDoc/addDoc/allocateNextShipmentSequence)
    // already refuses to silently use the memory fallback when
    // STRICT_PERSISTENCE is on — but reads didn't, so a mid-session
    // Firestore outage in production used to make every GET endpoint
    // return successfully with data from an empty, unrelated in-memory
    // store (SEED_DEMO_DATA is off in prod) instead of failing loudly.
    // That looks exactly like every shipment/driver/client record just
    // vanished, while writes correctly 500'd — a confusing and dangerous
    // mismatch. Reads must fail the same way writes do.
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return handleGetDocsMemory(queryRef);
  }
  try {
    return await withTimeout(rawGetDocs(queryRef), 5000, "Firestore getDocs query timed out");
  } catch (error) {
    console.warn("Firestore getDocs failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    scheduleFirestoreRecovery(30_000);
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return handleGetDocsMemory(queryRef);
  }
}

async function getDoc(docRef: any) {
  if (useMemoryFallback) {
    // See getDocs above — same reasoning, same fix.
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return handleGetDocMemory(docRef);
  }
  try {
    return await withTimeout(rawGetDoc(docRef), 5000, "Firestore getDoc query timed out");
  } catch (error) {
    console.warn("Firestore getDoc failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    scheduleFirestoreRecovery(30_000);
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
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

// Generates an unguessable public share token. Previous tokens were
// sequential ("token-1001", "token-1002", ...) and so could be trivially
// enumerated to read any shared shipment without auth. A random token closes
// that hole. Old "token-..." values are migrated to a fresh random one the
// next time sharing is (re)configured for a shipment — see the /share route.
function generateShareToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

// True for the old, guessable sequential tokens that must be rotated.
function isLegacyShareToken(token: string | undefined | null): boolean {
  return !token || /^token-\d+$/.test(token);
}

async function setDoc(docRef: any, data: any, options?: any) {
  const cleanedData = cleanUndefined(data);
  if (useMemoryFallback) {
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return handleSetDocMemory(docRef, cleanedData);
  }
  try {
    return await withTimeout(rawSetDoc(docRef, cleanedData, options), 5000, "Firestore setDoc timed out");
  } catch (error) {
    console.warn("Firestore setDoc failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    scheduleFirestoreRecovery(30_000);
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return handleSetDocMemory(docRef, cleanedData);
  }
}

async function updateDoc(docRef: any, data: any) {
  const cleanedData = cleanUndefined(data);
  if (useMemoryFallback) {
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return handleUpdateDocMemory(docRef, cleanedData);
  }
  try {
    return await withTimeout(rawUpdateDoc(docRef, cleanedData), 5000, "Firestore updateDoc timed out");
  } catch (error) {
    console.warn("Firestore updateDoc failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    scheduleFirestoreRecovery(30_000);
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return handleUpdateDocMemory(docRef, cleanedData);
  }
}

async function deleteDoc(docRef: any) {
  if (useMemoryFallback) {
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return handleDeleteDocMemory(docRef);
  }
  try {
    return await withTimeout(rawDeleteDoc(docRef), 5000, "Firestore deleteDoc timed out");
  } catch (error) {
    console.warn("Firestore deleteDoc failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    scheduleFirestoreRecovery(30_000);
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return handleDeleteDocMemory(docRef);
  }
}

async function addDoc(colRef: any, data: any) {
  const cleanedData = cleanUndefined(data);
  if (useMemoryFallback) {
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return handleAddDocMemory(colRef, cleanedData);
  }
  try {
    return await withTimeout(rawAddDoc(colRef, cleanedData), 5000, "Firestore addDoc timed out");
  } catch (error) {
    console.warn("Firestore addDoc failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    scheduleFirestoreRecovery(30_000);
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return handleAddDocMemory(colRef, cleanedData);
  }
}

// BUG-15: shipment number/id generation used to read the shipments
// collection's current size, add 1001 in JS, and write the new shipment
// with that number - with no coordination between two concurrent create
// requests, both could read the same size and hand out the same
// shipmentNumber/id. This replaces that read/increment/write with a
// dedicated counter doc allocated via a Firestore transaction (or, when
// Firestore is unavailable, the single-threaded InMemorySequenceCounter),
// so a sequence number can only ever be handed out once.
function getShipmentSequenceCounterMemory(): InMemorySequenceCounter {
  const mStore = getMemoryStore();
  if (!mStore.shipmentSequenceCounter) {
    // Bootstraps from however many shipments already exist in the memory
    // store, so numbering continues where the old count-based approach
    // left off instead of restarting at 0.
    mStore.shipmentSequenceCounter = new InMemorySequenceCounter(mStore.shipments.length);
  }
  return mStore.shipmentSequenceCounter;
}

async function allocateNextShipmentSequence(): Promise<number> {
  if (useMemoryFallback || !db) {
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return getShipmentSequenceCounterMemory().next();
  }

  const counterRef = rawDoc(db, "counters", "shipments");
  try {
    // Firestore transactions can only read individual documents, not run
    // a collection query, so the one-time bootstrap value (how many
    // shipments already exist) has to be read before the transaction
    // starts. It's only used the first time this ever runs, when the
    // counter doc doesn't exist yet; from then on the counter doc itself
    // is authoritative and this pre-read value is discarded.
    let bootstrapCount = 0;
    const existingCounter = await withTimeout(rawGetDoc(counterRef), 5000, "Firestore getDoc timed out");
    if (!existingCounter.exists()) {
      const existingShipments = await withTimeout(
        rawGetDocs(rawCollection(db, "shipments")),
        5000,
        "Firestore getDocs timed out"
      );
      bootstrapCount = existingShipments.size;
    }

    // The transaction is what actually makes this safe: Firestore aborts
    // and automatically retries this callback if the counter document was
    // modified by anyone else between the read below and the commit, so
    // two concurrent creates can never both read the same count and
    // successfully commit - one is always retried against the value the
    // other just wrote, and reads the incremented value instead.
    return await withTimeout(
      rawRunTransaction(db, async (tx) => {
        const snap = await tx.get(counterRef);
        const data = snap.exists() ? (snap.data() as ShipmentSequenceCounterDoc) : undefined;
        const { current, next } = nextSequenceFromCounterDoc(data, bootstrapCount);
        tx.set(counterRef, next, { merge: true });
        return current;
      }),
      5000,
      "Firestore transaction timed out"
    );
  } catch (error) {
    console.warn("Firestore shipment sequence transaction failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    scheduleFirestoreRecovery(30_000);
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return getShipmentSequenceCounterMemory().next();
  }
}
import { 
  Shipment,
  Driver,
  ChatMessage,
  ChatChannel,
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

// Augment Express's Request type so handlers can read req.session
// and req.shipment (attached by requireShipmentAccess in startServer below).
// This must be at the top level of the module, not nested inside any
// function — esbuild's bundler does not reliably handle a `declare global`
// block nested inside a function body the way `tsc` does, which caused a
// real build failure here once before.
declare global {
  namespace Express {
    interface Request {
      session?: AuthSessionPayload;
      shipment?: Shipment;
    }
  }
}

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

// Firebase Admin SDK, used only for sending push notifications via FCM.
// No explicit credentials are passed - on Cloud Run this automatically
// uses the instance's own service account (Application Default
// Credentials), so no separate key file needs to be managed or shipped
// in the container. This is intentionally separate from the client SDK
// app above, which signs in as a real Firestore-rules-scoped user for
// reading/writing data; sending pushes is an unrelated capability.
let pushMessaging: Messaging | null = null;
// Admin Auth instance — used to VERIFY Firebase ID tokens that clients send
// when restoring a session. This is how /api/verify-session proves who the
// caller actually is, instead of trusting a client-supplied id/email.
let adminAuth: AdminAuth | null = null;
try {
  const adminApp = getAdminApps().length ? getAdminApps()[0]! : initializeAdminApp();
  pushMessaging = getMessaging(adminApp);
  adminAuth = getAdminAuth(adminApp);
} catch (err: any) {
  console.warn("Firebase Admin SDK initialization failed - push notifications and server-side ID token verification will be disabled. Error:", err instanceof Error ? err.message : String(err));
}

// One clear, consolidated startup summary — everything below this point
// (Firestore connection attempts, seeding) logs incrementally as it
// happens, which made it easy to miss what mode the server actually
// started in. This is the single place to look. Never logs secret values,
// only whether they're present. See src/lib/persistenceReadiness.ts.
{
  const readiness = computePersistenceReadiness(process.env, !!firebaseConfig);
  console.log("──────────────────────────────────────────────────────────");
  console.log(`[Startup] NODE_ENV: ${process.env.NODE_ENV || "development"} (production: ${readiness.isProduction})`);
  console.log(`[Startup] STRICT_PERSISTENCE: ${readiness.strictPersistence} (writes fail instead of using memory fallback when true)`);
  console.log(`[Startup] SEED_DEMO_DATA: ${readiness.seedDemoData}`);
  console.log(`[Startup] Firebase client config found: ${readiness.firebaseConfigured}`);
  console.log(`[Startup] SERVER_FIREBASE_EMAIL/PASSWORD configured: ${readiness.serverFirebaseCredsConfigured}`);
  console.log(`[Startup] Configured persistence mode: ${readiness.configuredMode} (pending live Firestore connection check below)`);
  if (readiness.warnings.length) {
    for (const warning of readiness.warnings) {
      console.warn(`[Startup] WARNING: ${warning}`);
    }
  } else {
    console.log("[Startup] No production safety warnings.");
  }
  console.log("──────────────────────────────────────────────────────────");
}

// Test Firestore Connection
// IMPORTANT: this server now authenticates as a dedicated Firebase Auth
// account (configured via SERVER_FIREBASE_EMAIL / SERVER_FIREBASE_PASSWORD)
// before it can read or write anything. firestore.rules denies all access
// except from this specific account's UID — see firestore.rules for why.
// Without successful sign-in here, every Firestore call below will be
// rejected by the security rules and the app will run on the in-memory
// fallback store instead (logged loudly, since silent data loss is far
// worse than a visible startup error).
async function authenticateServerAccount(): Promise<boolean> {
  if (!firebaseApp) return false;
  const email = process.env.SERVER_FIREBASE_EMAIL;
  const password = process.env.SERVER_FIREBASE_PASSWORD;
  if (!email || !password) {
    console.error(
      "[STARTUP ERROR] SERVER_FIREBASE_EMAIL / SERVER_FIREBASE_PASSWORD are not set. " +
      "The server cannot authenticate to Firestore and firestore.rules will reject every " +
      "request. Falling back to in-memory storage — ALL DATA WILL BE LOST ON RESTART. " +
      "Set these two environment variables to the dedicated server account created in " +
      "Firebase Console > Authentication."
    );
    return false;
  }
  try {
    const auth = getAuth(firebaseApp);
    await signInWithEmailAndPassword(auth, email, password);
    console.log("Server authenticated to Firebase as the dedicated server account.");
    return true;
  } catch (err: any) {
    console.error(
      "[STARTUP ERROR] Server failed to authenticate to Firebase:",
      err instanceof Error ? err.message : String(err),
      "— falling back to in-memory storage. ALL DATA WILL BE LOST ON RESTART."
    );
    return false;
  }
}

// One probe attempt. Sets useMemoryFallback = false on success, returns true/false.
async function attemptFirestoreConnect(timeoutMs: number): Promise<boolean> {
  if (!db) return false;
  const authed = await authenticateServerAccount();
  if (!authed) return false;
  try {
    await withTimeout(rawGetDoc(rawDoc(db, "test", "connection")), timeoutMs, "Firestore connection check timed out");
    console.log(`[Firestore] Connected to database (${initialId}).`);
    useMemoryFallback = false;
    return true;
  } catch (err: any) {
    console.warn(`[Firestore] Connection check failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

// Idempotent: schedules one background retry at delayMs, doubling on each miss up to 5 min.
let _recoveryTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleFirestoreRecovery(delayMs: number): void {
  if (_recoveryTimer !== null) return;
  _recoveryTimer = setTimeout(async () => {
    _recoveryTimer = null;
    const ok = await attemptFirestoreConnect(10_000);
    if (ok) {
      seedDatabaseIfEmpty().catch(err => console.warn("[Firestore] Post-recovery seeding failed:", err));
    } else {
      scheduleFirestoreRecovery(Math.min(delayMs * 2, 5 * 60_000));
    }
  }, delayMs);
}

// Startup path: 3 attempts with escalating timeouts, then hands off to background recovery.
async function startFirestoreConnection(): Promise<void> {
  if (!db) {
    useMemoryFallback = true;
    return;
  }
  const attempts: Array<{ timeout: number; wait: number }> = [
    { timeout: 5_000, wait: 3_000 },
    { timeout: 10_000, wait: 5_000 },
    { timeout: 15_000, wait: 0 },
  ];
  for (let i = 0; i < attempts.length; i++) {
    if (i > 0) console.log(`[Firestore] Startup retry ${i}/${attempts.length - 1}...`);
    const ok = await attemptFirestoreConnect(attempts[i].timeout);
    if (ok) return;
    if (attempts[i].wait > 0) await new Promise<void>(r => setTimeout(r, attempts[i].wait));
  }
  console.warn("[Firestore] All startup connection attempts failed — serving from memory fallback. Background recovery scheduled.");
  useMemoryFallback = true;
  scheduleFirestoreRecovery(30_000);
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
    password: "pbkdf2$0ff843709b3e5a883ce174e4ac26120a$69d4034b22e818737e4429c3f303ee95e0ec74c7c6c343a79ad16da61f5656c4922225067c85348742876bf47c6cec804984b6fb2b7462473d3472a62f013947", // hashed (was plaintext "client123") — demo seed data only
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
    password: "pbkdf2$0ff843709b3e5a883ce174e4ac26120a$69d4034b22e818737e4429c3f303ee95e0ec74c7c6c343a79ad16da61f5656c4922225067c85348742876bf47c6cec804984b6fb2b7462473d3472a62f013947", // hashed (was plaintext "client123") — demo seed data only
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
    password: "pbkdf2$0ff843709b3e5a883ce174e4ac26120a$69d4034b22e818737e4429c3f303ee95e0ec74c7c6c343a79ad16da61f5656c4922225067c85348742876bf47c6cec804984b6fb2b7462473d3472a62f013947", // hashed (was plaintext "client123") — demo seed data only
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
    password: "pbkdf2$f9b0115c5f99f2541e0ba23085e2fe04$0b6e9232efdf4d135a685751d05bc563c6dd70ba6342cfba94ec5f4cee0469f1432008c80bf116da4703d792d3c6b777f34b836154265d04cefc2e6b0e2a7559", // hashed (was plaintext "123456") — demo seed data only
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
    password: "pbkdf2$f9b0115c5f99f2541e0ba23085e2fe04$0b6e9232efdf4d135a685751d05bc563c6dd70ba6342cfba94ec5f4cee0469f1432008c80bf116da4703d792d3c6b777f34b836154265d04cefc2e6b0e2a7559", // hashed (was plaintext "123456") — demo seed data only
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
    password: "pbkdf2$f9b0115c5f99f2541e0ba23085e2fe04$0b6e9232efdf4d135a685751d05bc563c6dd70ba6342cfba94ec5f4cee0469f1432008c80bf116da4703d792d3c6b777f34b836154265d04cefc2e6b0e2a7559", // hashed (was plaintext "123456") — demo seed data only
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
    password: "pbkdf2$f9b0115c5f99f2541e0ba23085e2fe04$0b6e9232efdf4d135a685751d05bc563c6dd70ba6342cfba94ec5f4cee0469f1432008c80bf116da4703d792d3c6b777f34b836154265d04cefc2e6b0e2a7559", // hashed (was plaintext "123456") — demo seed data only
    truckNumber: "LEB-45210",
    phone: "+961 3 124 567",
    // shipment-1003 (previously assigned to this driver) now seeds to
    // demo-driver instead — see initialShipments.
    activeShipmentsCount: 0,
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
    isLinkShared: false,
    shareToken: generateShareToken(),
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
    isLinkShared: false,
    shareToken: generateShareToken(),
    shareIncludeDocuments: true,
    shareIncludePhotos: false
  },
  {
    id: "shipment-1003",
    shipmentNumber: "MAR-2026-1003",
    // Assigned to the demo driver/client accounts (rather than driver-4 /
    // Karwan Foods) so demo_driver and demo_client each have at least one
    // visible shipment right after a fresh `npm run dev` with
    // SEED_DEMO_DATA=true — otherwise their dashboards are empty until an
    // admin manually reassigns a shipment.
    companyName: "Demo Client Co.",
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
    truckNumber: "DEMO-0001",
    assignedDriverId: "demo-driver",
    assignedDriverName: "Demo Driver",
    agreedAmount: 2800,
    currency: "TRY",
    internalNotes: "Needs temperature tracking, even though products are shelf-stable, keep ventilated.",
    status: "Accepted",
    // Driver App Simplification / CMR Read-Only Review (PR #71): this is the
    // local/dev manual-review fixture for the demo_driver account (see
    // docs/FOLLOW_UP_ROADMAP.md, "Driver review demo scenario") — one
    // admin-sent CMR (view/download only, isDocumentVisibleToDriver allows
    // 'cmr'), one admin-sent non-CMR operational document, and one
    // admin-sent invoice that must NOT be visible to the driver
    // (isDocumentVisibleToDriver blocks 'invoice' — this is the
    // "internal/accounting/customer document" a reviewer should confirm
    // stays hidden).
    documents: [
      {
        id: "doc-1003-cmr",
        name: "CMR_MAR-2026-1003.pdf",
        url: "#",
        category: "cmr",
        uploadedBy: "Admin",
        uploadedAt: "2026-05-31T15:00:00Z",
        isSharedExternally: true
      },
      {
        id: "doc-1003-packing",
        name: "PackingList_MAR-2026-1003.pdf",
        url: "#",
        category: "packing_list",
        uploadedBy: "Admin",
        uploadedAt: "2026-05-31T15:05:00Z",
        isSharedExternally: false
      },
      {
        id: "doc-1003-invoice",
        name: "Invoice_DemoClientCo-1003.pdf",
        url: "#",
        category: "invoice",
        uploadedBy: "Admin",
        uploadedAt: "2026-05-31T15:10:00Z",
        isSharedExternally: false
      }
    ],
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
        detailsEn: "Assigned to Demo Driver and truck DEMO-0001.",
        detailsTr: "Demo Driver ve DEMO-0001 numaralı tırına atandı.",
        detailsAr: "تم التعيين لـ Demo Driver والشاحنة DEMO-0001."
      },
      {
        timestamp: "2026-05-31T16:00:00Z",
        status: "Accepted",
        labelEn: "Order Accepted by Driver",
        labelTr: "Sürücü Siparişi Kabul Etti",
        labelAr: "تم قبول الطلب من السائق",
        detailsEn: "Demo Driver accepted Erbil cold storage ventilated shipment.",
        detailsTr: "Demo Driver havalandırmalı Erbil sevkiyatını kabul etti.",
        detailsAr: "قبل Demo Driver شحنة أربيل المهواة."
      }
    ],
    createdAt: "2026-05-31T09:00:00Z",
    updatedAt: "2026-05-31T16:00:00Z",
    isLinkShared: false,
    shareToken: generateShareToken(),
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
  },
  // Driver App Simplification / CMR Read-Only Review (PR #71): shipment-1003
  // is the local/dev manual-review fixture for the demo_driver account (see
  // docs/FOLLOW_UP_ROADMAP.md, "Driver review demo scenario"). msg-1 through
  // msg-5 above predate the `channel` field, so they're invisible to
  // driver/client sessions (filterChatMessagesByRole withholds untagged
  // messages) — these three are explicitly tagged so a fresh
  // `SEED_DEMO_DATA=true` local run has a real, channel-correct
  // driver_admin thread to review, plus one client_admin message to confirm
  // it never leaks into the driver's chat tab.
  {
    id: "msg-1003-1",
    shipmentId: "shipment-1003",
    sender: "admin",
    senderName: "MARAS Operations Office",
    type: "text",
    text: "Hi Demo Driver, your CMR document for MAR-2026-1003 has been uploaded and is ready to view — please download it and keep a copy for the Erbil checkpoint.",
    timestamp: "2026-05-31T15:20:00Z",
    channel: "driver_admin"
  },
  {
    id: "msg-1003-2",
    shipmentId: "shipment-1003",
    sender: "driver",
    senderName: "Demo Driver",
    type: "text",
    text: "Received, thank you. Loading is in progress, will confirm once cargo is secured.",
    timestamp: "2026-05-31T15:35:00Z",
    channel: "driver_admin"
  },
  {
    id: "msg-1003-3",
    shipmentId: "shipment-1003",
    sender: "admin",
    senderName: "MARAS Operations Office",
    type: "text",
    text: "Hi Demo Client, your invoice for MAR-2026-1003 has been finalized — let us know if you need anything else.",
    timestamp: "2026-05-31T15:25:00Z",
    channel: "client_admin"
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
  // Same safety gate as getMemoryStore() above: demo records (including
  // accounts with known, source-visible default passwords) must never be
  // written to a real Firestore database — which may be production —
  // unless explicitly opted into via SEED_DEMO_DATA=true. Previously this
  // ran unconditionally on every boot whenever Firestore was reachable and
  // a collection was empty, which would silently plant those accounts into
  // a genuinely fresh production database.
  if (!SEED_DEMO_DATA) {
    console.log("[Firestore] SEED_DEMO_DATA is not \"true\" — skipping demo-data seeding. Firestore collections will remain empty until real records are created.");
    return;
  }
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
      console.log("Drivers collection already seeded.");
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
      console.log("Clients collection already seeded.");
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
  type: 'assignment' | 'acceptance' | 'rejection' | 'status_update' | 'chat' | 'doc_upload' | 'delivery' | 'driver_registration',
  titleEn: string, titleTr: string, titleAr: string,
  messageEn: string, messageTr: string, messageAr: string,
  // Session id to exclude from this notification's recipients, e.g. the
  // chat sender so they don't get notified of their own message.
  excludeUserId?: string,
  // BUG-03: for type 'chat' notifications, which audience this chat
  // message belongs to. The title/body of a chat notification carry the
  // sender's name and message text, so without this a client's message
  // would page the driver's device (and vice versa) even though the chat
  // thread itself is now partitioned by channel.
  // PR #44: also passed for 'doc_upload' — its only call site is a
  // client_admin chat file attachment, and without a channel here that
  // notification would (like any other non-chat type) page the driver
  // too, even though it originated from a client_admin-only exchange.
  chatChannel?: ChatChannel
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
  if (excludeUserId) newNotif.excludeUserId = excludeUserId;
  if ((type === "chat" || type === "doc_upload") && chatChannel) newNotif.channel = chatChannel;
  try {
    await setDoc(doc(db, "notifications", newNotif.id), newNotif);
  } catch (err) {
    console.error("Error writing notification: ", err);
  }

  // Actually send a real push notification, in addition to writing the
  // in-app one above. Recipients are resolved here rather than passed
  // in by each of this function's call sites, since this function
  // already receives the shipmentId every call site already has on
  // hand - reusing the same assignedDriverId / companyName lookup the
  // GET /api/notifications endpoint already does for filtering, rather
  // than duplicating that logic at every call site.
  if (!pushMessaging) return;
  try {
    const userIds = new Set<string>();

    // Always include every admin - admins see every notification with
    // no filtering, so they should get every push too.
    const adminTokensSnap = await getDocs(collection(db, "pushTokens"));
    const allTokenDocs = adminTokensSnap.docs.map(d => d.data() as any);
    for (const t of allTokenDocs) {
      if (t.role === "admin") userIds.add(t.userId);
    }

    if (shipmentId) {
      const shipDoc = await getDoc(doc(db, "shipments", shipmentId));
      if (shipDoc.exists()) {
        const ship = shipDoc.data() as Shipment;
        // BUG-03: a chat push must only reach the audience it belongs to.
        // Non-chat notifications (assignment, status_update, etc.) are
        // unaffected and keep going to both driver and client as before.
        const includeDriver = shouldNotifyChatParty(type, "driver", chatChannel);
        const includeClient = shouldNotifyChatParty(type, "client", chatChannel);

        if (includeDriver) {
          if (ship.assignedDriverId) userIds.add(ship.assignedDriverId);
          if (ship.additionalDrivers) {
            for (const ad of ship.additionalDrivers) userIds.add(ad.driverId);
          }
        }
        if (includeClient && ship.companyName) {
          const clientsSnap = await getDocs(collection(db, "clients"));
          const matchingClient = clientsSnap.docs
            .map(d => d.data() as Client)
            .find(c => c.companyName === ship.companyName);
          if (matchingClient) userIds.add(matchingClient.id);
        }
      }
    }

    if (excludeUserId) userIds.delete(excludeUserId);

    const targetTokens = allTokenDocs
      .filter(t => userIds.has(t.userId))
      .map(t => t.token as string);

    if (targetTokens.length === 0) return;

    await pushMessaging.sendEachForMulticast({
      tokens: targetTokens,
      notification: {
        title: titleEn,
        body: messageEn
      },
      apns: {
        payload: {
          aps: { sound: "default" }
        }
      }
    });
  } catch (err) {
    // Never let a push-sending failure break the actual notification
    // or whatever action triggered it (e.g. assigning a shipment) -
    // the in-app notification above already succeeded regardless.
    console.error("Error sending push notification: ", err);
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

  // Trust the first proxy hop (Cloud Run's load balancer) so req.ip reflects
  // the real client IP, not the proxy's. Without this, the login rate
  // limiter below would see every request as coming from the same IP.
  app.set("trust proxy", 1);

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

  // BUG-11: this used to reflect back whatever Origin header the request
  // sent while Allow-Credentials was true — that combination lets any
  // website read authenticated responses from this API on a logged-in
  // user's behalf. Now backed by an explicit allowlist (see
  // src/lib/cors.ts): default local-dev + production origins, plus
  // anything set via APP_URL / CLIENT_URL / ALLOWED_ORIGINS /
  // PUBLIC_APP_URL (comma-separated). Computed once at startup, not per
  // request.
  const corsAllowedOrigins = parseAllowedOriginsFromEnv(process.env);

  // Custom CORS middleware to support external frontends querying this backend
  app.use((req, res, next) => {
    const rawOrigin = req.headers.origin;
    const requestOrigin = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
    const allowedOrigin = resolveCorsOrigin(requestOrigin, corsAllowedOrigins);

    if (allowedOrigin) {
      // Only ever a single allowlisted origin, never "*" — browsers reject
      // "*" together with credentialed requests anyway, but reflecting an
      // arbitrary origin here would be just as unsafe.
      res.header("Access-Control-Allow-Origin", allowedOrigin);
      res.header("Access-Control-Allow-Credentials", "true");
      res.header("Vary", "Origin");
    }
    // Else: no Origin header (same-origin browser request or a
    // server-to-server call — neither sends/needs one) or an origin that
    // isn't allowlisted. Either way, Access-Control-Allow-Origin is simply
    // omitted rather than defaulting to "*" or the raw origin.

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

  // ───────────────────────────────────────────────────────────────────────
  // SESSION / AUTHORIZATION SYSTEM
  //
  // Previously NONE of the API endpoints below checked who was calling
  // them — anyone who knew (or guessed) a URL like /api/admins or
  // /api/shipments/:id could read or write anything, logged in or not.
  // This block adds a real, signed session token (similar in spirit to a
  // JWT, built with Node's built-in crypto so no new dependency is
  // required) that is:
  //   1. issued by /api/login and /api/verify-session on successful auth
  //   2. sent back to the client, which must include it as
  //      `Authorization: Bearer <token>` on every subsequent request
  //   3. verified by requireAuth/requireRole on every endpoint that
  //      shouldn't be world-readable/writable
  //
  // SESSION_SECRET must be set in the environment — if it's missing, the
  // server refuses to start rather than silently running with no real
  // protection (matching the "fail loud, not silent" principle applied
  // to the Firestore connection above).
  // ───────────────────────────────────────────────────────────────────────
  const SESSION_SECRET = process.env.SESSION_SECRET || "";
  if (!SESSION_SECRET) {
    console.error(
      "[FATAL] SESSION_SECRET is not set. Refusing to start without it — every API " +
      "endpoint would otherwise be unauthenticated. Generate one with " +
      "`openssl rand -base64 48` and set it as an environment variable."
    );
    process.exit(1);
  }

  type SessionRole = AuthSessionRole;
  type SessionPayload = AuthSessionPayload;
  const SESSION_TTL_MS = AUTH_SESSION_TTL_MS;

  // Thin wrappers supplying SESSION_SECRET automatically, so the many call
  // sites below don't need to change. The actual signing/verification logic
  // lives in src/lib/auth.ts, where it's unit tested (npm run test) without
  // needing to boot this whole server.
  function signSessionToken(payload: SessionPayload): string {
    return signSessionTokenImpl(payload, SESSION_SECRET);
  }
  function verifySessionToken(token: string): SessionPayload | null {
    return verifySessionTokenImpl(token, SESSION_SECRET);
  }

  // (Express Request type augmentation moved to top-level, outside this
  // function — see declare global block near the top of the file.)

  function getTokenFromRequest(req: express.Request): string | null {
    const header = req.headers["authorization"];
    if (typeof header === "string" && header.startsWith("Bearer ")) {
      return header.slice("Bearer ".length).trim();
    }
    return null;
  }

  /** Attaches req.session if a valid token is present; does NOT reject the request on its own. */
  function attachSession(req: express.Request, _res: express.Response, next: express.NextFunction) {
    const token = getTokenFromRequest(req);
    if (token) {
      const payload = verifySessionToken(token);
      if (payload) req.session = payload;
    }
    next();
  }
  app.use(attachSession);

  /** Rejects the request unless a valid session of any role is present. */
  function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (!req.session) {
      return res.status(401).json({ error: "Authentication required." });
    }
    next();
  }

  /** Rejects the request unless the session role is in the allowed list. */
  function requireRole(...roles: SessionRole[]) {
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (!req.session) {
        return res.status(401).json({ error: "Authentication required." });
      }
      if (!roles.includes(req.session.role)) {
        return res.status(403).json({ error: "You do not have permission to perform this action." });
      }
      next();
    };
  }

  /**
   * True if this session is an admin with adminType 'super' or 'operation'
   * (not the cost-only 'accounts' role).
   *
   * BUG-17: 401 means "not authenticated" and 403 means "authenticated but
   * not allowed" — a logged-in client/driver, or an accounts-type admin,
   * belongs in the 403 bucket, not 401. See resolveFullAdminStatus for the
   * (unit-tested) decision logic.
   */
  function requireFullAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
    const status = resolveFullAdminStatus(req.session);
    if (status === 401) {
      return res.status(401).json({ error: "Authentication required." });
    }
    if (status === 403) {
      const message = req.session?.adminType === "accounts"
        ? "Accounts-role admins cannot perform this action."
        : "You do not have permission to perform this action.";
      return res.status(403).json({ error: message });
    }
    next();
  }

  /**
   * BUG-08: requireFullAdmin allows both 'super' and 'operation' through,
   * which is too broad for routes the AdminPanel UI treats as super-only
   * (e.g. the Team/admin roster) — an operation admin blocked only by the
   * UI could otherwise still call the route directly.
   */
  function requireSuperAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (!req.session || req.session.role !== "admin") {
      return res.status(401).json({ error: "Authentication required." });
    }
    if (!canViewAdminRoster(req.session.adminType)) {
      return res.status(403).json({ error: "Only the super-admin can perform this action." });
    }
    next();
  }

  /**
   * BUG-09: the AdminPanel UI shows accounts admins a Clients/Vendors tab
   * (they need the client/vendor directory to attribute costs and reports),
   * but GET /api/clients and GET /api/vendors used requireFullAdmin, which
   * blocks 'accounts' — a UI/server mismatch where the tab loaded to fetch
   * errors. These allow the same three admin types the UI already shows the
   * tab to; the write routes (POST/PUT) stay on requireFullAdmin so accounts
   * admins remain read-only.
   */
  function requireCanViewClients(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (!req.session || req.session.role !== "admin") {
      return res.status(401).json({ error: "Authentication required." });
    }
    if (!canViewClients(req.session.adminType)) {
      return res.status(403).json({ error: "You do not have permission to view clients." });
    }
    next();
  }
  function requireCanViewVendors(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (!req.session || req.session.role !== "admin") {
      return res.status(401).json({ error: "Authentication required." });
    }
    if (!canViewVendors(req.session.adminType)) {
      return res.status(403).json({ error: "You do not have permission to view vendors." });
    }
    next();
  }

  /**
   * Admin Data Fetch / AdminType Access Review (PR #58): GET /api/cost-statements
   * and GET /api/cost-statements/:shipmentId used requireRole("admin"), which let
   * an operation-type admin fetch the full accounting ledger directly even
   * though the AdminPanel UI never shows them the 'costs' tab. See
   * canViewCostStatements (adminAccess.ts) for the super/accounts-only rule.
   */
  function requireCanViewCostStatements(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (!req.session || req.session.role !== "admin") {
      return res.status(401).json({ error: "Authentication required." });
    }
    if (!canViewCostStatements(req.session.adminType)) {
      return res.status(403).json({ error: "You do not have permission to view cost statements." });
    }
    next();
  }

  /**
   * PR #61 (Accounts Cost Statement Write Access): POST
   * /api/cost-statements/:shipmentId used requireFullAdmin, which blocks
   * 'accounts' — the type the 'costs' tab is shown to for exactly this
   * purpose — from ever saving the statement it can already view via
   * requireCanViewCostStatements above. See canWriteCostStatements
   * (adminAccess.ts): mirrors the view rule (super/accounts), still
   * excludes 'operation' entirely, and grants nothing beyond this route —
   * accounts admins still cannot GET /api/shipments, /api/logs, or
   * /api/admins.
   */
  function requireCanWriteCostStatements(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (!req.session || req.session.role !== "admin") {
      return res.status(401).json({ error: "Authentication required." });
    }
    if (!canWriteCostStatements(req.session.adminType)) {
      return res.status(403).json({ error: "You do not have permission to write cost statements." });
    }
    next();
  }

  /**
   * Admin Data Fetch / AdminType Access Review (PR #58): GET /api/logs and
   * POST /api/logs used requireRole("admin"), which let any admin type read
   * or append to the immutable security/activity ledger directly, even
   * though the AdminPanel UI never shows the 'audit' tab to anyone but
   * super. See canViewAuditLogs (adminAccess.ts). Guards GET only — POST
   * uses the separate, intentionally broader requireCanWriteAuditLogs below
   * (PR #82, see canWriteAuditLogs for why).
   */
  function requireCanViewAuditLogs(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (!req.session || req.session.role !== "admin") {
      return res.status(401).json({ error: "Authentication required." });
    }
    if (!canViewAuditLogs(req.session.adminType)) {
      return res.status(403).json({ error: "You do not have permission to view audit logs." });
    }
    next();
  }

  /**
   * PR #82 (Google Workspace review): POST /api/logs previously shared
   * requireCanViewAuditLogs (super-only) with GET, but operation admins can
   * reach the Google Workspace 'gmail' tab (Gmail send, Drive backup,
   * Calendar scheduling — all reachable via the Shipments tab's Gmail Alert
   * shortcut, canViewShipmentRegistry) and every one of those actions POSTs
   * here to record itself. Sharing the super-only guard meant every such
   * action an operation admin performed silently failed to log at all. See
   * canWriteAuditLogs (adminAccess.ts) — read access (GET, the 'audit' tab)
   * is unaffected and stays super-only.
   */
  function requireCanWriteAuditLogs(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (!req.session || req.session.role !== "admin") {
      return res.status(401).json({ error: "Authentication required." });
    }
    if (!canWriteAuditLogs(req.session.adminType)) {
      return res.status(403).json({ error: "You do not have permission to write to the audit log." });
    }
    next();
  }

  /**
   * Simple in-memory rate limiter for login attempts, keyed by IP address +
   * the username being attempted. Prevents unlimited password guessing
   * against any one account. No new dependency — just a Map with manual
   * expiry, reset on every successful login.
   *
   * NOTE: this is per-server-instance memory, not shared across multiple
   * server replicas. If this app is ever deployed behind a load balancer
   * with more than one backend instance, a shared store (Redis, or a
   * Firestore-backed counter) would be needed for this to remain effective
   * — a single attacker could otherwise round-robin across instances to
   * bypass it. Fine for a single-instance deployment as-is.
   */
  const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
  const LOGIN_MAX_ATTEMPTS = 8;
  const loginAttempts = new Map<string, { count: number; windowStart: number }>();

  function loginRateLimitKey(req: express.Request, username: string): string {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    return `${ip}:${(username || "").toLowerCase().trim()}`;
  }

  function checkLoginRateLimit(req: express.Request, username: string): { allowed: boolean; retryAfterSeconds?: number } {
    const key = loginRateLimitKey(req, username);
    const now = Date.now();
    const entry = loginAttempts.get(key);

    if (!entry || now - entry.windowStart > LOGIN_ATTEMPT_WINDOW_MS) {
      loginAttempts.set(key, { count: 1, windowStart: now });
      return { allowed: true };
    }

    if (entry.count >= LOGIN_MAX_ATTEMPTS) {
      const retryAfterSeconds = Math.ceil((LOGIN_ATTEMPT_WINDOW_MS - (now - entry.windowStart)) / 1000);
      return { allowed: false, retryAfterSeconds };
    }

    entry.count += 1;
    return { allowed: true };
  }

  function clearLoginRateLimit(req: express.Request, username: string): void {
    loginAttempts.delete(loginRateLimitKey(req, username));
  }

  // Periodic cleanup so this Map doesn't grow unbounded over a long-running
  // server process — old entries outside the window are just stale memory.
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of loginAttempts.entries()) {
      if (now - entry.windowStart > LOGIN_ATTEMPT_WINDOW_MS) {
        loginAttempts.delete(key);
      }
    }
  }, LOGIN_ATTEMPT_WINDOW_MS);

  /**
   * For any endpoint shaped /api/shipments/:id/... — verifies the session
   * is either an admin, or a driver/client who actually owns that specific
   * shipment, before letting the request through. Attaches the loaded
   * shipment to req so handlers don't need to re-fetch it.
   */
  function requireShipmentAccess(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (!req.session) {
      return res.status(401).json({ error: "Authentication required." });
    }
    (async () => {
      try {
        const shipmentId = req.params.id;
        const sDoc = await getDoc(doc(db, "shipments", shipmentId));
        if (!sDoc.exists()) {
          return res.status(404).json({ error: "Shipment not found" });
        }
        const shipment = sDoc.data() as Shipment;

        if (req.session!.role === "admin") {
          req.shipment = shipment;
          return next();
        }
        if (req.session!.role === "driver") {
          const driverId = req.session!.id;
          const owns = shipment.assignedDriverId === driverId ||
            (shipment.additionalDrivers && shipment.additionalDrivers.some((ad: any) => ad.driverId === driverId));
          if (!owns) return res.status(403).json({ error: "You do not have access to this shipment." });
          req.shipment = shipment;
          return next();
        }
        if (req.session!.role === "client") {
          const clientsCol = collection(db, "clients");
          const clientsSnap = await getDocs(clientsCol);
          const myClient = clientsSnap.docs.map(d => d.data() as Client).find(c => c.id === req.session!.id);
          if (!myClient || !isShipmentVisibleToClientCompany(shipment.companyName, myClient.companyName)) {
            return res.status(403).json({ error: "You do not have access to this shipment." });
          }
          req.shipment = shipment;
          return next();
        }
        return res.status(403).json({ error: "Forbidden." });
      } catch (err) {
        console.error("requireShipmentAccess error:", err);
        return res.status(500).json({ error: "Failed to verify shipment access." });
      }
    })();
  }

  // Password hashing (hashPassword/verifyPassword/verifyPasswordWithMigration)
  // now lives in src/lib/auth.ts, imported at the top of this file — see
  // that module for the implementation and its unit tests.

  // Media uploading endpoints
  app.post("/api/upload", requireAuth, async (req, res) => {
    try {
      // feature/client-staff-accounts-safety-review: Client Staff
      // (session.viewOnly) may use this to upload a chat attachment, same
      // as the Client owner — see the /chat route below. They're still
      // blocked from anything that lets a document skip that chat flow
      // (the Document Center upload route, share/visibility toggles).
      const base64DataUrl = req.body.base64DataUrl || req.body.file || req.body.base64;
      const filename = req.body.filename || "upload.bin";
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

      // PR #46: reject anything outside the PDF/JPG/PNG/WebP/DOC(X)/XLS(X)
      // allowlist and anything over the per-file size cap before it ever
      // reaches Storage. The client's file-input `accept=` is advisory only
      // (this endpoint can be called directly), so this is the real check.
      const validation = validateUpload(mimeType, filename, buffer.length);
      if (!validation.ok) {
        return res.status(415).json({ error: validation.error });
      }

      if (useMemoryFallback || !firebaseApp) {
        // No durable storage available right now — say so plainly rather
        // than silently keeping the file in memory only, where it would
        // vanish on the next restart with no warning to anyone.
        console.error("[upload] Firebase unavailable — refusing upload rather than storing it only in memory where it would be silently lost.");
        return res.status(503).json({
          error: "File storage is temporarily unavailable. Your file was NOT saved — please try again in a moment.",
        });
      }

      try {
        const storage = getStorage(firebaseApp);
        const path = `uploads/${req.session!.role}/${req.session!.id}/${Date.now()}-${Math.random().toString(36).substring(2, 9)}-${filename}`;
        const fileRef = storageRef(storage, path);
        await uploadBytes(fileRef, buffer, { contentType: mimeType });
        // NOTE (BUG-12): this is a real Firebase Storage getDownloadURL() —
        // its access token is NOT revocable through anything in this app;
        // once handed out it keeps working forever regardless of later
        // document-visibility changes. That's fine for this authenticated
        // endpoint, whose caller (admin/driver/client, all logged in) is
        // meant to have access to what they themselves just uploaded. The
        // one place this becomes unsafe is the *public*, unauthenticated
        // share view — see buildSecureShareView and
        // /api/share/:token/documents/:docId below, which never forward
        // this raw URL and instead proxy through a route that re-checks
        // visibility on every request. Any new public-facing document
        // surface should use that same proxy pattern, not this URL
        // directly.
        const url = await getDownloadURL(fileRef);
        console.log(`[upload] Stored to Firebase Storage: ${path}`);
        res.json({ url });
      } catch (storageErr: any) {
        console.error("[upload] Firebase Storage write failed:", storageErr?.message || storageErr);
        res.status(502).json({
          error: "Could not save your file to storage. Please try again.",
        });
      }
    } catch (err) {
      console.error("Upload handler failed:", err);
      res.status(500).json({ error: "Upload failed" });
    }
  });

  // Kept only for backward compatibility with files uploaded before this
  // fix (old chat/document records may still reference /api/uploads/<id>
  // URLs). New uploads no longer use this path — see /api/upload above,
  // which now returns a real Firebase Storage URL directly. Note: any
  // pre-fix uploads referenced here were already lost on the first server
  // restart after they were created, since they only ever existed in
  // memory — this just avoids a broken-link error for the link itself.
  app.get("/api/uploads/:id", (req, res) => {
    const fileId = req.params.id;
    const fileObj = uploadedFiles.get(fileId);
    if (!fileObj) {
      return res.status(404).send("File not found (this was an older in-memory upload that didn't survive a server restart)");
    }
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(fileObj.filename)}"`);
    res.setHeader("Content-Type", fileObj.mimeType);
    res.send(fileObj.buffer);
  });

  // API Endpoints

  // 1. Get Shipments (from Firestore)
  app.get("/api/shipments", requireAuth, async (req, res) => {
    try {
      // BUG-08: accounts admins don't get the operational shipment registry —
      // the AdminPanel UI never shows them a Shipments tab, and the server
      // shouldn't hand it over just because the route was called directly.
      if (req.session!.role === "admin" && !canViewShipmentRegistry(req.session!.adminType)) {
        return res.status(403).json({ error: "Accounts-role admins cannot view the shipment registry." });
      }
      const col = collection(db, "shipments");
      const snapshot = await getDocs(col);
      let list = snapshot.docs.map(doc => doc.data() as Shipment);
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      // Scope results to the session's own role — never trust a
      // client-supplied driverId/clientId to decide what's returned.
      if (req.session!.role === "driver") {
        const driverId = req.session!.id;
        const filtered = list.filter(s =>
          s.assignedDriverId === driverId ||
          (s.additionalDrivers && s.additionalDrivers.some((ad: any) => ad.driverId === driverId))
        );
        return res.json(filtered.map(s => buildShipmentViewForRole(s, req.session!)));
      }
      if (req.session!.role === "client") {
        const clientsCol = collection(db, "clients");
        const clientsSnap = await getDocs(clientsCol);
        const myClient = clientsSnap.docs.map(d => d.data() as Client).find(c => c.id === req.session!.id);
        const filtered = myClient ? list.filter(s => isShipmentVisibleToClientCompany(s.companyName, myClient.companyName)) : [];
        return res.json(filtered.map(s => buildShipmentViewForRole(s, req.session!)));
      }
      // Admins see everything.
      res.json(list);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch shipments" });
    }
  });

  // 2. Create Shipment (Admin Only - writes to Firestore)
  app.post("/api/shipments", requireFullAdmin, async (req, res) => {
    try {
      const data = req.body;

      // Auto generate shipment number (MAR-Year-Count). BUG-15: this
      // sequence number now comes from allocateNextShipmentSequence(),
      // which allocates it atomically (Firestore transaction, or the
      // single-threaded in-memory counter when Firestore is unavailable)
      // instead of reading the collection size and incrementing in JS -
      // that pattern let two concurrent create requests read the same
      // count and hand out the same shipmentNumber/id.
      const count = await allocateNextShipmentSequence();
      const year = new Date().getFullYear();
      const shipmentNumber = formatShipmentNumber(year, count);
      const id = formatShipmentId(count);

      // Load drivers to find assignee
      const driversCol = collection(db, "drivers");
      const driversSnap = await getDocs(driversCol);
      const driversList = driversSnap.docs.map(doc => doc.data() as Driver);
      
      const driver = driversList.find(d => d.id === data.assignedDriverId);
      const assignedDriverName = driver ? driver.name : "Unassigned";

      // Assignment safety: the client-side driver-select dropdowns already
      // exclude pending/rejected drivers (getAssignableDrivers,
      // src/lib/driverAccess.ts), but nothing stopped a direct API call
      // from sending one anyway. Enforced here server-side, matching PR
      // #80's driver-login hardening principle.
      if (!isDriverAssignmentSafe(driver)) {
        return res.status(400).json({ error: "Cannot assign a pending or rejected driver to a shipment." });
      }
      if (Array.isArray(data.additionalDrivers)) {
        for (const ad of data.additionalDrivers) {
          const adDriver = driversList.find(d => d.id === ad?.driverId);
          if (!isDriverAssignmentSafe(adDriver)) {
            return res.status(400).json({ error: "Cannot assign a pending or rejected driver as an additional driver." });
          }
        }
      }

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
        isLinkShared: false,
        shareToken: generateShareToken(),
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
  app.get("/api/shipments/:id", requireAuth, async (req, res) => {
    try {
      const sDoc = await getDoc(doc(db, "shipments", req.params.id));
      if (!sDoc.exists()) {
        return res.status(404).json({ error: "Shipment not found" });
      }
      const shipment = sDoc.data() as Shipment;

      if (req.session!.role === "driver") {
        const driverId = req.session!.id;
        const owns = shipment.assignedDriverId === driverId ||
          (shipment.additionalDrivers && shipment.additionalDrivers.some((ad: any) => ad.driverId === driverId));
        if (!owns) return res.status(403).json({ error: "You do not have access to this shipment." });
      } else if (req.session!.role === "client") {
        const clientsCol = collection(db, "clients");
        const clientsSnap = await getDocs(clientsCol);
        const myClient = clientsSnap.docs.map(d => d.data() as Client).find(c => c.id === req.session!.id);
        if (!myClient || !isShipmentVisibleToClientCompany(shipment.companyName, myClient.companyName)) {
          return res.status(403).json({ error: "You do not have access to this shipment." });
        }
      }
      // Admins can view any shipment.

      res.json(buildShipmentViewForRole(shipment, req.session!));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch shipment details" });
    }
  });

  // 3.5. Calculate distance, duration, and estimated arrival time using Google Maps Distance Matrix API
  // BUG-06: shipment IDs are sequential/guessable — this previously only
  // required *some* valid session (requireAuth), letting any driver/client
  // request the distance matrix (and trigger a billed Google Maps call)
  // for a shipment they have nothing to do with. requireShipmentAccess
  // enforces the same ownership rule used by every other
  // /api/shipments/:id/... route and attaches req.shipment so this handler
  // doesn't need to re-fetch it.
  app.get("/api/shipments/:id/distance-matrix", requireShipmentAccess, async (req, res) => {
    try {
      const sRef = doc(db, "shipments", req.params.id);
      const shipment = req.shipment as any;
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
        const routeCoords = resolveRouteCoords(
          originStr,
          destinationStr,
          shipment.freightType,
          hasLiveDriverGps && liveGpsLocation ? liveGpsLocation : null
        );

        if (!routeCoords) {
          // Sea/air route whose origin and/or destination don't resolve to
          // known coordinates - there is no honest distance to compute, so
          // report unavailable instead of reusing the land default corridor
          // (do not persist anything to the shipment doc).
          return res.json({
            ...UNAVAILABLE_DISTANCE_MATRIX_RESPONSE,
            origin: originStr,
            destination: destinationStr,
            hasLiveDriverGps
          });
        }

        // Multiply by 1.25 to account for real roadways curvature (routing coefficient factor)
        const distanceKm = Math.round(haversineKm(routeCoords.origin, routeCoords.destination) * 1.25);
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
      } else if (!isLandFreight(shipment.freightType)) {
        // Google couldn't resolve this Sea/Air route either - there is no
        // known corridor to estimate from, so report unavailable instead of
        // fabricating an Istanbul-Baghdad-shaped distance/ETA.
        return res.json({
          ...UNAVAILABLE_DISTANCE_MATRIX_RESPONSE,
          origin: originStr,
          destination: destinationStr,
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
      res.status(500).json({ error: "Failed to process distance matrix" });
    }
  });

  // 4. Update Shipment Profile
  app.put("/api/shipments/:id", requireFullAdmin, async (req, res) => {
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

      // Fetch the new primary driver once, up front, and reuse it below for
      // both the assignment-safety check and the stats/name resolution
      // (previously fetched twice — once to bump activeShipmentsCount,
      // again just to read the name — with no validation in between).
      let driverObj: Driver | null = null;
      if (newDriverId) {
        const ndDoc = await getDoc(doc(db, "drivers", newDriverId));
        if (ndDoc.exists()) {
          driverObj = ndDoc.data() as Driver;
        }
      }

      // Assignment safety: the client-side driver-select dropdowns already
      // exclude pending/rejected drivers (getAssignableDrivers/
      // getCoreDriverSelectOptions, AdminPanel.tsx), but nothing stopped a
      // direct API call from sending one anyway. Enforced here server-side,
      // matching PR #80's driver-login hardening principle. Checked before
      // any mutation below (driver stats, shipment write) so a rejected
      // request never has a partial side effect.
      if (!isDriverAssignmentSafe(driverObj)) {
        return res.status(400).json({ error: "Cannot assign a pending or rejected driver to a shipment." });
      }
      if (Array.isArray(data.additionalDrivers)) {
        for (const ad of data.additionalDrivers) {
          if (!ad?.driverId) continue;
          const adDoc = await getDoc(doc(db, "drivers", ad.driverId));
          if (adDoc.exists() && !isDriverAssignmentSafe(adDoc.data() as Driver)) {
            return res.status(400).json({ error: "Cannot assign a pending or rejected driver as an additional driver." });
          }
        }
      }

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
        if (newDriverId && driverObj) {
          await setDoc(doc(db, "drivers", newDriverId), { ...driverObj, activeShipmentsCount: driverObj.activeShipmentsCount + 1 });
        }
      }

      const assignedDriverName = driverObj ? driverObj.name : "Unassigned";

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
  app.put("/api/shipments/:id/status", requireAuth, async (req, res) => {
    try {
      const { status, remarksDesc, updaterName, role } = req.body;
      const shipmentId = req.params.id;
      const sDocRef = doc(db, "shipments", shipmentId);
      const sDoc = await getDoc(sDocRef);

      if (!sDoc.exists()) {
        return res.status(404).json({ error: "Shipment not found" });
      }

      const item = sDoc.data() as Shipment;

      // Drivers may only update status on a shipment actually assigned to them.
      // Clients have no business updating status at all.
      if (req.session!.role === "driver") {
        const driverId = req.session!.id;
        const owns = item.assignedDriverId === driverId ||
          (item.additionalDrivers && item.additionalDrivers.some((ad: any) => ad.driverId === driverId));
        if (!owns) return res.status(403).json({ error: "You are not assigned to this shipment." });
      } else if (req.session!.role === "client") {
        return res.status(403).json({ error: "Clients cannot update shipment status." });
      } else if (req.session!.role === "admin" && !canViewShipmentRegistry(req.session!.adminType)) {
        // PR #83 (Shipment Registry review): this route used bare
        // requireAuth with no adminType check at all, unlike every other
        // shipment-mutating route (POST/PUT /api/shipments both use
        // requireFullAdmin) — an accounts-type admin session could update
        // any shipment's status directly, even though the whole Shipment
        // Registry tab (and its only client-side call site for this route,
        // the shipment details modal) is hidden from them. Not reachable
        // via the UI today, but the same defense-in-depth gap shape this
        // codebase has fixed repeatedly elsewhere (BUG-08, BUG-26, etc.).
        return res.status(403).json({ error: "Accounts-role admins cannot update shipment status." });
      }

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

      res.json(buildShipmentViewForRole(item, req.session!));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update status" });
    }
  });

  // 5b. Subscribe Customer to Cargo Updates
  app.post("/api/shipments/:id/subscribe-customer", requireShipmentAccess, async (req, res) => {
    try {
      // fix/client-create-username: Client Staff (session.viewOnly) now
      // gets identical company-level permissions to Client Owner, per the
      // confirmed account model — subscribing to updates is no longer
      // blocked here (previously treated as an owner-only account-level
      // setting; superseded by the explicit "same permissions" rule).
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
        "Customer (Tracking Subscription)",
        `Subscribed to real-time cargo updates`,
        `Canlı kargo güncellemelerine abone oldu`,
        `قام العميل بالاشتراك في تحديثات الشحنة المباشرة`
      );

      res.json(buildShipmentViewForRole(item, req.session!));
    } catch (err) {
      console.error("Error subscribing customer: ", err);
      res.status(500).json({ error: "Failed to join notification server registration scheme" });
    }
  });

  // 6. Get Chat Messages
  //
  // BUG-03: shipment chat is partitioned into two audiences —
  // 'driver_admin' (dispatch/operational chat) and 'client_admin'
  // (customer-service chat) — so a driver never sees a client's identity
  // or messages and a client never sees internal driver/admin chat. PR #34
  // adds a third, admin-only audience ('internal_staff') for MARAS staff.
  // Filtering happens here, server-side, based on the verified session
  // role rather than any client-supplied parameter, so a caller can't
  // request another audience's channel just by changing the query string.
  // Messages written before this field existed have no `channel` at all;
  // those are only ever shown to admins (safe default — an untagged
  // message could belong to any audience and might contain another
  // party's identity, so it's withheld from driver/client rather than
  // guessed at).
  app.get("/api/shipments/:id/chat", requireShipmentAccess, async (req, res) => {
    try {
      // PR #34: 'internal_staff' is a MARAS-staff-only audience — a
      // driver/client requesting it explicitly via the query string gets a
      // hard 403 rather than silently falling through to their own-channel
      // filter below.
      const requestedChannel = req.query.channel as string | undefined;
      if (requestedChannel === "internal_staff" && !canAccessInternalStaffChannel(req.session!.role)) {
        return res.status(403).json({ error: "You do not have permission to view this channel." });
      }

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
      msgs = filterChatMessagesByRole(msgs, req.session!.role, requestedChannel);

      msgs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      res.json(msgs);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to get chat messages" });
    }
  });

  // 6b. Mark Chat Messages as Seen
  app.post("/api/shipments/:id/chat/seen", requireShipmentAccess, async (req, res) => {
    try {
      const shipmentId = req.params.id;
      const { viewer, channel: requestedChannel } = req.body; // viewer: 'admin' | 'driver' | 'client'
      if (!viewer) {
        return res.status(400).json({ error: "Viewer is required ('admin' or 'driver')" });
      }
      if (requestedChannel === "internal_staff" && !canAccessInternalStaffChannel(req.session!.role)) {
        return res.status(403).json({ error: "You do not have permission to access this channel." });
      }

      // BUG-03: scope which messages a "seen" call can touch to the
      // caller's own channel, using the verified session role (not the
      // client-supplied `viewer`) — otherwise viewing one audience's
      // thread (e.g. driver_admin) would also silently flip read-receipts
      // on the other audience's messages (client_admin), since both used
      // to live in one shared, unfiltered thread. Admin with no channel
      // specified: preserve prior behavior and mark across all channels
      // (matches the merged admin GET default).
      const channelFilter = resolveSeenChannelFilter(req.session!.role, requestedChannel);

      const col = collection(db, "chatMessages");
      const snapshot = await getDocs(col);
      const batchWrites: Promise<void>[] = [];

      snapshot.docs.forEach((d) => {
        const msg = d.data() as ChatMessage;
        if (channelFilter && msg.channel !== channelFilter) return;
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

  /**
   * Resolves the authoritative chat sender identity from the verified
   * session instead of trusting client-supplied sender/senderName — a
   * caller could otherwise post a chat message claiming to be "admin" (or
   * any other role) regardless of who they actually authenticated as.
   */
  async function resolveChatSenderIdentity(req: express.Request): Promise<{ sender: SessionRole; senderName: string }> {
    const role = req.session!.role;

    if (role === "admin") {
      const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || "").toLowerCase();
      if (SUPER_ADMIN_EMAIL && req.session!.id === SUPER_ADMIN_EMAIL) {
        return { sender: "admin", senderName: "MARAS Operations Office" };
      }
      try {
        const adminDoc = await getDoc(doc(db, "admins", req.session!.id));
        if (adminDoc.exists()) {
          const adminData = adminDoc.data() as any;
          const fallbackName = adminData.adminType === "operation" ? "MARAS Operations Admin" : "MARAS Accounts Admin";
          return { sender: "admin", senderName: adminData.name || fallbackName };
        }
      } catch (err) {
        console.warn("resolveChatSenderIdentity: failed to load admin record:", err);
      }
      return { sender: "admin", senderName: "MARAS Operations" };
    }

    if (role === "driver") {
      try {
        const driverDoc = await getDoc(doc(db, "drivers", req.session!.id));
        if (driverDoc.exists()) {
          const driverData = driverDoc.data() as Driver;
          return { sender: "driver", senderName: driverData.name || "Driver" };
        }
      } catch (err) {
        console.warn("resolveChatSenderIdentity: failed to load driver record:", err);
      }
      return { sender: "driver", senderName: "Driver" };
    }

    // client
    try {
      const clientDoc = await getDoc(doc(db, "clients", req.session!.id));
      if (clientDoc.exists()) {
        const clientData = clientDoc.data() as Client;
        return { sender: "client", senderName: clientData.companyName || clientData.contactName || "Client" };
      }
    } catch (err) {
      console.warn("resolveChatSenderIdentity: failed to load client record:", err);
    }
    return { sender: "client", senderName: "Client" };
  }

  // 7. Post Chat Message & Handle Document Savings
  app.post("/api/shipments/:id/chat", requireShipmentAccess, async (req, res) => {
    try {
      // feature/client-staff-accounts-safety-review: Client Staff
      // (session.viewOnly) may use the existing customer/admin chat, same
      // as the Client owner — chat/document *approval* stays admin-only
      // (see the /documents and /share routes below, which still block
      // viewOnly), but sending a message or a chat attachment does not.
      const shipmentId = req.params.id;
      const { type, text, fileUrl, fileName, fileCategory, channel: requestedChannel } = req.body;

      // PR #34: 'internal_staff' is a MARAS-staff-only audience — reject
      // outright rather than silently reassigning to the caller's own
      // channel, so a driver/client trying to post into it gets an
      // unambiguous 403.
      if (requestedChannel === "internal_staff" && !canAccessInternalStaffChannel(req.session!.role)) {
        return res.status(403).json({ error: "You do not have permission to post to this channel." });
      }

      // Driver App Simplification / CMR Read-Only Review: removing the
      // CMR option from the driver-facing upload UI (DriverApplication.tsx,
      // FileUploadModal.tsx) only stops the app's own UI from offering it —
      // this endpoint can be called directly, so the same rule has to be
      // enforced here too. A driver session may never attach a 'cmr'
      // category file/document to chat; CMR is admin-published only.
      if (req.session!.role === "driver" && !canDriverUploadDocumentCategory(fileCategory)) {
        return res.status(403).json({ error: "Drivers cannot upload CMR documents. CMR documents must be sent by Admin." });
      }

      const { sender, senderName } = await resolveChatSenderIdentity(req);

      // BUG-03: which audience (driver_admin, client_admin, or
      // internal_staff) this message belongs to. Driver/client identity is
      // already server-verified above, so their channel is forced from
      // that and never taken from client input. Admin can message any
      // audience, so it must say which channel explicitly — there's no
      // existing UI signal reliable enough to infer this safely, and
      // guessing risks broadcasting one admin reply into the wrong
      // audience's thread.
      const channel = resolveOutgoingChatChannel(sender, requestedChannel);
      if (!channel) {
        return res.status(400).json({ error: "channel is required ('driver_admin', 'client_admin', or 'internal_staff') when sending as admin" });
      }

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
        status: "sent",
        channel
      };

      if (text !== undefined) newMessage.text = text;
      if (fileUrl !== undefined) newMessage.fileUrl = fileUrl;
      if (fileName !== undefined) newMessage.fileName = fileName;
      if (fileCategory !== undefined) newMessage.fileCategory = fileCategory;

      await setDoc(doc(db, "chatMessages", newMessage.id), newMessage);

      // Save file inside shipment documents
      if (type === "file" && fileUrl && shouldSaveChatFileAsShipmentDocument(channel, sender)) {
        const docId = `doc-${Date.now()}`;
        const newDoc = {
          id: docId,
          name: fileName || "unnamed_document.bin",
          url: fileUrl,
          category: fileCategory || "other",
          uploadedBy: senderName || (sender === "admin" ? "Admin" : sender === "client" ? "Client" : "Driver"),
          uploadedAt: new Date().toISOString(),
          // PR #46: new documents default internal-only — an admin opts one
          // into the public tracking link explicitly via the document
          // center's visibility toggle (see resolveNewDocumentSharedExternally).
          isSharedExternally: resolveNewDocumentSharedExternally()
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
          `تم إضافة مستند جديد باسم '${newDoc.name}' في ملف الشحنة ${shipmentItem.shipmentNumber}`,
          // PR #44: this branch is client_admin-only (shouldSaveChatFileAsShipmentDocument
          // above), so pass the channel through — without it, doc_upload's default
          // (unrestricted) recipient rule would also page the driver for a purely
          // client<->admin exchange.
          undefined,
          channel
        );
      } else if (type === "file" && fileUrl) {
        // internal_staff/driver_admin attachment, or a customer/client-staff
        // upload on client_admin (see shouldSaveChatFileAsShipmentDocument,
        // PR #39 / PR #62): chat-only, never saved to shipment.documents —
        // so it never reaches the customer dashboard or public share view —
        // and notified via the same channel-gated "chat" notification path
        // as a text message rather than the unfiltered "doc_upload"
        // notification.
        await pushNotification(
          shipmentId,
          shipmentItem.shipmentNumber,
          "chat",
          `Message: ${senderName}`,
          `Mesaj: ${senderName}`,
          `رسالة من: ${senderName}`,
          "sent an attachment",
          "dosya gönderildi",
          "أرسل ملفًا جديًا",
          req.session!.id,
          channel
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
          text ? (text.length > 50 ? `${text.substring(0, 50)}...` : text) : "أرسل ملفًا جديًا",
          req.session!.id,
          channel
        );
      }

      res.status(201).json(newMessage);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to post chat message" });
    }
  });

  // 8. Upload Document Directly (Admin Center)
  app.post("/api/shipments/:id/documents", requireShipmentAccess, async (req, res) => {
    try {
      // fix/client-create-username: Client Staff (session.viewOnly) now
      // gets identical company-level permissions to Client Owner — direct
      // document upload is no longer blocked here (previously restricted
      // to Owner only; superseded by the explicit "same permissions" rule
      // covering documents/uploads).
      const shipmentId = req.params.id;
      const { name, url, category, uploadedBy, isSharedExternally } = req.body;

      // Driver App Simplification / CMR Read-Only Review: this route skips
      // the chat trail and files a document directly (see the comment
      // above), so it's the more direct of the two upload paths a driver
      // session can reach — the same CMR-upload block as /chat applies
      // here too. CMR is admin-published only; a driver may still view one
      // (isDocumentVisibleToDriver), just never create one.
      if (req.session!.role === "driver" && !canDriverUploadDocumentCategory(category)) {
        return res.status(403).json({ error: "Drivers cannot upload CMR documents. CMR documents must be sent by Admin." });
      }

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
        // PR #46: internal-only by default — see resolveNewDocumentSharedExternally.
        isSharedExternally: resolveNewDocumentSharedExternally(isSharedExternally)
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
  app.put("/api/shipments/:id/documents/:docId/visibility", requireFullAdmin, async (req, res) => {
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
  app.post("/api/shipments/:id/share", requireShipmentAccess, async (req, res) => {
    try {
      // fix/client-create-username: Client Staff (session.viewOnly) now
      // gets identical company-level permissions to Client Owner —
      // configuring public share links is no longer blocked here
      // (previously owner-only; superseded by the explicit "same
      // permissions" rule covering public share links).
      const sDocRef = doc(db, "shipments", req.params.id);
      const sDoc = await getDoc(sDocRef);
      if (!sDoc.exists()) return res.status(404).json({ error: "Shipment not found" });

      const shipment = sDoc.data() as Shipment;
      const { isLinkShared, shareIncludeDocuments, shareIncludePhotos } = req.body;

      if (isLinkShared !== undefined) shipment.isLinkShared = isLinkShared;
      if (shareIncludeDocuments !== undefined) shipment.shareIncludeDocuments = shareIncludeDocuments;
      if (shareIncludePhotos !== undefined) shipment.shareIncludePhotos = shareIncludePhotos;

      // Migrate away from old guessable tokens, and ensure any shipment that
      // is (or becomes) shared has a strong, unguessable token. This rotates
      // legacy "token-100x" values the moment an admin touches sharing.
      if (isLegacyShareToken(shipment.shareToken)) {
        shipment.shareToken = generateShareToken();
      }

      await setDoc(sDocRef, shipment);
      res.json(buildShipmentViewForRole(shipment, req.session!));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to configure share link settings" });
    }
  });

  // The public share payload is built by buildSecureShareView
  // (src/lib/publicShareView.ts, BUG-21) so its field list is unit
  // testable without booting the full server.
  //
  // Shared by GET /api/share/:token and POST /api/share/:token/subscribe
  // so neither route can accidentally leak the full internal shipment record.

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

      res.json(buildSecureShareView(shipment));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to look up shared tracking link" });
    }
  });

  /**
   * 11b. Public secure document download (BUG-12).
   *
   * buildSecureShareView above never hands out a raw Firebase Storage URL
   * for a document — it hands out this path instead. That raw URL's access
   * token is not revocable through this app, so once it's in a browser it
   * would keep working forever regardless of what an admin later does with
   * isSharedExternally. This route re-runs the exact same visibility check
   * (isDocumentVisibleForShare, src/lib/documentAccess.ts) on every single
   * request — by fetching the shipment fresh rather than trusting anything
   * cached in the URL — so turning a document off actually takes effect
   * for any link this app has issued, immediately.
   *
   * The file itself is fetched server-side and streamed back rather than
   * redirecting the browser to the Storage URL, so the raw URL is never
   * exposed to the client at all, not even in a Location header.
   */
  app.get("/api/share/:token/documents/:docId", async (req, res) => {
    try {
      const col = collection(db, "shipments");
      const snapshot = await getDocs(col);
      const list = snapshot.docs.map(doc => doc.data() as Shipment);
      const shipment = list.find(s => s.shareToken === req.params.token);

      if (!shipment || !shipment.isLinkShared) {
        return res.status(404).json({ error: "Shared shipment path is inactive or invalid." });
      }

      const docItem = shipment.documents.find(d => d.id === req.params.docId);
      if (!docItem || !isDocumentVisibleForShare(docItem, shipment)) {
        return res.status(404).json({ error: "Document not found or no longer shared." });
      }
      if (!docItem.url || docItem.url === "#") {
        return res.status(404).json({ error: "Document not available." });
      }

      const upstream = await fetch(docItem.url);
      if (!upstream.ok || !upstream.body) {
        return res.status(502).json({ error: "Failed to retrieve document." });
      }
      const arrayBuffer = await upstream.arrayBuffer();
      res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(docItem.name || "document")}"`);
      res.send(Buffer.from(arrayBuffer));
    } catch (err) {
      console.error("Public document download failed:", err);
      res.status(500).json({ error: "Failed to retrieve document." });
    }
  });

  /**
   * Public, token-keyed equivalent of subscribe-customer above, for
   * anonymous visitors on the public tracking page (PublicTracking.tsx).
   * That page only ever has the share token, never the shipment's
   * internal Firestore id (which the secure /api/share/:token view
   * deliberately doesn't expose) — so this is keyed by token instead,
   * and only works while the shipment's link sharing is actually enabled.
   */
  app.post("/api/share/:token/subscribe", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email || !email.includes("@")) {
        return res.status(400).json({ error: "A valid email address is required" });
      }

      const col = collection(db, "shipments");
      const snapshot = await getDocs(col);
      const list = snapshot.docs.map(doc => doc.data() as Shipment);
      const shipment = list.find(s => s.shareToken === req.params.token);

      if (!shipment || !shipment.isLinkShared) {
        return res.status(404).json({ error: "Shared shipment path is inactive or invalid." });
      }

      const cleanEmail = email.trim().toLowerCase();
      const customerEmails = Array.isArray(shipment.customerEmails) ? [...shipment.customerEmails] : [];
      if (!customerEmails.includes(cleanEmail)) {
        customerEmails.push(cleanEmail);
      }

      const customerNotificationHistory = Array.isArray(shipment.customerNotificationHistory)
        ? [...shipment.customerNotificationHistory]
        : [];
      customerNotificationHistory.push({
        id: `cnh-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        timestamp: new Date().toISOString(),
        type: "setup",
        title: "Subscribed Successfully",
        message: `Your alert subscription for shipment #${shipment.shipmentNumber} has been successfully verified. You will receive real-time updates directly.`,
        email: cleanEmail,
        channel: "email",
      });

      const updatedShipment = { ...shipment, customerEmails, customerNotificationHistory };
      await setDoc(doc(db, "shipments", shipment.id), updatedShipment);

      // Return the same reduced "secure view" shape the public page already
      // expects from /api/share/:token, not the full internal record.
      res.json(buildSecureShareView(updatedShipment));
    } catch (err) {
      console.error("Public subscribe failed:", err);
      res.status(500).json({ error: "Failed to subscribe to updates." });
    }
  });


  app.post("/api/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: "Username/Email/Phone and Password are required" });
      }
      const normalizedQuery = username.toLowerCase().trim();

      const rateLimit = checkLoginRateLimit(req, normalizedQuery);
      if (!rateLimit.allowed) {
        res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
        return res.status(429).json({
          error: `Too many login attempts for this account. Please try again in ${Math.ceil((rateLimit.retryAfterSeconds || 0) / 60)} minute(s).`,
        });
      }

      // 1. Super-admin login (sardar@maras.iq) — root account, configured via
      //    env vars, never hardcoded. See SERVER_FIREBASE_EMAIL note: this is
      //    a *different* credential from the server's own Firebase account;
      //    this one is the actual human super-admin's app login.
      const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || "").toLowerCase();
      const SUPER_ADMIN_PASSWORD_HASH = process.env.SUPER_ADMIN_PASSWORD_HASH || "";
      const isSuperAdminUser =
        SUPER_ADMIN_EMAIL &&
        (normalizedQuery === SUPER_ADMIN_EMAIL || normalizedQuery === SUPER_ADMIN_EMAIL.split("@")[0]);

      if (isSuperAdminUser) {
        if (!SUPER_ADMIN_PASSWORD_HASH) {
          console.error("[login] SUPER_ADMIN_PASSWORD_HASH is not configured.");
        } else if (verifyPassword(password, SUPER_ADMIN_PASSWORD_HASH)) {
          clearLoginRateLimit(req, normalizedQuery);
          // Fire-and-forget: logActivity swallows its own errors, and is
          // never awaited here so a slow/failing log write can't delay or
          // block the login response.
          logActivity("", "", SUPER_ADMIN_EMAIL, "Super-admin login succeeded", "Süper yönetici girişi başarılı", "تم تسجيل دخول المسؤول الأعلى بنجاح");
          const sessionPayload: SessionPayload = {
            role: "admin",
            id: SUPER_ADMIN_EMAIL,
            adminType: "super",
            issuedAt: Date.now(),
            expiresAt: Date.now() + SESSION_TTL_MS,
          };
          return res.json({
            success: true,
            token: signSessionToken(sessionPayload),
            role: "admin",
            adminType: "super",
            user: {
              id: "admin",
              name: "MARAS Operations Office",
              username: "admin",
              phone: "+90 212 555 1234",
              email: SUPER_ADMIN_EMAIL,
              adminType: "super"
            }
          });
        }
        // BUG-10: wrong password for a known admin must look identical to an
        // unrecognized identity (see the final generic 401 below) — logged
        // server-side only, never in the client-facing response, which
        // would otherwise leak that this email is a real admin account.
        console.warn(`[login] Wrong password for super-admin account: ${SUPER_ADMIN_EMAIL}`);
        logActivity("", "", maskLoginIdentifier(SUPER_ADMIN_EMAIL), "Failed login attempt for super-admin account", "Süper yönetici hesabı için başarısız giriş denemesi", "محاولة تسجيل دخول فاشلة لحساب المسؤول الأعلى");
        return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
      }

      // 2. Sub-admins (stored in the `admins` collection)
      try {
        const adminsCol = collection(db, "admins");
        const adminsSnapshot = await getDocs(adminsCol);
        const adminsList = adminsSnapshot.docs.map(doc => doc.data() as any);
        const subAdmin = adminsList.find((a: any) => (a.email || "").toLowerCase().trim() === normalizedQuery);

        if (subAdmin) {
          const matched = await verifyPasswordWithMigration(password, subAdmin.password, async (newHash) => {
            await setDoc(doc(db, "admins", subAdmin.id), { ...subAdmin, password: newHash });
          });
          if (matched) {
            clearLoginRateLimit(req, normalizedQuery);
            logActivity("", "", subAdmin.email, "Admin login succeeded", "Yönetici girişi başarılı", "تم تسجيل دخول المسؤول بنجاح");
            const sessionPayload: SessionPayload = {
              role: "admin",
              id: subAdmin.id,
              adminType: subAdmin.adminType,
              issuedAt: Date.now(),
              expiresAt: Date.now() + SESSION_TTL_MS,
            };
            return res.json({
              success: true,
              token: signSessionToken(sessionPayload),
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
          // BUG-10: same reasoning as the super-admin branch above — do not
          // let the client tell a wrong-password admin apart from an
          // unknown identity.
          console.warn(`[login] Wrong password for admin account: ${subAdmin.email}`);
          logActivity("", "", maskLoginIdentifier(subAdmin.email), "Failed login attempt for admin account", "Yönetici hesabı için başarısız giriş denemesi", "محاولة تسجيل دخول فاشلة لحساب المسؤول");
          return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
        }
      } catch (err) {
        console.warn("Could not check additional admins collection in login backend:", err);
      }

      // 3. Driver login — match by username, email, phone, or name
      const col = collection(db, "drivers");
      const snapshot = await getDocs(col);
      const driversList = snapshot.docs.map(doc => doc.data() as Driver);

      const matchedDriver = driversList.find(d => {
        const uMatch = (d.username || "").toLowerCase() === normalizedQuery;
        const eMatch = (d.email || "").toLowerCase() === normalizedQuery;
        const pMatch = (d.phone || "").replace(/\s+/g, "") === normalizedQuery.replace(/\s+/g, "");
        const nameMatch = (d.name || "").toLowerCase() === normalizedQuery;
        return uMatch || eMatch || pMatch || nameMatch;
      });

      if (matchedDriver) {
        // No more "|| '123456'" default — a driver with no password set
        // simply cannot log in via password until an admin sets one.
        const matched = await verifyPasswordWithMigration(password, matchedDriver.password, async (newHash) => {
          await setDoc(doc(db, "drivers", matchedDriver.id), { ...matchedDriver, password: newHash });
        });
        if (matched) {
          const loginBlock = resolveDriverLoginBlock(matchedDriver.status);
          if (loginBlock.blocked) {
            const reason = matchedDriver.status === "pending" ? "account pending approval" : "registration rejected";
            const reasonTr = matchedDriver.status === "pending" ? "hesap onay bekliyor" : "kayıt reddedildi";
            const reasonAr = matchedDriver.status === "pending" ? "الحساب بانتظار الموافقة" : "تم رفض التسجيل";
            logActivity("", "", maskLoginIdentifier(matchedDriver.email || matchedDriver.username), `Driver login blocked - ${reason}`, `Sürücü girişi engellendi - ${reasonTr}`, `تم حظر تسجيل دخول السائق - ${reasonAr}`);
            return res.status(403).json({ error: loginBlock.message });
          }
          clearLoginRateLimit(req, normalizedQuery);
          logActivity("", "", matchedDriver.email || matchedDriver.username || "Driver", "Driver login succeeded", "Sürücü girişi başarılı", "تم تسجيل دخول السائق بنجاح");
          const sessionPayload: SessionPayload = {
            role: "driver",
            id: matchedDriver.id,
            issuedAt: Date.now(),
            expiresAt: Date.now() + SESSION_TTL_MS,
          };
          const { password: _dpw, ...safeDriver } = matchedDriver as any;
          return res.json({
            success: true,
            token: signSessionToken(sessionPayload),
            role: "driver",
            driver: safeDriver
          });
        }
      }

      // 4. Client login — match by username, email, or company name
      const clientsCol = collection(db, "clients");
      const clientsSnapshot = await getDocs(clientsCol);
      const clientsList = clientsSnapshot.docs.map(doc => doc.data() as Client);

      const matchedClient = clientsList.find(c => matchesClientLoginIdentifier(c, normalizedQuery));

      if (matchedClient) {
        // No more "|| 'client123'" default — same reasoning as drivers above.
        const matched = await verifyPasswordWithMigration(password, matchedClient.password, async (newHash) => {
          await setDoc(doc(db, "clients", matchedClient.id), { ...matchedClient, password: newHash });
        });
        if (matched) {
          // feature/client-staff-management-ui: checked only AFTER the
          // password has already verified, so a disabled account's
          // existence/credentials are never distinguishable from a wrong
          // password to an outside caller — this is a clear, specific
          // error shown only to someone who already proved they know the
          // correct password. isClientAccountActive treats missing/undefined
          // `active` as active (every pre-existing record), so this never
          // blocks an account that predates the field.
          if (!isClientAccountActive(matchedClient)) {
            logActivity("", "", matchedClient.email || matchedClient.username || "Client", "Login rejected - account disabled", "Giriş reddedildi - hesap devre dışı", "تم رفض تسجيل الدخول - الحساب معطل");
            return res.status(403).json({ error: "This account has been disabled. Contact your administrator." });
          }
          clearLoginRateLimit(req, normalizedQuery);
          logActivity("", "", matchedClient.email || matchedClient.username || "Client", "Client login succeeded", "Müşteri girişi başarılı", "تم تسجيل دخول العميل بنجاح");
          // isEmployee is read from the Firestore record loaded above — never from the request body.
          const sessionPayload: SessionPayload = {
            role: "client",
            id: matchedClient.id,
            issuedAt: Date.now(),
            expiresAt: Date.now() + SESSION_TTL_MS,
            ...(matchedClient.isEmployee ? { viewOnly: true } : {}),
          };
          const { password: _cpw, ...safeMatchedClient } = matchedClient as any;
          return res.json({
            success: true,
            token: signSessionToken(sessionPayload),
            role: "client",
            client: safeMatchedClient
          });
        }
      }

      logActivity("", "", maskLoginIdentifier(normalizedQuery), "Failed login attempt - invalid credentials or unrecognized identity", "Geçersiz kimlik bilgileri veya tanınmayan kullanıcı ile başarısız giriş denemesi", "محاولة تسجيل دخول فاشلة - بيانات اعتماد غير صحيحة أو هوية غير معروفة");
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // Secure server-side session verification.
  //
  // SECURITY: This endpoint exchanges a Firebase identity (established by the
  // client via Google / email-password sign-in) for one of our own signed
  // session tokens. It MUST prove the caller really is that Firebase user
  // before issuing anything — otherwise anyone could mint a session for any
  // user just by sending their id/email. So it requires a Firebase ID token
  // in the request and verifies it server-side with the Admin SDK. The
  // role/email/uid the client sends are treated as untrusted hints only; the
  // identity that actually counts comes from the verified token.
  app.post("/api/verify-session", async (req, res) => {
    try {
      const { role, idToken } = req.body;

      if (!adminAuth) {
        console.error("[verify-session] Admin Auth unavailable — cannot verify ID tokens.");
        return res.status(503).json({ success: false, message: "Session verification is temporarily unavailable." });
      }

      if (!idToken || typeof idToken !== "string") {
        return res.status(401).json({ success: false, message: "Missing Firebase ID token. Re-authenticate to restore your session." });
      }

      // Verify the token. Anything past this point can trust verifiedUid/verifiedEmail.
      let verifiedUid: string;
      let verifiedEmail: string;
      try {
        const decoded = await adminAuth.verifyIdToken(idToken);
        verifiedUid = decoded.uid;
        verifiedEmail = (decoded.email || "").trim().toLowerCase();
      } catch (verifyErr: any) {
        console.warn("[verify-session] ID token verification failed:", verifyErr?.message || verifyErr);
        return res.status(401).json({ success: false, message: "Invalid or expired session token. Please sign in again." });
      }

      const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || "").toLowerCase();

      if (role === "admin") {
        // Super admin — only if the VERIFIED email matches.
        if (SUPER_ADMIN_EMAIL && verifiedEmail === SUPER_ADMIN_EMAIL) {
          const sessionPayload: SessionPayload = {
            role: "admin",
            id: SUPER_ADMIN_EMAIL,
            adminType: "super",
            issuedAt: Date.now(),
            expiresAt: Date.now() + SESSION_TTL_MS,
          };
          return res.json({
            success: true,
            token: signSessionToken(sessionPayload),
            role: "admin",
            adminType: "super",
            user: {
              id: "admin",
              name: "MARAS Operations Office",
              username: "admin",
              phone: "+90 212 555 1234",
              email: SUPER_ADMIN_EMAIL,
              adminType: "super"
            }
          });
        }

        // Sub-admins — matched against the VERIFIED email only.
        try {
          const adminsCol = collection(db, "admins");
          const adminsSnapshot = await getDocs(adminsCol);
          const adminsList = adminsSnapshot.docs.map(doc => doc.data() as any);
          const subAdmin = adminsList.find((a: any) => (a.email || "").toLowerCase().trim() === verifiedEmail);

          if (subAdmin) {
            const sessionPayload: SessionPayload = {
              role: "admin",
              id: subAdmin.id,
              adminType: subAdmin.adminType,
              issuedAt: Date.now(),
              expiresAt: Date.now() + SESSION_TTL_MS,
            };
            return res.json({
              success: true,
              token: signSessionToken(sessionPayload),
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
          message: "Forbid: This account is not registered as an administrator."
        });
      }

      if (role === "driver") {
        // Match against the VERIFIED identity: uid against the stored id, or
        // the verified email against the stored email. Never a client-supplied id.
        const col = collection(db, "drivers");
        const snapshot = await getDocs(col);
        const driversList = snapshot.docs.map(doc => doc.data() as Driver);
        const foundDriver = driversList.find(d =>
          d.id === verifiedUid ||
          (!!verifiedEmail && (d.email || "").toLowerCase() === verifiedEmail)
        );

        if (!foundDriver) {
          return res.status(404).json({ success: false, message: "Forbid: No driver account is linked to this identity." });
        }
        const loginBlock = resolveDriverLoginBlock(foundDriver.status);
        if (loginBlock.blocked) {
          return res.status(403).json({ success: false, message: loginBlock.message });
        }

        const sessionPayload: SessionPayload = {
          role: "driver",
          id: foundDriver.id,
          issuedAt: Date.now(),
          expiresAt: Date.now() + SESSION_TTL_MS,
        };
        const { password: _fdpw, ...safeFoundDriver } = foundDriver as any;
        return res.json({
          success: true,
          token: signSessionToken(sessionPayload),
          role: "driver",
          driver: safeFoundDriver
        });
      }

      if (role === "client") {
        const col = collection(db, "clients");
        const snapshot = await getDocs(col);
        const clientsList = snapshot.docs.map(doc => doc.data() as Client);
        const foundClient = clientsList.find(c =>
          c.id === verifiedUid ||
          (!!verifiedEmail && (c.email || "").toLowerCase() === verifiedEmail)
        );

        if (!foundClient) {
          return res.status(404).json({ success: false, message: "Forbid: No client account is linked to this identity." });
        }

        const sessionPayload: SessionPayload = {
          role: "client",
          id: foundClient.id,
          issuedAt: Date.now(),
          expiresAt: Date.now() + SESSION_TTL_MS,
        };
        // BUG-07: this branch previously returned foundClient as-is,
        // including the password hash — every other verify-session branch
        // (driver above, admin above) already strips it.
        return res.json({
          success: true,
          token: signSessionToken(sessionPayload),
          role: "client",
          client: stripPassword(foundClient)
        });
      }

      return res.status(400).json({ success: false, message: "Invalid session role specified." });
    } catch (err: any) {
      console.error("Error verifying session server-side:", err);
      res.status(500).json({ error: "Session verification failed." });
    }
  });

  // BUG-19: this exposed env/platform details (and whether DD_API_KEY is
  // configured) to anyone, unauthenticated. Same admin-auth requirement as
  // the sibling /api/system/storage-status route above.
  app.get("/api/system/datadog", requireRole("admin"), (req, res) => {
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
      console.error("Error retrieving system configuration status:", err);
      res.status(500).json({ error: "Failed to retrieve configuration status" });
    }
  });

  app.get("/api/maps-key", requireAuth, (req, res) => {
    res.json({
      key: process.env.GOOGLE_MAPS_PLATFORM_KEY || ""
    });
  });

  // Surfaces the in-memory-fallback state to the admin UI. Previously this
  // was only ever logged to server console output, which meant an admin
  // had no way to know their data wasn't actually being saved to Firestore
  // — it would silently vanish on the next server restart with zero
  // warning anywhere in the app itself. Requires admin auth — see
  // requireRole('admin') below, wired up once auth middleware is in place.
  app.get("/api/system/storage-status", requireRole("admin"), (req, res) => {
    res.json({
      usingMemoryFallback: useMemoryFallback,
      warning: useMemoryFallback
        ? "This server is NOT connected to Firestore. All data (shipments, drivers, chat, everything) is being held in memory only and WILL BE PERMANENTLY LOST the next time the server restarts or redeploys. Check SERVER_FIREBASE_EMAIL/SERVER_FIREBASE_PASSWORD and the Firebase config."
        : null,
    });
  });

  // BUG-08: the Team/admin roster is super-only in the AdminPanel UI
  // (filteredAdminTabs only includes 'team' when isSuper), but this route
  // used requireFullAdmin, which also lets 'operation' admins through.
  app.get("/api/admins", requireSuperAdmin, async (req, res) => {
    try {
      const col = collection(db, "admins");
      const snapshot = await getDocs(col);
      // Never send password hashes to the client — the frontend has no
      // legitimate use for them, and there's no reason to expose even a
      // hashed value beyond what's strictly necessary.
      const list = snapshot.docs.map(doc => {
        const { password, ...rest } = doc.data() as any;
        return rest;
      });
      res.json(list);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch admins" });
    }
  });

  app.post("/api/admins", requireFullAdmin, async (req, res) => {
    try {
      const data = req.body;
      if (!data.password || data.password.length < 8) {
        return res.status(400).json({ error: "A password of at least 8 characters is required." });
      }
      const newAdminId = data.id || `admin-${Date.now()}`;
      // This route must only ever create a brand-new admin record. Without
      // this check, a client-supplied id colliding with an existing admin's
      // document would silently overwrite it via setDoc below — letting an
      // operation-type admin (who can call this route but, unlike super,
      // can neither view nor delete another admin's account) hijack a peer
      // admin's credentials just by guessing/reusing their id.
      const existingAdmin = await getDoc(doc(db, "admins", newAdminId));
      if (existingAdmin.exists()) {
        return res.status(409).json({ error: "An admin with this id already exists." });
      }
      const newAdmin = {
        id: newAdminId,
        name: data.name || "MARAS Team Member",
        email: data.email || "",
        password: hashPassword(data.password),
        adminType: sanitizeCreatedAdminType(data.adminType),
        createdAt: data.createdAt || new Date().toISOString()
      };
      await setDoc(doc(db, "admins", newAdmin.id), newAdmin);
      const { password, ...safeAdmin } = newAdmin;
      res.status(201).json(safeAdmin);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create admin" });
    }
  });

  app.delete("/api/admins/:id", requireAuth, async (req, res) => {
    try {
      // A literal "me" resolves to the caller's own session id. This lets
      // a sub-admin delete their own account without first fetching the
      // full admins list (GET /api/admins is restricted to super-admin
      // sessions, so a sub-admin could never look up their own document
      // id that way - they need a way to target "myself" directly).
      const rawId = req.params.id;
      const id = rawId === "me" && req.session!.role === "admin" ? req.session!.id : rawId;

      // See canDeleteAdminAccount (src/lib/adminAccess.ts): every admin may
      // delete their own record; deleting someone else's is super-only.
      if (!canDeleteAdminAccount(req.session, id)) {
        return res.status(403).json({ error: "Only the super-admin can delete another admin's account." });
      }
      const docRef = doc(db, "admins", id);

      // Owner-account protection: the account matching the owner identity
      // (adminType "super", or its email) can never be deleted through this
      // route, even by itself or another super-type admin.
      const ownerEmail = (process.env.SUPER_ADMIN_EMAIL || "sardar@maras.iq").toLowerCase();
      const existing = await getDoc(docRef);
      if (existing.exists() && isProtectedOwnerAccount(existing.data() as any, ownerEmail)) {
        return res.status(403).json({ error: "The owner account cannot be deleted." });
      }

      await deleteDoc(docRef);
      res.json({ success: true, message: "Admin deleted successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to delete admin" });
    }
  });

  // Lets a sub-admin (operation or accounts type) change their own
  // password. The super-admin's password lives in the
  // SUPER_ADMIN_PASSWORD_HASH environment variable, not a Firestore
  // document, so it genuinely cannot be changed through the app itself -
  // that requires regenerating the hash and redeploying with a new env
  // var, the same way it was originally set up.
  app.post("/api/admins/change-password", requireAuth, async (req, res) => {
    try {
      if (req.session!.role !== "admin") {
        return res.status(403).json({ error: "Only admin accounts can use this endpoint." });
      }
      if (req.session!.adminType === "super") {
        return res.status(400).json({ error: "The super-admin password cannot be changed through the app." });
      }
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword || String(newPassword).length < 8) {
        return res.status(400).json({ error: "Current password and a new password of at least 8 characters are required." });
      }

      const docRef = doc(db, "admins", req.session!.id);
      const adminDoc = await getDoc(docRef);
      if (!adminDoc.exists()) {
        return res.status(404).json({ error: "Admin account not found." });
      }
      const adminData = adminDoc.data() as any;

      const matched = await verifyPasswordWithMigration(currentPassword, adminData.password, async (migratedHash) => {
        await setDoc(docRef, { ...adminData, password: migratedHash });
      });
      if (!matched) {
        return res.status(401).json({ error: "Current password is incorrect." });
      }

      await setDoc(docRef, { ...adminData, password: hashPassword(newPassword) });
      res.json({ success: true, message: "Password updated successfully." });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update password." });
    }
  });

  app.delete("/api/drivers/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const isFullAdmin = req.session!.role === "admin" && req.session!.adminType !== "accounts";
      const isSelf = req.session!.role === "driver" && req.session!.id === id;
      if (!isFullAdmin && !isSelf) {
        return res.status(403).json({ error: "You can only delete your own account." });
      }
      const docRef = doc(db, "drivers", id);
      await deleteDoc(docRef);
      res.json({ success: true, message: "Driver deleted successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to delete driver" });
    }
  });

  app.delete("/api/clients/:id", requireAuth, async (req, res) => {
    try {
      const requestedId = req.params.id;
      const decision = resolveClientAccountDeleteAuthorization({
        requestedId,
        session: { role: req.session!.role, id: req.session!.id, adminType: req.session!.adminType },
      });
      if (!decision.allowed) {
        return res.status(403).json({ error: decision.reason });
      }
      // fix/client-create-username, final confirmed rule: a Client session
      // (Owner or Staff, identically — resolveClientAccountDeleteAuthorization
      // never checks isEmployee) may only ever delete its OWN account. The
      // delete target is the AUTHENTICATED session's own id, never
      // `requestedId` (the client-supplied URL parameter), so a client can
      // never delete another Client account by supplying a different :id —
      // even though the authorization check above already guarantees
      // requestedId === session.id for a client session, the target is
      // derived from the session explicitly, not merely validated against
      // it. A Super Admin's requestedId is used as-is (Operation Admin and
      // Accounts Admin never reach this line — resolveClientAccountDeleteAuthorization
      // rejects them above). There is no separate "company" entity or
      // company-delete operation in this codebase: this always deletes
      // exactly one Client Firestore document, never a cascade to
      // shipments, documents, or any other Client record.
      const targetId = req.session!.role === "client" ? req.session!.id : requestedId;
      await deleteDoc(doc(db, "clients", targetId));
      res.json({ success: true, message: "Client deleted successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to delete client" });
    }
  });

  // BUG-05/BUG-08: previously returned the entire fleet roster (phone,
  // email, live GPS) to any logged-in client or driver, and to every admin
  // type including accounts. Scoped via scopeDriverListForSession — see
  // src/lib/driverVisibility.ts.
  app.get("/api/drivers", requireAuth, async (req, res) => {
    try {
      if (req.session!.role === "admin" && !canViewDriverRoster(req.session!.adminType)) {
        return res.status(403).json({ error: "Accounts-role admins cannot view the driver roster." });
      }

      const col = collection(db, "drivers");
      const snapshot = await getDocs(col);
      const allDrivers = snapshot.docs.map(doc => doc.data() as Driver);

      if (req.session!.role === "admin") {
        return res.json(allDrivers.map(sanitizeDriver));
      }

      // Driver/client: only fetch shipments to compute which drivers this
      // session is actually allowed to know about — never the raw fleet list.
      const shipmentsSnap = await getDocs(collection(db, "shipments"));
      const allShipments = shipmentsSnap.docs.map(d => d.data() as Shipment);

      let relevantShipments: Shipment[] = [];
      if (req.session!.role === "driver") {
        const driverId = req.session!.id;
        relevantShipments = allShipments.filter(s =>
          s.assignedDriverId === driverId ||
          (s.additionalDrivers && s.additionalDrivers.some((ad: any) => ad.driverId === driverId))
        );
      } else if (req.session!.role === "client") {
        const clientsSnap = await getDocs(collection(db, "clients"));
        const myClient = clientsSnap.docs.map(d => d.data() as Client).find(c => c.id === req.session!.id);
        relevantShipments = myClient ? allShipments.filter(s => isShipmentVisibleToClientCompany(s.companyName, myClient.companyName)) : [];
      }

      res.json(scopeDriverListForSession(allDrivers, req.session!, relevantShipments));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch drivers" });
    }
  });

  app.post("/api/drivers", requireFullAdmin, async (req, res) => {
    try {
      const data = req.body;
      const newDriver: Driver = {
        id: data.id || `driver-${Date.now()}`,
        name: data.name || "Unnamed Driver",
        username: data.username || `driver_${Date.now()}`,
        // Drivers without an explicit password are created with one
        // generated for them and returned once in the response below —
        // no hardcoded, reused default like the old "123456" fallback.
        password: hashPassword(data.password || crypto.randomBytes(9).toString("base64url")),
        email: data.email || "",
        truckNumber: data.truckNumber || "Unassigned",
        phone: data.phone || "No phone",
        activeShipmentsCount: 0,
        completedShipmentsCount: 0,
        truckType: data.truckType || "reefer"
      };
      await setDoc(doc(db, "drivers", newDriver.id), newDriver);
      const { password, ...safeDriver } = newDriver;
      res.status(201).json({
        ...safeDriver,
        // Only returned here, once, at creation time, so the admin can
        // hand it to the driver — never stored or logged in plaintext.
        temporaryPassword: data.password ? undefined : "Generated — ask admin to set a password for this driver via Edit.",
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create driver" });
    }
  });

  /**
   * Driver self-registration via Google sign-in. Deliberately separate from
   * the admin-only POST /api/drivers above: this is the one specific,
   * narrowly-scoped case where an otherwise-unauthenticated request is
   * allowed to write to Firestore — a brand-new driver creating *only*
   * their own profile, identified by their own Firebase uid. The uid claim
   * isn't cryptographically verified (that requires Firebase Admin SDK,
   * not available in this deployment — see SERVER_FIREBASE_EMAIL note
   * elsewhere in this file), but this endpoint can only ever create a
   * driver record, never read or modify anyone else's data, which bounds
   * the impact of that residual gap.
   */
  app.post("/api/drivers/self-register", async (req, res) => {
    try {
      const data = req.body;

      // The client already enforces a 6-character minimum, but that's
      // trivially bypassable by calling this endpoint directly — only
      // checked when a password was actually sent; the no-password/Google
      // sign-in path below generates its own strong random one.
      if (data.password && data.password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters." });
      }

      // uid is normally a real Firebase Auth uid (from the Gmail or
      // email/password flow), but the manual registration form can
      // reach this point with no uid at all if Firebase Auth account
      // creation failed for some reason other than a duplicate email
      // or weak password (the form still submits as a "fallback").
      // Generate a stable id in that case rather than hard-rejecting.
      const driverId: string = data.uid || `driver-${Date.now()}`;
      const existing = await getDoc(doc(db, "drivers", driverId));
      if (existing.exists()) {
        return res.status(409).json({ error: "A driver profile already exists for this account." });
      }
      const newDriver: Driver = {
        id: driverId,
        name: data.name || "Unnamed Driver",
        username: data.username || `driver_${Date.now()}`,
        // Use the password the person actually chose on the
        // registration form if one was sent, instead of always
        // generating a random one they'd never know.
        password: data.password ? hashPassword(data.password) : hashPassword(crypto.randomBytes(9).toString("base64url")),
        email: data.email || "",
        truckNumber: data.truckNumber || "Unassigned",
        phone: data.phone || "No phone",
        activeShipmentsCount: 0,
        completedShipmentsCount: 0,
        truckType: data.truckType || "reefer",
        status: "pending"
      };

      // Login matches an identifier against username/email/phone across
      // every driver (see the "3. Driver login" branch of POST /api/login
      // below) — a silent duplicate here would make one of the two
      // colliding accounts unreachable, or ambiguous, at login time.
      //
      // Checked against the raw submitted fields, never newDriver's
      // display-fallback placeholders ("No phone", a generated username,
      // etc.) — those are cosmetic-only and would otherwise collide with
      // each other across unrelated drivers, producing false-positive
      // duplicate rejections for anyone who omitted the same field.
      const driversSnapshot = await getDocs(collection(db, "drivers"));
      const existingDrivers = driversSnapshot.docs.map(d => d.data() as Driver);
      const duplicateField = findDuplicateDriverField(existingDrivers, {
        username: data.username,
        email: data.email,
        phone: data.phone,
      });
      if (duplicateField) {
        const fieldLabel = duplicateField === "username" ? "Username" : duplicateField === "email" ? "Email address" : "Phone number";
        return res.status(409).json({ error: `${fieldLabel} is already registered to another driver.` });
      }

      await setDoc(doc(db, "drivers", newDriver.id), newDriver);

      await logActivity(
        "",
        "",
        `${newDriver.name} (@${newDriver.username})`,
        "Driver registration submitted - pending approval",
        "Sürücü kaydı gönderildi - onay bekliyor",
        "تم تقديم تسجيل السائق - بانتظار الموافقة"
      );

      // No session token here. A self-registered driver is "pending"
      // until an admin approves them (see PATCH /api/drivers/:id/status
      // below) - they cannot log in until then, even though the account
      // record already exists.
      await pushNotification(
        "",
        "",
        "driver_registration",
        "New Driver Registration",
        "Yeni Surucu Kaydi",
        "تسجيل سائق جديد",
        `${newDriver.name} (${newDriver.username}) has registered and is awaiting your approval.`,
        `${newDriver.name} (${newDriver.username}) kayit oldu ve onayinizi bekliyor.`,
        `قام ${newDriver.name} (${newDriver.username}) بالتسجيل وهو في انتظار موافقتك.`
      );

      const { password, ...safeDriver } = newDriver;
      res.status(201).json({
        ...safeDriver,
        pendingApproval: true,
        message: "Registration received. Your account is pending admin approval before you can sign in."
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to register driver" });
    }
  });

  // Lets an admin approve or reject a driver who self-registered and is
  // currently "pending". Existing drivers with no status field at all
  // (registered before this approval workflow existed) are unaffected -
  // this endpoint only matters for drivers actually in the pending state.
  app.patch("/api/drivers/:id/status", requireFullAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      if (status !== "approved" && status !== "rejected") {
        return res.status(400).json({ error: "status must be 'approved' or 'rejected'." });
      }
      const docRef = doc(db, "drivers", id);
      const driverDoc = await getDoc(docRef);
      if (!driverDoc.exists()) {
        return res.status(404).json({ error: "Driver not found." });
      }
      const driverData = driverDoc.data() as Driver;
      const statusChanged = driverData.status !== status;
      await setDoc(docRef, { ...driverData, status });

      // Only notify/log on an actual transition — a repeated approve/reject
      // request (double-click, retried request) is still a safe no-op, but
      // shouldn't spam a duplicate notification or audit entry every time.
      if (statusChanged) {
        const actor = req.session!.adminType === "super" ? "Super Admin" : "Operation Admin";
        if (status === "approved") {
          await logActivity(
            "",
            "",
            actor,
            `Approved driver ${driverData.name} (@${driverData.username})`,
            `${driverData.name} (@${driverData.username}) isimli sürücü onaylandı`,
            `تمت الموافقة على السائق ${driverData.name} (@${driverData.username})`
          );
          await pushNotification(
            "",
            "",
            "driver_registration",
            "Driver Approved",
            "Surucu Onaylandi",
            "تمت الموافقة على السائق",
            `${driverData.name} has been approved and can now sign in.`,
            `${driverData.name} onaylandi ve artik giris yapabilir.`,
            `تمت الموافقة على ${driverData.name} ويمكنه الآن تسجيل الدخول.`
          );
        } else {
          await logActivity(
            "",
            "",
            actor,
            `Rejected driver ${driverData.name} (@${driverData.username})`,
            `${driverData.name} (@${driverData.username}) isimli sürücü reddedildi`,
            `تم رفض السائق ${driverData.name} (@${driverData.username})`
          );
        }
      }

      res.json({ success: true, status });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update driver status." });
    }
  });

  app.get("/api/clients", requireCanViewClients, async (req, res) => {
    try {
      const col = collection(db, "clients");
      const snapshot = await getDocs(col);
      const list = snapshot.docs.map(doc => stripPassword(doc.data() as Client));
      res.json(list);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch clients" });
    }
  });

  app.post("/api/clients", requireFullAdmin, async (req, res) => {
    try {
      const data = req.body;
      if (!data.contactName) {
        return res.status(400).json({ error: "Contact name is required" });
      }

      // feature/client-staff-management-ui: `parentOwnerId` present means
      // this is an "+ Add Employee" (Client Staff) creation — the company
      // is NEVER taken from a client-supplied `companyName` string here;
      // it's looked up server-side from the parent Owner record's id, the
      // one thing the Admin UI actually lets the operator select. Absent
      // `parentOwnerId` means this is the "Create New Client" (Owner)
      // form — isEmployee is never honored from the request body on
      // either path, so this route can never be tricked into creating a
      // Staff record except through the explicit parentOwnerId path,
      // guaranteeing "Create Client always creates Client Owner, never
      // Staff."
      const clientsSnapshot = await getDocs(collection(db, "clients"));
      const existingClients = clientsSnapshot.docs.map(d => d.data() as Client);

      const resolution = resolveClientCreationCompany(data, existingClients);
      if (!resolution.ok) {
        return res.status(400).json({ error: resolution.error });
      }
      const { companyName, isEmployee } = resolution;

      // Every Client Staff member is a real login account — username and
      // password are mandatory (Owner creation is unaffected: this check
      // only runs when isEmployee is true, i.e. only on the Add Employee
      // path). Enforced here, not just in the Admin UI's `required`
      // attributes, since a direct API call bypasses HTML validation
      // entirely.
      if (isEmployee) {
        const credentialsCheck = validateStaffCredentials(data);
        if (!credentialsCheck.ok) {
          return res.status(400).json({ error: credentialsCheck.error });
        }
      }

      // Duplicate check across ALL Client accounts (Owner and Staff alike —
      // POST /api/login's client-matching branch has no per-company
      // scoping, so a duplicate username anywhere would make one of the
      // two colliding accounts unreachable/ambiguous at login. Same
      // reasoning as findDuplicateDriverField for drivers.
      if (data.username && hasDuplicateClientUsername(existingClients, data.username)) {
        return res.status(409).json({ error: "Username is already registered to another client account." });
      }
      const newClient: Client = {
        id: data.id || `client-${Date.now()}`,
        companyName,
        contactName: data.contactName,
        phone: data.phone || "",
        email: data.email || "",
        address: data.address || "",
        notes: data.notes || "",
        createdAt: data.createdAt || new Date().toISOString(),
        active: true,
        ...(isEmployee ? { isEmployee: true } : {}),
        ...buildClientUsernameField(data.username),
        ...(data.password ? { password: hashPassword(data.password) } : {}),
      };
      await setDoc(doc(db, "clients", newClient.id), newClient);
      res.status(201).json(stripPassword(newClient));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create client" });
    }
  });

  app.put("/api/clients/:id", requireFullAdmin, async (req, res) => {
    try {
      const clientRef = doc(db, "clients", req.params.id);
      const clientDoc = await getDoc(clientRef);
      if (!clientDoc.exists()) return res.status(404).json({ error: "Client not found" });

      const data = req.body;
      // companyName is intentionally excluded — re-scoping requires delete+recreate
      const updates: Partial<Client> = {};
      if (data.contactName !== undefined) updates.contactName = data.contactName;
      if (data.phone !== undefined) updates.phone = data.phone;
      if (data.email !== undefined) updates.email = data.email;
      if (data.address !== undefined) updates.address = data.address;
      if (data.notes !== undefined) updates.notes = data.notes;
      if (data.isEmployee !== undefined) updates.isEmployee = Boolean(data.isEmployee);
      // feature/client-staff-management-ui: Activate/Disable action.
      // `active` is Client Staff-scoped in the Admin UI this ships with,
      // but the field/route itself doesn't distinguish Owner from Staff —
      // whichever single Client record :id refers to gets updated, never
      // any other account, matching the existing per-id-only update
      // behavior of this route.
      if (data.active !== undefined) updates.active = Boolean(data.active);
      if (data.username !== undefined) {
        const normalizedUsername = normalizeClientUsername(data.username);
        if (normalizedUsername) {
          const clientsSnapshot = await getDocs(collection(db, "clients"));
          const existingClients = clientsSnapshot.docs.map(d => d.data() as Client);
          if (hasDuplicateClientUsername(existingClients, normalizedUsername, req.params.id)) {
            return res.status(409).json({ error: "Username is already registered to another client account." });
          }
        }
        updates.username = normalizedUsername;
      }
      const passwordField = buildClientPasswordUpdateField(data.password);
      if ("password" in passwordField) updates.password = hashPassword(passwordField.password);

      await updateDoc(clientRef, updates as Record<string, unknown>);

      const updated = { ...clientDoc.data(), ...updates } as Client;
      res.json(stripPassword(updated));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update client" });
    }
  });

  app.get("/api/vendors", requireCanViewVendors, async (req, res) => {
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

  app.post("/api/vendors", requireFullAdmin, async (req, res) => {
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

  app.put("/api/drivers/:id", requireAuth, async (req, res) => {
    try {
      // A driver may only update their own profile; admins may update any.
      if (req.session!.role === "driver" && req.session!.id !== req.params.id) {
        return res.status(403).json({ error: "You can only update your own profile." });
      }
      if (req.session!.role === "client") {
        return res.status(403).json({ error: "Clients cannot update driver profiles." });
      }
      const { name, username, email, truckNumber, phone, truckType, latitude, longitude, lastUpdated, avatarUrl } = req.body;
      const dRef = doc(db, "drivers", req.params.id);
      const dDoc = await getDoc(dRef);
      
      let original: any = {};
      if (dDoc.exists()) {
        original = dDoc.data();
      } else {
        // Auto-create base profile if not found. No hardcoded password —
        // a randomly generated, hashed one is used instead; this account
        // can't be logged into by password until an admin sets one.
        original = {
          id: req.params.id,
          name: name || "Simulated Specialist",
          username: username || `driver_${req.params.id}`,
          password: hashPassword(crypto.randomBytes(9).toString("base64url")),
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

      const { password, ...safeDriver } = updatedDriver;
      res.json(safeDriver);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update driver" });
    }
  });

  // 13. System Notifications
  app.get("/api/notifications", requireAuth, async (req, res) => {
    try {
      const col = collection(db, "notifications");
      const snapshot = await getDocs(col);
      let list = snapshot.docs.map(doc => doc.data() as AppNotification);
      list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Never show a notification to the same user it was excluded for
      // (e.g. a chat sender shouldn't be notified of their own message).
      list = list.filter(n => n.excludeUserId !== req.session!.id);

      // Scope to the session's own shipments for drivers/clients — same
      // reasoning as /api/shipments above. Admins see everything.
      if (req.session!.role === "driver") {
        const driverId = req.session!.id;
        const shipCol = collection(db, "shipments");
        const shipSnap = await getDocs(shipCol);
        const myShipmentIds = new Set(
          shipSnap.docs
            .map(d => d.data() as Shipment)
            .filter(s => s.assignedDriverId === driverId || (s.additionalDrivers && s.additionalDrivers.some((ad: any) => ad.driverId === driverId)))
            .map(s => s.id)
        );
        list = list.filter(n => myShipmentIds.has(n.shipmentId));
        // BUG-03: a "chat" notification's title/body carries the sender's
        // name and message text. Only let the driver_admin channel through
        // — legacy untagged chat notifications have no reliable audience,
        // so they're excluded rather than risk showing a client's message.
        list = list.filter(n => isChatNotificationVisibleToRole(n.type, "driver", n.channel));
      } else if (req.session!.role === "client") {
        const clientsCol = collection(db, "clients");
        const clientsSnap = await getDocs(clientsCol);
        const myClient = clientsSnap.docs.map(d => d.data() as Client).find(c => c.id === req.session!.id);
        if (myClient) {
          const shipCol = collection(db, "shipments");
          const shipSnap = await getDocs(shipCol);
          const myShipmentIds = new Set(
            shipSnap.docs
              .map(d => d.data() as Shipment)
              .filter(s => isShipmentVisibleToClientCompany(s.companyName, myClient.companyName))
              .map(s => s.id)
          );
          list = list.filter(n => myShipmentIds.has(n.shipmentId));
          list = list.filter(n => isChatNotificationVisibleToRole(n.type, "client", n.channel));
        } else {
          list = [];
        }
      }

      res.json(list);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to get notifications" });
    }
  });

  // Registers (or re-registers) a device's push notification token for
  // the currently logged-in user. One Firestore doc per token, keyed by
  // the token itself, so re-registering the same token on app relaunch
  // is a harmless overwrite rather than creating duplicates - and a
  // token that moves to a different account (rare, but possible if a
  // device is shared/reassigned) gets correctly re-pointed to whoever
  // currently owns it.
  app.post("/api/push-tokens", requireAuth, async (req, res) => {
    try {
      const { token, platform } = req.body;
      if (!token || typeof token !== "string") {
        return res.status(400).json({ error: "token is required." });
      }
      await setDoc(doc(db, "pushTokens", token), {
        token,
        role: req.session!.role,
        userId: req.session!.id,
        platform: platform || "ios",
        updatedAt: new Date().toISOString()
      });
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to register push token." });
    }
  });

  // Lets the client proactively remove its own token, e.g. on logout,
  // so a shared/reassigned device doesn't keep receiving a previous
  // user's pushes.
  //
  // BUG-18: this previously deleted whatever pushTokens/<token> doc
  // matched the URL with no ownership check at all - any authenticated
  // session (driver, client, or admin) could unregister ANY other user's
  // device just by knowing/guessing their token string, silently cutting
  // off their push notifications. Every token doc already records who
  // registered it (userId/role, set in the POST handler above), so this
  // now requires the caller's session to match both before deleting -
  // same pattern as requireShipmentAccess: 404 if the token doesn't
  // exist, 403 if it exists but belongs to someone else, so a caller
  // can't distinguish "not yours" from "doesn't exist" beyond that.
  // There is no admin-override route, so admins are held to the same
  // own-token-only rule.
  app.delete("/api/push-tokens/:token", requireAuth, async (req, res) => {
    try {
      const tokenRef = doc(db, "pushTokens", req.params.token);
      const tokenDoc = await getDoc(tokenRef);
      if (!tokenDoc.exists()) {
        return res.status(404).json({ error: "Push token not found." });
      }
      const record = tokenDoc.data() as { userId?: string; role?: string };
      if (!canDeletePushToken({ id: req.session!.id, role: req.session!.role }, record)) {
        return res.status(403).json({ error: "You do not have permission to remove this push token." });
      }
      await deleteDoc(tokenRef);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to remove push token." });
    }
  });

  app.post("/api/notifications/clear", requireRole("admin"), async (req, res) => {
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

  app.post("/api/notifications/:id/read", requireAuth, async (req, res) => {
    try {
      const dRef = doc(db, "notifications", req.params.id);
      const dDoc = await getDoc(dRef);
      if (dDoc.exists()) {
        const notif = dDoc.data() as AppNotification;

        // Non-admins may only mark read a notification belonging to one of
        // their own shipments.
        if (req.session!.role !== "admin") {
          const sDoc = await getDoc(doc(db, "shipments", notif.shipmentId));
          if (!sDoc.exists()) {
            return res.status(404).json({ error: "Shipment not found for this notification." });
          }
          const shipment = sDoc.data() as Shipment;
          let owns = false;
          if (req.session!.role === "driver") {
            const driverId = req.session!.id;
            owns = shipment.assignedDriverId === driverId ||
              !!(shipment.additionalDrivers && shipment.additionalDrivers.some((ad: any) => ad.driverId === driverId));
          } else if (req.session!.role === "client") {
            const clientsCol = collection(db, "clients");
            const clientsSnap = await getDocs(clientsCol);
            const myClient = clientsSnap.docs.map(d => d.data() as Client).find(c => c.id === req.session!.id);
            owns = !!myClient && isShipmentVisibleToClientCompany(shipment.companyName, myClient.companyName);
          }
          if (!owns) {
            return res.status(403).json({ error: "You do not have access to this notification." });
          }

          // PR #44: owning the shipment isn't enough on its own — a driver
          // assigned to a shipment must still not be able to mark read a
          // client_admin/internal_staff notification on that same shipment
          // (and vice versa for a client), same audience rule already
          // enforced on GET /api/notifications.
          if (!isChatNotificationVisibleToRole(notif.type, req.session!.role, notif.channel)) {
            return res.status(403).json({ error: "You do not have access to this notification." });
          }
        }

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
  app.get("/api/cost-statements", requireCanViewCostStatements, async (req, res) => {
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

  app.get("/api/cost-statements/:shipmentId", requireCanViewCostStatements, async (req, res) => {
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
            updatedAt: new Date().toISOString(),
            // Accounts-safe snapshot (PR #60) — see the CostStatement.agreedAmount/
            // truckNumber comment in src/types.ts.
            agreedAmount: s.agreedAmount,
            truckNumber: s.truckNumber
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

  app.post("/api/cost-statements/:shipmentId", requireCanWriteCostStatements, async (req, res) => {
    try {
      const { shipmentId } = req.params;
      const data = req.body as Partial<CostStatement>;
      
      const sRef = doc(db, "shipments", shipmentId);
      const sDoc = await getDoc(sRef);
      if (!sDoc.exists() && !useMemoryFallback) {
        return res.status(404).json({ error: "Shipment not found" });
      }
      const sData = sDoc.exists() ? (sDoc.data() as Shipment) : undefined;

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
        updatedAt: new Date().toISOString(),
        // Accounts-safe snapshot (PR #60): sourced from the authoritative
        // shipment record (not the client payload) whenever it exists, so
        // accounts admins reading this statement later — without shipment-
        // registry access — see a value that actually matches the
        // shipment. See the CostStatement.agreedAmount/truckNumber comment
        // in src/types.ts.
        agreedAmount: sData?.agreedAmount ?? data.agreedAmount,
        truckNumber: sData?.truckNumber || data.truckNumber || ""
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
  app.get("/api/logs", requireCanViewAuditLogs, async (req, res) => {
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

  app.post("/api/logs", requireCanWriteAuditLogs, async (req, res) => {
    try {
      const { shipmentId, shipmentNumber, actor, actionEn, actionTr, actionAr } = sanitizeLogInput(req.body || {});
      await logActivity(
        shipmentId,
        shipmentNumber,
        actor,
        actionEn,
        actionTr,
        actionAr
      );
      res.status(201).json({ status: "success" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create audit log" });
    }
  });

  // 15. Get Unread/Unseen Chat Messages (driver_admin + client_admin) and counts.
  // Admin-only (see requireRole below), so intentionally spans both
  // channels — the BUG-03 audience partition only restricts what
  // driver/client sessions can see, not admin.
  app.get("/api/chat/unread", requireRole("admin"), async (req, res) => {
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
      res.status(500).json({ error: "Failed to fetch unread chat messages" });
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
        await startFirestoreConnection();
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
