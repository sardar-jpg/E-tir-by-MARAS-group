/**
 * backfill-shipment-timestamps.ts
 *
 * Phase 2A follow-up (Firestore scalability audit, shipments/orders —
 * blocking-issue fix).
 *
 * GET /api/shipments' cursor pagination (server.ts) now uses real
 * Firestore `.orderBy("createdAt", ...)` / `.orderBy("updatedAt", ...)`
 * queries instead of an in-memory JS sort. This is a real, documented
 * behavior difference: a JS sort tolerates a missing/undefined field (it
 * just sorts unpredictably, but the record still appears in the result);
 * a Firestore `.orderBy(field)` query silently EXCLUDES any document that
 * doesn't have `field` set at all. A shipment written before `createdAt`/
 * `updatedAt` existed on this schema — or created through any write path
 * that ever skipped setting them — would be completely invisible to
 * GET /api/shipments (every role, every page) after this change, even
 * though it still exists in Firestore and is still reachable directly by
 * id via GET /api/shipments/:id.
 *
 * Every current shipment-write path in server.ts (POST /api/shipments,
 * PUT /api/shipments/:id, PUT /api/shipments/:id/status) always sets
 * both fields — this gap can only exist for a record written before this
 * code shipped, or written by some other process (a migration script, a
 * manual Firestore Console edit, or a since-removed legacy write path).
 * This app's own current data is demo-only (SEED_DEMO_DATA), so this
 * script cannot verify whether any real production record actually has
 * the gap — it is provided so the gap CAN be closed before this PR is
 * relied upon in production, not because a specific affected record is
 * known to exist.
 *
 * Best-available-fallback derivation per shipment (never invents a value
 * where a truthful one is derivable):
 *   - createdAt missing: the EARLIEST `timeline[].timestamp` entry (a
 *     shipment's timeline always starts with its own creation event —
 *     see the initialTimeline object in POST /api/shipments), else
 *     existing `updatedAt` if present, else "now" (last resort, logged
 *     loudly as an invented value).
 *   - updatedAt missing: the LATEST `timeline[].timestamp` entry (the
 *     most recent status/timeline event is the closest available proxy
 *     for "last modified"), else the (possibly just-derived) `createdAt`,
 *     else "now".
 *
 * Self-healing note: unlike backfill-additional-driver-ids.ts, a shipment
 * with this gap does NOT self-heal on its next normal write — PUT
 * /api/shipments/:id and PUT /api/shipments/:id/status both PRESERVE an
 * existing `createdAt` (`...original` spread) and only refresh
 * `updatedAt` going forward; they never retroactively invent a missing
 * `createdAt`. This script (or an equivalent one-time fix) is the only
 * way to close the gap for an existing affected record.
 *
 * NOT run automatically by this codebase, by CI, or by any deploy step.
 * An operator runs it manually, against production, when ready — the
 * task that introduced this script does not run it.
 *
 * Usage:
 *   npx tsx scripts/backfill-shipment-timestamps.ts            # dry run (default) — reports what WOULD change, writes nothing
 *   npx tsx scripts/backfill-shipment-timestamps.ts --apply    # actually writes the missing field(s)
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

interface TimelineEntryShape {
  timestamp?: string;
}

interface ShipmentDataShape {
  createdAt?: string;
  updatedAt?: string;
  timeline?: TimelineEntryShape[];
}

function earliestTimelineTimestamp(timeline: TimelineEntryShape[] | undefined): string | null {
  const stamps = (timeline || []).map((t) => t.timestamp).filter((t): t is string => !!t).sort();
  return stamps.length > 0 ? stamps[0] : null;
}

function latestTimelineTimestamp(timeline: TimelineEntryShape[] | undefined): string | null {
  const stamps = (timeline || []).map((t) => t.timestamp).filter((t): t is string => !!t).sort();
  return stamps.length > 0 ? stamps[stamps.length - 1] : null;
}

function deriveCreatedAt(data: ShipmentDataShape, nowIso: string): { value: string; invented: boolean } {
  const fromTimeline = earliestTimelineTimestamp(data.timeline);
  if (fromTimeline) return { value: fromTimeline, invented: false };
  if (data.updatedAt) return { value: data.updatedAt, invented: false };
  return { value: nowIso, invented: true };
}

function deriveUpdatedAt(data: ShipmentDataShape, resolvedCreatedAt: string, nowIso: string): { value: string; invented: boolean } {
  const fromTimeline = latestTimelineTimestamp(data.timeline);
  if (fromTimeline) return { value: fromTimeline, invented: false };
  if (resolvedCreatedAt) return { value: resolvedCreatedAt, invented: false };
  return { value: nowIso, invented: true };
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

  const nowIso = new Date().toISOString();
  let needsUpdate = 0;
  let inventedCount = 0;
  const writes: Promise<unknown>[] = [];

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data() as ShipmentDataShape;
    const missingCreatedAt = !data.createdAt;
    const missingUpdatedAt = !data.updatedAt;
    if (!missingCreatedAt && !missingUpdatedAt) continue;

    const update: Record<string, string> = {};
    let rowInvented = false;

    let resolvedCreatedAt = data.createdAt || "";
    if (missingCreatedAt) {
      const { value, invented } = deriveCreatedAt(data, nowIso);
      update.createdAt = value;
      resolvedCreatedAt = value;
      rowInvented = rowInvented || invented;
    }
    if (missingUpdatedAt) {
      const { value, invented } = deriveUpdatedAt(data, resolvedCreatedAt, nowIso);
      update.updatedAt = value;
      rowInvented = rowInvented || invented;
    }

    needsUpdate += 1;
    if (rowInvented) inventedCount += 1;
    console.log(`  ${docSnap.id}: ${JSON.stringify(update)}${rowInvented ? "  [WARNING: no derivable value — used current time]" : ""}`);
    if (APPLY) {
      writes.push(docSnap.ref.update(update));
    }
  }

  if (APPLY) {
    await Promise.all(writes);
    console.log(`Updated ${needsUpdate} shipment(s) (${inventedCount} needed an invented "now" fallback — review those manually).`);
  } else {
    console.log(`${needsUpdate} shipment(s) would be updated (${inventedCount} would need an invented "now" fallback). Re-run with --apply to write.`);
  }
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
