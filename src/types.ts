export type Language = 'en' | 'tr' | 'ar';

export type UserRole = 'admin' | 'driver' | 'client';

export type ShipmentStatus =
  | 'New'
  // Alliance-controlled pre-assignment stage (Land only): set automatically
  // when a Driver Alliance quote request is broadcast for the Order, and
  // cleared automatically (back to 'New' on cancel, forward to 'Assigned'
  // on winner selection). Never set through the manual status controls —
  // see shipmentStatusTransitions.ts. Occupies the same lifecycle position
  // as 'New': not dispatched, no driver, no chat.
  | 'Waiting for Driver Quotes'
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

/**
 * Unified Shipment Documents model — category ids.
 *
 * Every shipment document is one record in the shipment's `documents`
 * collection, and `category` is nothing more than a metadata label from
 * this list. CMR is deliberately NOT a special object anywhere in the
 * codebase: no route, screen, or rule may branch on `=== 'cmr'`. All
 * per-category behavior (driver read/upload direction, client
 * visibility, public-share gating, display label) lives in ONE place —
 * the DOCUMENT_CATEGORY_POLICIES registry in src/lib/shipmentDocuments.ts.
 * Adding a category later = add the id here + one registry entry; no
 * structural change anywhere else.
 */
export type DocumentCategory =
  | 'cmr'
  | 'invoice'          // Commercial Invoice
  | 'packing_list'
  | 't1'               // T1 transit declaration
  | 'tir_carnet'       // TIR Carnet
  | 'customs'          // Customs Document
  | 'delivery_proof'   // Delivery Note / POD
  | 'photo'
  | 'other';

/**
 * One shipment document. Uploadable today by Admin and Driver sessions
 * (and by future internal employee roles — the model carries plain
 * uploader metadata, not a role enum, so no structural change is needed).
 * The optional fields are the unified-model metadata added by the
 * documents-architecture cleanup: they are populated on records created
 * from now on and simply absent on older stored records (no migration —
 * every reader treats them as optional).
 */
export interface ShipmentDocument {
  id: string;
  name: string;
  url: string;
  category: DocumentCategory;
  uploadedBy: string;
  uploadedAt: string;
  isSharedExternally: boolean;
  /** Owning shipment id (also implicit from the embedding shipment record). */
  shipmentId?: string;
  /** MIME type or file extension supplied at upload time. */
  fileType?: string;
  /** Optional free-text note from the uploader. */
  notes?: string;
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
  // Shipment-update lost-update race fix: server-owned optimistic-concurrency
  // counter. Absent on shipments created before this field existed — always
  // interpreted as revision 1 (see resolveStoredRevision, shipmentRevision.ts).
  // Every successful PUT /api/shipments/:id increments this by exactly 1; the
  // client only ever submits the revision it last read, never a value it
  // computes itself.
  revision?: number;
  /**
   * feature/admin-chat-recent-activity-order: timestamp of the newest chat
   * message in this Order's chat room (any of its three channels —
   * internal_staff / driver_admin / client_admin — any sender role).
   * Written atomically in the SAME Firestore batch as the message + unread
   * fan-out (commitChatMessageWithUnreadFanout, server.ts) so the Chat
   * Center can sort Orders by recent activity (WhatsApp-style) without
   * scanning chatMessages. Deliberately does NOT touch `updatedAt` — a
   * chat message is not a shipment edit. Optional: legacy shipments
   * without it sort by createdAt below Orders with known activity (see
   * sortShipmentsByChatActivity, chatCenterView.ts); a dry-run backfill
   * exists in scripts/backfill-last-chat-activity.ts.
   */
  lastChatActivityAt?: string;
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

/**
 * Driver Alliance Phase 1: one directional working route for a driver.
 * Direction matters — "Turkey → Iraq" and "Iraq → Turkey" are two
 * different routes. Endpoints are free-form zone names (a country or a
 * region label like "Europe"), matched case-insensitively against an
 * offer's pickup/delivery country (see src/lib/driverAlliance.ts).
 * Routes are managed by Operations/Super admins only — the server
 * rejects a driver session writing them (PUT /api/drivers/:id).
 */
export interface DriverRoute {
  id: string;
  from: string;
  to: string;
  /** Inactive routes are kept but never match offers. */
  active: boolean;
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
  /**
   * Driver Alliance Phase 1: directional working routes (admin-managed;
   * see DriverRoute above). Absent on drivers created before this field
   * existed — treated as "no routes" (never matches any offer).
   */
  workingRoutes?: DriverRoute[];
  /**
   * Driver Alliance Phase 1: admin-set "Inactive" switch. An inactive
   * driver never appears in alliance matching and never receives offers,
   * regardless of whether they currently have an active job. Distinct
   * from `status` below (registration approval) — an approved driver can
   * still be marked alliance-inactive. Absent = active.
   */
  allianceInactive?: boolean;
  /**
   * Driver Quote Requests: the driver's OWN "Available for Offers"
   * switch, editable from the driver app's Account screen (the one
   * alliance field a driver session may write). Absent/true = available;
   * false = the driver receives no quotation requests. Independent of
   * `allianceInactive` (the Operations-side switch) — matching requires
   * BOTH to be off.
   */
  availableForOffers?: boolean;
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
  // 'alliance_offer' / 'alliance_update' (Driver Alliance Phase 1):
  // freight-offer lifecycle events. Offer-received/winner-selected/
  // offer-cancelled notifications are addressed to a specific driver via
  // recipientUserId (these events have no shipment yet, exactly like
  // 'driver_registration' approvals); price-submitted/offer-rejected
  // notifications have no recipient and therefore reach admins only.
  type: 'assignment' | 'acceptance' | 'rejection' | 'status_update' | 'chat' | 'doc_upload' | 'delivery' | 'driver_registration' | 'ai_alert' | 'alliance_offer' | 'alliance_update';
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
  // Vendor Payables (optional, legacy-safe): a cost line may be paid to a
  // vendor via one or more VendorPaymentTransaction records. paid/remaining/
  // status are NEVER stored here — they are derived server-side from the
  // active (non-reversed) transactions (see src/lib/vendorPayments.ts).
  vendorId?: string;
  dueDate?: string;
  paymentTerms?: string;
  /** Priority of this expense line (PR #140 increment 3) — never a payment method. */
  priority?: 'normal' | 'urgent';
  /** Stable client key for the item-level add API (idempotent append). */
  idempotencyKey?: string;
}

/**
 * A single vendor payment against one CostItem. A vendor cost may be paid
 * in multiple partial payments, so these are discrete records (never a
 * single paid flag on the item). Internal to MARAS — never exposed to
 * customers/drivers/public. Completed payments are never edited/deleted;
 * corrections are made by writing a reversal (status → "reversed").
 */
export interface VendorPaymentTransaction {
  id: string;
  shipmentId: string;
  /** MAR order number snapshot, for cross-document consistency + search. */
  shipmentNumber: string;
  /** Cost statement doc id (== shipmentId in this architecture). */
  costStatementId: string;
  costItemId: string;
  vendorId?: string;
  /** Vendor/supplier name snapshot at payment time. */
  vendorName: string;
  amount: number;
  currency: Currency;
  paymentDate: string;
  paymentMethod: string;
  /**
   * Urgency is a PRIORITY, not a payment method (PR #140 review, item 12).
   * Legacy records that stored paymentMethod:"urgent" are normalized on read
   * (normalizeExpensePriority, expensePriority.ts); new writes never persist
   * "urgent" as a method.
   */
  priority?: 'normal' | 'urgent';
  /** Paying bank/cash account (from Template Settings) + snapshot. */
  bankAccountId?: string;
  bankAccountSnapshot?: string;
  reference?: string;
  attachmentUrl?: string;
  attachmentName?: string;
  internalNotes?: string;
  /** Stable client-supplied retry key (scoped by action) — see idempotency.ts. */
  idempotencyKey?: string;
  createdBy: string;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
  status: 'active' | 'reversed';
  reversedBy?: string;
  reversedAt?: string;
  reversalReason?: string;
}

/** Derived, server-authoritative payable status for a single cost item. */
export type VendorPayableStatus = 'Unpaid' | 'Partially Paid' | 'Paid' | 'Overpaid';

// ═══════════════════════════════════════════════════════════════════
// Customer Invoices — customer-facing selling document, linked to a
// shipment (MAR number) and customer. Internal cost + profit are stored on
// the invoice but are PRIVATE (never in the customer projection / PDF).
// Issued invoices are immutable; corrections are cancellations (never
// deletes). Pricing math lives in src/lib/customerInvoice.ts.
// ═══════════════════════════════════════════════════════════════════

/**
 * Final pricing model (Increment 5): exactly two modes.
 *  - manual:    the user enters an agreed selling amount (or line items). The
 *               internal shipment cost stays private; nothing is derived from it.
 *  - cost_plus: the server takes the authorized internal cost base and adds a
 *               markup (percentage OR fixed). Only the selling price is shown to
 *               the customer; costBaseAmount and markup stay internal.
 */
export type InvoicePricingMode = 'manual' | 'cost_plus';

/** How a cost_plus markup is expressed. */
export type InvoiceMarkupType = 'percentage' | 'fixed';

/**
 * Canonical invoice lifecycle. draft/issued/cancelled are set explicitly;
 * partially_paid/paid are SERVER-DERIVED from the transactional invoice ledger
 * and are never selectable by the client. Overdue is calculated from dueDate
 * when needed — it is never a stored lifecycle status.
 */
export type CustomerInvoiceStatus = 'draft' | 'issued' | 'partially_paid' | 'paid' | 'cancelled';

/**
 * Immutable snapshot of the bank account copied onto an invoice AT ISSUE TIME.
 * Once written, editing/deactivating/deleting the master bank account never
 * changes it — issued documents always render from this snapshot.
 */
export interface BankAccountSnapshot {
  /** The master bank account this was copied from (reference only). */
  bankAccountId?: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  iban?: string;
  swiftCode?: string;
  branchName?: string;
  bankAddress?: string;
  currency: Currency;
  country?: string;
  paymentInstructions?: string;
}

export interface CustomerInvoice {
  id: string;
  /** Derived from the MAR order number — no second numbering system. */
  invoiceNumber: string;
  shipmentId: string;
  shipmentNumber: string;
  clientId?: string;
  companyName: string;
  currency: Currency;
  pricingMode: InvoicePricingMode;
  // ── Pricing inputs (only the relevant ones are used per mode) ──
  /** PRIVATE internal snapshot of the approved total shipment cost. Never shown to customer. */
  costBasis: number;
  /** manual mode: the agreed customer selling amount. */
  manualAmount?: number;
  /** cost_plus mode: PRIVATE authorized cost base the markup is applied to (server-derived). */
  costBaseAmount?: number;
  /** cost_plus mode: percentage or fixed markup. */
  markupType?: InvoiceMarkupType;
  /** cost_plus mode: the percentage value or the fixed amount, per markupType. */
  markupValue?: number;
  /** cost_plus mode: PRIVATE server-computed markup amount. Never shown to customer. */
  markupAmount?: number;
  /** Optional payment due date (used to CALCULATE overdue; never a stored status). */
  dueDate?: string;
  /** Optional customer-visible payment terms text. */
  paymentTerms?: string;
  // ── Server-computed ──
  /** Customer-facing invoice total. */
  sellingAmount: number;
  /** PRIVATE derived gross profit (selling − cost), or null if not comparable. */
  grossProfit?: number | null;
  description?: string;
  /** Customer-visible note. */
  notes?: string;
  /** PRIVATE internal note. */
  internalNotes?: string;
  status: CustomerInvoiceStatus;
  bankAccountId?: string;
  bankAccountSnapshot?: BankAccountSnapshot;
  /** Company branding snapshot captured at issue time (issued-doc integrity). */
  companySnapshot?: CompanyProfile;
  /** The company-profile version this document was issued against. */
  companyProfileVersion?: number;
  issuedAt?: string;
  issuedBy?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  cancellationReason?: string;
  createdAt: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
  revision?: number;
  // ── Line-based invoicing (customer-facing service lines) ──
  // Optional + legacy-safe: invoices created before this feature have no
  // invoiceLines and keep rendering/paying from their sellingAmount. For
  // line-based invoices the server recomputes each line amount + all totals
  // and sets sellingAmount = grandTotal (so the ledger/payments are unchanged).
  /** Customer-facing invoice date (defaults to today; distinct from issuedAt). */
  invoiceDate?: string;
  /** Server-recomputed customer service lines. Never contains internal cost/profit. */
  invoiceLines?: CustomerInvoiceLine[];
  /** Sum of line amounts (server-computed). */
  subtotal?: number;
  discountAmount?: number;
  taxAmount?: number;
  additionalCharges?: number;
  /** Server-computed: subtotal − discount + tax + additionalCharges. Equals sellingAmount. */
  grandTotal?: number;
  /** Customer-facing notes (separate from the internal `internalNotes`). */
  customerNotes?: string;
  /** grandTotal − agreed shipment selling price (signed; for the audit trail). */
  agreedPriceDifference?: number;
  /** Reason recorded when grandTotal differs from the agreed selling price. */
  priceDifferenceReason?: string;
}

/**
 * A single customer-facing invoice service line. `amount` is ALWAYS recomputed
 * server-side (quantity × unitPrice) — a browser-supplied amount is never
 * trusted. `serviceType`/`unit` come from the controlled catalog; a custom
 * value is only allowed via the "Other" sentinel (customServiceType/customUnit).
 * Nothing here exposes vendor cost or internal profit.
 */
export interface CustomerInvoiceLine {
  id: string;
  serviceType: string;
  customServiceType?: string;
  description?: string;
  quantity: number;
  /** Optional — the invoice-line UI no longer collects a unit; legacy lines may still carry one. */
  unit?: string;
  customUnit?: string;
  unitPrice: number;
  amount: number;
}

// ═══════════════════════════════════════════════════════════════════
// Customer Payments — account-based (per customer, by company name), not
// per-invoice. A payment is allocated across one or more invoices (auto,
// oldest-first, or manual); any unallocated balance is advance credit.
// Completed payments are never edited/deleted — corrections are reversals.
// Allocation/summary math lives in src/lib/customerPayments.ts.
// ═══════════════════════════════════════════════════════════════════

/** One allocation of a payment to a specific invoice. */
export interface PaymentAllocation {
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
}

export interface CustomerPayment {
  id: string;
  /** Customer identity — the shipment/invoice company name (consistent everywhere). */
  companyName: string;
  clientId?: string;
  amount: number;
  currency: Currency;
  paymentDate: string;
  paymentMethod: string;
  bankAccountId?: string;
  bankAccountSnapshot?: string;
  reference?: string;
  attachmentUrl?: string;
  attachmentName?: string;
  notes?: string;
  /** Current allocations to invoices (replaceable while active). */
  allocations: PaymentAllocation[];
  status: 'active' | 'reversed';
  /** Stable client-supplied retry key (scoped by action) — see idempotency.ts. */
  idempotencyKey?: string;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
  updatedBy?: string;
  reversedBy?: string;
  reversedAt?: string;
  reversalReason?: string;
}

/**
 * A customer-facing acknowledgment of a received payment, generated from a
 * CustomerPayment (one active receipt per payment). Snapshots company/bank
 * at issue time and lists the MAR invoices the payment covered. Voided (not
 * deleted) if the underlying payment is reversed.
 */
export interface PaymentReceipt {
  id: string;
  receiptNumber: string;
  paymentId: string;
  companyName: string;
  clientId?: string;
  amount: number;
  currency: Currency;
  paymentDate: string;
  paymentMethod: string;
  reference?: string;
  bankAccountSnapshot?: string;
  /** Invoices (by MAR-derived number) this payment was allocated to. */
  allocations: PaymentAllocation[];
  /** Snapshot of the issuing company branding at receipt time. */
  companySnapshot?: CompanyProfile;
  status: 'issued' | 'void';
  /** Stable client-supplied retry key (scoped by action) — see idempotency.ts. */
  idempotencyKey?: string;
  issuedBy: string;
  issuedAt: string;
  voidedBy?: string;
  voidedAt?: string;
  voidReason?: string;
}

export interface CostStatement {
  shipmentId: string;
  shipmentNumber: string;
  companyName: string;
  shipmentType: 'land' | 'sea' | 'air';
  date: string;
  currency: Currency;
  totalCost: number;
  /**
   * Expense Paid Amount (Accounting Phase B): money MARAS has PAID toward
   * this shipment's internal costs/vendors. This is strictly the expense
   * side of the ledger — it is NEVER money received from the customer
   * (that is customerReceivedAmount below), and no customer-facing
   * document may present it as a customer payment. The field name is
   * kept for legacy-record compatibility; its meaning is now canonical.
   */
  paidAmount: number;
  remainingBalance: number;
  /** Expense-side status only (paidAmount vs totalCost) — never shown on customer-facing documents. */
  paymentStatus: 'Unpaid' | 'Partial' | 'Paid';
  /**
   * Customer side (Accounting Phase B): total amount MARAS has RECEIVED
   * from the customer for this shipment, in the shipment's agreed
   * currency. Optional because legacy statements predate it — absent
   * always resolves to 0 (resolveCustomerReceivedAmount,
   * src/lib/costStatementMath.ts). Customer receivable/credit and the
   * customer-side payment status are derived from THIS field and the
   * shipment's agreedAmount only.
   */
  customerReceivedAmount?: number;
  /**
   * Optimistic-concurrency revision (Accounting Phase B), mirroring the
   * Shipment revision architecture: new statements start at 1, every
   * successful save increments by exactly one, and a save whose submitted
   * revision doesn't match the stored one is rejected with 409. Legacy
   * statements without the field resolve as revision 1
   * (resolveStatementRevision, src/lib/costStatementMath.ts).
   */
  revision?: number;
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
  /**
   * Accounting Phase B snapshot: the currency the shipment's agreedAmount
   * is denominated in, copied from the authoritative shipment at save
   * time (like agreedAmount itself). Needed so customer-side figures and
   * the internal gross-profit calculation can label — and refuse to mix —
   * currencies correctly without shipment-registry access. Optional for
   * legacy statements.
   */
  agreedCurrency?: Currency;

  // Cost Approval Workflow (PR #6). Optional so legacy statements are
  // safe — absent accountingStatus resolves to "draft"
  // (resolveAccountingStatus, src/lib/costApprovalWorkflow.ts), NEVER
  // final. Separate from paymentStatus above: paymentStatus is the
  // expense money state; these fields are the approval workflow state.
  // The full field set + decision logic live in costApprovalWorkflow.ts
  // (CostApprovalState); mirrored loosely here so the CostStatement type
  // carries them.
  accountingStatus?: string;
  approvalCycle?: number;
  approvalHistory?: unknown[];
  submittedAt?: string;
  submittedBy?: string;
  submittedRevision?: number;
  finalizedAt?: string;
  finalizedBy?: string;
  finalPdfUrl?: string;
  finalPdfStoragePath?: string;
  finalPdfFileName?: string;
  finalPdfGeneratedAt?: string;
  finalPdfGeneratedBy?: string;
  finalPdfStatementRevision?: number;
  finalVersions?: unknown[];
  // Transient finalization reservation (PR #6 idempotency): set atomically
  // with accountingStatus="finalizing" so a crash between PDF storage and
  // closure is recoverable, and a retry resolves to the same identity.
  finalizationKey?: string;
  finalizingAt?: string;
  finalizingBy?: string;
  reopenRequestedBy?: string;
  reopenRequestedAt?: string;
  reopenReason?: string;
}


// ═══════════════════════════════════════════════════════════════════
// Template Settings (Accounting) — Desktop is the source of truth. These
// power document branding + bank details for customer-facing accounting
// documents (invoices, receipts, statements) and the internal cost
// statement PDF. Managed ONLY on Desktop (super-admin); Mobile never edits
// them. Validation + default-bank resolution live in
// src/lib/accountingTemplateSettings.ts.
// ═══════════════════════════════════════════════════════════════════

/** Single company-profile settings document (accountingSettings/company_profile). */
export interface CompanyProfile {
  companyName?: string;
  companyNameEn?: string;
  companyNameAr?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  registrationDetails?: string;
  taxDetails?: string;
  logoUrl?: string;
  stampUrl?: string;
  signatureUrl?: string;
  footerText?: string;
  /** Published version counter — bumped on every save; issued documents
   *  snapshot the profile so template changes never alter historical docs. */
  version?: number;
  updatedAt?: string;
  updatedBy?: string;
}

/** An archived, previously-published company profile version. */
export interface CompanyProfileVersion extends CompanyProfile {
  id: string;
  version: number;
  archivedAt: string;
}

/** A configurable bank account (bankAccounts collection, one doc per account). */
export interface BankAccount {
  id: string;
  bankName: string;
  accountHolderName: string;
  accountNumber: string;
  iban?: string;
  swift?: string;
  currency: Currency;
  branch?: string;
  country?: string;
  additionalInstructions?: string;
  /** Inactive accounts are retained (never deleted) but not selectable/suggested. */
  active: boolean;
  /** At most one active default per currency (enforced server-side). */
  isDefaultForCurrency?: boolean;
  createdAt: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
}


// ═══════════════════════════════════════════════════════════════════
// Driver Alliance Phase 1 — controlled internal freight-offer system.
// NOT an auction: one offer goes to matched available drivers, each
// invited driver submits at most one USD price (or rejects), Operations
// picks exactly one winner, and the winner becomes a normal shipment
// through the EXISTING shipment workflow. All rules are enforced
// server-side (server.ts /api/alliance routes); the pure decision logic
// lives in src/lib/driverAlliance.ts.
// ═══════════════════════════════════════════════════════════════════

export type AllianceOfferStatus =
  /** Created but not yet sent to any driver. */
  | 'draft'
  /** Broadcast to matched drivers; quotes/rejections are being collected. */
  | 'broadcast'
  /** Operations picked one winning driver; a shipment was assigned/created. */
  | 'winner_selected'
  /** Cancelled by Operations before a winner was selected. */
  | 'cancelled'
  /**
   * The quotation window closed (expiresAt passed) with no winner yet.
   * DERIVED, never stored: documents keep 'broadcast' and the API
   * resolves it via resolveOfferStatus at read time, so no scheduler is
   * needed and Operations can still review quotes and select a winner
   * after expiry — only new driver answers are blocked.
   */
  | 'expired';

export interface AllianceOffer {
  id: string;
  status: AllianceOfferStatus;
  pickupCountry: string;
  pickupCity: string;
  deliveryCountry: string;
  deliveryCity: string;
  /** One of TRUCK_TYPES ids — the existing simple truck taxonomy. */
  truckType: string;
  cargoDescription: string;
  expectedLoadingDate: string;
  notes?: string;
  /** Freight mode shown to drivers and used for the created shipment ('land' | 'sea' | 'air'; default land). */
  freightType?: string;
  /** Optional route distance in km, shown to drivers when available. */
  distanceKm?: number;
  /**
   * Quotation window length, chosen by Operations at creation (e.g. 2,
   * 12, 24 hours). The countdown starts at BROADCAST, not creation —
   * expiresAt below is stamped then.
   */
  expiresInHours: number;
  /** Absolute expiry instant (broadcastAt + expiresInHours), set at broadcast. */
  expiresAt?: string;
  /**
   * THE linked MARAS Order (a Shipment record) this quote request
   * sources a driver for. REQUIRED on every offer created since order
   * linking (server-enforced); optional in the type only because legacy
   * offers predate the rule (those can no longer be broadcast or win —
   * see server.ts). Winner selection always assigns THIS order; no new
   * shipment or operational number is ever created by the alliance.
   */
  referenceShipmentId?: string;
  /**
   * The linked Order's MAR reference (MAR-0000-0000) — the ONE
   * user-visible operational number for the whole lifecycle. Snapshot of
   * the order's shipmentNumber; the Order remains authoritative.
   */
  referenceShipmentNumber?: string;
  /**
   * Order-data snapshots copied at request creation for historical
   * accuracy (the linked Order is ALWAYS the authoritative value; these
   * exist so an offer still reads correctly if the order is later
   * edited). Never includes customer identity.
   */
  loadingAddress?: string;
  deliveryAddress?: string;
  /** Cargo weight snapshot — kilograms, the project's existing unit convention (Shipment.cargoWeight). */
  weightKg?: number;
  /** Phase 1 is deliberately USD-only. The server rejects anything else. */
  currency: 'USD';
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  broadcastAt?: string;
  /** Driver ids invited at broadcast time (route+truck+availability match). */
  invitedDriverIds: string[];
  winnerDriverId?: string;
  winnerShipmentId?: string;
  /** The assigned/created shipment's human number, for the admin list. */
  winnerShipmentNumber?: string;
  /**
   * Set at winner selection, when every other (non-rejected) quotation
   * is closed and its driver is told "Another driver has been selected.
   * Thank you for your quotation."
   */
  closedAt?: string;
}

export type AllianceResponseStatus =
  | 'invited'
  | 'viewed'
  | 'quoted'
  | 'rejected'
  /** Closed by the system because Operations selected another driver. */
  | 'closed';

/**
 * One invited driver's participation in one offer. Document id is always
 * `${offerId}_${driverId}` — a natural unique key, so a driver can never
 * hold two responses to the same offer and concurrent submissions target
 * the same document.
 */
export interface AllianceOfferResponse {
  id: string;
  offerId: string;
  driverId: string;
  driverName: string;
  status: AllianceResponseStatus;
  /** USD only; validated server-side (positive, finite, capped). */
  priceUsd?: number;
  note?: string;
  /** Optional free-text reason the driver gave when rejecting. */
  rejectReason?: string;
  invitedAt: string;
  viewedAt?: string;
  respondedAt?: string;
}

export type AllianceAuditAction =
  | 'offer_created'
  | 'offer_broadcast'
  | 'offer_viewed'
  | 'price_submitted'
  | 'offer_rejected'
  | 'winner_selected'
  | 'offer_cancelled';

export interface AllianceAuditEntry {
  id: string;
  action: AllianceAuditAction;
  offerId: string;
  driverId?: string;
  shipmentId?: string;
  userId: string;
  userName: string;
  timestamp: string;
}

/**
 * Driver Alliance Phase 1 — one-active-job lock. One document per driver
 * (document id IS the driverId) claimed transactionally whenever a
 * shipment is assigned to that driver (manual assignment, creation with
 * a driver, or alliance winner selection) and released when the shipment
 * reaches its closing status (Closed for Land, Completed for Sea/Air) or
 * the driver declines the assignment. The claim transaction is what
 * guarantees two concurrent requests can never give one driver two
 * active shipments.
 */
export interface DriverActiveJobLock {
  /** Same as the document id: the driver's id. */
  driverId: string;
  shipmentId: string;
  claimedAt: string;
}
