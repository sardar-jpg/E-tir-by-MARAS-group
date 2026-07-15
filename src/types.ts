export type Language = 'en' | 'tr' | 'ar';

export type UserRole = 'admin' | 'driver' | 'client';

export type ShipmentStatus =
  | 'New'
  | 'Assigned'
  | 'Accepted'
  | 'Loading'
  | 'Loaded'
  | 'In Transit'
  | 'Border Crossing'
  | 'Customs Clearance'
  | 'Arrived'
  | 'Delivered'
  | 'Closed'
  // Sea statuses
  | 'Booking Confirmed'
  | 'Container Released'
  | 'Loaded on Vessel'
  | 'Vessel Departed'
  | 'Arrived at Port'
  | 'Released'
  | 'Out for Delivery'
  | 'Completed'
  // Air statuses
  | 'Cargo Received'
  | 'Security Check Completed'
  | 'Departed Airport'
  | 'Arrived Airport';

export type Currency = 'USD' | 'IQD' | 'TRY' | 'EUR';

export type DocumentCategory =
  | 'cmr'
  | 'invoice'
  | 'packing_list'
  | 'customs'
  | 'delivery_proof'
  | 'photo'
  | 'other';

export interface ShipmentDocument {
  id: string;
  name: string;
  url: string;
  category: DocumentCategory;
  uploadedBy: string;
  uploadedAt: string;
  isSharedExternally: boolean;
}

export interface LocationUpdate {
  timestamp: string;
  status: ShipmentStatus;
  labelEn: string;
  labelTr: string;
  labelAr: string;
  detailsEn?: string;
  detailsTr?: string;
  detailsAr?: string;
}

export interface Shipment {
  id: string;
  shipmentNumber: string;
  companyName: string; // Admin only
  loadingCountry: string;
  loadingCity: string;
  loadingAddress: string;
  loadingContactNumber: string;
  deliveryCountry: string;
  deliveryCity: string;
  deliveryAddress: string;
  deliveryContactNumber: string;
  cargoDescription: string;
  cargoWeight: number; // in kg
  truckNumber: string;
  assignedDriverId: string;
  assignedDriverName: string;
  agreedAmount: number;
  currency: Currency;
  internalNotes: string; // Admin only
  status: ShipmentStatus;
  documents: ShipmentDocument[];
  timeline: LocationUpdate[];
  createdAt: string;
  updatedAt: string;
  isLinkShared: boolean;
  shareToken: string;
  shareIncludeDocuments: boolean;
  shareIncludePhotos: boolean;
  
  // Scheduling
  loadingDate?: string;

  // Sea & Air properties
  freightType?: 'land' | 'sea' | 'air';
  additionalDrivers?: Array<{ driverId: string; driverName: string; truckNumber: string; agreedAmount?: number }>;
  // Phase 4 follow-up (Firestore scalability audit, PR #99 review): a flat
  // derived array of just `additionalDrivers[].driverId`, kept in sync by
  // the server on every create/update (see deriveAdditionalDriverIds,
  // src/lib/driverVisibility.ts) — additionalDrivers itself remains the
  // single source of truth for the full driver records; this field exists
  // solely so "is this driver an additional driver on this shipment" is a
  // Firestore `array-contains` query (server.ts's ownership lookup for
  // GET /api/notifications) instead of loading every shipment to check in
  // Node. Absent on any shipment that hasn't been created/updated since
  // this field was introduced — see the same function's header comment
  // for the documented legacy-record fallback/migration plan.
  additionalDriverIds?: string[];
  additionalContainers?: string[];
  // Sea precise
  shippingLine?: string;
  vesselName?: string;
  containerNumber?: string;
  bookingNumber?: string;
  billOfLadingNumber?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  finalDestination?: string;
  etd?: string;
  eta?: string;
  numberOfContainers?: number;
  containerType?: string;
  // Air precise
  airline?: string;
  flightNumber?: string;
  airWaybillNumber?: string;
  airportOfDeparture?: string;
  airportOfArrival?: string;
  grossWeight?: number;
  chargeableWeight?: number;
  numberOfPackages?: number;
  customerEmails?: string[];
  customerNotificationHistory?: Array<{ id: string; timestamp: string; type: string; title: string; message: string; email: string; channel: 'email' | 'sms' }>;
  
  // Custom Broker info for Land Freight
  destinationBrokerId?: string;
  destinationBrokerName?: string;
  destinationBrokerPhone?: string;
  iraqBorderBrokerId?: string;
  iraqBorderBrokerName?: string;
  iraqBorderBrokerPhone?: string;
}

export interface Driver {
  id: string;
  name: string;
  username: string;
  password?: string;
  email?: string;
  truckNumber: string;
  phone: string;
  activeShipmentsCount: number;
  completedShipmentsCount: number;
  truckType?: string;
  latitude?: number;
  longitude?: number;
  lastUpdated?: string;
  avatarUrl?: string;
  status?: "pending" | "approved" | "rejected";
  /**
   * The driver's Firebase Authentication uid, set ONLY by
   * POST /api/verify-session (server.ts) after adminAuth.verifyIdToken has
   * cryptographically confirmed it — never inferred from `id`, `email`,
   * `username`, or a client-supplied value. Absent for drivers who have
   * never signed in via Google/Firebase (username/password-only accounts
   * have no Firebase Auth identity at all). This is the only field
   * DELETE /api/drivers/:id trusts to also delete the Firebase Auth user.
   */
  firebaseUid?: string;
}

export interface Client {
  id: string;
  companyName: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  notes?: string;
  createdAt: string;
  username?: string;
  password?: string;
  isEmployee?: boolean;
  /**
   * feature/client-staff-management-ui: whether this account may log in.
   * `undefined` (every pre-existing record — no migration performed) and
   * `true` both mean active; only the literal `false` disables login. See
   * isClientAccountActive in clientAccess.ts, which is the single place
   * this convention is enforced — never compare `client.active === true`
   * directly, or every existing record would be treated as disabled.
   */
  active?: boolean;
}

export interface Vendor {
  id: string;
  companyName: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  serviceType: string;
  notes?: string;
  createdAt: string;
}

export const TRUCK_TYPES = [
  { id: "reefer", en: "Refrigerated (Reefer)", tr: "Frigorifik (Frigo)", ar: "مبردة (ثلاجة)" },
  { id: "curtainsider", en: "Curtainsider (Tilt)", tr: "Tenteli Dorse", ar: "جوانب ستائر" },
  { id: "flatbed", en: "Flatbed", tr: "Açık Kasa (Sal)", ar: "مسطحة" },
  { id: "lowboy", en: "Lowboy (Heavy Haul)", tr: "Alçak Şasi (Lowbed)", ar: "منخفضة للحمولات الثقيلة" },
  { id: "dryvan", en: "Box / Dry Van", tr: "Kapalı Kasa", ar: "صندوق مغلق" },
  { id: "tanker", en: "Tanker", tr: "Tanker", ar: "ناقلة سوائل / تانكر" }
];

// BUG-03: which audience a chat message belongs to. Driver/admin dispatch
// chat and client/admin customer-service chat are kept in separate
// threads so drivers never see client identity/content and clients never
// see internal driver/admin operational chat. Messages written before this
// field existed have no channel — the server treats those as admin-only
// (see server.ts chat routes) rather than guessing and risking a leak.
//
// 'internal_staff' (PR #34) is a third, admin-only audience for MARAS
// staff to discuss a shipment among themselves — never visible to driver
// or client sessions, and never exposed via the public share proxy (see
// chatVisibility.ts and the chat routes in server.ts).
export type ChatChannel = 'driver_admin' | 'client_admin' | 'internal_staff';

export interface ChatMessage {
  id: string;
  shipmentId: string;
  sender: 'admin' | 'driver' | 'client';
  senderName: string;
  type: 'text' | 'file';
  text?: string;
  fileUrl?: string;
  fileName?: string;
  fileCategory?: DocumentCategory;
  timestamp: string;
  // Single global read receipt shown to the SENDING driver/client ("was
  // my message seen by the admin side") — unchanged by the
  // admin-mobile-ui correction pass. Not per-admin; do not use this to
  // compute an individual admin's unread badge (see readByAdminIds).
  status?: 'sent' | 'seen';
  channel?: ChatChannel;
  // feature/admin-mobile-ui correction pass: session id of the admin who
  // sent this message (only ever set when sender === 'admin', resolved
  // server-side from the verified session — never client-supplied).
  // Needed to tell "my own internal_staff message" apart from "another
  // admin's internal_staff message" — sender alone ('admin') can't,
  // since every admin's messages have the same sender value. Absent on
  // driver/client messages and on messages sent before this field
  // existed (src/lib/chatUnreadAccess.ts treats those conservatively —
  // never counted as unread for anyone, rather than guessed).
  senderId?: string;
  // feature/admin-mobile-ui correction pass: session ids of the admins
  // who have read this message — the actual per-admin unread source of
  // truth (src/lib/chatUnreadAccess.ts), distinct from `status` above.
  // Only ever meaningful for messages an admin can receive (i.e. not
  // their own); appended to, never overwritten, by POST
  // /api/shipments/:id/chat/seen with viewer: 'admin'.
  readByAdminIds?: string[];
}

export interface ActivityLog {
  id: string;
  shipmentId: string;
  shipmentNumber: string;
  actionEn: string;
  actionTr: string;
  actionAr: string;
  actor: string;
  timestamp: string;
}

export interface AppNotification {
  id: string;
  shipmentId: string;
  shipmentNumber: string;
  titleEn: string;
  titleTr: string;
  titleAr: string;
  messageEn: string;
  messageTr: string;
  messageAr: string;
  // 'ai_alert' (PR #44) is reserved for a future MARAS AI monitoring
  // alert — see AI_ALERT_NOTIFICATION_TYPE below. No code creates this
  // type yet (no AI provider is connected); it's admin-only by
  // construction in chatVisibility.ts's routing helpers ahead of time, so
  // wiring up a real alert later can't accidentally forget to exclude
  // driver/client/public.
  type: 'assignment' | 'acceptance' | 'rejection' | 'status_update' | 'chat' | 'doc_upload' | 'delivery' | 'driver_registration' | 'ai_alert';
  timestamp: string;
  read: boolean;
  // Session id of the user this notification should NOT be shown to (its
  // own sender), e.g. so an admin doesn't get notified of their own chat
  // message. Absent for notification types that don't need self-exclusion.
  excludeUserId?: string;
  // BUG-03: for type 'chat' notifications, which chat audience this came
  // from (see ChatMessage.channel). Used to keep a driver from being
  // notified of a client message (or vice versa) via the notification
  // center/push, not just the chat thread itself.
  // PR #44: also set for 'doc_upload' when it originated from a chat file
  // attachment (client_admin only today), for the same reason — otherwise
  // driver would be paged for a document event that belongs to the
  // client_admin audience. Absent for other notification types.
  channel?: ChatChannel;
  // Notification Phase 1: session id of a specific user this notification
  // is directly addressed to, independent of shipmentId. Some events (e.g.
  // a driver being approved) have no associated shipment at all — without
  // this, GET /api/notifications' shipment-scoping filter for
  // driver/client sessions would silently drop the notification for
  // everyone except admins, and POST /api/notifications/:id/read's
  // ownership check (which looks up notif.shipmentId) would 404 rather
  // than let the intended recipient mark it read. When set, both routes
  // treat `recipientUserId === the caller's own session id` as sufficient
  // access on its own, on top of (not instead of) the existing
  // shipment-scoped rules. Absent for the ordinary shipment-scoped
  // notification types.
  recipientUserId?: string;
  // Notification Phase 1 correction: per-user read tracking. `read` above
  // is a legacy GLOBAL flag on the shared notification document — every
  // driver/client/admin who can see a given notification reads the SAME
  // doc, so one user's read request flipping `read` to true marked it
  // read for every other user too (a real bug: Driver A opening their
  // notifications silently marked it read for Driver B, Admin, and
  // Client, none of whom had actually seen it). `readByUserIds` is the
  // source of truth for whether a SPECIFIC user has read this
  // notification: a user's own verified session id must appear in this
  // array for it to count as read for them. Absent/empty means unread
  // for everyone, including on notifications written before this field
  // existed — those remain safely readable; reading one just adds the
  // reader's id here rather than requiring a data migration. Only ids are
  // ever added, never removed, by POST /api/notifications/:id/read.
  // `read` itself is left in place, untouched by per-user reads — it
  // still exists as-is for the legacy admin-wide POST
  // /api/notifications/clear and for Admin/Client code paths not yet
  // migrated to this per-user model (see
  // docs/NOTIFICATION_SYSTEM_AUDIT.md). DriverApplication.tsx is the only
  // consumer migrated to readByUserIds in this PR.
  readByUserIds?: string[];
}

// PR #44 — MARAS AI notification readiness. Reserved notification type
// string for a future admin-only MARAS AI alert (e.g. an anomaly/error
// surfaced from audit logs). Nothing in this codebase creates a
// notification with this type yet, and this PR does not connect MARAS AI
// to any provider — this constant exists purely so a future integration
// has one canonical, already-safe (admin-only, see
// chatVisibility.ts#isChatNotificationVisibleToRole /
// #shouldNotifyChatParty) type string to use instead of inventing a new
// unreviewed one. Any future payload built for this type must be
// sanitized first (safe shipment/status ids only — never raw chat text,
// internal notes, costs, or file URLs).
export const AI_ALERT_NOTIFICATION_TYPE = 'ai_alert' as const;

export interface CostItem {
  id: string;
  costType: string;
  description: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  currency: Currency;
  supplierName: string;
  documentUrl?: string;
  documentName?: string;
  internalNotes?: string;
}

export interface CostStatement {
  shipmentId: string;
  shipmentNumber: string;
  companyName: string;
  shipmentType: 'land' | 'sea' | 'air';
  date: string;
  currency: Currency;
  totalCost: number;
  paidAmount: number;
  remainingBalance: number;
  paymentStatus: 'Unpaid' | 'Partial' | 'Paid';
  notes: string;
  items: CostItem[];
  createdAt: string;
  updatedAt: string;

  // Accounts Admin data completeness (PR #60): accounts admins can view
  // cost statements (canViewCostStatements) but never fetch the shipment
  // registry (canViewShipmentRegistry is super/operation only), so the
  // Costs tab can't rely on joining against the live `shipments` array for
  // this role. These are accounting-safe snapshot fields copied from the
  // shipment at cost-statement create/update time (see server.ts POST
  // /api/cost-statements/:shipmentId) so search/filter/display and
  // customer-facing exports (costStatementExportView.ts) work from the
  // statement alone. Both are already shown/used in the accounts-visible
  // Costs UI today (the "Contract Agreed Amount" column and the "truck
  // plate" search field) — not new data exposure, just no longer requiring
  // a shipments join to read it.
  agreedAmount?: number;
  truckNumber?: string;
}

