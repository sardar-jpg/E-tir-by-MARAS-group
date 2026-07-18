/**
 * firebaseRulesUid.ts — the Firebase rules posture guard.
 *
 * PR #135 (Stage 2 PR 2, audit finding H-3), review correction: the guard
 * is STRUCTURAL, not a blacklist. Since PR #121 the committed posture is
 * deny-all in BOTH rules files — all Firestore/Storage access is
 * server-mediated through the Firebase Admin SDK (which bypasses these
 * rules), and the repo contains zero firebase/firestore or
 * firebase/storage client-SDK usage (firebase/auth only, for identity).
 *
 * A file is accepted ONLY when every active `allow …;` statement in it is
 * exactly the canonical deny-all rule (whitespace/formatting variations
 * allowed, nothing else). Any additional allow statement of any kind —
 * read, write, get, list, create, update, delete, custom condition, even
 * a redundant `allow get: if false;` — fails the check, because proving
 * deny-all requires proving there is NO other grant, not that no grant
 * matches a known-bad list. Comments are stripped before scanning so
 * documentation text can neither trigger nor satisfy any check.
 *
 * assessRulesPosture backs both scripts/check-firebase-readiness.ts
 * (blocking) and the unit suite, which runs it against the REAL rules
 * files — so CI fails anywhere the posture regresses.
 */

const UID_PATTERN = /request\.auth\.uid\s*==\s*"([^"]+)"/;

/** Every active allow statement, e.g. `allow read: if x;` (comments must be stripped first). */
const ALLOW_STATEMENT_PATTERN = /\ballow\b[\s\S]*?;/g;

/**
 * The ONLY permitted active allow statement, in whitespace-insensitive
 * form: `allow read, write: if false;`
 */
const CANONICAL_DENY_ALL_COMPACT = "allowread,write:iffalse;";

function stripRulesComments(rulesText: string): string {
  return rulesText.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const compact = (stmt: string): string => stmt.replace(/\s+/g, "");

export function extractServerUid(rulesText: string): string | null {
  const match = stripRulesComments(rulesText).match(UID_PATTERN);
  return match ? match[1] : null;
}

/**
 * All active allow statements, whitespace-normalized for reporting.
 * Comments are stripped first.
 */
export function extractAllowStatements(rulesText: string): string[] {
  const stripped = stripRulesComments(rulesText);
  return (stripped.match(ALLOW_STATEMENT_PATTERN) || []).map((s) => s.replace(/\s+/g, " ").trim());
}

/**
 * True when the file's active allow statements are exactly the canonical
 * deny-all form (one or more occurrences, nothing else) and no UID
 * authorization exists anywhere in it.
 */
export function isDenyAllRules(rulesText: string): boolean {
  const statements = extractAllowStatements(rulesText);
  return (
    statements.length > 0 &&
    statements.every((s) => compact(s) === CANONICAL_DENY_ALL_COMPACT) &&
    extractServerUid(rulesText) === null
  );
}

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
    const uid = extractServerUid(raw);
    if (uid) {
      problems.push(
        `${name} contains legacy hardcoded server-UID authorization (request.auth.uid == "…"). ` +
        "The required posture since PR #121 is deny-all — the server uses the Admin SDK and needs no rules grant. " +
        "Remove the UID clause and restore `allow read, write: if false;`."
      );
    }

    // Structural scan: EVERY active allow statement must be exactly the
    // canonical deny-all. Anything else — permissive, conditional, or even
    // a redundant extra denial — is a posture violation.
    const statements = extractAllowStatements(raw);
    const nonCanonical = statements.filter((s) => compact(s) !== CANONICAL_DENY_ALL_COMPACT);
    for (const stmt of nonCanonical) {
      problems.push(
        `${name} contains an allow statement other than the canonical deny-all: "${stmt}". ` +
        'The ONLY permitted active rule is `allow read, write: if false;` — remove every other allow statement.'
      );
    }
    if (!statements.some((s) => compact(s) === CANONICAL_DENY_ALL_COMPACT)) {
      problems.push(
        `${name} is missing the explicit deny-all rule (allow read, write: if false;). ` +
        "Restore it — anything else risks exposing raw collections/objects to browsers."
      );
    }
  }

  return { problems, warnings };
}
