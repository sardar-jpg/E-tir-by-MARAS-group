import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

/**
 * PR #128 — MARAS AI wiring/security contract pins. The behavior (prompt
 * content, validation, whitelist context, grouping, alert derivation) is
 * covered by real unit tests in marasAiCore.test.ts and
 * monitoringStore.test.ts; these pins guarantee the routes and the drawer
 * actually wire those tested pieces in with the right auth boundaries,
 * and that the hard security rules (server-side key, Admin-only surface,
 * Super-Admin-only telemetry, official product name) cannot silently
 * regress.
 */
const ROOT = join(__dirname, "..", "..");
const SERVER = readFileSync(join(ROOT, "server.ts"), "utf-8");
const ADMIN_PANEL = readFileSync(join(ROOT, "src", "components", "AdminPanel.tsx"), "utf-8");
const DRIVER_APP = readFileSync(join(ROOT, "src", "components", "DriverApplication.tsx"), "utf-8");
const CLIENT_APP = readFileSync(join(ROOT, "src", "components", "ClientDashboard.tsx"), "utf-8");
const PUBLIC_VIEW = readFileSync(join(ROOT, "src", "components", "PublicTracking.tsx"), "utf-8");
const ENV_EXAMPLE = readFileSync(join(ROOT, ".env.example"), "utf-8");

function region(source: string, needle: string, length: number): string {
  const start = source.indexOf(needle);
  expect(start, `needle not found: ${needle}`).toBeGreaterThan(-1);
  return source.slice(start, start + length);
}

describe("MARAS AI endpoint — authentication and role boundaries", () => {
  const CHAT_ROUTE = region(SERVER, 'app.post("/api/admin/maras-ai/chat"', 5200);

  it("chat requires a full admin (super/operation — same audience as the drawer); never public", () => {
    expect(SERVER).toContain('app.post("/api/admin/maras-ai/chat", requireFullAdmin,');
  });

  it("technical alerts are Super Admin ONLY", () => {
    expect(SERVER).toContain('app.get("/api/admin/maras-ai/alerts", requireSuperAdmin,');
  });

  it("the monitoring digest joins the AI context ONLY for a super-admin session", () => {
    expect(CHAT_ROUTE).toContain('if (req.session!.adminType === "super") {');
    expect(CHAT_ROUTE).toContain("buildMonitoringAiContext(deriveTechnicalAlerts(monitoringEvents))");
  });

  it("disabled/misconfigured -> clean 503; provider failure -> honest 502; never a fake response", () => {
    expect(CHAT_ROUTE).toContain('"MARAS_AI_UNAVAILABLE"');
    expect(CHAT_ROUTE).toContain('"MARAS_AI_UPSTREAM"');
    expect(CHAT_ROUTE).toContain("resolveMarasAiAvailability(process.env)");
    expect(CHAT_ROUTE).toContain("MARAS AI model request timed out");
  });

  it("requests run through the tested validator and whitelist context builders", () => {
    expect(CHAT_ROUTE).toContain("validateMarasAiChatBody(req.body)");
    expect(CHAT_ROUTE).toContain("buildShipmentAiContext(");
    expect(CHAT_ROUTE).toContain("buildMarasAiInput(parsed.history, parsed.message)");
  });
});

describe("OpenAI credential stays server-side", () => {
  it("the ONE OpenAI client lives in server.ts and reads the key from the environment only", () => {
    expect(SERVER).toContain('import OpenAI from "openai"');
    expect(SERVER).toContain("new OpenAI({ apiKey: process.env.OPENAI_API_KEY");
  });

  it("no frontend file imports openai or reads the API key from the environment", () => {
    // marasAiCore.ts only TYPES an env-shaped parameter (the server passes
    // process.env in); the real security property is that no src/ file
    // constructs an OpenAI client or reads process.env.OPENAI_API_KEY —
    // both live exclusively in server.ts. Test files are excluded.
    const frontendDirs = [join(ROOT, "src", "components"), join(ROOT, "src", "lib"), join(ROOT, "src", "hooks")];
    for (const dir of frontendDirs) {
      for (const file of readdirSync(dir, { recursive: true }) as string[]) {
        if (!/\.(ts|tsx)$/.test(String(file)) || /\.test\.tsx?$/.test(String(file))) continue;
        const content = readFileSync(join(dir, String(file)), "utf-8");
        expect(content, `${file} must not import the OpenAI SDK`).not.toMatch(/from ["']openai["']/);
        expect(content, `${file} must not read the API key from the environment`).not.toContain("process.env.OPENAI_API_KEY");
      }
    }
  });
});

describe("MARAS AI is Admin-only — no AI surface in Driver, Customer, or public apps", () => {
  it("driver/customer/public components contain no MARAS AI reference or endpoint call", () => {
    for (const [name, src] of [["DriverApplication", DRIVER_APP], ["ClientDashboard", CLIENT_APP], ["PublicTracking", PUBLIC_VIEW]] as const) {
      expect(src, `${name} must not reference MARAS AI`).not.toContain("maras-ai");
      expect(src, `${name} must not reference MARAS AI`).not.toContain("MARAS AI");
    }
  });

  it("the drawer posts to the real backend with the current-session thread and duplicate-submit guard", () => {
    expect(ADMIN_PANEL).toContain('apiFetch("/api/admin/maras-ai/chat"');
    expect(ADMIN_PANEL).toContain("if (!message || isMarasAiSending) return;");
    expect(ADMIN_PANEL).toContain("MARAS AI is thinking…");
    // The old fake preview reply is gone.
    expect(ADMIN_PANEL).not.toContain("MARAS AI is not connected yet");
  });
});

describe("the official product name is MARAS AI", () => {
  it("the drawer says MARAS AI and never a forbidden rename", () => {
    const drawer = region(ADMIN_PANEL, "MARAS AI drawer", 6000);
    expect(drawer).toContain("MARAS AI");
    for (const banned of ["Admin AI", "eTIR AI", "MARAS Assistant"]) {
      expect(ADMIN_PANEL).not.toContain(banned);
    }
  });
});

describe("monitoring is wired without a new database", () => {
  it("the response observer classifies finished /api requests through the tested pure module", () => {
    expect(SERVER).toContain("classifyRequestForMonitoring({");
    expect(SERVER).toContain('res.on("finish"');
    expect(SERVER).toContain("const monitoringEvents: MonitoringEvent[] = [];");
  });

  it("frontend error reports are admin-authenticated and feed the same grouped store", () => {
    expect(SERVER).toContain('app.post("/api/admin/monitoring/frontend-error", requireRole("admin")');
  });

  it("the env example documents the three variables with empty placeholders only", () => {
    expect(ENV_EXAMPLE).toContain('OPENAI_API_KEY=""');
    expect(ENV_EXAMPLE).toContain('OPENAI_MODEL=""');
    expect(ENV_EXAMPLE).toContain('MARAS_AI_ENABLED=""');
    expect(ENV_EXAMPLE).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
  });
});
