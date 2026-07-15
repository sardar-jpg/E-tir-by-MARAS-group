import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Accounting Phase A — Single Shipment Reference Hardening (orphan-record
 * fix). A Cost Statement must never be created unless it is linked to a
 * real, existing shipment, and its shipmentNumber must always be the
 * shipment's own authoritative value — in every persistence mode, not
 * just when Firestore is reachable.
 *
 * Bug this guards against: POST /api/cost-statements/:shipmentId
 * previously only 404'd for a missing shipment when `!useMemoryFallback`
 * — under the memory fallback, a nonexistent shipmentId was silently
 * allowed through and CostStatement.shipmentNumber fell back to whatever
 * the client submitted, producing an orphan financial record carrying a
 * manually-invented shipment reference.
 *
 * This codebase has no Express/route integration-test harness anywhere
 * (no route is ever exercised by booting the server in a test) — every
 * other server.ts behavior this precise is instead proven either by
 * extracting the decision into a pure, unit-tested function (see
 * costStatementRegistryView.test.ts, adminAccess.test.ts, etc.) or, for
 * an invariant about the literal absence/presence of a code pattern, by
 * scanning the real shipped source (see the existing
 * noLegacyClientWording.test.ts precedent and this PR's own
 * noOrderNumberRegression.test.ts). The fix here removed the only
 * decision this route made — whether to accept a client-supplied
 * shipmentNumber — rather than replacing it with a new one, so there is
 * no pure function left to extract; this test instead pins down the
 * exact source shape of the fixed route, so a future edit can't silently
 * reintroduce either the persistence-mode-conditional 404 or the
 * client-supplied shipmentNumber fallback.
 */

const SERVER_TS_PATH = join(__dirname, "..", "..", "server.ts");

function extractCostStatementCreateRoute(): string {
  const source = readFileSync(SERVER_TS_PATH, "utf-8");
  const startMarker = 'app.post("/api/cost-statements/:shipmentId"';
  const start = source.indexOf(startMarker);
  if (start === -1) {
    throw new Error("POST /api/cost-statements/:shipmentId route not found in server.ts");
  }
  const endMarker = "// 14. Activity Logs";
  const end = source.indexOf(endMarker, start);
  if (end === -1) {
    throw new Error("Could not find the end of the POST /api/cost-statements/:shipmentId route");
  }
  return source.slice(start, end);
}

/**
 * Strips `//` and `/* *\/` comments before the negative ("must not
 * contain") checks below — this route's own explanatory comments
 * legitimately describe the old, now-fixed bug in prose (e.g. "previously
 * only 404'd when `!useMemoryFallback`"), which would otherwise make this
 * regression test fail on its own documentation. Only the executable code
 * shape matters for these checks; the positive ("must contain") checks
 * don't need this, since the real code contains those tokens either way.
 */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("POST /api/cost-statements/:shipmentId cannot create an orphan Cost Statement", () => {
  const routeSource = extractCostStatementCreateRoute();
  const executableSource = stripComments(routeSource);

  it("sanity check: the route block was actually found and is non-trivial", () => {
    expect(routeSource.length).toBeGreaterThan(200);
  });

  it("a Cost Statement cannot be created for a nonexistent shipment: the existence check always 404s", () => {
    expect(executableSource).toContain("if (!sDoc.exists()) {");
    expect(executableSource).toMatch(/if \(!sDoc\.exists\(\)\) \{\s*\n\s*return res\.status\(404\)/);
  });

  it("the existence check is identical in Firestore and memory-fallback mode: it never branches on useMemoryFallback", () => {
    // The old bug's exact shape must never reappear in actual code (this
    // sentence itself, and the route's own explanatory comments, may
    // legitimately still mention it in prose — see stripComments above).
    expect(executableSource).not.toContain("useMemoryFallback");
  });

  it("a submitted fake shipmentNumber is always ignored: the client payload is never read as a shipmentNumber fallback", () => {
    expect(executableSource).not.toContain("data.shipmentNumber");
  });

  it("the stored shipmentNumber always equals the real Shipment.shipmentNumber", () => {
    expect(executableSource).toContain("shipmentNumber: shipment.shipmentNumber");
  });

  it("legacy real shipments continue to work: the shipment record is read directly and unconditionally, with no optional/undefined branch", () => {
    expect(executableSource).toContain("const shipment = sDoc.data() as Shipment;");
    // No more optional-shipment ("sData") naming from the pre-fix version.
    expect(executableSource).not.toContain("sData");
  });

  // No separate "no order-number system in this route" check here: the
  // repository-wide noOrderNumberRegression.test.ts already scans every
  // shipped source file (including this route inside server.ts) and is
  // the single source of truth for that invariant — duplicating it here
  // would also be self-defeating, since asserting the literal banned
  // substring's absence would itself make this file contain that
  // substring, which that repo-wide scan would then flag.
});
