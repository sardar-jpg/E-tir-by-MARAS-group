import { describe, it, expect } from "vitest";
import {
  sanitizeDriver,
  toClientSafeDriver,
  scopeDriverListForSession,
} from "./driverVisibility";
import type { Driver, Shipment } from "../types";

function makeDriver(overrides: Partial<Driver> = {}): Driver {
  return {
    id: "driver-1",
    name: "Ahmed Yilmaz",
    username: "ahmed",
    password: "pbkdf2$salt$hash",
    email: "ahmed@example.com",
    truckNumber: "34 ABC 123",
    phone: "+90 555 000 0000",
    activeShipmentsCount: 1,
    completedShipmentsCount: 5,
    truckType: "reefer",
    latitude: 41.01,
    longitude: 28.97,
    ...overrides,
  };
}

function makeShipment(overrides: Partial<Shipment> = {}): Partial<Shipment> {
  return {
    id: "shipment-1",
    companyName: "Acme Trading",
    assignedDriverId: "driver-1",
    additionalDrivers: [],
    ...overrides,
  };
}

describe("sanitizeDriver", () => {
  it("strips the password field and keeps everything else", () => {
    const driver = makeDriver();
    const safe = sanitizeDriver(driver);
    expect("password" in safe).toBe(false);
    expect(safe.email).toBe("ahmed@example.com");
    expect(safe.phone).toBe("+90 555 000 0000");
  });
});

describe("toClientSafeDriver", () => {
  it("only exposes non-sensitive fields — never phone/email/GPS", () => {
    const driver = makeDriver();
    const safe = toClientSafeDriver(driver);
    expect(safe).toEqual({
      id: "driver-1",
      name: "Ahmed Yilmaz",
      truckNumber: "34 ABC 123",
      truckType: "reefer",
      avatarUrl: undefined,
    });
    expect("email" in safe).toBe(false);
    expect("phone" in safe).toBe(false);
    expect("latitude" in safe).toBe(false);
    expect("longitude" in safe).toBe(false);
    expect("password" in safe).toBe(false);
  });
});

describe("scopeDriverListForSession", () => {
  const allDrivers = [
    makeDriver({ id: "driver-1", name: "Ahmed" }),
    makeDriver({ id: "driver-2", name: "Baran", email: "baran@example.com" }),
    makeDriver({ id: "driver-3", name: "Cemal", email: "cemal@example.com" }),
  ];

  it("gives a super admin the full roster, minus passwords", () => {
    const result = scopeDriverListForSession(
      allDrivers,
      { role: "admin", id: "admin-1", adminType: "super" },
      []
    );
    expect(result).toHaveLength(3);
    expect(result.every((d: any) => !("password" in d))).toBe(true);
  });

  it("gives an operation admin the full roster, minus passwords", () => {
    const result = scopeDriverListForSession(
      allDrivers,
      { role: "admin", id: "admin-2", adminType: "operation" },
      []
    );
    expect(result).toHaveLength(3);
  });

  it("gives an accounts admin nothing — the UI hides the Drivers tab from them", () => {
    const result = scopeDriverListForSession(
      allDrivers,
      { role: "admin", id: "admin-3", adminType: "accounts" },
      []
    );
    expect(result).toEqual([]);
  });

  it("gives a driver only their own record when they have no shipments", () => {
    const result = scopeDriverListForSession(
      allDrivers,
      { role: "driver", id: "driver-1" },
      []
    );
    expect(result).toHaveLength(1);
    expect((result[0] as any).id).toBe("driver-1");
    expect("password" in (result[0] as any)).toBe(false);
  });

  it("gives a driver their own record plus co-drivers on shipments they're assigned to, never unrelated drivers", () => {
    const relevantShipments = [
      makeShipment({
        assignedDriverId: "driver-1",
        additionalDrivers: [{ driverId: "driver-2", driverName: "Baran", truckNumber: "06 XYZ 456" }],
      }),
    ];
    const result = scopeDriverListForSession(
      allDrivers,
      { role: "driver", id: "driver-1" },
      relevantShipments as Shipment[]
    );
    const ids = result.map((d: any) => d.id).sort();
    expect(ids).toEqual(["driver-1", "driver-2"]);
    expect(ids).not.toContain("driver-3");
  });

  it("gives a client only minimal safe fields for drivers on their own shipments", () => {
    const relevantShipments = [makeShipment({ assignedDriverId: "driver-2" })];
    const result = scopeDriverListForSession(
      allDrivers,
      { role: "client", id: "client-1" },
      relevantShipments as Shipment[]
    );
    expect(result).toHaveLength(1);
    const driver = result[0] as any;
    expect(driver.id).toBe("driver-2");
    expect("email" in driver).toBe(false);
    expect("phone" in driver).toBe(false);
    expect("latitude" in driver).toBe(false);
    expect("password" in driver).toBe(false);
  });

  it("gives a client an empty list when they have no shipments", () => {
    const result = scopeDriverListForSession(
      allDrivers,
      { role: "client", id: "client-1" },
      []
    );
    expect(result).toEqual([]);
  });
});
