/**
 * googleAuthRejectionGuard.ts
 *
 * Fixes a confirmed production-risk crash: with Application Default
 * Credentials (ADC) completely unavailable (no file, no metadata server —
 * e.g. local dev before `gcloud auth application-default login`, or a
 * misconfigured/detached runtime identity), the underlying
 * `@google-cloud/firestore` / `google-gax` / `google-auth-library` stack
 * issues MORE THAN ONE independent internal `GoogleAuth.getClient()` /
 * credential-resolution attempt per logical Firestore call (confirmed by
 * direct reproduction — even a single isolated `.get()` call spawns a
 * second, entirely internal credential-resolution promise, and pre-resolving
 * credentials ourselves beforehand does not prevent it either).
 *
 * Our own explicit call (`db.collection(...).get()`, wrapped by
 * `withTimeout`) is properly caught by attemptFirestoreConnect's try/catch
 * in server.ts — that is the ONE promise our code holds a reference to. The
 * duplicate is created and rejected entirely inside the library's internals;
 * no promise reference for it is ever surfaced to application code, so it
 * cannot be `.catch()`-ed at any call site no matter how the awaited chain is
 * restructured. Node's default `--unhandled-rejections=throw` behavior
 * (default since Node 15) then terminates the process the moment that
 * detached promise settles — even though the "real", awaited version of the
 * exact same failure was already caught, logged, and handled gracefully
 * moments earlier.
 *
 * This module is a narrow, signature-matched safety net for exactly that
 * known, already-otherwise-handled duplicate — never a general
 * unhandled-rejection swallower. Anything that does not match the signature
 * below is treated as a genuine, unexpected bug and still crashes the
 * process (installGoogleAuthRejectionGuard calls the injected `exit`
 * function), preserving Node's default "a real unhandled rejection is
 * fatal" guarantee for everything else.
 */

const ADC_ERROR_MESSAGE_PATTERN =
  /could not load the default credentials|does not exist, or it is not a file|unable to detect a project id|failed to obtain access token|reauthentication is required|invalid_grant/i;

const ADC_ERROR_STACK_PATTERN = /google-auth-library|google-gax|GoogleAuth|GrpcClient/;

/**
 * True only if `reason` looks like the known duplicate ADC-resolution
 * rejection described above: an Error whose message matches a known
 * credential-resolution failure phrase AND whose stack implicates the
 * Google Cloud auth/gRPC client internals. Both conditions are required so
 * this can never accidentally match an unrelated application error that
 * merely happens to share wording.
 */
export function isDuplicateAdcRejection(reason: unknown): boolean {
  if (!(reason instanceof Error)) return false;
  if (!ADC_ERROR_MESSAGE_PATTERN.test(reason.message)) return false;
  return ADC_ERROR_STACK_PATTERN.test(reason.stack || "");
}

export type RejectionAction = "suppress" | "fatal";

/** Pure decision: what should happen for a given unhandled rejection reason. */
export function classifyUnhandledRejection(reason: unknown): RejectionAction {
  return isDuplicateAdcRejection(reason) ? "suppress" : "fatal";
}

export interface RejectionGuardLogger {
  warn: (message: string) => void;
  error: (message: string, err: unknown) => void;
}

/**
 * Installs the process-level `unhandledRejection` listener. Attaching any
 * listener disables Node's own default handling entirely, so the "fatal"
 * branch below must reproduce that default behavior itself (log + exit
 * non-zero) for anything that isn't the known, narrow, already-handled
 * duplicate — otherwise a real bug's unhandled rejection would silently stop
 * crashing the process, which would be a serious regression in the other
 * direction.
 *
 * `logger`/`exit` are injectable purely so this can be exercised safely in
 * tests without actually terminating the test process.
 */
export function installGoogleAuthRejectionGuard(
  logger: RejectionGuardLogger = console,
  exit: (code: number) => void = (code) => process.exit(code)
): void {
  process.on("unhandledRejection", (reason) => {
    if (classifyUnhandledRejection(reason) === "suppress") {
      logger.warn(
        "[Firestore] Ignoring a duplicate Application Default Credentials rejection from the underlying Google Cloud client library (known upstream google-auth-library/google-gax behavior — the authoritative failure was already caught and logged separately by attemptFirestoreConnect). Not crashing the process."
      );
      return;
    }
    logger.error("[FATAL] Unhandled promise rejection — crashing intentionally so this is never silently swallowed:", reason);
    exit(1);
  });
}
