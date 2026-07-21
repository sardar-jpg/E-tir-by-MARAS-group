/**
 * sessionVerificationCache.ts — Performance Phase 1.
 *
 * The authenticated-request middleware (attachSession, server.ts) loads the
 * BACKING account on every request so a deleted/disabled/demoted account
 * stops working immediately (Stage 2 PR 4). Under polling that means one
 * Firestore read per request, per surface, every few seconds.
 *
 * This is a small, bounded, in-process cache of the *backing read only* —
 * NOT of the authorization verdict. The middleware still:
 *   1. cryptographically verifies the session token's signature + expiry on
 *      EVERY request (unchanged, never cached), and
 *   2. re-runs the pure `evaluateSessionBacking(payload, backing)` decision
 *      on EVERY request against the (possibly cached) backing.
 * Only the Firestore document read is cached, and only for a few seconds, so
 * a burst of polling requests for the same account collapses to ~1 read per
 * account per TTL window instead of one read per request.
 *
 * FAIL-CLOSED guarantees preserved:
 *  - A Firestore ERROR is never stored (the caller keeps its fail-closed 503
 *    path); only a successful read result — whether the account exists or
 *    not — is cached.
 *  - The verdict is still computed from the live token payload each request,
 *    so a stale-`adminType` token is still rejected even against a cached
 *    fresh record; a demotion/deletion is picked up at the latest when the
 *    entry expires (TTL) or immediately when a mutation invalidates it.
 *  - Negative results (account missing/blocked) are cached only for the same
 *    short TTL — no long negative caching.
 *
 * MULTI-INSTANCE: each server process (e.g. each Cloud Run instance) has its
 * OWN cache. An account mutation on instance A invalidates only A's entry;
 * other instances converge within at most one TTL window (default 5s). This
 * is an intentional, documented trade-off — the security floor is the TTL,
 * which is far shorter than the 24h session-token lifetime that was the prior
 * worst case before Stage 2 PR 4.
 */

/** The minimal backing shape `evaluateSessionBacking` reads. Kept tiny on
 *  purpose: only the fields the pure verdict consults (no names, emails,
 *  financial, or personal data is retained in the cache). */
export interface CachedBacking {
  exists: boolean;
  record?: Record<string, unknown>;
}

export interface SessionVerificationCacheOptions {
  /** TTL in ms. Default 5000. Hard-capped at 10000 (Phase-1 max). */
  ttlMs?: number;
  /** Max entries before bounded eviction kicks in. Default 5000. */
  maxEntries?: number;
  /** Injectable clock for deterministic tests. Default Date.now. */
  now?: () => number;
}

interface CacheEntry {
  value: CachedBacking;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 5000;
const MAX_TTL_MS = 10000;
const DEFAULT_MAX_ENTRIES = 5000;

/**
 * Project a full Firestore backing record down to ONLY the fields session
 * authorization consults (`evaluateSessionBacking`): admin `adminType`,
 * driver `status`, client `active`. Everything else is dropped so the cache
 * never retains personal/business data. `active: false` / `undefined` are
 * preserved distinctly because `isClientAccountActive` treats them
 * differently.
 */
export function projectBackingRecord(
  record: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!record) return undefined;
  const { adminType, status, active } = record as {
    adminType?: unknown;
    status?: unknown;
    active?: unknown;
  };
  return { adminType, status, active };
}

export class SessionVerificationCache {
  private map = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private hits = 0;
  private misses = 0;

  constructor(opts: SessionVerificationCacheOptions = {}) {
    const requested = opts.ttlMs ?? DEFAULT_TTL_MS;
    // Clamp into [0, MAX_TTL_MS]; 0 disables caching entirely (every request
    // reads Firestore) which keeps the fail-closed behavior a superset.
    this.ttlMs = Math.max(0, Math.min(requested, MAX_TTL_MS));
    this.maxEntries = Math.max(1, opts.maxEntries ?? DEFAULT_MAX_ENTRIES);
    this.now = opts.now ?? Date.now;
  }

  /** Cache key. Includes the role so `admin:X` and `driver:X` never collide. */
  static keyFor(role: string, id: string): string {
    return `${role}:${id}`;
  }

  /**
   * Returns the cached backing if present and unexpired, else null.
   * Lazily evicts an expired entry. Records a hit/miss for instrumentation.
   */
  get(role: string, id: string): CachedBacking | null {
    const key = SessionVerificationCache.keyFor(role, id);
    const entry = this.map.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    if (entry.expiresAt <= this.now()) {
      this.map.delete(key);
      this.misses++;
      return null;
    }
    this.hits++;
    return entry.value;
  }

  /**
   * Store a successful backing read. No-op when caching is disabled
   * (ttlMs === 0). Bounds the map: sweeps expired entries first, then evicts
   * the oldest inserted entry if still at capacity (FIFO by insertion order).
   */
  set(role: string, id: string, value: CachedBacking): void {
    if (this.ttlMs <= 0) return;
    const key = SessionVerificationCache.keyFor(role, id);
    if (!this.map.has(key) && this.map.size >= this.maxEntries) {
      this.sweepExpired();
      while (this.map.size >= this.maxEntries) {
        const oldest = this.map.keys().next().value;
        if (oldest === undefined) break;
        this.map.delete(oldest);
      }
    }
    // Delete-then-set so the key moves to the most-recent insertion position,
    // keeping the Map's iteration order aligned with recency for eviction.
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  /** Drop a single account's entry (called after account mutations). */
  invalidate(role: string, id: string): void {
    this.map.delete(SessionVerificationCache.keyFor(role, id));
  }

  /** Remove all expired entries; returns how many were removed. */
  sweepExpired(): number {
    const t = this.now();
    let removed = 0;
    for (const [k, e] of this.map) {
      if (e.expiresAt <= t) {
        this.map.delete(k);
        removed++;
      }
    }
    return removed;
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  /** Hit/miss counters for dev/test instrumentation (no sensitive data). */
  stats(): { hits: number; misses: number; size: number } {
    return { hits: this.hits, misses: this.misses, size: this.map.size };
  }

  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }
}

/**
 * Process-wide singleton used by server.ts. TTL 5s per Phase-1 spec. A
 * separate instance exists per server process (documented multi-instance
 * behavior above).
 */
export const sessionVerificationCache = new SessionVerificationCache({ ttlMs: DEFAULT_TTL_MS });
