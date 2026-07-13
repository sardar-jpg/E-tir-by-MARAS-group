import { describe, it, expect } from "vitest";
import {
  MAX_CHAT_TEXT_LENGTH,
  isDataUrlFileReference,
  validateChatSendPayload,
} from "./chatMessageValidation";

describe("isDataUrlFileReference", () => {
  it("detects a base64 data URL", () => {
    expect(isDataUrlFileReference("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
  });

  it("is case-insensitive and tolerates leading whitespace", () => {
    expect(isDataUrlFileReference("  DATA:application/pdf;base64,AAAA")).toBe(true);
  });

  it("is false for a real Storage URL", () => {
    expect(isDataUrlFileReference("https://storage.googleapis.com/bucket/file.pdf")).toBe(false);
  });

  it("is false for non-string values", () => {
    expect(isDataUrlFileReference(undefined)).toBe(false);
    expect(isDataUrlFileReference(null)).toBe(false);
    expect(isDataUrlFileReference(42)).toBe(false);
  });
});

describe("validateChatSendPayload", () => {
  it("rejects a data: fileUrl even when type is file", () => {
    const result = validateChatSendPayload({
      type: "file",
      fileUrl: "data:image/png;base64,AAAA",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a data: fileUrl even when type is not explicitly file", () => {
    const result = validateChatSendPayload({
      text: "see attached",
      fileUrl: "data:application/pdf;base64,AAAA",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a file message with no fileUrl at all", () => {
    const result = validateChatSendPayload({ type: "file" });
    expect(result.ok).toBe(false);
  });

  it("rejects a file message with a blank fileUrl", () => {
    const result = validateChatSendPayload({ type: "file", fileUrl: "   " });
    expect(result.ok).toBe(false);
  });

  it("accepts a valid attachment-only message with a real Storage URL", () => {
    const result = validateChatSendPayload({
      type: "file",
      fileUrl: "https://storage.googleapis.com/bucket/file.pdf",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a file message with a real Storage URL plus caption text", () => {
    const result = validateChatSendPayload({
      type: "file",
      fileUrl: "https://storage.googleapis.com/bucket/file.pdf",
      text: "Here is the CMR",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects whitespace-only text with no attachment", () => {
    const result = validateChatSendPayload({ type: "text", text: "   \n\t  " });
    expect(result.ok).toBe(false);
  });

  it("rejects completely empty text with no attachment", () => {
    const result = validateChatSendPayload({ type: "text", text: "" });
    expect(result.ok).toBe(false);
  });

  it("accepts a normal text message", () => {
    const result = validateChatSendPayload({ type: "text", text: "Hello driver" });
    expect(result.ok).toBe(true);
  });

  it("accepts text exactly at the 5000-character boundary", () => {
    const text = "a".repeat(MAX_CHAT_TEXT_LENGTH);
    const result = validateChatSendPayload({ type: "text", text });
    expect(result.ok).toBe(true);
  });

  it("rejects text one character over the boundary", () => {
    const text = "a".repeat(MAX_CHAT_TEXT_LENGTH + 1);
    const result = validateChatSendPayload({ type: "text", text });
    expect(result.ok).toBe(false);
  });

  it("evaluates the boundary after trimming surrounding whitespace", () => {
    const text = `  ${"a".repeat(MAX_CHAT_TEXT_LENGTH)}  `;
    const result = validateChatSendPayload({ type: "text", text });
    expect(result.ok).toBe(true);
  });

  it("rejects over-limit caption text on an otherwise-valid file message", () => {
    const result = validateChatSendPayload({
      type: "file",
      fileUrl: "https://storage.googleapis.com/bucket/file.pdf",
      text: "a".repeat(MAX_CHAT_TEXT_LENGTH + 1),
    });
    expect(result.ok).toBe(false);
  });
});
