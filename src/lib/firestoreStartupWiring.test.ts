import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Wiring/contract tests for the missing-ADC startup crash fix: source-scan
 * server.ts so the actual call sites (which src/lib/*.test.ts can't reach
 * directly, since importing server.ts requires live Firebase config) can't
 * silently regress back to the unguarded/unconditional-memory-fallback
 * behavior. The pure decision logic itself is unit-tested directly in
 * googleAuthRejectionGuard.test.ts / firestoreStartupPolicy.test.ts /
 * bodyParserErrorResponse.test.ts.
 */
const ROOT = join(__dirname, "..", "..");
const SERVER = readFileSync(join(ROOT, "server.ts"), "utf-8");
const region = (needle: string, length: number): string => {
  const at = SERVER.indexOf(needle);
  expect(at, `server.ts must contain: ${needle}`).toBeGreaterThan(-1);
  return SERVER.slice(at, at + length);
};

describe("googleAuthRejectionGuard wiring", () => {
  it("is imported and installed before any Firebase Admin SDK call", () => {
    expect(SERVER).toContain('import { installGoogleAuthRejectionGuard } from "./src/lib/googleAuthRejectionGuard"');
    const guardCallIndex = SERVER.indexOf("installGoogleAuthRejectionGuard();");
    expect(guardCallIndex).toBeGreaterThan(-1);
    const adminInitIndex = SERVER.indexOf("initializeAdminApp({");
    expect(adminInitIndex).toBeGreaterThan(-1);
    expect(guardCallIndex).toBeLessThan(adminInitIndex);
  });
});

describe("startFirestoreConnection / attemptFirestoreConnect wiring", () => {
  it("attemptFirestoreConnect still tries/catches the live connection check and records the last error", () => {
    const region1 = region("async function attemptFirestoreConnect", 1200);
    expect(region1).toContain("try {");
    expect(region1).toContain("await withTimeout(db.collection(\"test\").doc(\"connection\").get()");
    expect(region1).toContain("} catch (err: any) {");
    expect(region1).toContain("lastFirestoreConnectError = err instanceof Error ? err.message : String(err);");
  });

  it("startFirestoreConnection routes exhausted retries through resolveFirestoreStartupFailureOutcome, not an unconditional memory-fallback", () => {
    const region1 = region("async function startFirestoreConnection", 1600);
    expect(region1).toContain(
      "resolveFirestoreStartupFailureOutcome(STRICT_PERSISTENCE, lastFirestoreConnectError)"
    );
    expect(region1).toContain('if (outcome.mode === "fatal-exit")');
    expect(region1).toContain("process.exit(1)");
    // The non-strict / recovered path must still exist unchanged: memory
    // fallback + background recovery, exactly as before this fix.
    expect(region1).toContain("useMemoryFallback = true;");
    expect(region1).toContain("scheduleFirestoreRecovery(30_000);");
  });

  it("import for the startup policy decision is present", () => {
    expect(SERVER).toContain(
      'import { resolveFirestoreStartupFailureOutcome } from "./src/lib/firestoreStartupPolicy"'
    );
  });
});

describe("body-parser JSON error formatting wiring (Payload Too Large -> JSON)", () => {
  it("is registered as error-handling middleware immediately after express.json()", () => {
    const jsonMiddlewareIndex = SERVER.indexOf('app.use(express.json({ limit: "20mb" }));');
    expect(jsonMiddlewareIndex).toBeGreaterThan(-1);
    const errorMiddlewareIndex = SERVER.indexOf("resolveBodyParserErrorResponse(err)");
    expect(errorMiddlewareIndex).toBeGreaterThan(jsonMiddlewareIndex);
    // Must be within a reasonable distance (i.e. the very next middleware),
    // not accidentally wired in far away from where body-parser errors are
    // actually thrown.
    expect(errorMiddlewareIndex - jsonMiddlewareIndex).toBeLessThan(1200);
  });

  it("falls through to next(err) for anything that isn't a body-parser error, instead of swallowing it", () => {
    const region1 = region("resolveBodyParserErrorResponse(err)", 400);
    expect(region1).toContain("next(err);");
  });
});
