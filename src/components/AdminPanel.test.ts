import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * fix/prevent-duplicate-shipment-creation
 *
 * AdminPanel.tsx (9,900+ lines, real Firestore-backed fetches, several
 * lazily-loaded siblings) has no component-render test harness — the
 * project's vitest setup runs in a plain "node" environment with no
 * jsdom/testing-library dependency (see LoginPage.test.ts for the same
 * situation and the same source-scan approach used there). These are
 * source-level regression checks pinning the duplicate-submission guard
 * added to handleCreateShipment: a double-click, repeated Enter, or
 * repeated submit event must never fire more than one POST /api/shipments.
 */

const SOURCE = readFileSync(join(__dirname, "AdminPanel.tsx"), "utf-8");

function extractFunctionBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `expected to find "${signature}" in AdminPanel.tsx`).toBeGreaterThan(-1);
  // Walk brace depth from the function's opening `{` to find its matching close.
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error("unbalanced braces while extracting handleCreateShipment");
}

const HANDLER = extractFunctionBody(SOURCE, "const handleCreateShipment = async (e: React.FormEvent) => {");

describe("handleCreateShipment has a dedicated in-flight guard", () => {
  it("declares a dedicated isCreatingShipment state, not a reused/shared flag", () => {
    expect(SOURCE).toMatch(/const \[isCreatingShipment, setIsCreatingShipment\] = useState\(false\)/);
  });

  it("returns immediately at the very start if a creation request is already in progress", () => {
    // Must appear before the payload/apiFetch logic, i.e. very early in the handler body.
    const guardIndex = HANDLER.indexOf("if (isCreatingShipment) return;");
    const payloadIndex = HANDLER.indexOf("const payload =");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(payloadIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(payloadIndex);
  });

  it("sets the in-flight state before the first asynchronous operation (the POST call)", () => {
    const setTrueIndex = HANDLER.indexOf("setIsCreatingShipment(true);");
    const fetchIndex = HANDLER.indexOf('apiFetch("/api/shipments"');
    expect(setTrueIndex).toBeGreaterThan(-1);
    expect(fetchIndex).toBeGreaterThan(-1);
    expect(setTrueIndex).toBeLessThan(fetchIndex);
  });

  it("resets the in-flight state in a finally block, not only on the success path", () => {
    expect(HANDLER).toMatch(/}\s*finally\s*{\s*setIsCreatingShipment\(false\);\s*}/);
  });

  it("still posts to /api/shipments with POST, and the request body/endpoint are unchanged", () => {
    expect(HANDLER).toContain('apiFetch("/api/shipments"');
    expect(HANDLER).toContain('method: "POST"');
  });

  it("does not close or reset the create-shipment modal outside the successful (res.ok) branch", () => {
    // setIsCreateOpen(false)/form-reset calls must only occur inside the `if (res.ok)` block.
    const okBlockStart = HANDLER.indexOf("if (res.ok) {");
    expect(okBlockStart).toBeGreaterThan(-1);
    const okBlockEnd = HANDLER.indexOf("} else {", okBlockStart);
    expect(okBlockEnd).toBeGreaterThan(okBlockStart);
    const beforeOkBlock = HANDLER.slice(0, okBlockStart);
    const afterOkBlock = HANDLER.slice(okBlockEnd);
    expect(beforeOkBlock).not.toContain("setIsCreateOpen(false)");
    expect(afterOkBlock).not.toContain("setIsCreateOpen(false)");
    const okBlock = HANDLER.slice(okBlockStart, okBlockEnd);
    expect(okBlock).toContain("setIsCreateOpen(false)");
  });

  it("preserves the existing failure/error toasts on the error and catch paths (retry-friendly, no silent failure)", () => {
    expect(HANDLER).toContain("Failed to create shipment.");
    expect(HANDLER).toContain("Could not reach the server");
  });
});

describe("Create Shipment submit button reflects the in-flight state", () => {
  it("disables the submit button while a creation request is active", () => {
    expect(SOURCE).toMatch(/type="submit"\s*\n\s*disabled=\{isCreatingShipment\}/);
  });

  it("shows a distinct, translated loading label while active, and the normal label otherwise", () => {
    const buttonIndex = SOURCE.indexOf("disabled={isCreatingShipment}");
    expect(buttonIndex).toBeGreaterThan(-1);
    const buttonEnd = SOURCE.indexOf("</button>", buttonIndex);
    expect(buttonEnd).toBeGreaterThan(buttonIndex);
    const buttonRegion = SOURCE.slice(buttonIndex, buttonEnd);
    expect(buttonRegion).toContain("isCreatingShipment");
    expect(buttonRegion).toContain("Creating...");
    expect(buttonRegion).toContain("Oluşturuluyor...");
    expect(buttonRegion).toContain("جاري الإنشاء...");
    expect(buttonRegion).toContain("t('save')");
  });
});

describe("Scope: no unrelated shipment-number or backend behavior touched", () => {
  // A second business-reference system is already guarded repo-wide by
  // src/lib/noOrderNumberRegression.test.ts — not duplicated here.

  it("handleCreateShipment's own payload-shaping logic (Sea/Air city derivation) is untouched", () => {
    expect(HANDLER).toContain("newShipmentData.freightType === \"land\"");
    expect(HANDLER).toContain("portOfLoading");
    expect(HANDLER).toContain("airportOfDeparture");
  });
});
