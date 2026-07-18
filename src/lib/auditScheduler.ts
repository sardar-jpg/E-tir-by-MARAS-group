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
