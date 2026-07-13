import { describe, it, expect } from "vitest";
import {
  canSubmitChatMessage,
  isStaleChatPollResponse,
  applySuccessfulChatPoll,
  applyFailedChatPoll,
  shouldConfirmChannelRead,
  planAttachmentSend,
  isCachedAttachmentForShipment,
  planAttachmentSendForShipment,
  type ChatPollState,
} from "./chatComposerState";

describe("canSubmitChatMessage (duplicate-send guard)", () => {
  it("allows a normal text send", () => {
    expect(canSubmitChatMessage({ text: "hello", hasAttachment: false, isSending: false })).toBe(true);
  });

  it("allows an attachment-only send with no text", () => {
    expect(canSubmitChatMessage({ text: "", hasAttachment: true, isSending: false })).toBe(true);
  });

  it("blocks when text is whitespace-only and there is no attachment", () => {
    expect(canSubmitChatMessage({ text: "   ", hasAttachment: false, isSending: false })).toBe(false);
  });

  it("blocks a second submit while one is already in flight, even with valid content", () => {
    expect(canSubmitChatMessage({ text: "hello", hasAttachment: false, isSending: true })).toBe(false);
    expect(canSubmitChatMessage({ text: "", hasAttachment: true, isSending: true })).toBe(false);
  });

  it("blocks when there is nothing to send at all", () => {
    expect(canSubmitChatMessage({ text: "", hasAttachment: false, isSending: false })).toBe(false);
  });
});

describe("isStaleChatPollResponse", () => {
  it("is not stale when the response matches the current shipment/channel", () => {
    expect(isStaleChatPollResponse("shipment-1", "shipment-1")).toBe(false);
  });

  it("is stale after switching to a different shipment", () => {
    expect(isStaleChatPollResponse("shipment-2", "shipment-1")).toBe(true);
  });

  it("is stale once nothing is selected anymore", () => {
    expect(isStaleChatPollResponse(null, "shipment-1")).toBe(true);
  });
});

describe("applySuccessfulChatPoll / applyFailedChatPoll", () => {
  it("a successful poll replaces messages and marks loaded, clearing any error", () => {
    const next = applySuccessfulChatPoll([{ id: "m1" }]);
    expect(next).toEqual({ messages: [{ id: "m1" }], hasLoadedOnce: true, pollError: false });
  });

  it("a failed poll preserves the previous messages untouched", () => {
    const prev: ChatPollState<{ id: string }> = {
      messages: [{ id: "m1" }, { id: "m2" }],
      hasLoadedOnce: true,
      pollError: false,
    };
    const next = applyFailedChatPoll(prev);
    expect(next.messages).toBe(prev.messages);
    expect(next.messages).toEqual([{ id: "m1" }, { id: "m2" }]);
  });

  it("a failed poll only flips pollError, leaving hasLoadedOnce as it was", () => {
    const prev: ChatPollState<{ id: string }> = { messages: [], hasLoadedOnce: false, pollError: false };
    const next = applyFailedChatPoll(prev);
    expect(next).toEqual({ messages: [], hasLoadedOnce: false, pollError: true });
  });

  it("never had a successful load: still distinguishable from a genuine empty conversation via hasLoadedOnce", () => {
    const neverLoaded = applyFailedChatPoll({ messages: [], hasLoadedOnce: false, pollError: false });
    const genuinelyEmpty = applySuccessfulChatPoll<{ id: string }>([]);
    expect(neverLoaded.hasLoadedOnce).toBe(false);
    expect(genuinelyEmpty.hasLoadedOnce).toBe(true);
  });
});

describe("shouldConfirmChannelRead", () => {
  it("confirms read only when the mark-seen request succeeded", () => {
    expect(shouldConfirmChannelRead(true)).toBe(true);
  });

  it("does not confirm read when the mark-seen request failed", () => {
    expect(shouldConfirmChannelRead(false)).toBe(false);
  });
});

describe("planAttachmentSend (retry reuses the uploaded URL, never re-uploads)", () => {
  // Exercised directly by all three attachment-sending surfaces
  // (ChatCenter.tsx's Internal Staff composer, App.tsx's Admin attachment
  // modal, and DriverApplication.tsx's retry handler) — this is the real
  // decision point behind "a retry after a failed send reuses the cached
  // Storage URL instead of uploading the file again."
  it("plans to upload when nothing has been cached yet", () => {
    expect(planAttachmentSend("")).toEqual({ action: "upload_then_send" });
  });

  it("plans to upload when the cache is whitespace-only", () => {
    expect(planAttachmentSend("   ")).toEqual({ action: "upload_then_send" });
  });

  it("Admin full chat retry: a cached URL from a prior successful upload is reused, not re-uploaded", () => {
    const cachedUrl = "https://storage.googleapis.com/bucket/admin-doc.pdf";
    expect(planAttachmentSend(cachedUrl)).toEqual({ action: "reuse_cached_url", fileUrl: cachedUrl });
  });

  it("Driver retry: a cached URL from a prior successful upload is reused, not re-uploaded", () => {
    const cachedUrl = "https://storage.googleapis.com/bucket/driver-photo.jpg";
    expect(planAttachmentSend(cachedUrl)).toEqual({ action: "reuse_cached_url", fileUrl: cachedUrl });
  });

  it("Internal Staff retry: a cached URL from a prior successful upload is reused, not re-uploaded", () => {
    const cachedUrl = "https://firebasestorage.googleapis.com/v0/b/proj.appspot.com/o/cmr.pdf?alt=media&token=abc";
    expect(planAttachmentSend(cachedUrl)).toEqual({ action: "reuse_cached_url", fileUrl: cachedUrl });
  });

  it("trims the cached URL before reusing it", () => {
    expect(planAttachmentSend("  https://storage.googleapis.com/bucket/file.pdf  ")).toEqual({
      action: "reuse_cached_url",
      fileUrl: "https://storage.googleapis.com/bucket/file.pdf",
    });
  });
});

describe("isCachedAttachmentForShipment / planAttachmentSendForShipment (cached uploads are bound to a shipment)", () => {
  const shipmentA = "shipment-1003";
  const shipmentB = "shipment-1001";
  const cachedUrl = "https://storage.googleapis.com/bucket/cmr.pdf";

  it("a cached upload for Shipment A is recognized as belonging to Shipment A", () => {
    expect(isCachedAttachmentForShipment(shipmentA, shipmentA)).toBe(true);
  });

  it("a cached upload for Shipment A does not belong to Shipment B", () => {
    expect(isCachedAttachmentForShipment(shipmentA, shipmentB)).toBe(false);
  });

  it("an empty cached shipment id never matches, even against itself", () => {
    expect(isCachedAttachmentForShipment("", "")).toBe(false);
  });

  it("does not match when nothing is currently selected", () => {
    expect(isCachedAttachmentForShipment(shipmentA, null)).toBe(false);
  });

  it("1. cached upload for Shipment A is reused when still on Shipment A", () => {
    expect(planAttachmentSendForShipment(cachedUrl, shipmentA, shipmentA)).toEqual({
      action: "reuse_cached_url",
      fileUrl: cachedUrl,
    });
  });

  it("2. cached upload for Shipment A is NOT reused on Shipment B — falls back to upload_then_send instead of leaking the URL across shipments", () => {
    expect(planAttachmentSendForShipment(cachedUrl, shipmentA, shipmentB)).toEqual({
      action: "upload_then_send",
    });
  });

  it("treats a shipment mismatch as 'nothing cached', not an error — same fallback as never having uploaded at all", () => {
    expect(planAttachmentSendForShipment(cachedUrl, shipmentA, shipmentB)).toEqual(planAttachmentSend(""));
  });

  it("7. still reuses without re-uploading on the original shipment (existing retry behavior unaffected by the shipment check)", () => {
    // Regression: adding the shipment boundary must not break the
    // already-shipped "retry reuses the cached URL" behavior when the
    // shipment genuinely hasn't changed.
    expect(planAttachmentSendForShipment(cachedUrl, shipmentA, shipmentA)).toEqual(
      planAttachmentSend(cachedUrl)
    );
  });

  it("3. Driver retry cannot post to a different shipment — handleRetryDriverAttachment's guard is exactly this check", () => {
    // DriverApplication.tsx's handleRetryDriverAttachment calls
    // isCachedAttachmentForShipment(pendingDriverAttachment.shipmentId,
    // activeShipment?.id) before ever reusing pendingDriverAttachment's
    // cached URL — if the driver switched shipments since the upload,
    // this is false and the retry is blocked (pendingDriverAttachment is
    // cleared instead of being sent).
    const uploadedForShipmentA = shipmentA;
    const nowActiveShipmentB = shipmentB;
    expect(isCachedAttachmentForShipment(uploadedForShipmentA, nowActiveShipmentB)).toBe(false);
  });

  it("4. Internal Staff (ChatCenter.tsx): switching shipment invalidates the cached attachment for the previous one", () => {
    // handleSendInternalMessage calls planAttachmentSendForShipment(
    // internalUploadedFileUrl, internalUploadShipmentId,
    // selectedShipment.id) — after switching to Shipment B, a URL cached
    // while Shipment A was selected must not be reused.
    const internalUploadedFileUrl = cachedUrl;
    const internalUploadShipmentId = shipmentA; // cached while viewing A
    const selectedShipmentIdNow = shipmentB; // switched to B
    expect(
      planAttachmentSendForShipment(internalUploadedFileUrl, internalUploadShipmentId, selectedShipmentIdNow)
    ).toEqual({ action: "upload_then_send" });
  });

  it("5. Admin full chat (App.tsx): switching the drawer's shipment invalidates the cached attachment for the previous one", () => {
    // handleSendAdminAttachment calls planAttachmentSendForShipment(
    // adminUploadedFileUrl, adminUploadShipmentId, chatShipment.id) — same
    // reasoning as Internal Staff above, for the admin drawer.
    const adminUploadedFileUrl = cachedUrl;
    const adminUploadShipmentId = shipmentA; // cached while the drawer showed A
    const chatShipmentIdNow = shipmentB; // drawer switched to B
    expect(
      planAttachmentSendForShipment(adminUploadedFileUrl, adminUploadShipmentId, chatShipmentIdNow)
    ).toEqual({ action: "upload_then_send" });
  });

  it("6. replacing/removing the attachment clears both the URL and the cached shipment id together — the cleared pair never matches any shipment afterward", () => {
    // ChatCenter.tsx's resetInternalAttachment, App.tsx's file-input
    // onChange, and DriverApplication.tsx's handleAttachmentSelected all
    // reset their cached-URL state and cached-shipment-id state to ""
    // together, never one without the other. Once both are cleared, the
    // pair must not spuriously match any shipment — including a shipment
    // whose id happens to also be "" (defensive; ids are never actually
    // empty strings in practice, but the check must not rely on that).
    const clearedUploadedUrl = "";
    const clearedUploadShipmentId = "";
    expect(isCachedAttachmentForShipment(clearedUploadShipmentId, shipmentA)).toBe(false);
    expect(isCachedAttachmentForShipment(clearedUploadShipmentId, "")).toBe(false);
    expect(planAttachmentSendForShipment(clearedUploadedUrl, clearedUploadShipmentId, shipmentA)).toEqual({
      action: "upload_then_send",
    });
  });
});
