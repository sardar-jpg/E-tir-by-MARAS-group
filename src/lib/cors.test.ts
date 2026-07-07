import { describe, it, expect } from "vitest";
import { resolveCorsOrigin, parseAllowedOriginsFromEnv, DEFAULT_ALLOWED_ORIGINS } from "./cors";

describe("resolveCorsOrigin", () => {
  it("allows the default local dev origins", () => {
    expect(resolveCorsOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    expect(resolveCorsOrigin("http://localhost:5173")).toBe("http://localhost:5173");
    expect(resolveCorsOrigin("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(resolveCorsOrigin("http://127.0.0.1:5173")).toBe("http://127.0.0.1:5173");
  });

  it("allows the production domain", () => {
    expect(resolveCorsOrigin("https://etir.app")).toBe("https://etir.app");
    expect(resolveCorsOrigin("https://www.etir.app")).toBe("https://www.etir.app");
  });

  it("rejects an arbitrary/attacker-controlled origin — does not reflect it", () => {
    expect(resolveCorsOrigin("https://evil.example.com")).toBeNull();
    expect(resolveCorsOrigin("http://localhost:9999")).toBeNull();
    expect(resolveCorsOrigin("null")).toBeNull();
  });

  it("returns null for a missing Origin header (same-origin/server-to-server)", () => {
    expect(resolveCorsOrigin(undefined)).toBeNull();
  });

  it("merges in extra allowed origins (e.g. from env vars) without dropping the defaults", () => {
    expect(resolveCorsOrigin("https://staging.etir.app", ["https://staging.etir.app"])).toBe(
      "https://staging.etir.app"
    );
    expect(resolveCorsOrigin("https://etir.app", ["https://staging.etir.app"])).toBe("https://etir.app");
    expect(resolveCorsOrigin("https://unrelated.example.com", ["https://staging.etir.app"])).toBeNull();
  });

  it("tolerates a trailing slash on the incoming Origin header", () => {
    expect(resolveCorsOrigin("https://etir.app/")).toBe("https://etir.app");
  });

  it("never returns '*' — every allowed result is a specific origin", () => {
    for (const origin of DEFAULT_ALLOWED_ORIGINS) {
      expect(resolveCorsOrigin(origin)).not.toBe("*");
    }
  });
});

describe("parseAllowedOriginsFromEnv", () => {
  it("reads APP_URL, CLIENT_URL, ALLOWED_ORIGINS, and PUBLIC_APP_URL", () => {
    const origins = parseAllowedOriginsFromEnv({
      APP_URL: "https://app.example.com",
      CLIENT_URL: "https://client.example.com",
      ALLOWED_ORIGINS: "https://a.example.com,https://b.example.com",
      PUBLIC_APP_URL: "https://public.example.com",
    });
    expect(origins).toEqual([
      "https://app.example.com",
      "https://client.example.com",
      "https://a.example.com",
      "https://b.example.com",
      "https://public.example.com",
    ]);
  });

  it("strips trailing slashes and whitespace", () => {
    expect(parseAllowedOriginsFromEnv({ ALLOWED_ORIGINS: " https://a.example.com/ , https://b.example.com " })).toEqual([
      "https://a.example.com",
      "https://b.example.com",
    ]);
  });

  it("returns an empty array when none of the env vars are set", () => {
    expect(parseAllowedOriginsFromEnv({})).toEqual([]);
  });

  it("ignores unrelated env vars", () => {
    expect(parseAllowedOriginsFromEnv({ SESSION_SECRET: "abc", PORT: "3000" })).toEqual([]);
  });
});
