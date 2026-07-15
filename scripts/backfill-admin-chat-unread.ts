/**
 * backfill-admin-chat-unread.ts
 *
 * Chat-unread scalability follow-up.
 *
 * GET /api/chat/unread now answers from a maintained `adminChatUnread`
 * collection (one document per (adminId, messageId) pair currently unread
 * for that admin — see src/lib/chatUnreadAccess.ts's header comment for the
 * full design) instead of walking every `chatMessages` document ever
 * written. Every chat message sent AFTER this shipped self-heals: the
 * "send message" write path (server.ts, planUnreadFanout) creates the
 * right adminChatUnread records atomically alongside the message itself.
 *
 * This script is only for chatMessages documents written BEFORE
 * adminChatUnread existed — they have no adminChatUnread records at all,
 * so without running this, every admin's unread badge would silently
 * exclude any pre-existing unread conversation the first time this ships,
 * even though those messages genuinely haven't been read yet.
 *
 * Recomputes, per admin, EXACTLY what the OLD GET /api/chat/unread would
 * have shown that admin (same isMessageFromOtherAdmin eligibility rule,
 * same readByAdminIds "already read" exclusion — a message some admin
 * already read under the legacy per-admin tracking is correctly NOT
 * resurrected as unread by this script), so running it does not change
 * anyone's unread state, only where that state is durably stored.
 *
 * Idempotent: each record's id is deterministic (`${adminId}__${messageId}`,
 * matching buildAdminChatUnreadRecordId in src/lib/chatUnreadAccess.ts) and
 * written with `.set()` (an upsert), so re-running this script (including a
 * second, later run against messages sent after the first run) never
 * creates a duplicate record — a record that's already correct is simply
 * overwritten with identical content.
 *
 * NOT run automatically by this codebase, by CI, or by any deploy step.
 * An operator runs it manually, against production, when ready — the task
 * that introduced this script does not run it.
 *
 * Usage:
 *   npx tsx scripts/backfill-admin-chat-unread.ts            # dry run (default) — reports what WOULD be written, writes nothing
 *   npx tsx scripts/backfill-admin-chat-unread.ts --apply    # actually writes the adminChatUnread records
 *
 * Requires the same Application Default Credentials server.ts itself needs
 * (`gcloud auth application-default login`, or the runtime service account
 * on Cloud Run) and firebase-applet-config.json for the project id /
 * Firestore database id — no separate configuration.
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

/** Firestore's hard cap on operations in a single WriteBatch — mirrors server.ts's own UNREAD_FANOUT_CHUNK_SIZE reasoning. */
const BATCH_CHUNK_SIZE = 450;

interface ChatMessageShape {
  id: string;
  shipmentId: string;
  sender: "admin" | "driver" | "client";
  senderId?: string;
  channel?: string;
  timestamp: string;
  readByAdminIds?: string[];
}

// Mirrors src/lib/chatUnreadAccess.ts's isMessageFromOtherAdmin exactly
// (kept as an inline copy here rather than imported, matching this
// codebase's existing backfill-script convention — see
// backfill-additional-driver-ids.ts/backfill-shipment-timestamps.ts —
// of a small, fully self-contained, independently-auditable script for
// anything that writes to production).
function isMessageFromOtherAdmin(message: ChatMessageShape, viewerAdminId: string): boolean {
  if (message.sender !== "admin") return true;
  return Boolean(message.senderId) && message.senderId !== viewerAdminId;
}

// Mirrors isMessageUnreadForAdmin exactly — the "already read under the
// legacy per-admin tracking" exclusion this script must respect so it
// never resurrects a message someone has genuinely already read.
function isMessageUnreadForAdmin(message: ChatMessageShape, viewerAdminId: string): boolean {
  if (!isMessageFromOtherAdmin(message, viewerAdminId)) return false;
  const readBy = message.readByAdminIds || [];
  return !readBy.includes(viewerAdminId);
}

function buildRecordId(adminId: string, messageId: string): string {
  return `${adminId}__${messageId}`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
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

  const [messagesSnapshot, adminsSnapshot] = await Promise.all([
    db.collection("chatMessages").get(),
    db.collection("admins").get(),
  ]);

  const messages = messagesSnapshot.docs.map((d) => ({ ...(d.data() as object), id: d.id } as ChatMessageShape));
  const adminIds = new Set<string>(adminsSnapshot.docs.map((d) => d.id));

  // Same two identity sources server.ts's resolveAllAdminIds() uses for
  // live fan-out — SUPER_ADMIN_EMAIL is an env-configured root account
  // that intentionally has no document in `admins` at all (see
  // resolveChatSenderIdentity's super-admin branch in server.ts). Missing
  // it here would leave that admin's pre-existing unread conversations
  // permanently un-backfilled. No `.trim()` — must match the exact
  // normalization server.ts's login/session paths use for
  // `req.session.id` (`.toLowerCase()` only), or a whitespace-padded env
  // var would backfill under an id that never equals the real session id.
  const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL || "").toLowerCase();
  if (superAdminEmail) adminIds.add(superAdminEmail);

  console.log(`Scanned ${messages.length} chat message(s) and ${adminIds.size} admin id(s) (${adminsSnapshot.size} from the admins collection${superAdminEmail ? " + 1 env-configured super-admin" : ""}).`);

  interface PlannedRecord {
    id: string;
    adminId: string;
    messageId: string;
    shipmentId: string;
    channel?: string;
    timestamp: string;
    message: ChatMessageShape;
    createdAt: string;
  }

  const nowIso = new Date().toISOString();
  const planned: PlannedRecord[] = [];

  for (const adminId of adminIds) {
    for (const message of messages) {
      if (!isMessageUnreadForAdmin(message, adminId)) continue;
      planned.push({
        id: buildRecordId(adminId, message.id),
        adminId,
        messageId: message.id,
        shipmentId: message.shipmentId,
        channel: message.channel,
        timestamp: message.timestamp,
        message,
        createdAt: nowIso,
      });
    }
  }

  console.log(`${planned.length} adminChatUnread record(s) would be created/upserted across ${adminIds.size} admin(s).`);
  for (const record of planned) {
    console.log(`  ${record.id}  (shipment ${record.shipmentId}${record.channel ? `, channel ${record.channel}` : ", no channel"})`);
  }

  if (!APPLY) {
    console.log("Re-run with --apply to write.");
    return;
  }

  const collectionRef = db.collection("adminChatUnread");
  for (const batchRecords of chunk(planned, BATCH_CHUNK_SIZE)) {
    const batch = db.batch();
    for (const record of batchRecords) {
      // Firestore's Admin SDK throws on an explicit `undefined` field value
      // (this project's `db` is not configured with
      // ignoreUndefinedProperties) — `channel` is the only optional field
      // here (legacy, pre-BUG-03 messages have none), so it's stripped
      // rather than passed through as `undefined`.
      const { channel, ...rest } = record;
      batch.set(collectionRef.doc(record.id), channel === undefined ? rest : record);
    }
    await batch.commit();
  }
  console.log(`Wrote ${planned.length} adminChatUnread record(s).`);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
