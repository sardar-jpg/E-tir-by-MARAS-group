/**
 * accountingAttachments.ts — pure, server-authoritative logic for accounting
 * proof/supporting attachments (Increment 6, section 13).
 *
 * Attachments are financial evidence (payment proofs, supporting docs). Raw
 * bytes NEVER live in Firestore — only this metadata does; the bytes go to the
 * approved storage adapter. Metadata is never hard-deleted: removal flips the
 * status to "removed" with a reason + actor, preserving the audit trail. File
 * type is validated by magic-byte sniff (the client MIME is not trusted) and by
 * extension, and only PDF/JPG/PNG are allowed — executables/scripts are
 * rejected. No clock, db, or session.
 */

export type AccountingAttachmentParentType =
  | "customer_payment"
  | "vendor_payment"
  | "customer_invoice"
  | "cost_statement"
  | "payment_receipt";

export const ATTACHMENT_PARENT_TYPES: readonly AccountingAttachmentParentType[] = [
  "customer_payment", "vendor_payment", "customer_invoice", "cost_statement", "payment_receipt",
];

export type AccountingAttachmentStatus = "active" | "removed";

export interface AccountingAttachment {
  attachmentId: string;
  /** Firestore doc id === attachmentId (memory-store parity). */
  id: string;
  parentType: AccountingAttachmentParentType;
  parentId: string;
  fileName: string; // randomized, safe storage-facing name
  originalFileName: string; // preserved only as metadata
  mimeType: string; // the SNIFFED (trusted) type, not the client-declared one
  sizeBytes: number;
  storagePath: string;
  uploadedAt: string;
  uploadedBy: string;
  description?: string;
  status: AccountingAttachmentStatus;
  removedAt?: string;
  removedBy?: string;
  removalReason?: string;
  /** Optional idempotency key so a repeated upload does not duplicate metadata. */
  idempotencyKey?: string;
}

/** Only these three content types are accepted for accounting proof. */
const ALLOWED = [
  { mime: "application/pdf", exts: ["pdf"] },
  { mime: "image/jpeg", exts: ["jpg", "jpeg"] },
  { mime: "image/png", exts: ["png"] },
] as const;

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15 MB

export function attachmentExtensionOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx + 1).toLowerCase();
}

/**
 * Sniff the real content type from the leading magic bytes. Returns one of the
 * allowed MIME types, or null for anything else (executables, scripts, HTML,
 * SVG, unknown binaries) — the client-declared MIME is never trusted.
 */
export function sniffAttachmentMime(bytes: Uint8Array): string | null {
  if (!bytes || bytes.length < 4) return null;
  // %PDF
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  // JPEG FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  // PNG 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  return null;
}

export type AttachmentValidationResult =
  | { ok: true; mimeType: string; extension: string }
  | { ok: false; code: "attachment_type_not_allowed" | "attachment_too_large"; error: string };

/**
 * Validate a proof upload by SNIFFED content type + extension + size. The
 * declared MIME is ignored for the security decision; the sniffed type must be
 * an allowed type and consistent with the filename extension.
 */
export function validateAttachmentUpload(params: { originalFileName: string; bytes: Uint8Array; sizeBytes: number }): AttachmentValidationResult {
  const size = Number.isFinite(params.sizeBytes) ? params.sizeBytes : (params.bytes?.length ?? 0);
  if (size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, code: "attachment_too_large", error: `File exceeds the ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB attachment limit.` };
  }
  const sniffed = sniffAttachmentMime(params.bytes);
  if (!sniffed) return { ok: false, code: "attachment_type_not_allowed", error: "Unsupported file. Only PDF, JPG, and PNG proof files are allowed." };
  const ext = attachmentExtensionOf(params.originalFileName);
  const rule = ALLOWED.find((a) => a.mime === sniffed);
  // Extension, when present, must match the sniffed type (a .exe renamed .pdf,
  // or a real PNG named .pdf, are both rejected).
  if (ext && rule && !(rule.exts as readonly string[]).includes(ext)) {
    return { ok: false, code: "attachment_type_not_allowed", error: "File extension does not match its actual content." };
  }
  return { ok: true, mimeType: sniffed, extension: rule ? rule.exts[0] : "" };
}

/** A randomized, path-traversal-safe storage filename that preserves only the extension. */
export function randomAttachmentStorageName(sniffedMime: string, randomToken: string): string {
  const ext = ALLOWED.find((a) => a.mime === sniffedMime)?.exts[0] || "bin";
  const safe = randomToken.replace(/[^a-zA-Z0-9]/g, "").slice(0, 40) || "file";
  return `${safe}.${ext}`;
}

/** The storage path for an attachment — segments are sanitized (no traversal). */
export function attachmentStoragePath(parentType: AccountingAttachmentParentType, parentId: string, storageName: string): string {
  const safeParent = String(parentId).replace(/[^a-zA-Z0-9_-]/g, "");
  return `accounting-attachments/${parentType}/${safeParent}/${storageName}`;
}

export function buildAttachmentMetadata(params: {
  attachmentId: string;
  parentType: AccountingAttachmentParentType;
  parentId: string;
  storageName: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  uploadedAt: string;
  uploadedBy: string;
  description?: string;
  idempotencyKey?: string;
}): AccountingAttachment {
  return {
    attachmentId: params.attachmentId,
    id: params.attachmentId,
    parentType: params.parentType,
    parentId: params.parentId,
    fileName: params.storageName,
    originalFileName: String(params.originalFileName).slice(0, 255),
    mimeType: params.mimeType,
    sizeBytes: params.sizeBytes,
    storagePath: params.storagePath,
    uploadedAt: params.uploadedAt,
    uploadedBy: params.uploadedBy,
    description: params.description ? String(params.description).slice(0, 500) : undefined,
    status: "active",
    idempotencyKey: params.idempotencyKey,
  };
}

export type AttachmentRemovalResult =
  | { ok: true; attachment: AccountingAttachment }
  | { ok: false; code: "removal_reason_required" | "already_removed"; error: string };

/** Soft-remove an attachment (reason required). Metadata is preserved forever. */
export function applyAttachmentRemoval(attachment: AccountingAttachment, params: { reason: string; actor: string; nowIso: string }): AttachmentRemovalResult {
  if (!params.reason || !params.reason.trim()) return { ok: false, code: "removal_reason_required", error: "A removal reason is required." };
  if (attachment.status === "removed") return { ok: false, code: "already_removed", error: "This attachment was already removed." };
  return {
    ok: true,
    attachment: { ...attachment, status: "removed", removedAt: params.nowIso, removedBy: params.actor, removalReason: params.reason.slice(0, 1000) },
  };
}

/** Vendor + cost-statement proofs are internal only; customer/receipt/invoice proofs are internal unless explicitly shared. */
export function isInternalOnlyAttachmentParent(parentType: AccountingAttachmentParentType): boolean {
  return parentType === "vendor_payment" || parentType === "cost_statement";
}
