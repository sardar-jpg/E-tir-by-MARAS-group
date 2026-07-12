# Notification System Audit — Phase 1

Branch: `fix/notification-phase1-driver-read-safety`. Scope: Driver unread-badge
bug, a backend privacy/channel-leakage review, Client Owner/Staff push
fan-out, and the Driver Approved notification. No business rules, role
permissions, API contracts, Firebase architecture, or iOS configuration were
touched beyond what's described below.

## 1. Architecture

Two independent notification surfaces, both driven from one shared write
path:

- **In-app notifications** — Firestore `notifications` collection
  (`AppNotification`, `src/types.ts`). Written by `pushNotification()`
  (`server.ts`), read via `GET /api/notifications`, marked read via
  `POST /api/notifications/:id/read` (any authenticated role, own
  notifications only) or `POST /api/notifications/clear` (admin only, marks
  every notification in the entire collection read).
- **Push notifications** — Firebase Cloud Messaging, sent from the same
  `pushNotification()` call via `pushMessaging.sendEachForMulticast()`.
  Recipients are resolved server-side from device tokens in the
  `pushTokens` collection (`POST /api/push-tokens` registers one,
  `DELETE /api/push-tokens/:token` requires the caller to own it — see
  `src/lib/pushTokenAccess.ts`).

Every notification carries a `shipmentId` (empty string `""` for events with
no associated shipment) and, as of this PR, an optional `recipientUserId`
(§5) for events that need to reach one specific user regardless of
shipment.

## 2. Routing

`pushNotification(shipmentId, shipmentNumber, type, titles..., messages...,
excludeUserId?, chatChannel?, recipientUserId?)` resolves push recipients in
one place, reused by every call site:

1. Every admin (admins see every notification with no filtering, so every
   admin gets every push).
2. If `recipientUserId` is set, that user directly — independent of any
   shipment (new in this PR, §5).
3. If `shipmentId` is set and the shipment exists: the assigned driver +
   any additional drivers (unless `shouldNotifyChatParty` excludes them for
   a channel-scoped `chat`/`doc_upload` notification), and every active
   Client Owner/Staff account on the shipment's company (§4).

`excludeUserId` removes the acting user afterward (e.g. a chat sender never
gets paged for their own message).

## 3. Privacy — reviewed, no leakage found, no permissions weakened

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
- **New `recipientUserId` mechanism (§5) does not weaken this**: it is
  compared against the caller's own *verified* session id
  (`req.session!.id`, never client-supplied), so it can only ever grant a
  user visibility into a notification addressed to themself — strictly
  narrower than the existing shipment-ownership rule, not an alternative
  to it.

No fixes were needed for this section — the existing design already holds;
this PR only adds test coverage confirming it (§7) and one small addition
(`recipientUserId`) that is scoped the same way.

## 4. Bugs fixed

### 4a. Driver unread badge never cleared (root cause)

`src/components/driver/NotificationsPanel.tsx` is a pure display
component — opening the Driver Notifications screen (`activeTab ===
'notifications'`) rendered the list but **called no endpoint at all**.
Nothing ever set `read: true`, locally or on the server, so
`unreadNotificationCount` (derived from `notifications.filter(n =>
!n.read).length`) could never change. Confirmed via `grep` — zero calls to
`/api/notifications/:id/read` or `/clear` anywhere in
`DriverApplication.tsx` before this fix, compared with `AdminPanel.tsx`
and `ClientDashboard.tsx`, which do call the per-notification endpoint.

**Fix** (`src/components/DriverApplication.tsx`):
- A `useEffect` fires whenever `activeTab === 'notifications'`, computing
  the currently-visible unread ids (`myNotifications.filter(n =>
  !n.read)`) and calling a new `markNotificationsRead(ids)`.
- `markNotificationsRead` calls `POST /api/notifications/:id/read` — the
  same authenticated, per-notification, own-notification-only endpoint
  every other role already uses. It **never** calls
  `POST /api/notifications/clear` (admin-only; a driver session has no
  permission to call it, and it would mark the *entire collection* read,
  not just this driver's own visible notifications).
- Local state (`setNotifications`) is only updated for an id **after**
  its own request resolves with `res.ok`. A failed request (network error
  or non-2xx) is logged and left unread, both locally and on the server —
  it's retried the next time the effect runs (e.g. the next 12s poll while
  the tab is still open).
- A `markingNotifsReadRef` ref-based in-flight guard prevents the 12s poll
  from firing a duplicate `POST .../read` for an id whose previous request
  hasn't settled yet.
- The effect re-runs on every change to `myNotifications` (new array
  reference each poll), so a notification that arrives *while* the driver
  already has the tab open is caught and marked read too, not just the
  ones present at the moment of opening.
- The scoping rule for "does this notification belong to this driver" was
  extracted into `src/lib/notificationAccess.ts`'s
  `isNotificationForDriver` and is now shared verbatim between
  `DriverApplication.tsx` (two call sites: the fetch-time filter and the
  `myNotifications` memo) and `server.ts`'s `GET /api/notifications` — one
  rule, not three copies that could drift apart.

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
(which already dedupes). Covered by 6 new tests in `clientAccess.test.ts`,
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
`pushNotification()`. When set:
- It's added to the push `userIds` Set **unconditionally**, before (and
  independent of) the `if (shipmentId)` block — so it works with no
  shipment at all.
- It's stored on the notification doc, and both `GET /api/notifications`
  (via `isNotificationForDriver`) and `POST /api/notifications/:id/read`
  (a new `isDirectRecipient` check, evaluated *before* the shipment-lookup
  branch, which previously 404'd on an empty `shipmentId`) treat
  `recipientUserId === the caller's own session id` as sufficient access
  on its own — on top of, not instead of, the existing shipment-scoped
  rules.
- The "Driver Approved" call site now passes `driverData.id` as
  `recipientUserId`, so the approved driver receives both the push and the
  in-app notification the moment they next poll or log in, with no
  dependency on any shipment assignment.

The "New Driver Registration" notification (self-registration submitted,
sent to admins so one of them can approve/reject it) was **not** changed —
it's intentionally admin-only; the registering driver has no session yet
to receive anything, so there's nothing to fix there.

## 5. Unread flow (after this fix)

```
Driver opens Notifications tab
  → useEffect(activeTab === 'notifications') fires
  → unread ids from myNotifications computed
  → markNotificationsRead(ids)
      → skip any id already in-flight (markingNotifsReadRef)
      → POST /api/notifications/:id/read for each remaining id
      → on 2xx: setNotifications(...) flips that id's `read` to true
                → unreadNotificationCount recomputes instantly (useMemo)
      → on failure: console.error, id stays unread, retried next run
```

## 6. Driver / Client / Admin flow summary

- **Driver** (`DriverApplication.tsx`): polls `GET /api/notifications`
  every 12s, toasts on newly-seen ids, badge from `unreadNotificationCount`.
  Fixed in this PR (§4a, §4c).
- **Client** (`ClientDashboard.tsx`): has a working `handleMarkAllRead` that
  calls the correct per-notification endpoint — **but** see §8 (remaining
  issue, not fixed in this Phase-1 pass since it's Driver-scoped).
- **Admin** (`AdminPanel.tsx`): `handleMarkNotifRead` (per-item) already
  follows the correct pattern — only updates local state after `res.ok`.
  `handleMarkAllNotifsRead` uses the admin-only `POST
  /api/notifications/clear`, which is correct for admin's own bulk-clear
  action and is the exact endpoint this PR's Driver fix deliberately
  avoids calling.

## 7. Tests added

- `src/lib/notificationAccess.test.ts` (new, 7 tests) — `isNotificationForDriver`:
  own-shipment match, direct-recipient match with no shipment at all,
  no-match cases, both-match case, and an empty-string-shipmentId edge case.
- `src/lib/clientAccess.test.ts` (+6 tests) — `resolveClientPushRecipientIds`:
  Owner + multiple active Staff all returned, disabled account excluded,
  different company excluded, undefined companyName → empty array, no
  match → empty array, and an explicit regression test for the old
  `.find()` bug's exact failure shape (Staff sorted before Owner).
- Existing `chatVisibility.test.ts` (38 tests, unchanged) already covers
  the full channel-privacy matrix reviewed in §3.

`npm run test`: **420/420 passing** (407 carried over + 13 new).

## 8. Remaining issues (not fixed in this Phase-1 pass)

- **`ClientDashboard.tsx`'s `handleMarkAllRead` marks every notification
  read in local state *before* awaiting the backend requests, and does
  not roll back on a partial/total failure** (`console.error`-only). This
  contradicts the "failed requests must remain unread" principle applied
  to the Driver fix in this PR. Left untouched because this PR's scope is
  explicitly Driver read-safety (see branch name); recommend a Phase 2 fix
  applying the same after-`res.ok`-only update pattern used here and in
  `AdminPanel.tsx`'s per-item handler.
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

1. Fix `ClientDashboard.tsx`'s `handleMarkAllRead` to match the
   after-success-only local-state-update pattern used here.
2. Consider whether `PATCH /api/drivers/:id/status`'s "rejected" branch
   should also notify the driver directly (it currently only logs an
   activity entry, no notification/push at all) — out of scope for this
   PR since the task only named the approved-driver case, but worth a
   deliberate product decision.
3. As notification volume grows, replace the full-collection-scan reads
   with real Firestore queries (`where("shipmentId", "in", [...])` /
   `where("recipientUserId", "==", ...)`), consistent with the
   already-documented systemic full-scan tracked in
   `docs/FOLLOW_UP_ROADMAP.md`.
4. If a Firebase emulator becomes available in CI, add an integration test
   exercising the real `pushNotification()` recipient resolution end to
   end (today's coverage is at the extracted pure-function level, per this
   repo's established testing convention for `server.ts` logic).

## 10. Confirmation

No changes were made to business rules, role permissions, Client Owner/
Staff behavior (Owner and Staff still have identical company-level
access), authentication/session behavior, API request/response contracts
(the endpoints named in this doc keep their existing routes, methods, and
response shapes — `recipientUserId` is a new optional field, not a
breaking change to any existing contract), persisted field names (aside
from the additive `AppNotification.recipientUserId`), Firestore collection
names, Firebase/Storage rules, shipment numbering, chat channel rules,
document visibility rules, accounting calculations, GPS update intervals,
production configuration, environment files, `package.json`/lockfile,
Capacitor configuration, or any file under `ios/`/`android/`. No app
version/build change, no deploy, no TestFlight upload, no App Store Review
submission changes.
