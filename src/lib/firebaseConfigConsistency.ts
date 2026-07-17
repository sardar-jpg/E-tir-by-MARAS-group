/**
 * firebaseConfigConsistency.ts
 *
 * Pure, secret-free static checks that catch cross-file Firebase
 * configuration mistakes BEFORE they reach a deploy — the class of bug that
 * silently points staging at production, ships without a rules reference, or
 * leaves a Firestore database / Storage bucket mismatched between the CLI
 * config and the app's own client config.
 *
 * This module never reads a secret and never contacts Firebase. It operates
 * only on the already-parsed contents of:
 *   - firebase.json                 (Firebase CLI deploy config)
 *   - .firebaserc                   (project aliases)
 *   - firebase-applet-config.json   (the web/Admin-SDK client config)
 *
 * It is consumed by scripts/check-firebase-readiness.ts (§11 of the audit)
 * and unit-tested in firebaseConfigConsistency.test.ts.
 */

export interface FirebaseConfigInputs {
  /** Parsed firebase.json, or null if absent/unreadable. */
  firebaseJson: unknown;
  /** Parsed .firebaserc, or null if absent/unreadable. */
  firebaserc: unknown;
  /** Parsed firebase-applet-config.json, or null if absent/unreadable. */
  appletConfig: unknown;
}

export interface ConsistencyResult {
  problems: string[];
  warnings: string[];
}

/** Legacy Google AI Studio project identifiers must never be a live target. */
const LEGACY_AI_STUDIO_PROJECT_RE = /^gen-lang-client-/i;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** firebase.json `firestore` may be a single object or an array of database entries. */
function firestoreEntries(firebaseJson: Record<string, unknown> | null): Record<string, unknown>[] {
  if (!firebaseJson) return [];
  const fs = firebaseJson["firestore"];
  if (Array.isArray(fs)) return fs.filter((e): e is Record<string, unknown> => !!asRecord(e));
  const single = asRecord(fs);
  return single ? [single] : [];
}

/** firebase.json `storage` may be a single object or an array of bucket entries. */
function storageEntries(firebaseJson: Record<string, unknown> | null): Record<string, unknown>[] {
  if (!firebaseJson) return [];
  const st = firebaseJson["storage"];
  if (Array.isArray(st)) return st.filter((e): e is Record<string, unknown> => !!asRecord(e));
  const single = asRecord(st);
  return single ? [single] : [];
}

export function checkFirebaseConfigConsistency(input: FirebaseConfigInputs): ConsistencyResult {
  const problems: string[] = [];
  const warnings: string[] = [];

  const firebaseJson = asRecord(input.firebaseJson);
  const firebaserc = asRecord(input.firebaserc);
  const applet = asRecord(input.appletConfig);

  // ── 1. firebase.json must reference firestore.rules ──────────────────────
  const fsEntries = firestoreEntries(firebaseJson);
  if (firebaseJson) {
    if (fsEntries.length === 0) {
      warnings.push("firebase.json has no `firestore` configuration block.");
    } else if (!fsEntries.some(e => typeof e["rules"] === "string" && e["rules"])) {
      problems.push(
        "firebase.json `firestore` config has no `rules` reference — firestore.rules would not be deployed by `firebase deploy`."
      );
    }
  }

  // ── 2. firebase.json must reference storage.rules ────────────────────────
  const stEntries = storageEntries(firebaseJson);
  if (firebaseJson) {
    if (stEntries.length === 0) {
      problems.push(
        "firebase.json has no `storage` rules reference — storage.rules would not be deployed by `firebase deploy`."
      );
    } else if (!stEntries.some(e => typeof e["rules"] === "string" && e["rules"])) {
      problems.push("firebase.json `storage` config is present but has no `rules` reference.");
    }
  }

  // ── 3. Firestore database ID must match between firebase.json and applet config ──
  const jsonDbIds = fsEntries
    .map(e => (typeof e["database"] === "string" ? (e["database"] as string) : undefined))
    .filter((v): v is string => !!v);
  const appletDbId = applet && typeof applet["firestoreDatabaseId"] === "string"
    ? (applet["firestoreDatabaseId"] as string)
    : undefined;
  if (appletDbId && jsonDbIds.length && !jsonDbIds.includes(appletDbId)) {
    problems.push(
      `Firestore database ID mismatch: firebase-applet-config.json uses "${appletDbId}" but firebase.json targets ${jsonDbIds.map(d => `"${d}"`).join(", ")}. ` +
      "The app would read/write a different database than the one deploys target."
    );
  }

  // ── 4. projectId must match between applet config and .firebaserc default/production ──
  const appletProjectId = applet && typeof applet["projectId"] === "string" ? (applet["projectId"] as string) : undefined;
  const projects = firebaserc ? asRecord(firebaserc["projects"]) : null;
  const defaultProject = projects && typeof projects["default"] === "string" ? (projects["default"] as string) : undefined;
  const productionProject = projects && typeof projects["production"] === "string" ? (projects["production"] as string) : undefined;
  const stagingProject = projects && typeof projects["staging"] === "string" ? (projects["staging"] as string) : undefined;

  if (appletProjectId && defaultProject && appletProjectId !== defaultProject) {
    problems.push(
      `Firebase project mismatch: firebase-applet-config.json projectId "${appletProjectId}" != .firebaserc default "${defaultProject}".`
    );
  }
  if (appletProjectId && productionProject && appletProjectId !== productionProject) {
    warnings.push(
      `firebase-applet-config.json projectId "${appletProjectId}" != .firebaserc production alias "${productionProject}" — confirm which project the app actually targets.`
    );
  }

  // ── 5. staging and production aliases must never point at the same project ──
  if (stagingProject && productionProject && stagingProject === productionProject) {
    problems.push(
      `.firebaserc staging and production aliases both point at "${stagingProject}" — a staging deploy would hit production.`
    );
  }
  if (stagingProject && defaultProject && stagingProject === defaultProject) {
    warnings.push(
      `.firebaserc staging alias equals the default project "${defaultProject}" — verify staging is genuinely a separate project.`
    );
  }

  // ── 6. Storage bucket should belong to the app's project ─────────────────
  const appletBucket = applet && typeof applet["storageBucket"] === "string" ? (applet["storageBucket"] as string) : undefined;
  if (appletBucket && appletProjectId && !appletBucket.startsWith(`${appletProjectId}.`)) {
    warnings.push(
      `Storage bucket "${appletBucket}" does not start with projectId "${appletProjectId}" — confirm the bucket belongs to this project.`
    );
  }

  // ── 7. Legacy Google AI Studio project identifiers must not be a live target ──
  const candidateProjectIds = [appletProjectId, defaultProject, productionProject, stagingProject].filter(
    (v): v is string => !!v
  );
  for (const pid of candidateProjectIds) {
    if (LEGACY_AI_STUDIO_PROJECT_RE.test(pid)) {
      problems.push(
        `Legacy Google AI Studio project identifier "${pid}" is referenced as a live target — this should be the real MARAS Firebase project, not the AI Studio scaffold project.`
      );
    }
  }

  return { problems, warnings };
}
