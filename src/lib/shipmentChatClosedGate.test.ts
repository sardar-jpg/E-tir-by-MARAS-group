import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * fix/shipment-update-concurrency (PR #111 review — Delivered/Closed
 * terminal & chat rules)
 *
 * POST /api/shipments/:id/chat is the single route every chat surface
 * (Admin, Driver, Customer/Client, and the chat-attachment-as-document
 * branch inside it) sends through — so it's the one enforcement point for
 * "Closed (Land) / Completed (Sea/Air) makes shipment chat read-only,
 * Delivered does not." This scans the real shipped server.ts source (no
 * Express harness in this repo — see shipmentUpdateRoute.test.ts for the
 * same approach) to pin: the gate exists, checks the freight-mode-aware
 * closing status (not Delivered, not any 'finished'-looking status), 409s
 * with the structured SHIPMENT_CHAT_CLOSED shape, and runs before any
 * message, unread record, or document is created — so a rejected send
 * can't have already produced a notification or audit trail.
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

const CHAT_ROUTE = extractBetween(
  'app.post("/api/shipments/:id/chat", requireShipmentAccess, async (req, res) => {',
  "// 8. Upload Document Directly",
);

describe("sanity: the chat route block was found and is non-trivial", () => {
  it("route", () => {
    expect(CHAT_ROUTE.length).toBeGreaterThan(500);
  });
});

describe("SHIPMENT_CHAT_CLOSED gate", () => {
  it("checks isShipmentClosed(shipmentItem.status, shipmentItem.freightType) — the freight-mode-aware closing status, not a hardcoded 'Closed' or any 'finished' status list", () => {
    expect(CHAT_ROUTE).toContain("isShipmentClosed(shipmentItem.status, shipmentItem.freightType)");
    expect(CHAT_ROUTE).not.toMatch(/shipmentItem\.status === ['"]Delivered['"]/);
  });

  it("responds 409 with the structured SHIPMENT_CHAT_CLOSED shape", () => {
    const gateIndex = CHAT_ROUTE.indexOf("isShipmentClosed(shipmentItem.status, shipmentItem.freightType)");
    const responseIndex = CHAT_ROUTE.indexOf("res.status(409)", gateIndex);
    expect(responseIndex).toBeGreaterThan(gateIndex);
    const responseBlock = CHAT_ROUTE.slice(responseIndex, CHAT_ROUTE.indexOf("}", CHAT_ROUTE.indexOf("shipmentStatus:", responseIndex)) + 1);
    expect(responseBlock).toContain('code: "SHIPMENT_CHAT_CLOSED"');
    expect(responseBlock).toContain("shipmentStatus: shipmentItem.status");
  });

  it("runs before the message object, the unread-fanout plan, and the chat-attachment document append are ever built", () => {
    const gateIndex = CHAT_ROUTE.indexOf("isShipmentClosed(shipmentItem.status, shipmentItem.freightType)");
    const messageIndex = CHAT_ROUTE.indexOf("const newMessage: ChatMessage = {");
    const fanoutIndex = CHAT_ROUTE.indexOf("planUnreadFanout(");
    const commitIndex = CHAT_ROUTE.indexOf("commitChatMessageWithUnreadFanout(");
    const docAppendIndex = CHAT_ROUTE.indexOf("applyIsolatedShipmentUpdate(shipmentId");
    expect(gateIndex).toBeGreaterThan(-1);
    expect(messageIndex).toBeGreaterThan(gateIndex);
    expect(fanoutIndex).toBeGreaterThan(gateIndex);
    expect(commitIndex).toBeGreaterThan(gateIndex);
    expect(docAppendIndex).toBeGreaterThan(gateIndex);
  });

  it("runs after the shipment is confirmed to exist (the gate reads shipmentItem.status, which requires the 404 check to have already passed)", () => {
    const notFoundIndex = CHAT_ROUTE.indexOf('res.status(404).json({ error: "Shipment not found" });');
    const gateIndex = CHAT_ROUTE.indexOf("isShipmentClosed(shipmentItem.status, shipmentItem.freightType)");
    expect(notFoundIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeGreaterThan(notFoundIndex);
  });
});
