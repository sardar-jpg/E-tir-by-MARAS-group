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

describe("stale-session invalidation is wired into the session middleware (fail-closed)", () => {
  const MW = region("const staleSessionLogAt = new Map", 4200);

  it("every authenticated request verifies the backing account through the tested pure module", () => {
    expect(MW).toContain("isOwnerSession(payload, ownerEmail)");
    expect(MW).toContain("backingCollectionForRole(payload.role)");
    expect(MW).toContain("evaluateSessionBacking(payload, { exists: snap.exists()");
    // Definitive rejection: the session is simply not attached (ordinary
    // 401 downstream); nothing is ever created from stale session data.
    expect(MW).not.toContain("setDoc(");
    expect(MW).not.toContain("updateDoc(");
  });

  it("PR #137 review: infrastructure failure NEVER attaches the session — it flags 503, not authorization", () => {
    // The catch block sets the verification-unavailable flag…
    expect(MW).toContain("req.sessionVerificationUnavailable = true");
    // …and contains NO session attachment (the only `req.session =` in the
    // middleware appear on the owner path and the verified-ok path).
    const catchAt = MW.indexOf("} catch (err) {");
    const catchBlock = MW.slice(catchAt, MW.indexOf("next();", catchAt));
    expect(catchBlock).not.toContain("req.session = payload");
    expect(catchBlock).toContain("verification unavailable");
    // The old fail-open wording is gone from the server entirely.
    expect(SERVER).not.toContain("keeping session for this request");
  });

  it("protected routes answer 503 SESSION_VERIFICATION_UNAVAILABLE on verification outage — via every auth gate", () => {
    const HELPER = region("function respondIfSessionVerificationUnavailable", 900);
    expect(HELPER).toContain("503");
    expect(HELPER).toContain("SESSION_VERIFICATION_UNAVAILABLE_CODE");
    // All 11 gates consult the helper: requireAuth, requireRole (factory),
    // requireFullAdmin, requireSuperAdmin, requireShipmentAccess, and the
    // six canView/canWrite gates.
    const gateCalls = SERVER.split("if (respondIfSessionVerificationUnavailable(req, res)) return;").length - 1;
    expect(gateCalls).toBeGreaterThanOrEqual(11);
    // Public/unauthenticated surfaces stay unaffected: the share routes
    // use no auth gate at all.
    const SHARE = region('app.get("/api/share/:token"', 300);
    expect(SHARE).not.toContain("requireAuth");
  });

  it("rejection + infra logging is throttled and secret-free", () => {
    expect(MW).toContain("STALE_SESSION_LOG_THROTTLE_MS");
    expect(MW).toContain("stale session rejected");
    // No token VALUE ever reaches a log line (no template interpolation of
    // the token variable anywhere in the middleware).
    expect(MW).not.toContain("${token");
    expect(MW).not.toContain(", token)");
  });
});

describe("PR #137 review: transactional identity reservations are the authoritative uniqueness mechanism", () => {
  it("the atomic executor runs claims+releases+account write in ONE transaction (memory mode synchronous)", () => {
    const EXEC = region("async function applyIdentityReservation", 3400);
    expect(EXEC).toContain("(db as any).runTransaction(async (tx: any) =>");
    expect(EXEC).toContain("findClaimConflict(op.claims, existing, op.owner)");
    expect(EXEC).toContain("throw new IdentityConflictError(conflict)");
    expect(EXEC).toContain("canReleaseReservation(");
    expect(EXEC).toContain("applyIdentityReservationMemory(");
    // Memory-fallback collection entry exists (PR #44 lesson).
    expect(SERVER).toContain("accountIdentityKeys: IdentityReservationRecord[];");
    expect(SERVER).toContain("accountIdentityKeys: [],");
  });

  it("all six create/update account paths and all four delete paths go through the executor", () => {
    const count = SERVER.split("await applyIdentityReservation({").length - 1;
    expect(count).toBeGreaterThanOrEqual(10); // 3 creates + self-register + 2 updates + 4 deletes/releases (+ owner startup)
    // Creates/updates write the account INSIDE the reservation transaction…
    expect(SERVER.split("accountWrite: { collection:").length - 1).toBeGreaterThanOrEqual(5);
    // …and deletes remove the account + release only its own keys together.
    expect(SERVER.split("accountDelete: { collection:").length - 1).toBeGreaterThanOrEqual(4);
    // The raw account setDoc/deleteDoc calls those paths used are gone.
    expect(SERVER).not.toContain('await setDoc(doc(db, "admins", newAdmin.id), newAdmin)');
    expect(SERVER).not.toContain('await setDoc(doc(db, "drivers", newDriver.id), newDriver)');
    expect(SERVER).not.toContain('await setDoc(doc(db, "clients", newClient.id), newClient)');
  });

  it("owner identity keys are reserved at startup under the untouchable owner source", () => {
    const OWNER = region("const ownerReservationTimer", 900);
    expect(OWNER).toContain("OWNER_RESERVATION_SOURCE");
    expect(OWNER).toContain("computeOwnerClaims(ownerEmail)");
  });

  it("the backfill script is dry-run by default, never auto-resolves collisions, and EVERY execute-mode write is transactional", () => {
    const SCRIPT = readFileSync(join(ROOT, "scripts", "backfill-identity-keys.ts"), "utf-8");
    expect(SCRIPT).toContain('process.argv.includes("--execute")');
    expect(SCRIPT).toContain("DRY RUN (nothing written)");
    expect(SCRIPT).toContain("never auto-resolved");
    expect(SCRIPT).toContain("COLLISION");
    // PR #137 final review: the initial snapshot is a plan, not
    // authorization — each write re-reads the reservation AND the backing
    // account inside a transaction and goes through the pure decision.
    expect(SCRIPT).toContain("db.runTransaction(async (tx)");
    expect(SCRIPT).toContain("decideBackfillWrite({");
    expect(SCRIPT).toContain("await tx.get(keyRef)");
    expect(SCRIPT).toContain("STALE ${keyId");
    // No unconditional set remains — the only reservation write is tx.set
    // inside the "create" branch.
    expect(SCRIPT).not.toContain(".doc(keyId).set(");
    expect(SCRIPT).toContain('if (d.action === "create")');
  });

  it("the stale fail-open wording is gone from the middleware documentation", () => {
    expect(SERVER).not.toContain("fail-open");
    expect(SERVER).not.toContain("keeps the session");
    const DOC = region("Failure handling (FAIL-CLOSED", 700);
    expect(DOC).toContain("attaches NO session");
    expect(DOC).toContain("503 SESSION_VERIFICATION_UNAVAILABLE");
    expect(DOC).toContain("Owner sessions are independent of the");
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
  it("no API route can create/update its way to a second super admin; the only admin-update route sets permissions only", () => {
    // No adminType-mutating admin update route exists.
    expect(SERVER).not.toContain('app.patch("/api/admins');
    const R = region('app.post("/api/admins"', 3600);
    // The only path to a created adminType is the strict validator, whose
    // unit tests prove "super" is rejected, never downgraded.
    expect(R).toContain("adminType: typeCheck.adminType");
    // The one PUT admin route (increment 4) manages ACCOUNTING PERMISSIONS
    // only — Super Admin only, owner/super target rejected, and it writes a
    // sanitized `permissions` array; it never touches adminType.
    expect(SERVER).toContain('app.put("/api/admins/:id/permissions", requireSuperAdmin');
    const PERM = region('app.put("/api/admins/:id/permissions"', 1200);
    expect(PERM).toContain("sanitizeAccountingPermissions(req.body?.permissions)");
    expect(PERM).toContain("permissions: after");
    expect(PERM).not.toContain("adminType:"); // never mutates the role
    // Escalation guards: owner/super target rejected, self-edit rejected.
    expect(SERVER).toContain("The Super Admin account's permissions cannot be modified.");
    expect(PERM).toContain("You cannot modify your own permissions.");
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
  it("admin deletion, client disable, and driver rejection all use the canonical helper with SNAPSHOT DOC IDS", () => {
    // PR #137 review item 3: never assume the token value equals the doc
    // id — every cleanup maps `{ id: t.id, ...t.data() }` and deletes by
    // the ids selectPushTokensForAccountDeletion returns.
    for (const [needle, role, len] of [
      ['app.delete("/api/admins/:id"', '{ id, role: "admin" }', 4200],
      ['app.put("/api/clients/:id"', '{ id: req.params.id, role: "client" }', 6400],
      ['app.patch("/api/drivers/:id/status"', '{ id: req.params.id, role: "driver" }', 2600],
    ] as const) {
      const R = region(needle, len);
      expect(R).toContain("id: t.id, ...(t.data()");
      expect(R).toContain(`selectPushTokensForAccountDeletion(tokenRecords, ${role})`);
    }
    const STATUS = region('app.patch("/api/drivers/:id/status"', 2600);
    expect(STATUS).toContain('status === "rejected"');
    // No CLEANUP path deletes by the token VALUE field: every pushTokens
    // deleteDoc in the server uses ids produced by the canonical helper
    // or the ownership-checked single-token route — never `t.token`.
    for (const badPattern of ['deleteDoc(doc(db, "pushTokens", t.token', 'deleteDoc(doc(db, "pushTokens", tokenValue']) {
      expect(SERVER).not.toContain(badPattern);
    }
  });

  it("the ownership helper itself selects by document id even when it differs from the token value", async () => {
    const { selectPushTokensForAccountDeletion } = await import("./pushTokenAccess");
    const docs = [
      { id: "doc-abc", userId: "admin-1", role: "admin" }, // doc id ≠ token value
      { id: "doc-def", userId: "admin-2", role: "admin" },
      { id: "doc-ghi", userId: "admin-1", role: "driver" }, // same user id, different role — untouched
    ];
    expect(selectPushTokensForAccountDeletion(docs, { id: "admin-1", role: "admin" })).toEqual(["doc-abc"]);
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
