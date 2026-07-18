import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * fix/admin-mobile-chat-correctness — source-shape contract pins. The
 * CALCULATION behavior (audience resolution, clear selection, badge
 * drops, poll guard, zoom math) is covered by real unit tests in
 * chatUnreadAccess.test.ts / chatCenterView.test.ts /
 * imageLightboxState.test.ts; these pins guarantee the components and the
 * server route actually WIRE those tested rules in, and that the audited
 * defects (WebView image navigation, duplicate mobile chat UI, fixed
 * 78dvh box, fetched-page seen gate, unscoped clears) cannot silently
 * come back. Same convention as costStatementRouteWiring.test.ts /
 * noLegacyClientWording.test.ts.
 */
const ROOT = join(__dirname, "..", "..");
const CHAT_CENTER = readFileSync(join(ROOT, "src", "components", "admin", "ChatCenter.tsx"), "utf-8");
const APP = readFileSync(join(ROOT, "src", "App.tsx"), "utf-8");
const ADMIN_PANEL = readFileSync(join(ROOT, "src", "components", "AdminPanel.tsx"), "utf-8");
const LIGHTBOX = readFileSync(join(ROOT, "src", "components", "ImageLightbox.tsx"), "utf-8");
const SERVER = readFileSync(join(ROOT, "server.ts"), "utf-8");
const RECONCILE = readFileSync(join(ROOT, "scripts", "reconcile-admin-chat-unread.ts"), "utf-8");

function region(source: string, needle: string, length: number): string {
  const start = source.indexOf(needle);
  expect(start, `needle not found: ${needle}`).toBeGreaterThan(-1);
  return source.slice(start, start + length);
}

describe("images open the in-app lightbox — never a WebView navigation to the raw file URL", () => {
  it("ChatCenter image attachments are lightbox buttons, not anchors", () => {
    const imageBranch = region(CHAT_CENTER, "{isImageAttachment ? (", 900);
    expect(imageBranch).toContain("setLightboxTarget(");
    expect(imageBranch).toContain("<button");
    expect(imageBranch).not.toContain("<a");
    expect(imageBranch).not.toContain('target="_blank"');
  });

  it("the desktop drawer's image attachments are lightbox buttons, not anchors", () => {
    const imageBranch = region(APP, "{isImageMsg ? (", 700);
    expect(imageBranch).toContain("setDrawerLightbox(");
    expect(imageBranch).toContain("<button");
    expect(imageBranch).not.toContain("<a");
    const thumb = region(APP, "Rich inline image preview — tap opens the in-app viewer", 800);
    expect(thumb).toContain("setDrawerLightbox(");
    expect(thumb).not.toContain('target="_blank"');
  });

  it("both surfaces mount the ONE shared ImageLightbox component", () => {
    expect(CHAT_CENTER).toContain("<ImageLightbox");
    expect(APP).toContain("<ImageLightbox");
  });

  it("the lightbox itself is a dialog with a close button and never opens the image via window.open", () => {
    expect(LIGHTBOX).toContain('role="dialog"');
    expect(LIGHTBOX).toContain("onClick={onClose}");
    expect(LIGHTBOX).not.toContain("window.open");
    // Pinch/zoom support: manual pointer handling with touch-action none.
    expect(LIGHTBOX).toContain("touchAction: 'none'");
    expect(LIGHTBOX).toContain("clampLightboxZoom");
  });
});

describe("one mobile chat experience — no duplicate full-chat hand-off on mobile", () => {
  it("the 'Continue in full chat' hand-off renders on desktop only", () => {
    expect(CHAT_CENTER).toContain("{!isMobile && activeChannel !== 'internal_staff' && (");
  });

  it("the fixed h-[78dvh] mobile chat box is gone; the thread is a flex-1 min-h-0 scroll region", () => {
    expect(CHAT_CENTER).not.toContain("h-[78dvh]");
    expect(CHAT_CENTER).toContain('className="flex-1 min-h-0 overflow-y-auto');
  });

  it("the mobile conversation is keyboard-aware (visualViewport) with the composer above the safe area", () => {
    expect(CHAT_CENTER).toContain("useVisualViewportHeight");
    expect(CHAT_CENTER).toContain("window.visualViewport");
    expect(CHAT_CENTER).toContain("env(safe-area-inset-bottom)");
  });

  it("desktop keeps the two-pane layout and its sizing", () => {
    expect(CHAT_CENTER).toContain("lg:h-[calc(100vh-220px)] lg:min-h-[520px]");
    expect(CHAT_CENTER).toContain('"hidden lg:flex flex-1 flex-col min-w-0 min-h-0"');
    // The desktop drawer still exists for desktop entry points.
    expect(APP).toContain("ADMIN LEVEL DRAWER CHAT PANEL");
  });
});

describe("seen handling — no fetched-page sender gate, confirmed-seen badge sync everywhere", () => {
  it("ChatCenter calls seen on the initial load unconditionally (legacy records exist even when the filtered page is empty)", () => {
    expect(CHAT_CENTER).toContain("if (!cursor || data.length > 0) {");
    // Badge sync still only fires when the server confirmed the write.
    expect(CHAT_CENTER).toContain("shouldConfirmChannelRead(seenRes.ok)");
  });

  it("the drawer's fetched-page sender gate is gone; it publishes a confirmed-seen event for AdminPanel's badges", () => {
    expect(APP).not.toContain("hasMessageFromOtherParty");
    expect(APP).toContain("if (!cursor || data.length > 0) {");
    expect(APP).toContain("seenRes.ok");
    expect(APP).toContain("setAdminChatSeenEvent");
    expect(APP).toContain("chatSeenEvent={adminChatSeenEvent}");
  });

  it("AdminPanel applies confirmed drops through the ONE tested helper and guards the unread poll against resurrection", () => {
    expect(ADMIN_PANEL).toContain("dropSeenUnreadMessages(prev, shipmentId, channel)");
    expect(ADMIN_PANEL).toContain("applyUnreadPollResponse(fetchedUnread, confirmedSeenScopesRef.current, unreadRequestIssuedAt)");
    expect(ADMIN_PANEL).toContain("recordConfirmedSeen(chatSeenEvent.shipmentId, chatSeenEvent.channel)");
    // A failed seen never clears locally: the only local drops go through
    // recordConfirmedSeen, and both callers are confirmation-gated
    // (shouldConfirmChannelRead in ChatCenter; seenRes.ok in the drawer).
    expect(ADMIN_PANEL).not.toContain("prev.filter((m) => !(m.shipmentId === shipmentId && m.channel === channel))");
  });
});

describe("order-scoped clearing stays exact: adminId + shipmentId + requested channel (+ deterministic legacy only)", () => {
  const SEEN_ROUTE = region(SERVER, 'app.post("/api/shipments/:id/chat/seen"', 7000);

  it("the channel-less merge is gated on a requested channel and runs through the tested deterministic selector", () => {
    expect(SEEN_ROUTE).toContain("if (channelFilter) {");
    expect(SEEN_ROUTE).toContain("selectChannellessClearableRecordIds(");
    expect(SEEN_ROUTE).toContain("buildUnreadClearFilters(viewerAdminId, shipmentId, null)");
    expect(SEEN_ROUTE).toContain("Array.from(new Set(");
  });

  it("clears remain per-admin and per-shipment — the scope always starts from viewerAdminId + shipmentId", () => {
    expect(SEEN_ROUTE).toContain("buildUnreadClearFilters(viewerAdminId, shipmentId, channelFilter)");
    expect(SEEN_ROUTE).toContain('const viewerAdminId = viewer === "admin" ? req.session!.id : null;');
  });

  it("GET /api/chat/unread still queries exactly this admin's records", () => {
    const UNREAD_ROUTE = region(SERVER, 'app.get("/api/chat/unread"', 2600);
    expect(UNREAD_ROUTE).toContain('{ field: "adminId", op: "==", value: viewerAdminId }');
    expect(UNREAD_ROUTE).toContain("selectUnreadMessagesFromRecords(");
  });
});

describe("legacy reconciliation script — dry-run by default, apply only behind its explicit flag", () => {
  it("performs no writes before the dry-run exit", () => {
    const beforeApplyGate = RECONCILE.slice(0, RECONCILE.indexOf("if (!apply)"));
    expect(beforeApplyGate.length).toBeGreaterThan(500);
    expect(beforeApplyGate).not.toContain(".update(");
    expect(beforeApplyGate).not.toContain(".set(");
    expect(beforeApplyGate).not.toContain(".delete(");
    expect(RECONCILE).toContain("Dry run complete. Nothing was modified.");
  });

  it("apply mode requires the explicit flag, only backfills deterministic records' channel, and never deletes", () => {
    expect(RECONCILE).toContain('const APPLY_FLAG = "--apply-backfill-channel"');
    expect(RECONCILE).toContain("process.argv.includes(APPLY_FLAG)");
    expect(RECONCILE).not.toContain(".delete(");
    // Ambiguous records are reported, never modified.
    expect(RECONCILE).toContain("ambiguous_legacy_admin_message");
    expect(RECONCILE).toContain("Ambiguous records were NOT modified");
  });
});

describe("channel privacy boundaries stay wired", () => {
  it("the internal_staff gate and channel scoping helpers are still in the seen/write paths", () => {
    expect(SERVER).toContain("canAccessInternalStaffChannel(req.session!.role)");
    expect(SERVER).toContain("resolveSeenChannelFilter(req.session!.role");
    expect(SERVER).toContain("resolveOutgoingChatChannel(");
  });

  it("the ChatCenter composer posts to the shipment-scoped chat route with the active channel — the server still decides permissions", () => {
    expect(CHAT_CENTER).toContain("const body: Record<string, unknown> = { channel: activeChannel };");
    expect(CHAT_CENTER).toContain("`/api/shipments/${selectedShipment.id}/chat`");
  });
});
