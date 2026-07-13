# Chat Safety & Reliability — Phase 1

Branch: `fix/chat-safety-reliability-phase1`. Internal Staff chat
(`internal_staff` channel, `ChatCenter.tsx`) was treated as the first
priority throughout, since it is a primary, high-usage operational channel
with no other UI surface at all — but every fix in §2–4 below that applies
to a shared mechanism (server-side validation, the chat-composer helpers)
applies identically to Admin full chat, Driver chat, and Client chat.

This PR is safety/reliability only. See §7 for what is explicitly deferred.

## 1. New shared libraries

### `src/lib/chatMessageValidation.ts`

Server-side backstop for `POST /api/shipments/:id/chat`, wired into
`server.ts`. Two independent rules:

- **`isDataUrlFileReference` / `validateChatSendPayload` reject any
  `fileUrl` that is an inline `data:` URL**, regardless of the declared
  `type`. Every upload surface is supposed to call `POST /api/upload`
  first and only ever send back the real Storage URL — but that was
  previously just a client-side convention. If that upload call failed,
  three of the four chat surfaces (Admin full chat, Admin Chat Center's
  Internal Staff composer, and the driver's attachment flow prior to this
  PR) fell back to sending the raw base64 `data:` URL as `fileUrl` anyway.
  A `data:` URL can be large enough to blow past Firestore's 1 MiB
  per-document limit outright, or succeed and permanently bloat that chat
  message — and for an admin-sent `client_admin` attachment specifically,
  it also gets copied into `shipment.documents` and triggers a full
  rewrite of the **entire shipment document**
  (`shouldSaveChatFileAsShipmentDocument`, `chatVisibility.ts`), risking
  that same limit on an otherwise-healthy shipment record.
- **`MAX_CHAT_TEXT_LENGTH = 5000`**, enforced after trimming, and
  whitespace-only text is rejected unless a valid (non-`data:`) file is
  attached. There was previously no length limit anywhere in the chat
  pipeline at all.

Both rules are enforced in exactly one place — `server.ts`'s
`POST /api/shipments/:id/chat` handler — independent of which client sent
the request or whether that client's own validation worked. Every
client-side check (composer `maxLength`, upload-failure handling) is
advisory on top of this, not a substitute for it.

### `src/lib/chatComposerState.ts`

Small, pure pieces of chat UI logic extracted so they're unit-testable
without a component-testing harness (this repo's test suite is Vitest
only — no jsdom / `@testing-library/react`):

- **`canSubmitChatMessage`** — the shared duplicate-send guard. Used by
  all four chat composers (`ChatCenter.tsx`, `App.tsx`, `DriverApplication.tsx`,
  `ClientDashboard.tsx`) so a rapid double-tap/double-Enter can't fire two
  POSTs before the first resolves. Previously only `ChatCenter.tsx`'s
  Internal Staff composer and `ClientDashboard.tsx` had any in-flight
  guard at all; `App.tsx`'s admin drawer and `DriverApplication.tsx` had
  none.
- **`isStaleChatPollResponse`** — used by `DriverApplication.tsx`'s two
  chat polling loops (see §4) to discard a response that arrives after the
  driver has already switched to a different shipment.
- **`applySuccessfulChatPoll` / `applyFailedChatPoll`** — the exact state
  transition a chat poll may produce. A failed poll (non-OK response or a
  thrown error) may only ever set `pollError = true`; it is structurally
  incapable of touching the message list. This is the fix for
  `ChatCenter.tsx` previously wiping a populated thread to an empty array
  on any transient network blip or 500 (on *every* 3-second background
  poll, not just the initial load).
- **`shouldConfirmChannelRead`** — gates `ChatCenter.tsx`'s
  `onChannelRead` callback (which lets `AdminPanel.tsx` optimistically
  clear this admin's local unread badge) on the `POST /chat/seen`
  response actually being OK. Previously this fired unconditionally, so a
  failed mark-seen write could still clear the local unread badge even
  though the server never recorded the read.

## 2. Internal Staff chat (`ChatCenter.tsx`) — the priority surface

- **Upload safety**: `handleSendInternalMessage` now blocks the send
  entirely if `POST /api/upload` fails or throws — no chat message is
  created, and the raw base64 data is never sent as `fileUrl`. The
  composer's text and attachment stay exactly as they were so the admin
  can retry.
- **Upload retry without re-uploading**: a successful upload's real
  Storage URL is cached in `internalUploadedFileUrl` state. A retry after
  a failed `POST /chat` reuses that cached URL instead of uploading the
  same file again — the cache is only cleared on a confirmed successful
  send, or when the admin removes/replaces the attachment
  (`resetInternalAttachment` / `handleInternalFileSelected`).
- **Distinct error states**: `internalSendError` is `'upload'` (the
  upload itself failed, nothing was sent) or `'send'` (the upload
  succeeded but message creation failed) — each with its own translated
  copy, replacing the old single "sent with a temporary copy only" banner
  that no longer applies now that base64 is never sent.
- **Polling never wipes existing messages**: a failed/errored poll only
  sets `pollError = true` (via `applyFailedChatPoll`); `channelMessages`
  is untouched. `hasLoadedMessagesOnce` distinguishes a genuine empty
  conversation from "never successfully loaded this channel yet," which
  get different UI: a full retry state (with a manual "Retry now" button)
  for the latter, and a small non-blocking "Connection lost — retrying…"
  banner above the existing thread for the former.
- **Mark-seen correctness**: `onChannelRead` only fires when
  `POST /chat/seen` responds OK (`shouldConfirmChannelRead`) — a failed
  mark-seen request no longer clears the local unread badge. The
  request itself still passes the specific `channel` (and the route
  still scopes by `shipmentId`), so the existing per-admin,
  shipment-aware, channel-aware `readByAdminIds` behavior
  (`chatUnreadAccess.ts`) is unchanged — see the untouched, still-passing
  `chatUnreadAccess.test.ts` and `chatVisibility.test.ts`.
- **Attachments are now actually openable**: the file bubble is a real
  `<a href download>` (open in a new tab / download), with an inline
  image preview for photo attachments, instead of a non-interactive
  `<div>` with no click handler at all.
- **Timestamps**: every message now renders a formatted, locale-aware
  send time; `senderName` was already shown and remains so.
- **"Internal Only" stays clear**: the persistent internal-channel banner
  is unchanged; the per-file-attachment badge is preserved too.
- **Sizing**: the outer panel switched from `h-[78vh]` to `h-[78dvh]` so
  the iOS on-screen keyboard can't leave the composer hidden below the
  fold (`vh` is computed against the layout viewport, which doesn't
  shrink when the keyboard opens — `dvh` does; this pattern was already
  used elsewhere in `App.tsx`). The smallest metadata text sizes (9px)
  were raised to 10–11px, the composer/attach/remove-attachment touch
  targets were enlarged slightly, and the composer text input now carries
  `maxLength={MAX_CHAT_TEXT_LENGTH}`. Arabic RTL wiring (`dir` on the
  outer container) was not touched.
- **Explicitly not done here**: no redesign of the composer into an
  auto-growing textarea, no date separators — see §7.

## 3. Server (`server.ts`)

`POST /api/shipments/:id/chat` now calls `validateChatSendPayload` (§1)
immediately after reading the request body, before any role/channel
checks, and returns `400` with the validation's own error message if it
fails. This is independent of and in addition to the existing
`chatVisibility.ts` role/channel enforcement, which is unmodified.

## 4. Admin full chat (`App.tsx`) and Driver chat (`DriverApplication.tsx`)

- **Base64 fallback removed.** `handleSendAdminAttachment` (App.tsx) and
  `handleAttachmentSelected` (DriverApplication.tsx) both used to still
  send a chat message when the upload failed — App.tsx with the raw
  base64 `data:` URL as `fileUrl`, DriverApplication.tsx with a dead `"#"`
  placeholder link. Both now block the send outright and show a
  translated error instead, consistent with `ChatCenter.tsx` and with the
  server-side backstop in §1/§3.
- **In-flight send guards added** to `handleSendAdminMessage` (App.tsx,
  previously had none at all) and `handleSendMessage`
  (DriverApplication.tsx, previously had none at all), both via the shared
  `canSubmitChatMessage`. `handleSendAdminAttachment` and
  `handleAttachmentSelected` already had (or now have) an equivalent
  guard against their own uploading-state flags.
- **Stale-response protection added to both polling loops.** App.tsx's
  admin-drawer poll now uses a `cancelled` flag (same pattern already used
  by `ChatCenter.tsx`) so a response for a previously-selected
  shipment/channel can't land after the admin has switched and overwrite
  the new thread. DriverApplication.tsx uses `activeShipmentIdRef` +
  `isStaleChatPollResponse` for the same purpose, since its polling
  closures are re-created on every render rather than living inside a
  single stable effect.
- **Driver's two competing chat polls consolidated where safe.**
  `fetchData`'s 12-second chat fetch and the dedicated 3.5-second
  `fetchChatOnly` loop previously both hit
  `GET /api/shipments/:id/chat` concurrently with no coordination at all
  whenever the driver had the chat tab open. `fetchData`'s own chat fetch
  is now skipped entirely while `activeTab === 'chat'` (the faster poll
  already owns updates in that case); `fetchChatOnly` keeps
  `knownChatMessageIdsRef` in sync while it has that ownership, so
  `fetchData` doesn't treat every message that arrived while the driver
  was chatting as "new" the moment they switch away from the chat tab.
- **Drafts already preserved on failure** in both files (text/attachment
  state was only ever cleared on a confirmed successful send) —
  unchanged, just confirmed and now also covered by the new error
  toasts/guards above.
- Both composers gained `maxLength={MAX_CHAT_TEXT_LENGTH}`.

## 5. Client chat (`ClientDashboard.tsx`)

Already the safest of the four surfaces going into this PR — it rejects
outright on upload failure (no base64 fallback ever existed here) and
uses a real `<textarea>` composer. Changes in this PR:

- Added the same `canSubmitChatMessage` in-flight guard (previously relied
  only on the disabled button attribute).
- Added `maxLength={MAX_CHAT_TEXT_LENGTH}` to the textarea plus a
  client-side length check with translated feedback
  (`textTooLongError`), matching the server-side limit.

## 6. Test coverage

**Automated (Vitest), added or extended in this PR:**

| Requirement | Test |
|---|---|
| `data:` fileUrl rejected | `chatMessageValidation.test.ts` |
| Invalid/malformed file message rejected (no URL, blank URL) | `chatMessageValidation.test.ts` |
| 5000-character boundary accepted / one over rejected | `chatMessageValidation.test.ts` |
| Whitespace-only rejected | `chatMessageValidation.test.ts` |
| Valid attachment-only message accepted | `chatMessageValidation.test.ts` |
| Failed poll preserves previous messages | `chatComposerState.test.ts` (`applyFailedChatPoll`) |
| Empty conversation distinguishable from failed-to-load | `chatComposerState.test.ts` |
| Failed mark-seen does not confirm channel read | `chatComposerState.test.ts` (`shouldConfirmChannelRead`) |
| Stale poll response detection | `chatComposerState.test.ts` (`isStaleChatPollResponse`) |
| Duplicate-send guard | `chatComposerState.test.ts` (`canSubmitChatMessage`) |

**Regression (pre-existing, unmodified, re-run as part of this PR):**

| Requirement | Test |
|---|---|
| Internal_staff attachment never becomes a shipment document | `chatVisibility.test.ts` (`shouldSaveChatFileAsShipmentDocument("internal_staff", "admin") === false`) |
| Existing role/channel privacy matrix unchanged | `chatVisibility.test.ts` (38 tests), `chatUnreadAccess.test.ts` (15 tests) — neither file was touched by this PR |

**Not covered by an automated test — verified by manual smoke test only
(see PR description for the run log), because this repo's test suite has
no component/DOM testing harness (no jsdom, no `@testing-library/react`)
and adding one is out of scope for a safety/reliability PR:**

- Upload failure never sends a chat message (end-to-end, all four
  surfaces).
- Retry after a failed send reuses the cached upload URL rather than
  uploading again (`ChatCenter.tsx` Internal Staff).
- Stale response actually ignored end-to-end during rapid shipment/channel
  switching in `App.tsx` and `ChatCenter.tsx` (the `cancelled`-flag
  mechanism itself, as opposed to the `isStaleChatPollResponse` predicate
  used by `DriverApplication.tsx`, which *is* unit tested).
- **Memory-fallback parity for chat.** The in-memory Firestore fallback
  (`server.ts`'s `memoryStore.chatMessages`) was confirmed structurally
  correct by code review — it's a real array, not silently dropped — but
  the memory-fallback layer isn't currently extracted into an importable,
  unit-testable module, so there is no automated regression test for it
  in this PR. Flagged as a follow-up if dedicated coverage is wanted.

## 7. Bug found and fixed during local smoke testing

Live smoke testing (real dev server, memory-fallback mode, demo accounts —
see PR description for the full run log) surfaced a genuine rendering bug
directly caused by this PR's own 5000-character limit: a message
consisting of one long unbroken run of characters (no spaces — e.g. a
pasted tracking number, URL, or base64-ish string) overflowed its bubble
and the entire chat panel horizontally, in all four chat surfaces
(`ChatCenter.tsx`, `App.tsx`, `DriverApplication.tsx`,
`ClientDashboard.tsx`).

Root cause, confirmed via live DOM inspection: each message row is
`flex flex-col ... items-end`/`items-start` — `align-items` is `flex-end`/
`flex-start`, never `stretch`, so the bubble (a flex item) sizes to its own
content's natural width instead of being constrained by the row. Adding
`break-words` (`overflow-wrap: break-word`) alone had nothing to shrink
into, since the bubble itself had no width ceiling. Fix: added `max-w-full`
alongside `break-words` on the bubble element in all four surfaces, so the
bubble is capped at its row's width (which is itself capped by
`max-w-[75/80/85%]`) and long unbroken text now wraps inside it instead of
overflowing. Verified live in the browser (before/after, matching a
temporary DOM patch used to confirm the fix before editing source) and
via `npx tsc --noEmit`.

## 8. Explicitly deferred (not in this PR)

- **Client Owner/Client Staff per-user "seen" model.** `ClientDashboard.tsx`
  still never calls `POST /chat/seen` at all (a pre-existing gap, not
  introduced or fixed here) — building that out requires first deciding
  whether read state should be per-user (mirroring `readByAdminIds`) or
  per-company, to avoid re-landing the "one admin's read clears it for
  everyone" bug in a new form.
- **Driver multi-driver per-user "seen" model.** Same category of
  decision, for shipments with multiple assigned drivers.
- **Broad UI/UX redesign.** Composer types were not unified into
  auto-growing textareas across all surfaces; message bubble sizing,
  general touch-target audits, and RTL logical-property cleanup
  (`ChatCenter.tsx`'s search bar `left-3`/`pl-8`) are unchanged outside
  the narrow, explicitly-requested Internal Staff metadata/sizing fixes
  in §2.
- **Closed/completed shipment chat policy.** `DriverApplication.tsx`
  still client-side-only blocks messaging on finished shipments; Admin and
  Client surfaces still have no such restriction, and the server doesn't
  enforce one either. Left as-is pending a product decision on the
  intended policy.
- **Firestore query/index scalability work.** `GET /chat`,
  `POST /chat/seen`, and `GET /chat/unread` still each scan the entire
  `chatMessages` collection and filter in memory. Unchanged in this PR.
- **Date separators** and any other thread-grouping-by-day UI.
