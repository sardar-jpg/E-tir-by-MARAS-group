import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assessProductionConfig,
  summarizeProductionConfig,
  PRODUCTION_ENV_CONTRACT,
  PRODUCTION_SECRET_NAMES,
} from "./productionConfig";

const ROOT = join(__dirname, "..", "..");

// Sentinel "secret" values planted in test environments — the contract is
// that NO output string ever contains them.
const SECRET_SENTINELS = {
  SESSION_SECRET: "sentinel-session-secret-XyZ123",
  OPENAI_API_KEY: "sk-sentinel-openai-key-ABC999",
  AUDIT_SCHEDULER_TOKEN: "sentinel-audit-token-QQQ777",
  SUPER_ADMIN_PASSWORD_HASH: "sentinel-hash-$2b$10$abcdef",
};

const healthyProduction = {
  NODE_ENV: "production",
  SESSION_SECRET: SECRET_SENTINELS.SESSION_SECRET,
  SUPER_ADMIN_EMAIL: "sardar@maras.iq",
  SUPER_ADMIN_PASSWORD_HASH: SECRET_SENTINELS.SUPER_ADMIN_PASSWORD_HASH,
  STRICT_PERSISTENCE: "true",
  SEED_DEMO_DATA: "false",
  MARAS_AI_ENABLED: "true",
  OPENAI_API_KEY: SECRET_SENTINELS.OPENAI_API_KEY,
  AUDIT_SCHEDULER_TOKEN: SECRET_SENTINELS.AUDIT_SCHEDULER_TOKEN,
};

describe("production config contract — assessment rules", () => {
  it("a fully healthy production environment produces zero issues", () => {
    expect(assessProductionConfig(healthyProduction)).toEqual([]);
  });

  it("missing required config is detected: SESSION_SECRET missing is fatal in any mode", () => {
    const issues = assessProductionConfig({ ...healthyProduction, SESSION_SECRET: undefined });
    expect(issues.some((i) => i.level === "fatal" && i.code === "session_secret_missing")).toBe(true);
    // Also fatal outside production (mirrors the server's own hard guard).
    const devIssues = assessProductionConfig({ NODE_ENV: undefined });
    expect(devIssues.some((i) => i.code === "session_secret_missing")).toBe(true);
  });

  it("production demo-data prohibition: SEED_DEMO_DATA=true in production is fatal", () => {
    const issues = assessProductionConfig({ ...healthyProduction, SEED_DEMO_DATA: "true" });
    expect(issues.some((i) => i.level === "fatal" && i.code === "seed_demo_data_in_production")).toBe(true);
    // ...but perfectly fine in local dev.
    const dev = assessProductionConfig({ SESSION_SECRET: "x", SEED_DEMO_DATA: "true" });
    expect(dev.some((i) => i.code === "seed_demo_data_in_production")).toBe(false);
  });

  it("strict persistence requirement: STRICT_PERSISTENCE=false in production is fatal", () => {
    const issues = assessProductionConfig({ ...healthyProduction, STRICT_PERSISTENCE: "false" });
    expect(issues.some((i) => i.level === "fatal" && i.code === "strict_persistence_disabled_in_production")).toBe(true);
    const dev = assessProductionConfig({ SESSION_SECRET: "x", STRICT_PERSISTENCE: "false" });
    expect(dev.some((i) => i.level === "fatal")).toBe(false);
  });

  it("MARAS AI config preservation: whitespace-corrupted flag and wiped-flag symptoms both warn", () => {
    // The exact production incident: value that trims to 'true' but is not
    // the literal — server treats it as DISABLED.
    const ws = assessProductionConfig({ ...healthyProduction, MARAS_AI_ENABLED: " true " });
    expect(ws.some((i) => i.code === "maras_ai_flag_whitespace")).toBe(true);
    // Key present but flag gone = classic wipe symptom.
    const wiped = assessProductionConfig({ ...healthyProduction, MARAS_AI_ENABLED: undefined });
    expect(wiped.some((i) => i.code === "maras_ai_flag_missing")).toBe(true);
    // Enabled without a key = feature will 503.
    const noKey = assessProductionConfig({ ...healthyProduction, OPENAI_API_KEY: undefined });
    expect(noKey.some((i) => i.code === "maras_ai_key_missing")).toBe(true);
    // Deliberately disabled (no flag, no key) is NOT a warning.
    const off = assessProductionConfig({ ...healthyProduction, MARAS_AI_ENABLED: undefined, OPENAI_API_KEY: undefined });
    expect(off.some((i) => i.code.startsWith("maras_ai"))).toBe(false);
  });

  it("scheduler config preservation: production without AUDIT_SCHEDULER_TOKEN warns (never blocks)", () => {
    const issues = assessProductionConfig({ ...healthyProduction, AUDIT_SCHEDULER_TOKEN: undefined });
    const hit = issues.find((i) => i.code === "audit_scheduler_token_missing");
    expect(hit?.level).toBe("warning");
    const dev = assessProductionConfig({ SESSION_SECRET: "x" });
    expect(dev.some((i) => i.code === "audit_scheduler_token_missing")).toBe(false);
  });

  it("root-admin pairing: email without hash warns", () => {
    const issues = assessProductionConfig({ ...healthyProduction, SUPER_ADMIN_PASSWORD_HASH: undefined });
    expect(issues.some((i) => i.code === "super_admin_hash_missing")).toBe(true);
  });

  it("NO output string ever contains a configuration VALUE — names only", () => {
    const broken = {
      ...healthyProduction,
      MARAS_AI_ENABLED: " true ",
      STRICT_PERSISTENCE: "false",
      SEED_DEMO_DATA: "true",
      SUPER_ADMIN_PASSWORD_HASH: undefined,
    };
    const everything = JSON.stringify(assessProductionConfig(broken)) + JSON.stringify(summarizeProductionConfig(broken));
    for (const sentinel of Object.values(SECRET_SENTINELS)) {
      expect(everything).not.toContain(sentinel);
    }
  });

  it("the summary reports presence booleans and secret NAMES, never values", () => {
    const rows = summarizeProductionConfig(healthyProduction);
    expect(rows.length).toBe(PRODUCTION_ENV_CONTRACT.length);
    const key = rows.find((r) => r.name === "OPENAI_API_KEY")!;
    expect(key).toEqual({ name: "OPENAI_API_KEY", kind: "secret", required: false, set: true, secretName: "etir-openai-api-key" });
    // Every secret-typed contract entry has a canonical Secret Manager name.
    for (const spec of PRODUCTION_ENV_CONTRACT.filter((s) => s.kind === "secret")) {
      expect(PRODUCTION_SECRET_NAMES[spec.name]).toBeTruthy();
    }
  });
});

describe("deploy manifest contract — deploy/cloudbuild.yaml (H-1)", () => {
  const MANIFEST = readFileSync(join(ROOT, "deploy", "cloudbuild.yaml"), "utf-8");

  it("uses only merge-semantics flags: --update-env-vars/--update-secrets; the wipe-capable flags are banned", () => {
    expect(MANIFEST).toContain("--update-env-vars=");
    expect(MANIFEST).toContain("--update-secrets=");
    expect(MANIFEST).not.toMatch(/--set-env-vars/);
    expect(MANIFEST).not.toMatch(/--clear-env-vars/);
    expect(MANIFEST).not.toMatch(/--remove-env-vars/);
    expect(MANIFEST).not.toMatch(/--set-secrets/);
  });

  it("references secrets by Secret Manager NAME:version — never by value", () => {
    for (const [envName, secretName] of Object.entries(PRODUCTION_SECRET_NAMES)) {
      if (envName === "DD_API_KEY") continue; // optional, not in the baseline manifest
      expect(MANIFEST).toContain(`${envName}=${secretName}:latest`);
    }
    // No plausible secret material anywhere in the file.
    expect(MANIFEST).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
    expect(MANIFEST).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
    expect(MANIFEST).not.toMatch(/BEGIN (RSA )?PRIVATE KEY/);
  });

  it("pins the safety-critical plain values: strict persistence on, demo seed off, MARAS AI flag exact", () => {
    expect(MANIFEST).toContain("STRICT_PERSISTENCE=${_STRICT_PERSISTENCE}");
    expect(MANIFEST).toContain('_STRICT_PERSISTENCE: "true"');
    expect(MANIFEST).toContain("SEED_DEMO_DATA=false");
    expect(MANIFEST).toContain("MARAS_AI_ENABLED=${_MARAS_AI_ENABLED}");
    expect(MANIFEST).toContain('_MARAS_AI_ENABLED: "true"');
    expect(MANIFEST).toContain("NODE_ENV=production");
  });

  it("targets the real service and region and deploys from source", () => {
    expect(MANIFEST).toContain('_SERVICE: "e-tir-by-maras-v2"');
    expect(MANIFEST).toContain('_REGION: "europe-west1"');
    expect(MANIFEST).toContain("--source=.");
  });
});

describe("server wiring — startup assessment (H-1 rollout gate)", () => {
  const SERVER = readFileSync(join(ROOT, "server.ts"), "utf-8");

  it("the server assesses the contract at startup and refuses to start production on fatal issues", () => {
    expect(SERVER).toContain("assessProductionConfig(process.env)");
    expect(SERVER).toContain('process.env.NODE_ENV === "production" && configIssues.some((i) => i.level === "fatal")');
    // The refusal is a hard exit so the Cloud Run rollout fails and the
    // previous healthy revision keeps serving.
    const gateAt = SERVER.indexOf("Production configuration is invalid");
    expect(gateAt).toBeGreaterThan(-1);
    expect(SERVER.slice(gateAt, gateAt + 400)).toContain("process.exit(1)");
  });
});
