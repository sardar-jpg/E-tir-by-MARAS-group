import { describe, it, expect } from "vitest";
import { resolveBodyParserErrorResponse } from "./bodyParserErrorResponse";

describe("resolveBodyParserErrorResponse", () => {
  it("formats an entity.too.large body-parser error as a 413 JSON error", () => {
    const err = Object.assign(new Error("request entity too large"), { type: "entity.too.large", status: 413 });
    expect(resolveBodyParserErrorResponse(err)).toEqual({
      status: 413,
      body: { error: "Request body is too large." },
    });
  });

  it("also matches by bare status/statusCode 413 (some body-parser versions omit `type`)", () => {
    expect(resolveBodyParserErrorResponse({ status: 413 })).toEqual({
      status: 413,
      body: { error: "Request body is too large." },
    });
    expect(resolveBodyParserErrorResponse({ statusCode: 413 })).toEqual({
      status: 413,
      body: { error: "Request body is too large." },
    });
  });

  it("formats a malformed-JSON SyntaxError (with body-parser's `.body` marker) as a 400 JSON error", () => {
    const err = Object.assign(new SyntaxError("Unexpected token in JSON"), { body: "{not valid json" });
    expect(resolveBodyParserErrorResponse(err)).toEqual({
      status: 400,
      body: { error: "Malformed JSON in request body." },
    });
  });

  it("does not match a plain SyntaxError from application code (no body-parser `.body` marker)", () => {
    const err = new SyntaxError("some unrelated syntax error");
    expect(resolveBodyParserErrorResponse(err)).toBeNull();
  });

  it("returns null for an unrelated error so the caller falls through to next(err)", () => {
    expect(resolveBodyParserErrorResponse(new Error("some other failure"))).toBeNull();
    expect(resolveBodyParserErrorResponse(null)).toBeNull();
    expect(resolveBodyParserErrorResponse(undefined)).toBeNull();
  });
});
