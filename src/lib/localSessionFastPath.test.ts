import { describe, it, expect } from "vitest";
import { isValidLocalSessionFastPath } from "./localSessionFastPath";

/**
 * audit-issue-4/fix/local-session-startup-gate
 *
 * Pins the decision behind App.tsx's startup fast-path: a session the
 * primary /api/login flow already fully established should not be blocked
 * behind the Firebase onAuthStateChanged initialization screen. Every
 * scenario here corresponds to one of the required regression cases from
 * the task (valid admin/driver/client bypass; Firebase session, missing
 * token, expired session, unknown role, and explicit logout all do not).
 */

const NOW = 1_700_000_000_000;
const FRESH = NOW - 60_000; // one minute ago
const STALE = NOW - 25 * 60 * 60 * 1000; // 25 hours ago — past the 24h rule

describe("isValidLocalSessionFastPath — valid local sessions bypass the gate", () => {
  it("bypasses for a valid non-expired local admin session with a token", () => {
    expect(
      isValidLocalSessionFastPath(
        { role: "admin", loginType: "local", token: "signed-token-abc", lastActive: FRESH },
        false,
        NOW
      )
    ).toBe(true);
  });

  it("bypasses for a valid non-expired local driver session with a token", () => {
    expect(
      isValidLocalSessionFastPath(
        { role: "driver", loginType: "local", token: "signed-token-def", lastActive: FRESH },
        false,
        NOW
      )
    ).toBe(true);
  });

  it("bypasses for a valid non-expired local client session with a token", () => {
    expect(
      isValidLocalSessionFastPath(
        { role: "client", loginType: "local", token: "signed-token-ghi", lastActive: FRESH },
        false,
        NOW
      )
    ).toBe(true);
  });
});

describe("isValidLocalSessionFastPath — everything else still waits for Firebase", () => {
  it("does not bypass for a Firebase-based session", () => {
    expect(
      isValidLocalSessionFastPath(
        { role: "admin", loginType: "firebase", token: "signed-token-abc", lastActive: FRESH },
        false,
        NOW
      )
    ).toBe(false);
  });

  it("does not bypass for a local session with no token", () => {
    expect(
      isValidLocalSessionFastPath(
        { role: "driver", loginType: "local", token: undefined, lastActive: FRESH },
        false,
        NOW
      )
    ).toBe(false);
  });

  it("does not bypass for a local session with a blank/whitespace token", () => {
    expect(
      isValidLocalSessionFastPath(
        { role: "driver", loginType: "local", token: "   ", lastActive: FRESH },
        false,
        NOW
      )
    ).toBe(false);
  });

  it("does not bypass for an expired local session", () => {
    expect(
      isValidLocalSessionFastPath(
        { role: "client", loginType: "local", token: "signed-token-jkl", lastActive: STALE },
        false,
        NOW
      )
    ).toBe(false);
  });

  it("does not bypass for an unknown/unsupported role", () => {
    expect(
      isValidLocalSessionFastPath(
        { role: "superadmin", loginType: "local", token: "signed-token-mno", lastActive: FRESH },
        false,
        NOW
      )
    ).toBe(false);
  });

  it("does not bypass when explicitly logged out, even if a session object is still present", () => {
    expect(
      isValidLocalSessionFastPath(
        { role: "admin", loginType: "local", token: "signed-token-pqr", lastActive: FRESH },
        true,
        NOW
      )
    ).toBe(false);
  });

  it("does not bypass for a null/missing session", () => {
    expect(isValidLocalSessionFastPath(null, false, NOW)).toBe(false);
    expect(isValidLocalSessionFastPath(undefined, false, NOW)).toBe(false);
  });

  it("does not bypass for a session missing lastActive entirely", () => {
    expect(
      isValidLocalSessionFastPath(
        { role: "admin", loginType: "local", token: "signed-token-stu" },
        false,
        NOW
      )
    ).toBe(false);
  });
});
