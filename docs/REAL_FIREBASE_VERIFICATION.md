# Real Firebase Verification

## 1. Purpose

This app runs on two possible storage backends: real Firebase (Firestore +
Storage) or an in-memory fallback (`useMemoryFallback` in `server.ts`). Local
development normally runs on the memory fallback — no Firebase credentials
are required, and `docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md` documents what
production *must* be configured to instead.

This guide is the missing piece between those two: **a repeatable procedure
for verifying the app's real Firestore/Storage/Auth behavior — not just its
memory-fallback behavior — before code changes reach `etir.app`.**

Context worth knowing before using this guide: `etir.app` is served from
Cloud Run (service `e-tir-by-maras-v2`, region `europe-west1`), which
auto-deploys on every push to `main` (see `ETIR-PROJECT-REFERENCE.md` §3–4—
**`git push` is the deploy**, there is no separate manual deploy step). The
Firebase project already wired into this repo
(`firebase-applet-config.json`, projectId `etir-by-maras-group`) is that
same production project — this codebase does not currently have a separate
staging Firebase project. §4 below explains how to verify safely given that.

This document does not itself change any runtime behavior, infrastructure,
secrets, or Firestore/Storage rules. It is a verification procedure and a
static readiness script only.

## 2. Safety rules

- **Never commit a Firebase/GCP service-account JSON key file.** This app's
  Admin SDK usage (`firebase-admin` — Firestore, Storage, FCM push, and
  session-token verification alike) is designed to use Application Default
  Credentials — see §3 — so no key file should ever need to exist in this
  repo. `scripts/check-firebase-readiness.ts` (§10) scans for one as a
  safety net.
- **Never commit `.env.local` or any file containing real secrets.**
  `.gitignore` already excludes `.env*` (except `.env.example`) — do not
  override that.
- **Use local environment variables or Cloud Run secrets, never files
  tracked by git**, for `SESSION_SECRET`, `SUPER_ADMIN_PASSWORD_HASH`,
  `GOOGLE_MAPS_PLATFORM_KEY`, etc.
- **Do not run verification against real production customer data** (real
  shipments, real client accounts, real chat/document content) unless
  explicitly approved by whoever owns that data. Everything in §7–§9 can be
  done with freshly created test/demo-style records instead.
- **Prefer a separate staging Firebase project when one exists.** As noted
  in §1, this repo does not have one today — if creating one, add a second
  `firebase-applet-config*.json` (or use the `FIREBASE_CONFIG` env var, §3)
  so staging and production configs never collide, and never point a
  staging deploy at the production project's credentials.
- **Never paste a real password, session token, or service-account key into
  chat, a PR description, a commit, or this document.**

## 3. Required environment variables

Exact names, taken from `server.ts` / `src/lib/cors.ts` / `.env.example` —
nothing below is invented. **Placeholders only; never commit real values.**

```
NODE_ENV=production                # or a staging-equivalent value; gates DEMO_ACCOUNTS off and
                                    # turns on computePersistenceReadiness's production warnings
SESSION_SECRET=<strong-random-secret>       # required — server exits at startup without it
STRICT_PERSISTENCE=true            # default; only the literal string "false" turns it off
SEED_DEMO_DATA=false               # default; only "true" seeds a full demo dataset
GOOGLE_APPLICATION_CREDENTIALS=<absolute-path-to-a-service-account-key, optional> # see §3a — not needed on Cloud Run, not needed locally if using gcloud login
SERVER_FIREBASE_UID=<firebase-auth-uid-for-server-account>   # NOT a secret — see §5a; legacy, only relevant until firestore.rules/storage.rules are updated
SUPER_ADMIN_EMAIL=<root-admin-login-email>
SUPER_ADMIN_PASSWORD_HASH=<generate-with-npm-run-hash-password>
GOOGLE_MAPS_PLATFORM_KEY=<restricted-maps-key>    # only needed to test GPS/map pages
ALLOWED_ORIGINS=<comma-separated-extra-origins>   # optional — see below
```

Notes:

- **Server-side Firestore/Storage auth — Application Default Credentials
  (ADC), no username/password, no committed key file.** The server uses the
  Firebase Admin SDK (`firebase-admin/firestore`, `firebase-admin/storage`)
  for all Firestore/Storage access, authenticating via ADC:
  - **Local development**: run `gcloud auth application-default login` once
    (interactive; stores credentials in a file outside this repo — nothing
    to put in `.env.local`).
  - **Cloud Run**: ADC resolves automatically via the instance's own
    attached runtime service account — no key file, no env var. That
    service account needs the Cloud Datastore User and Storage Object Admin
    IAM roles (see `docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md`).
  - **Alternative**: set `GOOGLE_APPLICATION_CREDENTIALS` to an absolute
    path (outside this repo) of a downloaded service-account JSON key, if
    you specifically don't want to use your own `gcloud` login locally.
  - The Admin SDK bypasses `firestore.rules`/`storage.rules` entirely (it's
    a trusted-server identity, not a rules-checked end user) — those rule
    files still hardcode a UID from the previous email/password-based setup
    (§5a), which is no longer load-bearing for the server's own access but
    hasn't been changed in this branch (see §5–§6).
- **`APP_URL` / `CLIENT_URL` / `PUBLIC_APP_URL`** — all optional,
  equivalent, additional CORS-allowlist entries (`src/lib/cors.ts`,
  `parseAllowedOriginsFromEnv`). `https://etir.app`, `https://www.etir.app`,
  and the standard `localhost`/`127.0.0.1` dev ports are always allowed in
  code (`DEFAULT_ALLOWED_ORIGINS`) with no env var needed. Only set these if
  a genuinely different origin (e.g. a staging frontend) needs credentialed
  cross-origin access.
- **Firebase client config — no separate env vars used by default.** The
  web SDK config (`projectId`, `apiKey`, `authDomain`, `storageBucket`,
  `firestoreDatabaseId`) is committed in `firebase-applet-config.json`,
  unchanged by the Admin SDK migration. `src/googleAuth.ts` (the browser)
  still reads the whole file for its own Google Sign-In use. `server.ts`
  now reads only `projectId`, `storageBucket`, and `firestoreDatabaseId`
  from it, to configure the Admin SDK — it no longer uses this file to sign
  in as anything. This is intentional and safe: Firebase web API keys are
  not secret by design. To point at a **different** Firebase project (e.g.
  a real staging project), either swap that file's contents for that
  environment, or set the **`FIREBASE_CONFIG`** env var to the same JSON as
  a string — `server.ts` checks the file first, then falls back to
  `FIREBASE_CONFIG`.
- **Firebase Admin SDK — Application Default Credentials, no explicit env
  vars required.** `server.ts` initializes one `firebase-admin` app with
  `credential: applicationDefault()`, which resolves ADC automatically — on
  Cloud Run this is the instance's own attached service account, with no
  key file to manage; locally, run `gcloud auth application-default login`
  once. This single app now backs Firestore, Storage, FCM push
  notifications, and Firebase ID-token verification (`/api/verify-session`)
  alike — no service-account JSON should ever be added to this repo.
- **Storage bucket — read from `firebase-applet-config.json`, same as
  before.** No separate bucket-name env var exists; `server.ts` reads
  `storageBucket` from that file at startup and calls
  `getStorage(adminApp).bucket()` (Admin SDK) once, reused for every
  `POST /api/upload`.
- **Present in `.env.example` but not read by any shipped feature:**
  `GEMINI_API_KEY` (leftover AI Studio scaffold var — the MARAS AI Monitor
  header is UI-only today). `DD_API_KEY` / `DD_ENV` are optional Datadog
  tracing, not required for the app to run.
- Do not invent any other Firebase-specific env var (e.g. a
  `FIREBASE_STORAGE_BUCKET` or `FIREBASE_PROJECT_ID` var) — none is read by
  this codebase today.

## 4. Local staging verification setup

Recommended, in order:

1. **Decide which Firebase project you are verifying against.** Given §1,
   this repo has no dedicated staging project today. Either:
   - Create a **separate Firebase project** for verification (recommended —
     avoids any risk to production data), and point at it via a local-only
     copy of `firebase-applet-config.json` or the `FIREBASE_CONFIG` env var
     (never committed), **or**
   - Deliberately verify against the existing production project
     (`etir-by-maras-group`), understanding that any data created will land
     in real production Firestore/Storage — only do this with disposable
     test records and explicit approval (§2).
2. In that project's Firebase Console: enable **Firestore** (matching the
   `firestoreDatabaseId` your config points at — production currently uses
   a non-default database, see `ETIR-PROJECT-REFERENCE.md` §1) and enable
   **Storage**.
3. Make sure Application Default Credentials are available for that
   project: run `gcloud auth application-default login` and, if needed,
   `gcloud config set project <the-verification-project-id>` (or
   `gcloud auth application-default set-quota-project <project-id>`) so ADC
   resolves against the right project rather than whatever your default
   `gcloud` project is. Confirm the account/service-account you're using has
   the Cloud Datastore User and Storage Object Admin IAM roles on that
   project.
4. `firestore.rules`/`storage.rules` are unaffected by this — the Admin SDK
   bypasses them entirely, and this branch does not change them (§5–§6 still
   describe the pre-migration UID-based rules, kept as-is pending a separate
   follow-up).
5. Set env vars **locally in your shell or `.env.local`** (never committed —
   already gitignored) per §3. No Firebase credential env vars are needed —
   only point `firebase-applet-config.json`/`FIREBASE_CONFIG` at the right
   project if verifying against something other than the default config.
6. Run with `STRICT_PERSISTENCE=true` and `SEED_DEMO_DATA=false` — the
   production defaults — so verification reflects real production behavior,
   not the more forgiving local-dev defaults.
7. Start the app (`npm run dev`, or `npm run build && npm start` to test the
   production bundle) and read the `[Startup]` log block (§9) to confirm it
   reports `Configured persistence mode: firestore`, not `memory-fallback`.
8. Deliberately test the unsafe-fallback path once: run
   `gcloud auth application-default revoke` (or temporarily point at a
   nonexistent project) and restart. **With `STRICT_PERSISTENCE=true` (the
   default), the server now refuses to start**: after exhausting its startup
   connection retries it logs a `[FATAL]` message explaining why and exits
   with a non-zero code, instead of silently proceeding in memory-fallback
   mode — see `src/lib/firestoreStartupPolicy.ts`. Only with
   `STRICT_PERSISTENCE=false` does it fall back to memory and keep running
   (logging the `[Firestore] Connection check failed` warning), matching the
   description this step used to give unconditionally. Then run
   `gcloud auth application-default login` again to restore it.
   - **Historical note:** earlier versions of this exact test (missing/
     revoked ADC + `STRICT_PERSISTENCE=true`) crashed the process outright
     with an uncaught `Could not load the default credentials` exception,
     instead of either of the above — a duplicate, internal
     credential-resolution promise inside `@google-cloud/firestore`/
     `google-gax` that the server's own `attemptFirestoreConnect` try/catch
     could never observe or catch, no matter how it was written. Fixed via
     `src/lib/googleAuthRejectionGuard.ts`, a narrow, signature-matched
     guard for exactly that known duplicate — not a general
     unhandled-rejection swallower; anything else still crashes the process
     as before.

## 5. Firestore rules verification

> **Legacy, pending a follow-up change.** This section (and §6, §5a) still
> describes the pre-Admin-SDK-migration model, where `firestore.rules`/
> `storage.rules` hardcode a specific Firebase Auth UID and the server signs
> in as that account. The server no longer does that (see §3) — it now uses
> the Admin SDK, which bypasses these rules entirely regardless of their
> content. These rule files are intentionally **unchanged** in this branch;
> a proposed deny-all replacement (since the UID they authorize is no
> longer load-bearing for the server's own access) is a separate follow-up,
> to be done only after the Admin SDK migration itself is verified working.
> The checks below remain accurate for what these rule files currently do,
> but are no longer part of what makes the server's own Firestore/Storage
> access work.

- [ ] `firestore.rules` deployed to the target project (Firebase Console >
      Firestore Database > Rules, or `firebase deploy --only firestore:rules`
      if the Firebase CLI is set up — not covered by this repo's scripts)
- [ ] The rule's hardcoded UID (`mQadHKcpmgbLIAwQaz8AqrAytIo2` in the
      committed file) matches the actual `SERVER_FIREBASE_EMAIL` account's
      UID for the target project (Firebase Console > Authentication > find
      the account > copy its User UID) — if verifying against a new
      project, this will **not** match until you update the rule for that
      project
- [ ] With a matching UID: the app's own read/writes succeed (shipments,
      drivers, clients, etc. load and save normally through the UI)
- [ ] With a deliberately mismatched UID (or no server sign-in at all): all
      Firestore reads/writes are rejected — confirm the app correctly falls
      back to memory (§4 step 8) rather than crashing or silently losing
      writes
- [ ] Super admin can create/read/update shipments, drivers, clients,
      vendors, cost statements, admins, activity logs
- [ ] Operation admin's *server-side* restrictions still hold even though
      Firestore itself grants the server account full access — this is
      enforced in `server.ts`/`src/lib/adminAccess.ts`, not in
      `firestore.rules` (see §7); rules verification here is only about the
      server's own access, not per-human-role access
- [ ] No collection is reachable by anything other than the server account
      — confirm via Firebase Console > Firestore > Rules Playground (or the
      Firebase emulator) that a request with no `request.auth`, or a
      different UID, is denied

## 5a. Server-account UID verification (static, no Firebase connection)

This is the step most likely to be skipped, because a mismatched UID doesn't
fail loudly like a missing env var does — the server falls back to memory
and logs it (§4 step 8, §11), but nothing forces you to *notice* before
deploying rules. Do this every time the server account or a Firebase project
changes:

1. In Firebase Console, open **Authentication > Users**.
2. Find the user whose email matches `SERVER_FIREBASE_EMAIL` for the target
   project.
3. Copy that user's **UID**.
4. Confirm it matches the UID hardcoded in both `firestore.rules`
   (`function isServerAccount()`) and `storage.rules` (same function) —
   they must currently be updated together, by hand; there is no build step
   that generates one from the other.
5. Optionally, set `SERVER_FIREBASE_UID` to the UID from step 3 — locally in
   your shell or `.env.local` (never committed) — and run:
   ```bash
   npm run check-firebase-readiness
   ```
   The script (`scripts/check-firebase-readiness.ts`,
   `src/lib/firebaseRulesUid.ts`) reads `firestore.rules` and
   `storage.rules` directly off disk and reports:
   - the UID it found in each rules file,
   - whether the two rule files agree with each other,
   - whether `SERVER_FIREBASE_UID` (if set) matches what the rules contain.

   **`SERVER_FIREBASE_UID` is not a secret.** It is a plain Firebase Auth
   UID (like the one already committed in plaintext in `firestore.rules`
   and `storage.rules`) — not a password, not a token, and not
   `SERVER_FIREBASE_EMAIL`/`SERVER_FIREBASE_PASSWORD`. It exists only so
   this script has something to diff the rules' hardcoded UID against
   without contacting Firebase.

   What failure means:
   - **`firestore.rules` / `storage.rules` UIDs match: false`** — the two
     rule files authorize different accounts; whichever one doesn't match
     the real `SERVER_FIREBASE_EMAIL` account will reject every request
     from the server. Fix both files to the same UID before deploying
     either.
   - **A `SERVER_FIREBASE_UID` mismatch warning/problem** — the UID you set
     locally doesn't match what's hardcoded in the rules. If you're
     confident `SERVER_FIREBASE_UID` is the *correct* value (i.e. you just
     copied it from Firebase Console per steps 1–3), the rules are stale
     and need updating before this account's requests will succeed against
     the target project. This is reported as a warning outside production,
     and as a blocking problem when `NODE_ENV=production` and
     `STRICT_PERSISTENCE` is on (the default) — matching how other
     launch-blocker problems are reported by this script.
   - **No `SERVER_FIREBASE_UID` set** — the script only reports what UID it
     found in the rules; it cannot confirm that matches the real
     `SERVER_FIREBASE_EMAIL` account without you completing steps 1–4
     manually. This is always a warning, never a blocking problem — the var
     is optional.

   This check is entirely static: it never signs in to Firebase, never
   reads `SERVER_FIREBASE_PASSWORD`, and never prints `SERVER_FIREBASE_UID`'s
   value beyond the presence/match booleans above. It cannot substitute for
   actually confirming the UID in Firebase Console (steps 1–3) — it can only
   catch the case where you *did* look it up and either the rules or your
   env var don't reflect it.

## 6. Storage rules verification

- [ ] `storage.rules` deployed to the target project
- [ ] Same UID-match check as §5 (Storage Console > Rules), against the
      same server account
- [ ] Upload a valid PDF via `POST /api/upload` (through the UI — Document
      Center, chat attachment, or Driver Application scan) — succeeds and
      returns a real Firebase Storage download URL
- [ ] Upload a valid JPG/PNG/WebP — succeeds
- [ ] Upload an invalid file (`.exe`, `.svg`, `.html`, or a mismatched
      extension/MIME pair) — rejected client-side with the "Unsupported
      file type" error from `src/lib/uploadValidation.ts`'s
      `ALLOWED_MIME_TYPES`/`ALLOWED_EXTENSIONS`
- [ ] Upload a file over 15MB (`MAX_UPLOAD_BYTES`) — rejected with the
      "exceeds the 15MB upload limit" error
- [ ] A client-sent `client_admin` chat attachment stays chat-only — does
      **not** appear in the shipment's Document Center or on the public
      share link (`shouldSaveChatFileAsShipmentDocument`,
      `src/lib/chatVisibility.ts`)
- [ ] An admin-sent `client_admin` chat attachment still auto-publishes as
      an official shipment document (existing, intended behavior —
      unchanged)
- [ ] Public tracking never exposes a raw Firebase Storage URL — confirm in
      browser dev tools (Network tab) on a public tracking page that
      document/photo URLs are same-origin
      `/api/share/:token/documents/:docId` paths, never
      `firebasestorage.app`/`storage.googleapis.com` URLs directly (see
      `buildPublicShareDocumentPath`, `src/lib/publicShareView.ts`)
- [ ] With Storage genuinely unavailable (§8) — confirm `POST /api/upload`
      returns a clear error rather than silently storing the file only in
      memory

## 7. Real Firebase smoke test matrix

Perform against the target project from §4, logged in as each role. This
mirrors `docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md` §7/§8/§11, restated here
as concrete real-Firebase checks (not just tab visibility) — see
`src/lib/adminAccess.ts` for the underlying rules.

**Super Admin**
- [ ] Login succeeds
- [ ] Dashboard loads with real data from Firestore
- [ ] Shipment Registry: list loads, create/update a shipment persists to
      Firestore (confirm by reloading in a second tab/session)
- [ ] Driver Alliance: driver roster loads
- [ ] GPS Tracking Map loads (needs `GOOGLE_MAPS_PLATFORM_KEY`, §9 of the
      deployment checklist)
- [ ] Settings > Team (admin roster), Audit Logs load
- [ ] Full access confirmed — nothing 403s

**Operation Admin**
- [ ] Login succeeds
- [ ] Shipment Registry, Driver Alliance, GPS Tracking Map load
- [ ] `GET /api/cost-statements` → 403 (`canViewCostStatements`)
- [ ] `GET /api/logs` (Audit Logs) → 403 (`canViewAuditLogs`)
- [ ] `GET /api/admins` (Team roster) → 403 (`canViewAdminRoster`)

**Accounts Admin**
- [ ] Login succeeds
- [ ] Cost Statements: view and save a statement, persists to Firestore
- [ ] `GET /api/shipments` → 403 (`canViewShipmentRegistry`)
- [ ] GPS Tracking Map, Driver Alliance, Shipment Registry tabs are hidden
      and the underlying routes 403 if called directly
- [ ] Clients/Vendors visible (read-only — write attempts 403)

**Client Owner / Client Staff**
- [ ] Login succeeds
- [ ] Sees only that client's own shipments (confirm a second client's
      shipment is not returned)
- [ ] Can send a `client_admin` chat message and a file attachment
      (persists, appears on reload)
- [ ] Client Staff (`isEmployee`) is scoped identically to the owner within
      the same company

**Driver**
- [ ] Login succeeds
- [ ] Sees only assigned jobs (confirm another driver's job is not
      returned)
- [ ] No customer/company private info (contact numbers, cost data) is
      present in the driver-safe view (`buildShipmentViewForRole`)
- [ ] Can send `driver_admin` chat and upload a document/photo

**Public tracking**
- [ ] A real share token loads `GET /api/share/:token` successfully
- [ ] Response contains only the fields in `buildSecureShareView` — no
      `loadingContactNumber`/`deliveryContactNumber`, no `shareToken`, no
      cost/accounting fields, no subscriber emails
- [ ] Documents/photos only appear when
      `shareIncludeDocuments`/`shareIncludePhotos` are enabled on that
      shipment
- [ ] No raw Storage URLs anywhere in the response or rendered page

## 8. Upload verification

- [ ] PDF upload succeeds end-to-end (client → `/api/upload` → real
      Storage → download URL returned and openable)
- [ ] Image upload (JPG/PNG/WebP) succeeds
- [ ] Invalid extension/MIME rejected (415, `uploadValidation.ts`)
- [ ] File over 15MB rejected
- [ ] Customer chat upload does not land in `shipment.documents` (§6)
- [ ] Admin chat upload into `client_admin` does auto-publish as a document
      (§6 — this is current intended behavior, not a bug)
- [ ] **Storage unavailable path**: temporarily break Storage access (e.g.
      revoke ADC's Storage IAM role, or point at an invalid bucket name in
      `firebase-applet-config.json`) and confirm `POST /api/upload` returns
      a clear 503 ("File storage is temporarily unavailable... NOT saved")
      rather than silently succeeding into memory — this is enforced
      explicitly in `server.ts`'s upload handler
      (`useMemoryFallback || !storageBucketRef` check), independent of
      `STRICT_PERSISTENCE`. Restore access afterward.

## 9. Persistence verification

- [ ] Create a shipment (or any record) while running with real Firebase
      credentials
- [ ] Restart the server process
- [ ] Confirm the record still exists after restart (proves it was written
      to Firestore, not memory)
- [ ] Confirm the `[Startup]` log block (`server.ts`, printed once per
      boot) reports `Configured persistence mode: firestore`
- [ ] Confirm the log does **not** contain `"Running using Robust Memory
      Fallback"`, `"utilizing default Memory Fallback"`, or any
      `[STARTUP ERROR]` line
- [ ] Confirm demo data was not reseeded — no `*.demo.local` /
      `demo_driver` / `demo_client` / `demo_client_staff` accounts appear
      (only possible if `NODE_ENV` were not `production`/staging-equivalent
      — see `DEMO_ACCOUNTS` in `server.ts`, gated on `IS_LOCAL_DEV`)
- [ ] Confirm no `SEED_DEMO_DATA`-seeded dataset (drivers/shipments/chat
      from `initialDrivers`/`initialShipments`/etc.) is present
- [ ] **(PR #84)** With real Firebase already connected, deliberately break
      connectivity mid-session (e.g. temporarily revoke the server
      account's access or block network to Firestore) and confirm `GET`
      endpoints (`/api/shipments`, `/api/drivers`, etc.) now return `503`
      instead of silently succeeding with empty results — `getDoc`/`getDocs`
      in `server.ts` respect `STRICT_PERSISTENCE` exactly like every write
      path already did. This specific transition (connected → disconnected
      mid-session) could not be exercised in an environment with no real
      Firebase credentials; only the "never connects" boot-time path was
      verified there.

## 10. Required commands

```bash
npm run lint                      # tsc --noEmit
npm run test                      # vitest run
npm run build                     # vite build + esbuild bundle of server.ts
npm run check-firebase-readiness  # static env/config readiness check — see below
```

All four should pass/report clean before considering a Firebase environment
verified.

`check-firebase-readiness` (`scripts/check-firebase-readiness.ts`) is a
**secret-free, connection-free** static check — it never contacts Firebase
and never prints a secret value. It reports the same persistence-mode
picture as the server's own `[Startup]` log
(`src/lib/persistenceReadiness.ts`), plus: whether `SESSION_SECRET` /
`SUPER_ADMIN_PASSWORD_HASH` are present, whether any `ALLOWED_ORIGINS`-style
env var contains a wildcard `*`, whether any committed file in the repo
looks like a Firebase/GCP service-account key, and — per §5a —
whether `firestore.rules`/`storage.rules` agree on the server-account UID
and, if `SERVER_FIREBASE_UID` is set, whether it matches them. Run it with
`NODE_ENV=production` set (matching your real deployment env) to get the
same launch-blocker checks the checklist requires — it exits non-zero if any
are found:

```bash
npm run check-firebase-readiness                       # check current shell env
NODE_ENV=production npm run check-firebase-readiness   # simulate a production check
```

Local dev/manual commands:

```bash
npm run dev     # tsx server.ts — local dev server
npm start       # node dist/server.cjs — runs the built production bundle (after npm run build)
```

## 11. Failure signs

Red flags to watch for in logs or behavior — any of these means the
environment is not production-ready:

- `"Running using Robust Memory Fallback"` or `"utilizing default Memory
  Fallback"` in startup logs
- `[Firestore] Connection check failed` in startup logs — usually means ADC
  is missing or unusable (run `gcloud auth application-default login`
  locally; verify the Cloud Run service account's IAM roles in production).
  With the default `STRICT_PERSISTENCE=true`, this now leads to a `[FATAL]`
  message and a non-zero process exit once startup retries are exhausted
  (`src/lib/firestoreStartupPolicy.ts`) rather than silently continuing —
  a container stuck restarting on this message means ADC/IAM needs fixing,
  not that the app is "just running on memory fallback."
- `Configured persistence mode: memory-fallback` in the `[Startup]` block
- Uploads returning "File storage is temporarily unavailable"
  (`useMemoryFallback || !storageBucketRef` — means Firestore/Storage isn't
  actually connected, not just an upload-specific failure)
- `*.demo.local` / `demo_driver` / `demo_client` / `demo_client_staff`
  accounts reachable, or `SEED_DEMO_DATA=true` while `NODE_ENV=production`
- `STRICT_PERSISTENCE=false` while `NODE_ENV=production`
- A wildcard (`*`) origin anywhere in `ALLOWED_ORIGINS`/`APP_URL`/
  `CLIENT_URL`/`PUBLIC_APP_URL`, or the server reflecting an arbitrary
  Origin header (would indicate `src/lib/cors.ts` was changed unsafely)
- (Legacy, see §5) Firestore/Storage rules' hardcoded UID disagreeing
  between the two files — run `npm run check-firebase-readiness` (§5a) to
  confirm `firestore.rules` and `storage.rules` still agree with each
  other; this UID is no longer load-bearing for the server's own access
  (the Admin SDK bypasses these rules), so a mismatch here is a hygiene
  issue, not a connectivity-blocking one
- Accounts admin able to fetch `GET /api/shipments`, `GET /api/drivers`, or
  `GET /api/logs` (should 403)
- Public tracking (`GET /api/share/:token`) returning internal documents,
  chat data, cost/accounting fields, or a raw
  `firebasestorage.app`/`storage.googleapis.com` URL
- Any Firebase/GCP service-account JSON file present in the repo (Admin SDK
  should use ADC only — see §3)
- `GOOGLE_MAPS_PLATFORM_KEY` unrestricted in Google Cloud Console (not
  detectable from this repo — verify directly in Cloud Console per
  `docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md` §9)

## 12. Sign-off checklist

- [ ] `npm run lint` passes
- [ ] `npm run test` passes
- [ ] `npm run build` passes
- [ ] `npm run check-firebase-readiness` (with `NODE_ENV=production`) reports
      no blocking problems
- [ ] Firestore and Storage rules deployed to the target project, with the
      server-account UID confirmed matching (§5–§6, §5a)
- [ ] Persistence verified real (§9) — data survives a restart, no memory
      fallback, no demo data
- [ ] Full role smoke test matrix (§7) passed for all seven roles/surfaces
- [ ] Upload verification (§8) passed, including the Storage-unavailable
      error path
- [ ] No `*` CORS origin, no committed service-account key, no secret
      committed anywhere in the diff being shipped
- [ ] Whoever ran this signs off with: date, which Firebase project was
      used (staging or production), and whether real production customer
      data was touched (should be "no" — see §2)

This guide complements, but does not replace,
`docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md` — that document is the full
pre-launch checklist (env vars, CORS, Google Workspace, accounting, GPS,
rollback plan); this one is specifically about proving the real
Firestore/Storage/Auth path works before relying on it.
