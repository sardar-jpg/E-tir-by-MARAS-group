/**
 * dashboardBrief.ts — the unified dashboard's deterministic view model
 * (PR #132): attention KPIs and the MARAS AI Brief content.
 *
 * Everything here is pure and derives from the SAME canonical helpers
 * the rest of the system uses (assessShipmentDelay for "delayed",
 * freight-mode/pre-dispatch vocabulary from the audit rules' shared
 * definitions) — no parallel calculation that could disagree with
 * existing analytics. The deterministic brief ALWAYS renders, with or
 * without OpenAI; the optional AI text only explains it.
 */
import type { Shipment } from "../types";
import { assessShipmentDelay } from "./marasAiIntents";
import { WAITING_FOR_DRIVER_QUOTES, resolveFreightMode } from "./shipmentStatusTransitions";
import type { AuditPrioritySummary } from "./auditEngine";

const TERMINAL = new Set(["Delivered", "Closed", "Completed"]);
const PRE_DISPATCH = new Set(["New", WAITING_FOR_DRIVER_QUOTES]);

// ── Attention KPIs ───────────────────────────────────────────────────

export interface DashboardAttentionKpis {
  delayedShipments: number;
  /** Dispatched, unfinished shipments with zero documents on file. */
  missingDocuments: number;
  /** Dispatched land shipments without an assigned driver. */
  unassignedShipments: number;
  inTransit: number;
  deliveredToday: number;
}

export function buildDashboardAttentionKpis(shipments: Shipment[], nowIso: string): DashboardAttentionKpis {
  const day = nowIso.slice(0, 10);
  const kpis: DashboardAttentionKpis = {
    delayedShipments: 0,
    missingDocuments: 0,
    unassignedShipments: 0,
    inTransit: 0,
    deliveredToday: 0,
  };
  for (const s of shipments) {
    const status = s.status || "";
    if (TERMINAL.has(status)) {
      if ((s.updatedAt || "").startsWith(day)) kpis.deliveredToday += 1;
      continue;
    }
    if (PRE_DISPATCH.has(status)) continue;
    if (assessShipmentDelay(s, nowIso).delayed) kpis.delayedShipments += 1;
    if ((s.documents || []).length === 0) kpis.missingDocuments += 1;
    if (resolveFreightMode(s.freightType) === "land" && !s.assignedDriverId) kpis.unassignedShipments += 1;
    if (status === "In Transit") kpis.inTransit += 1;
  }
  return kpis;
}

// ── Deterministic brief ──────────────────────────────────────────────

export type DashboardBriefStatus = "all_clear" | "attention" | "action_needed";

export interface DashboardBriefLine {
  /** Stable key the UI localizes; count renders beside the label. */
  kind:
    | "delayed_shipments"
    | "missing_documents"
    | "unassigned_shipments"
    | "critical_findings"
    | "high_findings"
    | "accounting_open"
    | "security_technical_open";
  count: number;
}

export interface DeterministicDashboardBrief {
  status: DashboardBriefStatus;
  /** Non-zero concerns only, worst first — the "top priorities for today". */
  priorities: DashboardBriefLine[];
  /** Stable action keys the UI localizes — one per priority kind present. */
  recommendedActions: DashboardBriefLine["kind"][];
  kpis: DashboardAttentionKpis;
  prioritySummary: AuditPrioritySummary;
}

export interface BriefScopeInput {
  kpis: DashboardAttentionKpis;
  prioritySummary: AuditPrioritySummary;
  /** Open accounting-scope findings — included ONLY when the viewer's scope allows accounting. */
  accountingOpenCount: number | null;
  /** Open security+technical findings — Super Admin only, null otherwise. */
  securityTechnicalOpenCount: number | null;
}

/**
 * The deterministic brief: worst concerns first, one recommended action
 * per concern. Restricted categories arrive already scope-filtered
 * (null = not permitted, and therefore never present in the output) —
 * the server decides scope, this function can only narrow.
 */
export function buildDeterministicBrief(input: BriefScopeInput): DeterministicDashboardBrief {
  const priorities: DashboardBriefLine[] = [];
  const push = (kind: DashboardBriefLine["kind"], count: number) => {
    if (count > 0) priorities.push({ kind, count });
  };
  push("critical_findings", input.prioritySummary.critical_now);
  push("high_findings", input.prioritySummary.high_today);
  push("delayed_shipments", input.kpis.delayedShipments);
  push("unassigned_shipments", input.kpis.unassignedShipments);
  push("missing_documents", input.kpis.missingDocuments);
  if (input.securityTechnicalOpenCount !== null) push("security_technical_open", input.securityTechnicalOpenCount);
  if (input.accountingOpenCount !== null) push("accounting_open", input.accountingOpenCount);

  const status: DashboardBriefStatus =
    input.prioritySummary.critical_now > 0 || input.prioritySummary.high_today > 0
      ? "action_needed"
      : priorities.length > 0
        ? "attention"
        : "all_clear";

  return {
    status,
    priorities,
    recommendedActions: priorities.map((p) => p.kind),
    kpis: input.kpis,
    prioritySummary: input.prioritySummary,
  };
}

/**
 * The COMPLETE payload the optional AI explanation receives — a short,
 * already scope-filtered digest. Nothing else about the system is ever
 * sent for the brief (minimum-necessary rule, pinned by tests).
 */
export function buildBriefAiDigest(brief: DeterministicDashboardBrief): string {
  const lines = brief.priorities.map((p) => `  - ${p.kind}: ${p.count}`);
  return [
    "CONTEXT DATA — deterministic dashboard brief (these counts are the ONLY real conditions; never invent findings):",
    `Overall status: ${brief.status}.`,
    `KPIs: delayed=${brief.kpis.delayedShipments}, missingDocs=${brief.kpis.missingDocuments}, unassigned=${brief.kpis.unassignedShipments}, inTransit=${brief.kpis.inTransit}, deliveredToday=${brief.kpis.deliveredToday}.`,
    `Monitoring priorities: critical=${brief.prioritySummary.critical_now}, high=${brief.prioritySummary.high_today}, medium=${brief.prioritySummary.medium_soon}, low=${brief.prioritySummary.low_monitor}.`,
    lines.length ? `Concerns:\n${lines.join("\n")}` : "Concerns: none — operations are clear.",
    "Write a 3-5 sentence operational brief for MARAS management: what matters most today and in what order. Do not add numbers or problems not listed above.",
  ].join("\n");
}

/** Which cached brief a viewer reads/writes — one cache per role scope, never shared across scopes. */
export function briefScopeKeyFor(adminType: string): "super" | "operation" | "accounts" | null {
  if (adminType === "super") return "super";
  if (adminType === "operation") return "operation";
  if (adminType === "accounts") return "accounts";
  return null;
}
