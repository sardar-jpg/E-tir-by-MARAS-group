import { describe, it, expect } from "vitest";
import { containsRawPrivateDocumentUrl } from "./emailSafety";

describe("containsRawPrivateDocumentUrl", () => {
  it("flags a raw firebasestorage.googleapis.com download link", () => {
    expect(
      containsRawPrivateDocumentUrl(
        "Here is the invoice: https://firebasestorage.googleapis.com/v0/b/etir/o/doc.pdf?alt=media&token=secret"
      )
    ).toBe(true);
  });

  it("flags a raw firebasestorage.app download link", () => {
    expect(
      containsRawPrivateDocumentUrl("https://etir-by-maras-group.firebasestorage.app/some/path")
    ).toBe(true);
  });

  it("flags a raw storage.googleapis.com download link", () => {
    expect(containsRawPrivateDocumentUrl("https://storage.googleapis.com/etir-bucket/doc.pdf")).toBe(true);
  });

  it("does not flag the safe, token-based tracking link", () => {
    expect(containsRawPrivateDocumentUrl("https://etir.app?token=tok_abc123")).toBe(false);
  });

  it("does not flag plain shipment text", () => {
    expect(
      containsRawPrivateDocumentUrl("Your shipment #123 is now In Transit from Istanbul to Berlin.")
    ).toBe(false);
  });

  it("handles empty/undefined text safely", () => {
    expect(containsRawPrivateDocumentUrl("")).toBe(false);
    expect(containsRawPrivateDocumentUrl(undefined as unknown as string)).toBe(false);
  });
});
