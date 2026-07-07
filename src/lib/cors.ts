/**
 * cors.ts
 *
 * BUG-11: the CORS middleware used to reflect back whatever Origin header a
 * request sent while Access-Control-Allow-Credentials was true. That
 * combination is unsafe — it tells the browser "any site may read this
 * response, including the credentials/session token it holds for this
 * user", which defeats the same-origin protections CORS exists to provide.
 * Replaced with an explicit allowlist: Access-Control-Allow-Origin is only
 * ever set to a request's Origin when that origin is on the list, and it is
 * never set to "*" (which browsers reject outright when combined with
 * Allow-Credentials anyway).
 *
 * Pure and framework-free so the allowlist logic is unit testable without
 * booting Express.
 */

/** Always-allowed local dev + production origins, regardless of env config. */
export const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "https://etir.app",
  "https://www.etir.app",
];

const ORIGIN_ENV_KEYS = ["APP_URL", "CLIENT_URL", "ALLOWED_ORIGINS", "PUBLIC_APP_URL"];

/**
 * Reads every env var that can carry allowed origins. Each may hold a
 * single URL or a comma-separated list; all are merged so whichever the
 * deployment happens to set is honored. A trailing slash is stripped so
 * "https://etir.app/" in an env var still matches the Origin header, which
 * never includes a trailing slash.
 */
export function parseAllowedOriginsFromEnv(env: Record<string, string | undefined>): string[] {
  const origins: string[] = [];
  for (const key of ORIGIN_ENV_KEYS) {
    const raw = env[key];
    if (!raw) continue;
    for (const part of raw.split(",")) {
      const trimmed = part.trim().replace(/\/+$/, "");
      if (trimmed) origins.push(trimmed);
    }
  }
  return origins;
}

/**
 * Decides what Access-Control-Allow-Origin value (if any) a request with
 * this Origin header should receive. Returns the origin itself when it's
 * allowlisted — the only correct value to pair with Allow-Credentials — or
 * null when it isn't, meaning the caller must omit
 * Access-Control-Allow-Origin (and Allow-Credentials) entirely rather than
 * fall back to reflecting the origin or using "*".
 *
 * A missing Origin (undefined) always resolves to null: browsers only send
 * Origin on cross-site requests, so its absence means same-origin or a
 * non-browser (server-to-server) caller, neither of which is subject to or
 * needs a CORS grant.
 */
export function resolveCorsOrigin(
  origin: string | undefined,
  extraAllowedOrigins: string[] = []
): string | null {
  if (!origin) return null;
  const normalized = origin.replace(/\/+$/, "");
  const allowlist = [...DEFAULT_ALLOWED_ORIGINS, ...extraAllowedOrigins];
  return allowlist.includes(normalized) ? normalized : null;
}
