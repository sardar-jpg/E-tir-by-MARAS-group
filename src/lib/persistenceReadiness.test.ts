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
      { NODE_ENV: "production", SEED_DEMO_DATA: "true", SERVER_FIREBASE_EMAIL: "a@b.com", SERVER_FIREBASE_PASSWORD: "x" },
      true
    );
    expect(result.warnings.some(w => w.includes("SEED_DEMO_DATA"))).toBe(true);
  });

  it("flags strict persistence disabled in production", () => {
    const result = computePersistenceReadiness(
      { NODE_ENV: "production", STRICT_PERSISTENCE: "false", SERVER_FIREBASE_EMAIL: "a@b.com", SERVER_FIREBASE_PASSWORD: "x" },
      true
    );
    expect(result.warnings.some(w => w.includes("STRICT_PERSISTENCE"))).toBe(true);
  });

  it("flags missing Firebase config entirely in production", () => {
    const result = computePersistenceReadiness({ NODE_ENV: "production" }, false);
    expect(result.configuredMode).toBe("memory-fallback");
    expect(result.warnings.some(w => w.includes("no Firebase configuration"))).toBe(true);
  });

  it("flags Firebase config present but server credentials missing in production", () => {
    const result = computePersistenceReadiness({ NODE_ENV: "production" }, true);
    expect(result.configuredMode).toBe("memory-fallback");
    expect(result.warnings.some(w => w.includes("SERVER_FIREBASE_EMAIL"))).toBe(true);
  });

  it("produces no warnings when production is fully configured", () => {
    const result = computePersistenceReadiness(
      {
        NODE_ENV: "production",
        STRICT_PERSISTENCE: undefined,
        SEED_DEMO_DATA: undefined,
        SERVER_FIREBASE_EMAIL: "server@etir-by-maras-group.firebaseapp.com",
        SERVER_FIREBASE_PASSWORD: "x",
      },
      true
    );
    expect(result.configuredMode).toBe("firestore");
    expect(result.warnings).toEqual([]);
  });

  it("never includes raw secret values in its output — only booleans and static strings", () => {
    const secretPassword = "s3cr3t-super-secret-password-value";
    const result = computePersistenceReadiness(
      { NODE_ENV: "production", SERVER_FIREBASE_EMAIL: "a@b.com", SERVER_FIREBASE_PASSWORD: secretPassword },
      true
    );
    expect(JSON.stringify(result)).not.toContain(secretPassword);
  });
});
