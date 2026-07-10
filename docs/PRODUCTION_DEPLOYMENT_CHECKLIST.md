# Production Deployment Checklist

## 1. Purpose

This checklist must be completed before launching **eTIR by MARAS Group** on
production for real customers, drivers, and staff. It exists so a launch
doesn't depend on anyone's memory of what's configured where — every item
below is copy-paste usable and can be checked off in order.

It reflects the app's actual current behavior as of PR #63 (GPS Tracking
Map / Driver Alliance / Shipment Registry admin access safety review) and
the security/access work before it (PR #60 accounts cost-statement data
completeness, PR #61 accounts cost-statement write access, PR #62 customer
chat file upload UI). See `docs/FOLLOW_UP_ROADMAP.md` for deferred
follow-ups not required for launch, and `ETIR-PROJECT-REFERENCE.md` for
the full architecture/deploy-mechanics reference.

This document does not itself change any runtime behavior, infrastructure,
or secrets. It is documentation only.

See also `docs/REAL_FIREBASE_VERIFICATION.md` for the step-by-step
procedure to actually prove the real Firestore/Storage/Auth path (§4, §17
below) works — not just that these env vars are set. See
`docs/IOS_APP_REVIEW_READINESS.md` for the iOS/TestFlight/App Store
Connect side of a launch (existing-app update rule, App Review checklist,
reviewer account plan, privacy/metadata checklist, and a safe
bundle-size/performance review) — this checklist stays focused on the
backend/Firebase/access side.

## 2. Production domain

- App/domain: `https://etir.app`
- Support email: `support@etir.app`

## 3. Required production environment variables

**Placeholders only below — never commit real values.** Names are taken
directly from `server.ts` / `.env.example` / `src/lib/*.ts`; nothing here is
invented. Set these as Cloud Run environment variables/secrets, never in
the repo.

```
NODE_ENV=production
SESSION_SECRET=<strong-random-secret>
SERVER_FIREBASE_EMAIL=<dedicated-firestore-service-account-email>
SERVER_FIREBASE_PASSWORD=<dedicated-firestore-service-account-password>
STRICT_PERSISTENCE=true
SEED_DEMO_DATA=false
SUPER_ADMIN_EMAIL=sardar@maras.iq
SUPER_ADMIN_PASSWORD_HASH=<generate-with-npm-run-hash-password>
GOOGLE_MAPS_PLATFORM_KEY=<restricted-google-maps-key>
ALLOWED_ORIGINS=https://etir.app
```

Notes on each:

- `NODE_ENV=production` — gates `IS_LOCAL_DEV`/`DEMO_ACCOUNTS` off (see
  §5) and flips `computePersistenceReadiness`'s production-only warnings on.
- `SESSION_SECRET` — **required**; the server refuses to start without it
  (`server.ts`, `[FATAL] SESSION_SECRET is not set`). Generate with
  `openssl rand -base64 48`.
- `SERVER_FIREBASE_EMAIL` / `SERVER_FIREBASE_PASSWORD` — the one dedicated
  Firebase Auth account the server itself signs in as to read/write
  Firestore (see §4 — this is the only UID `firestore.rules` /
  `storage.rules` allow). Create it once in Firebase Console >
  Authentication > Add user. Never a real human's login.
- `STRICT_PERSISTENCE` — must be `true` (or unset — `true` is the default;
  only the literal string `"false"` turns it off). See §5.
- `SEED_DEMO_DATA` — must be `false` (or unset — `false` is the default).
  See §5.
- `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD_HASH` — the root/owner admin
  login. Generate the hash with `npm run hash-password` (prompts for a
  password, prints the hash — never put the plaintext password itself
  anywhere in the codebase or a `.env` file).
- `GOOGLE_MAPS_PLATFORM_KEY` — served to the frontend via
  `GET /api/maps-key` (this is intentional — Maps JS API keys aren't secret
  by design); safety comes entirely from restricting it in Google Cloud
  Console. See §9.
- `ALLOWED_ORIGINS` — CORS allowlist addition. `https://etir.app` and
  `https://www.etir.app` are already always-allowed in code
  (`src/lib/cors.ts` `DEFAULT_ALLOWED_ORIGINS`), so this is only strictly
  required if another origin (e.g. a staging frontend) also needs access.
  `APP_URL` / `CLIENT_URL` / `PUBLIC_APP_URL` are equivalent alternatives
  read by the same allowlist (see §10).

**Firebase project variables required by the app:** none as separate env
vars for the client SDK — the web app config (`projectId`, `apiKey`,
`authDomain`, `storageBucket`, etc.) is committed in
`firebase-applet-config.json`. That file is a public, client-side Firebase
config (Firebase web API keys are not secret by design; real access
control lives in `firestore.rules`/`storage.rules`, restricted to the one
server-account UID) and does not need to change per environment unless
production uses a different Firebase project than what's already
configured there. If a different Firebase project is used for production,
either replace `firebase-applet-config.json` for that environment or set
the `FIREBASE_CONFIG` env var (JSON string) — `server.ts` reads the file
first, then falls back to `FIREBASE_CONFIG`.

**Firebase Admin/service-account variables:** none required. The
Firebase Admin SDK (`firebase-admin`, used only for FCM push notifications
and verifying ID tokens on `/api/verify-session`) uses Application Default
Credentials — on Cloud Run this is automatic via the instance's own
service account, with **no key file to manage or ship**. Do not add a
service-account JSON to the repo or to env vars for this.

**Storage bucket variables:** none required beyond the above — the upload
flow (`POST /api/upload`) uses `getStorage(firebaseApp)`, which reads the
bucket from `firebase-applet-config.json`'s `storageBucket` field, same as
Firestore.

**Optional / already in `.env.example`, not launch-blocking:**
- `GEMINI_API_KEY` — AI Studio legacy prototype var; not used by any
  currently-shipped feature (MARAS AI Monitor is UI-only, see
  `docs/FOLLOW_UP_ROADMAP.md`). Leave unset unless/until that ships.
- `APP_URL` — AI Studio's old Cloud Run self-URL injection var, also used
  as a CORS allowlist entry. Not required if `ALLOWED_ORIGINS` already
  covers every needed origin.
- `DD_API_KEY` / `DD_ENV` — Datadog tracing; optional observability, not
  required for the app to function.

## 4. Firebase readiness

- [ ] Real Firebase project created (`etir-by-maras-group` per
      `ETIR-PROJECT-REFERENCE.md`, or confirm the intended production
      project if different)
- [ ] Firestore enabled, using the correct (non-default) database ID if
      one is configured in `firebase-applet-config.json`
      (`firestoreDatabaseId`)
- [ ] Firebase Storage enabled
- [ ] Firebase Authentication enabled (needed for: the server's own
      dedicated `SERVER_FIREBASE_EMAIL` account, and end-user Google
      Sign-In / Google Workspace connect flow — see §12)
- [ ] Production service account (`SERVER_FIREBASE_EMAIL` /
      `SERVER_FIREBASE_PASSWORD`) created in Firebase Console >
      Authentication > Add user, and configured as a Cloud Run
      secret/env var
- [ ] No service-account JSON key file committed to the repo (Admin SDK
      uses ADC — see §3; confirm nothing under the repo root is a Google
      service-account key)
- [ ] Firestore indexes reviewed if any composite queries require them
      (check Cloud Run logs after first production traffic for
      "requires an index" errors)
- [ ] `SERVER_FIREBASE_UID` verified — copy the UID of the
      `SERVER_FIREBASE_EMAIL` account from Firebase Console >
      Authentication > Users (this var is not a secret; see
      `docs/REAL_FIREBASE_VERIFICATION.md` §5a)
- [ ] `firestore.rules` UID matches `storage.rules` UID — both files'
      `isServerAccount()` currently hardcode the same literal
      (`mQadHKcpmgbLIAwQaz8AqrAytIo2` as committed); run
      `npm run check-firebase-readiness` to check this statically
- [ ] Both rules files' UID matches `SERVER_FIREBASE_EMAIL`'s real Firebase
      Auth UID for the production project — **confirm this by hand in
      Firebase Console**, updating both rule files together if a different
      account/project is used; a mismatch fails closed (memory fallback,
      logged loudly) rather than granting access to the wrong account
- [ ] Firestore rules (`firestore.rules`) deployed only after the UID checks
      above pass (Firebase Console > Firestore Database > Rules, or
      `firebase deploy --only firestore:rules`)
- [ ] Storage rules (`storage.rules`) deployed only after the UID checks
      above pass (same UID-match caveat as Firestore)
- [ ] Production data backup strategy decided (see §18 — Firestore export)

## 5. Persistence and demo data

- **Production must not run on memory fallback.** The in-memory store is
  volatile (lost on every restart/redeploy) and is only ever a fallback
  when Firestore is unreachable or unconfigured
  (`src/lib/persistenceReadiness.ts`, `useMemoryFallback` in `server.ts`).
  Confirm at startup: Cloud Run logs print a `[Startup]` block including
  `Configured persistence mode: firestore` — if it says
  `memory-fallback`, do not consider the deployment production-ready.
- **`STRICT_PERSISTENCE=true`** must be enabled in production (this is
  already the default — only `"false"` disables it). When on, a write that
  can't reach Firestore fails loudly (503) instead of silently succeeding
  against memory and then vanishing on restart.
- **`SEED_DEMO_DATA=false`** must be enabled in production (already the
  default). When `true`, the server seeds a full demo dataset (drivers,
  shipments, chat, clients, vendors) with known, source-visible data.
- **Demo accounts should not be seeded in production.** Separately from
  `SEED_DEMO_DATA`, `server.ts`'s `DEMO_ACCOUNTS` (one demo login per role:
  `admin@demo.local`, `driver@demo.local` / `demo_driver`,
  `client@demo.local` / `demo_client`, `client.staff@demo.local` /
  `demo_client_staff` (Client Staff, `isEmployee: true`, same company as
  `demo_client`), plus a local-only owner alias) is gated on
  `IS_LOCAL_DEV = NODE_ENV !== "production"` — so setting
  `NODE_ENV=production` already disables this seeding path entirely,
  independent of `SEED_DEMO_DATA`. Confirm `NODE_ENV=production` is
  actually set on the Cloud Run service (don't rely on Cloud Run's
  platform default).
- **If demo accounts exist in production** (e.g. from a prior
  misconfigured deploy), remove/disable them before launch: check the
  `admins`, `drivers`, and `clients` Firestore collections for the
  `*.demo.local` email addresses / `demo_driver` / `demo_client` /
  `demo_client_staff` usernames above and delete those records.

## 6. Authentication and sessions

- [ ] `SESSION_SECRET` is strong (generated via `openssl rand -base64 48`
      or equivalent) and set only as a Cloud Run secret/env var, never
      committed
- [ ] Session/cookie behavior reviewed: sessions are **not** cookie-based
      — the server issues a signed session token that the client sends as
      `Authorization: Bearer <token>` on every request (`server.ts`,
      `verifySessionToken`). There is no `Set-Cookie` / cookie
      configuration in this app to review for `Secure`/`HttpOnly`/
      `SameSite`. Confirm the frontend transmits and stores this token
      only over HTTPS in production (production origin is HTTPS-only via
      `https://etir.app` — see §10).
- [ ] Admin owner account created and confirmed working:
      `SUPER_ADMIN_EMAIL` + a real password hashed via
      `npm run hash-password` into `SUPER_ADMIN_PASSWORD_HASH`
- [ ] Staff roles reviewed against `src/lib/adminAccess.ts` before
      creating real accounts:
  - `super` — full access
  - `operation` — shipment registry, driver alliance, GPS tracking,
    clients/vendors (read+write); no cost statements, no audit logs, no
    admin roster
  - `accounts` — cost statements (read+write), clients/vendors (read
    only); no shipment registry, no driver alliance, no GPS, no audit
    logs, no admin roster
- [ ] Protected owner account verified: an account matching
      `adminType === "super"` or the configured `SUPER_ADMIN_EMAIL` cannot
      be deleted through `DELETE /api/admins/:id`
      (`isProtectedOwnerAccount` in `src/lib/adminAccess.ts`) — confirm by
      attempting (and expecting a rejection) in a staging/test environment,
      not production
- [ ] Default/demo passwords removed — see §5; no `*.demo.local` /
      `Demo*123!` / `LocalOwner123!` credentials should exist in the
      production Firestore project

## 7. Role/access smoke test

Role matrix (from `src/lib/adminAccess.ts`, `chatVisibility.ts`,
`driverVisibility.ts`, `publicShareView.ts`):

| Role | Can access | Cannot access |
|---|---|---|
| Super Admin | Dashboard, Settings, Team, Audit Logs, Shipment Registry, Driver Alliance, GPS Tracking Map, Cost Statements (Accounting), Reports | — (full access) |
| Operation Admin | Dashboard, Shipment Registry, Driver Alliance, GPS Tracking Map, Clients/Vendors (read+write) | Cost Statements/Accounting, Audit Logs, Team/admin roster, Reports (Logistics Analytics) |
| Accounts Admin | Cost Statements (read+write), Clients/Vendors (read only) | Shipment Registry, Driver Alliance, GPS Tracking Map, Audit Logs, Team/admin roster, Dashboard |
| Client Owner | Own shipments (customer-safe view), `client_admin` chat, document uploads (chat-only) | Other customers' data, internal/driver chat, cost/accounting data |
| Client Staff | Same as Client Owner (scoped to their company) | Same restrictions as Client Owner |
| Driver | Assigned jobs only (driver-safe view), `driver_admin` chat, document/photo uploads | Other drivers' jobs, customer identity/chat, cost/accounting data |
| Public tracking link | Safe shared tracking fields only, explicitly shared documents/photos via proxy URL | Internal notes, costs, chat attachments, raw storage URLs, any non-shared document |

Smoke-test items (log in as each and confirm):

**Super Admin**
- [ ] Can access Dashboard, Settings, Team, Audit Logs, Shipment
      Registry, Driver Alliance, GPS Tracking Map, Cost Statements, Reports

**Operation Admin**
- [ ] Can access Shipment Registry, Driver Alliance, GPS Tracking Map
- [ ] Cannot access Cost Statements / Accounting (tab hidden; direct
      `GET /api/cost-statements` returns 403)

**Accounts Admin**
- [ ] Can access Cost Statements (view and save)
- [ ] Cannot access Shipment Registry, Driver Alliance, GPS Tracking Map,
      Audit Logs, admin/Team roster (tabs hidden; direct API calls to
      `GET /api/shipments`, `GET /api/drivers`, `GET /api/logs`,
      `GET /api/admins` return 403)

**Client**
- [ ] Sees only own customer-safe shipments
- [ ] Can use customer/admin (`client_admin`) chat and upload a file
      (PDF/JPG/PNG/WebP/DOC(X)/XLS(X)) alongside or instead of text

**Client Staff** (`isEmployee: true`, e.g. local demo `demo_client_staff`)
- [ ] Login succeeds; sees the same company's shipments as the owner
      account, and no other company's
- [ ] Can use `client_admin` chat and upload a file, same as the owner
- [ ] Cannot self-delete the account, cannot access admin/driver/internal
      surfaces (`canClientSelfDeleteAccount`, `src/lib/clientAccess.ts`)

**Driver**
- [ ] Sees only assigned driver-safe jobs
- [ ] Does not see customer/company private info

**Public tracking**
- [ ] Only shows safe shared tracking data (no internal notes, costs, or
      chat attachments)
- [ ] No raw Firebase Storage URLs appear anywhere in the public view —
      only the same-origin `/api/share/:token/documents/:docId` proxy path

## 8. Documents and upload smoke test

- [ ] Upload a valid PDF — succeeds
- [ ] Upload a valid JPG/PNG/WebP — succeeds
- [ ] Upload an invalid file type (e.g. `.exe`, `.svg`, `.html`) — rejected
      with the "Unsupported file type" error (`src/lib/uploadValidation.ts`)
- [ ] Upload a file over 15MB — rejected with the "exceeds the 15MB upload
      limit" error (`MAX_UPLOAD_BYTES`)
- [ ] Customer chat upload remains chat-only — a client-sent `client_admin`
      chat attachment does **not** appear in the shipment's Document
      Center or on the public tracking/share link
      (`shouldSaveChatFileAsShipmentDocument`, `src/lib/chatVisibility.ts`)
- [ ] Admin-sent `client_admin` chat attachment still auto-publishes as an
      official shipment document (unchanged, intended behavior)
- [ ] Public tracking does not expose chat-only uploads (only documents
      explicitly marked shared, per `shipment.shareIncludeDocuments` /
      `shareIncludePhotos` and `isDocumentVisibleForShare`)
- [ ] No raw Firebase Storage download URLs are exposed in any public
      view — confirm via browser dev tools network tab on the public
      tracking page

## 9. Google Maps readiness

- [ ] `GOOGLE_MAPS_PLATFORM_KEY` configured as a Cloud Run env
      var/secret, never committed to the repo (served to the frontend via
      `GET /api/maps-key`, which is expected/safe as long as the key
      itself is restricted below)
- [ ] Key restricted in Google Cloud Console > Credentials > this key >
      Application restrictions > HTTP referrers, to include `localhost`
      for local testing
- [ ] Key restricted to `https://etir.app` (and `https://www.etir.app` if
      used) for production
- [ ] Billing enabled on the Google Cloud project if required by current
      Maps Platform pricing
- [ ] GPS Tracking Map, Client Shipment Map, and Driver Application map
      pages tested with a real, restricted key
- [ ] Missing-key fallback tested (unset/empty key shows the "Google Maps
      Platform Key Required" setup-instructions card,
      `src/components/TrackingMap.tsx`, rather than a broken/blank map)

## 10. CORS and domain readiness

- [ ] `https://etir.app` (and `https://www.etir.app`) are already
      always-allowed in code (`src/lib/cors.ts`
      `DEFAULT_ALLOWED_ORIGINS`) — no env var needed for the primary
      production domain itself
- [ ] `ALLOWED_ORIGINS` (or `APP_URL`/`CLIENT_URL`/`PUBLIC_APP_URL`) set
      only if an additional origin (e.g. staging) genuinely needs
      credentialed cross-origin access
- [ ] Local dev origins (`localhost:3000`/`5173`, `127.0.0.1:3000`/`5173`)
      are always allowed — confirm no production-only origin is
      accidentally left dependent on these
- [ ] No wildcard (`*`) production CORS origin — the implementation
      (`resolveCorsOrigin`) never emits `*` and never reflects an
      unlisted origin; this is a code-level guarantee, not just
      configuration, but worth re-confirming after any CORS-related change
- [ ] HTTPS enabled on the production domain (Cloud Run custom domain
      mapping provides this automatically)
- [ ] `www.etir.app` → `etir.app` (or vice versa) redirect behavior
      confirmed as intended, if both are in use

## 11. Public tracking readiness

- [ ] Share links (`/api/share/:token`) work end-to-end from a real
      shipment
- [ ] Token-based links cannot expose internal fields — confirm the
      response only ever contains the fields in `buildSecureShareView`
      (`src/lib/publicShareView.ts`): no `loadingContactNumber`/
      `deliveryContactNumber` (private phone numbers), no `shareToken`,
      no customer subscriber emails
- [ ] Documents/photos on public tracking only appear when the shipment
      has `shareIncludeDocuments`/`shareIncludePhotos` explicitly enabled
      and the specific document is `isDocumentVisibleForShare`
- [ ] Chat attachments never appear automatically on public tracking
      (chat data is never read by `PublicTracking.tsx` or
      `publicShareView.ts` at all)
- [ ] Any QR/verify route tied to public tracking is tested if present

## 12. Google Workspace / Drive / Gmail readiness

This app has a working Google Workspace integration today (Admin Panel's
"Google Workspace" tab — client-side Firebase Google Sign-In with Gmail
send, Drive, and Calendar scopes; see `src/googleAuth.ts`), not just a
placeholder.

- [ ] OAuth scopes reviewed: current scopes are `gmail.send`, `drive`
      (full Drive access), and `calendar` (`src/googleAuth.ts`
      `GOOGLE_SCOPES`). **Note:** `drive` is the broad, full-Drive-access
      scope rather than the narrower `drive.file` (access only to files
      the app itself creates) — confirm this breadth is intentional
      before launch, or file it as a follow-up if a narrower scope would
      suffice (see `docs/FOLLOW_UP_ROADMAP.md`)
- [ ] No broader scope requested than needed for the Gmail
      send/Drive-backup/Calendar-scheduling features actually shipped
- [ ] Drive folder/backup behavior documented: current behavior lists a
      user's own Drive files in-panel; confirm whether a per-shipment
      folder convention is expected before real launch, or defer (see
      "Google Drive Shipment Folder Structure" in
      `docs/FOLLOW_UP_ROADMAP.md`)
- [ ] Gmail sending/drafting behavior documented: admin composes and sends
      shipment-status emails via the Gmail API using the signed-in
      admin's own Google account (not a service account) — confirm this
      is the intended production behavior
- [ ] Google Sign-In has two separate gates beyond app code that must be
      checked in the Google Cloud Console / Firebase Console: Firebase's
      "Authorized domains" list (Authentication > Settings) must include
      `etir.app`, and the OAuth consent screen's "Publishing status" must
      be `In production` (not `Testing`, which caps at 100 manually-added
      test users) if real customers/staff outside that list need to sign
      in with Google

If the above is not considered production-ready as-is, mark Google
Workspace as a later-phase feature for this launch and communicate that to
staff before go-live.

## 13. Notifications readiness

- [ ] Admin notifications tested (in-app + push via FCM, if
      `firebase-admin`/APNs configured)
- [ ] Customer notifications tested (chat, doc_upload types — scoped per
      channel, see `shouldNotifyChatParty`/`isChatNotificationVisibleToRole`
      in `src/lib/chatVisibility.ts`)
- [ ] Driver notifications tested, same channel-scoping as above
- [ ] Notification dismissal behavior reviewed (tracked as an open
      follow-up — see `docs/FOLLOW_UP_ROADMAP.md`, "Notification Dismiss
      behavior" — not a launch blocker but worth a quick manual check)
- [ ] Push token privacy reviewed: `DELETE` on a push token requires
      ownership match (`canDeletePushToken`, `src/lib/pushTokenAccess.ts`)
      — confirm one user cannot delete another's token via a crafted
      request

## 14. Accounting readiness

- [ ] Accounts Admin can read and write cost statements end-to-end
      (`canViewCostStatements`/`canWriteCostStatements`,
      `src/lib/adminAccess.ts`)
- [ ] Accounts Admin cannot access the broad shipment registry
      (`GET /api/shipments` 403s for `accounts`) — the cost-statement
      registry instead sources shipment context via
      `costStatementRegistryView.ts`'s accounting-safe `agreedAmount`/
      `truckNumber` snapshot fields (PR #60), not a live registry fetch
- [ ] Cost statement PDF/CSV exports tested (invoice, client, vendor
      preview variants)
- [ ] Currencies tested (multi-currency cost items, totals)
- [ ] Payment status tested (paid amount, balance, status transitions)
- [ ] No vendor/profit/internal cost data leaks to customer, driver, or
      public tracking views — confirm `buildShipmentViewForRole` and
      `buildSecureShareView` never include cost-statement fields (they
      don't today; re-check after any future shipment-view change)

## 15. GPS / operations readiness

- [ ] Shipment Registry tested (Operation/Super only)
- [ ] Driver Alliance tested (Operation/Super only)
- [ ] GPS Tracking Map tested (Operation/Super only, with a real
      restricted Maps key — see §9)
- [ ] Operation Admin access confirmed for all three above
- [ ] Accounts Admin confirmed blocked from all three, both in the UI
      (tabs hidden, `filteredAdminTabs`) and at the content-render level
      (`canViewGpsTracking`/`canViewDriverRoster`/`canViewShipmentRegistry`
      guards, per PR #63) and at the API level (403s)
- [ ] No accounting/internal cost data appears on GPS Tracking Map or
      Driver Alliance pages for any role that can reach them (confirmed
      clean as of PR #63 — re-check after any future change to these
      pages)

## 16. Build and test commands

```bash
npm run lint                      # tsc --noEmit
npm run test                      # vitest run
npm run build                     # vite build + esbuild bundle of server.ts
npm run check-firebase-readiness  # static, secret-free env/config readiness check
```

All four must pass/report clean before considering the app ready to deploy.
See `docs/REAL_FIREBASE_VERIFICATION.md` §10 for what the readiness script
checks.

## 17. Production smoke test after deploy

- [ ] Open `https://etir.app` — loads without console errors
- [ ] Log in as Super Admin
- [ ] Log in as Operation Admin
- [ ] Log in as Accounts Admin
- [ ] Log in as a Client
- [ ] Log in as a Driver
- [ ] Test a public tracking link
- [ ] Test a document/photo upload
- [ ] Test chat (customer and driver channels)
- [ ] Test cost statement create / update / export
- [ ] Test GPS Tracking Map with the real, restricted Maps key
- [ ] Confirm Cloud Run logs show no server errors and the `[Startup]`
      block reports `Configured persistence mode: firestore` (not
      `memory-fallback`)

## 18. Rollback plan

- [ ] Keep the previous Cloud Run revision available (Cloud Run keeps
      prior revisions by default — confirm traffic can be shifted back
      via `gcloud run services update-traffic` or the Console without a
      new deploy)
- [ ] Verify any Firestore schema/data changes in this release are
      backward-compatible with the previous revision, if that revision
      needs to serve traffic again
- [ ] Know how to disable/roll back the new deployment before starting
      the launch (document the exact `gcloud`/Console steps for whoever
      is on call)
- [ ] Keep a backup/export of production Firestore data taken
      immediately before launch (`gcloud firestore export`), so a bad
      migration or accidental write can be recovered from

## 19. Launch blockers

All of the following must be true before real launch:

- [ ] No memory fallback — `[Startup]` log confirms `firestore` mode
- [ ] No demo seed data — `SEED_DEMO_DATA=false`, `NODE_ENV=production`
      (which also disables `DEMO_ACCOUNTS`)
- [ ] Real Firebase project configured (Firestore + Storage + Auth
      enabled, rules deployed)
- [ ] Storage/upload flow working end-to-end
- [ ] All secrets (`SESSION_SECRET`, `SERVER_FIREBASE_EMAIL`/`_PASSWORD`,
      `SUPER_ADMIN_PASSWORD_HASH`, `GOOGLE_MAPS_PLATFORM_KEY`) configured
      as Cloud Run env vars/secrets, none committed to the repo
- [ ] `npm run build` passes
- [ ] Role smoke tests (§7) pass for all roles
- [ ] Public tracking safety confirmed (§11)
- [ ] Google Maps key restricted to `localhost` + `https://etir.app` (§9)
- [ ] `support@etir.app` is an active, monitored mailbox

## 20. Known follow-ups

Not required for launch — tracked in `docs/FOLLOW_UP_ROADMAP.md` and
referenced here rather than duplicated:

- Permissions & Roles Settings Review (finer-grained roles beyond
  super/operation/accounts)
- Centralized 401/403 denied-access logging
- `/api/verify-session` audit logging
- Expanded `activityLogs` coverage (admin create/delete, driver
  approve/reject, cost-statement read/export, document visibility)
- Notification Preferences backend, Company/System Settings backend
- Google Drive Shipment Folder Structure, Google Drive Scope Review
- Driver-uploaded CMR/customs scan approval flow
- Notification Dismiss behavior review
- Accounts-facing analytics endpoint; non-financial analytics for
  operation admins
- ~~**Real Firebase Verification**~~ — **Guide added** in
  `docs/REAL_FIREBASE_VERIFICATION.md` (§4 staging setup, §5–§6 rules
  verification, §7 role smoke-test matrix, §8 upload verification, §9
  persistence verification, plus the secret-free
  `npm run check-firebase-readiness` static check). This checklist's §4/§17
  remain the production-launch version of these checks; actually running a
  real Firebase project against them (staging or production) is still a
  manual step — no real Firebase credentials were available to run this
  automatically as part of adding the guide.
- ~~Seed demo Client Staff account (local dev only)~~ — **Done in PR #67**,
  see `docs/FOLLOW_UP_ROADMAP.md`
- Repository Cleanup / Legacy Files Review (`Etir/e-tir-by-maras`,
  `etir-new` scaffold directories)
- ~~Performance / Bundle Size Optimization~~ — **partially done in PR #69**
  (`ClientDashboard` and `jsPDF` now lazy/dynamically loaded); the two
  >500kB Vite warnings remain, smaller. See
  `docs/IOS_APP_REVIEW_READINESS.md` §7.
- ~~iOS Info.plist missing location/camera/photo-library usage-description
  strings~~ — **Done in PR #70** (`feature/ios-info-plist-usage-descriptions-fix`).
  `NSLocationWhenInUseUsageDescription`, `NSCameraUsageDescription`,
  `NSPhotoLibraryUsageDescription`, and `NSPhotoLibraryAddUsageDescription`
  added to `ios/App/App/Info.plist`. **A new archive/TestFlight build is
  still required to ship this** — see `docs/IOS_APP_REVIEW_READINESS.md`
  §8 and §1's "new native build" procedure.
- Mobile / Responsive Review
- MARAS AI Monitor Foundation — roadmap clarified (Admin-only, permanently)
  in PR #69, see `docs/IOS_APP_REVIEW_READINESS.md` §10
