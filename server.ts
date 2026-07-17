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
import { initializeApp as initializeAdminApp, getApps as getAdminApps, applicationDefault } from "firebase-admin/app";
import { getFirestore as getAdminFirestore, FieldValue, FieldPath } from "firebase-admin/firestore";
import { getStorage as getAdminStorage } from "firebase-admin/storage";
import { getMessaging, Messaging } from "firebase-admin/messaging";
import { getAuth as getAdminAuth, Auth as AdminAuth } from "firebase-admin/auth";
import {
  SessionRole as AuthSessionRole,
  SessionPayload as AuthSessionPayload,
  SESSION_TTL_MS as AUTH_SESSION_TTL_MS,
  signSessionToken as signSessionTokenImpl,
  verifySessionToken as verifySessionTokenImpl,
  signPendingFirebaseIdentityDeletionToken as signPendingFirebaseIdentityDeletionTokenImpl,
  verifyPendingFirebaseIdentityDeletionToken as verifyPendingFirebaseIdentityDeletionTokenImpl,
  PENDING_FIREBASE_DELETION_TOKEN_TTL_MS,
  hashPassword,
  verifyPassword,
  verifyPasswordWithMigration,
  GENERIC_LOGIN_ERROR,
} from "./src/lib/auth";
import { buildShipmentViewForRole } from "./src/lib/shipmentView";
import {
  resolveOutgoingChatChannel,
  resolveSeenChannelFilter,
  shouldNotifyChatParty,
  isChatNotificationVisibleToRole,
  canAccessInternalStaffChannel,
  isValidChatRole,
  shouldSaveChatFileAsShipmentDocument
} from "./src/lib/chatVisibility";
import { validateChatSendPayload } from "./src/lib/chatMessageValidation";
import { stripPassword } from "./src/lib/sanitize";
import { sanitizeDriver, scopeDriverListForSession, deriveAdditionalDriverIds, buildDriverOwnedShipmentQueryScopes } from "./src/lib/driverVisibility";
import { resolveShipmentListQueryScopes } from "./src/lib/shipmentListAccess";
import { SHIPMENT_STATUS_GROUPS, zeroedShipmentStatusGroupCounts } from "./src/lib/shipmentStatusGroups";
import { findDuplicateDriverField, resolveDriverLoginBlock, isDriverAssignmentSafe, canDeleteDriverAccount } from "./src/lib/driverAccess";
import { hasVerifiedFirebaseUid, isFirebaseUserNotFoundError, planServerFirebaseIdentityDeletion } from "./src/lib/driverAccountDeletion";
import {
  isSelfDeletableRole,
  resolveAccountCollectionName,
  resolveAccountDeletionLookupOutcome,
  checkPasswordConfirmation,
  type SelfDeletableRole,
} from "./src/lib/accountDeletion";
import { validateCostStatementInput, deriveExpenseSummary, decideStatementRevision, applyCostStatementRevisionedWriteMemory, CostStatementRevisionConflictError } from "./src/lib/costStatementMath";
import { canViewShipmentRegistry, canViewDriverRoster, canViewAdminRoster, canViewClients, canViewVendors, canViewCostStatements, canWriteCostStatements, canViewAuditLogs, canWriteAuditLogs, resolveFullAdminStatus, sanitizeCreatedAdminType, isProtectedOwnerAccount, canDeleteAdminAccount, canManageShipmentStatus } from "./src/lib/adminAccess";
import { resolveCorsOrigin, parseAllowedOriginsFromEnv } from "./src/lib/cors";
import { isDocumentVisibleForShare, resolveNewDocumentSharedExternally, canDriverUploadDocumentCategory } from "./src/lib/documentAccess";
import { coerceDocumentCategoryForStorage } from "./src/lib/shipmentDocuments";
import { isDriverChatAvailable } from "./src/lib/driverJobFlow";
import { resolveClientAccountDeleteAuthorization, buildClientUsernameField, buildClientPasswordUpdateField, normalizeClientUsername, matchesClientLoginIdentifier, hasDuplicateClientUsername, isShipmentVisibleToClientCompany, isClientAccountActive, resolveClientCreationCompany, validateStaffCredentials, resolveClientPushRecipientIds, buildClientOwnedShipmentQueryScopes } from "./src/lib/clientAccess";
import { addReaderToNotification, canMarkNotificationRead, buildDriverClientNotificationQueryScopes } from "./src/lib/notificationAccess";
import {
  DEFAULT_PAGE_SIZE,
  encodePageCursor,
  decodePageCursor,
  parseCursorParam,
  paginateDescending,
  paginateAscendingSince,
  hasUnsatisfiableFilter,
  applyMemoryFilters,
  countDistinctAcrossScopes,
  finalizeFilledDescendingPage,
  finalizeFilledSincePage,
  walkAllDescendingPages,
  type PageCursor,
  type PageFilter,
} from "./src/lib/pagination";
import { resolveAdminNotificationPreferences, validateNotificationPreferencesUpdate, shouldDeliverNotificationToAdmin, filterAdminRecipientsByPreferences, type NotificationPreferenceCategory } from "./src/lib/notificationPreferences";
import { canDeletePushToken, selectPushTokensForAccountDeletion } from "./src/lib/pushTokenAccess";
import { buildSecureShareView, resolveShareTokenLookup, type ShareTokenLookupResult } from "./src/lib/publicShareView";
import { isMissingIndexError } from "./src/lib/firestoreErrors";
import { computePersistenceReadiness } from "./src/lib/persistenceReadiness";
import { validateUpload } from "./src/lib/uploadValidation";
import { sanitizeLogInput, maskLoginIdentifier } from "./src/lib/activityLogInput";
import {
  selectUnreadMessagesForAdmin,
  planUnreadFanout,
  selectUnreadMessagesFromRecords,
  buildAdminChatUnreadRecordId,
  buildUnreadClearFilters,
  type AdminChatUnreadRecord,
} from "./src/lib/chatUnreadAccess";
import { buildSeenScopeFilters, planSeenWrites, type SeenWrite } from "./src/lib/chatSeenPlan";
import {
  resolveRouteCoords,
  haversineKm,
  isLandFreight,
  UNAVAILABLE_DISTANCE_MATRIX_RESPONSE,
} from "./src/lib/distanceMatrix";
import {
  formatShipmentNumber,
  formatShipmentId,
  nextSequenceFromCounterDoc,
  InMemorySequenceCounter,
  ShipmentSequenceCounterDoc,
} from "./src/lib/shipmentNumbering";
import {
  INITIAL_SHIPMENT_REVISION,
  resolveStoredRevision,
  parseExpectedRevision,
  checkShipmentRevision,
  ShipmentRevisionConflictError,
  applyRevisionedShipmentUpdateMemory,
  applyNarrowShipmentUpdateMemory,
  applyIsolatedShipmentUpdateMemory,
} from "./src/lib/shipmentRevision";
import {
  isShipmentClosed,
  isDriverAssignmentRejection,
  validateShipmentStatusTransition,
  ShipmentStatusTransitionError,
  validateShipmentStatusOverride,
  ShipmentStatusOverrideError,
  parseStatusOverrideReason,
  getShipmentStatusLabel,
} from "./src/lib/shipmentStatusTransitions";
import { runShipmentUpdateSideEffects, ShipmentSideEffectTask } from "./src/lib/shipmentUpdateSideEffects";
import { adaptDocSnapshot, AdaptedDocSnapshot } from "./src/lib/firestoreSnapshotAdapter";
import { buildFirebaseDownloadUrl } from "./src/lib/firebaseStorageUrl";

export let useMemoryFallback = false;

// Memory-fallback data safety controls.
// STRICT_PERSISTENCE is ON by default. When Firestore is unavailable,
// writes must not silently fall back to volatile in-memory storage.
const STRICT_PERSISTENCE = process.env.STRICT_PERSISTENCE !== "false";

// Demo seed data is OFF by default so production outages never show
// fabricated/demo records as real operational data.
const SEED_DEMO_DATA = process.env.SEED_DEMO_DATA === "true";

// Local-dev login safety net: when Application Default Credentials are
// missing/unusable, the app falls back to the in-memory store above, but nothing
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

/**
 * Blocking-issue fix (Phase 2A follow-up, shipments/orders pagination):
 * every query helper this PR added (queryDescendingPage/queryAscendingSince/
 * findShipmentByShareToken) already throws ServiceUnavailableError under
 * STRICT_PERSISTENCE instead of silently degrading to memory fallback —
 * but a route handler's own generic `catch (err) { res.status(500)... }`
 * previously swallowed that distinction and always answered 500. Call
 * this first in a route's catch block so a genuine "the database isn't
 * ready" condition (including a still-building composite index — see
 * src/lib/firestoreErrors.ts) reaches the client as a retryable 503, not
 * an opaque 500. Returns true (and has already written the response)
 * when `err` was a ServiceUnavailableError; false otherwise, so the
 * caller's own generic 500 handling still runs for anything else.
 */
function respondIfServiceUnavailable(err: unknown, res: express.Response): boolean {
  if (err instanceof ServiceUnavailableError) {
    res.status(503).json({ error: err.message });
    return true;
  }
  return false;
}

/**
 * Blocking-issue fix (security/correctness review): shared response
 * logic for all three public `/api/share/:token*` routes. A `conflict`
 * lookup (multiple shipments share the same token — see
 * resolveShareTokenLookup, src/lib/publicShareView.ts) always 409s with
 * a generic message and NEVER reaches the caller's own response logic
 * with shipment data — this is the one and only place that maps
 * findShipmentByShareToken's result to an HTTP response, so no route can
 * accidentally skip the fail-closed check. `not_found` and "found but
 * not currently shared" both 404 identically (unchanged from before this
 * fix — a caller with an inactive/never-existed token can't distinguish
 * the two, which is intentional: confirming "this token used to exist"
 * to an anonymous caller is its own small information leak). Returns the
 * shipment (caller proceeds) or `null` (response already sent, caller
 * must return immediately).
 */
function resolveActiveSharedShipment(lookup: ShareTokenLookupResult, res: express.Response): Shipment | null {
  if (lookup.status === "conflict") {
    res.status(409).json({ error: "This shared tracking link is temporarily unavailable. Please contact support." });
    return null;
  }
  if (lookup.status === "not_found" || !lookup.shipment.isLinkShared) {
    res.status(404).json({ error: "Shared shipment path is inactive or invalid." });
    return null;
  }
  return lookup.shipment;
}


// Custom safe wrappers for collection and doc to prevent crash if db is null or offline.
// db is a Firebase Admin SDK Firestore instance (see the Admin SDK init
// block below) — its .collection(path)/.doc(path) take one slash-joined
// path string, same as the segments this function already joins here, so
// this is a straight method call rather than a standalone function import.
function collection(dbInstance: any, pathName: string, ...pathSegments: string[]): any {
  const fullPath = pathName + (pathSegments.length ? "/" + pathSegments.join("/") : "");
  if (useMemoryFallback || !dbInstance) {
    return { path: fullPath, isCollection: true };
  }
  try {
    return dbInstance.collection(fullPath);
  } catch (err) {
    console.warn("Firestore collection wrapper caught error. Switching to Memory Fallback:", err);
    useMemoryFallback = true;
    scheduleFirestoreRecovery(30_000);
    return { path: fullPath, isCollection: true };
  }
}

function doc(dbInstance: any, pathName: string, ...pathSegments: string[]): any {
  const fullPath = pathName + (pathSegments.length ? "/" + pathSegments.join("/") : "");
  if (useMemoryFallback || !dbInstance) {
    return { path: fullPath, isDoc: true };
  }
  try {
    return dbInstance.doc(fullPath);
  } catch (err) {
    console.warn("Firestore doc wrapper caught error. Switching to Memory Fallback:", err);
    useMemoryFallback = true;
    scheduleFirestoreRecovery(30_000);
    return { path: fullPath, isDoc: true };
  }
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
  // Chat-unread scalability follow-up: one document per (adminId,
  // messageId) pair currently unread for that admin — see
  // src/lib/chatUnreadAccess.ts's header comment for the full design.
  // Same PR #44 lesson as pushTokens above: every collection this server
  // writes to needs an entry here, or a memory-fallback write to it
  // silently no-ops.
  adminChatUnread: AdminChatUnreadRecord[];
  // Apple Guideline 5.1.1(v) account-deletion follow-up: one document per
  // driver (id `driver_<driverId>`) whose Firebase Auth identity deletion
  // is still unresolved after DELETE /api/account's own attempt — see
  // that route's own comments. Same PR #44 lesson as pushTokens below:
  // needs an entry here or a memory-fallback write to it silently no-ops.
  accountDeletionAudit: any[];
  // PR #44: was missing from this store entirely — every read/write
  // against the "pushTokens" collection (register, delete, and the
  // admin-token lookup pushNotification does before sending) resolved
  // against `mStore[colName]` being undefined and silently no-opped, so
  // push token registration was a no-op and push notifications could
  // never be sent while running on the memory fallback (no live
  // Firestore credentials, e.g. local dev). Every other collection this
  // server writes to already has an entry here; this one was just missed.
  pushTokens: any[];
  // Notification Preferences Phase 2: one document per admin (keyed by
  // session id). Same PR #44 lesson as pushTokens above applies here —
  // every collection this server reads/writes must have an entry in this
  // store, or every read/write against it silently no-ops in memory
  // fallback (no live Firestore credentials, e.g. local dev).
  adminNotificationPreferences: any[];
  // Driver Alliance Phase 1 — same PR #44 lesson as pushTokens above:
  // every collection this server reads/writes needs an entry here, or a
  // memory-fallback access silently no-ops.
  allianceOffers: AllianceOffer[];
  allianceOfferResponses: AllianceOfferResponse[];
  allianceAuditLogs: AllianceAuditEntry[];
  driverActiveJobs: DriverActiveJobLock[];
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
      adminNotificationPreferences: [],
      adminChatUnread: [],
      accountDeletionAudit: [],
      allianceOffers: [],
      allianceOfferResponses: [],
      allianceAuditLogs: [],
      driverActiveJobs: [],
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

    // Chat-unread scalability follow-up: adminChatUnread only gets
    // populated going forward, by the live "send message" fan-out
    // (planUnreadFanout) — it is never seeded directly the way
    // chatMessages is above. Without this, a fresh SEED_DEMO_DATA=true
    // local run would show zero unread badges for the seed conversations
    // (initialChatMessages) even though the OLD full-scan endpoint always
    // surfaced them, a visible local-dev behavior regression. This
    // recomputes exactly what that old scan would have found, using
    // whatever admin ids actually got seeded above (empty when
    // DEMO_ACCOUNTS is unset — nobody could log in as admin to observe
    // this anyway in that case) — the in-memory equivalent of running
    // scripts/backfill-admin-chat-unread.ts once against this seed data.
    if (SEED_DEMO_DATA) {
      // Same two identity sources resolveAllAdminIds() uses for live
      // fan-out (memoryStore.admins, plus SUPER_ADMIN_EMAIL — an
      // env-configured root account that intentionally has no document in
      // `admins`/memoryStore.admins at all). DEMO_ACCOUNTS.owner is a
      // *local-only alias* specifically so the real owner can log into the
      // memory fallback without SUPER_ADMIN_EMAIL being set at all (see its
      // own comment above), so this rarely fires in practice — included
      // anyway so seed-time recipient resolution never silently diverges
      // from resolveAllAdminIds() in the one local setup where both are set.
      const seedAdminIds = memoryStore.admins.map((a: any) => a.id as string);
      const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL || "").toLowerCase();
      if (superAdminEmail) seedAdminIds.push(superAdminEmail);
      const nowIso = new Date().toISOString();
      for (const adminId of Array.from(new Set(seedAdminIds))) {
        for (const msg of selectUnreadMessagesForAdmin(memoryStore.chatMessages, adminId)) {
          memoryStore.adminChatUnread.push({
            id: buildAdminChatUnreadRecordId(adminId, msg.id),
            adminId,
            messageId: msg.id,
            shipmentId: msg.shipmentId,
            channel: msg.channel,
            timestamp: msg.timestamp,
            message: msg,
            createdAt: nowIso,
          });
        }
      }
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

// Shape every getDocs()/getDoc() call site in this file already expects
// (matching both the memory-fallback snapshots above and the client-SDK
// QuerySnapshot/DocumentSnapshot shape this replaced) — kept as a real
// return type, not bare `any`, so the ~40 `.docs.map(doc => doc.data())`
// call sites throughout the route handlers below still get contextual
// typing for their callback parameters instead of needing an annotation
// added at every single one.
interface FirestoreDocLike {
  id: string;
  ref: any;
  data: () => any;
}

interface FirestoreQuerySnapshotLike {
  empty: boolean;
  size: number;
  docs: FirestoreDocLike[];
}

async function getDocs(queryRef: any): Promise<FirestoreQuerySnapshotLike> {
  if (useMemoryFallback) {
    // PR #84 (Firebase production readiness): every write wrapper below
    // (setDoc/updateDoc/deleteDoc/allocateNextShipmentSequence)
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
    // Admin SDK: queryRef is a CollectionReference/Query — .get() returns a
    // QuerySnapshot with the same .empty/.size/.docs[].id/.ref/.data() shape
    // every existing call site already expects; no adapter needed here.
    return await withTimeout(queryRef.get(), 5000, "Firestore getDocs query timed out");
  } catch (error) {
    console.warn("Firestore getDocs failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    scheduleFirestoreRecovery(30_000);
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return handleGetDocsMemory(queryRef);
  }
}

async function getDoc(docRef: any): Promise<AdaptedDocSnapshot> {
  if (useMemoryFallback) {
    // See getDocs above — same reasoning, same fix.
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return handleGetDocMemory(docRef);
  }
  try {
    // Admin SDK's DocumentSnapshot exposes `exists` as a boolean property,
    // not a callable — adaptDocSnapshot normalizes it back to `exists()` so
    // every existing call site (written against the client SDK/memory
    // fallback shape) keeps working unchanged. See firestoreSnapshotAdapter.ts.
    const snap = await withTimeout<any>(docRef.get(), 5000, "Firestore getDoc query timed out");
    return adaptDocSnapshot(snap);
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

async function setDoc(docRef: any, data: any, options?: any): Promise<void> {
  const cleanedData = cleanUndefined(data);
  if (useMemoryFallback) {
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return handleSetDocMemory(docRef, cleanedData);
  }
  try {
    // Admin SDK's DocumentReference.set(data, options) accepts the same
    // SetOptions shape (e.g. { merge: true }) as the client SDK's setDoc.
    return await withTimeout(docRef.set(cleanedData, options), 5000, "Firestore setDoc timed out");
  } catch (error) {
    console.warn("Firestore setDoc failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    scheduleFirestoreRecovery(30_000);
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return handleSetDocMemory(docRef, cleanedData);
  }
}

async function updateDoc(docRef: any, data: any): Promise<void> {
  const cleanedData = cleanUndefined(data);
  if (useMemoryFallback) {
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return handleUpdateDocMemory(docRef, cleanedData);
  }
  try {
    return await withTimeout(docRef.update(cleanedData), 5000, "Firestore updateDoc timed out");
  } catch (error) {
    console.warn("Firestore updateDoc failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    scheduleFirestoreRecovery(30_000);
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return handleUpdateDocMemory(docRef, cleanedData);
  }
}

// Notification Phase 1 correction: a dedicated, atomic per-user read
// marker for AppNotification.readByUserIds — deliberately NOT routed
// through the generic setDoc/updateDoc wrappers above. setDoc would write
// the entire notification document back on every read (this function's
// whole point is to touch only readByUserIds); the generic updateDoc
// wrapper would work for real Firestore (a raw Firestore FieldValue.arrayUnion()
// value survives cleanUndefined() untouched — see its "native class
// instance" guard), but handleUpdateDocMemory's plain `{ ...existing,
// ...data }` spread in memory-fallback mode would store the arrayUnion()
// FieldValue sentinel object itself as the field's value instead of
// resolving it into an array, silently corrupting readByUserIds in local
// dev (which runs on the memory fallback by default). This function
// branches on useMemoryFallback itself so each path gets real, correct,
// non-destructive array-union semantics:
//  - Real Firestore: notifRef.update({ readByUserIds: FieldValue.arrayUnion(userId) })
//    (firebase-admin/firestore's FieldValue — same semantics as the client
//    SDK's) is a genuine atomic field update — Firestore guarantees this is safe
//    under two concurrent writers adding different ids at the same time,
//    with no read-modify-write race and no transaction needed. It also
//    only ever touches the readByUserIds field, never the rest of the
//    document (in particular, never the legacy `read` flag — see the
//    POST /api/notifications/:id/read route, which intentionally leaves
//    `read` untouched now).
//  - Memory fallback: the equivalent idempotent Set-union
//    (addReaderToNotification, src/lib/notificationAccess.ts) applied by
//    direct field assignment on the already-stored record — never a full
//    object replace, and never removes an existing reader id. Safe
//    without its own transaction: Node's single-threaded event loop means
//    this synchronous find-and-assign can't interleave with another
//    concurrent call to this same function the way two real network
//    requests to Firestore could.
async function addNotificationReaderId(notificationId: string, userId: string): Promise<void> {
  if (useMemoryFallback) {
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    handleAddNotificationReaderMemory(notificationId, userId);
    return;
  }
  try {
    const notifRef = db.collection("notifications").doc(notificationId);
    await withTimeout(
      notifRef.update({ readByUserIds: FieldValue.arrayUnion(userId) }),
      5000,
      "Firestore readByUserIds update timed out"
    );
  } catch (error) {
    console.warn("Firestore readByUserIds update failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    scheduleFirestoreRecovery(30_000);
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    handleAddNotificationReaderMemory(notificationId, userId);
  }
}

function handleAddNotificationReaderMemory(notificationId: string, userId: string): void {
  const mStore = getMemoryStore();
  const item = mStore.notifications.find(n => n.id === notificationId);
  if (item) {
    item.readByUserIds = addReaderToNotification(item.readByUserIds, userId);
  }
}

// Notification Preferences Phase 2 — concurrency fix. Writes ONLY the
// caller's validated, submitted category fields (plus
// security_system_alerts, forced true on every single write, and
// updatedAt) — never a full reconstruction of this admin's other
// categories, and never a prior read of the document's existing values.
// This is what makes two concurrent PUT /api/admin/notification-preferences
// requests to DIFFERENT categories both survive: neither write's payload
// ever mentions a field the other request didn't touch, so there is
// nothing for one write to overwrite that the other actually changed. See
// src/lib/notificationPreferences.ts's header comment for why the stored
// document is deliberately allowed to stay partial rather than eagerly
// seeded with full defaults on first write — eagerly writing defaults
// would reintroduce exactly this race for two concurrent first-time
// saves to different categories.
//
// Real Firestore: the existing generic setDoc() wrapper already forwards
// its `options` argument straight through to the real SDK's setDoc, so
// passing { merge: true } here performs a genuine atomic field-level
// merge, creating the document if it doesn't exist yet (using only the
// given fields) or merging into an existing one — with no read required
// first, and no transaction required, since Firestore's own merge
// semantics already guarantee two field-disjoint concurrent merges both
// apply.
//
// Memory fallback: handleSetDocMemory (below) already merges via
// `{ ...items[idx], ...data }` when updating (or `{ id, ...data }` when
// creating) as its own unconditional behavior — it doesn't even look at
// the `merge` option — so it already has the same
// only-touch-the-given-fields property real Firestore gets from
// { merge: true }. No dedicated raw-bypass helper is needed here, unlike
// addNotificationReaderId's arrayUnion() case above — this payload is
// plain booleans/strings, nothing cleanUndefined() or
// handleSetDocMemory's spread merge could mishandle.
async function updateAdminNotificationPreferenceFields(
  adminId: string,
  fields: Partial<Record<NotificationPreferenceCategory, boolean>>
): Promise<void> {
  const prefRef = doc(db, "adminNotificationPreferences", adminId);
  await setDoc(
    prefRef,
    {
      ...fields,
      security_system_alerts: true,
      id: adminId,
      updatedAt: new Date().toISOString()
    },
    { merge: true }
  );
}

async function deleteDoc(docRef: any): Promise<void> {
  if (useMemoryFallback) {
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return handleDeleteDocMemory(docRef);
  }
  try {
    return await withTimeout(docRef.delete(), 5000, "Firestore deleteDoc timed out");
  } catch (error) {
    console.warn("Firestore deleteDoc failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    scheduleFirestoreRecovery(30_000);
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return handleDeleteDocMemory(docRef);
  }
}

// Phase 4 (Firestore scalability audit): scoped, paginated collection
// queries for the two highest-traffic full-collection-read endpoints
// (GET /api/shipments/:id/chat, GET /api/notifications) — see
// docs/FOLLOW_UP_ROADMAP.md's "Full-collection-scan read pattern" entry
// for the audit this addresses. Every other `getDocs(collection(db,...))`
// call site in this file is unchanged and intentionally out of scope
// (see the PR description this shipped with for the full audit/priority
// list); this is deliberately a small, additive pair of query helpers,
// not a rewrite of the read-pattern.
//
// Ordering is always `(timestamp DESC, documentId DESC)` in "page" mode
// and `(timestamp ASC, documentId ASC)` in "since" (poll) mode — the
// document id is a genuine second sort key (via FieldPath.documentId()),
// not cosmetic, matching src/lib/pagination.ts's own tie-breaking so a
// live Firestore query and the memory-fallback engine agree by
// construction on rows sharing a timestamp.
interface DescendingPageResult {
  items: any[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface AscendingSinceResult {
  items: any[];
  hasMore: boolean;
}

function memoryDescendingPage(colName: string, filters: PageFilter[], cursor: PageCursor | null, limit: number, tsField: string = "timestamp"): DescendingPageResult {
  const mStore = getMemoryStore();
  const items = (mStore[colName as keyof typeof mStore] as any[]) || [];
  const filtered = applyMemoryFilters(items, filters);
  return paginateDescending(filtered, (i) => i[tsField], (i) => i.id, { cursor, limit });
}

function memoryAscendingSince(colName: string, filters: PageFilter[], cursor: PageCursor | null, limit: number, tsField: string = "timestamp"): AscendingSinceResult {
  const mStore = getMemoryStore();
  const items = (mStore[colName as keyof typeof mStore] as any[]) || [];
  const filtered = applyMemoryFilters(items, filters);
  return paginateAscendingSince(filtered, (i) => i[tsField], (i) => i.id, cursor, limit);
}

/**
 * "Latest N" / "older than cursor" page — real Firestore query with
 * where/orderBy/limit/startAfter, never a full-collection fetch. Fetches
 * `limit + 1` so `hasMore` is known from this one query instead of a
 * second round-trip; the (possible) 51st row is trimmed before returning.
 *
 * `tsField` (Phase 2A, shipments pagination): chat/notifications only ever
 * order by "timestamp" (their only meaningful clock, defaulted below so
 * those call sites are unchanged). Shipments are a mutable record, not an
 * append-only log, and need two different clocks for two different
 * questions — "newest created" (createdAt, used here for "load older") vs.
 * "most recently changed" (updatedAt, used by queryAscendingSince's since-
 * mode below) — see fetchShipmentsPage/fetchShipmentsSince for how each is
 * used.
 */
async function queryDescendingPage(
  colName: string,
  filters: PageFilter[],
  cursor: PageCursor | null,
  limit: number = DEFAULT_PAGE_SIZE,
  tsField: string = "timestamp"
): Promise<DescendingPageResult> {
  if (hasUnsatisfiableFilter(filters)) return { items: [], nextCursor: null, hasMore: false };
  if (useMemoryFallback) {
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return memoryDescendingPage(colName, filters, cursor, limit, tsField);
  }
  try {
    let q: FirebaseFirestore.Query = db!.collection(colName);
    for (const f of filters) {
      q = q.where(f.field, f.op as any, f.value);
    }
    q = q.orderBy(tsField, "desc").orderBy(FieldPath.documentId(), "desc");
    if (cursor) q = q.startAfter(cursor.ts, cursor.id);
    q = q.limit(limit + 1);
    const snapshot = await withTimeout(q.get(), 5000, "Firestore paginated query timed out");
    const docs = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    const hasMore = docs.length > limit;
    const page = docs.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodePageCursor({ ts: last[tsField], id: last.id }) : null;
    return { items: page, nextCursor, hasMore };
  } catch (error) {
    // Blocking-issue fix: a missing/still-building composite index is a
    // property of THIS query shape, not of Firestore's availability —
    // never flip the process-wide useMemoryFallback flag for it (that
    // would silently degrade every other Firestore-backed endpoint too).
    // See src/lib/firestoreErrors.ts's own header comment for the full
    // rationale and firestore.indexes.json's deployment-order note in the
    // PR description this shipped with.
    if (isMissingIndexError(error)) {
      console.error(`Firestore composite index missing or still building for a paginated query on "${colName}" (filters: ${JSON.stringify(filters)}, order: ${tsField}). NOT switching to memory fallback — deploy/wait for firestore.indexes.json first. Underlying error:`, error);
      if (STRICT_PERSISTENCE) throw new ServiceUnavailableError("Database index not ready yet. Please try again shortly.");
      return memoryDescendingPage(colName, filters, cursor, limit, tsField);
    }
    console.warn("Firestore paginated query failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    scheduleFirestoreRecovery(30_000);
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return memoryDescendingPage(colName, filters, cursor, limit, tsField);
  }
}

/**
 * "Newer than cursor" catch-up query used by live polling, ascending
 * order. `limit` is a safety cap on a single burst, not a page-size
 * contract — see paginateAscendingSince's own header comment. `tsField` —
 * see queryDescendingPage's header comment above.
 */
async function queryAscendingSince(
  colName: string,
  filters: PageFilter[],
  cursor: PageCursor | null,
  limit: number = DEFAULT_PAGE_SIZE,
  tsField: string = "timestamp"
): Promise<AscendingSinceResult> {
  if (hasUnsatisfiableFilter(filters)) return { items: [], hasMore: false };
  if (useMemoryFallback) {
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return memoryAscendingSince(colName, filters, cursor, limit, tsField);
  }
  try {
    let q: FirebaseFirestore.Query = db!.collection(colName);
    for (const f of filters) {
      q = q.where(f.field, f.op as any, f.value);
    }
    q = q.orderBy(tsField, "asc").orderBy(FieldPath.documentId(), "asc");
    if (cursor) q = q.startAfter(cursor.ts, cursor.id);
    q = q.limit(limit + 1);
    const snapshot = await withTimeout(q.get(), 5000, "Firestore since-query timed out");
    const docs = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    const hasMore = docs.length > limit;
    return { items: docs.slice(0, limit), hasMore };
  } catch (error) {
    // See queryDescendingPage's matching catch block above for why a
    // missing index is handled separately from a connectivity failure.
    if (isMissingIndexError(error)) {
      console.error(`Firestore composite index missing or still building for a since-query on "${colName}" (filters: ${JSON.stringify(filters)}, order: ${tsField}). NOT switching to memory fallback — deploy/wait for firestore.indexes.json first. Underlying error:`, error);
      if (STRICT_PERSISTENCE) throw new ServiceUnavailableError("Database index not ready yet. Please try again shortly.");
      return memoryAscendingSince(colName, filters, cursor, limit, tsField);
    }
    console.warn("Firestore since-query failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    scheduleFirestoreRecovery(30_000);
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return memoryAscendingSince(colName, filters, cursor, limit, tsField);
  }
}

/**
 * Phase 4 follow-up (chat seen/unread scalability audit). Thin wrapper
 * around walkAllDescendingPages (src/lib/pagination.ts) bound to a real
 * queryDescendingPage call — for the two call sites that genuinely need
 * every eligible row, not a bounded page (POST .../chat/seen must mark
 * every eligible message in its shipment(+channel) scope as seen in one
 * call; GET /api/chat/unread must compute one admin's true unread set).
 * Each page is still a real, ordered, timeout-protected, indexed Firestore
 * query (or its exact memory-fallback equivalent) — see
 * queryDescendingPage's own header comment for the STRICT_PERSISTENCE /
 * missing-index / memory-fallback behavior every page here inherits
 * unchanged. This replaces one unbounded `getDocs(collection(db, colName))`
 * read of the entire collection with a bounded sequence of small indexed
 * reads; `filters` (shipmentId/channel equality, or none) is what keeps
 * each individual read scoped rather than scanning unrelated
 * shipments/channels. Never call this where a single bounded page would do.
 */
async function fetchAllMatchingDescending(
  colName: string,
  filters: PageFilter[],
  pageLimit: number = 200
): Promise<any[]> {
  return walkAllDescendingPages((cursor) => queryDescendingPage(colName, filters, cursor, pageLimit));
}

// Chat-unread scalability follow-up: the full admin roster a new chat
// message's unread fan-out (planUnreadFanout, chatUnreadAccess.ts) is
// resolved against. Two identity sources, matching every login path in
// this file (see the super-admin branches of POST /api/login and
// POST /api/auth/verify-session above): the `admins` Firestore collection
// (every sub-admin), plus SUPER_ADMIN_EMAIL (an env-configured root
// account that intentionally has NO document in `admins` at all — see
// resolveChatSenderIdentity's own super-admin branch). Missing either
// source here would mean that admin never gets an adminChatUnread record
// for anyone else's message, i.e. their unread badge would silently stay
// empty forever.
async function resolveAllAdminIds(): Promise<string[]> {
  const adminsSnap = await getDocs(collection(db, "admins"));
  const ids = adminsSnap.docs.map((d) => d.id);
  // No `.trim()` here — must match the exact normalization every login/
  // session path uses for `req.session.id` (POST /api/login,
  // POST /api/auth/verify-session: `.toLowerCase()` only). A mismatch
  // would mean the super admin's session id never equality-matches the
  // id this function hands to planUnreadFanout/isMessageFromOtherAdmin,
  // silently breaking their own unread badge whenever SUPER_ADMIN_EMAIL
  // has incidental whitespace.
  const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL || "").toLowerCase();
  if (superAdminEmail) ids.push(superAdminEmail);
  return Array.from(new Set(ids));
}

/** Firestore's hard cap on operations in a single WriteBatch. */
const FIRESTORE_BATCH_MAX_OPS = 500;
// Leaves headroom under FIRESTORE_BATCH_MAX_OPS for a safety margin.
// Shared by every chunked-batch helper below (commitChatMessageWithUnreadFanout,
// commitSeenWritesAndUnreadClears) — this app's real admin roster / one
// shipment's conversation size are both a small business team's worth
// (nowhere near this), so in practice every call runs exactly one batch;
// chunking only exists so a future, much larger roster/thread degrades to
// "N sequential atomic batches" instead of a hard Firestore error.
const FIRESTORE_BATCH_CHUNK_SIZE = FIRESTORE_BATCH_MAX_OPS - 50;

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Chat-unread scalability follow-up: writes a newly-created chat message
 * together with every admin's adminChatUnread fan-out record for it,
 * atomically. This is the one write path where "partial failure" would
 * silently lose unread state — a message that saves successfully but
 * whose fan-out only half-completes would leave some eligible admins with
 * no unread record for a message they've never actually read. Real
 * Firestore: a single WriteBatch (the common case — see
 * FIRESTORE_BATCH_CHUNK_SIZE's own comment on why this app's realistic
 * admin roster never exceeds one) commits the message doc and every
 * unread record together, so it either fully applies or fully fails —
 * nothing in it is ever partially written. Only past
 * FIRESTORE_BATCH_CHUNK_SIZE recipients does this become several
 * SEQUENTIAL batches, each independently atomic but NOT atomic as a
 * whole across chunks — if an earlier chunk already committed to real
 * Firestore and a later one then fails, the catch block below must never
 * re-write that already-committed chunk into the memory-fallback store
 * (that would silently orphan it there once Firestore recovers, since
 * the memory store and Firestore are never reconciled). `committedChunks`
 * tracks exactly how many chunks (message doc included, in chunk 0)
 * durably landed in Firestore before the failure, so only the genuine
 * remainder is retried via memory fallback. `cleanUndefined` is applied
 * per-doc here because a raw WriteBatch bypasses the setDoc() wrapper
 * that normally does this (this Admin SDK instance is not configured
 * with ignoreUndefinedProperties, so an undefined field value would
 * otherwise throw). Memory fallback (from the very first call, i.e.
 * `useMemoryFallback` already true): Node's single-threaded event loop
 * means these synchronous array pushes (via the existing setDoc wrapper)
 * have no interleaving window a real partial-batch failure could occur
 * in, so no separate atomicity primitive is needed there.
 */
async function commitChatMessageWithUnreadFanout(message: ChatMessage, unreadRecords: AdminChatUnreadRecord[]): Promise<void> {
  if (useMemoryFallback || !db) {
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    await setDoc(doc(db, "chatMessages", message.id), message);
    for (const record of unreadRecords) {
      await setDoc(doc(db, "adminChatUnread", record.id), record);
    }
    return;
  }

  const recordChunks = chunkArray(unreadRecords, FIRESTORE_BATCH_CHUNK_SIZE);
  const batchesNeeded = recordChunks.length > 0 ? recordChunks : [[] as AdminChatUnreadRecord[]];
  let committedChunks = 0;
  try {
    for (; committedChunks < batchesNeeded.length; committedChunks++) {
      const batch = db.batch();
      if (committedChunks === 0) batch.set(db.collection("chatMessages").doc(message.id), cleanUndefined(message));
      for (const record of batchesNeeded[committedChunks]) {
        batch.set(db.collection("adminChatUnread").doc(record.id), cleanUndefined(record));
      }
      await withTimeout(batch.commit(), 5000, "Firestore chat message + unread fan-out batch timed out");
    }
  } catch (error) {
    console.warn("Firestore chat message + unread fan-out batch failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    scheduleFirestoreRecovery(30_000);
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    // committedChunks is the index of the FAILED chunk (the loop above
    // never reaches the increment for it) — chunks before it already
    // committed to real Firestore and must not be duplicated into memory;
    // only the failed chunk onward is genuinely missing and needs retry.
    const messageAlreadyCommitted = committedChunks > 0;
    if (!messageAlreadyCommitted) {
      await setDoc(doc(db, "chatMessages", message.id), message);
    }
    for (const record of batchesNeeded.slice(committedChunks).flat()) {
      await setDoc(doc(db, "adminChatUnread", record.id), record);
    }
  }
}

type SeenBatchOp =
  | { kind: "write"; id: string; data: ChatMessage }
  | { kind: "clear"; id: string };

/** Applies one SeenBatchOp through the existing setDoc/deleteDoc wrappers — used for memory fallback, both from the start and mid-retry after a real-Firestore batch failure. */
async function applySeenBatchOpMemory(op: SeenBatchOp): Promise<void> {
  if (op.kind === "write") {
    await setDoc(doc(db, "chatMessages", op.id), op.data);
  } else {
    await deleteDoc(doc(db, "adminChatUnread", op.id));
  }
}

/**
 * Chat-unread scalability follow-up: POST /api/shipments/:id/chat/seen's
 * two effects — the legacy chatMessages `readByAdminIds`/`status` writes
 * (planSeenWrites, chatSeenPlan.ts) and deleting this admin's now-read
 * adminChatUnread records (buildUnreadClearFilters) — used to be two
 * independent, non-atomic operations (unread-clear first, legacy write
 * second). That let a legacy-write failure return 500 to the caller
 * AFTER the adminChatUnread records were already durably deleted: the
 * badge would correctly clear, but the audit-trail field would silently
 * fall out of sync with it, exactly the "dual-write drift" this
 * collection's own header comment says to avoid. Combining both into one
 * atomic WriteBatch (real Firestore) makes them succeed or fail together
 * — same chunking/partial-failure handling as
 * commitChatMessageWithUnreadFanout above (see its own header comment for
 * the full reasoning, identical here): `committedChunks` ensures a
 * chunk that already landed in Firestore is never re-applied to the
 * memory-fallback store.
 */
async function commitSeenWritesAndUnreadClears(writes: SeenWrite[], unreadRecordIdsToClear: string[]): Promise<void> {
  const ops: SeenBatchOp[] = [
    ...writes.map((w): SeenBatchOp => ({ kind: "write", id: w.id, data: w.data })),
    ...unreadRecordIdsToClear.map((id): SeenBatchOp => ({ kind: "clear", id })),
  ];
  if (ops.length === 0) return;

  if (useMemoryFallback || !db) {
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    for (const op of ops) await applySeenBatchOpMemory(op);
    return;
  }

  const opChunks = chunkArray(ops, FIRESTORE_BATCH_CHUNK_SIZE);
  let committedChunks = 0;
  try {
    for (; committedChunks < opChunks.length; committedChunks++) {
      const batch = db.batch();
      for (const op of opChunks[committedChunks]) {
        if (op.kind === "write") {
          batch.set(db.collection("chatMessages").doc(op.id), cleanUndefined(op.data));
        } else {
          batch.delete(db.collection("adminChatUnread").doc(op.id));
        }
      }
      await withTimeout(batch.commit(), 5000, "Firestore seen-writes + unread-clear batch timed out");
    }
  } catch (error) {
    console.warn("Firestore seen-writes + unread-clear batch failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    scheduleFirestoreRecovery(30_000);
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    for (const op of opChunks.slice(committedChunks).flat()) {
      await applySeenBatchOpMemory(op);
    }
  }
}

/**
 * Notifications-specific fan-in: runs one `queryDescendingPage`/
 * `queryAscendingSince` per query scope (see
 * buildDriverClientNotificationQueryScopes — 1 scope for admin/no-filter,
 * up to 2 for driver/client: shipment-membership + direct-recipient) and
 * merges the results into one correctly-ordered, deduplicated,
 * correctly-cursored page. Never fetches more than `limit` extra rows per
 * scope, never loads the full collection.
 */
async function fetchNotificationsPage(
  scopes: PageFilter[][],
  cursor: PageCursor | null,
  limit: number
): Promise<DescendingPageResult> {
  const effectiveScopes = scopes.length > 0 ? scopes : [[]];
  const pages = await Promise.all(effectiveScopes.map((filters) => queryDescendingPage("notifications", filters, cursor, limit)));
  const merged = new Map<string, any>();
  for (const p of pages) for (const item of p.items) merged.set(item.id, item);
  const combined = Array.from(merged.values());
  const result = paginateDescending(combined, (i) => i.timestamp, (i) => i.id, { cursor, limit });
  const combinedHasMore = result.hasMore || pages.some((p) => p.hasMore);
  const last = result.items[result.items.length - 1];
  const nextCursor = combinedHasMore && last ? encodePageCursor({ ts: last.timestamp, id: last.id }) : null;
  return { items: result.items, nextCursor, hasMore: combinedHasMore };
}

async function fetchNotificationsSince(
  scopes: PageFilter[][],
  cursor: PageCursor | null,
  limit: number
): Promise<AscendingSinceResult> {
  const effectiveScopes = scopes.length > 0 ? scopes : [[]];
  const pages = await Promise.all(effectiveScopes.map((filters) => queryAscendingSince("notifications", filters, cursor, limit)));
  const merged = new Map<string, any>();
  for (const p of pages) for (const item of p.items) merged.set(item.id, item);
  const combined = Array.from(merged.values());
  const result = paginateAscendingSince(combined, (i) => i.timestamp, (i) => i.id, cursor, limit);
  return { items: result.items, hasMore: result.hasMore || pages.some((p) => p.hasMore) };
}

/**
 * Phase 2A (Firestore scalability audit, shipments/orders).
 *
 * Same independent-scopes-merged-in-Node fan-in shape as
 * fetchNotificationsPage above, applied to the `shipments` collection
 * itself instead of to a derived ownership-id lookup. `scopes` is:
 *  - `[[]]` for admin (no filter — sees every shipment, matching the
 *    existing "Admins see everything" GET /api/shipments behavior this
 *    replaces),
 *  - `buildDriverOwnedShipmentQueryScopes(driverId)` for a driver, each
 *    wrapped in its own single-filter scope (assignedDriverId ==, OR
 *    additionalDriverIds array-contains — same OR-via-independent-queries
 *    pattern as the notification ownership lookup, and the same
 *    legacy-record caveat: see driverVisibility.ts's own header comment),
 *  - `buildClientOwnedShipmentQueryScopes(companyName)` for a client.
 *
 * Ordered by `createdAt` (not `updatedAt`) — "latest 50 / load older"
 * pagination is a "when was this shipment created" question, matching the
 * existing `list.sort((a,b) => b.createdAt - a.createdAt)` this replaces.
 * See fetchShipmentsSince below for why polling uses a different field.
 */
async function fetchShipmentsPage(
  scopes: PageFilter[][],
  cursor: PageCursor | null,
  limit: number
): Promise<DescendingPageResult> {
  const effectiveScopes = scopes.length > 0 ? scopes : [[]];
  const pages = await Promise.all(effectiveScopes.map((filters) => queryDescendingPage("shipments", filters, cursor, limit, "createdAt")));
  const merged = new Map<string, any>();
  for (const p of pages) for (const item of p.items) merged.set(item.id, item);
  const combined = Array.from(merged.values());
  const result = paginateDescending(combined, (i) => i.createdAt, (i) => i.id, { cursor, limit });
  const combinedHasMore = result.hasMore || pages.some((p) => p.hasMore);
  const last = result.items[result.items.length - 1];
  const nextCursor = combinedHasMore && last ? encodePageCursor({ ts: last.createdAt, id: last.id }) : null;
  return { items: result.items, nextCursor, hasMore: combinedHasMore };
}

/**
 * Phase 2A (Firestore scalability audit, shipments/orders).
 *
 * The live-poll "catch up" equivalent of fetchShipmentsPage — deliberately
 * ordered by `updatedAt`, not `createdAt`: a poll needs to know "what
 * changed since I last looked" (a new shipment created OR an existing
 * one's status/details edited), not just "what's new." Every write path
 * that mutates a Shipment's own fields (creation, PUT /api/shipments/:id,
 * PUT /api/shipments/:id/status) already bumps `updatedAt`; a
 * newly-created shipment's `updatedAt` starts out equal to its
 * `createdAt`, so creation is naturally caught by this too. Known,
 * documented limitation carried over unchanged from this PR's own scope
 * boundary: Document Center / chat-linked mutations (upload, visibility
 * toggle, share-link config) are explicitly out of scope for this PR (see
 * its description) and do not bump `updatedAt` — a shipment whose only
 * change since the caller's last poll was a new document upload will not
 * appear in a `since` response until it's next `fetchShipmentsPage`'d (the
 * next full/initial load), the same "surfaces on next full reload, not
 * mid-poll" tradeoff PR #99 already documented for chat read-receipts.
 */
async function fetchShipmentsSince(
  scopes: PageFilter[][],
  cursor: PageCursor | null,
  limit: number
): Promise<AscendingSinceResult> {
  const effectiveScopes = scopes.length > 0 ? scopes : [[]];
  const pages = await Promise.all(effectiveScopes.map((filters) => queryAscendingSince("shipments", filters, cursor, limit, "updatedAt")));
  const merged = new Map<string, any>();
  for (const p of pages) for (const item of p.items) merged.set(item.id, item);
  const combined = Array.from(merged.values());
  const result = paginateAscendingSince(combined, (i) => i.updatedAt, (i) => i.id, cursor, limit);
  return { items: result.items, hasMore: result.hasMore || pages.some((p) => p.hasMore) };
}

export interface ShipmentStatsResult {
  total: number;
  byStatusGroup?: Record<string, number>;
}

/**
 * Phase 2A follow-up (Firestore scalability audit, shipments/orders —
 * blocking-issue fix: dashboard aggregate accuracy).
 *
 * With GET /api/shipments now returning only a bounded page (default 50,
 * "load more" for older) instead of the caller's entire accessible scope,
 * AdminPanel/ClientDashboard/DriverApplication can no longer honestly
 * compute "how many shipments total" from `shipments.length` on whatever
 * happens to be loaded — that would silently present a partial count as
 * a complete business total the moment there are more than one page's
 * worth. This is a real Firestore `.count()` AGGREGATE query (Admin SDK,
 * firebase-admin v11.5+) — it counts matching documents server-side
 * without transferring or reading their field data, so it stays cheap
 * and bounded even for a collection far larger than any single page.
 *
 * Status-group breakdown (`byStatusGroup`, SHIPMENT_STATUS_GROUPS) is
 * computed the same way — ADMIN ONLY. A driver/client's own count is
 * already cheap and accurate via `total` alone; adding a `status`
 * equality/`in` filter on TOP of their own ownership scope (a second
 * field) would need a new composite index per role per status group,
 * which this PR deliberately does not add (see the PR description's
 * "prefer dedicated server aggregates ... without broadening this PR
 * excessively" note) — admin's own scope is empty (`[]`), so a
 * `status in [...]` filter alone needs no composite index at all (same
 * reasoning as the admin no-filter list query). Driver/client dashboards
 * fall back to computing any status breakdown they show from their own
 * loaded records, clearly labeled as such in the UI — acceptable because
 * a single driver/client's OWN shipment count is realistically far
 * smaller than the whole system's, unlike admin's.
 *
 * Blocking-issue fix: `total` is an EXACT deduplicated count across
 * `scopes`, never a sum of independent `count()` results. Summing was
 * wrong whenever an item matched more than one scope at once (a driver
 * who is simultaneously the primary AND an additional driver on the
 * exact same shipment) — a data anomaly, but the total must never get it
 * wrong regardless of how it arose. A real `.count()` aggregate can't
 * dedupe across two separate queries by construction, so for any role
 * with more than one scope (today: only driver — assignedDriverId ==,
 * additionalDriverIds array-contains) this fetches ids only per scope
 * (`.select()`, no field data) and dedupes with a Set
 * (countDistinctShipmentsAcrossScopes below) — bounded to the caller's
 * own scope size, not the whole collection, same cost shape as
 * fetchOwnedShipmentIds elsewhere in this file. A single-scope role
 * (admin's empty scope, client's one companyName scope) has no
 * double-count to guard against, so it keeps using the cheaper `.count()`
 * aggregate directly. Both paths implement the exact same dedup
 * algorithm as the pure, unit-tested countDistinctAcrossScopes
 * (src/lib/pagination.ts) — that function's tests (including the
 * required "matches both scopes → counts once" case) stand in for this
 * real-Firestore path's correctness too.
 */
async function fetchShipmentStats(scopes: PageFilter[][], includeStatusGroups: boolean): Promise<ShipmentStatsResult> {
  if (useMemoryFallback) {
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return memoryShipmentStats(scopes, includeStatusGroups);
  }
  try {
    const effectiveScopes = scopes.length > 0 ? scopes : [[]];
    const total = effectiveScopes.length > 1
      ? await countDistinctShipmentsAcrossScopes(effectiveScopes)
      : await countShipmentsForScope(effectiveScopes[0]);
    if (!includeStatusGroups) return { total };
    const groupCounts = await Promise.all(
      SHIPMENT_STATUS_GROUPS.map((g) => countShipmentsForScope([{ field: "status", op: "in", value: g.statuses }]))
    );
    const byStatusGroup: Record<string, number> = {};
    SHIPMENT_STATUS_GROUPS.forEach((g, i) => { byStatusGroup[g.key] = groupCounts[i]; });
    return { total, byStatusGroup };
  } catch (error) {
    if (isMissingIndexError(error)) {
      console.error(`Firestore composite index missing or still building for a shipment stats aggregate query. NOT switching to memory fallback — deploy/wait for firestore.indexes.json first. Underlying error:`, error);
      if (STRICT_PERSISTENCE) throw new ServiceUnavailableError("Database index not ready yet. Please try again shortly.");
      return memoryShipmentStats(scopes, includeStatusGroups);
    }
    console.warn("Firestore shipment stats query failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    scheduleFirestoreRecovery(30_000);
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return memoryShipmentStats(scopes, includeStatusGroups);
  }
}

async function countShipmentsForScope(filters: PageFilter[]): Promise<number> {
  if (hasUnsatisfiableFilter(filters)) return 0;
  let q: FirebaseFirestore.Query = db!.collection("shipments");
  for (const f of filters) {
    q = q.where(f.field, f.op as any, f.value);
  }
  const snapshot = await withTimeout(q.count().get(), 5000, "Firestore count aggregate query timed out");
  return snapshot.data().count;
}

/**
 * Exact dedup across multiple independent scopes — see fetchShipmentStats'
 * own header comment for why this exists instead of summing count()
 * results. `.select()` with no field paths asks Firestore for document
 * ids only, not field data — this is bounded to the caller's own scope
 * size (e.g. one driver's own shipments), never the whole collection.
 */
async function countDistinctShipmentsAcrossScopes(scopes: PageFilter[][]): Promise<number> {
  const idLists = await Promise.all(scopes.map((filters) => fetchShipmentIdsForScope(filters)));
  return new Set(idLists.flat()).size;
}

async function fetchShipmentIdsForScope(filters: PageFilter[]): Promise<string[]> {
  if (hasUnsatisfiableFilter(filters)) return [];
  let q: FirebaseFirestore.Query = db!.collection("shipments");
  for (const f of filters) {
    q = q.where(f.field, f.op as any, f.value);
  }
  const snapshot = await withTimeout(q.select().get(), 5000, "Firestore shipment-id dedup query timed out");
  return snapshot.docs.map((d) => d.id);
}

function memoryShipmentStats(scopes: PageFilter[][], includeStatusGroups: boolean): ShipmentStatsResult {
  const mStore = getMemoryStore();
  const items = (mStore.shipments || []) as any[];
  const effectiveScopes = scopes.length > 0 ? scopes : [[]];
  const total = countDistinctAcrossScopes(items, effectiveScopes, (i) => i.id);
  if (!includeStatusGroups) return { total };
  const matchedIds = new Set(
    effectiveScopes.flatMap((filters) => applyMemoryFilters(items, filters).map((i) => i.id))
  );
  const scopedItems = items.filter((i) => matchedIds.has(i.id));
  const byStatusGroup: Record<string, number> = {};
  for (const group of SHIPMENT_STATUS_GROUPS) {
    byStatusGroup[group.key] = scopedItems.filter((i) => group.statuses.includes(i.status)).length;
  }
  return { total, byStatusGroup };
}

/**
 * Phase 2A (Firestore scalability audit, shipments/orders).
 *
 * The three public `/api/share/:token*` routes (tracking view, document
 * proxy, subscribe) each used to read the ENTIRE `shipments` collection
 * just to find the one document whose `shareToken` matches — the same
 * "full scan to find one row" shape already fixed elsewhere in this PR.
 * Every `shareToken` generated today (generateShareToken(), POST
 * /api/shipments) is a 192-bit crypto-random value, not a practical
 * collision risk — but this is NOT bounded to `.limit(1)`. Firestore has
 * no unique-constraint mechanism on a plain document field, and
 * isLegacyShareToken's own existence (below) proves this app once
 * assigned predictable, non-crypto-random tokens to older shipments — a
 * duplicate is a real, if rare, possibility for legacy/migrated data.
 *
 * Blocking-issue fix (security/correctness review): a duplicate token
 * FAILS CLOSED. Fetching a small bounded page (5, not 1) and resolving
 * through resolveShareTokenLookup (src/lib/publicShareView.ts) returns a
 * `conflict` result when more than one shipment matches — the caller
 * (each of the three public routes below) turns that into a 409 and
 * NEVER serves either candidate's data. Logged loudly
 * (`[data-integrity]`) for operator follow-up. This is deliberately NOT
 * "pick a deterministic one and serve it" (an earlier version of this
 * fix did, by lowest document id) — an ambiguous token cannot prove
 * which shipment its holder is entitled to see, so guessing one is a
 * data exposure risk, not a UX nicety to preserve. A malformed/unknown
 * token simply matches zero documents (`not_found`), same as the old
 * `.find()` returning `undefined`.
 */
async function findShipmentByShareToken(token: string): Promise<ShareTokenLookupResult> {
  if (!token) return { status: "not_found" };
  if (useMemoryFallback) {
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return memoryFindShipmentByShareToken(token);
  }
  try {
    const q: FirebaseFirestore.Query = db!.collection("shipments").where("shareToken", "==", token).limit(5);
    const snapshot: FirebaseFirestore.QuerySnapshot = await withTimeout(q.get(), 5000, "Firestore share-token lookup timed out");
    const matches = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as Shipment);
    if (matches.length > 1) {
      console.error(`[data-integrity] Duplicate shareToken detected across ${matches.length} shipments (ids: ${matches.map((m) => m.id).join(", ")}) — failing closed (409), serving neither. This indicates a legacy/migrated record and should be investigated; see resolveShareTokenLookup's header comment.`);
    }
    return resolveShareTokenLookup(matches);
  } catch (error) {
    if (isMissingIndexError(error)) {
      // where("shareToken","==",...) with no orderBy is a single-field
      // equality query — Firestore's automatic per-field indexing already
      // covers this with no composite index required, so this branch is
      // not expected to actually trigger for this query. Handled anyway
      // for consistency with queryDescendingPage/queryAscendingSince
      // above and defense against a future change to this query adding
      // an orderBy without updating firestore.indexes.json.
      console.error(`Firestore index issue on share-token lookup (unexpected for a single-field equality query). NOT switching to memory fallback. Underlying error:`, error);
      if (STRICT_PERSISTENCE) throw new ServiceUnavailableError("Database index not ready yet. Please try again shortly.");
      return memoryFindShipmentByShareToken(token);
    }
    console.warn("Firestore share-token lookup failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    scheduleFirestoreRecovery(30_000);
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return memoryFindShipmentByShareToken(token);
  }
}

function memoryFindShipmentByShareToken(token: string): ShareTokenLookupResult {
  const mStore = getMemoryStore();
  const items = (mStore.shipments || []) as Shipment[];
  const matches = items.filter((s) => s.shareToken === token);
  if (matches.length > 1) {
    console.error(`[data-integrity] Duplicate shareToken detected across ${matches.length} shipments (ids: ${matches.map((m) => m.id).join(", ")}) — failing closed (409), serving neither.`);
  }
  return resolveShareTokenLookup(matches);
}

/**
 * Phase 4 follow-up (Firestore scalability audit, PR #99 review).
 *
 * Replaces "read the entire shipments collection, keep the ones this
 * driver/client owns" with one real, indexed Firestore query per scope
 * (see buildDriverOwnedShipmentQueryScopes / buildClientOwnedShipmentQueryScopes)
 * — the union of their matches is the caller's own owned-shipment set,
 * used only as input to buildDriverClientNotificationQueryScopes below.
 * Deliberately unlimited (no `.limit()`) — this must return every owned
 * shipment id, however many there are (the earlier truncation bug this PR
 * fixes was exactly this kind of silent cap); the cost is proportional to
 * the calling driver/client's own shipment count, never the size of the
 * whole collection, which is the actual scalability property this
 * replaces a full scan with.
 */
async function fetchOwnedShipmentIds(scopes: PageFilter[]): Promise<string[]> {
  if (scopes.length === 0) return [];
  if (useMemoryFallback) {
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return memoryOwnedShipmentIds(scopes);
  }
  try {
    const results = await Promise.all(
      scopes.map(async (f) => {
        const q: FirebaseFirestore.Query = db!.collection("shipments").where(f.field, f.op as any, f.value);
        const snapshot: FirebaseFirestore.QuerySnapshot = await withTimeout(q.get(), 5000, "Firestore shipment-ownership query timed out");
        return snapshot.docs.map((d) => d.id);
      })
    );
    return Array.from(new Set(results.flat()));
  } catch (error) {
    console.warn("Firestore shipment-ownership query failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    scheduleFirestoreRecovery(30_000);
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return memoryOwnedShipmentIds(scopes);
  }
}

function memoryOwnedShipmentIds(scopes: PageFilter[]): string[] {
  const mStore = getMemoryStore();
  const items = (mStore.shipments || []) as any[];
  const matchedIds = new Set<string>();
  for (const f of scopes) {
    for (const item of applyMemoryFilters(items, [f])) matchedIds.add(item.id);
  }
  return Array.from(matchedIds);
}

/**
 * PR #99 review fix: excludeUserId / chat-channel-visibility / admin-
 * preference filtering still runs on an already-fetched page (each is a
 * per-notification rule too fine-grained to express as a Firestore
 * `where`, e.g. "this admin's saved preferences" isn't a field on the
 * notification at all) — so a filtered page can come back with fewer than
 * `limit` eligible items even when more exist further back. This
 * continues fetching additional bounded pages, re-applying the same
 * rules, until either the response holds `limit` eligible items or the
 * underlying data is genuinely exhausted (`hasMore: false`).
 * NOTIFICATIONS_MAX_TOPUP_ROUNDS is a hard, unconditional bound — even in
 * the pathological case where almost every fetched row gets filtered out
 * (e.g. an admin who has disabled nearly every category), this can never
 * loop more than a fixed, small number of extra round-trips; it returns
 * whatever it collected so far rather than looping indefinitely.
 */
const NOTIFICATIONS_MAX_TOPUP_ROUNDS = 6;

async function fetchFilledNotificationsPage(
  scopes: PageFilter[][],
  initialCursor: PageCursor | null,
  limit: number,
  applyRoleRules: (items: any[]) => Promise<any[]>
): Promise<DescendingPageResult> {
  let cursor = initialCursor;
  let collected: any[] = [];
  let rawHasMore = false;
  let rawNextCursor: string | null = null;
  for (let round = 0; round < NOTIFICATIONS_MAX_TOPUP_ROUNDS; round++) {
    const page = scopes.length > 0 ? await fetchNotificationsPage(scopes, cursor, limit) : { items: [], nextCursor: null, hasMore: false };
    const filtered = await applyRoleRules(page.items);
    collected = collected.concat(filtered);
    rawHasMore = page.hasMore;
    rawNextCursor = page.nextCursor;
    cursor = page.nextCursor ? decodePageCursor(page.nextCursor) : null;
    if (collected.length >= limit || !page.hasMore || !cursor) break;
  }
  return finalizeFilledDescendingPage(collected, limit, rawHasMore, rawNextCursor, (i) => i.timestamp, (i) => i.id);
}

async function fetchFilledNotificationsSince(
  scopes: PageFilter[][],
  cursor: PageCursor | null,
  limit: number,
  applyRoleRules: (items: any[]) => Promise<any[]>
): Promise<AscendingSinceResult> {
  let currentCursor = cursor;
  let collected: any[] = [];
  let rawHasMore = false;
  for (let round = 0; round < NOTIFICATIONS_MAX_TOPUP_ROUNDS; round++) {
    const page = scopes.length > 0 ? await fetchNotificationsSince(scopes, currentCursor, limit) : { items: [] as any[], hasMore: false };
    const filtered = await applyRoleRules(page.items);
    collected = collected.concat(filtered);
    rawHasMore = page.hasMore;
    const lastRaw = page.items[page.items.length - 1];
    if (collected.length >= limit || !page.hasMore || !lastRaw) break;
    currentCursor = { ts: lastRaw.timestamp, id: lastRaw.id };
  }
  return finalizeFilledSincePage(collected, limit, rawHasMore);
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

  const counterRef = db.collection("counters").doc("shipments");
  try {
    // Firestore transactions can only read individual documents, not run
    // a collection query, so the one-time bootstrap value (how many
    // shipments already exist) has to be read before the transaction
    // starts. It's only used the first time this ever runs, when the
    // counter doc doesn't exist yet; from then on the counter doc itself
    // is authoritative and this pre-read value is discarded.
    let bootstrapCount = 0;
    const existingCounter = await withTimeout<any>(counterRef.get(), 5000, "Firestore getDoc timed out");
    // Admin SDK's DocumentSnapshot exposes `exists` as a boolean property,
    // not a callable — unlike getDoc() above, this raw transactional path
    // isn't routed through adaptDocSnapshot, so it's read as a property here.
    if (!existingCounter.exists) {
      const existingShipments = await withTimeout<any>(
        db.collection("shipments").get(),
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
      db.runTransaction(async (tx: any) => {
        const snap = await tx.get(counterRef);
        const data = snap.exists ? (snap.data() as ShipmentSequenceCounterDoc) : undefined;
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

// Shipment-update lost-update race fix (stability audit). in-memory
// equivalent of the Firestore transaction below, used only when Firestore
// is unavailable and STRICT_PERSISTENCE is off — see
// applyRevisionedShipmentUpdateMemory (shipmentRevision.ts) for the actual
// (unit-tested) logic and its atomicity reasoning; this just supplies the
// live memory-store array reference.
function applyShipmentRevisionedUpdateMemory(
  shipmentId: string,
  expectedRevision: number,
  buildUpdated: (current: Shipment, nextRevision: number) => Shipment
): Shipment {
  return applyRevisionedShipmentUpdateMemory(getMemoryStore().shipments, shipmentId, expectedRevision, buildUpdated);
}

// Shipment-update lost-update race fix (stability audit). Compares the
// client's expectedRevision against the shipment document's actual current
// revision and performs the update, atomically, inside a single Firestore
// transaction — exactly one of two concurrent calls starting from the same
// expectedRevision can ever commit; the other sees ShipmentRevisionConflictError,
// with no document modification. `buildUpdated` must be a pure, synchronous
// function of (the transaction's own freshly-read current document, the
// revision to store) — it must not perform any I/O (no fetches, no other
// Firestore reads/writes, no notifications), since anything in the
// transaction callback may run more than once if Firestore internally
// retries it. Callers run notifications/audit logging only after this
// resolves successfully — never inside buildUpdated, and never on conflict.
async function applyShipmentRevisionedUpdate(
  shipmentId: string,
  expectedRevision: number,
  buildUpdated: (current: Shipment, nextRevision: number) => Shipment
): Promise<Shipment> {
  if (useMemoryFallback || !db) {
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return applyShipmentRevisionedUpdateMemory(shipmentId, expectedRevision, buildUpdated);
  }

  const sDocRef = db.collection("shipments").doc(shipmentId);
  try {
    return await withTimeout(
      db.runTransaction(async (tx: any) => {
        const snap = await tx.get(sDocRef);
        if (!snap.exists) {
          throw new Error("Shipment not found");
        }
        const current = snap.data() as Shipment;
        const { ok, currentRevision, nextRevision } = checkShipmentRevision(current.revision, expectedRevision);
        if (!ok) {
          throw new ShipmentRevisionConflictError(currentRevision, current);
        }
        const updated = buildUpdated(current, nextRevision);
        tx.set(sDocRef, cleanUndefined(updated));
        return updated;
      }),
      5000,
      "Firestore transaction timed out"
    );
  } catch (error) {
    // A genuine version conflict is an expected application outcome, not an
    // infrastructure failure — it must reach the route as-is so it 409s
    // with no notifications/audit side effects, never fall through to the
    // memory-fallback retry below (which could silently apply a stale
    // client's write against different, unrelated in-memory data).
    if (error instanceof ShipmentRevisionConflictError) throw error;
    console.warn("Firestore shipment update transaction failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    scheduleFirestoreRecovery(30_000);
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return applyShipmentRevisionedUpdateMemory(shipmentId, expectedRevision, buildUpdated);
  }
}

// Shipment-update lost-update race fix (stability audit, PR #111 review —
// Blocker 2). Narrow-writer counterpart to applyShipmentRevisionedUpdate:
// for routes where the caller is not a human edit form holding a specific
// revision it read (status updates, document/chat/share appends and
// toggles, public share-link subscribes), there is no expectedRevision to
// check — but the mutation must still atomically advance the revision, or
// an admin edit form opened before it would save later without ever
// detecting the change. See applyNarrowShipmentUpdateMemory
// (shipmentRevision.ts) for the full reasoning and its unit tests.
//
// PR #111 review (forward-only status transitions / Admin Status
// Override): `mutate` may also throw ShipmentStatusTransitionError (the
// normal status route's transition re-validation) or
// ShipmentStatusOverrideError (the status-override route's correction
// validation), both run against this call's own fresh `current` — see
// those routes. Exactly like ShipmentRevisionConflictError below, both are
// expected application-level rejections, not an infrastructure failure —
// they must reach the caller as-is, with no document modification, never
// fall through to the memory-fallback retry (which could otherwise
// silently re-run `mutate` a second time against different, unrelated
// in-memory data).
async function applyNarrowShipmentUpdate(
  shipmentId: string,
  mutate: (current: Shipment) => Shipment
): Promise<Shipment> {
  if (useMemoryFallback || !db) {
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return applyNarrowShipmentUpdateMemory(getMemoryStore().shipments, shipmentId, mutate);
  }

  const sDocRef = db.collection("shipments").doc(shipmentId);
  try {
    return await withTimeout(
      db.runTransaction(async (tx: any) => {
        const snap = await tx.get(sDocRef);
        if (!snap.exists) {
          throw new Error("Shipment not found");
        }
        const current = snap.data() as Shipment;
        const nextRevision = resolveStoredRevision(current.revision) + 1;
        const mutated = mutate(current);
        const updated = { ...mutated, revision: nextRevision };
        tx.set(sDocRef, cleanUndefined(updated));
        return updated;
      }),
      5000,
      "Firestore transaction timed out"
    );
  } catch (error) {
    if (error instanceof ShipmentStatusTransitionError || error instanceof ShipmentStatusOverrideError) throw error;
    console.warn("Firestore narrow shipment update transaction failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    scheduleFirestoreRecovery(30_000);
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return applyNarrowShipmentUpdateMemory(getMemoryStore().shipments, shipmentId, mutate);
  }
}

// Shipment-update lost-update race fix (stability audit, PR #111 review —
// over-broad-revision-policy correction). Revision-PRESERVING counterpart to
// applyNarrowShipmentUpdate: for writers whose fields the human edit form
// (PUT /api/shipments/:id, buildUpdatedShipment) never overwrites — document
// appends/uploads, chat attachments saved as documents, document visibility
// toggles, customerEmails/customerNotificationHistory subscriptions
// (authenticated and public), share-link settings, and the best-effort
// derived ETA/distance cache on GET .../distance-matrix. These still need
// atomic, transactional read-mutate-write (two concurrent document uploads,
// or two concurrent subscriptions, must not overwrite each other's append),
// but must NEVER advance the shipment's revision — doing so would make an
// unrelated, already-open admin edit form 409 on its next save even though
// nothing that edit form could have overwritten actually changed. See
// applyIsolatedShipmentUpdateMemory (shipmentRevision.ts) for the full
// reasoning, the documented distance-matrix `eta` trade-off, and unit tests.
async function applyIsolatedShipmentUpdate(
  shipmentId: string,
  mutate: (current: Shipment) => Shipment
): Promise<Shipment> {
  if (useMemoryFallback || !db) {
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return applyIsolatedShipmentUpdateMemory(getMemoryStore().shipments, shipmentId, mutate);
  }

  const sDocRef = db.collection("shipments").doc(shipmentId);
  try {
    return await withTimeout(
      db.runTransaction(async (tx: any) => {
        const snap = await tx.get(sDocRef);
        if (!snap.exists) {
          throw new Error("Shipment not found");
        }
        const current = snap.data() as Shipment;
        const mutated = mutate(current);
        const updated = { ...mutated, revision: current.revision };
        tx.set(sDocRef, cleanUndefined(updated));
        return updated;
      }),
      5000,
      "Firestore transaction timed out"
    );
  } catch (error) {
    console.warn("Firestore isolated shipment update transaction failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    scheduleFirestoreRecovery(30_000);
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return applyIsolatedShipmentUpdateMemory(getMemoryStore().shipments, shipmentId, mutate);
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
  CostStatement,
  DriverRoute,
  AllianceOffer,
  AllianceOfferResponse,
  AllianceAuditAction,
  AllianceAuditEntry,
  DriverActiveJobLock
} from "./src/types";
import {
  sanitizeWorkingRoutes,
  computeBusyDriverIds,
  isShipmentBusyingDriver,
  matchDriversForOffer,
  validateAllianceOfferInput,
  validateQuotePriceUsd,
  canBroadcastOffer,
  canDriverRespondToOffer,
  canSelectWinner,
  canCancelOffer,
  canSubmitResponse,
  allianceResponseId,
  buildDriverOfferView,
  buildOfferFromOrder,
  isValidMarReference,
  computeOfferExpiresAt,
  isOfferExpired,
  resolveOfferStatus,
  summarizeResponses,
} from "./src/lib/driverAlliance";

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

// Initialize Firebase.
//
// firebase-applet-config.json stays exactly as it was (still the browser's
// only source for its own Firebase web SDK config, via src/googleAuth.ts) —
// server-side code below now reads only projectId/storageBucket/
// firestoreDatabaseId out of it, to configure the Admin SDK. It no longer
// initializes a client-SDK app or signs in as a dedicated Firebase Auth
// user; see the Admin SDK block below.
const configPath = path.join(process.cwd(), "firebase-applet-config.json");
let firebaseConfig: any = null;
export let db: any = null;
let initialId = "(default)";
let adminProjectId: string | undefined;
let adminStorageBucketName: string | undefined;

try {
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } else if (process.env.FIREBASE_CONFIG) {
    firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
  }

  if (firebaseConfig) {
    adminProjectId = firebaseConfig.projectId;
    adminStorageBucketName = firebaseConfig.storageBucket;
  } else {
    console.warn("No Firebase configuration file or environment variable was found. Running using Robust Memory Fallback.");
    useMemoryFallback = true;
  }
} catch (err: any) {
  console.warn("Firebase configuration could not be read, utilizing default Memory Fallback. Error:", err instanceof Error ? err.message : String(err));
  useMemoryFallback = true;
}

// Firebase Admin SDK — the ONLY Firebase SDK this server uses now, for
// Firestore, Storage, FCM push, and ID-token verification alike. It
// authenticates via Application Default Credentials (ADC): locally, run
// `gcloud auth application-default login` once (stores credentials outside
// this repo, nothing to put in .env.local); on Cloud Run, ADC resolves
// automatically to the service's own attached runtime service account, with
// no key file to manage or ship. The Admin SDK bypasses firestore.rules/
// storage.rules entirely (it is a trusted-server identity, not a
// rules-checked end user) — those rule files are unchanged in this branch
// and are addressed separately (see docs/REAL_FIREBASE_VERIFICATION.md).
let pushMessaging: Messaging | null = null;
// Admin Auth instance — used to VERIFY Firebase ID tokens that clients send
// when restoring a session. This is how /api/verify-session proves who the
// caller actually is, instead of trusting a client-supplied id/email.
let adminAuth: AdminAuth | null = null;
let adminApp: any = null;
let storageBucketRef: any = null;

try {
  adminApp = getAdminApps().length
    ? getAdminApps()[0]!
    : initializeAdminApp({
        credential: applicationDefault(),
        ...(adminProjectId ? { projectId: adminProjectId } : {}),
        ...(adminStorageBucketName ? { storageBucket: adminStorageBucketName } : {}),
      });
  pushMessaging = getMessaging(adminApp);
  adminAuth = getAdminAuth(adminApp);
} catch (err: any) {
  console.warn("Firebase Admin SDK initialization failed - Firestore/Storage/push notifications/ID-token verification will be disabled. Error:", err instanceof Error ? err.message : String(err));
}

// Firestore only comes up if we actually know which project to target —
// mirrors the previous "if (firebaseConfig) {...} else { memory fallback }"
// gate exactly, just keyed off projectId instead of the whole config blob.
if (adminApp && adminProjectId) {
  try {
    const customId = firebaseConfig?.firestoreDatabaseId;
    initialId = customId && customId !== "(default)" ? customId : "(default)";
    db = customId && customId !== "(default)" ? getAdminFirestore(adminApp, customId) : getAdminFirestore(adminApp);
  } catch (err: any) {
    console.warn("Firestore (Admin SDK) initialization failed, utilizing default Memory Fallback. Error:", err instanceof Error ? err.message : String(err));
    useMemoryFallback = true;
  }
} else if (firebaseConfig) {
  console.warn("Firebase config found but has no projectId — cannot initialize Firestore. Running using Robust Memory Fallback.");
  useMemoryFallback = true;
}

// Storage bucket handle for /api/upload — only available if storageBucket
// was present in firebase-applet-config.json (unchanged requirement from
// before this migration; see docs/REAL_FIREBASE_VERIFICATION.md).
if (adminApp && adminStorageBucketName) {
  try {
    storageBucketRef = getAdminStorage(adminApp).bucket();
  } catch (err: any) {
    console.warn("Firebase Storage (Admin SDK) initialization failed. Uploads will be refused until this is resolved. Error:", err instanceof Error ? err.message : String(err));
  }
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
  console.log(`[Startup] ADC environment hint present (GOOGLE_APPLICATION_CREDENTIALS or Cloud Run's K_SERVICE): ${readiness.adcEnvHintPresent} (not authoritative — local dev via 'gcloud auth application-default login' can't be detected from env vars alone; the live Firestore connection check below is authoritative)`);
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
// The Admin SDK presents Application Default Credentials automatically on
// every call — there is no separate sign-in step to perform first (unlike
// the old client-SDK email/password flow this replaced). This probe is
// therefore the ONLY way to find out whether ADC is actually available and
// usable: locally, that means `gcloud auth application-default login` was
// run; on Cloud Run, that the attached runtime service account has the
// necessary Firestore IAM role. A failure here still falls back to the
// in-memory store (logged loudly, since silent data loss is far worse than
// a visible startup error).
async function attemptFirestoreConnect(timeoutMs: number): Promise<boolean> {
  if (!db) return false;
  try {
    await withTimeout(db.collection("test").doc("connection").get(), timeoutMs, "Firestore connection check timed out");
    console.log(`[Firestore] Connected to database (${initialId}) via Application Default Credentials.`);
    useMemoryFallback = false;
    return true;
  } catch (err: any) {
    console.warn(
      "[Firestore] Connection check failed — falling back to in-memory storage. ALL DATA WILL BE LOST ON " +
      "RESTART until this is resolved. This usually means Application Default Credentials are missing or " +
      "the runtime identity lacks Firestore access: locally, run `gcloud auth application-default login`; " +
      "on Cloud Run, verify the service's attached service account has the Cloud Datastore User role. " +
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
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
    const driverCol = db.collection("drivers");
    const driverSnap = await driverCol.get();
    if (driverSnap.empty) {
      console.log("Seeding drivers into Firestore...");
      for (const d of initialDrivers) {
        const cleaned = cleanUndefined(d);
        try {
          await db.collection("drivers").doc(d.id).set(cleaned);
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
    const shipmentCol = db.collection("shipments");
    const shipmentSnap = await shipmentCol.get();
    if (shipmentSnap.empty) {
      console.log("Seeding shipments into Firestore...");
      for (const s of initialShipments) {
        const cleaned = cleanUndefined(s);
        try {
          await db.collection("shipments").doc(s.id).set(cleaned);
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
    const chatCol = db.collection("chatMessages");
    const chatSnap = await chatCol.get();
    if (chatSnap.empty) {
      console.log("Seeding chat messages into Firestore...");
      for (const c of initialChatMessages) {
        const cleaned = cleanUndefined(c);
        try {
          await db.collection("chatMessages").doc(c.id).set(cleaned);
          console.log(`Successfully seeded chat message: ${c.id}`);
        } catch (subErr) {
          console.error(`Failed to write chat message ${c.id}:`, subErr);
        }
      }

      // Chat-unread scalability follow-up: without this, every admin's
      // unread badge would show 0 for these freshly-seeded conversations
      // (the same regression getMemoryStore()'s equivalent SEED_DEMO_DATA
      // block above exists to prevent, here for the real-Firestore
      // seeding path — this is effectively a one-time, inline run of
      // scripts/backfill-admin-chat-unread.ts scoped to exactly the
      // messages just seeded). Uses whatever real admins already exist in
      // this Firestore project at seed time (resolveAllAdminIds) — this
      // demo seeder never creates admin accounts itself.
      try {
        const adminIds = await resolveAllAdminIds();
        const nowIso = new Date().toISOString();
        const unreadRecords = adminIds.flatMap((adminId) =>
          selectUnreadMessagesForAdmin(initialChatMessages, adminId).map((msg) => ({
            id: buildAdminChatUnreadRecordId(adminId, msg.id),
            adminId,
            messageId: msg.id,
            shipmentId: msg.shipmentId,
            channel: msg.channel,
            timestamp: msg.timestamp,
            message: msg,
            createdAt: nowIso,
          }))
        );
        if (unreadRecords.length > 0) {
          console.log(`Seeding ${unreadRecords.length} adminChatUnread record(s) for the just-seeded chat messages...`);
          for (const recordChunk of chunkArray(unreadRecords, FIRESTORE_BATCH_CHUNK_SIZE)) {
            const batch = db.batch();
            for (const record of recordChunk) {
              batch.set(db.collection("adminChatUnread").doc(record.id), cleanUndefined(record));
            }
            await batch.commit();
          }
        }
      } catch (unreadSeedErr) {
        console.error("Error seeding adminChatUnread for seeded chat messages: ", unreadSeedErr);
      }
    } else {
      console.log("ChatMessages collection already seeded.");
    }
  } catch (err) {
    console.error("Error reading/seeding chat messages: ", err);
  }

  // 4. Seed notifications
  try {
    const notifCol = db.collection("notifications");
    const notifSnap = await notifCol.get();
    if (notifSnap.empty) {
      console.log("Seeding notifications into Firestore...");
      for (const n of initialNotifications) {
        const cleaned = cleanUndefined(n);
        try {
          await db.collection("notifications").doc(n.id).set(cleaned);
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
    const logCol = db.collection("activityLogs");
    const logSnap = await logCol.get();
    if (logSnap.empty) {
      console.log("Seeding activity logs into Firestore...");
      for (const l of initialActivityLogs) {
        const cleaned = cleanUndefined(l);
        try {
          await db.collection("activityLogs").doc(l.id).set(cleaned);
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
    const clientsCol = db.collection("clients");
    const clientsSnap = await clientsCol.get();
    if (clientsSnap.empty) {
      console.log("Seeding clients into Firestore...");
      for (const cl of initialClients) {
        const cleaned = cleanUndefined(cl);
        try {
          await db.collection("clients").doc(cl.id).set(cleaned);
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
    const vendorsCol = db.collection("vendors");
    const vendorsSnap = await vendorsCol.get();
    if (vendorsSnap.empty) {
      console.log("Seeding vendors into Firestore...");
      for (const v of initialVendors) {
        const cleaned = cleanUndefined(v);
        try {
          await db.collection("vendors").doc(v.id).set(cleaned);
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
      await db.collection("configs").doc("google_maps").set({ key: mapsKey });
      console.log("Successfully seeded Google Maps key config.");
    }
  } catch (err) {
    console.error("Error propagating Google Maps key to Firestore: ", err);
  }

  console.log("Firestore seeding check completed with comprehensive logs.");
}

// Helpers to write to Firestore
// ═══════════════════════════════════════════════════════════════════
// Driver Alliance Phase 1 — one-active-job lock + audit trail.
// ═══════════════════════════════════════════════════════════════════

/**
 * Thrown when an assignment would give a driver a second active
 * shipment. A deliberate application-level rejection (the route answers
 * 409 DRIVER_BUSY), never an infrastructure failure — same contract as
 * ShipmentStatusTransitionError.
 */
class DriverBusyError extends Error {
  readonly code = "DRIVER_BUSY";
  readonly driverId: string;
  constructor(driverId: string) {
    super("This driver already has an active shipment. A driver can only carry one active job at a time.");
    this.name = "DriverBusyError";
    this.driverId = driverId;
  }
}

/**
 * If a claimed lock's shipment document doesn't exist yet, the claim is
 * still honored for this long — POST /api/shipments claims the lock
 * BEFORE writing the shipment document, so a concurrent claimer must not
 * treat that in-flight window as a stale lock.
 */
/**
 * Thrown by createShipmentRecord when the requested primary/additional
 * driver is pending or rejected — the same 400 both callers previously
 * produced inline.
 */
/**
 * Driver Alliance Phase 1 — expected application-level rejection carrying
 * its HTTP status (403 not-invited, 409 ALREADY_RESPONDED). Same contract
 * as the other typed rejections: routes map it, nothing retries it.
 */
class AllianceRejectionError extends Error {
  readonly httpStatus: number;
  readonly code?: string;
  constructor(httpStatus: number, message: string, code?: string) {
    super(message);
    this.name = "AllianceRejectionError";
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

class UnsafeDriverAssignmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeDriverAssignmentError";
  }
}

const DRIVER_JOB_CLAIM_GRACE_MS = 120_000;

/** Every shipment currently making `driverId` Busy (primary assignment only). */
async function fetchBusyingShipmentsForDriver(driverId: string): Promise<Shipment[]> {
  let candidates: Shipment[] = [];
  if (useMemoryFallback || !db) {
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    candidates = (getMemoryStore().shipments as Shipment[]).filter((s) => s.assignedDriverId === driverId);
  } else {
    try {
      const q: FirebaseFirestore.Query = db.collection("shipments").where("assignedDriverId", "==", driverId);
      const snapshot: FirebaseFirestore.QuerySnapshot = await withTimeout(q.get(), 5000, "Firestore driver-shipments query timed out");
      candidates = snapshot.docs.map((d) => d.data() as Shipment);
    } catch (error) {
      console.warn("Firestore driver-shipments query failed or timed out. Switching to robust Memory Fallback.", error);
      useMemoryFallback = true;
      scheduleFirestoreRecovery(30_000);
      if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
      candidates = (getMemoryStore().shipments as Shipment[]).filter((s) => s.assignedDriverId === driverId);
    }
  }
  return candidates.filter((s) => isShipmentBusyingDriver(s.status, s.freightType));
}

/**
 * Claims the one-active-job lock for a driver before an assignment is
 * committed. Two layers, both server-side:
 *
 *  1. A real-shipments pre-check (covers shipments that predate the lock
 *     collection): any OTHER shipment currently busying this driver
 *     rejects the claim outright.
 *  2. The lock document itself (driverActiveJobs/{driverId}), written
 *     inside a Firestore transaction — the serialization point that
 *     guarantees two CONCURRENT assignment requests can never both
 *     succeed for one driver: the transaction re-reads the lock, and a
 *     second claimer either sees the first one's committed lock (and is
 *     rejected) or aborts/retries per Firestore's transaction contract.
 *     A lock whose shipment turned out closed/deleted is treated as
 *     stale and overwritten (self-healing), except within the short
 *     claim grace window above.
 *
 * On the memory fallback the check-and-set below is synchronous (no
 * await between read and write), which is atomic under Node's
 * single-threaded event loop — the same reasoning documented for
 * InMemorySequenceCounter.
 */
async function claimDriverActiveJob(driverId: string, shipmentId: string): Promise<void> {
  const busying = await fetchBusyingShipmentsForDriver(driverId);
  if (busying.some((s) => s.id !== shipmentId)) {
    throw new DriverBusyError(driverId);
  }

  const nowIso = new Date().toISOString();
  if (useMemoryFallback || !db) {
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    const locks = getMemoryStore().driverActiveJobs;
    const existing = locks.find((l) => l.driverId === driverId);
    if (existing && existing.shipmentId !== shipmentId) {
      const lockedShipment = (getMemoryStore().shipments as Shipment[]).find((s) => s.id === existing.shipmentId);
      const stillActive = lockedShipment
        ? isShipmentBusyingDriver(lockedShipment.status, lockedShipment.freightType)
        : Date.now() - Date.parse(existing.claimedAt) < DRIVER_JOB_CLAIM_GRACE_MS;
      if (stillActive) throw new DriverBusyError(driverId);
      existing.shipmentId = shipmentId;
      existing.claimedAt = nowIso;
      return;
    }
    if (existing) {
      existing.claimedAt = nowIso;
      return;
    }
    locks.push({ driverId, shipmentId, claimedAt: nowIso });
    return;
  }

  const lockRef = db.collection("driverActiveJobs").doc(driverId);
  try {
    await withTimeout(
      db.runTransaction(async (tx: any) => {
        const snap = await tx.get(lockRef);
        if (snap.exists) {
          const lock = snap.data() as DriverActiveJobLock;
          if (lock.shipmentId !== shipmentId) {
            const lockedShipmentSnap = await tx.get(db!.collection("shipments").doc(lock.shipmentId));
            const stillActive = lockedShipmentSnap.exists
              ? isShipmentBusyingDriver(
                  (lockedShipmentSnap.data() as Shipment).status,
                  (lockedShipmentSnap.data() as Shipment).freightType
                )
              : Date.now() - Date.parse(lock.claimedAt) < DRIVER_JOB_CLAIM_GRACE_MS;
            if (stillActive) throw new DriverBusyError(driverId);
          }
        }
        tx.set(lockRef, { driverId, shipmentId, claimedAt: nowIso } satisfies DriverActiveJobLock);
      }),
      5000,
      "Firestore driver-lock transaction timed out"
    );
  } catch (error) {
    if (error instanceof DriverBusyError) throw error;
    console.warn("Firestore driver-lock transaction failed or timed out. Switching to robust Memory Fallback.", error);
    useMemoryFallback = true;
    scheduleFirestoreRecovery(30_000);
    if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
    return claimDriverActiveJob(driverId, shipmentId);
  }
}

/**
 * Releases the one-active-job lock, but only if it still points at the
 * given shipment — a lock already re-claimed for a newer shipment is
 * never clobbered. Best-effort by design at its call sites (a failed
 * release self-heals on the next claim via the staleness check above).
 */
async function releaseDriverActiveJob(driverId: string, shipmentId: string): Promise<void> {
  if (!driverId) return;
  try {
    const lockRef = doc(db, "driverActiveJobs", driverId);
    const snap = await getDoc(lockRef);
    if (snap.exists() && (snap.data() as DriverActiveJobLock).shipmentId === shipmentId) {
      await deleteDoc(lockRef);
    }
  } catch (err) {
    console.warn("Driver active-job lock release failed (self-heals on next claim):", err);
  }
}

/**
 * Driver Alliance audit trail — one entry per important action, in its
 * own collection (never mixed into shipment activity logs). Best-effort
 * like logActivity: an audit write failure never fails the action.
 */
async function logAllianceAudit(
  action: AllianceAuditAction,
  refs: { offerId: string; driverId?: string; shipmentId?: string },
  actor: { userId: string; userName: string }
) {
  const entry: AllianceAuditEntry = {
    id: `aaudit-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    action,
    offerId: refs.offerId,
    ...(refs.driverId ? { driverId: refs.driverId } : {}),
    ...(refs.shipmentId ? { shipmentId: refs.shipmentId } : {}),
    userId: actor.userId,
    userName: actor.userName,
    timestamp: new Date().toISOString(),
  };
  try {
    await setDoc(doc(db, "allianceAuditLogs", entry.id), entry);
  } catch (err) {
    console.error("Error writing alliance audit entry: ", err);
  }
}

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
  type: 'assignment' | 'acceptance' | 'rejection' | 'status_update' | 'chat' | 'doc_upload' | 'delivery' | 'driver_registration' | 'alliance_offer' | 'alliance_update',
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
  chatChannel?: ChatChannel,
  // Notification Phase 1: session id of a specific user this notification
  // is directly addressed to, for events with no associated shipment at
  // all (e.g. a driver being approved). See AppNotification.recipientUserId
  // in src/types.ts for why this exists — without it, an event like this
  // reached admins only, never the driver it was actually about.
  recipientUserId?: string
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
  if (recipientUserId) newNotif.recipientUserId = recipientUserId;
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

    // Every admin gets a push for this notification's category, unless
    // that specific admin has disabled it in their own notification
    // preferences (Notification Preferences Phase 2 — Admin only; Driver/
    // Client recipient resolution below is completely separate code and
    // is never touched by this). security_system_alerts-mapped types
    // (and any type with no clear category) always reach every admin
    // regardless of preferences — see shouldDeliverNotificationToAdmin.
    const adminTokensSnap = await getDocs(collection(db, "pushTokens"));
    const allTokenDocs = adminTokensSnap.docs.map(d => d.data() as any);
    const adminTokenIds = allTokenDocs.filter(t => t.role === "admin").map(t => t.userId as string);
    if (adminTokenIds.length > 0) {
      const adminPrefsSnap = await getDocs(collection(db, "adminNotificationPreferences"));
      const preferencesByAdminId: Record<string, any> = {};
      for (const d of adminPrefsSnap.docs) {
        preferencesByAdminId[d.id] = d.data();
      }
      const allowedAdminIds = filterAdminRecipientsByPreferences(adminTokenIds, preferencesByAdminId, type, chatChannel);
      for (const id of allowedAdminIds) userIds.add(id);
    }

    // Notification Phase 1: a directly-addressed recipient (e.g. a driver
    // being approved) is targeted regardless of shipmentId — this must
    // not depend on the shipment lookup below, since events like this
    // have no associated shipment at all.
    if (recipientUserId) userIds.add(recipientUserId);

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
          // Notification Phase 1 fix: this previously used .find(), which
          // only ever resolved the FIRST client account matching the
          // shipment's company — silently dropping every other account on
          // the same company (the Owner if a Staff record happened to come
          // first in the snapshot, or every Staff account if the Owner
          // came first). resolveClientPushRecipientIds (clientAccess.ts)
          // returns every active account on the company instead.
          const clientsSnap = await getDocs(collection(db, "clients"));
          const clientRecipientIds = resolveClientPushRecipientIds(
            clientsSnap.docs.map(d => d.data() as Client),
            ship.companyName
          );
          for (const id of clientRecipientIds) userIds.add(id);
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
  function signPendingFirebaseIdentityDeletionToken(payload: { driverId: string; firebaseUid: string; issuedAt: number; expiresAt: number }): string {
    return signPendingFirebaseIdentityDeletionTokenImpl(payload, SESSION_SECRET);
  }
  function verifyPendingFirebaseIdentityDeletionToken(token: string) {
    return verifyPendingFirebaseIdentityDeletionTokenImpl(token, SESSION_SECRET);
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

  // Apple Guideline 5.1.1(v) — DELETE /api/account's own sensitive-action
  // rate limiter, same Map-based sliding-window pattern as
  // checkLoginRateLimit above (same single-instance-only caveat — see its
  // header comment). Keyed by the AUTHENTICATED session id, not a
  // client-supplied username: unlike login, the caller here already holds
  // a valid session, so this exists specifically to bound how many
  // `currentPassword` guesses a stolen/leaked bearer token can make
  // against the real account's password before the destructive delete can
  // ever proceed — not to rate-limit login attempts, which
  // checkLoginRateLimit already covers separately.
  const ACCOUNT_DELETION_ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
  const ACCOUNT_DELETION_MAX_ATTEMPTS = 5;
  const accountDeletionAttempts = new Map<string, { count: number; windowStart: number }>();

  function checkAccountDeletionRateLimit(sessionId: string): { allowed: boolean; retryAfterSeconds?: number } {
    const now = Date.now();
    const entry = accountDeletionAttempts.get(sessionId);

    if (!entry || now - entry.windowStart > ACCOUNT_DELETION_ATTEMPT_WINDOW_MS) {
      accountDeletionAttempts.set(sessionId, { count: 1, windowStart: now });
      return { allowed: true };
    }

    if (entry.count >= ACCOUNT_DELETION_MAX_ATTEMPTS) {
      const retryAfterSeconds = Math.ceil((ACCOUNT_DELETION_ATTEMPT_WINDOW_MS - (now - entry.windowStart)) / 1000);
      return { allowed: false, retryAfterSeconds };
    }

    entry.count += 1;
    return { allowed: true };
  }

  function clearAccountDeletionRateLimit(sessionId: string): void {
    accountDeletionAttempts.delete(sessionId);
  }

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of accountDeletionAttempts.entries()) {
      if (now - entry.windowStart > ACCOUNT_DELETION_ATTEMPT_WINDOW_MS) {
        accountDeletionAttempts.delete(key);
      }
    }
  }, ACCOUNT_DELETION_ATTEMPT_WINDOW_MS);

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

      if (useMemoryFallback || !storageBucketRef) {
        // No durable storage available right now — say so plainly rather
        // than silently keeping the file in memory only, where it would
        // vanish on the next restart with no warning to anyone.
        console.error("[upload] Firebase Storage unavailable — refusing upload rather than storing it only in memory where it would be silently lost.");
        return res.status(503).json({
          error: "File storage is temporarily unavailable. Your file was NOT saved — please try again in a moment.",
        });
      }

      try {
        const path = `uploads/${req.session!.role}/${req.session!.id}/${Date.now()}-${Math.random().toString(36).substring(2, 9)}-${filename}`;
        // NOTE (BUG-12): this token-based URL is NOT revocable through
        // anything in this app; once handed out it keeps working forever
        // regardless of later document-visibility changes. That's fine for
        // this authenticated endpoint, whose caller (admin/driver/client,
        // all logged in) is meant to have access to what they themselves
        // just uploaded. The one place this becomes unsafe is the *public*,
        // unauthenticated share view — see buildSecureShareView and
        // /api/share/:token/documents/:docId below, which never forward
        // this raw URL and instead proxy through a route that re-checks
        // visibility on every request. Any new public-facing document
        // surface should use that same proxy pattern, not this URL
        // directly. Deliberately not a signed URL (those expire) — see
        // src/lib/firebaseStorageUrl.ts.
        const downloadToken = crypto.randomUUID();
        const file = storageBucketRef.file(path);
        await file.save(buffer, {
          metadata: {
            contentType: mimeType,
            metadata: { firebaseStorageDownloadTokens: downloadToken },
          },
        });
        const url = buildFirebaseDownloadUrl(storageBucketRef.name, path, downloadToken);
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
  //
  // Phase 2A (Firestore scalability audit, shipments/orders): scoped,
  // cursor-paginated Firestore queries instead of reading the entire
  // `shipments` collection on every call (see docs/FOLLOW_UP_ROADMAP.md's
  // "Full-collection-scan read pattern" entry, and PR #99's own PR
  // description for the priority-3 "deferred" item this closes). Same
  // response shape and query-param contract as GET /api/notifications and
  // GET /api/shipments/:id/chat: `{ items, nextCursor, hasMore }` in page
  // mode, `{ items, hasMore }` in `since` (live-poll) mode. A malformed
  // *supplied* cursor/since 400s; a missing one is valid (see
  // parseCursorParam's own header comment, src/lib/pagination.ts).
  app.get("/api/shipments", requireAuth, async (req, res) => {
    try {
      // BUG-08: accounts admins don't get the operational shipment registry —
      // the AdminPanel UI never shows them a Shipments tab, and the server
      // shouldn't hand it over just because the route was called directly.
      if (req.session!.role === "admin" && !canViewShipmentRegistry(req.session!.adminType)) {
        return res.status(403).json({ error: "Accounts-role admins cannot view the shipment registry." });
      }

      const cursorParam = parseCursorParam(req.query.cursor);
      if (!cursorParam.ok) return res.status(400).json({ error: "Malformed cursor." });
      const sinceParam = parseCursorParam(req.query.since);
      if (!sinceParam.ok) return res.status(400).json({ error: "Malformed since parameter." });

      const limitParam = parseInt(req.query.limit as string, 10);
      const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 200 ? limitParam : DEFAULT_PAGE_SIZE;

      // Scope results to the session's own role — never trust a
      // client-supplied driverId/clientId to decide what's returned.
      // resolveShipmentListQueryScopes (src/lib/shipmentListAccess.ts)
      // turns "assigned/additional-driver shipments" / "own company's
      // shipments" into real, indexed Firestore query scopes — no longer
      // a full-collection Node-side filter — and is unit tested directly.
      let clientCompanyName: string | null = null;
      if (req.session!.role === "client") {
        // Direct document lookup by the client session's own id — same
        // fix as GET /api/notifications' client branch (PR #99 review):
        // a client session's id already IS its own clients/{id} document
        // id, so this was never a full `clients` collection scan away
        // from being a single-document read.
        const clientDoc = await getDoc(doc(db, "clients", req.session!.id));
        clientCompanyName = clientDoc.exists() ? (clientDoc.data() as Client).companyName || null : null;
      }
      const { scopes, isEmpty } = resolveShipmentListQueryScopes(
        { role: req.session!.role, id: req.session!.id },
        clientCompanyName
      );

      // A client session whose own record is missing/companyName-less has
      // nothing to scope a query to — matches the old behavior's
      // `myClient ? ... : []` empty-result fallback exactly, without
      // firing a query with an empty scope (which fetchShipmentsPage/Since
      // would otherwise treat as "no filter at all," i.e. everything).
      if (isEmpty) {
        if (typeof req.query.since === "string") return res.json({ items: [], hasMore: false });
        return res.json({ items: [], nextCursor: null, hasMore: false });
      }

      const applyRoleView = (items: any[]): any[] =>
        req.session!.role === "admin" ? items : items.map((s) => buildShipmentViewForRole(s as Shipment, req.session!));

      if (typeof req.query.since === "string") {
        const sincePage = await fetchShipmentsSince(scopes, sinceParam.cursor, limit);
        return res.json({ items: applyRoleView(sincePage.items), hasMore: sincePage.hasMore });
      }

      const page = await fetchShipmentsPage(scopes, cursorParam.cursor, limit);
      res.json({ items: applyRoleView(page.items), nextCursor: page.nextCursor, hasMore: page.hasMore });
    } catch (err) {
      if (respondIfServiceUnavailable(err, res)) return;
      console.error(err);
      res.status(500).json({ error: "Failed to fetch shipments" });
    }
  });

  // 2. Create Shipment (Admin Only - writes to Firestore)
  /**
   * Driver Alliance Phase 1 refactor: the EXISTING shipment-creation
   * logic, extracted verbatim from POST /api/shipments so alliance
   * winner selection creates its shipment through the exact same code
   * path (sequence allocation, assignment safety, one-active-job claim,
   * timeline, notification, audit) — never a duplicated workflow.
   * Throws UnsafeDriverAssignmentError (route answers 400) and
   * DriverBusyError (route answers 409); both callers map them.
   */
  async function createShipmentRecord(data: any): Promise<Shipment> {

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
      throw new UnsafeDriverAssignmentError("Cannot assign a pending or rejected driver to a shipment.");
    }
    if (Array.isArray(data.additionalDrivers)) {
      for (const ad of data.additionalDrivers) {
        const adDriver = driversList.find(d => d.id === ad?.driverId);
        if (!isDriverAssignmentSafe(adDriver)) {
          throw new UnsafeDriverAssignmentError("Cannot assign a pending or rejected driver as an additional driver.");
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
      // Shipment-update lost-update race fix: new shipments always begin
      // at revision 1 (see resolveStoredRevision, shipmentRevision.ts).
      revision: INITIAL_SHIPMENT_REVISION,
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
      // Phase 4 follow-up (Firestore scalability audit, PR #99 review):
      // kept in sync with additionalDrivers on every write — see
      // deriveAdditionalDriverIds (src/lib/driverVisibility.ts) for why.
      additionalDriverIds: deriveAdditionalDriverIds(data.additionalDrivers),
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
      // Driver Alliance Phase 1 — one-active-job rule: claim the
      // driver's lock BEFORE the shipment document is written, so two
      // concurrent creations (or a creation racing a manual
      // reassignment / an alliance winner selection) can never give
      // one driver two active shipments. A rejected claim throws
      // DriverBusyError → 409 below, with no partial side effects.
      await claimDriverActiveJob(driver.id, id);

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

    return newShipment;
  }

  app.post("/api/shipments", requireFullAdmin, async (req, res) => {
    try {
      const newShipment = await createShipmentRecord(req.body);
      res.status(201).json(newShipment);
    } catch (err) {
      if (err instanceof UnsafeDriverAssignmentError) {
        return res.status(400).json({ error: err.message });
      }
      if (err instanceof DriverBusyError) {
        return res.status(409).json({ code: err.code, error: err.message });
      }
      console.error(err);
      res.status(500).json({ error: "Failed to create shipment" });
    }
  });

  // 2.5. Get Shipment Stats (dashboard aggregate totals)
  //
  // Phase 2A follow-up (blocking-issue fix: dashboard aggregate
  // accuracy). Registered BEFORE GET /api/shipments/:id so Express
  // doesn't swallow this path as `:id === "stats"` — see
  // fetchShipmentStats' own header comment for what this returns and
  // why the status breakdown is admin-only. Role-scoped exactly like
  // GET /api/shipments (resolveShipmentListQueryScopes) — a driver/
  // client never sees a count of anyone else's shipments.
  app.get("/api/shipments/stats", requireAuth, async (req, res) => {
    try {
      if (req.session!.role === "admin" && !canViewShipmentRegistry(req.session!.adminType)) {
        return res.status(403).json({ error: "Accounts-role admins cannot view the shipment registry." });
      }
      let clientCompanyName: string | null = null;
      if (req.session!.role === "client") {
        const clientDoc = await getDoc(doc(db, "clients", req.session!.id));
        clientCompanyName = clientDoc.exists() ? (clientDoc.data() as Client).companyName || null : null;
      }
      const { scopes, isEmpty } = resolveShipmentListQueryScopes(
        { role: req.session!.role, id: req.session!.id },
        clientCompanyName
      );
      const includeStatusGroups = req.session!.role === "admin";
      if (isEmpty) {
        return res.json({ total: 0, ...(includeStatusGroups ? { byStatusGroup: zeroedShipmentStatusGroupCounts() } : {}) });
      }
      const stats = await fetchShipmentStats(scopes, includeStatusGroups);
      res.json(stats);
    } catch (err) {
      if (respondIfServiceUnavailable(err, res)) return;
      console.error(err);
      res.status(500).json({ error: "Failed to fetch shipment stats" });
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
        // Phase 2A (Firestore scalability audit): direct document lookup
        // by the client session's own id, replacing a full `clients`
        // collection scan just to find this one record — same fix as GET
        // /api/shipments and GET /api/notifications' client branches (a
        // client session's id already IS its own clients/{id} document
        // id; see those routes' own comments).
        const clientDoc = await getDoc(doc(db, "clients", req.session!.id));
        const myClient = clientDoc.exists() ? (clientDoc.data() as Client) : null;
        if (!myClient || !isShipmentVisibleToClientCompany(shipment.companyName, myClient.companyName)) {
          return res.status(403).json({ error: "You do not have access to this shipment." });
        }
      }
      // Admins can view any shipment.

      res.json(buildShipmentViewForRole(shipment, req.session!));
    } catch (err) {
      if (respondIfServiceUnavailable(err, res)) return;
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

        // Update shipment profile metadata with fallback estimation.
        // Shipment-update lost-update race fix (PR #111 review — over-broad
        // revision policy correction): this caches a computed ETA/distance
        // best-effort, atomically. Deliberately revision-PRESERVING, not
        // revision-incrementing: a page or map merely requesting a distance
        // calculation must never make an admin's already-open edit form
        // stale/409 on save. Accepted, documented trade-off: `eta` IS a
        // field the edit form's own merge can also overwrite, so an admin
        // who saves a stale `eta` can still clobber a fresher auto-computed
        // one here — treating this route as revision-changing instead would
        // make routine page/map loads invalidate every open edit session,
        // which is the far more common and disruptive failure mode.
        try {
          await applyIsolatedShipmentUpdate(req.params.id, (current) => ({
            ...current,
            eta: calculatedEta,
            lastCalculatedEta: calculatedEta,
            lastCalculatedDistance: `${distanceKm} km`,
            lastCalculatedDuration: `${Math.round(durationInTrafficSeconds / 3600)} hrs ${Math.round((durationInTrafficSeconds % 3600) / 60)} mins`
          }));
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

        // Automatically update the document ETA field in the firestore
        // database. Shipment-update lost-update race fix (PR #111 review —
        // over-broad revision policy correction): same revision-preserving
        // isolated helper as the fallback-estimate branch above, and the
        // same accepted `eta` trade-off documented there — still
        // best-effort (a failure here is silently logged and never fails
        // this GET request).
        try {
          await applyIsolatedShipmentUpdate(req.params.id, (current) => ({
            ...current,
            eta: calculatedEta,
            lastCalculatedEta: calculatedEta,
            lastCalculatedDistance: distObj.text,
            lastCalculatedDuration: durInTrafficObj.text
          }));
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
      const data = req.body;

      // Shipment-update lost-update race fix (stability audit): the client
      // must always submit the revision it actually read — never a value it
      // computes itself — or the request is rejected outright. Concurrency
      // protection is never optional here; there is no legacy bypass.
      const expectedRevision = parseExpectedRevision(data.expectedRevision);
      if (expectedRevision === null) {
        return res.status(400).json({ error: "A valid expectedRevision is required to save shipment changes." });
      }

      const sDocRef = doc(db, "shipments", req.params.id);
      const sDoc = await getDoc(sDocRef);
      if (!sDoc.exists()) {
        return res.status(404).json({ error: "Shipment not found" });
      }

      // Pre-transaction snapshot, used only for the validation checks below.
      // Reassigned after a successful commit (see below) to the
      // transaction's own authoritative read, since that — not this early
      // read — is what the write actually applied on top of.
      let original = sDoc.data() as Shipment;

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

      const assignedDriverName = driverObj ? driverObj.name : "Unassigned";

      // Shipment-update lost-update race fix: this merge is a pure,
      // synchronous function of (the Firestore transaction's own
      // freshly-read current document, the revision to store) — no I/O of
      // any kind, since Firestore may run it more than once if the
      // transaction is internally retried. `current` is captured into
      // capturedCurrent so the notification/audit logic after the
      // transaction (which must never run inside the transaction itself)
      // can diff against the exact snapshot the write actually applied on
      // top of.
      //
      // PR #111 review (over-broad revision policy correction, requirement
      // 6): every field below is spread from this transaction's own fresh
      // `current`, and the object literal only explicitly overrides the
      // named edit-form fields — so documents, customerEmails,
      // customerNotificationHistory, isLinkShared, shareToken,
      // shareIncludeDocuments, shareIncludePhotos, lastCalculatedEta,
      // lastCalculatedDistance, and lastCalculatedDuration are never
      // touched here, no matter what an isolated writer concurrently set
      // them to. This is exactly why those writers are safe to be
      // revision-preserving (applyIsolatedShipmentUpdate): this route could
      // never have overwritten their fields anyway, so a version bump for
      // them would only produce false conflicts, never prevent a real one.
      let capturedCurrent: Shipment | null = null;
      // True only when the "first assignment" New -> Assigned bump below
      // actually fires — distinct from "is the final status Assigned".
      let assignmentBumpApplied = false;
      // PR #111 review (Admin Status Override authorization correction):
      // this broad edit route no longer accepts a free-form `data.status`
      // at all — status can only ever change via the automatic
      // "first assignment" bump below (a side effect of assigning a
      // driver, not a manual status edit), the forward-only normal
      // progression endpoint (PUT /api/shipments/:id/status), or the
      // dedicated, reason-required, freight-validated Admin Status
      // Override endpoint (PUT /api/shipments/:id/status-override). This
      // used to also apply whatever raw `data.status` string the client
      // sent, with no forward-only check, no freight-workflow validation,
      // no required reason, and no terminal-reopen lock — a complete
      // bypass of every safety rule those two dedicated endpoints now
      // enforce, reachable by any authorized editor of this form. `status`
      // is simply never read from `data` anymore; finalStatus always
      // starts from the transaction's own fresh `current.status`.
      function buildUpdatedShipment(current: Shipment, nextRevision: number): Shipment {
        capturedCurrent = current;

        let finalStatus = current.status;
        const timelineCopy = [...(current.timeline || [])];

        const updated: Shipment = {
          ...current,
          status: finalStatus,
          timeline: timelineCopy,
          companyName: data.companyName !== undefined ? data.companyName : current.companyName,
          loadingCountry: data.loadingCountry !== undefined ? data.loadingCountry : current.loadingCountry,
          loadingCity: data.loadingCity !== undefined ? data.loadingCity : current.loadingCity,
          loadingAddress: data.loadingAddress !== undefined ? data.loadingAddress : current.loadingAddress,
          loadingContactNumber: data.loadingContactNumber !== undefined ? data.loadingContactNumber : current.loadingContactNumber,
          deliveryCountry: data.deliveryCountry !== undefined ? data.deliveryCountry : current.deliveryCountry,
          deliveryCity: data.deliveryCity !== undefined ? data.deliveryCity : current.deliveryCity,
          deliveryAddress: data.deliveryAddress !== undefined ? data.deliveryAddress : current.deliveryAddress,
          deliveryContactNumber: data.deliveryContactNumber !== undefined ? data.deliveryContactNumber : current.deliveryContactNumber,
          cargoDescription: data.cargoDescription !== undefined ? data.cargoDescription : current.cargoDescription,
          cargoWeight: data.cargoWeight !== undefined ? Number(data.cargoWeight) : current.cargoWeight,
          truckNumber: driverObj ? driverObj.truckNumber : (data.truckNumber !== undefined ? data.truckNumber : current.truckNumber),
          assignedDriverId: newDriverId !== undefined ? newDriverId : current.assignedDriverId,
          assignedDriverName: newDriverId !== undefined ? assignedDriverName : current.assignedDriverName,
          agreedAmount: data.agreedAmount !== undefined ? Number(data.agreedAmount) : current.agreedAmount,
          currency: data.currency !== undefined ? data.currency : current.currency,
          internalNotes: data.internalNotes !== undefined ? data.internalNotes : current.internalNotes,
          updatedAt: new Date().toISOString(),
          revision: nextRevision,

          // Add Sea & Air properties to update payload
          freightType: data.freightType !== undefined ? data.freightType : current.freightType,
          shippingLine: data.shippingLine !== undefined ? data.shippingLine : current.shippingLine,
          vesselName: data.vesselName !== undefined ? data.vesselName : current.vesselName,
          containerNumber: data.containerNumber !== undefined ? data.containerNumber : current.containerNumber,
          bookingNumber: data.bookingNumber !== undefined ? data.bookingNumber : current.bookingNumber,
          billOfLadingNumber: data.billOfLadingNumber !== undefined ? data.billOfLadingNumber : current.billOfLadingNumber,
          portOfLoading: data.portOfLoading !== undefined ? data.portOfLoading : current.portOfLoading,
          portOfDischarge: data.portOfDischarge !== undefined ? data.portOfDischarge : current.portOfDischarge,
          finalDestination: data.finalDestination !== undefined ? data.finalDestination : current.finalDestination,
          etd: data.etd !== undefined ? data.etd : current.etd,
          eta: data.eta !== undefined ? data.eta : current.eta,
          numberOfContainers: data.numberOfContainers !== undefined ? Number(data.numberOfContainers) : current.numberOfContainers,
          containerType: data.containerType !== undefined ? data.containerType : current.containerType,
          airline: data.airline !== undefined ? data.airline : current.airline,
          flightNumber: data.flightNumber !== undefined ? data.flightNumber : current.flightNumber,
          airWaybillNumber: data.airWaybillNumber !== undefined ? data.airWaybillNumber : current.airWaybillNumber,
          airportOfDeparture: data.airportOfDeparture !== undefined ? data.airportOfDeparture : current.airportOfDeparture,
          airportOfArrival: data.airportOfArrival !== undefined ? data.airportOfArrival : current.airportOfArrival,
          grossWeight: data.grossWeight !== undefined ? Number(data.grossWeight) : current.grossWeight,
          chargeableWeight: data.chargeableWeight !== undefined ? Number(data.chargeableWeight) : current.chargeableWeight,
          numberOfPackages: data.numberOfPackages !== undefined ? Number(data.numberOfPackages) : current.numberOfPackages,
          additionalDrivers: data.additionalDrivers !== undefined ? data.additionalDrivers : current.additionalDrivers,
          // Phase 4 follow-up (Firestore scalability audit, PR #99 review):
          // re-derived on every update (from whichever value additionalDrivers
          // above just resolved to) so this stays in sync even on an update
          // that doesn't touch additionalDrivers itself.
          additionalDriverIds: deriveAdditionalDriverIds(
            data.additionalDrivers !== undefined ? data.additionalDrivers : current.additionalDrivers
          ),
          additionalContainers: data.additionalContainers !== undefined ? data.additionalContainers : current.additionalContainers,

          // Broker details mapping for land shipments
          destinationBrokerId: data.destinationBrokerId !== undefined ? data.destinationBrokerId : current.destinationBrokerId,
          destinationBrokerName: data.destinationBrokerName !== undefined ? data.destinationBrokerName : current.destinationBrokerName,
          destinationBrokerPhone: data.destinationBrokerPhone !== undefined ? data.destinationBrokerPhone : current.destinationBrokerPhone,
          iraqBorderBrokerId: data.iraqBorderBrokerId !== undefined ? data.iraqBorderBrokerId : current.iraqBorderBrokerId,
          iraqBorderBrokerName: data.iraqBorderBrokerName !== undefined ? data.iraqBorderBrokerName : current.iraqBorderBrokerName,
          iraqBorderBrokerPhone: data.iraqBorderBrokerPhone !== undefined ? data.iraqBorderBrokerPhone : current.iraqBorderBrokerPhone,
        };

        // Set status to Assigned if first assigned
        if (oldDriverId !== newDriverId && newDriverId && updated.status === "New") {
          updated.status = "Assigned";
          updated.timeline.push({
            timestamp: new Date().toISOString(),
            status: "Assigned",
            labelEn: "Driver Assigned",
            labelTr: "Sürücü Atandı",
            labelAr: "تم تعيين السائق",
            detailsEn: `Assigned to driver ${assignedDriverName} during shipment update.`,
            detailsTr: `Sözleşme güncellemesi sırasında sürücü ${assignedDriverName} atandı.`,
            detailsAr: `تم تعيينه للسائق  ${assignedDriverName} أثناء عملية التحديث.`
          });
          assignmentBumpApplied = true;
        }

        return updated;
      }

      // Driver Alliance Phase 1 — one-active-job rule: a manual
      // reassignment to a driver who already carries an active shipment
      // is rejected server-side BEFORE the write, with the same
      // transactional lock POST /api/shipments and alliance winner
      // selection use, so no pair of concurrent requests can ever give
      // one driver two active shipments.
      const isReassignment = newDriverId !== undefined && newDriverId && newDriverId !== oldDriverId;
      if (isReassignment) {
        try {
          await claimDriverActiveJob(newDriverId, req.params.id);
        } catch (err) {
          if (err instanceof DriverBusyError) {
            return res.status(409).json({ code: err.code, error: err.message });
          }
          throw err;
        }
      }

      let updatedShipment: Shipment;
      try {
        updatedShipment = await applyShipmentRevisionedUpdate(req.params.id, expectedRevision, buildUpdatedShipment);
      } catch (err) {
        // The assignment write didn't commit — release the lock claimed
        // just above so the driver isn't left reserved for a save that
        // never happened (best-effort; a leftover lock self-heals via the
        // staleness check on the next claim).
        if (isReassignment) {
          await releaseDriverActiveJob(newDriverId, req.params.id);
        }
        if (err instanceof ShipmentRevisionConflictError) {
          // Stale save: no document was modified, and no notification/audit
          // side effect below ever runs for this request.
          return res.status(409).json({
            code: err.code,
            error: err.message,
            currentRevision: err.currentRevision,
            shipment: err.currentShipment,
          });
        }
        throw err;
      }

      // Everything below only runs after a successful, committed write —
      // never on validation failure, a missing shipment, a revision
      // conflict, or a transaction/infrastructure failure. The shipment
      // itself is already safely saved at this point: none of these tasks
      // may cause this request to report a save failure (PR #111 review —
      // see runShipmentUpdateSideEffects's own header for why).
      original = capturedCurrent!;

      // PR #111 review (Admin Status Override authorization correction):
      // status is no longer part of this route's update payload at all
      // (buildUpdatedShipment ignores data.status entirely — see its own
      // header comment) — a "Status is now: X" diff line here would
      // describe a value that was never actually applied to the shipment.
      const updatedDiffTexts: string[] = [];
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

      const sideEffectTasks: ShipmentSideEffectTask[] = [];

      // Driver activeShipmentsCount is a derived, cached tally — not the
      // authoritative record of which shipments a driver is assigned to
      // (that's each Shipment's own assignedDriverId/additionalDrivers,
      // already safely committed inside the transaction above). If one of
      // these writes fails, the assignment itself is still correct; only
      // this cached count can drift by one until a future successful
      // update on either driver recomputes it. Known, accepted limitation —
      // fixing it properly (a computed/query-derived count instead of a
      // cached field) is a larger change, out of scope for this PR.
      if (oldDriverId !== newDriverId) {
        if (oldDriverId) {
          sideEffectTasks.push({
            name: "driver-stat-decrement",
            run: async () => {
              const odRef = doc(db, "drivers", oldDriverId);
              const odDoc = await getDoc(odRef);
              if (odDoc.exists()) {
                const od = odDoc.data() as Driver;
                od.activeShipmentsCount = Math.max(0, od.activeShipmentsCount - 1);
                await setDoc(odRef, od);
              }
            },
          });
        }
        if (newDriverId && driverObj) {
          sideEffectTasks.push({
            name: "driver-stat-increment",
            run: async () => {
              await setDoc(doc(db, "drivers", newDriverId), { ...driverObj, activeShipmentsCount: driverObj.activeShipmentsCount + 1 });
            },
          });
        }
      }

      // Driver Alliance Phase 1: the previous driver's one-active-job
      // lock is released once the reassignment/unassignment committed.
      // Best-effort like every other post-commit task — a failed release
      // self-heals on the next claim.
      if (newDriverId !== undefined && oldDriverId && oldDriverId !== newDriverId) {
        sideEffectTasks.push({
          name: "driver-active-job-release-old",
          run: () => releaseDriverActiveJob(oldDriverId, req.params.id),
        });
      }


      // PR #111 review (Admin Status Override authorization correction): a
      // dedicated "status-update-notification" task used to fire here too
      // when data.status changed — removed along with buildUpdatedShipment's
      // status handling, since this route can no longer change status at
      // all (except the automatic assignment bump just below, which has
      // its own dedicated "assignment-notification" task).
      if (assignmentBumpApplied) {
        sideEffectTasks.push({
          name: "assignment-notification",
          run: () => pushNotification(
            original.id,
            original.shipmentNumber,
            "assignment",
            "New Assignment Assigned",
            "Yeni Görev Atandı",
            "تم تعيين مهمة جديدة",
            `Shipment ${original.shipmentNumber} has been assigned to you.`,
            `Sistem size ${original.shipmentNumber} numaralı sevkiyat yükünü atadı.`,
            `تم تعيين الشحنة رقم ${original.shipmentNumber} لك.`
          ),
        });
      }

      sideEffectTasks.push({
        name: "customer-watcher-notification",
        run: () => notifyCustomerWatchers(
          updatedShipment,
          "edit",
          "Shipment Parameters Updated",
          `Attention: Your shipment #${original.shipmentNumber} was updated by central operations. ${diffMsg}`
        ),
      });

      // In-app notification for the customer application
      sideEffectTasks.push({
        name: "shipment-updated-notification",
        run: () => pushNotification(
          original.id,
          original.shipmentNumber,
          "status_update",
          "Shipment Updated",
          "Sevkiyat Güncellendi",
          "تم تحديث الشحنة",
          `Attention: Your shipment #${original.shipmentNumber} was updated: ${diffMsg}`,
          `Yükünüz #${original.shipmentNumber} güncellendi: ${diffMsg}`,
          `تنبيه: تم تحديث شحنتكم رقم #${original.shipmentNumber}: ${diffMsg}`
        ),
      });

      sideEffectTasks.push({
        name: "audit-log",
        run: () => logActivity(
          original.id,
          original.shipmentNumber,
          "Admin Office",
          `Updated shipment parameters for ${original.shipmentNumber}`,
          `${original.shipmentNumber} sevkiyat parametreleri güncellendi`,
          `تم تحديث معايير الشحنة ${original.shipmentNumber}`
        ),
      });

      const sideEffectFailures = await runShipmentUpdateSideEffects(sideEffectTasks);
      for (const failure of sideEffectFailures) {
        console.error(
          `[shipment-update] post-commit side effect "${failure.name}" failed for shipment ${original.id} (${original.shipmentNumber}) — the shipment save itself already succeeded and is not retried.`,
          failure.error
        );
      }

      res.json(updatedShipment);
    } catch (err) {
      if (respondIfServiceUnavailable(err, res)) return;
      console.error(err);
      res.status(500).json({ error: "Failed to update shipment details" });
    }
  });

  // 5. Update Status
  app.put("/api/shipments/:id/status", requireAuth, async (req, res) => {
    try {
      const { status, remarksDesc, updaterName, role } = req.body;
      const requestedStatus: string = status;
      if (typeof requestedStatus !== "string" || !requestedStatus.trim()) {
        return res.status(400).json({ error: "status is required" });
      }
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
      } else if (req.session!.role === "admin" && !canManageShipmentStatus(req.session)) {
        // PR #83 (Shipment Registry review), narrowed further by the PR
        // #111 role-authorization correction: shipment status management
        // is a dedicated write permission (canManageShipmentStatus,
        // adminAccess.ts), not the read-only canViewShipmentRegistry this
        // used to reuse — an accounts-type admin session could otherwise
        // update any shipment's status directly, even though the whole
        // Shipment Registry tab (and its only client-side call site for
        // this route, the shipment details modal) is hidden from them.
        return res.status(403).json({ error: "Accounts-role admins cannot update shipment status." });
      }

      // PR #111 review (Delivered/Closed terminal & chat rules): closing a
      // shipment (Land's "Closed", Sea/Air's "Completed" — see
      // getClosingStatusForFreightMode, shipmentStatusTransitions.ts) is
      // reserved for authorized internal MARAS staff, never a driver or
      // customer/public session, regardless of whether the client-side
      // control happens to expose it. freightType is never changed by any
      // route, so the pre-read `item.freightType` is safe to use here.
      // This is a real server-side authorization gate, not just a UI
      // omission — the same canManageShipmentStatus check every other
      // admin status change above already requires (never
      // canViewShipmentRegistry — see that function's own header comment).
      if (
        isShipmentClosed(requestedStatus, item.freightType) &&
        !(req.session!.role === "admin" && canManageShipmentStatus(req.session))
      ) {
        return res.status(403).json({ error: "Only authorized MARAS staff may close a shipment." });
      }

      // PR #111 review (forward-only status transitions): validated and
      // built entirely inside applyNarrowShipmentUpdate's mutate callback,
      // from `current` — that call's own fresh read (the Firestore
      // transaction's live document, or the memory-fallback's live array
      // entry) — never from the pre-read `item` above. If another status
      // update committed between this request's initial read and now, this
      // runs against that committed result, not stale data (requirement:
      // "revalidate the transition inside the transaction using the
      // transaction's current shipment"). isDriverAssignmentRejection is
      // the one deliberate, narrowly-scoped exception to forward-only —
      // see its own header comment (shipmentStatusTransitions.ts).
      let updatedItem: Shipment;
      try {
        updatedItem = await applyNarrowShipmentUpdate(shipmentId, (current) => {
          if (!isDriverAssignmentRejection(current.status, requestedStatus)) {
            const transition = validateShipmentStatusTransition(current.status, requestedStatus, current.freightType);
            if (!transition.ok) {
              throw new ShipmentStatusTransitionError(current.status, requestedStatus, transition.allowedNextStatuses, transition.reason!);
            }
          }

          const labels = getShipmentStatusLabel(requestedStatus);
          const nowIso = new Date().toISOString();
          return {
            ...current,
            status: requestedStatus as ShipmentStatus,
            timeline: [
              ...current.timeline,
              {
                timestamp: nowIso,
                status: requestedStatus as ShipmentStatus,
                labelEn: labels.en,
                labelTr: labels.tr,
                labelAr: labels.ar,
                detailsEn: remarksDesc || `Status updated from ${current.status} to ${requestedStatus} by ${updaterName || 'System'}.`,
                detailsTr: remarksDesc || `Durum ${updaterName || 'Sistem'} tarafından ${current.status} seviyesinden ${requestedStatus} seviyesine çekildi.`,
                detailsAr: remarksDesc || `تم تحديث الحالة من ${current.status} إلى ${requestedStatus} بواسطة ${updaterName || 'النظام'}.`
              },
            ],
            updatedAt: nowIso,
          };
        });
      } catch (err) {
        if (err instanceof ShipmentStatusTransitionError) {
          // No document modification, no notification, no audit entry —
          // the transaction's mutate callback threw before building or
          // writing anything.
          return res.status(409).json({
            code: err.code,
            error: err.message,
            currentStatus: err.currentStatus,
            requestedStatus: err.requestedStatus,
            allowedNextStatuses: err.allowedNextStatuses,
          });
        }
        throw err;
      }

      // Everything below only runs after a successful, committed status
      // change — never on a rejected transition (409 above), a permission
      // denial, or a transaction/infrastructure failure. PR #111 review
      // (post-commit response semantics): the driver-stat cache update and
      // customer notification used to run BEFORE the commit, against the
      // pre-read `item` — meaning they'd already have fired even for a
      // transition later rejected as invalid. Both are now strictly
      // post-commit and built from `updatedItem` (the committed result),
      // alongside the notification/audit tasks already fixed here in the
      // prior review round.
      const sideEffectTasks: ShipmentSideEffectTask[] = [];

      // Driver Alliance Phase 1 — one-active-job lock release. The driver
      // becomes Available again exactly at the freight mode's closing
      // status (Closed for Land, Completed for Sea/Air — Delivered alone
      // does NOT free them), and immediately when they decline an
      // assignment (the Assigned→New exception is the only way
      // requestedStatus can be "New" here). Best-effort post-commit task;
      // a failed release self-heals on the next claim.
      if (
        updatedItem.assignedDriverId &&
        (isShipmentClosed(requestedStatus, updatedItem.freightType) || requestedStatus === "New")
      ) {
        sideEffectTasks.push({
          name: "driver-active-job-release",
          run: () => releaseDriverActiveJob(updatedItem.assignedDriverId, updatedItem.id),
        });
      }

      if (requestedStatus === "Delivered" && updatedItem.assignedDriverId) {
        // Driver activeShipmentsCount is a derived, cached tally — not the
        // authoritative record (same reasoning as PUT /api/shipments/:id's
        // own driver-stat tasks). If this fails, the status change itself
        // is still correct; only this cached count can drift by one until
        // a future successful update on either driver recomputes it.
        sideEffectTasks.push({
          name: "driver-stat-delivered-increment",
          run: async () => {
            const dDocRef = doc(db, "drivers", updatedItem.assignedDriverId);
            const dDoc = await getDoc(dDocRef);
            if (dDoc.exists()) {
              const driver = dDoc.data() as Driver;
              driver.activeShipmentsCount = Math.max(0, driver.activeShipmentsCount - 1);
              driver.completedShipmentsCount += 1;
              await setDoc(dDocRef, driver);
            }
          },
        });
      }

      sideEffectTasks.push({
        name: "customer-watcher-notification",
        run: () => notifyCustomerWatchers(
          updatedItem,
          requestedStatus === "Delivered" ? "delivery" : "status_update",
          `Shipment Status Updated: ${requestedStatus}`,
          `Good day, your shipment #${updatedItem.shipmentNumber} status is now: ${requestedStatus}. Remarks: ${remarksDesc || 'No remarks recorded.'}`
        ),
      });

      sideEffectTasks.push({
        name: "status-update-notification",
        run: () => pushNotification(
          updatedItem.id,
          updatedItem.shipmentNumber,
          requestedStatus === "Accepted" ? "acceptance" : (requestedStatus === "Delivered" ? "delivery" : "status_update"),
          `Status Update: ${requestedStatus}`,
          `Durum Güncellemesi: ${requestedStatus}`,
          `تحديث الحالة: ${requestedStatus}`,
          `Shipment ${updatedItem.shipmentNumber} is now ${requestedStatus}.`,
          `Sevkiyat ${updatedItem.shipmentNumber} şu anda ${requestedStatus} konumunda.`,
          `الشحنة رقم ${updatedItem.shipmentNumber} الآن هي في حالة [${requestedStatus}].`
        ),
      });

      sideEffectTasks.push({
        name: "audit-log",
        run: () => logActivity(
          updatedItem.id,
          updatedItem.shipmentNumber,
          updaterName || role || "System",
          `Changed status of ${updatedItem.shipmentNumber} to ${requestedStatus}`,
          `${updatedItem.shipmentNumber} sevkiyat durumunu ${requestedStatus} olarak güncelledi`,
          `تغيير حالة الشحنة برقم ${updatedItem.shipmentNumber} إلى ${requestedStatus}`
        ),
      });

      const sideEffectFailures = await runShipmentUpdateSideEffects(sideEffectTasks);
      for (const failure of sideEffectFailures) {
        console.error(
          `[status-update] post-commit side effect "${failure.name}" failed for shipment ${updatedItem.id} (${updatedItem.shipmentNumber}) — the status save itself already succeeded and is not retried.`,
          failure.error
        );
      }

      res.json(buildShipmentViewForRole(updatedItem, req.session!));
    } catch (err) {
      if (respondIfServiceUnavailable(err, res)) return;
      console.error(err);
      res.status(500).json({ error: "Failed to update status" });
    }
  });

  // 5a. Admin Status Override — the deliberate, separate exceptional-
  // correction workflow (PR #111 review, requirement 6: "Admin Status
  // Override must remain separate from the normal sequential status
  // endpoint"). Unlike PUT /api/shipments/:id/status above, this is not
  // forward-only — an authorized operational admin may correct a status
  // backward (or to any other valid status in the shipment's own freight
  // workflow) when an operational mistake occurred. It replaces the old
  // free-form `data.status` field that used to be accepted by the broad
  // edit route (PUT /api/shipments/:id) with no freight validation, no
  // required reason, and no terminal-reopen lock — that field is no longer
  // read there at all (see buildUpdatedShipment's own comment); this is now
  // the only way to correct a shipment's status outside forward-only
  // progression.
  app.put("/api/shipments/:id/status-override", requireAuth, async (req, res) => {
    try {
      const { status, correctionReason, updaterName } = req.body;
      const requestedStatus: string = status;
      if (typeof requestedStatus !== "string" || !requestedStatus.trim()) {
        return res.status(400).json({ error: "status is required" });
      }
      const reason = parseStatusOverrideReason(correctionReason);
      if (!reason) {
        return res.status(400).json({ error: "A correction reason is required for a status override." });
      }

      // PR #111 review (Admin Status Override authorization correction):
      // canManageShipmentStatus (Super Admin / Operations Admin only) —
      // never canViewShipmentRegistry, a read permission. Driver, client,
      // Accounts Admin, and any other admin adminType are all rejected
      // here regardless of what a manually-crafted request sends.
      if (!canManageShipmentStatus(req.session)) {
        return res.status(403).json({ error: "Only authorized MARAS staff may override shipment status." });
      }

      const shipmentId = req.params.id;
      const sDocRef = doc(db, "shipments", shipmentId);
      const sDoc = await getDoc(sDocRef);
      if (!sDoc.exists()) {
        return res.status(404).json({ error: "Shipment not found" });
      }

      // PR #111 review (forward-only status transitions / Admin Status
      // Override, requirement 10 & 7): validated and built entirely inside
      // applyNarrowShipmentUpdate's mutate callback, from `current` — that
      // call's own fresh read — never a pre-transaction snapshot, so
      // concurrent history can never be lost and the terminal-lock check
      // always runs against the real current status. Rejects unknown
      // statuses, statuses from another freight workflow, and any attempt
      // to reopen an already-closed/completed shipment (no reopening in
      // this PR — see validateShipmentStatusOverride's own header comment).
      let capturedPreviousStatus: ShipmentStatus | null = null;
      let updatedItem: Shipment;
      try {
        updatedItem = await applyNarrowShipmentUpdate(shipmentId, (current) => {
          const validation = validateShipmentStatusOverride(current.status, requestedStatus, current.freightType);
          if (!validation.ok) {
            throw new ShipmentStatusOverrideError(current.status, requestedStatus, validation.reason!);
          }

          capturedPreviousStatus = current.status;
          const labels = getShipmentStatusLabel(requestedStatus);
          const nowIso = new Date().toISOString();
          return {
            ...current,
            status: requestedStatus as ShipmentStatus,
            timeline: [
              ...current.timeline,
              {
                timestamp: nowIso,
                status: requestedStatus as ShipmentStatus,
                labelEn: labels.en,
                labelTr: labels.tr,
                labelAr: labels.ar,
                // PR #111 review (requirement 9): the correction reason is
                // deliberately NOT included here — this timeline is
                // returned unfiltered to driver/client views
                // (buildShipmentViewForRole) and to the public share view
                // (buildSecureShareView, both spread `timeline` through
                // unredacted). Only a generic, customer/public-safe label
                // goes here; the reason is recorded exclusively in the
                // internal audit log below (logActivity — GET /api/logs is
                // super-admin-only, never customer/public-reachable).
                detailsEn: `Status corrected to ${labels.en} by administrative review.`,
                detailsTr: `Durum, yönetimsel inceleme ile ${labels.tr} olarak düzeltildi.`,
                detailsAr: `تم تصحيح الحالة إلى ${labels.ar} عبر مراجعة إدارية.`,
              },
            ],
            updatedAt: nowIso,
          };
        });
      } catch (err) {
        if (err instanceof ShipmentStatusOverrideError) {
          // No document modification, no notification, no audit entry —
          // the transaction's mutate callback threw before building or
          // writing anything.
          return res.status(409).json({
            code: err.code,
            error: err.message,
            currentStatus: err.currentStatus,
            requestedStatus: err.requestedStatus,
            reason: err.reason,
          });
        }
        throw err;
      }

      // PR #111 review (requirement 8 & 10): the audit entry is the
      // authoritative record of this administrative correction — actor,
      // previous status, new status, shipmentNumber, timestamp (via
      // logActivity's own timestamp field), and the full reason text
      // (safe here: this collection is never exposed to customer/driver/
      // public views). Explicitly labeled "ADMINISTRATIVE CORRECTION" so
      // it reads unambiguously as an override, not a normal progression
      // entry, in the audit trail. Runs strictly post-commit — never on a
      // rejected/unauthorized attempt above.
      const overrideSideEffectTasks: ShipmentSideEffectTask[] = [
        {
          name: "audit-log",
          run: () => logActivity(
            updatedItem.id,
            updatedItem.shipmentNumber,
            updaterName || req.session!.id || "Admin",
            `ADMINISTRATIVE CORRECTION: shipment ${updatedItem.shipmentNumber} status corrected from "${capturedPreviousStatus}" to "${requestedStatus}". Reason: ${reason}`,
            `YÖNETİMSEL DÜZELTME: ${updatedItem.shipmentNumber} numaralı sevkiyatın durumu "${capturedPreviousStatus}" konumundan "${requestedStatus}" konumuna düzeltildi. Sebep: ${reason}`,
            `تصحيح إداري: تم تصحيح حالة الشحنة رقم ${updatedItem.shipmentNumber} من "${capturedPreviousStatus}" إلى "${requestedStatus}". السبب: ${reason}`
          ),
        },
      ];
      // Driver Alliance Phase 1 — an administrative correction that lands
      // on the closing status frees the driver exactly like the normal
      // closing transition does.
      if (updatedItem.assignedDriverId && isShipmentClosed(requestedStatus, updatedItem.freightType)) {
        overrideSideEffectTasks.push({
          name: "driver-active-job-release",
          run: () => releaseDriverActiveJob(updatedItem.assignedDriverId, updatedItem.id),
        });
      }
      const sideEffectFailures = await runShipmentUpdateSideEffects(overrideSideEffectTasks);
      for (const failure of sideEffectFailures) {
        console.error(
          `[status-override] post-commit side effect "${failure.name}" failed for shipment ${updatedItem.id} (${updatedItem.shipmentNumber}) — the override itself already succeeded and is not retried.`,
          failure.error
        );
      }

      res.json(buildShipmentViewForRole(updatedItem, req.session!));
    } catch (err) {
      if (respondIfServiceUnavailable(err, res)) return;
      console.error(err);
      res.status(500).json({ error: "Failed to override shipment status" });
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

      const cleanEmail = email.trim().toLowerCase();
      const alertId = `cnh-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      // Shipment-update lost-update race fix (PR #111 review — over-broad
      // revision policy correction): appends to whatever the document's
      // CURRENT customerEmails/customerNotificationHistory actually are
      // (not a pre-read snapshot), atomically. Revision-PRESERVING: the
      // human edit form's own merge (buildUpdatedShipment) never overwrites
      // these fields, so a customer subscribing to alerts must not make an
      // unrelated, already-open admin edit form 409 on its next save.
      const updatedItem = await applyIsolatedShipmentUpdate(shipmentId, (current) => {
        const customerEmails = current.customerEmails ? [...current.customerEmails] : [];
        if (!customerEmails.includes(cleanEmail)) {
          customerEmails.push(cleanEmail);
        }
        const customerNotificationHistory = current.customerNotificationHistory ? [...current.customerNotificationHistory] : [];
        customerNotificationHistory.push({
          id: alertId,
          timestamp: new Date().toISOString(),
          type: "setup",
          title: "Subscribed Successfully",
          message: `Your alert subscription for shipment #${current.shipmentNumber} has been successfully verified. You will receive real-time updates directly.`,
          email: cleanEmail,
          channel: channel || "email"
        });
        return { ...current, customerEmails, customerNotificationHistory };
      });

      // PR #111 review (post-commit response semantics re-audit): the
      // subscription append above is already safely committed — a
      // logActivity failure afterward must not make this request falsely
      // report "Failed to join notification server registration scheme".
      const sideEffectFailures = await runShipmentUpdateSideEffects([
        {
          name: "audit-log",
          run: () => logActivity(
            updatedItem.id,
            updatedItem.shipmentNumber,
            "Customer (Tracking Subscription)",
            `Subscribed to real-time cargo updates`,
            `Canlı kargo güncellemelerine abone oldu`,
            `قام العميل بالاشتراك في تحديثات الشحنة المباشرة`
          ),
        },
      ]);
      for (const failure of sideEffectFailures) {
        console.error(
          `[subscribe-customer] post-commit side effect "${failure.name}" failed for shipment ${updatedItem.id} (${updatedItem.shipmentNumber}) — the subscription itself already succeeded and is not retried.`,
          failure.error
        );
      }

      res.json(buildShipmentViewForRole(updatedItem, req.session!));
    } catch (err) {
      if (respondIfServiceUnavailable(err, res)) return;
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

      // Phase 4 (Firestore scalability audit): scoped at the query level
      // instead of fetching every chatMessages document ever written and
      // filtering shipmentId/channel in Node. resolveSeenChannelFilter
      // already encodes the exact same role/requestedChannel → channel
      // rule filterChatMessagesByRole used to apply after the fact (null
      // = admin's "all channels" default, matching the merged-admin GET
      // behavior this replaces) — reused here rather than duplicated.
      const channelFilter = resolveSeenChannelFilter(req.session!.role, requestedChannel);
      const filters: PageFilter[] = [{ field: "shipmentId", op: "==", value: req.params.id }];
      if (channelFilter) filters.push({ field: "channel", op: "==", value: channelFilter });

      const limitParam = parseInt(req.query.limit as string, 10);
      const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 200 ? limitParam : DEFAULT_PAGE_SIZE;

      // PR #99 review fix: a malformed *supplied* cursor/since value now
      // 400s instead of silently resetting to the first page — see
      // parseCursorParam's own header comment (src/lib/pagination.ts). A
      // missing param is still perfectly valid (fetch from the start).
      const cursorParam = parseCursorParam(req.query.cursor);
      if (!cursorParam.ok) return res.status(400).json({ error: "Malformed cursor." });
      const sinceParam = parseCursorParam(req.query.since);
      if (!sinceParam.ok) return res.status(400).json({ error: "Malformed since parameter." });

      // Live-poll "catch up" mode: only rows newer than the caller's own
      // last-known cursor, never a full re-fetch of the thread.
      if (typeof req.query.since === "string") {
        const sincePage = await queryAscendingSince("chatMessages", filters, sinceParam.cursor, limit);
        const items = sincePage.items.map((m) => ({ ...m, status: m.status || "sent" }));
        return res.json({ items, hasMore: sincePage.hasMore });
      }

      const page = await queryDescendingPage("chatMessages", filters, cursorParam.cursor, limit);
      // page.items come back newest-first (matching the query's own
      // orderBy direction) — reversed to oldest-first here so the
      // response shape every chat surface renders is unchanged: a page of
      // messages in the order they should appear top-to-bottom.
      const items = page.items.slice().reverse().map((m) => ({ ...m, status: m.status || "sent" }));
      res.json({ items, nextCursor: page.nextCursor, hasMore: page.hasMore });
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
      if (!isValidChatRole(viewer)) {
        return res.status(400).json({ error: "Viewer is required and must be 'admin', 'driver', or 'client'" });
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

      // feature/admin-mobile-ui correction pass: only an admin viewer
      // gets per-admin read tracking (src/lib/chatUnreadAccess.ts) — a
      // driver/client session's own "mark the admin side's messages seen"
      // call below is unchanged, since there's exactly one driver/client
      // per shipment and no per-user concept applies there.
      const viewerAdminId = viewer === "admin" ? req.session!.id : null;

      // Phase 4 follow-up (Firestore scalability audit): scoped at the
      // query level to this shipment (+ channel, when the caller's role
      // fixes one) instead of fetching every chatMessages document ever
      // written and filtering shipmentId/channel in Node — same rationale,
      // and the same already-deployed composite indexes (firestore.indexes.json),
      // as the sibling GET /api/shipments/:id/chat route just above.
      // buildSeenScopeFilters/planSeenWrites (src/lib/chatSeenPlan.ts) are
      // the single, unit-tested source of truth for both the query scope
      // and the per-message write decision — isMessageInSeenScope is
      // re-checked there anyway as defense in depth (never rely on query
      // scoping alone for a permission boundary).
      const filters = buildSeenScopeFilters(shipmentId, channelFilter);
      const candidates = await fetchAllMatchingDescending("chatMessages", filters);
      const writes = planSeenWrites(candidates as ChatMessage[], { viewer, channelFilter, shipmentId, viewerAdminId });

      // Chat-unread scalability follow-up: a deleted adminChatUnread record
      // IS "read" — no separate flag to flip. Scoped to this exact
      // adminId+shipmentId(+channel) triple, the same scope buildSeenScopeFilters
      // already computed above for the legacy chatMessages write, so this
      // can never clear a different admin's, shipment's, or channel's
      // unread state. Only relevant when this call resolved a per-admin
      // viewerAdminId above (driver/client "seen" calls never touch
      // per-admin state at all — see viewerAdminId's own comment).
      // Deletion (not a re-derived write) is what makes a retried/duplicate
      // "seen" call idempotent: deleting an already-gone doc is a no-op.
      let unreadRecordIdsToClear: string[] = [];
      if (viewerAdminId) {
        const unreadClearFilters = buildUnreadClearFilters(viewerAdminId, shipmentId, channelFilter);
        const unreadRecordsToClear = await fetchAllMatchingDescending("adminChatUnread", unreadClearFilters);
        unreadRecordIdsToClear = unreadRecordsToClear.map((r: any) => r.id as string);
      }

      // Combined into one atomic operation (commitSeenWritesAndUnreadClears)
      // so the legacy chatMessages writes and the adminChatUnread deletes
      // above can never partially apply — see that function's own header
      // comment for why a failure here must never let the two drift out
      // of sync with each other.
      await commitSeenWritesAndUnreadClears(writes, unreadRecordIdsToClear);

      res.json({ success: true, updatedCount: writes.length, unreadClearedCount: unreadRecordIdsToClear.length });
    } catch (err) {
      console.error(err);
      if (respondIfServiceUnavailable(err, res)) return;
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

      // fix/chat-safety-reliability-phase1: server-side backstop —
      // independent of which client sent this, and independent of whether
      // that client's own upload-failure handling worked correctly. Rejects
      // any fileUrl that is an inline `data:` URL (a client should only ever
      // send the real Storage URL returned by POST /api/upload) and enforces
      // the shared max text length + "not whitespace-only unless a valid
      // attachment is present" rule. See src/lib/chatMessageValidation.ts
      // for the full rationale — this is the one place that rule is
      // actually enforced; every client-side check is advisory on top of it.
      const sendValidation = validateChatSendPayload({ type, text, fileUrl });
      if (!sendValidation.ok) {
        return res.status(400).json({ error: sendValidation.error });
      }

      // PR #34: 'internal_staff' is a MARAS-staff-only audience — reject
      // outright rather than silently reassigning to the caller's own
      // channel, so a driver/client trying to post into it gets an
      // unambiguous 403.
      if (requestedChannel === "internal_staff" && !canAccessInternalStaffChannel(req.session!.role)) {
        return res.status(403).json({ error: "You do not have permission to post to this channel." });
      }

      // Removing an upload option from the driver-facing UI only stops the
      // app's own UI from offering it — this endpoint can be called
      // directly, so the category policy has to be enforced here too. A
      // driver session may only attach categories the registry flags
      // driverUploadable (DOCUMENT_CATEGORY_POLICIES,
      // src/lib/shipmentDocuments.ts); admin-published categories are
      // rejected regardless of what the client sent.
      if (req.session!.role === "driver" && !canDriverUploadDocumentCategory(fileCategory)) {
        return res.status(403).json({ error: "This document category is published by MARAS Admin and cannot be uploaded by drivers." });
      }

      // Shipment-chat lifecycle (server-side): the conversation exists
      // for the DRIVER only after they accept the assigned job — the
      // same isDriverChatAvailable rule the app uses. Admin/client
      // posting is unaffected; the closing-status read-only lock below
      // stays the other end of the lifecycle.
      if (req.session!.role === "driver" && req.shipment && !isDriverChatAvailable(req.shipment.status)) {
        return res.status(403).json({ error: "Shipment chat becomes available after you accept the assigned job." });
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
      // Chat-unread scalability follow-up: resolveAllAdminIds() (the admin
      // roster planUnreadFanout needs below) is independent of the
      // shipment lookup — started here so both reads run concurrently
      // instead of adding a second full round-trip to every message send.
      // The `.catch(() => {})` only silences Node's "unhandled rejection"
      // warning for the (rare) 404-shipment path below, which returns
      // before ever awaiting the real `allAdminIdsPromise` reference — it
      // does not swallow the rejection for that later `await`, which still
      // throws normally into this route's own try/catch.
      const allAdminIdsPromise = resolveAllAdminIds();
      allAdminIdsPromise.catch(() => {});
      const sDoc = await getDoc(sDocRef);
      if (!sDoc.exists()) {
        return res.status(404).json({ error: "Shipment not found" });
      }
      const shipmentItem = sDoc.data() as Shipment;

      // PR #111 review (Delivered/Closed terminal & chat rules): "Closed"
      // (Land) / "Completed" (Sea/Air — see isShipmentClosed,
      // shipmentStatusTransitions.ts) is the only status that locks
      // shipment communication. Reaching "Delivered" must NOT close chat —
      // Admin/Driver still routinely exchange CMR/POD corrections, final
      // remarks, and payment follow-up after delivery — so this checks the
      // freight-mode-appropriate closing status specifically, not any
      // "finished/terminal-looking" status. Rejected before any message,
      // unread-fanout record, or document is created, and before any
      // notification fires — every channel (admin, driver, customer) goes
      // through this one route, so this is the single enforcement point
      // for all of them.
      if (isShipmentClosed(shipmentItem.status, shipmentItem.freightType)) {
        return res.status(409).json({
          code: "SHIPMENT_CHAT_CLOSED",
          error: "This shipment is closed. New messages and attachments can no longer be sent.",
          shipmentStatus: shipmentItem.status,
        });
      }

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

      // feature/admin-mobile-ui correction pass: only meaningful (and only
      // ever set) for admin senders — see ChatMessage.senderId and
      // src/lib/chatUnreadAccess.ts. Lets per-admin unread tracking tell
      // "my own internal_staff message" apart from "another admin's".
      if (sender === "admin") {
        newMessage.senderId = req.session!.id;
      }

      if (text !== undefined) newMessage.text = text;
      if (fileUrl !== undefined) newMessage.fileUrl = fileUrl;
      if (fileName !== undefined) newMessage.fileName = fileName;
      if (fileCategory !== undefined) newMessage.fileCategory = fileCategory;

      // Chat-unread scalability follow-up: fans this message out to a
      // maintained adminChatUnread record for every eligible admin
      // (planUnreadFanout, chatUnreadAccess.ts) in the same atomic write as
      // the message itself — see commitChatMessageWithUnreadFanout's own
      // header comment for why this can't be two independent writes.
      const allAdminIds = await allAdminIdsPromise;
      const unreadFanoutCreatedAt = new Date().toISOString();
      const unreadRecords = planUnreadFanout(allAdminIds, newMessage, unreadFanoutCreatedAt);
      await commitChatMessageWithUnreadFanout(newMessage, unreadRecords);

      // Save file inside shipment documents
      if (type === "file" && fileUrl && shouldSaveChatFileAsShipmentDocument(channel, sender)) {
        const docId = `doc-${Date.now()}`;
        const newDoc = {
          id: docId,
          shipmentId,
          name: fileName || "unnamed_document.bin",
          url: fileUrl,
          // Unified documents model: a recognizable category id (any
          // case/spacing) is stored canonically; anything else files
          // under 'other' — never an unclassifiable string.
          category: coerceDocumentCategoryForStorage(fileCategory),
          uploadedBy: senderName || (sender === "admin" ? "Admin" : sender === "client" ? "Client" : "Driver"),
          uploadedAt: new Date().toISOString(),
          // PR #46: new documents default internal-only — an admin opts one
          // into the public tracking link explicitly via the document
          // center's visibility toggle (see resolveNewDocumentSharedExternally).
          isSharedExternally: resolveNewDocumentSharedExternally()
        };

        // Shipment-update lost-update race fix (PR #111 review — over-broad
        // revision policy correction): appends to whatever the document's
        // CURRENT documents array actually is (not the earlier pre-read
        // shipmentItem), atomically. Revision-PRESERVING: the human edit
        // form's own merge (buildUpdatedShipment) never overwrites
        // `documents`, so a chat attachment must not make an unrelated,
        // already-open admin edit form 409 on its next save.
        await applyIsolatedShipmentUpdate(shipmentId, (current) => ({
          ...current,
          documents: [...current.documents, newDoc],
        }));

        // PR #111 review (post-commit response semantics re-audit): the
        // chat message (commitChatMessageWithUnreadFanout above) and the
        // document append above are both already safely committed at this
        // point — logActivity/pushNotification failing afterward must not
        // make this request falsely report "Failed to post chat message".
        const sideEffectFailures = await runShipmentUpdateSideEffects([
          {
            name: "audit-log",
            run: () => logActivity(
              shipmentId,
              shipmentItem.shipmentNumber,
              senderName || sender,
              `Uploaded document [${newDoc.name}] through Chat`,
              `Mesajlaşma paneli üzerinden [${newDoc.name}] belgesini yükledi`,
              `تحميل المستند [${newDoc.name}] من خلال المحادثة`
            ),
          },
          {
            name: "doc-upload-notification",
            run: () => pushNotification(
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
            ),
          },
        ]);
        for (const failure of sideEffectFailures) {
          console.error(
            `[chat] post-commit side effect "${failure.name}" failed for shipment ${shipmentId} — the chat message and document upload already succeeded and are not retried.`,
            failure.error
          );
        }
      } else if (type === "file" && fileUrl) {
        // internal_staff/driver_admin attachment, or a customer/client-staff
        // upload on client_admin (see shouldSaveChatFileAsShipmentDocument,
        // PR #39 / PR #62): chat-only, never saved to shipment.documents —
        // so it never reaches the customer dashboard or public share view —
        // and notified via the same channel-gated "chat" notification path
        // as a text message rather than the unfiltered "doc_upload"
        // notification.
        //
        // PR #111 review (post-commit response semantics re-audit): the
        // chat message is already committed above — a notification failure
        // here must not falsely report "Failed to post chat message".
        const sideEffectFailures = await runShipmentUpdateSideEffects([
          {
            name: "chat-notification",
            run: () => pushNotification(
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
            ),
          },
        ]);
        for (const failure of sideEffectFailures) {
          console.error(
            `[chat] post-commit side effect "${failure.name}" failed for shipment ${shipmentId} — the chat message already succeeded and is not retried.`,
            failure.error
          );
        }
      } else {
        // PR #111 review (post-commit response semantics re-audit): same
        // reasoning as the two branches above.
        const sideEffectFailures = await runShipmentUpdateSideEffects([
          {
            name: "chat-notification",
            run: () => pushNotification(
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
            ),
          },
        ]);
        for (const failure of sideEffectFailures) {
          console.error(
            `[chat] post-commit side effect "${failure.name}" failed for shipment ${shipmentId} — the chat message already succeeded and is not retried.`,
            failure.error
          );
        }
      }

      res.status(201).json(newMessage);
    } catch (err) {
      console.error(err);
      // Pre-existing gap, now more likely to actually trigger: this route
      // previously only did one write (setDoc) that could throw
      // ServiceUnavailableError under STRICT_PERSISTENCE; it now also does
      // an admin-roster read (resolveAllAdminIds) and an atomic batch write
      // (commitChatMessageWithUnreadFanout) that can throw the same way.
      // Every sibling chat route (.../chat/seen, GET /api/chat/unread)
      // already returns the retryable 503 via this same helper — this
      // route was the one place in the chat surface that still 500'd a
      // Firestore outage instead, breaking client retry/backoff logic that
      // keys off 503.
      if (respondIfServiceUnavailable(err, res)) return;
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
      const { name, url, category, uploadedBy, isSharedExternally, fileType, notes } = req.body;

      // This route skips the chat trail and files a document directly (see
      // the comment above), so it's the more direct of the two upload paths
      // a driver session can reach — the same category policy as /chat
      // applies here too: only registry categories flagged driverUploadable
      // (DOCUMENT_CATEGORY_POLICIES, src/lib/shipmentDocuments.ts) may be
      // driver-originated. An admin-published category can still be VIEWED
      // by the driver when its policy says so (isDocumentVisibleToDriver),
      // just never created by one.
      if (req.session!.role === "driver" && !canDriverUploadDocumentCategory(category)) {
        return res.status(403).json({ error: "This document category is published by MARAS Admin and cannot be uploaded by drivers." });
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
        shipmentId,
        name: name || "document.bin",
        url: url || "#",
        // Unified documents model: a recognizable category id (any
        // case/spacing) is stored canonically; anything else files under
        // 'other' — never an unclassifiable string (the old unvalidated
        // cast let arbitrary body strings straight into storage).
        category: coerceDocumentCategoryForStorage(category),
        uploadedBy: uploadedBy || "Admin",
        uploadedAt: new Date().toISOString(),
        // Optional unified-model metadata; omitted entirely when not
        // provided (Firestore rejects undefined fields in array elements).
        ...(typeof fileType === "string" && fileType.trim() ? { fileType: fileType.trim().slice(0, 120) } : {}),
        ...(typeof notes === "string" && notes.trim() ? { notes: notes.trim().slice(0, 500) } : {}),
        // PR #46: internal-only by default — see resolveNewDocumentSharedExternally.
        isSharedExternally: resolveNewDocumentSharedExternally(isSharedExternally)
      };

      // Shipment-update lost-update race fix (PR #111 review — over-broad
      // revision policy correction): appends to whatever the document's
      // CURRENT documents array actually is (not the pre-read
      // shipmentItem), atomically. Revision-PRESERVING: the human edit
      // form's own merge (buildUpdatedShipment) never overwrites
      // `documents`, so a direct document upload must not make an
      // unrelated, already-open admin edit form 409 on its next save.
      await applyIsolatedShipmentUpdate(shipmentId, (current) => ({
        ...current,
        documents: [...current.documents, newDoc],
      }));

      // PR #111 review (post-commit response semantics re-audit): the
      // document append above is already safely committed — a logActivity
      // failure afterward must not make this request falsely report
      // "Failed to upload document".
      const sideEffectFailures = await runShipmentUpdateSideEffects([
        {
          name: "audit-log",
          run: () => logActivity(
            shipmentId,
            shipmentItem.shipmentNumber,
            uploadedBy || "Admin Panel",
            `Uploaded file ${newDoc.name} in Document Center`,
            `Belge Merkezine ${newDoc.name} evrakını yükledi`,
            `تحميل ملف ${newDoc.name} في مركز المستندات للشحنة`
          ),
        },
      ]);
      for (const failure of sideEffectFailures) {
        console.error(
          `[documents] post-commit side effect "${failure.name}" failed for shipment ${shipmentId} — the document upload itself already succeeded and is not retried.`,
          failure.error
        );
      }

      res.status(201).json(newDoc);
    } catch (err) {
      if (respondIfServiceUnavailable(err, res)) return;
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

      // Shipment-update lost-update race fix (PR #111 review — over-broad
      // revision policy correction): toggles the flag on whatever the
      // document's CURRENT documents array actually is (not the pre-read
      // shipment), atomically. Revision-PRESERVING: the human edit form's
      // own merge (buildUpdatedShipment) never overwrites `documents`, so a
      // visibility toggle must not make an unrelated, already-open admin
      // edit form 409 on its next save.
      const updated = await applyIsolatedShipmentUpdate(req.params.id, (current) => ({
        ...current,
        documents: current.documents.map(d => d.id === req.params.docId ? { ...d, isSharedExternally } : d),
      }));
      const updatedDocItem = updated.documents.find(d => d.id === req.params.docId) ?? { ...docItem, isSharedExternally };

      res.json(updatedDocItem);
    } catch (err) {
      if (respondIfServiceUnavailable(err, res)) return;
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

      const { isLinkShared, shareIncludeDocuments, shareIncludePhotos } = req.body;

      // Shipment-update lost-update race fix (PR #111 review — over-broad
      // revision policy correction): applies these field changes onto
      // whatever the document's CURRENT state actually is (not the
      // pre-read shipment), atomically. Revision-PRESERVING: the human
      // edit form's own merge (buildUpdatedShipment) never overwrites
      // isLinkShared/shareIncludeDocuments/shareIncludePhotos/shareToken,
      // so a share-settings change must not make an unrelated,
      // already-open admin edit form 409 on its next save.
      const updated = await applyIsolatedShipmentUpdate(req.params.id, (current) => {
        const next: Shipment = { ...current };
        if (isLinkShared !== undefined) next.isLinkShared = isLinkShared;
        if (shareIncludeDocuments !== undefined) next.shareIncludeDocuments = shareIncludeDocuments;
        if (shareIncludePhotos !== undefined) next.shareIncludePhotos = shareIncludePhotos;

        // Migrate away from old guessable tokens, and ensure any shipment
        // that is (or becomes) shared has a strong, unguessable token. This
        // rotates legacy "token-100x" values the moment an admin touches
        // sharing.
        if (isLegacyShareToken(next.shareToken)) {
          next.shareToken = generateShareToken();
        }
        return next;
      });

      res.json(buildShipmentViewForRole(updated, req.session!));
    } catch (err) {
      if (respondIfServiceUnavailable(err, res)) return;
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
      const lookup = await findShipmentByShareToken(req.params.token);
      const shipment = resolveActiveSharedShipment(lookup, res);
      if (!shipment) return;

      res.json(buildSecureShareView(shipment));
    } catch (err) {
      if (respondIfServiceUnavailable(err, res)) return;
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
      const lookup = await findShipmentByShareToken(req.params.token);
      const shipment = resolveActiveSharedShipment(lookup, res);
      if (!shipment) return;

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
      if (respondIfServiceUnavailable(err, res)) return;
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

      const lookup = await findShipmentByShareToken(req.params.token);
      const shipment = resolveActiveSharedShipment(lookup, res);
      if (!shipment) return;

      const cleanEmail = email.trim().toLowerCase();
      const alertId = `cnh-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      // Shipment-update lost-update race fix (PR #111 review — over-broad
      // revision policy correction): appends to whatever the document's
      // CURRENT customerEmails/customerNotificationHistory actually are
      // (not the pre-read shipment), atomically. Revision-PRESERVING: the
      // human edit form's own merge (buildUpdatedShipment) never overwrites
      // these fields, so a public subscribe must not make an unrelated,
      // already-open admin edit form 409 on its next save.
      const updatedShipment = await applyIsolatedShipmentUpdate(shipment.id, (current) => {
        const customerEmails = Array.isArray(current.customerEmails) ? [...current.customerEmails] : [];
        if (!customerEmails.includes(cleanEmail)) {
          customerEmails.push(cleanEmail);
        }
        const customerNotificationHistory = Array.isArray(current.customerNotificationHistory)
          ? [...current.customerNotificationHistory]
          : [];
        customerNotificationHistory.push({
          id: alertId,
          timestamp: new Date().toISOString(),
          type: "setup",
          title: "Subscribed Successfully",
          message: `Your alert subscription for shipment #${current.shipmentNumber} has been successfully verified. You will receive real-time updates directly.`,
          email: cleanEmail,
          channel: "email",
        });
        return { ...current, customerEmails, customerNotificationHistory };
      });

      // Return the same reduced "secure view" shape the public page already
      // expects from /api/share/:token, not the full internal record.
      res.json(buildSecureShareView(updatedShipment));
    } catch (err) {
      if (respondIfServiceUnavailable(err, res)) return;
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
      //    env vars, never hardcoded. This is unrelated to how the server
      //    itself authenticates to Firestore/Storage (Application Default
      //    Credentials, see the Admin SDK init above) — this one is the
      //    actual human super-admin's app login.
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
          return res.json({
            success: true,
            token: signSessionToken(sessionPayload),
            role: "driver",
            driver: sanitizeDriver(matchedDriver)
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

        // Persist this cryptographically-verified Firebase uid onto the
        // driver's own record (additive only — never backfilled/guessed
        // anywhere else). adminAuth.verifyIdToken above already proved
        // verifiedUid is real, so this is the one trustworthy source
        // DELETE /api/drivers/:id can later use to also remove the Firebase
        // Auth identity server-side. Never blocks the login on failure.
        if (foundDriver.firebaseUid !== verifiedUid) {
          try {
            await setDoc(doc(db, "drivers", foundDriver.id), { ...foundDriver, firebaseUid: verifiedUid });
            foundDriver.firebaseUid = verifiedUid;
          } catch (persistErr) {
            console.warn("[verify-session] Failed to persist verified firebaseUid for driver:", foundDriver.id, persistErr);
          }
        }

        const sessionPayload: SessionPayload = {
          role: "driver",
          id: foundDriver.id,
          issuedAt: Date.now(),
          expiresAt: Date.now() + SESSION_TTL_MS,
        };
        return res.json({
          success: true,
          token: signSessionToken(sessionPayload),
          role: "driver",
          driver: sanitizeDriver(foundDriver)
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
        ? "This server is NOT connected to Firestore. All data (shipments, drivers, chat, everything) is being held in memory only and WILL BE PERMANENTLY LOST the next time the server restarts or redeploys. Check Application Default Credentials (gcloud auth application-default login locally, or the Cloud Run service account in production) and the Firebase config."
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

  // Apple Guideline 5.1.1(v) — the Firestore delete below is what actually
  // makes the account unusable (every login path is gated on this
  // document), so it always happens first. The driver's `firebaseUid` (see
  // Driver type / /api/verify-session — the only place it's ever written,
  // always from a cryptographically-verified adminAuth.verifyIdToken
  // result) is read BEFORE that delete, since it would otherwise be gone
  // for good afterward. Deleting the Firebase Auth user server-side via the
  // Admin SDK does not require recent login (unlike the client SDK's
  // currentUser.delete(), which the frontend also attempts independently as
  // defense in depth — see DriverApplication.tsx), so this succeeds even
  // when the client-side deletion hit auth/requires-recent-login.
  app.delete("/api/drivers/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      if (!canDeleteDriverAccount({ role: req.session!.role, id: req.session!.id, adminType: req.session!.adminType }, id)) {
        return res.status(403).json({ error: "You can only delete your own account." });
      }

      const docRef = doc(db, "drivers", id);

      let driverBeforeDelete: Driver | undefined;
      let driverLookupFailed = false;
      try {
        const existing = await getDoc(docRef);
        if (existing.exists()) {
          driverBeforeDelete = existing.data() as Driver;
        }
      } catch (lookupErr) {
        driverLookupFailed = true;
        console.warn("[DELETE /api/drivers/:id] Could not read driver record before deletion:", lookupErr);
      }

      await deleteDoc(docRef);

      // Best-effort cleanup of every push-token registration this driver
      // ever made — same ownership rule as DELETE /api/push-tokens/:token
      // (canDeletePushToken), just applied to every token matching this
      // driver id/role instead of the one token a caller happens to still
      // hold. Never broadens who can remove a token; failure here is
      // non-fatal and never blocks the account deletion itself.
      try {
        const tokensSnap = await getDocs(collection(db, "pushTokens"));
        const tokenRecords = tokensSnap.docs.map(t => ({ id: t.id, ...(t.data() as any) }));
        const tokenIdsToDelete = selectPushTokensForAccountDeletion(tokenRecords, { id, role: "driver" });
        await Promise.all(tokenIdsToDelete.map(tokenId => deleteDoc(doc(db, "pushTokens", tokenId))));
      } catch (tokenCleanupErr) {
        console.warn("[DELETE /api/drivers/:id] Push-token cleanup failed (non-fatal):", tokenCleanupErr);
      }

      // Delete the Firebase Authentication identity itself, only ever
      // against a uid this server previously verified and stored — never a
      // guess from id/email/username. "Not found" means it's already gone
      // (idempotent, not a failure); any other error must not be reported
      // as success, since Apple's guideline treats a surviving Auth
      // identity as an incomplete deletion regardless of what the client
      // separately reports.
      //
      // Review follow-up: `planServerFirebaseIdentityDeletion` is the single
      // source of truth for "did an identity exist" / "should we even try" —
      // in particular, a failed pre-delete lookup (driverLookupFailed) is
      // treated as hadFirebaseIdentity=true but shouldAttemptDeletion=false,
      // so firebaseAuthDeleted below is explicitly set to false rather than
      // defaulting to true (the exact ambiguous-default bug this replaces).
      const plan = planServerFirebaseIdentityDeletion({
        driverLookupFailed,
        driver: driverBeforeDelete,
        adminAuthAvailable: !!adminAuth,
      });

      let firebaseAuthDeleted: boolean;
      if (!plan.hadFirebaseIdentity) {
        firebaseAuthDeleted = true;
      } else if (plan.shouldAttemptDeletion) {
        firebaseAuthDeleted = true;
        try {
          await adminAuth!.deleteUser(driverBeforeDelete!.firebaseUid!);
        } catch (fbErr: any) {
          if (isFirebaseUserNotFoundError(fbErr?.code)) {
            // Already gone — nothing left to do.
          } else {
            firebaseAuthDeleted = false;
            console.error("[DELETE /api/drivers/:id] Firebase Auth user deletion failed unexpectedly:", fbErr);
          }
        }
      } else {
        // A verified identity is presumed to exist (or the lookup failed,
        // so we can't rule one out) but there was no way to actually
        // attempt the deletion (unreadable pre-delete record, or Admin
        // Auth unavailable) — must not be reported as deleted.
        firebaseAuthDeleted = false;
      }

      // Lets a later Retry (POST /api/drivers/finish-firebase-deletion)
      // resume this specific deletion using the verified uid captured
      // above — the Firestore driver record (and its firebaseUid field) is
      // already gone by the time any retry could happen. Only issued when
      // we actually have a concrete uid to retry with.
      let pendingFirebaseDeletionToken: string | undefined;
      if (!firebaseAuthDeleted && driverBeforeDelete?.firebaseUid) {
        const now = Date.now();
        pendingFirebaseDeletionToken = signPendingFirebaseIdentityDeletionToken({
          driverId: id,
          firebaseUid: driverBeforeDelete.firebaseUid,
          issuedAt: now,
          expiresAt: now + PENDING_FIREBASE_DELETION_TOKEN_TTL_MS,
        });
      }

      res.json({
        success: true,
        message: "Driver deleted successfully",
        driverRecordDeleted: true,
        hadFirebaseIdentity: plan.hadFirebaseIdentity,
        firebaseAuthDeleted,
        ...(pendingFirebaseDeletionToken ? { pendingFirebaseDeletionToken } : {}),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to delete driver" });
    }
  });

  // Review follow-up to fix/apple-driver-account-deletion: resumes a
  // Firebase Auth identity deletion that DELETE /api/drivers/:id could not
  // complete or attempt (see pendingFirebaseDeletionToken above). By the
  // time this is called, the Firestore driver record is already gone, so
  // the verified uid comes only from the signed token, never a client-
  // supplied value or a fresh Firestore lookup. requireAuth is sufficient
  // here (not a Firestore-backed driver check) because the session token
  // is independent of the now-deleted driver document.
  app.post("/api/drivers/finish-firebase-deletion", requireAuth, async (req, res) => {
    try {
      const { token } = req.body;
      if (typeof token !== "string" || !token) {
        return res.status(400).json({ success: false, error: "Missing retry token." });
      }

      const payload = verifyPendingFirebaseIdentityDeletionToken(token);
      if (!payload) {
        return res.status(400).json({
          success: false,
          error: "This retry link has expired or is invalid. Please contact support to confirm your account deletion.",
        });
      }

      if (!canDeleteDriverAccount({ role: req.session!.role, id: req.session!.id, adminType: req.session!.adminType }, payload.driverId)) {
        return res.status(403).json({ success: false, error: "You can only finish deleting your own account." });
      }

      if (!adminAuth) {
        return res.status(503).json({ success: false, error: "Firebase Admin Auth is temporarily unavailable. Please retry shortly." });
      }

      let firebaseAuthDeleted = true;
      try {
        await adminAuth.deleteUser(payload.firebaseUid);
      } catch (fbErr: any) {
        if (isFirebaseUserNotFoundError(fbErr?.code)) {
          // Already gone — nothing left to do.
        } else {
          firebaseAuthDeleted = false;
          console.error("[POST /api/drivers/finish-firebase-deletion] Firebase Auth user deletion failed unexpectedly:", fbErr);
        }
      }

      // Review follow-up: keep DELETE /api/account's own unresolved-
      // identity audit record (accountDeletionAudit/driver_<id>, only
      // ever relevant when THAT endpoint originally issued this token) in
      // sync — this is the one place that resolves it, since a later
      // idempotent retry of DELETE /api/account has no other way to learn
      // this identity is now actually gone. Best-effort: this endpoint's
      // own success/failure response above is unaffected either way.
      if (firebaseAuthDeleted) {
        try {
          await deleteDoc(doc(db, "accountDeletionAudit", `driver_${payload.driverId}`));
        } catch (auditCleanupErr) {
          console.warn("[POST /api/drivers/finish-firebase-deletion] Could not clear resolved Firebase-identity audit record (non-fatal):", auditCleanupErr);
        }
      }

      res.json({
        success: true,
        driverRecordDeleted: true,
        hadFirebaseIdentity: true,
        firebaseAuthDeleted,
        // Same token stays valid (and is handed back) until it expires, so a
        // repeated failure can keep being retried without a fresh DELETE call.
        ...(!firebaseAuthDeleted ? { pendingFirebaseDeletionToken: token } : {}),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: "Failed to finish Firebase identity deletion." });
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

  /**
   * Apple Guideline 5.1.1(v) — the one consolidated, self-service account
   * deletion endpoint for every role that can create/own an account in
   * this app (driver, client/customer, staff/admin). Identity and role
   * come ONLY from the verified session (req.session!.id / .role) — there
   * is no :id route param and no body field is ever consulted to choose
   * the delete target, so this can never be used to delete another
   * account, regardless of what a caller puts in the request body.
   *
   * This is deliberately separate from — and does not change — DELETE
   * /api/drivers/:id, DELETE /api/clients/:id, and DELETE /api/admins/:id,
   * which remain the admin-management paths for removing SOMEONE ELSE's
   * account from a roster. Reuses those routes' own already-tested
   * building blocks instead of duplicating them: selectPushTokensForAccountDeletion
   * (pushTokenAccess.ts) for push-token cleanup, and — for drivers only —
   * planServerFirebaseIdentityDeletion/hasVerifiedFirebaseUid/
   * isFirebaseUserNotFoundError/signPendingFirebaseIdentityDeletionToken
   * (driverAccountDeletion.ts / auth.ts) for the exact same Firebase Auth
   * identity cleanup + retry-token flow DELETE /api/drivers/:id already
   * uses — see that route's own comments for the full rationale, in
   * particular why the Firestore delete always happens before attempting
   * the Firebase Auth identity delete.
   *
   * Ordering, top to bottom, and why:
   *  1. Reject unknown/unsupported roles outright (defense in depth —
   *     requireAuth already guarantees SOME valid role, but only
   *     driver/client/admin are self-deletable here).
   *  2. Pre-delete lookup. Any failure OTHER than "document doesn't
   *     exist" (a genuine read error, not a clean not-found) aborts with
   *     503 rather than guessing — proceeding without being able to
   *     verify owner-protection or the stored password would be exactly
   *     the kind of security check this endpoint exists to enforce, so a
   *     flaky read must never be treated as "safe to proceed."
   *  3. Owner-protection (resolveAccountDeletionLookupOutcome) —
   *     evaluated BEFORE the "already deleted" idempotency shortcut,
   *     specifically because the env-configured root owner has no
   *     Firestore `admins` document at all (see accountDeletion.ts's own
   *     header comment): checking idempotency first would let that
   *     account's delete call report false success while doing nothing.
   *  4. Idempotent-retry shortcut: a record that's already gone (and
   *     isn't the protected owner) is reported as success without
   *     re-attempting anything destructive — a retried/duplicate call is
   *     always safe.
   *  5. Rate limit, then password confirmation (checkPasswordConfirmation
   *     — a no-op for a Google-only driver with no stored password at
   *     all; that account's "recent authentication" proof is the
   *     existing client-side Firebase reauthentication flow instead).
   *  6. The actual destructive work: delete the profile record, then
   *     best-effort (never fatal to the overall request) push-token and
   *     (admin only) notification-preference cleanup, then — driver only
   *     — the Firebase Auth identity.
   *
   * What is deliberately NOT touched: shipments, cost statements, invoices,
   * activity logs, and any other operational/accounting record. Those
   * already never embed this account's login credentials (password, email,
   * phone) — only an operational label (e.g. a shipment's cached
   * assignedDriverName, or its companyName) that remains meaningful and
   * necessary for the surviving business record (other staff at the same
   * client company continue operating against the same shipment history;
   * a completed shipment's accounting trail must still show who
   * transported it) once this account's own login is gone. Mutating those
   * documents on every account deletion would itself be the kind of
   * broad, hard-to-verify, cross-document write this task's own review
   * guidance warns against — retaining them completely unmodified is the
   * conservative, explicitly-permitted choice ("may be retained... where
   * required by law or legitimate business obligations").
   *
   * Known architecture limitation — session invalidation: this app's
   * session tokens (signSessionToken/verifySessionToken, src/lib/auth.ts)
   * are stateless, signed JWTs with no server-side revocation store —
   * attachSession/requireAuth verify a token's signature and `expiresAt`
   * only, never checking that the underlying account record still
   * exists. There is deliberately no new revocation-list feature added
   * here to close that gap: it would be a shared-authentication-
   * infrastructure change touching every route in this file, well beyond
   * this endpoint's own scope, and risks its own regressions. What DOES
   * happen instead: (1) the profile record this token's role/id resolves
   * to is genuinely gone, so every OTHER route that re-reads it (most
   * do, e.g. requireShipmentAccess) fails naturally once the token is
   * reused; (2) the client-side flow (DriverApplication.tsx,
   * ClientDashboard.tsx, AdminPanel.tsx) clears its locally stored token
   * and signs out immediately on success; (3) the token's own bounded
   * SESSION_TTL_MS is a hard upper limit on how long ANY leaked/reused
   * token — deleted account or not — remains cryptographically valid at
   * all. A deleted account's token is therefore inert in practice well
   * before natural expiry, not hard-invalidated the instant this request
   * returns.
   */
  app.delete("/api/account", requireAuth, async (req, res) => {
    try {
      const session = req.session!;
      if (!isSelfDeletableRole(session.role)) {
        return res.status(403).json({ error: "This account type cannot be deleted through the app." });
      }
      const role: SelfDeletableRole = session.role;
      const collectionName = resolveAccountCollectionName(role);
      const docRef = doc(db, collectionName, session.id);

      let existingSnap: Awaited<ReturnType<typeof getDoc>>;
      try {
        existingSnap = await getDoc(docRef);
      } catch (lookupErr) {
        if (lookupErr instanceof ServiceUnavailableError) throw lookupErr;
        console.error("[DELETE /api/account] Could not verify account record before deletion:", lookupErr);
        throw new ServiceUnavailableError("Could not verify your account. Please try again.");
      }

      const ownerEmail = (process.env.SUPER_ADMIN_EMAIL || "sardar@maras.iq").toLowerCase();
      const recordExists = existingSnap.exists();
      const existingRecord = recordExists ? (existingSnap.data() as any) : null;

      const lookupOutcome = resolveAccountDeletionLookupOutcome({
        role,
        sessionId: session.id,
        recordExists,
        existingRecord,
        ownerEmail,
      });

      if (lookupOutcome.ownerProtected) {
        return res.status(403).json({
          error: "This account is the platform's sole owner identity and cannot be deleted through the app. Every other account type can be deleted here in full.",
          ownerProtected: true,
        });
      }

      // Best-effort push-token cleanup — shared by both the idempotent
      // "already deleted" path below and the real-deletion path further
      // down, since a prior call could have deleted the profile record
      // but failed partway through this step.
      const cleanupPushTokens = async () => {
        try {
          const tokensSnap = await getDocs(collection(db, "pushTokens"));
          const tokenRecords = tokensSnap.docs.map(t => ({ id: t.id, ...(t.data() as any) }));
          const tokenIdsToDelete = selectPushTokensForAccountDeletion(tokenRecords, { id: session.id, role });
          await Promise.all(tokenIdsToDelete.map(tokenId => deleteDoc(doc(db, "pushTokens", tokenId))));
        } catch (tokenCleanupErr) {
          console.warn("[DELETE /api/account] Push-token cleanup failed (non-fatal):", tokenCleanupErr);
        }
      };

      // Review follow-up: admin-only, so also shared between both paths
      // below for the same reason as cleanupPushTokens — a prior call
      // could have deleted the admins/ profile record via THIS route (or
      // via the separate admin-management DELETE /api/admins/:id, which
      // never cleans this up at all) without this step ever completing.
      const cleanupAdminNotificationPreferences = async () => {
        if (role !== "admin") return;
        try {
          await deleteDoc(doc(db, "adminNotificationPreferences", session.id));
        } catch (prefCleanupErr) {
          console.warn("[DELETE /api/account] Notification-preference cleanup failed (non-fatal):", prefCleanupErr);
        }
      };

      // Review follow-up: durable record of an UNRESOLVED driver Firebase
      // Auth identity deletion — see the write site below for the full
      // rationale. Doc id is role-prefixed defensively (only ever written
      // for role: "driver", but keeps this collection's key scheme
      // unambiguous if a future role ever needed the same tracking).
      const firebaseDeletionAuditRef = doc(db, "accountDeletionAudit", `driver_${session.id}`);

      if (lookupOutcome.alreadyDeleted) {
        await cleanupPushTokens();
        await cleanupAdminNotificationPreferences();

        let hadFirebaseIdentity = false;
        let firebaseAuthDeleted = true;
        let pendingFirebaseDeletionToken: string | undefined;

        if (role === "driver") {
          // Review follow-up (critical): the Firestore driver record is
          // already gone on this idempotent-retry path, so there is no
          // `firebaseUid` field left to re-derive an answer from — without
          // this audit lookup, this branch used to unconditionally claim
          // `firebaseAuthDeleted: true`, which is only actually true for
          // the common case (the first call's Firebase step also
          // succeeded). If that first call's Firebase step instead failed
          // or was never attempted (adminAuth down, a transient
          // deleteUser() error) and the client then lost its
          // pendingFirebaseDeletionToken (app killed/restarted) before
          // ever retrying via POST /api/drivers/finish-firebase-deletion,
          // a naive retry of THIS endpoint would falsely report the
          // Firebase Auth identity as deleted — exactly the "surviving
          // Auth identity reported as complete deletion" failure this
          // whole feature exists to prevent. The audit doc (written below,
          // only when unresolved) is this endpoint's only way to answer
          // honestly here; its absence is real proof of "nothing left
          // unresolved," not just an assumption.
          try {
            const auditSnap = await getDoc(firebaseDeletionAuditRef);
            if (auditSnap.exists()) {
              const audit = auditSnap.data() as { firebaseUid?: string };
              hadFirebaseIdentity = true;
              firebaseAuthDeleted = false;
              if (audit.firebaseUid) {
                const now = Date.now();
                pendingFirebaseDeletionToken = signPendingFirebaseIdentityDeletionToken({
                  driverId: session.id,
                  firebaseUid: audit.firebaseUid,
                  issuedAt: now,
                  expiresAt: now + PENDING_FIREBASE_DELETION_TOKEN_TTL_MS,
                });
              }
            }
          } catch (auditLookupErr) {
            if (auditLookupErr instanceof ServiceUnavailableError) throw auditLookupErr;
            // Conservative: an unreadable audit record must never be
            // treated as "confirmed nothing left to do" — same principle
            // as planServerFirebaseIdentityDeletion's own driverLookupFailed
            // handling.
            console.warn("[DELETE /api/account] Could not verify prior Firebase-identity deletion audit (assuming unresolved):", auditLookupErr);
            hadFirebaseIdentity = true;
            firebaseAuthDeleted = false;
          }
        }

        return res.json({
          success: true,
          accountRecordDeleted: true,
          hadFirebaseIdentity,
          firebaseAuthDeleted,
          ...(pendingFirebaseDeletionToken ? { pendingFirebaseDeletionToken } : {}),
        });
      }

      const rateLimit = checkAccountDeletionRateLimit(session.id);
      if (!rateLimit.allowed) {
        res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds || 0));
        return res.status(429).json({
          error: `Too many attempts. Please try again in ${Math.ceil((rateLimit.retryAfterSeconds || 0) / 60)} minute(s).`,
        });
      }

      const passwordCheck = checkPasswordConfirmation(role, existingRecord, req.body?.currentPassword, verifyPassword);
      if (!passwordCheck.ok) {
        if (passwordCheck.status === 400) {
          return res.status(400).json({ error: "Your current password is required to delete your account." });
        }
        return res.status(401).json({ error: "Current password is incorrect." });
      }
      clearAccountDeletionRateLimit(session.id);

      await deleteDoc(docRef);
      await cleanupPushTokens();
      await cleanupAdminNotificationPreferences();

      let hadFirebaseIdentity = false;
      let firebaseAuthDeleted = true;
      let pendingFirebaseDeletionToken: string | undefined;

      if (role === "driver") {
        // Same planning/attempt logic as DELETE /api/drivers/:id — see
        // that route's own comments. driverLookupFailed is always false
        // here because a failed pre-delete lookup already aborted this
        // request with 503 above, before reaching this point.
        const plan = planServerFirebaseIdentityDeletion({
          driverLookupFailed: false,
          driver: existingRecord,
          adminAuthAvailable: !!adminAuth,
        });
        hadFirebaseIdentity = plan.hadFirebaseIdentity;

        if (!plan.hadFirebaseIdentity) {
          firebaseAuthDeleted = true;
        } else if (plan.shouldAttemptDeletion) {
          firebaseAuthDeleted = true;
          try {
            await adminAuth!.deleteUser(existingRecord.firebaseUid);
          } catch (fbErr: any) {
            if (isFirebaseUserNotFoundError(fbErr?.code)) {
              // Already gone — nothing left to do.
            } else {
              firebaseAuthDeleted = false;
              console.error("[DELETE /api/account] Firebase Auth user deletion failed unexpectedly:", fbErr);
            }
          }
        } else {
          firebaseAuthDeleted = false;
        }

        if (!firebaseAuthDeleted && existingRecord?.firebaseUid) {
          const now = Date.now();
          pendingFirebaseDeletionToken = signPendingFirebaseIdentityDeletionToken({
            driverId: session.id,
            firebaseUid: existingRecord.firebaseUid,
            issuedAt: now,
            expiresAt: now + PENDING_FIREBASE_DELETION_TOKEN_TTL_MS,
          });
          // Durably record the unresolved state — see the idempotent-retry
          // branch above for why this is what makes a later retry honest
          // instead of falsely claiming success. Best-effort: if this
          // write itself fails, the caller still gets today's real
          // pendingFirebaseDeletionToken above and can finish via
          // POST /api/drivers/finish-firebase-deletion immediately: only a
          // LATER retry of this endpoint (after losing that token) would
          // be affected, an already-degraded edge case.
          try {
            await setDoc(firebaseDeletionAuditRef, {
              id: `driver_${session.id}`,
              driverId: session.id,
              firebaseUid: existingRecord.firebaseUid,
              hadFirebaseIdentity: true,
              firebaseAuthDeleted: false,
              updatedAt: new Date().toISOString(),
            });
          } catch (auditWriteErr) {
            console.warn("[DELETE /api/account] Could not persist unresolved-Firebase-identity audit record (non-fatal):", auditWriteErr);
          }
        } else if (firebaseAuthDeleted) {
          // Fully resolved (or there was never an identity to begin with)
          // — clear any stale audit record a PREVIOUS failed attempt may
          // have left behind, so a future idempotent retry doesn't
          // needlessly report this as still-unresolved.
          try {
            await deleteDoc(firebaseDeletionAuditRef);
          } catch (auditCleanupErr) {
            console.warn("[DELETE /api/account] Could not clear resolved Firebase-identity audit record (non-fatal):", auditCleanupErr);
          }
        }
      }

      res.json({
        success: true,
        accountRecordDeleted: true,
        hadFirebaseIdentity,
        firebaseAuthDeleted,
        ...(pendingFirebaseDeletionToken ? { pendingFirebaseDeletionToken } : {}),
      });
    } catch (err) {
      console.error(err);
      if (respondIfServiceUnavailable(err, res)) return;
      res.status(500).json({ error: "Failed to delete account." });
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
      res.status(201).json({
        ...sanitizeDriver(newDriver),
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
   * isn't cryptographically verified against a Firebase ID token here (see
   * adminAuth.verifyIdToken usage on /api/verify-session for where that
   * verification does happen elsewhere in this file), but this endpoint can
   * only ever create a driver record, never read or modify anyone else's
   * data, which bounds the impact of that residual gap.
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

      res.status(201).json({
        ...sanitizeDriver(newDriver),
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
            `تمت الموافقة على ${driverData.name} ويمكنه الآن تسجيل الدخول.`,
            // Notification Phase 1 fix: this notification has no shipment
            // (a driver isn't necessarily assigned to one yet at approval
            // time), so it previously reached admins only — the approved
            // driver themself never got the push or the in-app
            // notification, since GET /api/notifications' driver branch
            // filters strictly by shipmentId. recipientUserId targets this
            // specific driver directly, independent of any shipment.
            undefined,
            undefined,
            driverData.id
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
      const { name, username, email, truckNumber, phone, truckType, latitude, longitude, lastUpdated, avatarUrl, workingRoutes, allianceInactive, availableForOffers } = req.body;

      // Driver Alliance Phase 1: working routes and the alliance
      // Inactive switch are ADMIN-managed fields. A driver session
      // writing them is rejected outright (never silently ignored) —
      // matching happens server-side off these fields, so letting a
      // driver edit their own routes would let them steer which offers
      // they receive. availableForOffers is deliberately NOT in this
      // guard: it is the driver's OWN "Available for Offers" switch (the
      // own-profile check above already scopes it to their own record).
      if (req.session!.role === "driver" && (workingRoutes !== undefined || allianceInactive !== undefined)) {
        return res.status(403).json({ error: "Working routes and availability status are managed by MARAS Operations." });
      }
      if (availableForOffers !== undefined && typeof availableForOffers !== "boolean") {
        return res.status(400).json({ error: "availableForOffers must be true or false." });
      }
      let sanitizedRoutes: DriverRoute[] | undefined;
      if (workingRoutes !== undefined) {
        const routeResult = sanitizeWorkingRoutes(workingRoutes);
        if (!routeResult.ok) {
          return res.status(400).json({ error: routeResult.error });
        }
        sanitizedRoutes = routeResult.routes;
      }
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
      if (sanitizedRoutes !== undefined) updatedDriver.workingRoutes = sanitizedRoutes;
      if (allianceInactive !== undefined) updatedDriver.allianceInactive = allianceInactive === true;
      if (availableForOffers !== undefined) updatedDriver.availableForOffers = availableForOffers;

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

      res.json(sanitizeDriver(updatedDriver));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update driver" });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // Driver Alliance Phase 1 — /api/alliance/offers routes.
  //
  // A controlled internal freight-offer system, NOT an auction: Super/
  // Operations admins create an offer, broadcast it to automatically
  // matched Available drivers (route + truck type, never a driver with
  // an active job), each invited driver privately quotes one USD price
  // or rejects, and Operations selects exactly ONE winner — which flows
  // into the EXISTING shipment workflow (createShipmentRecord /
  // applyNarrowShipmentUpdate + the one-active-job lock). Every rule is
  // enforced here server-side; the UI merely mirrors them. Drivers only
  // ever see their own offers/responses (buildDriverOfferView).
  // ═══════════════════════════════════════════════════════════════════

  /** Dual-mode (Firestore / memory-fallback) equality query on an alliance collection. */
  async function fetchAllianceDocs<T>(colName: "allianceOffers" | "allianceOfferResponses", field: string, value: string): Promise<T[]> {
    if (useMemoryFallback || !db) {
      if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
      return (getMemoryStore()[colName] as any[]).filter((d) => d[field] === value) as T[];
    }
    try {
      const q: FirebaseFirestore.Query = db.collection(colName).where(field, "==", value);
      const snapshot: FirebaseFirestore.QuerySnapshot = await withTimeout(q.get(), 5000, "Firestore alliance query timed out");
      return snapshot.docs.map((d) => d.data() as T);
    } catch (error) {
      console.warn("Firestore alliance query failed or timed out. Switching to robust Memory Fallback.", error);
      useMemoryFallback = true;
      scheduleFirestoreRecovery(30_000);
      if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
      return (getMemoryStore()[colName] as any[]).filter((d) => d[field] === value) as T[];
    }
  }

  async function loadAllianceOffer(offerId: string): Promise<AllianceOffer | null> {
    const snap = await getDoc(doc(db, "allianceOffers", offerId));
    return snap.exists() ? (snap.data() as AllianceOffer) : null;
  }

  /**
   * Transactionally applies a driver's one-and-only answer to their own
   * response document. The (offerId, driverId) natural key plus this
   * transaction guarantee a double-tap or two concurrent submissions can
   * never record two answers or overwrite an existing one (the second
   * request is rejected with ALREADY_RESPONDED). Memory fallback uses a
   * synchronous check-and-set — atomic under Node's single-threaded
   * event loop, same reasoning as the driver active-job lock.
   */
  async function submitAllianceResponseOnce(
    offerId: string,
    driverId: string,
    mutate: (current: AllianceOfferResponse) => AllianceOfferResponse
  ): Promise<AllianceOfferResponse> {
    const responseId = allianceResponseId(offerId, driverId);
    if (useMemoryFallback || !db) {
      if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
      const store = getMemoryStore().allianceOfferResponses;
      const idx = store.findIndex((r) => r.id === responseId);
      if (idx === -1) throw new AllianceRejectionError(403, "You were not invited to this offer.");
      if (!canSubmitResponse(store[idx].status)) {
        throw new AllianceRejectionError(409, "You have already answered this offer.", "ALREADY_RESPONDED");
      }
      store[idx] = mutate(store[idx]);
      return store[idx];
    }
    const ref = db.collection("allianceOfferResponses").doc(responseId);
    try {
      return await withTimeout(
        db.runTransaction(async (tx: any) => {
          const snap = await tx.get(ref);
          if (!snap.exists) throw new AllianceRejectionError(403, "You were not invited to this offer.");
          const current = snap.data() as AllianceOfferResponse;
          if (!canSubmitResponse(current.status)) {
            throw new AllianceRejectionError(409, "You have already answered this offer.", "ALREADY_RESPONDED");
          }
          const next = mutate(current);
          tx.set(ref, cleanUndefined(next));
          return next;
        }),
        5000,
        "Firestore alliance response transaction timed out"
      );
    } catch (error) {
      if (error instanceof AllianceRejectionError) throw error;
      console.warn("Firestore alliance response transaction failed or timed out. Switching to robust Memory Fallback.", error);
      useMemoryFallback = true;
      scheduleFirestoreRecovery(30_000);
      if (STRICT_PERSISTENCE) throw new ServiceUnavailableError();
      return submitAllianceResponseOnce(offerId, driverId, mutate);
    }
  }

  function allianceActorName(req: express.Request): string {
    const fromBody = typeof req.body?.actorName === "string" ? req.body.actorName.trim() : "";
    return fromBody || req.session!.id;
  }

  // Create Offer (Super/Operations only — requireFullAdmin rejects
  // Accounts admins and every non-admin role with 403).
  app.post("/api/alliance/offers", requireFullAdmin, async (req, res) => {
    try {
      const input = validateAllianceOfferInput(req.body);
      if (!input.ok || !input.input) {
        return res.status(400).json({ error: input.error });
      }
      // Order-linking rule: EVERY quote request belongs to exactly one
      // existing MARAS Order (a Shipment record) carrying the one
      // official MAR reference. The Order is the source of truth — all
      // operational fields below are derived from it, never typed into
      // the alliance separately. No alliance action ever mints a number.
      const orderSnap = await getDoc(doc(db, "shipments", input.input.orderId));
      if (!orderSnap.exists()) {
        return res.status(400).json({ error: "Linked Order not found. Select an existing Order or create one first." });
      }
      const order = orderSnap.data() as Shipment;
      if (!isValidMarReference(order.shipmentNumber)) {
        return res.status(400).json({ error: "The linked Order has no valid MAR reference." });
      }
      if (order.assignedDriverId) {
        return res.status(400).json({ error: "The linked Order already has an assigned driver." });
      }
      if (isShipmentClosed(order.status, order.freightType)) {
        return res.status(400).json({ error: "The linked Order is already closed." });
      }
      if (order.status === "Waiting for Driver Quotes") {
        return res.status(400).json({ error: "The linked Order already has an open quote request. Cancel it before sending a new one." });
      }
      const nowIso = new Date().toISOString();
      const offer: AllianceOffer = {
        id: `aoffer-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        status: "draft",
        truckType: input.input.truckType,
        expiresInHours: input.input.expiresInHours,
        notes: input.input.notes,
        currency: input.input.currency,
        ...buildOfferFromOrder(order),
        createdById: req.session!.id,
        createdByName: allianceActorName(req),
        createdAt: nowIso,
        updatedAt: nowIso,
        invitedDriverIds: [],
      };
      await setDoc(doc(db, "allianceOffers", offer.id), cleanUndefined(offer));
      await logAllianceAudit("offer_created", { offerId: offer.id }, { userId: req.session!.id, userName: allianceActorName(req) });
      res.status(201).json(offer);
    } catch (err) {
      if (respondIfServiceUnavailable(err, res)) return;
      console.error(err);
      res.status(500).json({ error: "Failed to create offer" });
    }
  });

  // List Offers. Admins (Super/Operations): all offers. Drivers: ONLY
  // offers they were invited to, in sanitized form. Everyone else: 403.
  app.get("/api/alliance/offers", requireAuth, async (req, res) => {
    try {
      if (req.session!.role === "driver") {
        const driverId = req.session!.id;
        const responses = await fetchAllianceDocs<AllianceOfferResponse>("allianceOfferResponses", "driverId", driverId);
        const views = [];
        for (const response of responses) {
          const offer = await loadAllianceOffer(response.offerId);
          if (offer) views.push(buildDriverOfferView(offer, response));
        }
        views.sort((a, b) => (b.broadcastAt || "").localeCompare(a.broadcastAt || ""));
        return res.json({ items: views });
      }
      if (req.session!.role === "admin" && (req.session!.adminType === "super" || req.session!.adminType === "operation")) {
        const snap = await getDocs(collection(db, "allianceOffers"));
        // One grouped read of ALL responses so each list row can show
        // its Waiting/Quoted/Rejected counts without N queries.
        const respSnap = await getDocs(collection(db, "allianceOfferResponses"));
        const responsesByOffer = new Map<string, AllianceOfferResponse[]>();
        for (const rDoc of respSnap.docs) {
          const r = rDoc.data() as AllianceOfferResponse;
          const list = responsesByOffer.get(r.offerId) || [];
          list.push(r);
          responsesByOffer.set(r.offerId, list);
        }
        // Expiry is derived at read time (no scheduler): a broadcast
        // offer past expiresAt is reported as "expired".
        const offers = snap.docs.map((d: any) => {
          const o = d.data() as AllianceOffer;
          return {
            ...o,
            status: resolveOfferStatus(o),
            responseSummary: summarizeResponses(responsesByOffer.get(o.id) || []),
          };
        });
        offers.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
        return res.json({ items: offers.slice(0, 200) });
      }
      return res.status(403).json({ error: "You do not have permission to view Driver Alliance offers." });
    } catch (err) {
      if (respondIfServiceUnavailable(err, res)) return;
      console.error(err);
      res.status(500).json({ error: "Failed to load offers" });
    }
  });

  // Offer detail. Admin (Super/Operations): full offer + all responses.
  // Driver: sanitized own view only.
  app.get("/api/alliance/offers/:id", requireAuth, async (req, res) => {
    try {
      const offer = await loadAllianceOffer(req.params.id);
      if (!offer) return res.status(404).json({ error: "Offer not found" });
      if (req.session!.role === "driver") {
        const respSnap = await getDoc(doc(db, "allianceOfferResponses", allianceResponseId(offer.id, req.session!.id)));
        if (!respSnap.exists()) {
          return res.status(403).json({ error: "Drivers only see their own offers." });
        }
        return res.json(buildDriverOfferView(offer, respSnap.data() as AllianceOfferResponse));
      }
      if (req.session!.role === "admin" && (req.session!.adminType === "super" || req.session!.adminType === "operation")) {
        const responses = await fetchAllianceDocs<AllianceOfferResponse>("allianceOfferResponses", "offerId", offer.id);
        responses.sort((a, b) => (a.invitedAt || "").localeCompare(b.invitedAt || ""));
        return res.json({ offer: { ...offer, status: resolveOfferStatus(offer) }, responses });
      }
      return res.status(403).json({ error: "You do not have permission to view Driver Alliance offers." });
    } catch (err) {
      if (respondIfServiceUnavailable(err, res)) return;
      console.error(err);
      res.status(500).json({ error: "Failed to load offer" });
    }
  });

  // Broadcast: automatic matching (route + truck type + Available) and
  // invitation fan-out. A driver with an active job is NEVER invited.
  app.post("/api/alliance/offers/:id/broadcast", requireFullAdmin, async (req, res) => {
    try {
      const offer = await loadAllianceOffer(req.params.id);
      if (!offer) return res.status(404).json({ error: "Offer not found" });
      if (!canBroadcastOffer(offer.status)) {
        return res.status(409).json({ error: "Only a draft offer can be broadcast." });
      }

      const driversSnap = await getDocs(collection(db, "drivers"));
      const drivers = driversSnap.docs.map((d: any) => d.data() as Driver);
      const shipmentsSnap = await getDocs(collection(db, "shipments"));
      const busyDriverIds = computeBusyDriverIds(shipmentsSnap.docs.map((d: any) => d.data() as Shipment));
      const matched = matchDriversForOffer(drivers, offer, busyDriverIds);
      if (matched.length === 0) {
        return res.status(409).json({
          code: "NO_MATCHING_DRIVERS",
          error: "No available drivers match this Order's route and truck type. Adjust driver routes/availability and try again.",
        });
      }

      const nowIso = new Date().toISOString();
      const updatedOffer: AllianceOffer = {
        ...offer,
        status: "broadcast",
        broadcastAt: nowIso,
        // The quotation window opens now: expiry counts from broadcast,
        // not creation (a draft can sit for days without burning time).
        expiresAt: computeOfferExpiresAt(nowIso, offer.expiresInHours || 24),
        updatedAt: nowIso,
        invitedDriverIds: matched.map((d) => d.id),
      };
      await setDoc(doc(db, "allianceOffers", offer.id), cleanUndefined(updatedOffer));

      for (const driver of matched) {
        const response: AllianceOfferResponse = {
          id: allianceResponseId(offer.id, driver.id),
          offerId: offer.id,
          driverId: driver.id,
          driverName: driver.name,
          status: "invited",
          invitedAt: nowIso,
        };
        await setDoc(doc(db, "allianceOfferResponses", response.id), response);
        await pushNotification(
          "", "",
          "alliance_offer",
          "New Transport Offer",
          "Yeni Taşıma Teklifi",
          "عرض نقل جديد",
          `MARAS is requesting a price for ${offer.pickupCity}, ${offer.pickupCountry} → ${offer.deliveryCity}, ${offer.deliveryCountry}. Open the app to quote.`,
          `MARAS, ${offer.pickupCity}, ${offer.pickupCountry} → ${offer.deliveryCity}, ${offer.deliveryCountry} için fiyat istiyor. Teklif vermek için uygulamayı açın.`,
          `تطلب MARAS سعراً للنقل من ${offer.pickupCity}، ${offer.pickupCountry} إلى ${offer.deliveryCity}، ${offer.deliveryCountry}. افتح التطبيق لتقديم سعرك.`,
          undefined,
          undefined,
          driver.id
        );
      }

      // Order lifecycle: broadcasting moves the linked Order from "New"
      // (Draft) into the alliance-controlled "Waiting for Driver Quotes"
      // stage. Same MAR reference, same record — only the status moves.
      // Guarded to "New" so a re-broadcast/edge case can never yank an
      // already-assigned or in-progress Order backward.
      if (updatedOffer.referenceShipmentId) {
        try {
          await applyNarrowShipmentUpdate(updatedOffer.referenceShipmentId, (current) => {
            if (current.status !== "New" || current.assignedDriverId) return current;
            return {
              ...current,
              status: "Waiting for Driver Quotes" as ShipmentStatus,
              timeline: [
                ...current.timeline,
                {
                  timestamp: nowIso,
                  status: "Waiting for Driver Quotes" as ShipmentStatus,
                  labelEn: "Waiting for Driver Quotes",
                  labelTr: "Sürücü Teklifleri Bekleniyor",
                  labelAr: "بانتظار عروض أسعار السائقين",
                  detailsEn: `Driver Alliance quote request sent to ${matched.length} matching driver(s).`,
                  detailsTr: `Driver Alliance fiyat talebi ${matched.length} uygun sürücüye gönderildi.`,
                  detailsAr: `تم إرسال طلب تسعير تحالف السائقين إلى ${matched.length} سائق مطابق.`,
                },
              ],
              updatedAt: nowIso,
            };
          });
        } catch (orderErr) {
          // The broadcast itself succeeded; a failed status stamp must not
          // undo it. The Order simply stays at "New" (a legal state).
          console.error("[alliance] failed to mark linked order as Waiting for Driver Quotes:", orderErr);
        }
      }

      await logAllianceAudit("offer_broadcast", { offerId: offer.id }, { userId: req.session!.id, userName: allianceActorName(req) });
      res.json({ offer: updatedOffer, invitedCount: matched.length });
    } catch (err) {
      if (respondIfServiceUnavailable(err, res)) return;
      console.error(err);
      res.status(500).json({ error: "Failed to broadcast offer" });
    }
  });

  // Driver marks the offer as seen (audited; idempotent).
  app.post("/api/alliance/offers/:id/viewed", requireAuth, async (req, res) => {
    try {
      if (req.session!.role !== "driver") {
        return res.status(403).json({ error: "Only drivers can mark an offer as viewed." });
      }
      const driverId = req.session!.id;
      const respRef = doc(db, "allianceOfferResponses", allianceResponseId(req.params.id, driverId));
      const respSnap = await getDoc(respRef);
      if (!respSnap.exists()) {
        return res.status(403).json({ error: "You were not invited to this offer." });
      }
      const response = respSnap.data() as AllianceOfferResponse;
      if (!response.viewedAt) {
        const updated: AllianceOfferResponse = {
          ...response,
          viewedAt: new Date().toISOString(),
          status: response.status === "invited" ? "viewed" : response.status,
        };
        await setDoc(respRef, cleanUndefined(updated));
        await logAllianceAudit("offer_viewed", { offerId: req.params.id, driverId }, { userId: driverId, userName: response.driverName });
        return res.json(updated);
      }
      res.json(response);
    } catch (err) {
      if (respondIfServiceUnavailable(err, res)) return;
      console.error(err);
      res.status(500).json({ error: "Failed to record view" });
    }
  });

  // Driver answers: EITHER a single USD quote (optional note) OR a
  // rejection. Nothing else — no chat, no bidding, no renegotiation; a
  // recorded answer can never be changed (ALREADY_RESPONDED).
  app.post("/api/alliance/offers/:id/respond", requireAuth, async (req, res) => {
    try {
      if (req.session!.role !== "driver") {
        return res.status(403).json({ error: "Only invited drivers can answer an offer." });
      }
      const driverId = req.session!.id;
      const offer = await loadAllianceOffer(req.params.id);
      if (!offer) return res.status(404).json({ error: "Offer not found" });
      if (!canDriverRespondToOffer(offer.status)) {
        return res.status(409).json({ code: "OFFER_NOT_OPEN", error: "This offer is no longer open for answers." });
      }
      // Expiration: once the quotation window closes, no more answers —
      // enforced here regardless of what the driver's UI showed.
      if (isOfferExpired(offer)) {
        return res.status(409).json({ code: "OFFER_EXPIRED", error: "This offer has expired. Quotations can no longer be submitted." });
      }

      const action = req.body?.action;
      const nowIso = new Date().toISOString();
      let priceUsd: number | undefined;
      let note: string | undefined;
      let rejectReason: string | undefined;
      if (action === "quote") {
        const price = validateQuotePriceUsd(req.body?.priceUsd, req.body?.currency);
        if (!price.ok) return res.status(400).json({ error: price.error });
        priceUsd = price.priceUsd;
        note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) : undefined;
        if (note === "") note = undefined;
      } else if (action === "reject") {
        rejectReason = typeof req.body?.rejectReason === "string" ? req.body.rejectReason.trim().slice(0, 500) : undefined;
        if (rejectReason === "") rejectReason = undefined;
      } else {
        return res.status(400).json({ error: "action must be either \"quote\" or \"reject\"." });
      }

      const updated = await submitAllianceResponseOnce(offer.id, driverId, (current) => ({
        ...current,
        status: action === "quote" ? "quoted" : "rejected",
        priceUsd,
        note,
        rejectReason,
        respondedAt: nowIso,
        viewedAt: current.viewedAt || nowIso,
      }));

      if (action === "quote") {
        await logAllianceAudit("price_submitted", { offerId: offer.id, driverId }, { userId: driverId, userName: updated.driverName });
        await pushNotification(
          "", "",
          "alliance_update",
          "Alliance Price Submitted",
          "İttifak Fiyatı Gönderildi",
          "تم تقديم سعر التحالف",
          `${updated.driverName} quoted ${priceUsd} USD for ${offer.pickupCity} → ${offer.deliveryCity}.`,
          `${updated.driverName}, ${offer.pickupCity} → ${offer.deliveryCity} için ${priceUsd} USD teklif verdi.`,
          `قدّم ${updated.driverName} سعر ${priceUsd} دولار للنقل ${offer.pickupCity} → ${offer.deliveryCity}.`,
          driverId
        );
      } else {
        await logAllianceAudit("offer_rejected", { offerId: offer.id, driverId }, { userId: driverId, userName: updated.driverName });
        await pushNotification(
          "", "",
          "alliance_update",
          "Alliance Offer Rejected",
          "İttifak Teklifi Reddedildi",
          "تم رفض عرض التحالف",
          `${updated.driverName} declined the offer ${offer.pickupCity} → ${offer.deliveryCity}.${rejectReason ? ` Reason: ${rejectReason}` : ""}`,
          `${updated.driverName}, ${offer.pickupCity} → ${offer.deliveryCity} teklifini reddetti.${rejectReason ? ` Neden: ${rejectReason}` : ""}`,
          `رفض ${updated.driverName} عرض النقل ${offer.pickupCity} → ${offer.deliveryCity}.${rejectReason ? ` السبب: ${rejectReason}` : ""}`,
          driverId
        );
      }

      res.json(buildDriverOfferView({ ...offer }, updated));
    } catch (err) {
      if (err instanceof AllianceRejectionError) {
        return res.status(err.httpStatus).json({ ...(err.code ? { code: err.code } : {}), error: err.message });
      }
      if (respondIfServiceUnavailable(err, res)) return;
      console.error(err);
      res.status(500).json({ error: "Failed to record your answer" });
    }
  });

  // Winner selection: exactly ONE driver, who must have quoted. The
  // selected offer becomes an assigned shipment through the EXISTING
  // workflow: createShipmentRecord (the extracted POST /api/shipments
  // logic) for standalone offers, or assignment of the referenced
  // shipment. Both paths claim the one-active-job lock — a winner who
  // meanwhile got another active shipment is rejected (409 DRIVER_BUSY).
  app.post("/api/alliance/offers/:id/select-winner", requireFullAdmin, async (req, res) => {
    try {
      const offer = await loadAllianceOffer(req.params.id);
      if (!offer) return res.status(404).json({ error: "Offer not found" });
      if (!canSelectWinner(offer.status)) {
        return res.status(409).json({ error: "A winner can only be selected while the offer is open." });
      }
      const driverId = typeof req.body?.driverId === "string" ? req.body.driverId : "";
      if (!driverId) return res.status(400).json({ error: "driverId is required." });

      const respSnap = await getDoc(doc(db, "allianceOfferResponses", allianceResponseId(offer.id, driverId)));
      if (!respSnap.exists()) return res.status(400).json({ error: "That driver was not invited to this offer." });
      const response = respSnap.data() as AllianceOfferResponse;
      if (response.status !== "quoted" || typeof response.priceUsd !== "number") {
        return res.status(400).json({ error: "Only a driver who submitted a price can be selected." });
      }

      const driverSnap = await getDoc(doc(db, "drivers", driverId));
      if (!driverSnap.exists()) return res.status(400).json({ error: "Driver not found." });
      const driver = driverSnap.data() as Driver;

      // Single-MAR rule: winner selection ALWAYS updates the linked
      // Order (assignedDriver, agreed USD amount, truck, timeline) via
      // the same lock + narrow-update machinery every other assignment
      // uses. It never creates a shipment and never allocates a number —
      // the Order's existing MAR reference stays the one operational
      // reference through selection, acceptance, and delivery. Legacy
      // offers created before order linking carry no Order and can no
      // longer produce a winner (history stays readable; cancel works).
      if (!offer.referenceShipmentId) {
        return res.status(409).json({
          code: "LEGACY_OFFER_UNLINKED",
          error: "This request predates Order linking and has no linked Order. Create a new quote request from an Order instead.",
        });
      }
      const refSnap = await getDoc(doc(db, "shipments", offer.referenceShipmentId));
      if (!refSnap.exists()) return res.status(400).json({ error: "Linked Order not found." });
      const refShipment = refSnap.data() as Shipment;
      if (refShipment.assignedDriverId && refShipment.assignedDriverId !== driverId) {
        return res.status(409).json({ error: "The linked Order already has an assigned driver." });
      }
      await claimDriverActiveJob(driverId, refShipment.id);
      const updated = await applyNarrowShipmentUpdate(refShipment.id, (current) => ({
        ...current,
        assignedDriverId: driverId,
        assignedDriverName: driver.name,
        truckNumber: driver.truckNumber || current.truckNumber,
        agreedAmount: response.priceUsd!,
        currency: "USD",
        status: current.status === "New" || current.status === "Waiting for Driver Quotes" ? "Assigned" : current.status,
        timeline: [
          ...current.timeline,
          {
            timestamp: new Date().toISOString(),
            status: current.status === "New" || current.status === "Waiting for Driver Quotes" ? ("Assigned" as ShipmentStatus) : current.status,
            labelEn: "Driver Assigned",
            labelTr: "Sürücü Atandı",
            labelAr: "تم تعيين السائق",
            detailsEn: `Assigned to driver ${driver.name} via Driver Alliance quote request.`,
            detailsTr: `Driver Alliance fiyat talebi ile ${driver.name} sürücüsüne atandı.`,
            detailsAr: `تم التعيين للسائق ${driver.name} عبر طلب تسعير تحالف السائقين.`,
          },
        ],
        updatedAt: new Date().toISOString(),
      }));
      const shipmentId = updated.id;
      const shipmentNumber = updated.shipmentNumber;
      await pushNotification(
        shipmentId,
        shipmentNumber,
        "assignment",
        "New Assigned Shipment",
        "Yeni Atanmış Sevkiyat",
        "شحنة جديدة معينة",
        `You have been assigned shipment ${shipmentNumber}.`,
        `Size ${shipmentNumber} numaralı sevkiyat atandı.`,
        `تم تعيين الشحنة ${shipmentNumber} لك.`
      );

      const nowIso = new Date().toISOString();
      const updatedOffer: AllianceOffer = {
        ...offer,
        status: "winner_selected",
        winnerDriverId: driverId,
        winnerShipmentId: shipmentId,
        winnerShipmentNumber: shipmentNumber,
        // closedAt marks the moment every other quotation was closed
        // (see the loop below) — selection and closing are one action.
        closedAt: nowIso,
        updatedAt: nowIso,
      };
      await setDoc(doc(db, "allianceOffers", offer.id), cleanUndefined(updatedOffer));

      // Close every other quotation: non-winning drivers who hadn't
      // already rejected get their response marked "closed" and the
      // fixed courtesy message. The winner's identity and price are
      // never included.
      const allResponses = await fetchAllianceDocs<AllianceOfferResponse>("allianceOfferResponses", "offerId", offer.id);
      for (const other of allResponses) {
        if (other.driverId === driverId || other.status === "rejected" || other.status === "closed") continue;
        await setDoc(
          doc(db, "allianceOfferResponses", other.id),
          cleanUndefined({ ...other, status: "closed" as const })
        );
        await pushNotification(
          "", "",
          "alliance_update",
          "Transport Offer Closed",
          "Taşıma Teklifi Kapandı",
          "تم إغلاق عرض النقل",
          "Another driver has been selected. Thank you for your quotation.",
          "Başka bir sürücü seçildi. Fiyat teklifiniz için teşekkür ederiz.",
          "تم اختيار سائق آخر. شكراً لك على تقديم سعرك.",
          undefined,
          undefined,
          other.driverId
        );
      }

      await pushNotification(
        shipmentId,
        shipmentNumber,
        "alliance_update",
        "You Won the Transport Offer",
        "Taşıma Teklifini Kazandınız",
        "لقد فزت بعرض النقل",
        `MARAS selected your price of ${response.priceUsd} USD. Shipment ${shipmentNumber} is now assigned to you.`,
        `MARAS, ${response.priceUsd} USD fiyatınızı seçti. ${shipmentNumber} numaralı sevkiyat size atandı.`,
        `اختارت MARAS سعرك ${response.priceUsd} دولار. تم تعيين الشحنة ${shipmentNumber} لك.`,
        undefined,
        undefined,
        driverId
      );
      await logAllianceAudit(
        "winner_selected",
        { offerId: offer.id, driverId, shipmentId },
        { userId: req.session!.id, userName: allianceActorName(req) }
      );
      res.json({ offer: updatedOffer, shipmentId, shipmentNumber });
    } catch (err) {
      if (err instanceof DriverBusyError) {
        return res.status(409).json({ code: err.code, error: err.message });
      }
      if (err instanceof UnsafeDriverAssignmentError) {
        return res.status(400).json({ error: err.message });
      }
      if (respondIfServiceUnavailable(err, res)) return;
      console.error(err);
      res.status(500).json({ error: "Failed to select winner" });
    }
  });

  // Cancel: allowed while draft/broadcast only — never after a winner
  // was selected. Invited drivers who haven't rejected are notified.
  app.post("/api/alliance/offers/:id/cancel", requireFullAdmin, async (req, res) => {
    try {
      const offer = await loadAllianceOffer(req.params.id);
      if (!offer) return res.status(404).json({ error: "Offer not found" });
      if (!canCancelOffer(offer.status)) {
        return res.status(409).json({ error: "This offer can no longer be cancelled." });
      }
      const nowIso = new Date().toISOString();
      const updatedOffer: AllianceOffer = { ...offer, status: "cancelled", updatedAt: nowIso };
      await setDoc(doc(db, "allianceOffers", offer.id), cleanUndefined(updatedOffer));

      // Order lifecycle: cancelling the quote request releases the linked
      // Order from the alliance-controlled "Waiting for Driver Quotes"
      // stage back to "New" (Draft) — never touching an Order that has
      // meanwhile been assigned or moved on.
      if (offer.referenceShipmentId) {
        try {
          await applyNarrowShipmentUpdate(offer.referenceShipmentId, (current) => {
            if (current.status !== "Waiting for Driver Quotes" || current.assignedDriverId) return current;
            return {
              ...current,
              status: "New" as ShipmentStatus,
              timeline: [
                ...current.timeline,
                {
                  timestamp: nowIso,
                  status: "New" as ShipmentStatus,
                  labelEn: "Quote Request Cancelled",
                  labelTr: "Fiyat Talebi İptal Edildi",
                  labelAr: "تم إلغاء طلب التسعير",
                  detailsEn: "The Driver Alliance quote request was cancelled. The Order is back in Draft.",
                  detailsTr: "Driver Alliance fiyat talebi iptal edildi. Sipariş taslağa geri döndü.",
                  detailsAr: "تم إلغاء طلب تسعير تحالف السائقين. عاد الطلب إلى حالة المسودة.",
                },
              ],
              updatedAt: nowIso,
            };
          });
        } catch (orderErr) {
          console.error("[alliance] failed to release linked order after cancel:", orderErr);
        }
      }

      const responses = await fetchAllianceDocs<AllianceOfferResponse>("allianceOfferResponses", "offerId", offer.id);
      for (const response of responses) {
        if (response.status === "rejected") continue;
        await pushNotification(
          "", "",
          "alliance_update",
          "Transport Offer Cancelled",
          "Taşıma Teklifi İptal Edildi",
          "تم إلغاء عرض النقل",
          `The offer ${offer.pickupCity} → ${offer.deliveryCity} was cancelled by MARAS.`,
          `${offer.pickupCity} → ${offer.deliveryCity} teklifi MARAS tarafından iptal edildi.`,
          `تم إلغاء عرض النقل ${offer.pickupCity} → ${offer.deliveryCity} من قبل MARAS.`,
          undefined,
          undefined,
          response.driverId
        );
      }
      await logAllianceAudit("offer_cancelled", { offerId: offer.id }, { userId: req.session!.id, userName: allianceActorName(req) });
      res.json({ offer: updatedOffer });
    } catch (err) {
      if (respondIfServiceUnavailable(err, res)) return;
      console.error(err);
      res.status(500).json({ error: "Failed to cancel offer" });
    }
  });

  // 13. System Notifications
  app.get("/api/notifications", requireAuth, async (req, res) => {
    try {
      // PR #99 review fix: a malformed *supplied* cursor/since value now
      // 400s instead of silently resetting to page one — see
      // parseCursorParam's own header comment. A missing param is still
      // perfectly valid (defaults to the first page / no catch-up point).
      const cursorParam = parseCursorParam(req.query.cursor);
      if (!cursorParam.ok) return res.status(400).json({ error: "Malformed cursor." });
      const sinceParam = parseCursorParam(req.query.since);
      if (!sinceParam.ok) return res.status(400).json({ error: "Malformed since parameter." });

      // Phase 4 (Firestore scalability audit) + PR #99 review fix:
      // query-scoped instead of fetching the entire notifications
      // collection on every call, AND the shipment-ownership lookup
      // itself is now a real Firestore query (buildDriverOwnedShipmentQueryScopes /
      // buildClientOwnedShipmentQueryScopes + fetchOwnedShipmentIds) —
      // no longer a full `shipments` (or, for clients, `clients`) scan.
      // buildDriverClientNotificationQueryScopes turns the same
      // own-shipment-OR-direct-recipient rule isNotificationForDriver used
      // to apply after the fact into the actual Firestore query scopes —
      // see its own header comment (src/lib/notificationAccess.ts) for why
      // this is independent queries merged in Node rather than one
      // combined query, and how it now CHUNKS (never truncates) any
      // number of owned shipment ids past Firestore's 30-value `in` cap.
      let scopes: PageFilter[][] = [[]]; // admin default: no filter, sees everything
      if (req.session!.role === "driver") {
        const driverId = req.session!.id;
        const myShipmentIds = await fetchOwnedShipmentIds(buildDriverOwnedShipmentQueryScopes(driverId));
        scopes = buildDriverClientNotificationQueryScopes(driverId, myShipmentIds).map(scope => [
          { field: scope.field, op: scope.op, value: scope.value } as PageFilter,
        ]);
      } else if (req.session!.role === "client") {
        // The client's own record is looked up by its own verified
        // session id — a single document read, not a scan of every
        // client, since a client session's id IS its own clients/{id}
        // document id (see POST /api/login's client branch).
        const clientDoc = await getDoc(doc(db, "clients", req.session!.id));
        if (clientDoc.exists()) {
          const myClient = clientDoc.data() as Client;
          const myShipmentIds = await fetchOwnedShipmentIds(buildClientOwnedShipmentQueryScopes(myClient.companyName));
          scopes = buildDriverClientNotificationQueryScopes(req.session!.id, myShipmentIds).map(scope => [
            { field: scope.field, op: scope.op, value: scope.value } as PageFilter,
          ]);
        } else {
          scopes = [];
        }
      }

      const limitParam = parseInt(req.query.limit as string, 10);
      const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 200 ? limitParam : DEFAULT_PAGE_SIZE;

      // Resolved once per request (not once per applyRoleRules call) —
      // the top-up loop below can invoke applyRoleRules several times for
      // one request, and an admin's own preferences never change
      // mid-request.
      let adminPreferences: ReturnType<typeof resolveAdminNotificationPreferences> | null = null;
      if (req.session!.role === "admin") {
        const prefDoc = await getDoc(doc(db, "adminNotificationPreferences", req.session!.id));
        adminPreferences = resolveAdminNotificationPreferences(prefDoc.exists() ? prefDoc.data() : undefined);
      }

      // applyRoleRules re-applies exactly the same excludeUserId/
      // channel-visibility/admin-preference rules the old full-scan
      // version did — unchanged logic, just run against an already-scoped
      // page instead of the whole collection. PR #99 review fix: the
      // caller (fetchFilledNotificationsPage/Since) now tops up with
      // additional bounded fetches when this filters a page below the
      // requested limit, instead of silently returning a short page.
      const applyRoleRules = async (items: any[]): Promise<any[]> => {
        let list = items.filter(n => n.excludeUserId !== req.session!.id);
        if (req.session!.role === "driver") {
          list = list.filter(n => isChatNotificationVisibleToRole(n.type, "driver", n.channel));
        } else if (req.session!.role === "client") {
          list = list.filter(n => isChatNotificationVisibleToRole(n.type, "client", n.channel));
        } else if (req.session!.role === "admin" && adminPreferences) {
          list = list.filter(n => shouldDeliverNotificationToAdmin(adminPreferences, n.type, n.channel));
        }
        return list;
      };

      if (typeof req.query.since === "string") {
        const sincePage = await fetchFilledNotificationsSince(scopes, sinceParam.cursor, limit, applyRoleRules);
        return res.json({ items: sincePage.items, hasMore: sincePage.hasMore });
      }

      const page = await fetchFilledNotificationsPage(scopes, cursorParam.cursor, limit, applyRoleRules);
      res.json({ items: page.items, nextCursor: page.nextCursor, hasMore: page.hasMore });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to get notifications" });
    }
  });

  // Notification Preferences Phase 2 (Admin only). Storage: one document
  // per admin in a new `adminNotificationPreferences` collection, keyed
  // by req.session.id (the super-admin's email, or a sub-admin's own
  // `admins/{id}` Firestore doc id — never their email; see
  // src/lib/notificationPreferences.ts's own header comment for why these
  // differ). Both routes are scoped entirely by the caller's own verified
  // session id — there is no id/email parameter accepted from the client
  // at all, so there is no way for one admin to read or write another
  // admin's preferences through this API. This is a brand-new collection;
  // no Firestore rules change is needed (firestore.rules already denies
  // every collection except the server's own account, a blanket rule that
  // already covers any collection name). No production data is migrated —
  // an admin with no saved document simply resolves to all-enabled
  // defaults (resolveAdminNotificationPreferences).
  app.get("/api/admin/notification-preferences", requireRole("admin"), async (req, res) => {
    try {
      const prefDoc = await getDoc(doc(db, "adminNotificationPreferences", req.session!.id));
      const preferences = resolveAdminNotificationPreferences(prefDoc.exists() ? prefDoc.data() : undefined);
      res.json({ preferences });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load notification preferences." });
    }
  });

  app.put("/api/admin/notification-preferences", requireRole("admin"), async (req, res) => {
    try {
      const validation = validateNotificationPreferencesUpdate(req.body);
      // Every submitted category value is validated server-side: a known
      // category with a non-boolean value rejects the whole request
      // rather than silently applying a partially-valid update. An
      // attempt to disable security_system_alerts specifically is NOT a
      // validation error — validateNotificationPreferencesUpdate already
      // dropped it from `updates` above, so the rest of a legitimate
      // request (e.g. also toggling another category) still succeeds.
      if (validation.invalidKeys.length > 0) {
        return res.status(400).json({
          error: `Invalid value for: ${validation.invalidKeys.join(", ")}. Each category must be true or false.`
        });
      }
      // Concurrency fix: this is an atomic field-level write of ONLY the
      // validated delta — no read of the existing document happens
      // before this write, and nothing about another category is ever
      // reconstructed or guessed at. See
      // updateAdminNotificationPreferenceFields's own comment for exactly
      // why this is what makes two concurrent PUTs to different
      // categories both survive.
      await updateAdminNotificationPreferenceFields(req.session!.id, validation.updates);
      // This read happens strictly AFTER the write completes, purely to
      // report accurate current data back to the caller — it has no
      // influence on what was written above, so it cannot reintroduce the
      // lost-update race this endpoint was fixed for.
      const prefDoc = await getDoc(doc(db, "adminNotificationPreferences", req.session!.id));
      const preferences = resolveAdminNotificationPreferences(prefDoc.exists() ? prefDoc.data() : undefined);
      res.json({ preferences });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update notification preferences." });
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

  // Notification Phase 1 correction: this route used to mean "set the
  // legacy shared `read` flag true on every notification" — which was
  // exactly the cross-contamination bug the per-user model exists to fix
  // (one admin's global "clear" would have marked every notification read
  // for every other admin, every driver, and every client too). It now
  // means "mark every notification visible to the current admin as read
  // FOR THIS ADMIN ONLY": the calling admin's own session id is
  // atomically added to each notification's readByUserIds via
  // addNotificationReaderId (the same helper POST
  // /api/notifications/:id/read uses — real Firestore arrayUnion,
  // idempotent Set-union in memory fallback), never the whole document.
  // Still admin-only (requireRole("admin"), unchanged); `read` itself is
  // never read or written by this route anymore; no other admin's,
  // driver's, or client's readByUserIds entry is ever touched.
  app.post("/api/notifications/clear", requireRole("admin"), async (req, res) => {
    try {
      const col = collection(db, "notifications");
      const snapshot = await getDocs(col);
      await Promise.all(snapshot.docs.map(d => addNotificationReaderId(d.id, req.session!.id)));
      res.json({ status: "success" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to mark all notifications as read" });
    }
  });

  app.post("/api/notifications/:id/read", requireAuth, async (req, res) => {
    try {
      const dRef = doc(db, "notifications", req.params.id);
      const dDoc = await getDoc(dRef);
      if (dDoc.exists()) {
        const notif = dDoc.data() as AppNotification;

        // Non-admins may only mark read a notification belonging to one of
        // their own shipments — OR one addressed directly to their own
        // session id (Notification Phase 1: recipientUserId, for events
        // like "Driver Approved" with no associated shipment at all;
        // strictly narrower than shipment ownership, since it only ever
        // matches the caller's own id) — AND, either way, only within
        // their own audience channel. canMarkNotificationRead
        // (notificationAccess.ts) is the single source of truth for this
        // full decision — see its own comment for the direct-recipient
        // channel-bypass this fixed (a direct recipient previously skipped
        // the channel check entirely).
        if (req.session!.role !== "admin") {
          const isDirectRecipient = !!notif.recipientUserId && notif.recipientUserId === req.session!.id;
          let ownsViaShipment = false;
          if (!isDirectRecipient) {
            const sDoc = await getDoc(doc(db, "shipments", notif.shipmentId));
            if (!sDoc.exists()) {
              return res.status(404).json({ error: "Shipment not found for this notification." });
            }
            const shipment = sDoc.data() as Shipment;
            if (req.session!.role === "driver") {
              const driverId = req.session!.id;
              ownsViaShipment = shipment.assignedDriverId === driverId ||
                !!(shipment.additionalDrivers && shipment.additionalDrivers.some((ad: any) => ad.driverId === driverId));
            } else if (req.session!.role === "client") {
              const clientsCol = collection(db, "clients");
              const clientsSnap = await getDocs(clientsCol);
              const myClient = clientsSnap.docs.map(d => d.data() as Client).find(c => c.id === req.session!.id);
              ownsViaShipment = !!myClient && isShipmentVisibleToClientCompany(shipment.companyName, myClient.companyName);
            }
          }
          if (!canMarkNotificationRead(notif, req.session!.role, req.session!.id, ownsViaShipment)) {
            return res.status(403).json({ error: "You do not have access to this notification." });
          }
        }

        // Notification Phase 1 correction: per-user read tracking, via an
        // atomic field-only update (addNotificationReaderId — real
        // Firestore arrayUnion in production, an equivalent idempotent
        // Set-union on just this field in memory fallback; see its own
        // comment above). Only this caller's own session id is ever
        // added; every other id already present (another user who already
        // read this same notification) is preserved untouched, and
        // nothing else on the document — including the legacy `read`
        // flag — is read, touched, or written by this call. `read` is
        // deliberately left exactly as it was: Admin/Client code paths
        // that still consume it (not yet migrated to readByUserIds — see
        // docs/NOTIFICATION_SYSTEM_AUDIT.md) must not have a Driver's own
        // read silently flip it, the same class of bug this per-user
        // model exists to fix.
        await addNotificationReaderId(req.params.id, req.session!.id);
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

      // Accounting Phase A — Single Shipment Reference Hardening: a Cost
      // Statement must never be created unless it is linked to a real,
      // existing shipment — in EVERY persistence mode. The shipment is
      // confirmed to exist first, unconditionally, and every reference
      // to it comes only from that authoritative record.
      const sRef = doc(db, "shipments", shipmentId);
      const sDoc = await getDoc(sRef);
      if (!sDoc.exists()) {
        return res.status(404).json({ error: "Shipment not found" });
      }
      const shipment = sDoc.data() as Shipment;

      // Accounting Phase B — server-authoritative money: every submitted
      // number is validated (finite, non-negative), item totals are
      // RECOMPUTED as quantity × unitPrice (a client-sent totalAmount is
      // ignored), currencies must be one of USD/IQD/TRY/EUR, and every
      // item currency must equal the statement currency — mixed-currency
      // statements are rejected outright (no FX engine exists by design).
      const validated = validateCostStatementInput(data);
      if (!validated.ok) {
        return res.status(400).json({ error: validated.error });
      }
      const input = validated.input;
      const expense = deriveExpenseSummary(input.totalCost, input.paidAmount);

      // Everything identity-shaped comes from the authoritative shipment,
      // never the client: the MAR reference, the customer identity, the
      // freight segment, and the accounting-safe snapshots (agreedAmount +
      // its currency, truck plate) — refreshed on every save. The
      // statement's own currency stays an accounting choice (expenses may
      // be tracked in a different currency than the customer contract);
      // the shipment's agreed currency is snapshotted alongside so the
      // two sides are always labelled — and never mixed — correctly.
      const buildFinal = (nextRevision: number, existing: CostStatement | undefined): CostStatement => ({
        shipmentId,
        shipmentNumber: shipment.shipmentNumber,
        companyName: shipment.companyName || "",
        shipmentType: shipment.freightType === "sea" ? "sea" : shipment.freightType === "air" ? "air" : "land",
        date: typeof data.date === "string" && data.date ? data.date : new Date().toISOString().split("T")[0],
        currency: input.currency,
        totalCost: input.totalCost,
        // Expense Paid Amount — money MARAS paid toward costs/vendors.
        paidAmount: input.paidAmount,
        remainingBalance: expense.remainingBalance,
        paymentStatus: expense.paymentStatus,
        // Customer side — money MARAS received from the customer.
        customerReceivedAmount: input.customerReceivedAmount,
        revision: nextRevision,
        notes: typeof data.notes === "string" ? data.notes : "",
        items: input.items,
        createdAt: existing?.createdAt || (typeof data.createdAt === "string" && data.createdAt ? data.createdAt : new Date().toISOString()),
        updatedAt: new Date().toISOString(),
        agreedAmount: shipment.agreedAmount,
        agreedCurrency: shipment.currency,
        truckNumber: shipment.truckNumber,
      });

      // Optimistic concurrency (Accounting Phase B), same rule in both
      // persistence modes via decideStatementRevision: Firestore runs it
      // inside a real transaction; memory mode applies it synchronously
      // against the live array (no await between read and write — atomic
      // within the event loop). A stale submitted revision answers 409
      // and writes nothing; strict-persistence behavior is unchanged
      // (infra failures still surface as 503 via the outer catch).
      let finalStatement: CostStatement;
      if (!useMemoryFallback && db && typeof (db as any).runTransaction === "function") {
        const dRefTx = doc(db, "costStatements", shipmentId);
        finalStatement = await withTimeout(
          (db as any).runTransaction(async (tx: any) => {
            const snap = await tx.get(dRefTx);
            const stored = snap.exists ? (snap.data() as CostStatement) : undefined;
            const decision = decideStatementRevision(stored, data.revision);
            if (!decision.ok) throw new CostStatementRevisionConflictError(decision.storedRevision);
            const fin = buildFinal(decision.nextRevision, stored);
            tx.set(dRefTx, fin);
            return fin;
          }),
          5000,
          "Firestore cost-statement transaction timed out"
        );
      } else {
        finalStatement = applyCostStatementRevisionedWriteMemory(
          getMemoryStore().costStatements,
          shipmentId,
          data.revision,
          buildFinal
        );
      }

      try {
        const logId = `log-${Date.now()}`;
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
      if (err instanceof CostStatementRevisionConflictError) {
        return res.status(409).json({
          code: err.code,
          storedRevision: err.storedRevision,
          error: err.message,
        });
      }
      if (respondIfServiceUnavailable(err, res)) return;
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
      // feature/admin-mobile-ui correction pass: per-admin (WhatsApp/
      // Google-Chat-style), not a single global flag shared by every
      // admin — see src/lib/chatUnreadAccess.ts. This also now correctly
      // includes another admin's internal_staff messages (previously
      // excluded outright by the old `sender !== "admin"` filter, since
      // every admin's messages share that same sender value).
      const viewerAdminId = req.session!.id;

      // Chat-unread scalability follow-up: this used to walk every
      // chatMessages document ever written (paginated, but still
      // O(all messages) — see git history for the prior comment here),
      // because "unread for this specific admin" had no Firestore-queryable
      // shape against chatMessages itself (readByAdminIds is an array
      // field; Firestore has no "array does not contain" operator). It now
      // queries the maintained adminChatUnread collection
      // (chatUnreadAccess.ts's own header comment has the full design) with
      // a real `adminId == this admin` filter — O(this admin's unread set),
      // not O(every message ever sent) — via the same bounded,
      // timeout-protected, indexed-page walk fetchAllMatchingDescending
      // already gives every other exhaustive-fetch call site in this file.
      const filters: PageFilter[] = [{ field: "adminId", op: "==", value: viewerAdminId }];
      const records = await fetchAllMatchingDescending("adminChatUnread", filters);
      const unreadMsgs = selectUnreadMessagesFromRecords(records as AdminChatUnreadRecord[], viewerAdminId);

      res.json(unreadMsgs);
    } catch (err: any) {
      console.error(err);
      if (respondIfServiceUnavailable(err, res)) return;
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
