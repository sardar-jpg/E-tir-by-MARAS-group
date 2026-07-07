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
