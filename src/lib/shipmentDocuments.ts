/**
 * shipmentDocuments.ts — the ONE place shipment-document categories are
 * defined (documents-architecture cleanup).
 *
 * Target architecture: every shipment owns one document collection, every
 * document carries common metadata only, and a category is nothing but a
 * label plus a row of policy flags in the registry below. CMR is exactly
 * one such row — it is forbidden for any other file to branch on
 * `category === 'cmr'` (or any other category literal). Code that needs
 * per-category behavior asks getDocumentCategoryPolicy() for the flags
 * and acts on the FLAG, never on the id, so a new category (or a changed
 * rule for an existing one) is a one-line data edit here and nowhere
 * else.
 *
 * The flags encode the behavior the app already had — this module changed
 * no rule, it only centralized them:
 *  - driverVisible:   read direction — may the assigned driver see/download
 *                     a document of this category? (operational paperwork
 *                     yes; accounting-capable and unclassified content no.)
 *  - driverUploadable: write direction — may a DRIVER session originate a
 *                     document/chat attachment of this category? (Only
 *                     admin-published categories say no. Admin uploads are
 *                     never gated by this flag, and finer per-role
 *                     permissions are deliberately NOT modeled yet.)
 *  - requiresExplicitClientShare: the category can carry accounting/
 *                     internal content, so the authenticated client only
 *                     sees it after an admin explicitly flips the
 *                     document's isSharedExternally on, and the anonymous
 *                     public share link never sees it at all.
 *  - sharesAsPhoto:   on the public share link this category is gated by
 *                     shareIncludePhotos instead of shareIncludeDocuments.
 */
import type { DocumentCategory } from "../types";

export interface DocumentCategoryPolicy {
  id: DocumentCategory;
  /** Canonical English display label (UIs may localize on top). */
  label: string;
  driverVisible: boolean;
  driverUploadable: boolean;
  requiresExplicitClientShare: boolean;
  sharesAsPhoto: boolean;
}

/**
 * The registry. Record<DocumentCategory, …> is deliberately exhaustive:
 * adding an id to the DocumentCategory union without adding its row here
 * is a compile error, so the union and the registry can never drift.
 */
export const DOCUMENT_CATEGORY_POLICIES: Record<DocumentCategory, DocumentCategoryPolicy> = {
  cmr: {
    id: "cmr",
    label: "CMR",
    driverVisible: true,
    // Created, signed, stamped, and published by MARAS/Admin only — a
    // driver views/downloads one but never originates one. This is a data
    // flag like any other, not special-cased code.
    driverUploadable: false,
    requiresExplicitClientShare: false,
    sharesAsPhoto: false,
  },
  invoice: {
    id: "invoice",
    label: "Commercial Invoice",
    driverVisible: false,
    driverUploadable: true,
    requiresExplicitClientShare: true,
    sharesAsPhoto: false,
  },
  packing_list: {
    id: "packing_list",
    label: "Packing List",
    driverVisible: true,
    driverUploadable: true,
    requiresExplicitClientShare: false,
    sharesAsPhoto: false,
  },
  t1: {
    id: "t1",
    label: "T1",
    // Border/transit paperwork — same class as customs documents.
    driverVisible: true,
    driverUploadable: true,
    requiresExplicitClientShare: false,
    sharesAsPhoto: false,
  },
  tir_carnet: {
    id: "tir_carnet",
    label: "TIR Carnet",
    driverVisible: true,
    driverUploadable: true,
    requiresExplicitClientShare: false,
    sharesAsPhoto: false,
  },
  customs: {
    id: "customs",
    label: "Customs Document",
    driverVisible: true,
    driverUploadable: true,
    requiresExplicitClientShare: false,
    sharesAsPhoto: false,
  },
  delivery_proof: {
    id: "delivery_proof",
    label: "Delivery Note / POD",
    driverVisible: true,
    driverUploadable: true,
    requiresExplicitClientShare: false,
    sharesAsPhoto: false,
  },
  photo: {
    id: "photo",
    label: "Photo",
    driverVisible: false,
    driverUploadable: true,
    requiresExplicitClientShare: false,
    sharesAsPhoto: true,
  },
  other: {
    id: "other",
    label: "Other",
    driverVisible: false,
    driverUploadable: true,
    // The only catch-all — it can carry anything, including internal/
    // accounting content, so it needs the explicit-share gate.
    requiresExplicitClientShare: true,
    sharesAsPhoto: false,
  },
};

export const DOCUMENT_CATEGORY_IDS = Object.keys(DOCUMENT_CATEGORY_POLICIES) as DocumentCategory[];

export function listDocumentCategories(): DocumentCategoryPolicy[] {
  return DOCUMENT_CATEGORY_IDS.map((id) => DOCUMENT_CATEGORY_POLICIES[id]);
}

export function isKnownDocumentCategory(value: unknown): value is DocumentCategory {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DOCUMENT_CATEGORY_POLICIES, value);
}

/**
 * Maps a raw, unvalidated value (request body, stored record) onto a
 * canonical category id, tolerating case/whitespace variants ("CMR",
 * " cmr ") — the same normalization the old hand-written 'cmr' upload
 * check used (PR #85), now applied uniformly to every category. Returns
 * null for anything unrecognized; callers decide what null means for
 * them (see the two callers below).
 */
export function normalizeDocumentCategory(value: unknown): DocumentCategory | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim().toLowerCase();
  return isKnownDocumentCategory(candidate) ? candidate : null;
}

/**
 * Write-time coercion for the two document-creating server paths: a
 * recognizable id (any case/spacing) is stored canonically; anything
 * else files under 'other', the catch-all — a shipment document can
 * never be stored with an unclassifiable category going forward.
 */
export function coerceDocumentCategoryForStorage(value: unknown): DocumentCategory {
  return normalizeDocumentCategory(value) ?? "other";
}

/**
 * Read-time policy for records that may predate write-time coercion:
 * older stored documents can carry an arbitrary category string, and
 * those must keep behaving exactly as they always did — hidden from
 * drivers (the old driver-visible set didn't contain them), visible to
 * the authenticated client (the old ambiguous set didn't contain them
 * either), and gated by shareIncludeDocuments on the public link.
 */
const LEGACY_UNCLASSIFIED_POLICY: DocumentCategoryPolicy = {
  id: "other",
  label: "Other",
  driverVisible: false,
  driverUploadable: true,
  requiresExplicitClientShare: false,
  sharesAsPhoto: false,
};

export function getDocumentCategoryPolicy(category: unknown): DocumentCategoryPolicy {
  return isKnownDocumentCategory(category) ? DOCUMENT_CATEGORY_POLICIES[category] : LEGACY_UNCLASSIFIED_POLICY;
}
