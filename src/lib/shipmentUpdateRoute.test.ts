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

  it("notifications and audit logging are only queued as post-commit side-effect tasks, built after the transaction has already resolved successfully", () => {
    const transactionCallIndex = ROUTE.indexOf("await applyShipmentRevisionedUpdate(");
    const firstNotificationIndex = ROUTE.indexOf("run: () => pushNotification(", transactionCallIndex);
    const auditIndex = ROUTE.indexOf("run: () => logActivity(", transactionCallIndex);
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

describe("PR #111 review — Blocker 1: a committed shipment update can never false-500 because a post-commit side effect failed", () => {
  it("driver-stat bumps, notifications, customer-watcher updates, and audit logging are all queued as tasks and run via runShipmentUpdateSideEffects, not awaited directly in the route body", () => {
    expect(ROUTE).toContain("const sideEffectTasks: ShipmentSideEffectTask[] = [];");
    expect(ROUTE).toContain("const sideEffectFailures = await runShipmentUpdateSideEffects(sideEffectTasks);");
    // None of the actual side-effect calls are awaited directly in the
    // route body anymore — they're deferred inside a task's `run`
    // (the driver-stat tasks still legitimately await their own setDoc,
    // just nested inside their own run closure, not at the top level).
    expect(ROUTE).not.toMatch(/\n\s*await pushNotification\(/);
    expect(ROUTE).not.toMatch(/\n\s*await notifyCustomerWatchers\(/);
    expect(ROUTE).not.toMatch(/\n\s*await logActivity\(/);
  });

  it("res.json(updatedShipment) is unconditional after the side-effect run — not inside a branch that a failure could skip", () => {
    const runIndex = ROUTE.indexOf("const sideEffectFailures = await runShipmentUpdateSideEffects(sideEffectTasks);");
    const resJsonIndex = ROUTE.indexOf("res.json(updatedShipment);", runIndex);
    expect(runIndex).toBeGreaterThan(-1);
    expect(resJsonIndex).toBeGreaterThan(runIndex);
    // Nothing but the logging loop sits between them.
    const between = ROUTE.slice(runIndex, resJsonIndex);
    expect(between).not.toContain("return res.status(500)");
    expect(between).not.toContain("throw ");
  });

  it("side-effect failures are logged with the shipment id/number and the effect name — not silently swallowed", () => {
    const logIndex = ROUTE.indexOf("for (const failure of sideEffectFailures)");
    expect(logIndex).toBeGreaterThan(-1);
    // Find the end of the whole console.error(...) call, not the first
    // "}" (which would be the closing brace of an earlier "${...}"
    // template-literal interpolation inside the message itself).
    const logBlockEnd = ROUTE.indexOf(");", ROUTE.indexOf("failure.error", logIndex)) + 2;
    const logBlock = ROUTE.slice(logIndex, logBlockEnd);
    expect(logBlock).toContain("failure.name");
    expect(logBlock).toContain("original.id");
    expect(logBlock).toContain("original.shipmentNumber");
    expect(logBlock).toContain("failure.error");
  });

  it("does not re-run or retry the shipment transaction when a side effect fails — applyShipmentRevisionedUpdate is called exactly once in this route", () => {
    const callCount = (ROUTE.match(/applyShipmentRevisionedUpdate\(req\.params\.id/g) || []).length;
    expect(callCount).toBe(1);
  });

  it("driver activeShipmentsCount updates are documented as a derived, non-authoritative cache, not the source of truth for assignment", () => {
    const decrementIndex = ROUTE.indexOf('name: "driver-stat-decrement"');
    const incrementIndex = ROUTE.indexOf('name: "driver-stat-increment"');
    expect(decrementIndex).toBeGreaterThan(-1);
    expect(incrementIndex).toBeGreaterThan(-1);
    // The honest-limitation comment sits just above the driver-stat tasks.
    const commentRegion = ROUTE.slice(Math.max(0, decrementIndex - 900), decrementIndex);
    expect(commentRegion).toContain("derived, cached tally");
    expect(commentRegion).toContain("not the");
    expect(commentRegion).toContain("authoritative record");
  });

  it("a revision conflict still returns 409 and builds/runs no side-effect tasks at all", () => {
    const conflictIndex = ROUTE.indexOf("if (err instanceof ShipmentRevisionConflictError)");
    const conflictReturnIndex = ROUTE.indexOf("return res.status(409)", conflictIndex);
    const sideEffectTasksDeclIndex = ROUTE.indexOf("const sideEffectTasks: ShipmentSideEffectTask[] = [];");
    expect(conflictIndex).toBeGreaterThan(-1);
    expect(conflictReturnIndex).toBeGreaterThan(conflictIndex);
    // The conflict branch (inside the catch around applyShipmentRevisionedUpdate)
    // returns before the code that declares/builds sideEffectTasks is ever
    // reached — they're sequential statements, and the conflict path exits
    // the function via `return` well before that declaration.
    expect(sideEffectTasksDeclIndex).toBeGreaterThan(conflictReturnIndex);
  });

  it("a genuine transaction/infrastructure failure (not a conflict) still surfaces as a failure response, not a silent success", () => {
    // Any error that isn't a ShipmentRevisionConflictError is rethrown from
    // the inner catch and falls through to the route's own outer catch,
    // which maps ServiceUnavailableError to 503 and anything else to 500 —
    // it is never swallowed into a 200.
    expect(ROUTE).toContain("throw err;");
    const outerCatchIndex = ROUTE.lastIndexOf("} catch (err) {");
    const outerCatchBlock = ROUTE.slice(outerCatchIndex);
    expect(outerCatchBlock).toContain("if (respondIfServiceUnavailable(err, res)) return;");
    expect(outerCatchBlock).toContain('res.status(500).json({ error: "Failed to update shipment details" });');
  });
});

describe("PR #111 review — over-broad revision policy correction: writer classification per route", () => {
  const STATUS_ROUTE = extractBetween(
    'app.put("/api/shipments/:id/status", requireAuth, async (req, res) => {',
    '// 5b. Subscribe Customer',
  );
  const SUBSCRIBE_CUSTOMER_ROUTE = extractBetween(
    'app.post("/api/shipments/:id/subscribe-customer", requireShipmentAccess, async (req, res) => {',
    '// 6. Get Chat Messages',
  );
  const CHAT_ROUTE = extractBetween(
    'app.post("/api/shipments/:id/chat", requireShipmentAccess, async (req, res) => {',
    '// 8. Upload Document Directly',
  );
  const DOCUMENTS_UPLOAD_ROUTE = extractBetween(
    'app.post("/api/shipments/:id/documents", requireShipmentAccess, async (req, res) => {',
    '// 9. Toggle Document Visibility',
  );
  const VISIBILITY_ROUTE = extractBetween(
    'app.put("/api/shipments/:id/documents/:docId/visibility", requireFullAdmin, async (req, res) => {',
    '// 10. Configure Sharing Page Link',
  );
  const SHARE_ROUTE = extractBetween(
    'app.post("/api/shipments/:id/share", requireShipmentAccess, async (req, res) => {',
    'app.get("/api/share/:token", async (req, res) => {',
  );
  const PUBLIC_SUBSCRIBE_ROUTE = extractBetween(
    'app.post("/api/share/:token/subscribe", async (req, res) => {',
    'app.post("/api/login"',
  );
  const DISTANCE_MATRIX_ROUTE = extractBetween(
    'app.get("/api/shipments/:id/distance-matrix", requireShipmentAccess, async (req, res) => {',
    'app.put("/api/shipments/:id", requireFullAdmin, async (req, res) => {',
  );

  it("status route stays on applyNarrowShipmentUpdate — status/timeline ARE broad-edit-overwritable fields", () => {
    expect(STATUS_ROUTE).toContain("await applyNarrowShipmentUpdate(shipmentId");
    expect(STATUS_ROUTE).not.toContain("applyIsolatedShipmentUpdate(");
  });

  it("every isolated writer route uses applyIsolatedShipmentUpdate, never applyNarrowShipmentUpdate", () => {
    for (const [name, route] of [
      ["subscribe-customer", SUBSCRIBE_CUSTOMER_ROUTE],
      ["chat", CHAT_ROUTE],
      ["documents upload", DOCUMENTS_UPLOAD_ROUTE],
      ["document visibility", VISIBILITY_ROUTE],
      ["share settings", SHARE_ROUTE],
      ["public subscribe", PUBLIC_SUBSCRIBE_ROUTE],
      ["distance-matrix", DISTANCE_MATRIX_ROUTE],
    ] as const) {
      expect(route, `${name} route body`).toContain("applyIsolatedShipmentUpdate(");
      expect(route, `${name} route body`).not.toContain("applyNarrowShipmentUpdate(");
    }
  });

  it("the distance-matrix route calls applyIsolatedShipmentUpdate exactly twice — the fallback-estimate branch and the Google-Maps-success branch", () => {
    const count = (DISTANCE_MATRIX_ROUTE.match(/applyIsolatedShipmentUpdate\(/g) || []).length;
    expect(count).toBe(2);
  });

  it("post-commit response semantics: status route's notification/audit calls run via runShipmentUpdateSideEffects, not bare awaits after the commit", () => {
    const commitIndex = STATUS_ROUTE.indexOf("await applyNarrowShipmentUpdate(shipmentId");
    const afterCommit = STATUS_ROUTE.slice(commitIndex);
    expect(afterCommit).toContain("await runShipmentUpdateSideEffects([");
    expect(afterCommit).not.toMatch(/\n\s*await pushNotification\(/);
    expect(afterCommit).not.toMatch(/\n\s*await logActivity\(/);
  });

  it("post-commit response semantics: subscribe-customer route's audit-log call runs via runShipmentUpdateSideEffects, not a bare await after the commit", () => {
    const commitIndex = SUBSCRIBE_CUSTOMER_ROUTE.indexOf("await applyIsolatedShipmentUpdate(shipmentId");
    const afterCommit = SUBSCRIBE_CUSTOMER_ROUTE.slice(commitIndex);
    expect(afterCommit).toContain("await runShipmentUpdateSideEffects([");
    expect(afterCommit).not.toMatch(/\n\s*await logActivity\(/);
  });

  it("post-commit response semantics: documents-upload route's audit-log call runs via runShipmentUpdateSideEffects, not a bare await after the commit", () => {
    const commitIndex = DOCUMENTS_UPLOAD_ROUTE.indexOf("await applyIsolatedShipmentUpdate(shipmentId");
    const afterCommit = DOCUMENTS_UPLOAD_ROUTE.slice(commitIndex);
    expect(afterCommit).toContain("await runShipmentUpdateSideEffects([");
    expect(afterCommit).not.toMatch(/\n\s*await logActivity\(/);
  });

  it("post-commit response semantics: chat route's document-upload notification/audit calls run via runShipmentUpdateSideEffects, not bare awaits after the commit", () => {
    const commitIndex = CHAT_ROUTE.indexOf("await applyIsolatedShipmentUpdate(shipmentId");
    expect(commitIndex).toBeGreaterThan(-1);
    const afterCommit = CHAT_ROUTE.slice(commitIndex);
    expect(afterCommit).toContain("await runShipmentUpdateSideEffects([");
  });
});

describe("Scope: shipmentNumber and no second business reference", () => {
  it("shipmentNumber is never reassigned by this route (it is never part of the update payload)", () => {
    expect(ROUTE).not.toMatch(/shipmentNumber:\s*data\.shipmentNumber/);
  });

  // No separate second-business-reference check here — noOrderNumberRegression.test.ts
  // (src/lib/) already scans every shipped source file (including server.ts) repo-wide.
});
