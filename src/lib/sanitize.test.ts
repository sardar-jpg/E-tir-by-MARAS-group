import { describe, it, expect } from "vitest";
import { stripPassword, stripFirebaseUid } from "./sanitize";

describe("stripPassword", () => {
  it("removes the password field", () => {
    const record = { id: "client-1", companyName: "Acme", password: "pbkdf2$abc$def" };
    const safe = stripPassword(record);
    expect("password" in safe).toBe(false);
    expect((safe as any).password).toBeUndefined();
  });

  it("keeps every other field unchanged", () => {
    const record = { id: "client-1", companyName: "Acme", email: "a@b.com", password: "hash" };
    const safe = stripPassword(record);
    expect(safe).toEqual({ id: "client-1", companyName: "Acme", email: "a@b.com" });
  });

  it("is a no-op when there is no password field", () => {
    const record: { id: string; name: string; password?: unknown } = { id: "admin-1", name: "Ops" };
    const safe = stripPassword(record);
    expect(safe).toEqual({ id: "admin-1", name: "Ops" });
  });
});

describe("stripFirebaseUid", () => {
  it("removes the firebaseUid field", () => {
    const record = { id: "driver-1", name: "Ahmed", firebaseUid: "google-oauth2|abc123" };
    const safe = stripFirebaseUid(record);
    expect("firebaseUid" in safe).toBe(false);
    expect((safe as any).firebaseUid).toBeUndefined();
  });

  it("keeps every other field unchanged", () => {
    const record = { id: "driver-1", name: "Ahmed", email: "a@b.com", firebaseUid: "uid-xyz" };
    const safe = stripFirebaseUid(record);
    expect(safe).toEqual({ id: "driver-1", name: "Ahmed", email: "a@b.com" });
  });

  it("is a no-op when there is no firebaseUid field — username/password-only drivers", () => {
    const record: { id: string; name: string; firebaseUid?: unknown } = { id: "driver-2", name: "Mehmet" };
    const safe = stripFirebaseUid(record);
    expect(safe).toEqual({ id: "driver-2", name: "Mehmet" });
  });
});
