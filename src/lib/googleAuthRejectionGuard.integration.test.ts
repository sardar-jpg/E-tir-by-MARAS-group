import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

/**
 * End-to-end proof, using the REAL firebase-admin/@google-cloud/firestore/
 * google-auth-library stack (not a mock), that installGoogleAuthRejectionGuard
 * actually fixes the confirmed production crash: with Application Default
 * Credentials unavailable, @google-cloud/firestore/google-gax internally
 * spawns a second, detached credential-resolution promise that our own code
 * never receives a reference to, so no amount of try/catch around our own
 * `.get()` call can catch it. Before this fix, that duplicate crashed the
 * whole process via Node's default unhandled-rejection-is-fatal behavior —
 * see scripts/adcRejectionGuardFixture.ts for the harness this spawns.
 *
 * This is intentionally a real subprocess test, not a mocked unit test: the
 * bug lives entirely inside library internals no unit test could observe.
 */
const ROOT = join(__dirname, "..", "..");
const TSX_BIN = join(ROOT, "node_modules", ".bin", "tsx");
const FIXTURE = join(ROOT, "scripts", "adcRejectionGuardFixture.ts");

function runFixture(mode: string) {
  return spawnSync(TSX_BIN, [FIXTURE], {
    cwd: ROOT,
    env: {
      ...process.env,
      FIXTURE_MODE: mode,
      // Deterministically force ADC resolution to fail without any network
      // access, regardless of what's actually configured on the machine
      // running this test: google-auth-library throws immediately when an
      // explicitly-set GOOGLE_APPLICATION_CREDENTIALS path doesn't exist,
      // rather than falling back to the metadata server or well-known file.
      GOOGLE_APPLICATION_CREDENTIALS: "/nonexistent/does-not-exist.json",
    },
    encoding: "utf-8",
    timeout: 20_000,
  });
}

describe("googleAuthRejectionGuard — real end-to-end crash reproduction", () => {
  it(
    "does NOT crash the process for the real duplicate ADC rejection (missing ADC + STRICT_PERSISTENCE-equivalent connection check)",
    () => {
      const result = runFixture("adc-duplicate");

      // Before the fix, this exact scenario terminated with Node's raw
      // uncaught-exception crash format and a non-zero/killed exit.
      expect(result.status, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
      expect(result.signal).toBeNull();

      expect(result.stdout).toContain("FIXTURE: caught in try/catch as expected");
      expect(result.stdout).toContain("FIXTURE: survived to the end without crashing.");

      // The guard must have actually intercepted the known duplicate
      // rejection (proves the fix engaged, not merely that nothing fired).
      expect(result.stderr).toContain("Ignoring a duplicate Application Default Credentials rejection");

      // Must never silently disappear without a trace either.
      expect(result.stderr).not.toContain("UnhandledPromiseRejectionWarning");
      expect(result.stdout + result.stderr).not.toContain("Node.js v");
    },
    25_000
  );

  it(
    "still treats a genuinely unrelated unhandled rejection as fatal (the guard is not a blanket swallow-everything handler)",
    () => {
      const result = runFixture("unrelated-bug");

      expect(result.stdout).toContain("FIXTURE: emitting a genuinely unrelated unhandled rejection");
      // Our own controlled fatal path must have fired (exit code 1 from
      // installGoogleAuthRejectionGuard's default `exit`), not the
      // fixture's own "reached the end" fallback (exit code 99).
      expect(result.status).toBe(1);
      expect(result.stdout).not.toContain("ERROR — reached the end without being treated as fatal");
      expect(result.stderr).toContain("[FATAL] Unhandled promise rejection");
      expect(result.stderr).toContain("totally unrelated application bug");
    },
    10_000
  );
});
