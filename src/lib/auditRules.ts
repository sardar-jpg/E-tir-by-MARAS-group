/**
 * auditRules.ts — the deterministic rule inventory for MARAS AI's full
 * internal monitoring (PR #131).
 *
 * Every rule is a small pure function over the AuditContext snapshot,
 * REUSING the existing canonical business helpers (assessShipmentDelay,
 * freight-mode status sequences, cost-statement math, shipment-number
 * format) instead of re-deriving any business logic. Evidence strings
 * are short, human-readable, and redacted by construction: no rule ever
 * reads shareToken, password/hash fields, session tokens, or credential
 * values — the one credential-pattern rule reports WHERE a pattern was
 * seen, never the value.
 *
 * Signals the current data model cannot support are NOT faked — see
 * docs/MARAS_AI_MONITORING.md "Known unavailable signals".
 */
import type { CostStatement, Shipment } from "../types";
import type { AuditContext, AuditDetection, AuditRule } from "./auditEngine";
import { assessShipmentDelay, DELAYED_STALE_DAYS } from "./marasAiIntents";
import {
  LAND_STATUS_SEQUENCE,
  SEA_STATUS_SEQUENCE,
  AIR_STATUS_SEQUENCE,
  WAITING_FOR_DRIVER_QUOTES,
  getClosingStatusForFreightMode,
  resolveFreightMode,
} from "./shipmentStatusTransitions";
import { resolveCustomerReceivedAmount, isAllowedCostCurrency } from "./costStatementMath";

// ── Shared vocabulary (single definitions, reused across rules) ──────

const TERMINAL = new Set(["Delivered", "Closed", "Completed"]);
const PRE_DISPATCH = new Set(["New", WAITING_FOR_DRIVER_QUOTES]);
const KNOWN_STATUSES = new Set<string>([
  "New",
  WAITING_FOR_DRIVER_QUOTES,
  ...LAND_STATUS_SEQUENCE,
  ...SEA_STATUS_SEQUENCE,
  ...AIR_STATUS_SEQUENCE,
]);
const CANONICAL_ORDER_NUMBER = /^MAR-\d{4}-\d{4,}$/;
const CREDENTIAL_PATTERN = /(sk-[A-Za-z0-9]{16,})|(AIza[0-9A-Za-z_-]{20,})|(-----BEGIN [A-Z ]*PRIVATE KEY-----)/;

const DAY_MS = 86_400_000;
export const ASSIGNED_NOT_ACCEPTED_DAYS = 2;
export const ACCEPTED_NOT_STARTED_DAYS = 2;
export const STALE_GPS_HOURS = 12;
export const ACCOUNTING_CLOSE_GRACE_DAYS = 14;
export const MAX_EXPECTED_SUPER_ADMINS = 5;
export const MONEY_EPSILON = 0.01;

function daysSince(iso: string | undefined, nowIso: string): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return 0;
  return (new Date(nowIso).getTime() - t) / DAY_MS;
}

function isActive(s: Shipment): boolean {
  return !TERMINAL.has(s.status || "") && !PRE_DISPATCH.has(s.status || "");
}

function ref(s: Shipment): string {
  return s.shipmentNumber || s.id;
}

function shipmentDetections(
  shipments: Shipment[],
  predicate: (s: Shipment) => string | null
): AuditDetection[] {
  const out: AuditDetection[] = [];
  for (const s of shipments) {
    const evidence = predicate(s);
    if (evidence) out.push({ recordType: "shipment", recordId: s.id, recordRef: ref(s), evidence });
  }
  return out;
}

function statementDetections(
  statements: CostStatement[],
  predicate: (st: CostStatement) => string | null
): AuditDetection[] {
  const out: AuditDetection[] = [];
  for (const st of statements) {
    const evidence = predicate(st);
    if (evidence) {
      out.push({ recordType: "costStatement", recordId: st.shipmentId, recordRef: st.shipmentNumber || st.shipmentId, evidence });
    }
  }
  return out;
}

// ── A. Shipment & operations ─────────────────────────────────────────

const operationsRules: AuditRule[] = [
  {
    id: "OPS-001",
    category: "operations",
    title: "Shipment status stale",
    description: `Active shipment with no status change for ${DELAYED_STALE_DAYS}+ days (shared MARAS AI delay heuristic).`,
    severity: "medium",
    scope: "operations",
    recommendedAction: "Contact the assigned driver and update the shipment status, or correct the record if the trip has actually progressed.",
    evaluate: (ctx) =>
      shipmentDetections(ctx.shipments, (s) => {
        if (TERMINAL.has(s.status || "") || PRE_DISPATCH.has(s.status || "")) return null;
        const a = assessShipmentDelay(s, ctx.nowIso);
        return a.delayed && a.reason && a.reason.includes("no status change") ? a.reason : null;
      }),
  },
  {
    id: "OPS-002",
    category: "operations",
    title: "ETA passed, shipment unfinished",
    description: "The shipment's ETA has passed while it has not reached a destination stage.",
    severity: "high",
    scope: "operations",
    recommendedAction: "Verify the real position with the driver/carrier, update the ETA or status, and notify the customer if delivery slips.",
    evaluate: (ctx) =>
      shipmentDetections(ctx.shipments, (s) => {
        if (TERMINAL.has(s.status || "") || PRE_DISPATCH.has(s.status || "")) return null;
        const a = assessShipmentDelay(s, ctx.nowIso);
        return a.delayed && a.reason && a.reason.includes("ETA") ? a.reason : null;
      }),
  },
  {
    id: "OPS-003",
    category: "operations",
    title: "Active shipment without a driver",
    description: "A dispatched land shipment has no assigned driver.",
    severity: "high",
    scope: "operations",
    recommendedAction: "Assign a driver or return the Order to the pre-dispatch stage.",
    evaluate: (ctx) =>
      shipmentDetections(ctx.shipments, (s) =>
        isActive(s) && resolveFreightMode(s.freightType) === "land" && !s.assignedDriverId
          ? `Status "${s.status}" with no assignedDriver.`
          : null
      ),
  },
  {
    id: "OPS-004",
    category: "operations",
    title: "Assignment not accepted",
    description: `Shipment has stayed in "Assigned" for ${ASSIGNED_NOT_ACCEPTED_DAYS}+ days without driver acceptance.`,
    severity: "medium",
    scope: "operations",
    recommendedAction: "Call the driver to confirm, or reassign the Order.",
    evaluate: (ctx) =>
      shipmentDetections(ctx.shipments, (s) =>
        s.status === "Assigned" && daysSince(s.updatedAt || s.createdAt, ctx.nowIso) >= ASSIGNED_NOT_ACCEPTED_DAYS
          ? `"Assigned" for ${Math.floor(daysSince(s.updatedAt || s.createdAt, ctx.nowIso))} days.`
          : null
      ),
  },
  {
    id: "OPS-005",
    category: "operations",
    title: "Accepted but not started",
    description: `Shipment accepted ${ACCEPTED_NOT_STARTED_DAYS}+ days ago without moving to loading/transit.`,
    severity: "medium",
    scope: "operations",
    recommendedAction: "Confirm the loading appointment with the driver and customer.",
    evaluate: (ctx) =>
      shipmentDetections(ctx.shipments, (s) =>
        s.status === "Accepted" && daysSince(s.updatedAt || s.createdAt, ctx.nowIso) >= ACCEPTED_NOT_STARTED_DAYS
          ? `"Accepted" for ${Math.floor(daysSince(s.updatedAt || s.createdAt, ctx.nowIso))} days.`
          : null
      ),
  },
  {
    id: "OPS-006",
    category: "operations",
    title: "Status outside freight-mode sequence",
    description: "The shipment's status is not part of its freight mode's canonical status sequence.",
    severity: "medium",
    scope: "operations",
    recommendedAction: "Correct the status via the shipment's status controls; mixed-mode statuses break stage-based rules.",
    evaluate: (ctx) =>
      shipmentDetections(ctx.shipments, (s) => {
        const status = s.status || "";
        if (PRE_DISPATCH.has(status) || !KNOWN_STATUSES.has(status)) return null; // unknown handled by INT-004
        const mode = resolveFreightMode(s.freightType);
        const sequence =
          mode === "land" ? LAND_STATUS_SEQUENCE : mode === "sea" ? SEA_STATUS_SEQUENCE : AIR_STATUS_SEQUENCE;
        return sequence.includes(s.status) ? null : `Status "${status}" is not in the ${mode} sequence.`;
      }),
  },
  {
    id: "OPS-007",
    category: "operations",
    title: "Delivered without any documents",
    description: "A finished shipment has no documents on file at all (POD/CMR/invoice expected by stage).",
    severity: "high",
    scope: "operations",
    recommendedAction: "Collect and upload the delivery paperwork (CMR/POD at minimum) before closing the file.",
    evaluate: (ctx) =>
      shipmentDetections(ctx.shipments, (s) =>
        TERMINAL.has(s.status || "") && (s.documents || []).length === 0 ? `"${s.status}" with 0 documents.` : null
      ),
  },
  {
    id: "OPS-008",
    category: "operations",
    title: "Delivered land shipment missing CMR/POD",
    description: "A finished land shipment has documents, but none categorized as CMR or proof of delivery.",
    severity: "medium",
    scope: "operations",
    recommendedAction: "Upload the signed CMR / proof-of-delivery document to the shipment.",
    evaluate: (ctx) =>
      shipmentDetections(ctx.shipments, (s) => {
        if (!TERMINAL.has(s.status || "") || resolveFreightMode(s.freightType) !== "land") return null;
        const docs = s.documents || [];
        if (docs.length === 0) return null; // OPS-007 owns the zero-doc case
        const categories = docs.map((d) => `${d.category || ""} ${d.name || ""}`.toLowerCase());
        const hasDelivery = categories.some((c) => c.includes("cmr") || c.includes("pod") || c.includes("proof") || c.includes("delivery"));
        return hasDelivery ? null : `${docs.length} document(s), none matching CMR/POD.`;
      }),
  },
  {
    id: "OPS-009",
    category: "operations",
    title: "Multi-truck assignment incomplete",
    description: "An additional-driver entry is missing its driver or truck, or a multi-container sea Order lists fewer containers than declared.",
    severity: "medium",
    scope: "operations",
    recommendedAction: "Complete the additional truck/driver assignments or correct the declared container count.",
    evaluate: (ctx) =>
      shipmentDetections(ctx.shipments, (s) => {
        if (!isActive(s) && !TERMINAL.has(s.status || "")) return null;
        for (const extra of s.additionalDrivers || []) {
          if (!extra.driverId || !extra.truckNumber) return "additionalDrivers entry missing driverId or truckNumber.";
        }
        if (resolveFreightMode(s.freightType) === "sea" && (s.numberOfContainers || 0) > 1) {
          const listed = (s.containerNumber ? 1 : 0) + (s.additionalContainers || []).length;
          if (listed < (s.numberOfContainers || 0)) {
            return `Declares ${s.numberOfContainers} containers but lists ${listed}.`;
          }
        }
        return null;
      }),
  },
  {
    id: "OPS-010",
    category: "operations",
    title: "Stale GPS during active trip",
    description: `Driver on an active shipment has not reported a location for ${STALE_GPS_HOURS}+ hours.`,
    severity: "medium",
    scope: "operations",
    recommendedAction: "Ask the driver to reopen the app / check GPS permission; verify the trip is actually progressing.",
    evaluate: (ctx) => {
      const activeByDriver = new Map<string, Shipment>();
      for (const s of ctx.shipments) if (isActive(s) && s.assignedDriverId) activeByDriver.set(s.assignedDriverId, s);
      const out: AuditDetection[] = [];
      for (const d of ctx.drivers) {
        const active = activeByDriver.get(d.id);
        if (!active) continue;
        const hours = daysSince(d.lastUpdated, ctx.nowIso) * 24;
        if (!d.lastUpdated || hours >= STALE_GPS_HOURS) {
          out.push({
            recordType: "shipment",
            recordId: active.id,
            recordRef: ref(active),
            evidence: d.lastUpdated
              ? `Driver ${d.name}: last GPS ${Math.floor(hours)}h ago.`
              : `Driver ${d.name}: no GPS position on record.`,
          });
        }
      }
      return out;
    },
  },
];

// ── B. Accounting ────────────────────────────────────────────────────

const accountingRules: AuditRule[] = [
  {
    id: "ACC-001",
    category: "accounting",
    title: "Finished shipment without a cost statement",
    description: "A delivered/closed shipment has no cost statement on record.",
    severity: "high",
    scope: "accounting",
    recommendedAction: "Create the cost statement so the Order's accounting can be closed.",
    evaluate: (ctx) => {
      const withStatement = new Set(ctx.costStatements.map((st) => st.shipmentId));
      return shipmentDetections(ctx.shipments, (s) =>
        TERMINAL.has(s.status || "") && !withStatement.has(s.id) ? `"${s.status}" with no cost statement.` : null
      );
    },
  },
  {
    id: "ACC-002",
    category: "accounting",
    title: "Cost statement has no items",
    description: "The statement exists but contains zero cost items.",
    severity: "medium",
    scope: "accounting",
    recommendedAction: "Enter the Order's cost breakdown or delete-and-recreate via the normal accounting screens.",
    evaluate: (ctx) => statementDetections(ctx.costStatements, (st) => ((st.items || []).length === 0 ? "0 cost items." : null)),
  },
  {
    id: "ACC-003",
    category: "accounting",
    title: "Cost item invalid currency",
    description: "A cost item's currency is missing or not one of the allowed accounting currencies.",
    severity: "medium",
    scope: "accounting",
    recommendedAction: "Correct the item's currency in the cost statement editor.",
    evaluate: (ctx) =>
      statementDetections(ctx.costStatements, (st) => {
        const bad = (st.items || []).filter((i) => !isAllowedCostCurrency(i.currency));
        return bad.length ? `${bad.length} item(s) with missing/invalid currency.` : null;
      }),
  },
  {
    id: "ACC-004",
    category: "accounting",
    title: "Cost item missing supplier/description",
    description: "A cost item has no supplier name or no description — the expense cannot be traced.",
    severity: "low",
    scope: "accounting",
    recommendedAction: "Fill in the supplier and description for every cost item.",
    evaluate: (ctx) =>
      statementDetections(ctx.costStatements, (st) => {
        const bad = (st.items || []).filter((i) => !(i.supplierName || "").trim() || !(i.description || "").trim());
        return bad.length ? `${bad.length} item(s) missing supplier or description.` : null;
      }),
  },
  {
    id: "ACC-005",
    category: "accounting",
    title: "Duplicate cost items",
    description: "Two items in one statement share the same type, description, and amount — a likely double entry.",
    severity: "medium",
    scope: "accounting",
    recommendedAction: "Review the statement and remove the duplicated entry if it is not a genuine repeat cost.",
    evaluate: (ctx) =>
      statementDetections(ctx.costStatements, (st) => {
        const seen = new Set<string>();
        for (const i of st.items || []) {
          const key = `${i.costType}|${(i.description || "").trim().toLowerCase()}|${i.totalAmount}|${i.currency}`;
          if (seen.has(key)) return `Duplicate item: ${i.costType} / ${i.totalAmount} ${i.currency}.`;
          seen.add(key);
        }
        return null;
      }),
  },
  {
    id: "ACC-006",
    category: "accounting",
    title: "Customer revenue not received",
    description: "Finished shipment with an agreed amount but zero recorded customer receipts.",
    severity: "high",
    scope: "accounting",
    recommendedAction: "Follow up the customer receivable and record incoming payments on the statement.",
    evaluate: (ctx) => {
      const terminalIds = new Map(ctx.shipments.filter((s) => TERMINAL.has(s.status || "")).map((s) => [s.id, s]));
      return statementDetections(ctx.costStatements, (st) => {
        const shipment = terminalIds.get(st.shipmentId);
        if (!shipment) return null;
        const agreed = st.agreedAmount ?? shipment.agreedAmount ?? 0;
        return agreed > 0 && resolveCustomerReceivedAmount(st) <= 0
          ? `Agreed ${agreed}, received 0.`
          : null;
      });
    },
  },
  {
    id: "ACC-007",
    category: "accounting",
    title: "Statement totals inconsistent",
    description: "totalCost does not equal the sum of the statement's item amounts.",
    severity: "high",
    scope: "accounting",
    recommendedAction: "Re-save the statement so totals are recomputed, or correct the mismatched item.",
    evaluate: (ctx) =>
      statementDetections(ctx.costStatements, (st) => {
        const items = st.items || [];
        if (!items.length) return null; // ACC-002 owns empty statements
        const sum = items.reduce((acc, i) => acc + (i.totalAmount || 0), 0);
        return Math.abs(sum - (st.totalCost || 0)) > MONEY_EPSILON
          ? `Items sum ${sum.toFixed(2)} != totalCost ${(st.totalCost || 0).toFixed(2)}.`
          : null;
      }),
  },
  {
    id: "ACC-008",
    category: "accounting",
    title: "Remaining balance inconsistent",
    description: "remainingBalance does not equal totalCost - paidAmount.",
    severity: "medium",
    scope: "accounting",
    recommendedAction: "Re-save the statement to recompute the balance.",
    evaluate: (ctx) =>
      statementDetections(ctx.costStatements, (st) =>
        Math.abs((st.remainingBalance || 0) - ((st.totalCost || 0) - (st.paidAmount || 0))) > MONEY_EPSILON
          ? `remaining ${st.remainingBalance} != ${st.totalCost} - ${st.paidAmount}.`
          : null
      ),
  },
  {
    id: "ACC-009",
    category: "accounting",
    title: "Payment status inconsistent",
    description: "The expense payment status contradicts the paid/remaining amounts (e.g. Paid with balance outstanding).",
    severity: "high",
    scope: "accounting",
    recommendedAction: "Correct the payment status or the amounts; exports must never show Paid with money outstanding.",
    evaluate: (ctx) =>
      statementDetections(ctx.costStatements, (st) => {
        const remaining = (st.totalCost || 0) - (st.paidAmount || 0);
        if (st.paymentStatus === "Paid" && remaining > MONEY_EPSILON) return `Marked Paid with ${remaining.toFixed(2)} outstanding.`;
        if (st.paymentStatus === "Unpaid" && (st.paidAmount || 0) > MONEY_EPSILON) return `Marked Unpaid with ${st.paidAmount} already paid.`;
        return null;
      }),
  },
  {
    id: "ACC-010",
    category: "accounting",
    title: "Cost statement orphaned",
    description: "The statement references a shipment id that no longer exists.",
    severity: "high",
    scope: "accounting",
    recommendedAction: "Investigate — statements must always belong to a real Order; restore the shipment or archive the statement per policy.",
    evaluate: (ctx) => {
      const ids = new Set(ctx.shipments.map((s) => s.id));
      return statementDetections(ctx.costStatements, (st) => (!ids.has(st.shipmentId) ? "No shipment with this id exists." : null));
    },
  },
  {
    id: "ACC-011",
    category: "accounting",
    title: "Accounting not closed after delivery",
    description: `Shipment finished ${ACCOUNTING_CLOSE_GRACE_DAYS}+ days ago and its expense side is still not fully paid.`,
    severity: "medium",
    scope: "accounting",
    recommendedAction: "Close out the Order's expenses or record why the balance remains.",
    evaluate: (ctx) => {
      const terminal = new Map(ctx.shipments.filter((s) => TERMINAL.has(s.status || "")).map((s) => [s.id, s]));
      return statementDetections(ctx.costStatements, (st) => {
        const shipment = terminal.get(st.shipmentId);
        if (!shipment || st.paymentStatus === "Paid") return null;
        const days = daysSince(shipment.updatedAt || shipment.createdAt, ctx.nowIso);
        return days >= ACCOUNTING_CLOSE_GRACE_DAYS
          ? `Finished ~${Math.floor(days)} days ago, expense status "${st.paymentStatus}".`
          : null;
      });
    },
  },
];

// ── C. Data integrity ────────────────────────────────────────────────

const dataIntegrityRules: AuditRule[] = [
  {
    id: "INT-001",
    category: "data_integrity",
    title: "Duplicate order number",
    description: "Two shipments share the same canonical order number.",
    severity: "critical",
    scope: "super",
    recommendedAction: "Renumber one record — the MAR number is the single business reference and must be unique.",
    evaluate: (ctx) => {
      const byNumber = new Map<string, Shipment[]>();
      for (const s of ctx.shipments) {
        if (!s.shipmentNumber) continue;
        byNumber.set(s.shipmentNumber, [...(byNumber.get(s.shipmentNumber) || []), s]);
      }
      const out: AuditDetection[] = [];
      for (const [num, list] of byNumber) {
        if (list.length > 1) {
          for (const s of list) {
            out.push({ recordType: "shipment", recordId: s.id, recordRef: num, evidence: `${list.length} shipments share ${num}.` });
          }
        }
      }
      return out;
    },
  },
  {
    id: "INT-002",
    category: "data_integrity",
    title: "Order number not canonical",
    description: "The shipment number does not match the canonical MAR-YYYY-#### format.",
    severity: "low",
    scope: "super",
    recommendedAction: "Correct the shipment number to the canonical format used across chat, accounting, and exports.",
    evaluate: (ctx) =>
      shipmentDetections(ctx.shipments, (s) =>
        s.shipmentNumber && !CANONICAL_ORDER_NUMBER.test(s.shipmentNumber) ? `"${s.shipmentNumber}" is non-canonical.` : null
      ),
  },
  {
    id: "INT-003",
    category: "data_integrity",
    title: "Shipment references missing driver",
    description: "assignedDriverId points at a driver record that does not exist.",
    severity: "high",
    scope: "super",
    recommendedAction: "Reassign a real driver; the dangling reference breaks driver visibility and notifications.",
    evaluate: (ctx) => {
      const ids = new Set(ctx.drivers.map((d) => d.id));
      return shipmentDetections(ctx.shipments, (s) =>
        s.assignedDriverId && !ids.has(s.assignedDriverId) && !TERMINAL.has(s.status || "")
          ? `assignedDriverId "${s.assignedDriverId}" not found.`
          : null
      );
    },
  },
  {
    id: "INT-004",
    category: "data_integrity",
    title: "Unknown shipment status",
    description: "The stored status is not a known ShipmentStatus value.",
    severity: "high",
    scope: "super",
    recommendedAction: "Correct the status — unknown values break stage logic, chat locks, and status transitions.",
    evaluate: (ctx) =>
      shipmentDetections(ctx.shipments, (s) => (!KNOWN_STATUSES.has(s.status || "") ? `Unknown status "${s.status}".` : null)),
  },
  {
    id: "INT-005",
    category: "data_integrity",
    title: "Impossible timestamps",
    description: "updatedAt is earlier than createdAt.",
    severity: "medium",
    scope: "super",
    recommendedAction: "Investigate how the record was written; timestamps drive delay heuristics and sorting.",
    evaluate: (ctx) =>
      shipmentDetections(ctx.shipments, (s) =>
        s.createdAt && s.updatedAt && new Date(s.updatedAt).getTime() < new Date(s.createdAt).getTime()
          ? `updatedAt ${s.updatedAt} < createdAt ${s.createdAt}.`
          : null
      ),
  },
  {
    id: "INT-006",
    category: "data_integrity",
    title: "Notification references missing shipment",
    description: "A recent shipment-scoped notification points at a shipment that does not exist.",
    severity: "low",
    scope: "super",
    recommendedAction: "Usually harmless residue of a deleted Order; investigate only if the volume grows.",
    evaluate: (ctx) => {
      const ids = new Set(ctx.shipments.map((s) => s.id));
      const out: AuditDetection[] = [];
      for (const n of ctx.notifications) {
        if (n.shipmentId && !ids.has(n.shipmentId)) {
          out.push({ recordType: "notification", recordId: n.id, recordRef: n.shipmentNumber || n.id, evidence: `Notification for missing shipment ${n.shipmentId}.` });
        }
      }
      return out;
    },
  },
];

// ── D. Security & permissions (Super Admin only) ─────────────────────

const securityRules: AuditRule[] = [
  {
    id: "SEC-001",
    category: "security",
    title: "Admin record missing role metadata",
    description: "An admin account has no adminType — its permission tier is undefined.",
    severity: "high",
    scope: "super",
    recommendedAction: "Set the admin's type explicitly (super/operation/accounts); undefined tiers default dangerously.",
    evaluate: (ctx) =>
      ctx.admins
        .filter((a) => !a.adminType)
        .map((a) => ({ recordType: "admin", recordId: a.id, recordRef: a.email || a.id, evidence: "adminType missing." })),
  },
  {
    id: "SEC-002",
    category: "security",
    title: "Duplicate admin accounts for one email",
    description: "Two admin accounts share the same email address.",
    severity: "high",
    scope: "super",
    recommendedAction: "Deactivate the duplicate; one identity must map to one privileged account.",
    evaluate: (ctx) => {
      const byEmail = new Map<string, typeof ctx.admins>();
      for (const a of ctx.admins) {
        const email = (a.email || "").trim().toLowerCase();
        if (!email) continue;
        byEmail.set(email, [...(byEmail.get(email) || []), a]);
      }
      const out: AuditDetection[] = [];
      for (const [email, list] of byEmail) {
        if (list.length > 1) {
          for (const a of list) out.push({ recordType: "admin", recordId: a.id, recordRef: email, evidence: `${list.length} accounts share this email.` });
        }
      }
      return out;
    },
  },
  {
    id: "SEC-003",
    category: "security",
    title: "Unusual number of Super Admins",
    description: `More than ${MAX_EXPECTED_SUPER_ADMINS} super-admin accounts exist — verify each one is intended.`,
    severity: "medium",
    scope: "super",
    recommendedAction: "Review the Employees page and demote/remove any super account that should not exist.",
    evaluate: (ctx) => {
      const supers = ctx.admins.filter((a) => a.adminType === "super");
      return supers.length > MAX_EXPECTED_SUPER_ADMINS
        ? [{ recordType: "adminRoster", recordId: "super-admins", recordRef: "Employees", evidence: `${supers.length} super-admin accounts.` }]
        : [];
    },
  },
  {
    id: "SEC-004",
    category: "security",
    title: "Credential-like pattern in stored content",
    description: "A stored free-text field matches a credential/key pattern. The value itself is never included in this finding.",
    severity: "critical",
    scope: "super",
    recommendedAction: "Open the record, remove the credential from the field, and rotate the exposed key immediately.",
    evaluate: (ctx) => {
      const out: AuditDetection[] = [];
      for (const s of ctx.shipments) {
        if (CREDENTIAL_PATTERN.test(s.internalNotes || "")) {
          out.push({ recordType: "shipment", recordId: s.id, recordRef: ref(s), evidence: "Credential-like pattern in internalNotes (value redacted)." });
        }
      }
      for (const log of ctx.activityLogs) {
        if (CREDENTIAL_PATTERN.test(`${log.actionEn || ""} ${log.actionTr || ""} ${log.actionAr || ""}`)) {
          out.push({ recordType: "activityLog", recordId: log.id, recordRef: log.shipmentNumber || log.id, evidence: "Credential-like pattern in an activity log entry (value redacted)." });
        }
      }
      return out;
    },
  },
];

// ── E. Technical & system health (Super Admin only) ──────────────────

const TECH_SEVERITY: Record<string, { severity: AuditRule["severity"]; title: string }> = {
  server_error: { severity: "critical", title: "Repeated backend errors" },
  db_failure: { severity: "high", title: "Database/storage failures" },
  upload_failure: { severity: "high", title: "Document upload failures" },
  notification_failure: { severity: "medium", title: "Notification delivery failures" },
  gps_failure: { severity: "medium", title: "GPS pipeline failures" },
  frontend_error: { severity: "medium", title: "Repeated frontend errors" },
  maras_ai_failure: { severity: "medium", title: "MARAS AI provider failures" },
  slow_request: { severity: "low", title: "Slow API endpoint" },
};

const technicalRules: AuditRule[] = [
  {
    id: "TEC-001",
    category: "technical",
    title: "Monitoring event group active",
    description: "The persistent request monitor recorded this problem group (grouped, restart-surviving telemetry from PR #128).",
    severity: "medium",
    scope: "super",
    recommendedAction: "See the per-group suggested action in the monitoring alert list; the finding mirrors the grouped telemetry.",
    evaluate: (ctx) =>
      ctx.monitoringEvents.map((e) => {
        const meta = TECH_SEVERITY[e.kind] || { severity: "medium" as const, title: "Monitoring event" };
        return {
          recordType: "monitoringEvent",
          recordId: e.key,
          recordRef: e.area,
          severity: meta.severity,
          evidence: `${meta.title}: ${e.title} (${e.area}) x${e.count}, last ${e.lastAt}.`,
        };
      }),
  },
  {
    id: "TEC-002",
    category: "technical",
    title: "Production running on memory fallback",
    description: "The server is serving from the volatile in-memory store in production — all writes are being lost on restart.",
    severity: "critical",
    scope: "super",
    recommendedAction: "Restore Firestore connectivity/credentials immediately; treat as an incident (see docs/MARAS_AI_MONITORING.md).",
    evaluate: (ctx) =>
      ctx.environment.isProduction && ctx.environment.memoryFallback
        ? [{ recordType: "system", recordId: "persistence", recordRef: "server", evidence: "useMemoryFallback=true with NODE_ENV=production." }]
        : [],
  },
  {
    id: "TEC-003",
    category: "technical",
    title: "Audit runs stale",
    description: "No successful audit completed within twice the scheduled interval — the scheduler may be broken.",
    severity: "high",
    scope: "super",
    recommendedAction: "Check the scheduler (Cloud Scheduler job or in-process interval) and the audit lock; run a manual audit.",
    evaluate: (ctx) => {
      const last = ctx.environment.lastSuccessfulRunAt;
      if (!last) return []; // first ever run — nothing stale yet
      const ageMs = new Date(ctx.nowIso).getTime() - new Date(last).getTime();
      return ageMs > 2 * 6 * 60 * 60 * 1000
        ? [{ recordType: "system", recordId: "audit-schedule", recordRef: "audit", evidence: `Last successful audit ${Math.floor(ageMs / 3_600_000)}h ago.` }]
        : [];
    },
  },
];

// ── Registry ─────────────────────────────────────────────────────────

export const AUDIT_RULES: AuditRule[] = [
  ...operationsRules,
  ...accountingRules,
  ...dataIntegrityRules,
  ...securityRules,
  ...technicalRules,
];

/** Bumped whenever the registry's semantics change — persisted on every run record. */
export const AUDIT_RULES_VERSION = "2026-07-18.1";
