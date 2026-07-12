# Notification System Audit — Phase 1

Branch: `fix/notification-phase1-driver-read-safety`. Scope: unread-badge
correctness for **all three roles** (Driver, Client, Admin) on a completed,
atomic, `read`-preserving per-user read model — see §5 for the review passes
that got it there — a backend privacy/channel-leakage review (including a
direct-recipient channel-bypass found and fixed along the way, §4d), Client
Owner/Staff push fan-out, and the Driver Approved notification. No business
rules, role permissions, API contracts, Firebase architecture, or iOS
configuration were touched beyond what's described below.

## 1. Architecture

Two independent notification surfaces, both driven from one shared write
path:

- **In-app notifications** — Firestore `notifications` collection
  (`AppNotification`, `src/types.ts`). Written by `pushNotification()`
  (`server.ts`), read via `GET /api/notifications`, marked read via
  `POST /api/notifications/:id/read` (any authenticated role, own
  notifications only) or `POST /api/notifications/clear` (admin only — see
  §4e for its revised, now per-user, "mark all as read for me" semantics).
- **Push notifications** — Firebase Cloud Messaging, sent from the same
  `pushNotification()` call via `pushMessaging.sendEachForMulticast()`.
  Recipients are resolved server-side from device tokens in the
  `pushTokens` collection (`POST /api/push-tokens` registers one,
  `DELETE /api/push-tokens/:token` requires the caller to own it — see
  `src/lib/pushTokenAccess.ts`).

Every notification carries a `shipmentId` (empty string `""` for events with
no associated shipment), an optional `recipientUserId` (§4c) for events that
need to reach one specific user regardless of shipment, `readByUserIds`
(§5 — the per-user read model every role now uses for its own unread state),
and a legacy `read` boolean, kept in the schema for backward compatibility
but no longer read or written by any personal-unread-state code path in this
codebase (§5).

## 2. Routing

`pushNotification(shipmentId, shipmentNumber, type, titles..., messages...,
excludeUserId?, chatChannel?, recipientUserId?)` resolves push recipients in
one place, reused by every call site:

1. Every admin (admins see every notification with no filtering, so every
   admin gets every push).
2. If `recipientUserId` is set, that user directly — independent of any
   shipment (§4c).
3. If `shipmentId` is set and the shipment exists: the assigned driver +
   any additional drivers (unless `shouldNotifyChatParty` excludes them for
   a channel-scoped `chat`/`doc_upload` notification), and every active
   Client Owner/Staff account on the shipment's company (§4b).

`excludeUserId` removes the acting user afterward (e.g. a chat sender never
gets paged for their own message).

## 3. Privacy — reviewed; one real bypass found and fixed (§4d)

Verified `src/lib/chatVisibility.ts`'s `isChatNotificationVisibleToRole` /
`shouldNotifyChatParty` (already covered by 38 existing tests in
`chatVisibility.test.ts`, unchanged by this PR) against every notification
type:

- **Driver cannot read Client notifications, Client cannot read Driver
  notifications**: `chat`/`doc_upload` notifications carry a `channel`
  (`driver_admin` / `client_admin` / `internal_staff`). `GET
  /api/notifications` filters driver sessions to `channel ===
  "driver_admin"` and client sessions to `channel === "client_admin"` —
  confirmed both server-side (route) and client-side (`isChatNotificationVisibleToRole`).
  A legacy/untagged chat notification (no `channel` at all) is withheld
  from both rather than guessed at.
- **Internal staff notifications stay internal**: `internal_staff` is
  rejected outright for driver/client channel requests
  (`canAccessInternalStaffChannel`) and, for the notifications this
  produces, `isChatNotificationVisibleToRole` returns `false` for both
  `driver` and `client` regardless — only `admin` (the fallback branch)
  ever sees them.
- **`ai_alert` is admin-only by construction** — reserved for a future
  MARAS AI integration; no code creates this type yet.
- **Non-shipment leakage**: driver/client sessions are additionally scoped
  by `shipmentId` membership (their own assigned shipments / their own
  company's shipments) before the channel check ever runs, so even a
  same-channel notification on a shipment they don't own is invisible.
- **`recipientUserId` — real bypass found and fixed here (§4d)**: an
  earlier revision of this PR's `POST /api/notifications/:id/read` let a
  direct recipient (`recipientUserId` matching the caller) skip the
  channel-visibility check entirely, because that check lived inside the
  same `if (!isDirectRecipient)` branch as the shipment-ownership lookup.
  A direct recipient could, in principle, have marked read a
  `client_admin`/`driver_admin`/`internal_staff`/`ai_alert`-scoped
  notification outside their own audience. Not exploitable *today* — the
  only real call site (`recipientUserId` on the "Driver Approved" event)
  uses a non-channel-gated type — but fixed as defense in depth against a
  future call site combining the two.
- **Per-user read state (§5) introduces no new leakage**: every read/write
  of `readByUserIds` is keyed to the caller's own verified session id —
  never a client-supplied value — for all three roles, and one role's
  reads are provably invisible to the others (§7).

## 4. Bugs fixed

### 4a. Driver unread badge never cleared (root cause)

`src/components/driver/NotificationsPanel.tsx` is a pure display
component — opening the Driver Notifications screen (`activeTab ===
'notifications'`) rendered the list but **called no endpoint at all**.
Nothing ever marked a notification read for this driver, locally or on the
server, so the unread badge could never change. Confirmed via `grep` —
zero calls to `/api/notifications/:id/read` or `/clear` anywhere in
`DriverApplication.tsx` before this fix.

**Fix** (`src/components/DriverApplication.tsx`): a `useEffect` fires
whenever `activeTab === 'notifications'`, computing the currently-visible
unread ids and calling a new `markNotificationsRead(ids)`, which calls
`POST /api/notifications/:id/read` — the same authenticated,
per-notification, own-notification-only endpoint every other role already
uses. It **never** calls `POST /api/notifications/clear` (admin-only). See
§5 for the exact read-state model this uses.

### 4b. Client Owner/Staff push routing only reached one account per company

`pushNotification()`'s client-recipient resolution used
`clientsSnap.docs.map(...).find(c => c.companyName === ship.companyName)`
— `.find()` returns only the **first** matching record. A company with a
Client Owner plus one or more Client Staff accounts (equal company-level
permissions, see `clientAccess.ts`) would only ever push to whichever one
happened to sort first in the Firestore snapshot — silently dropping every
other account on that company.

**Fix**: extracted `resolveClientPushRecipientIds(clients, companyName)`
into `src/lib/clientAccess.ts` — returns every client id matching the
company **and** passing `isClientAccountActive` (the same `active !==
false` rule `POST /api/login` already uses to refuse a disabled account a
session). `server.ts` now adds all of them to the push-recipient `Set`
(which already dedupes). Covered by 6 tests in `clientAccess.test.ts`,
including a regression test reproducing the exact "Staff sorts before
Owner in the snapshot" scenario that the old `.find()` implementation
would have gotten wrong.

### 4c. Driver Approved notification never reached the approved driver

The `PATCH /api/drivers/:id/status` "approved" branch called
`pushNotification("", "", "driver_registration", "Driver Approved", ...)`
with an **empty `shipmentId`** — a newly-approved driver isn't necessarily
assigned to any shipment yet. Two independent effects silently dropped it:

- **Push**: the recipient-resolution block only reads
  `ship.assignedDriverId` from `if (shipmentId) { const shipDoc = ... }` —
  with `shipmentId === ""` this block never runs, so the driver was never
  added to `userIds`. Only admins (always included) got the push.
- **In-app**: `GET /api/notifications`'s driver branch filtered strictly by
  `myShipmentIds.has(n.shipmentId)` — an empty-string `shipmentId` never
  matches a real shipment id, so even after logging in, the approved
  driver's own notification feed would never show it.

**Fix**: added `AppNotification.recipientUserId` (optional; see
`src/types.ts`) and a matching `recipientUserId` parameter on
`pushNotification()`. When set, it's added to the push `userIds` Set
**unconditionally**, before (and independent of) the `if (shipmentId)`
block, and it's stored on the notification doc. `GET /api/notifications`
(via `isNotificationForDriver`, `src/lib/notificationAccess.ts`) and
`POST /api/notifications/:id/read` (§4d) both treat `recipientUserId ===
the caller's own session id` as sufficient access on its own — on top of,
not instead of, the existing shipment-scoped rules. The "Driver Approved"
call site now passes `driverData.id` as `recipientUserId`.

The "New Driver Registration" notification (self-registration submitted,
sent to admins so one of them can approve/reject it) was **not**
changed — it's intentionally admin-only; the registering driver has no
session yet to receive anything.

### 4d. Direct recipients could bypass channel-visibility checks (found during PR review)

`POST /api/notifications/:id/read`'s channel-visibility check
(`isChatNotificationVisibleToRole`) lived **inside** the `if
(!isDirectRecipient)` branch, alongside the shipment-ownership lookup —
meaning a direct recipient (§4c's `recipientUserId` mechanism) skipped it
entirely. `recipientUserId` is only ever combined with the non-gated
`driver_registration` type today, so this had no live exploit path, but it
was a real latent bypass of the exact audience rule PR #44 already
enforces everywhere else on this same route (and on `GET
/api/notifications`).

**Fix**: extracted the full authorization decision into
`canMarkNotificationRead(notification, role, callerId, ownsViaShipment)`
(`src/lib/notificationAccess.ts`) — a pure function, unit-testable without
booting the Express server. `server.ts` now computes `ownsViaShipment`
(the existing async shipment lookup, unchanged) and `isDirectRecipient`,
then calls this one function, which runs
`isChatNotificationVisibleToRole` **unconditionally** for every non-admin
caller regardless of which path established their access. Covered by 8
tests (§7), including the exact "direct recipient, wrong channel"
scenario for `chat`, `doc_upload`, and `ai_alert`.

### 4e. Shared `read` flag caused cross-role/cross-account contamination for every role, not just Driver

The original Driver-badge fix (§4a) wrote to the single, shared
`AppNotification.read` boolean — every driver, client, and admin who could
see a given notification read the *same* document, so one person's read
silently marked it read for everyone else too. This section is the
complete fix, covering **all three roles**:

**`AppNotification.readByUserIds?: string[]`** (`src/types.ts`) is the
sole source of truth for whether a *specific* user has read a given
notification — their own verified session id must appear in the array.
Absent/empty means unread for everyone, including every notification
written before this field existed (no data migration performed or
needed). The legacy `read` boolean is **left in the schema, untouched by
any of this** — `POST /api/notifications/:id/read` and `POST
/api/notifications/clear` (§4f) never read or write it; it exists purely
for backward compatibility with the field itself, not with any behavior.

**Driver** (`DriverApplication.tsx`) — see §4a/§5 for the flow. Reader id:
`loggedInDriverId`.

**Client** (`ClientDashboard.tsx`) — `handleMarkAllRead` (triggered by the
notification panel's "Mark all as read" button) now:
- Computes unread ids via `isNotificationReadForUser(n, clientId)`, not
  `!n.read`.
- Calls `POST /api/notifications/:id/read` per id, skipping any id already
  in-flight (`markingNotifsReadRef`, the same duplicate-request guard used
  for Driver).
- Updates each id's local `readByUserIds` (via `addReaderToNotification`,
  which preserves every existing id) **only after that id's own request
  succeeds**. A failed request for one id leaves only that id unread —
  every other id's already-applied update is unaffected (§7).
- The bell badge, the panel's unread count, the "Mark all as read" button's
  visibility, and each notification card's unread styling all switched
  from `!n.read` to `!isNotificationReadForUser(n, clientId)`.
- Reader id: `clientId` — the verified session's own client record id
  (`session.client?.id`, threaded through as an existing prop), which is
  **distinct for a Client Owner vs. each Client Staff account on the same
  company** even though they share `companyName`. This is exactly why
  Owner reading a notification does not mark it read for Staff, and vice
  versa (§7) — they have different reader ids by construction, with no
  new code needed to keep them apart.

**Admin** (`AdminPanel.tsx`) — `handleMarkNotifRead` (per-item) and the
bell/panel/mobile-sheet unread computations all switched from `!n.read` to
`!isNotificationReadForUser(n, ownAdminId)`, with the same in-flight-guard
and after-success-only local update pattern as Driver/Client.
**`ownAdminId` is *not* the `adminEmail` prop.** `req.session.id`
server-side is the super-admin's email for the super-admin (where email
and id happen to coincide), but a **sub-admin's `admins/{id}` Firestore
document id** for every other admin type — a genuinely different value
from their email. Using `adminEmail` would have silently broken the badge
for every sub-admin (their own reads would never match what the server
actually stored in `readByUserIds`). `ownAdminId` instead uses
`getOwnSessionId()` — a function already present in this file for the
identical "recognize my own identity, not for authorization" purpose (the
own-chat-message toast guard) — which decodes `id` directly out of this
admin's own signed session token, matching `req.session.id` exactly for
every admin type. `MobileNotificationsSheet.tsx` (a separate component
rendering the same notifications on mobile) received a new `currentUserId`
prop carrying this same value, so its own unread count/styling compute
identically to the desktop dropdown.

## 4f. Admin global "clear" redefined as atomic per-admin "mark all as read"

`POST /api/notifications/clear` previously set the legacy shared `read`
flag `true` on every unread notification — global, not per-user, and the
same cross-contamination bug as §4e for every admin at once. It now means
**"mark every notification visible to the current admin as read, for this
admin only"**:

- Still `requireRole("admin")` — unchanged, admin-only.
- For every notification in the collection, atomically adds *only* the
  calling admin's own session id to `readByUserIds`, via the same
  `addNotificationReaderId` helper (§5) `POST /api/notifications/:id/read`
  uses — real Firestore `arrayUnion()`, or the equivalent idempotent
  Set-union in memory fallback. Never a full-document write.
- Never reads or writes the legacy `read` field.
- Never adds any id other than the caller's own — another admin's,
  driver's, or client's `readByUserIds` entry is untouched (§7).
- UI wording was already correct before this PR ("Mark all as read" — both
  the desktop dropdown button and `MobileNotificationsSheet`'s button
  already said this, not "Clear"); only the route's internal comments and
  error message (`"Failed to clear notifications"` →
  `"Failed to mark all notifications as read"`) needed updating to match
  the corrected semantics.

## 5. Unread flow — per-user read model (how it got here, and the final atomic form)

Three review passes shaped this model; each caught something the previous
one missed:

1. **First pass**: Driver's badge fix wrote to the shared `read` flag —
   reproduced the exact one-user-affects-everyone bug it was meant to fix.
2. **Second pass**: `readByUserIds` was added and the route switched to it
   for Driver — but the route *also* still set `notif.read = true`
   alongside it, via a full-document `setDoc` (non-atomic, and still let a
   Driver's read flip the flag Admin/Client were still reading from).
3. **Third and final pass (this revision)**: the route no longer touches
   `read` at all, the write is a genuine atomic field update (not a
   read-then-write of the whole document), and **Admin and Client are
   fully migrated** to the same `readByUserIds` model Driver uses — so
   there is no longer any live code path anywhere in this app that reads
   or writes the legacy `read` field for personal unread state, for any
   role.

```
Any role (Driver / Client / Admin) opens its notifications view
  → unread ids computed via isNotificationReadForUser(notif, ownId)
    — NEVER notif.read, for any of the three roles
  → for each unread id (guarded against duplicate in-flight requests):
      POST /api/notifications/:id/read
      → server: canMarkNotificationRead(...) authorization check (§4d)
      → server: addNotificationReaderId(notificationId, req.session!.id)
          — a DEDICATED atomic helper (server.ts), not the generic
          setDoc/updateDoc wrappers:
            • real Firestore: rawUpdateDoc(ref, { readByUserIds:
              arrayUnion(callerSessionId) }) — a genuine atomic
              field-scoped update; Firestore guarantees this is safe
              under two concurrent writers, no transaction needed, and
              it touches ONLY readByUserIds — never `read`, never any
              other field, never the whole document.
            • memory fallback: a direct assignment of just the
              readByUserIds property on the already-stored record
              (addReaderToNotification's Set-union, src/lib/
              notificationAccess.ts) — again, only that one field.
      → on 2xx: the calling role's local state updates via the same
        addReaderToNotification (preserves every existing id)
        → its own unread count recomputes instantly (useMemo),
          via isNotificationReadForUser — never notif.read
      → on failure: console.error, that one id stays unread both
        locally and on the server, retried next run — every other
        id's already-applied update is unaffected
```

Admin's bulk "mark all as read" (`POST /api/notifications/clear`, §4f)
follows the identical `addNotificationReaderId` path, just applied to
every notification in one request instead of one id at a time.

**Backward compatibility, as required:**
- No production data was migrated. A notification with no `readByUserIds`
  field at all behaves exactly like one with an empty array — unread for
  everyone, for every role — and becomes readable the normal way the first
  time any given user reads it.
- The legacy `read` field was **not** removed or renamed — it remains in
  `AppNotification` and in every existing document, simply unread and
  unwritten by any personal-unread-state code path now (Driver, Client,
  Admin per-item, and Admin mark-all all migrated).
- **Atomic, field-scoped write — never a read-modify-write of the whole
  document.** `addNotificationReaderId` (`server.ts`) is deliberately not
  routed through the generic `setDoc`/`updateDoc` wrappers: `setDoc` would
  send the entire notification document back on every read; the generic
  `updateDoc` wrapper would work for real Firestore (a raw `arrayUnion()`
  `FieldValue` survives this file's `cleanUndefined()` untouched, via its
  existing "native class instance" guard) but would silently corrupt
  `readByUserIds` in memory-fallback mode, where `handleUpdateDocMemory`'s
  plain object spread would store the `FieldValue` sentinel itself instead
  of resolving it into an array. `addNotificationReaderId` branches on
  `useMemoryFallback` itself: real Firestore gets a genuine atomic
  `arrayUnion()` field update; memory fallback gets the equivalent
  idempotent `addReaderToNotification` Set-union, applied by direct field
  assignment (never a full-object replace). The initial `getDoc` each
  route still does happens only to evaluate the authorization checks
  (§4d) — it is never written back as a whole document.

## 6. Driver / Client / Admin flow summary (all three fully migrated)

- **Driver** (`DriverApplication.tsx`): polls `GET /api/notifications`
  every 12s, toasts on newly-seen ids, badge and list from
  `isNotificationReadForUser(n, loggedInDriverId)`. Fixed in this PR (§4a,
  §4c, §4d, §4e, §5).
- **Client** (`ClientDashboard.tsx`): bell badge, panel unread count,
  "Mark all as read" visibility, and per-card unread styling all from
  `isNotificationReadForUser(n, clientId)`; `handleMarkAllRead` per-id,
  after-success-only, duplicate-guarded (§4e). Client Owner and each
  Client Staff account read independently — reading as one never affects
  the other's badge.
- **Admin** (`AdminPanel.tsx`): desktop dropdown, `MobileTopAppBar`/
  `MobileMoreMenu` badge counts, and `MobileNotificationsSheet` all from
  `isNotificationReadForUser(n, ownAdminId)`; `handleMarkNotifRead`
  per-item and `handleMarkAllNotifsRead` (→ `POST
  /api/notifications/clear`, §4f) both after-success-only and
  duplicate-guarded for the per-item case. One admin reading, or bulk
  "marking all as read," never affects another admin's own badge.

No role's personal unread state reads or writes the legacy `read` field
anywhere in this codebase as of this revision.

## 7. Tests added

- `src/lib/notificationAccess.test.ts` (34 tests total):
  - `isNotificationForDriver` (7): own-shipment match, direct-recipient
    match with no shipment at all, no-match cases, both-match case, and
    an empty-string-shipmentId edge case.
  - `isNotificationReadForUser` / `addReaderToNotification` (6): base
    idempotency/preservation/legacy-compat cases.
  - `canMarkNotificationRead` (8): admin always allowed regardless of
    channel; a direct recipient **rejected** for `chat`/`internal_staff`/
    `ai_alert` outside their own channel (the core §4d fix); a direct
    recipient allowed for a non-channel-gated type and for their own
    correctly-scoped chat channel; a shipment owner still requires the
    correct channel too (pre-existing PR #44 rule, unchanged); neither
    path allowed without the other.
  - Atomic per-user read update (5): the computation never reads or
    produces a `read` value; sequential different-user reads both persist;
    same-user repeats stay idempotent; existing ids preserved without
    mutating the input; the memory-fallback union matches a
    locally-simulated Firestore `arrayUnion` for identical input
    sequences.
  - **Full per-role migration (8, new this revision)**: Admin A reading
    does not mark read for Admin B; Client Owner reading does not mark
    read for Client Staff, and vice versa (with each account's own read
    status independently preserved); Driver reading does not affect
    Client or Admin; Admin "mark all as read" only ever adds the calling
    admin's own id, across multiple notifications with varying existing
    reader ids; a partial Client mark-all-read failure leaves only the
    failed notification(s) unread; existing reader ids are preserved
    across Driver, Client, and Admin reading independently; repeated reads
    stay idempotent; a legacy notification with no `readByUserIds` is
    unread for every role until that role reads it, with no data
    migration required.
- `src/lib/clientAccess.test.ts` (+6 tests) — `resolveClientPushRecipientIds`
  (§4b), unchanged from prior revisions of this PR.
- Existing `chatVisibility.test.ts` (38 tests, unchanged) already covers
  the full channel-privacy matrix reviewed in §3.

`npm run test`: **447/447 passing** (407 carried over from before this PR +
40 new across this PR's four revisions).

Component-level (`AdminPanel.tsx`/`ClientDashboard.tsx`/
`DriverApplication.tsx`) behavior is exercised through the shared pure
functions above rather than a rendered-component test, consistent with
this repo's established convention (no `.test.tsx`/testing-library
harness exists in this codebase; UI logic is validated by extracting it
into `src/lib/*.ts` and testing that directly — see `docs/
CODE_CLEANUP_AUDIT.md` for the same convention noted elsewhere).

## 8. Remaining issues (not fixed in this Phase-1 pass)

- **Full-collection-scan reads**: `GET /api/notifications` fetches the
  entire `notifications` collection on every call and filters in JS, and
  `POST /api/notifications/clear` (§4f) now does an
  `addNotificationReaderId` call per document in the collection rather
  than a single batched write — a pre-existing, systemic full-scan
  pattern across this codebase's server routes (already documented in
  `docs/FOLLOW_UP_ROADMAP.md`), not something this PR changes
  structurally, just applies the correct per-user semantics to.
- **No push-delivery confirmation/retry**: `sendEachForMulticast` errors
  are caught and logged only; a failed push is never retried or surfaced
  to the sender. Pre-existing behavior, unchanged.
- **`recipientUserId` is currently only populated by the driver-approval
  event.** The mechanism is generic (any role, any event) so a future
  no-shipment event can reuse it without another schema change.
- Consider whether `PATCH /api/drivers/:id/status`'s "rejected" branch
  should also notify the driver directly (it currently only logs an
  activity entry, no notification/push at all) — out of scope for this
  PR since the task only named the approved-driver case.

## 9. Recommendations for a future phase

1. As notification volume grows, replace the full-collection-scan reads
   (and `POST /api/notifications/clear`'s per-document loop, §8) with
   real Firestore queries/batched writes, consistent with the
   already-documented systemic full-scan tracked in
   `docs/FOLLOW_UP_ROADMAP.md`.
2. Consider migrating some of `server.ts`'s other single-document
   read-modify-write mutations (the pattern used everywhere except the
   shipment-sequence-counter transaction and, as of this revision,
   `addNotificationReaderId`) to atomic field updates where the same
   class of concurrent-write race could matter — this PR's
   `addNotificationReaderId` is a template for that pattern, not a
   one-off.
3. If a Firebase emulator becomes available in CI, add an integration
   test exercising the real `pushNotification()` recipient resolution and
   the real `POST /api/notifications/:id/read` / `/clear` routes
   (including their `arrayUnion` writes) against a live Firestore
   instance — today's coverage proves the memory-fallback path's logic
   and its equivalence to `arrayUnion`'s *documented* semantics, but has
   not exercised a real `arrayUnion` call, per this repo's established
   testing convention for `server.ts` logic (no server.ts test file;
   pure-function extraction instead).
4. Consider whether `PATCH /api/drivers/:id/status`'s "rejected" branch
   should notify the driver directly (§8).

## 10. Confirmation

No changes were made to business rules, role permissions, Client Owner/
Staff behavior (Owner and Staff still have identical company-level
access, and now independently correct personal read state), authentication/
session behavior, API request/response contracts (the endpoints named in
this doc keep their existing routes, methods, and response shapes —
`recipientUserId` and `readByUserIds` are additive optional fields, not
breaking changes to any existing contract), persisted field names (aside
from the two additive fields above; the legacy `read` field was not
removed or renamed), Firestore collection names, Firebase/Storage rules,
shipment numbering, chat channel rules, document visibility rules,
accounting calculations, GPS update intervals, production configuration,
environment files, `package.json`/lockfile, Capacitor configuration, or
any file under `ios/`/`android/`. No production data was migrated or
altered. No app version/build change, no deploy, no TestFlight upload, no
App Store Review submission changes.
