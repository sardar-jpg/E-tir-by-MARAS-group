/**
 * backfill-additional-driver-ids.ts
 *
 * Phase 4 follow-up (Firestore scalability audit, PR #99 review).
 *
 * One-time, manually-run migration for the legacy-record gap documented
 * in src/lib/driverVisibility.ts's deriveAdditionalDriverIds: a shipment
 * written before Shipment.additionalDriverIds existed has no value for
 * that field, so GET /api/notifications' new `array-contains` ownership
 * query won't find it for a driver who is only listed as one of its
 * additionalDrivers (not the primary assignedDriverId). Every shipment
 * self-heals the next time it's created/updated through the normal write
 * path (server.ts always derives this field on write) — this script is
 * only for shipments that might otherwise never be touched again.
 *
 * NOT run automatically by this codebase, by CI, or by any deploy step.
 * An operator runs it manually, against production, when ready — the
 * task that introduced this script does not run it.
 *
 * Usage:
 *   npx tsx scripts/backfill-additional-driver-ids.ts            # dry run (default) — reports what WOULD change, writes nothing
 *   npx tsx scripts/backfill-additional-driver-ids.ts --apply    # actually writes the missing/out-of-sync field
 *
 * Requires the same Application Default Credentials server.ts itself
 * needs (`gcloud auth application-default login`, or the runtime service
 * account on Cloud Run) and firebase-applet-config.json for the project
 * id / Firestore database id — no separate configuration.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

const configPath = join(projectRoot, "firebase-applet-config.json");
const firebaseConfig = JSON.parse(readFileSync(configPath, "utf8"));

const APPLY = process.argv.includes("--apply");

function deriveAdditionalDriverIds(additionalDrivers: Array<{ driverId?: string }> | undefined): string[] {
  const ids = new Set<string>();
  for (const ad of additionalDrivers || []) {
    if (ad && typeof ad.driverId === "string" && ad.driverId.length > 0) ids.add(ad.driverId);
  }
  return Array.from(ids);
}

function sameIds(a: string[] | undefined, b: string[]): boolean {
  const setA = new Set(a || []);
  if (setA.size !== b.length) return false;
  return b.every((id) => setA.has(id));
}

async function main() {
  const app = initializeApp({
    credential: applicationDefault(),
    projectId: firebaseConfig.projectId,
  });
  const db = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== "(default)"
    ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
    : getFirestore(app);

  console.log(`Mode: ${APPLY ? "APPLY (will write to production)" : "DRY RUN (no writes — pass --apply to write)"}`);

  const snapshot = await db.collection("shipments").get();
  console.log(`Scanned ${snapshot.size} shipment(s).`);

  let needsUpdate = 0;
  const writes: Promise<unknown>[] = [];

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data() as { additionalDrivers?: Array<{ driverId?: string }>; additionalDriverIds?: string[] };
    const derived = deriveAdditionalDriverIds(data.additionalDrivers);
    if (derived.length === 0 && (data.additionalDriverIds === undefined || data.additionalDriverIds.length === 0)) {
      continue; // nothing to backfill — no additional drivers, field absence is not a gap here
    }
    if (sameIds(data.additionalDriverIds, derived)) {
      continue; // already correct
    }
    needsUpdate += 1;
    console.log(`  ${docSnap.id}: additionalDriverIds ${JSON.stringify(data.additionalDriverIds || [])} -> ${JSON.stringify(derived)}`);
    if (APPLY) {
      writes.push(docSnap.ref.update({ additionalDriverIds: derived }));
    }
  }

  if (APPLY) {
    await Promise.all(writes);
    console.log(`Updated ${needsUpdate} shipment(s).`);
  } else {
    console.log(`${needsUpdate} shipment(s) would be updated. Re-run with --apply to write.`);
  }
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
