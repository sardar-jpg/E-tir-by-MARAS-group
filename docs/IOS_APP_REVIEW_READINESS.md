# iOS App Review & Performance Readiness Pack

PR #69. This document is the practical playbook for updating the existing
**Etir** iOS/TestFlight app and getting a build through App Review — plus
the findings from a safe performance/bundle-size pass done in the same PR.
Documentation only where noted; the two code changes made in this PR are
called out explicitly in §7.

See also `ETIR-PROJECT-REFERENCE.md` (architecture + day-to-day deploy
mechanics — read that one first if you're new to this repo),
`docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md` (backend/Firebase/access launch
checklist), and `docs/FOLLOW_UP_ROADMAP.md` (deferred work tracker).

## 1. Existing app update rule — read this before touching Xcode

**This is an update to an existing, already-submitted app. Do not create a
new App Store Connect app record.**

Facts, from `ETIR-PROJECT-REFERENCE.md` §1 and this session's inspection of
`capacitor.config.ts` / `ios/App/App.xcodeproj/project.pbxproj`:

| What | Value |
|---|---|
| App Store Connect app | "Etir" (existing record — reuse it) |
| Apple Developer Team ID | `7S734U3SAW` |
| Bundle ID | `com.maras.etir` (`PRODUCT_BUNDLE_IDENTIFIER`, both Debug/Release) |
| Current marketing version | `1.0.3` (`MARKETING_VERSION`) |
| Current build number | `6` (`CURRENT_PROJECT_VERSION`) |
| Prior submission status (as of `ETIR-PROJECT-REFERENCE.md`) | v1.0.3 build 6 submitted, after two rounds of rejections |

**Critical architecture fact that changes what "update the app" even
means here:** `capacitor.config.ts`'s `server.url` points the native
WKWebView directly at the live Cloud Run URL
(`https://e-tir-by-maras-v2-282009674985.europe-west1.run.app`). The
native iOS binary is a thin shell — it is **not** a snapshot of `dist/`.
Concretely:

- Any change to `src/` or `server.ts`, once merged to `main`, deploys via
  Cloud Build on `git push` and is **immediately live inside the existing
  TestFlight/App Store build** — no new archive, no new upload, no new
  version bump. This is how almost all of PR #56–#68's work has shipped
  to the native app already, with zero App Store interaction.
- A new Xcode archive + TestFlight upload is only required for
  **native-level** changes: new Capacitor plugins, new Xcode
  capabilities/entitlements, app icon/launch screen changes, or an
  Info.plist key addition (see §8 for one that's actually needed).
- This PR's performance/bundle-size changes (§7) are `src/` changes only
  — covered by the "just `git push`" path, not a new build.

### If/when a new native build genuinely is required

Follow the exact procedure already documented in
`ETIR-PROJECT-REFERENCE.md` §4 ("Ship a native-level change") — reproduced
here for convenience, not redefined:

1. Bump `MARKETING_VERSION` and/or `CURRENT_PROJECT_VERSION` in
   `ios/App/App.xcodeproj/project.pbxproj`. **Always increment
   `CURRENT_PROJECT_VERSION` (the build number) for every new upload** —
   App Store Connect rejects a re-upload of the same build number.
   `MARKETING_VERSION` only needs to change for a user-visible version
   bump.
2. ```bash
   cd ios/App
   xcodebuild archive -project App.xcodeproj -scheme App -configuration Release -archivePath ~/Desktop/Etir-X.X.X.xcarchive -allowProvisioningUpdates
   open ~/Desktop/Etir-X.X.X.xcarchive
   ```
3. Xcode Organizer → **Distribute App → App Store Connect → Upload**.
4. Once processed in TestFlight: App Store Connect → Distribution → the
   version page → select the new build → complete export compliance
   (Standard encryption / No for the France question) → Save → Add for
   Review (or Resubmit if the version is already in a rejected/editable
   state).

Do not create a new app record, a new bundle ID, or a new Team association
for this. If a genuinely new app is ever wanted, that requires an explicit,
separate decision — not something to do as a side effect of a routine
update.

## 2. App Review checklist

Reviewer-facing / policy-facing items, current state as of this PR:

- [x] **Backend is live** — Cloud Run service `e-tir-by-maras-v2`
      (`europe-west1`) is the always-on backend the native app's WebView
      loads; there's no separate "prepare a backend for review" step
      because the same production backend serves both the website and the
      app at all times.
- [ ] **Confirm no memory fallback in the reviewed environment.** The
      review target is the live Cloud Run service, so this should already
      be `firestore` mode — confirm via Cloud Run `[Startup]` logs before
      submitting (`docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md` §5). Local dev
      (`npm run dev` on a laptop with no `SERVER_FIREBASE_EMAIL`/`_PASSWORD`
      set) does run on memory fallback — that's expected and fine for
      local dev, just never for what a reviewer actually hits.
- [ ] **Firebase/Storage configured** — real Firestore + Storage project
      required in production (`docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md`
      §4); re-confirm current production status before submitting, don't
      assume it's unchanged since the last check.
- [ ] **Google Maps key configured and restricted** — GPS Tracking Map
      (admin) and Client Shipment Map render via `@vis.gl/react-google-maps`
      and need `GOOGLE_MAPS_PLATFORM_KEY` set and HTTP-referrer-restricted
      (`docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md` §9). (The Driver app's own
      map card was removed in PR #72 as part of the driver UI
      simplification — drivers no longer see a map, just their job details;
      background GPS reporting to the admin tracking map is unaffected.) A
      missing key shows a "Google Maps Platform Key Required" setup card
      instead of a broken map (fixed in PR #63) — but a
      reviewer should see a working map, not that card.
- [ ] **Privacy policy present and accurate** — `PrivacyPolicyModal.tsx`
      exists and is reachable from the login screen. See §5 for the
      accuracy checklist (one known mismatch found — support email).
- [ ] **App Privacy (nutrition) labels match actual data usage** — see §5;
      no code change needed, this is an App Store Connect metadata form
      that must be filled out to match what the app in §5 actually does.
- [ ] **Reviewer notes explain login and test flow** — use the template in
      §3.
- [x] **No visible prototype/demo/AI Studio placeholder wording in the
      production app UI.** Checked: the one remaining `"AI Studio"`
      string in the codebase is a source comment in
      `src/components/TrackingMap.tsx` (explaining what used to be there,
      per the PR #63 fix), not rendered UI. `README.md` still has AI
      Studio boilerplate (title, badge image, `GEMINI_API_KEY` step) but
      that's a developer-facing file, never shipped to the app or a
      reviewer — low-priority cleanup, not a review blocker (see §9).
- [x] **Support email is `support@etir.app`** — confirmed live in the UI:
      `LoginPage.tsx` (`SUPPORT_EMAIL` constant, "need help" link) and
      `AdminPanel.tsx`'s Settings page both use it. `PrivacyPolicyModal.tsx`
      and `TermsModal.tsx` previously listed `info@maras.iq` instead — see
      §5; **resolved in PR #85**, both now use `support@etir.app` too.
- [x] **Domain is `etir.app`** — `docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md`
      §2/§10 already documents `https://etir.app` as the production domain
      and confirms it's always-allowed in CORS
      (`src/lib/cors.ts` `DEFAULT_ALLOWED_ORIGINS`), independent of this PR.

## 3. Reviewer notes template

Paste into App Store Connect's "Notes for Review" field, filling in the
`<>` placeholders with real, current credentials before submitting (never
commit the filled-in version anywhere):

```
Etir is a freight/logistics tracking app for MARAS Group (Iraq-based
freight company) with three separate login experiences: Admin, Driver,
and Client (customer). All three log in from the same screen.

ADMIN LOGIN
  Email: <admin reviewer email>
  Password: <admin reviewer password>
  What to check: Dashboard, Shipment Registry (a sample shipment should
  already exist), GPS Tracking Map, Driver Alliance, Chat, Settings.

DRIVER LOGIN
  Username/Email: <driver reviewer account>
  Password: <driver reviewer password>
  Note: this account should already be approved and have at least one
  sample shipment/job assigned — a driver account with nothing to show
  was flagged in a prior review round (see ETIR-PROJECT-REFERENCE.md §6,
  "no-demo-driver-content"). Confirm this before submitting, every time.

CLIENT LOGIN
  Email: <client reviewer email>
  Password: <client reviewer password>
  What to check: shipment tracking view, chat with the admin, document
  upload.

The app requires an active internet connection — it loads live data from
our backend for all three roles; there is no offline/demo mode.

Location permission is used only by the Driver role, to report the
driver's live position while an assigned job is active (used for the
customer/admin-facing GPS tracking map). Camera/photo library access is
used to attach shipment documents/photos (all three roles) and delivery
proof photos (driver role).
```

Two prior rejection rounds are recorded in `ETIR-PROJECT-REFERENCE.md` §6:
name/icon/Google-sign-in-bug/demo-credentials/account-deletion/
business-model, then Google-login-error/no-demo-driver-content/
email-verification-not-received. Re-check each of those specific points
still holds before resubmitting — they're exactly the kind of thing that
regresses silently.

## 4. Reviewer demo account plan

**No real production passwords are included in this document or this PR.**
Everything below is either (a) a `*.demo.local` / local-dev-only account
already gated out of production by `IS_LOCAL_DEV`
(`server.ts`, `docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md` §5), shown only as
an example of the credential *shape*, or (b) a placeholder to be filled
with a real, dedicated reviewer account created for production.

### Local/demo accounts (examples only — never used for real App Review)

| Role | Username/Email | Password | Notes |
|---|---|---|---|
| Admin (super) | `admin@demo.local` | `DemoAdmin123!` | seeded only when `NODE_ENV !== "production"` |
| Client Owner | `demo_client` / `client@demo.local` | `DemoClient123!` | "Demo Client Co." |
| Client Staff | `demo_client_staff` / `client.staff@demo.local` | `DemoClientStaff123!` | same company as Client Owner, `isEmployee: true` |
| Driver | `demo_driver` / `driver@demo.local` | `DemoDriver123!` | |

These are useful for local `npm run dev` testing of the lazy-loading
changes in this PR (§7) and for reproducing role behavior, but **must
never be what a real App Store reviewer logs in with** — they don't exist
in production (`IS_LOCAL_DEV` gate) and wouldn't work against
`https://etir.app` anyway.

### Real reviewer account plan (for actual App Review submission)

`ETIR-PROJECT-REFERENCE.md` §1 records that a prior submission already
used dedicated reviewer accounts:

- **Admin**: `sardar@maras.iq` (the real super-admin/owner account —
  password lives in the team's password manager, not this repo)
- **Driver**: `applereviewer` — a dedicated, already-approved driver
  account with a sample shipment pre-assigned specifically so a reviewer
  sees populated content instead of an empty state (this addressed the
  "no-demo-driver-content" rejection reason from a prior round)

Recommended reviewer coverage for this PR's submission:

- **Client Owner** — a dedicated reviewer client account (not a real
  customer's account) with at least one sample shipment, so the reviewer
  can see the tracking/chat/document-upload flow without needing to be
  handed a live customer's data.
- **Driver** — reuse the existing `applereviewer` pattern: dedicated,
  pre-approved, with a sample job assigned before submitting, every time.
- **Admin** — the existing `sardar@maras.iq` super-admin account is
  reasonable to keep using for review (Apple reviewers don't attempt
  destructive actions), but if there's ever a concern about handing out
  full super-admin credentials, create a dedicated `operation`-type admin
  reviewer account instead (`src/lib/adminAccess.ts` — `operation` gets
  Shipment Registry/Driver Alliance/GPS/Clients-Vendors but not
  Accounts/Audit Logs/Team, which is plenty to demonstrate the app).
- **Client Staff** — not necessary for review; Client Staff is
  functionally identical to Client Owner from a reviewer's perspective
  (same dashboard, same restrictions minus account self-deletion — see
  `docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md` §7). Only add if a reviewer
  question specifically asks about it.

**Action before next submission:** create/confirm one dedicated Client
reviewer account (with a sample shipment) in the real production Firebase
project, the same way `applereviewer` was already done for Driver. This
document does not create it — that requires touching production data,
which is out of scope for this docs/performance PR.

## 5. Privacy policy / App Store metadata checklist

Reviewed `src/components/PrivacyPolicyModal.tsx`, `TermsModal.tsx`, and
the actual data flows in `server.ts`/`src/lib/*.ts`. This is a
practical cross-check of what the app *actually does* against what its
privacy surface *says* — not new legal text, and no legal guarantees are
invented here.

| Data category | Actually collected/used? | Where in the app | Privacy policy coverage |
|---|---|---|---|
| Location/GPS | Yes — driver's live position while an active job is assigned (`navigator.geolocation.getCurrentPosition`, `src/components/DriverApplication.tsx`) | Driver role only, for GPS Tracking Map / customer tracking | `PrivacyPolicyModal.tsx` mentions "active telemetry" generically — confirm this reads clearly as GPS location tracking, not just log telemetry |
| Uploaded shipment documents/photos | Yes — PDF/JPG/PNG/WebP/DOC(X)/XLS(X) up to 15MB (`src/lib/uploadValidation.ts`), stored in Firebase Storage | All three roles (chat/document upload flows) | Confirm the policy explicitly covers document/photo storage and who can see what (see the existing document-visibility rules in `docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md` §8) |
| Chat messages | Yes — customer↔admin and driver↔admin channels (`src/lib/chatVisibility.ts`) | All three roles | Confirm the policy mentions chat message storage/retention |
| Account/login data | Yes — email, hashed password, company name (client), assigned jobs (driver) | All roles | Standard — confirm covered |
| Notifications | Yes — in-app + push via FCM (`@capacitor/push-notifications`, `firebase-admin`) | All roles | Confirm push notification data use is mentioned (device token storage — see `src/lib/pushTokenAccess.ts`) |
| Support contact | `support@etir.app` used live in `LoginPage.tsx`/`AdminPanel.tsx` | — | **Resolved in PR #85.** `PrivacyPolicyModal.tsx` and `TermsModal.tsx` previously listed `info@maras.iq` instead of `support@etir.app`; owner confirmed `support@etir.app` is the official contact and both modals were updated to match. |
| Data retention/deletion | Partial — Client Owner can self-delete their account (`canClientSelfDeleteAccount`, `src/lib/clientAccess.ts`); Client Staff cannot (admin-only removal). No explicit data-retention-period language found in the reviewed modals. | — | Add a plain-language retention/deletion note if App Privacy answers require one (don't invent a specific retention period that isn't actually implemented — state the truth: account deletion removes the account; shipment/document records tied to a company's shipments are retained for the business's own operational/accounting needs unless a separate deletion request is made). |
| User roles / business purpose | Admin / Operation Admin / Accounts Admin / Driver / Client Owner / Client Staff — each role's actual access is fully documented in `docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md` §7's role matrix | — | Useful as source material for the App Privacy questionnaire's "why do you collect this" answers — reuse the existing, accurate role matrix rather than re-describing access from scratch |

### App Store Connect "App Privacy" (nutrition label) cross-check

Based on the table above, the categories that should be declared as
collected (confirm exact wording in App Store Connect against Apple's
own category list, this is a mapping guide not the final submission
text):

- **Location** (Precise Location) — linked to the driver user, used for
  App Functionality (live tracking), not used for tracking across
  apps/websites.
- **User Content** (Photos/Documents, Customer Support/chat messages).
- **Contact Info** (email address, name/company name).
- **Identifiers** (account/user ID, device ID for push tokens).

Do not declare categories the app doesn't actually use (no analytics SDK,
no ad SDK, no third-party tracking found in `package.json`'s dependency
list as of this PR).

## 6. Backend / live-service requirements for review

Restating and cross-referencing `docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md`
(this PR does not change any of these, just consolidates what matters for
App Review specifically):

- Backend (Cloud Run) must be reachable and in `firestore` persistence
  mode, not memory fallback (§5 of that doc) — a reviewer hitting memory
  fallback would see data vanish/behave inconsistently across sessions.
- Firebase Storage must be configured for uploads to work at all — a
  reviewer testing the document/photo upload flow on memory fallback (or
  missing Storage config) gets a 503 "File storage is temporarily
  unavailable" error, exactly as observed and documented in PR #68's local
  smoke test. That's correct/expected behavior for local dev; it must not
  happen against whatever URL App Review is actually hitting.
- `GOOGLE_MAPS_PLATFORM_KEY` must be set and restricted (§9 of that doc) —
  otherwise every map surface shows the setup-instructions fallback card
  instead of a working map.
- Google Sign-In (if a reviewer might try it) needs both gates open:
  Firebase "Authorized domains" including `etir.app`, and the Google OAuth
  consent screen's Publishing status set to "In production" — both called
  out in `docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md` §12 and
  `ETIR-PROJECT-REFERENCE.md` §5.

## 7. Safe performance / bundle-size review

### Build warning before any changes

Ran `npm run build` on this branch before making any changes. Exact
output:

```
dist/index.html                                0.53 kB │ gzip:   0.35 kB
dist/assets/index-DHFTynR4.css               152.05 kB │ gzip:  19.75 kB
dist/assets/gpsFreshness-CMpvOcrE.js           0.93 kB │ gzip:   0.51 kB
dist/assets/web-B_PXSGDp.js                   12.61 kB │ gzip:   2.89 kB
dist/assets/purify.es-Csrj9YNg.js             28.14 kB │ gzip:  10.66 kB
dist/assets/zipHelper-Co6Hg7Sp.js             98.63 kB │ gzip:  30.76 kB
dist/assets/index.es-BQviBmic.js             159.67 kB │ gzip:  53.40 kB
dist/assets/DriverApplication-RlwL73jr.js    174.58 kB │ gzip:  41.50 kB
dist/assets/html2canvas.esm-QH1iLAAe.js      202.38 kB │ gzip:  47.71 kB
dist/assets/index-C5stEKFa.js                813.42 kB │ gzip: 223.16 kB
dist/assets/AdminPanel-bM_9vy4R.js         1,310.72 kB │ gzip: 355.86 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
```

### What was actually loaded eagerly vs. lazily, before this PR

Checked `src/App.tsx` role routing directly:

- `AdminPanel` — **already lazy** (`lazy(() => import("./components/AdminPanel"))`,
  wrapped in `<Suspense>`), per the existing "BUG-25" comment — done in an
  earlier PR, not this one.
- `DriverApplication` — **already lazy**, same pattern, same prior PR.
- `ClientDashboard` — **statically imported** at the top of `App.tsx`,
  loaded into the initial/main bundle for every session (admin, driver,
  and public-tracking visitors included), even though it's only ever
  rendered for `session.role === "client"`. This pulls
  `@vis.gl/react-google-maps` (via `ClientShipmentMap`, which
  `ClientDashboard` imports) into the main bundle unconditionally.
- `jsPDF` — statically imported at the top of `AdminPanel.tsx`
  (`import { jsPDF } from "jspdf"`) but only actually used inside one
  function, `handleDownloadPDF`, which runs only when an admin clicks
  "Download PDF" on a cost statement. Since `AdminPanel` is already a lazy
  chunk, this doesn't affect the main bundle, but it does mean the entire
  jsPDF library (~29MB unpacked, several hundred kB minified) loads as
  part of *every* AdminPanel load, not just the PDF-export path — a
  meaningful chunk of that 1,310.72 kB AdminPanel chunk.
- `html2canvas` was already its own separate chunk in the build output —
  this comes from an internal dynamic import inside the `jspdf` package
  itself (no source in this repo references `html2canvas` directly), so
  it was already lazily loaded and needed no change.
- `zipHelper`/`jszip` was already dynamically imported at the point of use
  (`await import('./utils/zipHelper')` in `App.tsx`, for the "download all
  documents as zip" feature) — this PR's jsPDF change follows that exact
  existing pattern.

### Safe fixes made in this PR

Two small, mechanical, low-risk changes — no behavior change, only *when*
each dependency's code downloads:

1. **`src/App.tsx`** — `ClientDashboard` converted from a static import to
   `lazy(() => import("./components/ClientDashboard"))`, wrapped in the
   same `<Suspense fallback={<RouteLoadingFallback />}>` already used for
   `AdminPanel`/`DriverApplication`. This is the exact same, already
   -established pattern in the same file — not a new technique.
2. **`src/components/AdminPanel.tsx`** — `handleDownloadPDF` (the only
   caller of `jsPDF` in the file) changed from a synchronous function using
   a top-level `import { jsPDF } from "jspdf"` to an `async` function that
   does `const { jsPDF } = await import("jspdf")` at the point of use,
   inside the existing `try` block (so an import failure is caught by the
   existing `catch` exactly like any other PDF-generation error). All
   three call sites (`AdminPanel.tsx` lines ~7757, ~8179, ~11189) already
   invoke it as `() => handleDownloadPDF(...)` inside arrow functions that
   discard the return value, so making it `async` required no caller
   changes.

Both changes were verified with `npm run lint`, `npm run test`, and
`npm run build` (all clean — see §10), plus a Playwright-driven browser
smoke test (client/driver/admin login, zero console errors on any of the
three — see §10) after the change, matching PR #68's precedent of
browser-verifying UI-affecting changes rather than trusting build/tests
alone.

### Build warning after changes

```
dist/index.html                              0.53 kB │ gzip:   0.35 kB
dist/assets/index-DHFTynR4.css             152.05 kB │ gzip:  19.75 kB
dist/assets/chevron-right-DhBMV169.js        0.30 kB │ gzip:   0.25 kB
dist/assets/gpsFreshness-Bb7X1yAO.js         0.93 kB │ gzip:   0.51 kB
dist/assets/star-BnlmT6Sy.js                 1.09 kB │ gzip:   0.52 kB
dist/assets/web-9z8vVvAE.js                 12.60 kB │ gzip:   2.89 kB
dist/assets/purify.es-Csrj9YNg.js           28.14 kB │ gzip:  10.66 kB
dist/assets/index.modern-SNZcNxT6.js        40.06 kB │ gzip:  13.09 kB
dist/assets/ClientDashboard-Cy7A6P4b.js     51.61 kB │ gzip:  14.53 kB
dist/assets/zipHelper-CDgDi5WM.js           98.63 kB │ gzip:  30.76 kB
dist/assets/index.es-BeF9fKco.js           159.64 kB │ gzip:  53.38 kB
dist/assets/DriverApplication-BMDoDkET.js  174.66 kB │ gzip:  41.52 kB
dist/assets/html2canvas.esm-QH1iLAAe.js    202.38 kB │ gzip:  47.71 kB
dist/assets/jspdf.es.min-DZsP_W7K.js       390.79 kB │ gzip: 127.34 kB
dist/assets/index-C1KVOGYE.js              720.62 kB │ gzip: 196.83 kB
dist/assets/AdminPanel-SdwuTGLn.js         917.96 kB │ gzip: 227.84 kB

(!) Some chunks are larger than 500 kB after minification. [same warning text]
```

| Chunk | Before | After | Change |
|---|---|---|---|
| `AdminPanel` | 1,310.72 kB (gzip 355.86 kB) | 917.96 kB (gzip 227.84 kB) | **−392.76 kB raw / −128.02 kB gzip**, jsPDF split out |
| Main (`index-*.js`) | 813.42 kB (gzip 223.16 kB) | 720.62 kB (gzip 196.83 kB) | **−92.80 kB raw / −26.33 kB gzip**, ClientDashboard split out |
| `ClientDashboard` (new) | — (was inside main) | 51.61 kB (gzip 14.53 kB) | now loads only for client sessions |
| `jspdf.es.min` (new) | — (was inside AdminPanel) | 390.79 kB (gzip 127.34 kB) | now loads only when an admin exports a PDF |

**The two >500kB warnings remain** — `AdminPanel` and the main chunk are
both still over the default Vite threshold, just meaningfully smaller than
before. This is expected and consistent with the "conservative" scope of
this PR: the warning threshold is a generic 500kB default, not itself a
functional problem, and further reduction would require the larger,
explicitly out-of-scope work below.

### Performance fixes intentionally deferred (not done in this PR)

- **Splitting `AdminPanel.tsx` itself** (11,499 lines) into smaller
  files/chunks — explicitly out of scope per this PR's instructions ("Do
  not split the full AdminPanel into many files in this PR"). The
  `recharts` charting library (used only by the super-admin-only
  Logistics Analytics tab) is still statically imported inside
  `AdminPanel.tsx` and is a plausible next target for a *dedicated*
  future PR, once it can be scoped and reviewed on its own.
- **`TrackingMap`/`ClientShipmentMap` (`@vis.gl/react-google-maps`)
  further isolation** — `TrackingMap` is only used inside `AdminPanel`
  (already lazy) and `ClientShipmentMap` only inside `ClientDashboard`
  (now lazy, this PR), so both maps libraries are already gated behind
  role-based lazy boundaries. A further win (lazy-loading the map
  specifically, separate from the rest of each panel, e.g. only once the
  GPS/Tracking tab is opened) is possible but adds real complexity for a
  comparatively small additional win — deferred.
- **Manual chunk splitting via `build.rollupOptions.output.manualChunks`**
  (e.g. splitting `firebase`, `recharts`, `lucide-react` into their own
  vendor chunks) — not attempted in this PR; it's a global build-config
  change with broader blast radius than the two targeted dynamic-import
  changes made here, and risks interacting with the existing chunk
  boundaries in ways that are hard to fully verify without dedicated
  bundle-analyzer tooling. Worth a dedicated follow-up PR with
  `rollup-plugin-visualizer` or similar to actually see the composition
  before changing chunking strategy.
- **Raising or silencing `chunkSizeWarningLimit`** — deliberately not
  done. The warning is accurate (both chunks are still large) and
  silencing it would hide a real, still-open follow-up rather than fix
  it.

## 8. Production blockers found during this review

These predate this PR and were **not introduced or fixed by it** — flagged
here because they're squarely "App Review readiness" findings and this
document is the natural place to record them. No code was changed for
these; native config changes are out of the explicit scope given for this
PR ("conservative," no large/risky changes) and deserve a dedicated,
reviewed native-config PR of their own.

- ~~**Missing iOS location/camera/photo-library usage-description
  strings.**~~ — **Fixed in PR #70**
  (`feature/ios-info-plist-usage-descriptions-fix`).
  `ios/App/App/Info.plist` had no `NSLocationWhenInUseUsageDescription`,
  `NSCameraUsageDescription`, or `NSPhotoLibraryUsageDescription` /
  `NSPhotoLibraryAddUsageDescription` keys, even though the app does call:
  - `navigator.geolocation.getCurrentPosition` in
    `src/components/DriverApplication.tsx` (driver GPS check-in/live
    tracking), twice.
  - Native file/photo pickers via plain `<input type="file" accept="image/*">`
    in `DriverApplication.tsx`, `ClientDashboard.tsx`, and `AdminPanel.tsx`
    (document/photo uploads), which on iOS can surface a
    "Take Photo or Video" option requiring camera access.

  Without the corresponding Info.plist usage-description strings, iOS
  either silently denies the permission or the app can crash when the
  permission is requested — this was both an App Review rejection risk
  (Apple explicitly checks for this) and a real runtime bug on device,
  independent of review. PR #70 added all four keys directly to
  `ios/App/App/Info.plist`:

  | Key | Value |
  |---|---|
  | `NSLocationWhenInUseUsageDescription` | "eTIR uses your location while the app is open to update shipment tracking for assigned deliveries." |
  | `NSCameraUsageDescription` | "eTIR uses the camera to let you take shipment-related photos and document images for your assigned deliveries." |
  | `NSPhotoLibraryUsageDescription` | "eTIR uses your photo library so you can choose shipment-related photos or document images to upload." |
  | `NSPhotoLibraryAddUsageDescription` | "eTIR may save shipment-related documents or images to your photo library when you choose to download or save them." |

  Validated with `plutil -lint`. No `capacitor.config.ts` or
  `project.pbxproj` changes were needed — neither mirrors usage-description
  strings. **Still open:** this is a source-only change; per §1, a new
  Xcode archive + TestFlight upload (with `CURRENT_PROJECT_VERSION`
  incremented) is required before this fix reaches an actual submitted
  build.
- **`aps-environment` is `development`** in `ios/App/App/App.entitlements`.
  Xcode normally swaps this automatically to `production` based on the
  distribution provisioning profile used at archive/export time (per the
  `Distribute App → App Store Connect` flow in §1), so this is likely a
  non-issue in practice — but worth an explicit confirmation on the next
  real archive that push notifications still work end-to-end in the
  submitted build, since a stale `development` value in the shipped
  binary would silently break production APNs delivery.
- ~~Privacy policy / Terms contact email mismatch~~ — **resolved in PR
  #85**; see §5.

## 9. Non-blocking cleanup noted, not done

- `README.md` still carries "AI Studio" prototype boilerplate (title,
  banner image, "View your app in AI Studio" link, `GEMINI_API_KEY` setup
  step). This is developer-facing only (never shipped in the app or seen
  by a reviewer), so it's not an App Review blocker — flagged for a future
  cleanup pass, not touched here to keep this PR scoped to review
  readiness/performance, not repo-wide copy cleanup.

## 10. MARAS AI Assistant — Admin-only, documentation-only roadmap clarification

Product decision recorded in this PR (**documentation only — no code
changed for this section**): **MARAS AI Assistant is and remains an
Admin-only feature.** It must never be available to Client, Client Staff,
Driver, or Public Tracking sessions.

**Current state, verified by inspection (unchanged by this PR):** the
existing "MARAS AI" header drawer (`src/components/AdminPanel.tsx`, PR
#36) already satisfies this — it only exists inside `AdminPanel.tsx`
(the "✨ MARAS AI quick-access button" and drawer render only for
super/operation admin sessions, gated the same way the rest of
`AdminPanel`'s admin-type-specific UI is), is UI-only, and is not wired to
any backend or AI provider: its send button sets a static message,
`"MARAS AI is not connected yet. This preview is UI-only."`
(`AdminPanel.tsx` ~line 3688). Confirmed by grep that no "MARAS AI" /
`ai_alert` reference exists in `ClientDashboard.tsx`, `DriverApplication.tsx`,
or `PublicTracking.tsx` — the admin-only boundary already holds today,
before any real integration exists.

**Roadmap, superseding the one-line "MARAS AI Monitor Foundation" note in
`docs/FOLLOW_UP_ROADMAP.md`'s AI section (see that file for the updated
version):**

- Keep MARAS AI unavailable to clients, client staff, drivers, and public
  tracking — permanently, not just until the first integration.
- Start with a Super Admin-only internal assistant when real integration
  begins (not Operation/Accounts on day one).
- Expand to Operation/Accounts admin types only through role-safe data
  projections that mirror existing access control, not a shared
  unrestricted data feed:
  - **Super Admin** may access all internal data through the assistant.
  - **Operation Admin** must not receive accounting, profit, margin, or
    cost-statement data through the assistant if `src/lib/adminAccess.ts`
    already blocks that admin type from that data today
    (`canViewCostStatements` is `super`/`accounts` only, per the existing
    role matrix in `docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md` §7).
  - **Accounts Admin** must not receive GPS, Driver Alliance, or other
    private operations data through the assistant if `adminAccess.ts`
    already blocks it today (`canViewGpsTracking`/`canViewDriverRoster`/
    `canViewShipmentRegistry` are `super`/`operation` only).
  - In short: the assistant must never become a side channel that returns
    data its caller's `adminType` couldn't already reach through the
    normal UI/API. Whatever projects data into an AI prompt has to run
    through the same `canView*`/`canManage*` functions the rest of the
    app already uses — not a new, parallel access-control path.
- Never let the assistant bypass any existing permission check to answer
  a question a given admin type couldn't already see the answer to
  through the normal UI.
- Do not send shipment, customer, or internal financial data to an
  external AI provider without a later, explicit, dedicated approval and
  privacy-policy coverage for that specific data flow — the current
  Privacy Policy (`PrivacyPolicyModal.tsx`) makes no mention of AI
  processing because none exists yet; that has to change together with,
  not after, any real external-provider integration.

**Explicitly not done in this PR, per instruction:** no external AI
provider (OpenAI, Claude, Gemini, or otherwise) is enabled; no AI API key
of any kind is added, referenced, or wired to any environment variable
beyond the pre-existing, already-unused `GEMINI_API_KEY` placeholder in
`.env.example` (documented as "not used by any currently-shipped feature"
in `docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md` §3, unchanged by this PR); no
AI UI was added to `ClientDashboard`, `DriverApplication`, or
`PublicTracking` (none exists there today, and none should be added
without revisiting this decision explicitly). Real AI integration is a
separate, future, dedicated PR.

## 11. Testing run for this PR

```
npm run lint                      # tsc --noEmit
npm run test                      # vitest run
npm run build                     # vite build + esbuild bundle of server.ts
npm run check-firebase-readiness  # static, secret-free env/config readiness check
```

All four pass — see the top-level PR report for exact output. Additionally
ran a Playwright-driven headless-Chromium smoke test against `npm run dev`
(memory fallback, same approach as PR #68) logging in as
`client.staff@demo.local`, `driver@demo.local`, and `admin@demo.local` in
turn: all three rendered their respective dashboards with **zero browser
console errors**, confirming the two lazy-loading changes in §7 don't
break any of the three role UIs at runtime, not just at build/typecheck
time.

## 12. Driver App Simplification + CMR Read-Only Review

**CMR upload/view contradiction fixed in PR #71**
(`feature/driver-app-simplification-cmr-documents-review`). Full detail
lives in `docs/FOLLOW_UP_ROADMAP.md` ("Driver app simplification" section);
this is a short cross-reference for the App-Review-facing angle, since the
Driver role is one of the three reviewed login flows in §3's reviewer notes
template.

Product decision: the Driver app (`DriverApplication.tsx`, currently the
"mobile-style native app view" per `ETIR-PROJECT-REFERENCE.md` §2) must
stay a simple, operational tool — current job, accept job, pickup/dropoff,
status updates, read-only CMR view/download, CMR-ready notification,
`driver_admin` chat, agreed driver amount — not grow into an admin-style
dashboard with counters/charts/analytics.

**CMR is the key access-control angle for this doc:** the decision is
that a driver may only ever **view and download** an admin-published CMR,
never create/generate/sign/stamp/approve/upload one. `src/lib/documentAccess.ts`
needed no change on the *read* side —
`isDocumentVisibleToDriver`/`DRIVER_VISIBLE_DOCUMENT_CATEGORIES` already
correctly treated `cmr` as driver-visible-for-*viewing* (checked, per the
PR #58/#59/#63 pattern, at both the UI gate and the server-side route —
`buildShipmentViewForRole` filters `shipment.documents` through it on every
driver-facing `GET`). The contradiction was on the driver-*upload* side, and
was fixed at both layers:
- **UI**: `DriverApplication.tsx` and
  `src/components/driver/FileUploadModal.tsx` no longer offer `cmr` as a
  category the driver can pick for a file *they* are sending, and the
  driver-facing chat prompt modeling an admin asking the driver to upload a
  signed CMR is gone.
- **Server**: removing the UI option alone doesn't stop a direct API call,
  so `POST /api/shipments/:id/chat` and `POST /api/shipments/:id/documents`
  both now call the new `canDriverUploadDocumentCategory(category)`
  (`src/lib/documentAccess.ts`) and reject with `403` (`"Drivers cannot
  upload CMR documents. CMR documents must be sent by Admin."`) whenever the
  session role is `driver` and the category is `cmr` — same access-control
  rigor as the PR #58/#59/#63 pattern this doc already holds the Driver role
  to, applied to the *write* direction this time.

The Documents panel (previously non-interactive — document rows had no
click target at all) now renders each admin-sent document as an actual
view/download link, which is the read-only half of the decision. Verified
browser-driven at both desktop and a 390×844 mobile viewport (`demo_driver`
for the general flow, `driver-1`/`murat_yilmaz` — whose seeded shipment
carries the demo CMR document — to see the read-only view link render for a
real `cmr`-category document).

**Done in PR #72** (`feature/driver-simple-mobile-ux-cleanup`, cosmetic
simplification, not a safety fix — PR #71's review already confirmed
none of these sections leaked admin/customer/accounting data). Trimmed
`DriverApplication`'s non-CMR admin-dashboard-style sections: the
"Smart Transit Route Tracker" map card, the "Proof of Delivery"
signature panel, the "Trip Estimate" road-condition simulator, and the
Menu tab's "Pilot Operations" block (ELD Hours of Service, Fuel & Route
Calculator, and a duplicate "System Configuration" toggle set). "Quick
Cockpit Actions" was simplified to a plain 2-button "Quick Actions"
panel. See `docs/FOLLOW_UP_ROADMAP.md` for the full list of what was
removed/simplified and the wording changes (Scan Document → Take
Photo, Upload File/Upload Doc → Send File/Send Photo, "... Updates
Terminal" → "Update Shipment Status"). None of this touched the CMR
read-only rule, `documentAccess.ts`, or the server-side CMR-upload
rejection from PR #71 — the Documents from Admin panel's CMR/View
links are unchanged. See `docs/FOLLOW_UP_ROADMAP.md` for one more
small, unrelated gap found along the way in PR #71 (seeded demo chat
messages predate the `channel` field so don't appear to driver/client
sessions in a fresh local `SEED_DEMO_DATA=true` dev environment).

**Local/dev manual-review scenario (login credentials, exact shipment
fixture, what should/shouldn't appear):** see
`docs/FOLLOW_UP_ROADMAP.md` § "Driver review demo scenario (local/dev
only — PR #71, re-verified PR #72)" — `demo_driver` / `DemoDriver123!`

**Case-bypass of the CMR-upload block fixed in PR #85.**
`canDriverUploadDocumentCategory` (above) did a strict
`category !== "cmr"` check — sending `"CMR"`/`"Cmr"`/`" cmr"` in the
request body bypassed the block entirely (not reachable via the real UI,
which only ever sends the canonical lowercase literal, but reachable via
a direct API call). Fixed to normalize case/whitespace before comparing.
This does not change anything described above — the product decision and
UI behavior are unchanged; this closes a server-side enforcement gap in
the same rule. See `docs/FOLLOW_UP_ROADMAP.md` ("Production release
readiness..." PR #85 section) for the full writeup. The
`info@maras.iq` vs `support@etir.app` mismatch flagged in §5 of this
document is also resolved as of PR #85's follow-up commit — the owner
confirmed `support@etir.app` is official and both modals were updated.
with `SEED_DEMO_DATA=true`, local only, never seeded in production.
