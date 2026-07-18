/**
 * auditEngine.ts — MARAS AI full internal monitoring: the generic,
 * deterministic engine (PR #131).
 *
 * This module is the machinery only — WHAT gets detected lives in
 * auditRules.ts. Everything here is pure and unit-tested: rules run over
 * an in-memory snapshot (AuditContext) with per-rule isolation (one
 * throwing rule is recorded and never stops the others), detections
 * reconcile against persisted findings (create / re-occur / reopen /
 * AUTO-RESOLVE when the condition clears — never delete), and every
 * status change appends to the finding's own history. OpenAI is never
 * involved: detection is deterministic backend logic; MARAS AI only
 * explains findings it is HANDED as system data.
 */
import type {
  ActivityLog,
  AppNotification,
  Client,
  CostStatement,
  Driver,
  Shipment,
  Vendor,
} from "../types";
import type { MonitoringEvent } from "./monitoringStore";

// ── Vocabulary ───────────────────────────────────────────────────────

export type AuditCategory = "operations" | "accounting" | "data_integrity" | "security" | "technical";
export type AuditSeverity = "info" | "low" | "medium" | "high" | "critical";
export type AuditFindingStatus = "open" | "acknowledged" | "resolved" | "ignored";
/** Which roles may see findings from a rule. Never widened at read time — routes filter DOWN from this. */
export type AuditScope = "super" | "operations" | "accounting";

export const AUDIT_SEVERITY_RANK: Record<AuditSeverity, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

// ── Context (the snapshot rules see) ─────────────────────────────────

export interface AuditEnvironmentInfo {
  isProduction: boolean;
  memoryFallback: boolean;
  /** Last SUCCESSFUL audit run before this one, if any (staleness rule). */
  lastSuccessfulRunAt: string | null;
}

/** Sanitized admin record — the context loader must never include password/hash fields. */
export interface AuditAdminRecord {
  id: string;
  name?: string;
  email?: string;
  adminType?: string;
}

export interface AuditContext {
  nowIso: string;
  shipments: Shipment[];
  drivers: Driver[];
  clients: Client[];
  vendors: Vendor[];
  admins: AuditAdminRecord[];
  costStatements: CostStatement[];
  /** Bounded — newest window only; rules must not assume completeness. */
  notifications: AppNotification[];
  /** Bounded — newest window only. */
  activityLogs: ActivityLog[];
  monitoringEvents: MonitoringEvent[];
  environment: AuditEnvironmentInfo;
}

// ── Rules ────────────────────────────────────────────────────────────

/** One raw detection from a rule. Evidence must already be REDACTED — short, secret-free, human-readable. */
export interface AuditDetection {
  recordType: string;
  recordId: string;
  /** Human reference for search/display (e.g. the MAR-YYYY-#### number). */
  recordRef?: string;
  /** Overrides the rule's default severity for this one record. */
  severity?: AuditSeverity;
  evidence: string;
}

export interface AuditRule {
  id: string;
  category: AuditCategory;
  title: string;
  description: string;
  severity: AuditSeverity;
  scope: AuditScope;
  recommendedAction: string;
  evaluate: (ctx: AuditContext) => AuditDetection[];
}

export interface AuditRuleResult {
  ruleId: string;
  ok: boolean;
  detectionCount: number;
  durationMs: number;
  error?: string;
}

/**
 * Runs every rule with per-rule isolation: a throwing rule is recorded
 * as failed (message only, never rethrown) and the remaining rules still
 * run — monitoring must never take the application down with it.
 */
export function runAuditRules(rules: AuditRule[], ctx: AuditContext): {
  detections: { rule: AuditRule; detection: AuditDetection }[];
  ruleResults: AuditRuleResult[];
} {
  const detections: { rule: AuditRule; detection: AuditDetection }[] = [];
  const ruleResults: AuditRuleResult[] = [];
  for (const rule of rules) {
    const startedAt = Date.now();
    try {
      const found = rule.evaluate(ctx);
      for (const detection of found) detections.push({ rule, detection });
      ruleResults.push({ ruleId: rule.id, ok: true, detectionCount: found.length, durationMs: Date.now() - startedAt });
    } catch (err) {
      ruleResults.push({
        ruleId: rule.id,
        ok: false,
        detectionCount: 0,
        durationMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message.slice(0, 300) : "rule failed",
      });
    }
  }
  return { detections, ruleResults };
}

// ── Findings ─────────────────────────────────────────────────────────

export interface AuditFindingHistoryEntry {
  at: string;
  actor: string;
  from: AuditFindingStatus | null;
  to: AuditFindingStatus;
  reason: string;
}

export interface AuditFinding {
  /** Deterministic identity: one finding per (rule, record) pair, forever. */
  id: string;
  ruleId: string;
  category: AuditCategory;
  scope: AuditScope;
  severity: AuditSeverity;
  title: string;
  description: string;
  recommendedAction: string;
  recordType: string;
  recordId: string;
  recordRef: string;
  evidence: string;
  status: AuditFindingStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  /** How many audit runs have observed this condition. */
  occurrenceCount: number;
  /** Set when status becomes resolved; cleared on reopen. */
  resolvedAt?: string;
  resolutionKind?: "auto" | "manual";
  history: AuditFindingHistoryEntry[];
}

/** Deterministic, Firestore-safe finding document id (same FNV approach as monitoringDocIdForKey). */
export function auditFindingIdFor(ruleId: string, recordType: string, recordId: string): string {
  const key = `${ruleId}|${recordType}|${recordId}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const readable = key.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 110);
  return `${readable || "finding"}-${hash.toString(16).padStart(8, "0")}`;
}

export interface ReconcileResult {
  /** Every finding whose document changed this run (create/update/auto-resolve/reopen) — the ONLY docs the server writes. */
  changed: AuditFinding[];
  createdCount: number;
  reopenedCount: number;
  autoResolvedCount: number;
  /** Newly created OR reopened findings at high/critical — the notification set. */
  newlyCriticalOrHigh: AuditFinding[];
}

/**
 * The heart of the audit lifecycle, fully deterministic:
 * - detection with no existing finding      -> create (open)
 * - detection matching open/acknowledged    -> update lastSeen + occurrence (acknowledged STAYS acknowledged)
 * - detection matching ignored              -> update lastSeen + occurrence, stays ignored (the human said so)
 * - detection matching resolved             -> REOPEN (condition came back)
 * - open/acknowledged finding not detected  -> AUTO-RESOLVE (condition cleared; history entry, doc kept forever)
 * - ignored/resolved finding not detected   -> untouched
 */
export function reconcileFindings(
  existing: AuditFinding[],
  detected: { rule: AuditRule; detection: AuditDetection }[],
  nowIso: string
): ReconcileResult {
  const byId = new Map(existing.map((f) => [f.id, f]));
  const changed = new Map<string, AuditFinding>();
  const detectedIds = new Set<string>();
  let createdCount = 0;
  let reopenedCount = 0;
  let autoResolvedCount = 0;
  const newlyCriticalOrHigh: AuditFinding[] = [];

  for (const { rule, detection } of detected) {
    const id = auditFindingIdFor(rule.id, detection.recordType, detection.recordId);
    if (detectedIds.has(id)) continue; // one rule+record = one finding per run
    detectedIds.add(id);
    const severity = detection.severity || rule.severity;
    const current = byId.get(id);
    if (!current) {
      const created: AuditFinding = {
        id,
        ruleId: rule.id,
        category: rule.category,
        scope: rule.scope,
        severity,
        title: rule.title,
        description: rule.description,
        recommendedAction: rule.recommendedAction,
        recordType: detection.recordType,
        recordId: detection.recordId,
        recordRef: detection.recordRef || detection.recordId,
        evidence: detection.evidence,
        status: "open",
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        occurrenceCount: 1,
        history: [{ at: nowIso, actor: "audit-engine", from: null, to: "open", reason: "Condition detected." }],
      };
      changed.set(id, created);
      createdCount += 1;
      if (severity === "high" || severity === "critical") newlyCriticalOrHigh.push(created);
      continue;
    }
    const next: AuditFinding = {
      ...current,
      lastSeenAt: nowIso,
      occurrenceCount: current.occurrenceCount + 1,
      evidence: detection.evidence,
      severity: AUDIT_SEVERITY_RANK[severity] > AUDIT_SEVERITY_RANK[current.severity] ? severity : current.severity,
    };
    if (current.status === "resolved") {
      next.status = "open";
      delete next.resolvedAt;
      delete next.resolutionKind;
      next.history = [...current.history, { at: nowIso, actor: "audit-engine", from: "resolved", to: "open", reason: "Condition detected again." }];
      reopenedCount += 1;
      if (next.severity === "high" || next.severity === "critical") newlyCriticalOrHigh.push(next);
    }
    changed.set(id, next);
  }

  // Auto-resolution: an open/acknowledged finding whose condition was NOT
  // detected in this run no longer exists in the system — close it
  // honestly, keep the document forever.
  for (const finding of existing) {
    if (detectedIds.has(finding.id)) continue;
    if (finding.status !== "open" && finding.status !== "acknowledged") continue;
    changed.set(finding.id, {
      ...finding,
      status: "resolved",
      resolvedAt: nowIso,
      resolutionKind: "auto",
      history: [...finding.history, { at: nowIso, actor: "audit-engine", from: finding.status, to: "resolved", reason: "Condition no longer detected." }],
    });
    autoResolvedCount += 1;
  }

  return { changed: [...changed.values()], createdCount, reopenedCount, autoResolvedCount, newlyCriticalOrHigh };
}

// ── Manual status changes (routes call these; every change is history) ─

export type AuditActionResult = { ok: true; finding: AuditFinding } | { ok: false; error: string };

export function applyFindingAction(
  finding: AuditFinding,
  action: "acknowledge" | "ignore" | "resolve",
  actor: string,
  reason: string,
  nowIso: string
): AuditActionResult {
  const trimmed = (reason || "").trim();
  if ((action === "ignore" || action === "resolve") && !trimmed) {
    return { ok: false, error: "A reason is required." };
  }
  if (action === "acknowledge") {
    if (finding.status !== "open") return { ok: false, error: `Only open findings can be acknowledged (status: ${finding.status}).` };
    return {
      ok: true,
      finding: {
        ...finding,
        status: "acknowledged",
        history: [...finding.history, { at: nowIso, actor, from: "open", to: "acknowledged", reason: trimmed || "Acknowledged." }],
      },
    };
  }
  if (action === "ignore") {
    if (finding.status === "resolved") return { ok: false, error: "A resolved finding cannot be ignored." };
    return {
      ok: true,
      finding: {
        ...finding,
        status: "ignored",
        history: [...finding.history, { at: nowIso, actor, from: finding.status, to: "ignored", reason: trimmed }],
      },
    };
  }
  // Manual resolve — documented rule: allowed with a mandatory reason
  // (Super Admin only, enforced by the route); if the condition still
  // exists, the next audit run reopens the finding automatically.
  if (finding.status === "resolved") return { ok: false, error: "Finding is already resolved." };
  return {
    ok: true,
    finding: {
      ...finding,
      status: "resolved",
      resolvedAt: nowIso,
      resolutionKind: "manual",
      history: [...finding.history, { at: nowIso, actor, from: finding.status, to: "resolved", reason: trimmed }],
    },
  };
}

// ── Role scoping (the single visibility rule) ────────────────────────

/**
 * Which scopes a viewer may see. Super Admin: everything. Operation:
 * operational findings only. Accounts: accounting findings only (their
 * existing permissions already allow the underlying statements). Nothing
 * else — security/technical/data-integrity are Super Admin only.
 */
export function visibleAuditScopesFor(adminType: string): AuditScope[] {
  if (adminType === "super") return ["super", "operations", "accounting"];
  if (adminType === "operation") return ["operations"];
  if (adminType === "accounts") return ["accounting"];
  return [];
}

export function filterFindingsForViewer<T extends { scope: AuditScope }>(findings: T[], adminType: string): T[] {
  const scopes = new Set(visibleAuditScopesFor(adminType));
  return findings.filter((f) => scopes.has(f.scope));
}

// ── Summaries ────────────────────────────────────────────────────────

export interface AuditSummary {
  openTotal: number;
  bySeverity: Record<AuditSeverity, number>;
  byCategory: Record<AuditCategory, number>;
  acknowledgedTotal: number;
  ignoredTotal: number;
  resolvedTotal: number;
  /** Open + high/critical — the badge/notification signal. */
  openHighOrCritical: number;
}

export function summarizeFindings(findings: Pick<AuditFinding, "status" | "severity" | "category">[]): AuditSummary {
  const summary: AuditSummary = {
    openTotal: 0,
    bySeverity: { info: 0, low: 0, medium: 0, high: 0, critical: 0 },
    byCategory: { operations: 0, accounting: 0, data_integrity: 0, security: 0, technical: 0 },
    acknowledgedTotal: 0,
    ignoredTotal: 0,
    resolvedTotal: 0,
    openHighOrCritical: 0,
  };
  for (const f of findings) {
    if (f.status === "open") {
      summary.openTotal += 1;
      summary.bySeverity[f.severity] += 1;
      summary.byCategory[f.category] += 1;
      if (f.severity === "high" || f.severity === "critical") summary.openHighOrCritical += 1;
    } else if (f.status === "acknowledged") summary.acknowledgedTotal += 1;
    else if (f.status === "ignored") summary.ignoredTotal += 1;
    else summary.resolvedTotal += 1;
  }
  return summary;
}

// ── Runs ─────────────────────────────────────────────────────────────

export type AuditRunTrigger = "startup" | "interval" | "manual" | "scheduler";

export interface AuditRunRecord {
  id: string;
  trigger: AuditRunTrigger;
  actor: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  ok: boolean;
  error?: string;
  ruleResults: AuditRuleResult[];
  createdCount: number;
  reopenedCount: number;
  autoResolvedCount: number;
  failedRuleCount: number;
  openTotalAfter: number;
}

/** Keep this many run records; older ones prune (findings themselves are NEVER pruned). */
export const AUDIT_RUN_RETENTION = 100;
/** Hard ceiling on one audit's wall time; the run is marked failed past this. */
export const AUDIT_MAX_DURATION_MS = 120_000;
/** Best-effort distributed lock TTL — a crashed holder frees the lock after this. */
export const AUDIT_LOCK_TTL_MS = 10 * 60 * 1000;
/** In-process fallback cadence; real correctness comes from the scheduler endpoint (see docs). */
export const AUDIT_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Skip a startup/interval run if a successful run is fresher than this. */
export const AUDIT_MIN_GAP_MS = 30 * 60 * 1000;
