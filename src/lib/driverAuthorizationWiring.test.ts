import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Wiring/contract tests for Stage 2 PR 5 (audit findings M-1 + M-2):
 * driver API authorization and fake-record removal. Source-scans the real
 * routes so none of the hardened behaviors can silently regress.
 */
const ROOT = join(__dirname, "..", "..");
const SERVER = readFileSync(join(ROOT, "server.ts"), "utf-8");

const region = (needle: string, length: number): string => {
  const at = SERVER.indexOf(needle);
  expect(at, `server.ts must contain: ${needle}`).toBeGreaterThan(-1);
  return SERVER.slice(at, at + length);
};

describe("M-1 — production APIs never fabricate records", () => {
  it("PUT /api/drivers/:id returns 404 for unknown ids — the Simulated Specialist auto-create is gone", () => {
    const R = region('app.put("/api/drivers/:id"', 6500);
    expect(R).toContain("if (!dDoc.exists()) {");
    expect(R).toContain('res.status(404).json({ error: "Driver not found." })');
    // The fabricated identity is gone from the entire server.
    expect(SERVER).not.toContain("Simulated Specialist");
    expect(SERVER).not.toContain("TR-7733-IQ");
    // Real creation happens only through the two creation routes.
    expect(SERVER).toContain('app.post("/api/drivers", requireFullAdmin');
    expect(SERVER).toContain('app.post("/api/drivers/self-register"');
  });

  it("missing shipments 404; sessions never recreate accounts (PR #137 pins still hold)", () => {
    const SHIP = region('app.get("/api/shipments/:id", requireAuth', 800);
    expect(SHIP).toContain('res.status(404).json({ error: "Shipment not found" })');
    const MW = region("const staleSessionLogAt = new Map", 4200);
    expect(MW).not.toContain("setDoc(");
  });
});

describe("M-2 — driver identity comes from the verified session only", () => {
  const PUT = region('app.put("/api/drivers/:id"', 6500);

  it("a driver may update only their own record; accounts-type admins are rejected from driver writes", () => {
    expect(PUT).toContain('req.session!.role === "driver" && req.session!.id !== req.params.id');
    expect(PUT).toContain("You can only update your own profile.");
    expect(PUT).toContain('req.session!.role === "admin" && resolveFullAdminStatus(req.session) !== 200');
    expect(PUT).toContain("Accounts-type admins cannot modify driver profiles.");
    // Admin-managed alliance fields still rejected for driver sessions.
    expect(PUT).toContain("Working routes and availability status are managed by MARAS Operations.");
    // The update never spreads the raw request body into the record.
    expect(PUT).not.toContain("...req.body");
    // approval status is not an updatable field on this route.
    expect(PUT).not.toContain("updatedDriver.status");
  });

  it("shipment access/status/chat/documents authorize by the AUTHORITATIVE assignment, never a client-sent driver id", () => {
    const ACCESS = region("function requireShipmentAccess", 2600);
    expect(ACCESS).toContain("const driverId = req.session!.id");
    expect(ACCESS).toContain("shipment.assignedDriverId === driverId");
    expect(ACCESS).toContain("ad.driverId === driverId");
    const STATUS = region('app.put("/api/shipments/:id/status"', 2000);
    expect(STATUS).toContain("const driverId = req.session!.id");
    expect(STATUS).toContain("You are not assigned to this shipment.");
    // GET /api/shipments/:id enforces the same ownership and filters the
    // response through the role view (no costs/customer identity for drivers).
    const GETID = region('app.get("/api/shipments/:id", requireAuth', 2400);
    expect(GETID).toContain("shipment.assignedDriverId === driverId");
    expect(GETID).toContain("buildShipmentViewForRole(shipment, req.session!)");
  });

  it("alliance offer reads/responses derive the driver from the session", () => {
    const RESPOND = region('app.post("/api/alliance/offers/:id/respond"', 900);
    expect(RESPOND).toContain("const driverId = req.session!.id");
    const VIEWED = region('app.post("/api/alliance/offers/:id/viewed"', 700);
    expect(VIEWED).toContain("const driverId = req.session!.id");
    const LIST = region('app.get("/api/alliance/offers", requireAuth', 900);
    expect(LIST).toContain('"driverId", driverId');
  });

  it("chat and document attribution are server-derived — client-sent identity strings are ignored", () => {
    const CHAT = region('app.post("/api/shipments/:id/chat", requireShipmentAccess', 3400);
    expect(CHAT).toContain("await resolveChatSenderIdentity(req)");
    const DOCS = region('app.post("/api/shipments/:id/documents", requireShipmentAccess', 3400);
    expect(DOCS).toContain("(await resolveChatSenderIdentity(req)).senderName");
    expect(DOCS).not.toContain('uploadedBy || "Admin"');
    // Driver upload/category policy retained.
    expect(DOCS).toContain("canDriverUploadDocumentCategory(category)");
  });

  it("M-1 final blocker: document records are validated BEFORE any write — placeholder defaults are gone", () => {
    const DOCS = region('app.post("/api/shipments/:id/documents", requireShipmentAccess', 3800);
    expect(DOCS).toContain("validateDocumentReference({ name, url })");
    expect(DOCS).toContain("INVALID_DOCUMENT_INPUT_CODE");
    // Ordering: validation happens before the shipment write, activity
    // log, and notification — a 400 has zero side effects.
    const validateAt = DOCS.indexOf("validateDocumentReference");
    expect(validateAt).toBeGreaterThan(-1);
    for (const write of ["newDoc", "logActivity", "pushNotification"]) {
      const writeAt = DOCS.indexOf(write);
      if (writeAt >= 0) expect(validateAt).toBeLessThan(writeAt);
    }
    // The fabrication fallbacks no longer exist anywhere in the server.
    expect(SERVER).not.toContain('name || "document.bin"');
    expect(SERVER).not.toContain('url || "#"');
    expect(SERVER).not.toContain('fileName || "unnamed_document.bin"');
    // Chat file messages carry the name requirement through the shared
    // validator (behavioral tests in chatMessageValidation.test.ts).
    const CHAT = region('app.post("/api/shipments/:id/chat", requireShipmentAccess', 3400);
    expect(CHAT).toContain("validateChatSendPayload({ type, text, fileUrl, fileName })");
  });

  it("push tokens register under the session identity and delete only with ownership", () => {
    const REG = region('app.post("/api/push-tokens"', 900);
    expect(REG).toContain("userId: req.session!.id");
    const DEL = region('app.delete("/api/push-tokens/:token"', 1200);
    expect(DEL).toContain("canDeletePushToken(");
  });
});

describe("denial logging — safe, throttled, no sensitive payloads", () => {
  it("blocked cross-account/cross-assignment attempts log role+id+target only", () => {
    const HELPER = region("function logSecurityDenial", 900);
    expect(HELPER).toContain("securityDenialLogAt");
    expect(HELPER).toContain("10 * 60 * 1000"); // throttle window
    // Wired into the three denial hot spots.
    expect(SERVER.split("logSecurityDenial(").length - 1).toBeGreaterThanOrEqual(6); // helper + 5 call sites
    expect(SERVER).toContain('logSecurityDenial("shipment_access"');
    expect(SERVER).toContain('logSecurityDenial("shipment_status_write"');
    expect(SERVER).toContain('logSecurityDenial("driver_profile_write"');
    // No call site passes bodies/locations/tokens — details are template
    // strings referencing ids only.
    for (const m of SERVER.matchAll(/logSecurityDenial\([^;]+;/g)) {
      expect(m[0]).not.toContain("req.body");
      expect(m[0]).not.toContain("latitude");
      expect(m[0]).not.toContain("token");
      expect(m[0]).not.toContain("password");
    }
  });
});

describe("status-code contract and PR #137 protections remain intact", () => {
  it("401 only from missing auth; 403 for authenticated cross-access; 404 for missing records; 503 for verification outage", () => {
    const AUTH = region("function requireAuth", 400);
    expect(AUTH).toContain("401");
    expect(SERVER).toContain('res.status(403).json({ error: "You do not have access to this shipment." })');
    expect(SERVER).toContain('res.status(404).json({ error: "Driver not found." })');
    expect(SERVER).toContain("SESSION_VERIFICATION_UNAVAILABLE_CODE");
    // Owner + fail-closed session machinery untouched. Perf Phase 1 caches
    // only the backing READ; the pure verdict still runs on every request.
    expect(SERVER).toContain("isOwnerSession(payload, ownerEmail)");
    expect(SERVER).toContain("evaluateSessionBacking(payload, backing)");
    const gateCalls = SERVER.split("if (respondIfSessionVerificationUnavailable(req, res)) return;").length - 1;
    expect(gateCalls).toBeGreaterThanOrEqual(11);
  });

  it("driver responses stay sensitive-field-free (role view + sanitizeDriver still the only exits)", () => {
    const VIEW = readFileSync(join(ROOT, "src", "lib", "shipmentView.ts"), "utf-8");
    for (const stripped of ["agreedAmount: _agreedAmount", "internalNotes: _internalNotes", "companyName: _companyName"]) {
      expect(VIEW).toContain(stripped);
    }
    // The driver list route sanitizes and scopes.
    const LIST = region('app.get("/api/drivers", requireAuth', 1700);
    expect(LIST).toContain("sanitizeDriver");
    expect(LIST).toContain("scopeDriverListForSession");
  });
});
