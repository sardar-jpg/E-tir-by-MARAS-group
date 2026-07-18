/**
 * firebaseRulesUid.ts
 *
 * Pure helpers for scripts/check-firebase-readiness.ts (PR #66): extract the
 * hardcoded server-account UID from firestore.rules / storage.rules and
 * compare it (a) against each other and (b) against the optional
 * SERVER_FIREBASE_UID env var. This exists because firestore.rules /
 * storage.rules both hardcode `request.auth.uid == "<uid>"` for the
 * dedicated server account (see docs/REAL_FIREBASE_VERIFICATION.md §5–§6) —
 * if that UID doesn't match the real SERVER_FIREBASE_EMAIL account's
 * Firebase Auth UID, every Firestore/Storage request fails closed even
 * though SERVER_FIREBASE_EMAIL/PASSWORD are set correctly.
 *
 * SERVER_FIREBASE_UID is NOT a secret — it's a verification value only,
 * unrelated to SERVER_FIREBASE_EMAIL/PASSWORD. Never touches Firebase.
 */

const UID_PATTERN = /request\.auth\.uid\s*==\s*"([^"]+)"/;
// Deny-all: `allow read, write: if false;` with NO UID authorization. This is
// the fully-hardened, server-mediated posture — all Firestore/Storage access
// goes through the Firebase Admin SDK, which bypasses these rules entirely.
const DENY_ALL_PATTERN = /allow\s+read\s*,\s*write\s*:\s*if\s+false\s*;/;

export function extractServerUid(rulesText: string): string | null {
  const match = rulesText.match(UID_PATTERN);
  return match ? match[1] : null;
}

/** True when the rules deny all direct client access and authorize no UID. */
export function isDenyAllRules(rulesText: string): boolean {
  return DENY_ALL_PATTERN.test(rulesText) && !UID_PATTERN.test(rulesText);
}

/**
 * PR #135 (Stage 2 PR 2, audit finding H-3): the legacy UID-authorization
 * model is no longer an accepted shape. Since PR #121 the committed
 * posture is deny-all in BOTH rules files — all Firestore/Storage access
 * is server-mediated through the Firebase Admin SDK (which bypasses these
 * rules), and the repo contains zero firebase/firestore or
 * firebase/storage client-SDK usage (firebase/auth only, for identity).
 *
 * assessRulesPosture is the regression guard: it FAILS readiness (and the
 * unit suite, which runs it against the real files) if a hardcoded UID
 * authorization returns, if any broad client grant appears, or if the
 * deny-all rule goes missing. Comments are stripped before matching so
 * documentation text can never trigger (or mask) a finding.
 */

function stripRulesComments(rulesText: string): string {
  return rulesText.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Broad/permissive client grants that must never appear in either file. */
const PERMISSIVE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /allow\s+[^:;]*:\s*if\s+true/, label: 'unconditional grant ("allow ...: if true")' },
  { pattern: /allow\s+[a-z]+(\s*,\s*[a-z]+)*\s*;/, label: "bare allow with no condition (always true)" },
  { pattern: /request\.auth\s*!=\s*null(?!\s*&&)/, label: 'any-signed-in-user grant ("request.auth != null")' },
];

export interface RulesPostureCheck {
  problems: string[];
  warnings: string[];
}

export function assessRulesPosture(firestoreRulesText: string, storageRulesText: string): RulesPostureCheck {
  const problems: string[] = [];
  const warnings: string[] = [];

  for (const [name, raw] of [
    ["firestore.rules", firestoreRulesText],
    ["storage.rules", storageRulesText],
  ] as const) {
    const text = stripRulesComments(raw);
    const uid = extractServerUid(text);
    if (uid) {
      problems.push(
        `${name} contains legacy hardcoded server-UID authorization (request.auth.uid == "…"). ` +
        "The required posture since PR #121 is deny-all — the server uses the Admin SDK and needs no rules grant. " +
        "Remove the UID clause and restore `allow read, write: if false;`."
      );
    }
    for (const { pattern, label } of PERMISSIVE_PATTERNS) {
      if (pattern.test(text)) {
        problems.push(
          `${name} contains a permissive client grant: ${label}. Direct client access must stay fully denied — ` +
          "every read/write goes through the Express API."
        );
      }
    }
    if (!isDenyAllRules(text)) {
      problems.push(
        `${name} is missing the explicit deny-all rule (allow read, write: if false;). ` +
        "Restore it — anything else risks exposing raw collections/objects to browsers."
      );
    }
  }

  return { problems, warnings };
}
