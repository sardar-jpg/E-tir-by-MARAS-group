# Follow-Up Roadmap

Deferred items identified during PR #56 (Settings Center Foundation) and prior
reviews. None of these are in scope for that PR — this file only tracks what's
next so the work isn't lost between sessions.

## Access & permissions
- ~~**Admin Data Fetch / AdminType Access Review**~~ — **Done in PR #58** (`feature/admin-data-fetch-admin-type-access-review`). GET/POST `/api/logs` and GET `/api/cost-statements(/:shipmentId)` used `requireRole("admin")` with no `adminType` check, so any admin type could fetch the audit ledger or the accounting/cost-statement data directly, and AdminPanel's `fetchData()` fetched both unconditionally into browser state for every admin type regardless of which tabs `filteredAdminTabs` showed them. Also found and fixed: the Dashboard's "Operational Activity Stream" widget rendered the last 5 `activityLogs` entries (with a "Full Audit" button routing into the hidden `audit` tab) unconditionally for every admin type, since the Dashboard tab itself is shown to all three. See `canViewAuditLogs`/`canViewCostStatements` (`src/lib/adminAccess.ts`) and their `requireCanViewAuditLogs`/`requireCanViewCostStatements` server guards.
- ~~**Cost statement write access for accounts admins**~~ — **Done in PR #61** (`feature/accounts-cost-statement-write-access`). Product decision: **Option A** — Accounts Admin owns accounting end-to-end (cost items, supplier names, quantities, unit prices, totals, paid amount, notes, payment status), so write access mirrors the existing read access. `POST /api/cost-statements/:shipmentId` moved from `requireFullAdmin` (super/operation only) to a new `requireCanWriteCostStatements` guard backed by `canWriteCostStatements` (`src/lib/adminAccess.ts`), which allows `super`/`accounts` and still blocks `operation` entirely. This grants nothing beyond the cost-statements route — accounts admins still cannot GET `/api/shipments`, `/api/logs`, or `/api/admins`. The route already sources `agreedAmount`/`truckNumber` from the authoritative shipment record rather than the client payload when the shipment exists (PR #60), so that protection is unaffected by the wider caller set.
- ~~**BUG-26: GPS Tracking Map / Driver Alliance / Shipment Registry tabs had no content-render guard**~~ — **Done in PR #63** (`feature/gps-tracking-map-qa-safety-review`). QA/safety review of the Admin GPS Tracking Map, Driver Alliance, and Shipment Registry pages found that `filteredAdminTabs` (sidebar + mobile tab bar) already correctly hid all three from accounts admins, but the `activeTab === 'tracking_map' | 'drivers' | 'shipments'` content blocks had no matching adminType check — just the tab-id check, unlike 'reports'/'audit'/'team', which already re-check their access function at the content block (defense-in-depth, PR #59/#58/#57). The Dashboard's "Administrative Operations Quick Links" widget also had unconditional `setActiveTab('tracking_map')` / `setActiveTab('drivers')` buttons. **Verified neither gap is reachable by an accounts admin today**: `activeTab`'s initial state is `isAccountsAdminType ? 'costs' : 'dashboard'`, and 'dashboard' itself (where the quick-links widget lives) is absent from `filteredAdminTabs` for accounts, so an accounts admin never lands on, or has any button that navigates to, the Dashboard tab — confirmed by browser-driving all three roles (super/operation/accounts) end to end. Fixed both gaps anyway as defense-in-depth, matching the existing `reports`/`audit`/`team` convention, since relying on "no button happens to reach it today" is exactly the kind of assumption a future quick-link or default-tab change could quietly invalidate. Gated on `canViewGpsTracking` (new)/`canViewDriverRoster`/`canViewShipmentRegistry` (`src/lib/adminAccess.ts`). Also reviewed and confirmed clean: no sensitive fields (cost/accounting data, internal notes, vendor costs, profit/margin) are rendered on any of the three pages for the roles that can reach them; `App.tsx`'s top-level routing already fully separates Client/Driver/Public sessions from `AdminPanel` (they never mount it, regardless of adminType logic); `GET /api/shipments`/`GET /api/drivers` already 403 for accounts server-side; `scopeDriverListForSession`/`buildShipmentViewForRole`/`buildSecureShareView` already correctly scope driver/shipment/public-share data per role. Also fixed: the GPS map's "Google Maps Platform Key Required" fallback card referenced opening "Settings > Secrets" in "AI Studio" — leftover prototype boilerplate that doesn't exist in this deployed app — replaced with real setup steps (Google Cloud Console, HTTP-referrer restriction to `localhost`/`etir.app`, `GOOGLE_MAPS_PLATFORM_KEY` as an environment variable/Cloud Run secret, never committed to the repo).
- **Permissions & Roles Settings Review** — decide whether Staff & Permissions needs finer-grained roles beyond `super` / `operation` / `accounts`.
- **Centralized 401/403 denied-access logging** — log denied-access attempts (401/403) in one place instead of ad hoc per route.
- **`/api/verify-session` audit logging** — add logging to the session-verification endpoint so failed/forged session checks are visible in audit logs.
- **Admin create/delete, driver approve/reject, cost-statement read/export, document visibility audit events** — expand `activityLogs` coverage to these actions, which aren't currently logged.
- **Audit Logging Completion** — broader pass once the above event types are enumerated.

- ~~**Admin Sidebar Usability + Role Navigation Safety + Safe Lazy Loading**~~ — **Done in PR #76** (`feature/admin-collapsible-sidebar-review`). Three findings from the review, all fixed the same way as prior `audit`/`team`/`costs`/`reports`/`tracking_map`/`drivers`/`shipments` defense-in-depth gaps (content block re-checks the access function, not just sidebar visibility):
  - `activeTab === 'chat_center'` had no `adminType` check. `chat_center` is only in `filteredAdminTabs` for super/operation (accounts can't view shipments, which Chat Center is scoped to), but nothing stopped the content block from rendering for any role. Not reachable in practice today (every entry point into it goes through a shipment record, and accounts admins can't fetch shipments), but fixed anyway. Guarded on `resolvedAdminType === 'super' || resolvedAdminType === 'operation'`.
  - `activeTab === 'gmail'` had no `adminType` check at all. `gmail` is hidden from the top-level nav for everyone (`HIDDEN_FROM_TOP_LEVEL_NAV_IDS`) and only reachable two ways: the Settings "Google Workspace" card (`resolvedAdminType === 'super'`), and the Shipments tab's Compose/Gmail Alert shortcuts (reachable by operation, since `shipments` itself is `canViewShipmentRegistry`-gated to super/operation). Guarded the content block on `resolvedAdminType === 'super' || resolvedAdminType === 'operation'` to match those two real paths — this also closes the gap for accounts, which had no guard before.
  - The Dashboard's "Financial Reports" quick link used `resolvedAdminType !== 'operation'`, which let it through for accounts too, even though accounts can't view Reports (`canViewLogisticsAnalytics` is super-only). Not reachable in practice (accounts never lands on the Dashboard tab — see the `tracking_map`/`drivers` fix in PR #63 above), but fixed to use `canViewLogisticsAnalytics(resolvedAdminType)` directly, matching every other quick link in that widget.

  No sidebar-shows/content-hides or content-reachable/sidebar-hides gaps found elsewhere; Operation and Accounts admin sidebars were browser-verified end to end (see below) and match `adminAccess.ts` exactly.

## Admin bundle size / lazy loading (PR #76)
`AdminPanel.tsx` is an ~11.5k-line single file with every tab's JSX inlined in one `return`, so cleanly splitting it further is a bigger, riskier refactor than fit in one PR. What's done vs. deferred:
- **Done**: `TrackingMap` and `ChatCenter` (already separate component files) converted to `React.lazy` + `Suspense`; the Reports (`activeTab === 'reports'`) and Costs (`activeTab === 'costs'`) tab bodies — both large, self-contained blocks whose only external state was a handful of already-computed props — extracted to `src/components/admin/sections/AdminReportsSection.tsx` and `AdminCostsSection.tsx` and lazy-loaded the same way. AdminPanel's production chunk: 917.97 kB → 799.41 kB (gzip 227.84 kB → 199.44 kB). New chunks: `TrackingMap` (~63.8 kB), `AdminReportsSection` (~31.9 kB), `AdminCostsSection` (~17.1 kB), `ChatCenter` (~14.1 kB).
- **Deferred** — not attempted this pass because none of them are isolated the way Reports/Costs were (each is tangled with dozens of shared handlers/state — add/edit forms, modals, search/filter state — that would need to be threaded through as props, which is a much larger and riskier change to do safely in one PR):
  - Driver Alliance (`drivers` tab)
  - Clients / Customers (`clients` tab) and Vendors (`vendors` tab)
  - Settings, Team/Staff, Audit Logs, Google Workspace (`settings`/`team`/`audit`/`gmail` tabs)
  - Invoices — no separate "Invoices" tab exists today; invoice/cost-statement PDF export already lazy-imports `jspdf` on demand (pre-existing, unrelated to this PR)
- **Target not fully met**: AdminPanel is 799 kB, above the 500–600 kB target. `main/index` chunk (720.81 kB) is unrelated to AdminPanel and wasn't in scope. recharts itself could not be removed from AdminPanel's own chunk even after extracting Reports/Costs, since the Dashboard tab (not extracted) also renders several recharts charts (`AreaChart`/`BarChart`/`PieChart`) — extracting Reports/Costs mainly saved their JSX/markup weight, not the recharts library weight.

## Settings Center backends
- **Notification Preferences Backend** — wire the "Coming soon" categories added in PR #56 to a real preferences store; keep Security/system alerts always-on.
- **Company/System Settings backend** — make the read-only placeholder fields (company name, currency, order number format, etc.) actually editable and persisted.

## Sidebar / navigation cleanup
- ~~**Collapsible desktop sidebar + mobile/tablet drawer**~~ — **Done in PR #76** (`feature/admin-collapsible-sidebar-review`). `AdminSidebar.tsx` gained a collapse toggle (icon+label ↔ icons-only, `w-64` ↔ `w-[76px]`, active tab still highlighted in both modes) persisted to `localStorage` (`etir_admin_sidebar_collapsed`, via the existing `safeGetItem`/`safeSetItem` iframe-safe helpers in `src/lib/api.ts` — no new SSR/browser-availability handling needed). The desktop `<aside>` is also now `sticky top-0 h-screen` — it wasn't before, so on any tab with content taller than the viewport, scrolling the page scrolled the sidebar's icons out of view too (pre-existing, not introduced by this PR, but fixed while touching this file since it directly affects "active tab stays visually clear"). The old mobile/tablet always-visible horizontal tab-chip strip (no menu button, not dismissible, nothing to "close after selecting an item") was replaced with a Menu button that opens an off-canvas drawer using the *same* `AdminSidebar` component and the *same* role-filtered `tabs` prop as desktop — so the drawer can never show a section desktop hides — with a backdrop, close (X) button, and auto-close on tab selection. Both new UI surfaces render nothing extra for role visibility; they only change how the existing `filteredAdminTabs` list is *displayed*.
- ~~**Decide later whether to hide duplicated top-level sidebar entries**~~ — **Done in PR #57** (`feature/sidebar-settings-dedup-cleanup`). `My Account`, `Operation Team / Staff & Permissions`, `Google Workspace`, and `Audit Logs / Security Activity` are hidden from the top-level desktop sidebar and mobile tab bar; Settings is now the single entry point, linking to them via its cards' `setActiveTab` calls. The tabs, their `activeTab` ids, and content blocks are unchanged — only the duplicate top-level nav entries were removed.

## Google Workspace
- **Google Drive Shipment Folder Structure** — define a consistent per-shipment folder layout for Drive backups.
- **Google Drive Scope Review** — re-check requested OAuth scopes are the minimum needed (no scope changes were made in PR #56).

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
