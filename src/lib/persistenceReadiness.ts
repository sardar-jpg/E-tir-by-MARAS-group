/**
 * persistenceReadiness.ts
 *
 * Firebase readiness / production-safety review (PR #43): pure helper that
 * turns the persistence-related env vars into one clear picture of what mode
 * the server is about to run in, so this can be logged once, unambiguously,
 * at startup (see server.ts) instead of being pieced together from scattered
 * warnings. Also unit-testable without booting Express or Firebase.
 *
 * Never touches secret values themselves (SESSION_SECRET,
 * SERVER_FIREBASE_PASSWORD, API keys, ...) — only whether they're present.
 */

export interface PersistenceReadiness {
  isProduction: boolean;
  /** STRICT_PERSISTENCE is on by default; only "false" turns it off. */
  strictPersistence: boolean;
  /** SEED_DEMO_DATA is off by default; only "true" turns it on. */
  seedDemoData: boolean;
  /** Whether a Firebase client config (file or FIREBASE_CONFIG env) was found. */
  firebaseConfigured: boolean;
  /** Whether SERVER_FIREBASE_EMAIL/PASSWORD are both set. */
  serverFirebaseCredsConfigured: boolean;
  /**
   * Best-effort mode based on static config alone — NOT the live
   * `useMemoryFallback` runtime flag, which can additionally flip to
   * "memory-fallback" later if the Firestore connection check fails even
   * though config/credentials looked complete at startup.
   */
  configuredMode: "firestore" | "memory-fallback";
  /** Human-readable problems worth surfacing loudly; empty when everything looks safe. */
  warnings: string[];
}

export function computePersistenceReadiness(
  env: Record<string, string | undefined>,
  firebaseConfigured: boolean
): PersistenceReadiness {
  const isProduction = env.NODE_ENV === "production";
  const strictPersistence = env.STRICT_PERSISTENCE !== "false";
  const seedDemoData = env.SEED_DEMO_DATA === "true";
  const serverFirebaseCredsConfigured = !!env.SERVER_FIREBASE_EMAIL && !!env.SERVER_FIREBASE_PASSWORD;
  const configuredMode: PersistenceReadiness["configuredMode"] =
    firebaseConfigured && serverFirebaseCredsConfigured ? "firestore" : "memory-fallback";

  const warnings: string[] = [];

  if (isProduction && seedDemoData) {
    warnings.push(
      "SEED_DEMO_DATA=true in production — demo accounts with known, source-visible passwords will be seeded. Only enable this intentionally."
    );
  }

  if (isProduction && !strictPersistence) {
    warnings.push(
      "STRICT_PERSISTENCE=false in production — writes are allowed to silently land in volatile in-memory storage instead of being rejected when Firestore is unreachable. Real data can be lost on restart."
    );
  }

  if (isProduction && configuredMode === "memory-fallback") {
    warnings.push(
      firebaseConfigured
        ? "Production is missing SERVER_FIREBASE_EMAIL/SERVER_FIREBASE_PASSWORD — the server cannot authenticate to Firestore and will run on the in-memory fallback until these are set."
        : "Production has no Firebase configuration (no config file and no FIREBASE_CONFIG env var) — the server will run entirely on the in-memory fallback."
    );
  }

  return {
    isProduction,
    strictPersistence,
    seedDemoData,
    firebaseConfigured,
    serverFirebaseCredsConfigured,
    configuredMode,
    warnings,
  };
}
