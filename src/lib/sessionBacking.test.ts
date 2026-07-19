import { describe, it, expect } from "vitest";
import { evaluateSessionBacking, backingCollectionForRole, isOwnerSession } from "./sessionBacking";

describe("stale-session invalidation — backing account decisions", () => {
  it("the env-configured owner session is valid without a Firestore record", () => {
    expect(isOwnerSession({ role: "admin", id: "sardar@maras.iq" }, "sardar@maras.iq")).toBe(true);
    expect(isOwnerSession({ role: "admin", id: " SARDAR@MARAS.IQ " }, "sardar@maras.iq")).toBe(true);
    expect(isOwnerSession({ role: "admin", id: "admin-2" }, "sardar@maras.iq")).toBe(false);
    expect(isOwnerSession({ role: "driver", id: "sardar@maras.iq" }, "sardar@maras.iq")).toBe(false);
    expect(isOwnerSession({ role: "admin", id: "sardar@maras.iq" }, "")).toBe(false);
  });

  it("each role maps to its backing collection; unknown roles are rejected outright", () => {
    expect(backingCollectionForRole("admin")).toBe("admins");
    expect(backingCollectionForRole("driver")).toBe("drivers");
    expect(backingCollectionForRole("client")).toBe("clients");
    expect(backingCollectionForRole("superuser")).toBeNull();
    expect(backingCollectionForRole(undefined)).toBeNull();
    expect(evaluateSessionBacking({ role: "ghost", id: "x" }, { exists: true, record: {} })).toEqual({ ok: false, reason: "unknown_role" });
  });

  it("a DELETED account cannot restore an old session (any role)", () => {
    for (const role of ["admin", "driver", "client"]) {
      expect(evaluateSessionBacking({ role, id: "gone", adminType: "operation" }, { exists: false })).toEqual({ ok: false, reason: "missing" });
    }
  });

  it("a disabled client and a rejected/pending driver cannot restore old sessions", () => {
    expect(evaluateSessionBacking({ role: "client", id: "c1" }, { exists: true, record: { active: false } })).toEqual({ ok: false, reason: "blocked" });
    expect(evaluateSessionBacking({ role: "driver", id: "d1" }, { exists: true, record: { status: "rejected" } })).toEqual({ ok: false, reason: "blocked" });
    expect(evaluateSessionBacking({ role: "driver", id: "d1" }, { exists: true, record: { status: "pending" } })).toEqual({ ok: false, reason: "blocked" });
  });

  it("a changed adminType invalidates stale elevated claims — the admin must log in again", () => {
    const demoted = evaluateSessionBacking(
      { role: "admin", id: "a1", adminType: "super" },
      { exists: true, record: { adminType: "operation" } }
    );
    expect(demoted).toEqual({ ok: false, reason: "role_changed" });
    // …and the other direction too (a stale lower-privilege token does not
    // silently continue after promotion — re-login gets the new claims).
    const promoted = evaluateSessionBacking(
      { role: "admin", id: "a1", adminType: "accounts" },
      { exists: true, record: { adminType: "operation" } }
    );
    expect(promoted.ok).toBe(false);
  });

  it("unaffected valid sessions remain valid (matching admin, approved/legacy driver, active/legacy client)", () => {
    expect(evaluateSessionBacking({ role: "admin", id: "a1", adminType: "operation" }, { exists: true, record: { adminType: "operation" } })).toEqual({ ok: true });
    expect(evaluateSessionBacking({ role: "driver", id: "d1" }, { exists: true, record: { status: "approved" } })).toEqual({ ok: true });
    expect(evaluateSessionBacking({ role: "driver", id: "d-legacy" }, { exists: true, record: {} })).toEqual({ ok: true }); // pre-approval-era driver
    expect(evaluateSessionBacking({ role: "client", id: "c1" }, { exists: true, record: { active: true } })).toEqual({ ok: true });
    expect(evaluateSessionBacking({ role: "client", id: "c-legacy" }, { exists: true, record: {} })).toEqual({ ok: true }); // pre-active-flag client
  });
});
