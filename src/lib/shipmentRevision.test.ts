import { describe, it, expect } from "vitest";
import {
  INITIAL_SHIPMENT_REVISION,
  resolveStoredRevision,
  parseExpectedRevision,
  checkShipmentRevision,
  ShipmentRevisionConflictError,
  applyRevisionedShipmentUpdateMemory,
} from "./shipmentRevision";

/**
 * fix/shipment-update-concurrency
 *
 * PUT /api/shipments/:id used to read-modify-write the shipment document
 * with no concurrency check: two admins editing the same shipment close
 * together could have the later write silently overwrite fields the first
 * admin just saved. Fixed with optimistic concurrency control via a
 * server-owned numeric `revision`. These tests cover the pure comparison
 * logic and the in-memory equivalent directly; the real Firestore
 * transaction wiring in server.ts (which needs live Firebase credentials
 * to exercise for real) is instead pinned by a source-level regression
 * test in AdminPanel.test.ts-style scanning — see
 * shipmentRevisionRoute.test.ts.
 */

type TestShipment = { id: string; revision?: number; note?: string };

describe("resolveStoredRevision — legacy-record compatibility", () => {
  it("interprets a shipment with no revision field at all as revision 1", () => {
    expect(resolveStoredRevision(undefined)).toBe(1);
  });

  it("interprets null the same way", () => {
    expect(resolveStoredRevision(null)).toBe(1);
  });

  it("returns a valid stored positive integer unchanged", () => {
    expect(resolveStoredRevision(1)).toBe(1);
    expect(resolveStoredRevision(7)).toBe(7);
  });

  it("falls back to 1 for anything that should never be stored (defensive)", () => {
    expect(resolveStoredRevision(0)).toBe(1);
    expect(resolveStoredRevision(-3)).toBe(1);
    expect(resolveStoredRevision(2.5)).toBe(1);
    expect(resolveStoredRevision("3")).toBe(1);
    expect(resolveStoredRevision(NaN)).toBe(1);
  });
});

describe("parseExpectedRevision — rejects every malformed client input", () => {
  it("accepts a valid positive integer", () => {
    expect(parseExpectedRevision(1)).toBe(1);
    expect(parseExpectedRevision(42)).toBe(42);
  });

  it("rejects negative values", () => {
    expect(parseExpectedRevision(-1)).toBeNull();
  });

  it("rejects zero", () => {
    expect(parseExpectedRevision(0)).toBeNull();
  });

  it("rejects decimals", () => {
    expect(parseExpectedRevision(1.5)).toBeNull();
  });

  it("rejects strings outright, even numeric-looking ones (no coercion)", () => {
    expect(parseExpectedRevision("1")).toBeNull();
    expect(parseExpectedRevision("2")).toBeNull();
  });

  it("rejects NaN", () => {
    expect(parseExpectedRevision(NaN)).toBeNull();
  });

  it("rejects +Infinity and -Infinity", () => {
    expect(parseExpectedRevision(Infinity)).toBeNull();
    expect(parseExpectedRevision(-Infinity)).toBeNull();
  });

  it("rejects missing/null/undefined values", () => {
    expect(parseExpectedRevision(undefined)).toBeNull();
    expect(parseExpectedRevision(null)).toBeNull();
  });

  it("rejects other non-number types", () => {
    expect(parseExpectedRevision(true)).toBeNull();
    expect(parseExpectedRevision({})).toBeNull();
    expect(parseExpectedRevision([1])).toBeNull();
  });
});

describe("checkShipmentRevision — the comparison the transaction runs", () => {
  it("succeeds when expectedRevision matches a legacy (revision-less) document, treated as revision 1", () => {
    const result = checkShipmentRevision(undefined, 1);
    expect(result.ok).toBe(true);
    expect(result.currentRevision).toBe(1);
    expect(result.nextRevision).toBe(2);
  });

  it("a successful check at revision 1 always produces exactly revision 2 — never a client-chosen value", () => {
    const result = checkShipmentRevision(1, 1);
    expect(result.nextRevision).toBe(2);
  });

  it("a successful subsequent check increments again (2 -> 3)", () => {
    const result = checkShipmentRevision(2, 2);
    expect(result.ok).toBe(true);
    expect(result.nextRevision).toBe(3);
  });

  it("a stale expectedRevision is reported as a conflict, not silently accepted", () => {
    const result = checkShipmentRevision(2, 1);
    expect(result.ok).toBe(false);
    expect(result.currentRevision).toBe(2);
  });

  it("the client cannot force the next revision — nextRevision is always derived from the actual stored value, never from expectedRevision itself", () => {
    // Even if a caller "expects" a huge, made-up revision, the check just
    // reports a conflict against the real stored value — it never adopts
    // the client's number as if it were authoritative.
    const result = checkShipmentRevision(1, 999);
    expect(result.ok).toBe(false);
    expect(result.currentRevision).toBe(1);
    expect(result.nextRevision).toBe(1);
  });
});

describe("ShipmentRevisionConflictError", () => {
  it("carries the real current revision and shipment, with a stable machine-readable code", () => {
    const shipment = { id: "s1", revision: 3 };
    const err = new ShipmentRevisionConflictError(3, shipment);
    expect(err.code).toBe("SHIPMENT_VERSION_CONFLICT");
    expect(err.currentRevision).toBe(3);
    expect(err.currentShipment).toBe(shipment);
    expect(err).toBeInstanceOf(Error);
  });
});

describe("applyRevisionedShipmentUpdateMemory — local-development memory-fallback semantics", () => {
  it("updates a legacy shipment (no revision) starting from expectedRevision 1, producing revision 2", () => {
    const shipments: TestShipment[] = [{ id: "s1", note: "original" }];
    const result = applyRevisionedShipmentUpdateMemory(shipments, "s1", 1, (current, nextRevision) => ({
      ...current,
      note: "updated",
      revision: nextRevision,
    }));
    expect(result.revision).toBe(2);
    expect(result.note).toBe("updated");
    expect(shipments[0]).toEqual(result);
  });

  it("a second successful update increments again (2 -> 3)", () => {
    const shipments: TestShipment[] = [{ id: "s1", revision: 2 }];
    const result = applyRevisionedShipmentUpdateMemory(shipments, "s1", 2, (current, nextRevision) => ({
      ...current,
      revision: nextRevision,
    }));
    expect(result.revision).toBe(3);
  });

  it("a stale expectedRevision throws ShipmentRevisionConflictError and modifies nothing", () => {
    const shipments: TestShipment[] = [{ id: "s1", revision: 2, note: "server-current" }];
    const before = { ...shipments[0] };
    expect(() =>
      applyRevisionedShipmentUpdateMemory(shipments, "s1", 1, (current, nextRevision) => ({
        ...current,
        note: "stale-write",
        revision: nextRevision,
      }))
    ).toThrow(ShipmentRevisionConflictError);
    expect(shipments[0]).toEqual(before);
  });

  it("a conflict never triggers the build/write callback — buildUpdated is only invoked when the check passes", () => {
    const shipments: TestShipment[] = [{ id: "s1", revision: 5 }];
    let buildCalls = 0;
    expect(() =>
      applyRevisionedShipmentUpdateMemory(shipments, "s1", 1, (current, nextRevision) => {
        buildCalls++;
        return { ...current, revision: nextRevision };
      })
    ).toThrow(ShipmentRevisionConflictError);
    expect(buildCalls).toBe(0);
  });

  it("throws for a shipment id that doesn't exist in the store", () => {
    const shipments: TestShipment[] = [{ id: "other", revision: 1 }];
    expect(() =>
      applyRevisionedShipmentUpdateMemory(shipments, "missing", 1, (current, nextRevision) => ({
        ...current,
        revision: nextRevision,
      }))
    ).toThrow("Shipment not found");
  });

  it("two concurrent updates starting from the same expectedRevision: exactly one succeeds, exactly one conflicts, and no lost update", () => {
    // Simulates two admins who both opened the edit form while the
    // shipment was at revision 1, then both tried to save. Modeled as two
    // sequential calls against the same backing array — this function has
    // no `await` between its read and write, so this is exactly the
    // interleaving Node's single-threaded event loop can actually produce.
    const shipments: TestShipment[] = [{ id: "s1", revision: 1, note: "original" }];

    const adminA = applyRevisionedShipmentUpdateMemory(shipments, "s1", 1, (current, nextRevision) => ({
      ...current,
      note: "admin-A-change",
      revision: nextRevision,
    }));

    expect(() =>
      applyRevisionedShipmentUpdateMemory(shipments, "s1", 1, (current, nextRevision) => ({
        ...current,
        note: "admin-B-change",
        revision: nextRevision,
      }))
    ).toThrow(ShipmentRevisionConflictError);

    // Admin A's change won and is the only one ever applied; Admin B's
    // intended change was never silently merged in or lost — it simply
    // never got written, and Admin B's request received a conflict they
    // can act on (reload + retry), not a false success.
    expect(shipments[0]).toEqual(adminA);
    expect(shipments[0].note).toBe("admin-A-change");
    expect(shipments[0].revision).toBe(2);
  });
});

describe("Legacy-record compatibility end to end", () => {
  it("a legacy shipment can be edited exactly once with no prior revision, and behaves like any other shipment afterward", () => {
    const shipments: TestShipment[] = [{ id: "s1" }]; // no revision field at all
    const first = applyRevisionedShipmentUpdateMemory(shipments, "s1", INITIAL_SHIPMENT_REVISION, (current, nextRevision) => ({
      ...current,
      revision: nextRevision,
    }));
    expect(first.revision).toBe(2);

    const second = applyRevisionedShipmentUpdateMemory(shipments, "s1", 2, (current, nextRevision) => ({
      ...current,
      revision: nextRevision,
    }));
    expect(second.revision).toBe(3);
  });
});
