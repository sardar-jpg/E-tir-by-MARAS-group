import { describe, it, expect } from "vitest";
import {
  SessionVerificationCache,
  projectBackingRecord,
  type CachedBacking,
} from "./sessionVerificationCache";
import { evaluateSessionBacking } from "./sessionBacking";

/**
 * These tests model the middleware's real flow: crypto verification (assumed
 * done before we ever reach the cache) → cache lookup → Firestore read on
 * miss → pure verdict each request. A controllable clock makes TTL
 * deterministic and a read counter stands in for Firestore.
 */

// A fake "Firestore" whose reads we can count, keyed by `${role}:${id}`.
function makeBackingSource(records: Record<string, CachedBacking>) {
  let reads = 0;
  return {
    get reads() {
      return reads;
    },
    read(role: string, id: string): CachedBacking {
      reads++;
      const found = records[`${role}:${id}`];
      return found ?? { exists: false };
    },
  };
}

// Mirrors the middleware: cache the backing read only; run the pure verdict
// against the live payload every time.
function verifyThroughCache(
  cache: SessionVerificationCache,
  source: { read: (r: string, i: string) => CachedBacking },
  payload: { role: string; id: string; adminType?: string }
) {
  let backing = cache.get(payload.role, payload.id);
  if (!backing) {
    backing = source.read(payload.role, payload.id);
    cache.set(payload.role, payload.id, backing);
  }
  return evaluateSessionBacking(payload, backing);
}

describe("projectBackingRecord", () => {
  it("keeps only the auth-relevant fields and drops everything else", () => {
    const projected = projectBackingRecord({
      adminType: "operation",
      status: "approved",
      active: true,
      name: "Jane",
      email: "jane@example.com",
      salary: 9999,
    });
    expect(projected).toEqual({ adminType: "operation", status: "approved", active: true });
    expect(projected).not.toHaveProperty("name");
    expect(projected).not.toHaveProperty("email");
    expect(projected).not.toHaveProperty("salary");
  });

  it("preserves active:false distinctly from undefined", () => {
    expect(projectBackingRecord({ active: false })).toEqual({
      adminType: undefined,
      status: undefined,
      active: false,
    });
    expect(projectBackingRecord({})).toEqual({
      adminType: undefined,
      status: undefined,
      active: undefined,
    });
    expect(projectBackingRecord(undefined)).toBeUndefined();
  });
});

describe("SessionVerificationCache TTL + read collapsing", () => {
  it("1) first request reads the source (miss)", () => {
    let t = 1000;
    const cache = new SessionVerificationCache({ ttlMs: 5000, now: () => t });
    const source = makeBackingSource({ "admin:a1": { exists: true, record: { adminType: "operation" } } });
    verifyThroughCache(cache, source, { role: "admin", id: "a1", adminType: "operation" });
    expect(source.reads).toBe(1);
    expect(cache.stats().misses).toBe(1);
  });

  it("2) a second request within TTL reuses the cache (no new read)", () => {
    let t = 1000;
    const cache = new SessionVerificationCache({ ttlMs: 5000, now: () => t });
    const source = makeBackingSource({ "admin:a1": { exists: true, record: { adminType: "operation" } } });
    const p = { role: "admin", id: "a1", adminType: "operation" };
    verifyThroughCache(cache, source, p);
    t += 4999; // still inside TTL
    const r = verifyThroughCache(cache, source, p);
    expect(source.reads).toBe(1); // collapsed
    expect(cache.stats().hits).toBe(1);
    expect(r.ok).toBe(true);
  });

  it("3) a request after TTL reads the source again", () => {
    let t = 1000;
    const cache = new SessionVerificationCache({ ttlMs: 5000, now: () => t });
    const source = makeBackingSource({ "admin:a1": { exists: true, record: { adminType: "operation" } } });
    const p = { role: "admin", id: "a1", adminType: "operation" };
    verifyThroughCache(cache, source, p);
    t += 5001; // expired
    verifyThroughCache(cache, source, p);
    expect(source.reads).toBe(2);
  });

  it("N burst requests within TTL ≈ 1 read (benchmark shape)", () => {
    let t = 1000;
    const cache = new SessionVerificationCache({ ttlMs: 5000, now: () => t });
    const source = makeBackingSource({ "driver:d1": { exists: true, record: { status: "approved" } } });
    const p = { role: "driver", id: "d1" };
    for (let i = 0; i < 50; i++) {
      t += 10; // 50 requests over 500ms, all within TTL
      verifyThroughCache(cache, source, p);
    }
    expect(source.reads).toBe(1);
  });
});

describe("SessionVerificationCache correctness + fail-closed", () => {
  it("4) different roles sharing a raw id never collide", () => {
    let t = 1000;
    const cache = new SessionVerificationCache({ ttlMs: 5000, now: () => t });
    const source = makeBackingSource({
      "admin:shared": { exists: true, record: { adminType: "super" } },
      "driver:shared": { exists: true, record: { status: "approved" } },
      "client:shared": { exists: true, record: { active: true } },
    });
    const admin = verifyThroughCache(cache, source, { role: "admin", id: "shared", adminType: "super" });
    const driver = verifyThroughCache(cache, source, { role: "driver", id: "shared" });
    const client = verifyThroughCache(cache, source, { role: "client", id: "shared" });
    expect(admin.ok && driver.ok && client.ok).toBe(true);
    expect(source.reads).toBe(3); // three distinct keys, three reads
    expect(SessionVerificationCache.keyFor("admin", "shared")).not.toBe(
      SessionVerificationCache.keyFor("driver", "shared")
    );
  });

  it("5) invalid/deleted account stays rejected (missing record)", () => {
    let t = 1000;
    const cache = new SessionVerificationCache({ ttlMs: 5000, now: () => t });
    const source = makeBackingSource({}); // nothing exists
    const r = verifyThroughCache(cache, source, { role: "admin", id: "ghost", adminType: "super" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("missing");
  });

  it("5b) a stale-adminType token is rejected even against a cached fresh record", () => {
    let t = 1000;
    const cache = new SessionVerificationCache({ ttlMs: 5000, now: () => t });
    const source = makeBackingSource({ "admin:a1": { exists: true, record: { adminType: "operation" } } });
    // Token still claims 'super' but the backing account is now 'operation'.
    const r = verifyThroughCache(cache, source, { role: "admin", id: "a1", adminType: "super" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("role_changed");
  });

  it("6) a Firestore failure is never cached as a success", () => {
    let t = 1000;
    const cache = new SessionVerificationCache({ ttlMs: 5000, now: () => t });
    // Simulate the middleware's catch path: on error, DO NOT call set().
    let firstCall = true;
    const flakySource = {
      read(role: string, id: string): CachedBacking {
        if (firstCall) {
          firstCall = false;
          throw new Error("Firestore unavailable");
        }
        return { exists: true, record: { adminType: "operation" } };
      },
    };
    const p = { role: "admin", id: "a1", adminType: "operation" };
    // First request: read throws → middleware would fail-closed and NOT cache.
    let threw = false;
    try {
      const backing = cache.get(p.role, p.id) ?? flakySource.read(p.role, p.id);
      cache.set(p.role, p.id, backing);
    } catch {
      threw = true; // fail-closed; nothing cached
    }
    expect(threw).toBe(true);
    expect(cache.size).toBe(0); // no poisoned entry
    // Next request succeeds and now caches a real result.
    const r = verifyThroughCache(cache, flakySource as any, p);
    expect(r.ok).toBe(true);
    expect(cache.size).toBe(1);
  });

  it("7) invalidate() forces the next request to re-read (mutation path)", () => {
    let t = 1000;
    const cache = new SessionVerificationCache({ ttlMs: 5000, now: () => t });
    const records: Record<string, CachedBacking> = {
      "client:c1": { exists: true, record: { active: true } },
    };
    const source = {
      reads: 0,
      read(role: string, id: string): CachedBacking {
        this.reads++;
        return records[`${role}:${id}`] ?? { exists: false };
      },
    };
    const p = { role: "client", id: "c1" };
    const first = verifyThroughCache(cache, source, p);
    expect(first.ok).toBe(true);
    // Account is disabled AND the mutation route invalidates the entry.
    records["client:c1"] = { exists: true, record: { active: false } };
    cache.invalidate("client", "c1");
    const second = verifyThroughCache(cache, source, p);
    expect(source.reads).toBe(2); // invalidation forced a fresh read
    expect(second.ok).toBe(false); // now blocked, immediately
  });

  it("without invalidation a disabled account is still caught at TTL expiry (bounded staleness)", () => {
    let t = 1000;
    const cache = new SessionVerificationCache({ ttlMs: 5000, now: () => t });
    const records: Record<string, CachedBacking> = {
      "client:c1": { exists: true, record: { active: true } },
    };
    const source = {
      read: (role: string, id: string): CachedBacking => records[`${role}:${id}`] ?? { exists: false },
    };
    const p = { role: "client", id: "c1" };
    expect(verifyThroughCache(cache, source, p).ok).toBe(true);
    records["client:c1"] = { exists: true, record: { active: false } };
    t += 2000; // within TTL: still stale-allowed
    expect(verifyThroughCache(cache, source, p).ok).toBe(true);
    t += 3001; // past TTL: re-read picks up the disable
    expect(verifyThroughCache(cache, source, p).ok).toBe(false);
  });
});

describe("SessionVerificationCache bounds", () => {
  it("never grows past maxEntries", () => {
    let t = 1000;
    const cache = new SessionVerificationCache({ ttlMs: 5000, maxEntries: 10, now: () => t });
    for (let i = 0; i < 100; i++) {
      t += 1; // keep entries technically unexpired to force capacity eviction
      cache.set("driver", `d${i}`, { exists: true, record: { status: "approved" } });
    }
    expect(cache.size).toBeLessThanOrEqual(10);
  });

  it("sweepExpired removes only expired entries", () => {
    let t = 1000;
    const cache = new SessionVerificationCache({ ttlMs: 5000, now: () => t });
    cache.set("driver", "old", { exists: true });
    t += 6000;
    cache.set("driver", "new", { exists: true });
    const removed = cache.sweepExpired();
    expect(removed).toBe(1);
    expect(cache.get("driver", "new")).not.toBeNull();
  });

  it("ttl of 0 disables caching (every request reads)", () => {
    const cache = new SessionVerificationCache({ ttlMs: 0 });
    cache.set("admin", "a1", { exists: true, record: { adminType: "super" } });
    expect(cache.size).toBe(0);
    expect(cache.get("admin", "a1")).toBeNull();
  });

  it("ttl above the 10s cap is clamped", () => {
    let t = 0;
    const cache = new SessionVerificationCache({ ttlMs: 999999, now: () => t });
    cache.set("admin", "a1", { exists: true });
    t = 10001; // just past the hard cap
    expect(cache.get("admin", "a1")).toBeNull();
  });
});
