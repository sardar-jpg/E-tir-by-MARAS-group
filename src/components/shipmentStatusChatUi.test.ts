import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * fix/shipment-update-concurrency (PR #111 review — forward-only status
 * transitions + Delivered/Closed terminal & chat rules)
 *
 * None of these components have a render-test harness (this project's
 * vitest setup has no jsdom/testing-library — see AdminPanel.test.ts /
 * LoginPage.test.ts for the same situation and the same source-scan
 * approach used here). This pins, at the source level, across every
 * surface the review named:
 *   - the status-update UI shows only the allowed next status
 *     (getAllowedNextShipmentStatuses / getDriverSubmittableNextStatus),
 *     never a free-form list a user could pick a skipped/backward status
 *     from
 *   - chat locks only at the freight-mode-appropriate closing status
 *     (isShipmentClosed) — never at "Delivered"
 *   - INVALID_SHIPMENT_STATUS_TRANSITION / SHIPMENT_CHAT_CLOSED responses
 *     are handled by refreshing local state, never by silently retrying
 */

function read(relPath: string): string {
  return readFileSync(join(__dirname, relPath), "utf-8");
}

describe("DriverApplication.tsx", () => {
  const SOURCE = read("DriverApplication.tsx");

  it("computes the chat lock from isShipmentClosed, not a hardcoded Delivered/Arrived/Closed/Completed list", () => {
    expect(SOURCE).toContain("const isShipmentChatClosed = activeShipment ? isShipmentClosed(activeShipment.status, activeShipment.freightType) : false;");
  });

  // feature/driver-app-comprehensive-redesign: the status-update control
  // moved from an inline form into DriverNextAction.tsx (a single primary
  // button for the one legal next status). These pins moved with it — the
  // protections themselves are unchanged.
  it("the driver status control (DriverNextAction) derives its one action from getDriverNextAction and renders a locked/completed state when there is none", () => {
    const NEXT_ACTION = read("driver/DriverNextAction.tsx");
    expect(NEXT_ACTION).toContain("const action = getDriverNextAction(shipment.status, shipment.freightType);");
    expect(NEXT_ACTION).toContain("if (!action) {");
  });

  it("the driver status control offers a single forward action — never a select/dropdown a driver could pick a skipped/backward/closing status from", () => {
    const NEXT_ACTION = read("driver/DriverNextAction.tsx");
    expect(NEXT_ACTION).not.toContain("<select");
    expect(NEXT_ACTION).not.toContain("<option");
    // getDriverNextAction is itself backed by getDriverSubmittableNextStatus
    // (driverJobFlow.ts) — pinned there by driverJobFlow.test.ts.
  });

  it("handleSubmitNextStatus submits the freshly-derived next status (not a possibly-stale piece of state) and refreshes on a 409 rejection without auto-retrying", () => {
    const fnStart = SOURCE.indexOf("const handleSubmitNextStatus = async (shipment: Shipment) => {");
    expect(fnStart).toBeGreaterThan(-1);
    const fnRegion = SOURCE.slice(fnStart, fnStart + 2400);
    expect(fnRegion).toContain("getDriverSubmittableNextStatus(shipment.status, shipment.freightType)");
    expect(fnRegion).toContain('status: nextStatus,');
    expect(fnRegion).toContain('body?.code === "INVALID_SHIPMENT_STATUS_TRANSITION"');
    expect(fnRegion).toContain("fetchData();");
  });

  it("handleSendMessage and sendDriverFileMessage handle SHIPMENT_CHAT_CLOSED without queuing a retry", () => {
    const textSendStart = SOURCE.indexOf("const handleSendMessage = async (e: React.FormEvent) => {");
    const textSendRegion = SOURCE.slice(textSendStart, textSendStart + 1600);
    expect(textSendRegion).toContain('body?.code === "SHIPMENT_CHAT_CLOSED"');

    const fileSendStart = SOURCE.indexOf("const sendDriverFileMessage = async (");
    const fileSendRegion = SOURCE.slice(fileSendStart, fileSendStart + 1600);
    expect(fileSendRegion).toContain('body?.code === "SHIPMENT_CHAT_CLOSED"');
    // On a closed rejection, the attachment must NOT be queued as a
    // retryable pending attachment (that would let the driver keep
    // re-attempting a send that can never succeed).
    const closedBranchStart = fileSendRegion.indexOf('body?.code === "SHIPMENT_CHAT_CLOSED"');
    const closedBranchEnd = fileSendRegion.indexOf("} else {", closedBranchStart);
    const closedBranch = fileSendRegion.slice(closedBranchStart, closedBranchEnd);
    expect(closedBranch).not.toContain("setPendingDriverAttachment({");
  });

  it("imports isShipmentClosed and getDriverSubmittableNextStatus from the shared shipmentStatusTransitions module", () => {
    expect(SOURCE).toContain('from "../lib/shipmentStatusTransitions"');
  });
});

describe("AdminPanel.tsx — Manual Status Milestone panel", () => {
  const SOURCE = read("AdminPanel.tsx");

  it("handleManualStatusUpdate derives the next status from getAllowedNextShipmentStatuses and refreshes on a 409 rejection", () => {
    const fnStart = SOURCE.indexOf("const handleManualStatusUpdate = async () => {");
    expect(fnStart).toBeGreaterThan(-1);
    const fnRegion = SOURCE.slice(fnStart, fnStart + 1800);
    expect(fnRegion).toContain("const [nextStatus] = getAllowedNextShipmentStatuses(targetDetailsShipment.status, targetDetailsShipment.freightType);");
    expect(fnRegion).toContain("if (!nextStatus) return;");
    expect(fnRegion).toContain('status: nextStatus,');
    expect(fnRegion).toContain('body?.code === "INVALID_SHIPMENT_STATUS_TRANSITION"');
  });

  it("the milestone dropdown shows only the single computed next status, disabled, never the old hardcoded per-freight-type list bound to free editing", () => {
    const panelIndex = SOURCE.indexOf("Select Updated Transit Status");
    expect(panelIndex).toBeGreaterThan(-1);
    const panelRegion = SOURCE.slice(panelIndex, panelIndex + 900);
    expect(panelRegion).toContain("nextTransitStatus ? (");
    expect(panelRegion).toContain("disabled");
    expect(panelRegion).not.toContain(".map((st)");
  });

  it("the Status Override in the broad edit form is explicitly documented as a separate, clearly-labeled administrative-correction workflow, distinct from the normal progression control", () => {
    const overrideIndex = SOURCE.indexOf("Admin Status Correction/Override — PR #111 review");
    expect(overrideIndex).toBeGreaterThan(-1);
    const overrideRegion = SOURCE.slice(overrideIndex, overrideIndex + 900);
    expect(overrideRegion).toContain("intentionally exempt from the forward-only sequence");
    expect(overrideRegion).toContain("canManageShipmentStatus");
  });
});

describe("AdminPanel.tsx — Admin Status Override widget", () => {
  const SOURCE = read("AdminPanel.tsx");

  it("handleStatusOverride submits to the dedicated status-override endpoint with a required correctionReason, never the normal /status endpoint", () => {
    const fnStart = SOURCE.indexOf("const handleStatusOverride = async () => {");
    expect(fnStart).toBeGreaterThan(-1);
    const fnRegion = SOURCE.slice(fnStart, fnStart + 1400);
    expect(fnRegion).toContain("/status-override`");
    expect(fnRegion).toContain("if (!reason) {");
    expect(fnRegion).toContain("correctionReason: reason,");
  });

  it("the widget is hidden (replaced by a locked message) once the shipment is already Closed/Completed — no terminal reopening in this PR", () => {
    const widgetIndex = SOURCE.indexOf("Admin Status Correction/Override — PR #111 review");
    const widgetRegion = SOURCE.slice(widgetIndex, widgetIndex + 3600);
    expect(widgetRegion).toContain("isShipmentClosed(editingShipment.status, editingShipment.freightType) ? (");
    expect(widgetRegion).toContain("is locked");
  });

  it("the override status dropdown offers every status in the shipment's own freight-mode sequence, not just the next one", () => {
    const widgetIndex = SOURCE.indexOf("Admin Status Correction/Override — PR #111 review");
    const widgetRegion = SOURCE.slice(widgetIndex, widgetIndex + 3600);
    expect(widgetRegion).toContain("getStatusSequenceForFreightMode(resolveFreightMode(editingShipment.freightType)).map(st =>");
  });

  it("the submit button is disabled without a non-empty reason", () => {
    const widgetIndex = SOURCE.indexOf("Admin Status Correction/Override — PR #111 review");
    const widgetRegion = SOURCE.slice(widgetIndex, widgetIndex + 3600);
    expect(widgetRegion).toContain("disabled={isSubmittingOverride || !overrideReason.trim() || !overrideTargetStatus}");
  });

  it("the override target/reason reset whenever a different shipment's edit form opens", () => {
    expect(SOURCE).toContain("}, [editingShipment?.id]);");
    const effectIndex = SOURCE.indexOf("setOverrideTargetStatus(editingShipment?.status ?? null);");
    expect(effectIndex).toBeGreaterThan(-1);
  });
});

describe("App.tsx — Admin chat drawer", () => {
  const SOURCE = read("../App.tsx");

  it("computes the chat lock from isShipmentClosed, not any hardcoded status list", () => {
    expect(SOURCE).toContain("const isChatShipmentClosed = chatShipment ? isShipmentClosed(chatShipment.status, chatShipment.freightType) : false;");
  });

  it("the composer is replaced by a read-only banner when closed, and the Send button passes isLocked through to canSubmitChatMessage", () => {
    expect(SOURCE).toContain("{isChatShipmentClosed ? (");
    expect(SOURCE).toContain("This shipment is closed. Chat is now read-only.");
    expect(SOURCE).toContain("isLocked: isChatShipmentClosed");
  });

  it("handleSendAdminMessage and handleSendAdminAttachment both handle SHIPMENT_CHAT_CLOSED by syncing local status, never by silently retrying", () => {
    const msgStart = SOURCE.indexOf("const handleSendAdminMessage = async (e: React.FormEvent) => {");
    const msgRegion = SOURCE.slice(msgStart, msgStart + 2200);
    expect(msgRegion).toContain('body?.code === "SHIPMENT_CHAT_CLOSED"');
    expect(msgRegion).toContain("setChatShipment((prev) => (prev ? { ...prev, status: body.shipmentStatus } : prev));");

    const attachStart = SOURCE.indexOf("const handleSendAdminAttachment = async () => {");
    const attachSendIndex = SOURCE.indexOf("fileUrl: finalFileUrl || \"#\",", attachStart);
    expect(attachSendIndex).toBeGreaterThan(attachStart);
    const attachRegion = SOURCE.slice(attachSendIndex, attachSendIndex + 1500);
    expect(attachRegion).toContain('closedBody?.code === "SHIPMENT_CHAT_CLOSED"');
  });
});

describe("ClientDashboard.tsx", () => {
  const SOURCE = read("ClientDashboard.tsx");

  it("computes the chat lock from isShipmentClosed", () => {
    expect(SOURCE).toContain("const isChatClosed = selectedShipment ? isShipmentClosed(selectedShipment.status, selectedShipment.freightType) : false;");
  });

  it("shows a distinct closed banner ahead of the view-only-account banner, and both replace the composer", () => {
    // Customer App Revision A: the composer moved into renderChatConversation,
    // which derives the same two gates and renders them in the same order —
    // closed lock first, then view-only, then the composer.
    expect(SOURCE).toContain("const locked = isShipmentClosed(ship.status, ship.freightType);");
    expect(SOURCE).toContain("const canSend = !locked && canClientSendChatMessage({ isEmployee: viewOnly });");
    const bannerIndex = SOURCE.indexOf("{locked ? (");
    expect(bannerIndex).toBeGreaterThan(-1);
    const bannerRegion = SOURCE.slice(bannerIndex, bannerIndex + 700);
    // closed banner branch comes first, then the view-only (!canSend) branch,
    // then the actual composer.
    expect(bannerRegion).toContain("curT.chatClosed");
    expect(bannerRegion).toContain(") : !canSend ? (");
    // the closed wording itself is preserved (in the localized dictionary).
    expect(SOURCE).toContain("This shipment is closed");
  });

  it("handleSendInquiry syncs local selectedShipment status on a SHIPMENT_CHAT_CLOSED rejection", () => {
    const fnStart = SOURCE.indexOf("const handleSendInquiry = async (shipmentId: string) => {");
    const fnRegion = SOURCE.slice(fnStart, fnStart + 4800);
    expect(fnRegion).toContain('body?.code === "SHIPMENT_CHAT_CLOSED"');
    expect(fnRegion).toContain("setSelectedShipment((prev) => (prev && prev.id === shipmentId ? { ...prev, status: body.shipmentStatus } : prev));");
  });
});

describe("admin/ChatCenter.tsx — internal_staff composer", () => {
  const SOURCE = read("admin/ChatCenter.tsx");

  it("computes the chat lock from isShipmentClosed", () => {
    expect(SOURCE).toContain("const isSelectedShipmentClosed = selectedShipment ? isShipmentClosed(selectedShipment.status, selectedShipment.freightType) : false;");
  });

  it("renders a read-only banner instead of the composer once closed", () => {
    // fix/admin-mobile-chat-correctness: the composer now serves every
    // channel this surface may compose in (internal everywhere; all
    // channels on mobile — canComposeInActiveChannel), so the closed
    // lock is pinned on that composability flag: wherever a composer
    // COULD render, the closed state must swap it for the banner.
    expect(SOURCE).toContain("canComposeInActiveChannel = activeChannel === 'internal_staff' || isMobile");
    expect(SOURCE).toContain("canComposeInActiveChannel && isSelectedShipmentClosed &&");
    expect(SOURCE).toContain("canComposeInActiveChannel && !isSelectedShipmentClosed &&");
  });

  it("handleSendInternalMessage is guarded by isLocked, and reports a specific (not generic) error on SHIPMENT_CHAT_CLOSED", () => {
    const fnStart = SOURCE.indexOf("const handleSendInternalMessage = async () => {");
    const fnRegion = SOURCE.slice(fnStart, fnStart + 6400);
    expect(fnRegion).toContain("isLocked: isSelectedShipmentClosed");
    expect(fnRegion).toContain("closedBody?.code === 'SHIPMENT_CHAT_CLOSED'");
    expect(fnRegion).toContain("setInternalSendError('closed');");
  });
});
