import { describe, it, expect } from "vitest";
import {
  isSuperAdmin,
  canViewShipmentRegistry,
  canViewDriverRoster,
  canViewAdminRoster,
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
