import { describe, it, expect } from "vitest";
import { canDeletePushToken } from "./pushTokenAccess";

describe("canDeletePushToken", () => {
  it("BUG-18: allows a session to delete its own token", () => {
    const session = { id: "driver-1", role: "driver" };
    const record = { userId: "driver-1", role: "driver" };
    expect(canDeletePushToken(session, record)).toBe(true);
  });

  it("BUG-18: blocks a different user with the same role", () => {
    const session = { id: "driver-2", role: "driver" };
    const record = { userId: "driver-1", role: "driver" };
    expect(canDeletePushToken(session, record)).toBe(false);
  });

  it("BUG-18: blocks a role mismatch even with the same id", () => {
    const session = { id: "shared-id", role: "client" };
    const record = { userId: "shared-id", role: "driver" };
    expect(canDeletePushToken(session, record)).toBe(false);
  });

  it("BUG-18: an admin session gets no override - it must match the record like anyone else", () => {
    const session = { id: "admin-1", role: "admin" };
    const record = { userId: "driver-1", role: "driver" };
    expect(canDeletePushToken(session, record)).toBe(false);
  });

  it("BUG-18: an admin can still delete its own token", () => {
    const session = { id: "admin-1", role: "admin" };
    const record = { userId: "admin-1", role: "admin" };
    expect(canDeletePushToken(session, record)).toBe(true);
  });

  it("treats a record missing owner metadata as owned by no one", () => {
    const session = { id: "driver-1", role: "driver" };
    expect(canDeletePushToken(session, {})).toBe(false);
  });
});
