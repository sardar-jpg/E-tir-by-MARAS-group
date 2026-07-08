import { describe, it, expect } from "vitest";
import {
  isSuperAdmin,
  canViewShipmentRegistry,
  canViewDriverRoster,
  canViewAdminRoster,
  canViewClients,
  canViewVendors,
  canManageClients,
  canManageVendors,
  resolveFullAdminStatus,
  sanitizeCreatedAdminType,
  isProtectedOwnerAccount,
} from "./adminAccess";

describe("isSuperAdmin", () => {
  it("is true only for 'super'", () => {
    expect(isSuperAdmin("super")).toBe(true);
    expect(isSuperAdmin("operation")).toBe(false);
    expect(isSuperAdmin("accounts")).toBe(false);
    expect(isSuperAdmin(undefined)).toBe(false);
  });
});

describe("canViewShipmentRegistry", () => {
  it("allows super and operation, blocks accounts", () => {
    expect(canViewShipmentRegistry("super")).toBe(true);
    expect(canViewShipmentRegistry("operation")).toBe(true);
    expect(canViewShipmentRegistry("accounts")).toBe(false);
    expect(canViewShipmentRegistry(undefined)).toBe(false);
  });
});

describe("canViewDriverRoster", () => {
  it("allows super and operation, blocks accounts", () => {
    expect(canViewDriverRoster("super")).toBe(true);
    expect(canViewDriverRoster("operation")).toBe(true);
    expect(canViewDriverRoster("accounts")).toBe(false);
    expect(canViewDriverRoster(undefined)).toBe(false);
  });
});

describe("canViewAdminRoster", () => {
  it("allows only super — operation and accounts are both blocked from the Team roster", () => {
    expect(canViewAdminRoster("super")).toBe(true);
    expect(canViewAdminRoster("operation")).toBe(false);
    expect(canViewAdminRoster("accounts")).toBe(false);
    expect(canViewAdminRoster(undefined)).toBe(false);
  });
});

describe("canViewClients / canViewVendors", () => {
  it("allows super, operation, and accounts — the AdminPanel UI shows the Clients/Vendors tabs to all three", () => {
    expect(canViewClients("super")).toBe(true);
    expect(canViewClients("operation")).toBe(true);
    expect(canViewClients("accounts")).toBe(true);
    expect(canViewClients(undefined)).toBe(false);

    expect(canViewVendors("super")).toBe(true);
    expect(canViewVendors("operation")).toBe(true);
    expect(canViewVendors("accounts")).toBe(true);
    expect(canViewVendors(undefined)).toBe(false);
  });
});

describe("canManageClients / canManageVendors", () => {
  it("allows super and operation to write, blocks accounts (read-only)", () => {
    expect(canManageClients("super")).toBe(true);
    expect(canManageClients("operation")).toBe(true);
    expect(canManageClients("accounts")).toBe(false);
    expect(canManageClients(undefined)).toBe(false);

    expect(canManageVendors("super")).toBe(true);
    expect(canManageVendors("operation")).toBe(true);
    expect(canManageVendors("accounts")).toBe(false);
    expect(canManageVendors(undefined)).toBe(false);
  });
});

describe("resolveFullAdminStatus", () => {
  it("returns 401 only when there is no session at all", () => {
    expect(resolveFullAdminStatus(null)).toBe(401);
    expect(resolveFullAdminStatus(undefined)).toBe(401);
  });

  it("returns 403 — not 401 — for an authenticated session with the wrong role", () => {
    expect(resolveFullAdminStatus({ role: "client" })).toBe(403);
    expect(resolveFullAdminStatus({ role: "driver" })).toBe(403);
  });

  it("returns 403 for an authenticated admin with an insufficient adminType", () => {
    expect(resolveFullAdminStatus({ role: "admin", adminType: "accounts" })).toBe(403);
  });

  it("returns 200 for super/operation admins, leaving successful access unchanged", () => {
    expect(resolveFullAdminStatus({ role: "admin", adminType: "super" })).toBe(200);
    expect(resolveFullAdminStatus({ role: "admin", adminType: "operation" })).toBe(200);
  });
});

describe("sanitizeCreatedAdminType", () => {
  it("never lets a caller mint a 'super' admin through POST /api/admins", () => {
    expect(sanitizeCreatedAdminType("super")).toBe("operation");
  });

  it("passes through 'accounts' as requested", () => {
    expect(sanitizeCreatedAdminType("accounts")).toBe("accounts");
  });

  it("defaults anything else (including missing/garbage input) to 'operation'", () => {
    expect(sanitizeCreatedAdminType("operation")).toBe("operation");
    expect(sanitizeCreatedAdminType(undefined)).toBe("operation");
    expect(sanitizeCreatedAdminType(null)).toBe("operation");
    expect(sanitizeCreatedAdminType("root")).toBe("operation");
    expect(sanitizeCreatedAdminType(123)).toBe("operation");
  });
});

describe("isProtectedOwnerAccount", () => {
  const OWNER_EMAIL = "sardar@maras.iq";

  it("protects any record whose adminType is 'super', regardless of email", () => {
    expect(isProtectedOwnerAccount({ adminType: "super", email: "someone-else@maras.iq" }, OWNER_EMAIL)).toBe(true);
  });

  it("protects a record matching the owner email even if adminType is missing/wrong", () => {
    expect(isProtectedOwnerAccount({ email: "Sardar@Maras.IQ" }, OWNER_EMAIL)).toBe(true);
    expect(isProtectedOwnerAccount({ email: "sardar@maras.iq", adminType: "operation" }, OWNER_EMAIL)).toBe(true);
  });

  it("does not protect an unrelated operation/accounts admin", () => {
    expect(isProtectedOwnerAccount({ adminType: "operation", email: "ops@maras.iq" }, OWNER_EMAIL)).toBe(false);
    expect(isProtectedOwnerAccount({ adminType: "accounts", email: "accounts@maras.iq" }, OWNER_EMAIL)).toBe(false);
  });

  it("returns false for null/undefined candidates or a missing owner email", () => {
    expect(isProtectedOwnerAccount(null, OWNER_EMAIL)).toBe(false);
    expect(isProtectedOwnerAccount(undefined, OWNER_EMAIL)).toBe(false);
    expect(isProtectedOwnerAccount({ email: "sardar@maras.iq" }, "")).toBe(false);
  });
});
