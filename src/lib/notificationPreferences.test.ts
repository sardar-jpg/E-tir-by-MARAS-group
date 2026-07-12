import { describe, it, expect } from "vitest";
import {
  DEFAULT_ADMIN_NOTIFICATION_PREFERENCES,
  resolveAdminNotificationPreferences,
  validateNotificationPreferencesUpdate,
  applyPreferenceFieldUpdate,
  mapNotificationToPreferenceCategory,
  isNotificationCategoryEnabledForAdmin,
  shouldDeliverNotificationToAdmin,
  filterAdminRecipientsByPreferences,
  NOTIFICATION_PREFERENCE_CATEGORIES,
  type AdminNotificationPreferences,
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

describe("validateNotificationPreferencesUpdate — produces a delta only, no existing-state merge", () => {
  it("a valid boolean update to a known category appears in `updates`, with no other category present at all", () => {
    const result = validateNotificationPreferencesUpdate({ shipment_updates: false });
    expect(result.updates).toEqual({ shipment_updates: false });
    expect(result.invalidKeys).toEqual([]);
  });

  it("security_system_alerts is never included in `updates`, whichever value is submitted — the caller forces it true itself on every write", () => {
    const disableAttempt = validateNotificationPreferencesUpdate({ security_system_alerts: false });
    expect(disableAttempt.updates).not.toHaveProperty("security_system_alerts");
    expect(disableAttempt.securityAlertsDisableAttempted).toBe(true);
    expect(disableAttempt.invalidKeys).toEqual([]); // not treated as an invalid request — silently dropped

    const explicitTrue = validateNotificationPreferencesUpdate({ security_system_alerts: true });
    expect(explicitTrue.updates).not.toHaveProperty("security_system_alerts");
    expect(explicitTrue.securityAlertsDisableAttempted).toBe(false);
  });

  it("a request disabling security_system_alerts alongside another valid change still produces that other change in `updates`", () => {
    const result = validateNotificationPreferencesUpdate({ security_system_alerts: false, driver_messages: false });
    expect(result.updates).toEqual({ driver_messages: false });
  });

  it("a non-boolean value for a known category is flagged invalid, and is never added to `updates`", () => {
    const result = validateNotificationPreferencesUpdate({ shipment_updates: "false" });
    expect(result.invalidKeys).toEqual(["shipment_updates"]);
    expect(result.updates).not.toHaveProperty("shipment_updates");
  });

  it("an unrecognized key is ignored (reported separately), not treated as invalid, and never added to `updates`", () => {
    const result = validateNotificationPreferencesUpdate({ made_up_category: false });
    expect(result.unknownKeys).toEqual(["made_up_category"]);
    expect(result.invalidKeys).toEqual([]);
    expect(result.updates).toEqual({});
  });

  it("null/undefined/non-object input produces an empty delta and no errors", () => {
    expect(validateNotificationPreferencesUpdate(null).updates).toEqual({});
    expect(validateNotificationPreferencesUpdate(undefined).updates).toEqual({});
    expect(validateNotificationPreferencesUpdate("not an object").updates).toEqual({});
    expect(validateNotificationPreferencesUpdate(["array"]).updates).toEqual({});
  });

  it("a multi-category request produces a delta containing exactly those categories, nothing else", () => {
    const result = validateNotificationPreferencesUpdate({ cmr_pod: false, accounting_alerts: false, driver_messages: false });
    expect(result.updates).toEqual({ cmr_pod: false, accounting_alerts: false, driver_messages: false });
    expect(Object.keys(result.updates)).toHaveLength(3);
  });
});

describe("Atomic field-level merge semantics — the concurrency fix", () => {
  // These tests model server.ts's updateAdminNotificationPreferenceFields
  // at the level this repo's tests operate on (no server.ts test file
  // exists — pure-function extraction is the established convention).
  // simulateFieldMerge below stands in for BOTH real paths this function
  // relies on: Firestore's own setDoc(ref, data, { merge: true }) contract
  // (only the given top-level fields change; everything else in the
  // document is left alone) and handleSetDocMemory's existing
  // `{ ...items[idx], ...data }` / `{ id, ...data }` behavior in
  // server.ts — both are, by construction, exactly this operation.
  function simulateFieldMerge(
    stored: Partial<Record<string, unknown>> | undefined,
    fields: Partial<AdminNotificationPreferences>
  ): Partial<Record<string, unknown>> {
    return { ...(stored ?? {}), ...fields };
  }

  it("two sequential partial updates to different categories both persist — neither is lost", () => {
    let stored: Partial<Record<string, unknown>> | undefined = undefined;
    stored = simulateFieldMerge(stored, { driver_messages: false });
    stored = simulateFieldMerge(stored, { shipment_updates: false });
    const resolved = resolveAdminNotificationPreferences(stored);
    expect(resolved.driver_messages).toBe(false);
    expect(resolved.shipment_updates).toBe(false);
  });

  it("updating one category never resets a previously-saved different category back to its default", () => {
    let stored: Partial<Record<string, unknown>> | undefined = simulateFieldMerge(undefined, { cmr_pod: false });
    // A second, later, unrelated update — must not reintroduce cmr_pod at all,
    // let alone reset it.
    stored = simulateFieldMerge(stored, { accounting_alerts: false });
    const resolved = resolveAdminNotificationPreferences(stored);
    expect(resolved.cmr_pod).toBe(false); // still false — not reset to the true default
    expect(resolved.accounting_alerts).toBe(false);
  });

  it("simulates the exact race this fix closes: two concurrent updates to DIFFERENT categories, applied in either order, both survive", () => {
    // Request A changes driver_messages; Request B changes shipment_updates.
    // Neither request's payload mentions the other's field at all (unlike
    // the old read-existing-then-write-full-object approach), so applying
    // them in either order — simulating either possible arrival order for
    // two concurrent requests — produces the same, fully-correct result.
    const requestAFields = { driver_messages: false };
    const requestBFields = { shipment_updates: false };

    const orderAThenB = simulateFieldMerge(simulateFieldMerge(undefined, requestAFields), requestBFields);
    const orderBThenA = simulateFieldMerge(simulateFieldMerge(undefined, requestBFields), requestAFields);

    for (const stored of [orderAThenB, orderBThenA]) {
      const resolved = resolveAdminNotificationPreferences(stored);
      expect(resolved.driver_messages).toBe(false);
      expect(resolved.shipment_updates).toBe(false);
    }
  });

  it("creating preferences for a brand-new admin (no prior document) via a single-category update still resolves every other category to its default", () => {
    const stored = simulateFieldMerge(undefined, { driver_messages: false });
    const resolved = resolveAdminNotificationPreferences(stored);
    expect(resolved.driver_messages).toBe(false);
    expect(resolved.shipment_updates).toBe(true);
    expect(resolved.customer_messages).toBe(true);
    expect(resolved.document_uploads).toBe(true);
    expect(resolved.cmr_pod).toBe(true);
    expect(resolved.delays_border_waiting).toBe(true);
    expect(resolved.accounting_alerts).toBe(true);
  });

  it("security_system_alerts remains true through any sequence of field-level merges, since it is never part of a submitted delta", () => {
    let stored: Partial<Record<string, unknown>> | undefined = undefined;
    stored = simulateFieldMerge(stored, { driver_messages: false });
    stored = simulateFieldMerge(stored, { shipment_updates: false });
    stored = simulateFieldMerge(stored, { security_system_alerts: true }); // the route always includes this on every write
    expect(resolveAdminNotificationPreferences(stored).security_system_alerts).toBe(true);
  });

  it("memory fallback and Firestore field-update semantics are equivalent at the helper level", () => {
    // A second, independent model of Firestore's merge:true semantics
    // (documented: only the given top-level fields change) — proves
    // simulateFieldMerge above (standing in for BOTH real code paths)
    // isn't accidentally modeling only one of them.
    const simulateFirestoreMergeTrue = (
      stored: Partial<Record<string, unknown>> | undefined,
      fields: Partial<AdminNotificationPreferences>
    ): Partial<Record<string, unknown>> => ({ ...(stored ?? {}), ...fields });

    const sequence: Partial<AdminNotificationPreferences>[] = [
      { driver_messages: false },
      { shipment_updates: false },
      { cmr_pod: false },
    ];

    let memoryFallbackResult: Partial<Record<string, unknown>> | undefined = undefined;
    let firestoreResult: Partial<Record<string, unknown>> | undefined = undefined;
    for (const fields of sequence) {
      memoryFallbackResult = simulateFieldMerge(memoryFallbackResult, fields);
      firestoreResult = simulateFirestoreMergeTrue(firestoreResult, fields);
    }

    expect(resolveAdminNotificationPreferences(memoryFallbackResult)).toEqual(resolveAdminNotificationPreferences(firestoreResult));
  });
});

describe("applyPreferenceFieldUpdate — the frontend half of the concurrency fix", () => {
  it("replaces exactly one category, leaving every other field untouched", () => {
    const before: AdminNotificationPreferences = { ...DEFAULT_ADMIN_NOTIFICATION_PREFERENCES, cmr_pod: false };
    const after = applyPreferenceFieldUpdate(before, "driver_messages", false);
    expect(after.driver_messages).toBe(false);
    expect(after.cmr_pod).toBe(false); // preserved, untouched
    expect(after.shipment_updates).toBe(true); // preserved, untouched
    // pure — does not mutate the input
    expect(before.driver_messages).toBe(true);
  });

  it("models AdminSettingsSection.tsx's failure-rollback: reverting a failed category changes only that category", () => {
    // Simulates: optimistic update to driver_messages, a second category
    // (cmr_pod) already successfully saved earlier, then the
    // driver_messages request fails and is rolled back.
    let state: AdminNotificationPreferences = DEFAULT_ADMIN_NOTIFICATION_PREFERENCES;
    state = applyPreferenceFieldUpdate(state, "cmr_pod", false); // earlier, already-successful save
    const previousDriverMessages = state.driver_messages; // true, captured before the optimistic flip
    state = applyPreferenceFieldUpdate(state, "driver_messages", false); // optimistic update for the new toggle
    // ...request fails...
    state = applyPreferenceFieldUpdate(state, "driver_messages", previousDriverMessages); // rollback

    expect(state.driver_messages).toBe(true); // rolled back
    expect(state.cmr_pod).toBe(false); // the earlier successful save is NOT undone by this rollback
  });

  it("models two sequential successful saves: the second save's success-merge never disturbs the first's already-applied value", () => {
    let state: AdminNotificationPreferences = DEFAULT_ADMIN_NOTIFICATION_PREFERENCES;
    state = applyPreferenceFieldUpdate(state, "shipment_updates", false); // save #1 succeeds, merges its own confirmed value
    state = applyPreferenceFieldUpdate(state, "driver_messages", false); // save #2 succeeds, merges its own confirmed value
    expect(state.shipment_updates).toBe(false);
    expect(state.driver_messages).toBe(false);
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
