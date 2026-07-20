import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ExpenseDrawer data-entry-safety contract. The repo's vitest env is `node`
 * (no DOM renderer), so the drawer's structural guarantees are asserted by
 * scanning source (the same wiring-test pattern used across the codebase),
 * and its master-data reuse is asserted against the shared constant + the
 * existing vendor type.
 */
const ROOT = join(__dirname, "..", "..", "..");
const drawer = readFileSync(join(ROOT, "src/components/admin/ExpenseDrawer.tsx"), "utf8");
const workspace = readFileSync(join(ROOT, "src/components/admin/CostStatementWorkspace.tsx"), "utf8");
const adminPanel = readFileSync(join(ROOT, "src/components/AdminPanel.tsx"), "utf8");
const expenseTypesSrc = readFileSync(join(ROOT, "src/lib/expenseTypes.ts"), "utf8");
const itemBuilder = readFileSync(join(ROOT, "src/lib/costStatementItem.ts"), "utf8");

describe("1. Vendor / Supplier is a searchable selector backed by the Vendors module", () => {
  it("takes the existing vendors list as a prop (no new vendor store)", () => {
    expect(drawer).toContain("vendors: Vendor[]");
    expect(drawer).toContain('import type { Language, Vendor }');
    // Threaded from the master-data source: AdminPanel → workspace → drawer.
    expect(adminPanel).toContain("vendors={vendors}");
    expect(workspace).toContain("vendors={vendors}");
    expect(workspace).toContain("vendors: Vendor[]");
  });
  it("is a searchable combobox (search input + filter), not a free-text field", () => {
    expect(drawer).toContain("vendorQuery");
    expect(drawer).toContain("filteredVendors");
    // Search covers name, code (id), category (serviceType) and phone.
    expect(drawer).toContain("v.companyName");
    expect(drawer).toContain("v.id");
    expect(drawer).toContain("v.serviceType");
    expect(drawer).toContain("v.phone");
  });
  it("shows a clear empty state when no vendor exists (no inline creation)", () => {
    expect(drawer).toContain("Vendor not found. Add the vendor from the Vendors section first.");
    // The drawer makes EXACTLY ONE network call — the existing item endpoint —
    // so there is no inline vendor creation or any other write.
    expect((drawer.match(/apiFetch\(/g) || []).length).toBe(1);
    expect(drawer).toContain("apiFetch(`/api/cost-statements/${shipmentId}/items`");
  });
  it("only the selected vendor's canonical name is saved — arbitrary text cannot be submitted", () => {
    // Save uses selectedVendor.companyName (from the list), never the typed query.
    expect(drawer).toContain("supplierName: selectedVendor.companyName");
    // Validity + save both require an actually selected vendor object.
    expect(drawer).toContain("!!selectedVendor");
    expect(drawer).toContain("if (!valid || !selectedVendor) return;");
    // The typed query is never used as the saved supplier value.
    expect(drawer).not.toContain("supplierName: vendorQuery");
  });
});

describe("2. Expense Type is a controlled dropdown from the shared source of truth", () => {
  it("renders a controlled dropdown populated from EXPENSE_TYPES (no duplicated inline list, no free-text type field)", () => {
    expect(drawer).toContain("import { EXPENSE_TYPES");
    expect(drawer).toContain("EXPENSE_TYPES.map");
    // The type is chosen from a dropdown (typeOpen), never typed except via Other.
    expect(drawer).toContain("setTypeOpen");
  });
  it("the shared constant is the single source of truth", () => {
    expect(expenseTypesSrc).toContain("export const EXPENSE_TYPES");
    expect(expenseTypesSrc).toContain('export const EXPENSE_TYPE_OTHER = "Other"');
  });
});

describe("3. Other behaviour", () => {
  it("selecting Other reveals a required Specify Expense Type field", () => {
    expect(drawer).toContain("isOther ?");
    expect(drawer).toContain("Specify Expense Type");
    expect(drawer).toContain("customType");
  });
  it("switching away from Other clears the previously typed custom value", () => {
    expect(drawer).toContain("if (!isOtherExpenseType(v)) setCustomType(\"\")");
  });
  it("the custom value is trimmed and used as the stored costType", () => {
    expect(drawer).toContain("isOther ? customType.trim() : expenseType");
    expect(drawer).toContain("costType: resolvedType");
  });
});

describe("4 & 5. Description and Invoice/Reference are optional free text, trimmed", () => {
  it("description uses the friendly placeholder and is trimmed on submit", () => {
    expect(drawer).toContain("Add expense details or notes");
    expect(drawer).toContain("description.trim()");
  });
  it("reference is labelled clearly and trimmed", () => {
    expect(drawer).toContain("Invoice / Reference Number");
    expect(drawer).toContain("reference.trim()");
  });
});

describe("6. Validation gates Save until required fields are valid, with inline messages", () => {
  it("validity requires type + vendor + amount>0 + (custom when Other)", () => {
    expect(drawer).toContain("const valid =");
    expect(drawer).toContain("!!expenseType");
    expect(drawer).toContain("(!isOther || customType.trim().length > 0)");
    expect(drawer).toContain("amountNum > 0");
    expect(drawer).toContain("disabled={busy || !valid}");
  });
  it("shows inline validation messages, not only backend errors", () => {
    expect(drawer).toContain("InlineErr");
    expect(drawer).toContain("Select a vendor from the list.");
    expect(drawer).toContain("Specify the custom expense type.");
  });
});

describe("7 & 8. Existing contracts + historical records preserved", () => {
  it("reuses the existing item endpoint + idempotency/revision contract (no backend change)", () => {
    expect(drawer).toContain("/api/cost-statements/${shipmentId}/items");
    expect(drawer).toContain("idempotencyKey");
    expect(drawer).toContain("expectedRevision");
  });
  it("the server item builder is untouched — costType stays a free string, so legacy values persist", () => {
    // costType is stored as a trimmed free string server-side (defaulting to
    // "other"), which is exactly why old free-text categories keep working.
    expect(itemBuilder).toContain("costType: typeof input.costType === \"string\"");
  });
  it("the expenses table renders each row's stored costType/supplierName verbatim (historical-safe)", () => {
    expect(workspace).toContain("{it.costType || \"—\"}");
    expect(workspace).toContain("{it.supplierName || \"—\"}");
  });
});
