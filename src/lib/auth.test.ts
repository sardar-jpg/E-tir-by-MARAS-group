import { describe, it, expect, vi } from "vitest";
import {
  hashPassword,
  verifyPassword,
  verifyPasswordWithMigration,
  signSessionToken,
  verifySessionToken,
  SessionPayload,
  GENERIC_LOGIN_ERROR,
} from "./auth";

const SECRET = "test-secret-do-not-use-in-real-env";

describe("GENERIC_LOGIN_ERROR", () => {
  it("is a single fixed message, not one that varies by failure reason", () => {
    // BUG-10: /api/login must return this exact same string for a wrong
    // password on a known admin AND for an unrecognized identity — a
    // distinct message for either case would leak which emails are real
    // admin accounts. This just pins the constant so a future edit can't
    // silently reintroduce two different strings at the two call sites.
    expect(GENERIC_LOGIN_ERROR).toBe("Invalid username, email, phone, or password");
  });
});

describe("hashPassword / verifyPassword", () => {
  it("produces a hash in the expected pbkdf2$salt$hash format", () => {
    const hash = hashPassword("correct-password-123");
    expect(hash.startsWith("pbkdf2$")).toBe(true);
    expect(hash.split("$")).toHaveLength(3);
  });

  it("verifies a correct password against its own hash", () => {
    const hash = hashPassword("correct-password-123");
    expect(verifyPassword("correct-password-123", hash)).toBe(true);
  });

  it("rejects an incorrect password", () => {
    const hash = hashPassword("correct-password-123");
    expect(verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("produces a different hash each time (random salt), but both still verify", () => {
    const hashA = hashPassword("same-password");
    const hashB = hashPassword("same-password");
    expect(hashA).not.toBe(hashB);
    expect(verifyPassword("same-password", hashA)).toBe(true);
    expect(verifyPassword("same-password", hashB)).toBe(true);
  });

  it("rejects plaintext values that don't start with pbkdf2$ (old, unmigrated passwords)", () => {
    expect(verifyPassword("maras123", "maras123")).toBe(false);
  });

  it("rejects undefined/missing stored passwords", () => {
    expect(verifyPassword("anything", undefined)).toBe(false);
  });

  it("rejects a malformed hash (wrong number of $ segments)", () => {
    expect(verifyPassword("anything", "pbkdf2$onlyonesegment")).toBe(false);
  });
});

describe("verifyPasswordWithMigration", () => {
  it("migrates a matching legacy plaintext password and reports success", async () => {
    const onMigrated = vi.fn().mockResolvedValue(undefined);
    const result = await verifyPasswordWithMigration("maras123", "maras123", onMigrated);

    expect(result).toBe(true);
    expect(onMigrated).toHaveBeenCalledTimes(1);
    // The migrated value handed to onMigrated should be a real pbkdf2 hash,
    // not the plaintext password itself.
    const newHash = onMigrated.mock.calls[0][0];
    expect(newHash.startsWith("pbkdf2$")).toBe(true);
    expect(verifyPassword("maras123", newHash)).toBe(true);
  });

  it("does not migrate or succeed for a non-matching legacy plaintext password", async () => {
    const onMigrated = vi.fn();
    const result = await verifyPasswordWithMigration("wrong", "maras123", onMigrated);

    expect(result).toBe(false);
    expect(onMigrated).not.toHaveBeenCalled();
  });

  it("uses normal hash verification (no migration) once a password is already hashed", async () => {
    const onMigrated = vi.fn();
    const hash = hashPassword("already-migrated-password");
    const result = await verifyPasswordWithMigration("already-migrated-password", hash, onMigrated);

    expect(result).toBe(true);
    expect(onMigrated).not.toHaveBeenCalled();
  });

  it("returns false for missing stored password without attempting migration", async () => {
    const onMigrated = vi.fn();
    const result = await verifyPasswordWithMigration("anything", undefined, onMigrated);

    expect(result).toBe(false);
    expect(onMigrated).not.toHaveBeenCalled();
  });
});

describe("signSessionToken / verifySessionToken", () => {
  const makePayload = (overrides: Partial<SessionPayload> = {}): SessionPayload => ({
    role: "driver",
    id: "driver-123",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    ...overrides,
  });

  it("round-trips a valid token", () => {
    const payload = makePayload();
    const token = signSessionToken(payload, SECRET);
    const verified = verifySessionToken(token, SECRET);

    expect(verified).not.toBeNull();
    expect(verified?.role).toBe("driver");
    expect(verified?.id).toBe("driver-123");
  });

  it("rejects a token signed with a different secret", () => {
    const token = signSessionToken(makePayload(), "a-different-secret");
    expect(verifySessionToken(token, SECRET)).toBeNull();
  });

  it("rejects a tampered token body", () => {
    const token = signSessionToken(makePayload({ role: "driver" }), SECRET);
    const [body, sig] = token.split(".");
    // Tamper with the body by re-encoding a payload with an elevated role,
    // keeping the original (now-mismatched) signature.
    const tamperedPayload = makePayload({ role: "admin", adminType: "super" });
    const tamperedBody = Buffer.from(JSON.stringify(tamperedPayload))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const tamperedToken = `${tamperedBody}.${sig}`;

    expect(verifySessionToken(tamperedToken, SECRET)).toBeNull();
  });

  it("rejects an expired token", () => {
    const expiredPayload = makePayload({ expiresAt: Date.now() - 1000 });
    const token = signSessionToken(expiredPayload, SECRET);

    expect(verifySessionToken(token, SECRET)).toBeNull();
  });

  it("rejects a malformed token (missing signature segment)", () => {
    expect(verifySessionToken("not-a-real-token", SECRET)).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(verifySessionToken("", SECRET)).toBeNull();
  });

  it("preserves adminType through the round trip for admin sessions", () => {
    const payload = makePayload({ role: "admin", id: "sardar@maras.iq", adminType: "super" });
    const token = signSessionToken(payload, SECRET);
    const verified = verifySessionToken(token, SECRET);

    expect(verified?.role).toBe("admin");
    expect(verified?.adminType).toBe("super");
  });
});
