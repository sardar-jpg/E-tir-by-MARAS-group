/**
 * accountingAudit.ts — pure logic for the canonical, append-only accounting
 * audit log (Increment 7). One typed action registry, one record shape, and the
 * masking / diffing / filtering / CSV-export helpers. The RECORD is always
 * assembled server-side: actor identity + timestamp come from authenticated
 * server context, never from the browser. No clock, db, or session here — the
 * caller passes the server clock and the resolved actor.
 *
 * The audit log is NOT the financial ledger; it is an immutable history of who
 * did what. It never stores tokens, passwords, secrets, full bank numbers, raw
 * attachment bytes, or complete rendered documents.
 */

export const AUDIT_SCHEMA_VERSION = 1;

export type AuditSource = "admin_web" | "staff_mobile" | "server" | "system";
export type AuditResult = "success" | "rejected" | "failed";

/** Centralized, typed action names — never scatter raw action strings. */
export const AUDIT_ACTIONS = {
  invoiceDraftCreated: "invoice.draft_created",
  invoiceDraftUpdated: "invoice.draft_updated",
  invoiceIssued: "invoice.issued",
  invoiceCancelled: "invoice.cancelled",
  invoiceIssueRejected: "invoice.issue_rejected",
  invoiceEditRejected: "invoice.edit_rejected",
  invoiceStatusRecalculated: "invoice.status_recalculated",
  /** A line-based invoice's grand total differs from the agreed selling price. */
  invoicePriceDifferenceRecorded: "invoice.price_difference_recorded",

  customerPaymentCreated: "customer_payment.created",
  customerPaymentAllocated: "customer_payment.allocated",
  customerPaymentReversed: "customer_payment.reversed",
  customerPaymentOverpaymentRejected: "customer_payment.overpayment_rejected",

  vendorPaymentCreated: "vendor_payment.created",
  vendorPaymentReversed: "vendor_payment.reversed",
  vendorPaymentOverpaymentRejected: "vendor_payment.overpayment_rejected",

  receiptCreated: "receipt.created",

  costStatementFinalized: "cost_statement.finalized",
  costStatementCancelled: "cost_statement.cancelled",

  // Accounting Phase 6 — Financial Closing workflow.
  financialClosed: "financial.closed",
  financialCloseRejected: "financial.close_rejected",
  financialReopenRequested: "financial.reopen_requested",
  financialReopenApproved: "financial.reopen_approved",
  financialReopenRejected: "financial.reopen_rejected",

  reportExported: "report.exported",

  notificationRead: "accounting.notification_read",
  notificationAcknowledged: "accounting.notification_acknowledged",
  notificationDismissed: "accounting.notification_dismissed",
  notificationSettingsUpdated: "accounting.notification_settings_updated",

  bankAccountCreated: "bank_account.created",
  bankAccountUpdated: "bank_account.updated",
  bankAccountDeactivated: "bank_account.deactivated",
  bankAccountDefaultChanged: "bank_account.default_changed",

  companyProfileUpdated: "company_profile.updated",
  companyProfilePublished: "company_profile.published",

  templatePublished: "template.published",
  templateRestored: "template.restored",
  templateDefaultChanged: "template.default_changed",

  attachmentUploaded: "attachment.uploaded",
  attachmentRemoved: "attachment.removed",
  attachmentDownloadRejected: "attachment.download_rejected",

  permissionGranted: "permission.granted",
  permissionRevoked: "permission.revoked",
  permissionBulkChanged: "permission.bulk_changed",

  reconciliationExecuted: "reconciliation.executed",
  reconciliationDiscrepancyFound: "reconciliation.discrepancy_found",
  reconciliationRepairExecuted: "reconciliation.repair_executed",
  reconciliationRepairDenied: "reconciliation.repair_denied",

  documentGenerated: "accounting_document.generated",
  documentAccessRejected: "accounting_document.access_rejected",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

const ALL_ACTIONS = new Set<string>(Object.values(AUDIT_ACTIONS));
export function isKnownAuditAction(a: unknown): a is AuditAction {
  return typeof a === "string" && ALL_ACTIONS.has(a);
}

/** The authenticated actor, resolved from server session context (never body). */
export interface AuditActor {
  actorId: string;
  actorNameSnapshot?: string;
  actorRoleSnapshot?: string;
  actorPermissionSnapshot?: string[];
  source: AuditSource;
}

export interface AuditRecord {
  auditId: string;
  id: string; // === auditId (memory-store parity)
  occurredAt: string;
  actorId: string;
  actorNameSnapshot?: string;
  actorRoleSnapshot?: string;
  actorPermissionSnapshot?: string[];
  action: AuditAction;
  entityType: string;
  entityId: string;
  parentEntityType?: string;
  parentEntityId?: string;
  clientId?: string;
  orderId?: string;
  invoiceId?: string;
  paymentId?: string;
  vendorId?: string;
  currency?: string;
  beforeSnapshot?: Record<string, unknown>;
  afterSnapshot?: Record<string, unknown>;
  changedFields?: string[];
  reason?: string;
  idempotencyKey?: string;
  requestId?: string;
  correlationId?: string;
  source: AuditSource;
  userAgentSummary?: string;
  result: AuditResult;
  errorCode?: string;
  metadata?: Record<string, unknown>;
  schemaVersion: number;
}

const clip = (v: unknown, n = 1000): string | undefined => (typeof v === "string" && v ? v.slice(0, n) : undefined);

/** Mask all but the last 4 characters of a sensitive account identifier. */
export function maskAccountValue(v: unknown): string | undefined {
  if (typeof v !== "string" || !v) return undefined;
  const s = v.replace(/\s+/g, "");
  if (s.length <= 4) return "****";
  return "*".repeat(Math.max(4, s.length - 4)) + s.slice(-4);
}

/** A bank snapshot safe for the audit log — full account number / IBAN masked. */
export function maskBankForAudit(bank: {
  id?: string; bankName?: string; currency?: string; active?: boolean; isDefaultForCurrency?: boolean;
  accountNumber?: string; iban?: string;
}): Record<string, unknown> {
  return {
    bankAccountId: bank.id,
    bankName: bank.bankName,
    currency: bank.currency,
    active: bank.active,
    isDefaultForCurrency: bank.isDefaultForCurrency,
    accountNumberMasked: maskAccountValue(bank.accountNumber),
    ibanMasked: maskAccountValue(bank.iban),
  };
}

/** Field-level diff of two safe snapshots — the keys whose values changed. */
export function diffChangedFields(before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined): string[] {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const changed: string[] = [];
  for (const k of keys) {
    const a = before ? before[k] : undefined;
    const b = after ? after[k] : undefined;
    if (JSON.stringify(a) !== JSON.stringify(b)) changed.push(k);
  }
  return changed.sort();
}

const stripUndefined = <T extends Record<string, unknown>>(o: T): T => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as T;
};

export interface BuildAuditParams {
  auditId: string;
  nowIso: string;
  actor: AuditActor;
  action: AuditAction;
  entityType: string;
  entityId: string;
  result: AuditResult;
  parentEntityType?: string;
  parentEntityId?: string;
  clientId?: string;
  orderId?: string;
  invoiceId?: string;
  paymentId?: string;
  vendorId?: string;
  currency?: string;
  beforeSnapshot?: Record<string, unknown>;
  afterSnapshot?: Record<string, unknown>;
  changedFields?: string[];
  reason?: string;
  idempotencyKey?: string;
  requestId?: string;
  correlationId?: string;
  userAgentSummary?: string;
  errorCode?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Assemble an immutable audit record. Actor identity + occurredAt come from the
 * caller's SERVER context (never the browser). changedFields is derived when a
 * before/after pair is present and none was supplied.
 */
export function buildAuditRecord(params: BuildAuditParams): AuditRecord {
  const changedFields = params.changedFields
    ?? ((params.beforeSnapshot || params.afterSnapshot) ? diffChangedFields(params.beforeSnapshot, params.afterSnapshot) : undefined);
  return stripUndefined({
    auditId: params.auditId,
    id: params.auditId,
    occurredAt: params.nowIso,
    actorId: params.actor.actorId,
    actorNameSnapshot: params.actor.actorNameSnapshot,
    actorRoleSnapshot: params.actor.actorRoleSnapshot,
    actorPermissionSnapshot: params.actor.actorPermissionSnapshot,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    parentEntityType: params.parentEntityType,
    parentEntityId: params.parentEntityId,
    clientId: params.clientId,
    orderId: params.orderId,
    invoiceId: params.invoiceId,
    paymentId: params.paymentId,
    vendorId: params.vendorId,
    currency: params.currency,
    beforeSnapshot: params.beforeSnapshot,
    afterSnapshot: params.afterSnapshot,
    changedFields,
    reason: clip(params.reason),
    idempotencyKey: params.idempotencyKey,
    requestId: params.requestId,
    correlationId: params.correlationId,
    source: params.actor.source,
    userAgentSummary: clip(params.userAgentSummary, 200),
    result: params.result,
    errorCode: params.errorCode,
    metadata: params.metadata,
    schemaVersion: AUDIT_SCHEMA_VERSION,
  }) as AuditRecord;
}

/** Non-privileged view: drop the before/after snapshots (masked-field detail). */
export function redactAuditForNonSensitive(rec: AuditRecord): AuditRecord {
  const { beforeSnapshot: _b, afterSnapshot: _a, metadata: _m, ...rest } = rec;
  return rest as AuditRecord;
}

export interface AuditFilters {
  from?: string; // occurredAt >=
  to?: string; // occurredAt <=
  actorId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  reference?: string; // matches order/invoice/payment/entity ids loosely
  clientId?: string;
  result?: AuditResult;
  source?: AuditSource;
}

/** Server-side filter (never send the whole collection to the browser). */
export function filterAuditRecords(records: AuditRecord[], f: AuditFilters): AuditRecord[] {
  const ref = (f.reference || "").toLowerCase();
  return records.filter((r) => {
    if (f.from && r.occurredAt < f.from) return false;
    if (f.to && r.occurredAt > f.to) return false;
    if (f.actorId && r.actorId !== f.actorId) return false;
    if (f.action && r.action !== f.action) return false;
    if (f.entityType && r.entityType !== f.entityType) return false;
    if (f.entityId && r.entityId !== f.entityId) return false;
    if (f.clientId && r.clientId !== f.clientId) return false;
    if (f.result && r.result !== f.result) return false;
    if (f.source && r.source !== f.source) return false;
    if (ref) {
      const hay = [r.entityId, r.orderId, r.invoiceId, r.paymentId, r.vendorId, r.entityType].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(ref)) return false;
    }
    return true;
  });
}

/** Stable newest-first ordering key. */
function sortKey(r: AuditRecord): string {
  return `${r.occurredAt}|${r.auditId}`;
}

export interface AuditPage {
  records: AuditRecord[];
  nextCursor: string | null;
}

/**
 * Newest-first, cursor-paginated. The cursor is the last item's `${occurredAt}|
 * ${auditId}` — stable and bounded (never loads the whole collection client-side).
 */
export function paginateAudit(records: AuditRecord[], opts: { limit?: number; cursor?: string }): AuditPage {
  const limit = Math.max(1, Math.min(200, opts.limit || 50));
  const sorted = [...records].sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : sortKey(a) > sortKey(b) ? -1 : 0));
  const start = opts.cursor ? sorted.findIndex((r) => sortKey(r) < opts.cursor!) : 0;
  const from = start < 0 ? sorted.length : start;
  const slice = sorted.slice(from, from + limit);
  const nextCursor = from + limit < sorted.length && slice.length ? sortKey(slice[slice.length - 1]) : null;
  return { records: slice, nextCursor };
}

/**
 * Escape a CSV cell, defusing spreadsheet formula injection: a value beginning
 * with = + - @ (or tab/CR) is prefixed with a single quote, then the whole cell
 * is double-quote-escaped.
 */
export function escapeCsvCell(value: unknown): string {
  let s = value === undefined || value === null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export const AUDIT_CSV_COLUMNS = [
  "occurredAt", "actorId", "actorNameSnapshot", "actorRoleSnapshot", "action",
  "entityType", "entityId", "invoiceId", "paymentId", "vendorId", "clientId",
  "currency", "result", "errorCode", "reason", "source", "requestId", "correlationId",
] as const;

/** Build a safe CSV (no sensitive bank/auth data; formula-injection defused). */
export function buildAuditCsv(records: AuditRecord[]): string {
  const header = AUDIT_CSV_COLUMNS.join(",");
  const rows = records.map((r) =>
    AUDIT_CSV_COLUMNS.map((c) => escapeCsvCell((r as any)[c])).join(",")
  );
  return [header, ...rows].join("\r\n");
}
