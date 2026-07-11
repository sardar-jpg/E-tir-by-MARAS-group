# Follow-Up Roadmap

Deferred items identified during PR #56 (Settings Center Foundation) and prior
reviews. None of these are in scope for that PR — this file only tracks what's
next so the work isn't lost between sessions.

## Google Workspace module review (PR #82)
Review and hardening pass over the existing Google Workspace integration
(the `gmail` tab in `AdminPanel.tsx` — Gmail send, Google Drive shipment
backups, Google Calendar scheduling — plus `src/googleAuth.ts`'s OAuth
connect/disconnect flow). The feature already existed and worked; this PR
found and fixed one real bug (an audit-logging gap for operation admins)
and left everything else unchanged, including two pre-existing design
tradeoffs documented below as deferred rather than fixed.

**Fixed:**
- **Operation admins' Google Workspace actions were never logged.**
  `POST /api/logs` (the endpoint `AdminPanel.tsx` calls after a successful
  Gmail send, Drive backup, or Calendar event creation) shared
  `requireCanViewAuditLogs` (super-only) with `GET /api/logs`. But the
  `gmail` tab's content-block gate is `resolvedAdminType === 'super' ||
  resolvedAdminType === 'operation'` — operation admins can reach it via
  the Shipments tab's "Gmail Alert" shortcut (`canViewShipmentRegistry`,
  not super-only) — so every Workspace action an operation admin actually
  performed silently 403'd on the logging call and was never recorded,
  even though the UI explicitly grants them the capability to perform it.
  The PR #58 comment that originally justified sharing the super-only
  guard between GET and POST ("every current client call site for the
  POST route is inside the super-only Google Workspace flow") turned out
  to be false once operation gained `gmail`-tab access — this was a real
  audit-completeness gap, not an intentional restriction. Added
  `canWriteAuditLogs` (`src/lib/adminAccess.ts`, super or operation) and a
  new `requireCanWriteAuditLogs` server guard, applied only to `POST
  /api/logs` — `GET /api/logs` and the `audit` tab are unchanged and still
  super-only, so operation admins can now log their own Workspace actions
  but still can never read the full ledger back. Also fixed the client
  side symptom of the same bug: the Gmail-send success handler
  unconditionally re-fetched `GET /api/logs` afterward to refresh the
  local `activityLogs` state — harmless for super admins but a guaranteed
  403 for operation admins — now gated on `canViewAuditLogs(resolvedAdminType)`
  first, matching the same guard already used elsewhere in this file
  (`fetchData()`'s SWR loader).

**Reviewed, found already correct, no change needed:**
- **Role access**: `gmail` tab content-block already gated to
  super/operation; the Settings "Google Workspace" card is separately
  gated to super-only inside `AdminSettingsSection.tsx`
  (`resolvedAdminType === 'super'`) — an operation admin reaches the tab
  only via the Shipments shortcut, never via Settings, matching the
  existing comment at the `gmail` content block. Accounts admins can
  never set `activeTab` to `'gmail'` at all (outer gate blocks the
  content, and no accounts-visible UI path — Settings card and Shipments
  tab are both hidden from them). `isCurrentlyAdmin` in `App.tsx` (`session
  && session.role === "admin"`) is the sole gate on mounting `AdminPanel`
  at all — Client/Driver/Public sessions never reach the Workspace UI,
  confirmed unchanged.
- **No tokens exposed in the UI itself**: the header only ever renders
  `gmailUser.email`/`.displayName`/`.photoURL` — the raw OAuth
  `gmailToken` is never interpolated into any rendered text, attribute, or
  console statement anywhere in the `gmail` tab or `googleAuth.ts`.
- **No secrets logged**: none of the three `POST /api/logs` calls (Gmail
  send, Drive backup, Calendar event) include the token, email body,
  attachment content, or any Drive/Calendar payload — only shipment
  number, a masked recipient (`maskEmailForLog`, already existing — same
  first-letter-plus-domain masking as `maskLoginIdentifier`), and a short
  fixed description. Verified all three call sites individually.
- **No accidental customer/internal data leak via email**: the "Compose"
  pre-fill (`handlePrepopulateGmail`) only ever populates public-tracking-safe
  fields (shipment number, company name, status, cities, truck number, and
  a `?token=` tracking link) — no `agreedAmount`, `internalNotes`, vendor
  costs, or margin. The send handler also already calls
  `containsRawPrivateDocumentUrl` (`src/lib/emailSafety.ts`) on both
  subject and body before allowing send, blocking raw private
  Storage/Firestore document URLs from being emailed — pre-existing,
  unit-tested, unchanged.
- **Reliability**: Gmail/Drive/Calendar each have distinct loading, empty,
  and error states (`driveLoading`/`calendarLoading` spinners, "No files
  found"/"No upcoming calendar slots" empty states, red error banners
  surfacing the Google API's own error message — appropriate here since
  the audience is already-authorized admins debugging their own action,
  not end customers). No polling: the data-fetch `useEffect` only fires on
  `activeTab`/`workspaceSubTab` changes, never on an interval. No
  console/network spam for unauthorized roles: accounts admins can never
  reach a state where this `useEffect` or any Workspace fetch fires at
  all, confirmed via the access-rule review above.
- **Lazy-loading**: evaluated fresh this PR, not just carried over from
  the PR #78 note. Decision unchanged: **not extracted**. Unlike the seven
  tabs already extracted (PR #76/#78/#81), the Gmail send handler is ~110
  lines of real business logic (MIME construction, base64url encoding,
  the Gmail API call, masked logging, and a shared-state `setActivityLogs`
  refresh) written *inline* as the `<form onSubmit>` in JSX — not a
  pre-extracted named function like `analyzeShipmentTiming`/`getShipmentProgressPercentage`
  were for the Dashboard extraction. Extracting the tab would mean either
  first pulling that inline handler into a named function (a real,
  security-sensitive-code-touching change with no test coverage over this
  exact flow, done only to enable an unrelated refactor) or passing a
  ~110-line inline arrow function down as a prop (doesn't actually reduce
  risk or complexity, just relocates it). It also reaches into
  `activityLogs`/`setActivityLogs`, state shared far more broadly than any
  extracted section's own props. Given recharts is already fully out of
  `AdminPanel`'s chunk (PR #81), the remaining estimated saving here
  (~20–25 kB, per the PR #78 estimate) isn't worth that risk. Bundle size
  measured unaffected by this PR's actual change: `AdminPanel` chunk
  312.32 kB → 312.33 kB (the one added `if` guard).

**Reviewed, found real but deliberately left unchanged (deferred, not a
bug — see "Google Workspace" section below for the pre-existing tracked
items these update):**
- **The Google OAuth access token is persisted to `localStorage`**
  (`gmail_access_token`, `src/googleAuth.ts`), not just held in React
  state. This is consistent with the rest of the app's session model
  (`etir_session` is also `localStorage`-persisted) rather than a uniquely
  worse practice introduced here — changing it would mean redesigning the
  app's client-side credential storage strategy generally, out of scope
  for a Workspace-specific hardening pass. Noted for awareness, not fixed.
- **The requested Drive OAuth scope is the full `drive` scope**, not the
  narrower `drive.file` (app-created-files-only) scope — already tracked
  below as "Google Drive Scope Review." Confirmed why it's broad:
  `fetchDriveFiles()` lists the account's general Drive folder
  (`orderBy=createdTime desc` across all files, not scoped to app-created
  ones), so narrowing to `drive.file` would break "browse recent Drive
  files" entirely — a real behavior change requiring a product decision,
  not a mechanical hardening fix. Left unchanged.

**Verification:** `npm run lint`/`test`/`build`/`check-firebase-readiness`
all pass (282/282 tests, 3 new in `adminAccess.test.ts` for
`canWriteAuditLogs`). Browser-driven (Playwright/Chromium, `npm run dev`,
memory-fallback persistence), scoped to what's actually testable without a
real Google account (this environment has no live Google OAuth
credential, so the popup-based connect flow itself, and everything gated
on an actual `gmailToken` — Gmail/Drive/Calendar sub-tabs, a real send —
could not be exercised end to end; noted here rather than assumed):
- Super Admin: sees the Settings "Open Google Workspace" card, opens the
  `gmail` tab, sees the not-connected "Authorize with Google" state
  (screenshotted, desktop). Direct API probe with its own session token:
  `GET /api/logs` → 200, `POST /api/logs` → 201 (unchanged).
- A temporary Operations Admin (created/deleted via the real "Add Team
  Member" flow): confirmed **no** "Open Google Workspace" card in
  Settings (matches the code's `resolvedAdminType === 'super'` gate in
  `AdminSettingsSection.tsx`). The Shipments tab's "Gmail Alert" shortcut
  itself is conditional on that specific shipment's public-tracking
  toggle (`isLinkShared`) being on — not a role restriction — and wasn't
  reachable on the seeded demo shipment used in this pass; its
  reachability by operation admins is confirmed instead by code (the
  `gmail` content block's own gate, `resolvedAdminType === 'super' ||
  resolvedAdminType === 'operation'`, has no further restriction on this
  button) and, more importantly, by the actual fix: a direct API probe
  with this admin's own session token shows `POST /api/logs` now returns
  **201** (was 403 before this PR's fix) while `GET /api/logs` correctly
  stays **403** (unchanged, read access still super-only) — this is the
  exact route the real Gmail-send/Drive-backup/Calendar-create handlers
  call, so this confirms the fix functions correctly for the flow it's
  fixing.
- A temporary Accounts Admin: confirmed no Google Workspace access
  anywhere in the UI; direct probes confirm `POST /api/logs` stays 403
  (not widened beyond super/operation) and an unrelated route
  (`GET /api/drivers`) still 403s too, i.e. nothing else was accidentally
  broadened.
- All three temporary admins were created and deleted via the real UI;
  no leftover data (confirmed via a post-cleanup roster check).

## Driver registration & pending approval (PR #80)
Review and hardening pass over the existing driver self-registration +
admin pending-approval flow (`LoginPage.tsx`'s registration form,
`POST /api/drivers/self-register`, `PATCH /api/drivers/:id/status`, the
Driver Alliance tab's "Pending Driver Approvals" section). The flow already
existed and worked end to end — this PR found and fixed four gaps, added a
`src/lib/driverAccess.ts` module (pure, unit-tested, same pattern as
`adminAccess.ts`/`clientAccess.ts`/`documentAccess.ts`), and left one
gap as a documented product decision rather than a code change.

**Fixed:**
- **No duplicate username/email/phone check on self-registration.** Login
  matches an identifier against every driver's username/email/phone
  (`POST /api/login`'s driver branch), so two drivers registering with the
  same username left the second one permanently unable to log in (or
  ambiguously matched against the first), with no error surfaced anywhere.
  `findDuplicateDriverField` (`src/lib/driverAccess.ts`) now checks new
  registrations against every existing driver (case-insensitive,
  whitespace-insensitive for phone) and `POST /api/drivers/self-register`
  returns `409` with a clear message on a collision. The admin-side
  `POST /api/drivers` create route has the same pre-existing gap but was
  left unchanged — that path is behind `requireFullAdmin` (a trusted actor
  entering data deliberately, not a public self-service form), which is a
  materially different risk profile from an anonymous registration
  endpoint; worth applying the same check there as a follow-up.
- **No server-side password length check on self-registration.** The
  client enforced a 6-character minimum, but `POST
  /api/drivers/self-register` accepted anything when called directly.
  Added the same check server-side (only when a password was actually
  sent — the no-password/Google-sign-in path still generates its own
  random one).
- **Pending/rejected drivers could still appear in shipment
  driver-assignment selectors.** `AdminPanel.tsx`'s four driver `<select>`s
  (Create Shipment's Core Driver + Additional Driver, Edit Shipment's same
  two) all mapped over the raw `drivers` array with no status filter, so a
  driver who hadn't been approved yet (or had been rejected) could still be
  assigned to a shipment. Now filtered through `getAssignableDrivers`
  (status `undefined`/`"approved"` only); the Edit Shipment Core Driver
  select uses `getCoreDriverSelectOptions` instead, which also keeps a
  shipment's *currently* assigned driver visible in the dropdown even if
  they're no longer assignable, so editing an existing shipment never
  silently mismatches its own value or drops a real prior assignment. The
  Dashboard's "Fleet Utilization" KPI (`X / Y capacity allocated`) had the
  same problem — `Y` was every registered driver including pending/rejected
  — now scoped to the assignable roster.
- **Driver registration submitted / approved / rejected were not in
  `activityLogs`.** This PR's roadmap already flagged "driver approve/reject"
  as a known audit-logging gap (see "Access & permissions" below). Added
  `logActivity` calls to `POST /api/drivers/self-register` and `PATCH
  /api/drivers/:id/status` (both approve and reject branches, actor =
  `Super Admin`/`Operation Admin` from the session). The approve/reject
  route also now skips the log + push notification on a no-op repeated
  request (status already equal to the requested one) so double-clicking
  Approve/Reject can't spam duplicate log entries/notifications — the
  write itself was already idempotent, this only quiets the side effects.

**Also reviewed, found already correct, no change needed:**
- Registration form: all fields required client-side, email format check,
  password-confirmation match, new drivers always created with
  `status: "pending"`, no auto-approval path anywhere.
- Pending/rejected block is enforced **server-side** at both driver login
  paths (`POST /api/login`'s driver branch and the Firebase-verified
  `POST /api/verify-session`) — a pending/rejected driver never receives a
  session token, so no operational endpoint or screen is reachable
  regardless of client-side UI. Consolidated the two previously-duplicated
  message strings into `resolveDriverLoginBlock`
  (`src/lib/driverAccess.ts`) so both paths show identical wording.
- Admin Pending Approval area: pending drivers are visually separated
  (amber "Pending Driver Approvals" card) with Approve/Reject buttons above
  the main roster grid; `canViewDriverRoster` already limits the whole
  Driver Alliance tab to super/operation.
- Approve/reject: `PATCH /api/drivers/:id/status` is behind
  `requireFullAdmin`, which 403s both a driver session (role `"driver"`)
  and an accounts-type admin session server-side — not just UI-hidden.
  Verified end to end: a temporary Accounts Admin created via the real
  "Add Team Member" flow has no Driver Alliance nav item, and a direct
  `PATCH /api/drivers/:id/status` API call with its own session token
  returns `403 {"error":"Accounts-role admins cannot perform this
  action."}`. A driver session can never pass `requireFullAdmin` at all, so
  self-approval isn't reachable by construction.
- Assignment safety: existing assignments to a driver who is later
  rejected/pending are unaffected by the new dropdown filtering (see
  `getCoreDriverSelectOptions` above); `drivers.find(...)`-based lookups
  elsewhere (shipment cards, chat, GPS map) were left untouched since they
  read an *existing* assignment, not a picker of new ones.

**Missing product decision (not implemented — no code change):**
- **Suspended / inactive / archived driver statuses don't exist.**
  `Driver.status` (`src/types.ts`) only supports `"pending" | "approved" |
  "rejected"` — there is no way today to deactivate an approved driver
  (e.g. a driver who leaves, or whose account needs a temporary hold)
  short of manually editing their record. Adding these statuses is a real
  product decision (what happens to their active shipments/assignments at
  the moment of suspension, whether it's reversible, who can do it) and a
  larger change than this hardening pass — out of scope here, but the
  login-block/assignment-filter plumbing added in this PR
  (`resolveDriverLoginBlock`, `isDriverApproved`/`getAssignableDrivers`) is
  already structured so adding new blocked statuses later is a small,
  localized change (extend the status union + those two functions) rather
  than a new mechanism.
- **An already-issued driver session isn't re-validated per request.**
  Login blocks pending/rejected drivers from ever getting a session token,
  but once a driver has a valid token (24h TTL, `SESSION_TTL_MS` in
  `src/lib/auth.ts`), nothing re-checks their current `status` on
  subsequent requests — so a driver rejected/suspended *after* logging in
  keeps working operational access until their token expires. This matches
  the app's existing session model for every role (an admin whose account
  is deleted mid-session keeps access the same way — no role gets live
  per-request revalidation today), so singling out drivers for it would be
  an inconsistent, asymmetric change with a real cost (an extra Firestore
  read on every authenticated driver request, including the ~3.5s chat
  poll and GPS sync intervals). Flagging as a deliberate product/infra
  decision rather than fixing silently: if same-session revocation ever
  becomes a requirement, it should apply consistently across all
  roles (a session-store/blocklist mechanism), not just drivers.

**Verification:** `npm run lint`/`test`/`build`/`check-firebase-readiness`
all pass (278/278 tests, 21 new in `src/lib/driverAccess.test.ts`).
Browser-driven end to end (Playwright against real Chrome, `npm run dev`
with `SEED_DEMO_DATA=true STRICT_PERSISTENCE=false`, memory-fallback
persistence): registered a temporary driver through the real UI, confirmed
`Pending` status and login block, approved it as Super Admin and confirmed
login then worked with no unauthorized shipment data shown, confirmed the
driver now appears in the shipment driver-assignment dropdown (absent
before approval); registered and rejected a second temporary driver,
confirmed the block message; confirmed a duplicate-username registration
attempt is rejected with a clear error; confirmed a temporary Accounts
Admin (created and deleted via the real "Add Team Member" flow) has no
Driver Alliance access client- or server-side; registration form and
pending screen both verified at 390×844 mobile width. All temporary
drivers/admin existed only in this run's in-memory fallback store and were
discarded by stopping the dev server afterward.

## Access & permissions
- ~~**Admin Data Fetch / AdminType Access Review**~~ — **Done in PR #58** (`feature/admin-data-fetch-admin-type-access-review`). GET/POST `/api/logs` and GET `/api/cost-statements(/:shipmentId)` used `requireRole("admin")` with no `adminType` check, so any admin type could fetch the audit ledger or the accounting/cost-statement data directly, and AdminPanel's `fetchData()` fetched both unconditionally into browser state for every admin type regardless of which tabs `filteredAdminTabs` showed them. Also found and fixed: the Dashboard's "Operational Activity Stream" widget rendered the last 5 `activityLogs` entries (with a "Full Audit" button routing into the hidden `audit` tab) unconditionally for every admin type, since the Dashboard tab itself is shown to all three. See `canViewAuditLogs`/`canViewCostStatements` (`src/lib/adminAccess.ts`) and their `requireCanViewAuditLogs`/`requireCanViewCostStatements` server guards.
- ~~**Cost statement write access for accounts admins**~~ — **Done in PR #61** (`feature/accounts-cost-statement-write-access`). Product decision: **Option A** — Accounts Admin owns accounting end-to-end (cost items, supplier names, quantities, unit prices, totals, paid amount, notes, payment status), so write access mirrors the existing read access. `POST /api/cost-statements/:shipmentId` moved from `requireFullAdmin` (super/operation only) to a new `requireCanWriteCostStatements` guard backed by `canWriteCostStatements` (`src/lib/adminAccess.ts`), which allows `super`/`accounts` and still blocks `operation` entirely. This grants nothing beyond the cost-statements route — accounts admins still cannot GET `/api/shipments`, `/api/logs`, or `/api/admins`. The route already sources `agreedAmount`/`truckNumber` from the authoritative shipment record rather than the client payload when the shipment exists (PR #60), so that protection is unaffected by the wider caller set.
- ~~**BUG-26: GPS Tracking Map / Driver Alliance / Shipment Registry tabs had no content-render guard**~~ — **Done in PR #63** (`feature/gps-tracking-map-qa-safety-review`). QA/safety review of the Admin GPS Tracking Map, Driver Alliance, and Shipment Registry pages found that `filteredAdminTabs` (sidebar + mobile tab bar) already correctly hid all three from accounts admins, but the `activeTab === 'tracking_map' | 'drivers' | 'shipments'` content blocks had no matching adminType check — just the tab-id check, unlike 'reports'/'audit'/'team', which already re-check their access function at the content block (defense-in-depth, PR #59/#58/#57). The Dashboard's "Administrative Operations Quick Links" widget also had unconditional `setActiveTab('tracking_map')` / `setActiveTab('drivers')` buttons. **Verified neither gap is reachable by an accounts admin today**: `activeTab`'s initial state is `isAccountsAdminType ? 'costs' : 'dashboard'`, and 'dashboard' itself (where the quick-links widget lives) is absent from `filteredAdminTabs` for accounts, so an accounts admin never lands on, or has any button that navigates to, the Dashboard tab — confirmed by browser-driving all three roles (super/operation/accounts) end to end. Fixed both gaps anyway as defense-in-depth, matching the existing `reports`/`audit`/`team` convention, since relying on "no button happens to reach it today" is exactly the kind of assumption a future quick-link or default-tab change could quietly invalidate. Gated on `canViewGpsTracking` (new)/`canViewDriverRoster`/`canViewShipmentRegistry` (`src/lib/adminAccess.ts`). Also reviewed and confirmed clean: no sensitive fields (cost/accounting data, internal notes, vendor costs, profit/margin) are rendered on any of the three pages for the roles that can reach them; `App.tsx`'s top-level routing already fully separates Client/Driver/Public sessions from `AdminPanel` (they never mount it, regardless of adminType logic); `GET /api/shipments`/`GET /api/drivers` already 403 for accounts server-side; `scopeDriverListForSession`/`buildShipmentViewForRole`/`buildSecureShareView` already correctly scope driver/shipment/public-share data per role. Also fixed: the GPS map's "Google Maps Platform Key Required" fallback card referenced opening "Settings > Secrets" in "AI Studio" — leftover prototype boilerplate that doesn't exist in this deployed app — replaced with real setup steps (Google Cloud Console, HTTP-referrer restriction to `localhost`/`etir.app`, `GOOGLE_MAPS_PLATFORM_KEY` as an environment variable/Cloud Run secret, never committed to the repo).
- **Permissions & Roles Settings Review** — decide whether Staff & Permissions needs finer-grained roles beyond `super` / `operation` / `accounts`.
- **Centralized 401/403 denied-access logging** — log denied-access attempts (401/403) in one place instead of ad hoc per route.
- **`/api/verify-session` audit logging** — add logging to the session-verification endpoint so failed/forged session checks are visible in audit logs.
- **Admin create/delete, driver approve/reject, cost-statement read/export, document visibility audit events** — expand `activityLogs` coverage to these actions, which aren't currently logged. ~~Driver approve/reject (and registration submitted)~~ — **done in PR #80**, see "Driver registration & pending approval" above. Admin create/delete, cost-statement read/export, and document-visibility events remain unlogged.
- **Audit Logging Completion** — broader pass once the above event types are enumerated.

- ~~**Admin Sidebar Usability + Role Navigation Safety + Safe Lazy Loading**~~ — **Done in PR #76** (`feature/admin-collapsible-sidebar-review`). Three findings from the review, all fixed the same way as prior `audit`/`team`/`costs`/`reports`/`tracking_map`/`drivers`/`shipments` defense-in-depth gaps (content block re-checks the access function, not just sidebar visibility):
  - `activeTab === 'chat_center'` had no `adminType` check. `chat_center` is only in `filteredAdminTabs` for super/operation (accounts can't view shipments, which Chat Center is scoped to), but nothing stopped the content block from rendering for any role. Not reachable in practice today (every entry point into it goes through a shipment record, and accounts admins can't fetch shipments), but fixed anyway. Guarded on `resolvedAdminType === 'super' || resolvedAdminType === 'operation'`.
  - `activeTab === 'gmail'` had no `adminType` check at all. `gmail` is hidden from the top-level nav for everyone (`HIDDEN_FROM_TOP_LEVEL_NAV_IDS`) and only reachable two ways: the Settings "Google Workspace" card (`resolvedAdminType === 'super'`), and the Shipments tab's Compose/Gmail Alert shortcuts (reachable by operation, since `shipments` itself is `canViewShipmentRegistry`-gated to super/operation). Guarded the content block on `resolvedAdminType === 'super' || resolvedAdminType === 'operation'` to match those two real paths — this also closes the gap for accounts, which had no guard before.
  - The Dashboard's "Financial Reports" quick link used `resolvedAdminType !== 'operation'`, which let it through for accounts too, even though accounts can't view Reports (`canViewLogisticsAnalytics` is super-only). Not reachable in practice (accounts never lands on the Dashboard tab — see the `tracking_map`/`drivers` fix in PR #63 above), but fixed to use `canViewLogisticsAnalytics(resolvedAdminType)` directly, matching every other quick link in that widget.

  No sidebar-shows/content-hides or content-reachable/sidebar-hides gaps found elsewhere; Operation and Accounts admin sidebars were browser-verified end to end (see below) and match `adminAccess.ts` exactly.

- ~~**Full App Smoke Test After Admin Refactor**~~ — **Done in PR #79** (`feature/full-app-smoke-test-after-admin-refactor`), verification-only pass across PR #74–#78 (Driver simplification, Client/Customer safety review, Admin collapsible sidebar + lazy loading phase 1/2, Admin dashboard identity cleanup). `npm run lint`/`test`/`build`/`check-firebase-readiness` all pass (257/257 tests, no blocking readiness problems). Browser-driven (Playwright/Chromium against `npm run dev`, memory-fallback persistence) across all seven roles — Super Admin, Operation Admin, Accounts Admin (both temporary, created via the real "Create Admin" flow and deleted after), Driver, Client Owner, Client Staff, and Public/shared tracking (a real share token, obtained by toggling `isLinkShared` on a seeded demo shipment and reverted after) — confirming: PR #77's dashboard identity fix shows the real logged-in admin's email/role, never the hardcoded owner email; the PR #76 sidebar collapse/expand and mobile drawer both work and stay role-scoped; every PR #76/#78 lazy-loaded section (GPS Tracking Map, Chat Center, Logistics Analytics, Costs, Clients, Vendors, Settings, and — via the Settings hub — Team and Google Workspace) opens correctly for Super Admin; Operation/Accounts admin sidebars and mobile drawers expose exactly the sections `adminAccess.ts` allows and nothing more, and direct API probes with each session's own bearer token confirm the server-side 403s match; the Driver App's "Continue Job" detail view still shows the CMR document as View-only (no upload input, no `cmr` option in any category picker) with the Invoice document and customer company name both absent, matching `docs/REAL_FIREBASE_VERIFICATION.md`'s per-role fixture; Client Owner/Client Staff both see only their own company's shipment with no `agreedAmount`/margin/internal notes, Client Staff has no Delete Account button and a 403 on a direct self-delete API attempt; the public tracking page shows no agreed amount, internal notes, company name, chat UI, or raw Storage URL.
  - **One small bug found and fixed**: `AdminPanel.tsx`'s `fetchData()` (SWR data loader) and its 60-second shipment-polling `useEffect` both called `GET /api/shipments`/`GET /api/drivers` unconditionally for every admin type — unlike `resLogs`/`resCostStatements`/`resAdmins` in the same function, which already skip the request for admin types the server 403s (the PR #58 pattern this file documents above). Accounts admins can't view either route (`canViewShipmentRegistry`/`canViewDriverRoster`, both super/operation-only), so every accounts-admin session generated two guaranteed 403s in the browser console on load and again every 60 seconds — functionally harmless (no data reached the client either way) but exactly the "no failed requests" regression this smoke test was checking for. Fixed by gating both call sites on `canViewShipmentRegistry`/`canViewDriverRoster`, mirroring the existing guard style; `resShipments`/`resDrivers` are now `Response | null` and their `.ok` checks updated to match. No behavior change for super/operation admins. Verified via a second browser pass: accounts-admin console errors and failed requests both went from 2 unconditional 403s to zero.
  - **No large/deferred bugs found.**

## Admin bundle size / lazy loading (PR #76, phase 2 in PR #78, Dashboard in PR #81)
`AdminPanel.tsx` is an ~11.5k-line single file with every tab's JSX inlined in one `return`, so cleanly splitting it further is a bigger, riskier refactor than fit in one PR. What's done vs. deferred:
- **Done (PR #81, `feature/dashboard-lazy-loading-review`)**: the Dashboard tab (`activeTab === 'dashboard'`, ~810 lines) — the single largest remaining lever identified in PR #78 (see "Target still not fully met" below, pre-#81) — extracted to `src/components/admin/sections/AdminDashboardSection.tsx`, same pattern as the other six sections: state (search/filter, create-shipment-modal triggers, details-modal trigger) stays in `AdminPanel.tsx` and is passed down as value/setter props; all metrics/chart data (`routeChartData`, `shipmentAnalyticsData`, `pendingCountVal`, etc.) stay computed in `AdminPanel.tsx` exactly as before and are passed down already-computed, so no business logic is duplicated between the two files. Role gating for the three Quick Links buttons and the super-only Operational Activity Stream widget also stays in `AdminPanel.tsx` (computed via the existing `canViewDriverRoster`/`canViewGpsTracking`/`canViewLogisticsAnalytics`/`resolvedAdminType === 'super'`) and is passed down as plain booleans — this component never imports `adminAccess.ts` or decides access itself. The Dashboard tab itself has no outer role gate (every admin type lands here), so the `<Suspense>` boundary is simply `activeTab === 'dashboard'`.
  - **Result: recharts is now fully out of AdminPanel's own chunk** (the actual goal PR #78 flagged as blocked on this extraction) — `AdminPanel`'s production chunk dropped **745.79 kB → 312.32 kB** (gzip **190.65 kB → 68.85 kB**), a further ~433 kB / ~58% cut, comfortably past the 600–700 kB target set in PR #78. recharts itself didn't disappear — it now ships as its own shared chunks (`BarChart-*.js`, ~364.9 kB / gzip 107.56 kB, and `PieChart-*.js`, ~23.0 kB / gzip 6.89 kB) loaded on demand the first time an admin opens Dashboard, Reports, or Costs, instead of being bundled unconditionally into every admin session's initial load. New chunk: `AdminDashboardSection` (49.62 kB / gzip 13.46 kB).
  - **One real (pre-existing, unrelated) bug found and fixed while touching this file**: the sidebar's "Logistics Analytics" (`reports`) tab entry used `icon: BarChart` (`AdminPanel.tsx`'s `filteredAdminTabs`), where `BarChart` resolved to **recharts' `<BarChart>` chart component**, not a small icon — `lucide-react` has no `BarChart` export, so this could only ever have been the recharts import, rendered at `w-4 h-4` with no data/width/height, which recharts cannot render meaningfully at that size. This was only *discoverable* as part of removing recharts from `AdminPanel.tsx`'s own imports (that line would otherwise have kept the whole library in the main chunk), not something this PR went looking for — but it's a real, verifiable, in-scope fix: swapped to `BarChart3` (a real lucide-react icon, `lucide-chart-column` internally), confirmed via a direct DOM check that the sidebar item now renders a proper 24×24-viewBox icon like every sibling nav entry, where before it structurally could not have rendered one.
  - Verified end to end (Playwright/Chromium, `npm run dev`, memory-fallback persistence): Super Admin dashboard renders identically (all three charts, KPI banner including the PR #80 assignable-fleet Fleet Utilization metric, Live Cargo Transit Monitoring table, Operational Activity Stream, all four Quick Links); a temporary Operations Admin (created/deleted via the real "Add Team Member" flow) sees the dashboard with the Activity Stream and "Financial Reports" quick link correctly hidden (super-only) but "Active Driver Fleet"/"GIS Tracking Map" correctly shown (operation-allowed); a temporary Accounts Admin never lands on the Dashboard tab at all (unchanged pre-existing routing — accounts admins default to `costs`); no console/page errors on any of the three; mobile viewport (390×844) renders the same single-column stacked layout as before with no overlap/truncation. `npm run lint`/`test`/`build`/`check-firebase-readiness` all pass (279/279 tests, unchanged — this was a structural extraction with no new logic to test).
- **Done (PR #76)**: `TrackingMap` and `ChatCenter` (already separate component files) converted to `React.lazy` + `Suspense`; the Reports (`activeTab === 'reports'`) and Costs (`activeTab === 'costs'`) tab bodies — both large, self-contained blocks whose only external state was a handful of already-computed props — extracted to `src/components/admin/sections/AdminReportsSection.tsx` and `AdminCostsSection.tsx` and lazy-loaded the same way. AdminPanel's production chunk: 917.97 kB → 799.41 kB (gzip 227.84 kB → 199.44 kB). New chunks: `TrackingMap` (~63.8 kB), `AdminReportsSection` (~31.9 kB), `AdminCostsSection` (~17.1 kB), `ChatCenter` (~14.1 kB).
- **Done (PR #78, phase 2)**: re-examined the tabs PR #76 deferred as "tangled with shared handlers/state" and found five of them were extractable the same way as Reports/Costs — the state itself (search queries, add/edit form fields, modal-open flags) stays declared in `AdminPanel.tsx` (since the submit handlers that read it via closure — `handleAddClientSubmit`, `handleCreateAdmin`, etc. — also stay there, unmoved, per "don't duplicate large logic in both AdminPanel and new components"), and is passed down to the new components as plain value/setter props, identical in shape to `AdminCostsSection`'s existing props. Role checks (`canWriteClients`/`canWriteVendors`/`resolvedAdminType === 'super'`) also stay in `AdminPanel.tsx`, unchanged, gating the `<Suspense>` boundary exactly as they gated the inline JSX before — the new components never decide access on their own.
  - `Clients / Customers` (`clients` tab, 591 lines) → `src/components/admin/sections/AdminClientsSection.tsx` (largest extraction: ~63 props, since the add-client and edit-client forms each have ~10 field/setter pairs — but every prop is a direct pass-through, no new logic).
  - `Vendors` (`vendors` tab, 288 lines) → `src/components/admin/sections/AdminVendorsSection.tsx`.
  - `Team / Staff & Permissions` (`team` tab, 216 lines, super-only) → `src/components/admin/sections/AdminTeamSection.tsx`.
  - `Audit Logs` (`audit` tab, 44 lines, super-only) → `src/components/admin/sections/AdminAuditSection.tsx` — the simplest of the five: only `activityLogs`, `lang`, and `t`, no form state or handlers at all.
  - `Settings` (`settings` tab, 213 lines) → `src/components/admin/sections/AdminSettingsSection.tsx` — this tab is a pure navigation hub (cards that call `setActiveTab`), so it took no handler props at all, just display props and a `setActiveTab` passthrough.
  - Result: AdminPanel's production chunk 799.59 kB → 745.79 kB (gzip 199.44 kB → ~190.65 kB), a further ~54 kB / ~6.7% cut. New chunks: `AdminClientsSection` (25.79 kB / gzip 6.07 kB), `AdminVendorsSection` (12.80 kB / gzip 3.83 kB), `AdminSettingsSection` (10.85 kB / gzip 3.33 kB), `AdminTeamSection` (8.94 kB / gzip 2.69 kB), `AdminAuditSection` (1.65 kB / gzip 0.66 kB). All four PR #76 chunks (`TrackingMap`, `ChatCenter`, `AdminReportsSection`, `AdminCostsSection`) still present and unchanged.
- **Deferred (PR #78, phase 2)**:
  - **Google Workspace (`gmail` tab, 620 lines)** — explicitly evaluated and skipped, unlike the five above. Unlike Clients/Vendors/Team (whose JSX only *calls* handlers already defined elsewhere in `AdminPanel.tsx`), the Gmail tab's "Send" button has its send-email logic written *inline* as an `onSubmit={async (e) => {...}}` directly in the JSX — extracting the tab means moving real business logic into the new component, not just markup, which is a materially different (and riskier) kind of change than the other five. It also mutates `activityLogs` (shared state also read by the extracted Audit Logs section) and depends on an `AdminPanel`-level `useEffect` keyed on `activeTab === 'gmail' && workspaceSubTab` that fetches Drive/Calendar data — extractable in principle (the effect can stay in `AdminPanel.tsx` regardless of where the JSX lives) but adds enough surface area, on top of the already-large `clients` extraction in the same PR, that it was left for a follow-up rather than pushed through in this pass. Estimated savings if done: comparable to `AdminClientsSection` (~20–25 kB), not enough on its own to reach the 600–700 kB target.
  - Driver Alliance (`drivers` tab) — unchanged from the PR #76 assessment, still tangled with shared handlers/state.
  - Invoices — no separate "Invoices" tab exists today; invoice/cost-statement PDF export already lazy-imports `jspdf` on demand (pre-existing, unrelated to either PR).
- ~~**Target still not fully met**~~ — **met in PR #81**: AdminPanel was 745.79 kB after PR #76/#78, still above the 600–700 kB target; extracting Dashboard (see above) brought it to 312.32 kB, well past the target, primarily by finally letting recharts drop out of AdminPanel's own chunk entirely. Historical context (pre-#81) kept below for reference:
  - `main/index` chunk (720.84 kB) is unrelated to AdminPanel and out of scope for this refactor — still true after PR #81, unchanged.
  - ~~recharts could not be removed from AdminPanel's own chunk...~~ — this was the blocker; resolved in PR #81 by extracting Dashboard (see above).
  - Shipment Registry (`shipments` tab) is the largest remaining un-extracted tab by line count. Still not extracted — now that the bundle-size target is met, this is lower priority than it was, but remains a candidate if `AdminPanel.tsx`'s 11.5k-line size itself (not just its shipped bytes) becomes the concern instead of bundle weight.
  - Google Workspace (`gmail` tab) and Driver Alliance (`drivers` tab) remain deferred for the same reasons as before (see below) — neither was blocking the bundle-size target, so PR #81 didn't revisit them.

## Settings Center backends
- **Notification Preferences Backend** — wire the "Coming soon" categories added in PR #56 to a real preferences store; keep Security/system alerts always-on.
- **Company/System Settings backend** — make the read-only placeholder fields (company name, currency, order number format, etc.) actually editable and persisted.

## Sidebar / navigation cleanup
- ~~**Collapsible desktop sidebar + mobile/tablet drawer**~~ — **Done in PR #76** (`feature/admin-collapsible-sidebar-review`). `AdminSidebar.tsx` gained a collapse toggle (icon+label ↔ icons-only, `w-64` ↔ `w-[76px]`, active tab still highlighted in both modes) persisted to `localStorage` (`etir_admin_sidebar_collapsed`, via the existing `safeGetItem`/`safeSetItem` iframe-safe helpers in `src/lib/api.ts` — no new SSR/browser-availability handling needed). The desktop `<aside>` is also now `sticky top-0 h-screen` — it wasn't before, so on any tab with content taller than the viewport, scrolling the page scrolled the sidebar's icons out of view too (pre-existing, not introduced by this PR, but fixed while touching this file since it directly affects "active tab stays visually clear"). The old mobile/tablet always-visible horizontal tab-chip strip (no menu button, not dismissible, nothing to "close after selecting an item") was replaced with a Menu button that opens an off-canvas drawer using the *same* `AdminSidebar` component and the *same* role-filtered `tabs` prop as desktop — so the drawer can never show a section desktop hides — with a backdrop, close (X) button, and auto-close on tab selection. Both new UI surfaces render nothing extra for role visibility; they only change how the existing `filteredAdminTabs` list is *displayed*.
- ~~**Decide later whether to hide duplicated top-level sidebar entries**~~ — **Done in PR #57** (`feature/sidebar-settings-dedup-cleanup`). `My Account`, `Operation Team / Staff & Permissions`, `Google Workspace`, and `Audit Logs / Security Activity` are hidden from the top-level desktop sidebar and mobile tab bar; Settings is now the single entry point, linking to them via its cards' `setActiveTab` calls. The tabs, their `activeTab` ids, and content blocks are unchanged — only the duplicate top-level nav entries were removed.

## Google Workspace
- **Google Drive Shipment Folder Structure** — define a consistent per-shipment folder layout for Drive backups.
- **Google Drive Scope Review** — re-check requested OAuth scopes are the minimum needed (no scope changes were made in PR #56). **Reviewed in PR #82** (see "Google Workspace module review" above): the full `drive` scope is confirmed still necessary today, since `fetchDriveFiles()` browses the account's general Drive folder rather than only app-created files — narrowing to `drive.file` would require also changing that behavior (a product decision), so no scope change was made. Still open if a future PR wants to scope Drive backups to an app-managed folder instead.
- **Google OAuth token storage** — added in PR #82: the connected account's OAuth access token is persisted to `localStorage` (`gmail_access_token`, `src/googleAuth.ts`), consistent with this app's existing `etir_session` storage pattern but worth a dedicated look if the app's client-side credential storage strategy is ever revisited generally (out of scope for a Workspace-specific pass).

## Chat & documents
- ~~**Customer Chat File Upload UI**~~ — **Done in PR #62** (`feature/customer-chat-file-upload-ui`). Client Owner/Client Staff can now attach one file (paperclip button, existing `PDF/JPG/PNG/WebP/DOC(X)/XLS(X)` allowlist via `validateUpload`, `src/lib/uploadValidation.ts`) alongside or instead of text in the customer/admin (`client_admin`) chat in `ClientDashboard.tsx`, reusing the existing `/api/upload` + `POST /api/shipments/:id/chat` flow (channel still server-forced to `client_admin` for client sessions — unchanged). Uploads stay chat-only by default: `shouldSaveChatFileAsShipmentDocument` (`src/lib/chatVisibility.ts`) was narrowed from channel-only to channel **and** sender — only an *admin-sent* `client_admin` attachment still auto-mirrors into `shipment.documents` (preserving the existing admin publish-a-document-via-chat feature from PR #35/#39/#44); a customer/client-staff-sent attachment no longer does, so it can't reach the public share link without review. Message rendering shows file name + category + an authenticated download link, never a raw URL as plain text. Driver/other-client/public-tracking exposure unaffected — those surfaces don't read `client_admin` chat at all (pre-existing `filterChatMessagesByRole`, `chatVisibility.ts`, and `PublicTracking.tsx` never touching chat data). Converting a customer's chat upload into an official approved document is intentionally out of scope — no such approval flow exists yet.
- **Document category future schema** — revisit `DocumentCategory` as new document types are needed.
- ~~**Driver-uploaded CMR/customs scan approval flow**~~ — **superseded by the CMR product decision below** (added in PR #69, docs-only). Adding an approval step for driver-submitted CMRs is no longer the direction: the decision is that drivers must not create, generate, sign, stamp, approve, or upload CMR at all — CMR becomes admin-only end-to-end, with drivers getting read-only view/download access. See "Driver App Simplification + CMR Read-Only Review" below.
- **Notification Dismiss behavior** — review how notifications are dismissed/cleared across roles.

## Driver app simplification (added in PR #69, docs-only; CMR contradiction fixed in PR #71; UI complexity trimmed in PR #72)

Product decision recorded in PR #69
(`feature/ios-app-review-performance-readiness-pack`, documentation only).
See `docs/IOS_APP_REVIEW_READINESS.md` §12 for the mobile/App-Review-facing
cross-reference.

**Important product decision: the Driver app must stay simple and
operational — not become an admin-style dashboard.** Driver app should
focus on:
- current assigned job
- accept job
- pickup/dropoff details
- simple status updates
- view/download Admin-generated CMR
- receive a CMR-ready notification
- show CMR at the border
- `driver_admin` chat
- agreed driver amount, if intended

**CMR rule (this is a behavior change from today, not just a new
restriction):**
- Driver must **not** create, generate, sign, stamp, or approve a CMR.
- Driver must **not** upload a CMR.
- CMR must be created, stamped, signed, approved, and published only by
  MARAS/Admin/company from `AdminPanel`, using MARAS's own dedicated CMR
  design and shipment data.
- Driver CMR access must be **read-only**: view, download, and show at
  the border. Nothing else.

**Done in PR #71** (`feature/driver-app-simplification-cmr-documents-review`).
`DriverApplication.tsx` used to actively invite the driver to upload a CMR
("Scan CMR / Paperwork" in the document-upload UI, a driver-facing prompt
reading "Please upload the signed CMR document as soon as possible.", and a
`cmr` option in two separate category pickers — the inline camera-scanner
modal and `src/components/driver/FileUploadModal.tsx`). All of that is now
removed: the `cmr` category option no longer appears in either picker (or in
`FileUploadModal`'s filename-based auto-detection), every default/quick-action
category that used to hardcode `"cmr"` now defaults to `"photo"`, "Scan CMR"
is now "Scan Photo", the generic "Upload File" action is now "Send File", and
the driver-facing chat-translation dictionary entry that modeled an admin
*asking the driver to upload* a signed CMR was replaced with one that models
the correct flow (admin notifying the driver a CMR is uploaded and ready to
view). The Documents panel header changed from "CMR / Proof of Delivery" to
"Documents from Admin", and — this was the other half of the fix — each
document row is now an actual `<a href={d.url} target="_blank">` link
("View"), where before the panel listed document names with **no click
target at all**, so a driver had no way to open an admin-sent document even
though the visibility model already allowed it. `src/lib/documentAccess.ts`'s
`isDocumentVisibleToDriver`/`DRIVER_VISIBLE_DOCUMENT_CATEGORIES` needed **no
logic change** — `cmr` was already correctly driver-*visible* (view-only);
the contradiction was entirely in the driver-*upload* UI offering `cmr` as a
category of file the driver originates, plus the missing click target on the
read side. Verified browser-driven (`demo_driver` for the general flow,
`murat_yilmaz`/`driver-1` — whose seeded shipment carries the demo CMR
document — for the read-only-view-link check specifically, since
`demo_driver`'s own seeded shipment has no documents): the admin-sent CMR
document renders as a "Documents from Admin" row reading
`CMR_MAR-2026-1001.pdf` / `CMR` / `VIEW`; neither upload dropdown offers
`cmr`; no upload/sign/stamp CMR wording remains anywhere in
`DriverApplication.tsx`.

**Done in PR #72** (`feature/driver-simple-mobile-ux-cleanup`). This was
the dedicated scoping pass deferred from PR #71: removed the "Smart
Transit Route Tracker" map card (Google Maps embed, fallback block, and
the Last Update/Progress %/Tracking Status counters), the "Proof of
Delivery" digital-signature/checklist panel, and the "Trip Estimate"
road-condition simulator from the job-detail view — none of them leaked
admin/customer/accounting data (confirmed in PR #71's review), they were
purely cockpit-style UI weight. "Quick Cockpit Actions" was cut from a
3-button grid with an inline status drawer down to a plain 2-button
"Quick Actions" panel (Start Shipment, Send Photo) — the inline status
drawer was a duplicate of the status form already below it. The Menu
tab's "Pilot Operations" section (ELD Hours of Service timer, Fuel &
Route Calculator, and a "System Configuration" block that only
duplicated the toggles already above it) was removed entirely, along
with the non-functional Measurement Units toggle, the Sound
Alerts/Speed Post Guard toggles (found to gate nothing — the underlying
Web Audio chime code ran unconditionally regardless of the toggle, so
that dead chime code was removed too rather than wired up), and the
fake "Save Preferences" button (only fired a toast, persisted nothing).
Menu now reads as a simple Settings page: driver identity badge, a
real Theme (Day/Night) toggle, a read-only Language display, and
Logout. Profile's "Stats Counter Grid" (active/completed job counts of
unverified accuracy) was also removed. Wording changes: "Scan Document"
→ "Take Photo", "Upload File"/chat "Upload Doc" → "Send File" /
"Send Photo/File", the status-update form's heading ("... Updates
Terminal") → "Update Shipment Status", and the remaining camera-capture
modal's "Document Scanner"/"Capture Document"/"Send Document" strings →
"Take Photo"/"Capture Photo"/"Send to Admin". None of this touched
`src/lib/documentAccess.ts`, the server-side CMR-upload rejection, or
`isDocumentVisibleToDriver` — the "Documents from Admin" panel and its
CMR/packing-list View links are unchanged. Background GPS transmission
(`transmitGPS`/`triggerGpsSync`, the polling `useEffect`) was kept
as-is — it feeds the admin GPS Tracking Map and has no UI in the driver
app, so it wasn't "cockpit" surface to remove. Verified browser-driven
at 390×844 with the same `demo_driver` scenario documented below; see
`docs/IOS_APP_REVIEW_READINESS.md` §12 for the App-Review-facing
cross-reference.
- Driver must never see: customer company name, Client Staff identity,
  customer price/payment status, cost statements, vendor costs,
  profit/margin, invoices, internal notes, `client_admin` chat, or
  `internal_staff` chat. **Re-confirmed in PR #71's browser pass** (still
  holds, same as PR #68's finding): `demo_driver` and `murat_yilmaz` each see
  only their own assigned shipment — cargo description, own payout/truck, no
  company name, Client Staff identity, or invoice document (the seeded
  invoice document on `murat_yilmaz`'s shipment, `isSharedExternally: false`,
  correctly never renders in the Documents panel).
- **New, found during PR #71's browser pass:** every seeded demo chat
  message (`initialChatMessages` in `server.ts`) predates the `channel`
  field and so is invisible to `driver`/`client` sessions
  (`filterChatMessagesByRole` withholds untagged messages from both —
  correct behavior for real data, since an untagged message's audience is
  unknowable, but it means a fresh `SEED_DEMO_DATA=true` dev environment
  shows an empty driver_admin/client_admin chat thread instead of the seeded
  demo conversation). Sending a **new** message still works end-to-end
  (verified — it only fails locally because this dev environment has no live
  Firestore, the same 503-on-write behavior PR #68 already documented for
  uploads). Not fixed here: backfilling `channel` onto every seeded message
  needs a per-message audience decision (`driver_admin` vs `client_admin`)
  that's outside a CMR-focused PR's scope.
- ~~**Server-side CMR-upload rejection**~~ — **Done in PR #71** (same PR,
  follow-up commit). Found during PR #71's initial review: removing the
  `cmr` option from the driver-facing upload UI was a client-side/UX fix
  only — nothing server-side stopped a driver session from POSTing
  `fileCategory`/`category: "cmr"` directly to `POST
  /api/shipments/:id/chat` or, more directly, `POST
  /api/shipments/:id/documents` (the Document Center upload route — no UI
  currently calls it, but `requireShipmentAccess` lets any driver who owns
  the shipment reach it, and unlike the chat route it writes straight into
  `shipment.documents` with no `shouldSaveChatFileAsShipmentDocument` gate
  at all). Both routes now call the new
  `canDriverUploadDocumentCategory(category)` (`src/lib/documentAccess.ts`)
  and reject with `403 { error: "Drivers cannot upload CMR documents. CMR
  documents must be sent by Admin." }` whenever `req.session.role ===
  "driver"` and the category is `"cmr"`. Every other category a driver
  already uploads under (photo, delivery_proof, customs, packing_list,
  invoice, other) is unaffected, and admin/client sessions are unaffected
  entirely — the check only fires for `role === "driver"`. Driver *viewing*
  an admin-sent CMR is untouched (`isDocumentVisibleToDriver` still lists
  `cmr`, unit tests confirm both directions independently). See
  `src/lib/documentAccess.test.ts`'s `canDriverUploadDocumentCategory`
  suite.
- The future PR should include a real mobile-size browser smoke test for
  `DriverApplication` (narrow viewport, not just a desktop-sized
  headless browser window), matching the browser-driven verification
  standard set by PR #68's client-staff smoke test. **Done in PR #71**,
  re-verified in PR #72 against the simplified UI — driven at 390×844,
  Home/Jobs/Chat/Menu/Profile all render correctly with no
  overlap/truncation and zero console errors.

### Driver review demo scenario (local/dev only — PR #71, re-verified PR #72)

For manually reviewing the Driver app end-to-end (this section, not a
permanent feature): **local/dev only, never seeded in production** — gated
the same way as every other demo fixture in this file (`IS_LOCAL_DEV` for
the login itself, `SEED_DEMO_DATA=true` for the shipment/document/chat data;
`persistenceReadiness.ts` already warns loudly if `SEED_DEMO_DATA=true` is
ever combined with `NODE_ENV=production`). No real customer data, no
secrets.

**Login:** username `demo_driver`, password `DemoDriver123!` (the existing
`DEMO_ACCOUNTS.driver` entry, `server.ts` — reused rather than adding a new
`demo_driver_review` account, since this one already exists, is already
documented for manual review at the top of this PR, and only needed its
assigned shipment enriched with review data).

**Local commands:**
```
SESSION_SECRET="<any local value>" SEED_DEMO_DATA=true npm run dev
```
(`SESSION_SECRET` is required — the server refuses to start without it, not
demo-specific. Put both in a local, gitignored `.env.local` rather than
inline if preferred — never commit either.)

**What appears (shipment MAR-2026-1003, `shipment-1003` in `server.ts`):**
- Active assigned job — Gaziantep → Erbil, "Assorted confectioneries,
  sunflower oils, and dried nuts.", truck `DEMO-0001`
- Agreed driver amount: 2,800 TRY (own payout — allowed)
- Status: `Accepted` (leaves every forward transition —
  Loading/Loaded/In Transit/Border Crossing/Customs
  Clearance/Arrived/Delivered — available to exercise via the status
  dropdown)
- `driver_admin` chat thread: an admin message ("your CMR document ... has
  been uploaded and is ready to view") and a driver reply — both properly
  `channel: "driver_admin"`-tagged so they render in a fresh
  `SEED_DEMO_DATA=true` run (the older seed messages on other shipments
  predate the `channel` field and are invisible to driver/client sessions
  by design — see the untagged-messages item below)
- Documents from Admin panel:
  - **`CMR_MAR-2026-1003.pdf`** (category `cmr`) — must appear as a
    **View**-only row (opens `doc.url`), never as an upload prompt
  - `PackingList_MAR-2026-1003.pdf` (category `packing_list`) — the
    admin-sent non-CMR document, also View-only
  - **`Invoice_DemoClientCo-1003.pdf`** (category `invoice`) — must
    **NOT** appear anywhere in the driver's Documents panel
    (`isDocumentVisibleToDriver` blocks `invoice`) — this is the
    internal/accounting/customer document a reviewer should confirm stays
    hidden

**Confirm hidden from the driver:** customer company name ("Demo Client
Co." — present on the record, never rendered to driver), Client Staff
identity, customer price/payment status, cost statements, vendor costs,
profit/margin, `internalNotes` ("Needs temperature tracking..." — present
on the record, admin-only), the invoice document above, `client_admin` chat
(a third seeded message on this same shipment is deliberately tagged
`channel: "client_admin"` — confirm it never appears in the driver's chat
tab), `internal_staff` chat.

**Confirm driver sees only their own assigned job:** shipment-1001
(`companyName: "Al-Bahi General Trading Ltd."`, assigned to `driver-1`) and
shipment-1002 (`companyName: "Uruk Industrial Spares Group"`, assigned to
`driver-2`) are both seeded under the same `SEED_DEMO_DATA=true` run but
belong to different drivers/companies — neither should ever appear in
`demo_driver`'s job list.

**Upload/sign/stamp CMR must not be offered or accepted:** confirmed both
in the UI (no `cmr` option in either category picker, "Documents from
Admin" panel is read-only) and now server-side — a request from this
session with `fileCategory`/`category: "cmr"` to either
`POST /api/shipments/:id/chat` or `POST /api/shipments/:id/documents` gets
rejected with `403 { "error": "Drivers cannot upload CMR documents. CMR
documents must be sent by Admin." }` (`canDriverUploadDocumentCategory`,
`src/lib/documentAccess.ts`).

## Dashboard
- **Revenue KPI** — add a revenue-based KPI tile to the admin dashboard.
- **Active Shipments vs Active Transits** — clarify/separate these two metrics, which currently may conflate active count with in-transit count.
- ~~**"Logistics Command Hub" header shows a static owner identity for every admin**~~ — **Done in PR #77** (`feature/admin-dashboard-honesty-cleanup`). Noticed during the PR #76 sidebar review: the Dashboard hero card's subtitle (`MARAS Cargo HQ · sardar@maras.iq (Senior Administrator)`) was a hardcoded string, not the currently logged-in admin — an Operation or Accounts admin saw the owner's name/email there too. Replaced with the already-available `adminEmail` session prop (same one already rendered safely in the My Account tab and Settings > My Profile card) plus an `adminType`-driven role label (`Super Admin` / `Accounts Admin` / `Operations Admin`, matching the existing pattern at those same two call sites), falling back to the linked `gmailUser?.email` and finally neutral "MARAS Admin" wording if neither is available. No new data exposure — `adminEmail` was already shown elsewhere in this file. Also fixed in the same PR: the hero's `v2.4.1 SECURE` badge next to the "Gateway Active" pill was a fabricated version/certification string with no real backing (`package.json` version is `0.0.0`; no security certification process exists) — removed.

## Logistics Analytics (PR #59, surfaced during PR #58's review)
- ~~**Accounts admin sees an empty Reports tab**~~ — **Done in PR #59** (`feature/logistics-analytics-improvements`). Rather than widen `/api/shipments` access or build a scoped accounts-analytics endpoint in this PR, `reports` was tightened to super-only: `filteredAdminTabs` now gates the tab id behind `canViewLogisticsAnalytics` (`src/lib/adminAccess.ts`), and the content block re-checks the same function (defense-in-depth, matching the existing `audit`/`team`/`costs` pattern). Accounts admins simply no longer see the tab, instead of seeing it render empty. See `canViewLogisticsAnalytics` for the full reasoning.
- ~~**"Currency Values" / `currencyDistribution` label is imprecise**~~ — **Done in PR #59**. Renamed to "Driver Agreed Amount by Currency" (chart title, `currencyDistribution` in `translations.ts`) and the chart tooltip now reuses the existing `carrierAmount` ("Agreed Driver Amount") label instead of "Total Sum". The page header subtitle was replaced with an explicit "Operational analytics based on shipment records. Financial accounting analytics will be added separately." note (localized), and the duplicate/inconsistent `operationsReport` ("Operations Analytics Report") title was removed in favor of reusing `reports` ("Logistics Analytics") so the sidebar label and in-page title always match.
- **No non-financial analytics view for operation admins** — operation admins manage shipments/drivers day to day but have no analytics view at all (`reports` is `canViewLogisticsAnalytics`-gated to `super` only). Consider whether a non-financial subset (status distribution, completed volume — no `agreedAmount`/currency chart) belongs on their Dashboard, as its own operation-safe view, or stays out of scope.
- **Accounts-facing analytics endpoint** — build a scoped, read-only analytics source for accounts admins based on `CostStatement` data (total/paid/balance by currency, payment status mix) instead of the shipment-based charts they can't use. Once it exists, `canViewLogisticsAnalytics` (or a new accounts-specific variant) can extend Reports — or a dedicated accounting-analytics tab — to accounts.
- ~~**Costs tab silently depends on the `shipments` client state for accounts admins**~~ — **Done in PR #60** (`feature/accounts-cost-statements-data-completeness`). Confirmed: `filteredShipmentsCosts` joined `costStatements` against `shipments`, which is `[]` for accounts admins (`GET /api/shipments` 403s — `canViewShipmentRegistry`), so the registry, search/filter, and the statement editor's invoice/client/vendor preview + PDF/CSV exports all silently degraded (empty list, zeroed `agreedAmount`, blank truck plate) for that role. Fixed by adding `agreedAmount`/`truckNumber` as accounting-safe snapshot fields on `CostStatement` (`src/types.ts`), populated server-side from the shipment record at create/update time (`server.ts` `POST /api/cost-statements/:shipmentId`, and the template-building branch of `GET /api/cost-statements/:shipmentId`) — never trusting the client payload for these when the live shipment exists. `src/lib/costStatementRegistryView.ts` (new) builds the registry from `costStatements` first with `shipments` only as an enrichment/extra-rows source, and resolves the statement-editor/export shipment context the same way; `AdminPanel.tsx`'s `filteredShipmentsCosts` and the four `renderStatement*` preview functions now use it instead of `shipments.find(...)` directly. Route/origin/destination (`loadingCity`/`deliveryCity`) and `cargoDescription` were **not** added to the snapshot (kept out of scope — cosmetic-only in the vendor/invoice preview subtext, which already has a generic fallback ["Origin"/"N/A"/"General Cargo Merchandise"] when the shipment isn't joined); pick up if accounts admins need real route data on statements.
- **Chart / report exports** — Logistics Analytics (and Costs) currently have no export affordance (CSV/PDF); consider once there's a concrete requester for it, to avoid adding an unused feature.

## Infra & operations
- ~~**Production Deployment Checklist**~~ — **Done in PR #64** (`feature/production-deployment-checklist`). Formalized as `docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md`: env vars (exact names from `server.ts`/`.env.example`), Firebase/Firestore/Storage readiness, persistence/demo-data flags, auth/session review, a role/access smoke-test matrix, upload/document/public-tracking safety checks, Google Maps key restriction steps, CORS/domain readiness, Google Workspace scope review, accounting/GPS readiness, build/test commands, a post-deploy smoke test, and a rollback plan. Documentation only — no runtime/infra/access behavior changed.
- ~~**Real Firebase Verification (guide)**~~ — **Guide added** (PR #65, `feature/real-firebase-verification`): `docs/REAL_FIREBASE_VERIFICATION.md` documents a repeatable procedure (staging project setup, Firestore/Storage rules verification, a per-role smoke-test matrix, upload verification, persistence verification) plus `scripts/check-firebase-readiness.ts` (`npm run check-firebase-readiness`), a secret-free static check for dangerous production env-var combinations (memory fallback, demo seeding, missing `SESSION_SECRET`/`SUPER_ADMIN_PASSWORD_HASH`, wildcard CORS origins, a committed service-account key file). No real Firebase credentials were available in this environment, so **actually executing the guide's smoke tests against a live Firestore/Storage project remains an open, manual follow-up** — track that execution (not just the guide's existence) separately before relying on it as done.
- ~~**Firebase rules UID / server account verification**~~ — **Done in PR #66** (`feature/firebase-rules-uid-server-account-verification`). PR #65 found that `firestore.rules`/`storage.rules` hardcode the server account's Firebase Auth UID (`mQadHKcpmgbLIAwQaz8AqrAytIo2` in both, currently consistent between the two files) and that a mismatch against the real `SERVER_FIREBASE_EMAIL` account's UID fails closed with no dedicated check. Added `src/lib/firebaseRulesUid.ts` (pure, unit-tested) and extended `scripts/check-firebase-readiness.ts`/`npm run check-firebase-readiness` to statically parse both rule files, report whether they agree, and — if the new non-secret `SERVER_FIREBASE_UID` env var is set — report whether it matches (warning outside production, blocking problem in production with `STRICT_PERSISTENCE` on). Documented the manual Firebase Console UID-lookup procedure in `docs/REAL_FIREBASE_VERIFICATION.md` §5a and added checklist items to `docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md` §4. No real Firebase project was available in this environment, so **the actual Firebase Console UID lookup and a live mismatch test remain open, manual follow-ups** — this PR only makes the requirement checkable, not automatically verified end-to-end.
- ~~**Seed demo Client Staff account**~~ — **Done in PR #67** (`feature/seed-demo-client-staff-account`). Added a `demo_client_staff` / `client.staff@demo.local` entry to `DEMO_ACCOUNTS` in `server.ts`, seeded as its own `Client` memory record (`id: "demo-client-staff"`, `isEmployee: true`) attached to the same `companyName: "Demo Client Co."` as the existing `demo_client` owner account, so it gets identical customer-safe shipment/document/chat scoping via the existing company-name matching in `requireShipmentAccess`/the shipments/notifications routes — no new access-control code needed since `clientAccess.ts`'s `isClientStaffAccount`/`canClientSelfDeleteAccount`/`canClientSendChatMessage` already fully implement Client Staff behavior (from the earlier `feature/client-staff-accounts-safety-review` and `feature/customer-chat-file-upload-ui` work). Same `IS_LOCAL_DEV`/`DEMO_ACCOUNTS` gating as every other demo account — never seeded when `NODE_ENV=production`, independent of `SEED_DEMO_DATA`.
- ~~**Client Staff Browser Smoke Test / Safety Review**~~ — **Done in PR #68** (`feature/client-staff-browser-smoke-test-safety-review`), a browser-driven follow-up to PR #67's code-level review. Ran `npm run dev` (memory fallback, `STRICT_PERSISTENCE` briefly relaxed in a local, gitignored `.env.local` only to let the Admin UI create temporary test data, then reverted) and drove the real UI with a scripted Playwright session — not just curl — across all four demo roles. Created two temporary shipments (one for "Demo Client Co.", one for a newly added, temporary "Other Test Co." client) to actually exercise cross-company isolation in the browser rather than assume it from code reading; both are in-memory-only and gone on server restart. Confirmed end-to-end with screenshots: `demo_client_staff` logs in, lands on `ClientDashboard` (never `AdminPanel`), sees a "Client Staff" badge, sees only its own company's shipment (the other company's "Other Co Secret Cargo" shipment never appears), sees no `agreedAmount`/internal notes/margin on shipment details, has no "Delete Account" button (owner does), can send a `client_admin` chat text message (sender name shows the company, per existing `chatVisibility.ts` behavior) and select a file via the PR #62 upload UI (filename preview + remove button both work); the actual upload attempt correctly 503s with "File storage is temporarily unavailable... your file was NOT saved" since no live Firebase Storage is configured locally — expected and consistent with `docs/REAL_FIREBASE_VERIFICATION.md`. Notifications panel shows "0 unread updates matching your shipments" with no internal/admin entries. Logout returns to the login page. Client Owner (`demo_client`) verified separately: same shipment, same shared chat thread (sees the staff account's message), "Delete Account" button present, no "Client Staff" badge. Super Admin (`admin@demo.local`) Clients Registry lists both `demo_client` and `demo_client_staff` under "Demo Client Co.", staff row visibly tagged "CLIENT STAFF"; admin's Chat Center "Client Channel" for the shipment shows both the staff's and owner's messages. Driver (`demo_driver`) dashboard shows only its own assigned job — cargo description, own payout/truck — no customer company name or Client Staff identity. Server-side (`curl`, memory fallback): `GET /api/cost-statements` and `GET /api/logs` both 401 for the Client Staff session; `DELETE /api/clients/:id` on its own record 403s ("Client Staff accounts can only be removed by MARAS Admin."). No bugs found — no code changes were needed. `npm run lint`/`test`/`build`/`check-firebase-readiness` all pass unchanged.
- **Repository Cleanup / Legacy Files Review** — review `Etir/e-tir-by-maras` and `etir-new` scaffold directories for removal.
- ~~**Performance / Bundle Size Optimization**~~ — **Partially done in PR #69** (`feature/ios-app-review-performance-readiness-pack`). `ClientDashboard` (was statically imported in `App.tsx`, pulling `@vis.gl/react-google-maps` into the main bundle for every session) is now lazy-loaded, matching the existing `AdminPanel`/`DriverApplication` pattern (main bundle 813.42 kB → 720.62 kB gzip 223.16 → 196.83 kB). `jsPDF` in `AdminPanel.tsx`'s `handleDownloadPDF` is now dynamically imported at the point of use instead of statically at the top of the file (AdminPanel chunk 1,310.72 kB → 917.96 kB, gzip 355.86 → 227.84 kB). Both >500kB Vite warnings remain (smaller, not gone) — see `docs/IOS_APP_REVIEW_READINESS.md` §7 for full before/after numbers and the larger, explicitly-deferred follow-ups (splitting `AdminPanel.tsx` itself, further map-library isolation, `manualChunks` vendor splitting).
- ~~**iOS Info.plist missing usage-description strings**~~ — **Done in PR #70** (`feature/ios-info-plist-usage-descriptions-fix`). Found during PR #69's App Review readiness pass; `ios/App/App/Info.plist` had no `NSLocationWhenInUseUsageDescription`, `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, or `NSPhotoLibraryAddUsageDescription`, despite the app using `navigator.geolocation` (driver GPS) and native file/photo pickers (document/photo uploads, all three roles). All four keys added with App-Review-safe wording; no Capacitor config mirroring was needed (`capacitor.config.ts` doesn't declare these). See `docs/IOS_APP_REVIEW_READINESS.md` §8. **Still open:** this only edits the checked-in Info.plist source — a new Xcode archive + TestFlight upload (per that doc's §1 "new native build" procedure) is required before the fix actually reaches a submitted build.
- **Privacy policy / Terms contact email mismatch** — found during PR #69. `PrivacyPolicyModal.tsx`/`TermsModal.tsx` list `info@maras.iq`; the rest of the live app (`LoginPage.tsx`, `AdminPanel.tsx` Settings) uses `support@etir.app`. Not changed in PR #69 since privacy-policy copy is legal-adjacent and deserves a deliberate edit. See `docs/IOS_APP_REVIEW_READINESS.md` §5.
- **Mobile / Responsive Review** — pass over mobile/tablet layouts beyond the existing `lg:hidden` tab bar.

## AI / monitoring
- **MARAS AI Monitor Foundation** — foundation work for the MARAS AI header drawer feature (currently UI-only, no backend/provider wired up).
- **MARAS AI Assistant roadmap — clarified in PR #69 (documentation only, no code changed):** MARAS AI is an **Admin-only** feature, permanently — never available to Client, Client Staff, Driver, or Public Tracking sessions. Verified this already holds today (the existing drawer only renders inside `AdminPanel.tsx`, is UI-only, not wired to any provider). Full roadmap (start with Super Admin-only, expand to Operation/Accounts only via role-safe data projections mirroring `adminAccess.ts`'s existing `canView*` checks, never bypass existing permissions, external-provider integration requires its own dedicated PR + privacy-policy coverage + explicit approval) is in `docs/IOS_APP_REVIEW_READINESS.md` §10 — that's now the canonical version of this roadmap item.
