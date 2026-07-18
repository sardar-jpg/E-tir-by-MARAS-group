# MARAS AI — Full Internal Monitoring & Audit System (PR #131)

A complete, persistent, **read-only** internal monitoring system for
eTIR. Deterministic backend rules inspect operational, accounting,
data-integrity, security, and technical conditions; MARAS AI explains
and prioritizes findings but **OpenAI is never required to detect
anything** — monitoring works fully with the AI disabled.

## Architecture

```
auditRules.ts      pure rule inventory (reuses existing business helpers)
auditEngine.ts     pure machinery: run/isolate rules, reconcile findings,
                   manual actions, role scoping, summaries
server.ts          thin wiring: snapshot loader, Firestore-backed lock,
                   run persistence, routes, scheduling, notifications
MarasAiMonitoringPanel.tsx   the dashboard (opened from the MARAS AI drawer)
```

- **Read-only by construction:** rules receive an in-memory snapshot and
  return detections; the only writes anywhere are to the audit's own
  collections, the grouped `ai_alert` notification, and the activity
  log. No rule or route can edit shipments, accounting, users, statuses,
  or permissions.
- **Failure isolation:** each rule runs in its own try/catch. A failed
  rule is recorded on the run (`ruleResults[].error`, runtime measured
  per rule) and the rest continue. Monitoring never blocks operations.
- **Lifecycle (deterministic):** detect → `open`; re-detect → occurrence
  count + lastSeen; condition cleared → **auto-resolve** (document kept,
  history appended); re-detected after resolve → **reopen**. Ignored
  findings stay ignored. Findings are **never hard-deleted**.

## Persistence collections

| Collection | Contents | Retention |
|---|---|---|
| `auditFindings` | one doc per (rule, record) finding: severity, scope, status, evidence, recommendedAction, firstSeen/lastSeen, occurrenceCount, full status history | **forever** (no deletes) |
| `auditRuns` | one doc per run: trigger, actor, duration, per-rule results/runtimes, created/reopened/auto-resolved counts, rulesVersion | last 100 runs |
| `auditState` | `summary` (last successful/failed run, rules version, counts) + `lock` (distributed lock) | current state |

All writes go through the project's existing Firestore/memory-fallback
wrappers. The memory fallback is dev-only convenience — **TEC-002 raises
a critical finding if production ever serves from it**.

## Scheduling (Cloud Run reality)

Cloud Run instances are not guaranteed to stay alive, so the in-process
interval is best-effort only:

1. **Startup pass** — 15s after boot (skipped if a successful run is
   fresher than 30 min).
2. **In-process interval** — every 6h, best-effort, same freshness skip.
3. **Manual** — "Run Audit Now" (Super Admin) → `POST /api/admin/audit/run`.
4. **External scheduler (the correctness mechanism)** —
   `POST /api/audit/scheduler-run` with header `x-audit-token:
   $AUDIT_SCHEDULER_TOKEN`. Disabled (403) until the env var is set.

### Cloud Scheduler setup (manual, one-time — the authoritative trigger)

PR #136 (Stage 2 PR 3, audit finding H-2) made this endpoint the
authoritative recurring trigger; the in-process timers are best-effort
only. **Never put the token value in this file, in a PR, or in a log** —
it lives in Secret Manager as `etir-audit-scheduler-token` (see
docs/PRODUCTION_CONFIGURATION.md) and is delivered to Cloud Run as the
`AUDIT_SCHEDULER_TOKEN` env var by the deploy manifest.

| Setting | Value |
|---|---|
| Target URL | `https://etir.app/api/audit/scheduler-run` |
| HTTP method | `POST` (anything else gets `405` + `Allow: POST`) |
| Header | `x-audit-token: <value of the etir-audit-scheduler-token secret>` |
| Recommended cadence | every 3 hours: cron `0 */3 * * *` |
| Timezone | `Europe/Istanbul` (business timezone; the endpoint itself is timezone-agnostic — cadence only) |
| Retry policy | max 3 retries, min backoff 1 min, max backoff 10 min, deadline 120 s |

Create it with:

```bash
gcloud scheduler jobs create http etir-audit-run \
  --location=europe-west1 \
  --schedule="0 */3 * * *" \
  --time-zone="Europe/Istanbul" \
  --uri="https://etir.app/api/audit/scheduler-run" \
  --http-method=POST \
  --update-headers="x-audit-token=$(gcloud secrets versions access latest --secret=etir-audit-scheduler-token)" \
  --max-retry-attempts=3 --min-backoff=60s --max-backoff=600s --attempt-deadline=120s
```

(The command substitution reads the secret at creation time without ever
writing it to this file or your shell history file — do not paste the
value inline.)

**Manual verification** (after creating the job): `gcloud scheduler jobs
run etir-audit-run --location=europe-west1`, then confirm Cloud Logging
shows `[audit-scheduler] authorized invocation received.` followed by an
`[audit] scheduler run … succeeded` line with counts, and the Monitoring
panel shows a fresh run. An unauthorized probe must get 403:
`curl -s -o /dev/null -w '%{http_code}' -X POST https://etir.app/api/audit/scheduler-run` → `403`,
and `curl -s -o /dev/null -w '%{http_code}' https://etir.app/api/audit/scheduler-run` → `405`.

**Behavioral guarantees (unit-tested in src/lib/auditScheduler.test.ts):**
- Missing, malformed, repeated, or wrong `x-audit-token` → one shared 403
  (constant-time comparison; no oracle about which check failed).
- A retry fire landing within 60 s of a success is acknowledged as
  `{ ok: true, deduplicated: true }` without re-running.
- Scheduler/manual triggers never skip on freshness — recovering from a
  stale audit is exactly their job; only best-effort startup/interval
  triggers skip while a success is fresher than 30 min.
- Logs carry run ids, durations, and counts only — never token values.

**Overlap prevention:** a Firestore lock document (`auditState/lock`)
with a 10-minute TTL; acquire-then-confirm semantics, expired locks are
taken over (logged) so a crashed run can never wedge auditing. Best-effort
(the shims expose no transactions) — the TTL bounds any race, and runs
are idempotent by design (deterministic finding ids).

## Rule inventory

| Rule | Category | Severity | Scope | Detects |
|---|---|---|---|---|
| OPS-001 | operations | medium | operations | active shipment, no status change 3+ days (shared heuristic) |
| OPS-002 | operations | high | operations | ETA passed while unfinished |
| OPS-003 | operations | high | operations | dispatched land shipment without a driver |
| OPS-004 | operations | medium | operations | "Assigned" 2+ days, not accepted |
| OPS-005 | operations | medium | operations | "Accepted" 2+ days, not started |
| OPS-006 | operations | medium | operations | status outside the freight-mode sequence |
| OPS-007 | operations | high | operations | finished shipment with zero documents |
| OPS-008 | operations | medium | operations | finished land shipment without CMR/POD |
| OPS-009 | operations | medium | operations | incomplete multi-truck/container assignments |
| OPS-010 | operations | medium | operations | stale/absent GPS during an active trip (12h) |
| ACC-001 | accounting | high | accounting | finished shipment without a cost statement |
| ACC-002 | accounting | medium | accounting | statement with zero items |
| ACC-003 | accounting | medium | accounting | item with missing/invalid currency |
| ACC-004 | accounting | low | accounting | item missing supplier or description |
| ACC-005 | accounting | medium | accounting | duplicate cost items |
| ACC-006 | accounting | high | accounting | finished order, customer revenue = 0 |
| ACC-007 | accounting | high | accounting | totalCost ≠ Σ item amounts |
| ACC-008 | accounting | medium | accounting | remainingBalance ≠ totalCost − paidAmount |
| ACC-009 | accounting | high | accounting | payment status contradicts amounts |
| ACC-010 | accounting | high | accounting | statement references a missing shipment |
| ACC-011 | accounting | medium | accounting | delivered 14+ days, expenses still unpaid |
| INT-001 | data_integrity | critical | super | duplicate canonical order numbers |
| INT-002 | data_integrity | low | super | non-canonical order number format |
| INT-003 | data_integrity | high | super | shipment references a missing driver |
| INT-004 | data_integrity | high | super | unknown status enum value |
| INT-005 | data_integrity | medium | super | updatedAt earlier than createdAt |
| INT-006 | data_integrity | low | super | recent notification references a missing shipment |
| SEC-001 | security | high | super | admin account without adminType |
| SEC-002 | security | high | super | duplicate admin accounts per email |
| SEC-003 | security | medium | super | more super admins than expected (>5) |
| SEC-004 | security | critical | super | credential-like pattern in stored text (value redacted) |
| TEC-001 | technical | per-kind | super | every persistent monitoring event group (5xx, db/upload/notification/GPS failures, frontend errors, MARAS AI provider failures, slow endpoints) |
| TEC-002 | technical | critical | super | production serving from memory fallback |
| TEC-003 | technical | high | super | no successful audit within 2× the schedule |

### Recommended Priority engine

Every finding additionally carries a **Recommended Priority** and
**Response Time**, derived deterministically at read time (so aging open
findings escalate live) — never by OpenAI, which only explains the
engine's own reason string:

| Priority | Response target |
|---|---|
| 🔴 Critical – Fix Immediately | Within 1 hour |
| 🟠 High – Fix Today | Within the current business day |
| 🟡 Medium – Review Soon | Within 2–3 business days |
| 🔵 Low – Monitor | During normal operations |

Score = base severity (critical 4 / high 3 / medium 2 / low-info 1)
+1 if unresolved ≥ 3 days · +1 if observed ≥ 5 runs · +1 for security
category · +1 for customer impact (operational finding whose evidence
shows the ETA already passed) — clamped to the four levels. The
deterministic reason lists exactly the factors that applied. The
dashboard shows the four-bucket triage row and sorts findings worst
priority first; the AI digest carries priority + reason with an explicit
instruction to explain, never invent.

### Severity policy
critical = data corruption / security exposure / production integrity ·
high = money, delivery, or references broken · medium = process stuck or
inconsistent · low = hygiene · info = context only.

### Known unavailable signals (documented, not faked)
Reefer temperature (no temperature field in the data model),
border-delay free periods/charges (no border-delay fields), driver
stationary/route-vs-stage geo analysis (no GPS history stored), stored
invoices and post-approval edit audit (exports are generated, not stored;
no field-level edit log), repeated authentication failures (not logged),
Cloud Run/GCP platform metrics (the app receives none). Adding the
missing fields later makes each of these a one-rule addition.

## Access-control matrix

| Capability | Super | Operation | Accounts | Driver/Client |
|---|---|---|---|---|
| Dashboard (drawer entry) | full | operational scope | — (API only) | never |
| Operations findings | ✓ | ✓ | ✗ | ✗ |
| Accounting findings | ✓ | ✗ | ✓ (API; their permissions already cover the records) | ✗ |
| Data-integrity / Security / Technical | ✓ | ✗ | ✗ | ✗ |
| Acknowledge | ✓ | own scope | own scope | ✗ |
| Ignore / manual resolve (reason mandatory) | ✓ | ✗ | ✗ | ✗ |
| Run audit now / scheduler | ✓ / token | ✗ | ✗ | ✗ |

Scoping is enforced **server-side** on every route and on the AI context
(`visibleAuditScopesFor` — one function, pinned by tests). Internal
accounting data never reaches operations users; security/technical
findings never leave Super Admin; evidence is redacted at detection time.

## Notifications & badge

- New **high/critical** findings per run → **one grouped** `ai_alert`
  in-app notification (admin-only by construction) — never one per
  finding.
- The mobile MARAS AI badge now also counts open high/critical findings
  (scope-filtered per viewer). Unlike the operational attention part,
  this count is **not** dismissed by opening the drawer — it clears only
  when findings are acknowledged/resolved/ignored or auto-resolve.
- No OpenAI call is ever made for badges or notifications.

## MARAS AI integration

"What are the most critical problems?", "Audit all current shipments.",
"Show accounting inconsistencies.", "What should we fix first?" trigger
the `audit_findings` intent: the server loads the persisted findings
(scope-filtered for the asking role), attaches them as CONTEXT DATA and
as `audit_findings` cards, and instructs the model that these are the
ONLY real findings — general advice must be labeled as suggestion, never
as a detected finding. Source indicator: deterministic lists are System
Data; AI explanation on top shows System Data + AI Analysis.

## Incident-response workflow

1. Badge / `ai_alert` notification → open MARAS AI → Monitoring.
2. Filter to critical/high; open the finding; read evidence + suggested
   action; use **Open Record** to jump to the shipment.
3. Fix the underlying condition in the normal screens (the audit system
   itself never edits data). The next run auto-resolves the finding.
4. `Acknowledge` while work is in progress; `Ignore` (Super Admin,
   reason) for accepted permanent exceptions; manual `Resolve` (Super
   Admin, reason) only when you have verified the condition is cleared —
   if it isn't, the next run reopens it automatically.
5. TEC-002 (production memory fallback) is a drop-everything incident:
   restore Firestore credentials/connectivity, then run a manual audit.

## Adding a new rule safely

1. Add one `AuditRule` object in `auditRules.ts` — reuse existing pure
   helpers; never re-derive business logic; evidence must be short and
   secret-free.
2. Pick category/scope/severity from the tables above (accounting rules
   MUST be `scope: "accounting"`, security MUST be `super` — pinned).
3. Add a healthy-baseline + trigger test in `auditRules.test.ts` (the
   "healthy snapshot produces zero findings" test guards false
   positives for free).
4. Bump `AUDIT_RULES_VERSION`.
