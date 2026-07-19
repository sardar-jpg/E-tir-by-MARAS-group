/**
 * backfill-identity-keys.ts — one-time migration for PR #137's
 * transactional identity reservations (accountIdentityKeys collection).
 *
 * DRY-RUN BY DEFAULT: prints what would be written and every legacy
 * collision it finds, writes NOTHING. Pass --execute to actually write
 * reservation documents. NEVER run --execute against production without
 * completing the documented migration order (docs/PRODUCTION_CONFIGURATION.md §7).
 *
 * What it does:
 *   1. Reads admins / drivers / clients.
 *   2. Computes the reservation claims each account SHOULD hold
 *      (admin email; driver username/email/phone with the "No phone"
 *      placeholder excluded; client username/email/phone) plus the
 *      protected owner's permanent claims.
 *   3. Reports collisions among legacy data (two accounts sharing an
 *      identity) — these are NEVER auto-resolved; fix the data first.
 *   4. In --execute mode, writes a reservation for every uncontested
 *      claim that doesn't already exist. Existing reservations owned by
 *      someone else are reported, never overwritten.
 *
 * Uses Application Default Credentials, same as the server. Usage:
 *   npx tsx scripts/backfill-identity-keys.ts             # dry run
 *   npx tsx scripts/backfill-identity-keys.ts --execute   # write
 */
import "../src/lib/loadEnv";
import { initializeApp, getApps, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  IDENTITY_KEYS_COLLECTION,
  OWNER_RESERVATION_SOURCE,
  computeIdentityClaims,
  computeOwnerClaims,
  buildReservationRecord,
  decideBackfillWrite,
  type IdentityKeyClaim,
  type IdentityCandidate,
} from "../src/lib/identityReservation";

/** The account's CURRENT reservable identity, per source collection. */
function identityOfAccount(source: string, record: Record<string, unknown>): IdentityCandidate {
  if (source === "admins") return { email: record.email as string | undefined };
  if (source === "drivers") {
    return {
      username: record.username as string | undefined,
      email: record.email as string | undefined,
      phone: (record.phone as string | undefined) === "No phone" ? "" : (record.phone as string | undefined),
    };
  }
  return {
    username: record.username as string | undefined,
    email: record.email as string | undefined,
    phone: record.phone as string | undefined,
  };
}

const EXECUTE = process.argv.includes("--execute");

async function main() {
  if (getApps().length === 0) initializeApp({ credential: applicationDefault() });
  const db = getFirestore();

  const [adminsSnap, driversSnap, clientsSnap, existingKeysSnap] = await Promise.all([
    db.collection("admins").get(),
    db.collection("drivers").get(),
    db.collection("clients").get(),
    db.collection(IDENTITY_KEYS_COLLECTION).get(),
  ]);
  const existingKeys = new Map(existingKeysSnap.docs.map((d) => [d.id, d.data() as { source: string; accountId: string }]));

  interface PlannedClaim { claim: IdentityKeyClaim; source: string; accountId: string; label: string }
  const planned: PlannedClaim[] = [];
  const ownerEmail = (process.env.SUPER_ADMIN_EMAIL || "sardar@maras.iq").toLowerCase();
  for (const claim of computeOwnerClaims(ownerEmail)) {
    planned.push({ claim, source: OWNER_RESERVATION_SOURCE, accountId: "owner", label: "protected owner" });
  }
  for (const d of adminsSnap.docs) {
    const a = d.data() as { id?: string; email?: string; name?: string };
    for (const claim of computeIdentityClaims({ email: a.email })) {
      planned.push({ claim, source: "admins", accountId: a.id || d.id, label: `admin ${a.name || d.id}` });
    }
  }
  for (const d of driversSnap.docs) {
    const dr = d.data() as { id?: string; username?: string; email?: string; phone?: string; name?: string };
    const identity = { username: dr.username, email: dr.email, phone: dr.phone === "No phone" ? "" : dr.phone };
    for (const claim of computeIdentityClaims(identity)) {
      planned.push({ claim, source: "drivers", accountId: dr.id || d.id, label: `driver ${dr.name || d.id}` });
    }
  }
  for (const d of clientsSnap.docs) {
    const c = d.data() as { id?: string; username?: string; email?: string; phone?: string; contactName?: string };
    for (const claim of computeIdentityClaims({ username: c.username, email: c.email, phone: c.phone })) {
      planned.push({ claim, source: "clients", accountId: c.id || d.id, label: `client ${c.contactName || d.id}` });
    }
  }

  // Legacy collision detection: two DIFFERENT accounts wanting one key.
  const byKey = new Map<string, PlannedClaim[]>();
  for (const p of planned) {
    const list = byKey.get(p.claim.keyId) || [];
    list.push(p);
    byKey.set(p.claim.keyId, list);
  }
  let collisions = 0;
  for (const [keyId, claimants] of byKey) {
    const owners = new Set(claimants.map((c) => `${c.source}/${c.accountId}`));
    if (owners.size > 1) {
      collisions++;
      console.log(`COLLISION ${claimants[0].claim.field} key ${keyId.slice(0, 18)}…  claimed by: ${claimants.map((c) => c.label).join("  vs  ")}`);
    }
  }

  // PR #137 final review: the snapshot above is a PLAN only — never
  // authorization to write. In --execute mode EVERY reservation goes
  // through its own transaction that re-reads the reservation doc AND the
  // backing account at write time, recomputes the account's CURRENT
  // claims, and writes only when decideBackfillWrite says "create". A
  // reservation created concurrently after the scan is never overwritten;
  // an account that changed identity or disappeared mid-run is reported
  // STALE and skipped. Dry-run mode counts from the snapshot (advisory).
  let toWrite = 0, alreadyOwned = 0, foreignOwned = 0, stale = 0;
  const nowIso = new Date().toISOString();
  for (const [keyId, claimants] of byKey) {
    if (new Set(claimants.map((c) => `${c.source}/${c.accountId}`)).size > 1) continue; // contested — never auto-resolved
    const p = claimants[0];

    if (!EXECUTE) {
      const current = existingKeys.get(keyId);
      if (current) {
        if (current.source === p.source && current.accountId === p.accountId) { alreadyOwned++; continue; }
        foreignOwned++;
        console.log(`SKIP ${keyId.slice(0, 18)}… already reserved by ${current.source}/${current.accountId}, wanted by ${p.label}`);
        continue;
      }
      toWrite++;
      continue;
    }

    const decision = await db.runTransaction(async (tx) => {
      const keyRef = db.collection(IDENTITY_KEYS_COLLECTION).doc(keyId);
      const keySnap = await tx.get(keyRef);
      let currentAccountExists = true;
      let currentClaimKeyIds: string[];
      if (p.source === OWNER_RESERVATION_SOURCE) {
        // Owner claims are re-derived from the CURRENT configured email.
        currentClaimKeyIds = computeOwnerClaims((process.env.SUPER_ADMIN_EMAIL || "sardar@maras.iq").toLowerCase()).map((c) => c.keyId);
      } else {
        const accountSnap = await tx.get(db.collection(p.source).doc(p.accountId));
        currentAccountExists = accountSnap.exists;
        currentClaimKeyIds = currentAccountExists
          ? computeIdentityClaims(identityOfAccount(p.source, accountSnap.data() as Record<string, unknown>)).map((c) => c.keyId)
          : [];
      }
      const d = decideBackfillWrite({
        plannedKeyId: keyId,
        planned: { source: p.source, accountId: p.accountId },
        currentReservation: keySnap.exists ? (keySnap.data() as { source: string; accountId: string }) : null,
        currentAccountExists,
        currentAccountClaimKeyIds: currentClaimKeyIds,
      });
      if (d.action === "create") {
        tx.set(keyRef, buildReservationRecord(p.claim, { source: p.source, accountId: p.accountId }, nowIso));
      }
      return d;
    });

    if (decision.action === "create") toWrite++;
    else if (decision.action === "already_owned") alreadyOwned++;
    else if (decision.action === "foreign_conflict") {
      foreignOwned++;
      console.log(`SKIP ${keyId.slice(0, 18)}… reserved by ${decision.currentOwner.source}/${decision.currentOwner.accountId} at write time, wanted by ${p.label}`);
    } else {
      stale++;
      console.log(`STALE ${keyId.slice(0, 18)}… ${decision.reason === "account_missing" ? "backing account no longer exists" : "account no longer claims this identity"} — not written (${p.label})`);
    }
  }

  console.log("──────────────────────────────────────────");
  console.log(`Mode:                ${EXECUTE ? "EXECUTE (transactional writes)" : "DRY RUN (nothing written)"}`);
  console.log(`Accounts scanned:    ${adminsSnap.size} admins, ${driversSnap.size} drivers, ${clientsSnap.size} clients (+owner)`);
  console.log(`Reservations ${EXECUTE ? "written" : "to write"}: ${toWrite}`);
  console.log(`Already in place:    ${alreadyOwned}`);
  console.log(`Foreign-owned skips: ${foreignOwned}`);
  if (EXECUTE) console.log(`Stale skips:         ${stale}`);
  console.log(`Legacy collisions:   ${collisions}${collisions ? "  ← RESOLVE THESE IN THE DATA FIRST" : ""}`);
  if (!EXECUTE) console.log("Re-run with --execute to write the uncontested reservations.");
  process.exit(collisions > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
