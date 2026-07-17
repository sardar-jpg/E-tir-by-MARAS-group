import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * fix/shipment-update-concurrency (PR #111 review — Blocker 2, then
 * narrowed by the over-broad-revision-policy correction that followed it)
 *
 * Every route/helper that writes to an existing or brand-new shipment
 * document must be exactly one of these four, never a raw write that
 * bypasses all of them:
 *
 *   1. Revision-guarded broad edit — PUT /api/shipments/:id, via
 *      applyShipmentRevisionedUpdate. Requires a client expectedRevision
 *      and 409s on a mismatch.
 *   2. Revision-incrementing operational mutation — a writer that changes
 *      a field the broad edit form's own merge (buildUpdatedShipment) can
 *      also overwrite (currently: status/timeline only), via
 *      applyNarrowShipmentUpdate. No client expectedRevision to check, but
 *      unconditionally advances revision so a stale admin edit form still
 *      409s on its next save.
 *   3. Revision-preserving isolated atomic mutation — a writer whose
 *      fields the broad edit form's merge never overwrites (document
 *      appends/uploads, chat attachments saved as documents, document
 *      visibility, customer/public subscriptions, share settings, the
 *      best-effort derived ETA/distance cache), via
 *      applyIsolatedShipmentUpdate. Still atomic, but deliberately does
 *      NOT advance revision — advancing it would manufacture a false
 *      conflict for an admin edit session that writer could never
 *      actually have clobbered.
 *   4. New-document creation — POST /api/shipments and the one-time
 *      startup seed. Not a mutation of an existing document at all;
 *      explicitly sets revision: INITIAL_SHIPMENT_REVISION.
 *
 * Do NOT enforce "every shipment writer increments revision" — that rule
 * is incorrect. Only writers touching a field the broad edit form can also
 * overwrite (category 2) should. A writer that bypasses ALL four
 * categories — a raw setDoc/updateDoc/tx.set straight against a shipment
 * document reference — would silently leave revision unchanged with no
 * atomicity guarantee at all, defeating the whole fix.
 *
 * This scans the real shipped server.ts source (no Express/live-Firestore
 * harness in this repo — same situation and same approach as
 * costStatementOrphanPrevention.test.ts) for every write that targets the
 * "shipments" collection and asserts each one is inside a known-accounted-for
 * location. A future PR that adds a new raw write bypassing all four
 * categories will fail this test's total-count assertion, not silently
 * reintroduce an unguarded writer.
 */

const SERVER_TS_PATH = join(__dirname, "..", "..", "server.ts");
const SOURCE = readFileSync(SERVER_TS_PATH, "utf-8");

interface WriteSite {
  /** Substring uniquely identifying this write call. */
  needle: string;
  /** Human-readable reason this write is accounted for. */
  reason: string;
}

// The complete, reviewed inventory of every place server.ts writes to an
// existing (or brand-new) shipment document. Any write call matching the
// broad detection regex below that ISN'T one of these is an unreviewed
// writer and must fail this test.
const KNOWN_WRITE_SITES: WriteSite[] = [
  {
    needle: "tx.set(sDocRef, cleanUndefined(updated));",
    reason: "all three revision-aware transactions (applyShipmentRevisionedUpdate, applyNarrowShipmentUpdate, applyIsolatedShipmentUpdate) use this identical line — see the count assertion below for why three is correct.",
  },
  {
    needle: 'await db.collection("shipments").doc(s.id).set(cleaned);',
    reason: "one-time startup seed — only runs when the shipments collection is completely empty; creates brand-new demo documents, never mutates an existing one.",
  },
  {
    needle: 'await setDoc(doc(db, "shipments", id), newShipment);',
    reason: "POST /api/shipments (create route) — a brand-new document, not a mutation of an existing one; explicitly sets revision: INITIAL_SHIPMENT_REVISION.",
  },
];

// Matches any write call that targets a shipment document reference,
// whichever of the several equivalent ways this codebase spells it: the
// setDoc/tx.set/updateDoc wrappers against sDocRef/sRef/doc(db,"shipments",...),
// or a raw Admin SDK chained db.collection("shipments").doc(...).set(...)
// call (the one-time startup seed's own style, which doesn't go through
// any of those wrappers at all). Broad on purpose — a future writer using
// a slightly different local variable name, or a different chained-call
// shape, must still be caught, not silently miscounted as zero.
const WRITE_CALL_PATTERN = /(?:(?:tx\.set|setDoc|updateDoc)\(\s*(?:sDocRef|sRef|doc\(db,\s*"shipments"))|(?:db\.collection\("shipments"\)\.doc\([^)]*\)\.set\()/g;

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("Every write to the shipments collection is a known, reviewed writer", () => {
  it("sanity check: the detection pattern actually finds writes in the real source (not silently matching nothing)", () => {
    const matches = SOURCE.match(WRITE_CALL_PATTERN) || [];
    expect(matches.length).toBeGreaterThan(0);
  });

  it("every known write site's needle actually occurs in server.ts (no stale/renamed entry in this inventory)", () => {
    for (const site of KNOWN_WRITE_SITES) {
      const count = countOccurrences(SOURCE, site.needle);
      expect(count, `expected to find "${site.needle}" (${site.reason})`).toBeGreaterThan(0);
    }
  });

  it("the shared transaction line (tx.set(sDocRef, cleanUndefined(updated))) appears exactly three times — once per revision-aware helper, never a fourth bespoke copy", () => {
    const count = countOccurrences(SOURCE, "tx.set(sDocRef, cleanUndefined(updated));");
    expect(count).toBe(3);
  });

  it("the one-time startup seed and the create-route write each appear exactly once", () => {
    expect(countOccurrences(SOURCE, 'await db.collection("shipments").doc(s.id).set(cleaned);')).toBe(1);
    expect(countOccurrences(SOURCE, 'await setDoc(doc(db, "shipments", id), newShipment);')).toBe(1);
  });

  it("exactly five routes call applyNarrowShipmentUpdate — the reviewed revision-incrementing operational writers (status progression, Admin Status Override, and the Driver Alliance lifecycle: broadcast, cancel, winner selection)", () => {
    // Status/timeline are the only fields, among all narrow writers, that
    // the broad edit form's own merge (buildUpdatedShipment) can also
    // overwrite — every other former "narrow" writer was reclassified as
    // isolated by the over-broad-revision-policy correction below.
    // PR #111 review (Admin Status Override authorization correction): the
    // broad edit route no longer accepts a free-form status field at all
    // (buildUpdatedShipment always starts finalStatus from current.status);
    // the dedicated status-override route is the second, separate writer.
    // Driver Alliance Phase 1: winner selection with a reference shipment
    // is the third reviewed writer — it assigns the referenced shipment
    // (driver/truck/agreedAmount/status→Assigned + timeline entry) through
    // this same transactional helper, guarded by requireFullAdmin and the
    // one-active-job claim (claimDriverActiveJob) beforehand.
    // Order-status lifecycle (Driver Alliance order linking): broadcast and
    // cancel are the fourth and fifth reviewed writers — broadcast stamps
    // the linked Order "New" → "Waiting for Driver Quotes", cancel releases
    // it back to "New". Both are guarded no-ops unless the Order is exactly
    // in the expected pre-assignment state (status check + !assignedDriverId
    // inside the mutate callback), so they can never move a live shipment.
    const narrowCallCount = (SOURCE.match(/await applyNarrowShipmentUpdate\(/g) || []).length;
    expect(narrowCallCount).toBe(5);
  });

  it("every route calling applyIsolatedShipmentUpdate is present — the complete revision-preserving isolated-writer inventory", () => {
    // One call site per isolated writer: subscribe-customer,
    // chat-file-attachment, direct document upload, document-visibility
    // toggle, share-settings, the public share-link subscribe, and the two
    // best-effort ETA/distance cache writes on the distance-matrix route
    // (initially miscategorized as revision-incrementing in the Blocker 2
    // audit, then corrected here since none of these touch a field the
    // broad edit form's merge can also overwrite).
    const isolatedCallCount = (SOURCE.match(/await applyIsolatedShipmentUpdate\(/g) || []).length;
    expect(isolatedCallCount).toBe(8);
  });

  it("exactly one route calls the revision-guarded applyShipmentRevisionedUpdate — the human edit form", () => {
    const guardedCallCount = (SOURCE.match(/await applyShipmentRevisionedUpdate\(/g) || []).length;
    expect(guardedCallCount).toBe(1);
  });

  it("no write call targets a shipment document reference outside the three revision-aware helper functions or the two documented new-document exceptions", () => {
    // Every occurrence of the broad write pattern must be explained by one
    // of: the three helper functions' own internal tx.set (3 occurrences),
    // the startup seed (1), or the create route (1) — 5 total. If this
    // count ever grows, a new writer was added that isn't accounted for in
    // KNOWN_WRITE_SITES above and needs review before this test is updated.
    const matches = SOURCE.match(WRITE_CALL_PATTERN) || [];
    expect(matches.length).toBe(5);
  });
});

describe("Classification is honest about which writers require expectedRevision", () => {
  it("applyShipmentRevisionedUpdate requires and checks expectedRevision", () => {
    const fnStart = SOURCE.indexOf("async function applyShipmentRevisionedUpdate(");
    expect(fnStart).toBeGreaterThan(-1);
    const fnRegion = SOURCE.slice(fnStart, fnStart + 1500);
    expect(fnRegion).toContain("expectedRevision: number");
    expect(fnRegion).toContain("checkShipmentRevision(current.revision, expectedRevision)");
  });

  it("applyNarrowShipmentUpdate takes no expectedRevision parameter and always advances the revision", () => {
    const fnStart = SOURCE.indexOf("async function applyNarrowShipmentUpdate(");
    expect(fnStart).toBeGreaterThan(-1);
    const fnRegion = SOURCE.slice(fnStart, fnStart + 1200);
    expect(fnRegion).not.toContain("expectedRevision");
    expect(fnRegion).toContain("resolveStoredRevision(current.revision) + 1");
  });

  it("applyIsolatedShipmentUpdate takes no expectedRevision parameter and never advances the revision", () => {
    const fnStart = SOURCE.indexOf("async function applyIsolatedShipmentUpdate(");
    expect(fnStart).toBeGreaterThan(-1);
    const fnRegion = SOURCE.slice(fnStart, fnStart + 1500);
    expect(fnRegion).not.toContain("expectedRevision");
    expect(fnRegion).not.toContain("resolveStoredRevision(current.revision) + 1");
    // Forces the write's revision back to whatever the transaction's own
    // fresh read already had — never a caller-supplied or incremented value.
    expect(fnRegion).toContain("revision: current.revision");
  });
});
