import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join } from "path";

/**
 * Accounting Phase A — Single Shipment Reference Hardening.
 *
 * Final confirmed business decision: MAR-YYYY-#### `shipmentNumber` is the
 * ONE business reference used everywhere; no separate "orderNumber" (or
 * eTIR-###### style) system was adopted. An earlier version of this PR
 * introduced exactly such a system and was corrected before merge. Scans
 * the actual shipped source (server.ts plus everything under src/, not
 * just the files this correction happened to touch) so a future change
 * can't silently reintroduce a second business-reference system without a
 * test failing here — mirrors the existing
 * noLegacyClientWording.test.ts precedent.
 */

const BANNED_STRINGS = [
  "orderNumber",
  "orderNumbering",
  "allocateNextOrderSequence",
  "getOrderSequenceCounterMemory",
  "orderSequenceCounter",
  "backfill-order-numbers",
  "counters/orders",
  "ORDER_NUMBER_BASE",
  "ORDER_NUMBER_PAD_LENGTH",
  "ORDER_NUMBER_PREFIX",
];

const REPO_ROOT = join(__dirname, "..", "..");
const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist", "ios", "android", "coverage"]);
const THIS_FILE = join(__dirname, "noOrderNumberRegression.test.ts");

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (/\.(tsx?|jsx?)$/.test(entry) && fullPath !== THIS_FILE) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("no separate 'orderNumber' business-reference system remains anywhere in the repository", () => {
  const files = collectSourceFiles(REPO_ROOT);

  it("scans a non-trivial number of source files (sanity check the scan itself isn't silently finding nothing)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("server.ts is included in the scan", () => {
    expect(files.some((f) => f.endsWith("server.ts"))).toBe(true);
  });

  for (const bannedString of BANNED_STRINGS) {
    it(`contains no occurrence of "${bannedString}"`, () => {
      const offenders = files.filter((file) => readFileSync(file, "utf-8").includes(bannedString));
      expect(offenders).toEqual([]);
    });
  }

  it("the dedicated order-numbering module files no longer exist", () => {
    expect(existsSync(join(__dirname, "orderNumbering.ts"))).toBe(false);
    expect(existsSync(join(__dirname, "orderNumbering.test.ts"))).toBe(false);
  });

  it("Shipment's only business-reference field is shipmentNumber (MAR-YYYY-####), not a second one", () => {
    const typesFile = readFileSync(join(REPO_ROOT, "src", "types.ts"), "utf-8");
    expect(typesFile).toContain("shipmentNumber: string;");
  });
});
