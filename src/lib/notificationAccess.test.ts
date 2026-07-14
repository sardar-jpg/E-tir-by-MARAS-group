import { describe, it, expect } from "vitest";
import {
  isNotificationForDriver,
  isNotificationReadForUser,
  addReaderToNotification,
  canMarkNotificationRead,
  buildDriverClientNotificationQueryScopes,
} from "./notificationAccess";

describe("isNotificationForDriver — Notification Phase 1", () => {
  it("is true when the notification's shipmentId is one of the driver's own shipments", () => {
    const notif = { shipmentId: "ship-1" };
    expect(isNotificationForDriver(notif, "driver-1", new Set(["ship-1", "ship-2"]))).toBe(true);
  });

  it("is false when the shipmentId does not belong to the driver and there is no recipientUserId", () => {
    const notif = { shipmentId: "ship-99" };
    expect(isNotificationForDriver(notif, "driver-1", new Set(["ship-1", "ship-2"]))).toBe(false);
  });

  it("is true when recipientUserId matches the driver, even with no shipment at all — the 'Driver Approved' case", () => {
    const notif = { shipmentId: "", recipientUserId: "driver-1" };
    expect(isNotificationForDriver(notif, "driver-1", new Set())).toBe(true);
  });

  it("is false when recipientUserId is set but belongs to a different driver", () => {
    const notif = { shipmentId: "", recipientUserId: "driver-2" };
    expect(isNotificationForDriver(notif, "driver-1", new Set())).toBe(false);
  });

  it("is false for a notification with neither a matching shipment nor a matching recipientUserId", () => {
    const notif = { shipmentId: "ship-99", recipientUserId: "driver-2" };
    expect(isNotificationForDriver(notif, "driver-1", new Set(["ship-1"]))).toBe(false);
  });

  it("is true when both conditions independently match (own shipment AND directly addressed)", () => {
    const notif = { shipmentId: "ship-1", recipientUserId: "driver-1" };
    expect(isNotificationForDriver(notif, "driver-1", new Set(["ship-1"]))).toBe(true);
  });

  it("treats a missing shipmentId the same as an empty one — never a false match against an empty-string shipment id", () => {
    const notif = { recipientUserId: "driver-1" };
    expect(isNotificationForDriver(notif, "driver-1", new Set([""]))).toBe(true);
    expect(isNotificationForDriver({ shipmentId: "" }, "driver-1", new Set([""]))).toBe(false);
  });
});

describe("Per-user read state — Notification Phase 1 correction", () => {
  describe("isNotificationReadForUser / addReaderToNotification", () => {
    it("Driver A reading a notification does not mark it read for Driver B", () => {
      const notif = { readByUserIds: undefined as string[] | undefined };
      notif.readByUserIds = addReaderToNotification(notif.readByUserIds, "driver-A");
      expect(isNotificationReadForUser(notif, "driver-A")).toBe(true);
      expect(isNotificationReadForUser(notif, "driver-B")).toBe(false);
    });

    it("a Driver reading a notification does not mark it read for Admin or Client", () => {
      const notif = { readByUserIds: addReaderToNotification(undefined, "driver-1") };
      expect(isNotificationReadForUser(notif, "driver-1")).toBe(true);
      expect(isNotificationReadForUser(notif, "admin@maras.iq")).toBe(false);
      expect(isNotificationReadForUser(notif, "client-1")).toBe(false);
    });

    it("repeated reads by the same user are idempotent — no duplicate entries, same result every time", () => {
      let readByUserIds: string[] | undefined = undefined;
      readByUserIds = addReaderToNotification(readByUserIds, "driver-1");
      readByUserIds = addReaderToNotification(readByUserIds, "driver-1");
      readByUserIds = addReaderToNotification(readByUserIds, "driver-1");
      expect(readByUserIds).toEqual(["driver-1"]);
      expect(isNotificationReadForUser({ readByUserIds }, "driver-1")).toBe(true);
    });

    it("existing readByUserIds entries are preserved when a new user reads it", () => {
      const existing = ["admin@maras.iq", "driver-1"];
      const updated = addReaderToNotification(existing, "driver-2");
      expect(updated).toContain("admin@maras.iq");
      expect(updated).toContain("driver-1");
      expect(updated).toContain("driver-2");
      expect(updated).toHaveLength(3);
      // the original array passed in is untouched (pure function)
      expect(existing).toEqual(["admin@maras.iq", "driver-1"]);
    });

    it("a legacy notification with no readByUserIds field at all remains safely readable", () => {
      const legacyNotif: { read: boolean; readByUserIds?: string[] } = { read: true }; // pre-existing shape, no readByUserIds
      expect(isNotificationReadForUser(legacyNotif, "driver-1")).toBe(false);
      const afterRead = addReaderToNotification(legacyNotif.readByUserIds, "driver-1");
      expect(afterRead).toEqual(["driver-1"]);
      expect(isNotificationReadForUser({ readByUserIds: afterRead }, "driver-1")).toBe(true);
    });

    it("an empty readByUserIds array means unread for everyone, not read-by-default", () => {
      expect(isNotificationReadForUser({ readByUserIds: [] }, "driver-1")).toBe(false);
    });
  });

  describe("canMarkNotificationRead — direct-recipient channel enforcement", () => {
    it("admin can always mark any notification read, regardless of type/channel", () => {
      expect(canMarkNotificationRead({ type: "chat", channel: "internal_staff" }, "admin", "admin-1", false)).toBe(true);
      expect(canMarkNotificationRead({ type: "ai_alert" }, "admin", "admin-1", false)).toBe(true);
    });

    it("a direct recipient is REJECTED for a chat notification outside their own channel — the core fix", () => {
      // recipientUserId matches the caller (driver-1), but the notification
      // is client_admin-scoped chat — a driver must never read this, direct
      // recipient or not.
      const notif = { type: "chat", channel: "client_admin" as const, recipientUserId: "driver-1" };
      expect(canMarkNotificationRead(notif, "driver", "driver-1", false)).toBe(false);
    });

    it("a direct recipient is REJECTED for an internal_staff notification", () => {
      const notif = { type: "doc_upload", channel: "internal_staff" as const, recipientUserId: "client-1" };
      expect(canMarkNotificationRead(notif, "client", "client-1", false)).toBe(false);
    });

    it("a direct recipient is REJECTED for ai_alert regardless of channel", () => {
      const notif = { type: "ai_alert", recipientUserId: "driver-1" };
      expect(canMarkNotificationRead(notif, "driver", "driver-1", false)).toBe(false);
    });

    it("a direct recipient IS allowed for a non-channel-gated type (e.g. driver_registration, the real 'Driver Approved' case)", () => {
      const notif = { type: "driver_registration", recipientUserId: "driver-1" };
      expect(canMarkNotificationRead(notif, "driver", "driver-1", false)).toBe(true);
    });

    it("a direct recipient IS allowed for their own correctly-scoped chat channel", () => {
      const notif = { type: "chat", channel: "driver_admin" as const, recipientUserId: "driver-1" };
      expect(canMarkNotificationRead(notif, "driver", "driver-1", false)).toBe(true);
    });

    it("shipment ownership still requires the correct channel too (pre-existing PR #44 rule, unchanged)", () => {
      const notif = { type: "chat", channel: "client_admin" as const };
      expect(canMarkNotificationRead(notif, "driver", "driver-1", true)).toBe(false);
      const ownChannel = { type: "chat", channel: "driver_admin" as const };
      expect(canMarkNotificationRead(ownChannel, "driver", "driver-1", true)).toBe(true);
    });

    it("neither a direct recipient nor a shipment owner is rejected outright, before the channel check even matters", () => {
      const notif = { type: "status_update" };
      expect(canMarkNotificationRead(notif, "driver", "driver-1", false)).toBe(false);
    });
  });
});

describe("Atomic per-user read update — Notification Phase 1 correction", () => {
  it("never reads or produces a `read` value — the legacy shared flag is entirely outside this computation", () => {
    // addReaderToNotification's signature only ever takes/returns
    // readByUserIds — it cannot read or mutate a `read` field. This is
    // exactly why POST /api/notifications/:id/read (server.ts) no longer
    // sets notif.read = true: the atomic update (addNotificationReaderId)
    // only ever touches readByUserIds, both in real Firestore (a
    // field-scoped arrayUnion()) and in memory fallback (a direct
    // assignment to just this one property on the stored record) — `read`
    // is never part of that write in either path.
    const before = { read: true, readByUserIds: ["admin-1"] };
    const updated = addReaderToNotification(before.readByUserIds, "driver-1");
    expect(before.read).toBe(true); // untouched by the computation
    expect(updated).toEqual(["admin-1", "driver-1"]);
  });

  it("two different users added sequentially both remain in readByUserIds", () => {
    let readByUserIds: string[] | undefined = undefined;
    readByUserIds = addReaderToNotification(readByUserIds, "driver-A");
    readByUserIds = addReaderToNotification(readByUserIds, "driver-B");
    expect(readByUserIds).toContain("driver-A");
    expect(readByUserIds).toContain("driver-B");
    expect(readByUserIds).toHaveLength(2);
  });

  it("repeated same-user reads stay idempotent even when interleaved with a different user's read", () => {
    let readByUserIds: string[] | undefined = undefined;
    readByUserIds = addReaderToNotification(readByUserIds, "driver-A");
    readByUserIds = addReaderToNotification(readByUserIds, "driver-B");
    readByUserIds = addReaderToNotification(readByUserIds, "driver-A"); // repeat read
    expect(readByUserIds.filter((id) => id === "driver-A")).toHaveLength(1);
    expect(readByUserIds).toContain("driver-B");
    expect(readByUserIds).toHaveLength(2);
  });

  it("existing reader ids are preserved when a new reader is added", () => {
    const existing = ["admin-1", "client-1"];
    const updated = addReaderToNotification(existing, "driver-1");
    expect(updated).toEqual(expect.arrayContaining(["admin-1", "client-1", "driver-1"]));
    expect(updated).toHaveLength(3);
    // the input array itself is never mutated (pure function)
    expect(existing).toEqual(["admin-1", "client-1"]);
  });

  it("the memory-fallback union and a simulated Firestore arrayUnion produce identical results for the same input sequence", () => {
    // Firestore's arrayUnion(...elements) is documented to add each
    // element only if not already present and never duplicate. This is a
    // faithful, minimal local model of exactly that contract, used only
    // to prove addReaderToNotification (the memory-fallback path used by
    // handleAddNotificationReaderMemory in server.ts) reaches the same
    // end state a real arrayUnion() would on the production Firestore
    // path (addNotificationReaderId), for identical sequences of reader
    // ids — a logical equivalence check of the two paths' documented/pure
    // semantics, not a live Firestore call (no emulator available in this
    // environment).
    const simulateArrayUnion = (existing: string[] | undefined, newId: string): string[] => {
      const result = [...(existing ?? [])];
      if (!result.includes(newId)) result.push(newId);
      return result;
    };

    const sequence = ["driver-A", "admin-1", "driver-A", "client-1", "driver-B"];

    let memoryResult: string[] | undefined = undefined;
    for (const id of sequence) memoryResult = addReaderToNotification(memoryResult, id);

    let firestoreResult: string[] | undefined = undefined;
    for (const id of sequence) firestoreResult = simulateArrayUnion(firestoreResult, id);

    expect(new Set(memoryResult)).toEqual(new Set(firestoreResult));
    expect(memoryResult).toHaveLength(new Set(sequence).size);
  });
});

describe("Full per-role read migration — Admin, Client, Driver (Notification Phase 1 completion)", () => {
  it("Admin A reading a notification does not mark it read for Admin B", () => {
    const readByUserIds = addReaderToNotification(undefined, "admin-A@maras.iq");
    expect(isNotificationReadForUser({ readByUserIds }, "admin-A@maras.iq")).toBe(true);
    expect(isNotificationReadForUser({ readByUserIds }, "admin-B-id")).toBe(false);
  });

  it("Client Owner reading does not mark read for Client Staff on the same company, and vice versa", () => {
    const ownerId = "client-owner-1";
    const staffId = "client-staff-1";
    const afterOwnerRead = addReaderToNotification(undefined, ownerId);
    expect(isNotificationReadForUser({ readByUserIds: afterOwnerRead }, ownerId)).toBe(true);
    expect(isNotificationReadForUser({ readByUserIds: afterOwnerRead }, staffId)).toBe(false);

    // Staff then reads the same notification — Owner's own read status
    // (and the array entry proving it) must be preserved, not replaced.
    const afterStaffRead = addReaderToNotification(afterOwnerRead, staffId);
    expect(isNotificationReadForUser({ readByUserIds: afterStaffRead }, ownerId)).toBe(true);
    expect(isNotificationReadForUser({ readByUserIds: afterStaffRead }, staffId)).toBe(true);
  });

  it("Driver reading a notification does not affect Client or Admin read state", () => {
    const readByUserIds = addReaderToNotification(undefined, "driver-1");
    expect(isNotificationReadForUser({ readByUserIds }, "driver-1")).toBe(true);
    expect(isNotificationReadForUser({ readByUserIds }, "client-1")).toBe(false);
    expect(isNotificationReadForUser({ readByUserIds }, "admin@maras.iq")).toBe(false);
  });

  it("Admin 'mark all as read' (POST /api/notifications/clear, new semantics) only ever adds the calling admin's own id", () => {
    // Models the route's new per-notification behavior:
    // addReaderToNotification(existing, callingAdminId) for every doc —
    // never a replacement, never another user's id.
    const callingAdminId = "admin-A@maras.iq";
    const notifs = [
      { id: "n1", readByUserIds: undefined as string[] | undefined },
      { id: "n2", readByUserIds: ["admin-B-id"] },
      { id: "n3", readByUserIds: ["driver-1", "client-1"] },
    ];
    const updated = notifs.map((n) => ({ ...n, readByUserIds: addReaderToNotification(n.readByUserIds, callingAdminId) }));

    expect(updated[0].readByUserIds).toEqual([callingAdminId]);
    expect(updated[1].readByUserIds).toEqual(expect.arrayContaining(["admin-B-id", callingAdminId]));
    expect(updated[1].readByUserIds).toHaveLength(2);
    expect(updated[2].readByUserIds).toEqual(expect.arrayContaining(["driver-1", "client-1", callingAdminId]));
    expect(updated[2].readByUserIds).toHaveLength(3);

    // Admin B's pre-existing read status is untouched by Admin A's
    // mark-all, and Admin A's mark-all does not retroactively count as a
    // read for Admin B before it actually happened.
    expect(isNotificationReadForUser(updated[1], "admin-B-id")).toBe(true); // was already there beforehand
    expect(isNotificationReadForUser({ readByUserIds: ["admin-B-id"] }, callingAdminId)).toBe(false); // A hadn't read it yet
  });

  it("a partial Client 'mark all as read' failure leaves only the failed notification(s) unread", () => {
    // Models ClientDashboard.tsx's handleMarkAllRead: each notification's
    // local readByUserIds is only updated after its OWN POST request
    // succeeds — a failure for one id must not affect any other id's
    // already-applied update.
    const clientId = "client-1";
    const notifASucceeded = { id: "a", readByUserIds: addReaderToNotification(undefined, clientId) };
    const notifBFailed = { id: "b", readByUserIds: undefined as string[] | undefined }; // request failed, never touched
    expect(isNotificationReadForUser(notifASucceeded, clientId)).toBe(true);
    expect(isNotificationReadForUser(notifBFailed, clientId)).toBe(false);
  });

  it("existing reader ids are preserved across Driver, Client, and Admin reading the same notification independently", () => {
    let readByUserIds: string[] | undefined = undefined;
    readByUserIds = addReaderToNotification(readByUserIds, "driver-1");
    readByUserIds = addReaderToNotification(readByUserIds, "client-1");
    readByUserIds = addReaderToNotification(readByUserIds, "admin@maras.iq");
    expect(readByUserIds).toEqual(expect.arrayContaining(["driver-1", "client-1", "admin@maras.iq"]));
    expect(readByUserIds).toHaveLength(3);
  });

  it("repeated reads by any single role stay idempotent", () => {
    let readByUserIds: string[] | undefined = undefined;
    readByUserIds = addReaderToNotification(readByUserIds, "admin@maras.iq");
    readByUserIds = addReaderToNotification(readByUserIds, "admin@maras.iq");
    expect(readByUserIds).toEqual(["admin@maras.iq"]);
  });

  it("a legacy notification (no readByUserIds at all) is unread for every role until that role reads it — no data migration needed", () => {
    const legacyNotif: { read: boolean; readByUserIds?: string[] } = { read: true };
    expect(isNotificationReadForUser(legacyNotif, "admin@maras.iq")).toBe(false);
    expect(isNotificationReadForUser(legacyNotif, "client-1")).toBe(false);
    expect(isNotificationReadForUser(legacyNotif, "driver-1")).toBe(false);
  });
});

describe("buildDriverClientNotificationQueryScopes — Phase 4 (Firestore scalability audit)", () => {
  it("returns a shipmentId-in scope and a recipientUserId scope when the caller owns shipments", () => {
    const scopes = buildDriverClientNotificationQueryScopes("driver-1", ["ship-A", "ship-B"]);
    expect(scopes).toEqual([
      { field: "shipmentId", op: "in", value: ["ship-A", "ship-B"] },
      { field: "recipientUserId", op: "==", value: "driver-1" },
    ]);
  });

  it("still returns the direct-recipient scope even with zero owned shipments — a brand-new driver isn't left with no scopes at all", () => {
    const scopes = buildDriverClientNotificationQueryScopes("driver-new", []);
    expect(scopes).toEqual([{ field: "recipientUserId", op: "==", value: "driver-new" }]);
  });

  it("the recipientUserId scope always uses the caller's own session id, never a shipment id or anything else", () => {
    const scopes = buildDriverClientNotificationQueryScopes("client-42", ["ship-X"]);
    const recipientScope = scopes.find((s) => s.field === "recipientUserId");
    expect(recipientScope).toEqual({ field: "recipientUserId", op: "==", value: "client-42" });
  });

  // PR #99 review: the original implementation silently `.slice(0, 30)`d
  // ownedShipmentIds, dropping every shipment past the 30th — a driver or
  // client with more than 30 shipments would simply stop receiving
  // notifications for the rest. Fixed to chunk into as many `in` scopes
  // as needed (never discarding an id) — every size below is exercised
  // explicitly, including well past Firestore's 30-value single-query cap.
  describe("chunking — never discards an owned shipment id, at any scale", () => {
    const shipmentScopes = (n: number) => {
      const ids = Array.from({ length: n }, (_, i) => `ship-${i}`);
      return buildDriverClientNotificationQueryScopes("driver-1", ids).filter((s) => s.field === "shipmentId");
    };
    const allShipmentIdsIn = (scopes: ReturnType<typeof shipmentScopes>) =>
      scopes.flatMap((s) => s.value as string[]);

    it("0 shipments — no shipmentId scope at all, only the recipient scope", () => {
      expect(shipmentScopes(0)).toEqual([]);
    });

    it("1 shipment — a single scope with exactly that one id", () => {
      const scopes = shipmentScopes(1);
      expect(scopes).toEqual([{ field: "shipmentId", op: "in", value: ["ship-0"] }]);
    });

    it("30 shipments — exactly one scope, at the cap, with no truncation", () => {
      const scopes = shipmentScopes(30);
      expect(scopes.length).toBe(1);
      expect((scopes[0].value as string[]).length).toBe(30);
      expect(allShipmentIdsIn(scopes)).toEqual(Array.from({ length: 30 }, (_, i) => `ship-${i}`));
    });

    it("31 shipments — two scopes, every id present, none dropped", () => {
      const scopes = shipmentScopes(31);
      expect(scopes.length).toBe(2);
      expect(scopes.every((s) => (s.value as string[]).length <= 30)).toBe(true);
      expect(allShipmentIdsIn(scopes).sort()).toEqual(Array.from({ length: 31 }, (_, i) => `ship-${i}`).sort());
    });

    it("60 shipments — exactly two full scopes, every id present", () => {
      const scopes = shipmentScopes(60);
      expect(scopes.length).toBe(2);
      expect(scopes.every((s) => (s.value as string[]).length === 30)).toBe(true);
      expect(allShipmentIdsIn(scopes).sort()).toEqual(Array.from({ length: 60 }, (_, i) => `ship-${i}`).sort());
    });

    it("500 shipments — chunks correctly, every id present, no scope exceeds the Firestore `in` cap", () => {
      const scopes = shipmentScopes(500);
      expect(scopes.length).toBe(Math.ceil(500 / 30));
      expect(scopes.every((s) => (s.value as string[]).length <= 30)).toBe(true);
      const allIds = allShipmentIdsIn(scopes);
      expect(new Set(allIds).size).toBe(500); // no duplicates
      expect(allIds.sort()).toEqual(Array.from({ length: 500 }, (_, i) => `ship-${i}`).sort());
    });

    it("duplicate ids in the input are deduplicated before chunking, not double-counted", () => {
      const scopes = buildDriverClientNotificationQueryScopes("driver-1", ["ship-A", "ship-A", "ship-B"])
        .filter((s) => s.field === "shipmentId");
      expect(allShipmentIdsIn(scopes).sort()).toEqual(["ship-A", "ship-B"]);
    });
  });
});
