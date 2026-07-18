/**
 * productionConfig.ts — the declarative production-configuration contract
 * (Stage 2 PR 1; audit findings H-1 and the config-governance half of H-2).
 *
 * One place declares every runtime variable production needs, which ones
 * are Secret Manager references, and what counts as a fatal
 * misconfiguration. The server assesses this contract at startup, so a
 * deployment that wiped or corrupted required configuration (the H-1
 * incident: an auto-deploy from main silently cleared manually-set Cloud
 * Run env vars) fails its revision rollout loudly — Cloud Run keeps the
 * previous healthy revision serving — instead of running misconfigured.
 *
 * HARD RULE: nothing in this module may ever place a configuration VALUE
 * into an issue message, a summary, or any other output — variable NAMES
 * only. The unit tests plant sentinel secret values and assert they never
 * appear in any produced string.
 */

export interface ProductionConfigIssue {
  level: "fatal" | "warning";
  code: string;
  /** Mentions variable NAMES only — never values. */
  message: string;
}

/**
 * Canonical Secret Manager secret names for every secret-typed variable.
 * The deploy manifest (deploy/cloudbuild.yaml) must reference these NAMES
 * via --update-secrets; raw values never appear in the repository.
 */
export const PRODUCTION_SECRET_NAMES: Record<string, string> = {
  SESSION_SECRET: "etir-session-secret",
  SUPER_ADMIN_PASSWORD_HASH: "etir-super-admin-password-hash",
  OPENAI_API_KEY: "etir-openai-api-key",
  AUDIT_SCHEDULER_TOKEN: "etir-audit-scheduler-token",
  DD_API_KEY: "etir-datadog-api-key",
};

export interface ProductionEnvVarSpec {
  name: string;
  kind: "secret" | "plain";
  /** required = startup warns (or fails, per rules below) when unset in production. */
  required: boolean;
  purpose: string;
}

export const PRODUCTION_ENV_CONTRACT: ProductionEnvVarSpec[] = [
  { name: "SESSION_SECRET", kind: "secret", required: true, purpose: "Signs every login session token; server refuses to start without it." },
  { name: "SUPER_ADMIN_EMAIL", kind: "plain", required: true, purpose: "Root admin login identity." },
  { name: "SUPER_ADMIN_PASSWORD_HASH", kind: "secret", required: true, purpose: "Root admin password hash (never the plaintext)." },
  { name: "STRICT_PERSISTENCE", kind: "plain", required: true, purpose: "Must not be 'false' in production — memory-fallback writes are forbidden." },
  { name: "SEED_DEMO_DATA", kind: "plain", required: true, purpose: "Must not be 'true' in production — seeds known-password demo accounts." },
  { name: "MARAS_AI_ENABLED", kind: "plain", required: false, purpose: "MARAS AI master switch; must be the literal 'true' (no whitespace) to enable." },
  { name: "OPENAI_API_KEY", kind: "secret", required: false, purpose: "MARAS AI provider key; required whenever MARAS_AI_ENABLED is 'true'." },
  { name: "OPENAI_MODEL", kind: "plain", required: false, purpose: "Optional MARAS AI model override." },
  { name: "AUDIT_SCHEDULER_TOKEN", kind: "secret", required: false, purpose: "Enables the external audit scheduler endpoint; strongly recommended in production." },
  { name: "GOOGLE_MAPS_PLATFORM_KEY", kind: "plain", required: false, purpose: "Maps JS key (browser-served by design; must be referrer-restricted in GCP)." },
  { name: "DD_API_KEY", kind: "secret", required: false, purpose: "Optional Datadog tracing." },
];

const lc = (v: string | undefined): string => (v || "").toLowerCase();

/**
 * Assess an environment against the production contract.
 *
 * Fatal issues (in production these should abort startup so the rollout
 * fails and the previous revision keeps serving):
 *   - SESSION_SECRET missing (any mode — mirrors the server's own guard)
 *   - NODE_ENV=production with SEED_DEMO_DATA=true
 *   - NODE_ENV=production with STRICT_PERSISTENCE=false
 *
 * Warnings (loud, never blocking — a disabled optional feature is a valid
 * state, but a silently *wiped* one must still be visible in logs):
 *   - MARAS_AI_ENABLED would parse as true after trimming but not as-is
 *     (the exact whitespace trap behind the H-1 production incident)
 *   - OPENAI_API_KEY set while MARAS_AI_ENABLED is not effectively 'true'
 *     (classic symptom of a wiped/mangled flag)
 *   - MARAS AI enabled without OPENAI_API_KEY (feature will 503)
 *   - production without AUDIT_SCHEDULER_TOKEN (scheduler endpoint disabled)
 *   - SUPER_ADMIN_EMAIL without SUPER_ADMIN_PASSWORD_HASH (root login dead)
 */
export function assessProductionConfig(env: Record<string, string | undefined>): ProductionConfigIssue[] {
  const issues: ProductionConfigIssue[] = [];
  const isProduction = env.NODE_ENV === "production";

  if (!env.SESSION_SECRET) {
    issues.push({
      level: "fatal",
      code: "session_secret_missing",
      message: "SESSION_SECRET is not set — every API endpoint would be unauthenticated.",
    });
  }

  if (isProduction && lc(env.SEED_DEMO_DATA) === "true") {
    issues.push({
      level: "fatal",
      code: "seed_demo_data_in_production",
      message: "SEED_DEMO_DATA=true in production would seed demo accounts with source-visible passwords. Set SEED_DEMO_DATA=false.",
    });
  }

  if (isProduction && lc(env.STRICT_PERSISTENCE) === "false") {
    issues.push({
      level: "fatal",
      code: "strict_persistence_disabled_in_production",
      message: "STRICT_PERSISTENCE=false in production would let writes silently land in the volatile memory fallback. Remove the override.",
    });
  }

  const marasRaw = env.MARAS_AI_ENABLED || "";
  const marasEffective = lc(marasRaw) === "true"; // exact server semantics (marasAiCore.ts) — no trim
  const marasIntended = marasRaw.trim().toLowerCase() === "true";
  if (marasIntended && !marasEffective) {
    issues.push({
      level: "warning",
      code: "maras_ai_flag_whitespace",
      message: "MARAS_AI_ENABLED contains surrounding whitespace and will be treated as DISABLED — set it to the exact literal 'true'.",
    });
  }
  if (marasEffective && !env.OPENAI_API_KEY) {
    issues.push({
      level: "warning",
      code: "maras_ai_key_missing",
      message: "MARAS_AI_ENABLED is 'true' but OPENAI_API_KEY is not set — MARAS AI will answer 503 until the key is configured.",
    });
  }
  if (!marasEffective && !marasIntended && env.OPENAI_API_KEY) {
    issues.push({
      level: "warning",
      code: "maras_ai_flag_missing",
      message: "OPENAI_API_KEY is set but MARAS_AI_ENABLED is not 'true' — MARAS AI is disabled. If this deploy was expected to keep it enabled, the flag was likely wiped (audit finding H-1).",
    });
  }

  if (isProduction && !env.AUDIT_SCHEDULER_TOKEN) {
    issues.push({
      level: "warning",
      code: "audit_scheduler_token_missing",
      message: "AUDIT_SCHEDULER_TOKEN is not set — POST /api/audit/scheduler-run stays disabled and audit cadence relies on best-effort in-process timers only (audit finding H-2).",
    });
  }

  if (isProduction && !env.SUPER_ADMIN_EMAIL) {
    issues.push({
      level: "warning",
      code: "super_admin_email_missing",
      message: "SUPER_ADMIN_EMAIL is not set — the root admin cannot log in.",
    });
  }
  if (env.SUPER_ADMIN_EMAIL && !env.SUPER_ADMIN_PASSWORD_HASH) {
    issues.push({
      level: "warning",
      code: "super_admin_hash_missing",
      message: "SUPER_ADMIN_EMAIL is set but SUPER_ADMIN_PASSWORD_HASH is not — the root admin login will always fail.",
    });
  }

  return issues;
}

export interface ProductionConfigSummaryRow {
  name: string;
  kind: "secret" | "plain";
  required: boolean;
  /** Presence only — the value itself is never surfaced anywhere. */
  set: boolean;
  secretName?: string;
}

/** Presence table for the operator check script — names and booleans only. */
export function summarizeProductionConfig(env: Record<string, string | undefined>): ProductionConfigSummaryRow[] {
  return PRODUCTION_ENV_CONTRACT.map((spec) => ({
    name: spec.name,
    kind: spec.kind,
    required: spec.required,
    set: !!env[spec.name],
    ...(spec.kind === "secret" ? { secretName: PRODUCTION_SECRET_NAMES[spec.name] } : {}),
  }));
}
