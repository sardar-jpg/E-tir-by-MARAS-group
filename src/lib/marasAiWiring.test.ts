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
  const CHAT_ROUTE = region(SERVER, 'app.post("/api/admin/maras-ai/chat"', 12000);

  it("chat requires a full admin (super/operation — same audience as the drawer); never public", () => {
    expect(SERVER).toContain('app.post("/api/admin/maras-ai/chat", requireFullAdmin,');
  });

  it("technical alerts are Super Admin ONLY", () => {
    expect(SERVER).toContain('app.get("/api/admin/maras-ai/alerts", requireSuperAdmin,');
  });

  it("the monitoring digest joins the AI context ONLY for a super-admin session", () => {
    expect(CHAT_ROUTE).toContain('if (needs.monitoring && req.session!.adminType === "super") {');
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
    expect(CHAT_ROUTE).toContain("buildMarasAiInput(historyForModel, parsed.message)");
  });

  it("system awareness: the request is inspected and backend data collected BEFORE the prompt is built", () => {
    expect(CHAT_ROUTE).toContain("detectMarasAiIntents(parsed.message)");
    expect(CHAT_ROUTE).toContain("requiredDataForIntents(intents)");
    expect(CHAT_ROUTE).toContain("buildSystemContextBlocks(intents, systemData, nowIso)");
    // Data collection goes through the project's existing persistence
    // wrappers — the same getDocs every other route uses.
    expect(CHAT_ROUTE).toContain('getDocs(collection(db, "shipments"))');
    expect(CHAT_ROUTE).toContain('getDocs(collection(db, "drivers"))');
    expect(CHAT_ROUTE).toContain('getDocs(collection(db, "costStatements"))');
  });

  it("the reply carries the honest response-source indicator", () => {
    expect(CHAT_ROUTE).toContain("resolveMarasAiResponseSource({ usedSystemData: systemBlocks.length > 0, usedAiModel: true })");
    expect(CHAT_ROUTE).toContain("res.json({ reply: responseText, model, source, persisted, conversation: toConversationSummary(convo) })");
  });
});

describe("MARAS AI conversation history — per-admin, persisted, never shared", () => {
  it("all three conversation routes exist behind requireFullAdmin", () => {
    expect(SERVER).toContain('app.get("/api/admin/maras-ai/conversations", requireFullAdmin,');
    expect(SERVER).toContain('app.get("/api/admin/maras-ai/conversations/:id", requireFullAdmin,');
    expect(SERVER).toContain('app.delete("/api/admin/maras-ai/conversations/:id", requireFullAdmin,');
  });

  it("every read/delete is ownership-checked through the tested rule", () => {
    const LIST = region(SERVER, 'app.get("/api/admin/maras-ai/conversations"', 1200);
    const GET_ONE = region(SERVER, 'app.get("/api/admin/maras-ai/conversations/:id"', 1200);
    const DELETE_ONE = region(SERVER, 'app.delete("/api/admin/maras-ai/conversations/:id"', 1200);
    expect(LIST).toContain("canAccessConversation(c, adminId)");
    expect(GET_ONE).toContain("canAccessConversation(stored, req.session!.id)");
    expect(DELETE_ONE).toContain("canAccessConversation(stored, req.session!.id)");
    // Not-owned and missing answer identically.
    expect(GET_ONE).toContain("status(404)");
    expect(DELETE_ONE).toContain("status(404)");
  });

  it("the chat route continues a conversation only after the same ownership check", () => {
    const CHAT_ROUTE = region(SERVER, 'app.post("/api/admin/maras-ai/chat"', 12000);
    expect(CHAT_ROUTE).toContain("canAccessConversation(stored, adminId)");
    expect(CHAT_ROUTE).toContain('doc(db, "marasAiConversations", convo.id)');
  });

  it("conversations persist through the existing persistence layer (memory-fallback entry included)", () => {
    expect(SERVER).toContain("marasAiConversations: MarasAiConversation[];");
    expect(SERVER).toContain("marasAiConversations: [],");
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

  it("conversation history: the drawer lists, opens, deletes, and starts conversations", () => {
    expect(ADMIN_PANEL).toContain('apiFetch("/api/admin/maras-ai/conversations")');
    expect(ADMIN_PANEL).toContain("apiFetch(`/api/admin/maras-ai/conversations/${conversationId}`)");
    expect(ADMIN_PANEL).toContain('apiFetch(`/api/admin/maras-ai/conversations/${conversationId}`, { method: "DELETE" })');
    expect(ADMIN_PANEL).toContain("handleNewMarasAiConversation");
    expect(ADMIN_PANEL).toContain("New Conversation");
    // Continuing a conversation defers history to the server's stored thread.
    expect(ADMIN_PANEL).toContain("{ conversationId: activeMarasAiConversationId }");
  });

  it("quick suggestions come from the shared intent module and populate the prompt", () => {
    expect(ADMIN_PANEL).toContain("MARAS_AI_QUICK_SUGGESTIONS.map((suggestion)");
    expect(ADMIN_PANEL).toContain("setMarasAiPrompt(suggestion.prompt)");
  });

  it("the response-source indicator renders from the server's own source field, never invented client-side", () => {
    expect(ADMIN_PANEL).toContain("MARAS_AI_SOURCE_LABELS");
    expect(ADMIN_PANEL).toContain("turn.role === 'assistant' && turn.source");
    // The client never computes or defaults a source itself — it only
    // renders what the server sent on this turn.
    expect(ADMIN_PANEL).not.toContain("source: 'system_data");
    expect(ADMIN_PANEL).not.toContain('source: "system_data');
  });
});

describe("mobile access — same drawer, same roles, desktop unchanged", () => {
  const MOBILE_BAR = readFileSync(join(ROOT, "src", "components", "admin", "mobile", "MobileTopAppBar.tsx"), "utf-8");

  it("the mobile top bar renders the MARAS AI trigger only when AdminPanel passed the handler", () => {
    expect(MOBILE_BAR).toContain("onMarasAiClick?: () => void");
    expect(MOBILE_BAR).toContain("{onMarasAiClick && (");
    expect(MOBILE_BAR).toContain('aria-label="MARAS AI"');
    // The bar never decides roles itself — absent handler = no button.
    expect(MOBILE_BAR).not.toMatch(/adminType|'super'|'operation'/);
  });

  it("AdminPanel gates the mobile trigger with the SAME role check as the desktop button", () => {
    const gate = "resolvedAdminType === 'super' || resolvedAdminType === 'operation'";
    // Desktop button gate — unchanged from PR #36/#128.
    expect(ADMIN_PANEL).toContain(`{(${gate}) && (`);
    // Mobile handler: same gate, else undefined (button hidden for
    // accounts admins and every other unauthorized role).
    const mobileWiring = region(ADMIN_PANEL, "onMarasAiClick={", 500);
    expect(mobileWiring).toContain(gate);
    expect(mobileWiring).toContain("setIsMarasAiOpen(true)");
    expect(mobileWiring).toContain(": undefined");
  });

  it("tapping opens the ONE existing drawer — no separate mobile page, no duplicate conversation logic", () => {
    expect(ADMIN_PANEL.split("{isMarasAiOpen && (resolvedAdminType === 'super' || resolvedAdminType === 'operation') && (").length - 1).toBe(1);
    expect(ADMIN_PANEL.split('apiFetch("/api/admin/maras-ai/chat"').length - 1).toBe(1);
    expect(ADMIN_PANEL.split("const handleSendMarasAi").length - 1).toBe(1);
  });

  it("the drawer respects mobile safe areas (notch + home indicator) and contains its own scrolling", () => {
    // max(designed padding, env inset) — a no-op on desktop where env()=0.
    expect(ADMIN_PANEL).toContain("pt-[max(1.25rem,env(safe-area-inset-top))]");
    expect(ADMIN_PANEL).toContain("pb-[max(1.25rem,env(safe-area-inset-bottom))]");
    expect(ADMIN_PANEL).toContain("overscroll-contain");
  });

  it("RTL: the drawer flips side and direction; the bar trigger is a fixed-size flex item that reorders with dir", () => {
    expect(ADMIN_PANEL).toContain("dir={isRtl ? 'rtl' : 'ltr'}");
    expect(ADMIN_PANEL).toContain("isRtl ? 'left-0 border-r' : 'right-0 border-l'");
    const trigger = region(MOBILE_BAR, "onMarasAiClick && (", 600);
    expect(trigger).toContain("w-9 h-9 shrink-0");
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

describe("monitoring is persistent — existing persistence layer, no new database", () => {
  it("the response observer classifies finished /api requests through the tested pure module", () => {
    expect(SERVER).toContain("classifyRequestForMonitoring({");
    expect(SERVER).toContain('res.on("finish"');
    expect(SERVER).toContain("const monitoringEvents: MonitoringEvent[] = [];");
  });

  it("event groups persist to the monitoringEvents collection and hydrate back after a restart", () => {
    // Start-up hydration merges persisted groups into the working set…
    expect(SERVER).toContain('getDocs(collection(db, "monitoringEvents"))');
    expect(SERVER).toContain("mergeMonitoringEvents(monitoringEvents, persisted)");
    // …recording writes back through the SAME wrappers every other
    // collection uses (write-behind, grouped by key)…
    expect(SERVER).toContain("recordAndPersistMonitoringEvent(");
    expect(SERVER).toContain('setDoc(doc(db, "monitoringEvents", docId)');
    expect(SERVER).toContain("monitoringDocIdForKey(");
    // …and the memory fallback has its collection entry (PR #44 lesson).
    expect(SERVER).toContain("monitoringEvents: MonitoringEvent[];");
    expect(SERVER).toContain("monitoringEvents: [],");
  });

  it("retention is automatic: expired groups are pruned and their documents deleted", () => {
    expect(SERVER).toContain("pruneExpiredMonitoringEvents(monitoringEvents, new Date().toISOString())");
    expect(SERVER).toContain('deleteDoc(doc(db, "monitoringEvents", monitoringDocIdForKey(expired.key)))');
  });

  it("the alerts route hydrates before deriving, so history survives a restart", () => {
    const ALERTS = region(SERVER, 'app.get("/api/admin/maras-ai/alerts"', 400);
    expect(ALERTS).toContain("await ensureMonitoringHydrated();");
    expect(ALERTS).toContain("deriveTechnicalAlerts(monitoringEvents)");
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
