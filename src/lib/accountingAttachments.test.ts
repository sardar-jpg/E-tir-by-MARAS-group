import { describe, it, expect } from "vitest";
import {
  sniffAttachmentMime, validateAttachmentUpload, buildAttachmentMetadata,
  applyAttachmentRemoval, randomAttachmentStorageName, attachmentStoragePath,
  isInternalOnlyAttachmentParent, MAX_ATTACHMENT_BYTES,
} from "./accountingAttachments";

const bytesOf = (arr: number[], pad = 8): Uint8Array => {
  const out = new Uint8Array(Math.max(arr.length, pad));
  arr.forEach((b, i) => (out[i] = b));
  return out;
};
const PDF = bytesOf([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]); // %PDF-1
const JPG = bytesOf([0xff, 0xd8, 0xff, 0xe0]);
const PNG = bytesOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EXE = bytesOf([0x4d, 0x5a, 0x90, 0x00]); // MZ (Windows PE)
const ELF = bytesOf([0x7f, 0x45, 0x4c, 0x46]); // ELF
const HTML = bytesOf([0x3c, 0x21, 0x44, 0x4f]); // <!DO

describe("magic-byte sniffing (client MIME is never trusted)", () => {
  it("detects PDF / JPEG / PNG by content", () => {
    expect(sniffAttachmentMime(PDF)).toBe("application/pdf");
    expect(sniffAttachmentMime(JPG)).toBe("image/jpeg");
    expect(sniffAttachmentMime(PNG)).toBe("image/png");
  });
  it("returns null for executables, scripts, HTML, and unknown binaries", () => {
    expect(sniffAttachmentMime(EXE)).toBeNull();
    expect(sniffAttachmentMime(ELF)).toBeNull();
    expect(sniffAttachmentMime(HTML)).toBeNull();
    expect(sniffAttachmentMime(bytesOf([0x00, 0x01]))).toBeNull();
  });
});

describe("validateAttachmentUpload", () => {
  it("accepts a real PDF/JPG/PNG (test 47)", () => {
    expect(validateAttachmentUpload({ originalFileName: "proof.pdf", bytes: PDF, sizeBytes: PDF.length }).ok).toBe(true);
    expect(validateAttachmentUpload({ originalFileName: "photo.jpg", bytes: JPG, sizeBytes: JPG.length }).ok).toBe(true);
    expect(validateAttachmentUpload({ originalFileName: "scan.png", bytes: PNG, sizeBytes: PNG.length }).ok).toBe(true);
  });
  it("rejects an executable even when named .pdf (test 48)", () => {
    const r = validateAttachmentUpload({ originalFileName: "malware.pdf", bytes: EXE, sizeBytes: EXE.length });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("attachment_type_not_allowed");
  });
  it("rejects a real PNG whose extension claims .pdf (content/extension mismatch)", () => {
    const r = validateAttachmentUpload({ originalFileName: "sneaky.pdf", bytes: PNG, sizeBytes: PNG.length });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("attachment_type_not_allowed");
  });
  it("rejects an oversized file (test 49)", () => {
    const r = validateAttachmentUpload({ originalFileName: "big.pdf", bytes: PDF, sizeBytes: MAX_ATTACHMENT_BYTES + 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("attachment_too_large");
  });
});

describe("storage naming is randomized + path-traversal safe", () => {
  it("random name preserves only the extension", () => {
    const name = randomAttachmentStorageName("application/pdf", "abc-123-XYZ");
    expect(name.endsWith(".pdf")).toBe(true);
    expect(name).not.toContain("/");
    expect(name).not.toContain("..");
  });
  it("storage path strips traversal from the parent id", () => {
    const path = attachmentStoragePath("vendor_payment", "../../etc/passwd", "rand.pdf");
    expect(path).toBe("accounting-attachments/vendor_payment/etcpasswd/rand.pdf");
    expect(path).not.toContain("..");
  });
});

describe("metadata never carries raw bytes (test 54)", () => {
  it("built metadata has no byte/buffer field and is status active", () => {
    const meta = buildAttachmentMetadata({
      attachmentId: "att-1", parentType: "customer_payment", parentId: "cpay-1",
      storageName: "rand.pdf", originalFileName: "My Proof.pdf", mimeType: "application/pdf",
      sizeBytes: 1234, storagePath: "accounting-attachments/customer_payment/cpay-1/rand.pdf",
      uploadedAt: "t", uploadedBy: "u1",
    });
    const json = JSON.stringify(meta);
    expect(json).not.toContain("base64");
    expect((meta as any).bytes).toBeUndefined();
    expect((meta as any).buffer).toBeUndefined();
    expect(meta.status).toBe("active");
    expect(meta.originalFileName).toBe("My Proof.pdf");
    expect(meta.fileName).toBe("rand.pdf"); // storage-facing randomized name
  });
});

describe("soft removal preserves metadata (test 53)", () => {
  const base = buildAttachmentMetadata({
    attachmentId: "att-2", parentType: "vendor_payment", parentId: "vp-1", storageName: "r.pdf",
    originalFileName: "v.pdf", mimeType: "application/pdf", sizeBytes: 10, storagePath: "p", uploadedAt: "t", uploadedBy: "u",
  });
  it("requires a reason", () => {
    const r = applyAttachmentRemoval(base, { reason: "  ", actor: "u2", nowIso: "t2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("removal_reason_required");
  });
  it("marks removed with reason + actor, never hard-deletes", () => {
    const r = applyAttachmentRemoval(base, { reason: "wrong file", actor: "u2", nowIso: "t2" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.attachment.status).toBe("removed");
      expect(r.attachment.removalReason).toBe("wrong file");
      expect(r.attachment.removedBy).toBe("u2");
      expect(r.attachment.originalFileName).toBe("v.pdf"); // metadata preserved
    }
  });
  it("re-removal is rejected (already removed)", () => {
    const first = applyAttachmentRemoval(base, { reason: "x", actor: "u", nowIso: "t" });
    if (first.ok) {
      const again = applyAttachmentRemoval(first.attachment, { reason: "y", actor: "u", nowIso: "t3" });
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.code).toBe("already_removed");
    }
  });
});

describe("internal-only classification", () => {
  it("vendor + cost-statement proofs are internal only", () => {
    expect(isInternalOnlyAttachmentParent("vendor_payment")).toBe(true);
    expect(isInternalOnlyAttachmentParent("cost_statement")).toBe(true);
    expect(isInternalOnlyAttachmentParent("customer_payment")).toBe(false);
  });
});
