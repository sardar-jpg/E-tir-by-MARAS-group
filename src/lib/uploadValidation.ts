/**
 * uploadValidation.ts
 *
 * PR #46: POST /api/upload stored whatever mimeType/filename/bytes the
 * caller sent, with no server-side check at all — only the `accept=`
 * attribute on each file input (FileUploadModal, ChatCenter, AdminPanel
 * document center, DriverApplication) restricted what could be picked in
 * the UI, and that's advisory only, trivially bypassed by calling the API
 * directly. This is a defense-in-depth allowlist covering exactly the file
 * types those upload surfaces already use — not a content-sniffing
 * security boundary, since mimeType/filename remain client-supplied.
 *
 * Extracted as a pure function (same rationale as documentAccess.ts /
 * chatVisibility.ts) so it's unit testable without booting the server.
 */

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const ALLOWED_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
]);

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB per file

function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx + 1).toLowerCase();
}

export type UploadValidationResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Rejects anything outside the shipment-paperwork/photo types this app's
 * upload surfaces actually use (PDF, JPG/PNG/WebP, DOC/DOCX, XLS/XLSX) and
 * anything over MAX_UPLOAD_BYTES.
 *
 * The declared MIME type is the primary, always-enforced gate — it alone
 * already rejects HTML/SVG/scripts/executables/unknown binaries regardless
 * of filename. The filename extension is a secondary check and is only
 * enforced when a filename actually has one: DriverApplication's
 * camera-scan flow (handleUploadScannedDocument / handleUploadSimFile)
 * lets the driver type a free-text document name with no extension before
 * it's sent here with an authoritative `image/png` MIME type from
 * canvas.toDataURL() — that must keep working. What this extension check
 * does catch is a dangerous file renamed with a safe extension, or a safe
 * file's real extension mismatching an allowed-but-wrong declared MIME type
 * (e.g. a ".exe" sent with a spoofed "application/pdf" MIME type).
 */
export function validateUpload(
  mimeType: string,
  filename: string,
  byteLength: number
): UploadValidationResult {
  if (byteLength > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `File exceeds the ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB upload limit.`,
    };
  }
  if (!ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
    return {
      ok: false,
      error: "Unsupported file type. Allowed: PDF, JPG, PNG, WebP, DOC/DOCX, XLS/XLSX.",
    };
  }
  const ext = extensionOf(filename);
  if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      error: "Unsupported file type. Allowed: PDF, JPG, PNG, WebP, DOC/DOCX, XLS/XLSX.",
    };
  }
  return { ok: true };
}
