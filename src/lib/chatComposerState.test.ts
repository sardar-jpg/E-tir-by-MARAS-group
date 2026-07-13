import { describe, it, expect } from "vitest";
import {
  canSubmitChatMessage,
  isStaleChatPollResponse,
  applySuccessfulChatPoll,
  applyFailedChatPoll,
  shouldConfirmChannelRead,
  planAttachmentSend,
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
