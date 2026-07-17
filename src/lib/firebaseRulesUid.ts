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

export interface RulesUidCheck {
  firestoreUid: string | null;
  storageUid: string | null;
  /** true only when both files have a UID and it's the same one. */
  rulesMatch: boolean;
  problems: string[];
  warnings: string[];
}

export function checkRulesUids(
  firestoreRulesText: string,
  storageRulesText: string,
  envUid: string | undefined,
  opts: { isProduction: boolean; strictPersistence: boolean }
): RulesUidCheck {
  const firestoreUid = extractServerUid(firestoreRulesText);
  const storageUid = extractServerUid(storageRulesText);
  const firestoreDenyAll = isDenyAllRules(firestoreRulesText);
  const storageDenyAll = isDenyAllRules(storageRulesText);
  const problems: string[] = [];
  const warnings: string[] = [];

  // Each rules file must be well-formed: it either authorizes a specific
  // server-account UID (legacy model) OR explicitly denies all direct client
  // access (deny-all — the fully server-mediated Admin-SDK model). Anything
  // else is an unexpected shape and blocks.
  if (!firestoreUid && !firestoreDenyAll) {
    problems.push(
      'firestore.rules has neither a server-account UID (request.auth.uid == "...") nor an explicit deny-all (allow read, write: if false).'
    );
  }
  if (!storageUid && !storageDenyAll) {
    problems.push(
      'storage.rules has neither a server-account UID (request.auth.uid == "...") nor an explicit deny-all (allow read, write: if false).'
    );
  }

  // Fully-hardened posture: both files deny all direct client access. All
  // Firestore/Storage access is server-mediated via the Admin SDK, which
  // bypasses these rules — so there is no UID to match and the UID/env checks
  // below do not apply.
  if (firestoreDenyAll && storageDenyAll) {
    warnings.push(
      "firestore.rules and storage.rules are deny-all (allow read, write: if false) — direct client access is fully blocked; all Firestore/Storage access is server-mediated via the Firebase Admin SDK. Server-UID checks are not applicable."
    );
    return { firestoreUid, storageUid, rulesMatch: false, problems, warnings };
  }

  // Transitional/mixed state: one file deny-all, the other still UID-based.
  if (firestoreDenyAll !== storageDenyAll && (firestoreUid || storageUid)) {
    warnings.push(
      "firestore.rules and storage.rules are in different modes (one deny-all, one UID-based) — align both to the same model before deploying."
    );
  }

  const rulesMatch = !!firestoreUid && !!storageUid && firestoreUid === storageUid;
  if (firestoreUid && storageUid && !rulesMatch) {
    problems.push(
      `firestore.rules and storage.rules grant access to different UIDs (firestore: ${firestoreUid}, storage: ${storageUid}) — only one server account can be authorized; fix the mismatch before deploying either rule file.`
    );
  }

  if (envUid) {
    if (rulesMatch) {
      if (envUid !== firestoreUid) {
        const message =
          `SERVER_FIREBASE_UID ("${envUid}") does not match the UID hardcoded in firestore.rules/storage.rules ` +
          `("${firestoreUid}"). Firestore/Storage requests from this server account will be rejected until the ` +
          "rules are updated (or SERVER_FIREBASE_UID is corrected if it's the one that's wrong).";
        if (opts.isProduction && opts.strictPersistence) {
          problems.push(message);
        } else {
          warnings.push(message);
        }
      }
    } else if (firestoreUid || storageUid) {
      warnings.push(
        "SERVER_FIREBASE_UID is set, but firestore.rules and storage.rules disagree on the UID — cannot confirm a match until the rules agree."
      );
    }
  } else {
    warnings.push(
      "SERVER_FIREBASE_UID is not set — cannot statically confirm the rules' hardcoded UID matches the real " +
      "SERVER_FIREBASE_EMAIL account's Firebase Auth UID. Confirm manually in Firebase Console > Authentication " +
      "(see docs/REAL_FIREBASE_VERIFICATION.md)."
    );
  }

  return { firestoreUid, storageUid, rulesMatch, problems, warnings };
}
