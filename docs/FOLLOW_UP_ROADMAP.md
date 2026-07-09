# Follow-Up Roadmap

Deferred items identified during PR #56 (Settings Center Foundation) and prior
reviews. None of these are in scope for that PR — this file only tracks what's
next so the work isn't lost between sessions.

## Access & permissions
- ~~**Admin Data Fetch / AdminType Access Review**~~ — **Done in PR #58** (`feature/admin-data-fetch-admin-type-access-review`). GET/POST `/api/logs` and GET `/api/cost-statements(/:shipmentId)` used `requireRole("admin")` with no `adminType` check, so any admin type could fetch the audit ledger or the accounting/cost-statement data directly, and AdminPanel's `fetchData()` fetched both unconditionally into browser state for every admin type regardless of which tabs `filteredAdminTabs` showed them. Also found and fixed: the Dashboard's "Operational Activity Stream" widget rendered the last 5 `activityLogs` entries (with a "Full Audit" button routing into the hidden `audit` tab) unconditionally for every admin type, since the Dashboard tab itself is shown to all three. See `canViewAuditLogs`/`canViewCostStatements` (`src/lib/adminAccess.ts`) and their `requireCanViewAuditLogs`/`requireCanViewCostStatements` server guards.
- **Cost statement write access for accounts admins** — found during PR #58: `POST /api/cost-statements/:shipmentId` uses `requireFullAdmin` (super/operation only), so an accounts admin — the type the 'costs' tab is shown to for exactly this purpose — currently cannot save a cost statement from the UI (the request 403s). Pre-existing, orthogonal to PR #58's scope (widening access is a product decision, not a safety fix); needs a decision on whether accounts admins should be able to write cost statements.
- **Permissions & Roles Settings Review** — decide whether Staff & Permissions needs finer-grained roles beyond `super` / `operation` / `accounts`.
- **Centralized 401/403 denied-access logging** — log denied-access attempts (401/403) in one place instead of ad hoc per route.
- **`/api/verify-session` audit logging** — add logging to the session-verification endpoint so failed/forged session checks are visible in audit logs.
- **Admin create/delete, driver approve/reject, cost-statement read/export, document visibility audit events** — expand `activityLogs` coverage to these actions, which aren't currently logged.
- **Audit Logging Completion** — broader pass once the above event types are enumerated.

## Settings Center backends
- **Notification Preferences Backend** — wire the "Coming soon" categories added in PR #56 to a real preferences store; keep Security/system alerts always-on.
- **Company/System Settings backend** — make the read-only placeholder fields (company name, currency, order number format, etc.) actually editable and persisted.

## Sidebar / navigation cleanup
- ~~**Decide later whether to hide duplicated top-level sidebar entries**~~ — **Done in PR #57** (`feature/sidebar-settings-dedup-cleanup`). `My Account`, `Operation Team / Staff & Permissions`, `Google Workspace`, and `Audit Logs / Security Activity` are hidden from the top-level desktop sidebar and mobile tab bar; Settings is now the single entry point, linking to them via its cards' `setActiveTab` calls. The tabs, their `activeTab` ids, and content blocks are unchanged — only the duplicate top-level nav entries were removed.

## Google Workspace
- **Google Drive Shipment Folder Structure** — define a consistent per-shipment folder layout for Drive backups.
- **Google Drive Scope Review** — re-check requested OAuth scopes are the minimum needed (no scope changes were made in PR #56).

## Chat & documents
- **Customer Chat File Upload UI** — client-side chat currently lacks a file upload affordance that exists elsewhere.
- **Document category future schema** — revisit `DocumentCategory` as new document types are needed.
- **Driver-uploaded CMR/customs scan approval flow** — add an admin approval step for driver-submitted CMR/customs scans.
- **Notification Dismiss behavior** — review how notifications are dismissed/cleared across roles.

## Dashboard
- **Revenue KPI** — add a revenue-based KPI tile to the admin dashboard.
- **Active Shipments vs Active Transits** — clarify/separate these two metrics, which currently may conflate active count with in-transit count.

## Logistics Analytics (PR #59, surfaced during PR #58's review)
- ~~**Accounts admin sees an empty Reports tab**~~ — **Done in PR #59** (`feature/logistics-analytics-improvements`). Rather than widen `/api/shipments` access or build a scoped accounts-analytics endpoint in this PR, `reports` was tightened to super-only: `filteredAdminTabs` now gates the tab id behind `canViewLogisticsAnalytics` (`src/lib/adminAccess.ts`), and the content block re-checks the same function (defense-in-depth, matching the existing `audit`/`team`/`costs` pattern). Accounts admins simply no longer see the tab, instead of seeing it render empty. See `canViewLogisticsAnalytics` for the full reasoning.
- ~~**"Currency Values" / `currencyDistribution` label is imprecise**~~ — **Done in PR #59**. Renamed to "Driver Agreed Amount by Currency" (chart title, `currencyDistribution` in `translations.ts`) and the chart tooltip now reuses the existing `carrierAmount` ("Agreed Driver Amount") label instead of "Total Sum". The page header subtitle was replaced with an explicit "Operational analytics based on shipment records. Financial accounting analytics will be added separately." note (localized), and the duplicate/inconsistent `operationsReport` ("Operations Analytics Report") title was removed in favor of reusing `reports` ("Logistics Analytics") so the sidebar label and in-page title always match.
- **No non-financial analytics view for operation admins** — operation admins manage shipments/drivers day to day but have no analytics view at all (`reports` is `canViewLogisticsAnalytics`-gated to `super` only). Consider whether a non-financial subset (status distribution, completed volume — no `agreedAmount`/currency chart) belongs on their Dashboard, as its own operation-safe view, or stays out of scope.
- **Accounts-facing analytics endpoint** — build a scoped, read-only analytics source for accounts admins based on `CostStatement` data (total/paid/balance by currency, payment status mix) instead of the shipment-based charts they can't use. Once it exists, `canViewLogisticsAnalytics` (or a new accounts-specific variant) can extend Reports — or a dedicated accounting-analytics tab — to accounts.
- **Costs tab silently depends on the `shipments` client state for accounts admins** — found while investigating PR #59: the `costs` tab (shown to `accounts`) computes `filteredShipmentsCosts` by joining `costStatements` against the `shipments` array (for shipment number/company/truck/freight-type search and filtering) at `src/components/AdminPanel.tsx` (~line 7350+). Since `GET /api/shipments` 403s for accounts, `shipments` stays `[]` for them, so those joins never match anything — the search/filter UI likely degrades silently for accounts admins today. Pre-existing, orthogonal to PR #59's Reports-only scope; needs its own look (likely resolved once cost statements carry their own shipment-number/company snapshot instead of joining live).
- **Chart / report exports** — Logistics Analytics (and Costs) currently have no export affordance (CSV/PDF); consider once there's a concrete requester for it, to avoid adding an unused feature.

## Infra & operations
- **Production Deployment Checklist** — formalize a pre-deploy checklist (env vars, Firestore auth, seed data flags).
- **Real Firebase Verification** — verify behavior against a real Firestore/Firebase project instead of the in-memory fallback used in local dev.
- **Seed demo Client Staff account** — add a demo client-staff (`Client.isEmployee`) account to the seed data for local testing.
- **Repository Cleanup / Legacy Files Review** — review `Etir/e-tir-by-maras` and `etir-new` scaffold directories for removal.
- **Performance / Bundle Size Optimization** — address the existing Vite chunk-size warnings (`AdminPanel` and main bundle both exceed 500kB gzip-minified).
- **Mobile / Responsive Review** — pass over mobile/tablet layouts beyond the existing `lg:hidden` tab bar.

## AI / monitoring
- **MARAS AI Monitor Foundation** — foundation work for the MARAS AI header drawer feature (currently UI-only, no backend/provider wired up).
