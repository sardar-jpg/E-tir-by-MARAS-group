import { describe, it, expect } from "vitest";
import {
  isSuperAdmin,
  canViewShipmentRegistry,
  canViewDriverRoster,
  canViewGpsTracking,
  canViewAdminRoster,
  canViewClients,
  canViewVendors,
  canManageClients,
  canManageVendors,
  canViewCostStatements,
  canWriteCostStatements,
  canViewAuditLogs,
  canWriteAuditLogs,
  canViewLogisticsAnalytics,
  resolveFullAdminStatus,
  isProtectedOwnerAccount,
  canDeleteAdminAccount,
  canManageShipmentStatus,
} from "./adminAccess";

describe("isSuperAdmin", () => {
  it("is true only for 'super'", () => {
    expect(isSuperAdmin("super")).toBe(true);
    expect(isSuperAdmin("operation")).toBe(false);
    expect(isSuperAdmin("accounts")).toBe(false);
    expect(isSuperAdmin(undefined)).toBe(false);
  });
});

describe("canViewShipmentRegistry", () => {
  it("allows super and operation, blocks accounts", () => {
    expect(canViewShipmentRegistry("super")).toBe(true);
    expect(canViewShipmentRegistry("operation")).toBe(true);
    expect(canViewShipmentRegistry("accounts")).toBe(false);
    expect(canViewShipmentRegistry(undefined)).toBe(false);
  });
});

describe("canViewDriverRoster", () => {
  it("allows super and operation, blocks accounts", () => {
    expect(canViewDriverRoster("super")).toBe(true);
    expect(canViewDriverRoster("operation")).toBe(true);
    expect(canViewDriverRoster("accounts")).toBe(false);
    expect(canViewDriverRoster(undefined)).toBe(false);
  });
});

describe("canViewGpsTracking", () => {
  it("allows super and operation, blocks accounts — the GPS Tracking Map tab is internal-operations-only", () => {
    expect(canViewGpsTracking("super")).toBe(true);
    expect(canViewGpsTracking("operation")).toBe(true);
    expect(canViewGpsTracking("accounts")).toBe(false);
    expect(canViewGpsTracking(undefined)).toBe(false);
  });
});

describe("canViewAdminRoster", () => {
  it("allows only super — operation and accounts are both blocked from the Team roster", () => {
    expect(canViewAdminRoster("super")).toBe(true);
    expect(canViewAdminRoster("operation")).toBe(false);
    expect(canViewAdminRoster("accounts")).toBe(false);
    expect(canViewAdminRoster(undefined)).toBe(false);
  });
});

describe("canViewClients / canViewVendors", () => {
  it("allows super, operation, and accounts — the AdminPanel UI shows the Clients/Vendors tabs to all three", () => {
    expect(canViewClients("super")).toBe(true);
    expect(canViewClients("operation")).toBe(true);
    expect(canViewClients("accounts")).toBe(true);
    expect(canViewClients(undefined)).toBe(false);

    expect(canViewVendors("super")).toBe(true);
    expect(canViewVendors("operation")).toBe(true);
    expect(canViewVendors("accounts")).toBe(true);
    expect(canViewVendors(undefined)).toBe(false);
  });
});

describe("canManageClients / canManageVendors", () => {
  it("allows super and operation to write, blocks accounts (read-only)", () => {
    expect(canManageClients("super")).toBe(true);
    expect(canManageClients("operation")).toBe(true);
    expect(canManageClients("accounts")).toBe(false);
    expect(canManageClients(undefined)).toBe(false);

    expect(canManageVendors("super")).toBe(true);
    expect(canManageVendors("operation")).toBe(true);
    expect(canManageVendors("accounts")).toBe(false);
    expect(canManageVendors(undefined)).toBe(false);
  });
});

describe("canViewCostStatements", () => {
  it("allows super and accounts, blocks operation — the AdminPanel UI only shows 'costs' to those two", () => {
    expect(canViewCostStatements("super")).toBe(true);
    expect(canViewCostStatements("accounts")).toBe(true);
    expect(canViewCostStatements("operation")).toBe(false);
    expect(canViewCostStatements(undefined)).toBe(false);
  });
});

describe("canWriteCostStatements", () => {
  it("allows super and accounts, blocks operation — accounts admins can save the statements they can already view", () => {
    expect(canWriteCostStatements("super")).toBe(true);
    expect(canWriteCostStatements("accounts")).toBe(true);
    expect(canWriteCostStatements("operation")).toBe(false);
    expect(canWriteCostStatements(undefined)).toBe(false);
  });

  it("matches canViewCostStatements — write access never exceeds read access", () => {
    for (const adminType of ["super", "operation", "accounts", undefined]) {
      expect(canWriteCostStatements(adminType)).toBe(canViewCostStatements(adminType));
    }
  });
});

describe("canViewLogisticsAnalytics", () => {
  it("allows only super — operation never had Reports, and accounts can't fetch the shipments the charts are built from", () => {
    expect(canViewLogisticsAnalytics("super")).toBe(true);
    expect(canViewLogisticsAnalytics("operation")).toBe(false);
    expect(canViewLogisticsAnalytics("accounts")).toBe(false);
    expect(canViewLogisticsAnalytics(undefined)).toBe(false);
  });
});

describe("canViewAuditLogs", () => {
  it("allows only super — operation and accounts are both blocked from the audit/activity ledger", () => {
    expect(canViewAuditLogs("super")).toBe(true);
    expect(canViewAuditLogs("operation")).toBe(false);
    expect(canViewAuditLogs("accounts")).toBe(false);
    expect(canViewAuditLogs(undefined)).toBe(false);
  });
});

describe("canWriteAuditLogs", () => {
  it("allows super and operation — operation admins can reach the Google Workspace tab and must be able to log those actions", () => {
    expect(canWriteAuditLogs("super")).toBe(true);
    expect(canWriteAuditLogs("operation")).toBe(true);
  });

  it("blocks accounts and missing adminType", () => {
    expect(canWriteAuditLogs("accounts")).toBe(false);
    expect(canWriteAuditLogs(undefined)).toBe(false);
  });

  it("is strictly broader than canViewAuditLogs — write access is a superset of read access here, not the usual write-never-exceeds-read pattern", () => {
    for (const adminType of ["super", "operation", "accounts", undefined] as const) {
      if (canViewAuditLogs(adminType)) {
        expect(canWriteAuditLogs(adminType)).toBe(true);
      }
    }
  });
});

describe("resolveFullAdminStatus", () => {
  it("returns 401 only when there is no session at all", () => {
    expect(resolveFullAdminStatus(null)).toBe(401);
    expect(resolveFullAdminStatus(undefined)).toBe(401);
  });

  it("returns 403 — not 401 — for an authenticated session with the wrong role", () => {
    expect(resolveFullAdminStatus({ role: "client" })).toBe(403);
    expect(resolveFullAdminStatus({ role: "driver" })).toBe(403);
  });

  it("returns 403 for an authenticated admin with an insufficient adminType", () => {
    expect(resolveFullAdminStatus({ role: "admin", adminType: "accounts" })).toBe(403);
  });

  it("returns 200 for super/operation admins, leaving successful access unchanged", () => {
    expect(resolveFullAdminStatus({ role: "admin", adminType: "super" })).toBe(200);
    expect(resolveFullAdminStatus({ role: "admin", adminType: "operation" })).toBe(200);
  });
});

describe("canManageShipmentStatus (PR #111 review — dedicated shipment-status write permission)", () => {
  it("allows Super Admin", () => {
    expect(canManageShipmentStatus({ role: "admin", adminType: "super" })).toBe(true);
  });

  it("allows Operations Admin", () => {
    expect(canManageShipmentStatus({ role: "admin", adminType: "operation" })).toBe(true);
  });

  it("rejects Accounts Admin", () => {
    expect(canManageShipmentStatus({ role: "admin", adminType: "accounts" })).toBe(false);
  });

  it("rejects any other/unknown admin adminType ('Viewer'-style read-only admin included)", () => {
    expect(canManageShipmentStatus({ role: "admin", adminType: "viewer" })).toBe(false);
    expect(canManageShipmentStatus({ role: "admin", adminType: undefined })).toBe(false);
  });

  it("rejects driver and client roles regardless of adminType", () => {
    expect(canManageShipmentStatus({ role: "driver" })).toBe(false);
    expect(canManageShipmentStatus({ role: "client" })).toBe(false);
  });

  it("rejects no session at all (unauthenticated/public/shared-link)", () => {
    expect(canManageShipmentStatus(null)).toBe(false);
    expect(canManageShipmentStatus(undefined)).toBe(false);
  });

  it("is a distinct permission from canViewShipmentRegistry, not an alias of it — a future divergence between the two must not go unnoticed", () => {
    // Today both happen to allow exactly super/operation, but they are
    // separate named functions on purpose (view permission vs. write/
    // operational permission) — this pins that canManageShipmentStatus
    // does not silently become canViewShipmentRegistry(adminType) by
    // reference equality or accidental re-export.
    expect(canManageShipmentStatus).not.toBe(canViewShipmentRegistry);
  });
});


describe("isProtectedOwnerAccount", () => {
  const OWNER_EMAIL = "sardar@maras.iq";

  it("protects any record whose adminType is 'super', regardless of email", () => {
    expect(isProtectedOwnerAccount({ adminType: "super", email: "someone-else@maras.iq" }, OWNER_EMAIL)).toBe(true);
  });

  it("protects a record matching the owner email even if adminType is missing/wrong", () => {
    expect(isProtectedOwnerAccount({ email: "Sardar@Maras.IQ" }, OWNER_EMAIL)).toBe(true);
    expect(isProtectedOwnerAccount({ email: "sardar@maras.iq", adminType: "operation" }, OWNER_EMAIL)).toBe(true);
  });

  it("does not protect an unrelated operation/accounts admin", () => {
    expect(isProtectedOwnerAccount({ adminType: "operation", email: "ops@maras.iq" }, OWNER_EMAIL)).toBe(false);
    expect(isProtectedOwnerAccount({ adminType: "accounts", email: "accounts@maras.iq" }, OWNER_EMAIL)).toBe(false);
  });

  it("returns false for null/undefined candidates or a missing owner email", () => {
    expect(isProtectedOwnerAccount(null, OWNER_EMAIL)).toBe(false);
    expect(isProtectedOwnerAccount(undefined, OWNER_EMAIL)).toBe(false);
    expect(isProtectedOwnerAccount({ email: "sardar@maras.iq" }, "")).toBe(false);
  });
});

describe("canDeleteAdminAccount", () => {
  it("allows any admin type to delete their own record", () => {
    expect(canDeleteAdminAccount({ role: "admin", adminType: "operation", id: "admin-1" }, "admin-1")).toBe(true);
    expect(canDeleteAdminAccount({ role: "admin", adminType: "accounts", id: "admin-2" }, "admin-2")).toBe(true);
    expect(canDeleteAdminAccount({ role: "admin", adminType: "super", id: "sardar@maras.iq" }, "sardar@maras.iq")).toBe(true);
  });

  it("blocks an operation or accounts admin from deleting a different admin's record", () => {
    expect(canDeleteAdminAccount({ role: "admin", adminType: "operation", id: "admin-1" }, "admin-2")).toBe(false);
    expect(canDeleteAdminAccount({ role: "admin", adminType: "accounts", id: "admin-2" }, "admin-1")).toBe(false);
  });

  it("allows the super-admin to delete a different admin's record", () => {
    expect(canDeleteAdminAccount({ role: "admin", adminType: "super", id: "sardar@maras.iq" }, "admin-1")).toBe(true);
  });

  it("blocks non-admin sessions and missing sessions entirely", () => {
    expect(canDeleteAdminAccount({ role: "driver", id: "driver-1" }, "driver-1")).toBe(false);
    expect(canDeleteAdminAccount({ role: "client", id: "client-1" }, "client-1")).toBe(false);
    expect(canDeleteAdminAccount(null, "admin-1")).toBe(false);
    expect(canDeleteAdminAccount(undefined, "admin-1")).toBe(false);
  });
});
