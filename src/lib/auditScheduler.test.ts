import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  evaluateSchedulerAuth,
  shouldSkipAutomaticRun,
  isDuplicateSchedulerFire,
  canTakeOverAuditLock,
  summarizeRunForLog,
  SCHEDULER_DUPLICATE_WINDOW_MS,
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

describe("server wiring — scheduler is the authoritative trigger (H-2)", () => {
  const SERVER = readFileSync(join(ROOT, "server.ts"), "utf-8");
  const at = SERVER.indexOf('app.all("/api/audit/scheduler-run"');
  const SCHED = SERVER.slice(at, at + 2800);

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
});
