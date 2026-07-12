# Code Cleanup Audit

Branch: `chore/safe-code-cleanup-naming-audit`. A conservative, behavior-preserving
cleanup pass — no business rules, permissions, API contracts, Firebase
architecture, iOS configuration, or the current App Review submission were
touched. See `README.md`'s documentation index for how this fits alongside
the other docs.

## 1. What was reviewed

- **Unused code**: every `.ts`/`.tsx` file under `src/`, `server.ts`, and
  `scripts/` — unused imports/locals/params (via `npx tsc --noEmit
  --noUnusedLocals --noUnusedParameters`, flags passed on the CLI only,
  `tsconfig.json` unchanged), unused exported functions/components (grepped
  repo-wide for zero call sites), unreachable UI branches, dead constants,
  dead i18n keys (`src/translations.ts`), stale comments, and leftover
  AI-Studio-only references.
- **Naming/wording**: every user-facing string in `src/components/*.tsx` and
  `server.ts` checked against the confirmed terminology (Client
  Owner/Client Staff, no "Tracking Account" role, Smart Tracking/periodic
  GPS updates rather than live/real-time claims, MARAS AI "not connected
  yet", internal-MARAS-employee vs. Client-Staff "employee" wording, current
  support email/domain).
- **Tracked scratch/temp files**: `git ls-files` cross-referenced against
  `.gitignore` and against real import/reference usage.
- **Dependencies**: every `package.json` dependency/devDependency checked
  for actual usage across `src/`, `server.ts`, `scripts/`, and build config
  files. Report only — `package.json`/`package-lock.json` untouched.

Every removal below was proven safe via a repo-wide grep for the exact
symbol/key name (showing zero remaining references) and/or a
compiler-verified unused-binding diagnostic, then confirmed by a full
`lint`/`test`/`build`/`check-firebase-readiness` pass. Nothing was removed
based on appearance alone.

## 2. Safe removals made

**Dead functions/types (server.ts, src/lib/api.ts)** — each confirmed to have
zero call sites anywhere in the repo before removal:
- `server.ts`: `handleFirestoreError` + its only consumers `OperationType`/`FirestoreErrorInfo`.
- `server.ts`: the wrapped `addDoc(colRef, data)` function and its
  memory-fallback helper `handleAddDocMemory` (the app creates documents via
  `setDoc` with explicit IDs everywhere; this `addDoc` wrapper was never
  called). Removing it also freed the now-unused `addDoc as rawAddDoc`
  import; one stale comment listing "addDoc" among live write wrappers was
  corrected to match.
- `src/lib/api.ts`: `safeRemoveItem` (its siblings `safeGetItem`/`safeSetItem`
  are actively used; this one had zero callers). Also fixed a dangling
  comment referencing `fetchFromFirestoreDirectly`, a function that no
  longer exists in the codebase.
- `src/components/AdminPanel.tsx`: the dead `totalRevenueUSD` calculation in
  `AdminPanel` and the `APPROX_USD_EXCHANGE_RATES` constant it was the sole
  reader of — both orphaned leftovers of a "Total Revenue" dashboard KPI
  that no longer renders anywhere (confirmed by the matching dead
  `totalRevenue` translation key below). Also removed one dead
  `matchingShipment` local in `renderStatementHeader` (declared, never
  read in that function).

**Unused imports** — one-line/list edits, zero behavior change, across:
`server.ts`, `src/App.tsx`, `src/components/AdminPanel.tsx`,
`ClientDashboard.tsx`, `ClientShipmentMap.tsx`, `DriverApplication.tsx`,
`PrivacyPolicyModal.tsx`, `PublicTracking.tsx`, `TermsModal.tsx`,
`TrackingMap.tsx`, `admin/sections/AdminDashboardSection.tsx`. This
includes several unused default `React` imports (JSX transform makes them
redundant) and unused `lucide-react` icon imports.

**Unused locals — small, individually verified pure/no-side-effect cases only**:
- `server.ts`: unused `logCol` local (only its declaration, never read).
- `src/components/admin/mobile/MobileDashboard.tsx`: unused `t`/
  `completedShipmentsCount` dropped from the props destructure (component
  interface unchanged — parent still passes them, just not bound locally).
- `src/components/TrackingMap.tsx`: unused loop variable in a `for...of`
  (`for (const [, val] of Object.entries(...))`) — a second, near-identical
  loop in the same file that *does* use its key was left untouched.
- `src/utils/zipHelper.ts`: unused `contentType` local (computed, never
  used in the subsequent `zip.file(...)` call).
- `src/lib/auth.test.ts`: unused `body` from an array destructure in a test
  (only `sig` was used).

**Dead i18n keys** — 31 keys removed from all three locale blocks
(`en`/`tr`/`ar`, 93 lines total) in `src/translations.ts`, each independently
confirmed to have zero `t('key')` call sites anywhere in `src/` (verified
with a script, not just visual inspection; two keys with raw-string false
positives — `activityLogs`, `username` — were checked by hand and confirmed
to be unrelated identifiers, not translation lookups):
`roleDriver, rolePublic, language, shipmentDetails, activityLogs, notes,
attachments, addAttachment, uploadDoc, uploadPhoto, privateChatTitle, send,
selectCategory, optional, noNotifications, markAllRead, totalRevenue,
username, autoGenerated, weight, cargoDetails, viewOnlyTracking,
lastUpdated, destinationDetails, originDetails, secureDirectView,
restrictedNotice, unassigned, allDrivers, shipmentProgressReport,
searchLogs`.

**Tracked dead files removed** (all confirmed zero references in build
config, source, or docs beyond the roadmap entries noting them for
removal):
- `Etir/e-tir-by-maras/android/gradlew` and `etir-new/.claude/start-expo-*.sh`
  — two abandoned scaffold/prototype trees, already named for removal in
  `docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md` and
  `docs/FOLLOW_UP_ROADMAP.md`'s "Repository Cleanup / Legacy Files Review"
  item (now marked done in both docs).
- `assets/.aistudio/.gitignore` — an empty AI-Studio-scaffold placeholder
  directory (its only content excludes everything inside it).
- `metadata.json`, `firebase-blueprint.json` — root-level Google AI Studio
  project metadata/entity-blueprint files, unreferenced anywhere in
  `vite.config.ts`, `capacitor.config.ts`, `server.ts`, or any source file.

## 3. Naming/wording corrections made

Three "real-time tracking" claims that overstated the app's actual
Smart Tracking / periodic-GPS-update behavior (the app already has strong,
consistent honesty about this elsewhere — `TrackingMap.tsx`, `gpsFreshness.ts`,
and `DriverApplication.tsx` all explicitly say "not live every-second
tracking" — these three were the only stale outliers found):

- `src/components/AdminPanel.tsx` — customer-facing WhatsApp share message:
  "Track logistics progress in real-time here" → "Track logistics progress
  here".
- `src/components/PrivacyPolicyModal.tsx` — Privacy Policy bullet:
  "**Real-Time Tracking:** Keep active delivery runs fully transparent..."
  → "**Smart Tracking:** Keep active delivery runs transparent..., with
  periodic location updates rather than continuous live tracking."
- `src/components/admin/sections/AdminClientsSection.tsx` — admin-facing
  description (English variant only; the Turkish/Arabic strings already
  said generic "tracking links"): "share real-time tracking links" →
  "share tracking links".

No other naming issues were found. Full audit results (all FINE / already
correct, verified but unchanged):
- **"Tracking Account"**: zero occurrences; actively banned by
  `src/lib/noLegacyClientWording.test.ts` across all three languages.
- **"View Only Account" / "Customer Staff"**: zero role/label usages found.
- **"Employee" wording**: consistently means Client Staff (customer-company
  employee), never confused with internal MARAS staff —
  `src/lib/clientAccess.ts` explicitly documents this distinction in a code
  comment.
- **AI Studio / Gemini**: only 4 remaining mentions, all historical code
  comments explaining a past fix; nothing user-facing.
- **MARAS AI**: every UI reference already correctly says "not connected
  yet" / "UI-only" — no real backend integration exists.
- **Demo wording**: gated to local-dev-only (`IS_LOCAL_DEV`), never reaches
  production.
- **Support email / domain**: `support@etir.app` used consistently; no
  `info@maras.iq` or stale domain found in source.

## 4. Items intentionally not changed (deferred to future PRs)

These were found during the audit but deliberately left alone — either too
large/structural for a "small diff" cleanup pass, or carrying enough nuance
that a drive-by fix risked being a guess rather than a proven-safe change:

- **Unreachable UI branch in `DriverApplication.tsx`** (~100+ lines): a
  "Driver Node Console" / "Developer Mode" / "Simulated Account" panel
  (desktop) and a "Floating Gear Workspace" variant (mobile), both gated on
  `!loggedInDriverId`. Traced the only render path
  (`src/App.tsx` → `DriverApplication`) and confirmed `loggedInDriverId` is
  always truthy by construction there, so both blocks are dead in the
  shipped app. Removal touches component state (`selectedDriverId`,
  `showControlsModal`, the `drivers` prop) and 100+ lines — recommend a
  dedicated future PR, not a drive-by deletion here.
- **`src/App.tsx`'s unused `isAdminMobileMode` binding**: the surrounding
  comment explicitly documents that this `useIsMobile(1024)` call must stay
  unconditional for React's Rules of Hooks (Driver/Client sessions return
  early above it). Left entirely untouched rather than risk a
  hooks-ordering regression for a cosmetic fix.
- **GPS-related unused state** (`DriverApplication.tsx`'s `gpsAvailable`/
  `lastGpsCoords`, `TrackingMap.tsx`'s `currentDriverName`,
  `PublicTracking.tsx`'s `subscriptionSuccess`): each is a `useState` pair
  where only the setter (or only the getter) could be confirmed used from a
  quick grep. Given the explicit safety boundary against touching GPS/
  tracking behavior, and the real possibility these reflect a
  partially-wired feature (e.g. a "subscribed!" confirmation UI that was
  never finished) rather than pure dead code, these were left for a
  dedicated future review rather than assumed dead.
- **`AdminPanel.tsx`'s unused `elementId` parameter** on
  `handleDownloadPDF` (3 call sites pass a string that's silently
  discarded): safe in principle but touches 4 locations for zero
  functional gain — deferred as low-value.
- **`server.ts`'s idiomatic unused `req`/`res` Express handler params** (11
  occurrences) and one unused `map` callback parameter in
  `AdminDashboardSection.tsx`: cosmetic only, not flagged by the project's
  actual `npm run lint` (which doesn't enable `noUnusedParameters`) —
  renaming them is pure style churn with no safety or lint benefit, so left
  alone.
- **`ClientDashboard.tsx`'s unused `isMobile` prop** in its destructure:
  genuinely safe to drop (the interface/parent contract is unaffected
  either way) but low enough value that it was left out to keep this PR's
  diff focused on higher-value items.

## 5. Possibly unused dependencies (report only — none removed)

Full dependency audit performed; **no changes were made to `package.json` or
`package-lock.json`** — this section is a report for a future, dedicated
dependency-review PR.

**Clearly used**: `react`, `react-dom`, `express`, `firebase`,
`firebase-admin`, `dotenv`, `dd-trace`, `jszip`, `jspdf`, `lucide-react`,
`motion`, `recharts`, `@vis.gl/react-google-maps`, `@types/google.maps`,
`@capacitor/core`, `@capacitor-firebase/authentication`,
`@capacitor/push-notifications`, `@capacitor/cli`, `@capacitor/ios`,
`@tailwindcss/vite`, `@vitejs/plugin-react`, `tailwindcss`, `vite`,
`esbuild`, `tsx`, `typescript`, `vitest`, and the `@types/*` ambient-type
packages matching each of the above.

**Possibly unused**:
- `autoprefixer` — no `postcss.config.*` exists anywhere in the repo, and
  Tailwind v4's Vite plugin (built on Lightning CSS) does its own
  vendor-prefixing without a separate PostCSS step. No wiring into any
  build step found. Medium-high confidence this is a leftover from a
  pre-v4-migration setup.

**Needs a separate dedicated review** (not a simple usage question):
- `@capacitor/android` — listed in `package.json` but no `android/`
  directory has been scaffolded yet in this repo (only `ios/App` exists).
  Whether to keep it (future Android support planned) or drop it is a
  product/roadmap decision, not a cleanup-pass decision.
- `vite` — listed identically in both `dependencies` and `devDependencies`
  (same version `^6.2.3`). Not a usage problem, just a `package.json`
  hygiene item; a dependency-focused PR should resolve the duplicate
  deliberately.
- Any version/removal decision touching `firebase-admin`,
  `@capacitor-firebase/authentication`, or `dd-trace` — all confirmed used,
  but auth/tracing/observability changes carry security or
  production-monitoring blast radius beyond what a grep-based cleanup pass
  should decide.

## 6. Large files still needing future modularization

Not touched in this pass (structural, not cleanup) — flagged for a future,
dedicated refactor PR:

- `src/components/AdminPanel.tsx` — **9,666 lines**. By far the largest
  file in the repo; already the known >500kB build-warning chunk
  (documented in `docs/IOS_APP_REVIEW_READINESS.md` §7 as a deferred
  follow-up). A future PR should look at splitting it by tab/section
  (several sections already live under `src/components/admin/sections/`
  and `src/components/admin/mobile/` — the pattern exists, just isn't
  applied to everything left in the main file).
- `server.ts` — **5,240 lines**, one file holding every API route. Already
  documented as an intentional "one file, all API routes" architecture in
  `ETIR-PROJECT-REFERENCE.md`; splitting this is a larger architectural
  decision, not a cleanup item.
- `src/components/DriverApplication.tsx` — **2,327 lines**, includes the
  confirmed-dead unreachable UI region noted in §4 above.
- `src/components/TrackingMap.tsx` — **2,139 lines**.
- `src/components/ClientDashboard.tsx` — **1,334 lines**.
- `src/components/PublicTracking.tsx` — **1,041 lines**.

## 7. Risks found

- The dead "Total Revenue" KPI trail (§2) — a fully-computed value, a
  supporting exchange-rate constant, and a translation key, all orphaned
  together — suggests a UI card was removed at some point without its
  backing computation being cleaned up. Worth a quick product check: was
  removing the "Total Revenue" dashboard KPI intentional, or should it be
  restored instead of having its dead remnants deleted? This PR assumes
  the removal was intentional (nothing in `docs/FOLLOW_UP_ROADMAP.md`
  suggests otherwise) and cleaned up the leftovers accordingly.
- The unreachable `DriverApplication.tsx` dev-mode panel (§4) sat in the
  shipped bundle, inert, for an unknown period — it's dead weight (bundle
  size) but not a functional or security risk since it's provably
  unreachable from the real login flow.
- No other correctness, security, or behavior risks were found during this
  pass — everything else reviewed was either already correct or is a
  documented, deliberate tradeoff from earlier PRs (see
  `docs/FOLLOW_UP_ROADMAP.md` for that history).

## 8. Recommended future cleanup PRs

1. Remove the confirmed-unreachable `DriverApplication.tsx` dev-mode/
   simulation panel (§4) — needs its own PR since it touches component
   state, not just a deletion.
2. Dependency-focused PR: resolve the duplicate `vite` entry, decide on
   `autoprefixer` and `@capacitor/android`, per §5.
3. Modularize `AdminPanel.tsx` further — extract remaining inline sections
   into `src/components/admin/sections/` following the existing pattern.
4. A dedicated pass on the GPS-related unused state variables flagged in
   §4 (`gpsAvailable`/`lastGpsCoords`/`currentDriverName`/
   `subscriptionSuccess`) — confirm with the product owner whether these
   reflect an unfinished feature or are safe to remove.
5. Consider enabling `noUnusedLocals`/`noUnusedParameters` in a scoped way
   (e.g. an additional CI check, not `tsconfig.json` itself) so new unused
   bindings don't silently accumulate again — this audit found 76 tsc-level
   unused-binding diagnostics before this cleanup; most are now fixed, the
   rest are catalogued in §4.

## 9. Confirmation

No business logic, access-control/permission behavior, authentication or
session behavior, API request/response contracts, persisted field names,
Firestore collection names, Firebase/Storage rules, shipment numbering,
chat channel rules, document visibility rules, accounting calculations, GPS
update intervals, notification routing, or production configuration were
intentionally changed by this PR. Every change in this diff is either a
proven-dead-code removal (verified via repo-wide search and/or compiler
diagnostics, then re-verified by a full lint/test/build pass) or a
narrowly-scoped wording correction to text that contradicted the app's own
documented Smart Tracking / periodic-update behavior.
