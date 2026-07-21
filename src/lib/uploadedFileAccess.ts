/**
 * uploadedFileAccess.ts — authorization decision for the in-memory
 * `/api/uploads/:id` retrieval endpoint (audit finding F-1).
 *
 * The `uploadedFiles` map in server.ts is a NON-durable, memory/dev-only
 * fallback: in production every file is written to Firebase Storage and this
 * map stays empty, so `/api/uploads/:id` normally 404s. But in memory-fallback
 * or the gated accounting test adapter it *does* hold real bytes — currently
 * only INTERNAL ACCOUNTING documents (final cost-statement PDFs and accounting
 * attachments). The endpoint historically had no authentication and no
 * resource-level authorization, so anyone who knew or guessed an upload id
 * could read those files.
 *
 * This module is the single, framework-independent authorization decision so
 * it can be exhaustively unit-tested without booting Express. The route in
 * server.ts supplies the session, the resolved accounting-permission check,
 * and (for shipment-linked classifications) the authoritative shipment
 * ownership facts; this function decides allow / 401 / 403 / 404.
 *
 * Fail-closed principles:
 *   - No/invalid session → 401 (the route also gates this with requireAuth).
 *   - Missing or unknown classification metadata → 404 (never defaults to
 *     public or broadly-authenticated access; also non-enumerating).
 *   - Authenticated but not permitted → 403.
 *   - Unknown upload id → 404 (decided by the caller before this runs).
 *
 * No classification is broader than required. Every current producer stores
 * `internal-accounting`; the shipment-linked classifications exist so a future
 * driver-/customer-facing file can be served through the SAME re-checked route
 * (never a public token) without widening this one.
 */

export type UploadedFileClassification =
  | "internal-accounting"
  | "admin-only"
  | "shipment-participant"
  | "driver-shareable"
  | "customer-shareable"
  | "test-only";

const KNOWN_CLASSIFICATIONS: ReadonlySet<string> = new Set<UploadedFileClassification>([
  "internal-accounting",
  "admin-only",
  "shipment-participant",
  "driver-shareable",
  "customer-shareable",
  "test-only",
]);

/**
 * Authorization descriptor stored ALONGSIDE the file bytes. It is internal:
 * the retrieval route must never echo it back in an HTTP response.
 */
export interface UploadedFileAccessMeta {
  classification: UploadedFileClassification;
  /** Accounting permission required for internal-accounting / admin-only files. */
  requiredPermission?: string;
  /** Linked shipment id for the shipment-scoped classifications. */
  shipmentId?: string;
  /** Internal-only label for logs/debugging. Never returned to the client. */
  label?: string;
}

export interface UploadedFileSessionLike {
  role: string; // "admin" | "driver" | "client"
  id: string;
  adminType?: string;
}

export interface UploadedFileAuthContext {
  session: UploadedFileSessionLike | null | undefined;
  /**
   * Resolved accounting-permission predicate for the current admin session
   * (Super Admin resolves to "has everything"). Only consulted for
   * internal-accounting / admin-only classifications. Absent for non-admins.
   */
  hasPermission?: (permission: string) => boolean;
  /**
   * Authoritative shipment ownership facts resolved by the caller from the
   * real store, for shipment-linked classifications. `null` means the linked
   * shipment does not exist (fail closed). `undefined` means "not resolved"
   * (also treated as unavailable → fail closed for non-admins).
   */
  shipment?: {
    assignedDriverId?: string;
    additionalDriverIds?: string[];
    companyName?: string;
  } | null;
  /** The requesting client's own company name (for customer-facing files). */
  clientCompanyName?: string | null;
  /** Company-visibility comparison — reuse the server's existing helper. */
  companyMatches?: (shipmentCompany: string | undefined, clientCompany: string | undefined) => boolean;
}

export type UploadedFileAccessStatus = 401 | 403 | 404;
export type UploadedFileAccessDecision =
  | { ok: true }
  | { ok: false; status: UploadedFileAccessStatus; reason: string };

function deny(status: UploadedFileAccessStatus, reason: string): UploadedFileAccessDecision {
  return { ok: false, status, reason };
}

function driverOwns(
  session: UploadedFileSessionLike,
  shipment: NonNullable<UploadedFileAuthContext["shipment"]>
): boolean {
  return shipment.assignedDriverId === session.id ||
    (shipment.additionalDriverIds || []).includes(session.id);
}

export function authorizeUploadedFileAccess(
  meta: UploadedFileAccessMeta | undefined | null,
  ctx: UploadedFileAuthContext
): UploadedFileAccessDecision {
  const session = ctx.session;

  // 1) Authentication first — the route also enforces this with requireAuth,
  //    but the decision is complete on its own for deterministic testing.
  if (!session || !session.role || !session.id) {
    return deny(401, "unauthenticated");
  }

  // 2) Missing / malformed / unknown metadata → fail closed, non-enumerating.
  if (!meta || !meta.classification || !KNOWN_CLASSIFICATIONS.has(meta.classification)) {
    return deny(404, "missing_or_unknown_classification");
  }

  switch (meta.classification) {
    // Never served through the authenticated file route.
    case "test-only":
      return deny(404, "test_only_not_servable");

    case "internal-accounting":
    case "admin-only": {
      if (session.role !== "admin") return deny(403, "not_admin");
      if (meta.requiredPermission) {
        if (!ctx.hasPermission || !ctx.hasPermission(meta.requiredPermission)) {
          return deny(403, "missing_permission");
        }
      }
      return { ok: true };
    }

    case "driver-shareable": {
      if (!meta.shipmentId) return deny(404, "no_shipment_link");
      if (session.role === "admin") return { ok: true };
      if (session.role === "driver") {
        if (!ctx.shipment) return deny(404, "shipment_unavailable");
        return driverOwns(session, ctx.shipment) ? { ok: true } : deny(403, "driver_not_assigned");
      }
      return deny(403, "not_driver");
    }

    case "customer-shareable": {
      if (!meta.shipmentId) return deny(404, "no_shipment_link");
      if (session.role === "admin") return { ok: true };
      if (session.role === "client") {
        if (!ctx.shipment) return deny(404, "shipment_unavailable");
        const match = ctx.companyMatches
          ? ctx.companyMatches(ctx.shipment.companyName, ctx.clientCompanyName || undefined)
          : false;
        return match ? { ok: true } : deny(403, "client_company_mismatch");
      }
      return deny(403, "not_client");
    }

    case "shipment-participant": {
      if (!meta.shipmentId) return deny(404, "no_shipment_link");
      if (session.role === "admin") return { ok: true };
      if (!ctx.shipment) return deny(404, "shipment_unavailable");
      if (session.role === "driver") {
        return driverOwns(session, ctx.shipment) ? { ok: true } : deny(403, "driver_not_assigned");
      }
      if (session.role === "client") {
        const match = ctx.companyMatches
          ? ctx.companyMatches(ctx.shipment.companyName, ctx.clientCompanyName || undefined)
          : false;
        return match ? { ok: true } : deny(403, "client_company_mismatch");
      }
      return deny(403, "unknown_role");
    }

    default:
      // Exhaustive fail-closed guard (also satisfies the type checker).
      return deny(404, "unhandled_classification");
  }
}
