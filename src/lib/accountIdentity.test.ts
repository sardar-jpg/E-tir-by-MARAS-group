import { describe, it, expect } from "vitest";
import {
  findGlobalIdentityCollision,
  identityConflictMessage,
  buildOwnerIdentityRecord,
  parseAdminType,
  validateCreatedAdminType,
  ADMIN_TYPES,
  type IdentityRecord,
} from "./accountIdentity";

const RECORDS: IdentityRecord[] = [
  { source: "admins", id: "admin-1", email: "ops@maras.iq" },
  { source: "drivers", id: "driver-1", username: "murat", email: "murat@example.com", phone: "+964 750 111 2222" },
  { source: "clients", id: "client-1", username: "acme_owner", email: "owner@acme.com", phone: "+90 532 000 1111" },
  buildOwnerIdentityRecord("sardar@maras.iq"),
];

describe("global identity uniqueness — one rule for every role", () => {
  it("duplicate username in the SAME role is rejected", () => {
    expect(findGlobalIdentityCollision({ username: "murat" }, RECORDS)).toBe("username");
  });

  it("duplicate username ACROSS roles is rejected (client staff cannot take a driver username)", () => {
    expect(findGlobalIdentityCollision({ username: "acme_owner" }, RECORDS)).toBe("username");
    expect(findGlobalIdentityCollision({ username: "murat", email: "fresh@x.com" }, RECORDS)).toBe("username");
  });

  it("duplicate email across roles is rejected (driver cannot register with an admin email)", () => {
    expect(findGlobalIdentityCollision({ email: "ops@maras.iq" }, RECORDS)).toBe("email");
    expect(findGlobalIdentityCollision({ email: "owner@acme.com" }, RECORDS)).toBe("email");
  });

  it("duplicate phone across roles is rejected (admin cannot reuse a client phone)", () => {
    expect(findGlobalIdentityCollision({ phone: "+90 532 000 1111" }, RECORDS)).toBe("phone");
  });

  it("case and whitespace are normalized; phone compares whitespace-insensitively (no country-code invention)", () => {
    expect(findGlobalIdentityCollision({ username: "  MURAT  " }, RECORDS)).toBe("username");
    expect(findGlobalIdentityCollision({ email: " OPS@MARAS.IQ " }, RECORDS)).toBe("email");
    expect(findGlobalIdentityCollision({ phone: "+9647501112222" }, RECORDS)).toBe("phone");
    // No digit rewriting: a genuinely different number never collides.
    expect(findGlobalIdentityCollision({ phone: "07501112222" }, RECORDS)).toBeNull();
  });

  it("blank/missing candidate fields are ignored", () => {
    expect(findGlobalIdentityCollision({}, RECORDS)).toBeNull();
    expect(findGlobalIdentityCollision({ username: "", email: "   ", phone: "" }, RECORDS)).toBeNull();
    expect(findGlobalIdentityCollision({ username: "brand-new" }, RECORDS)).toBeNull();
  });

  it("self-update with unchanged identity is allowed (own record excluded), but claiming another account still fails", () => {
    const self = { source: "drivers", id: "driver-1" };
    expect(findGlobalIdentityCollision({ username: "murat", email: "murat@example.com", phone: "+964 750 111 2222" }, RECORDS, self)).toBeNull();
    expect(findGlobalIdentityCollision({ username: "acme_owner" }, RECORDS, self)).toBe("username");
    // Exclusion is source+id scoped — the same id in a DIFFERENT collection is not "self".
    expect(findGlobalIdentityCollision({ username: "murat" }, RECORDS, { source: "clients", id: "driver-1" })).toBe("username");
  });

  it("the protected owner identity (email + username form) can never be claimed by any role", () => {
    expect(findGlobalIdentityCollision({ email: "sardar@maras.iq" }, RECORDS)).toBe("email");
    expect(findGlobalIdentityCollision({ email: "  SARDAR@MARAS.IQ " }, RECORDS)).toBe("email");
    expect(findGlobalIdentityCollision({ username: "sardar" }, RECORDS)).toBe("username");
  });

  it("the conflict message names ONLY the field type — never the conflicting account, role, or collection", () => {
    for (const field of ["username", "email", "phone"] as const) {
      const msg = identityConflictMessage(field);
      expect(msg).toContain("already in use");
      for (const leak of ["admin", "driver", "client", "owner", "murat", "acme", "maras.iq"]) {
        expect(msg.toLowerCase()).not.toContain(leak);
      }
    }
  });
});

describe("strict adminType validation — no fallback, ever", () => {
  it("the canonical list is exactly super/operation/accounts", () => {
    expect([...ADMIN_TYPES]).toEqual(["super", "operation", "accounts"]);
  });

  it("parseAdminType accepts only the exact strings", () => {
    expect(parseAdminType("super")).toBe("super");
    expect(parseAdminType("operation")).toBe("operation");
    expect(parseAdminType("accounts")).toBe("accounts");
    for (const bad of ["Super", " operation ", "ACCOUNTS", "admin", "root", "", null, undefined, 42, {}, ["operation"]]) {
      expect(parseAdminType(bad)).toBeNull();
    }
  });

  it("creation validation: operation and accounts pass; missing/unknown/case-tricks are 400-shaped errors", () => {
    expect(validateCreatedAdminType("operation")).toEqual({ ok: true, adminType: "operation" });
    expect(validateCreatedAdminType("accounts")).toEqual({ ok: true, adminType: "accounts" });
    for (const bad of [undefined, null, "", "admin", "Operation", " accounts "]) {
      const r = validateCreatedAdminType(bad);
      expect(r.ok).toBe(false);
    }
  });

  it("'super' is explicitly rejected at creation — not silently downgraded (the old fallback is gone)", () => {
    const r = validateCreatedAdminType("super");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Super Admin");
    // And no input of any kind can produce a fallback type:
    for (const bad of ["root", undefined, "Super"]) {
      const check = validateCreatedAdminType(bad);
      expect(check.ok).toBe(false);
      expect((check as { adminType?: string }).adminType).toBeUndefined();
    }
  });
});
