# Notification System Audit — Phase 1

Branch: `fix/notification-phase1-driver-read-safety`. Scope: Driver
unread-badge bug (now on a correct, atomic, `read`-preserving per-user read
model — see §5 for the two review passes that got it there), a backend
privacy/channel-leakage review (including a direct-recipient channel-bypass
found and fixed along the way, §4d), Client Owner/Staff push fan-out, and the
Driver Approved notification. No business rules, role permissions, API
contracts, Firebase architecture, or iOS configuration were touched beyond
what's described below.

## 1. Architecture

Two independent notification surfaces, both driven from one shared write
path:

- **In-app notifications** — Firestore `notifications` collection
  (`AppNotification`, `src/types.ts`). Written by `pushNotification()`
  (`server.ts`), read via `GET /api/notifications`, marked read via
  `POST /api/notifications/:id/read` (any authenticated role, own
  notifications only) or `POST /api/notifications/clear` (admin only, marks
  every notification in the entire collection read — legacy, unchanged,
  see §5).
- **Push notifications** — Firebase Cloud Messaging, sent from the same
  `pushNotification()` call via `pushMessaging.sendEachForMulticast()`.
  Recipients are resolved server-side from device tokens in the
  `pushTokens` collection (`POST /api/push-tokens` registers one,
  `DELETE /api/push-tokens/:token` requires the caller to own it — see
  `src/lib/pushTokenAccess.ts`).

Every notification carries a `shipmentId` (empty string `""` for events with
no associated shipment), an optional `recipientUserId` (§4c) for events that
need to reach one specific user regardless of shipment, a legacy `read`
boolean (§5), and — as of this revision — an optional `readByUserIds` array
(§5), the correct per-user read model.

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
- **`recipientUserId` — real bypass found and fixed here (§4d)**: the
  initial version of this PR's `POST /api/notifications/:id/read` let a
  direct recipient (`recipientUserId` matching the caller) skip the
  channel-visibility check entirely, because that check lived inside the
  same `if (!isDirectRecipient)` branch as the shipment-ownership lookup.
  A direct recipient could, in principle, have marked read a
  `client_admin`/`driver_admin`/`internal_staff`/`ai_alert`-scoped
  notification outside their own audience. Not exploitable *today* — the
  only real call site (`recipientUserId` on the "Driver Approved" event)
  uses a non-channel-gated type — but fixed as defense in depth against a
  future call site combining the two. See §4d.

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
uses. It **never** calls `POST /api/notifications/clear` (admin-only; a
driver session has no permission to call it, and it would mark the
*entire collection* read, not just this driver's own visible
notifications). See §5 for the exact read-state model this now uses —
revised from the version first shipped in this PR (see below).

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

Reported against the first version of this PR: `POST
/api/notifications/:id/read`'s channel-visibility check
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
caller regardless of which path established their access. Covered by 9
new tests (§7), including the exact "direct recipient, wrong channel"
scenario for `chat`, `doc_upload`, and `ai_alert`.

## 5. Unread flow — per-user read model (corrected, then made atomic and read-preserving)

**The first version of this PR fixed the Driver badge by writing to the
same shared `read: boolean` field every other role and every other user
reads** — which reproduced the identical class of bug it was meant to fix:
Driver A opening their notifications flipped `read` to `true` on the
shared document, silently marking that notification read for Driver B,
Admin, and Client too. Caught in review; `readByUserIds` was added and the
route switched to it.

**A second review pass found the route still set `notif.read = true`
alongside the new `readByUserIds` write, via a full-document `setDoc`.**
That meant a Driver's own read could still flip the shared flag Admin/
Client consume — the same cross-contamination the per-user model exists to
prevent, just moved from `read`-only-write to `read`-plus-`readByUserIds`.
The full-document `setDoc` (read-then-write) was also non-atomic: two
different users reading the same notification at nearly the same moment
could race, with one's write silently overwriting the other's just-added
id. **Both are fixed as of this revision:**

**`AppNotification.readByUserIds?: string[]`** (`src/types.ts`) is the
source of truth for whether a *specific* user has read a given
notification: their own verified session id must appear in this array.
Absent/empty means unread for everyone, including every notification
written before this field existed (no data migration performed or
needed). The legacy `read` boolean is **left in place, and is no longer
touched by `POST /api/notifications/:id/read` at all** — its value is
whatever it already was, forever, from this route's perspective. It is
still written by the legacy admin-wide `POST /api/notifications/clear`
only (unchanged, §8).

```
Driver opens Notifications tab
  → useEffect(activeTab === 'notifications') fires
  → unread ids computed from myNotifications, using
    isNotificationReadForUser(notif, loggedInDriverId) — i.e. is this
    driver's own id in notif.readByUserIds — NEVER notif.read
  → markNotificationsRead(ids)
      → skip any id already in-flight (markingNotifsReadRef)
      → POST /api/notifications/:id/read for each remaining id
      → server: addNotificationReaderId(notificationId, callerSessionId)
          — a DEDICATED atomic helper (src/lib/notificationAccess.ts's
          addReaderToNotification is its pure core), not the generic
          setDoc/updateDoc wrappers:
            • real Firestore: rawUpdateDoc(ref, { readByUserIds:
              arrayUnion(callerSessionId) }) — a genuine atomic
              field-scoped update; Firestore guarantees this is safe
              under two concurrent writers, no transaction needed, and
              it touches ONLY readByUserIds — never `read`, never any
              other field, never the whole document.
            • memory fallback: a direct assignment of just the
              readByUserIds property on the already-stored record
              (addReaderToNotification's Set-union) — again, only that
              one field, nothing else.
      → on 2xx: local state updates via the same addReaderToNotification
                → unreadNotificationCount recomputes instantly (useMemo),
                  via isNotificationReadForUser — never notif.read
      → on failure: console.error, id stays unread for this driver
        both locally and on the server, retried next run
```

**Backward compatibility, as required:**
- No production data was migrated. A notification with no `readByUserIds`
  field at all behaves exactly like one with an empty array — unread for
  everyone — and becomes readable the normal way the first time anyone
  calls `POST /api/notifications/:id/read` on it.
- The legacy `read` field was **not** removed or renamed. It simply is no
  longer written by this particular route — it keeps whatever value it
  already had (see the consequence noted in §6/§8: Admin/Client's own
  per-item read, which calls this same route, no longer persists a
  read-across-refresh signal via `read` the way it incidentally did in
  the previous revision).
- **`POST /api/notifications/clear` (admin global clear) remains legacy,
  by explicit scope decision**: it still only touches `read`, never
  `readByUserIds`, and is unchanged by this revision.
- **Atomic, field-scoped write — not a read-modify-write of the whole
  document.** `addNotificationReaderId` (`server.ts`) is a dedicated
  helper, deliberately not routed through the generic `setDoc`/`updateDoc`
  wrappers: `setDoc` would send the entire notification document back on
  every read; the generic `updateDoc` wrapper would work for real
  Firestore (a raw `arrayUnion()` `FieldValue` survives this file's
  `cleanUndefined()` untouched, via its existing "native class instance"
  guard) but would silently corrupt `readByUserIds` in memory-fallback
  mode, where `handleUpdateDocMemory`'s plain object spread would store
  the `FieldValue` sentinel itself instead of resolving it into an array.
  `addNotificationReaderId` branches on `useMemoryFallback` itself: real
  Firestore gets a genuine atomic `arrayUnion()` field update (no
  transaction needed — Firestore itself guarantees this is race-free
  under concurrent writers); memory fallback gets the equivalent
  idempotent `addReaderToNotification` Set-union, applied by direct
  field assignment (never a full-object replace). The initial `getDoc`
  in the route still happens, but only to evaluate the authorization
  checks (§4d) — it is never written back as a whole document anymore.

## 6. Driver / Client / Admin flow summary

- **Driver** (`DriverApplication.tsx`): polls `GET /api/notifications`
  every 12s, toasts on newly-seen ids, badge from
  `unreadNotificationCount` — computed via `readByUserIds` (§5). Fixed in
  this PR (§4a, §4c, §4d, §5).
- **Client** (`ClientDashboard.tsx`): its `handleMarkAllRead` still calls
  the correct per-notification endpoint, so it now correctly populates
  `readByUserIds` for whichever client account calls it — but its own
  unread badge still reads the legacy `read` flag, which this route no
  longer sets at all (§5). **Consequence: Client's own per-item read no
  longer persists as "read" across a page refresh** (the local optimistic
  UI update still works within the same session, but a fresh `GET
  /api/notifications` will show `read: false` again, unchanged by this
  route). Not fixed in this Phase-1 pass since it's Driver-scoped; see §8.
- **Admin** (`AdminPanel.tsx`): `handleMarkNotifRead` (per-item) has the
  same consequence as Client above — its local optimistic update still
  works, but the server's `read` field is no longer flipped by this route,
  so it won't persist across a refresh either. `handleMarkAllNotifsRead`
  uses the admin-only `POST /api/notifications/clear`, unaffected and
  still legacy (§5).

## 7. Tests added

- `src/lib/notificationAccess.test.ts` (26 tests total):
  - `isNotificationForDriver` (7): own-shipment match, direct-recipient
    match with no shipment at all, no-match cases, both-match case, and
    an empty-string-shipmentId edge case.
  - `isNotificationReadForUser` / `addReaderToNotification` (6): Driver A
    reading does not mark it read for Driver B; a Driver reading does not
    mark it read for Admin or Client; repeated reads by the same user are
    idempotent (no duplicate entries); existing `readByUserIds` entries
    are preserved when a new user reads it; a legacy notification with no
    `readByUserIds` field at all remains safely readable; an empty
    `readByUserIds` array means unread for everyone, not read-by-default.
  - `canMarkNotificationRead` (8): admin always allowed regardless of
    channel; a direct recipient **rejected** for `chat` outside their own
    channel (the core §4d fix); a direct recipient rejected for
    `internal_staff`; a direct recipient rejected for `ai_alert`; a direct
    recipient allowed for a non-channel-gated type (`driver_registration`,
    the real "Driver Approved" case); a direct recipient allowed for
    their own correctly-scoped chat channel; a shipment owner still
    requires the correct channel too (pre-existing PR #44 rule,
    unchanged, now re-verified through this function); neither a direct
    recipient nor a shipment owner is allowed regardless of channel.
  - **Atomic per-user read update (5, new this revision)**: the
    computation never reads or produces a `read` value (proving the
    legacy flag is structurally outside this code path, not just
    unwritten by convention); two different users added sequentially both
    remain in `readByUserIds`; repeated same-user reads stay idempotent
    even interleaved with a different user's read; existing reader ids
    are preserved (and the input array is never mutated); the
    memory-fallback union and a locally-simulated Firestore `arrayUnion`
    produce identical results for the same input sequence — the closest
    proof of memory-fallback/Firestore parity available without a live
    Firestore emulator in this environment (see §9.6).
- `src/lib/clientAccess.test.ts` (+6 tests) — `resolveClientPushRecipientIds`
  (§4b), unchanged from prior revisions of this PR.
- Existing `chatVisibility.test.ts` (38 tests, unchanged) already covers
  the full channel-privacy matrix reviewed in §3.

`npm run test`: **439/439 passing** (407 carried over from before this PR +
32 new across this PR's three revisions).

## 8. Remaining issues (not fixed in this Phase-1 pass)

- **Admin and Client's own per-item read no longer persists across a page
  refresh.** Both `AdminPanel.tsx`'s `handleMarkNotifRead` and
  `ClientDashboard.tsx`'s `handleMarkAllRead` call the same `POST
  /api/notifications/:id/read` route Driver now uses — which, as of this
  revision, **never** touches the legacy `read` field. Their own local
  optimistic state update still works within the same session (they set
  `read: true` client-side after a 2xx response, independent of the
  response body), but a fresh `GET /api/notifications` (e.g. after a
  reload) will show `read: false` again, since nothing on the server sets
  it true anymore via this route. This is the direct, deliberate
  consequence of closing the Driver/Admin/Client cross-contamination bug
  the task asked to fix — Admin and Client simply have not been migrated
  to `readByUserIds` *yet* in this pass (explicit scope: this task named
  Driver only). A future phase must migrate `AdminPanel.tsx`'s
  `handleMarkNotifRead`/badge and `ClientDashboard.tsx`'s
  `handleMarkAllRead`/badge to `isNotificationReadForUser`/
  `readByUserIds`, the same way `DriverApplication.tsx` was in this PR —
  until then, Admin/Client read-state does not survive a refresh.
- **`POST /api/notifications/clear` (admin global clear) remains on the
  legacy shared `read` model** — explicitly scoped as legacy-for-now per
  this task's instructions; it still only ever touches `read`, never
  `readByUserIds`, and is unaffected by any of this PR's changes.
- **`ClientDashboard.tsx`'s `handleMarkAllRead` marks every notification
  read in local state *before* awaiting the backend requests, and does
  not roll back on a partial/total failure** (`console.error`-only) — a
  separate bug from the read-model issue above, contradicting the "failed
  requests must remain unread" principle applied to the Driver fix in
  this PR. Left untouched (Driver-scoped PR).
- **Full-collection-scan reads**: `GET /api/notifications` fetches the
  entire `notifications` collection on every call and filters in JS — a
  pre-existing, systemic pattern across this codebase's server routes
  (already documented in `docs/FOLLOW_UP_ROADMAP.md`), not something this
  PR changes.
- **No push-delivery confirmation/retry**: `sendEachForMulticast` errors
  are caught and logged only; a failed push is never retried or surfaced
  to the sender. Pre-existing behavior, unchanged.
- **`recipientUserId` is currently only populated by the driver-approval
  event.** The mechanism is generic (any role, any event) so a future
  no-shipment event can reuse it without another schema change.

## 9. Recommendations for a future phase

1. Migrate Admin and Client to `readByUserIds`/`isNotificationReadForUser`
   for their own unread badges — this also resolves the "doesn't persist
   across refresh" consequence noted in §8 — and decide what (if
   anything) `POST /api/notifications/clear` should do to `readByUserIds`
   once they are (e.g. add the calling admin's id to every notification's
   array, or leave it a deliberately cross-role legacy operation).
2. Fix `ClientDashboard.tsx`'s `handleMarkAllRead` to match the
   after-success-only local-state-update pattern used here.
3. Consider whether `PATCH /api/drivers/:id/status`'s "rejected" branch
   should also notify the driver directly (it currently only logs an
   activity entry, no notification/push at all) — out of scope for this
   PR since the task only named the approved-driver case.
4. As notification volume grows, replace the full-collection-scan reads
   with real Firestore queries, consistent with the already-documented
   systemic full-scan tracked in `docs/FOLLOW_UP_ROADMAP.md`.
5. Consider migrating some of `server.ts`'s other single-document
   read-modify-write mutations (the pattern used everywhere except the
   shipment-sequence-counter transaction and, as of this revision,
   `addNotificationReaderId`) to atomic field updates where the same
   class of concurrent-write race could matter — this PR's
   `addNotificationReaderId` is a template for that pattern, not a
   one-off.
6. If a Firebase emulator becomes available in CI, add an integration
   test exercising the real `pushNotification()` recipient resolution and
   the real `POST /api/notifications/:id/read` route (including its
   `arrayUnion` write) against a live Firestore instance — today's
   coverage proves the memory-fallback path's logic and its equivalence
   to `arrayUnion`'s *documented* semantics, but has not exercised a real
   `arrayUnion` call, per this repo's established testing convention for
   `server.ts` logic (no server.ts test file; pure-function extraction
   instead).

## 10. Confirmation

No changes were made to business rules, role permissions, Client Owner/
Staff behavior (Owner and Staff still have identical company-level
access), authentication/session behavior, API request/response contracts
(the endpoints named in this doc keep their existing routes, methods, and
response shapes — `recipientUserId` and `readByUserIds` are additive
optional fields, not breaking changes to any existing contract), persisted
field names (aside from the two additive fields above; the legacy `read`
field was not removed or renamed), Firestore collection names, Firebase/
Storage rules, shipment numbering, chat channel rules, document visibility
rules, accounting calculations, GPS update intervals, production
configuration, environment files, `package.json`/lockfile, Capacitor
configuration, or any file under `ios/`/`android/`. No production data was
migrated or altered. No app version/build change, no deploy, no TestFlight
upload, no App Store Review submission changes.
