import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * fix/shipment-update-concurrency
 *
 * This codebase has no Express/route integration-test harness (no route is
 * ever exercised by booting the server against live Firebase — see
 * costStatementOrphanPrevention.test.ts's header comment for the same
 * situation and the same approach). The pure comparison/memory-fallback
 * logic behind this fix is unit-tested directly in shipmentRevision.test.ts;
 * what can't be exercised without live Firestore — that the transaction
 * actually performs the comparison and the write atomically, that
 * notifications/audit never run inside it, and that STRICT_PERSISTENCE still
 * refuses a silent memory write — is instead pinned here by scanning the
 * real shipped source, so a future edit can't silently reintroduce the
 * original race or leak a side effect into the transaction callback.
 */

const SERVER_TS_PATH = join(__dirname, "..", "..", "server.ts");
const SOURCE = readFileSync(SERVER_TS_PATH, "utf-8");

function extractBetween(startMarker: string, endMarker: string, afterIndex = 0): string {
  const start = SOURCE.indexOf(startMarker, afterIndex);
  expect(start, `expected to find "${startMarker}" in server.ts`).toBeGreaterThan(-1);
  const end = SOURCE.indexOf(endMarker, start);
  expect(end, `expected to find "${endMarker}" after "${startMarker}" in server.ts`).toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

const TRANSACTION_HELPER = extractBetween(
  "async function applyShipmentRevisionedUpdate(",
  "\nimport {",
);

const ROUTE = extractBetween(
  'app.put("/api/shipments/:id", requireFullAdmin, async (req, res) => {',
  "// 5. Update Status",
);

describe("sanity: both blocks were actually found and are non-trivial", () => {
  it("transaction helper", () => {
    expect(TRANSACTION_HELPER.length).toBeGreaterThan(200);
  });
  it("route", () => {
    expect(ROUTE.length).toBeGreaterThan(500);
  });
});

describe("the revision comparison and the shipment write happen inside the same Firestore transaction", () => {
  it("runs inside db.runTransaction", () => {
    expect(TRANSACTION_HELPER).toContain("db.runTransaction(async (tx: any) => {");
  });

  it("reads the document, checks the revision, and writes the update all within that one callback", () => {
    const callbackStart = TRANSACTION_HELPER.indexOf("db.runTransaction(async (tx: any) => {");
    const callbackEnd = TRANSACTION_HELPER.indexOf("}),", callbackStart);
    expect(callbackEnd).toBeGreaterThan(callbackStart);
    const callback = TRANSACTION_HELPER.slice(callbackStart, callbackEnd);
    expect(callback).toContain("await tx.get(sDocRef)");
    expect(callback).toContain("checkShipmentRevision(current.revision, expectedRevision)");
    expect(callback).toContain("throw new ShipmentRevisionConflictError(currentRevision, current)");
    expect(callback).toContain("tx.set(sDocRef,");
  });

  it("a version conflict is never treated as an infrastructure failure — it is rethrown before the memory-fallback switch", () => {
    expect(TRANSACTION_HELPER).toMatch(
      /if \(error instanceof ShipmentRevisionConflictError\) throw error;\s*\n\s*console\.warn/
    );
  });
});

describe("no notification, customer-watcher, or audit side effect ever runs inside the transaction callback", () => {
  const callbackStart = TRANSACTION_HELPER.indexOf("db.runTransaction(async (tx: any) => {");
  const callbackEnd = TRANSACTION_HELPER.indexOf("}),", callbackStart);
  const callback = TRANSACTION_HELPER.slice(callbackStart, callbackEnd);

  it("no pushNotification call", () => {
    expect(callback).not.toContain("pushNotification(");
  });
  it("no notifyCustomerWatchers call", () => {
    expect(callback).not.toContain("notifyCustomerWatchers(");
  });
  it("no logActivity call", () => {
    expect(callback).not.toContain("logActivity(");
  });
});

describe("STRICT_PERSISTENCE still refuses a silent memory write for this route", () => {
  it("the memory-fallback entry path throws ServiceUnavailableError under STRICT_PERSISTENCE before touching memory", () => {
    expect(TRANSACTION_HELPER).toMatch(
      /if \(useMemoryFallback \|\| !db\) \{\s*\n\s*if \(STRICT_PERSISTENCE\) throw new ServiceUnavailableError\(\);/
    );
  });

  it("the post-failure memory-fallback path also throws ServiceUnavailableError under STRICT_PERSISTENCE before falling back", () => {
    const afterCatch = TRANSACTION_HELPER.slice(TRANSACTION_HELPER.indexOf("} catch (error) {"));
    expect(afterCatch).toMatch(/if \(STRICT_PERSISTENCE\) throw new ServiceUnavailableError\(\);/);
  });
});

describe("PUT /api/shipments/:id route: expectedRevision is required, never optional", () => {
  it("rejects a missing/malformed expectedRevision with 400, before any Firestore read", () => {
    const validationIndex = ROUTE.indexOf("parseExpectedRevision(data.expectedRevision)");
    const getDocIndex = ROUTE.indexOf("await getDoc(sDocRef)");
    expect(validationIndex).toBeGreaterThan(-1);
    expect(getDocIndex).toBeGreaterThan(validationIndex);
    expect(ROUTE).toMatch(/if \(expectedRevision === null\) \{\s*\n\s*return res\.status\(400\)/);
  });

  it("uses the shared applyShipmentRevisionedUpdate helper rather than a bare setDoc", () => {
    expect(ROUTE).toContain("applyShipmentRevisionedUpdate(req.params.id, expectedRevision, buildUpdatedShipment)");
  });

  it("responds 409 with the structured conflict shape and never modifies the shipment on conflict", () => {
    expect(ROUTE).toMatch(/if \(err instanceof ShipmentRevisionConflictError\) \{/);
    expect(ROUTE).toContain('code: err.code');
    expect(ROUTE).toContain("currentRevision: err.currentRevision");
    expect(ROUTE).toContain("shipment: err.currentShipment");
  });

  it("notifications and audit logging only run after the transaction has already resolved successfully", () => {
    const transactionCallIndex = ROUTE.indexOf("await applyShipmentRevisionedUpdate(");
    const firstNotificationIndex = ROUTE.indexOf("await pushNotification(", transactionCallIndex);
    const auditIndex = ROUTE.indexOf("await logActivity(", transactionCallIndex);
    expect(firstNotificationIndex).toBeGreaterThan(transactionCallIndex);
    expect(auditIndex).toBeGreaterThan(transactionCallIndex);
  });

  it("the 'first assignment' notification fires from a flag set exactly when the New -> Assigned bump ran, not from re-deriving it after the fact", () => {
    // A request that assigns a new driver AND separately sets data.status
    // to "Assigned" explicitly must behave exactly as before this fix:
    // the bump-specific "New Assignment Assigned" notification only fires
    // when the bump itself actually changed status, not whenever the final
    // status merely happens to equal "Assigned". Re-deriving this from
    // original.status/updatedShipment.status after the transaction would
    // get this wrong (both could independently be "New"/"Assigned" without
    // the bump ever running) — assignmentBumpApplied is set inside
    // buildUpdatedShipment at the exact moment the pre-fix code made this
    // same decision, and used unchanged afterward.
    expect(ROUTE).toContain("let assignmentBumpApplied = false;");
    const bumpIfIndex = ROUTE.indexOf('if (oldDriverId !== newDriverId && newDriverId && updated.status === "New") {');
    expect(bumpIfIndex).toBeGreaterThan(-1);
    const bumpBlockEnd = ROUTE.indexOf("}", ROUTE.indexOf("assignmentBumpApplied = true;", bumpIfIndex));
    const bumpBlock = ROUTE.slice(bumpIfIndex, bumpBlockEnd);
    expect(bumpBlock).toContain("assignmentBumpApplied = true;");
    expect(ROUTE).toContain("if (assignmentBumpApplied) {");
    expect(ROUTE).not.toMatch(/if \(oldDriverId !== newDriverId && newDriverId && original\.status === "New"/);
  });

  it("the route now checks respondIfServiceUnavailable, so a genuine Firestore outage 503s instead of a generic 500", () => {
    expect(ROUTE).toContain("if (respondIfServiceUnavailable(err, res)) return;");
  });
});

describe("Scope: shipmentNumber and no second business reference", () => {
  it("shipmentNumber is never reassigned by this route (it is never part of the update payload)", () => {
    expect(ROUTE).not.toMatch(/shipmentNumber:\s*data\.shipmentNumber/);
  });

  // No separate second-business-reference check here — noOrderNumberRegression.test.ts
  // (src/lib/) already scans every shipped source file (including server.ts) repo-wide.
});
