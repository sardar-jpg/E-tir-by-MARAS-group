/**
 * backfill-last-chat-activity.ts — legacy Chat Center ordering repair
 * (feature/admin-chat-recent-activity-order). DRY-RUN BY DEFAULT:
 *
 *   npx tsx scripts/backfill-last-chat-activity.ts
 *
 * reads every shipment and every chat message (a one-off manual scan —
 * the application itself NEVER does this; the live path maintains
 * shipment.lastChatActivityAt atomically on each message create) and
 * REPORTS, per shipment, the stored lastChatActivityAt versus the true
 * maximum historical message timestamp across the Order's three channels.
 *
 * Apply mode exists ONLY behind an explicit flag:
 *   npx tsx scripts/backfill-last-chat-activity.ts --apply-last-chat-activity
 * and is intentionally narrow: it sets lastChatActivityAt to the computed
 * deterministic maximum ONLY where the stored value is missing or older.
 * It never deletes anything, never touches messages, and never modifies
 * updatedAt or any other shipment field. Nothing in the application ever
 * invokes this script — it is a manual, human-reviewed operation.
 */
import "../src/lib/loadEnv";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { ChatMessage, Shipment } from "../src/types";

const APPLY_FLAG = "--apply-last-chat-activity";

async function main() {
  const apply = process.argv.includes(APPLY_FLAG);
  initializeApp({ credential: applicationDefault() });
  const db = getFirestore();

  const [shipSnap, msgSnap] = await Promise.all([
    db.collection("shipments").get(),
    db.collection("chatMessages").get(),
  ]);

  // Deterministic per-shipment maximum message timestamp (ISO strings —
  // lexicographic max is chronological max).
  const maxByShipment = new Map<string, string>();
  msgSnap.docs.forEach((d) => {
    const m = d.data() as ChatMessage;
    if (!m.shipmentId || typeof m.timestamp !== "string") return;
    const prev = maxByShipment.get(m.shipmentId);
    if (!prev || m.timestamp > prev) maxByShipment.set(m.shipmentId, m.timestamp);
  });

  let upToDate = 0;
  const missing: { id: string; number: string; computed: string }[] = [];
  const stale: { id: string; number: string; stored: string; computed: string }[] = [];
  const noMessages: number[] = [];

  for (const docSnap of shipSnap.docs) {
    const s = docSnap.data() as Shipment;
    const computed = maxByShipment.get(docSnap.id);
    if (!computed) {
      noMessages.push(1);
      continue;
    }
    const stored = s.lastChatActivityAt;
    if (!stored) missing.push({ id: docSnap.id, number: s.shipmentNumber || docSnap.id, computed });
    else if (stored < computed) stale.push({ id: docSnap.id, number: s.shipmentNumber || docSnap.id, stored, computed });
    else upToDate++;
  }

  console.log(`Shipments scanned: ${shipSnap.size}; chat messages scanned: ${msgSnap.size}`);
  console.log(`  up to date:                 ${upToDate}`);
  console.log(`  no chat messages (no-op):   ${noMessages.length}`);
  console.log(`  missing lastChatActivityAt: ${missing.length}`);
  console.log(`  stale (stored < computed):  ${stale.length}`);
  for (const s of missing) console.log(`  [missing] ${s.number}: -> ${s.computed}`);
  for (const s of stale) console.log(`  [stale]   ${s.number}: ${s.stored} -> ${s.computed}`);

  if (!apply) {
    console.log(`\nDry run complete. Nothing was modified.`);
    console.log(`To write the ${missing.length + stale.length} deterministic value(s) above, re-run with ${APPLY_FLAG}.`);
    return;
  }

  let updated = 0;
  for (const s of [...missing, ...stale]) {
    await db.collection("shipments").doc(s.id).update({ lastChatActivityAt: (s as any).computed });
    updated++;
  }
  console.log(`\nApply complete: lastChatActivityAt written on ${updated} shipment(s). No other field was touched.`);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
