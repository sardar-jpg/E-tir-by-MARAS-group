import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * feature/client-staff-management-ui, 20/20
 *
 * "No Tracking Account text remains in English, Arabic, or Turkish."
 * Scans the actual shipped source files (not just the files this PR
 * happened to touch) so a future change can't silently reintroduce this
 * wording without a test failing here. Client Owner / Client Staff are
 * the only two account types; there has never been a "Tracking Account"
 * concept in the backend, only in old UI copy.
 */

const BANNED_STRINGS = [
  "Tracking Account",
  "Takip Hesabı",
  "حساب تتبع",
];

const SCAN_ROOT = join(__dirname, "..", "components");

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (/\.(tsx|ts)$/.test(entry) && !entry.endsWith(".test.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("no legacy 'Tracking Account' wording remains in any shipped component", () => {
  const files = collectSourceFiles(SCAN_ROOT);

  it("scans a non-trivial number of component files (sanity check the scan itself isn't silently finding nothing)", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const bannedString of BANNED_STRINGS) {
    it(`contains no occurrence of "${bannedString}"`, () => {
      const offenders = files.filter((file) => readFileSync(file, "utf-8").includes(bannedString));
      expect(offenders).toEqual([]);
    });
  }
});
