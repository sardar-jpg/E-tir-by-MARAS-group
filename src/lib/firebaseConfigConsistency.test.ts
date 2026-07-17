import { describe, it, expect } from "vitest";
import { checkFirebaseConfigConsistency } from "./firebaseConfigConsistency";

// The real, current repo configuration (as of the Firebase environment audit).
const GOOD = {
  firebaseJson: {
    firestore: [
      {
        database: "ai-studio-43f003da-29bb-4b79-b7a4-8fcf5095f532",
        rules: "firestore.rules",
        indexes: "firestore.indexes.json",
      },
    ],
    storage: { rules: "storage.rules" },
  },
  firebaserc: {
    projects: { production: "etir-by-maras-group", default: "etir-by-maras-group" },
  },
  appletConfig: {
    projectId: "etir-by-maras-group",
    firestoreDatabaseId: "ai-studio-43f003da-29bb-4b79-b7a4-8fcf5095f532",
    storageBucket: "etir-by-maras-group.firebasestorage.app",
  },
};

describe("checkFirebaseConfigConsistency", () => {
  it("reports no problems for the current, correct repo config", () => {
    const r = checkFirebaseConfigConsistency(GOOD);
    expect(r.problems).toEqual([]);
  });

  it("flags a missing firestore rules reference", () => {
    const r = checkFirebaseConfigConsistency({
      ...GOOD,
      firebaseJson: {
        firestore: [{ database: "ai-studio-43f003da-29bb-4b79-b7a4-8fcf5095f532", indexes: "firestore.indexes.json" }],
        storage: { rules: "storage.rules" },
      },
    });
    expect(r.problems.some(p => /firestore.*rules.*reference/i.test(p))).toBe(true);
  });

  it("flags a missing storage rules reference", () => {
    const r = checkFirebaseConfigConsistency({
      ...GOOD,
      firebaseJson: {
        firestore: [
          { database: "ai-studio-43f003da-29bb-4b79-b7a4-8fcf5095f532", rules: "firestore.rules", indexes: "firestore.indexes.json" },
        ],
      },
    });
    expect(r.problems.some(p => /storage.*rules.*reference/i.test(p))).toBe(true);
  });

  it("flags a Firestore database ID mismatch between firebase.json and applet config", () => {
    const r = checkFirebaseConfigConsistency({
      ...GOOD,
      appletConfig: { ...GOOD.appletConfig, firestoreDatabaseId: "(default)" },
    });
    expect(r.problems.some(p => /database ID mismatch/i.test(p))).toBe(true);
  });

  it("flags a projectId mismatch between applet config and .firebaserc default", () => {
    const r = checkFirebaseConfigConsistency({
      ...GOOD,
      appletConfig: { ...GOOD.appletConfig, projectId: "some-other-project" },
    });
    expect(r.problems.some(p => /project mismatch/i.test(p))).toBe(true);
  });

  it("flags a staging/production alias collision", () => {
    const r = checkFirebaseConfigConsistency({
      ...GOOD,
      firebaserc: {
        projects: {
          production: "etir-by-maras-group",
          staging: "etir-by-maras-group",
          default: "etir-by-maras-group",
        },
      },
    });
    expect(r.problems.some(p => /staging and production aliases both point/i.test(p))).toBe(true);
  });

  it("flags a legacy AI Studio (gen-lang-client-) project as a live target", () => {
    const r = checkFirebaseConfigConsistency({
      ...GOOD,
      firebaserc: {
        projects: { production: "gen-lang-client-0123456789", default: "gen-lang-client-0123456789" },
      },
      appletConfig: { ...GOOD.appletConfig, projectId: "gen-lang-client-0123456789" },
    });
    expect(r.problems.some(p => /Legacy Google AI Studio/i.test(p))).toBe(true);
  });

  it("does NOT flag the ai-studio- database name as legacy (only gen-lang-client- projects)", () => {
    const r = checkFirebaseConfigConsistency(GOOD);
    expect(r.problems.some(p => /Legacy Google AI Studio/i.test(p))).toBe(false);
    expect(r.warnings.some(p => /Legacy Google AI Studio/i.test(p))).toBe(false);
  });

  it("warns when the storage bucket does not belong to the project", () => {
    const r = checkFirebaseConfigConsistency({
      ...GOOD,
      appletConfig: { ...GOOD.appletConfig, storageBucket: "someone-elses-bucket.firebasestorage.app" },
    });
    expect(r.warnings.some(w => /does not start with projectId/i.test(w))).toBe(true);
  });

  it("is null-safe when config files are absent", () => {
    const r = checkFirebaseConfigConsistency({ firebaseJson: null, firebaserc: null, appletConfig: null });
    expect(Array.isArray(r.problems)).toBe(true);
    expect(Array.isArray(r.warnings)).toBe(true);
  });
});
