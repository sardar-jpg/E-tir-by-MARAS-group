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

export function extractServerUid(rulesText: string): string | null {
  const match = rulesText.match(UID_PATTERN);
  return match ? match[1] : null;
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
  const problems: string[] = [];
  const warnings: string[] = [];

  if (!firestoreUid) {
    problems.push(
      'Could not find a server-account UID in firestore.rules (expected request.auth.uid == "...").'
    );
  }
  if (!storageUid) {
    problems.push(
      'Could not find a server-account UID in storage.rules (expected request.auth.uid == "...").'
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
