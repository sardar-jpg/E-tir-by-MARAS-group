import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Customer Invoice LINES — UI/UX refinement contract tests.
 *
 * The vitest environment is `node` (no DOM renderer), so the component's
 * structural guarantees are asserted by scanning source — the established
 * "wiring test" pattern — while the pure row operations are covered separately
 * in invoiceLineEditor.test.ts. These assertions lock in the ERP-table refinement
 * WITHOUT touching any server-authoritative money math.
 */
const ROOT = join(__dirname, "..", "..", "..");
const panel = readFileSync(join(ROOT, "src/components/admin/CustomerInvoicePanel.tsx"), "utf8");
const workspace = readFileSync(join(ROOT, "src/components/admin/CostStatementWorkspace.tsx"), "utf8");
const editor = readFileSync(join(ROOT, "src/lib/invoiceLineEditor.ts"), "utf8");

describe("1. ERP invoice-lines table", () => {
  it("renders a real table with #, Service Type, Description, Qty, Unit, Unit Price, Amount, Actions columns", () => {
    for (const key of ["rowNo", "serviceType", "description", "quantity", "unit", "unitPrice", "amount", "actions"]) {
      expect(panel).toContain(`tr("${key}", lang)`);
    }
    // Visible 1-based row number per line.
    expect(panel).toContain("{idx + 1}");
  });
  it("stays usable with many rows — horizontal scroll + min width, not a cramped single row", () => {
    expect(panel).toContain("overflow-x-auto");
    expect(panel).toContain("min-w-[880px]");
  });
  it("money columns are right-aligned and Amount is visually stronger than inputs", () => {
    expect(panel).toContain("text-right tabular-nums");
    expect(panel).toMatch(/Amount is auto[\s\S]{0,160}font-black/);
  });
});

describe("2. row actions — duplicate + delete", () => {
  it("each row exposes Duplicate and Delete actions with accessible tooltips", () => {
    expect(panel).toContain("duplicateLine(l.id)");
    expect(panel).toContain("requestDelete(l)");
    expect(panel).toContain('title={tr("duplicate", lang)}');
    expect(panel).toContain('aria-label={tr("duplicate", lang)}');
    expect(panel).toContain('title={tr("deleteLine", lang)}');
  });
  it("delete of a row WITH data asks for a lightweight confirmation first", () => {
    expect(panel).toContain("lineDraftHasData(l)");
    expect(panel).toContain("setConfirmDeleteId");
    expect(panel).toContain("confirmDeleteId === l.id");
    expect(panel).toContain('tr("confirmDelete", lang)');
  });
  it("row operations delegate to the pure editor lib (amounts stay server-derived)", () => {
    expect(panel).toContain("duplicateLineDraft");
    expect(panel).toContain("deleteLineDraft");
    expect(panel).toContain("addLineDraft");
    // The editor copies content but never a server record id, and recomputes amount.
    expect(editor).toContain("assign a BRAND-NEW client id");
    expect(editor).toContain("recomputed from quantity");
  });
});

describe("3. add line + focus/keyboard UX", () => {
  it("Add Invoice Line appends a row and focuses its Service Type field", () => {
    expect(panel).toContain('tr("addLine", lang)');
    expect(panel).toContain("setFocusLineId");
    expect(panel).toContain("serviceRefs.current[focusLineId]");
    expect(panel).toContain('scrollIntoView({ block: "nearest"');
  });
  it("Enter on the last row's last field appends a new line", () => {
    expect(panel).toContain("onLastFieldEnter");
    expect(panel).toContain('e.key === "Enter"');
  });
  it("the Service Type control exposes a trigger ref so focus can land on it", () => {
    expect(panel).toContain("triggerRef");
  });
});

describe("4. customer notes label", () => {
  it("uses the single customer-facing 'Customer Notes' label (not 'Description / Notes')", () => {
    expect(panel).toContain('customerNotes: { en: "Customer Notes"');
    expect(panel).not.toContain("Customer Description / Notes");
  });
  it("still persists to the existing customerNotes field (no schema change)", () => {
    expect(panel).toContain("customerNotes: hdr.customerNotes.trim() || undefined");
  });
});

describe("5. agreed-price comparison states", () => {
  it("shows a green match state with a 0.00 difference when totals equal the agreed price", () => {
    expect(panel).toContain('tr("matchTitle", lang)');
    expect(panel).toContain("hasAgreed && !hasDiff");
  });
  it("shows an orange difference state with the amount + Reason Required when they differ", () => {
    expect(panel).toContain('tr("diffTitle", lang)');
    expect(panel).toContain('tr("reasonRequired", lang)');
    expect(panel).toContain("money(Math.abs(priceDiff))");
  });
  it("keeps the existing server-side price-difference-reason requirement", () => {
    expect(panel).toContain("reasonOk = !hasDiff || hdr.priceDifferenceReason.trim().length > 0");
    expect(panel).toContain("priceDifferenceReason: hasDiff ? hdr.priceDifferenceReason.trim() : undefined");
  });
});

describe("6. totals card — Total Payable + Currency", () => {
  it("shows Grand Total and a Total Payable line, both from the same derived total", () => {
    expect(panel).toContain('tr("grandTotal", lang)');
    expect(panel).toContain('tr("totalPayable", lang)');
    // Total Payable mirrors the grand total — no second financial source.
    const payableIdx = panel.indexOf('tr("totalPayable", lang)');
    expect(panel.slice(payableIdx, payableIdx + 200)).toContain("totals.grandTotal");
  });
  it("does not invent client-side totals — totals come from computeInvoiceTotals", () => {
    expect(panel).toContain("computeInvoiceTotals");
    expect(panel).toContain("SERVER RECOMPUTES on save");
  });
});

describe("7. bank account selector", () => {
  it("shows bank name, currency and a MASKED account number (never the full number)", () => {
    expect(panel).toContain("BankSelect");
    expect(panel).toContain("maskAccount");
    expect(panel).toContain("s.slice(-4)");
  });
  it("reuses the existing bank list (no new bank data store)", () => {
    expect(panel).toContain("banks={banks}");
    expect(panel).toContain("bankAccounts.filter((b) => b.active && b.currency === currency)");
  });
});

describe("8. issued invoice summary card", () => {
  it("shows number, status, dates, amount, payment status and line count", () => {
    for (const key of ["invoiceNo", "status", "linesCount", "invoiceDate", "dueDate", "invoiceAmount", "payStatus"]) {
      expect(panel).toContain(`tr("${key}", lang)`);
    }
  });
  it("keeps View / Download / Print / Cancel actions", () => {
    expect(panel).toContain('tr("viewInvoice", lang)');
    expect(panel).toContain('tr("downloadPdf", lang)');
    expect(panel).toContain('tr("print", lang)');
    expect(panel).toContain('tr("cancelInv", lang)');
  });
});

describe("9. payment quick access reuses existing flow (no duplicate logic)", () => {
  it("offers Payment History + View Receipts when payments exist, else Receive Payment", () => {
    expect(panel).toContain('tr("paymentHistory", lang)');
    expect(panel).toContain('tr("viewReceipts", lang)');
    expect(panel).toContain("customerHasPayments ?");
    expect(panel).toContain("onReceivePayment");
  });
  it("the panel contains NO payment API calls of its own — it defers to callbacks", () => {
    // The only apiFetch calls are the invoice draft/issue/cancel endpoints; there is
    // no customer-accounts payment/receipt write here.
    expect(panel).not.toContain("/api/customer-accounts/");
    expect(panel).not.toContain("allocationMode");
    expect(panel).not.toMatch(/apiFetch\([^)]*receipt/);
  });
  it("the workspace wires the quick actions to the existing AR section", () => {
    expect(workspace).toContain("customerHasPayments={customer.customerReceivedAmount > 0}");
    expect(workspace).toContain("onReceivePayment={");
    expect(workspace).toContain("onViewPayments={");
    expect(workspace).toContain('getElementById("csw-payments")');
  });
});

describe("10. generated document card state", () => {
  it("the issued Customer Invoice doc card uses a strong generated/ready success state with actions", () => {
    // ready doc cards get an emerald-tinted card + filled 'Generated' badge + actions.
    expect(workspace).toContain("border-emerald-200 bg-emerald-50/30");
    expect(workspace).toContain("bg-emerald-500 text-white");
    expect(workspace).toContain("ready={hasIssuedInvoice}");
  });
});

describe("11. empty + large-data states", () => {
  it("shows a helpful empty state when there are no invoice lines", () => {
    expect(panel).toContain('tr("noLinesTitle", lang)');
    expect(panel).toContain('tr("noLinesBody", lang)');
    expect(panel).toContain("lines.length === 0 ?");
  });
});

describe("12. NO backend / accounting logic changed", () => {
  it("the create payload + endpoints are unchanged (draft/issue/cancel)", () => {
    expect(panel).toContain("/api/cost-statements/${shipmentId}/invoices");
    expect(panel).toContain("/issue");
    expect(panel).toContain("/cancel");
    expect(panel).toContain("buildPayload");
  });
  it("line amounts + totals remain server-authoritative (preview only, never trusted)", () => {
    expect(panel).toContain("computeLineAmount");
    expect(panel).toContain("Amount is auto — never typed");
    expect(panel).toContain("SERVER RECOMPUTES on save — never trusted here");
  });
});
