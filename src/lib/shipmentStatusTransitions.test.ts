import { describe, it, expect } from "vitest";
import {
  LAND_STATUS_SEQUENCE,
  SEA_STATUS_SEQUENCE,
  AIR_STATUS_SEQUENCE,
  resolveFreightMode,
  getStatusSequenceForFreightMode,
  getClosingStatusForFreightMode,
  isShipmentClosed,
  getAllowedNextShipmentStatuses,
  getDriverSubmittableNextStatus,
  validateShipmentStatusTransition,
  isDriverAssignmentRejection,
  ShipmentStatusTransitionError,
  validateShipmentStatusOverride,
  ShipmentStatusOverrideError,
  parseStatusOverrideReason,
  MAX_STATUS_OVERRIDE_REASON_LENGTH,
  getShipmentStatusLabel,
  SHIPMENT_STATUS_LABELS,
  WAITING_FOR_DRIVER_QUOTES,
  normalizeStatusForSequence,
} from "./shipmentStatusTransitions";
import { applyNarrowShipmentUpdateMemory } from "./shipmentRevision";
import type { ShipmentStatus } from "../types";

/**
 * fix/shipment-update-concurrency (PR #111 review — forward-only status
 * transitions)
 *
 * PUT /api/shipments/:id/status used to accept any status string with no
 * ordering check at all. These tests cover the pure decision logic
 * directly; the real route wiring (server.ts) is pinned by a source-level
 * scan test — see shipmentStatusRoute.test.ts, same approach as every
 * other server.ts regression test in this repo (no Express harness).
 */

describe("resolveFreightMode", () => {
  it("recognizes 'sea' and 'air' explicitly", () => {
    expect(resolveFreightMode("sea")).toBe("sea");
    expect(resolveFreightMode("air")).toBe("air");
  });

  it("defaults to 'land' for 'land', undefined, null, or anything else", () => {
    expect(resolveFreightMode("land")).toBe("land");
    expect(resolveFreightMode(undefined)).toBe("land");
    expect(resolveFreightMode(null)).toBe("land");
    expect(resolveFreightMode("bogus")).toBe("land");
  });
});

describe("the three approved sequences", () => {
  it("Land: New -> Assigned -> Accepted -> Loading -> Loaded -> In Transit -> Border Crossing -> Customs Clearance -> Arrived -> Delivered -> Closed", () => {
    expect(LAND_STATUS_SEQUENCE).toEqual([
      "New", "Assigned", "Accepted", "Loading", "Loaded", "In Transit",
      "Border Crossing", "Customs Clearance", "Arrived", "Delivered", "Closed",
    ]);
  });

  it("Sea: Booking Confirmed -> Container Released -> Loaded on Vessel -> Vessel Departed -> In Transit -> Arrived at Port -> Customs Clearance -> Released -> Out for Delivery -> Delivered -> Completed", () => {
    expect(SEA_STATUS_SEQUENCE).toEqual([
      "Booking Confirmed", "Container Released", "Loaded on Vessel", "Vessel Departed",
      "In Transit", "Arrived at Port", "Customs Clearance", "Released",
      "Out for Delivery", "Delivered", "Completed",
    ]);
  });

  it("Air: Booking Confirmed -> Cargo Received -> Security Check Completed -> Departed Airport -> In Transit -> Arrived Airport -> Customs Clearance -> Released -> Out for Delivery -> Delivered -> Completed", () => {
    expect(AIR_STATUS_SEQUENCE).toEqual([
      "Booking Confirmed", "Cargo Received", "Security Check Completed", "Departed Airport",
      "In Transit", "Arrived Airport", "Customs Clearance", "Released",
      "Out for Delivery", "Delivered", "Completed",
    ]);
  });

  it("getStatusSequenceForFreightMode returns the matching sequence for each mode", () => {
    expect(getStatusSequenceForFreightMode("land")).toBe(LAND_STATUS_SEQUENCE);
    expect(getStatusSequenceForFreightMode("sea")).toBe(SEA_STATUS_SEQUENCE);
    expect(getStatusSequenceForFreightMode("air")).toBe(AIR_STATUS_SEQUENCE);
  });
});

describe("getClosingStatusForFreightMode / isShipmentClosed", () => {
  it("Land closes at 'Closed'", () => {
    expect(getClosingStatusForFreightMode("land")).toBe("Closed");
  });

  it("Sea and Air close at 'Completed', never 'Closed' (that status doesn't exist in their sequence)", () => {
    expect(getClosingStatusForFreightMode("sea")).toBe("Completed");
    expect(getClosingStatusForFreightMode("air")).toBe("Completed");
  });

  it("isShipmentClosed is true only for the freight-mode-appropriate closing status", () => {
    expect(isShipmentClosed("Closed", "land")).toBe(true);
    expect(isShipmentClosed("Delivered", "land")).toBe(false);
    expect(isShipmentClosed("Completed", "sea")).toBe(true);
    expect(isShipmentClosed("Delivered", "sea")).toBe(false);
    expect(isShipmentClosed("Completed", "air")).toBe(true);
    expect(isShipmentClosed("Closed", "sea")).toBe(false);
  });
});

describe("getAllowedNextShipmentStatuses", () => {
  it("Land: Loading's only allowed next status is Loaded", () => {
    expect(getAllowedNextShipmentStatuses("Loading", "land")).toEqual(["Loaded"]);
  });

  it("Sea: Container Released's only allowed next status is Loaded on Vessel", () => {
    expect(getAllowedNextShipmentStatuses("Container Released", "sea")).toEqual(["Loaded on Vessel"]);
  });

  it("Air: Security Check Completed's only allowed next status is Departed Airport", () => {
    expect(getAllowedNextShipmentStatuses("Security Check Completed", "air")).toEqual(["Departed Airport"]);
  });

  it("terminal statuses have no allowed next status", () => {
    expect(getAllowedNextShipmentStatuses("Closed", "land")).toEqual([]);
    expect(getAllowedNextShipmentStatuses("Completed", "sea")).toEqual([]);
    expect(getAllowedNextShipmentStatuses("Completed", "air")).toEqual([]);
  });

  it("a status that isn't part of this freight mode's sequence has no allowed next status", () => {
    expect(getAllowedNextShipmentStatuses("Booking Confirmed", "land")).toEqual([]);
  });
});

describe("getDriverSubmittableNextStatus", () => {
  it("at 'Arrived' (Land), a driver can still submit 'Delivered' — fixes the prior bug where 'Arrived' was treated as already finished, permanently blocking the driver from ever reaching Delivered", () => {
    expect(getDriverSubmittableNextStatus("Arrived", "land")).toBe("Delivered");
  });

  it("at 'Delivered' (Land), there is nothing left for a driver to submit — the only next step is the admin-only Closed transition", () => {
    expect(getDriverSubmittableNextStatus("Delivered", "land")).toBeNull();
  });

  it("at 'Closed' (terminal), there is nothing left to submit", () => {
    expect(getDriverSubmittableNextStatus("Closed", "land")).toBeNull();
  });

  it("mid-sequence statuses return their normal next status, same as getAllowedNextShipmentStatuses", () => {
    expect(getDriverSubmittableNextStatus("Loading", "land")).toBe("Loaded");
  });

  it("Sea/Air: at 'Delivered', nothing left to submit (next step is the admin-only Completed transition)", () => {
    expect(getDriverSubmittableNextStatus("Delivered", "sea")).toBeNull();
    expect(getDriverSubmittableNextStatus("Delivered", "air")).toBeNull();
  });
});

describe("validateShipmentStatusTransition — Land", () => {
  it("allows the immediately-following status (Loading example from the spec)", () => {
    const result = validateShipmentStatusTransition("Loading", "Loaded", "land");
    expect(result.ok).toBe(true);
    expect(result.allowedNextStatuses).toEqual(["Loaded"]);
  });

  it("rejects resubmitting the current status", () => {
    const result = validateShipmentStatusTransition("Loading", "Loading", "land");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("same-status");
  });

  it("rejects a backward transition", () => {
    const result = validateShipmentStatusTransition("Loading", "Accepted", "land");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("backward");
  });

  it("rejects skipping stages (the spec's own example: Loading -> In Transit is forbidden)", () => {
    const result = validateShipmentStatusTransition("Loading", "In Transit", "land");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("skipped-stage");
    expect(result.allowedNextStatuses).toEqual(["Loaded"]);
  });

  it("rejects a status belonging to another freight mode's workflow", () => {
    const result = validateShipmentStatusTransition("Loading", "Booking Confirmed", "land");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("wrong-freight-workflow");
  });

  it("rejects an unknown status string", () => {
    const result = validateShipmentStatusTransition("Loading", "Teleporting", "land");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unknown-status");
  });

  it("rejects any transition once the shipment is Closed (terminal)", () => {
    const result = validateShipmentStatusTransition("Closed", "Delivered", "land");
    expect(result.ok).toBe(false);
    expect(result.allowedNextStatuses).toEqual([]);
  });

  it("New -> Assigned -> Accepted -> Loading -> Loaded -> In Transit -> Border Crossing -> Customs Clearance -> Arrived -> Delivered -> Closed all succeed one step at a time", () => {
    for (let i = 0; i < LAND_STATUS_SEQUENCE.length - 1; i++) {
      const result = validateShipmentStatusTransition(LAND_STATUS_SEQUENCE[i], LAND_STATUS_SEQUENCE[i + 1], "land");
      expect(result.ok, `${LAND_STATUS_SEQUENCE[i]} -> ${LAND_STATUS_SEQUENCE[i + 1]}`).toBe(true);
    }
  });
});

describe("validateShipmentStatusTransition — Sea", () => {
  it("allows the immediately-following status", () => {
    const result = validateShipmentStatusTransition("Vessel Departed", "In Transit", "sea");
    expect(result.ok).toBe(true);
  });

  it("rejects same-status resubmission", () => {
    expect(validateShipmentStatusTransition("Released", "Released", "sea").reason).toBe("same-status");
  });

  it("rejects backward transitions", () => {
    expect(validateShipmentStatusTransition("Released", "Container Released", "sea").reason).toBe("backward");
  });

  it("rejects skipped stages", () => {
    const result = validateShipmentStatusTransition("Container Released", "Vessel Departed", "sea");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("skipped-stage");
  });

  it("rejects a Land-only or Air-only status", () => {
    expect(validateShipmentStatusTransition("Released", "Closed", "sea").reason).toBe("wrong-freight-workflow");
    expect(validateShipmentStatusTransition("Released", "Cargo Received", "sea").reason).toBe("wrong-freight-workflow");
  });

  it("rejects an unknown status", () => {
    expect(validateShipmentStatusTransition("Released", "Nonexistent", "sea").reason).toBe("unknown-status");
  });

  it("rejects any transition once Completed (terminal)", () => {
    const result = validateShipmentStatusTransition("Completed", "Delivered", "sea");
    expect(result.ok).toBe(false);
    expect(result.allowedNextStatuses).toEqual([]);
  });

  it("the full sequence succeeds one step at a time", () => {
    for (let i = 0; i < SEA_STATUS_SEQUENCE.length - 1; i++) {
      const result = validateShipmentStatusTransition(SEA_STATUS_SEQUENCE[i], SEA_STATUS_SEQUENCE[i + 1], "sea");
      expect(result.ok, `${SEA_STATUS_SEQUENCE[i]} -> ${SEA_STATUS_SEQUENCE[i + 1]}`).toBe(true);
    }
  });
});

describe("validateShipmentStatusTransition — Air", () => {
  it("allows the immediately-following status", () => {
    const result = validateShipmentStatusTransition("Departed Airport", "In Transit", "air");
    expect(result.ok).toBe(true);
  });

  it("rejects same-status resubmission", () => {
    expect(validateShipmentStatusTransition("Arrived Airport", "Arrived Airport", "air").reason).toBe("same-status");
  });

  it("rejects backward transitions", () => {
    expect(validateShipmentStatusTransition("Arrived Airport", "Departed Airport", "air").reason).toBe("backward");
  });

  it("rejects skipped stages", () => {
    const result = validateShipmentStatusTransition("Cargo Received", "Departed Airport", "air");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("skipped-stage");
  });

  it("rejects a Land-only or Sea-only status", () => {
    expect(validateShipmentStatusTransition("Arrived Airport", "Closed", "air").reason).toBe("wrong-freight-workflow");
    expect(validateShipmentStatusTransition("Arrived Airport", "Container Released", "air").reason).toBe("wrong-freight-workflow");
  });

  it("rejects an unknown status", () => {
    expect(validateShipmentStatusTransition("Arrived Airport", "Nonexistent", "air").reason).toBe("unknown-status");
  });

  it("rejects any transition once Completed (terminal)", () => {
    const result = validateShipmentStatusTransition("Completed", "Delivered", "air");
    expect(result.ok).toBe(false);
    expect(result.allowedNextStatuses).toEqual([]);
  });

  it("the full sequence succeeds one step at a time", () => {
    for (let i = 0; i < AIR_STATUS_SEQUENCE.length - 1; i++) {
      const result = validateShipmentStatusTransition(AIR_STATUS_SEQUENCE[i], AIR_STATUS_SEQUENCE[i + 1], "air");
      expect(result.ok, `${AIR_STATUS_SEQUENCE[i]} -> ${AIR_STATUS_SEQUENCE[i + 1]}`).toBe(true);
    }
  });
});

describe("isDriverAssignmentRejection — the one deliberate backward-transition exception", () => {
  it("recognizes Assigned -> New as the assignment-rejection correction", () => {
    expect(isDriverAssignmentRejection("Assigned", "New")).toBe(true);
  });

  it("does not recognize any other backward pair", () => {
    expect(isDriverAssignmentRejection("Accepted", "New")).toBe(false);
    expect(isDriverAssignmentRejection("Accepted", "Assigned")).toBe(false);
    expect(isDriverAssignmentRejection("Loading", "New")).toBe(false);
  });

  it("does not recognize it in the forward direction", () => {
    expect(isDriverAssignmentRejection("New", "Assigned")).toBe(false);
  });
});

describe("ShipmentStatusTransitionError", () => {
  it("carries the structured rejection shape", () => {
    const err = new ShipmentStatusTransitionError("Loading", "In Transit", ["Loaded"], "skipped-stage");
    expect(err.code).toBe("INVALID_SHIPMENT_STATUS_TRANSITION");
    expect(err.currentStatus).toBe("Loading");
    expect(err.requestedStatus).toBe("In Transit");
    expect(err.allowedNextStatuses).toEqual(["Loaded"]);
    expect(err.reason).toBe("skipped-stage");
    expect(err).toBeInstanceOf(Error);
  });

  it("has a safe, non-empty message even when there is no allowed next status (terminal)", () => {
    const err = new ShipmentStatusTransitionError("Closed", "Delivered", [], "backward");
    expect(err.message.length).toBeGreaterThan(0);
  });
});

/**
 * Concurrency-integration tests: exercising validateShipmentStatusTransition
 * exactly the way server.ts's status route will — inside the mutate
 * callback of applyNarrowShipmentUpdateMemory, so it always runs against
 * that call's own fresh `current`, never a stale pre-read. This is the
 * synchronous, no-`await`-between-read-and-write memory-fallback
 * equivalent of the real Firestore transaction (see
 * shipmentRevision.ts) — same reasoning already used for the broad-edit
 * lost-update tests in shipmentRevision.test.ts.
 */
type TestStatusShipment = {
  id: string;
  revision?: number;
  status: ShipmentStatus;
  freightType?: string;
  timeline: { status: ShipmentStatus }[];
};

function applyStatusTransition(
  shipments: TestStatusShipment[],
  shipmentId: string,
  requestedStatus: string
): TestStatusShipment {
  return applyNarrowShipmentUpdateMemory(shipments, shipmentId, (current) => {
    if (!isDriverAssignmentRejection(current.status, requestedStatus)) {
      const transition = validateShipmentStatusTransition(current.status, requestedStatus, current.freightType);
      if (!transition.ok) {
        throw new ShipmentStatusTransitionError(current.status, requestedStatus, transition.allowedNextStatuses, transition.reason!);
      }
    }
    return {
      ...current,
      status: requestedStatus as ShipmentStatus,
      timeline: [...current.timeline, { status: requestedStatus as ShipmentStatus }],
    };
  });
}

describe("Concurrency: transition validation always runs against the transaction's own current status", () => {
  it("two concurrent status requests: the first commits, the second is re-validated against the FIRST's committed status, not the original pre-request status", () => {
    const shipments: TestStatusShipment[] = [{ id: "s1", revision: 1, status: "Loading", freightType: "land", timeline: [] }];

    // Admin A and Admin B both read the shipment at "Loading" and both
    // attempt to advance it. A's request reaches the transaction first.
    const afterA = applyStatusTransition(shipments, "s1", "Loaded");
    expect(afterA.status).toBe("Loaded");

    // B's request is validated against the transaction's CURRENT status
    // ("Loaded", not the "Loading" B originally read) — "Loaded" is now a
    // same-status resubmission, correctly rejected rather than silently
    // accepted against stale data.
    expect(() => applyStatusTransition(shipments, "s1", "Loaded")).toThrow(ShipmentStatusTransitionError);
    expect(shipments[0].status).toBe("Loaded");
  });

  it("both accepted sequential transitions preserve both timeline events — neither is lost", () => {
    const shipments: TestStatusShipment[] = [{ id: "s1", revision: 1, status: "Loading", freightType: "land", timeline: [{ status: "Loading" }] }];
    applyStatusTransition(shipments, "s1", "Loaded");
    applyStatusTransition(shipments, "s1", "In Transit");
    expect(shipments[0].timeline.map((t) => t.status)).toEqual(["Loading", "Loaded", "In Transit"]);
    expect(shipments[0].revision).toBe(3);
  });

  it("two requests attempting the exact same next transition: exactly one succeeds, one gets an invalid-transition rejection", () => {
    const shipments: TestStatusShipment[] = [{ id: "s1", revision: 1, status: "Loading", freightType: "land", timeline: [] }];
    let successes = 0;
    let rejections = 0;

    for (let i = 0; i < 2; i++) {
      try {
        applyStatusTransition(shipments, "s1", "Loaded");
        successes++;
      } catch (err) {
        expect(err).toBeInstanceOf(ShipmentStatusTransitionError);
        rejections++;
      }
    }

    expect(successes).toBe(1);
    expect(rejections).toBe(1);
    expect(shipments[0].status).toBe("Loaded");
    expect(shipments[0].timeline.length).toBe(1);
  });

  it("an invalid transition never mutates the stored status, timeline, or revision", () => {
    const shipments: TestStatusShipment[] = [{ id: "s1", revision: 5, status: "Loading", freightType: "land", timeline: [{ status: "Loading" }] }];
    const before = JSON.parse(JSON.stringify(shipments[0]));
    expect(() => applyStatusTransition(shipments, "s1", "In Transit")).toThrow(ShipmentStatusTransitionError);
    expect(shipments[0]).toEqual(before);
  });

  it("the driver assignment-rejection exception still works inside the same mutate-time validation", () => {
    const shipments: TestStatusShipment[] = [{ id: "s1", revision: 1, status: "Assigned", freightType: "land", timeline: [] }];
    const result = applyStatusTransition(shipments, "s1", "New");
    expect(result.status).toBe("New");
  });
});

describe("validateShipmentStatusOverride — the Admin Status Override correction workflow", () => {
  it("allows a backward correction within the shipment's own freight workflow", () => {
    const result = validateShipmentStatusOverride("Loading", "Accepted", "land");
    expect(result.ok).toBe(true);
  });

  it("allows a forward correction too — override is not restricted to backward moves", () => {
    const result = validateShipmentStatusOverride("Loading", "In Transit", "land");
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown status", () => {
    const result = validateShipmentStatusOverride("Loading", "Nonexistent", "land");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unknown-status");
  });

  it("rejects a status belonging to another freight mode's workflow (Land -> Sea-only status)", () => {
    const result = validateShipmentStatusOverride("Loading", "Booking Confirmed", "land");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("wrong-freight-workflow");
  });

  it("rejects a Sea shipment corrected to a Land-only status", () => {
    const result = validateShipmentStatusOverride("Released", "Closed", "sea");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("wrong-freight-workflow");
  });

  it("rejects an Air shipment corrected to a Sea-only status", () => {
    const result = validateShipmentStatusOverride("Cargo Received", "Container Released", "air");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("wrong-freight-workflow");
  });

  it("rejects any correction once the shipment is already terminal (Land Closed) — no reopening", () => {
    const result = validateShipmentStatusOverride("Closed", "Delivered", "land");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("terminal-locked");
  });

  it("rejects any correction once the shipment is already terminal (Sea/Air Completed) — no reopening", () => {
    expect(validateShipmentStatusOverride("Completed", "Delivered", "sea").reason).toBe("terminal-locked");
    expect(validateShipmentStatusOverride("Completed", "Delivered", "air").reason).toBe("terminal-locked");
  });

  it("terminal-lock is checked before status validity — even a nonsense requestedStatus is reported as terminal-locked, not unknown-status, once already terminal", () => {
    const result = validateShipmentStatusOverride("Closed", "Nonexistent", "land");
    expect(result.reason).toBe("terminal-locked");
  });
});

describe("ShipmentStatusOverrideError", () => {
  it("carries the structured rejection shape", () => {
    const err = new ShipmentStatusOverrideError("Loading", "Booking Confirmed", "wrong-freight-workflow");
    expect(err.code).toBe("INVALID_SHIPMENT_STATUS_OVERRIDE");
    expect(err.currentStatus).toBe("Loading");
    expect(err.requestedStatus).toBe("Booking Confirmed");
    expect(err.reason).toBe("wrong-freight-workflow");
    expect(err).toBeInstanceOf(Error);
  });

  it("gives a distinct, clear message for a terminal-locked rejection", () => {
    const err = new ShipmentStatusOverrideError("Closed", "Delivered", "terminal-locked");
    expect(err.message).toContain("cannot be reopened");
  });
});

describe("parseStatusOverrideReason — required correction reason validation", () => {
  it("accepts and trims a normal reason", () => {
    expect(parseStatusOverrideReason("  Driver marked wrong milestone by mistake  ")).toBe("Driver marked wrong milestone by mistake");
  });

  it("rejects an empty string", () => {
    expect(parseStatusOverrideReason("")).toBeNull();
  });

  it("rejects a whitespace-only string", () => {
    expect(parseStatusOverrideReason("   ")).toBeNull();
  });

  it("rejects missing/non-string values", () => {
    expect(parseStatusOverrideReason(undefined)).toBeNull();
    expect(parseStatusOverrideReason(null)).toBeNull();
    expect(parseStatusOverrideReason(42)).toBeNull();
    expect(parseStatusOverrideReason({})).toBeNull();
  });

  it("rejects a reason longer than the maximum length", () => {
    const tooLong = "a".repeat(MAX_STATUS_OVERRIDE_REASON_LENGTH + 1);
    expect(parseStatusOverrideReason(tooLong)).toBeNull();
  });

  it("accepts a reason exactly at the maximum length", () => {
    const atLimit = "a".repeat(MAX_STATUS_OVERRIDE_REASON_LENGTH);
    expect(parseStatusOverrideReason(atLimit)).toBe(atLimit);
  });
});

describe("getShipmentStatusLabel / SHIPMENT_STATUS_LABELS", () => {
  it("has an entry for every status in every freight mode's sequence", () => {
    for (const status of [...LAND_STATUS_SEQUENCE, ...SEA_STATUS_SEQUENCE, ...AIR_STATUS_SEQUENCE]) {
      expect(SHIPMENT_STATUS_LABELS[status], status).toBeDefined();
    }
  });

  it("returns the matching label for a known status", () => {
    expect(getShipmentStatusLabel("Delivered")).toEqual({ en: "Shipment Delivered", tr: "Teslim Edildi", ar: "تم التسليم" });
  });

  it("falls back to the 'In Transit' label for an unknown status", () => {
    expect(getShipmentStatusLabel("Nonexistent")).toEqual(SHIPMENT_STATUS_LABELS['In Transit']);
  });
});

/**
 * Driver Alliance order-linking lifecycle: "Waiting for Driver Quotes" is
 * the alliance-controlled stage between "New" (Draft) and "Assigned"
 * (Driver Selected). It lives OUTSIDE the manual sequences: the alliance
 * broadcast/cancel/winner endpoints are the only writers, and for every
 * sequence-position decision it counts as "New".
 */
describe("'Waiting for Driver Quotes' — alliance-controlled stage", () => {
  it("occupies the same sequence position as 'New' (Draft) and is not part of any manual sequence", () => {
    expect(normalizeStatusForSequence(WAITING_FOR_DRIVER_QUOTES)).toBe("New");
    expect(normalizeStatusForSequence("Loading")).toBe("Loading");
    expect(LAND_STATUS_SEQUENCE).not.toContain(WAITING_FOR_DRIVER_QUOTES);
    expect(SEA_STATUS_SEQUENCE).not.toContain(WAITING_FOR_DRIVER_QUOTES);
    expect(AIR_STATUS_SEQUENCE).not.toContain(WAITING_FOR_DRIVER_QUOTES);
  });

  it("a waiting Order's next manual status is 'Assigned' — the lifecycle continues exactly where 'New' would", () => {
    expect(getAllowedNextShipmentStatuses(WAITING_FOR_DRIVER_QUOTES, "road")).toEqual(["Assigned"]);
    expect(validateShipmentStatusTransition(WAITING_FOR_DRIVER_QUOTES, "Assigned", "road").ok).toBe(true);
  });

  it("can never be REQUESTED through the manual status route — it is set only by the alliance broadcast", () => {
    const result = validateShipmentStatusTransition("New", WAITING_FOR_DRIVER_QUOTES, "road");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("alliance-controlled");
  });

  it("can never be set through the Admin Status Override either — but correcting OUT of it back to 'New' works", () => {
    const into = validateShipmentStatusOverride("New", WAITING_FOR_DRIVER_QUOTES, "road");
    expect(into.ok).toBe(false);
    expect(into.reason).toBe("alliance-controlled");
    expect(new ShipmentStatusOverrideError("New", WAITING_FOR_DRIVER_QUOTES, "alliance-controlled").message).toContain("Driver Alliance");
    // Escape hatch: an authorized admin can correct a stuck waiting Order back to Draft.
    expect(validateShipmentStatusOverride(WAITING_FOR_DRIVER_QUOTES, "New", "road").ok).toBe(true);
  });

  it("is not a closed status, has a translated label, and counts as pre-transit like 'New'", () => {
    expect(isShipmentClosed(WAITING_FOR_DRIVER_QUOTES, "road")).toBe(false);
    expect(SHIPMENT_STATUS_LABELS[WAITING_FOR_DRIVER_QUOTES]).toEqual({
      en: "Waiting for Driver Quotes",
      tr: "Sürücü Teklifleri Bekleniyor",
      ar: "بانتظار عروض أسعار السائقين",
    });
    // The next lifecycle stage is 'Assigned' — reached via winner
    // selection (no driver is assigned during sourcing, so no driver can
    // ever actually submit it).
    expect(getDriverSubmittableNextStatus(WAITING_FOR_DRIVER_QUOTES, "road")).toBe("Assigned");
  });
});
