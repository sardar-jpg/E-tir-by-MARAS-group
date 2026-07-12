import { describe, it, expect } from "vitest";
import {
  isNotificationForDriver,
  isNotificationReadForUser,
  addReaderToNotification,
  canMarkNotificationRead,
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
