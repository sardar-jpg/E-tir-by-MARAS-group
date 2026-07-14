import { describe, it, expect } from "vitest";
import { isMissingIndexError } from "./firestoreErrors";

describe("isMissingIndexError — Phase 2A follow-up (blocking-issue fix)", () => {
  it("matches the real Firebase Admin SDK missing-index error shape", () => {
    const err = {
      code: 9,
      message:
        "9 FAILED_PRECONDITION: The query requires an index. You can create it here: https://console.firebase.google.com/project/x/firestore/indexes?create_composite=...",
    };
    expect(isMissingIndexError(err)).toBe(true);
  });

  it("matches by message text alone even if `code` is missing or a different shape", () => {
    expect(isMissingIndexError({ message: "The query requires an index." })).toBe(true);
    expect(isMissingIndexError({ code: "failed-precondition", message: "index is currently building, try again later" })).toBe(true);
  });

  it("does NOT match a generic connectivity/timeout error — must not be treated as an index problem", () => {
    expect(isMissingIndexError(new Error("Firestore paginated query timed out"))).toBe(false);
    expect(isMissingIndexError({ code: 14, message: "UNAVAILABLE: the service is currently unavailable" })).toBe(false);
    expect(isMissingIndexError({ code: 7, message: "PERMISSION_DENIED: missing or insufficient permissions" })).toBe(false);
  });

  it("does NOT match a FAILED_PRECONDITION error for an unrelated reason", () => {
    // FAILED_PRECONDITION is also used for other Firestore preconditions
    // (e.g. a transaction precondition) — only the ones that actually
    // mention an index should be treated as an index problem.
    expect(isMissingIndexError({ code: 9, message: "FAILED_PRECONDITION: document has been modified" })).toBe(false);
  });

  it("is safe against non-error / malformed inputs — never throws, always a clean boolean", () => {
    expect(isMissingIndexError(null)).toBe(false);
    expect(isMissingIndexError(undefined)).toBe(false);
    expect(isMissingIndexError("just a string")).toBe(false);
    expect(isMissingIndexError(42)).toBe(false);
    expect(isMissingIndexError({})).toBe(false);
  });
});
