# Performance Phase 1 — polling & session efficiency

Scope: four tightly-bounded optimizations. No business rules, permissions,
authentication, visibility, or API contracts changed. No WebSockets/SSE/
Firestore `onSnapshot`. `server.ts` and `AdminPanel.tsx` were not split.

## 1. Session-verification cache

- **What:** the authenticated-request middleware (`server.ts` `attachSession`)
  used to run a Firestore `getDoc` on every request to confirm the backing
  account. It now caches the **backing read only** for a short window.
- **Module:** `src/lib/sessionVerificationCache.ts` (pure, unit-tested).
- **Key:** `` `${role}:${id}` `` — role is included so `admin:X`/`driver:X`/
  `client:X` can never collide.
- **TTL:** 5s (hard-capped at 10s in the class).
- **Bounds:** max 5000 entries; on insert it sweeps expired entries then
  FIFO-evicts the oldest — it can never grow without bound. Expired entries are
  also evicted lazily on read.
- **Fail-closed:** the token signature+expiry are still verified on **every**
  request (never cached), and the pure `evaluateSessionBacking(payload, …)`
  verdict is still re-computed on **every** request against the (possibly
  cached) backing — so a stale-`adminType` token is still rejected even against
  a fresh cached record. A Firestore **error** is never cached and keeps the
  existing 503 `SESSION_VERIFICATION_UNAVAILABLE` fail-closed path. Negative
  (missing/blocked) results live only for the same 5s TTL — no long negative
  caching.
- **Invalidation (immediate):** `sessionVerificationCache.invalidate(role, id)`
  is called after every account mutation that can affect session validity:
  - `DELETE /api/admins/:id` (delete)
  - `PUT /api/admins/:id/permissions` (permission/adminType change)
  - `DELETE /api/drivers/:id`, `PATCH /api/drivers/:id/status` (approve/reject),
    `PUT /api/drivers/:id` (defensive)
  - `DELETE /api/clients/:id`, `PUT /api/clients/:id` (can flip `active`)
  Without invalidation, a change is still caught at TTL expiry (≤5s).
- **Multi-instance:** each Cloud Run instance has its own cache. A mutation on
  instance A invalidates only A; other instances converge within ≤1 TTL (5s).
  This is far shorter than the 24h session-token lifetime that was the prior
  worst case, and is an intentional, documented trade-off.
- **Observe:** `sessionVerificationCache.stats()` → `{ hits, misses, size }`.

## 2. Visibility / app-state polling control  &  3. Adaptive backoff

- **Core (pure, unit-tested):** `src/lib/adaptivePolling.ts`
  - state machine `nextPollingState` / `intervalForState`
  - `PollingController` — a single self-rescheduling timer with **all** side
    effects injected (timer, clock, poll, visible/online predicates), so it is
    deterministically testable in the node harness.
- **Adapters:** `src/hooks/browserPolling.ts` (`attachBrowserPolling`, imperative,
  for existing effects) and `src/hooks/usePolling.ts` (React hook). Both wire the
  controller to `visibilitychange` / `online` / `offline` and clean everything up.
- **Guarantees:** at most one pending timer (repeated transitions never stack
  duplicates); paused while hidden or offline; exactly one immediate refresh on
  return to visible/online; overlapping polls suppressed; small ±10% jitter to
  de-synchronize clients.
- **Schedule (chat/default):** `3s → 5s → 10s → 20s → 30s`. Climbs one step per
  unchanged poll; snaps back to the fast step on: new/changed data, user sends a
  message, chat/shipment context change, foreground resume, back online, or
  manual refresh. Transient errors use bounded exponential backoff
  (`3s → 6s → 12s → 24s → 30s` cap).
- **Change detection (cheap):** existing `since`/cursor deltas — first load or a
  tick that returned new messages counts as a change. No deep serialization.
- **Capacitor:** `@capacitor/app` is **not** a dependency; the WebView emits
  standard `visibilitychange` on background/foreground, so browser visibility
  handling doubles as mobile app-state handling. If `@capacitor/app` is added
  later, its `appStateChange` can call the returned `reset()`/`pollNow()`.
- **Surfaces updated:**
  | Surface | Before | After |
  |---|---|---|
  | `App.tsx` admin chat drawer | fixed 3s, ran in background | adaptive 3s→30s, paused when hidden/offline, reset on send |
  | `ChatCenter.tsx` | fixed 3s, ran in background | adaptive 3s→30s, paused, reset on send |
  | `DriverApplication.tsx` chat | fixed 3.5s, ran with screen off | adaptive 3.5s→30s, paused, reset on send |
  | `DriverApplication.tsx` data | fixed 12s, ran in background | **fixed 12s** (no idle backoff — offers/assignments never delayed), paused when hidden/offline, immediate refresh on resume |
  | `PublicTracking.tsx` | fixed 5s, ran in background | adaptive 5s→30s, paused when hidden/offline |
  | `AdminPanel.tsx` | already paused on `document.hidden` + delta polling | unchanged (not regressed) |

### GPS (audited, deliberately unchanged)
`src/hooks/driver/useDriverLocationReporting.ts` already gates its reporting
loop on `isActive` — it runs only while a job is underway (through "Arrived")
and stops when there is no active job. That is exactly the safe pause. It is
**not** gated on visibility: an active delivery must keep reporting while the
app is backgrounded / the screen is off, and Capacitor/iOS background behavior
must not be broken. No GPS change was made in this phase.

## 4. Compression & static cache headers

- **Deployment evidence:** the app is served **directly by Express on Cloud
  Run** (`deploy/cloudbuild.yaml`, service `e-tir-by-maras-v2`). `firebase.json`
  has **no** `hosting` block, and the repo contains no CDN / load-balancer
  config. Cloud Run does not auto-compress, and `express.static` set no
  long-cache headers — so origin compression and immutable asset caching are
  both warranted.
- **Compression:** added the standard `compression` middleware early in the
  chain. Its filter follows the pure, unit-tested policy in
  `src/lib/httpCaching.ts` (`shouldCompress`): compresses text/JSON/JS/CSS/SVG/
  XML/manifest, skips already-compressed images/fonts/pdf/zip/media, and honors
  the conventional `x-no-compression` opt-out.
- **Static cache headers** (`cacheControlForAsset`, pure + unit-tested), applied
  only to files served from `dist/`:
  - `/assets/*` (content-hashed Vite output) → `public, max-age=31536000, immutable`
  - entry HTML (`/`, `*.html`, and the SPA fallback) → `no-cache`
  - other root files → `public, max-age=0, must-revalidate`
  These are **never** applied to authenticated API, customer/driver/accounting,
  or public-share responses (those flow through routes, not `express.static`).

## Tests

- `src/lib/sessionVerificationCache.test.ts` — TTL, read-collapsing, role
  isolation, fail-closed (missing/stale-token/Firestore-error), invalidation,
  bounds, ttl clamp.
- `src/lib/sessionVerificationCache.bench.test.ts` — raw before/after read
  counts (deterministic, no Firebase).
- `src/lib/adaptivePolling.test.ts` — state machine + controller (pause/resume,
  immediate refresh, no duplicate timers, backoff/recover, cleanup, no overlap).
- `src/lib/httpCaching.test.ts` — immutable vs no-cache classification,
  compressible vs already-compressed.

## Benchmark (raw counts, deterministic)

`npx vitest run src/lib/sessionVerificationCache.bench.test.ts`

- 40 authenticated requests at 3s spacing (120s), 5s TTL:
  **40 backing reads → 20** (identical authorization outcome).
- 50 requests inside one 5s TTL window: **50 → 1** backing read.

### Visibility-gating model (illustrative, NOT a production measurement)
One admin with the Chat Center backgrounded for 50 of every 60 minutes, chat at
the 3s fast tier: foreground ≈ 10 min × 20 polls/min ≈ 200 polls/hr; background
≈ 0 (paused) vs the previous ≈ 50 min × 20 = 1000 polls/hr that used to fire in
the background. Model only — real numbers depend on usage.
