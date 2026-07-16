import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * fix/shipment-update-concurrency (PR #111 review — forward-only status
 * transitions + Delivered/Closed terminal rules)
 *
 * PUT /api/shipments/:id/status used to accept any status string with no
 * ordering check, and ran its notification/driver-stat side effects BEFORE
 * the actual commit (against a pre-read snapshot) — meaning they would have
 * already fired even for a transition later rejected as invalid. This scans
 * the real shipped server.ts source (no Express harness in this repo — see
 * shipmentUpdateRoute.test.ts/shipmentWriterInventory.test.ts for the same
 * approach) to pin: the structured 409 rejection shape, the transaction-time
 * re-validation, the closing-status authorization gate, the one documented
 * backward-transition exception, and that every side effect is strictly
 * post-commit.
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

const STATUS_ROUTE = extractBetween(
  'app.put("/api/shipments/:id/status", requireAuth, async (req, res) => {',
  "// 5b. Subscribe Customer",
);

describe("sanity: the status route block was found and is non-trivial", () => {
  it("route", () => {
    expect(STATUS_ROUTE.length).toBeGreaterThan(500);
  });
});

describe("closing-status authorization: only authorized MARAS staff may close a shipment", () => {
  it("checks isShipmentClosed against the requested status before allowing the transition through", () => {
    expect(STATUS_ROUTE).toContain("isShipmentClosed(requestedStatus, item.freightType)");
  });

  it("rejects with 403 unless the session is an admin passing canViewShipmentRegistry", () => {
    const gateIndex = STATUS_ROUTE.indexOf("isShipmentClosed(requestedStatus, item.freightType)");
    const rejectIndex = STATUS_ROUTE.indexOf("res.status(403)", gateIndex);
    expect(rejectIndex).toBeGreaterThan(gateIndex);
    const gateBlock = STATUS_ROUTE.slice(gateIndex, rejectIndex);
    expect(gateBlock).toContain('req.session!.role === "admin" && canViewShipmentRegistry(req.session!.adminType)');
  });

  it("this authorization check runs before the transition is validated/applied — driver/client sessions never even reach the transaction for a closing status", () => {
    const gateIndex = STATUS_ROUTE.indexOf("isShipmentClosed(requestedStatus, item.freightType)");
    const transactionIndex = STATUS_ROUTE.indexOf("await applyNarrowShipmentUpdate(shipmentId");
    expect(gateIndex).toBeGreaterThan(-1);
    expect(transactionIndex).toBeGreaterThan(gateIndex);
  });
});

describe("forward-only transition validation runs inside the transaction, against its own fresh `current`", () => {
  it("validateShipmentStatusTransition is called with current.status/current.freightType, never the pre-read `item`", () => {
    expect(STATUS_ROUTE).toContain("validateShipmentStatusTransition(current.status, requestedStatus, current.freightType)");
  });

  it("the one documented exception (driver assignment rejection) is checked before the general rule, inside the same callback", () => {
    const callbackStart = STATUS_ROUTE.indexOf("await applyNarrowShipmentUpdate(shipmentId, (current) => {");
    expect(callbackStart).toBeGreaterThan(-1);
    const exceptionIndex = STATUS_ROUTE.indexOf("isDriverAssignmentRejection(current.status, requestedStatus)", callbackStart);
    const validateIndex = STATUS_ROUTE.indexOf("validateShipmentStatusTransition(", callbackStart);
    expect(exceptionIndex).toBeGreaterThan(callbackStart);
    expect(validateIndex).toBeGreaterThan(exceptionIndex);
  });

  it("an invalid transition throws ShipmentStatusTransitionError with the allowedNextStatuses/reason from the check — never silently applies", () => {
    expect(STATUS_ROUTE).toContain(
      "throw new ShipmentStatusTransitionError(current.status, requestedStatus, transition.allowedNextStatuses, transition.reason!);"
    );
  });

  it("the timeline event and status/updatedAt are built from `current` (transaction-fresh), not the pre-read `item`", () => {
    const callbackStart = STATUS_ROUTE.indexOf("await applyNarrowShipmentUpdate(shipmentId, (current) => {");
    const callbackEnd = STATUS_ROUTE.indexOf("});", callbackStart);
    const callback = STATUS_ROUTE.slice(callbackStart, callbackEnd);
    expect(callback).toContain("...current,");
    expect(callback).toContain("...current.timeline,");
    expect(callback).not.toContain("item.status");
    expect(callback).not.toContain("item.timeline");
  });
});

describe("structured 409 rejection shape (INVALID_SHIPMENT_STATUS_TRANSITION)", () => {
  it("catches ShipmentStatusTransitionError and responds 409 with the full structured shape", () => {
    const catchIndex = STATUS_ROUTE.indexOf("if (err instanceof ShipmentStatusTransitionError)");
    expect(catchIndex).toBeGreaterThan(-1);
    const responseIndex = STATUS_ROUTE.indexOf("res.status(409)", catchIndex);
    expect(responseIndex).toBeGreaterThan(catchIndex);
    const responseBlock = STATUS_ROUTE.slice(responseIndex, STATUS_ROUTE.indexOf("}", STATUS_ROUTE.indexOf("allowedNextStatuses: err.allowedNextStatuses", responseIndex)) + 1);
    expect(responseBlock).toContain("code: err.code");
    expect(responseBlock).toContain("currentStatus: err.currentStatus");
    expect(responseBlock).toContain("requestedStatus: err.requestedStatus");
    expect(responseBlock).toContain("allowedNextStatuses: err.allowedNextStatuses");
  });

  it("a genuine transaction/infrastructure failure (not a rejection) is rethrown, not swallowed", () => {
    const catchIndex = STATUS_ROUTE.indexOf("if (err instanceof ShipmentStatusTransitionError)");
    const afterConflictBranch = STATUS_ROUTE.slice(catchIndex);
    expect(afterConflictBranch).toContain("throw err;");
  });
});

describe("post-commit response semantics: no side effect ever runs before the transition is validated and committed", () => {
  it("notifyCustomerWatchers, pushNotification, logActivity, and the driver-stat task are all declared after the applyNarrowShipmentUpdate call, never before it", () => {
    const transactionIndex = STATUS_ROUTE.indexOf("let updatedItem: Shipment;");
    expect(transactionIndex).toBeGreaterThan(-1);
    const beforeTransaction = STATUS_ROUTE.slice(0, transactionIndex);
    expect(beforeTransaction).not.toContain("notifyCustomerWatchers(");
    expect(beforeTransaction).not.toContain("pushNotification(");
    expect(beforeTransaction).not.toContain("logActivity(");
    expect(beforeTransaction).not.toContain('doc(db, "drivers"');
  });

  it("the driver-stat delivered-increment task is gated on requestedStatus === \"Delivered\" and built from updatedItem (the committed result), not the pre-read item", () => {
    const taskIndex = STATUS_ROUTE.indexOf('name: "driver-stat-delivered-increment"');
    expect(taskIndex).toBeGreaterThan(-1);
    const guardRegion = STATUS_ROUTE.slice(Math.max(0, taskIndex - 700), taskIndex);
    expect(guardRegion).toContain('requestedStatus === "Delivered" && updatedItem.assignedDriverId');
  });

  it("res.json responds with updatedItem (the transaction's committed result), not the pre-read item", () => {
    expect(STATUS_ROUTE).toContain("res.json(buildShipmentViewForRole(updatedItem, req.session!));");
  });
});
