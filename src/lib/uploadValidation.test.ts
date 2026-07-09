import { describe, it, expect } from "vitest";
import { validateUpload, MAX_UPLOAD_BYTES } from "./uploadValidation";

describe("validateUpload", () => {
  it("accepts a PDF", () => {
    expect(validateUpload("application/pdf", "cmr.pdf", 1024)).toEqual({ ok: true });
  });

  it("accepts JPG/PNG/WebP images", () => {
    expect(validateUpload("image/jpeg", "photo.jpg", 1024)).toEqual({ ok: true });
    expect(validateUpload("image/png", "photo.png", 1024)).toEqual({ ok: true });
    expect(validateUpload("image/webp", "photo.webp", 1024)).toEqual({ ok: true });
  });

  it("accepts DOC/DOCX and XLS/XLSX", () => {
    expect(validateUpload("application/msword", "invoice.doc", 1024)).toEqual({ ok: true });
    expect(
      validateUpload(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "invoice.docx",
        1024
      )
    ).toEqual({ ok: true });
    expect(validateUpload("application/vnd.ms-excel", "sheet.xls", 1024)).toEqual({ ok: true });
    expect(
      validateUpload(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "sheet.xlsx",
        1024
      )
    ).toEqual({ ok: true });
  });

  it("rejects executable/script/html types even with a safe extension", () => {
    const result = validateUpload("application/x-msdownload", "invoice.pdf", 1024);
    expect(result.ok).toBe(false);
  });

  it("rejects a safe MIME type paired with a dangerous extension", () => {
    // mismatched declared type vs. actual filename — reject rather than trust either alone
    const result = validateUpload("application/pdf", "payload.exe", 1024);
    expect(result.ok).toBe(false);
  });

  it("accepts a free-text filename with no extension, as long as the MIME type is allowed", () => {
    // DriverApplication's camera-scan flow (handleUploadScannedDocument /
    // handleUploadSimFile) sends a driver-typed name with no extension,
    // paired with the authoritative image/png MIME type from
    // canvas.toDataURL() — this must keep working.
    expect(validateUpload("image/png", "Border Gate CMR", 1024)).toEqual({ ok: true });
  });

  it("rejects script/html/unknown binary types", () => {
    expect(validateUpload("text/html", "page.html", 1024).ok).toBe(false);
    expect(validateUpload("application/javascript", "script.js", 1024).ok).toBe(false);
    expect(validateUpload("application/octet-stream", "unknown.bin", 1024).ok).toBe(false);
  });

  it("rejects a file over the size limit", () => {
    const result = validateUpload("application/pdf", "big.pdf", MAX_UPLOAD_BYTES + 1);
    expect(result.ok).toBe(false);
  });

  it("accepts a file exactly at the size limit", () => {
    expect(validateUpload("application/pdf", "big.pdf", MAX_UPLOAD_BYTES).ok).toBe(true);
  });
});
