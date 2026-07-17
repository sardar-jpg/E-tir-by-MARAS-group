import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Driver Alliance Phase 1 — server wiring contracts. The pure decision
 * logic is behavior-tested in driverAlliance.test.ts; this file pins, at
 * the source level (no server-boot harness exists in this repo — same
 * approach as shipmentStatusRoute.test.ts), that server.ts actually
 * enforces those rules on the real routes: permissions, the
 * one-active-job lock and its race protection, USD-only validation,
 * notifications, audit logging, and reuse of the existing shipment
 * workflow.
 */
const SOURCE = readFileSync(join(__dirname, "..", "..", "server.ts"), "utf-8");

function region(startNeedle: string, length = 4000): string {
  const start = SOURCE.indexOf(startNeedle);
  expect(start, `expected to find "${startNeedle}" in server.ts`).toBeGreaterThan(-1);
  return SOURCE.slice(start, start + length);
}

describe("permissions — Super/Operations only, server-side", () => {
  it("create, broadcast, select-winner, and cancel are all behind requireFullAdmin (which 403s Accounts admins)", () => {
    for (const route of [
      'app.post("/api/alliance/offers", requireFullAdmin',
      'app.post("/api/alliance/offers/:id/broadcast", requireFullAdmin',
      'app.post("/api/alliance/offers/:id/select-winner", requireFullAdmin',
      'app.post("/api/alliance/offers/:id/cancel", requireFullAdmin',
    ]) {
      expect(SOURCE).toContain(route);
    }
  });

  it("offer reads are role-scoped: drivers get only their own sanitized views; only super/operation admins get the full lists; everyone else is rejected", () => {
    const list = region('app.get("/api/alliance/offers", requireAuth', 2500);
    expect(list).toContain('req.session!.role === "driver"');
    expect(list).toContain("buildDriverOfferView(offer, response)");
    expect(list).toContain('req.session!.adminType === "super" || req.session!.adminType === "operation"');
    expect(list).toContain("res.status(403)");

    const detail = region('app.get("/api/alliance/offers/:id", requireAuth', 2500);
    expect(detail).toContain("Drivers only see their own offers.");
    expect(detail).toContain("buildDriverOfferView(offer, respSnap.data() as AllianceOfferResponse)");
  });

  it("respond and viewed are driver-only", () => {
    expect(region('app.post("/api/alliance/offers/:id/respond"', 1200)).toContain('req.session!.role !== "driver"');
    expect(region('app.post("/api/alliance/offers/:id/viewed"', 1200)).toContain('req.session!.role !== "driver"');
  });

  it("working routes and the alliance Inactive switch are rejected for driver sessions on PUT /api/drivers/:id", () => {
    const route = region('app.put("/api/drivers/:id", requireAuth', 3000);
    expect(route).toContain('req.session!.role === "driver" && (workingRoutes !== undefined || allianceInactive !== undefined)');
    expect(route).toContain("managed by MARAS Operations");
    expect(route).toContain("sanitizeWorkingRoutes(workingRoutes)");
  });

  it("the driver's own 'Available for Offers' switch IS writable by a driver session (boolean-validated, own record only)", () => {
    const route = region('app.put("/api/drivers/:id", requireAuth', 6000);
    // Deliberately OUTSIDE the admin-only guard above.
    expect(route).toContain('typeof availableForOffers !== "boolean"');
    expect(route).toContain("updatedDriver.availableForOffers = availableForOffers;");
    // Own-record scoping is the route's first check.
    expect(route).toContain("You can only update your own profile.");
  });
});

describe("one-active-job rule — claim on every assignment path, release at the real terminal points", () => {
  it("the claim helper uses a real Firestore transaction on the per-driver lock document (the race-condition serialization point), with a documented synchronous memory fallback", () => {
    const claim = region("async function claimDriverActiveJob", 4200);
    expect(claim).toContain("db.runTransaction(async (tx: any) => {");
    expect(claim).toContain('db.collection("driverActiveJobs").doc(driverId)');
    expect(claim).toContain("throw new DriverBusyError(driverId)");
    // Real-shipments pre-check covers records that predate the lock.
    expect(claim).toContain("fetchBusyingShipmentsForDriver(driverId)");
  });

  it("all three assignment paths claim the lock: shipment creation, manual reassignment, and alliance winner selection", () => {
    expect(region("async function createShipmentRecord", 8000)).toContain("await claimDriverActiveJob(driver.id, id);");
    expect(region('app.put("/api/shipments/:id", requireFullAdmin', 40000)).toContain("await claimDriverActiveJob(newDriverId, req.params.id);");
    const winner = region('app.post("/api/alliance/offers/:id/select-winner"', 7000);
    expect(winner).toContain("await claimDriverActiveJob(driverId, refShipment.id);");
  });

  it("a busy driver yields 409 DRIVER_BUSY on every path — never a silent success", () => {
    expect((SOURCE.match(/err instanceof DriverBusyError/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(SOURCE).toContain('return res.status(409).json({ code: err.code, error: err.message });');
  });

  it("the lock is released at the freight-mode closing status and on decline (Assigned→New) — Delivered alone never frees the driver", () => {
    const statusRoute = region('app.put("/api/shipments/:id/status", requireAuth', 16000);
    expect(statusRoute).toContain('isShipmentClosed(requestedStatus, updatedItem.freightType) || requestedStatus === "New"');
    expect(statusRoute).toContain('name: "driver-active-job-release"');
  });

  it("the admin status-override correction releases the lock when it lands on the closing status", () => {
    const overrideRoute = region('app.put("/api/shipments/:id/status-override"', 12000);
    expect(overrideRoute).toContain("isShipmentClosed(requestedStatus, updatedItem.freightType)");
    expect(overrideRoute).toContain("releaseDriverActiveJob(updatedItem.assignedDriverId, updatedItem.id)");
  });

  it("a manual reassignment releases the OLD driver's lock only post-commit, and rolls back a claim when the write never committed", () => {
    const put = region('app.put("/api/shipments/:id", requireFullAdmin', 40000);
    expect(put).toContain('name: "driver-active-job-release-old"');
    expect(put).toContain("await releaseDriverActiveJob(newDriverId, req.params.id);");
  });
});

describe("broadcast matching — the server derives eligibility itself", () => {
  it("matching runs against ALL drivers and real shipments via the shared pure helpers (route + truck + availability), never a client-supplied list", () => {
    const broadcast = region('app.post("/api/alliance/offers/:id/broadcast"', 4000);
    expect(broadcast).toContain("computeBusyDriverIds(");
    expect(broadcast).toContain("matchDriversForOffer(drivers, offer, busyDriverIds)");
    expect(broadcast).toContain("canBroadcastOffer(offer.status)");
  });

  it("the quotation window opens at broadcast: expiresAt is stamped from the offer's chosen hours", () => {
    const broadcast = region('app.post("/api/alliance/offers/:id/broadcast"', 4000);
    expect(broadcast).toContain("computeOfferExpiresAt(nowIso, offer.expiresInHours || 24)");
  });
});

describe("expiration — no more quotations after the window closes", () => {
  it("respond rejects an expired offer with 409 OFFER_EXPIRED, server-side", () => {
    const respond = region('app.post("/api/alliance/offers/:id/respond"', 2000);
    expect(respond).toContain("isOfferExpired(offer)");
    expect(respond).toContain('"OFFER_EXPIRED"');
  });

  it("reads report the RESOLVED status (a past-expiry broadcast offer is served as expired) — derived at read time, no scheduler", () => {
    const list = region('app.get("/api/alliance/offers", requireAuth', 3500);
    expect(list).toContain("resolveOfferStatus(o)");
    const detail = region('app.get("/api/alliance/offers/:id", requireAuth', 2500);
    expect(detail).toContain("resolveOfferStatus(offer)");
  });

  it("the admin list carries per-offer Waiting/Quoted/Rejected counts from one grouped read", () => {
    const list = region('app.get("/api/alliance/offers", requireAuth', 3500);
    expect(list).toContain("summarizeResponses(responsesByOffer.get(o.id) || [])");
  });
});

describe("USD-only and answer validation — server-side", () => {
  it("offer creation validates through validateAllianceOfferInput (USD only, required fields)", () => {
    expect(region('app.post("/api/alliance/offers", requireFullAdmin', 2000)).toContain("validateAllianceOfferInput(req.body)");
  });

  it("quotes validate through validateQuotePriceUsd, and the response transaction blocks any second answer", () => {
    const respond = region('app.post("/api/alliance/offers/:id/respond"', 4500);
    expect(respond).toContain("validateQuotePriceUsd(req.body?.priceUsd, req.body?.currency)");
    expect(respond).toContain("canDriverRespondToOffer(offer.status)");
    expect(respond).toContain("submitAllianceResponseOnce(offer.id, driverId");
    const submitOnce = region("async function submitAllianceResponseOnce", 3000);
    expect(submitOnce).toContain("db.runTransaction(async (tx: any) => {");
    expect(submitOnce).toContain("canSubmitResponse(current.status)");
    expect(submitOnce).toContain("ALREADY_RESPONDED");
  });

  it("winner selection requires a quoted response and updates the offer to winner_selected", () => {
    const winner = region('app.post("/api/alliance/offers/:id/select-winner"', 7000);
    expect(winner).toContain("canSelectWinner(offer.status)");
    expect(winner).toContain('response.status !== "quoted"');
    expect(winner).toContain('status: "winner_selected"');
  });

  it("selecting the winner closes every other open quotation (status closed + the fixed courtesy message), never touching rejected answers", () => {
    const winner = region('app.post("/api/alliance/offers/:id/select-winner"', 7000);
    expect(winner).toContain('other.driverId === driverId || other.status === "rejected" || other.status === "closed"');
    expect(winner).toContain('status: "closed" as const');
    expect(winner).toContain("Another driver has been selected. Thank you for your quotation.");
    expect(winner).toContain("closedAt: nowIso");
    expect(winner).toContain("winnerShipmentNumber: shipmentNumber");
  });

  it("a rejection stores the driver's optional reason (bounded), and it reaches the admin notification", () => {
    const respond = region('app.post("/api/alliance/offers/:id/respond"', 4500);
    expect(respond).toContain('req.body?.rejectReason === "string" ? req.body.rejectReason.trim().slice(0, 500)');
    expect(respond).toContain("rejectReason,");
    expect(respond).toContain("Reason: ${rejectReason}");
  });
});

describe("notifications — existing infrastructure, every required event", () => {
  it("Offer Received goes to each invited driver via recipientUserId", () => {
    const broadcast = region('app.post("/api/alliance/offers/:id/broadcast"', 5000);
    expect(broadcast).toContain('"alliance_offer"');
    expect(broadcast).toContain("driver.id");
  });

  it("Price Submitted and Offer Rejected notify the admin side; Winner Selected and Offer Cancelled notify the driver(s)", () => {
    const respond = region('app.post("/api/alliance/offers/:id/respond"', 6000);
    expect(respond).toContain("Alliance Price Submitted");
    expect(respond).toContain("Alliance Offer Rejected");
    const winner = region('app.post("/api/alliance/offers/:id/select-winner"', 8000);
    expect(winner).toContain("You Won the Transport Offer");
    const cancel = region('app.post("/api/alliance/offers/:id/cancel"', 4000);
    expect(cancel).toContain("Transport Offer Cancelled");
  });
});

describe("audit log — every important action, with user/timestamp/offer/driver/shipment refs", () => {
  it("all seven audited actions are wired", () => {
    for (const action of [
      '"offer_created"',
      '"offer_broadcast"',
      '"offer_viewed"',
      '"price_submitted"',
      '"offer_rejected"',
      '"winner_selected"',
      '"offer_cancelled"',
    ]) {
      expect(SOURCE).toMatch(new RegExp(`logAllianceAudit\\(\\s*${action.replace(/"/g, '\\"')}`));
    }
  });

  it("winner selection records offerId + driverId + shipmentId", () => {
    expect(SOURCE).toContain('{ offerId: offer.id, driverId, shipmentId },');
  });

  it("audit entries live in their own collection with user and timestamp", () => {
    const audit = region("async function logAllianceAudit", 1500);
    expect(audit).toContain('"allianceAuditLogs"');
    expect(audit).toContain("userId: actor.userId");
    expect(audit).toContain("timestamp: new Date().toISOString()");
  });
});

describe("storage & workflow reuse", () => {
  it("every new collection has a memory-fallback entry (the PR #44 lesson)", () => {
    for (const col of ["allianceOffers: []", "allianceOfferResponses: []", "allianceAuditLogs: []", "driverActiveJobs: []"]) {
      expect(SOURCE).toContain(col);
    }
  });

  it("winner selection ALWAYS updates the linked Order — it never creates a shipment and never allocates a number (single MAR reference for the whole lifecycle)", () => {
    const winner = region('app.post("/api/alliance/offers/:id/select-winner"', 8000);
    expect(winner).toContain("applyNarrowShipmentUpdate(refShipment.id");
    expect(winner).not.toContain("createShipmentRecord(");
    expect(winner).not.toContain("allocateNextShipmentSequence");
    // Legacy offers without a linked Order can no longer produce a winner.
    expect(winner).toContain('"LEGACY_OFFER_UNLINKED"');
  });

  it("offer creation REQUIRES a linked, MAR-numbered, unassigned, open Order and derives every operational field from it", () => {
    const create = region('app.post("/api/alliance/offers", requireFullAdmin', 3500);
    expect(create).toContain("isValidMarReference(order.shipmentNumber)");
    expect(create).toContain("order.assignedDriverId");
    expect(create).toContain("isShipmentClosed(order.status, order.freightType)");
    expect(create).toContain("...buildOfferFromOrder(order)");
  });

  it("broadcast refuses to send with zero matched drivers", () => {
    const broadcast = region('app.post("/api/alliance/offers/:id/broadcast"', 4000);
    expect(broadcast).toContain('"NO_MATCHING_DRIVERS"');
  });

  it("driver chat posting is rejected server-side before job acceptance (the same isDriverChatAvailable rule the app uses)", () => {
    const chat = region('app.post("/api/shipments/:id/chat"', 4000);
    expect(chat).toContain("!isDriverChatAvailable(req.shipment.status)");
    expect(chat).toContain("Shipment chat becomes available after you accept the assigned job.");
  });

  it("POST /api/shipments itself now delegates to the same extracted creator (single source of creation logic)", () => {
    const post = region('app.post("/api/shipments", requireFullAdmin', 900);
    expect(post).toContain("await createShipmentRecord(req.body);");
  });

  it("closedAt marks the moment the non-winning quotations were closed (winner selection writes it)", () => {
    const types = readFileSync(join(__dirname, "..", "types.ts"), "utf-8");
    expect(types).toContain("closedAt?: string;");
    expect(region('app.post("/api/alliance/offers/:id/select-winner"', 7000)).toContain("closedAt: nowIso");
  });
});

/**
 * Order-status lifecycle (Driver Alliance order linking): the linked Order
 * moves New (Draft) → "Waiting for Driver Quotes" on broadcast, back to
 * "New" on cancel, and forward to "Assigned" on winner selection — always
 * the SAME record, same MAR reference. The waiting stage is alliance-
 * controlled: the manual status routes reject it (see
 * shipmentStatusTransitions.test.ts for the pure rules).
 */
describe("Order status lifecycle — Waiting for Driver Quotes", () => {
  it("broadcast stamps the linked Order 'New' → 'Waiting for Driver Quotes' (guarded, timeline entry, same record)", () => {
    const broadcast = region('app.post("/api/alliance/offers/:id/broadcast"', 6500);
    expect(broadcast).toContain('await applyNarrowShipmentUpdate(updatedOffer.referenceShipmentId');
    expect(broadcast).toContain('if (current.status !== "New" || current.assignedDriverId) return current;');
    expect(broadcast).toContain('status: "Waiting for Driver Quotes" as ShipmentStatus');
    expect(broadcast).toContain("Sürücü Teklifleri Bekleniyor");
    // Never creates anything: the broadcast region has no shipment creation.
    expect(broadcast).not.toContain("createShipmentRecord(");
  });

  it("cancel releases the linked Order back to 'New' (Draft) — only from the waiting stage and never once assigned", () => {
    const cancel = region('app.post("/api/alliance/offers/:id/cancel"', 6000);
    expect(cancel).toContain('if (current.status !== "Waiting for Driver Quotes" || current.assignedDriverId) return current;');
    expect(cancel).toContain('status: "New" as ShipmentStatus');
    expect(cancel).toContain("Quote Request Cancelled");
  });

  it("winner selection moves the Order forward to 'Assigned' from either pre-assignment stage", () => {
    const winner = region('app.post("/api/alliance/offers/:id/select-winner"', 7000);
    expect(winner).toContain('current.status === "New" || current.status === "Waiting for Driver Quotes" ? "Assigned" : current.status');
  });

  it("an Order already out for quotes cannot back a second parallel request", () => {
    const create = region('app.post("/api/alliance/offers", requireFullAdmin', 3800);
    expect(create).toContain('if (order.status === "Waiting for Driver Quotes")');
    expect(create).toContain("already has an open quote request");
  });
});
