import { describe, it, expect } from "vitest";
import {
  authorizeUploadedFileAccess,
  type UploadedFileAccessMeta,
  type UploadedFileAuthContext,
} from "./uploadedFileAccess";

/** Faithful stand-in for the server's isShipmentVisibleToClientCompany. */
const companyMatches = (a: string | undefined, b: string | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

const admin = { role: "admin", id: "adm-1", adminType: "operation" as const };
const superAdmin = { role: "admin", id: "adm-super", adminType: "super" as const };
const driver = { role: "driver", id: "drv-1" };
const client = { role: "client", id: "cli-1" };

function ctx(over: Partial<UploadedFileAuthContext>): UploadedFileAuthContext {
  return { session: admin, companyMatches, ...over };
}

const internalAccounting: UploadedFileAccessMeta = {
  classification: "internal-accounting",
  requiredPermission: "costs.view",
  shipmentId: "shipment-1001",
  label: "cost-statement-final-pdf",
};

describe("authorizeUploadedFileAccess — authentication", () => {
  it("denies with 401 when there is no session", () => {
    expect(authorizeUploadedFileAccess(internalAccounting, ctx({ session: null }))).toEqual({
      ok: false, status: 401, reason: "unauthenticated",
    });
    expect(authorizeUploadedFileAccess(internalAccounting, ctx({ session: undefined }))).toMatchObject({ ok: false, status: 401 });
  });

  it("denies a session with no role/id (malformed) with 401", () => {
    expect(authorizeUploadedFileAccess(internalAccounting, ctx({ session: { role: "", id: "" } }))).toMatchObject({ ok: false, status: 401 });
  });
});

describe("authorizeUploadedFileAccess — missing/malformed metadata fails closed", () => {
  it("returns 404 for undefined metadata", () => {
    expect(authorizeUploadedFileAccess(undefined, ctx({ session: admin }))).toEqual({
      ok: false, status: 404, reason: "missing_or_unknown_classification",
    });
  });
  it("returns 404 for null metadata", () => {
    expect(authorizeUploadedFileAccess(null, ctx({ session: admin }))).toMatchObject({ ok: false, status: 404 });
  });
  it("returns 404 for an unknown classification string", () => {
    const bad = { classification: "public" as any };
    expect(authorizeUploadedFileAccess(bad, ctx({ session: admin }))).toMatchObject({ ok: false, status: 404 });
  });
  it("never returns ok for incomplete metadata, even for a super admin", () => {
    expect(authorizeUploadedFileAccess(undefined, ctx({ session: superAdmin }))).toMatchObject({ ok: false });
  });
});

describe("authorizeUploadedFileAccess — internal-accounting", () => {
  it("allows an admin WITH the required accounting permission", () => {
    const hasPermission = (p: string) => p === "costs.view";
    expect(authorizeUploadedFileAccess(internalAccounting, ctx({ session: admin, hasPermission }))).toEqual({ ok: true });
  });

  it("denies an admin WITHOUT the required accounting permission (403)", () => {
    const hasPermission = (_p: string) => false;
    expect(authorizeUploadedFileAccess(internalAccounting, ctx({ session: admin, hasPermission }))).toMatchObject({ ok: false, status: 403, reason: "missing_permission" });
  });

  it("denies an admin when no permission resolver is supplied (fail closed)", () => {
    expect(authorizeUploadedFileAccess(internalAccounting, ctx({ session: admin, hasPermission: undefined }))).toMatchObject({ ok: false, status: 403 });
  });

  it("denies a driver (403 not_admin) regardless of shipment ownership", () => {
    expect(authorizeUploadedFileAccess(internalAccounting, ctx({
      session: driver,
      shipment: { assignedDriverId: "drv-1" },
    }))).toMatchObject({ ok: false, status: 403, reason: "not_admin" });
  });

  it("denies a customer (403 not_admin) even from the shipment's company", () => {
    expect(authorizeUploadedFileAccess(internalAccounting, ctx({
      session: client,
      shipment: { companyName: "Demo Client Co." },
      clientCompanyName: "Demo Client Co.",
    }))).toMatchObject({ ok: false, status: 403, reason: "not_admin" });
  });

  it("a super admin with a hasPermission that grants everything is allowed", () => {
    const hasPermission = (_p: string) => true; // resolveEffectivePermissions(super) grants all
    expect(authorizeUploadedFileAccess(internalAccounting, ctx({ session: superAdmin, hasPermission }))).toEqual({ ok: true });
  });
});

describe("authorizeUploadedFileAccess — driver-shareable", () => {
  const meta: UploadedFileAccessMeta = { classification: "driver-shareable", shipmentId: "shipment-1001" };

  it("allows the assigned driver", () => {
    expect(authorizeUploadedFileAccess(meta, ctx({ session: driver, shipment: { assignedDriverId: "drv-1" } }))).toEqual({ ok: true });
  });
  it("allows an additional driver", () => {
    expect(authorizeUploadedFileAccess(meta, ctx({ session: driver, shipment: { assignedDriverId: "other", additionalDriverIds: ["drv-1"] } }))).toEqual({ ok: true });
  });
  it("denies an unrelated driver (403)", () => {
    expect(authorizeUploadedFileAccess(meta, ctx({ session: driver, shipment: { assignedDriverId: "someone-else" } }))).toMatchObject({ ok: false, status: 403, reason: "driver_not_assigned" });
  });
  it("denies a customer (403 not_driver)", () => {
    expect(authorizeUploadedFileAccess(meta, ctx({ session: client, shipment: { assignedDriverId: "drv-1" } }))).toMatchObject({ ok: false, status: 403, reason: "not_driver" });
  });
  it("admin may access a driver-shareable file", () => {
    expect(authorizeUploadedFileAccess(meta, ctx({ session: admin, shipment: { assignedDriverId: "drv-1" } }))).toEqual({ ok: true });
  });
  it("fails closed (404) when the linked shipment is missing for a driver", () => {
    expect(authorizeUploadedFileAccess(meta, ctx({ session: driver, shipment: null }))).toMatchObject({ ok: false, status: 404, reason: "shipment_unavailable" });
  });
  it("fails closed (404) when the metadata has no shipment link", () => {
    expect(authorizeUploadedFileAccess({ classification: "driver-shareable" }, ctx({ session: driver }))).toMatchObject({ ok: false, status: 404, reason: "no_shipment_link" });
  });
});

describe("authorizeUploadedFileAccess — customer-shareable", () => {
  const meta: UploadedFileAccessMeta = { classification: "customer-shareable", shipmentId: "shipment-1001" };

  it("allows a client from the same company", () => {
    expect(authorizeUploadedFileAccess(meta, ctx({ session: client, shipment: { companyName: "Demo Client Co." }, clientCompanyName: "Demo Client Co." }))).toEqual({ ok: true });
  });
  it("denies a client from a different company (403)", () => {
    expect(authorizeUploadedFileAccess(meta, ctx({ session: client, shipment: { companyName: "Al-Bahi" }, clientCompanyName: "Demo Client Co." }))).toMatchObject({ ok: false, status: 403, reason: "client_company_mismatch" });
  });
  it("denies a driver (403 not_client)", () => {
    expect(authorizeUploadedFileAccess(meta, ctx({ session: driver, shipment: { companyName: "Demo Client Co." }, clientCompanyName: "Demo Client Co." }))).toMatchObject({ ok: false, status: 403, reason: "not_client" });
  });
  it("fails closed (404) when the linked shipment is missing for a client", () => {
    expect(authorizeUploadedFileAccess(meta, ctx({ session: client, shipment: null, clientCompanyName: "Demo Client Co." }))).toMatchObject({ ok: false, status: 404 });
  });
});

describe("authorizeUploadedFileAccess — shipment-participant", () => {
  const meta: UploadedFileAccessMeta = { classification: "shipment-participant", shipmentId: "shipment-1001" };
  it("allows the assigned driver and the owning company client, denies outsiders", () => {
    expect(authorizeUploadedFileAccess(meta, ctx({ session: driver, shipment: { assignedDriverId: "drv-1" } }))).toEqual({ ok: true });
    expect(authorizeUploadedFileAccess(meta, ctx({ session: client, shipment: { companyName: "Co" }, clientCompanyName: "Co" }))).toEqual({ ok: true });
    expect(authorizeUploadedFileAccess(meta, ctx({ session: driver, shipment: { assignedDriverId: "x" } }))).toMatchObject({ ok: false, status: 403 });
    expect(authorizeUploadedFileAccess(meta, ctx({ session: client, shipment: { companyName: "A" }, clientCompanyName: "B" }))).toMatchObject({ ok: false, status: 403 });
  });
});

describe("authorizeUploadedFileAccess — test-only never servable, and id-swap resistance", () => {
  it("denies test-only classification (404)", () => {
    expect(authorizeUploadedFileAccess({ classification: "test-only" }, ctx({ session: superAdmin }))).toMatchObject({ ok: false, status: 404 });
  });

  it("a driver cannot reach an internal-accounting file by presenting a shipment they own (classification, not id, governs)", () => {
    // Even though the driver owns shipment-1001, an internal-accounting file
    // linked to it is admin+permission only.
    expect(authorizeUploadedFileAccess(internalAccounting, ctx({ session: driver, shipment: { assignedDriverId: "drv-1" } }))).toMatchObject({ ok: false, status: 403 });
  });
});
