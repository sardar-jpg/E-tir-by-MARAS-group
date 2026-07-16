import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * fix/shipment-update-concurrency (PR #111 review — Blocker 2)
 *
 * Every route/helper that writes to an EXISTING shipment document must be
 * one of exactly two things:
 *   - revision-guarded (the human edit form, PUT /api/shipments/:id, via
 *     applyShipmentRevisionedUpdate — requires a client expectedRevision
 *     and 409s on a mismatch), or
 *   - a narrow, server-owned atomic update (status changes, document/chat/
 *     share appends and toggles, public share-link subscribes, via
 *     applyNarrowShipmentUpdate — no client expectedRevision to check, but
 *     unconditionally advances revision so a stale admin edit form still
 *     409s on its next save).
 *
 * A writer that bypasses both — a raw setDoc/updateDoc/tx.set straight
 * against a shipment document reference — would silently leave revision
 * unchanged, defeating the whole fix for every OTHER writer: an admin edit
 * form opened before that write would still save successfully afterward
 * without ever detecting the change.
 *
 * This scans the real shipped server.ts source (no Express/live-Firestore
 * harness in this repo — same situation and same approach as
 * costStatementOrphanPrevention.test.ts) for every write that targets the
 * "shipments" collection and asserts each one is inside a known-accounted-for
 * location. A future PR that adds a new raw write bypassing both helpers
 * will fail this test's total-count assertion, not silently reintroduce an
 * unguarded writer.
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
    reason: "revision-guarded (applyShipmentRevisionedUpdate) and revision-incrementing narrow (applyNarrowShipmentUpdate) transactions both use this identical line — see the count assertion below for why two is correct.",
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

  it("the shared transaction line (tx.set(sDocRef, cleanUndefined(updated))) appears exactly twice — once per revision-aware helper, never a third bespoke copy", () => {
    const count = countOccurrences(SOURCE, "tx.set(sDocRef, cleanUndefined(updated));");
    expect(count).toBe(2);
  });

  it("the one-time startup seed and the create-route write each appear exactly once", () => {
    expect(countOccurrences(SOURCE, 'await db.collection("shipments").doc(s.id).set(cleaned);')).toBe(1);
    expect(countOccurrences(SOURCE, 'await setDoc(doc(db, "shipments", id), newShipment);')).toBe(1);
  });

  it("every route calling applyNarrowShipmentUpdate is present — the complete narrow-writer inventory", () => {
    // One call site per narrow writer: status, subscribe-customer,
    // chat-file-attachment, direct document upload, document-visibility
    // toggle, share-settings, the public share-link subscribe, and the two
    // best-effort ETA/distance cache writes on the distance-matrix route
    // (initially missed in the Blocker 2 audit precisely because it isn't
    // shaped like a shipment "edit" route — caught by this test's own
    // total-write-count assertion below).
    const narrowCallCount = (SOURCE.match(/await applyNarrowShipmentUpdate\(/g) || []).length;
    expect(narrowCallCount).toBe(9);
  });

  it("exactly one route calls the revision-guarded applyShipmentRevisionedUpdate — the human edit form", () => {
    const guardedCallCount = (SOURCE.match(/await applyShipmentRevisionedUpdate\(/g) || []).length;
    expect(guardedCallCount).toBe(1);
  });

  it("no write call targets a shipment document reference outside the two revision-aware helper functions or the two documented exceptions", () => {
    // Every occurrence of the broad write pattern must be explained by one
    // of: the two helper functions' own internal tx.set (2 occurrences),
    // the startup seed (1), or the create route (1) — 4 total. If this
    // count ever grows, a new writer was added that isn't accounted for in
    // KNOWN_WRITE_SITES above and needs review before this test is updated.
    const matches = SOURCE.match(WRITE_CALL_PATTERN) || [];
    expect(matches.length).toBe(4);
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
});
