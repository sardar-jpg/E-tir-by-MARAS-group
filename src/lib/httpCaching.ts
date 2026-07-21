/**
 * httpCaching.ts — Performance Phase 1.
 *
 * Pure decisions for (a) which Cache-Control a served static file should get
 * and (b) which content types are worth compressing. The Express wiring lives
 * in server.ts; keeping the policy here makes it unit-testable in the node
 * harness and impossible to accidentally apply to an API/data response.
 *
 * Vite emits content-hashed files under `/assets/` (e.g.
 * `index-dI7Y0FE0.js`), so those are safe to cache forever (`immutable`) — a
 * new deploy ships new filenames. The entry HTML must always revalidate so a
 * deploy is picked up on the next load. NOTHING here is ever applied to
 * authenticated API, customer/driver/accounting, or public-share responses —
 * it only decorates files served from the built `dist/` directory.
 */

const ONE_YEAR_SECONDS = 31536000;

/**
 * Cache-Control for a static file, given its URL path (leading slash, no
 * origin). Hashed build assets → immutable 1-year; HTML entry documents →
 * no-cache (revalidate every load); anything else → short, revalidated.
 */
export function cacheControlForAsset(pathname: string): string {
  const p = (pathname.split("?")[0] || "").trim();
  // Content-hashed, fingerprinted build output — safe to cache immutably.
  if (p.startsWith("/assets/")) {
    return `public, max-age=${ONE_YEAR_SECONDS}, immutable`;
  }
  // Entry HTML must never be immutably cached or a deploy won't be seen.
  if (p === "/" || p === "/index.html" || p.endsWith("/index.html") || p.endsWith(".html")) {
    return "no-cache";
  }
  // Other root files (favicon, manifest, robots, …): allow caching but force
  // revalidation so they can't go stale across deploys.
  return "public, max-age=0, must-revalidate";
}

/** True when a Cache-Control implies a long-lived, immutable cache. */
export function isImmutableCacheControl(value: string | undefined): boolean {
  return !!value && /immutable/.test(value) && /max-age=\d{5,}/.test(value);
}

const COMPRESSIBLE = [
  /^text\//,
  /application\/json/,
  /application\/(java|ecma)script/,
  /text\/javascript/,
  /application\/xml/,
  /\+xml/,
  /image\/svg\+xml/,
  /application\/manifest\+json/,
];

const ALREADY_COMPRESSED = [
  /^image\/(png|jpe?g|gif|webp|avif|x-icon)/,
  /^video\//,
  /^audio\//,
  /application\/zip/,
  /application\/gzip/,
  /application\/pdf/,
  /^font\/(woff2?|otf|ttf)/,
  /application\/octet-stream/,
];

/**
 * Whether a response of this content type is worth gzip/brotli. Skips images,
 * fonts, media, and archives (already compressed — recompressing wastes CPU).
 */
export function shouldCompress(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  if (ALREADY_COMPRESSED.some((r) => r.test(ct))) return false;
  return COMPRESSIBLE.some((r) => r.test(ct));
}
