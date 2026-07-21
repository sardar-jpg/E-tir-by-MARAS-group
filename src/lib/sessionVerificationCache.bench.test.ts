import { describe, it, expect } from "vitest";
import { SessionVerificationCache, type CachedBacking } from "./sessionVerificationCache";
import { evaluateSessionBacking } from "./sessionBacking";

/**
 * Deterministic local benchmark for the session-verification cache. No
 * Firebase credentials, no network — a counted in-memory "backing source"
 * stands in for Firestore, and a controllable clock makes the TTL exact.
 *
 * It reports RAW COUNTS (not a headline percentage): how many backing-account
 * verification reads N authenticated requests cause, before-equivalent
 * (cache disabled) vs after (5s TTL). Run with:
 *   npx vitest run src/lib/sessionVerificationCache.bench.test.ts
 */

function countingSource(record: CachedBacking) {
  let reads = 0;
  return {
    get reads() {
      return reads;
    },
    read(): CachedBacking {
      reads++;
      return record;
    },
  };
}

function runBurst(opts: {
  ttlMs: number;
  requests: number;
  spacingMs: number;
  role: string;
  id: string;
  adminType?: string;
}) {
  let t = 0;
  const cache = new SessionVerificationCache({ ttlMs: opts.ttlMs, now: () => t });
  const source = countingSource({ exists: true, record: { adminType: opts.adminType } });
  const payload = { role: opts.role, id: opts.id, adminType: opts.adminType };
  let authorizedCount = 0;
  for (let i = 0; i < opts.requests; i++) {
    // Crypto token verification would run here every request (not modelled —
    // it is unchanged and never cached). Then the backing check:
    let backing = cache.get(payload.role, payload.id);
    if (!backing) {
      backing = source.read();
      cache.set(payload.role, payload.id, backing);
    }
    const verdict = evaluateSessionBacking(payload, backing);
    if (verdict.ok) authorizedCount++;
    t += opts.spacingMs;
  }
  return { reads: source.reads, authorizedCount, stats: cache.stats() };
}

describe("session-verification read benchmark (raw counts)", () => {
  const REQUESTS = 40; // e.g. one admin polling ~ every 3s for 2 minutes
  const SPACING_MS = 3000;

  it("reports before/after backing-read counts for a polling burst", () => {
    // BEFORE-equivalent: caching disabled (ttl 0) → one read per request.
    const before = runBurst({ ttlMs: 0, requests: REQUESTS, spacingMs: SPACING_MS, role: "admin", id: "a1", adminType: "operation" });
    // AFTER: 5s TTL → roughly one read per TTL window.
    const after = runBurst({ ttlMs: 5000, requests: REQUESTS, spacingMs: SPACING_MS, role: "admin", id: "a1", adminType: "operation" });

    // eslint-disable-next-line no-console
    console.log(
      `[bench] session verification over ${REQUESTS} requests @ ${SPACING_MS}ms spacing (${(REQUESTS * SPACING_MS) / 1000}s window):\n` +
        `        BEFORE (no cache): ${before.reads} backing reads\n` +
        `        AFTER  (5s TTL):   ${after.reads} backing reads (hits=${after.stats.hits}, misses=${after.stats.misses})\n` +
        `        Authorization result identical: ${before.authorizedCount === after.authorizedCount} (${after.authorizedCount}/${REQUESTS} authorized in both)`
    );

    // BEFORE reads once per request.
    expect(before.reads).toBe(REQUESTS);
    // AFTER: with 3s spacing under a 5s TTL, at most one read per ~5s window.
    // window count = ceil(totalSpan / ttl) bounded; assert it is far fewer and
    // matches the deterministic window math (span 117s / 5s ≈ 24 boundaries).
    expect(after.reads).toBeLessThan(before.reads);
    expect(after.reads).toBeLessThanOrEqual(Math.ceil((REQUESTS * SPACING_MS) / 5000) + 1);
    // Crucially: identical authorization outcome — the cache changes cost, not the verdict.
    expect(after.authorizedCount).toBe(before.authorizedCount);
    expect(after.authorizedCount).toBe(REQUESTS);
  });

  it("a same-account burst inside one TTL window collapses to a single read", () => {
    // 50 requests within 500ms (all inside a 5s TTL) → exactly 1 read.
    const r = runBurst({ ttlMs: 5000, requests: 50, spacingMs: 10, role: "driver", id: "d1" });
    // eslint-disable-next-line no-console
    console.log(`[bench] 50 requests within one 5s TTL window → ${r.reads} backing read(s)`);
    expect(r.reads).toBe(1);
  });
});
