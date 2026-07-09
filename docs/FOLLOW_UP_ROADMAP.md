# Follow-Up Roadmap

Deferred items identified during PR #56 (Settings Center Foundation) and prior
reviews. None of these are in scope for that PR — this file only tracks what's
next so the work isn't lost between sessions.

## Access & permissions
- **Admin Data Fetch / AdminType Access Review** — audit every admin data-fetch path against `resolvedAdminType` to confirm server-side responses (not just UI tabs) are scoped per admin type.
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

## Infra & operations
- **Production Deployment Checklist** — formalize a pre-deploy checklist (env vars, Firestore auth, seed data flags).
- **Real Firebase Verification** — verify behavior against a real Firestore/Firebase project instead of the in-memory fallback used in local dev.
- **Seed demo Client Staff account** — add a demo client-staff (`Client.isEmployee`) account to the seed data for local testing.
- **Repository Cleanup / Legacy Files Review** — review `Etir/e-tir-by-maras` and `etir-new` scaffold directories for removal.
- **Performance / Bundle Size Optimization** — address the existing Vite chunk-size warnings (`AdminPanel` and main bundle both exceed 500kB gzip-minified).
- **Mobile / Responsive Review** — pass over mobile/tablet layouts beyond the existing `lg:hidden` tab bar.

## AI / monitoring
- **MARAS AI Monitor Foundation** — foundation work for the MARAS AI header drawer feature (currently UI-only, no backend/provider wired up).
