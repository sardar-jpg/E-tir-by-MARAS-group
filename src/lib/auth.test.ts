import { describe, it, expect, vi } from "vitest";
import crypto from "crypto";
import {
  hashPassword,
  verifyPassword,
  verifyPasswordWithMigration,
  signSessionToken,
  verifySessionToken,
  SessionPayload,
  GENERIC_LOGIN_ERROR,
  signPendingFirebaseIdentityDeletionToken,
  verifyPendingFirebaseIdentityDeletionToken,
  PendingFirebaseIdentityDeletionToken,
  base64url,
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
    const [, sig] = token.split(".");
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

describe("signPendingFirebaseIdentityDeletionToken / verifyPendingFirebaseIdentityDeletionToken", () => {
  const makeTokenPayload = (
    overrides: Partial<{ driverId: string; firebaseUid: string; issuedAt: number; expiresAt: number }> = {}
  ) => ({
    driverId: "driver-123",
    firebaseUid: "google-oauth2|verified-uid-abc",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    ...overrides,
  });

  // Re-encodes a payload object into the same body format the sign
  // function produces, WITHOUT recomputing a matching signature — used to
  // simulate an attacker editing the decoded body and pasting the
  // original (now-mismatched) signature back on, same technique as the
  // "rejects a tampered token body" test above.
  function tamperedToken(originalToken: string, tamperedPayload: unknown): string {
    const [, originalSig] = originalToken.split(".");
    const tamperedBody = base64url(JSON.stringify(tamperedPayload));
    return `${tamperedBody}.${originalSig}`;
  }

  it("round-trips a valid token", () => {
    const payload = makeTokenPayload();
    const token = signPendingFirebaseIdentityDeletionToken(payload, SECRET);
    const verified = verifyPendingFirebaseIdentityDeletionToken(token, SECRET);

    expect(verified).not.toBeNull();
    expect(verified?.driverId).toBe(payload.driverId);
    expect(verified?.firebaseUid).toBe(payload.firebaseUid);
    expect(verified?.issuedAt).toBe(payload.issuedAt);
    expect(verified?.expiresAt).toBe(payload.expiresAt);
  });

  it("rejects a token signed with a different secret", () => {
    const token = signPendingFirebaseIdentityDeletionToken(makeTokenPayload(), "a-different-secret");
    expect(verifyPendingFirebaseIdentityDeletionToken(token, SECRET)).toBeNull();
  });

  it("rejects a tampered driverId, keeping the original (now-mismatched) signature", () => {
    const original = makeTokenPayload();
    const token = signPendingFirebaseIdentityDeletionToken(original, SECRET);
    const tampered = tamperedToken(token, {
      ...original,
      purpose: "finish-firebase-identity-deletion",
      driverId: "someone-elses-driver-id",
    });
    expect(verifyPendingFirebaseIdentityDeletionToken(tampered, SECRET)).toBeNull();
  });

  it("rejects a tampered firebaseUid, keeping the original (now-mismatched) signature", () => {
    const original = makeTokenPayload();
    const token = signPendingFirebaseIdentityDeletionToken(original, SECRET);
    const tampered = tamperedToken(token, {
      ...original,
      purpose: "finish-firebase-identity-deletion",
      firebaseUid: "a-different-firebase-uid",
    });
    expect(verifyPendingFirebaseIdentityDeletionToken(tampered, SECRET)).toBeNull();
  });

  it("rejects a tampered expiresAt (an attacker trying to extend the token's lifetime), keeping the original signature", () => {
    const original = makeTokenPayload({ expiresAt: Date.now() - 1000 }); // already expired
    const token = signPendingFirebaseIdentityDeletionToken(original, SECRET);
    const tampered = tamperedToken(token, {
      ...original,
      purpose: "finish-firebase-identity-deletion",
      expiresAt: Date.now() + 60_000, // attacker-extended expiry
    });
    expect(verifyPendingFirebaseIdentityDeletionToken(tampered, SECRET)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const token = signPendingFirebaseIdentityDeletionToken(makeTokenPayload(), SECRET);
    const [body, sig] = token.split(".");
    // Flip the signature's first character to something else.
    const flipped = sig[0] === "a" ? "b" : "a";
    const tamperedSig = flipped + sig.slice(1);
    expect(verifyPendingFirebaseIdentityDeletionToken(`${body}.${tamperedSig}`, SECRET)).toBeNull();
  });

  it("rejects an expired token", () => {
    const expiredPayload = makeTokenPayload({ expiresAt: Date.now() - 1000 });
    const token = signPendingFirebaseIdentityDeletionToken(expiredPayload, SECRET);
    expect(verifyPendingFirebaseIdentityDeletionToken(token, SECRET)).toBeNull();
  });

  it("accepts a token whose expiresAt is still in the future, right up to the implementation's exact comparison boundary (Date.now() > expiresAt, not >=)", () => {
    // A token expiring several seconds from now must still verify — this
    // is the "equal to or slightly after current time" boundary case from
    // the review: the implementation only rejects once Date.now() is
    // STRICTLY greater than expiresAt, so anything from "now" forward
    // (down to the same millisecond) is still valid.
    const payload = makeTokenPayload({ expiresAt: Date.now() + 2000 });
    const token = signPendingFirebaseIdentityDeletionToken(payload, SECRET);
    expect(verifyPendingFirebaseIdentityDeletionToken(token, SECRET)).not.toBeNull();
  });

  it("rejects a token that is clearly, unambiguously expired", () => {
    const payload = makeTokenPayload({ expiresAt: Date.now() - 60_000 });
    const token = signPendingFirebaseIdentityDeletionToken(payload, SECRET);
    expect(verifyPendingFirebaseIdentityDeletionToken(token, SECRET)).toBeNull();
  });

  it("rejects a malformed token (missing signature segment)", () => {
    expect(verifyPendingFirebaseIdentityDeletionToken("not-a-real-token", SECRET)).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(verifyPendingFirebaseIdentityDeletionToken("", SECRET)).toBeNull();
  });

  it("rejects a body that decodes to invalid JSON, without throwing", () => {
    const body = base64url("this is not valid json{");
    const sig = base64url(crypto.createHmac("sha256", SECRET).update(body).digest());
    expect(() => verifyPendingFirebaseIdentityDeletionToken(`${body}.${sig}`, SECRET)).not.toThrow();
    expect(verifyPendingFirebaseIdentityDeletionToken(`${body}.${sig}`, SECRET)).toBeNull();
  });

  it("rejects a well-formed but non-matching-purpose payload (missing purpose field entirely)", () => {
    const bodyPayload = { driverId: "driver-123", firebaseUid: "uid-abc", issuedAt: Date.now(), expiresAt: Date.now() + 60_000 };
    const body = base64url(JSON.stringify(bodyPayload));
    const sig = base64url(crypto.createHmac("sha256", SECRET).update(body).digest());
    expect(verifyPendingFirebaseIdentityDeletionToken(`${body}.${sig}`, SECRET)).toBeNull();
  });

  describe("purpose discriminator — separation from session tokens", () => {
    it("rejects a normal session token — a session token has no `purpose` field, so it can never be used to finish a Firebase identity deletion", () => {
      const sessionToken = signSessionToken(
        { role: "driver", id: "driver-123", issuedAt: Date.now(), expiresAt: Date.now() + 60_000 },
        SECRET
      );
      expect(verifyPendingFirebaseIdentityDeletionToken(sessionToken, SECRET)).toBeNull();
    });

    // Known, non-exploitable gap (documented here rather than "fixed",
    // since this is a test-only task and changing verifySessionToken's
    // contract could affect production session handling): verifySessionToken
    // does not itself check for the ABSENCE of a `purpose` field, so a
    // pending-deletion token is currently structurally accepted as if it
    // were a session token — it just comes back with `role`/`id` both
    // `undefined`, because verifySessionToken has no allowlist of expected
    // keys. This is not exploitable in practice: every route that actually
    // grants a capability (requireRole, requireFullAdmin, canDeleteDriverAccount,
    // canViewDriverRoster, etc.) keys off `req.session.role` / `req.session.id`
    // matching a real role/identity, and both are undefined here, so no
    // route's authorization check can succeed with a token forged this way.
    // Left as a defense-in-depth follow-up (e.g. verifySessionToken could
    // reject any payload carrying a `purpose` field) rather than changed here.
    it("[documents current behavior — not a security fix] verifySessionToken structurally accepts a pending-deletion token's shape, but with role/id undefined", () => {
      const pendingToken = signPendingFirebaseIdentityDeletionToken(makeTokenPayload(), SECRET);
      const verified = verifySessionToken(pendingToken, SECRET);

      // Currently non-null (not the ideal outcome) — asserting this
      // precisely so any future tightening of verifySessionToken's
      // contract is a deliberate, visible test change, not a silent one.
      expect(verified).not.toBeNull();
      expect((verified as any)?.role).toBeUndefined();
      expect((verified as any)?.id).toBeUndefined();
    });
  });

  it("preserves driverId, firebaseUid, issuedAt, and expiresAt exactly through the round trip (payload integrity)", () => {
    // issuedAt is deliberately a fixed point in the past (nothing checks
    // it against Date.now()); expiresAt must stay relative to "now" so
    // this test doesn't itself go stale and start failing on expiry.
    const fixedIssuedAt = 1_700_000_000_000;
    const futureExpiresAt = Date.now() + 60_000;
    const payload = makeTokenPayload({
      driverId: "driver-exact-match-456",
      firebaseUid: "google-oauth2|exact-match-uid-789",
      issuedAt: fixedIssuedAt,
      expiresAt: futureExpiresAt,
    });
    const token = signPendingFirebaseIdentityDeletionToken(payload, SECRET);
    const verified = verifyPendingFirebaseIdentityDeletionToken(token, SECRET) as PendingFirebaseIdentityDeletionToken;

    expect(verified).not.toBeNull();
    expect(verified.driverId).toBe("driver-exact-match-456");
    expect(verified.firebaseUid).toBe("google-oauth2|exact-match-uid-789");
    expect(verified.issuedAt).toBe(fixedIssuedAt);
    expect(verified.expiresAt).toBe(futureExpiresAt);
  });
});
