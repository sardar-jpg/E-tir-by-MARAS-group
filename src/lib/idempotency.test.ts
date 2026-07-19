import { describe, it, expect } from "vitest";
import {
  normalizeIdempotencyKey,
  scopeIdempotencyKey,
  fingerprintPayload,
  resolveIdempotency,
} from "./idempotency";

describe("idempotency key normalization + scoping", () => {
  it("trims, caps, and drops blank keys", () => {
    expect(normalizeIdempotencyKey("  k1 ")).toBe("k1");
    expect(normalizeIdempotencyKey("")).toBeUndefined();
    expect(normalizeIdempotencyKey("   ")).toBeUndefined();
    expect(normalizeIdempotencyKey(123 as unknown)).toBeUndefined();
    expect(normalizeIdempotencyKey("x".repeat(500))!.length).toBe(200);
  });
  it("scopes a key by action so it can't collide across operations", () => {
    expect(scopeIdempotencyKey("customer-payment", "k1")).toBe("customer-payment:k1");
    expect(scopeIdempotencyKey("receipt", "k1")).not.toBe(scopeIdempotencyKey("customer-payment", "k1"));
  });
});

describe("payload fingerprint is order-independent and value-stable", () => {
  it("is identical regardless of key order", () => {
    expect(fingerprintPayload({ a: 1, b: "x" })).toBe(fingerprintPayload({ b: "x", a: 1 }));
  });
  it("changes when a financially-significant value changes", () => {
    expect(fingerprintPayload({ amount: 100 })).not.toBe(fingerprintPayload({ amount: 200 }));
  });
});

describe("resolveIdempotency: replay vs conflict vs proceed", () => {
  const fp = (r: { amount: number }) => fingerprintPayload({ amount: r.amount });
  const existing = [{ id: "p1", idempotencyKey: "customer-payment:k1", amount: 100 }];

  it("proceeds when no key is supplied", () => {
    const out = resolveIdempotency({ existing, scopedKey: undefined, fingerprintOf: fp, requestFingerprint: fingerprintPayload({ amount: 100 }) });
    expect(out.kind).toBe("proceed");
  });
  it("replays the original record when the same key + same payload arrives (one payment, not two)", () => {
    const out = resolveIdempotency({ existing, scopedKey: "customer-payment:k1", fingerprintOf: fp, requestFingerprint: fingerprintPayload({ amount: 100 }) });
    expect(out.kind).toBe("replay");
    expect((out as { record: { id: string } }).record.id).toBe("p1");
  });
  it("rejects the same key used with a different payload", () => {
    const out = resolveIdempotency({ existing, scopedKey: "customer-payment:k1", fingerprintOf: fp, requestFingerprint: fingerprintPayload({ amount: 999 }) });
    expect(out.kind).toBe("conflict");
    expect((out as { code: string }).code).toBe("idempotency_conflict");
  });
  it("proceeds when the key is new", () => {
    const out = resolveIdempotency({ existing, scopedKey: "customer-payment:k2", fingerprintOf: fp, requestFingerprint: fingerprintPayload({ amount: 100 }) });
    expect(out.kind).toBe("proceed");
  });
});
