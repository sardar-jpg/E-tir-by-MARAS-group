# MARAS Accounting System — Architecture & Operations

Final reference for the accounting module delivered across Increments 1–7 on
`feature/accounting-workflow-full-implementation` (PR #140). All examples use
fake data; this document contains no secrets, tokens, customer, or bank data.

## 1. Authoritative data flow

- **Server-authoritative.** Every total, status, snapshot, and audit record is
  computed on the Express server (`server.ts`) using pure libraries in
  `src/lib/*`. The browser submits inputs only; it never supplies trusted
  totals, statuses, snapshots, or audit actor identity.
- **Firestore is the store of record; the Admin SDK is the only writer.**
  `firestore.rules` denies all direct client access (`allow read, write: if
  false`); web/mobile reach data exclusively through the API. Strict production
  mode refuses to fall back to memory: with `STRICT_PERSISTENCE` on and no
  Firestore, the server fails rather than silently using the in-memory store.
- **Memory mode** is explicit and development/test-only (`STRICT_PERSISTENCE=
  false`), used by the live acceptance scenarios. It mirrors the same pure code
  paths as Firestore.

## 2. Invoice lifecycle

Statuses: `draft → issued → partially_paid → paid`, plus `cancelled`.
`partially_paid`/`paid` are **derived** from the invoice allocation ledger
(`deriveInvoiceStatus`) and re-staged inside the payment transactions — the
client can never force them. Overdue is calculated from `dueDate`, never stored.

- **Issue** is one atomic, idempotent transaction: validate draft, resolve +
  validate the bank, snapshot company + bank, initialize the ledger, flip to
  `issued`, and stage the audit — all together or not at all. A repeat with the
  same `idempotencyKey` replays the issued invoice (no second number/ledger/
  snapshot).
- **Cancel** requires `invoices.cancel` + a reason, and is rejected while active
  allocations exist (`invoice_has_allocations`). Issued invoices are never hard-
  deleted.

## 3. Pricing model

`pricingMode: manual | cost_plus`. `cost_plus` carries `costBaseAmount` (the
approved internal cost, server-derived — never trusted from the browser) +
`markupType (percentage|fixed)` + `markupValue`; the server computes
`markupAmount` and `sellingAmount`. The removed legacy fields/modes are rejected
(`invalid_pricing_mode` / `legacy_field_rejected`). Internal cost + markup are
private (never in customer views/PDFs).

## 4. Payments, allocation, reversal, ledgers

- Customer payments are account-based (per customer), allocated to invoices
  (auto oldest-first or manual). Allocation and over-allocation are enforced
  **inside a Firestore transaction** on the per-invoice ledger — Firestore, not
  an in-process mutex, is the cross-instance correctness boundary.
- Vendor payments use a per-cost-item payable ledger with the same in-transaction
  overpayment guard.
- Reversal is atomic + idempotent; ledgers and derived invoice status are
  recomputed in the same transaction. Payments/vouchers are never deleted.
- Ledgers are **rebuildable aggregates** — reconciliation recomputes the expected
  value from source records.

## 5. Document snapshots, PDFs, templates

- Issued invoices render from their **immutable** `companySnapshot` +
  `bankAccountSnapshot` + `companyProfileVersion`; later master edits never
  change an issued document (verified by `documentIntegrity.test`).
- Five documents (invoice, receipt, statement, vendor voucher, cost statement)
  via one registry (`accountingDocumentRegistry.ts`) → permission, customer-
  facing vs internal classification, languages, filename, private fields. One
  renderer; EN/AR/TR with a local embedded Arabic font (RTL).
- Templates: controlled config with version history, restore-as-new-version, one
  default per type/language; editing/restoring never rewrites old documents.

## 6. Attachments

Proof/supporting files: metadata in Firestore, **bytes in the storage adapter**
(Firebase Storage in prod; in-memory map in memory mode; strict prod without a
bucket fails with `attachment_storage_unavailable`). Magic-byte sniffing
(client MIME untrusted), PDF/JPG/PNG allowlist, size cap, randomized traversal-
safe names, soft-remove with reason (never hard-deleted), downloads re-authorized
every request. Vendor/cost proofs are internal only.

## 7. Granular permissions

Central typed registry (`accountingPermissions.ts`), stored per employee, managed
**only** in Settings → Team (Super-Admin). Super has all; accounts employees get
explicit grants (plus a documented legacy-defaults set). Print ≠ edit; upload ≠
remove; `audit.viewSensitive` / `audit.executeRepair` are sensitive.

## 8. Audit log (Increment 7)

Append-only `auditLogs` collection; **not** the financial ledger. Canonical typed
actions (`AUDIT_ACTIONS`); records built server-side (actor + timestamp from
authenticated context, never the browser). For critical mutations the audit is
staged **inside** the same transaction (`stageAudit`), so it commits or rolls
back atomically and idempotent replays never double-audit. Rejected sensitive
actions are logged (`recordAudit`). Sensitive bank fields are masked (account
number + IBAN → last 4); no tokens/passwords/raw bytes are stored.

- Read-only routes: `GET /api/admin/accounting/audit` (`audit.view`; server-side
  filter + bounded cursor pagination; before/after gated by `audit.viewSensitive`)
  and `.../audit/export.csv` (`audit.export`; formula-injection-safe CSV, no bank
  secrets). No update/delete route. Viewer UI in Settings → Team.

## 9. Reconciliation & repair

`POST /api/admin/accounting/repair-ledgers` — dry-run by default (`audit.
runReconciliation`/`accountingRepair.view`); every run is audited. Executing a
repair (`?mode=repair`) additionally requires `accountingRepair.execute` **and a
reason**, and emits a distinct audit event. Repair never rewrites issued
financial snapshots, never converts currencies, never deletes historical records.

## 10. Privacy boundaries

Customers, drivers, and public/shared-link users can never reach internal cost,
vendor cost/identity, markup, profit, cost statements, vendor vouchers, audit
logs, reconciliation, repair controls, internal attachments, or permission
details. Enforced by permission-gated routes + deny-all Firestore rules; the
customer projection/PDF strips every private field.

## 11. Known limitations (honest)

- **Arabic bidi:** glyphs shape with the embedded font and mixed Arabic/Latin
  references render correctly, but full UAX-9 bidirectional reordering is
  **not** claimed.
- **Cross-instance Firestore concurrency** is enforced by Firestore transactions
  by design, but was **not** exercised against a live multi-instance cluster or
  the Firestore emulator in this environment (no emulator/credentials available).
  Parity between memory and Firestore is via the shared pure code paths, not an
  emulator run.
- No load/scale testing beyond test-scale batches; audit list/statement/aging
  queries are paginated and bounded, but large-tenant performance is unverified.

## 12. Production configuration & deployment checklist

- Set `SESSION_SECRET`, `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD_HASH`,
  `GOOGLE_MAPS_PLATFORM_KEY`, and Firebase Admin credentials (ADC).
- Keep `STRICT_PERSISTENCE` on in production (fail-closed on Firestore outage).
- Deploy `firestore.rules` (deny-all) and `firestore.indexes.json`.
- Run `npm run check-firebase-readiness` and `npm run check-production-config`.
- Configure Firebase Storage bucket (attachments + finalized PDFs).

## 13. Rollback checklist

- Revert the PR merge commit on `main` (no destructive data migration was
  introduced — all Increment 1–7 changes apply to newly created records; no
  backfill to undo).
- Redeploy the prior server build; Firestore documents remain readable by the
  older code (older code simply ignores the newer optional fields).
- No schema deletions were performed, so a forward/backward redeploy is safe.
