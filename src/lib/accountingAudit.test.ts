import { describe, it, expect } from "vitest";
import {
  AUDIT_ACTIONS, AUDIT_SCHEMA_VERSION, isKnownAuditAction, buildAuditRecord,
  maskAccountValue, maskBankForAudit, diffChangedFields, redactAuditForNonSensitive,
  filterAuditRecords, paginateAudit, escapeCsvCell, buildAuditCsv, type AuditActor, type AuditRecord,
} from "./accountingAudit";

const actor: AuditActor = { actorId: "u1", actorNameSnapshot: "Alice", actorRoleSnapshot: "accounts", actorPermissionSnapshot: ["invoices.issue"], source: "admin_web" };

describe("action registry is centralized + typed", () => {
  it("known actions validate; arbitrary strings do not", () => {
    expect(isKnownAuditAction(AUDIT_ACTIONS.invoiceIssued)).toBe(true);
    expect(isKnownAuditAction("invoice.issued")).toBe(true);
    expect(isKnownAuditAction("some.random_action")).toBe(false);
  });
});

describe("buildAuditRecord — server-authoritative fields", () => {
  it("uses the supplied server clock + resolved actor (not browser input)", () => {
    const rec = buildAuditRecord({ auditId: "a1", nowIso: "2026-07-19T10:00:00Z", actor, action: AUDIT_ACTIONS.invoiceIssued, entityType: "customer_invoice", entityId: "inv1", result: "success", invoiceId: "inv1" });
    expect(rec.occurredAt).toBe("2026-07-19T10:00:00Z");
    expect(rec.actorId).toBe("u1");
    expect(rec.source).toBe("admin_web");
    expect(rec.schemaVersion).toBe(AUDIT_SCHEMA_VERSION);
    expect(rec.id).toBe(rec.auditId);
  });
  it("derives changedFields from a before/after pair", () => {
    const rec = buildAuditRecord({ auditId: "a2", nowIso: "t", actor, action: AUDIT_ACTIONS.bankAccountUpdated, entityType: "bank_account", entityId: "b1", result: "success", beforeSnapshot: { active: true, bankName: "X" }, afterSnapshot: { active: false, bankName: "X" } });
    expect(rec.changedFields).toEqual(["active"]);
  });
  it("never carries undefined keys", () => {
    const rec = buildAuditRecord({ auditId: "a3", nowIso: "t", actor, action: AUDIT_ACTIONS.receiptCreated, entityType: "payment_receipt", entityId: "r1", result: "success" });
    expect(Object.values(rec).every((v) => v !== undefined)).toBe(true);
  });
});

describe("sensitive masking", () => {
  it("masks all but the last 4 of an account value", () => {
    expect(maskAccountValue("0011223344")).toBe("******3344");
    expect(maskAccountValue("12")).toBe("****");
    expect(maskAccountValue(undefined)).toBeUndefined();
  });
  it("bank audit snapshot masks account number + IBAN and drops full values", () => {
    const snap = maskBankForAudit({ id: "b1", bankName: "Trade Bank", currency: "USD", active: true, isDefaultForCurrency: true, accountNumber: "0011223344", iban: "IQ98NBIQ850123456789" });
    expect(snap.accountNumberMasked).toBe("******3344");
    expect((snap.ibanMasked as string).endsWith("6789")).toBe(true);
    const json = JSON.stringify(snap);
    expect(json).not.toContain("0011223344");
    expect(json).not.toContain("IQ98NBIQ850123456789");
  });
});

describe("redaction for non-sensitive viewers", () => {
  it("drops before/after snapshots and metadata", () => {
    const rec = buildAuditRecord({ auditId: "a4", nowIso: "t", actor, action: AUDIT_ACTIONS.bankAccountUpdated, entityType: "bank_account", entityId: "b1", result: "success", beforeSnapshot: { active: true }, afterSnapshot: { active: false }, metadata: { x: 1 } });
    const red = redactAuditForNonSensitive(rec);
    expect((red as any).beforeSnapshot).toBeUndefined();
    expect((red as any).afterSnapshot).toBeUndefined();
    expect(red.action).toBe(AUDIT_ACTIONS.bankAccountUpdated); // core fields kept
  });
});

const mk = (id: string, over: { occurredAt?: string; actorId?: string; action?: any; entityType?: string; entityId?: string; result?: any; invoiceId?: string; reason?: string } = {}): AuditRecord =>
  buildAuditRecord({
    auditId: id, nowIso: over.occurredAt || "2026-07-19T10:00:00Z",
    actor: { ...actor, actorId: over.actorId || actor.actorId },
    action: over.action || AUDIT_ACTIONS.invoiceIssued, entityType: over.entityType || "customer_invoice",
    entityId: over.entityId || "inv", result: over.result || "success", invoiceId: over.invoiceId, reason: over.reason,
  });

describe("filtering + pagination (server-side, bounded)", () => {
  const recs = [
    mk("1", { occurredAt: "2026-07-01T00:00:00Z", action: AUDIT_ACTIONS.invoiceIssued, actorId: "u1", entityType: "customer_invoice", invoiceId: "inv-1" }),
    mk("2", { occurredAt: "2026-07-02T00:00:00Z", action: AUDIT_ACTIONS.customerPaymentCreated, actorId: "u2", entityType: "customer_payment", result: "success" }),
    mk("3", { occurredAt: "2026-07-03T00:00:00Z", action: AUDIT_ACTIONS.invoiceIssueRejected, actorId: "u1", entityType: "customer_invoice", result: "rejected" }),
  ];
  it("filters by date range, actor, action, entity, result", () => {
    expect(filterAuditRecords(recs, { from: "2026-07-02T00:00:00Z" }).length).toBe(2);
    expect(filterAuditRecords(recs, { actorId: "u1" }).length).toBe(2);
    expect(filterAuditRecords(recs, { action: AUDIT_ACTIONS.customerPaymentCreated }).length).toBe(1);
    expect(filterAuditRecords(recs, { entityType: "customer_payment" }).length).toBe(1);
    expect(filterAuditRecords(recs, { result: "rejected" }).length).toBe(1);
  });
  it("newest-first, bounded, stable cursor pagination", () => {
    const p1 = paginateAudit(recs, { limit: 2 });
    expect(p1.records.map((r) => r.auditId)).toEqual(["3", "2"]);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = paginateAudit(recs, { limit: 2, cursor: p1.nextCursor! });
    expect(p2.records.map((r) => r.auditId)).toEqual(["1"]);
    expect(p2.nextCursor).toBeNull();
  });
  it("caps the page size", () => {
    const many = Array.from({ length: 500 }, (_, i) => mk(`m${i}`, { occurredAt: `2026-07-19T10:00:${String(i % 60).padStart(2, "0")}Z` } as any));
    expect(paginateAudit(many, { limit: 9999 }).records.length).toBe(200);
  });
});

describe("CSV export defuses formula injection", () => {
  it("prefixes a leading = + - @ with a single quote", () => {
    expect(escapeCsvCell("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(escapeCsvCell("+1")).toBe("'+1");
    expect(escapeCsvCell("-2")).toBe("'-2");
    expect(escapeCsvCell("@x")).toBe("'@x");
    expect(escapeCsvCell("normal")).toBe("normal");
  });
  it("quotes cells containing commas/quotes/newlines", () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('a"b')).toBe('"a""b"');
  });
  it("buildAuditCsv has a header and no sensitive bank/token columns", () => {
    const csv = buildAuditCsv([mk("1", { reason: "=EVIL()" } as any)]);
    const [header, row] = csv.split("\r\n");
    expect(header).toContain("occurredAt,actorId");
    expect(header).not.toMatch(/accountNumber|iban|token|password/i);
    expect(row).toContain("'=EVIL()"); // reason escaped
  });
});
