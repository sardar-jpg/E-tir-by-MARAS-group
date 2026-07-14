import { describe, it, expect } from "vitest";
import { computePersistenceReadiness } from "./persistenceReadiness";

describe("computePersistenceReadiness", () => {
  it("defaults to strict persistence on and demo seeding off", () => {
    const result = computePersistenceReadiness({}, true);
    expect(result.strictPersistence).toBe(true);
    expect(result.seedDemoData).toBe(false);
  });

  it("only STRICT_PERSISTENCE=\"false\" turns strict persistence off", () => {
    expect(computePersistenceReadiness({ STRICT_PERSISTENCE: "false" }, true).strictPersistence).toBe(false);
    expect(computePersistenceReadiness({ STRICT_PERSISTENCE: "0" }, true).strictPersistence).toBe(true);
    expect(computePersistenceReadiness({ STRICT_PERSISTENCE: "" }, true).strictPersistence).toBe(true);
  });

  it("only SEED_DEMO_DATA=\"true\" turns demo seeding on", () => {
    expect(computePersistenceReadiness({ SEED_DEMO_DATA: "true" }, true).seedDemoData).toBe(true);
    expect(computePersistenceReadiness({ SEED_DEMO_DATA: "1" }, true).seedDemoData).toBe(false);
    expect(computePersistenceReadiness({ SEED_DEMO_DATA: "yes" }, true).seedDemoData).toBe(false);
  });

  it("local dev (non-production) never produces warnings, regardless of flags", () => {
    const result = computePersistenceReadiness(
      { NODE_ENV: "development", SEED_DEMO_DATA: "true", STRICT_PERSISTENCE: "false" },
      false
    );
    expect(result.isProduction).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it("flags demo seeding enabled in production", () => {
    const result = computePersistenceReadiness(
      { NODE_ENV: "production", SEED_DEMO_DATA: "true", GOOGLE_APPLICATION_CREDENTIALS: "/secure/key.json" },
      true
    );
    expect(result.warnings.some(w => w.includes("SEED_DEMO_DATA"))).toBe(true);
  });

  it("flags strict persistence disabled in production", () => {
    const result = computePersistenceReadiness(
      { NODE_ENV: "production", STRICT_PERSISTENCE: "false", GOOGLE_APPLICATION_CREDENTIALS: "/secure/key.json" },
      true
    );
    expect(result.warnings.some(w => w.includes("STRICT_PERSISTENCE"))).toBe(true);
  });

  it("flags missing Firebase config entirely in production", () => {
    const result = computePersistenceReadiness({ NODE_ENV: "production" }, false);
    expect(result.configuredMode).toBe("memory-fallback");
    expect(result.warnings.some(w => w.includes("no Firebase configuration"))).toBe(true);
  });

  it("detects the ADC environment hint via GOOGLE_APPLICATION_CREDENTIALS", () => {
    expect(computePersistenceReadiness({ GOOGLE_APPLICATION_CREDENTIALS: "/path/to/key.json" }, true).adcEnvHintPresent).toBe(true);
  });

  it("detects the ADC environment hint via Cloud Run's K_SERVICE", () => {
    expect(computePersistenceReadiness({ K_SERVICE: "e-tir-by-maras-v2" }, true).adcEnvHintPresent).toBe(true);
  });

  it("does not claim an ADC hint when neither env var is present", () => {
    expect(computePersistenceReadiness({}, true).adcEnvHintPresent).toBe(false);
  });

  it("warns in production when Firebase is configured but no ADC hint is present", () => {
    const result = computePersistenceReadiness({ NODE_ENV: "production" }, true);
    expect(result.configuredMode).toBe("firestore");
    expect(result.warnings.some(w => w.includes("ADC environment hint"))).toBe(true);
  });

  it("produces no warnings when production is fully configured with an ADC hint", () => {
    const result = computePersistenceReadiness(
      {
        NODE_ENV: "production",
        STRICT_PERSISTENCE: undefined,
        SEED_DEMO_DATA: undefined,
        K_SERVICE: "e-tir-by-maras-v2",
      },
      true
    );
    expect(result.configuredMode).toBe("firestore");
    expect(result.warnings).toEqual([]);
  });

  it("does not warn about a missing ADC hint outside production (local dev has no static hint by design)", () => {
    const result = computePersistenceReadiness({ NODE_ENV: "development" }, true);
    expect(result.warnings).toEqual([]);
  });

  it("never includes raw secret values in its output — only booleans and static strings", () => {
    const secretKeyPath = "/very/secret/path/to/service-account-key.json";
    const result = computePersistenceReadiness(
      { NODE_ENV: "production", GOOGLE_APPLICATION_CREDENTIALS: secretKeyPath },
      true
    );
    // The path itself is not a secret value (it's a filesystem path, not a
    // credential), but this still confirms nothing beyond presence is echoed.
    expect(JSON.stringify(result)).not.toContain(secretKeyPath);
  });
});
