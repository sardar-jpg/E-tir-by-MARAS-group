# Firebase / Google Cloud Environment Map

Verified environment mapping for eTIR, produced during the Firebase full-environment
audit. This is the single-page "which project is which" reference; it complements
`REAL_FIREBASE_VERIFICATION.md` (how to prove the real Firebase path works) and
`PRODUCTION_DEPLOYMENT_CHECKLIST.md` (the full pre-launch checklist).

> **Evidence basis.** Everything below marked _(repo)_ was verified from committed
> files in this branch. Items marked _(needs live re-verify)_ could not be confirmed
> against live Firebase/GCP during the audit because the CLI credentials
> (`gcloud` / `firebase` / ADC) had expired and require an interactive
> `gcloud auth login` / `firebase login --reauth` / `gcloud auth application-default login`.
> Re-run the live checks in §"Live re-verification" once re-authenticated.

## 1. Verified project mapping

| Surface | Value | Source |
|---|---|---|
| **Firebase / GCP project (production)** | `etir-by-maras-group` | `.firebaserc` (default + production), `firebase-applet-config.json`, iOS `GoogleService-Info.plist` _(repo)_ |
| **GCP project number** | `282009674985` | `firebase-applet-config.json` (messagingSenderId), iOS `GCM_SENDER_ID`, Cloud Run URL _(repo)_ |
| **Firestore database ID** | `ai-studio-43f003da-29bb-4b79-b7a4-8fcf5095f532` (named, non-default) | `firebase.json`, `firebase-applet-config.json` _(repo)_ |
| **Storage bucket** | `etir-by-maras-group.firebasestorage.app` | `firebase-applet-config.json`, iOS `STORAGE_BUCKET` _(repo)_ |
| **Auth domain** | `etir-by-maras-group.firebaseapp.com` | `firebase-applet-config.json` _(repo)_ |
| **Messaging sender ID** | `282009674985` | `firebase-applet-config.json` _(repo)_ |
| **Cloud Run service** | `e-tir-by-maras-v2` | `capacitor.config.ts`, `REAL_FIREBASE_VERIFICATION.md` _(repo)_ |
| **Cloud Run region** | `europe-west1` | `capacitor.config.ts` _(repo)_ |
| **Cloud Run URL** | `https://e-tir-by-maras-v2-282009674985.europe-west1.run.app` | `capacitor.config.ts` _(repo)_ |
| **Public app URL** | `https://etir.app` / `https://www.etir.app` | `src/lib/cors.ts` DEFAULT_ALLOWED_ORIGINS _(repo)_ |
| **iOS bundle ID** | `com.maras.etir` | `GoogleService-Info.plist`, `capacitor.config.ts` _(repo)_ |
| **Cloud Run runtime service account** | attached ADC identity — _(needs live re-verify)_ | should have Cloud Datastore User + Storage Object Admin only |

**All app surfaces target one project.** Web (`firebase-applet-config.json`), iOS
(`GoogleService-Info.plist`), the Cloud Run backend (`capacitor.config.ts`), Firestore,
Storage and Messaging all resolve to `etir-by-maras-group` / project number
`282009674985`. No web↔mobile project split and no stray AI-Studio project reference
was found in committed config.

## 2. Environment status

| Environment | Firebase/GCP project | Status |
|---|---|---|
| **Local development** | none (in-memory fallback) | `useMemoryFallback` with `SEED_DEMO_DATA=true` locally; no Firebase creds required. |
| **Staging** | **none in repo** | The repo has no separate staging Firebase project. `etir-staging` may exist in the console but is **not wired into any committed config**. To wire it, add a staging alias to `.firebaserc` **and** a separate `firebase-applet-config` (or `FIREBASE_CONFIG` env) — never point staging at `etir-by-maras-group`. _(needs live re-verify that `etir-staging` exists and is intended as staging)_ |
| **Production** | `etir-by-maras-group` | The live project. Cloud Run auto-deploys on push to `main` (`git push` **is** the deploy). |
| **Legacy / AI Studio** | `gen-lang-client-*` (if present) | Original AI Studio scaffold project. **Not referenced anywhere in committed config** — the `ai-studio-…` string is only the Firestore *database name* inside `etir-by-maras-group`, not a separate project. _(needs live re-verify of what the `gen-lang-client-*` project still contains)_ |

## 3. Security architecture (verified from `server.ts`)

- **Server → Firestore/Storage: Firebase Admin SDK via Application Default Credentials.**
  `server.ts` and every `scripts/*.ts` use `firebase-admin/firestore` +
  `firebase-admin/storage` with `credential: applicationDefault()`. The Admin SDK is a
  trusted-server identity and **bypasses `firestore.rules` / `storage.rules` entirely**.
- **Web/mobile client uses only `firebase/auth`** (Google Sign-In, email/password login,
  `onAuthStateChanged`) — for identity only. It never touches Firestore or Storage
  directly; all data flows through the Express API with `requireAuth`/`requireRole`.
- **`firestore.rules` / `storage.rules` hardcode UID `mQadHKcpmgbLIAwQaz8AqrAytIo2`.**
  That UID appears **only in the two rules files** — nothing in code signs in as it any
  more (confirmed by repo-wide grep). Because the server now uses the Admin SDK, the UID
  rule is **no longer load-bearing** for the server's own access.
  - **Recommended hardening (proven correct, not yet applied):** replace the UID rule
    with deny-all (`allow read, write: if false`). Since all legitimate access is via the
    Admin SDK, deny-all blocks *all* direct client access and is strictly more secure.
    This is a **rules deployment = production change**; do it only after the live
    re-verification below, deploying to `etir-by-maras-group` explicitly and confirming
    the app still reads/writes normally (it will, because the Admin SDK bypasses rules).

## 4. Safe deploy & rollback commands

`firebase.json` now references `firestore.rules`, `firestore.indexes.json`, and
`storage.rules`, so the Firebase CLI can deploy them to the correct named database and
bucket. **Always confirm the active alias first** — deploying from the wrong alias is the
single most dangerous mistake here.

```bash
# ALWAYS confirm the target project first:
firebase use                       # shows the active alias/project
firebase use production            # -> etir-by-maras-group (the only alias today)

# Rules (production change — requires approval + live verification):
firebase deploy --only firestore:rules --project etir-by-maras-group
firebase deploy --only storage:rules   --project etir-by-maras-group

# Indexes:
firebase deploy --only firestore:indexes --project etir-by-maras-group

# Validate before deploying (no remote change):
firebase deploy --only firestore:rules --project etir-by-maras-group --dry-run

# Cloud Run backend: there is NO manual command — `git push` to main auto-deploys.
```

**Rollback**

- **Rules/indexes:** `git revert` the change and re-deploy the previous
  `firestore.rules`/`storage.rules`/`firestore.indexes.json` with the same commands.
  Rules deploys are versioned in the Firebase console (Firestore/Storage → Rules → history).
- **Cloud Run:** roll back to a previous revision in the Cloud Run console
  (`e-tir-by-maras-v2`, region `europe-west1`) or `gcloud run services update-traffic
  e-tir-by-maras-v2 --to-revisions=<PREV>=100 --region europe-west1`.
- **Indexes:** removing an index is safe to revert (re-deploy re-creates it); do not
  delete a live index unless proven unused.

## 5. Required non-secret env var names (Cloud Run)

Names only — never commit values. See `REAL_FIREBASE_VERIFICATION.md` §3 for the
authoritative list. Required in production: `NODE_ENV=production`, `SESSION_SECRET`
(secret), `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD_HASH` (secret), `STRICT_PERSISTENCE=true`
(default), `SEED_DEMO_DATA=false` (default). Optional: `GOOGLE_MAPS_PLATFORM_KEY` (secret),
`ALLOWED_ORIGINS`/`APP_URL`/`CLIENT_URL`/`PUBLIC_APP_URL` (no wildcards).

## 6. Required IAM (Cloud Run runtime service account)

Least privilege — **no Owner/Editor**. Needs: **Cloud Datastore User**
(`roles/datastore.user`) for Firestore, **Storage Object Admin**
(`roles/storage.objectAdmin`) for the bucket, and Secret Manager **Secret Accessor**
(`roles/secretmanager.secretAccessor`) for any secrets it reads. FCM push uses the
Admin SDK under the same identity. _(needs live re-verify of the actual bound roles.)_

## 7. Live re-verification (run once re-authenticated)

```bash
gcloud auth login
gcloud auth application-default login
firebase login --reauth

# Identity & resources (read-only):
firebase projects:list
gcloud firestore databases list --project etir-by-maras-group
gcloud storage buckets list --project etir-by-maras-group
gcloud run services describe e-tir-by-maras-v2 --region europe-west1 --project etir-by-maras-group
gcloud secrets list --project etir-by-maras-group                 # names only
gcloud projects get-iam-policy etir-by-maras-group                # roles/service accounts

# App-level: follow REAL_FIREBASE_VERIFICATION.md §4–§9.
```

## 8. Standing warnings

- **Never commit a service-account JSON key.** The Admin SDK uses ADC only.
  `scripts/check-firebase-readiness.ts` scans for committed keys as a safety net.
- **Never deploy from the wrong Firebase alias.** Run `firebase use` first. Staging and
  production must never resolve to the same project.
- **Never point staging credentials at `etir-by-maras-group`.**
- **Firebase web API keys are not secret** (they are embedded in shipped clients), but
  `SESSION_SECRET`, `SUPER_ADMIN_PASSWORD_HASH`, `GOOGLE_MAPS_PLATFORM_KEY`, and any
  service-account material are — keep them in env/Secret Manager, never in git.
