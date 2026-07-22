/**
 * adcRejectionGuardFixture.ts
 *
 * Standalone harness (not an npm script — invoked directly by
 * src/lib/googleAuthRejectionGuard.integration.test.ts via `tsx`) that
 * reproduces the exact real-world crash this fix addresses, using the real
 * firebase-admin/@google-cloud/firestore/google-auth-library stack — not a
 * mock. This is the empirical proof that installGoogleAuthRejectionGuard
 * actually prevents the process crash for the known duplicate ADC
 * rejection, while still crashing (as before) on a genuinely unrelated bug.
 *
 * Controlled by env var FIXTURE_MODE:
 *   "adc-duplicate"  — mimics attemptFirestoreConnect exactly (a real
 *                       Firestore .get() call with ADC forced unavailable,
 *                       wrapped in the same withTimeout/Promise.race
 *                       pattern used in server.ts), then waits for the
 *                       known detached internal rejection to surface.
 *   "unrelated-bug"  — emits a genuinely unrelated unhandled rejection, to
 *                       prove the guard still treats real bugs as fatal
 *                       (does not become a blanket swallow-everything
 *                       handler).
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS to point at a nonexistent file
 * (set by the test) so ADC resolution deterministically fails without any
 * network access.
 */
import { installGoogleAuthRejectionGuard } from "../src/lib/googleAuthRejectionGuard";

installGoogleAuthRejectionGuard();

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutErrorMsg: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutErrorMsg)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

async function runAdcDuplicateScenario(): Promise<void> {
  const { initializeApp, applicationDefault } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");

  const app = initializeApp({ credential: applicationDefault(), projectId: "smoke-test-fixture-project" });
  const db = getFirestore(app);

  console.log("FIXTURE: about to attempt Firestore connection check with ADC forced unavailable...");
  try {
    await withTimeout(db.collection("test").doc("connection").get(), 3000, "Firestore connection check timed out");
    console.log("FIXTURE: unexpectedly connected");
  } catch (err) {
    console.log("FIXTURE: caught in try/catch as expected:", err instanceof Error ? err.message : String(err));
  }

  console.log("FIXTURE: waiting to give the known detached internal rejection a chance to surface...");
  await new Promise((resolve) => setTimeout(resolve, 5000));
  console.log("FIXTURE: survived to the end without crashing.");
  process.exit(0);
}

async function runUnrelatedBugScenario(): Promise<void> {
  console.log("FIXTURE: emitting a genuinely unrelated unhandled rejection...");
  // Deliberately not awaited/caught anywhere — simulates a real application
  // bug producing an unhandled rejection, unrelated to Google Auth/Firestore.
  Promise.reject(new Error("totally unrelated application bug — should still be fatal"));
  await new Promise((resolve) => setTimeout(resolve, 3000));
  // Should never reach here — the guard's fatal path calls process.exit(1)
  // before this timer fires.
  console.log("FIXTURE: ERROR — reached the end without being treated as fatal.");
  process.exit(99);
}

const mode = process.env.FIXTURE_MODE;
if (mode === "adc-duplicate") {
  runAdcDuplicateScenario();
} else if (mode === "unrelated-bug") {
  runUnrelatedBugScenario();
} else {
  console.error(`FIXTURE: unknown FIXTURE_MODE: ${mode}`);
  process.exit(2);
}
