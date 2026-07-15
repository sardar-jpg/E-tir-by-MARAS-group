import { describe, it, expect } from "vitest";
import {
  buildCostStatementRows,
  filterCostStatementRows,
  resolveCostStatementDisplay,
  resolveStatementShipmentContext,
  resolveCostStatementShipmentNumber,
} from "./costStatementRegistryView";
import type { CostStatement, Shipment } from "../types";

function makeStatement(overrides: Partial<CostStatement> = {}): CostStatement {
  return {
    shipmentId: "shipment-1",
    shipmentNumber: "MAR-2026-1001",
    companyName: "Acme Trading",
    shipmentType: "land",
    date: "2026-01-01",
    currency: "USD",
    totalCost: 2000,
    paidAmount: 500,
    remainingBalance: 1500,
    paymentStatus: "Partial",
    notes: "",
    items: [
      {
        id: "item-1",
        costType: "Trucking",
        description: "Border to Erbil leg",
        quantity: 1,
        unitPrice: 1200,
        totalAmount: 1200,
        currency: "USD",
        supplierName: "Zagros Carriers",
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    agreedAmount: 3200,
    truckNumber: "34 ABC 123",
    ...overrides,
  };
}

function makeShipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: "shipment-1",
    shipmentNumber: "MAR-2026-1001",
    companyName: "Acme Trading",
    loadingCountry: "Iraq",
    loadingCity: "Erbil",
    loadingAddress: "Industrial Zone 1",
    loadingContactNumber: "+964 750 000 0000",
    deliveryCountry: "Turkey",
    deliveryCity: "Mersin",
    deliveryAddress: "Port Road 5",
    deliveryContactNumber: "+90 555 000 0000",
    cargoDescription: "Machinery parts",
    cargoWeight: 12000,
    truckNumber: "34 ABC 123",
    assignedDriverId: "driver-1",
    assignedDriverName: "Ahmed Yilmaz",
    agreedAmount: 3200,
    currency: "USD",
    internalNotes: "",
    status: "In Transit",
    documents: [],
    timeline: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    isLinkShared: false,
    shareToken: "tok_abc123",
    shareIncludeDocuments: true,
    shareIncludePhotos: true,
    freightType: "land",
    ...overrides,
  };
}

describe("resolveCostStatementDisplay", () => {
  it("prefers the statement's own snapshot fields when a matching shipment is absent (accounts admin, shipments === [])", () => {
    const display = resolveCostStatementDisplay(makeStatement(), undefined);
    expect(display).toMatchObject({
      shipmentId: "shipment-1",
      shipmentNumber: "MAR-2026-1001",
      companyName: "Acme Trading",
      freightType: "land",
      agreedAmount: 3200,
      currency: "USD",
      truckNumber: "34 ABC 123",
    });
    expect(display.cargoDescription).toBe("");
  });

  it("falls back to the joined shipment only for fields the statement snapshot doesn't carry (cargoDescription)", () => {
    const display = resolveCostStatementDisplay(makeStatement(), makeShipment({ cargoDescription: "Steel coils" }));
    expect(display.cargoDescription).toBe("Steel coils");
  });

  it("falls back to shipment fields for statements created before the snapshot fields existed", () => {
    const statement = makeStatement({ agreedAmount: undefined, truckNumber: undefined, companyName: "" });
    const display = resolveCostStatementDisplay(statement, makeShipment({ agreedAmount: 4100, truckNumber: "99 XYZ 456", companyName: "Fallback Co" }));
    expect(display.agreedAmount).toBe(4100);
    expect(display.truckNumber).toBe("99 XYZ 456");
    expect(display.companyName).toBe("Fallback Co");
  });
});

describe("buildCostStatementRows", () => {
  it("builds full rows from costStatements alone when shipments is empty (accounts admin)", () => {
    const rows = buildCostStatementRows([makeStatement()], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].statement).not.toBeNull();
    expect(rows[0].shipmentNumber).toBe("MAR-2026-1001");
    expect(rows[0].agreedAmount).toBe(3200);
  });

  it("does not duplicate a shipment that already has a cost statement", () => {
    const rows = buildCostStatementRows([makeStatement()], [makeShipment()]);
    expect(rows).toHaveLength(1);
    expect(rows[0].statement).not.toBeNull();
  });

  it("adds shipments without a cost statement yet as statement: null rows (super/operation only, since shipments is [] for accounts)", () => {
    const rows = buildCostStatementRows(
      [makeStatement()],
      [makeShipment(), makeShipment({ id: "shipment-2", shipmentNumber: "MAR-2026-1002" })]
    );
    expect(rows).toHaveLength(2);
    const noStatementRow = rows.find(r => r.shipmentId === "shipment-2");
    expect(noStatementRow?.statement).toBeNull();
    expect(noStatementRow?.shipmentNumber).toBe("MAR-2026-1002");
  });
});

describe("filterCostStatementRows", () => {
  const rows = buildCostStatementRows(
    [
      makeStatement({ paymentStatus: "Paid" }),
      makeStatement({
        shipmentId: "shipment-2",
        shipmentNumber: "MAR-2026-2002",
        companyName: "Zagros Metals",
        shipmentType: "sea",
        paymentStatus: "Unpaid",
        truckNumber: "",
        items: [],
      }),
    ],
    []
  );

  it("returns all rows for an empty query and 'All' filters", () => {
    expect(filterCostStatementRows(rows, "", "All", "All")).toHaveLength(2);
  });

  it("matches by shipment number", () => {
    const result = filterCostStatementRows(rows, "2002", "All", "All");
    expect(result.map(r => r.shipmentId)).toEqual(["shipment-2"]);
  });

  it("matches by company name", () => {
    const result = filterCostStatementRows(rows, "zagros metals", "All", "All");
    expect(result.map(r => r.shipmentId)).toEqual(["shipment-2"]);
  });

  it("matches by truck plate snapshot field", () => {
    const result = filterCostStatementRows(rows, "34 abc", "All", "All");
    expect(result.map(r => r.shipmentId)).toEqual(["shipment-1"]);
  });

  it("matches by supplier/cost-item text on the statement", () => {
    const result = filterCostStatementRows(rows, "zagros carriers", "All", "All");
    expect(result.map(r => r.shipmentId)).toEqual(["shipment-1"]);
  });

  it("excludes rows with no match on any field", () => {
    expect(filterCostStatementRows(rows, "nonexistent-query", "All", "All")).toHaveLength(0);
  });

  it("filters by payment status", () => {
    const result = filterCostStatementRows(rows, "", "Unpaid", "All");
    expect(result.map(r => r.shipmentId)).toEqual(["shipment-2"]);
  });

  it("filters by freight segment", () => {
    const result = filterCostStatementRows(rows, "", "All", "sea");
    expect(result.map(r => r.shipmentId)).toEqual(["shipment-2"]);
  });
});

describe("resolveStatementShipmentContext", () => {
  it("resolves agreedAmount/truckNumber/freightType from the statement snapshot when shipments is empty (accounts admin)", () => {
    const context = resolveStatementShipmentContext(makeStatement(), []);
    expect(context.agreedAmount).toBe(3200);
    expect(context.truckNumber).toBe("34 ABC 123");
    expect(context.freightType).toBe("land");
    expect(context.loadingCity).toBeUndefined();
    expect(context.deliveryCity).toBeUndefined();
    expect(context.cargoDescription).toBeUndefined();
  });

  it("adds route/cargo fields from the joined shipment when it's present (super/operation)", () => {
    const context = resolveStatementShipmentContext(makeStatement(), [makeShipment()]);
    expect(context.loadingCity).toBe("Erbil");
    expect(context.deliveryCity).toBe("Mersin");
    expect(context.cargoDescription).toBe("Machinery parts");
  });

  it("falls back to the joined shipment's agreedAmount/truckNumber for a statement predating the snapshot fields", () => {
    const statement = makeStatement({ agreedAmount: undefined, truckNumber: undefined });
    const context = resolveStatementShipmentContext(statement, [makeShipment({ agreedAmount: 5000, truckNumber: "12 QRS 789" })]);
    expect(context.agreedAmount).toBe(5000);
    expect(context.truckNumber).toBe("12 QRS 789");
  });
});

describe("resolveCostStatementShipmentNumber", () => {
  it("Accounting Phase A regression: cost statements retain the correct (authoritative) shipmentNumber, ignoring a mismatched client-supplied value", () => {
    const shipment = makeShipment({ shipmentNumber: "MAR-2026-1001" });
    expect(resolveCostStatementShipmentNumber(shipment, "MAR-2026-9999")).toBe("MAR-2026-1001");
  });

  it("Accounting Phase A regression: client requests cannot override the server-side shipmentNumber when a shipment record exists", () => {
    const shipment = makeShipment({ shipmentNumber: "MAR-2026-1001" });
    // Even an attempt to inject something other than the canonical format
    // is ignored outright whenever the authoritative shipment exists.
    expect(resolveCostStatementShipmentNumber(shipment, "eTIR-000184")).toBe("MAR-2026-1001");
    expect(resolveCostStatementShipmentNumber(shipment, "")).toBe("MAR-2026-1001");
    expect(resolveCostStatementShipmentNumber(shipment, undefined)).toBe("MAR-2026-1001");
  });

  it("falls back to the client-supplied value only when no authoritative shipment record exists at all", () => {
    expect(resolveCostStatementShipmentNumber(undefined, "MAR-2026-1001")).toBe("MAR-2026-1001");
  });

  it("falls back to an empty string when neither the shipment nor the client supplied a value", () => {
    expect(resolveCostStatementShipmentNumber(undefined, undefined)).toBe("");
  });
});
