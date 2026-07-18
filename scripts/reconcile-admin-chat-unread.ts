/**
 * reconcile-admin-chat-unread.ts — legacy adminChatUnread reconciliation
 * (fix/admin-mobile-chat-correctness). DRY-RUN BY DEFAULT:
 *
 *   npx tsx scripts/reconcile-admin-chat-unread.ts
 *
 * reads the adminChatUnread collection and REPORTS, without writing
 * anything:
 *   - records that carry a channel (healthy — clearable by normal seen calls),
 *   - channel-less records whose audience resolves DETERMINISTICALLY
 *     (driver-sent → driver_admin, client-sent → client_admin) — the seen
 *     route now clears these when their resolved channel is opened, and
 *     apply mode can optionally backfill the missing channel field,
 *   - channel-less admin-sent records — AMBIGUOUS (pre-channel-partition
 *     messages lived in the old merged driver/client thread; nothing in
 *     their metadata proves the audience). These are never auto-resolved
 *     and never cleared by opening a channel; they are listed here for a
 *     human decision.
 *
 * Apply mode exists ONLY behind an explicit flag and is intentionally
 * narrow: `--apply-backfill-channel` sets the missing `channel` field on
 * DETERMINISTIC records to their resolved audience (it never deletes a
 * record, never touches ambiguous records, never modifies messages).
 * Nothing in the application ever invokes this script — it is a manual,
 * human-reviewed operation.
 */
import "../src/lib/loadEnv";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { AdminChatUnreadRecord } from "../src/lib/chatUnreadAccess";
import { resolveLegacyUnreadAudience } from "../src/lib/chatUnreadAccess";

const APPLY_FLAG = "--apply-backfill-channel";

async function main() {
  const apply = process.argv.includes(APPLY_FLAG);
  initializeApp({ credential: applicationDefault() });
  const db = getFirestore();

  const snap = await db.collection("adminChatUnread").get();
  let healthy = 0;
  const deterministic: { record: AdminChatUnreadRecord; resolved: string }[] = [];
  const ambiguous: AdminChatUnreadRecord[] = [];

  for (const docSnap of snap.docs) {
    const r = docSnap.data() as AdminChatUnreadRecord;
    if (r.channel !== undefined) {
      healthy++;
      continue;
    }
    const audience = resolveLegacyUnreadAudience(r.message || { sender: "admin" });
    if (audience === "ambiguous_legacy_admin_message") {
      ambiguous.push({ ...r, id: docSnap.id });
    } else {
      deterministic.push({ record: { ...r, id: docSnap.id }, resolved: audience });
    }
  }

  console.log(`adminChatUnread records scanned: ${snap.size}`);
  console.log(`  healthy (channel present):                 ${healthy}`);
  console.log(`  stranded, deterministic audience:          ${deterministic.length}`);
  console.log(`  stranded, AMBIGUOUS legacy admin message:  ${ambiguous.length}`);

  for (const { record, resolved } of deterministic) {
    console.log(
      `  [deterministic] ${record.id}  shipment=${record.message?.shipmentId || record.shipmentId}` +
        ` sender=${record.message?.sender} impliedChannel=${resolved}` +
        ` reason=channel-less record; sender role fixes the audience`
    );
  }
  for (const record of ambiguous) {
    console.log(
      `  [ambiguous]     ${record.id}  shipment=${record.message?.shipmentId || record.shipmentId}` +
        ` sender=admin impliedChannel=NONE` +
        ` reason=pre-partition admin message; audience cannot be proven — needs human review`
    );
  }

  if (!apply) {
    console.log(`\nDry run complete. Nothing was modified.`);
    console.log(`To backfill the channel field on the ${deterministic.length} deterministic record(s), re-run with ${APPLY_FLAG}.`);
    return;
  }

  // Apply mode: backfill ONLY the deterministic records' channel field.
  let updated = 0;
  for (const { record, resolved } of deterministic) {
    await db.collection("adminChatUnread").doc(record.id).update({ channel: resolved });
    updated++;
  }
  console.log(`\nApply complete: channel backfilled on ${updated} deterministic record(s).`);
  console.log(`Ambiguous records were NOT modified (${ambiguous.length} remain for human review).`);
}

main().catch((err) => {
  console.error("Reconciliation failed:", err);
  process.exit(1);
});
