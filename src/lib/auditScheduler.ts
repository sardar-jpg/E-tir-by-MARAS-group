/**
 * auditScheduler.ts — pure decision logic for the audit scheduler
 * endpoint and run cadence (Stage 2 PR 3, audit finding H-2).
 *
 * Design stance: the in-process startup/interval timers are BEST-EFFORT
 * ONLY (Cloud Run instances stop when idle); the authoritative recurring
 * trigger is an external scheduler calling POST /api/audit/scheduler-run
 * with the x-audit-token header. Everything here is pure and unit-tested;
 * server.ts only wires these decisions to Express, the Firestore lock,
 * and runAudit. No function in this module may ever place a token value
 * in any returned string.
 */
import crypto from "crypto";

/**
 * Cloud Scheduler retries a job when the previous attempt was slow or
 * returned non-2xx; a retry landing right after a successful run should
 * be acknowledged as a duplicate, not start a second audit.
 */
export const SCHEDULER_DUPLICATE_WINDOW_MS = 60_000;

/**
 * HTTP deadline for a scheduler-triggered run. This is a REQUEST deadline,
 * not a cancellation: when it expires the endpoint answers 504 and the
 * original audit keeps executing in the background, releasing its
 * distributed lock only through runAudit's own finally path. Kept under
 * Cloud Scheduler's 120s attempt deadline so we control the response.
 */
export const SCHEDULER_HTTP_DEADLINE_MS = 110_000;

/** Documented external cadence (cron 0 *\/3 * * * — every 3 hours). */
export const EXPECTED_SCHEDULER_CADENCE_MS = 3 * 60 * 60 * 1000;

export type SchedulerAuthResult =
  /** token configured and the provided header matches (constant-time) */
  | "ok"
  /** no AUDIT_SCHEDULER_TOKEN configured — endpoint disabled */
  | "disabled"
  /** header missing, empty, or not a single string value */
  | "malformed"
  /** header present but wrong */
  | "invalid_token";

/**
 * Constant-time token check. The length comparison short-circuit does not
 * leak token CONTENT (only that lengths differ); crypto.timingSafeEqual
 * requires equal-length buffers.
 */
export function evaluateSchedulerAuth(configuredRaw: string | undefined, providedHeader: unknown): SchedulerAuthResult {
  const configured = (configuredRaw || "").trim();
  if (!configured) return "disabled";
  if (typeof providedHeader !== "string" || providedHeader.length === 0) return "malformed";
  const a = Buffer.from(configured);
  const b = Buffer.from(providedHeader);
  if (a.length !== b.length) return "invalid_token";
  return crypto.timingSafeEqual(a, b) ? "ok" : "invalid_token";
}

/**
 * Best-effort automatic triggers (startup/interval) skip when a fresh
 * successful run already exists — many Cloud Run instances may boot in a
 * burst. The authoritative "scheduler" and explicit "manual" triggers
 * NEVER skip here: recovering from a stale audit is exactly their job.
 */
export function shouldSkipAutomaticRun(
  trigger: string,
  lastSuccessfulRunAt: string | null | undefined,
  nowMs: number,
  minGapMs: number
): boolean {
  if (trigger !== "startup" && trigger !== "interval") return false;
  if (!lastSuccessfulRunAt) return false;
  const age = nowMs - new Date(lastSuccessfulRunAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < minGapMs;
}

/** A scheduler fire arriving inside the window after a success is a retry duplicate. */
export function isDuplicateSchedulerFire(
  lastSuccessfulRunAt: string | null | undefined,
  nowMs: number,
  windowMs: number = SCHEDULER_DUPLICATE_WINDOW_MS
): boolean {
  if (!lastSuccessfulRunAt) return false;
  const age = nowMs - new Date(lastSuccessfulRunAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < windowMs;
}

/**
 * Lock takeover decision: an absent, blank, or EXPIRED lock may be taken
 * over (stale-lock recovery after a crashed run); a live one may not.
 */
export function canTakeOverAuditLock(
  current: { expiresAt?: string } | null | undefined,
  nowMs: number
): boolean {
  if (!current?.expiresAt) return true;
  const expiresAt = new Date(current.expiresAt).getTime();
  return !Number.isFinite(expiresAt) || expiresAt <= nowMs;
}

/**
 * Persisted scheduler operational state (auditState/scheduler document).
 * Written ONLY by the external scheduler endpoint, so manual, startup,
 * and in-process interval runs can never make the external scheduler
 * look healthy. Survives Cloud Run instance restarts by construction —
 * health is derived from THIS persisted state, never from memory.
 * Timestamps only; no token or token-derived value may ever live here.
 */
export interface SchedulerState {
  lastTriggeredAt?: string | null;
  lastSuccessfulRunAt?: string | null;
  lastFailedRunAt?: string | null;
  lastTimedOutAt?: string | null;
}

export type SchedulerHealthStatus = "not_configured" | "never_run" | "healthy" | "stale" | "failing";

export interface SchedulerHealth {
  configured: boolean;
  status: SchedulerHealthStatus;
  expectedCadenceMs: number;
  lastTriggeredAt: string | null;
  lastSuccessfulRunAt: string | null;
  lastFailedRunAt: string | null;
  lastTimedOutAt: string | null;
}

const ts = (iso: string | null | undefined): number => {
  if (!iso) return 0;
  const v = new Date(iso).getTime();
  return Number.isFinite(v) ? v : 0;
};

/**
 * Health decision table (external scheduler ONLY — see SchedulerState):
 *   not_configured  no AUDIT_SCHEDULER_TOKEN
 *   never_run       configured, but no terminal scheduler outcome persisted
 *                   (success, failure, or timeout) — a bare trigger with no
 *                   outcome yet still counts as never_run
 *   failing         the newest terminal outcome is a failure or timeout
 *                   (i.e. failure/timeout newer than the last success);
 *                   a LATER success flips back to healthy/stale
 *   stale           last success older than 2 × the expected cadence
 *   healthy         last success within the allowed window
 */
export function assessSchedulerHealth(
  configured: boolean,
  state: SchedulerState | null | undefined,
  nowMs: number,
  expectedCadenceMs: number = EXPECTED_SCHEDULER_CADENCE_MS
): SchedulerHealth {
  const base = {
    configured,
    expectedCadenceMs,
    lastTriggeredAt: state?.lastTriggeredAt || null,
    lastSuccessfulRunAt: state?.lastSuccessfulRunAt || null,
    lastFailedRunAt: state?.lastFailedRunAt || null,
    lastTimedOutAt: state?.lastTimedOutAt || null,
  };
  if (!configured) return { ...base, status: "not_configured" };

  const success = ts(state?.lastSuccessfulRunAt);
  const badness = Math.max(ts(state?.lastFailedRunAt), ts(state?.lastTimedOutAt));
  if (success === 0 && badness === 0) return { ...base, status: "never_run" };
  if (badness > success) return { ...base, status: "failing" };
  const age = nowMs - success;
  if (age >= 2 * expectedCadenceMs) return { ...base, status: "stale" };
  return { ...base, status: "healthy" };
}

/**
 * Timeout/success ordering race guard (PR #136 review issue 2): when the
 * HTTP deadline and the run's own completion land near-simultaneously,
 * Promise.race may discard a JUST-SUCCEEDED result and take the timeout
 * branch anyway. Writing lastTimedOutAt then would shadow the real,
 * already-persisted success with a NEWER timeout timestamp and flip
 * health to "failing" for a run that actually succeeded. Record the
 * timeout marker ONLY when no success has been persisted since this
 * invocation began: a success at/after invokedAtMs is the very run we
 * launched, so the 504 stays (HTTP deadline truly passed) but the health
 * marker is suppressed.
 */
export function shouldRecordSchedulerTimeout(
  lastSuccessfulRunAt: string | null | undefined,
  invokedAtMs: number
): boolean {
  return ts(lastSuccessfulRunAt) < invokedAtMs;
}

/**
 * One secret-safe, grep-able log line per finished run: trigger, outcome,
 * duration, and finding counts. Contains counts and ids only — never a
 * token, never finding content.
 */
export function summarizeRunForLog(run: {
  id: string;
  trigger: string;
  ok: boolean;
  durationMs: number;
  createdCount: number;
  reopenedCount: number;
  autoResolvedCount: number;
  failedRuleCount: number;
  openTotalAfter: number;
}): string {
  return (
    `[audit] ${run.trigger} run ${run.id} ${run.ok ? "succeeded" : "FAILED"} in ${run.durationMs}ms — ` +
    `${run.createdCount} new, ${run.reopenedCount} reopened, ${run.autoResolvedCount} auto-resolved, ` +
    `${run.failedRuleCount} failed rule(s), ${run.openTotalAfter} open finding(s) after`
  );
}
