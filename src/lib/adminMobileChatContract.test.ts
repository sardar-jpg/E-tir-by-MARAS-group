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
const ACTIVITY_BACKFILL = readFileSync(join(ROOT, "scripts", "backfill-last-chat-activity.ts"), "utf-8");

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
    expect(CHAT_CENTER).toContain("useVisualViewportMetrics");
    expect(CHAT_CENTER).toContain("window.visualViewport");
    expect(CHAT_CENTER).toContain("env(safe-area-inset-bottom)");
  });

  it("keyboard UX (real-iPhone pass): body locked while the conversation is open, overlay follows the visual viewport, thread bottom-anchored", () => {
    // The page behind the overlay must never scroll (the shipment list
    // could appear behind the composer when WebKit scrolled the document
    // to reveal the focused input).
    expect(CHAT_CENTER).toContain("body.style.position = 'fixed'");
    expect(CHAT_CENTER).toContain("window.scrollTo(0, scrollY)");
    // The overlay tracks the visual viewport's pan offset, so
    // header/tabs/composer stay inside the visible area with the
    // keyboard open — the page itself never repositions.
    expect(CHAT_CENTER).toContain("translateY(${visualViewport.offsetTop}px)");
    // Short conversations hug the composer (no dead space) —
    // WhatsApp/Telegram/iMessage anchoring.
    expect(CHAT_CENTER).toContain('"min-h-full flex flex-col justify-end"');
    // Thread scrolling never chains into the page; the overlay refuses
    // rubber-band overscroll.
    expect(CHAT_CENTER).toContain("overscroll-contain");
    expect(CHAT_CENTER).toContain("overscroll-none");
    // Keyboard resize keeps the newest messages pinned; sending always
    // follows your own message down.
    expect(CHAT_CENTER).toContain("}, [visualViewport?.height, isMobile]);");
    expect(CHAT_CENTER).toContain("isNearBottomRef.current = true;\n        setChannelMessages((prev) => [...prev, msg]);");
  });

  it("mobile list card is sized by MEASUREMENT, not a hardcoded viewport guess (last row must never clip under the bottom nav)", () => {
    // The old hardcoded chrome guess clipped the final shipment row on
    // real iPhones (top bar + browser toolbar + safe areas exceeded it).
    expect(CHAT_CENTER).not.toContain("h-[calc(100dvh-13.5rem)]");
    // Measured: card top + live visualViewport height, reserving exactly
    // AdminPanel's own bottom-nav allowance (5.5rem + safe-area inset).
    expect(CHAT_CENTER).toContain("getBoundingClientRect().top");
    expect(CHAT_CENTER).toContain("px - 5.5rem - env(safe-area-inset-bottom)");
    expect(CHAT_CENTER).toContain("isMobile && mobileListHeight ? { height: mobileListHeight } : undefined");
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

describe("recent-activity ordering (feature/admin-chat-recent-activity-order)", () => {
  it("lastChatActivityAt is written ATOMICALLY in the same first batch as the message — and never touches updatedAt", () => {
    const COMMIT = region(SERVER, "async function commitChatMessageWithUnreadFanout", 3600);
    expect(COMMIT).toContain("const activityUpdate = { lastChatActivityAt: message.timestamp };");
    // Firestore: same first batch as the message set.
    expect(COMMIT).toContain('batch.update(db.collection("shipments").doc(message.shipmentId), activityUpdate);');
    // Memory-fallback parity (single-field merge).
    expect(COMMIT).toContain('await updateDoc(doc(db, "shipments", message.shipmentId), activityUpdate);');
    // A chat message is not a shipment edit: updatedAt must not appear in
    // the activity update (only in prose comments, if anywhere).
    expect(COMMIT).not.toContain("updatedAt:");
  });

  it("the Chat Center sorts through the ONE tested pure helper — search filters first, ordering preserved", () => {
    expect(CHAT_CENTER).toContain("sortShipmentsByChatActivity(");
    expect(CHAT_CENTER).toContain("filterShipmentsBySearch(shipments, searchQuery),");
    // Immediate reorder on own send + read-never-demotes memory.
    expect(CHAT_CENTER).toContain("recordLocalActivity(selectedShipment.id, msg.timestamp);");
    expect(CHAT_CENTER).toContain("recordLocalActivity(selectedShipment.id, newest.timestamp);");
    // Ordering is never derived by fetching the chatMessages collection.
    expect(CHAT_CENTER).not.toContain('"/api/chat/');
  });

  it("the activity backfill is dry-run by default; apply requires its explicit flag and never deletes", () => {
    const beforeApplyGate = ACTIVITY_BACKFILL.slice(0, ACTIVITY_BACKFILL.indexOf("if (!apply)"));
    expect(beforeApplyGate.length).toBeGreaterThan(500);
    // No Firestore write shape may be reachable before the dry-run exit —
    // no document reference is even constructed there (`.doc(`), and no
    // update/delete call exists. (Map.prototype.set for the in-memory
    // aggregation is not a write.)
    expect(beforeApplyGate).not.toContain(".update(");
    expect(beforeApplyGate).not.toContain(".doc(");
    expect(beforeApplyGate).not.toContain(".delete(");
    expect(ACTIVITY_BACKFILL).toContain("Dry run complete. Nothing was modified.");
    expect(ACTIVITY_BACKFILL).toContain('const APPLY_FLAG = "--apply-last-chat-activity"');
    expect(ACTIVITY_BACKFILL).toContain("process.argv.includes(APPLY_FLAG)");
    expect(ACTIVITY_BACKFILL).not.toContain(".delete(");
  });
});

describe("mobile UX pass (feature/admin-chat-mobile-ux-pass)", () => {
  it("keyboard: the textarea is never disabled during a send, and Send/attach taps never steal its focus", () => {
    // Disabling the focused textarea force-blurred it on iOS — the
    // keyboard closed after every send. The isSending submit-gate
    // (canSubmitChatMessage) remains the authoritative duplicate guard.
    expect(CHAT_CENTER).not.toContain("disabled={isSendingInternal}\n              style={{ minHeight: COMPOSER_MIN_HEIGHT_PX");
    const textareaRegion = region(CHAT_CENTER, "ref={internalTextareaRef}", 1800);
    expect(textareaRegion).not.toContain("disabled={isSendingInternal}");
    // Narrow pointerdown guards on exactly the two composer buttons.
    expect((CHAT_CENTER.match(/onPointerDown=\{\(e\) => e\.preventDefault\(\)\}/g) || []).length).toBe(2);
    // Post-send focus restore (mobile safety net), draft cleared only on success.
    expect(CHAT_CENTER).toContain("if (isMobile) internalTextareaRef.current?.focus();");
  });

  it("mobile list is flat (no outer card border/radius/shadow, no double gutter); desktop card intact", () => {
    expect(CHAT_CENTER).toContain("border-0 lg:border");
    expect(CHAT_CENTER).toContain("rounded-none lg:rounded-2xl");
    expect(CHAT_CENTER).toContain("-mx-3 lg:mx-0");
    expect(CHAT_CENTER).toContain("bg-white lg:bg-slate-50");
    // The desktop sizing pin lives in the earlier describe and still holds;
    // the measured visualViewport sizing from PR #124 stays wired:
    expect(CHAT_CENTER).toContain("getBoundingClientRect().top");
    expect(CHAT_CENTER).toContain("isMobile && mobileListHeight ? { height: mobileListHeight } : undefined");
  });

  it("optimistic images: pending item bound at creation, reconciled by server message, deduped by id, revoked on removal", () => {
    // Image attachments route into the optimistic flow; other files keep
    // the existing synchronous path.
    expect(CHAT_CENTER).toContain("if (internalFile && (internalFile.type.startsWith('image/') || isLikelyHeic(internalFile))) {");
    expect(CHAT_CENTER).toContain("startImageSend(internalFile, text);");
    // The job posts to the CAPTURED shipment/channel, never the currently
    // viewed one, and only appends to the visible thread when they match.
    expect(CHAT_CENTER).toContain("`/api/shipments/${job.shipmentId}/chat`");
    expect(CHAT_CENTER).toContain("channel: job.channel,");
    expect(CHAT_CENTER).toContain("viewing.shipmentId === job.shipmentId && viewing.channel === job.channel");
    // Reconciliation: server message merged de-dup-by-id (the ~3s poll
    // delivering the same id later is a no-op), pending removed + URL revoked.
    expect(CHAT_CENTER).toContain("setChannelMessages((prev) => mergeNewerChatMessages(prev, [msg]));");
    expect(CHAT_CENTER).toContain("removePendingImage(prev, id)");
    expect(CHAT_CENTER).toContain("revokePreviewUrl(revokedUrl)");
    // Per-item duplicate-submission guard; retry reuses the same id and
    // the cached upload URL (never re-uploads after a send-stage failure).
    expect(CHAT_CENTER).toContain("if (!job || job.running) return;");
    expect(CHAT_CENTER).toContain("markPendingImageRetrying(prev, id)");
    expect(CHAT_CENTER).toContain("if (!job.uploadedUrl) {");
    // Durable activity comes ONLY from the authoritative server message.
    const jobRegion = region(CHAT_CENTER, "const runPendingImageJob", 3600);
    expect(jobRegion).toContain("recordLocalActivity(job.shipmentId, msg.timestamp);");
    // HEIC is refused with a clear message, never uploaded under a fake type.
    expect(CHAT_CENTER).toContain("setInternalSendError('heic');");
    expect(CHAT_CENTER).toContain("{label.heicUnsupported}");
  });

  it("the optimizer is dependency-free and falls back to the original file", () => {
    const OPTIMIZE = readFileSync(join(ROOT, "src", "lib", "chatImageOptimize.ts"), "utf-8");
    expect(OPTIMIZE).not.toMatch(/from ["'](?!\.)/); // no package imports at all
    expect(OPTIMIZE).toContain("imageOrientation: \"from-image\"");
    expect(OPTIMIZE).toContain("if (blob.size >= file.size) return original;");
    expect(OPTIMIZE).toContain("bitmap?.close?.();");
  });
});
