import { describe, it, expect } from "vitest";

/**
 * Models the atomic version logic the company-profile / template publish +
 * restore routes run INSIDE runAccountingTransaction (increment 3, items
 * 14-18). The critical section (read current+version → archive current under a
 * deterministic id → write next version) has no await, so two concurrent
 * publishes serialize: the loser re-reads the winner's version and bumps again,
 * yielding DISTINCT versions. Historical archives are keyed by version, so they
 * are written exactly once and never mutated. Restore republishes prior CONTENT
 * as a NEW version (never touching the restored historical doc) and is
 * idempotent by key.
 */
type Profile = { content: string; version: number; sourceRestoredVersion?: number };

function makeVersionedStore(initial: Profile) {
  let current = initial;
  const archives = new Map<number, Profile>(); // keyed by version → immutable
  const idem = new Map<string, number>();
  return {
    current: () => current,
    archives,
    /** atomic publish: read → archive(current) once → write next. */
    publish(content: string) {
      const v = current.version;
      if (v > 0 && !archives.has(v)) archives.set(v, { ...current }); // deterministic id = version → exactly once
      current = { content, version: v + 1 };
      return current.version;
    },
    /** atomic restore-as-new-version, idempotent by key. */
    restore(targetVersion: number, priorContent: string, key?: string) {
      if (key && idem.has(key)) return { version: idem.get(key)!, idempotent: true };
      const v = current.version;
      if (v > 0 && !archives.has(v)) archives.set(v, { ...current });
      current = { content: priorContent, version: v + 1, sourceRestoredVersion: targetVersion };
      if (key) idem.set(key, current.version);
      return { version: current.version, idempotent: false };
    },
  };
}

describe("atomic versioning — publish / restore (item 18)", () => {
  it("two sequential publishes receive DISTINCT, monotonic versions", () => {
    const store = makeVersionedStore({ content: "v1", version: 1 });
    const a = store.publish("A");
    const b = store.publish("B");
    expect(a).toBe(2);
    expect(b).toBe(3);
    expect(a).not.toBe(b);
  });

  it("historical versions are archived exactly once and never mutated", () => {
    const store = makeVersionedStore({ content: "orig", version: 1 });
    store.publish("second"); // archives v1
    const v1 = store.archives.get(1)!;
    store.publish("third"); // archives v2, v1 untouched
    expect(store.archives.get(1)).toBe(v1); // same object — immutable
    expect(store.archives.get(1)!.content).toBe("orig");
    expect(store.archives.get(2)!.content).toBe("second");
  });

  it("restore creates a NEW version from prior content, preserving the source and never mutating history", () => {
    const store = makeVersionedStore({ content: "current", version: 3 });
    const r = store.restore(1, "the-v1-content");
    expect(r.version).toBe(4); // new version, not 1
    expect(store.current().content).toBe("the-v1-content");
    expect(store.current().sourceRestoredVersion).toBe(1);
    // The archived v3 (the pre-restore current) is intact.
    expect(store.archives.get(3)!.content).toBe("current");
  });

  it("a repeated restore with the SAME idempotency key replays (no duplicate version)", () => {
    const store = makeVersionedStore({ content: "current", version: 2 });
    const first = store.restore(1, "v1", "restore-key-1");
    const again = store.restore(1, "v1", "restore-key-1");
    expect(first.version).toBe(3);
    expect(again.version).toBe(3);
    expect(again.idempotent).toBe(true);
    expect(store.current().version).toBe(3); // not 4
  });
});
