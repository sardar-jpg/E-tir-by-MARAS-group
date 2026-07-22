import { describe, it, expect, vi } from "vitest";
import {
  isDuplicateAdcRejection,
  classifyUnhandledRejection,
  installGoogleAuthRejectionGuard,
} from "./googleAuthRejectionGuard";

function fakeAdcError(message: string, stackFrames: string): Error {
  const err = new Error(message);
  err.stack = `Error: ${message}\n${stackFrames}`;
  return err;
}

describe("isDuplicateAdcRejection", () => {
  it("matches the exact reproduced failure (missing ADC file + google-auth-library/google-gax stack)", () => {
    const err = fakeAdcError(
      "The file at /nonexistent/path/does-not-exist.json does not exist, or it is not a file. ENOENT: no such file or directory, lstat '/nonexistent'",
      "    at GoogleAuth._getApplicationCredentialsFromFilePath (/node_modules/google-gax/node_modules/google-auth-library/build/src/auth/googleauth.js:380:27)\n" +
        "    at GoogleAuth.getApplicationDefaultAsync (/node_modules/google-gax/node_modules/google-auth-library/build/src/auth/googleauth.js:257:24)\n" +
        "    at GrpcClient.createStub (/node_modules/google-gax/build/src/grpc.js:373:34)"
    );
    expect(isDuplicateAdcRejection(err)).toBe(true);
  });

  it("matches the no-ADC-at-all variant (\"Could not load the default credentials\")", () => {
    const err = fakeAdcError(
      "Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication/getting-started for more information.",
      "    at GoogleAuth.getApplicationDefaultAsync (/node_modules/google-gax/node_modules/google-auth-library/build/src/auth/googleauth.js:284:15)\n" +
        "    at async GrpcClient.createStub (/node_modules/google-gax/build/src/grpc.js:373:23)"
    );
    expect(isDuplicateAdcRejection(err)).toBe(true);
  });

  it("does not match a non-Error reason", () => {
    expect(isDuplicateAdcRejection("just a string")).toBe(false);
    expect(isDuplicateAdcRejection(undefined)).toBe(false);
    expect(isDuplicateAdcRejection({ message: "Could not load the default credentials" })).toBe(false);
  });

  it("does not match an Error with a similar message but an unrelated (application-code) stack", () => {
    const err = fakeAdcError(
      "Could not load the default credentials for this widget.",
      "    at loadWidgetDefaults (/Users/me/app/src/widgets.ts:42:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)"
    );
    expect(isDuplicateAdcRejection(err)).toBe(false);
  });

  it("does not match a genuinely unrelated application error", () => {
    const err = new Error("Cannot read properties of undefined (reading 'foo')");
    err.stack = "TypeError: Cannot read properties of undefined (reading 'foo')\n    at handler (/Users/me/app/server.ts:100:5)";
    expect(isDuplicateAdcRejection(err)).toBe(false);
  });

  it("does not match a real Firestore permission error (a different, legitimate failure mode)", () => {
    const err = fakeAdcError(
      "7 PERMISSION_DENIED: Missing or insufficient permissions.",
      "    at callErrorFromStatus (/node_modules/@grpc/grpc-js/build/src/call.js:31:26)\n    at Object.onReceiveStatus (/node_modules/@grpc/grpc-js/build/src/client.js:192:52)"
    );
    expect(isDuplicateAdcRejection(err)).toBe(false);
  });
});

describe("classifyUnhandledRejection", () => {
  it("suppresses the known duplicate ADC rejection", () => {
    const err = fakeAdcError(
      "Could not load the default credentials.",
      "    at GoogleAuth.getApplicationDefaultAsync (/node_modules/google-gax/node_modules/google-auth-library/build/src/auth/googleauth.js:284:15)"
    );
    expect(classifyUnhandledRejection(err)).toBe("suppress");
  });

  it("treats everything else as fatal", () => {
    expect(classifyUnhandledRejection(new Error("some unrelated bug"))).toBe("fatal");
    expect(classifyUnhandledRejection("weird non-error rejection")).toBe("fatal");
  });
});

describe("installGoogleAuthRejectionGuard", () => {
  it("suppresses a duplicate ADC rejection: logs a warning, never calls exit", () => {
    const logger = { warn: vi.fn(), error: vi.fn() };
    const exit = vi.fn();
    installGoogleAuthRejectionGuard(logger, exit);
    try {
      const err = fakeAdcError(
        "Could not load the default credentials.",
        "    at GoogleAuth.getApplicationDefaultAsync (/node_modules/google-gax/node_modules/google-auth-library/build/src/auth/googleauth.js:284:15)"
      );
      process.emit("unhandledRejection", err, Promise.reject(err).catch(() => {}));
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0][0]).toContain("Ignoring a duplicate Application Default Credentials rejection");
      expect(logger.error).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
    } finally {
      process.removeAllListeners("unhandledRejection");
    }
  });

  it("treats an unrelated rejection as fatal: logs an error and calls exit(1), never silently swallowed", () => {
    const logger = { warn: vi.fn(), error: vi.fn() };
    const exit = vi.fn();
    installGoogleAuthRejectionGuard(logger, exit);
    try {
      const err = new Error("totally unrelated application bug");
      process.emit("unhandledRejection", err, Promise.reject(err).catch(() => {}));
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error.mock.calls[0][0]).toContain("[FATAL] Unhandled promise rejection");
      expect(logger.warn).not.toHaveBeenCalled();
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      process.removeAllListeners("unhandledRejection");
    }
  });
});
