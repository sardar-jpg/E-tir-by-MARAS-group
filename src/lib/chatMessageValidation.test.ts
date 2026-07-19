import { describe, it, expect } from "vitest";
import {
  MAX_CHAT_TEXT_LENGTH,
  isDataUrlFileReference,
  isHttpsUrl,
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

describe("isHttpsUrl", () => {
  it("rejects '#'", () => {
    expect(isHttpsUrl("#")).toBe(false);
  });

  it("rejects empty and whitespace-only strings", () => {
    expect(isHttpsUrl("")).toBe(false);
    expect(isHttpsUrl("   ")).toBe(false);
  });

  it("rejects a javascript: URL", () => {
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects a file: URL", () => {
    expect(isHttpsUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects a blob: URL", () => {
    expect(isHttpsUrl("blob:https://example.com/9a1b2c3d")).toBe(false);
  });

  it("rejects a data: URL", () => {
    expect(isHttpsUrl("data:image/png;base64,AAAA")).toBe(false);
  });

  it("rejects a malformed / non-URL string", () => {
    expect(isHttpsUrl("not a url")).toBe(false);
    expect(isHttpsUrl("htp://storage.googleapis.com/x")).toBe(false);
  });

  it("rejects a protocol-relative or schemeless URL", () => {
    expect(isHttpsUrl("//storage.googleapis.com/bucket/file.pdf")).toBe(false);
    expect(isHttpsUrl("storage.googleapis.com/bucket/file.pdf")).toBe(false);
  });

  it("rejects a plain http: (non-secure) URL", () => {
    expect(isHttpsUrl("http://storage.googleapis.com/bucket/file.pdf")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isHttpsUrl(undefined)).toBe(false);
    expect(isHttpsUrl(null)).toBe(false);
    expect(isHttpsUrl(42)).toBe(false);
  });

  it("accepts a real Firebase Storage download URL", () => {
    expect(
      isHttpsUrl("https://firebasestorage.googleapis.com/v0/b/proj.appspot.com/o/file.pdf?alt=media&token=abc123")
    ).toBe(true);
  });

  it("accepts a real Cloud Storage (GCS) URL", () => {
    expect(isHttpsUrl("https://storage.googleapis.com/bucket-name/uploads/admin/1234-file.pdf")).toBe(true);
  });

  it("is case-insensitive on the scheme", () => {
    expect(isHttpsUrl("HTTPS://storage.googleapis.com/bucket/file.pdf")).toBe(true);
  });

  it("tolerates surrounding whitespace", () => {
    expect(isHttpsUrl("  https://storage.googleapis.com/bucket/file.pdf  ")).toBe(true);
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

  it("rejects '#' as a fileUrl", () => {
    const result = validateChatSendPayload({ type: "file", fileUrl: "#" });
    expect(result.ok).toBe(false);
  });

  it("rejects a javascript: fileUrl", () => {
    const result = validateChatSendPayload({ type: "file", fileUrl: "javascript:alert(1)" });
    expect(result.ok).toBe(false);
  });

  it("rejects a file: fileUrl", () => {
    const result = validateChatSendPayload({ type: "file", fileUrl: "file:///etc/passwd" });
    expect(result.ok).toBe(false);
  });

  it("rejects a blob: fileUrl", () => {
    const result = validateChatSendPayload({ type: "file", fileUrl: "blob:https://example.com/abc" });
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed fileUrl", () => {
    const result = validateChatSendPayload({ type: "file", fileUrl: "not a url" });
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
      fileName: "file.pdf", // PR #138: file messages now require a real name
      fileUrl: "https://storage.googleapis.com/bucket/file.pdf",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a valid attachment-only message with a real Firebase Storage download URL", () => {
    const result = validateChatSendPayload({
      type: "file",
      fileName: "file.pdf", // PR #138: file messages now require a real name
      fileUrl: "https://firebasestorage.googleapis.com/v0/b/proj.appspot.com/o/file.pdf?alt=media&token=abc123",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a file message with a real Storage URL plus caption text", () => {
    const result = validateChatSendPayload({
      type: "file",
      fileName: "file.pdf", // PR #138: file messages now require a real name
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
      fileName: "file.pdf", // PR #138: file messages now require a real name
      fileUrl: "https://storage.googleapis.com/bucket/file.pdf",
      text: "a".repeat(MAX_CHAT_TEXT_LENGTH + 1),
    });
    expect(result.ok).toBe(false);
  });
});

describe("file messages require a REAL file name (PR #138 review, M-1) — text behavior unchanged", () => {
  const URL = "https://firebasestorage.googleapis.com/v0/b/x/o/f.png?alt=media&token=t";

  it("a file message without a fileName is rejected — the chat→document mirror can never fabricate a name", () => {
    expect(validateChatSendPayload({ type: "file", fileUrl: URL }).ok).toBe(false);
    expect(validateChatSendPayload({ type: "file", fileUrl: URL, fileName: "   " }).ok).toBe(false);
    expect(validateChatSendPayload({ type: "file", fileUrl: URL, fileName: "unnamed_document.bin" }).ok).toBe(false);
    expect(validateChatSendPayload({ type: "file", fileUrl: URL, fileName: "#" }).ok).toBe(false);
  });

  it("a file message with a real fileName passes (with or without caption text)", () => {
    expect(validateChatSendPayload({ type: "file", fileUrl: URL, fileName: "pod.png" }).ok).toBe(true);
    expect(validateChatSendPayload({ type: "file", fileUrl: URL, fileName: "pod.png", text: "delivered" }).ok).toBe(true);
  });

  it("text messages are unaffected: no fileName required, same emptiness rule as before", () => {
    expect(validateChatSendPayload({ type: "text", text: "merhaba" }).ok).toBe(true);
    expect(validateChatSendPayload({ type: "text", text: "  " }).ok).toBe(false);
    expect(validateChatSendPayload({ type: "text", text: "hi", fileName: undefined }).ok).toBe(true);
  });
});
