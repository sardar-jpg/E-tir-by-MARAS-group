import { describe, it, expect } from "vitest";
import {
  canSubmitChatMessage,
  isStaleChatPollResponse,
  applySuccessfulChatPoll,
  applyFailedChatPoll,
  shouldConfirmChannelRead,
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
