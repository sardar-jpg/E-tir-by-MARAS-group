import { describe, it, expect } from "vitest";
import {
  DEFAULT_ADMIN_NOTIFICATION_PREFERENCES,
  resolveAdminNotificationPreferences,
  sanitizeNotificationPreferencesUpdate,
  mapNotificationToPreferenceCategory,
  isNotificationCategoryEnabledForAdmin,
  shouldDeliverNotificationToAdmin,
  filterAdminRecipientsByPreferences,
  NOTIFICATION_PREFERENCE_CATEGORIES,
} from "./notificationPreferences";

describe("resolveAdminNotificationPreferences — defaults", () => {
  it("a legacy admin with no saved preferences document gets every category enabled", () => {
    expect(resolveAdminNotificationPreferences(undefined)).toEqual(DEFAULT_ADMIN_NOTIFICATION_PREFERENCES);
    expect(resolveAdminNotificationPreferences(null)).toEqual(DEFAULT_ADMIN_NOTIFICATION_PREFERENCES);
    expect(resolveAdminNotificationPreferences({})).toEqual(DEFAULT_ADMIN_NOTIFICATION_PREFERENCES);
  });

  it("every default category is true, including security_system_alerts", () => {
    for (const category of NOTIFICATION_PREFERENCE_CATEGORIES) {
      expect(DEFAULT_ADMIN_NOTIFICATION_PREFERENCES[category]).toBe(true);
    }
  });

  it("a partially-saved document keeps its saved values and defaults the rest", () => {
    const resolved = resolveAdminNotificationPreferences({ shipment_updates: false });
    expect(resolved.shipment_updates).toBe(false);
    expect(resolved.customer_messages).toBe(true);
    expect(resolved.driver_messages).toBe(true);
  });

  it("security_system_alerts is forced true even if a stored document somehow has it false", () => {
    const resolved = resolveAdminNotificationPreferences({ security_system_alerts: false });
    expect(resolved.security_system_alerts).toBe(true);
  });

  it("a non-boolean stored value for a category is treated as missing (falls back to the default)", () => {
    const resolved = resolveAdminNotificationPreferences({ accounting_alerts: "false" as any });
    expect(resolved.accounting_alerts).toBe(true);
  });
});

describe("Per-admin isolation", () => {
  it("two different admins' stored preferences resolve completely independently", () => {
    const adminA = resolveAdminNotificationPreferences({ shipment_updates: false, driver_messages: false });
    const adminB = resolveAdminNotificationPreferences({ customer_messages: false });
    expect(adminA.shipment_updates).toBe(false);
    expect(adminA.driver_messages).toBe(false);
    expect(adminA.customer_messages).toBe(true);
    expect(adminB.customer_messages).toBe(false);
    expect(adminB.shipment_updates).toBe(true);
    expect(adminB.driver_messages).toBe(true);
  });

  it("Super Admin, Operations Admin, and Accounts Admin can each hold different saved preferences with no cross-effect", () => {
    // Storage is one document per admin session id — these three admin
    // types are just three different ids to this model, resolved
    // independently. The model itself is agnostic to adminType; the
    // isolation comes entirely from each admin having its own document,
    // modeled here as three independent resolve calls.
    const superAdminPrefs = resolveAdminNotificationPreferences({ accounting_alerts: false });
    const opsAdminPrefs = resolveAdminNotificationPreferences({ driver_messages: false });
    const accountsAdminPrefs = resolveAdminNotificationPreferences({ shipment_updates: false });
    expect(superAdminPrefs.accounting_alerts).toBe(false);
    expect(superAdminPrefs.driver_messages).toBe(true);
    expect(opsAdminPrefs.driver_messages).toBe(false);
    expect(opsAdminPrefs.accounting_alerts).toBe(true);
    expect(accountsAdminPrefs.shipment_updates).toBe(false);
    expect(accountsAdminPrefs.accounting_alerts).toBe(true);
  });

  it("sub-admin id (a Firestore admins/{id} doc id) and super-admin id (an email) are just opaque strings to this model — resolution never depends on id shape", () => {
    // Mirrors the Notification Phase 1 finding: req.session.id is the
    // super-admin's email, but a sub-admin's own `admins/{id}` Firestore
    // document id (a distinct value from their email) — see
    // AdminPanel.tsx's ownAdminId / getOwnSessionId(). This model takes no
    // id parameter of its own (the id is only ever used by server.ts as
    // the Firestore document key), so it is inherently correct for both
    // shapes; this test proves resolution genuinely doesn't care what the
    // key looked like, only what was stored under it.
    const superAdminStored = { driver_messages: false }; // stored under id === "sardar@maras.iq"
    const subAdminStored = { driver_messages: true }; // stored under id === "admin-doc-id-abc123"
    const superAdminPrefs = resolveAdminNotificationPreferences(superAdminStored);
    const subAdminPrefs = resolveAdminNotificationPreferences(subAdminStored);
    expect(superAdminPrefs.driver_messages).toBe(false);
    expect(subAdminPrefs.driver_messages).toBe(true);
  });
});

describe("sanitizeNotificationPreferencesUpdate", () => {
  it("applies a valid boolean update to a known category", () => {
    const result = sanitizeNotificationPreferencesUpdate(DEFAULT_ADMIN_NOTIFICATION_PREFERENCES, { shipment_updates: false });
    expect(result.preferences.shipment_updates).toBe(false);
    expect(result.invalidKeys).toEqual([]);
  });

  it("security_system_alerts cannot be disabled — the attempt is ignored, not applied, and flagged", () => {
    const result = sanitizeNotificationPreferencesUpdate(DEFAULT_ADMIN_NOTIFICATION_PREFERENCES, { security_system_alerts: false });
    expect(result.preferences.security_system_alerts).toBe(true);
    expect(result.securityAlertsDisableAttempted).toBe(true);
    expect(result.invalidKeys).toEqual([]); // not treated as an invalid request — silently ignored
  });

  it("a request disabling security_system_alerts alongside other valid changes still applies the other changes", () => {
    const result = sanitizeNotificationPreferencesUpdate(DEFAULT_ADMIN_NOTIFICATION_PREFERENCES, {
      security_system_alerts: false,
      driver_messages: false,
    });
    expect(result.preferences.security_system_alerts).toBe(true);
    expect(result.preferences.driver_messages).toBe(false);
  });

  it("explicitly setting security_system_alerts: true is accepted (a no-op, already always true)", () => {
    const result = sanitizeNotificationPreferencesUpdate(DEFAULT_ADMIN_NOTIFICATION_PREFERENCES, { security_system_alerts: true });
    expect(result.preferences.security_system_alerts).toBe(true);
    expect(result.securityAlertsDisableAttempted).toBe(false);
  });

  it("a non-boolean value for a known category is flagged invalid, not silently coerced", () => {
    const result = sanitizeNotificationPreferencesUpdate(DEFAULT_ADMIN_NOTIFICATION_PREFERENCES, { shipment_updates: "false" });
    expect(result.invalidKeys).toEqual(["shipment_updates"]);
    expect(result.preferences.shipment_updates).toBe(true); // unchanged from existing
  });

  it("an unrecognized key is ignored, not treated as invalid", () => {
    const result = sanitizeNotificationPreferencesUpdate(DEFAULT_ADMIN_NOTIFICATION_PREFERENCES, { made_up_category: false });
    expect(result.unknownKeys).toEqual(["made_up_category"]);
    expect(result.invalidKeys).toEqual([]);
  });

  it("null/undefined/non-object input changes nothing and reports no errors", () => {
    expect(sanitizeNotificationPreferencesUpdate(DEFAULT_ADMIN_NOTIFICATION_PREFERENCES, null).preferences).toEqual(DEFAULT_ADMIN_NOTIFICATION_PREFERENCES);
    expect(sanitizeNotificationPreferencesUpdate(DEFAULT_ADMIN_NOTIFICATION_PREFERENCES, undefined).preferences).toEqual(DEFAULT_ADMIN_NOTIFICATION_PREFERENCES);
    expect(sanitizeNotificationPreferencesUpdate(DEFAULT_ADMIN_NOTIFICATION_PREFERENCES, "not an object").preferences).toEqual(DEFAULT_ADMIN_NOTIFICATION_PREFERENCES);
    expect(sanitizeNotificationPreferencesUpdate(DEFAULT_ADMIN_NOTIFICATION_PREFERENCES, ["array"]).preferences).toEqual(DEFAULT_ADMIN_NOTIFICATION_PREFERENCES);
  });

  it("preserves categories not mentioned in the update", () => {
    const existing = resolveAdminNotificationPreferences({ cmr_pod: false, accounting_alerts: false });
    const result = sanitizeNotificationPreferencesUpdate(existing, { driver_messages: false });
    expect(result.preferences.cmr_pod).toBe(false);
    expect(result.preferences.accounting_alerts).toBe(false);
    expect(result.preferences.driver_messages).toBe(false);
    expect(result.preferences.shipment_updates).toBe(true);
  });
});

describe("mapNotificationToPreferenceCategory", () => {
  it("maps every shipment-lifecycle type to shipment_updates", () => {
    for (const type of ["assignment", "acceptance", "rejection", "status_update", "delivery"]) {
      expect(mapNotificationToPreferenceCategory(type)).toBe("shipment_updates");
    }
  });

  it("maps chat by channel: client_admin -> customer_messages, driver_admin -> driver_messages", () => {
    expect(mapNotificationToPreferenceCategory("chat", "client_admin")).toBe("customer_messages");
    expect(mapNotificationToPreferenceCategory("chat", "driver_admin")).toBe("driver_messages");
  });

  it("chat with internal_staff channel, or no channel at all, has no clear category (null)", () => {
    expect(mapNotificationToPreferenceCategory("chat", "internal_staff")).toBeNull();
    expect(mapNotificationToPreferenceCategory("chat")).toBeNull();
  });

  it("maps doc_upload to document_uploads", () => {
    expect(mapNotificationToPreferenceCategory("doc_upload")).toBe("document_uploads");
  });

  it("maps driver_registration and ai_alert to security_system_alerts", () => {
    expect(mapNotificationToPreferenceCategory("driver_registration")).toBe("security_system_alerts");
    expect(mapNotificationToPreferenceCategory("ai_alert")).toBe("security_system_alerts");
  });

  it("an unknown/future notification type has no clear category (null) rather than a guess", () => {
    expect(mapNotificationToPreferenceCategory("some_future_type_not_yet_invented")).toBeNull();
  });
});

describe("isNotificationCategoryEnabledForAdmin / shouldDeliverNotificationToAdmin", () => {
  it("a null category (unknown notification type) always defaults to enabled, regardless of preferences", () => {
    const allDisabled: any = Object.fromEntries(NOTIFICATION_PREFERENCE_CATEGORIES.map((c) => [c, false]));
    expect(isNotificationCategoryEnabledForAdmin(allDisabled, null)).toBe(true);
    expect(shouldDeliverNotificationToAdmin(allDisabled, "some_future_type_not_yet_invented")).toBe(true);
  });

  it("security_system_alerts is always delivered even if somehow stored as false", () => {
    const corrupted: any = { ...DEFAULT_ADMIN_NOTIFICATION_PREFERENCES, security_system_alerts: false };
    expect(isNotificationCategoryEnabledForAdmin(corrupted, "security_system_alerts")).toBe(true);
    expect(shouldDeliverNotificationToAdmin(corrupted, "ai_alert")).toBe(true);
    expect(shouldDeliverNotificationToAdmin(corrupted, "driver_registration")).toBe(true);
  });

  it("a disabled category suppresses delivery for that admin", () => {
    const prefs = resolveAdminNotificationPreferences({ driver_messages: false });
    expect(shouldDeliverNotificationToAdmin(prefs, "chat", "driver_admin")).toBe(false);
  });

  it("an enabled category still delivers", () => {
    const prefs = resolveAdminNotificationPreferences({ driver_messages: true });
    expect(shouldDeliverNotificationToAdmin(prefs, "chat", "driver_admin")).toBe(true);
    // Also true by default, with no saved preferences at all.
    expect(shouldDeliverNotificationToAdmin(DEFAULT_ADMIN_NOTIFICATION_PREFERENCES, "status_update")).toBe(true);
  });
});

describe("filterAdminRecipientsByPreferences — per-admin isolation for push/in-app delivery, Driver/Client unaffected", () => {
  it("a disabled category suppresses only the admin who disabled it — a different admin with it enabled still receives it", () => {
    const adminIds = ["admin-A", "admin-B"];
    const preferencesByAdminId = {
      "admin-A": { driver_messages: false },
      "admin-B": { driver_messages: true },
    };
    const recipients = filterAdminRecipientsByPreferences(adminIds, preferencesByAdminId, "chat", "driver_admin");
    expect(recipients).toEqual(["admin-B"]);
  });

  it("an admin with no saved preferences document at all (legacy admin) still receives every category by default", () => {
    const adminIds = ["admin-A", "admin-legacy"];
    const preferencesByAdminId = {
      "admin-A": { customer_messages: false },
      // admin-legacy: no entry at all in the map
    };
    const recipients = filterAdminRecipientsByPreferences(adminIds, preferencesByAdminId, "chat", "client_admin");
    expect(recipients).toEqual(["admin-legacy"]);
  });

  it("security_system_alerts-mapped notifications reach every admin regardless of any of their preferences", () => {
    const adminIds = ["admin-A", "admin-B"];
    const preferencesByAdminId = {
      "admin-A": Object.fromEntries(NOTIFICATION_PREFERENCE_CATEGORIES.map((c) => [c, false])),
      "admin-B": Object.fromEntries(NOTIFICATION_PREFERENCE_CATEGORIES.map((c) => [c, false])),
    };
    const recipients = filterAdminRecipientsByPreferences(adminIds, preferencesByAdminId, "driver_registration");
    expect(recipients.sort()).toEqual(["admin-A", "admin-B"]);
  });

  it("this function's signature has no way to reference Driver or Client ids at all — it operates purely on the admin id list and admin preference map passed in", () => {
    // Structural proof, not just a behavioral one: filterAdminRecipientsByPreferences
    // takes (adminIds: string[], preferencesByAdminId, type, channel) — there
    // is no driver/client parameter for it to filter, so it is impossible
    // for this mechanism to suppress a Driver or Client recipient. Confirmed
    // here by passing a driver-shaped id through the SAME admin-only
    // function and observing it is treated identically to any other
    // opaque string id (this function does not know or care what role an
    // id belongs to — that separation is enforced by server.ts calling it
    // only on the admin-token id list, never on driver/client ids).
    const idsIncludingADriverLookingId = ["admin-A", "driver-1"];
    const preferencesByAdminId = { "admin-A": { driver_messages: true }, "driver-1": { driver_messages: true } };
    const recipients = filterAdminRecipientsByPreferences(idsIncludingADriverLookingId, preferencesByAdminId, "chat", "driver_admin");
    // Both come through here because the function itself has no concept
    // of role — real driver/client suppression-immunity is guaranteed by
    // server.ts never calling this with anything but the admin token list.
    expect(recipients.sort()).toEqual(["admin-A", "driver-1"]);
  });
});
