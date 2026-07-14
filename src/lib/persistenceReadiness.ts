/**
 * persistenceReadiness.ts
 *
 * Firebase readiness / production-safety review (PR #43, updated by the
 * Admin SDK / Application Default Credentials migration): pure helper that
 * turns the persistence-related env vars into one clear picture of what mode
 * the server is about to run in, so this can be logged once, unambiguously,
 * at startup (see server.ts) instead of being pieced together from scattered
 * warnings. Also unit-testable without booting Express or Firebase.
 *
 * Never touches secret values themselves (SESSION_SECRET, API keys, ...) —
 * only whether they're present.
 *
 * Credential-availability note: this server used to authenticate to
 * Firestore/Storage via a dedicated Firebase Auth account
 * (SERVER_FIREBASE_EMAIL/PASSWORD), whose presence as env vars was a
 * reliable static signal. It now uses the Firebase Admin SDK with
 * Application Default Credentials (ADC) instead, which — for local
 * development via `gcloud auth application-default login` — live in a file
 * outside any env var. That means credential availability generally can NOT
 * be determined by inspecting env vars alone. `adcEnvHintPresent` below is a
 * best-effort, non-authoritative hint (an explicit key-file path, or a
 * Cloud Run runtime marker); the live Firestore connection check in
 * server.ts's attemptFirestoreConnect() is the only real source of truth.
 */

export interface PersistenceReadiness {
  isProduction: boolean;
  /** STRICT_PERSISTENCE is on by default; only "false" turns it off. */
  strictPersistence: boolean;
  /** SEED_DEMO_DATA is off by default; only "true" turns it on. */
  seedDemoData: boolean;
  /** Whether a Firebase client config (file or FIREBASE_CONFIG env) was found. */
  firebaseConfigured: boolean;
  /**
   * Best-effort, non-authoritative hint that Application Default
   * Credentials will be available: true when GOOGLE_APPLICATION_CREDENTIALS
   * (an explicit service-account key file path) or K_SERVICE (set
   * automatically by Cloud Run) is present. Local development via
   * `gcloud auth application-default login` cannot be detected this way —
   * only the live Firestore connection check can confirm ADC actually
   * works.
   */
  adcEnvHintPresent: boolean;
  /**
   * Best-effort mode based on static config alone — NOT the live
   * `useMemoryFallback` runtime flag, which can additionally flip to
   * "memory-fallback" later if the Firestore connection check fails even
   * though a project/config looked complete at startup.
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
  const adcEnvHintPresent = !!env.GOOGLE_APPLICATION_CREDENTIALS || !!env.K_SERVICE;
  const configuredMode: PersistenceReadiness["configuredMode"] = firebaseConfigured ? "firestore" : "memory-fallback";

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
      "Production has no Firebase configuration (no config file and no FIREBASE_CONFIG env var) — the server will run entirely on the in-memory fallback."
    );
  }

  if (isProduction && configuredMode === "firestore" && !adcEnvHintPresent) {
    warnings.push(
      "Production has Firebase config but no ADC environment hint (GOOGLE_APPLICATION_CREDENTIALS or Cloud Run's K_SERVICE) — confirm the runtime has a service account with Firestore/Storage access attached. The live Firestore connection check at startup is authoritative; this is only a static hint."
    );
  }

  return {
    isProduction,
    strictPersistence,
    seedDemoData,
    firebaseConfigured,
    adcEnvHintPresent,
    configuredMode,
    warnings,
  };
}
