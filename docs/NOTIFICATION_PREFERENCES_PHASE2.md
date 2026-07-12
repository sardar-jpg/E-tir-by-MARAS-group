# Notification Preferences — Phase 2 (Admin Only)

Branch: `feature/notification-preferences-phase2`. Turns Admin Settings'
"Notification Preferences" card from a static "Coming Soon" placeholder into
real, persistent, per-admin preferences that actually gate which
notifications reach each admin. Driver and Client preferences are explicitly
out of scope for this PR (see §8).

## 1. Storage model

**New Firestore collection: `adminNotificationPreferences`.** One document
per admin, document id === that admin's own session id
(`req.session.id` server-side):

```ts
// src/lib/notificationPreferences.ts
export type NotificationPreferenceCategory =
  | "shipment_updates" | "customer_messages" | "driver_messages"
  | "document_uploads" | "cmr_pod" | "delays_border_waiting"
  | "accounting_alerts" | "security_system_alerts";

export type AdminNotificationPreferences = Record<NotificationPreferenceCategory, boolean>;
```

The stored document itself is that same flat boolean map plus `id` (the
admin's session id, duplicated onto the doc for consistency with every
other collection in this app) and `updatedAt` (ISO timestamp).

**Why session id, not email, as the key**: `req.session.id` is the
super-admin's email for the super-admin (they happen to coincide), but a
**sub-admin's own `admins/{id}` Firestore document id** for every other
admin type — a genuinely different value from their email. This is the
same distinction the Notification Phase 1 read-model work already
established for `AdminPanel.tsx`'s `ownAdminId` (see
`docs/NOTIFICATION_SYSTEM_AUDIT.md`). Keying this collection by email
would have silently merged/misattributed every sub-admin's preferences
(or simply never matched what the server actually checks against).

**Why a new collection, not a field on an existing document**: the
super-admin has no Firestore document at all (their identity is a
hardcoded `SUPER_ADMIN_EMAIL` env var, not an `admins/{id}` record) — so
there is no existing per-admin document every admin type already has to
attach a field to. A dedicated collection, keyed uniformly by session id,
is the only storage shape that works for both super-admin and sub-admins
without special-casing one of them.

**No Firestore rules change.** `firestore.rules` already denies every
collection except the server's own dedicated account
(`allow read, write: if isServerAccount()` on `/{document=**}`) — a
blanket rule that already covers any collection name, existing or new.
Real per-admin authorization (an admin can only ever read/write their
own document) is enforced entirely in `server.ts`, the same architecture
every other collection in this app already uses.

**Backward compatible, additive, no migration**: no existing document
anywhere was touched. An admin with no saved preferences document at all
(every admin, before this feature shipped) resolves to
`DEFAULT_ADMIN_NOTIFICATION_PREFERENCES` — every category `true` — via
`resolveAdminNotificationPreferences(undefined)`.

## 2. Endpoint behavior

### `GET /api/admin/notification-preferences`
- `requireRole("admin")` — any admin type (super/operation/accounts).
- Reads `adminNotificationPreferences/{req.session.id}`; resolves via
  `resolveAdminNotificationPreferences` (fills in defaults for anything
  missing, forces `security_system_alerts` to `true` regardless of what,
  if anything, was stored).
- Response: `{ preferences: AdminNotificationPreferences }`.

### `PUT /api/admin/notification-preferences`
- `requireRole("admin")`, same as GET.
- Body: a partial `Record<category, boolean>` — only the categories being
  changed need to be present.
- **Validation** (`validateNotificationPreferencesUpdate`):
  - An unrecognized key is **ignored** (not an error) — forward/backward
    compatible with clients sending extra fields.
  - A recognized category with a **non-boolean value rejects the whole
    request** with `400` (`"Invalid value for: <keys>. Each category
    must be true or false."`) — no partial update is ever applied when
    the request itself is malformed.
  - `security_system_alerts: false` is **not** a validation error — the
    field is dropped from the validated delta entirely (never sent to
    storage at all), and the server always writes `security_system_alerts:
    true` on every single write regardless of input, so a request that
    also changes other categories in the same call still succeeds for
    those. There is no way to make this endpoint persist
    `security_system_alerts: false` under any input.
- **Field-scoped, atomic write — never a full-document read-modify-write**
  (see §2a below for the concurrency fix this is). The validated delta is
  applied via `updateAdminNotificationPreferenceFields` (`server.ts`),
  then the route does one *post-write* read purely to report the current
  full state back to the caller — `res.json({ preferences })`, using
  `resolveAdminNotificationPreferences` the same way GET does. That read
  has no influence on what was written; it only reports it.
- **Isolation**: neither route accepts an admin id/email parameter from
  the client at all — both are scoped entirely to `req.session.id`. There
  is no request shape through which one admin could read or write another
  admin's preferences.

### 2a. Concurrency fix — field-scoped atomic writes

**The problem, as found in review**: the original implementation read the
complete existing preferences document, merged the one submitted category
into a full in-memory object, then wrote that *entire reconstructed
object* back with a plain `setDoc`. Two quick, different-category toggle
requests (e.g. a user clicking two switches a moment apart, or two browser
tabs) could both read the same "before" snapshot; whichever write finished
last would silently overwrite the other's change, since its payload
included a stale value for the field the *other* request had just
changed. The frontend had a matching bug: it replaced the *entire* local
preferences state with each server response, so an out-of-order response
could visually revert an already-successfully-saved toggle.

**The fix, on both ends:**

- **`validateNotificationPreferencesUpdate` produces a delta, not a merged
  object.** It no longer takes "existing preferences" as an input at all —
  it just validates the request body and returns exactly the fields that
  request is changing (`updates`), nothing else. There is nothing left to
  merge in application code, and therefore nothing that can go stale.
- **`updateAdminNotificationPreferenceFields` (`server.ts`) writes only
  that delta, atomically, with no prior read**:
  - Real Firestore: `setDoc(ref, { ...updates, security_system_alerts:
    true, id, updatedAt }, { merge: true })`. The existing generic
    `setDoc()` wrapper already forwards its `options` argument straight
    through to the real SDK, so `{ merge: true }` performs a genuine
    atomic field-level merge — Firestore creates the document if it
    doesn't exist yet (using only the given fields) or merges into an
    existing one, with **no read required first**. Two concurrent merge
    writes to *different* fields of the same document both apply,
    regardless of arrival order, because each write's payload only ever
    names the field(s) it's actually changing.
  - Memory fallback: `handleSetDocMemory` (`server.ts`) already merges via
    `{ ...items[idx], ...data }` (or `{ id, ...data }` when creating) as
    its own unconditional behavior — it doesn't even inspect the `merge`
    option — so it already has the same
    only-touch-the-given-fields property real Firestore gets from
    `{ merge: true }`. No dedicated bypass helper was needed here (unlike
    `addNotificationReaderId`'s `arrayUnion()` case in the Notification
    Phase 1 read-model work) — this payload is plain booleans/strings,
    nothing `cleanUndefined()` or the memory store's spread-merge could
    mishandle.
- **The stored document is deliberately allowed to stay partial.** It may
  only ever contain whichever categories a given admin has actually
  changed at least once — never a full 8-field snapshot written eagerly
  "for completeness." This is intentional: if the very first save for a
  brand-new admin instead eagerly filled in every other category's
  default value, two concurrent *first-time* saves to different
  categories for that same admin could each write a full
  "defaults + my one change" snapshot, and whichever landed second would
  silently reset the first one's category back to its default —
  reproducing the exact bug this fix closes, just for the create case
  specifically. `resolveAdminNotificationPreferences` already treats a
  missing category as enabled-by-default on every read (GET and PUT
  responses both go through it), so a partial stored document is
  functionally invisible to any caller — it always looks like a complete,
  fully-resolved 8-category object.
- **Frontend (`AdminSettingsSection.tsx`)**: only one save may be in
  flight at a time — every toggle is disabled while any save is pending —
  and the optimistic update, the success-merge of the server's response,
  and the failure-rollback all use one shared, pure, single-field helper
  (`applyPreferenceFieldUpdate`) that replaces exactly one category and
  leaves every other field in local state untouched. See §7 for the full
  frontend behavior.

**Verified live** against the dev server (memory fallback): fired two
genuinely concurrent `PUT` requests to two *different* categories for the
same admin (via two backgrounded `curl` processes) and confirmed both
changes were present on the next `GET` — neither was lost, in either
arrival order. Repeated with five concurrent first-time writes (five
different categories, `curl`ed simultaneously) for a brand-new admin with
no prior preferences document at all, confirming all five persisted
correctly and the three untouched categories still resolved to their
`true` defaults — the specific "concurrent first-time create" race
described above, and it does not reproduce.

## 3. Category → notification mapping

`mapNotificationToPreferenceCategory(type, channel)` (`src/lib/
notificationPreferences.ts`) maps every existing `AppNotification.type`
(and, for `chat`, its channel) to one of the 8 categories, or `null` if
there's no clear match:

| Notification type / channel | Category | Notes |
|---|---|---|
| `assignment`, `acceptance`, `rejection`, `status_update`, `delivery` | `shipment_updates` | All shipment lifecycle events. |
| `chat` + `client_admin` | `customer_messages` | |
| `chat` + `driver_admin` | `driver_messages` | |
| `chat` + `internal_staff`, or no channel at all | *(null → always enabled)* | Admin-to-admin internal chat and legacy untagged chat have no dedicated category of their own — not guessed at. |
| `doc_upload` | `document_uploads` | See the `cmr_pod` note below. |
| `driver_registration` (self-registration submitted, and approved/rejected) | `security_system_alerts` | Account/access-lifecycle events — not a shipment/chat/document/accounting event, and genuinely about who may sign in, so treated as system-administration rather than left unmapped. Always enabled either way. |
| `ai_alert` | `security_system_alerts` | Reserved for a future MARAS AI monitoring alert; already admin-only by construction elsewhere (`chatVisibility.ts`). |
| anything else (a future/unknown type) | *(null → always enabled)* | "No clear category, default to enabled" rule — never guessed. |

**`cmr_pod` currently has no notification source mapped to it.**
`pushNotification()` does not currently receive which document category
(CMR, POD, "other") triggered a `doc_upload` notification — that
information exists on the chat message / document record itself but was
never threaded through to the notification layer. The `cmr_pod`
preference is fully functional (savable, independently toggleable, and
will apply correctly the moment a future phase adds category-aware
document notifications), it simply has nothing to gate today. Documented
here explicitly rather than guessing a mapping that isn't real.

## 4. Defaults

`DEFAULT_ADMIN_NOTIFICATION_PREFERENCES` — every one of the 8 categories
`true`. Applies to:
- Every admin who existed before this feature shipped (no migration
  performed or needed).
- Any category omitted from a partial saved document.
- Any category present in a stored document with a non-boolean value
  (treated the same as missing, not trusted).

## 5. Security alert rule

`security_system_alerts` **cannot be disabled, at every layer**:
1. **Write time** (`sanitizeNotificationPreferencesUpdate`): an attempt to
   set it `false` is ignored, not applied, and the request is not
   rejected for it (other categories in the same request still apply).
2. **Read time** (`resolveAdminNotificationPreferences`): forced `true`
   regardless of what a stored document actually contains — covers a
   hypothetical hand-edited/corrupted document.
3. **Delivery-decision time**
   (`isNotificationCategoryEnabledForAdmin`): returns `true`
   unconditionally for this category, regardless of the preferences
   object passed in — a third, independent enforcement point.
4. **UI**: rendered as a fixed "Always On" badge, never a toggle — the
   user has no way to even attempt disabling it through the interface.

## 6. Admin role behavior

- Super Admin, Operations Admin, and Accounts Admin are all just
  `requireRole("admin")` for these two routes — no `adminType` gating.
  Each holds completely independent preferences, isolated purely by
  their own session id being a different Firestore document key. Verified
  live in this environment (see §7) with two distinct super-admin-type
  demo accounts: disabling `driver_messages` for one account left the
  other account's preferences (and its own visible notifications) fully
  unaffected.
- Both **push** (`pushNotification()`'s admin-recipient resolution) and
  **in-app** (`GET /api/notifications`'s admin branch) now consult each
  admin's own preferences independently:
  - Push: `pushNotification()` fetches every admin's push token and every
    admin's saved preferences document once per notification, then
    `filterAdminRecipientsByPreferences` keeps only the admin ids whose
    own preferences allow this notification's category through. An admin
    with no saved document defaults to allowed (§4).
  - In-app: `GET /api/notifications`'s admin branch (previously
    completely unfiltered — "admins see everything") now additionally
    filters by the *requesting* admin's own resolved preferences via
    `shouldDeliverNotificationToAdmin`. A different admin's own `GET`
    call is filtered by *their* own preferences, independently.
- **Driver and Client recipients/visibility are completely untouched.**
  The admin-preference filtering lives entirely inside the existing
  admin-only code paths (the admin-token loop inside `pushNotification()`,
  and the `else if (req.session!.role === "admin")` branch of `GET
  /api/notifications`) — the driver/client recipient-resolution and
  driver/client `GET /api/notifications` branches were not modified at
  all. Verified live (§7): both a driver's and a client's own
  notification list continued to return normally, unaffected by any
  admin's preferences.
- **No privacy/channel boundary was changed.** The existing
  `driver_admin`/`client_admin`/`internal_staff` channel partitioning and
  shipment/company scoping (see `docs/NOTIFICATION_SYSTEM_AUDIT.md` §3)
  still run exactly as before; preference filtering is applied
  additionally, never instead of those checks.

## 7. Frontend

`src/components/admin/sections/AdminSettingsSection.tsx`'s "Notification
Preferences" card:
- Fetches preferences on mount (`GET`), shows a loading state
  (dimmed/non-interactive) while in flight, and a red inline error banner
  if the fetch fails.
- Each of the 7 non-security categories renders as a real, accessible
  toggle (`<input type="checkbox" role="switch">`, not a styled `<div>`)
  with an English/Turkish/Arabic label. Toggling immediately calls `PUT`
  with just that one category's new value.
- **Only one save may be in flight at a time.** A single `savingCategory`
  state (not a set) tracks it; every toggle in the card — not just the
  one being changed — is `disabled` while it is non-null, so the frontend
  itself can never fire two overlapping `PUT` requests. A small "Saving…"
  indicator shows in the card header while it's set.
- **Every state transition (optimistic update, success-merge of the
  server's response, and failure-rollback) touches exactly one category**,
  via a single shared, pure helper, `applyPreferenceFieldUpdate`
  (`src/lib/notificationPreferences.ts`, unit-tested) — never
  `setPreferences(fullObject)`. Concretely:
  - On toggle: `setPreferences(prev => applyPreferenceFieldUpdate(prev, category, next))` — optimistic, this category only.
  - On success: the confirmed value for *that same category* is read back
    out of the server's response and merged in the same way — the rest of
    the response body is not trusted or applied wholesale, so an
    out-of-order/stale response could never revert an unrelated category.
  - On failure: the category is reverted to its pre-toggle value the same
    way, plus a red inline error banner — a failed save is never left
    looking like it succeeded, and it never touches any other category's
    state, including one that saved successfully moments earlier.
- `security_system_alerts` renders as a fixed, non-interactive "Always
  On" badge (matching the pre-existing visual treatment), not a toggle at
  all.
- RTL: this component has never set its own `dir` attribute (inherited
  from a parent wrapper elsewhere in `AdminPanel.tsx`) and still doesn't —
  no new RTL-specific markup was needed; Arabic labels render correctly
  under the existing inherited `dir="rtl"` the same way every other
  Arabic string in this file already does.
- Visual style: reuses this file's existing card/row/pill conventions
  (`bg-slate-50 border border-slate-100` rows, `bg-amber-50` for the
  always-on row) — no new design language introduced.
- Out of scope, per this PR's instructions: no Email channel, no Quiet
  Hours. Only the 8 named categories exist.

**Manually verified in this environment** (`npm run dev`, memory
fallback, demo data seeded): logged in as two separate demo admin
accounts via `curl`, confirmed `GET` defaults to all-`true` for a fresh
account, `PUT` persists and is reflected on a subsequent `GET`, an
attempt to disable `security_system_alerts` is silently ignored, an
invalid non-boolean value is rejected with `400`, the two admin accounts'
preferences are fully independent, and — most importantly — sending a
real `driver_admin` chat message and checking `GET /api/notifications`
for both admins showed the notification **absent** for the admin who had
disabled `driver_messages` and **present** for the admin who had it
enabled. Driver's and Client's own `GET /api/notifications` continued to
return normally throughout. A later pass specifically re-verified the
concurrency fix (§2a) with genuinely concurrent `curl` requests — see §2a
for that verification's exact results.

**Bug found and fixed during this verification pass**: the new
`adminNotificationPreferences` collection was initially missing from
`memoryStore`'s type declaration and initializer in `server.ts` — the
exact same class of bug PR #44 already found and fixed once for
`pushTokens` (a collection missing from this object means every
read/write against it silently no-ops under the memory fallback, which
local dev runs on by default). Caught immediately by the live `PUT`-then-
`GET` check above returning stale defaults instead of the just-saved
value; fixed by adding the collection to both the type and the
initializer, matching the existing `pushTokens` entry's pattern exactly.

## 8. Deferred work (Driver and Client preferences)

**Explicitly out of scope for this PR** (Admin only, per the task):

- Driver and Client have no notification preferences UI or storage at
  all. Their own notification delivery (push and in-app) is completely
  unaffected by any of this work — `shouldNotifyChatParty` (driver/client
  push gating) and the driver/client branches of `GET /api/notifications`
  were not touched.
- A future phase would need its own category set (likely different from
  the admin list — e.g. a driver has no "accounting alerts" concept) and
  its own storage keyed by driver id / client id respectively, following
  the same "session id, not email, as the key" and "additive, no
  migration" principles established here.
- `cmr_pod` has no live notification source yet (§3) — a future phase
  threading document category through to `pushNotification()` would
  close this gap without any change to the preference model itself.
- Admin's own bulk actions (`POST /api/notifications/clear`, "mark all as
  read") are a completely separate concern (per-user *read* state, see
  `docs/NOTIFICATION_SYSTEM_AUDIT.md`) from these *delivery* preferences,
  and were not touched by this PR.
- No Email channel, no Quiet Hours (explicitly excluded from this PR's
  scope).

## 9. Confirmation

No changes to business rules, role permissions, authentication/session
behavior, existing API contracts (two new additive endpoints; no existing
route's request/response shape changed), Firestore rules (none needed —
see §1), chat channel partitioning, document visibility rules, shipment
numbering, accounting calculations, GPS update intervals, production
configuration, environment files, `package.json`/lockfile, Capacitor
configuration, or any file under `ios/`/`android/`. No production data was
migrated or altered. No app version/build change, no deploy, no
TestFlight upload, no App Store Review submission changes.
