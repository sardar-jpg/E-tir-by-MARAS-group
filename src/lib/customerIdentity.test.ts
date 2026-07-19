import { describe, it, expect } from "vitest";
import {
  requireClientId,
  indexClientsByCompany,
  resolveRecordClientId,
  sameCustomerById,
  planClientIdBackfill,
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

describe("legacy identity resolution from the customers list", () => {
  const clients = [
    { id: "c1", companyName: "Acme" },
    { id: "c2", companyName: "Beta LLC" },
    // Ambiguous duplicate name — must NOT resolve to a single id.
    { id: "c3", companyName: "Dupe" },
    { id: "c4", companyName: "dupe" },
  ];
  const idx = indexClientsByCompany(clients);

  it("prefers the record's own clientId over any companyName lookup", () => {
    expect(resolveRecordClientId({ clientId: "cX", companyName: "Acme" }, idx)).toEqual({ ok: true, clientId: "cX" });
  });
  it("resolves a legacy record (no clientId) by exact normalized companyName", () => {
    expect(resolveRecordClientId({ companyName: "acme" }, idx)).toEqual({ ok: true, clientId: "c1" });
  });
  it("fails safely when the company name is ambiguous or unknown", () => {
    expect(resolveRecordClientId({ companyName: "Dupe" }, idx).ok).toBe(false);
    expect(resolveRecordClientId({ companyName: "Unknown Co" }, idx).ok).toBe(false);
    expect(resolveRecordClientId({}, idx).ok).toBe(false);
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

describe("backfill planning is deterministic and never guesses", () => {
  it("resolves what it can and flags the rest as unresolved", () => {
    const idx = indexClientsByCompany([{ id: "c1", companyName: "Acme" }]);
    const records = [
      { id: "r1", clientId: "c9", companyName: "Acme" }, // already has identity → skipped
      { id: "r2", companyName: "Acme" }, // resolvable
      { id: "r3", companyName: "Ghost Co" }, // unresolvable
    ];
    const plan = planClientIdBackfill(records, idx);
    expect(plan.resolved).toEqual([{ record: records[1], clientId: "c1" }]);
    expect(plan.unresolved.map((r) => r.id)).toEqual(["r3"]);
  });
});
