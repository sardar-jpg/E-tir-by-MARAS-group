import { describe, it, expect } from "vitest";
import {
  INVOICE_SERVICE_TYPES, INVOICE_UNITS, PAYMENT_TERMS, PRICE_DIFFERENCE_REASONS,
  SERVICE_TYPE_OTHER, UNIT_OTHER, PAYMENT_TERM_CUSTOM,
  isOtherServiceType, isOtherUnit, isCustomPaymentTerm, paymentTermDays,
} from "./invoiceLineCatalog";

describe("invoiceLineCatalog — controlled source of truth", () => {
  it("service types include the supported set + Other sentinel", () => {
    const v = INVOICE_SERVICE_TYPES.map((o) => o.value);
    for (const s of ["Sea Freight", "Air Freight", "Land Freight", "Local Transportation", "International Transportation",
      "Customs Clearance", "Customs Duty", "Port Handling", "Terminal Handling", "Documentation Fee", "Agency Fee",
      "Storage", "Warehousing", "Demurrage", "Detention", "Loading", "Unloading", "Inspection", "Insurance",
      "Delivery Service", "Border Charges", "Courier Service", "Other"]) {
      expect(v).toContain(s);
    }
    expect(SERVICE_TYPE_OTHER).toBe("Other");
  });
  it("units include the supported set + Other sentinel", () => {
    const v = INVOICE_UNITS.map((o) => o.value);
    for (const u of ["Shipment", "Container", "Truck", "Trip", "Service", "Package", "Pallet", "Ton", "Kilogram", "Cubic Meter", "Day", "Hour", "Item", "Other"]) {
      expect(v).toContain(u);
    }
    expect(UNIT_OTHER).toBe("Other");
  });
  it("payment terms include Due on receipt … 60 days + Custom", () => {
    const v = PAYMENT_TERMS.map((o) => o.value);
    for (const t of ["Due on receipt", "7 days", "15 days", "30 days", "45 days", "60 days", "Custom"]) expect(v).toContain(t);
    expect(PAYMENT_TERM_CUSTOM).toBe("Custom");
  });
  it("every option carries en/ar/tr labels", () => {
    for (const list of [INVOICE_SERVICE_TYPES, INVOICE_UNITS, PAYMENT_TERMS, PRICE_DIFFERENCE_REASONS]) {
      for (const o of list) { expect(o.label.en.length).toBeGreaterThan(0); expect(typeof o.label.ar).toBe("string"); expect(typeof o.label.tr).toBe("string"); }
    }
  });
  it("Other / Custom guards behave", () => {
    expect(isOtherServiceType("Other")).toBe(true);
    expect(isOtherServiceType("Sea Freight")).toBe(false);
    expect(isOtherUnit("Other")).toBe(true);
    expect(isCustomPaymentTerm("Custom")).toBe(true);
  });
  it("paymentTermDays maps controlled terms to net days", () => {
    expect(paymentTermDays("Due on receipt")).toBe(0);
    expect(paymentTermDays("30 days")).toBe(30);
    expect(paymentTermDays("Custom")).toBeNull();
  });
});
