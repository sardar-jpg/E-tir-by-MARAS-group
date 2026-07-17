import { describe, it, expect } from "vitest";
import { extractServerUid, isDenyAllRules, checkRulesUids } from "./firebaseRulesUid";

const rulesWithUid = (uid: string) => `
  function isServerAccount() {
    return request.auth != null && request.auth.uid == "${uid}";
  }
`;

const DENY_ALL = `
  rules_version = '2';
  service cloud.firestore {
    match /databases/{database}/documents {
      match /{document=**} {
        allow read, write: if false;
      }
    }
  }
`;

const NON_PROD = { isProduction: false, strictPersistence: true };
const PROD_STRICT = { isProduction: true, strictPersistence: true };

describe("extractServerUid", () => {
  it("extracts the UID from a rules-style request.auth.uid check", () => {
    expect(extractServerUid(rulesWithUid("abc123"))).toBe("abc123");
  });

  it("returns null when no UID check is present", () => {
    expect(extractServerUid("service cloud.firestore { match /{document=**} { allow read: if true; } }")).toBeNull();
  });
});

describe("checkRulesUids", () => {
  it("matches when both rule files use the same UID and no env var is set", () => {
    const result = checkRulesUids(rulesWithUid("same-uid"), rulesWithUid("same-uid"), undefined, NON_PROD);
    expect(result.rulesMatch).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.warnings.some(w => w.includes("SERVER_FIREBASE_UID is not set"))).toBe(true);
  });

  it("reports a problem when firestore.rules and storage.rules disagree", () => {
    const result = checkRulesUids(rulesWithUid("uid-a"), rulesWithUid("uid-b"), undefined, NON_PROD);
    expect(result.rulesMatch).toBe(false);
    expect(result.problems.some(p => p.includes("different UIDs"))).toBe(true);
  });

  it("reports a problem when a rules file has no UID at all", () => {
    const result = checkRulesUids("no uid here", rulesWithUid("uid-a"), undefined, NON_PROD);
    expect(result.firestoreUid).toBeNull();
    expect(result.problems.some(p => p.includes("firestore.rules"))).toBe(true);
  });

  it("passes cleanly when SERVER_FIREBASE_UID matches the rules UID", () => {
    const result = checkRulesUids(rulesWithUid("same-uid"), rulesWithUid("same-uid"), "same-uid", NON_PROD);
    expect(result.problems).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("warns (not errors) on a SERVER_FIREBASE_UID mismatch outside production", () => {
    const result = checkRulesUids(rulesWithUid("real-uid"), rulesWithUid("real-uid"), "fake-uid", NON_PROD);
    expect(result.problems).toEqual([]);
    expect(result.warnings.some(w => w.includes('does not match'))).toBe(true);
  });

  it("errors on a SERVER_FIREBASE_UID mismatch in production with strict persistence", () => {
    const result = checkRulesUids(rulesWithUid("real-uid"), rulesWithUid("real-uid"), "fake-uid", PROD_STRICT);
    expect(result.problems.some(p => p.includes("does not match"))).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("warns instead of comparing when SERVER_FIREBASE_UID is set but the rules already disagree", () => {
    const result = checkRulesUids(rulesWithUid("uid-a"), rulesWithUid("uid-b"), "uid-a", NON_PROD);
    expect(result.warnings.some(w => w.includes("disagree on the UID"))).toBe(true);
  });

  it("treats both-deny-all rules as valid with NO blocking problems (server-mediated)", () => {
    const result = checkRulesUids(DENY_ALL, DENY_ALL, undefined, PROD_STRICT);
    expect(result.problems).toEqual([]);
    expect(result.firestoreUid).toBeNull();
    expect(result.storageUid).toBeNull();
    expect(result.warnings.some(w => w.includes("deny-all"))).toBe(true);
    // The "SERVER_FIREBASE_UID is not set" warning must NOT fire for deny-all —
    // there is no UID to confirm.
    expect(result.warnings.some(w => w.includes("SERVER_FIREBASE_UID is not set"))).toBe(false);
  });

  it("does not block even in production+strict when both rules are deny-all", () => {
    const result = checkRulesUids(DENY_ALL, DENY_ALL, "any-uid", PROD_STRICT);
    expect(result.problems).toEqual([]);
  });

  it("warns on a mixed state: one file deny-all, the other UID-based", () => {
    const result = checkRulesUids(DENY_ALL, rulesWithUid("uid-a"), undefined, NON_PROD);
    expect(result.warnings.some(w => w.includes("different modes"))).toBe(true);
  });

  it("still blocks a file that is neither deny-all nor UID-bearing", () => {
    const result = checkRulesUids("garbage rules with no uid and no deny", rulesWithUid("uid-a"), undefined, NON_PROD);
    expect(result.problems.some(p => p.includes("firestore.rules"))).toBe(true);
  });
});

describe("isDenyAllRules", () => {
  it("detects an explicit deny-all rule set", () => {
    expect(isDenyAllRules(DENY_ALL)).toBe(true);
  });
  it("returns false for UID-based rules", () => {
    expect(isDenyAllRules(rulesWithUid("abc"))).toBe(false);
  });
  it("returns false for allow-all rules", () => {
    expect(isDenyAllRules("allow read, write: if true;")).toBe(false);
  });
});
