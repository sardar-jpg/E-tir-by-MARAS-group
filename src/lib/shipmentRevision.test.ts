import { describe, it, expect } from "vitest";
import {
  INITIAL_SHIPMENT_REVISION,
  resolveStoredRevision,
  parseExpectedRevision,
  checkShipmentRevision,
  ShipmentRevisionConflictError,
  applyRevisionedShipmentUpdateMemory,
  applyNarrowShipmentUpdateMemory,
  applyIsolatedShipmentUpdateMemory,
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

// Wider shape used by the operational-vs-isolated writer tests below (PR
// #111 review — over-broad revision policy correction): a status field to
// stand in for the operational (revision-incrementing) writers, and
// documents/customerEmails/isLinkShared/eta/companyName to stand in for
// the isolated (revision-preserving) writers plus a field the broad edit
// form itself can overwrite.
type TestFullShipment = {
  id: string;
  revision?: number;
  status?: string;
  documents: { id: string }[];
  customerEmails: string[];
  isLinkShared?: boolean;
  eta?: string;
  companyName?: string;
};

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

describe("applyNarrowShipmentUpdateMemory — revision-incrementing operational writers (e.g. status changes)", () => {
  it("unconditionally advances revision by exactly 1, with no expectedRevision to check", () => {
    const shipments: TestFullShipment[] = [{ id: "s1", revision: 1, status: "New", documents: [], customerEmails: [] }];
    const result = applyNarrowShipmentUpdateMemory(shipments, "s1", (current) => ({ ...current, status: "Assigned" }));
    expect(result.status).toBe("Assigned");
    expect(result.revision).toBe(2);
    expect(shipments[0]).toEqual(result);
  });

  it("an admin edit form opened before this status change correctly conflicts on its next save — broad-edit lost-update protection remains intact for operational writers", () => {
    const shipments: TestFullShipment[] = [{ id: "s1", revision: 1, status: "New", documents: [], customerEmails: [] }];
    // Admin reads the shipment at revision 1, then a driver changes status
    // before the admin saves.
    applyNarrowShipmentUpdateMemory(shipments, "s1", (current) => ({ ...current, status: "Assigned" }));
    expect(shipments[0].revision).toBe(2);

    expect(() =>
      applyRevisionedShipmentUpdateMemory(shipments, "s1", 1, (current, nextRevision) => ({
        ...current,
        companyName: "Stale Admin Edit",
        revision: nextRevision,
      }))
    ).toThrow(ShipmentRevisionConflictError);
    // The stale edit never applied.
    expect(shipments[0].companyName).toBeUndefined();
  });

  it("throws for a shipment id that doesn't exist in the store", () => {
    const shipments: TestFullShipment[] = [{ id: "other", revision: 1, documents: [], customerEmails: [] }];
    expect(() => applyNarrowShipmentUpdateMemory(shipments, "missing", (c) => c)).toThrow("Shipment not found");
  });
});

describe("applyIsolatedShipmentUpdateMemory — revision-preserving isolated writers", () => {
  it("a document upload appends atomically but preserves the stored revision", () => {
    const shipments: TestFullShipment[] = [{ id: "s1", revision: 3, documents: [], customerEmails: [] }];
    const result = applyIsolatedShipmentUpdateMemory(shipments, "s1", (current) => ({
      ...current,
      documents: [...current.documents, { id: "doc-1" }],
    }));
    expect(result.documents).toEqual([{ id: "doc-1" }]);
    expect(result.revision).toBe(3);
  });

  it("a customer subscription appends atomically but preserves the stored revision", () => {
    const shipments: TestFullShipment[] = [{ id: "s1", revision: 3, documents: [], customerEmails: [] }];
    const result = applyIsolatedShipmentUpdateMemory(shipments, "s1", (current) => ({
      ...current,
      customerEmails: [...current.customerEmails, "customer@example.com"],
    }));
    expect(result.customerEmails).toEqual(["customer@example.com"]);
    expect(result.revision).toBe(3);
  });

  it("a share-setting change preserves the stored revision", () => {
    const shipments: TestFullShipment[] = [{ id: "s1", revision: 3, documents: [], customerEmails: [], isLinkShared: false }];
    const result = applyIsolatedShipmentUpdateMemory(shipments, "s1", (current) => ({ ...current, isLinkShared: true }));
    expect(result.isLinkShared).toBe(true);
    expect(result.revision).toBe(3);
  });

  it("a distance-matrix ETA/distance cache write preserves the stored revision", () => {
    const shipments: TestFullShipment[] = [{ id: "s1", revision: 3, documents: [], customerEmails: [] }];
    const result = applyIsolatedShipmentUpdateMemory(shipments, "s1", (current) => ({ ...current, eta: "2026-01-01T00:00:00.000Z" }));
    expect(result.eta).toBe("2026-01-01T00:00:00.000Z");
    expect(result.revision).toBe(3);
  });

  it("forces revision back to the stored value even if `mutate` tries to change it (defensive)", () => {
    const shipments: TestFullShipment[] = [{ id: "s1", revision: 3, documents: [], customerEmails: [] }];
    const result = applyIsolatedShipmentUpdateMemory(shipments, "s1", (current) => ({ ...current, revision: 999 }));
    expect(result.revision).toBe(3);
  });

  it("two concurrent document appends both survive — neither upload is lost", () => {
    const shipments: TestFullShipment[] = [{ id: "s1", revision: 1, documents: [], customerEmails: [] }];
    applyIsolatedShipmentUpdateMemory(shipments, "s1", (current) => ({
      ...current,
      documents: [...current.documents, { id: "doc-A" }],
    }));
    applyIsolatedShipmentUpdateMemory(shipments, "s1", (current) => ({
      ...current,
      documents: [...current.documents, { id: "doc-B" }],
    }));
    expect(shipments[0].documents).toEqual([{ id: "doc-A" }, { id: "doc-B" }]);
    expect(shipments[0].revision).toBe(1);
  });

  it("two concurrent customer subscriptions both survive — neither subscriber is lost", () => {
    const shipments: TestFullShipment[] = [{ id: "s1", revision: 1, documents: [], customerEmails: [] }];
    applyIsolatedShipmentUpdateMemory(shipments, "s1", (current) => ({
      ...current,
      customerEmails: [...current.customerEmails, "a@example.com"],
    }));
    applyIsolatedShipmentUpdateMemory(shipments, "s1", (current) => ({
      ...current,
      customerEmails: [...current.customerEmails, "b@example.com"],
    }));
    expect(shipments[0].customerEmails).toEqual(["a@example.com", "b@example.com"]);
    expect(shipments[0].revision).toBe(1);
  });

  it("throws for a shipment id that doesn't exist in the store", () => {
    const shipments: TestFullShipment[] = [{ id: "other", revision: 1, documents: [], customerEmails: [] }];
    expect(() => applyIsolatedShipmentUpdateMemory(shipments, "missing", (c) => c)).toThrow("Shipment not found");
  });
});

describe("Cross-writer interaction (PR #111 review — over-broad revision policy correction)", () => {
  it("an admin edit form opened before document/subscription/share/distance-cache activity can still save successfully, and that save preserves every concurrently-added isolated value", () => {
    const shipments: TestFullShipment[] = [
      { id: "s1", revision: 1, documents: [], customerEmails: [], isLinkShared: false, companyName: "Acme" },
    ];

    // Admin opens the edit form here, reading revision 1. Meanwhile, none
    // of the following isolated activity touches that revision at all.
    applyIsolatedShipmentUpdateMemory(shipments, "s1", (current) => ({
      ...current,
      documents: [...current.documents, { id: "doc-1" }],
    }));
    applyIsolatedShipmentUpdateMemory(shipments, "s1", (current) => ({
      ...current,
      customerEmails: [...current.customerEmails, "customer@example.com"],
    }));
    applyIsolatedShipmentUpdateMemory(shipments, "s1", (current) => ({ ...current, isLinkShared: true }));
    applyIsolatedShipmentUpdateMemory(shipments, "s1", (current) => ({ ...current, eta: "2026-01-01T00:00:00.000Z" }));

    // None of that isolated activity advanced the revision the admin is
    // about to save against.
    expect(shipments[0].revision).toBe(1);

    // The admin's save, exactly like buildUpdatedShipment in server.ts,
    // spreads the transaction's own fresh `current` and only explicitly
    // overrides the fields the edit form actually changed.
    const saved = applyRevisionedShipmentUpdateMemory(shipments, "s1", 1, (current, nextRevision) => ({
      ...current,
      companyName: "New Co",
      revision: nextRevision,
    }));

    expect(saved.revision).toBe(2);
    expect(saved.companyName).toBe("New Co");
    // Every concurrently-added isolated value survived the admin's save.
    expect(saved.documents).toEqual([{ id: "doc-1" }]);
    expect(saved.customerEmails).toEqual(["customer@example.com"]);
    expect(saved.isLinkShared).toBe(true);
    expect(saved.eta).toBe("2026-01-01T00:00:00.000Z");
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
