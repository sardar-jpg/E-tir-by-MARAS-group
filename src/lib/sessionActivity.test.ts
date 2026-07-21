import { describe, it, expect } from "vitest";
import { touchStoredSessionActivity, SESSION_STORAGE_KEY, type StringStorage } from "./sessionActivity";

function memoryStorage(initial: Record<string, string> = {}): StringStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const FIXED_NOW = 1_800_000_000_000;

describe("touchStoredSessionActivity", () => {
  it("writes the correct lastActive value and reports it", () => {
    const storage = memoryStorage({
      [SESSION_STORAGE_KEY]: JSON.stringify({ role: "admin", email: "a@b.co", lastActive: 1 }),
    });
    const res = touchStoredSessionActivity(storage, () => FIXED_NOW);
    expect(res).toEqual({ ok: true, lastActive: FIXED_NOW });
    expect(JSON.parse(storage.data[SESSION_STORAGE_KEY]).lastActive).toBe(FIXED_NOW);
  });

  it("preserves every other session property byte-identically (role, token, email, driver fields)", () => {
    const session = {
      role: "driver",
      email: "driver@example.test",
      token: "signed.token.value",
      loginType: "firebase",
      driver: { id: "d1", name: "Jane", truckType: "flatbed", nested: { plate: "TR-1" } },
      permissions: ["a", "b"],
      lastActive: 42,
    };
    const storage = memoryStorage({ [SESSION_STORAGE_KEY]: JSON.stringify(session) });
    touchStoredSessionActivity(storage, () => FIXED_NOW);
    const after = JSON.parse(storage.data[SESSION_STORAGE_KEY]);
    expect(after).toEqual({ ...session, lastActive: FIXED_NOW });
    // Explicitly: identity/security fields untouched.
    expect(after.role).toBe("driver");
    expect(after.token).toBe("signed.token.value");
    expect(after.email).toBe("driver@example.test");
    expect(after.driver).toEqual(session.driver);
  });

  it("handles a missing session safely (no throw, no write)", () => {
    const storage = memoryStorage();
    const res = touchStoredSessionActivity(storage, () => FIXED_NOW);
    expect(res).toEqual({ ok: false, reason: "missing" });
    expect(SESSION_STORAGE_KEY in storage.data).toBe(false);
  });

  it("handles corrupt JSON safely and leaves the stored value untouched", () => {
    const storage = memoryStorage({ [SESSION_STORAGE_KEY]: "{not-json" });
    expect(touchStoredSessionActivity(storage, () => FIXED_NOW)).toEqual({ ok: false, reason: "corrupt" });
    expect(storage.data[SESSION_STORAGE_KEY]).toBe("{not-json");
    // Non-object JSON values are corrupt too — never rewritten into a session.
    const arr = memoryStorage({ [SESSION_STORAGE_KEY]: "[1,2]" });
    expect(touchStoredSessionActivity(arr, () => FIXED_NOW)).toEqual({ ok: false, reason: "corrupt" });
    expect(arr.data[SESSION_STORAGE_KEY]).toBe("[1,2]");
  });

  it("handles a storage read failure safely", () => {
    const storage: StringStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
    };
    expect(touchStoredSessionActivity(storage, () => FIXED_NOW)).toEqual({ ok: false, reason: "read_error" });
  });

  it("handles a storage write failure safely (quota/private mode)", () => {
    const storage: StringStorage = {
      getItem: () => JSON.stringify({ role: "client", lastActive: 1 }),
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(touchStoredSessionActivity(storage, () => FIXED_NOW)).toEqual({ ok: false, reason: "write_error" });
  });
});
