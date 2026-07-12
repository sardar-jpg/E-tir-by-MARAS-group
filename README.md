# eTIR by MARAS

**eTIR by MARAS** is a logistics/freight management platform for MARAS Group,
managing land, sea, and air freight operations, shipment tracking, drivers,
customers, documents, and internal logistics workflows.

- **Domain**: https://etir.app
- **Support email**: support@etir.app

## Architecture

- **Admin platform** — dashboard, shipment registry, driver/client/vendor
  management, GPS tracking map, cost statements, chat (desktop and
  mobile-first responsive UI)
- **Driver application** — job list, chat, GPS check-in, document uploads
- **Client application** — customer-facing shipment tracking dashboard,
  with per-company Owner and Staff accounts
- **Public/shared shipment tracking** — token-based, no-login tracking view
  for sharing a single shipment externally
- **Backend**: Express/Node.js (`server.ts`), one file, all API routes
- **Persistence**: Firebase (Firestore + Storage) in production, with an
  in-memory fallback for local development only (see safety rules below)
- **Native apps**: Capacitor wraps the same web app for iOS and Android

## Supported languages

- English
- Arabic (RTL)
- Turkish

## Local development

**Prerequisites:** Node.js

```bash
npm install                     # install dependencies
npm run dev                     # run the app locally
npm run lint                    # type-check (tsc --noEmit)
npm run test                    # run the test suite
npm run build                   # production build
npm run check-firebase-readiness  # verify Firebase/production launch config
```

When local Firebase credentials are unavailable, the development server may
use the in-memory fallback for UI and local workflow testing. This data is
not persistent and must never be treated as production storage. See
[Real Firebase Verification](docs/REAL_FIREBASE_VERIFICATION.md) for how to
verify the app against real Firebase locally.

## Development safety rules

- Use feature branches for all changes.
- Use Pull Requests — no direct commits to `main`.
- Do not merge without owner approval.
- Do not deploy without owner approval.
- Do not change the iOS app version or build number unless explicitly requested.
- Do not modify production data.
- Do not expose secrets (API keys, service-account credentials, session secrets) in code, commits, or docs.
- The in-memory persistence fallback is **local-development-only** and must
  never be treated as, or substituted for, persistent production storage.

## Documentation index

- [Project Reference](ETIR-PROJECT-REFERENCE.md) — start here for any new
  session: architecture, deploy mechanics, and operational gotchas.
- [Production Deployment Checklist](docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md) —
  required reading before launching or relaunching on `etir.app`.
- [Real Firebase Verification](docs/REAL_FIREBASE_VERIFICATION.md) —
  procedure for verifying real Firestore/Storage/Auth behavior before
  relying on it.
- [iOS App Review & Performance Readiness](docs/IOS_APP_REVIEW_READINESS.md) —
  updating the existing iOS/TestFlight app, App Review checklist, reviewer
  account plan, and a safe bundle-size review.
- [Follow-Up Roadmap](docs/FOLLOW_UP_ROADMAP.md) — deferred items and
  detailed review history tracked between PRs.
