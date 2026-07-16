import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * fix/shipment-update-concurrency (PR #111 review — Admin Status Override
 * authorization correction)
 *
 * PUT /api/shipments/:id/status-override is the new, dedicated,
 * "clearly identified" admin correction workflow (requirement 6) that
 * replaced the broad edit route's old free-form `data.status` field (see
 * shipmentUpdateRoute.test.ts for the removal). This scans the real
 * shipped server.ts source (no Express harness in this repo — same
 * approach as every other server.ts regression test here) to pin: the
 * dedicated canManageShipmentStatus authorization gate (never the
 * read-only canViewShipmentRegistry), the required correction reason, the
 * freight-workflow/terminal-lock validation running inside the
 * transaction against transaction-fresh `current`, the structured 409
 * rejection shape, the "administrative correction" audit-log wording, and
 * that the reason text never reaches the customer/public-visible timeline.
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

const OVERRIDE_ROUTE = extractBetween(
  'app.put("/api/shipments/:id/status-override", requireAuth, async (req, res) => {',
  "// 5b. Subscribe Customer",
);

describe("sanity: the status-override route block was found and is non-trivial", () => {
  it("route", () => {
    expect(OVERRIDE_ROUTE.length).toBeGreaterThan(500);
  });
});

describe("authorization: only canManageShipmentStatus (Super Admin / Operations Admin), never the read-only canViewShipmentRegistry", () => {
  it("checks canManageShipmentStatus(req.session) and rejects with 403 otherwise", () => {
    expect(OVERRIDE_ROUTE).toContain("if (!canManageShipmentStatus(req.session)) {");
    const gateIndex = OVERRIDE_ROUTE.indexOf("if (!canManageShipmentStatus(req.session)) {");
    const rejectIndex = OVERRIDE_ROUTE.indexOf("res.status(403)", gateIndex);
    expect(rejectIndex).toBeGreaterThan(gateIndex);
  });

  it("never calls canViewShipmentRegistry as an actual authorization check in this route", () => {
    expect(OVERRIDE_ROUTE).not.toContain("canViewShipmentRegistry(");
  });

  it("the authorization check runs before the shipment is even fetched — no data leaks to an unauthorized caller", () => {
    const gateIndex = OVERRIDE_ROUTE.indexOf("if (!canManageShipmentStatus(req.session)) {");
    const fetchIndex = OVERRIDE_ROUTE.indexOf("await getDoc(sDocRef)");
    expect(gateIndex).toBeGreaterThan(-1);
    expect(fetchIndex).toBeGreaterThan(gateIndex);
  });
});

describe("required correction reason", () => {
  it("validates correctionReason via parseStatusOverrideReason and rejects with 400 when missing/invalid", () => {
    expect(OVERRIDE_ROUTE).toContain("const reason = parseStatusOverrideReason(correctionReason);");
    const reasonIndex = OVERRIDE_ROUTE.indexOf("const reason = parseStatusOverrideReason(correctionReason);");
    const rejectIndex = OVERRIDE_ROUTE.indexOf("res.status(400)", reasonIndex);
    expect(rejectIndex).toBeGreaterThan(reasonIndex);
  });

  it("the reason check runs before the authorization check's own early return only in terms of input validation, but reason is still required regardless of role", () => {
    expect(OVERRIDE_ROUTE).toContain("if (!reason) {");
  });
});

describe("forward-agnostic correction validated inside the transaction, against transaction-fresh `current`", () => {
  it("validateShipmentStatusOverride is called with current.status/current.freightType, never a pre-read snapshot", () => {
    expect(OVERRIDE_ROUTE).toContain("validateShipmentStatusOverride(current.status, requestedStatus, current.freightType)");
  });

  it("an invalid correction throws ShipmentStatusOverrideError with the reason from the check — never silently applies", () => {
    expect(OVERRIDE_ROUTE).toContain("throw new ShipmentStatusOverrideError(current.status, requestedStatus, validation.reason!);");
  });

  it("appends exactly one timeline event and uses current.timeline (transaction-fresh), never a stale pre-transaction array", () => {
    const callbackStart = OVERRIDE_ROUTE.indexOf("await applyNarrowShipmentUpdate(shipmentId, (current) => {");
    const callbackEnd = OVERRIDE_ROUTE.indexOf("});", callbackStart);
    const callback = OVERRIDE_ROUTE.slice(callbackStart, callbackEnd);
    expect(callback).toContain("...current.timeline,");
    // Exactly one pushed/appended timeline object literal in this callback.
    const timelineEntryCount = (callback.match(/timestamp: nowIso,/g) || []).length;
    expect(timelineEntryCount).toBe(1);
  });
});

describe("structured 409 rejection shape (INVALID_SHIPMENT_STATUS_OVERRIDE)", () => {
  it("catches ShipmentStatusOverrideError and responds 409 with the full structured shape", () => {
    const catchIndex = OVERRIDE_ROUTE.indexOf("if (err instanceof ShipmentStatusOverrideError)");
    expect(catchIndex).toBeGreaterThan(-1);
    const responseIndex = OVERRIDE_ROUTE.indexOf("res.status(409)", catchIndex);
    expect(responseIndex).toBeGreaterThan(catchIndex);
    const responseBlock = OVERRIDE_ROUTE.slice(responseIndex, OVERRIDE_ROUTE.indexOf("}", OVERRIDE_ROUTE.indexOf("reason: err.reason", responseIndex)) + 1);
    expect(responseBlock).toContain("code: err.code");
    expect(responseBlock).toContain("currentStatus: err.currentStatus");
    expect(responseBlock).toContain("requestedStatus: err.requestedStatus");
    expect(responseBlock).toContain("reason: err.reason");
  });

  it("a genuine transaction/infrastructure failure (not a rejection) is rethrown, not swallowed", () => {
    const catchIndex = OVERRIDE_ROUTE.indexOf("if (err instanceof ShipmentStatusOverrideError)");
    const afterBranch = OVERRIDE_ROUTE.slice(catchIndex);
    expect(afterBranch).toContain("throw err;");
  });
});

describe("audit entry: clearly labeled administrative correction, reason recorded only in the internal audit log", () => {
  it("logActivity is called with an ADMINISTRATIVE CORRECTION label, previous status, new status, shipmentNumber, and the reason", () => {
    const auditIndex = OVERRIDE_ROUTE.indexOf("run: () => logActivity(");
    expect(auditIndex).toBeGreaterThan(-1);
    const auditBlock = OVERRIDE_ROUTE.slice(auditIndex, OVERRIDE_ROUTE.indexOf("),", auditIndex));
    expect(auditBlock).toContain("ADMINISTRATIVE CORRECTION");
    expect(auditBlock).toContain("updatedItem.shipmentNumber");
    expect(auditBlock).toContain("capturedPreviousStatus");
    expect(auditBlock).toContain("requestedStatus");
    expect(auditBlock).toContain("Reason: ${reason}");
  });

  it("the timeline event's detail text never includes the raw correction reason (timeline is visible to driver/client/public share view)", () => {
    const callbackStart = OVERRIDE_ROUTE.indexOf("await applyNarrowShipmentUpdate(shipmentId, (current) => {");
    const callbackEnd = OVERRIDE_ROUTE.indexOf("});", callbackStart);
    const callback = OVERRIDE_ROUTE.slice(callbackStart, callbackEnd);
    expect(callback).not.toContain("${reason}");
    expect(callback).toContain("administrative review");
  });

  it("the audit log runs strictly post-commit, via runShipmentUpdateSideEffects", () => {
    const commitIndex = OVERRIDE_ROUTE.indexOf("await applyNarrowShipmentUpdate(shipmentId");
    const sideEffectIndex = OVERRIDE_ROUTE.indexOf("await runShipmentUpdateSideEffects([", commitIndex);
    expect(sideEffectIndex).toBeGreaterThan(commitIndex);
  });
});

describe("terminal-reopen lock — no reopening in this PR", () => {
  it("validateShipmentStatusOverride (which checks isShipmentClosed(currentStatus, ...) first) is the only gate — no separate bypass exists in this route", () => {
    expect(OVERRIDE_ROUTE).toContain("validateShipmentStatusOverride(current.status, requestedStatus, current.freightType)");
    // No second, looser status-writing path in this same route.
    expect((OVERRIDE_ROUTE.match(/applyNarrowShipmentUpdate\(/g) || []).length).toBe(1);
  });
});
