import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  evaluateSchedulerAuth,
  shouldSkipAutomaticRun,
  isDuplicateSchedulerFire,
  canTakeOverAuditLock,
  summarizeRunForLog,
  assessSchedulerHealth,
  shouldRecordSchedulerTimeout,
  SCHEDULER_DUPLICATE_WINDOW_MS,
  EXPECTED_SCHEDULER_CADENCE_MS,
  SCHEDULER_HTTP_DEADLINE_MS,
} from "./auditScheduler";

const ROOT = join(__dirname, "..", "..");
const TOKEN = "sentinel-scheduler-token-A1b2C3";
const NOW = Date.parse("2026-07-18T12:00:00Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("scheduler authorization — constant-time, fail-closed", () => {
  it("unauthorized: no configured token disables the endpoint entirely", () => {
    expect(evaluateSchedulerAuth(undefined, TOKEN)).toBe("disabled");
    expect(evaluateSchedulerAuth("", TOKEN)).toBe("disabled");
    expect(evaluateSchedulerAuth("   ", TOKEN)).toBe("disabled");
  });

  it("unauthorized: missing/empty/malformed header never passes", () => {
    expect(evaluateSchedulerAuth(TOKEN, undefined)).toBe("malformed");
    expect(evaluateSchedulerAuth(TOKEN, "")).toBe("malformed");
    expect(evaluateSchedulerAuth(TOKEN, ["a", "b"])).toBe("malformed"); // repeated header
    expect(evaluateSchedulerAuth(TOKEN, 42 as unknown)).toBe("malformed");
  });

  it("unauthorized: wrong token fails — including equal-length wrong tokens (timingSafeEqual path)", () => {
    expect(evaluateSchedulerAuth(TOKEN, "short")).toBe("invalid_token");
    const equalLengthWrong = TOKEN.slice(0, -1) + (TOKEN.endsWith("3") ? "4" : "3");
    expect(equalLengthWrong.length).toBe(TOKEN.length);
    expect(evaluateSchedulerAuth(TOKEN, equalLengthWrong)).toBe("invalid_token");
  });

  it("authorized: the exact token passes; the configured value is trimmed (env-var hygiene)", () => {
    expect(evaluateSchedulerAuth(TOKEN, TOKEN)).toBe("ok");
    expect(evaluateSchedulerAuth(`  ${TOKEN}  `, TOKEN)).toBe("ok");
  });
});

describe("overlap and duplicate protection", () => {
  it("a live lock can never be taken over; expired/absent/blank locks can (stale-lock recovery)", () => {
    expect(canTakeOverAuditLock({ expiresAt: iso(-60_000) }, NOW)).toBe(false); // expires in the future
    expect(canTakeOverAuditLock({ expiresAt: iso(1) }, NOW)).toBe(true); // just expired
    expect(canTakeOverAuditLock({ expiresAt: "" }, NOW)).toBe(true);
    expect(canTakeOverAuditLock(null, NOW)).toBe(true);
    expect(canTakeOverAuditLock({ expiresAt: "not-a-date" }, NOW)).toBe(true); // corrupt lock never wedges audits forever
  });

  it("a scheduler fire right after a success is a duplicate retry; later fires are real", () => {
    expect(isDuplicateSchedulerFire(iso(10_000), NOW)).toBe(true);
    expect(isDuplicateSchedulerFire(iso(SCHEDULER_DUPLICATE_WINDOW_MS + 1), NOW)).toBe(false);
    expect(isDuplicateSchedulerFire(null, NOW)).toBe(false);
    expect(isDuplicateSchedulerFire(iso(-5_000), NOW)).toBe(false); // clock skew: future timestamp is not a duplicate
  });

  it("timeout/success ordering race: a success persisted at/after the invocation suppresses the timeout marker", () => {
    // Previous run's success (before this invocation) → our run really
    // timed out; record the marker.
    expect(shouldRecordSchedulerTimeout(iso(120_000), NOW)).toBe(true);
    expect(shouldRecordSchedulerTimeout(null, NOW)).toBe(true);
    // Success landed AT or AFTER this invocation began: that is the run
    // we launched — the 504 stands, but the health marker is suppressed
    // so stale timeout metadata can never shadow a real success.
    expect(shouldRecordSchedulerTimeout(iso(0), NOW)).toBe(false);
    expect(shouldRecordSchedulerTimeout(iso(-30_000), NOW)).toBe(false); // finished during the race window
  });
});

describe("cadence: best-effort timers skip, authoritative triggers never do", () => {
  const GAP = 30 * 60 * 1000;

  it("startup/interval skip while a fresh successful run exists", () => {
    expect(shouldSkipAutomaticRun("startup", iso(GAP - 1), NOW, GAP)).toBe(true);
    expect(shouldSkipAutomaticRun("interval", iso(GAP - 1), NOW, GAP)).toBe(true);
  });

  it("stale-audit recovery: once the last success is old (or absent), automatic triggers run again", () => {
    expect(shouldSkipAutomaticRun("startup", iso(GAP + 1), NOW, GAP)).toBe(false);
    expect(shouldSkipAutomaticRun("interval", null, NOW, GAP)).toBe(false);
  });

  it("scheduler and manual triggers NEVER skip — they are the recovery path", () => {
    expect(shouldSkipAutomaticRun("scheduler", iso(1), NOW, GAP)).toBe(false);
    expect(shouldSkipAutomaticRun("manual", iso(1), NOW, GAP)).toBe(false);
  });
});

describe("observability is secret-safe", () => {
  it("the run log line carries trigger/outcome/duration/counts — and never any token", () => {
    const line = summarizeRunForLog({
      id: "audit-run-1", trigger: "scheduler", ok: true, durationMs: 1234,
      createdCount: 2, reopenedCount: 1, autoResolvedCount: 3, failedRuleCount: 1, openTotalAfter: 7,
    });
    expect(line).toContain("scheduler");
    expect(line).toContain("succeeded in 1234ms");
    expect(line).toContain("2 new");
    expect(line).toContain("1 reopened");
    expect(line).toContain("3 auto-resolved");
    expect(line).toContain("1 failed rule(s)");
    expect(line).toContain("7 open finding(s) after");
    expect(line).not.toContain(TOKEN);
  });

  it("partial rule failure is visible in the run summary and warned about in server wiring", () => {
    const line = summarizeRunForLog({
      id: "r", trigger: "interval", ok: true, durationMs: 10,
      createdCount: 0, reopenedCount: 0, autoResolvedCount: 0, failedRuleCount: 4, openTotalAfter: 0,
    });
    expect(line).toContain("4 failed rule(s)");
    const SERVER = readFileSync(join(ROOT, "server.ts"), "utf-8");
    expect(SERVER).toContain("rule(s) failed in isolation this run");
    expect(SERVER).toContain("summarizeRunForLog(run)");
  });
});

describe("scheduler health — persisted-state decision table", () => {
  const CAD = EXPECTED_SCHEDULER_CADENCE_MS;

  it("missing token → not_configured (regardless of any persisted history)", () => {
    expect(assessSchedulerHealth(false, { lastSuccessfulRunAt: iso(1000) }, NOW).status).toBe("not_configured");
    expect(assessSchedulerHealth(false, null, NOW).configured).toBe(false);
  });

  it("configured but never run → never_run (a bare trigger with no terminal outcome still counts)", () => {
    expect(assessSchedulerHealth(true, null, NOW).status).toBe("never_run");
    expect(assessSchedulerHealth(true, { lastTriggeredAt: iso(1000) }, NOW).status).toBe("never_run");
  });

  it("recent successful scheduler run → healthy", () => {
    const h = assessSchedulerHealth(true, { lastSuccessfulRunAt: iso(CAD) }, NOW);
    expect(h.status).toBe("healthy");
    expect(h.expectedCadenceMs).toBe(CAD);
    expect(h.lastSuccessfulRunAt).toBe(iso(CAD));
  });

  it("old successful scheduler run (≥ 2× cadence) → stale", () => {
    expect(assessSchedulerHealth(true, { lastSuccessfulRunAt: iso(2 * CAD) }, NOW).status).toBe("stale");
    expect(assessSchedulerHealth(true, { lastSuccessfulRunAt: iso(2 * CAD - 1) }, NOW).status).toBe("healthy");
  });

  it("newer failed run than last success → failing; newer TIMED-OUT run → failing", () => {
    expect(assessSchedulerHealth(true, { lastSuccessfulRunAt: iso(60_000), lastFailedRunAt: iso(10_000) }, NOW).status).toBe("failing");
    expect(assessSchedulerHealth(true, { lastSuccessfulRunAt: iso(60_000), lastTimedOutAt: iso(10_000) }, NOW).status).toBe("failing");
    // Failure with no success ever recorded is failing too.
    expect(assessSchedulerHealth(true, { lastFailedRunAt: iso(10_000) }, NOW).status).toBe("failing");
  });

  it("a LATER success supersedes earlier failure/timeout metadata → healthy again", () => {
    const h = assessSchedulerHealth(true, {
      lastFailedRunAt: iso(60_000), lastTimedOutAt: iso(50_000), lastSuccessfulRunAt: iso(10_000),
    }, NOW);
    expect(h.status).toBe("healthy");
  });

  it("health carries safe operational metadata only — no token-shaped field can exist", () => {
    const h = assessSchedulerHealth(true, { lastSuccessfulRunAt: iso(1000) }, NOW);
    expect(Object.keys(h).sort()).toEqual([
      "configured", "expectedCadenceMs", "lastFailedRunAt", "lastSuccessfulRunAt", "lastTimedOutAt", "lastTriggeredAt", "status",
    ]);
    expect(JSON.stringify(h)).not.toContain(TOKEN);
  });
});

describe("server wiring — scheduler is the authoritative trigger (H-2)", () => {
  const SERVER = readFileSync(join(ROOT, "server.ts"), "utf-8");
  const at = SERVER.indexOf('app.all("/api/audit/scheduler-run"');
  const SCHED = SERVER.slice(at, at + 6500);

  it("unsupported methods are rejected with 405 + Allow header; the route never falls to the SPA catch-all", () => {
    expect(at).toBeGreaterThan(-1);
    expect(SCHED).toContain('req.method !== "POST"');
    expect(SCHED).toContain('res.setHeader("Allow", "POST")');
    expect(SCHED).toContain("405");
  });

  it("auth, dedup, lock skip-logging, and stale-lock takeover all route through the tested pure module", () => {
    expect(SCHED).toContain("evaluateSchedulerAuth(process.env.AUDIT_SCHEDULER_TOKEN");
    expect(SCHED).toContain("isDuplicateSchedulerFire(");
    expect(SERVER).toContain("shouldSkipAutomaticRun(trigger, ctx.environment.lastSuccessfulRunAt");
    expect(SERVER).toContain("canTakeOverAuditLock(");
    expect(SERVER).toContain("taking over expired lock");
  });

  it("no token value can reach a log or response: the handler interpolates no auth material", () => {
    expect(SCHED).not.toContain("${provided");
    expect(SCHED).not.toContain("${configured");
    expect(SCHED).not.toContain("x-audit-token\"]}"); // header value never templated
    // The success response exposes counts/ids only.
    expect(SCHED).toContain("failedRuleCount: result.run.failedRuleCount");
    expect(SCHED).not.toContain("AUDIT_SCHEDULER_TOKEN}");
  });

  it("dedup reads SCHEDULER-ONLY persisted state — a manual/startup/interval success can never suppress the external run", () => {
    // The dedup lookup targets auditState/scheduler via schedulerStateRef…
    expect(SCHED).toContain("const schedulerStateSnap = await getDoc(schedulerStateRef)");
    expect(SCHED).toContain("isDuplicateSchedulerFire(schedulerLastSuccessAt, invokedAtMs)");
    // …and the handler never consults the all-trigger summary document.
    expect(SCHED).not.toContain('"auditState", "summary"');
  });

  it("HTTP deadline: withTimeout wraps the scheduler run; expiry → 504 + race-guarded lastTimedOutAt + secret-free log; lock NOT released early", () => {
    expect(SCHED).toContain("withTimeout(runAudit(\"scheduler\", \"scheduler\"), SCHEDULER_HTTP_DEADLINE_MS");
    expect(SCHED).toContain("504");
    expect(SCHED).toContain('outcome: "timed_out"');
    // Race guard: the timeout marker is written only through the pure,
    // tested decision — a success persisted since this invocation
    // suppresses it (and that suppression is logged).
    expect(SCHED).toContain("shouldRecordSchedulerTimeout(successSinceInvocation, invokedAtMs)");
    expect(SCHED).toContain("lastTimedOutAt: new Date().toISOString()");
    expect(SCHED).toContain("timeout marker suppressed");
    // The timeout branch must not touch the lock: release happens only in
    // runAudit's own finally path (retry overlap is blocked by the lock).
    expect(SCHED).not.toContain("releaseAuditLock");
    // The timeout log is a fixed string with the deadline number only —
    // no token material.
    expect(SCHED).toContain("the run continues in the background and its lock guards against retry overlap");
    // Deadline stays under Cloud Scheduler's 120s attempt deadline.
    expect(SCHEDULER_HTTP_DEADLINE_MS).toBeLessThan(120_000);
  });

  it("outcomes are distinguished: succeeded / failed(500) / locked(409, no failure marker) / deduplicated / timed_out", () => {
    expect(SCHED).toContain('outcome: "succeeded"');
    expect(SCHED).toContain('outcome: "failed"');
    expect(SCHED).toContain('outcome: "locked"');
    expect(SCHED).toContain('outcome: "deduplicated"');
    expect(SCHED).toContain('res.status(500).json({ error: result.error || "Audit failed.", outcome: "failed" })');
    expect(SCHED).toContain('result.reason === "locked"');
    // A locked retry (e.g. during a still-valid lock after a 504) never
    // writes a failure marker — only runAudit's terminal paths do.
    const lockedBranch = SCHED.slice(SCHED.indexOf('result.reason === "locked"'), SCHED.indexOf('outcome: "locked"'));
    expect(lockedBranch).not.toContain("lastFailedRunAt");
  });

  it("terminal scheduler outcomes persist inside runAudit (scheduler-triggered only), so manual/startup/interval runs never touch scheduler health", () => {
    const runAuditAt = SERVER.indexOf("async function runAudit(");
    const RUN = SERVER.slice(runAuditAt, SERVER.indexOf("const auditStartupTimer"));
    expect(RUN).toContain('if (trigger === "scheduler")');
    expect(RUN).toContain('setDoc(doc(db, "auditState", "scheduler")');
    // Success and failure paths both gated on the scheduler trigger.
    expect(RUN.split('if (trigger === "scheduler")').length - 1).toBe(2);
    // The admin summary exposes health from the PERSISTED doc through the
    // pure assessor — configured presence boolean only, never the token.
    const SUMMARY = SERVER.slice(SERVER.indexOf('app.get("/api/admin/audit/summary"'), SERVER.indexOf('app.get("/api/admin/audit/findings"'));
    expect(SUMMARY).toContain('getDoc(doc(db, "auditState", "scheduler"))');
    expect(SUMMARY).toContain("assessSchedulerHealth(schedulerConfigured, schedulerState, Date.now())");
    expect(SUMMARY).toContain('!!(process.env.AUDIT_SCHEDULER_TOKEN || "").trim()');
    expect(SUMMARY).not.toContain("${");
  });
});
