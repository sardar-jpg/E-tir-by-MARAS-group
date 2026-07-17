/**
 * check-firebase-readiness.ts
 *
 * Static, secret-free readiness check for docs/REAL_FIREBASE_VERIFICATION.md
 * and docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md §4/§5/§19. Never connects to
 * Firebase and never reads/prints secret values — it only checks whether the
 * env vars server.ts depends on are *present* and whether any of the
 * dangerous-in-production combinations documented in
 * src/lib/persistenceReadiness.ts apply to the current environment.
 *
 * The server authenticates to Firestore/Storage via the Firebase Admin SDK
 * using Application Default Credentials (ADC) — locally via
 * `gcloud auth application-default login`, on Cloud Run automatically via
 * the attached runtime service account. ADC availability generally can't be
 * confirmed from env vars alone (see adcEnvHintPresent in
 * persistenceReadiness.ts); this script reports only a best-effort static
 * hint, never an authoritative answer — only a live server boot (or
 * `npm run dev`) can confirm ADC actually works.
 *
 * Also checks (src/lib/firebaseRulesUid.ts) that firestore.rules and
 * storage.rules hardcode the *same* server-account UID, and — if the
 * non-secret SERVER_FIREBASE_UID env var is set — that it matches the UID
 * found in those rules. This UID-matching check predates the Admin SDK
 * migration and is unrelated to it (rules files are unchanged in this
 * branch) — it never reads firestore.rules/storage.rules from anywhere but
 * disk and never contacts Firebase.
 *
 * Usage:
 *   npx tsx scripts/check-firebase-readiness.ts
 *   NODE_ENV=production npx tsx scripts/check-firebase-readiness.ts   # simulate a prod check
 *
 * Exits non-zero if run with NODE_ENV=production and any launch-blocking
 * condition from the checklist is detected (memory fallback, demo seeding,
 * missing SESSION_SECRET/SUPER_ADMIN_PASSWORD_HASH, a wildcard CORS origin,
 * a committed service-account-looking JSON file, firestore.rules/storage.rules
 * disagreeing on the server UID, or — in production with STRICT_PERSISTENCE
 * on — SERVER_FIREBASE_UID disagreeing with the rules). Exits 0 (with
 * warnings) outside production, since local dev is expected to run on the
 * memory fallback with demo data.
 */
import fs from "fs";
import path from "path";
import { computePersistenceReadiness } from "../src/lib/persistenceReadiness";
import { checkRulesUids } from "../src/lib/firebaseRulesUid";
import { checkFirebaseConfigConsistency } from "../src/lib/firebaseConfigConsistency";

const projectRoot = path.join(path.dirname(new URL(import.meta.url).pathname), "..");

function firebaseConfigured(): boolean {
  const configPath = path.join(projectRoot, "firebase-applet-config.json");
  if (fs.existsSync(configPath)) return true;
  return !!process.env.FIREBASE_CONFIG;
}

/**
 * Scans repo-root-level files (not node_modules/dist/.git) for a JSON file
 * that looks like a Firebase/GCP service-account key — the one secret this
 * app must never have committed, since the Admin SDK is meant to rely on
 * Application Default Credentials instead (see checklist §3/§4).
 */
function findSuspiciousServiceAccountFiles(): string[] {
  const found: string[] = [];
  const skipDirs = new Set(["node_modules", ".git", "dist", "ios", "assets"]);
  function walk(dir: string, depth: number) {
    if (depth > 3) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) walk(full, depth + 1);
        continue;
      }
      if (!entry.name.endsWith(".json")) continue;
      try {
        const content = fs.readFileSync(full, "utf8");
        if (content.includes('"type": "service_account"') || content.includes('"private_key"')) {
          found.push(path.relative(projectRoot, full));
        }
      } catch {
        // unreadable/binary — not a JSON key file, ignore
      }
    }
  }
  walk(projectRoot, 0);
  return found;
}

function main() {
  const env = process.env;
  const readiness = computePersistenceReadiness(env, firebaseConfigured());
  const problems: string[] = [];
  const warnings: string[] = [...readiness.warnings];

  console.log("──────────────────────────────────────────────────────────");
  console.log("Firebase / production-readiness check (static, no secrets read)");
  console.log("──────────────────────────────────────────────────────────");
  console.log(`NODE_ENV: ${env.NODE_ENV || "development"} (production: ${readiness.isProduction})`);
  console.log(`Firebase client config found: ${readiness.firebaseConfigured}`);
  console.log(`ADC environment hint present (GOOGLE_APPLICATION_CREDENTIALS or K_SERVICE): ${readiness.adcEnvHintPresent} (not authoritative — see header comment)`);
  console.log(`STRICT_PERSISTENCE: ${readiness.strictPersistence}`);
  console.log(`SEED_DEMO_DATA: ${readiness.seedDemoData}`);
  console.log(`Configured persistence mode: ${readiness.configuredMode}`);
  console.log(`SESSION_SECRET present: ${!!env.SESSION_SECRET}`);
  console.log(`SUPER_ADMIN_EMAIL present: ${!!env.SUPER_ADMIN_EMAIL}`);
  console.log(`SUPER_ADMIN_PASSWORD_HASH present: ${!!env.SUPER_ADMIN_PASSWORD_HASH}`);
  console.log(`GOOGLE_MAPS_PLATFORM_KEY present: ${!!env.GOOGLE_MAPS_PLATFORM_KEY}`);

  if (!env.SESSION_SECRET) {
    (readiness.isProduction ? problems : warnings).push(
      "SESSION_SECRET is not set — the server refuses to start without it (server.ts [FATAL])."
    );
  }

  if (readiness.isProduction && !env.SUPER_ADMIN_PASSWORD_HASH) {
    problems.push("NODE_ENV=production but SUPER_ADMIN_PASSWORD_HASH is not set.");
  }

  const originEnvKeys = ["APP_URL", "CLIENT_URL", "ALLOWED_ORIGINS", "PUBLIC_APP_URL"];
  for (const key of originEnvKeys) {
    if (env[key] && env[key]!.split(",").map(s => s.trim()).includes("*")) {
      problems.push(`${key} contains a wildcard "*" origin — CORS must never allow this.`);
    }
  }

  const serviceAccountFiles = findSuspiciousServiceAccountFiles();
  if (serviceAccountFiles.length) {
    problems.push(
      `Found file(s) that look like a committed Firebase/GCP service-account key: ${serviceAccountFiles.join(", ")}. ` +
      "The Admin SDK is meant to use Application Default Credentials — no key file should exist in this repo."
    );
  }

  if (readiness.isProduction && readiness.configuredMode === "memory-fallback") {
    problems.push("Production is configured to run on the in-memory fallback (see warnings above) — this is a launch blocker.");
  }

  // Static cross-file Firebase config consistency (firebase.json / .firebaserc /
  // firebase-applet-config.json) — catches missing rules references, project /
  // database / bucket mismatches, staging↔production alias collisions, and
  // legacy AI Studio project identifiers. Secret-free; never contacts Firebase.
  function readJsonIfPresent(rel: string): unknown {
    try {
      return JSON.parse(fs.readFileSync(path.join(projectRoot, rel), "utf8"));
    } catch {
      return null;
    }
  }
  const configConsistency = checkFirebaseConfigConsistency({
    firebaseJson: readJsonIfPresent("firebase.json"),
    firebaserc: readJsonIfPresent(".firebaserc"),
    appletConfig: readJsonIfPresent("firebase-applet-config.json"),
  });
  problems.push(...configConsistency.problems);
  warnings.push(...configConsistency.warnings);

  const firestoreRulesPath = path.join(projectRoot, "firestore.rules");
  const storageRulesPath = path.join(projectRoot, "storage.rules");
  if (fs.existsSync(firestoreRulesPath) && fs.existsSync(storageRulesPath)) {
    const uidCheck = checkRulesUids(
      fs.readFileSync(firestoreRulesPath, "utf8"),
      fs.readFileSync(storageRulesPath, "utf8"),
      env.SERVER_FIREBASE_UID,
      { isProduction: readiness.isProduction, strictPersistence: readiness.strictPersistence }
    );
    console.log(`firestore.rules server UID: ${uidCheck.firestoreUid ?? "(not found)"}`);
    console.log(`storage.rules server UID: ${uidCheck.storageUid ?? "(not found)"}`);
    console.log(`firestore.rules / storage.rules UIDs match: ${uidCheck.rulesMatch}`);
    console.log(`SERVER_FIREBASE_UID present: ${!!env.SERVER_FIREBASE_UID}`);
    problems.push(...uidCheck.problems);
    warnings.push(...uidCheck.warnings);
  } else {
    warnings.push("firestore.rules and/or storage.rules not found at repo root — skipped server-UID consistency check.");
  }

  console.log("──────────────────────────────────────────────────────────");
  if (warnings.length) {
    console.log("Warnings:");
    for (const w of warnings) console.log(`  - ${w}`);
  }
  if (problems.length) {
    console.log("BLOCKING PROBLEMS:");
    for (const p of problems) console.log(`  - ${p}`);
    console.log("──────────────────────────────────────────────────────────");
    process.exit(1);
  }
  console.log(warnings.length ? "No blocking problems (see warnings above)." : "No problems detected.");
  console.log("──────────────────────────────────────────────────────────");
}

main();
