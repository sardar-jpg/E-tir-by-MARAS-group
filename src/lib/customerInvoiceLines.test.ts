import { describe, it, expect } from "vitest";
import {
  computeLineAmount, sanitizeInvoiceLine, sanitizeInvoiceLines, computeInvoiceTotals,
  hasInvoiceLines, lineServiceLabel, lineUnitLabel, priceDifference,
} from "./customerInvoiceLines";

describe("computeLineAmount — always quantity × unitPrice", () => {
  it("multiplies and rounds to 2dp; ignores any client amount", () => {
    expect(computeLineAmount(1, 2500)).toBe(2500);
    expect(computeLineAmount(3, 900)).toBe(2700);
    expect(computeLineAmount(2.5, 10.1)).toBe(25.25);
  });
});

describe("sanitizeInvoiceLine — validation + server-authoritative amount", () => {
  const base = { serviceType: "Sea Freight", quantity: 1, unit: "Shipment", unitPrice: 2500, amount: 999999 };
  it("recomputes amount and ignores the client-supplied amount", () => {
    const r = sanitizeInvoiceLine(base, "l1");
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.line.amount).toBe(2500); expect(r.line.serviceType).toBe("Sea Freight"); }
  });
  it("rejects a missing service type", () => {
    expect(sanitizeInvoiceLine({ ...base, serviceType: "" }, "l1")).toMatchObject({ ok: false, code: "missing_service_type" });
  });
  it("requires custom text when service type is Other", () => {
    expect(sanitizeInvoiceLine({ ...base, serviceType: "Other" }, "l1")).toMatchObject({ ok: false, code: "missing_custom_service" });
    const ok = sanitizeInvoiceLine({ ...base, serviceType: "Other", customServiceType: "Special handling" }, "l1");
    expect(ok.ok).toBe(true); if (ok.ok) expect(ok.line.customServiceType).toBe("Special handling");
  });
  it("requires custom text when unit is Other", () => {
    expect(sanitizeInvoiceLine({ ...base, unit: "Other" }, "l1")).toMatchObject({ ok: false, code: "missing_custom_unit" });
    const ok = sanitizeInvoiceLine({ ...base, unit: "Other", customUnit: "Box" }, "l1");
    expect(ok.ok).toBe(true); if (ok.ok) expect(ok.line.customUnit).toBe("Box");
  });
  it("rejects a non-positive quantity and a negative unit price", () => {
    expect(sanitizeInvoiceLine({ ...base, quantity: 0 }, "l1")).toMatchObject({ ok: false, code: "invalid_quantity" });
    expect(sanitizeInvoiceLine({ ...base, unitPrice: -1 }, "l1")).toMatchObject({ ok: false, code: "invalid_unit_price" });
  });
  it("allows a zero unit price", () => {
    expect(sanitizeInvoiceLine({ ...base, unitPrice: 0 }, "l1").ok).toBe(true);
  });
});

describe("sanitizeInvoiceLines — requires at least one line", () => {
  it("rejects an empty/non-array", () => {
    expect(sanitizeInvoiceLines([])).toMatchObject({ ok: false, code: "no_lines" });
    expect(sanitizeInvoiceLines(undefined)).toMatchObject({ ok: false, code: "no_lines" });
  });
  it("normalizes multiple lines with recomputed amounts", () => {
    const r = sanitizeInvoiceLines([
      { serviceType: "Sea Freight", quantity: 1, unit: "Shipment", unitPrice: 2500 },
      { serviceType: "Land Freight", quantity: 1, unit: "Trip", unitPrice: 900 },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.lines).toHaveLength(2); expect(r.lines[0].amount).toBe(2500); expect(r.lines[1].amount).toBe(900); }
  });
});

describe("computeInvoiceTotals — server-authoritative subtotal + grand total", () => {
  const lines = [
    { id: "1", serviceType: "Sea Freight", quantity: 1, unit: "Shipment", unitPrice: 2500, amount: 2500 },
    { id: "2", serviceType: "Land Freight", quantity: 1, unit: "Trip", unitPrice: 900, amount: 900 },
    { id: "3", serviceType: "Customs Clearance", quantity: 1, unit: "Service", unitPrice: 450, amount: 450 },
    { id: "4", serviceType: "Documentation Fee", quantity: 1, unit: "Service", unitPrice: 100, amount: 100 },
    { id: "5", serviceType: "Port Handling", quantity: 1, unit: "Service", unitPrice: 350, amount: 350 },
  ];
  it("sums lines to the subtotal and grand total (4,300)", () => {
    const t = computeInvoiceTotals(lines);
    expect(t.subtotal).toBe(4300);
    expect(t.grandTotal).toBe(4300);
  });
  it("applies discount, tax and additional charges: subtotal − discount + tax + additional", () => {
    const t = computeInvoiceTotals(lines, { discountAmount: 300, taxAmount: 100, additionalCharges: 50 });
    expect(t.grandTotal).toBe(4300 - 300 + 100 + 50);
  });
  it("clamps negative adjustments and never goes below zero", () => {
    const t = computeInvoiceTotals([{ id: "1", serviceType: "X", quantity: 1, unit: "Service", unitPrice: 100, amount: 100 }], { discountAmount: 999 });
    expect(t.grandTotal).toBe(0);
  });
});

describe("helpers", () => {
  it("hasInvoiceLines detects structured lines", () => {
    expect(hasInvoiceLines({ invoiceLines: [{}] as any })).toBe(true);
    expect(hasInvoiceLines({})).toBe(false);
    expect(hasInvoiceLines({ invoiceLines: [] })).toBe(false);
  });
  it("line labels prefer the custom text for Other", () => {
    expect(lineServiceLabel({ id: "1", serviceType: "Other", customServiceType: "Bespoke", quantity: 1, unit: "Service", unitPrice: 1, amount: 1 })).toBe("Bespoke");
    expect(lineUnitLabel({ id: "1", serviceType: "X", quantity: 1, unit: "Other", customUnit: "Crate", unitPrice: 1, amount: 1 })).toBe("Crate");
    expect(lineServiceLabel({ id: "1", serviceType: "Sea Freight", quantity: 1, unit: "Shipment", unitPrice: 1, amount: 1 })).toBe("Sea Freight");
  });
  it("priceDifference is grandTotal − agreed", () => {
    expect(priceDifference(4550, 4300)).toBe(250);
    expect(priceDifference(4300, 4300)).toBe(0);
  });
});
