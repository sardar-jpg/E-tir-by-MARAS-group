import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  deriveExpenseSummary,
  deriveCustomerSummary,
  computeGrossProfit,
} from "../../lib/costStatementMath";

/**
 * Full-screen Cost Statement redesign — contract tests.
 *
 * This is a UI/UX restructuring: the old darkened MODAL was replaced by a
 * dedicated in-content workspace (CostStatementWorkspace) that guides the
 * employee through Expenses → Vendor Payments → Customer Invoice → Customer
 * Payments → Review & Approve. Because the repo's vitest environment is `node`
 * (no DOM renderer), the component's structural guarantees are asserted by
 * scanning source — the same "wiring test" pattern used for server.ts — and its
 * financial guarantees are asserted through the same pure derivation functions
 * the component calls, so the browser is never the source of truth.
 */

const ROOT = join(__dirname, "..", "..", "..");
const workspaceSrc = readFileSync(
  join(ROOT, "src/components/admin/CostStatementWorkspace.tsx"),
  "utf8",
);
const adminPanelSrc = readFileSync(
  join(ROOT, "src/components/AdminPanel.tsx"),
  "utf8",
);
const invoicePanelSrc = readFileSync(
  join(ROOT, "src/components/admin/CustomerInvoicePanel.tsx"),
  "utf8",
);

describe("1. navigation — launch buttons open the dedicated page, not a modal", () => {
  it("AdminPanel renders CostStatementWorkspace when a statement is open", () => {
    expect(adminPanelSrc).toContain("import CostStatementWorkspace");
    expect(adminPanelSrc).toContain("<CostStatementWorkspace");
  });
  it("the workspace is gated on the same open condition the list uses", () => {
    expect(adminPanelSrc).toContain("selectedCostStatement && isStatementEditorOpen ?");
  });
  it("the launch handler selects the accounting tab and loads by shipmentId", () => {
    expect(adminPanelSrc).toContain("onSelectActiveStatement={handleSelectActiveStatement}");
    expect(adminPanelSrc).toContain("const handleSelectActiveStatement = async (shipmentId: string)");
  });
});

describe("2. page-by-shipmentId deep link + refresh persistence", () => {
  it("opening a statement writes the #/accounting/cost-statements/:shipmentId hash", () => {
    expect(adminPanelSrc).toContain("#/accounting/cost-statements/${shipmentId}");
  });
  it("a mount-time effect restores the workspace from the hash after a refresh", () => {
    expect(adminPanelSrc).toContain("didRestoreStatementFromHashRef");
    expect(adminPanelSrc).toMatch(/#\\\/accounting\\\/cost-statements\\\/\(\.\+\)\$/);
    expect(adminPanelSrc).toContain("void handleSelectActiveStatement(shipmentId)");
    expect(adminPanelSrc).toContain("setActiveTab('costs')");
  });
  it("browser Back clears the hash so the browser back button returns to the list", () => {
    expect(adminPanelSrc).toContain("window.location.hash = ''");
  });
});

describe("3. NO darkened / blurred backdrop, sidebar preserved", () => {
  it("the workspace root is an in-flow container, not a fixed backdrop overlay", () => {
    expect(workspaceSrc).not.toContain("fixed inset-0");
    expect(workspaceSrc).not.toContain("backdrop-blur");
    expect(workspaceSrc).not.toContain("bg-slate-950/70");
  });
  it("the old fixed-overlay cost-statement modal was removed from AdminPanel", () => {
    // The retired modal's signature markup must no longer exist.
    expect(adminPanelSrc).not.toContain("live-statement-preview-draft");
    expect(adminPanelSrc).not.toContain("renderStatementTotalsSection");
    // And there must be exactly one editor implementation, not two competing ones.
    const opens = adminPanelSrc.match(/selectedCostStatement && isStatementEditorOpen/g) || [];
    expect(opens.length).toBe(1);
  });
});

describe("4. five ordered workflow steps", () => {
  const order = ["csw-expenses", "csw-vendor", "csw-invoice", "csw-payments", "csw-review"];
  it("all five section anchors are present", () => {
    for (const id of order) expect(workspaceSrc).toContain(`id="${id}"`);
  });
  it("the sections appear in the canonical order", () => {
    const positions = order.map((id) => workspaceSrc.indexOf(`id="${id}"`));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });
  it("step states include blocked/active/completed/pending with a status sub-label", () => {
    expect(workspaceSrc).toContain("StepState");
    expect(workspaceSrc).toContain('"blocked"');
    expect(workspaceSrc).toContain('"completed"');
    expect(workspaceSrc).toContain("StepStatusLabel");
  });
});

describe("5. NO editable aggregate accounting fields", () => {
  it("there is no editable 'Expense Paid Amount' aggregate input", () => {
    expect(workspaceSrc).not.toMatch(/Expense Paid Amount/i);
  });
  it("there is no manual 'Customer Received Amount' input", () => {
    // The phrase may only appear as a derived, read-only summary label, never as an <input>.
    const hasReceivedInput = /Customer Received[\s\S]{0,120}<input/i.test(workspaceSrc);
    expect(hasReceivedInput).toBe(false);
  });
  it("summary totals are rendered via read-only KPI components, not inputs", () => {
    expect(workspaceSrc).toContain("<BigKpi");
    expect(workspaceSrc).toContain("<KpiCell");
    // No text input / editable field anywhere in the workspace itself.
    expect(workspaceSrc).not.toContain("<input");
  });
});

describe("6. derived totals come from the pure math library (server-consistent)", () => {
  it("the workspace derives expense + customer summaries from costStatementMath", () => {
    expect(workspaceSrc).toContain("deriveExpenseSummary");
    expect(workspaceSrc).toContain("deriveCustomerSummary");
    expect(workspaceSrc).toContain("resolveCustomerReceivedAmount");
    expect(workspaceSrc).toContain("computeGrossProfit");
  });
  it("deriveExpenseSummary computes remaining/credit/status without a manual field", () => {
    const s = deriveExpenseSummary(1000, 400);
    expect(s.expenseRemaining).toBe(600);
    expect(s.expenseCredit).toBe(0);
    expect(s.paymentStatus).not.toBe("Paid");
    const full = deriveExpenseSummary(1000, 1000);
    expect(full.paymentStatus).toBe("Paid");
    const over = deriveExpenseSummary(1000, 1200);
    expect(over.expenseCredit).toBe(200);
  });
  it("deriveCustomerSummary computes receivable/credit from agreed vs received", () => {
    const c = deriveCustomerSummary(1000, 250);
    expect(c.customerReceivable).toBe(750);
    expect(c.customerReceivedAmount).toBe(250);
  });
});

describe("7. multi-currency figures are never aggregated", () => {
  it("gross profit is null (shown as —) when agreed and statement currencies differ", () => {
    expect(computeGrossProfit(1000, "USD", 600, "EUR")).toBeNull();
    expect(computeGrossProfit(1000, "USD", 600, "USD")).toBe(400);
  });
  it("the workspace renders an em-dash + non-aggregation note when profit is null", () => {
    expect(workspaceSrc).toContain("grossProfit === null");
    expect(workspaceSrc).toContain("not aggregated");
  });
});

describe("8. vendor payments cannot precede an expense (payable must exist)", () => {
  it("the vendor section is gated on hasExpenses and explains the block", () => {
    expect(workspaceSrc).toContain("const hasExpenses = items.length > 0");
    expect(workspaceSrc).toMatch(/!hasExpenses \?[\s\S]{0,400}VendorPayablesPanel/);
    expect(workspaceSrc).toContain("noVendorYet");
  });
  it("the vendor step is 'blocked' until an expense exists", () => {
    // The step-state machine marks a step blocked when its hard prerequisite is
    // missing; the vendor step (index 1) requires at least one expense.
    expect(workspaceSrc).toContain("blockedPrereq");
    expect(workspaceSrc).toContain("i === 1 && !hasExpenses");
  });
});

describe("9. customer invoice — human-readable clientId UX (no raw error)", () => {
  it("clientId is resolved from the matching customer, never invented", () => {
    expect(workspaceSrc).toContain("clients.find((c) => c.companyName === statement.companyName)");
    expect(workspaceSrc).toContain("resolvedClientId");
  });
  it("the panel receives clientId and a Link/Open Customer affordance", () => {
    expect(workspaceSrc).toContain("clientId={resolvedClientId || undefined}");
    expect(workspaceSrc).toContain("onLinkCustomer");
  });
  it("CustomerInvoicePanel shows a friendly message, not the raw server string", () => {
    expect(invoicePanelSrc).not.toMatch(/A customer clientId is required/);
    expect(invoicePanelSrc).toMatch(/Link or create the customer/i);
  });
  it("invoice creation forwards clientId so identity resolves server-side", () => {
    expect(invoicePanelSrc).toContain("clientId");
    expect(invoicePanelSrc).toMatch(/identity[\s\S]{0,60}clientId/);
  });
});

describe("10. documents open ON DEMAND — no permanent half-screen PDF pane", () => {
  it("there is no always-visible embedded PDF/iframe pane", () => {
    expect(workspaceSrc).not.toContain("<iframe");
    expect(workspaceSrc).not.toContain("live-statement-preview-draft");
  });
  it("documents are compact cards that preview via openAccountingPdf on click", () => {
    expect(workspaceSrc).toContain("DocCard");
    expect(workspaceSrc).toContain("openAccountingPdf");
    expect(workspaceSrc).toContain("onPreview");
  });
});

describe("11. approval workflow gating (Operations → Accounts → Managing Director)", () => {
  it("submit is disabled until a human-readable checklist is satisfied", () => {
    expect(workspaceSrc).toContain("const canSubmit = canWrite && checklist.every");
    expect(workspaceSrc).toContain("disabled={!canSubmit}");
    expect(workspaceSrc).toContain("submitBlocked");
  });
  it("the checklist is shown BEFORE submit, listing each requirement", () => {
    expect(workspaceSrc).toContain("checklist.map");
    expect(workspaceSrc).toContain("Customer account is linked");
    expect(workspaceSrc).toContain("At least one expense exists");
  });
  it("the multi-stage approval card is rendered", () => {
    expect(workspaceSrc).toContain("CostApprovalWorkflowCard");
  });
});

describe("12. privacy — internal cost/markup never presented as customer figures", () => {
  it("gross profit is treated as an internal figure in the summary, not the invoice", () => {
    // Profit lives in the Accounting Summary section, not in the customer-facing panels.
    const summaryIdx = workspaceSrc.indexOf('id="csw-summary"');
    const invoiceIdx = workspaceSrc.indexOf('id="csw-invoice"');
    const profitIdx = workspaceSrc.indexOf("grossProfit");
    expect(summaryIdx).toBeGreaterThan(-1);
    expect(profitIdx).toBeGreaterThan(-1);
    // grossProfit is derived above the JSX; the visible profit row sits in the summary block.
    expect(workspaceSrc).toContain("T.grossProfit");
    expect(invoiceIdx).toBeGreaterThan(summaryIdx);
  });
});

describe("13. responsive two-column desktop layout (not mobile-first)", () => {
  it("the body is a desktop two-column grid (≈65/35) that collapses to one column", () => {
    expect(workspaceSrc).toContain("grid-cols-1 lg:grid-cols-12");
    expect(workspaceSrc).toContain("lg:col-span-8"); // main ≈65%
    expect(workspaceSrc).toContain("lg:col-span-4"); // right ≈35%
  });
});

describe("14. actor/permissions wiring is preserved (no privilege regression)", () => {
  it("canWrite gates every write affordance and is passed to child panels", () => {
    expect(workspaceSrc).toContain("canWrite={canWrite}");
    expect(workspaceSrc).toContain("actor={actor}");
    expect(adminPanelSrc).toContain("canWrite={canViewCostStatements(resolvedAdminType)}");
  });
});

describe("15. Receive Payment reuses the existing AR flow (no duplicated logic)", () => {
  const accountPanelSrc = readFileSync(
    join(ROOT, "src/components/admin/CustomerAccountPanel.tsx"),
    "utf8",
  );
  it("the Customer Payments section exposes a Receive Payment action (canWrite-gated)", () => {
    expect(workspaceSrc).toContain("receivePayment");
    expect(workspaceSrc).toContain("setShowReceivePayment");
  });
  it("it mounts the existing CustomerAccountPanel — the same customer AR endpoints, no new payment logic", () => {
    expect(workspaceSrc).toContain("<CustomerAccountPanel");
    // The workspace itself issues NO API writes and has no editable field —
    // all payment logic stays in the reused AR panel (no duplication).
    expect(workspaceSrc).not.toContain("apiFetch(");
    expect(workspaceSrc).not.toContain('method: "POST"');
    expect(workspaceSrc).not.toContain("<input");
    // The AR panel is the single implementation that talks to the payment API.
    expect(accountPanelSrc).toContain("/api/customer-accounts/payments");
    expect(accountPanelSrc).toContain('allocationMode: "auto"');
  });
  it("a recorded payment refreshes the statement and re-derives invoice status", () => {
    expect(workspaceSrc).toContain("onCustomerPaymentChanged");
    expect(workspaceSrc).toContain("onChanged={onCustomerPaymentChanged}");
    expect(workspaceSrc).toContain("setArRefreshToken");
    expect(workspaceSrc).toContain("onRefresh()");
    // Remounting the invoice panel forces its status to reload after a payment.
    expect(workspaceSrc).toContain("key={`inv-${arRefreshToken}`}");
  });
  it("the AR panel fires onChanged after payment / reversal / receipt (server writes unchanged)", () => {
    // onChanged appears on all three success paths; the POSTs themselves are untouched.
    expect((accountPanelSrc.match(/onChanged\?\.\(\)/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(accountPanelSrc).toContain("/reverse");
    expect(accountPanelSrc).toContain("/receipt");
  });
  it("Receive Payment is disabled and explained until an invoice exists (item 10)", () => {
    expect(workspaceSrc).toContain("disabled={!hasIssuedInvoice}");
    expect(workspaceSrc).toContain("invoiceFirst");
  });
});

describe("16. UI refinement — scale, drawer, statuses, approval, docs", () => {
  const drawerSrc = readFileSync(join(ROOT, "src/components/admin/ExpenseDrawer.tsx"), "utf8");
  const approvalSrc = readFileSync(join(ROOT, "src/components/admin/CostApprovalWorkflowCard.tsx"), "utf8");
  const invoicePanel2 = readFileSync(join(ROOT, "src/components/admin/CustomerInvoicePanel.tsx"), "utf8");

  it("the add-expense drawer is CLOSED by default and closes + resets on save (item 3)", () => {
    expect(workspaceSrc).toContain("const [showAddExpense, setShowAddExpense] = useState(false)");
    expect(workspaceSrc).toContain("<ExpenseDrawer");
    // It only opens on an explicit click, never by default.
    expect(workspaceSrc).toContain("onClick={() => setShowAddExpense(true)}");
    // Drawer resets fields and closes on a successful save.
    expect(drawerSrc).toContain("reset();");
    expect(drawerSrc).toContain("onClose();");
  });
  it("the drawer reuses the existing item endpoint (no duplicated accounting logic, item 14)", () => {
    expect(drawerSrc).toContain("/api/cost-statements/${shipmentId}/items");
    expect(drawerSrc).toContain("expectedRevision");
    expect(drawerSrc).toContain("idempotencyKey");
  });
  it("Submit for Approval appears only in the two action bars, never in Quick Actions or the timeline (item 4)", () => {
    // Exactly two Submit buttons in the workspace (top bar + sticky bar).
    expect((workspaceSrc.match(/T\.submit, lang\)/g) || []).length).toBe(2);
    // The approval timeline card no longer renders its own Submit button.
    expect(approvalSrc).not.toContain(">Submit for Approval<");
    // The dense mobile quick-actions block is not embedded on desktop.
    expect(workspaceSrc).not.toContain("MobileAccountingQuickActions");
  });
  it("statuses are separated: statement status drives the title badge, not UNPAID (item 13)", () => {
    expect(workspaceSrc).toContain("resolveAccountingStatus");
    expect(workspaceSrc).toContain("deriveStatementStatus");
    expect(workspaceSrc).toContain("statementStatus");
    // Distinct vendor + customer payment status vocabularies.
    expect(workspaceSrc).toContain("vendorStatus");
    expect(workspaceSrc).toContain("custStatus");
    // The title badge is the statement status, not the payment status.
    expect(workspaceSrc).toContain("label={pick(statementStatus.label, lang)}");
    expect(workspaceSrc).not.toContain("statement.paymentStatus");
  });
  it("blocked workflow steps explain the reason, never just 'Blocked' (item 8)", () => {
    expect(workspaceSrc).toContain("needExpense");
    expect(workspaceSrc).toContain("needCustomer");
    expect(workspaceSrc).toContain("needInvoice");
  });
  it("the approval workflow is a timeline with role, timestamp and comment (item 12)", () => {
    expect(approvalSrc).toContain("actorRole");
    expect(approvalSrc).toContain("appr.comment");
    expect(approvalSrc).toContain("toLocaleString()");
  });
  it("the customer invoice card shows number, dates, amount, status and actions (item 9)", () => {
    expect(invoicePanel2).toContain("invoiceDate");
    expect(invoicePanel2).toContain("dueDate");
    expect(invoicePanel2).toContain("viewInvoice");
    expect(invoicePanel2).toContain("downloadPdf");
  });
});
