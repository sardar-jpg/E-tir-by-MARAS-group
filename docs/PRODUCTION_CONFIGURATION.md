# Production Configuration — eTIR by MARAS

Source of truth for every runtime variable production needs, how each one
is delivered, and how deploys are prevented from wiping them again
(Stage 1 audit finding **H-1**; config half of **H-2**).

**Never put a secret VALUE in this file, in a PR, in a log, or in a test.**
Everything here works with variable names and Secret Manager secret names only.

## 1. The three layers

1. **Contract** — `src/lib/productionConfig.ts` declares every variable,
   its kind (secret / plain), and the fatal rules. Unit-tested.
2. **Deploy manifest** — `deploy/cloudbuild.yaml` applies the required
   config on every deploy using only `--update-env-vars` /
   `--update-secrets` (merge semantics: variables not listed are
   preserved; the wipe-capable `--set-env-vars` / `--clear-env-vars`
   flags are banned and their absence is enforced by
   `src/lib/productionConfig.test.ts`).
3. **Startup gate** — `server.ts` runs `assessProductionConfig` at boot.
   In production, any fatal issue aborts startup, which **fails the Cloud
   Run revision rollout and leaves the previous healthy revision serving.**

## 2. Variable table

| Variable | Kind | Required | Delivery | Notes |
|---|---|---|---|---|
| `SESSION_SECRET` | secret | yes | Secret Manager `etir-session-secret` | Server refuses to start without it (any mode) |
| `SUPER_ADMIN_EMAIL` | plain | yes | deploy manifest | `sardar@maras.iq` |
| `SUPER_ADMIN_PASSWORD_HASH` | secret | yes | Secret Manager `etir-super-admin-password-hash` | Generate with `npm run hash-password` |
| `STRICT_PERSISTENCE` | plain | yes | deploy manifest (`true`) | `false` in production = **fatal at startup** |
| `SEED_DEMO_DATA` | plain | yes | deploy manifest (`false`) | `true` in production = **fatal at startup** |
| `NODE_ENV` | plain | yes | deploy manifest (`production`) | Activates the production rules |
| `MARAS_AI_ENABLED` | plain | feature | deploy manifest (`true`) | Must be the exact literal `true` — whitespace = disabled (startup warns) |
| `OPENAI_API_KEY` | secret | feature | Secret Manager `etir-openai-api-key` | MARAS AI provider key |
| `OPENAI_MODEL` | plain | no | manual (preserved) | Optional model override |
| `AUDIT_SCHEDULER_TOKEN` | secret | recommended | Secret Manager `etir-audit-scheduler-token` | Enables `POST /api/audit/scheduler-run`; missing = startup warning |
| `GOOGLE_MAPS_PLATFORM_KEY` | plain | feature | manual (preserved) | Browser-served by design; **must** be referrer-restricted in GCP |
| `DD_API_KEY` | secret | no | manual (preserved) | Optional Datadog |
| CORS (`APP_URL`, `ALLOWED_ORIGINS`, …) | plain | as needed | manual (preserved) | See `.env.example` |

"manual (preserved)" = set once on the service; every deploy through the
manifest preserves it because `--update-*` never touches unlisted variables.

## 3. One-time activation checklist (manual — requires GCP access)

Project: `etir-by-maras-group` (282009674985) · Service: `e-tir-by-maras-v2` · Region: `europe-west1`.

**Step 1 — create the secrets** (each command reads the value from stdin so
it never lands in shell history; paste the value, then Ctrl-D):

```bash
gcloud secrets create etir-session-secret            --replication-policy=automatic --data-file=-
gcloud secrets create etir-super-admin-password-hash --replication-policy=automatic --data-file=-
gcloud secrets create etir-openai-api-key            --replication-policy=automatic --data-file=-
gcloud secrets create etir-audit-scheduler-token     --replication-policy=automatic --data-file=-
```

For the scheduler token, generate a fresh random value first: `openssl rand -base64 32`.

**Step 2 — grant the Cloud Run runtime service account access:**

```bash
for s in etir-session-secret etir-super-admin-password-hash etir-openai-api-key etir-audit-scheduler-token; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:282009674985-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
```

(If the service uses a dedicated service account, substitute it — check with
`gcloud run services describe e-tir-by-maras-v2 --region=europe-west1 --format='value(spec.template.spec.serviceAccountName)'`.)

**Step 3 — point the main-branch Cloud Build trigger at the manifest:**
Console → Cloud Build → Triggers → the `main` push trigger → Edit →
Configuration: *Cloud Build configuration file* → `deploy/cloudbuild.yaml` → Save.
(Or: `gcloud builds triggers list` then
`gcloud builds triggers update <TRIGGER_NAME> --build-config=deploy/cloudbuild.yaml`.)

**Step 4 — verify on the next deploy** (names only — never print values):

```bash
gcloud run services describe e-tir-by-maras-v2 --region=europe-west1 \
  --format='value(spec.template.spec.containers[0].env[].name)'
gcloud run revisions list --service=e-tir-by-maras-v2 --region=europe-west1 --limit=3
```

Expected names include: `NODE_ENV, MARAS_AI_ENABLED, STRICT_PERSISTENCE,
SEED_DEMO_DATA, SUPER_ADMIN_EMAIL, SESSION_SECRET, SUPER_ADMIN_PASSWORD_HASH,
OPENAI_API_KEY, AUDIT_SCHEDULER_TOKEN` (+ any manually preserved extras).

## 4. Post-deploy health checks (every deploy)

1. New revision serving 100 % traffic (`gcloud run revisions list …`).
2. App loads at https://etir.app and login succeeds.
3. Startup logs contain **no** `[config:fatal]` / `[config:warning]` lines
   (Cloud Logging → the new revision's stdout).
4. MARAS AI drawer answers (not the "disabled" message) for a Super Admin.
5. Monitoring panel shows a recent audit run (once the scheduler is live).

## 5. Ownership & rotation

- **Owner:** MARAS super-admin (sardar@maras.iq) owns secret values and the
  trigger configuration; repository owns names, manifest, and contract.
- **Rotation:** add a new secret **version** (`gcloud secrets versions add
  <name> --data-file=-`), then redeploy (manifest pins `:latest`, so the
  next rollout picks it up). Rotate `SESSION_SECRET` only in a maintenance
  window — all existing sessions become invalid. After rotating
  `AUDIT_SCHEDULER_TOKEN`, update the Cloud Scheduler job header to match.
- **Never** rotate by editing the Cloud Run service env vars by hand —
  hand-edits are exactly what the manifest exists to make unnecessary, and
  they are overwritten by the next deploy for the variables it manages.

## 6. Operator check

`npm run check-production-config` prints a SET/missing table (names only)
and every contract issue for the current environment assessed as
production; exits non-zero on fatal issues. Use `-- --dev` to assess the
environment as-is instead.
