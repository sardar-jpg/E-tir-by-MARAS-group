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
  const CHAT_ROUTE = region(SERVER, 'app.post("/api/admin/maras-ai/chat"', 14000);

  it("chat requires a full admin (super/operation — same audience as the drawer); never public", () => {
    expect(SERVER).toContain('app.post("/api/admin/maras-ai/chat", requireFullAdmin,');
  });

  it("technical alerts are Super Admin ONLY", () => {
    expect(SERVER).toContain('app.get("/api/admin/maras-ai/alerts", requireSuperAdmin,');
  });

  it("the monitoring digest joins the AI context ONLY for a super-admin session", () => {
    expect(CHAT_ROUTE).toContain('if (needs.monitoring && req.session!.adminType === "super") {');
    expect(CHAT_ROUTE).toContain("const technicalAlerts = deriveTechnicalAlerts(monitoringEvents);");
    expect(CHAT_ROUTE).toContain("buildMonitoringAiContext(technicalAlerts)");
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
    expect(CHAT_ROUTE).toContain("res.json({ reply: responseText, model, source, structured, persisted, conversation: toConversationSummary(convo) })");
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
    const CHAT_ROUTE = region(SERVER, 'app.post("/api/admin/maras-ai/chat"', 14000);
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

  it("attention badge: derived from existing system data via the shared rule, dismissed on open, never from the AI provider", () => {
    // AdminPanel derives it from the loaded shipments + the EXISTING
    // alerts endpoint (super only) through the tested pure function…
    expect(ADMIN_PANEL).toContain("deriveMarasAiAttention({ shipments, monitoringAlertSeverities: marasAiAlertSeverities");
    expect(ADMIN_PANEL).toContain('apiFetch("/api/admin/maras-ai/alerts")');
    expect(ADMIN_PANEL).toContain("if (resolvedAdminType !== 'super') return;");
    // …opening the drawer dismisses the current actionable set…
    expect(ADMIN_PANEL).toContain("if (isMarasAiOpen) setMarasAiBadgeDismissedSignature(marasAiAttention.signature);");
    expect(ADMIN_PANEL).toContain("marasAiAttention.signature !== marasAiBadgeDismissedSignature && !isMarasAiOpen");
    // …and the bar renders a pure presentational dot (no polling, no AI
    // call, no interval anywhere in the badge path).
    expect(ADMIN_PANEL).toContain("marasAiAttention={showMarasAiBadge}");
    const barTrigger = region(MOBILE_BAR, "onMarasAiClick && (", 900);
    expect(barTrigger).toContain("marasAiAttention && (");
    expect(barTrigger).toContain("bg-orange-500");
    expect(MOBILE_BAR).not.toContain("setInterval");
    expect(ADMIN_PANEL).not.toMatch(/setInterval\([^)]*maras/i);
  });

  it("RTL: the drawer flips side and direction; the bar trigger is a fixed-size flex item that reorders with dir", () => {
    expect(ADMIN_PANEL).toContain("dir={isRtl ? 'rtl' : 'ltr'}");
    expect(ADMIN_PANEL).toContain("isRtl ? 'left-0 border-r' : 'right-0 border-l'");
    const trigger = region(MOBILE_BAR, "onMarasAiClick && (", 600);
    expect(trigger).toContain("w-9 h-9 shrink-0");
  });
});

describe("response presentation (PR #130) — structured cards + safe Markdown, one shared component", () => {
  const RESPONSE_VIEW = readFileSync(join(ROOT, "src", "components", "admin", "MarasAiResponseView.tsx"), "utf-8");

  it("the chat route returns and persists the typed structured payload (derived from collected data, not parsed Markdown)", () => {
    const CHAT_ROUTE = region(SERVER, 'app.post("/api/admin/maras-ai/chat"', 14000);
    expect(CHAT_ROUTE).toContain("buildStructuredMarasAiResults(intents, systemData, nowIso)");
    expect(CHAT_ROUTE).toContain("res.json({ reply: responseText, model, source, structured, persisted, conversation: toConversationSummary(convo) })");
    expect(CHAT_ROUTE).toContain("...(structured.length ? { structured } : {})");
    // Monitoring cards only ever join inside the existing Super Admin gate.
    const superGate = region(CHAT_ROUTE, 'if (needs.monitoring && req.session!.adminType === "super")', 400);
    expect(superGate).toContain("structured.push(buildMonitoringAlertsResult(technicalAlerts))");
  });

  it("both mobile and desktop render assistant turns through the ONE shared response view", () => {
    expect(ADMIN_PANEL).toContain("<MarasAiResponseView");
    expect(ADMIN_PANEL.split("<MarasAiResponseView").length - 1).toBe(1); // one call site — the shared drawer bubble
    expect(ADMIN_PANEL).toContain("structured={turn.structured}");
  });

  it("Markdown renders through the typed parser — never raw HTML injection", () => {
    expect(RESPONSE_VIEW).toContain("parseMarasAiMarkdown");
    expect(RESPONSE_VIEW).not.toContain("dangerouslySetInnerHTML");
    expect(ADMIN_PANEL).not.toContain("dangerouslySetInnerHTML");
    // External links opened safely.
    expect(RESPONSE_VIEW).toContain('rel="noopener noreferrer"');
  });

  it("navigation actions are read-only routes into existing views, gated by handler + id", () => {
    // Buttons render only when a valid internal id exists AND a handler was passed.
    expect(RESPONSE_VIEW).toContain("const hasId = !!item.id;");
    expect(RESPONSE_VIEW).toContain("hasId && (onOpenShipment || onOpenTracking || onOpenChat)");
    // AdminPanel role-gates tracking with the existing permission rule and
    // every handler only navigates + closes the drawer (no writes).
    expect(ADMIN_PANEL).toContain("onOpenTracking={canViewGpsTracking(resolvedAdminType) ? handleMarasAiOpenTracking : undefined}");
    const openShipment = region(ADMIN_PANEL, "const handleMarasAiOpenShipment", 700);
    expect(openShipment).toContain("setOpenDetailsId(shipmentId)");
    expect(openShipment).toContain("setChatCenterFocus({ shipmentId, channel: 'internal_staff' })");
    expect(openShipment).not.toMatch(/apiFetch\([^)]*method:\s*["'](POST|PUT|DELETE)/);
  });

  it("status labels reuse the existing EN/TR/AR translations; cards localize their own field labels", () => {
    expect(RESPONSE_VIEW).toContain("getShipmentStatusLabel");
    for (const needle of ["Geciken Sevkiyatlar", "الشحنات المتأخرة", "Delayed Shipments"]) {
      expect(RESPONSE_VIEW).toContain(needle);
    }
  });

  it("stored conversations round-trip their card payloads (backward compatible with older plain messages)", () => {
    expect(ADMIN_PANEL).toContain("...(Array.isArray(m.structured) ? { structured: m.structured } : {})");
  });
});

describe("full internal audit (PR #131) — deterministic, persistent, scoped, no hard deletes", () => {
  const MONITORING_PANEL = readFileSync(join(ROOT, "src", "components", "admin", "MarasAiMonitoringPanel.tsx"), "utf-8");

  it("manual runs are Super Admin only; the scheduler endpoint authorizes through the tested pure module", () => {
    expect(SERVER).toContain('app.post("/api/admin/audit/run", requireSuperAdmin,');
    // PR #136: the endpoint is app.all (unsupported methods get an explicit
    // 405, never the SPA catch-all) and auth is the pure, constant-time
    // evaluateSchedulerAuth (src/lib/auditScheduler.ts — unit tested there).
    const SCHED = region(SERVER, 'app.all("/api/audit/scheduler-run"', 2600);
    expect(SCHED).toContain('evaluateSchedulerAuth(process.env.AUDIT_SCHEDULER_TOKEN, req.headers["x-audit-token"])');
    expect(SCHED).toContain('"Scheduler runs are not enabled on this server."');
    expect(SCHED).toContain("405");
    expect(SCHED).toContain('res.setHeader("Allow", "POST")');
    expect(SCHED).toContain("isDuplicateSchedulerFire(");
    // Secret safety: the handler never interpolates a token into any string.
    expect(SCHED).not.toContain("${provided");
    expect(SCHED).not.toContain("${configured");
    expect(SERVER).not.toContain('app.post("/api/audit/scheduler-run"'); // old registration is gone
  });

  it("every read is scope-filtered through the tested rule; ignore/resolve are Super Admin only", () => {
    expect(SERVER).toContain('app.get("/api/admin/audit/summary", requireRole("admin")');
    expect(SERVER).toContain('app.get("/api/admin/audit/findings", requireRole("admin")');
    const ACTION = region(SERVER, 'app.post("/api/admin/audit/findings/:id/action"', 2600);
    expect(ACTION).toContain("visibleAuditScopesFor(adminType).includes(finding.scope)");
    expect(ACTION).toContain('adminType !== "super"');
    expect(ACTION).toContain("Only a Super Admin can ignore or manually resolve findings.");
    expect(SERVER.split("filterFindingsForViewer(").length - 1).toBeGreaterThanOrEqual(3); // summary, findings, AI context
  });

  it("runs are lock-protected, duration-capped, and persisted; findings are NEVER hard-deleted", () => {
    expect(SERVER).toContain("async function acquireAuditLock(");
    expect(SERVER).toContain("AUDIT_LOCK_TTL_MS");
    expect(SERVER).toContain("AUDIT_MAX_DURATION_MS");
    expect(SERVER).toContain('setDoc(doc(db, "auditFindings", finding.id), finding)');
    expect(SERVER).toContain('setDoc(doc(db, "auditRuns", runId), run)');
    expect(SERVER).not.toContain('deleteDoc(doc(db, "auditFindings"'); // no hard deletes, ever
    // Memory-fallback entries exist (PR #44 lesson).
    expect(SERVER).toContain("auditFindings: AuditFinding[];");
    expect(SERVER).toContain("auditRuns: AuditRunRecord[];");
    expect(SERVER).toContain("auditState: [],");
  });

  it("scheduling: startup pass + best-effort interval + fresh-run skip; scheduler endpoint is the correctness path", () => {
    expect(SERVER).toContain('void runAudit("startup", "system")');
    expect(SERVER).toContain('void runAudit("interval", "system")');
    expect(SERVER).toContain("AUDIT_MIN_GAP_MS");
  });

  it("the audit context sanitizes admins (no password fields) and push failures feed monitoring", () => {
    const CTX = region(SERVER, "async function loadAuditContext", 2600);
    expect(CTX).toContain("adminType: a.adminType");
    // The mapped admin object never reads a credential property.
    expect(CTX).not.toContain("a.password");
    expect(CTX).not.toContain("passwordHash");
    expect(SERVER).toContain("notifyMonitoringOfPushFailure");
  });

  it("new high/critical findings produce ONE grouped ai_alert notification per run — never one per finding", () => {
    const RUN = region(SERVER, "async function runAudit(", 7000);
    expect(RUN).toContain("if (rec.newlyCriticalOrHigh.length > 0) {");
    expect(RUN).toContain('type: "ai_alert"');
    // The notification write sits outside any per-finding loop: exactly one setDoc to notifications in the run body.
    expect(RUN.split('doc(db, "notifications"').length - 1).toBe(1);
  });

  it("MARAS AI receives findings as scope-filtered system data and is told never to invent findings", () => {
    const CHAT = region(SERVER, 'app.post("/api/admin/maras-ai/chat"', 16000);
    expect(CHAT).toContain("if (needs.auditFindings) {");
    expect(CHAT).toContain('filterFindingsForViewer(allFindings, req.session!.adminType || "")');
    expect(CHAT).toContain("buildAuditFindingsAiContext(visibleFindings)");
    expect(CHAT).toContain("buildAuditFindingsResult(visibleFindings)");
  });

  it("the badge counts open high/critical findings and is never dismissed by opening the drawer", () => {
    expect(ADMIN_PANEL).toContain('apiFetch("/api/admin/audit/summary")');
    expect(ADMIN_PANEL).toContain("auditOpenHighOrCritical > 0");
    // The audit term sits OUTSIDE the signature-dismissal expression.
    expect(ADMIN_PANEL).toContain("marasAiAttention.signature !== marasAiBadgeDismissedSignature && !isMarasAiOpen) ||");
  });

  it("recommended priority: derived server-side at read time, shown everywhere, never from OpenAI", () => {
    // Summary carries the four-bucket triage row; findings are decorated
    // and sorted by the deterministic engine.
    expect(SERVER).toContain("byPriority: summarizeFindingPriorities(visible, new Date().toISOString())");
    expect(SERVER).toContain("sortFindingsByPriority(findings, nowIso)");
    expect(SERVER).toContain("priority: assessFindingPriority(f, nowIso)");
    // The AI receives priorities as data and is told they are the ONLY
    // real ones — explain, never invent.
    const CHAT = region(SERVER, 'app.post("/api/admin/maras-ai/chat"', 17000);
    expect(CHAT).toContain("const prio = assessFindingPriority(f, nowIso);");
    const INTENTS = readFileSync(join(ROOT, "src", "lib", "marasAiIntents.ts"), "utf-8");
    expect(INTENTS).toContain("the ONLY real findings and the ONLY real priorities");
    // Dashboard triage row + per-finding priority block; AI cards show the label.
    expect(MONITORING_PANEL).toContain("byPriority");
    expect(MONITORING_PANEL).toContain('t("priorities", lang)');
    expect(MONITORING_PANEL).toContain("f.priority.responseTarget");
    const VIEW = readFileSync(join(ROOT, "src", "components", "admin", "MarasAiResponseView.tsx"), "utf-8");
    expect(VIEW).toContain("f.priorityLabel");
  });

  it("the monitoring dashboard is safe presentation: server-scoped data, audited actions, no HTML injection", () => {
    expect(ADMIN_PANEL).toContain("<MarasAiMonitoringPanel");
    expect(MONITORING_PANEL).toContain('apiFetch("/api/admin/audit/summary")');
    expect(MONITORING_PANEL).toContain("/api/admin/audit/findings/");
    expect(MONITORING_PANEL).not.toContain("dangerouslySetInnerHTML");
    // Run Audit Now renders only for Super Admin; ignore/resolve buttons too.
    expect(MONITORING_PANEL).toContain("{isSuper && (");
    expect(MONITORING_PANEL).toContain("isSuper && f.status !== \"resolved\"");
    // Ignore/resolve require a typed reason before any request is sent.
    expect(MONITORING_PANEL).toContain('window.prompt(t("reasonPrompt", lang))');
  });
});

describe("unified dashboard + MARAS AI Brief (PR #132)", () => {
  const BRIEF_CARD = readFileSync(join(ROOT, "src", "components", "admin", "MarasAiBriefCard.tsx"), "utf-8");

  it("the brief GET is one consolidated, scope-filtered fetch that NEVER calls OpenAI", () => {
    expect(SERVER).toContain('app.get("/api/admin/dashboard/brief", requireRole("admin")');
    const GET_ROUTE = region(SERVER, 'app.get("/api/admin/dashboard/brief"', 1800);
    expect(GET_ROUTE).not.toContain("getOpenAiClient");
    expect(GET_ROUTE).toContain('summarizes: "all_current_operations"');
    // Scope filtering + restricted-category gating live in ONE computer.
    const COMPUTE = region(SERVER, "async function computeDashboardBrief", 2600);
    expect(COMPUTE).toContain("filterFindingsForViewer(");
    expect(COMPUTE).toContain('scopes.includes("accounting")');
    expect(COMPUTE).toContain('adminType === "super"');
    expect(COMPUTE).toContain(": null");
  });

  it("only the explicit refresh may call the provider, sends ONLY the digest, and caches per scope", () => {
    const REFRESH = region(SERVER, 'app.post("/api/admin/dashboard/brief/refresh"', 3600);
    expect(REFRESH).toContain("resolveMarasAiAvailability(process.env)");
    expect(REFRESH).toContain("buildBriefAiDigest(computed.brief)");
    expect(REFRESH).toContain("`brief_${computed.scopeKey}`");
    // Honest degradation: unavailability/failure -> deterministic brief + aiError.
    expect(REFRESH).toContain("showing the deterministic brief only");
    // The digest is the ONLY payload — no raw collections in the AI call.
    const AI_CALL = region(REFRESH, "getOpenAiClient().responses.create", 400);
    expect(AI_CALL).not.toContain("shipments");
    expect(AI_CALL).not.toContain("costStatements");
  });

  it("navigation: Logistics Analytics is a dedicated Reports tab (the Dashboard redesign retired the redirect)", () => {
    // The redesigned Dashboard no longer stacks analytics; the operational
    // recharts view is restored as its own role-gated Business-group tab.
    expect(ADMIN_PANEL).toContain("{ id: 'reports', label: t('reports'), icon: BarChart3 }");
    expect(ADMIN_PANEL).toContain("activeTab === 'reports' && canViewLogisticsAnalytics(resolvedAdminType)");
    // The old redirect-into-Dashboard effect is gone.
    expect(ADMIN_PANEL).not.toContain("if (activeTab === 'reports') {");
  });

  it("analytics reuses the SAME lazy component, data, and permission gate (now a dedicated Reports page)", () => {
    // The redesign moved analytics onto its own tab — still exactly ONE
    // AdminReportsSection render site, same data + canViewLogisticsAnalytics gate.
    expect(ADMIN_PANEL.split("<AdminReportsSection").length - 1).toBe(1);
    expect(ADMIN_PANEL).toContain("performanceAnalyticsData={performanceAnalyticsData}");
    expect(ADMIN_PANEL).toContain("activeTab === 'reports' && canViewLogisticsAnalytics(resolvedAdminType)");
  });

  it("the redesigned Dashboard no longer stacks the MARAS AI brief; MARAS AI stays reachable via its monitoring modal", () => {
    // The Executive Brief card is no longer rendered on the Dashboard
    // Overview (the concise redesign dropped the stacked sections). The
    // component file is kept intact, and MARAS AI stays reachable — the
    // dashboard Action Center opens the existing monitoring modal.
    expect(ADMIN_PANEL.split("<MarasAiBriefCard").length - 1).toBe(0);
    expect(ADMIN_PANEL).toContain("onOpenActionCenter={() => setIsMarasAiMonitoringOpen(true)}");
  });

  it("the card is honest and isolated: deterministic content, cached AI, explicit refresh, contained failures", () => {
    // GET on mount; POST only from the Refresh button's load(true).
    expect(BRIEF_CARD).toContain('await apiFetch("/api/admin/dashboard/brief")');
    expect(BRIEF_CARD).toContain('await apiFetch("/api/admin/dashboard/brief/refresh", { method: "POST" })');
    expect(BRIEF_CARD).toContain("void load(false); }, [load]");
    // Source indicator uses the server's source field only.
    expect(BRIEF_CARD).toContain('data.source === "system_data_ai_analysis"');
    expect(BRIEF_CARD).toContain("System Data + AI Analysis");
    expect(BRIEF_CARD).toContain('t("lastUpdated", lang)');
    expect(BRIEF_CARD).toContain('t("scopeAll", lang)');
    // Failure isolation: errors render inside the card, never thrown upward.
    expect(BRIEF_CARD).toContain("The rest of the dashboard is unaffected.");
    expect(BRIEF_CARD).not.toContain("dangerouslySetInnerHTML");
    // Run Audit Now renders only for Super Admin.
    expect(BRIEF_CARD).toContain("{isSuper && (");
  });
});

describe("executive dashboard (PR #133) — deterministic finances, per-user layout", () => {
  const FIN_SECTION = readFileSync(join(ROOT, "src", "components", "admin", "ExecutiveFinancialSection.tsx"), "utf-8");

  it("the financial route mirrors accounting access exactly and never touches the AI provider", () => {
    expect(SERVER).toContain('app.get("/api/admin/dashboard/financial", requireRole("admin")');
    const FIN = region(SERVER, 'app.get("/api/admin/dashboard/financial"', 1600);
    expect(FIN).toContain("canViewCostStatements(req.session!.adminType");
    expect(FIN).toContain("Financial overview requires accounting access.");
    expect(FIN).toContain("buildExecutiveFinanceOverview(");
    expect(FIN).not.toContain("getOpenAiClient");
    expect(FIN).not.toContain("OPENAI");
  });

  it("layout persistence is strictly per admin id and always normalized", () => {
    expect(SERVER).toContain('app.get("/api/admin/dashboard/layout", requireRole("admin")');
    expect(SERVER).toContain('app.put("/api/admin/dashboard/layout", requireRole("admin")');
    const PUT = region(SERVER, 'app.put("/api/admin/dashboard/layout"', 1000);
    expect(PUT).toContain("normalizeDashboardLayout(req.body?.layout)");
    expect(PUT).toContain('doc(db, "adminDashboardLayouts", req.session!.id)');
    expect(SERVER).toContain("adminDashboardLayouts: [],"); // memory-fallback entry (PR #44 lesson)
  });

  it("the dashboard still intersects the saved layout with role permissions (customize UI retired by the redesign)", () => {
    expect(ADMIN_PANEL).toContain("visibleOrderedSections(dashboardLayout, permittedDashboardSections)");
    const PERM = region(ADMIN_PANEL, "const permittedDashboardSections", 600);
    expect(PERM).toContain("canViewCostStatements(effectiveType)");
    expect(PERM).toContain("canViewLogisticsAnalytics(effectiveType)");
    // Layout persistence stays wired (endpoint + client helper) even though
    // the concise redesign renders only the operations dashboard.
    expect(ADMIN_PANEL).toContain('apiFetch("/api/admin/dashboard/layout", {');
    expect(ADMIN_PANEL).toContain("visibleOrderedSections(dashboardLayout, permittedDashboardSections).includes('operations')");
    // The per-section drag/hide customize panel + stacked financial sections
    // were removed by the redesign (single concise dashboard).
    expect(ADMIN_PANEL).not.toContain("saveDashboardLayout(toggleDashboardSection(dashboardLayout, sectionId))");
    expect(ADMIN_PANEL).not.toContain("sectionId === 'financial_alerts' && canViewCostStatements(resolvedAdminType)");
  });

  it("financial UI states its source and reuses deterministic accounting findings for alerts", () => {
    expect(FIN_SECTION).toContain("never mixed, never AI");
    expect(FIN_SECTION).toContain('apiFetch("/api/admin/dashboard/financial")');
    // Financial Alerts = the PR #131 accounting findings verbatim — no new detection.
    expect(FIN_SECTION).toContain('apiFetch("/api/admin/audit/findings?category=accounting&status=open")');
    expect(FIN_SECTION).not.toContain("dangerouslySetInnerHTML");
    // The brief is now titled Executive Brief (product name MARAS AI unchanged elsewhere).
    const BRIEF_CARD = readFileSync(join(ROOT, "src", "components", "admin", "MarasAiBriefCard.tsx"), "utf-8");
    expect(BRIEF_CARD).toContain('en: "Executive Brief"');
  });

  it("review refinements: renamed section, Open Shipments Value KPI, Top Customer This Month", () => {
    // The section component is titled Executive Financial Overview — an
    // Executive Dashboard view, not an accounting page. (The dashboard's
    // former section-label map was removed in the Dashboard redesign.)
    expect(FIN_SECTION).toContain('en: "Executive Financial Overview"');
    // Open Shipments Value: deterministic shipment data, and its card opens
    // the shipment list pre-filtered to ACTIVE using the SAME status rule
    // (isOpenShipmentStatus) the KPI itself uses — they can never disagree.
    expect(FIN_SECTION).toContain("openShipmentsValue");
    expect(FIN_SECTION).toContain("onOpenShipments");
    expect(ADMIN_PANEL).toContain("setStatusFilter('active'); setTypeFilter('all'); setActiveTab('shipments');");
    expect(ADMIN_PANEL).toContain("isOpenShipmentStatus(s.status)");
    // Top Customer This Month is never ranked by revenue alone: gross
    // profit first, revenue tie-break, name as the deterministic last word.
    expect(FIN_SECTION).toContain("topCustomerThisMonth");
    const FIN_LIB = readFileSync(join(ROOT, "src", "lib", "executiveFinance.ts"), "utf-8");
    expect(FIN_LIB).toContain("z[1].grossProfit - a[1].grossProfit || z[1].revenue - a[1].revenue || a[0].localeCompare(z[0])");
    expect(FIN_LIB).not.toContain("highestRevenueCustomer");
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
