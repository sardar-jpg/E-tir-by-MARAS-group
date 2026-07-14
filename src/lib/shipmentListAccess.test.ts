import { describe, it, expect } from "vitest";
import { resolveShipmentListQueryScopes } from "./shipmentListAccess";

describe("resolveShipmentListQueryScopes — Phase 2A (Firestore scalability audit, shipments/orders)", () => {
  describe("admin", () => {
    it("gets a single no-filter scope — sees everything, matching the pre-existing 'Admins see everything' behavior", () => {
      const result = resolveShipmentListQueryScopes({ role: "admin", id: "admin-1" }, null);
      expect(result).toEqual({ scopes: [[]], isEmpty: false });
    });

    it("ignores clientCompanyName entirely — an admin session is never scoped by company", () => {
      const result = resolveShipmentListQueryScopes({ role: "admin", id: "admin-1" }, "Some Company LLC");
      expect(result.scopes).toEqual([[]]);
      expect(result.isEmpty).toBe(false);
    });
  });

  describe("driver", () => {
    it("gets two independent scopes: assignedDriverId == and additionalDriverIds array-contains", () => {
      const result = resolveShipmentListQueryScopes({ role: "driver", id: "driver-1" }, null);
      expect(result.isEmpty).toBe(false);
      expect(result.scopes).toEqual([
        [{ field: "assignedDriverId", op: "==", value: "driver-1" }],
        [{ field: "additionalDriverIds", op: "array-contains", value: "driver-1" }],
      ]);
    });

    it("never becomes empty regardless of clientCompanyName (which is irrelevant to a driver)", () => {
      const result = resolveShipmentListQueryScopes({ role: "driver", id: "driver-2" }, "Irrelevant Co");
      expect(result.isEmpty).toBe(false);
    });

    it("scopes to the driver's OWN id, never another driver's — no cross-driver leakage", () => {
      const result = resolveShipmentListQueryScopes({ role: "driver", id: "driver-A" }, null);
      const values = result.scopes.flat().map((f) => f.value);
      expect(values).toEqual(["driver-A", "driver-A"]);
      expect(values).not.toContain("driver-B");
    });
  });

  describe("client", () => {
    it("gets a single companyName == scope when the client record has a company", () => {
      const result = resolveShipmentListQueryScopes({ role: "client", id: "client-1" }, "Acme Freight LLC");
      expect(result).toEqual({
        scopes: [[{ field: "companyName", op: "==", value: "Acme Freight LLC" }]],
        isEmpty: false,
      });
    });

    it("isEmpty: true when the client's own record could not be found (companyName is null) — never falls back to admin's 'no filter' scope", () => {
      const result = resolveShipmentListQueryScopes({ role: "client", id: "client-ghost" }, null);
      expect(result.isEmpty).toBe(true);
      expect(result.scopes).toEqual([]);
    });

    it("isEmpty: true when the client record exists but companyName is blank/undefined — same as no record at all", () => {
      const result = resolveShipmentListQueryScopes({ role: "client", id: "client-2" }, undefined);
      expect(result.isEmpty).toBe(true);
      expect(result.scopes).toEqual([]);
    });

    it("never leaks another company's scope — the scope is always exactly the caller's own company", () => {
      const result = resolveShipmentListQueryScopes({ role: "client", id: "client-3" }, "Company X");
      expect(result.scopes).toEqual([[{ field: "companyName", op: "==", value: "Company X" }]]);
      expect(JSON.stringify(result.scopes)).not.toContain("Company Y");
    });
  });

  it("isEmpty is the ONLY signal callers should use to short-circuit to an empty page — an empty scopes array with isEmpty:false would (correctly) never occur for any role here", () => {
    // Regression guard: fetchShipmentsPage/Since treat scopes.length === 0
    // as "no filter at all" (admin default). If a client with no company
    // ever produced { scopes: [], isEmpty: false } instead of isEmpty:
    // true, that client would see every shipment in the system.
    const admin = resolveShipmentListQueryScopes({ role: "admin", id: "a" }, null);
    const driver = resolveShipmentListQueryScopes({ role: "driver", id: "d" }, null);
    const clientWithCompany = resolveShipmentListQueryScopes({ role: "client", id: "c" }, "Co");
    const clientNoCompany = resolveShipmentListQueryScopes({ role: "client", id: "c" }, null);
    for (const r of [admin, driver, clientWithCompany]) {
      expect(r.scopes.length === 0 && !r.isEmpty).toBe(false);
    }
    expect(clientNoCompany.scopes).toEqual([]);
    expect(clientNoCompany.isEmpty).toBe(true);
  });
});
