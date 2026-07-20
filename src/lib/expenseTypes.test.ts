import { describe, it, expect } from "vitest";
import { EXPENSE_TYPES, EXPENSE_TYPE_OTHER, isOtherExpenseType, isKnownExpenseType } from "./expenseTypes";

describe("expenseTypes — controlled source of truth for cost line categories", () => {
  it("includes the supported standard categories and an Other sentinel", () => {
    const values = EXPENSE_TYPES.map((t) => t.value);
    for (const v of ["Freight", "Land Freight", "Sea Freight", "Air Freight", "Customs Clearance", "Customs Duty",
      "Port Charges", "Border Fees", "Loading", "Unloading", "Storage", "Demurrage", "Detention", "Handling",
      "Documentation", "Inspection", "Insurance", "Driver Allowance", "Fuel", "Toll Fees", "Local Transportation",
      "Agency Fee", "Bank Charges", "Other"]) {
      expect(values).toContain(v);
    }
    expect(EXPENSE_TYPE_OTHER).toBe("Other");
  });
  it("every option carries en/ar/tr labels", () => {
    for (const t of EXPENSE_TYPES) {
      expect(typeof t.label.en).toBe("string");
      expect(typeof t.label.ar).toBe("string");
      expect(typeof t.label.tr).toBe("string");
      expect(t.label.en.length).toBeGreaterThan(0);
    }
  });
  it("isOtherExpenseType / isKnownExpenseType behave as guards", () => {
    expect(isOtherExpenseType("Other")).toBe(true);
    expect(isOtherExpenseType("Freight")).toBe(false);
    expect(isKnownExpenseType("Customs Clearance")).toBe(true);
    // A legacy free-text value is NOT in the controlled list — historical records
    // still store/display it, but the UI never offers it as a selectable option.
    expect(isKnownExpenseType("Some Legacy Free Text")).toBe(false);
  });
});
