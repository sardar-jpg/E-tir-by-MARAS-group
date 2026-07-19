import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Increment 4 — permission MANAGEMENT lives ONLY in Settings → Team
 * (mandatory tests 20 & 22). Operational accounting screens read the saved
 * permissions but never contain permission-editing controls.
 */
const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf-8");

describe("permission management is confined to Settings → Team", () => {
  it("the editor is rendered by the Team section (Settings), Super-Admin gated", () => {
    const team = read("src/components/admin/sections/AdminTeamSection.tsx");
    expect(team).toContain("import EmployeePermissionsEditor");
    expect(team).toContain("<EmployeePermissionsEditor");
  });
  it("the editor manages permissions via the dedicated admin endpoint only", () => {
    const editor = read("src/components/admin/EmployeePermissionsEditor.tsx");
    expect(editor).toContain("/api/admins/${employeeId}/permissions");
    expect(editor).toContain('method: "PUT"');
    // Labels come from the central registry (never raw keys shown to the user).
    expect(editor).toContain("ACCOUNTING_PERMISSION_GROUPS");
    expect(editor).toContain("perm.label[lang]");
  });

  it("NO accounting/operational component contains permission-editing controls", () => {
    // Scan every admin accounting component + the mobile quick actions.
    const dirs = ["src/components/admin", "src/components/admin/mobile", "src/components/admin/sections"];
    const offenders: string[] = [];
    for (const dir of dirs) {
      for (const file of readdirSync(join(ROOT, dir))) {
        if (!file.endsWith(".tsx")) continue;
        if (file === "EmployeePermissionsEditor.tsx" || file === "AdminTeamSection.tsx") continue; // the Settings editor + its host
        const src = read(join(dir, file));
        const looksAccounting = /invoice|vendor|payment|receipt|cost|bank|template|companyprofile|accounting/i.test(file);
        if (!looksAccounting) continue;
        if (src.includes("/permissions") || src.includes("ACCOUNTING_PERMISSION_GROUPS") || src.includes("EmployeePermissionsEditor")) {
          offenders.push(join(dir, file));
        }
      }
    }
    expect(offenders, `accounting screens must not manage permissions: ${offenders.join(", ")}`).toEqual([]);
  });
});
