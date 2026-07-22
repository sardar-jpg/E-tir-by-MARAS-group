/**
 * bodyParserErrorResponse.ts
 *
 * express.json({ limit: "20mb" }) (server.ts) throws synchronously, before
 * any route handler runs, when a request body exceeds the limit or isn't
 * valid JSON. Left unhandled, Express's default error page returns a raw
 * HTML "Payload Too Large" / "Bad Request" document — on an otherwise
 * 100%-JSON API, every other error response uses `{ error: string }`. This
 * is purely a response-format fix: the underlying limits/status codes are
 * unchanged (413 stays 413), and the precise per-file MAX_UPLOAD_BYTES
 * check in uploadValidation.ts (which runs after base64 decoding, on the
 * actual decoded byte length) still runs exactly as before — this only
 * covers the coarser whole-request-body cap that can reject a request
 * before uploadValidation.ts ever sees it.
 */

export interface BodyParserErrorResponse {
  status: number;
  body: { error: string };
}

/**
 * Returns the response to send for a body-parser error, or null if `err`
 * isn't one (in which case the caller should call `next(err)` to let normal
 * Express error handling continue).
 */
export function resolveBodyParserErrorResponse(err: unknown): BodyParserErrorResponse | null {
  const e = err as { type?: string; status?: number; statusCode?: number; body?: unknown } | null;
  if (e && (e.type === "entity.too.large" || e.status === 413 || e.statusCode === 413)) {
    return { status: 413, body: { error: "Request body is too large." } };
  }
  if (err instanceof SyntaxError && e && "body" in e) {
    return { status: 400, body: { error: "Malformed JSON in request body." } };
  }
  return null;
}
