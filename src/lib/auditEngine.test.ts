import { describe, it, expect } from "vitest";
import {
  runAuditRules,
  reconcileFindings,
  applyFindingAction,
  auditFindingIdFor,
  filterFindingsForViewer,
  visibleAuditScopesFor,
  summarizeFindings,
  type AuditContext,
  type AuditFinding,
  type AuditRule,
} from "./auditEngine";

const emptyCtx = (over: Partial<AuditContext> = {}): AuditContext => ({
  nowIso: "2026-07-18T12:00:00Z",
  shipments: [],
  drivers: [],
  clients: [],
  vendors: [],
  admins: [],
  costStatements: [],
  notifications: [],
  activityLogs: [],
  monitoringEvents: [],
  environment: { isProduction: false, memoryFallback: false, lastSuccessfulRunAt: null },
  ...over,
});

const rule = (over: Partial<AuditRule> = {}): AuditRule => ({
  id: "TEST-001",
  category: "operations",
  title: "Test rule",
  description: "d",
  severity: "high",
  scope: "operations",
  recommendedAction: "act",
  evaluate: () => [],
  ...over,
});

const detect = (recordId: string) => [{ recordType: "shipment", recordId, recordRef: recordId, evidence: "e1" }];

describe("runAuditRules — per-rule isolation", () => {
  it("a throwing rule is recorded as failed and never stops the others", () => {
    const boom = rule({ id: "BOOM", evaluate: () => { throw new Error("kaput"); } });
    const good = rule({ id: "GOOD", evaluate: () => detect("s1") });
    const { detections, ruleResults } = runAuditRules([boom, good], emptyCtx());
    expect(detections).toHaveLength(1);
    expect(ruleResults.find((r) => r.ruleId === "BOOM")).toMatchObject({ ok: false, error: "kaput", detectionCount: 0 });
    expect(ruleResults.find((r) => r.ruleId === "GOOD")).toMatchObject({ ok: true, detectionCount: 1 });
    expect(ruleResults.every((r) => typeof r.durationMs === "number")).toBe(true);
  });
});

describe("reconcileFindings — the deterministic finding lifecycle", () => {
  const r = rule({ id: "R1" });

  it("creates open findings with history; identical (rule, record) never duplicates within a run", () => {
    const rec = reconcileFindings([], [
      { rule: r, detection: detect("s1")[0] },
      { rule: r, detection: detect("s1")[0] },
    ], "t1");
    expect(rec.createdCount).toBe(1);
    expect(rec.changed[0]).toMatchObject({ status: "open", firstSeenAt: "t1", lastSeenAt: "t1", occurrenceCount: 1, severity: "high" });
    expect(rec.changed[0].history).toEqual([{ at: "t1", actor: "audit-engine", from: null, to: "open", reason: "Condition detected." }]);
    expect(rec.newlyCriticalOrHigh).toHaveLength(1); // high severity -> notification set
  });

  it("re-detection bumps lastSeen + occurrenceCount and keeps acknowledged/ignored statuses", () => {
    const first = reconcileFindings([], [{ rule: r, detection: detect("s1")[0] }], "t1").changed[0];
    const acked = applyFindingAction(first, "acknowledge", "admin-1", "", "t2");
    if (!acked.ok) throw new Error("ack failed");
    const rec = reconcileFindings([acked.finding], [{ rule: r, detection: detect("s1")[0] }], "t3");
    expect(rec.changed[0]).toMatchObject({ status: "acknowledged", lastSeenAt: "t3", occurrenceCount: 2 });
    expect(rec.createdCount).toBe(0);
    expect(rec.newlyCriticalOrHigh).toHaveLength(0); // not NEW -> no re-notification
  });

  it("AUTO-RESOLVES open/acknowledged findings whose condition cleared — document kept, history appended", () => {
    const first = reconcileFindings([], [{ rule: r, detection: detect("s1")[0] }], "t1").changed[0];
    const rec = reconcileFindings([first], [], "t2");
    expect(rec.autoResolvedCount).toBe(1);
    expect(rec.changed[0]).toMatchObject({ status: "resolved", resolvedAt: "t2", resolutionKind: "auto" });
    expect(rec.changed[0].history[rec.changed[0].history.length - 1]).toMatchObject({ to: "resolved", reason: "Condition no longer detected." });
  });

  it("REOPENS a resolved finding when the condition comes back (counts as newly notifiable)", () => {
    const first = reconcileFindings([], [{ rule: r, detection: detect("s1")[0] }], "t1").changed[0];
    const resolved = reconcileFindings([first], [], "t2").changed[0];
    const rec = reconcileFindings([resolved], [{ rule: r, detection: detect("s1")[0] }], "t3");
    expect(rec.reopenedCount).toBe(1);
    expect(rec.changed[0]).toMatchObject({ status: "open", occurrenceCount: 2 });
    expect(rec.changed[0].resolvedAt).toBeUndefined();
    expect(rec.newlyCriticalOrHigh).toHaveLength(1);
  });

  it("ignored findings stay ignored while detected and are never auto-resolved", () => {
    const first = reconcileFindings([], [{ rule: r, detection: detect("s1")[0] }], "t1").changed[0];
    const ignored = applyFindingAction(first, "ignore", "admin-1", "known issue", "t2");
    if (!ignored.ok) throw new Error("ignore failed");
    const stillDetected = reconcileFindings([ignored.finding], [{ rule: r, detection: detect("s1")[0] }], "t3");
    expect(stillDetected.changed[0].status).toBe("ignored");
    const cleared = reconcileFindings([ignored.finding], [], "t4");
    expect(cleared.changed).toHaveLength(0); // untouched — the human's decision stands
  });
});

describe("manual actions — reasons and permissions are enforced upstream of the routes", () => {
  const base = reconcileFindings([], [{ rule: rule({ id: "R2" }), detection: detect("s9")[0] }], "t1").changed[0];

  it("ignore and manual resolve REQUIRE a reason; acknowledge does not", () => {
    expect(applyFindingAction(base, "ignore", "a", "  ", "t2").ok).toBe(false);
    expect(applyFindingAction(base, "resolve", "a", "", "t2").ok).toBe(false);
    expect(applyFindingAction(base, "acknowledge", "a", "", "t2").ok).toBe(true);
  });

  it("manual resolve records kind + actor + reason in history (full audit trail)", () => {
    const res = applyFindingAction(base, "resolve", "sardar@maras.iq", "verified fixed by hand", "t2");
    if (!res.ok) throw new Error("resolve failed");
    expect(res.finding).toMatchObject({ status: "resolved", resolutionKind: "manual", resolvedAt: "t2" });
    expect(res.finding.history[res.finding.history.length - 1]).toMatchObject({ actor: "sardar@maras.iq", reason: "verified fixed by hand" });
  });

  it("invalid transitions are rejected", () => {
    const resolved = applyFindingAction(base, "resolve", "a", "r", "t2");
    if (!resolved.ok) throw new Error("setup failed");
    expect(applyFindingAction(resolved.finding, "resolve", "a", "again", "t3").ok).toBe(false);
    expect(applyFindingAction(resolved.finding, "acknowledge", "a", "", "t3").ok).toBe(false);
  });
});

describe("role scoping — the single visibility rule", () => {
  const findings = [
    { scope: "operations" as const },
    { scope: "accounting" as const },
    { scope: "super" as const },
  ];

  it("super sees everything; operation sees operations only; accounts sees accounting only; unknown roles see nothing", () => {
    expect(filterFindingsForViewer(findings, "super")).toHaveLength(3);
    expect(filterFindingsForViewer(findings, "operation").map((f) => f.scope)).toEqual(["operations"]);
    expect(filterFindingsForViewer(findings, "accounts").map((f) => f.scope)).toEqual(["accounting"]);
    expect(filterFindingsForViewer(findings, "")).toHaveLength(0);
    expect(visibleAuditScopesFor("operation")).not.toContain("super"); // security/technical never leak
  });
});

describe("summaries and identity", () => {
  it("summarizes open counts by severity/category; other statuses tally separately", () => {
    const f = (over: Partial<AuditFinding>) => ({ status: "open", severity: "high", category: "operations", ...over } as AuditFinding);
    const s = summarizeFindings([
      f({}), f({ severity: "critical", category: "security" }), f({ status: "acknowledged" }), f({ status: "resolved" }), f({ status: "ignored" }),
    ]);
    expect(s).toMatchObject({ openTotal: 2, openHighOrCritical: 2, acknowledgedTotal: 1, resolvedTotal: 1, ignoredTotal: 1 });
    expect(s.bySeverity.critical).toBe(1);
    expect(s.byCategory.security).toBe(1);
  });

  it("finding ids are deterministic, Firestore-safe, and collision-suffixed", () => {
    const id = auditFindingIdFor("OPS-001", "shipment", "shipment-1001");
    expect(id).toBe(auditFindingIdFor("OPS-001", "shipment", "shipment-1001"));
    expect(id).not.toMatch(/[/|\s]/);
    expect(auditFindingIdFor("A", "b", "c|d")).not.toBe(auditFindingIdFor("A", "b", "c/d"));
  });
});
