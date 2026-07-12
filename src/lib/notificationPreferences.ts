/**
 * notificationPreferences.ts
 *
 * Notification Preferences Phase 2 (Admin only).
 *
 * Pure, testable model for per-admin notification category preferences —
 * imported by both server.ts (GET/PUT /api/admin/notification-preferences,
 * and the admin-recipient filtering inside pushNotification()/GET
 * /api/notifications) and AdminSettingsSection.tsx (the toggle UI), so
 * there is exactly one place deciding defaults, validation, and category
 * mapping instead of several that could drift apart.
 *
 * Storage: one document per admin in a new `adminNotificationPreferences`
 * Firestore collection, keyed by the admin's own session id
 * (req.session.id — the super-admin's email, or a sub-admin's
 * `admins/{id}` Firestore doc id; these are genuinely different values,
 * see AdminPanel.tsx's ownAdminId from the read-model phase). Never keyed
 * by email — a sub-admin's email is not their session id. This is a
 * brand-new collection, so no Firestore rules change is needed: this
 * project's rules already deny every collection except the server's own
 * account (see firestore.rules), a blanket rule that already covers any
 * collection name, existing or new.
 *
 * Backward compatibility: this is purely additive. No existing document
 * anywhere is migrated or touched. An admin with no saved preferences
 * document at all (every admin, before this feature ships) resolves to
 * "every category enabled" — see DEFAULT_ADMIN_NOTIFICATION_PREFERENCES.
 */

export const NOTIFICATION_PREFERENCE_CATEGORIES = [
  "shipment_updates",
  "customer_messages",
  "driver_messages",
  "document_uploads",
  "cmr_pod",
  "delays_border_waiting",
  "accounting_alerts",
  "security_system_alerts",
] as const;

export type NotificationPreferenceCategory = (typeof NOTIFICATION_PREFERENCE_CATEGORIES)[number];

export type AdminNotificationPreferences = Record<NotificationPreferenceCategory, boolean>;

export const DEFAULT_ADMIN_NOTIFICATION_PREFERENCES: AdminNotificationPreferences = {
  shipment_updates: true,
  customer_messages: true,
  driver_messages: true,
  document_uploads: true,
  cmr_pod: true,
  delays_border_waiting: true,
  accounting_alerts: true,
  security_system_alerts: true,
};

function isKnownCategory(key: string): key is NotificationPreferenceCategory {
  return (NOTIFICATION_PREFERENCE_CATEGORIES as readonly string[]).includes(key);
}

/**
 * Resolves a stored preferences document (or its absence) into a complete,
 * safe preferences object. Any category missing from `stored` (including
 * every category, for an admin who has never saved preferences at all —
 * "legacy admin with no preferences") defaults to enabled. Any category
 * present with a non-boolean value is treated the same as missing, rather
 * than trusting a corrupted/hand-edited value.
 *
 * security_system_alerts is unconditionally forced to true here,
 * regardless of what (if anything) was actually stored — this is the
 * final, defense-in-depth enforcement point for "cannot be turned off",
 * on top of sanitizeNotificationPreferencesUpdate rejecting the write in
 * the first place.
 */
export function resolveAdminNotificationPreferences(
  stored: Partial<Record<string, unknown>> | null | undefined
): AdminNotificationPreferences {
  const resolved: AdminNotificationPreferences = { ...DEFAULT_ADMIN_NOTIFICATION_PREFERENCES };
  if (stored) {
    for (const category of NOTIFICATION_PREFERENCE_CATEGORIES) {
      const value = stored[category];
      if (typeof value === "boolean") {
        resolved[category] = value;
      }
    }
  }
  resolved.security_system_alerts = true;
  return resolved;
}

export interface NotificationPreferencesValidationResult {
  preferences: AdminNotificationPreferences;
  // Known category, but the submitted value wasn't a boolean — the PUT
  // route rejects the whole request (400) if this is non-empty, rather
  // than silently applying a partially-valid update.
  invalidKeys: string[];
  // Not a recognized category at all — ignored, not an error (forward/
  // backward compatible: an older or newer client sending an extra field
  // doesn't break the request).
  unknownKeys: string[];
  // True if the request specifically tried to set security_system_alerts
  // to false. Not treated as an invalid request — the value is silently
  // ignored (forced true) rather than rejecting the whole update, so a
  // request that also changes other categories in the same call still
  // succeeds for those.
  securityAlertsDisableAttempted: boolean;
}

/**
 * Validates and applies a PUT /api/admin/notification-preferences request
 * body against this admin's existing preferences. Pure — the caller
 * supplies `existing` (already resolved via resolveAdminNotificationPreferences)
 * and persists `preferences` from the result themselves.
 */
export function sanitizeNotificationPreferencesUpdate(
  existing: AdminNotificationPreferences,
  input: unknown
): NotificationPreferencesValidationResult {
  const preferences: AdminNotificationPreferences = { ...existing };
  const invalidKeys: string[] = [];
  const unknownKeys: string[] = [];
  let securityAlertsDisableAttempted = false;

  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (!isKnownCategory(key)) {
        unknownKeys.push(key);
        continue;
      }
      if (typeof value !== "boolean") {
        invalidKeys.push(key);
        continue;
      }
      if (key === "security_system_alerts") {
        if (value === false) securityAlertsDisableAttempted = true;
        continue; // never applied from input — forced true below regardless
      }
      preferences[key] = value;
    }
  }

  preferences.security_system_alerts = true;
  return { preferences, invalidKeys, unknownKeys, securityAlertsDisableAttempted };
}

/**
 * Maps an existing AppNotification's type/channel to the admin preference
 * category it belongs to. Returns null when there is no clear match —
 * callers (isNotificationCategoryEnabledForAdmin) must treat null as
 * "always enabled," never as "guess a category."
 *
 * - assignment/acceptance/rejection/status_update/delivery: all shipment
 *   lifecycle events → shipment_updates.
 * - chat: split by ChatChannel — client_admin → customer_messages,
 *   driver_admin → driver_messages. internal_staff (admin-to-admin) and
 *   legacy untagged chat (no channel at all) have no dedicated category
 *   of their own → null (always enabled).
 * - doc_upload → document_uploads. Note: pushNotification() does not
 *   currently receive which document category (CMR, POD, other)
 *   triggered a doc_upload notification, so there is no notification
 *   event mapped to "cmr_pod" specifically yet — seeing/toggling the
 *   cmr_pod preference itself works today, it just has no live
 *   notification source to gate until a future phase threads document
 *   category through to pushNotification(). Documented in
 *   docs/NOTIFICATION_PREFERENCES_PHASE2.md — not guessed at here.
 * - driver_registration (both "submitted, pending approval" and
 *   "approved"/"rejected"): account-lifecycle/access events, not a
 *   shipment/chat/document/accounting event — treated as a system/
 *   account-administration alert (security_system_alerts) rather than
 *   left fully unmapped, since it's genuinely about who may sign in;
 *   always enabled either way.
 * - ai_alert: reserved for a future MARAS AI monitoring alert, already
 *   admin-only by construction elsewhere (chatVisibility.ts) →
 *   security_system_alerts.
 * - anything else (a future/unknown type): null → always enabled, per
 *   the "no clear category, default to enabled" rule.
 */
export function mapNotificationToPreferenceCategory(
  notificationType: string,
  notificationChannel?: string
): NotificationPreferenceCategory | null {
  switch (notificationType) {
    case "assignment":
    case "acceptance":
    case "rejection":
    case "status_update":
    case "delivery":
      return "shipment_updates";
    case "doc_upload":
      return "document_uploads";
    case "chat":
      if (notificationChannel === "client_admin") return "customer_messages";
      if (notificationChannel === "driver_admin") return "driver_messages";
      return null;
    case "driver_registration":
    case "ai_alert":
      return "security_system_alerts";
    default:
      return null;
  }
}

/**
 * Whether a notification in the given category should reach a given
 * admin, given their resolved preferences. `category === null` (no clear
 * mapping — see mapNotificationToPreferenceCategory) and
 * `category === "security_system_alerts"` are both unconditionally `true`
 * — the latter regardless of what `preferences.security_system_alerts`
 * actually holds, as a final defense-in-depth layer on top of
 * resolveAdminNotificationPreferences already forcing it true.
 */
export function isNotificationCategoryEnabledForAdmin(
  preferences: AdminNotificationPreferences,
  category: NotificationPreferenceCategory | null
): boolean {
  if (category === null) return true;
  if (category === "security_system_alerts") return true;
  return preferences[category] !== false;
}

/**
 * Convenience wrapper combining the category mapping and the enabled
 * check — the single function both GET /api/notifications' admin branch
 * and pushNotification()'s admin push-recipient resolution call, so the
 * two can't drift apart.
 */
export function shouldDeliverNotificationToAdmin(
  preferences: AdminNotificationPreferences,
  notificationType: string,
  notificationChannel?: string
): boolean {
  const category = mapNotificationToPreferenceCategory(notificationType, notificationChannel);
  return isNotificationCategoryEnabledForAdmin(preferences, category);
}

/**
 * Filters a list of admin recipient ids (already resolved from push
 * tokens) down to only those whose own preferences allow this
 * notification through. Takes ONLY admin ids and an admin-id-keyed
 * preferences map — it has no parameter through which a driver or client
 * id could ever be passed in or affected, so this mechanism is
 * structurally incapable of suppressing a Driver or Client recipient
 * (see server.ts's pushNotification — this is called on the admin
 * id list only, entirely separately from the driver/client
 * recipient-resolution code).
 */
export function filterAdminRecipientsByPreferences(
  adminIds: string[],
  preferencesByAdminId: Record<string, Partial<Record<string, unknown>> | null | undefined>,
  notificationType: string,
  notificationChannel?: string
): string[] {
  return adminIds.filter((id) => {
    const preferences = resolveAdminNotificationPreferences(preferencesByAdminId[id]);
    return shouldDeliverNotificationToAdmin(preferences, notificationType, notificationChannel);
  });
}
