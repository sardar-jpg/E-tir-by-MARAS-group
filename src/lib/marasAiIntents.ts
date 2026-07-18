/**
 * marasAiIntents.ts — system-awareness for MARAS AI (PR #128 refinement).
 *
 * Before any prompt reaches OpenAI, the server inspects the employee's
 * request here: detectMarasAiIntents() decides WHAT the request is about,
 * requiredDataForIntents() decides WHICH backend collections must be
 * fetched first, and buildSystemContextBlocks() turns the fetched records
 * into compact, WHITELIST-only CONTEXT DATA digests the model can analyze
 * — so "Which shipments are delayed?" is answered from real shipment
 * data, never with "please provide shipment information".
 *
 * Everything is pure (records in, strings out) and keyword tables are
 * data, not hardcoded sentences — adding an intent is one table row plus
 * one builder. Like marasAiCore's shipment digest, builders read only
 * explicitly named operational fields: shareToken, session tokens, and
 * password material are never touched, so they can never leak into a
 * prompt.
 */
import type { AppNotification, CostStatement, Driver, Shipment } from "../types";
import type { MonitoringAlertForAi } from "./marasAiCore";

// ── Intent detection ─────────────────────────────────────────────────

export type MarasAiIntent =
  | "delayed_shipments"
  | "shipments_overview"
  | "driver_performance"
  | "missing_documents"
  | "todays_operations"
  | "monitoring_alerts"
  | "accounting_summary"
  | "operational_risks"
  | "audit_findings";

/**
 * Keyword table — each intent fires when ANY of its patterns matches the
 * (lowercased) message. Patterns include the common English phrasings
 * plus the Turkish/Arabic operational terms MARAS staff actually use.
 */
const INTENT_PATTERNS: Record<MarasAiIntent, RegExp[]> = {
  delayed_shipments: [
    /delay|late|overdue|stuck|behind schedule|gecik|مت[أا]خر|تأخير/,
  ],
  shipments_overview: [
    /shipment|order|cargo|transit|sevkiyat|yük|شحن|طلب/,
  ],
  driver_performance: [
    /driver|trucker|şoför|sürücü|سائق|performance.*driver|driver.*performance/,
  ],
  missing_documents: [
    /document|paperwork|cmr|invoice|belge|evrak|مستند|وثيق|فاتور/,
  ],
  todays_operations: [
    /today|daily|bugün|اليوم|this morning|right now|current operations/,
  ],
  monitoring_alerts: [
    /monitor|alert|error|failure|technical|system health|incident|uyarı|hata|خطأ|تنبيه/,
  ],
  accounting_summary: [
    /account|cost|payment|paid|unpaid|balance|invoice|profit|revenue|muhasebe|maliyet|ödeme|محاسب|تكلفة|دفع/,
  ],
  operational_risks: [
    /risk|problem|issue|attention|concern|risk review|sorun|مخاطر|مشكل/,
  ],
  audit_findings: [
    /audit|finding|critical problems|fix first|inconsisten|suspicious|integrity|denetim|bulgu|تدقيق|نتائج/,
  ],
};

export function detectMarasAiIntents(message: string): MarasAiIntent[] {
  const text = message.toLowerCase();
  const intents: MarasAiIntent[] = [];
  for (const intent of Object.keys(INTENT_PATTERNS) as MarasAiIntent[]) {
    if (INTENT_PATTERNS[intent].some((p) => p.test(text))) intents.push(intent);
  }
  return intents;
}

// ── Data requirements ────────────────────────────────────────────────

export interface MarasAiDataNeeds {
  shipments: boolean;
  drivers: boolean;
  notifications: boolean;
  costStatements: boolean;
  monitoring: boolean;
  /** PR #131: persisted deterministic audit findings (scope-filtered by the server per role). */
  auditFindings: boolean;
}

const INTENT_DATA: Record<MarasAiIntent, Partial<MarasAiDataNeeds>> = {
  delayed_shipments: { shipments: true },
  shipments_overview: { shipments: true },
  driver_performance: { drivers: true, shipments: true },
  missing_documents: { shipments: true },
  todays_operations: { shipments: true, notifications: true },
  monitoring_alerts: { monitoring: true },
  accounting_summary: { costStatements: true },
  operational_risks: { shipments: true, monitoring: true },
  audit_findings: { auditFindings: true },
};

export function requiredDataForIntents(intents: MarasAiIntent[]): MarasAiDataNeeds {
  const needs: MarasAiDataNeeds = { shipments: false, drivers: false, notifications: false, costStatements: false, monitoring: false, auditFindings: false };
  for (const intent of intents) Object.assign(needs, INTENT_DATA[intent]);
  return needs;
}

// ── Delay heuristic ──────────────────────────────────────────────────

/** Statuses where a shipment is finished — never counted as delayed. */
const TERMINAL_STATUSES = new Set(["Delivered", "Closed", "Completed"]);
/** Pre-dispatch statuses — waiting, not delayed in the operational sense. */
const PRE_DISPATCH_STATUSES = new Set(["New", "Waiting for Driver Quotes"]);

/** An active shipment whose status hasn't moved for this long is flagged as possibly delayed. */
export const DELAYED_STALE_DAYS = 3;

export interface DelayAssessment {
  delayed: boolean;
  reason: string | null;
  daysSinceUpdate: number;
}

/**
 * Honest heuristic, stated as such in the digest: a shipment is flagged
 * when it is in an active (dispatched, unfinished) stage and either its
 * status hasn't changed for DELAYED_STALE_DAYS+, or its ETA has passed
 * while it still isn't at destination. The AI explains; it never invents.
 */
export function assessShipmentDelay(shipment: Shipment, nowIso: string): DelayAssessment {
  const now = new Date(nowIso).getTime();
  const updatedAt = shipment.updatedAt || shipment.createdAt || nowIso;
  const daysSinceUpdate = Math.max(0, Math.floor((now - new Date(updatedAt).getTime()) / 86_400_000));
  const status = shipment.status || "";
  if (TERMINAL_STATUSES.has(status) || PRE_DISPATCH_STATUSES.has(status)) {
    return { delayed: false, reason: null, daysSinceUpdate };
  }
  if (shipment.eta && new Date(shipment.eta).getTime() < now && !["Arrived", "Arrived at Port", "Arrived Airport", "Out for Delivery", "Released"].includes(status)) {
    return { delayed: true, reason: `ETA ${shipment.eta} has passed while status is still "${status}"`, daysSinceUpdate };
  }
  if (daysSinceUpdate >= DELAYED_STALE_DAYS) {
    return { delayed: true, reason: `no status change for ${daysSinceUpdate} days (status "${status}")`, daysSinceUpdate };
  }
  return { delayed: false, reason: null, daysSinceUpdate };
}

// ── Context builders (whitelist only) ────────────────────────────────

const MAX_DIGEST_LINES = 40;

function shipmentLine(s: Shipment): string {
  return `  - ${s.shipmentNumber || s.id}: ${s.status} | ${s.loadingCity || "?"} -> ${s.deliveryCity || "?"} | driver: ${s.assignedDriverName || "unassigned"} | customer: ${s.companyName || "?"} | updated ${s.updatedAt || s.createdAt || "?"}`;
}

export function buildDelayedShipmentsAiContext(shipments: Shipment[], nowIso: string): string {
  const flagged = shipments
    .map((s) => ({ s, a: assessShipmentDelay(s, nowIso) }))
    .filter((x) => x.a.delayed)
    .sort((x, y) => y.a.daysSinceUpdate - x.a.daysSinceUpdate)
    .slice(0, MAX_DIGEST_LINES);
  if (flagged.length === 0) {
    return `CONTEXT DATA — delayed shipments (heuristic: active status unchanged ${DELAYED_STALE_DAYS}+ days, or ETA passed): none of the ${shipments.length} shipments on record are currently flagged as delayed.`;
  }
  const lines = flagged.map((x) => `${shipmentLine(x.s)} | flagged: ${x.a.reason}`);
  return `CONTEXT DATA — delayed shipments (heuristic: active status unchanged ${DELAYED_STALE_DAYS}+ days, or ETA passed; ${flagged.length} of ${shipments.length} flagged):\n${lines.join("\n")}`;
}

export function buildShipmentsOverviewAiContext(shipments: Shipment[]): string {
  const byStatus = new Map<string, number>();
  for (const s of shipments) byStatus.set(s.status || "?", (byStatus.get(s.status || "?") || 0) + 1);
  const counts = [...byStatus.entries()].sort((a, b) => b[1] - a[1]).map(([st, n]) => `${st}: ${n}`).join(", ");
  const active = shipments
    .filter((s) => !TERMINAL_STATUSES.has(s.status || ""))
    .sort((a, b) => ((a.updatedAt || a.createdAt || "") < (b.updatedAt || b.createdAt || "") ? 1 : -1))
    .slice(0, MAX_DIGEST_LINES);
  return `CONTEXT DATA — shipments overview (${shipments.length} total; by status: ${counts || "none"}):\n${active.map(shipmentLine).join("\n") || "  (no active shipments)"}`;
}

export function buildDriverPerformanceAiContext(drivers: Driver[], shipments: Shipment[], nowIso: string): string {
  const rows = drivers
    .map((d) => {
      const own = shipments.filter((s) => s.assignedDriverId === d.id || (s.additionalDriverIds || []).includes(d.id));
      const active = own.filter((s) => !TERMINAL_STATUSES.has(s.status || "") && !PRE_DISPATCH_STATUSES.has(s.status || ""));
      const delayed = active.filter((s) => assessShipmentDelay(s, nowIso).delayed);
      return { d, active: active.length, delayed: delayed.length, completed: d.completedShipmentsCount || own.filter((s) => TERMINAL_STATUSES.has(s.status || "")).length };
    })
    .sort((a, b) => b.delayed - a.delayed || b.active - a.active)
    .slice(0, 25);
  const lines = rows.map((r) => `  - ${r.d.name} (truck ${r.d.truckNumber || "?"}): active ${r.active}, delayed ${r.delayed}, completed ${r.completed}`);
  return `CONTEXT DATA — driver performance (${drivers.length} drivers; delayed counts use the same heuristic as the delayed-shipments digest):\n${lines.join("\n") || "  (no drivers on record)"}`;
}

export function buildMissingDocumentsAiContext(shipments: Shipment[]): string {
  const active = shipments.filter((s) => !TERMINAL_STATUSES.has(s.status || ""));
  const rows = active
    .map((s) => {
      const docs = s.documents || [];
      const categories = [...new Set(docs.map((d) => d.category || "other"))];
      return { s, docCount: docs.length, categories };
    })
    .sort((a, b) => a.docCount - b.docCount)
    .slice(0, MAX_DIGEST_LINES);
  const lines = rows.map((r) =>
    `  - ${r.s.shipmentNumber || r.s.id} (${r.s.status}): ${r.docCount === 0 ? "NO documents on file" : `${r.docCount} document(s): ${r.categories.join(", ")}`}`
  );
  return `CONTEXT DATA — shipment documents on file (${active.length} active shipments, fewest documents first):\n${lines.join("\n") || "  (no active shipments)"}`;
}

export function buildTodaysOperationsAiContext(shipments: Shipment[], notifications: AppNotification[], nowIso: string): string {
  const day = nowIso.slice(0, 10);
  const createdToday = shipments.filter((s) => (s.createdAt || "").startsWith(day));
  const updatedToday = shipments.filter((s) => (s.updatedAt || "").startsWith(day) && !(s.createdAt || "").startsWith(day));
  const notifsToday = notifications.filter((n) => (n.timestamp || "").startsWith(day));
  const byType = new Map<string, number>();
  for (const n of notifsToday) byType.set(n.type, (byType.get(n.type) || 0) + 1);
  const parts = [
    `CONTEXT DATA — today's operations (${day}):`,
    `Shipments created today (${createdToday.length}):\n${createdToday.slice(0, 20).map(shipmentLine).join("\n") || "  none"}`,
    `Shipments updated today (${updatedToday.length}):\n${updatedToday.slice(0, 20).map(shipmentLine).join("\n") || "  none"}`,
    `Notifications today (${notifsToday.length} total): ${[...byType.entries()].map(([t, n]) => `${t}: ${n}`).join(", ") || "none"}`,
  ];
  return parts.join("\n");
}

export function buildAccountingAiContext(statements: CostStatement[]): string {
  const byCurrency = new Map<string, { total: number; paid: number; remaining: number; received: number; count: number }>();
  const byStatus = new Map<string, number>();
  for (const st of statements) {
    const c = byCurrency.get(st.currency) || { total: 0, paid: 0, remaining: 0, received: 0, count: 0 };
    c.total += st.totalCost || 0;
    c.paid += st.paidAmount || 0;
    c.remaining += st.remainingBalance || 0;
    c.received += st.customerReceivedAmount || 0;
    c.count += 1;
    byCurrency.set(st.currency, c);
    byStatus.set(st.paymentStatus || "?", (byStatus.get(st.paymentStatus || "?") || 0) + 1);
  }
  const totals = [...byCurrency.entries()]
    .map(([cur, c]) => `  - ${cur} (${c.count} statements): total cost ${c.total}, expenses paid ${c.paid}, remaining ${c.remaining}, received from customers ${c.received}`)
    .join("\n");
  const open = statements
    .filter((st) => st.paymentStatus !== "Paid")
    .sort((a, b) => (b.remainingBalance || 0) - (a.remainingBalance || 0))
    .slice(0, 15)
    .map((st) => `  - ${st.shipmentNumber}: total ${st.totalCost} ${st.currency}, paid ${st.paidAmount}, remaining ${st.remainingBalance} (${st.paymentStatus})`);
  return [
    `CONTEXT DATA — accounting summary (${statements.length} cost statements; internal financial data, MARAS staff only):`,
    totals || "  (no cost statements on record)",
    `By expense payment status: ${[...byStatus.entries()].map(([s, n]) => `${s}: ${n}`).join(", ") || "none"}`,
    open.length ? `Open (not fully paid) statements, largest remaining first:\n${open.join("\n")}` : "Open statements: none",
  ].join("\n");
}

// ── Dispatch ─────────────────────────────────────────────────────────

export interface MarasAiSystemData {
  shipments?: Shipment[];
  drivers?: Driver[];
  notifications?: AppNotification[];
  costStatements?: CostStatement[];
}

/**
 * One digest block per detected intent, from the data the server
 * collected. Monitoring is NOT built here — its digest is Super-Admin
 * gated in server.ts (buildMonitoringAiContext) and never leaves that
 * gate.
 */
export function buildSystemContextBlocks(intents: MarasAiIntent[], data: MarasAiSystemData, nowIso: string): string[] {
  const blocks: string[] = [];
  const shipments = data.shipments || [];
  for (const intent of intents) {
    switch (intent) {
      case "delayed_shipments":
        blocks.push(buildDelayedShipmentsAiContext(shipments, nowIso));
        break;
      case "shipments_overview":
        blocks.push(buildShipmentsOverviewAiContext(shipments));
        break;
      case "driver_performance":
        blocks.push(buildDriverPerformanceAiContext(data.drivers || [], shipments, nowIso));
        break;
      case "missing_documents":
        blocks.push(buildMissingDocumentsAiContext(shipments));
        break;
      case "todays_operations":
        blocks.push(buildTodaysOperationsAiContext(shipments, data.notifications || [], nowIso));
        break;
      case "operational_risks":
        blocks.push(buildDelayedShipmentsAiContext(shipments, nowIso), buildMissingDocumentsAiContext(shipments));
        break;
      case "accounting_summary":
        blocks.push(buildAccountingAiContext(data.costStatements || []));
        break;
      case "monitoring_alerts":
        // Handled (and Super-Admin gated) in server.ts.
        break;
    }
  }
  // operational_risks + delayed_shipments/missing_documents can both add
  // the same digest — keep each block once.
  return [...new Set(blocks)];
}

// ── Structured results (PR #130 — presentation only) ─────────────────
//
// Typed payloads for the drawer's card rendering, derived from the SAME
// authoritative records the server already collected for the detected
// intents — never parsed back out of the model's Markdown, and carrying
// only the whitelisted operational fields the text digests already use
// (shareToken/credentials are never read here either). The AI text stays
// the narrative; these are the data the narrative is about.

export type MarasAiSeverityTag = "info" | "warning" | "critical";

export interface MarasAiShipmentCardItem {
  id: string;
  shipmentNumber: string;
  status: string;
  originCity: string | null;
  destinationCity: string | null;
  driverName: string | null;
  companyName: string | null;
  updatedAt: string | null;
  /** Why this shipment is listed (delay reason, "no documents on file", …). */
  reason: string | null;
  severity: MarasAiSeverityTag;
}

export interface MarasAiDriverCardItem {
  driverName: string;
  truckNumber: string | null;
  activeCount: number;
  delayedCount: number;
  completedCount: number;
}

export interface MarasAiAlertCardItem {
  title: string;
  severity: string;
  area: string;
  count: number;
  time: string;
  suggestedAction: string;
}

/** PR #131: one deterministic audit finding, reduced to card/AI-digest fields (already redacted at detection time). */
export interface MarasAiAuditFindingCardItem {
  ruleId: string;
  title: string;
  severity: string;
  category: string;
  status: string;
  recordType: string;
  recordId: string;
  recordRef: string;
  evidence: string;
  recommendedAction: string;
  lastSeenAt: string;
  occurrenceCount: number;
  /** PR #131 follow-up: the deterministic recommended-priority assessment (server-computed, never AI-invented). */
  priority?: string;
  priorityLabel?: string;
  responseTarget?: string;
  priorityReason?: string;
}

export type MarasAiStructuredResult =
  | { responseType: "delayed_shipments" | "shipments_overview" | "missing_documents" | "operational_risks"; totalCount: number; shipments: MarasAiShipmentCardItem[] }
  | { responseType: "driver_performance"; totalCount: number; drivers: MarasAiDriverCardItem[] }
  | { responseType: "monitoring_alerts"; totalCount: number; alerts: MarasAiAlertCardItem[] }
  | { responseType: "audit_findings"; totalCount: number; findings: MarasAiAuditFindingCardItem[] };

/** Card caps keep responses light and conversation documents small. */
export const MARAS_AI_MAX_CARD_ITEMS = 15;

function toShipmentCard(s: Shipment, reason: string | null, severity: MarasAiSeverityTag): MarasAiShipmentCardItem {
  return {
    id: s.id,
    shipmentNumber: s.shipmentNumber || s.id,
    status: s.status || "?",
    originCity: s.loadingCity || null,
    destinationCity: s.deliveryCity || null,
    driverName: s.assignedDriverName || null,
    companyName: s.companyName || null,
    updatedAt: s.updatedAt || s.createdAt || null,
    reason,
    severity,
  };
}

/**
 * One structured result per supported intent, from the collected data.
 * Monitoring alerts are deliberately NOT built here — the server appends
 * them inside its existing Super-Admin gate (buildMonitoringAlertsResult)
 * so the role restriction has exactly one owner.
 */
export function buildStructuredMarasAiResults(
  intents: MarasAiIntent[],
  data: MarasAiSystemData,
  nowIso: string
): MarasAiStructuredResult[] {
  const results: MarasAiStructuredResult[] = [];
  const shipments = data.shipments || [];
  const seen = new Set<string>();

  for (const intent of intents) {
    if (seen.has(intent)) continue;
    seen.add(intent);
    switch (intent) {
      case "delayed_shipments":
      case "operational_risks": {
        const flagged = shipments
          .map((s) => ({ s, a: assessShipmentDelay(s, nowIso) }))
          .filter((x) => x.a.delayed)
          .sort((x, y) => y.a.daysSinceUpdate - x.a.daysSinceUpdate);
        results.push({
          responseType: intent,
          totalCount: flagged.length,
          shipments: flagged.slice(0, MARAS_AI_MAX_CARD_ITEMS).map((x) => toShipmentCard(x.s, x.a.reason, "critical")),
        });
        break;
      }
      case "shipments_overview": {
        const active = shipments
          .filter((s) => !TERMINAL_STATUSES.has(s.status || ""))
          .sort((a, b) => ((a.updatedAt || a.createdAt || "") < (b.updatedAt || b.createdAt || "") ? 1 : -1));
        results.push({
          responseType: "shipments_overview",
          totalCount: active.length,
          shipments: active.slice(0, MARAS_AI_MAX_CARD_ITEMS).map((s) => {
            const delay = assessShipmentDelay(s, nowIso);
            return toShipmentCard(s, delay.delayed ? delay.reason : null, delay.delayed ? "warning" : "info");
          }),
        });
        break;
      }
      case "missing_documents": {
        const missing = shipments.filter(
          (s) => !TERMINAL_STATUSES.has(s.status || "") && !PRE_DISPATCH_STATUSES.has(s.status || "") && (s.documents || []).length === 0
        );
        results.push({
          responseType: "missing_documents",
          totalCount: missing.length,
          shipments: missing.slice(0, MARAS_AI_MAX_CARD_ITEMS).map((s) => toShipmentCard(s, "No documents on file", "warning")),
        });
        break;
      }
      case "driver_performance": {
        const rows = (data.drivers || [])
          .map((d) => {
            const own = shipments.filter((s) => s.assignedDriverId === d.id || (s.additionalDriverIds || []).includes(d.id));
            const active = own.filter((s) => !TERMINAL_STATUSES.has(s.status || "") && !PRE_DISPATCH_STATUSES.has(s.status || ""));
            return {
              driverName: d.name,
              truckNumber: d.truckNumber || null,
              activeCount: active.length,
              delayedCount: active.filter((s) => assessShipmentDelay(s, nowIso).delayed).length,
              completedCount: d.completedShipmentsCount || 0,
            };
          })
          .sort((a, b) => b.delayedCount - a.delayedCount || b.activeCount - a.activeCount);
        results.push({
          responseType: "driver_performance",
          totalCount: rows.length,
          drivers: rows.slice(0, MARAS_AI_MAX_CARD_ITEMS),
        });
        break;
      }
      default:
        break;
    }
  }
  return results;
}

const SEVERITY_ORDER: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

/**
 * PR #131 — deterministic audit findings as system data for MARAS AI.
 * The server passes findings ALREADY scope-filtered for the requesting
 * role; this builder only sorts (worst first), caps, and digests. The
 * AI is explicitly told these are the only real findings, so it can
 * explain and prioritize but never invent.
 */
export function buildAuditFindingsResult(findings: MarasAiAuditFindingCardItem[]): MarasAiStructuredResult {
  const sorted = [...findings].sort(
    (a, b) => (SEVERITY_ORDER[b.severity] || 0) - (SEVERITY_ORDER[a.severity] || 0) || (a.lastSeenAt < b.lastSeenAt ? 1 : -1)
  );
  return { responseType: "audit_findings", totalCount: findings.length, findings: sorted.slice(0, MARAS_AI_MAX_CARD_ITEMS) };
}

export function buildAuditFindingsAiContext(findings: MarasAiAuditFindingCardItem[]): string {
  if (findings.length === 0) {
    return "CONTEXT DATA — internal audit findings: the deterministic audit currently reports NO open findings for your role's scope. These deterministic findings are the ONLY real findings; do not invent others. General advice must be clearly labeled as a suggestion, not a detected finding.";
  }
  const PRIORITY_ORDER: Record<string, number> = { critical_now: 4, high_today: 3, medium_soon: 2, low_monitor: 1 };
  const sorted = [...findings].sort(
    (a, b) =>
      (PRIORITY_ORDER[b.priority || ""] || 0) - (PRIORITY_ORDER[a.priority || ""] || 0) ||
      (SEVERITY_ORDER[b.severity] || 0) - (SEVERITY_ORDER[a.severity] || 0)
  );
  const lines = sorted
    .slice(0, 30)
    .map((f) => {
      const prio = f.priorityLabel ? ` PRIORITY: ${f.priorityLabel} (respond ${f.responseTarget}) because ${f.priorityReason}` : "";
      return `  - [${f.severity.toUpperCase()}] ${f.ruleId} ${f.title} (${f.recordRef}, seen x${f.occurrenceCount}, status ${f.status}): ${f.evidence}${prio} Suggested: ${f.recommendedAction}`;
    });
  return `CONTEXT DATA — internal audit findings (deterministic backend rules, ${findings.length} in your role's scope, ordered by the deterministic Recommended Priority engine; these are the ONLY real findings and the ONLY real priorities — never invent findings or priorities, only explain the given reasons; label any general advice as a suggestion, not a finding):\n${lines.join("\n")}`;
}

/** Super-Admin-only monitoring alerts card set — called by the server INSIDE its existing role gate. */
export function buildMonitoringAlertsResult(alerts: MonitoringAlertForAi[]): MarasAiStructuredResult {
  return {
    responseType: "monitoring_alerts",
    totalCount: alerts.length,
    alerts: alerts.slice(0, MARAS_AI_MAX_CARD_ITEMS).map((a) => ({
      title: a.title,
      severity: a.severity,
      area: a.area,
      count: a.count,
      time: a.time,
      suggestedAction: a.suggestedAction,
    })),
  };
}

// ── Response source indicator ────────────────────────────────────────

export type MarasAiResponseSource = "system_data" | "ai_analysis" | "system_data_ai_analysis";

export const MARAS_AI_SOURCE_LABELS: Record<MarasAiResponseSource, string> = {
  system_data: "System Data",
  ai_analysis: "AI Analysis",
  system_data_ai_analysis: "System Data + AI Analysis",
};

/**
 * Honest derivation, never guessed after the fact: the server knows
 * whether it attached backend CONTEXT DATA and whether the model ran.
 * Backend data analyzed by the model -> "System Data + AI Analysis";
 * model with no backend data (general knowledge) -> "AI Analysis";
 * backend data with no model involved -> "System Data".
 */
export function resolveMarasAiResponseSource(input: { usedSystemData: boolean; usedAiModel: boolean }): MarasAiResponseSource {
  if (input.usedSystemData && input.usedAiModel) return "system_data_ai_analysis";
  if (input.usedSystemData) return "system_data";
  return "ai_analysis";
}

// ── Attention badge (mobile ✨ trigger) ──────────────────────────────
//
// PR #129 follow-up: a small "attention needed" indicator on the mobile
// MARAS AI trigger. Derived ENTIRELY from system data the Admin client
// already holds (the loaded shipment registry) plus, for Super Admins,
// the alert severities from the EXISTING alerts endpoint — no AI call,
// no OpenAI polling, no new backend API. Delay detection reuses
// assessShipmentDelay above (the same heuristic MARAS AI itself
// explains), so the badge and the AI can never disagree about what
// "delayed" means.

export interface MarasAiAttention {
  needsAttention: boolean;
  delayedCount: number;
  /** Dispatched, unfinished shipments with zero documents on file (a brand-new undispatched Order is not yet actionable). */
  missingDocumentsCount: number;
  /** high/critical monitoring alert groups (Super Admin data only; 0 when unavailable). */
  criticalAlertCount: number;
  /** Stable fingerprint of the current actionable set — the drawer-open dismissal compares against this, so NEW items re-show the badge. */
  signature: string;
}

export function deriveMarasAiAttention(input: {
  shipments: Shipment[];
  monitoringAlertSeverities?: string[];
  nowIso: string;
}): MarasAiAttention {
  let delayedCount = 0;
  let missingDocumentsCount = 0;
  for (const s of input.shipments) {
    const status = s.status || "";
    if (TERMINAL_STATUSES.has(status)) continue;
    const preDispatch = PRE_DISPATCH_STATUSES.has(status);
    if (!preDispatch && assessShipmentDelay(s, input.nowIso).delayed) delayedCount += 1;
    if (!preDispatch && (s.documents || []).length === 0) missingDocumentsCount += 1;
  }
  const criticalAlertCount = (input.monitoringAlertSeverities || []).filter(
    (sev) => sev === "high" || sev === "critical"
  ).length;
  return {
    needsAttention: delayedCount + missingDocumentsCount + criticalAlertCount > 0,
    delayedCount,
    missingDocumentsCount,
    criticalAlertCount,
    signature: `${delayedCount}|${missingDocumentsCount}|${criticalAlertCount}`,
  };
}

// ── Quick suggestions (drawer, no active conversation) ──────────────

export interface MarasAiQuickSuggestion {
  id: string;
  label: string;
  prompt: string;
}

export const MARAS_AI_QUICK_SUGGESTIONS: MarasAiQuickSuggestion[] = [
  { id: "delayed_shipments", label: "Show delayed shipments", prompt: "Which shipments are delayed right now?" },
  { id: "todays_operations", label: "Summarize today's operations", prompt: "Summarize today's operations." },
  { id: "monitoring_alerts", label: "Review monitoring alerts", prompt: "Review the current monitoring alerts and tell me what needs attention." },
  { id: "missing_documents", label: "Check missing documents", prompt: "Which active shipments are missing documents?" },
  { id: "operational_risks", label: "Review operational risks", prompt: "Review current operational risks across active shipments." },
  { id: "dashboard_summary", label: "Summarize dashboard", prompt: "Give me an overview of all current shipments and their statuses." },
  { id: "driver_performance", label: "Review driver performance", prompt: "Which drivers have the most delayed deliveries?" },
];
