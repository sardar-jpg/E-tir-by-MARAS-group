import { describe, it, expect } from "vitest";
import { resolveFirestoreStartupFailureOutcome } from "./firestoreStartupPolicy";

describe("resolveFirestoreStartupFailureOutcome", () => {
  it("fails startup with a controlled fatal-exit outcome when STRICT_PERSISTENCE is on (the default)", () => {
    const outcome = resolveFirestoreStartupFailureOutcome(true, "Could not load the default credentials.");
    expect(outcome.mode).toBe("fatal-exit");
    expect(outcome.message).toContain("STRICT_PERSISTENCE is on");
    expect(outcome.message).toContain("refusing to start");
    expect(outcome.message).toContain("Could not load the default credentials.");
  });

  it("does not mention memory-fallback as an actual outcome when STRICT_PERSISTENCE is on", () => {
    const outcome = resolveFirestoreStartupFailureOutcome(true, "ECONNREFUSED");
    expect(outcome.mode).toBe("fatal-exit");
  });

  it("falls back to memory, unchanged, when STRICT_PERSISTENCE is explicitly off", () => {
    const outcome = resolveFirestoreStartupFailureOutcome(false, "Could not load the default credentials.");
    expect(outcome.mode).toBe("memory-fallback");
    expect(outcome.message).toContain("STRICT_PERSISTENCE is off");
    expect(outcome.message).toContain("ALL DATA WILL BE LOST ON RESTART");
    expect(outcome.message).toContain("Could not load the default credentials.");
  });

  it("always includes the last connect error verbatim so operators can debug the actual cause", () => {
    const uniqueError = "7 PERMISSION_DENIED: Missing or insufficient permissions. UNIQUE-MARKER-42";
    expect(resolveFirestoreStartupFailureOutcome(true, uniqueError).message).toContain(uniqueError);
    expect(resolveFirestoreStartupFailureOutcome(false, uniqueError).message).toContain(uniqueError);
  });
});
