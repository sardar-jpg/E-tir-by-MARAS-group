import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Wiring/contract tests for Stage 2 PR 4 (account identity + stale-session
 * hardening): source-scans server.ts so the pure helpers cannot exist
 * unused and the hardened behaviors cannot silently regress.
 */
const ROOT = join(__dirname, "..", "..");
const SERVER = readFileSync(join(ROOT, "server.ts"), "utf-8");

const region = (needle: string, length: number): string => {
  const at = SERVER.indexOf(needle);
  expect(at, `server.ts must contain: ${needle}`).toBeGreaterThan(-1);
  return SERVER.slice(at, at + length);
};

describe("stale-session invalidation is wired into the session middleware", () => {
  const MW = region("const staleSessionLogAt = new Map", 3200);

  it("every authenticated request verifies the backing account through the tested pure module", () => {
    expect(MW).toContain("isOwnerSession(payload, ownerEmail)");
    expect(MW).toContain("backingCollectionForRole(payload.role)");
    expect(MW).toContain("evaluateSessionBacking(payload, { exists: snap.exists()");
    // Definitive rejection: the session is simply not attached (ordinary
    // 401 downstream); nothing is ever created from stale session data.
    expect(MW).not.toContain("setDoc(");
    expect(MW).not.toContain("updateDoc(");
  });

  it("rejection logging is throttled and secret-free; infra errors fail open, never into a fake verdict", () => {
    expect(MW).toContain("STALE_SESSION_LOG_THROTTLE_MS");
    expect(MW).toContain("stale session rejected");
    // Log lines carry role + id only — never the token.
    expect(MW).not.toContain("${token");
    expect(MW).toContain("keeping session for this request");
  });
});

describe("global identity uniqueness is enforced on every account-mutation route", () => {
  it("one snapshot loader covers admins + drivers + clients + the protected owner", () => {
    const LOADER = region("async function loadAllIdentityRecords", 1600);
    expect(LOADER).toContain('getDocs(collection(db, "admins"))');
    expect(LOADER).toContain('getDocs(collection(db, "drivers"))');
    expect(LOADER).toContain('getDocs(collection(db, "clients"))');
    expect(LOADER).toContain("buildOwnerIdentityRecord(ownerEmail)");
  });

  it("admin creation: strict adminType + email collision; the silent-fallback sanitizer is gone from the codebase", () => {
    const R = region('app.post("/api/admins"', 3600);
    expect(R).toContain("validateCreatedAdminType(data.adminType)");
    expect(R).toContain("findGlobalIdentityCollision({ email: data.email }");
    expect(R).toContain("identityConflictMessage(");
    expect(SERVER).not.toContain("sanitizeCreatedAdminType");
    const ADMIN_ACCESS = readFileSync(join(ROOT, "src", "lib", "adminAccess.ts"), "utf-8");
    expect(ADMIN_ACCESS).not.toContain("export function sanitizeCreatedAdminType");
  });

  it("driver creation (admin + self-register) and driver identity edits run the global check", () => {
    const CREATE = region('app.post("/api/drivers", requireFullAdmin', 1400);
    expect(CREATE).toContain("findGlobalIdentityCollision(");
    const SELF = region('app.post("/api/drivers/self-register"', 5200);
    expect(SELF).toContain("findGlobalIdentityCollision(");
    const PUT = region('app.put("/api/drivers/:id"', 3400);
    expect(PUT).toContain('{ source: "drivers", id: req.params.id }'); // self-exclusion on update
  });

  it("client creation and client identity edits run the global check (update excludes self)", () => {
    const CREATE = region('app.post("/api/clients"', 3600);
    expect(CREATE).toContain("findGlobalIdentityCollision(");
    const PUT = region('app.put("/api/clients/:id"', 3200);
    expect(PUT).toContain('{ source: "clients", id: req.params.id }');
  });

  it("conflict responses are 409s built ONLY from identityConflictMessage (field type, no account details)", () => {
    // Every identity 409 goes through the canonical message helper.
    const count = SERVER.split("identityConflictMessage(").length - 1;
    expect(count).toBeGreaterThanOrEqual(6); // admins, drivers x3, clients x2
    // The old per-role reveal-y messages are gone.
    expect(SERVER).not.toContain("already registered to another driver");
    expect(SERVER).not.toContain("already registered to another client account");
  });
});

describe("owner protection", () => {
  it("no API route can create/update its way to a second super admin, and no admin-update route exists at all", () => {
    expect(SERVER).not.toContain('app.put("/api/admins');
    expect(SERVER).not.toContain('app.patch("/api/admins');
    const R = region('app.post("/api/admins"', 3600);
    // The only path to a created adminType is the strict validator, whose
    // unit tests prove "super" is rejected, never downgraded.
    expect(R).toContain("adminType: typeCheck.adminType");
  });

  it("owner deletion stays blocked on BOTH delete routes, and blocked attempts are audit-trailed", () => {
    const DEL = region('app.delete("/api/admins/:id"', 3400);
    expect(DEL).toContain("isProtectedOwnerAccount(");
    expect(DEL).toContain("The owner account cannot be deleted.");
    expect(DEL).toContain("BLOCKED: attempt to delete the protected owner account");
    // Self-service route keeps its own owner guard (pre-existing).
    const ACCT = region('app.delete("/api/account"', 2600);
    expect(ACCT).toContain("ownerProtected");
  });
});

describe("push tokens and audit trail on delete/disable", () => {
  it("admin deletion, client disable, and driver rejection all revoke ONLY the target account's push tokens", () => {
    const DEL = region('app.delete("/api/admins/:id"', 3400);
    expect(DEL).toContain("t.userId === id");
    const CLI = region('app.put("/api/clients/:id"', 4600);
    expect(CLI).toContain("t.userId === req.params.id");
    const STATUS = region('app.patch("/api/drivers/:id/status"', 2200);
    expect(STATUS).toContain('status === "rejected"');
    expect(STATUS).toContain("t.userId === req.params.id");
  });

  it("activity log entries exist for admin creation/deletion and client disabling — with no credential material", () => {
    expect(SERVER).toContain("Admin account created:");
    expect(SERVER).toContain("Admin account deleted:");
    expect(SERVER).toContain("Client account disabled:");
    for (const needle of ["Admin account created:", "Admin account deleted:", "Client account disabled:"]) {
      const at = SERVER.indexOf(needle);
      // The complete logActivity(...) statement this message belongs to —
      // from the call start to its terminating semicolon.
      const callStart = SERVER.lastIndexOf("logActivity", at);
      const callEnd = SERVER.indexOf(";", at);
      const logCall = SERVER.slice(callStart, callEnd);
      expect(logCall).not.toContain("password");
      expect(logCall).not.toContain("Hash");
      expect(logCall).not.toContain("token");
    }
  });
});
