import { describe, it, expect } from "vitest";
import {
  findDuplicateDriverField,
  isDriverApproved,
  isDriverAssignmentSafe,
  getAssignableDrivers,
  getCoreDriverSelectOptions,
  resolveDriverLoginBlock,
  canDeleteDriverAccount,
} from "./driverAccess";
import { resolveFullAdminStatus } from "./adminAccess";
import type { Driver } from "../types";

function makeDriver(overrides: Partial<Driver> = {}): Driver {
  return {
    id: "driver-1",
    name: "Ahmed Yilmaz",
    username: "ahmed",
    password: "pbkdf2$salt$hash",
    email: "ahmed@example.com",
    truckNumber: "34 ABC 123",
    phone: "+90 555 000 0000",
    activeShipmentsCount: 0,
    completedShipmentsCount: 0,
    ...overrides,
  };
}

describe("findDuplicateDriverField", () => {
  const existing = [
    makeDriver({ id: "driver-1", username: "ahmed", email: "ahmed@example.com", phone: "+90 555 000 0000" }),
  ];

  it("returns null for a candidate that collides with nothing", () => {
    expect(
      findDuplicateDriverField(existing, { username: "baran", email: "baran@example.com", phone: "+90 555 111 1111" })
    ).toBeNull();
  });

  it("catches a duplicate username, case-insensitively", () => {
    expect(findDuplicateDriverField(existing, { username: "AHMED", email: "new@example.com", phone: "+90 555 999 9999" })).toBe(
      "username"
    );
  });

  it("catches a duplicate email, case-insensitively", () => {
    expect(
      findDuplicateDriverField(existing, { username: "new_guy", email: "Ahmed@Example.com", phone: "+90 555 999 9999" })
    ).toBe("email");
  });

  it("catches a duplicate phone even when it's spaced/grouped differently", () => {
    expect(
      findDuplicateDriverField(existing, { username: "new_guy", email: "new@example.com", phone: "+905550000000" })
    ).toBe("phone");
  });

  it("does not flag a genuinely different phone number as a duplicate", () => {
    expect(
      findDuplicateDriverField(existing, { username: "new_guy", email: "new@example.com", phone: "+90 555 111 1111" })
    ).toBeNull();
  });

  it("never matches on empty/missing fields against other empty fields", () => {
    const withBlankEmail = [makeDriver({ id: "driver-2", username: "cemal", email: "", phone: "+90 555 222 2222" })];
    expect(findDuplicateDriverField(withBlankEmail, { username: "yusuf", email: "", phone: "+90 555 333 3333" })).toBeNull();
  });

  it("does not treat the 'No phone' display-fallback placeholder as a real duplicate phone value", () => {
    // POST /api/drivers/self-register (server.ts) stores "No phone" on
    // newDriver when no phone was submitted, purely as a display fallback.
    // The duplicate check must be run against the caller's RAW phone input
    // (undefined/empty here), never that placeholder — otherwise a second
    // genuinely different registrant who also omits a phone number gets
    // incorrectly rejected as a duplicate of the first.
    const withPlaceholderPhone = [makeDriver({ id: "driver-2", username: "cemal", email: "cemal@example.com", phone: "No phone" })];
    expect(
      findDuplicateDriverField(withPlaceholderPhone, { username: "yusuf", email: "yusuf@example.com", phone: undefined })
    ).toBeNull();
    expect(
      findDuplicateDriverField(withPlaceholderPhone, { username: "yusuf", email: "yusuf@example.com", phone: "" })
    ).toBeNull();
  });
});

describe("isDriverApproved / getAssignableDrivers", () => {
  it("treats a driver with no status field (pre-approval-workflow) as approved", () => {
    expect(isDriverApproved(makeDriver({ status: undefined }))).toBe(true);
  });

  it("treats status 'approved' as approved", () => {
    expect(isDriverApproved(makeDriver({ status: "approved" }))).toBe(true);
  });

  it("treats 'pending' and 'rejected' as not approved", () => {
    expect(isDriverApproved(makeDriver({ status: "pending" }))).toBe(false);
    expect(isDriverApproved(makeDriver({ status: "rejected" }))).toBe(false);
  });

  it("getAssignableDrivers excludes pending/rejected drivers, keeps approved and legacy no-status drivers", () => {
    const drivers = [
      makeDriver({ id: "d1", status: "approved" }),
      makeDriver({ id: "d2", status: "pending" }),
      makeDriver({ id: "d3", status: "rejected" }),
      makeDriver({ id: "d4", status: undefined }),
    ];
    expect(getAssignableDrivers(drivers).map(d => d.id)).toEqual(["d1", "d4"]);
  });
});

describe("isDriverAssignmentSafe", () => {
  it("allows an approved driver and a legacy driver with no status field", () => {
    expect(isDriverAssignmentSafe(makeDriver({ status: "approved" }))).toBe(true);
    expect(isDriverAssignmentSafe(makeDriver({ status: undefined }))).toBe(true);
  });

  it("blocks a pending or rejected driver", () => {
    expect(isDriverAssignmentSafe(makeDriver({ status: "pending" }))).toBe(false);
    expect(isDriverAssignmentSafe(makeDriver({ status: "rejected" }))).toBe(false);
  });

  it("treats a missing/unresolved driver (null or undefined) as safe — 'driver not found' is a different route concern, not an assignment-safety rejection", () => {
    expect(isDriverAssignmentSafe(null)).toBe(true);
    expect(isDriverAssignmentSafe(undefined)).toBe(true);
  });
});

describe("getCoreDriverSelectOptions", () => {
  const drivers = [
    makeDriver({ id: "d1", status: "approved" }),
    makeDriver({ id: "d2", status: "pending" }),
  ];

  it("returns only assignable drivers when there is no current assignment", () => {
    expect(getCoreDriverSelectOptions(drivers).map(d => d.id)).toEqual(["d1"]);
  });

  it("returns only assignable drivers when the current assignment is already assignable", () => {
    expect(getCoreDriverSelectOptions(drivers, "d1").map(d => d.id)).toEqual(["d1"]);
  });

  it("keeps a currently-assigned driver visible even if they're no longer assignable, so editing a shipment never mismatches its own value", () => {
    expect(getCoreDriverSelectOptions(drivers, "d2").map(d => d.id)).toEqual(["d1", "d2"]);
  });

  it("doesn't add a phantom option for an assignedDriverId that no longer exists at all", () => {
    expect(getCoreDriverSelectOptions(drivers, "does-not-exist").map(d => d.id)).toEqual(["d1"]);
  });
});

describe("resolveDriverLoginBlock", () => {
  it("blocks a pending driver with a clear message", () => {
    const result = resolveDriverLoginBlock("pending");
    expect(result.blocked).toBe(true);
    expect(result.message).toMatch(/pending admin approval/i);
  });

  it("blocks a rejected driver with a clear message", () => {
    const result = resolveDriverLoginBlock("rejected");
    expect(result.blocked).toBe(true);
    expect(result.message).toMatch(/not approved/i);
  });

  it("allows an approved driver through", () => {
    expect(resolveDriverLoginBlock("approved")).toEqual({ blocked: false });
  });

  it("allows a legacy driver with no status field through", () => {
    expect(resolveDriverLoginBlock(undefined)).toEqual({ blocked: false });
  });
});

describe("driver self-approval / cross-role safety (documents existing adminAccess behavior)", () => {
  it("a driver session can never pass requireFullAdmin, so a driver can never approve/reject any driver including themselves", () => {
    expect(resolveFullAdminStatus({ role: "driver" })).toBe(403);
  });

  it("an accounts-type admin session cannot approve/reject drivers either", () => {
    expect(resolveFullAdminStatus({ role: "admin", adminType: "accounts" })).toBe(403);
  });

  it("super and operation admins can", () => {
    expect(resolveFullAdminStatus({ role: "admin", adminType: "super" })).toBe(200);
    expect(resolveFullAdminStatus({ role: "admin", adminType: "operation" })).toBe(200);
  });
});

describe("canDeleteDriverAccount — DELETE /api/drivers/:id authorization (fix/apple-driver-account-deletion)", () => {
  it("a driver can delete their own account", () => {
    expect(canDeleteDriverAccount({ role: "driver", id: "driver-1" }, "driver-1")).toBe(true);
  });

  it("a driver cannot delete a different driver's account", () => {
    expect(canDeleteDriverAccount({ role: "driver", id: "driver-1" }, "driver-2")).toBe(false);
  });

  it("a client session can never delete a driver account", () => {
    expect(canDeleteDriverAccount({ role: "client", id: "driver-1" }, "driver-1")).toBe(false);
  });

  it("a super admin can delete any driver account", () => {
    expect(canDeleteDriverAccount({ role: "admin", id: "admin-1", adminType: "super" }, "driver-1")).toBe(true);
  });

  it("an operation admin can delete any driver account", () => {
    expect(canDeleteDriverAccount({ role: "admin", id: "admin-1", adminType: "operation" }, "driver-1")).toBe(true);
  });

  it("an accounts-type admin cannot delete a driver account", () => {
    expect(canDeleteDriverAccount({ role: "admin", id: "admin-1", adminType: "accounts" }, "driver-1")).toBe(false);
  });
});
