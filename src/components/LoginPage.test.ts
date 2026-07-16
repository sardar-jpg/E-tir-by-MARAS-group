import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * feature/login-mobile-app-experience
 *
 * The project has no component-render test harness (vitest runs in a plain
 * "node" environment — see vite.config.ts — with no jsdom/testing-library
 * dependency), so these are source-level regression checks rather than
 * rendered-DOM assertions. They pin the behavioral contract of LoginPage.tsx
 * that this PR must not break while reworking its layout: all three
 * languages, RTL, the unified /api/login call with no role selector,
 * Firebase fallback, registration/verification reachability, labels +
 * autocomplete, and the old small-card mobile constraint being gone.
 */

const SOURCE = readFileSync(join(__dirname, "LoginPage.tsx"), "utf-8");

describe("LoginPage languages and RTL", () => {
  it("still defines English, Turkish, and Arabic translation blocks", () => {
    expect(SOURCE).toMatch(/en:\s*{/);
    expect(SOURCE).toMatch(/tr:\s*{/);
    expect(SOURCE).toMatch(/ar:\s*{/);
  });

  it("still derives RTL from the Arabic language and applies it to the root dir attribute", () => {
    expect(SOURCE).toContain('const isRtl = lang === "ar"');
    expect(SOURCE).toContain('dir={isRtl ? "rtl" : "ltr"}');
  });

  it("uses logical start/end spacing utilities instead of hardcoded left/right", () => {
    expect(SOURCE).not.toMatch(/\bp[lr]-\d/);
    expect(SOURCE).not.toMatch(/\bm[lr]-\d/);
    expect(SOURCE).not.toMatch(/\bleft-\d|\bright-\d/);
  });
});

describe("LoginPage authentication behavior is unchanged", () => {
  it("still posts to the single unified /api/login endpoint with no client-chosen role", () => {
    expect(SOURCE).toContain('apiFetch("/api/login"');
    expect(SOURCE).toContain("The client never chooses");
  });

  it("still falls back to Firebase email/password sign-in", () => {
    expect(SOURCE).toContain("signInWithEmailAndPassword(auth, enteredEmail, loginPassword)");
  });

  it("still calls /api/verify-session and /api/drivers/self-register", () => {
    expect(SOURCE).toContain('apiFetch("/api/verify-session"');
    expect(SOURCE).toContain('apiFetch("/api/drivers/self-register"');
  });

  it("introduces no role selector — the only <select> elements are language and truck type", () => {
    const selectTagCount = (SOURCE.match(/<select\b/g) || []).length;
    expect(selectTagCount).toBe(2);
    expect(SOURCE).toContain('aria-label="Language"');
    expect(SOURCE).toContain("value={regTruckType}");
  });

  it("keeps the Google sign-in feature flag disabled and untouched", () => {
    expect(SOURCE).toContain("const GOOGLE_LOGIN_ENABLED = false;");
  });
});

describe("LoginPage accessibility contract", () => {
  it("keeps associated labels and autocomplete on the login fields", () => {
    expect(SOURCE).toContain('htmlFor="login-identifier"');
    expect(SOURCE).toContain('id="login-identifier"');
    expect(SOURCE).toContain('autoComplete="username"');
    expect(SOURCE).toContain('htmlFor="login-password"');
    expect(SOURCE).toContain('id="login-password"');
    expect(SOURCE).toContain('autoComplete="current-password"');
  });

  it("still announces the login error as an alert", () => {
    expect(SOURCE).toContain('role="alert"');
  });

  it("still disables the sign-in and register submit buttons while a request is in flight", () => {
    expect(SOURCE).toContain("disabled={isLoggingIn}");
    expect(SOURCE).toContain("disabled={isRegistering}");
  });
});

describe("LoginPage reachable states and footer", () => {
  it("still supports switching into registration mode and back", () => {
    expect(SOURCE).toContain("setIsRegisterMode(true)");
    expect(SOURCE).toContain("setIsRegisterMode(false)");
  });

  it("still reaches the verification-success state after registration", () => {
    expect(SOURCE).toContain("setVerificationEmail(email)");
    expect(SOURCE).toMatch(/verificationEmail \?/);
  });

  it("still surfaces support email, Privacy Policy, and Terms controls", () => {
    expect(SOURCE).toContain('href={`mailto:${SUPPORT_EMAIL}`}');
    expect(SOURCE).toContain("onViewPrivacy");
    expect(SOURCE).toContain("onViewTerms");
  });
});

describe("LoginPage mobile layout no longer uses the old small-card constraint", () => {
  it("removes the fixed max-w-[440px] mobile card cap", () => {
    expect(SOURCE).not.toContain("max-w-[440px]");
  });

  it("uses dynamic viewport height instead of a fixed-height screen container", () => {
    expect(SOURCE).toContain("min-h-dvh");
    expect(SOURCE).not.toContain("min-h-screen bg-slate-900");
  });

  it("respects iOS/Android safe areas for the top bar and bottom content", () => {
    expect(SOURCE).toContain("env(safe-area-inset-top)");
    expect(SOURCE).toContain("env(safe-area-inset-bottom)");
  });

  it("keeps the primary Sign In / Register controls at a touch-friendly height (>=52px)", () => {
    expect(SOURCE).toMatch(/type="submit"[\s\S]{0,120}h-14/);
  });

  it("gives mobile a two-column desktop layout starting at the lg breakpoint, not a stretched single form", () => {
    expect(SOURCE).toContain("lg:grid lg:grid-cols-2");
    expect(SOURCE).toContain("hidden lg:flex");
  });
});
