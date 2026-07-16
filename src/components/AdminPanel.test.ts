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
 *
 * React state updates are not synchronous, so a guard that only reads/sets
 * `isCreatingShipment` (state) can be bypassed by two submit events
 * dispatched in the same tick, before either has re-rendered — both would
 * read the same stale `false`. isCreatingShipmentRef is the authoritative,
 * synchronous lock; isCreatingShipment (state) exists only to drive the
 * disabled/loading UI. The tests below check both the real source (that
 * the ref guard is actually wired up ahead of the state and of any async
 * work) and, separately, the concurrency reasoning itself via a faithful
 * inline reproduction of the two guard strategies.
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
const CLOSE_MODAL = extractFunctionBody(SOURCE, "const closeCreateShipmentModal = () => {");

describe("handleCreateShipment is guarded by a synchronous ref, not state alone", () => {
  it("declares a dedicated isCreatingShipmentRef, separate from the isCreatingShipment UI-feedback state", () => {
    expect(SOURCE).toMatch(/const isCreatingShipmentRef = React\.useRef\(false\)/);
    expect(SOURCE).toMatch(/const \[isCreatingShipment, setIsCreatingShipment\] = useState\(false\)/);
  });

  it("checks the ref (not the state) at the very start, before the payload/apiFetch logic", () => {
    const guardIndex = HANDLER.indexOf("if (isCreatingShipmentRef.current) return;");
    const payloadIndex = HANDLER.indexOf("const payload =");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(payloadIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(payloadIndex);
    // The old state-only guard must be gone, not just supplemented.
    expect(HANDLER).not.toContain("if (isCreatingShipment) return;");
  });

  it("sets the ref synchronously to true immediately after the guard, before setting state or any async work", () => {
    const guardIndex = HANDLER.indexOf("if (isCreatingShipmentRef.current) return;");
    const refSetIndex = HANDLER.indexOf("isCreatingShipmentRef.current = true;");
    const stateSetIndex = HANDLER.indexOf("setIsCreatingShipment(true);");
    const fetchIndex = HANDLER.indexOf('apiFetch("/api/shipments"');
    expect(refSetIndex).toBeGreaterThan(guardIndex);
    expect(stateSetIndex).toBeGreaterThan(refSetIndex);
    expect(fetchIndex).toBeGreaterThan(stateSetIndex);
  });

  it("still sets isCreatingShipment state (for UI feedback), not only the ref", () => {
    expect(HANDLER).toContain("setIsCreatingShipment(true);");
  });

  it("resets both the ref and the state in a finally block, not only on the success path", () => {
    expect(HANDLER).toMatch(
      /}\s*finally\s*{\s*isCreatingShipmentRef\.current = false;\s*setIsCreatingShipment\(false\);\s*}/
    );
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
  const submitButtonMatch = /type="submit"\s*\n\s*disabled=\{isCreatingShipment\}/.exec(SOURCE);

  it("disables the submit button while a creation request is active", () => {
    expect(submitButtonMatch).not.toBeNull();
  });

  it("shows a distinct, translated loading label while active, and the normal label otherwise", () => {
    expect(submitButtonMatch).not.toBeNull();
    const buttonIndex = submitButtonMatch!.index;
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

describe("closeCreateShipmentModal (Cancel + the header X) ignores close attempts while creating", () => {
  it("returns immediately (no-op) if a creation request is in progress, using the same authoritative ref", () => {
    // The guard must be the first statement in the function body, before any state reset.
    const guardIndex = CLOSE_MODAL.indexOf("if (isCreatingShipmentRef.current) return;");
    const resetIndex = CLOSE_MODAL.indexOf("setIsCreateOpen(false);");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(resetIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(resetIndex);
  });

  it("the header close (X) button is disabled while creating and still calls closeCreateShipmentModal", () => {
    expect(SOURCE).toMatch(/onClick=\{closeCreateShipmentModal\}\s*\n\s*disabled=\{isCreatingShipment\}/);
  });

  it("the Cancel button is disabled while creating and still calls closeCreateShipmentModal", () => {
    expect(SOURCE).toMatch(/type="button"\s*\n\s*onClick=\{closeCreateShipmentModal\}\s*\n\s*disabled=\{isCreatingShipment\}/);
  });
});

describe("Concurrency semantics: why a ref (not state) is required", () => {
  // Not the real component (no render harness available — see file header).
  // Faithfully reproduces the two competing guard strategies to prove the
  // reasoning behind the fix: a synchronous ref-based guard, driven the
  // same way isCreatingShipmentRef is (check-then-set on a plain mutable
  // value before any await), versus a React-state-based guard, where the
  // updated value is only observable after a render (modeled here as
  // "not visible until a microtask has elapsed").

  it("a synchronous ref-based guard lets only one of two same-tick submissions proceed", () => {
    const ref = { current: false };
    let proceedCount = 0;

    function submitWithRefGuard() {
      if (ref.current) return;
      ref.current = true;
      proceedCount++;
    }

    // Two submit events dispatched in the same tick, exactly like a
    // double-click or double Enter before any state/render has occurred.
    submitWithRefGuard();
    submitWithRefGuard();

    expect(proceedCount).toBe(1);
  });

  it("a React-state-style guard (update not observable until after a render) incorrectly lets both proceed", () => {
    // Models React state: the "committed" value only updates after a
    // render/microtask boundary, so a second synchronous call in the same
    // tick still reads the pre-update value — this is exactly the bug
    // this PR fixes, kept here so the regression can't silently return.
    let committedState = false;
    let pendingState = false;
    let proceedCount = 0;

    function submitWithStateOnlyGuard() {
      if (committedState) return;
      pendingState = true; // setIsCreatingShipment(true) — not yet committed
      proceedCount++;
    }

    submitWithStateOnlyGuard();
    submitWithStateOnlyGuard();
    // Only now, after both synchronous calls, does the "render" commit.
    committedState = pendingState;

    expect(proceedCount).toBe(2);
    expect(committedState).toBe(true);
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

// fix/shipment-update-concurrency
//
// PUT /api/shipments/:id now requires an expectedRevision and can 409 with
// SHIPMENT_VERSION_CONFLICT. AdminPanel must: always send the revision it
// last read, never close the edit modal or reset the unsaved form on a
// conflict, never auto-apply the newer server record, and never retry
// automatically — only offer an explicit reload.

const EDIT_HANDLER = extractFunctionBody(SOURCE, "const handleEditShipment = async (e: React.FormEvent) => {");
const RELOAD_FROM_CONFLICT = extractFunctionBody(SOURCE, "const handleReloadEditingShipmentFromConflict = () => {");

describe("handleEditShipment sends the expected revision it opened the form with", () => {
  it("computes expectedRevision from editingShipment.revision, defaulting legacy (revision-less) shipments to 1", () => {
    expect(EDIT_HANDLER).toContain("const expectedRevision = editingShipment.revision ?? 1;");
  });

  it("includes expectedRevision in the PUT body alongside the rest of the edited fields", () => {
    expect(EDIT_HANDLER).toMatch(/body:\s*JSON\.stringify\(\{\s*\.\.\.editingShipment,\s*expectedRevision\s*\}\)/);
  });

  it("never sends a client-invented expectedRevision — the value always comes from state, not a literal/incremented constant", () => {
    expect(EDIT_HANDLER).not.toMatch(/expectedRevision:\s*editingShipment\.revision\s*\+\s*1/);
  });
});

describe("handleEditShipment on a 409 conflict: no close, no reset, no auto-overwrite, no retry", () => {
  it("branches on res.status === 409 before falling through to the generic failure toast", () => {
    const conflictIndex = EDIT_HANDLER.indexOf("if (res.status === 409) {");
    const genericFailureIndex = EDIT_HANDLER.indexOf('let msg = "Failed to update shipment.";');
    expect(conflictIndex).toBeGreaterThan(-1);
    expect(genericFailureIndex).toBeGreaterThan(conflictIndex);
  });

  it("does not close the edit modal or reset the form inside the 409 branch", () => {
    const conflictStart = EDIT_HANDLER.indexOf("if (res.status === 409) {");
    const conflictEnd = EDIT_HANDLER.indexOf("return;", conflictStart);
    expect(conflictEnd).toBeGreaterThan(conflictStart);
    const conflictBlock = EDIT_HANDLER.slice(conflictStart, conflictEnd);
    expect(conflictBlock).not.toContain("setIsEditOpen(false)");
    expect(conflictBlock).not.toContain("setEditingShipment(null)");
    expect(conflictBlock).not.toContain("setEditingShipment(conflictBody");
  });

  it("stores the conflict (currentRevision + current shipment) in state instead of overwriting the form automatically", () => {
    const conflictStart = EDIT_HANDLER.indexOf("if (res.status === 409) {");
    const conflictBlock = EDIT_HANDLER.slice(conflictStart, EDIT_HANDLER.indexOf("return;", conflictStart));
    expect(conflictBlock).toContain("setEditConflict({");
    expect(conflictBlock).toContain("currentRevision:");
    expect(conflictBlock).toContain("shipment: conflictBody?.shipment");
  });

  it("does not call handleEditShipment (or apiFetch) again from within itself — no automatic retry", () => {
    expect(EDIT_HANDLER).not.toContain("handleEditShipment(");
    const apiFetchCalls = (EDIT_HANDLER.match(/apiFetch\(/g) || []).length;
    expect(apiFetchCalls).toBe(1);
  });

  it("only closes the modal and resets the form on the successful (res.ok) path", () => {
    const okStart = EDIT_HANDLER.indexOf("if (res.ok) {");
    const okEnd = EDIT_HANDLER.indexOf("if (res.status === 409)", okStart);
    expect(okStart).toBeGreaterThan(-1);
    expect(okEnd).toBeGreaterThan(okStart);
    const okBlock = EDIT_HANDLER.slice(okStart, okEnd);
    expect(okBlock).toContain("setIsEditOpen(false)");
    expect(okBlock).toContain("setEditingShipment(null)");
    expect(okBlock).toContain("setEditConflict(null)");
  });

  it("preserves the existing update-success and generic-failure/network-error behavior", () => {
    expect(EDIT_HANDLER).toContain("t('updateSuccess')");
    expect(EDIT_HANDLER).toContain("fetchData()");
    expect(EDIT_HANDLER).toContain("Could not reach the server");
  });
});

describe("Conflict banner: translated message and an explicit, safe reload — never automatic", () => {
  it("shows the conflict banner only when editConflict is set", () => {
    expect(SOURCE).toContain("{editConflict && (");
  });

  it("the conflict message is translated in English, Turkish, and Arabic", () => {
    const bannerIndex = SOURCE.indexOf("{editConflict && (");
    const bannerEnd = SOURCE.indexOf(")}", bannerIndex);
    const banner = SOURCE.slice(bannerIndex, bannerEnd);
    expect(banner).toContain("was saved by someone else");
    expect(banner).toContain("başka biri tarafından kaydedildi");
    expect(banner).toContain("حفظ هذه الشحنة من قبل شخص آخر");
    expect(banner).toContain("Reload Latest Data");
    expect(banner).toContain("En Son Verileri Yükle");
    expect(banner).toContain("تحميل أحدث البيانات");
  });

  it("the reload action only replaces the form when the conflict actually carried a shipment, and never re-submits", () => {
    expect(RELOAD_FROM_CONFLICT).toContain("if (editConflict?.shipment) {");
    expect(RELOAD_FROM_CONFLICT).toContain("setEditingShipment(editConflict.shipment);");
    expect(RELOAD_FROM_CONFLICT).toContain("setEditConflict(null);");
    expect(RELOAD_FROM_CONFLICT).not.toContain("apiFetch(");
    expect(RELOAD_FROM_CONFLICT).not.toContain("handleEditShipment(");
  });

  it("the reload button is disabled if the conflict response carried no shipment to reload", () => {
    expect(SOURCE).toMatch(/onClick=\{handleReloadEditingShipmentFromConflict\}\s*\n\s*disabled=\{!editConflict\.shipment\}/);
  });
});

describe("Opening/closing the edit modal always clears any stale conflict banner", () => {
  it("both edit-open call sites reset editConflict before opening the modal", () => {
    const occurrences = (SOURCE.match(/setEditingShipment\(s\);\s*\n\s*setEditConflict\(null\);\s*\n\s*setIsEditOpen\(true\);/g) || []).length;
    expect(occurrences).toBe(2);
  });

  it("every place the modal closes (success, header X, Discard) also clears editConflict", () => {
    expect(SOURCE).toMatch(/setIsEditOpen\(false\);\s*\n\s*setEditingShipment\(null\);\s*\n\s*setEditConflict\(null\);/);
    // Success path, header X, and Discard — all three close the modal and
    // must all clear a stale conflict banner along with it.
    const occurrences = (SOURCE.match(/setEditingShipment\(null\);\s*\n\s*setEditConflict\(null\);/g) || []).length;
    expect(occurrences).toBe(3);
  });
});
