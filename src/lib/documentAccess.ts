/**
 * documentAccess.ts
 *
 * BUG-12: uploads store a real Firebase Storage getDownloadURL() directly
 * on the document record. That URL's access token has no concept of this
 * app's state at all — once it has been handed to a browser (e.g. because
 * a shipment's public share link included it), it keeps working forever,
 * even after an admin later flips that document's isSharedExternally off.
 * Toggling visibility only ever changed what the *next* JSON response
 * contained; it never revoked anything already issued.
 *
 * This does not attempt to revoke the underlying Firebase Storage token
 * (that needs the Admin SDK's dedicated token-rotation call plus reissuing
 * every other place the same URL is stored, which is a larger storage
 * rework than this fix is scoped to). Instead, the *public* share view
 * (PublicTracking.tsx, reached with nothing but a share token, no login)
 * is changed to never hand out a raw Storage URL for a document at all —
 * it gets a server-proxied path instead (see server.ts), and every request
 * to that path re-runs isDocumentVisibleForShare below at request time. So
 * turning a document's visibility off immediately breaks the link this app
 * hands out, going forward — a raw Storage URL a visitor already copied
 * before this fix shipped remains a separate, inherent limitation of that
 * URL type, not something any app-level check can undo.
 *
 * Authenticated views (ClientDashboard, AdminPanel) are unaffected by any
 * of this — they belong to the shipment's own client/admin, not the
 * public/anonymous audience isSharedExternally exists to gate, and keep
 * receiving the real document record including its Storage URL.
 */
import type { Shipment, ShipmentDocument } from "../types";
import { getDocumentCategoryPolicy, normalizeDocumentCategory } from "./shipmentDocuments";

/*
 * Documents-architecture cleanup: every function below used to consult
 * its own hand-maintained category set (plus one literal 'cmr' string
 * comparison in the upload check). They now all read the SAME per-category
 * policy flags from the DOCUMENT_CATEGORY_POLICIES registry
 * (src/lib/shipmentDocuments.ts) — no category id appears in this file at
 * all, and no category (CMR included) gets special-cased code. Behavior
 * is unchanged; only where the rules live changed.
 */

/**
 * Read direction for the assigned driver: operational paperwork
 * (driverVisible categories) only. Accounting-capable and unclassified
 * content is withheld — a driver has no relation to customer invoices or
 * internal cost documents.
 */
export function isDocumentVisibleToDriver(doc: Pick<ShipmentDocument, "category">): boolean {
  return getDocumentCategoryPolicy(doc.category).driverVisible;
}

/**
 * Upload-direction counterpart to isDocumentVisibleToDriver — whether a
 * driver session may set this category on a document/chat attachment
 * *they* are sending. Categories flagged driverUploadable: false in the
 * registry are admin-published only (today that is CMR — created, signed,
 * stamped, approved, and published by MARAS/Admin; a driver views one but
 * never originates one).
 *
 * `category` is typed loosely (not DocumentCategory) because it comes
 * straight off an unvalidated request body. Normalization (PR #85) makes
 * case/whitespace variants of a blocked category id ("CMR", " cmr") hit
 * the same policy row; an absent/unrecognized value is NOT treated as a
 * blocked category and stays allowed, exactly as before.
 */
export function canDriverUploadDocumentCategory(category: unknown): boolean {
  const normalized = normalizeDocumentCategory(category);
  if (normalized === null) return true;
  return getDocumentCategoryPolicy(normalized).driverUploadable;
}

/**
 * Whether an approval-required document (requiresExplicitClientShare —
 * the categories capable of carrying accounting/internal content) may
 * reach the authenticated Client dashboard. Operational categories stay
 * visible by default, as they always were. isSharedExternally is reused
 * as the explicit-intent flag: it is the only existing per-document
 * "admin approved this" signal (see resolveNewDocumentSharedExternally —
 * every new document defaults to false/unapproved), so an admin has to
 * flip it before the client's own dashboard shows such a document, not
 * just before it can appear on the public tracking link.
 */
export function isDocumentVisibleToClient(
  doc: Pick<ShipmentDocument, "category" | "isSharedExternally">
): boolean {
  if (getDocumentCategoryPolicy(doc.category).requiresExplicitClientShare) {
    return Boolean(doc.isSharedExternally);
  }
  return true;
}

/**
 * Whether a document should be visible/downloadable through the public
 * share view right now. Mirrors the filter used to build the public share
 * JSON list — factored out so the download-proxy route can run the exact
 * same check at request time rather than trusting a URL/flag it saw
 * earlier.
 *
 * Public tracking is the anonymous, token-only audience — accounting/cost
 * documents (requiresExplicitClientShare categories) must never reach it,
 * even if a document's isSharedExternally happens to be on, because that
 * flag is meant to gate "share tracking link" visibility per document, and
 * an admin toggling it for an invoice (e.g. so it reaches the authenticated
 * client) must not accidentally also publish it to whoever holds the public
 * link.
 */
export function isDocumentVisibleForShare(
  doc: Pick<ShipmentDocument, "isSharedExternally" | "category">,
  shipment: Pick<Shipment, "isLinkShared" | "shareIncludeDocuments" | "shareIncludePhotos">
): boolean {
  if (!shipment.isLinkShared) return false;
  if (!doc.isSharedExternally) return false;
  const policy = getDocumentCategoryPolicy(doc.category);
  if (policy.requiresExplicitClientShare) return false;
  return policy.sharesAsPhoto ? Boolean(shipment.shareIncludePhotos) : Boolean(shipment.shareIncludeDocuments);
}

/**
 * Public-facing path for a shared document, used in place of the raw
 * Firebase Storage URL in the public share view. The actual bytes are
 * fetched server-side by the route this path points at (see server.ts),
 * which re-runs isDocumentVisibleForShare before serving anything.
 */
export function buildPublicShareDocumentPath(shareToken: string, docId: string): string {
  return `/api/share/${encodeURIComponent(shareToken)}/documents/${encodeURIComponent(docId)}`;
}

/**
 * PR #46: whether a newly created shipment document should default to
 * externally-shared. Both call sites that create a document (the
 * client_admin chat auto-save, and the direct document-center upload route
 * in server.ts) previously hardcoded/defaulted this to `true` — meaning a
 * document was public-tracking-eligible (pending only isLinkShared +
 * shareIncludeDocuments) the instant it was created, unless a caller
 * remembered to say otherwise. AdminPanel's document center has a
 * dedicated per-document eye/eye-off toggle for exactly this decision,
 * which only makes sense if new documents start hidden and an admin
 * explicitly turns one on — so the default here is `false`; only an
 * explicit `true` opts a new document into public visibility.
 */
export function resolveNewDocumentSharedExternally(explicit?: boolean): boolean {
  return explicit === true;
}
