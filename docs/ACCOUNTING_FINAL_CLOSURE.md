# eTIR by MARAS — Accounting System Final Closure

Final state of the accounting implementation (Phases 1–9.1). This document
describes the delivered system, the business rules that must not change, the
validation performed at closure, and known non-blocking limitations.

- **Branch:** `fix/accounting-invoice-based-profit`
- **Validated commit range:** `73ce4ee` (Phase 1) → `387cf94` (Phase 9.1)
- **Phase 9 commit:** `d28685b`  ·  **Phase 9.1 (unified notifications):** `387cf94`

---

## 1. Completed phases

| Phase | Commit | Summary |
|------|--------|---------|
| 1 | `73ce4ee` | Revenue & Official Profit based on issued customer invoices, not the Driver Agreed Amount |
| 2 | `995a8c9` | User-based, ordered approval chains (per-cycle approver snapshot) |
| 3 | `06c1b19` | Invoice lock on issued statements + controlled reopen approval chain |
| 4 | `a769312` | Manual vendor payment workflow (partial payments, reversal, ledger) |
| 5 | `e75ab24` | Customer payment workflow + per-invoice allocation |
| 6 | `637f2c0` | Financial Closing workflow (close, blockers, financial reopen chain) |
| 7 | `c02ecbd` | Read-only financial reports + account statements (per-currency) |
| 8 | `e7d3856` | Controlled professional PDF report exports (+ CSV), export permission hardening |
| 9 | `d28685b` | Accounting notifications, reminders & Action Center |
| 9.1 | `387cf94` | Unified notification center integration (one bell, one badge, one feed) |

---

## 2. Key business rules (final — do not change)

### Official Profit
`Official Profit = Issued Customer Invoice Total − Approved Vendor Costs`, per
currency. Customer and vendor **payment timing never changes Official Profit**.
Profit is never derived from cash movement, draft invoices, cancelled invoices,
unapproved costs, or the Driver Agreed Amount.

### Driver Agreed Amount — Reference Only
Never used as an approved cost, invoice amount, payable, receivable, profit
input, cash figure, financial-close input, report total, or notification
trigger. It is a reference field only.

### Order Number
The single order reference is the MAR number (`MAR-2026-0001`). The codebase
uses the `orderRef` identifier internally; there is no second numbering system
(enforced by `noOrderNumberRegression.test.ts`).

### Currency separation
Currencies are never combined and there is **no FX conversion**. Every total is
grouped by currency (USD / IQD / EUR / TRY / …); there is never one
mixed-currency grand total.

### Invoice & payment model
- Active customer invoices: `issued`, `partially_paid`, `paid`. `draft` and
  `cancelled` are excluded from revenue, receivables, and profit.
- Customer received = active (non-reversed) payment allocations to issued
  invoices. Customer remaining = invoice total − valid allocations (never
  negative for presentation; overpayments surface as controlled warnings).
- Vendor approved cost = cost lines of a `final_closed` cost statement. Vendor
  paid = active (non-reversed) vendor payments. Vendor remaining = approved −
  paid (no overpayment).

### Approval & reopen workflows
- Approval uses an ordered, **per-cycle approver snapshot** captured at submit;
  approve/reject read the snapshot, never live settings.
- Cost-statement reopen and Financial Reopen each use their own captured
  approval-chain snapshot; historical snapshots are never rewritten.

### Financial Close
Allowed only when the cost statement is `final_closed`, every vendor line is
paid, every issued invoice is paid, no draft invoice exists, no accounting
reopen is active, and no financial reopen is pending. Once closed, all
accounting mutations are read-only until an approved Financial Reopen. Reports
and historical snapshots remain available after close.

---

## 3. Accounting permissions

Central registry in `src/lib/accountingPermissions.ts` (single source of truth).
Highlights relevant to closure:

- `reports.view` (legacy accounts default) — read reports.
- `reports.export` — **sensitive**, explicit grant only (removed from the
  legacy default in Phase 8). Gates both PDF and CSV export, in addition to the
  report's own view permission (`profitReports.view` / `cashReports.view`).
- `profitReports.view`, `cashReports.view` — **sensitive** (Official Profit and
  Operational Cash Movement).
- `accounting.notifications.view` (legacy accounts default) — open the Action
  Center / see accounting notifications.
- `accounting.notifications.configure` — **sensitive**, explicit grant only.
- `accounting.financialClose`, `accounting.financialReopen` — granular, not
  Super-Admin-only.

No permission is Super-Admin-only by construction; Super Admin simply has all
permissions. Notification visibility never bypasses the underlying scope
permission (customerPayments.view / vendorPayments.view / accounting.financialClose
/ accountingAudit.view).

---

## 4. Audit coverage

Recorded via the existing accounting audit infrastructure (metadata only — never
full financial records):

- Cost statement: submit / approve / reject / finalize.
- Reopen and Financial Reopen: request / approve / reject.
- Financial close: closed / close-rejected.
- Vendor payments: created / reversed.  Customer payments: created / reversed.
- Invoices: issued / cancelled.
- Report exports: `report.exported` (type, format, row count, filters, scope).
- Notifications: `notification_created`, `notification_resolved`,
  `notification_read`, `notification_acknowledged`, `notification_dismissed`,
  `notification_settings_updated`.

---

## 5. Reports & PDFs

Read-only reporting layer (`src/lib/accountingReports.ts`) backs both the UI and
the exports. Reports: Order Financial Summary, Accounts Receivable (aged),
Accounts Payable, Official Profit, Operational Cash Movement, Customer Receipts,
Vendor Payments, Financial Closing, plus customer/vendor account statements.

- Professional PDF exports for all report types via the existing accounting PDF
  architecture (`accountingReportExportModel.ts` → `accountingPdfRender.ts`);
  headers repeat across pages, currency shown beside every amount, unavailable
  values shown as text (never a fake zero), no mixed-currency grand total.
- Arabic (RTL) / English / Turkish supported through the existing font + shaping
  pipeline; Arabic names render without corruption.
- CSV exports keep amounts numeric with a separate currency column and
  formula-injection protection.
- Exports are read-only (only write is one `report.exported` audit) with a
  `MAX_EXPORT_ROWS` (5000) guard returning a controlled 413.

---

## 6. Unified notification center (final product decision)

The user sees **one** notification experience: one bell, one combined unread
badge, one chronological center. Category icons identify each item: operational
→ truck, accounting → finance/wallet, users → user, system → warning, broadcast
→ megaphone. Accounting integrity warnings use the accounting (finance) icon and
keep their warning-priority chip.

### Internal two-store architecture (kept separate on purpose)
There are two **internal** persisted stores that are NOT merged or synchronized:

1. Legacy `AppNotification` store (operational / shipment / driver / chat / user
   / system events).
2. Accounting `accountingNotifications` store (Accounting Phase 9).

`src/lib/unifiedNotifications.ts` is a **pure presentation adapter** only: it
normalizes both shapes into one view-model with source-qualified keys
(`legacy:{id}` / `accounting:{id}`), maps category icons, localizes titles,
sorts newest-first, and computes the combined unread count. No record is copied
between stores; there is no synchronization job; one underlying notification
maps to exactly one displayed item. Legacy actions use the legacy APIs;
accounting actions use the Phase 9 accounting APIs. Approval action-items are
never dismissable. A failure of one source does not hide the other.

### Automatic evaluation
Accounting notifications are derived from authoritative Phase 1–8 state by a pure
evaluator and reconciled (dedup + auto-resolve). After a committed accounting
workflow action (submit / approve / reject, reopen request/decision, financial
reopen, financial close, invoice issue/cancel, customer + vendor payment
create/reverse) a fire-and-forget `fireNotifRefresh()` re-derives notifications.
It runs only after the accounting transaction commits, never rolls it back, and
reuses reconciliation so no duplicate notifications are created.

### Reminder behavior
One active notification record per condition. `lastRemindedAt` is stored; a
**read**, still-active reminder resurfaces (back to unread) only after the
configured `reminderRepeatIntervalDays` elapses. A user-**dismissed** reminder is
never resurfaced while the condition holds. Resolving the underlying condition
resolves the notification and stops future reminders. External delivery (email /
SMS / WhatsApp / push) is permanently disabled — in-app only.

---

## 7. Validation performed at closure

Commands:

```
npm run lint                        # tsc --noEmit
npx vitest run                      # full test suite
npm run build                       # client + dist/server.cjs
npm run check-firebase-readiness    # persistence/rules posture
```

Results:

- **TypeScript / lint:** clean (exit 0).
- **Full test suite:** 181 files / 2787 tests passing.
- **Production build:** succeeds (client bundle + `dist/server.cjs`); only the
  pre-existing large-chunk advisory.
- **Firebase readiness:** no blocking problems; deny-all rules posture intact;
  only the pre-existing env-only warning (SESSION_SECRET not set in this
  environment — the server refuses to start without it, by design).

---

## 8. Known non-blocking limitations

1. **Interactive live-backend smoke not run in the CI sandbox.** This
   environment has no Application Default Credentials and the tracked
   `firebase-applet-config.json` forces Firestore mode (a memory-mode boot is
   not available here), so the running server cannot be started for an
   interactive HTTP walkthrough. No product defect was found. The HTTP surface
   is instead covered by extensive source-scan **wiring tests** (route
   registration, permission gating, read-only guarantees, audit calls,
   no-mutation invariants, currency separation, dedup, unified adapter) and
   **behavioral tests** over the pure calculators that back every route. Run the
   live-smoke checklist in §9 in an ADC-enabled staging environment before
   production sign-off.
2. **Reopened cost statements report cost/profit as pending.** The model keeps
   no separate approved-amount snapshot, so a statement not currently
   `final_closed` reports vendor cost / Official Profit as pending (never a
   guessed or draft-edited amount). Documented behavior, not a defect.
3. **Report PDF row cap (5000).** Very large filtered exports return a controlled
   413; narrow the date range or filters.
4. **Large client chunk** advisory in the production build (pre-existing).

---

## 9. Live-smoke checklist (run in an ADC-enabled environment)

Boot: provide `SESSION_SECRET`, Application Default Credentials (or run in the
deployed environment), and log in as an accounting admin. Use order numbers in
the `MAR-2026-XXXX` format only.

1. Create order → cost statement → multiple cost items in ≥2 currencies →
   confirm currency-separated totals, no FX, no mixed-currency grand total.
2. Submit → approve through the captured chain → confirm the snapshot is
   immutable and audits are written.
3. Request reopen → approve and reject paths → confirm history preserved.
4. Issue invoice → confirm Official Profit = issued invoice − approved cost.
5. Record partial then full customer payment → reverse one → confirm balances +
   audit; confirm no currency conversion.
6. Record partial + full vendor payments → reverse → confirm payable balances.
7. Financial close blocked (incomplete) → shows reasons → complete → close →
   confirm read-only lock; reports still available.
8. Financial reopen → authorized-role-only → confirm locked records need the
   approved reopen workflow.
9. Open reports; generate each PDF (EN / AR / TR) → confirm order numbers,
   amounts, currencies, statuses, dates; no clipping or mixed-currency totals.
10. Notifications: perform the workflow actions above and confirm accounting
    notifications appear automatically in the single main bell (no manual
    evaluate call), with correct category icons, combined unread badge, correct
    deep links, non-dismissable approvals, and permission isolation (an
    operational user with no accounting access sees no accounting data or
    counts). Confirm resolving a condition resolves its notification and no
    duplicates are created.

---

## 10. Guardrails (must remain true)

No bank integration, no automatic payment, no automatic approval, no automatic
Financial Close, no FX conversion, no mixed-currency total, reports remain
read-only, notifications never mutate accounting records, and the two internal
notification stores remain separate (presentation-only unification).
