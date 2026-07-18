# Firebase Rules & Google Maps Key — Security Verification

Stage 2 PR 2 (audit findings **H-3**, **H-4**). Repository-side enforcement
is automatic; the two short manual checklists at the bottom cover what can
only be proven inside Google consoles. **No secret or key value appears in
this document, and none may ever be added to it.**

## 1. Firebase rules posture (H-3)

**Committed posture (since PR #121, now regression-guarded):**
`firestore.rules` and `storage.rules` are both **deny-all**
(`allow read, write: if false;`). Every legitimate read/write goes through
the Express backend using the Firebase **Admin SDK**, which bypasses rules
entirely. The repo contains **zero** `firebase/firestore` / `firebase/storage`
client-SDK usage — browsers use `firebase/auth` for identity only.

**Automatic enforcement added in this PR:**
- `assessRulesPosture` (`src/lib/firebaseRulesUid.ts`) fails on: a returning
  hardcoded `request.auth.uid == "…"` authorization, any permissive grant
  (`if true`, bare `allow …;`, `request.auth != null`), or a missing
  deny-all rule. Comments are stripped first so documentation text can
  neither trigger nor satisfy a check.
- `npm run check-firebase-readiness` now treats any posture violation or a
  missing rules file as a **blocking problem** (it previously tolerated the
  legacy UID model as a valid shape).
- The unit suite runs the same guard against the **real** rules files and
  scans `src/` proving no Firestore/Storage client-SDK import exists —
  so CI fails anywhere the posture regresses.
- The legacy `SERVER_FIREBASE_UID` env surface was removed
  (`.env.example`, readiness script) — nothing hardcodes or compares a
  server UID anymore.

## 2. Google Maps key (H-4)

**How the key is delivered (verified in this PR):**
- `GET /api/maps-key` — now scoped to the roles that actually render a
  Google map: **clients** (`ClientShipmentMap`) and **GPS-permitted admins**
  (`canViewGpsTracking`: super/operation, for `TrackingMap`). Drivers and
  accounts-type admins receive 403. The key never appears in the public
  share payload (`publicShareView.ts` allowlist) — `PublicTracking`
  renders no Google map.
- `GET /api/shipments/:id/distance-matrix` — uses the key **server-side
  only** to call Google; the key is never in the response.
- The startup routine that copied the key into a Firestore
  `configs/google_maps` document was **removed** — nothing ever read it.

A Maps **JS** key is browser-visible by design; its real protection is the
restriction set in Google Cloud Console. Role-scoping above just avoids
handing it to sessions with no map at all.

## 3. Manual checklist — Firebase console (cannot be proven from the repo)

1. Firebase Console → Firestore Database → **Rules**: confirm the deployed
   text matches the repo's `firestore.rules` (deny-all). If it differs,
   deploy the repo version: `firebase deploy --only firestore:rules`.
2. Firebase Console → Storage → **Rules**: same check;
   `firebase deploy --only storage`.
3. After deploying, use the console Rules Playground: a simulated
   unauthenticated **and** an authenticated read of any document/object
   must both be **denied**.

## 4. Manual checklist — Google Cloud console (Maps key, H-4)

Credentials → the key served as `GOOGLE_MAPS_PLATFORM_KEY`:

1. **Application restriction = Websites (HTTP referrers)** with ONLY:
   - `https://etir.app/*`
   - `https://www.etir.app/*`
   - any explicitly required staging origin — nothing else, no `*` entries.
2. **API restriction**: only the APIs actually used — Maps JavaScript API
   (browser maps) and Distance Matrix API (server calls). Note: referrer
   restrictions can block server-to-server Distance Matrix calls; if that
   occurs, split into TWO keys — a referrer-restricted browser key served
   by `/api/maps-key` and an IP/API-restricted server key used only by the
   distance-matrix route — rather than loosening either restriction.
3. **Native apps**: the iOS/Android builds run the same web app in a
   Capacitor webview, whose origin is `capacitor://localhost` (iOS) /
   `https://localhost` (Android). If maps must work in the installed native
   apps, add those two origins to the referrer list (or issue a separate
   restricted key for native) — verify on a TestFlight/internal build after
   restricting, since an over-tight list silently breaks native maps.
4. Confirm billing alerts/quota caps exist for the Maps APIs so abuse of a
   leaked key would be noticed and bounded.
