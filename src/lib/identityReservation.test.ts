import { describe, it, expect } from "vitest";
import {
  buildIdentityKeyId,
  computeIdentityClaims,
  computeOwnerClaims,
  diffIdentityClaims,
  findClaimConflict,
  canReleaseReservation,
  buildReservationRecord,
  applyIdentityReservationMemory,
  decideBackfillWrite,
  IdentityConflictError,
  OWNER_RESERVATION_SOURCE,
  type IdentityReservationRecord,
} from "./identityReservation";

const owner = (source: string, accountId: string) => ({ source, accountId });

/** Fresh in-memory stores for each scenario. */
const freshStores = () => ({ keys: [] as IdentityReservationRecord[], accounts: [] as Array<Record<string, unknown> & { id?: string }> });

const createAccount = (stores: ReturnType<typeof freshStores>, source: string, id: string, identity: { username?: string; email?: string; phone?: string }) =>
  applyIdentityReservationMemory(stores, {
    owner: owner(source, id),
    claims: computeIdentityClaims(identity),
    releaseKeyIds: [],
    accountWrite: { id, ...identity },
  });

describe("deterministic key encoding", () => {
  it("keys are deterministic, Firestore-safe, field-prefixed, and normalization-aware", () => {
    const a = buildIdentityKeyId("email", "  User@Example.COM ");
    const b = buildIdentityKeyId("email", "user@example.com");
    expect(a).toBe(b);
    expect(a).toMatch(/^email_[0-9a-f]{40}$/);
    expect(buildIdentityKeyId("phone", "+964 750 111 2222")).toBe(buildIdentityKeyId("phone", "+9647501112222"));
    // Same value under different fields yields DIFFERENT keys.
    expect(buildIdentityKeyId("username", "sardar")).not.toBe(buildIdentityKeyId("email", "sardar"));
    expect(buildIdentityKeyId("email", "")).toBeNull();
    expect(buildIdentityKeyId("email", "   ")).toBeNull();
  });

  it("reservation records carry minimum metadata and never the raw value", () => {
    const [claim] = computeIdentityClaims({ email: "private.person@example.com" });
    const record = buildReservationRecord(claim, owner("drivers", "d1"), "2026-07-19T00:00:00Z");
    expect(Object.keys(record).sort()).toEqual(["accountId", "field", "id", "reservedAt", "source", "valueHash"]);
    expect(JSON.stringify(record)).not.toContain("private.person");
    expect(JSON.stringify(record)).not.toContain("example.com");
  });
});

describe("atomic reservation semantics (memory-mode = synchronous, equivalent within one process)", () => {
  it("two simultaneous creates with the same email: exactly one succeeds", async () => {
    const stores = freshStores();
    const attempt = (id: string) => (async () => createAccount(stores, "drivers", id, { email: "dup@x.com" }))();
    const results = await Promise.allSettled([attempt("d1"), attempt("d2")]);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const conflicts = results.filter((r) => r.status === "rejected" && (r as PromiseRejectedResult).reason instanceof IdentityConflictError);
    expect(ok).toBe(1);
    expect(conflicts.length).toBe(1);
    expect(stores.accounts.length).toBe(1);
    expect(stores.keys.filter((k) => k.field === "email").length).toBe(1);
  });

  it("same username across DIFFERENT roles: exactly one succeeds", async () => {
    const stores = freshStores();
    const clientStores = { keys: stores.keys, accounts: [] as Array<Record<string, unknown> & { id?: string }> };
    const r = await Promise.allSettled([
      (async () => createAccount(stores, "drivers", "d1", { username: "shared" }))(),
      (async () => applyIdentityReservationMemory(clientStores, { owner: owner("clients", "c1"), claims: computeIdentityClaims({ username: "shared" }), releaseKeyIds: [], accountWrite: { id: "c1" } }))(),
    ]);
    expect(r.filter((x) => x.status === "fulfilled").length).toBe(1);
    expect(stores.keys.filter((k) => k.field === "username").length).toBe(1);
  });

  it("same phone across different roles: exactly one succeeds (whitespace variants collide)", async () => {
    const stores = freshStores();
    const r = await Promise.allSettled([
      (async () => createAccount(stores, "drivers", "d1", { phone: "+964 750 1" }))(),
      (async () => createAccount(stores, "clients", "c1", { phone: "+9647501" }))(),
    ]);
    expect(r.filter((x) => x.status === "fulfilled").length).toBe(1);
  });

  it("a failed creation leaves NO orphan reservations and no account", () => {
    const stores = freshStores();
    createAccount(stores, "drivers", "d1", { username: "taken", email: "d1@x.com" });
    const before = stores.keys.length;
    // d2 claims a fresh email AND the taken username — the conflict aborts
    // BEFORE any mutation, so the fresh email key must not linger.
    expect(() => createAccount(stores, "drivers", "d2", { username: "taken", email: "fresh@x.com" })).toThrow(IdentityConflictError);
    expect(stores.keys.length).toBe(before);
    expect(stores.keys.some((k) => k.accountId === "d2")).toBe(false);
    expect(stores.accounts.some((a) => a.id === "d2")).toBe(false);
  });

  it("update releases the old key and reserves the new key atomically; unchanged keys stay put", () => {
    const stores = freshStores();
    createAccount(stores, "clients", "c1", { username: "old_name", email: "same@x.com" });
    const { toReserve, toReleaseKeyIds } = diffIdentityClaims(
      { username: "old_name", email: "same@x.com" },
      { username: "new_name", email: "same@x.com" }
    );
    expect(toReserve.map((c) => c.field)).toEqual(["username"]);
    expect(toReleaseKeyIds).toEqual([buildIdentityKeyId("username", "old_name")]);
    applyIdentityReservationMemory(stores, { owner: owner("clients", "c1"), claims: toReserve, releaseKeyIds: toReleaseKeyIds, accountWrite: { id: "c1", username: "new_name" } });
    expect(stores.keys.some((k) => k.id === buildIdentityKeyId("username", "old_name"))).toBe(false);
    expect(stores.keys.some((k) => k.id === buildIdentityKeyId("username", "new_name") && k.accountId === "c1")).toBe(true);
    expect(stores.keys.some((k) => k.id === buildIdentityKeyId("email", "same@x.com") && k.accountId === "c1")).toBe(true);
    // The freed old username is claimable again.
    createAccount(stores, "drivers", "d9", { username: "old_name" });
  });

  it("self-update with unchanged identity produces an empty diff and always passes", () => {
    const identity = { username: "same", email: "same@x.com", phone: "+1 1" };
    const diff = diffIdentityClaims(identity, { username: "same", email: "SAME@x.com", phone: "+11" });
    expect(diff.toReserve).toEqual([]);
    expect(diff.toReleaseKeyIds).toEqual([]);
  });

  it("deletion removes ONLY the target account's reservations", () => {
    const stores = freshStores();
    createAccount(stores, "drivers", "d1", { username: "u1", email: "e1@x.com" });
    createAccount(stores, "drivers", "d2", { username: "u2", email: "e2@x.com" });
    applyIdentityReservationMemory(stores, {
      owner: owner("drivers", "d1"),
      claims: [],
      // d1 tries to release its own keys AND d2's key — only its own go.
      releaseKeyIds: [buildIdentityKeyId("username", "u1")!, buildIdentityKeyId("email", "e1@x.com")!, buildIdentityKeyId("username", "u2")!],
      accountDeleteId: "d1",
    });
    expect(stores.keys.some((k) => k.accountId === "d1")).toBe(false);
    expect(stores.keys.filter((k) => k.accountId === "d2").length).toBe(2);
    expect(stores.accounts.map((a) => a.id)).toEqual(["d2"]);
  });

  it("owner reservations can never be claimed or released by any account", () => {
    const stores = freshStores();
    const ownerClaims = computeOwnerClaims("sardar@maras.iq");
    applyIdentityReservationMemory(stores, { owner: owner(OWNER_RESERVATION_SOURCE, "owner"), claims: ownerClaims, releaseKeyIds: [] });
    // Claim attempt by a driver → conflict on the owner's email.
    expect(() => createAccount(stores, "drivers", "d1", { email: "sardar@maras.iq" })).toThrow(IdentityConflictError);
    expect(() => createAccount(stores, "drivers", "d1", { username: "sardar" })).toThrow(IdentityConflictError);
    // Release attempt by any account is ignored.
    applyIdentityReservationMemory(stores, { owner: owner("drivers", "d1"), claims: [], releaseKeyIds: ownerClaims.map((c) => c.keyId) });
    expect(stores.keys.filter((k) => k.source === OWNER_RESERVATION_SOURCE).length).toBe(ownerClaims.length);
    // canReleaseReservation is explicit about it.
    expect(canReleaseReservation({ source: OWNER_RESERVATION_SOURCE, accountId: "owner" }, owner(OWNER_RESERVATION_SOURCE, "owner"))).toBe(false);
    // Idempotent re-reservation by the owner itself is fine.
    applyIdentityReservationMemory(stores, { owner: owner(OWNER_RESERVATION_SOURCE, "owner"), claims: ownerClaims, releaseKeyIds: [] });
  });

  it("an account re-claiming its OWN key is not a conflict (idempotent create/update)", () => {
    const stores = freshStores();
    createAccount(stores, "clients", "c1", { email: "mine@x.com" });
    const existing = new Map(stores.keys.map((k) => [k.id, k]));
    expect(findClaimConflict(computeIdentityClaims({ email: "mine@x.com" }), existing, owner("clients", "c1"))).toBeNull();
    expect(findClaimConflict(computeIdentityClaims({ email: "mine@x.com" }), existing, owner("clients", "c2"))).toBe("email");
  });
});

describe("backfill write decisions — the snapshot is a plan, never authorization (PR #137 final review)", () => {
  const KEY = buildIdentityKeyId("email", "legacy@x.com")!;
  const planned = { source: "drivers", accountId: "d1" };
  const base = { plannedKeyId: KEY, planned, currentAccountExists: true, currentAccountClaimKeyIds: [KEY] };

  it("a reservation created concurrently after the initial scan is never overwritten", () => {
    const d = decideBackfillWrite({ ...base, currentReservation: { source: "clients", accountId: "c9" } });
    expect(d).toEqual({ action: "foreign_conflict", currentOwner: { source: "clients", accountId: "c9" } });
  });

  it("a foreign reservation is never replaced even when the account still claims the key", () => {
    const d = decideBackfillWrite({ ...base, currentReservation: { source: "drivers", accountId: "OTHER" } });
    expect(d.action).toBe("foreign_conflict");
  });

  it("same-account existing reservation is idempotent (already_owned, no write)", () => {
    const d = decideBackfillWrite({ ...base, currentReservation: { source: "drivers", accountId: "d1" } });
    expect(d).toEqual({ action: "already_owned" });
  });

  it("an account whose identity changed during the backfill produces STALE and no reservation", () => {
    const changedKey = buildIdentityKeyId("email", "renamed@x.com")!;
    const d = decideBackfillWrite({ ...base, currentReservation: null, currentAccountClaimKeyIds: [changedKey] });
    expect(d).toEqual({ action: "stale", reason: "identity_changed" });
  });

  it("a deleted account produces STALE and no reservation", () => {
    const d = decideBackfillWrite({ ...base, currentReservation: null, currentAccountExists: false, currentAccountClaimKeyIds: [] });
    expect(d).toEqual({ action: "stale", reason: "account_missing" });
  });

  it("only a still-valid, currently-absent key is created", () => {
    expect(decideBackfillWrite({ ...base, currentReservation: null })).toEqual({ action: "create" });
  });
});
