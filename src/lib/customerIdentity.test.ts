import { describe, it, expect } from "vitest";
import {
  requireClientId,
  sameCustomerById,
} from "./customerIdentity";

describe("clientId is required for new accounting records", () => {
  it("accepts a non-blank id and trims it", () => {
    const r = requireClientId("  c1  ");
    expect(r).toEqual({ ok: true, clientId: "c1" });
  });
  it("rejects blank / non-string ids (companyName can never become identity)", () => {
    expect(requireClientId("").ok).toBe(false);
    expect(requireClientId("   ").ok).toBe(false);
    expect(requireClientId(undefined).ok).toBe(false);
    expect(requireClientId(42 as unknown).ok).toBe(false);
  });
});

describe("same-customer decision is by immutable id only (isolation)", () => {
  it("same companyName with DIFFERENT clientIds stays isolated", () => {
    const a = { clientId: "c1", companyName: "Acme" };
    const b = { clientId: "c2", companyName: "Acme" }; // same display name, different customer
    expect(sameCustomerById(a, b)).toBe(false);
  });
  it("same clientId is the same customer even if companyName was renamed", () => {
    expect(sameCustomerById({ clientId: "c1", companyName: "Acme" }, { clientId: "c1", companyName: "Acme Renamed" })).toBe(true);
  });
  it("a missing clientId on either side never matches (never falls back to name)", () => {
    expect(sameCustomerById({ companyName: "Acme" }, { companyName: "Acme" })).toBe(false);
    expect(sameCustomerById({ clientId: "c1" }, { companyName: "Acme" })).toBe(false);
  });
});
