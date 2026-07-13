/**
 * chatMessageValidation.ts
 *
 * fix/chat-safety-reliability-phase1
 *
 * Shared, pure validation for POST /api/shipments/:id/chat, used by
 * server.ts (the actual enforcement point) and unit-tested here without
 * booting the Express server — same pattern as chatVisibility.ts /
 * uploadValidation.ts.
 *
 * Independent rules live here:
 *
 * 1. A chat message's `fileUrl`, when present, must be a well-formed,
 *    absolute HTTPS URL — and nothing else. Every upload surface
 *    (ChatCenter.tsx, App.tsx, DriverApplication.tsx) is supposed to call
 *    POST /api/upload first and only ever send the real Storage URL that
 *    comes back (always `https://...`, via Firebase's getDownloadURL()) —
 *    but that's a client-side convention with nothing stopping a client
 *    (buggy or otherwise) from sending something else instead: the raw
 *    base64 `data:` URL it read the file into (e.g. as a fallback when the
 *    upload call itself failed — a `data:` URL can be arbitrarily large and,
 *    once written to Firestore, permanently inflates that message document,
 *    and for client_admin/admin-sent messages can also get copied into
 *    shipment.documents and rewrite the ENTIRE shipment document, risking
 *    Firestore's 1 MiB per-document limit on an otherwise-healthy shipment
 *    record); a dead placeholder like `"#"`; a `javascript:`/`file:`/
 *    `blob:` URL; or a malformed string. `new URL()` parsing plus an
 *    explicit `https:` protocol check rejects all of these outright, while
 *    still accepting any real Firebase/Cloud Storage HTTPS download URL.
 *    This is the server-side backstop: reject the request before it ever
 *    reaches Firestore, rather than trust the client already did the right
 *    thing.
 *
 * 2. Message text has a maximum length and can't be whitespace-only unless
 *    a valid attachment is present — there was previously no length limit
 *    anywhere in the pipeline at all.
 */

export const MAX_CHAT_TEXT_LENGTH = 5000;

export type ChatSendValidationResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * True for any string that is (or, after trimming, starts as) an inline
 * `data:` URL — the browser-native representation of a file read via
 * FileReader.readAsDataURL(), as opposed to a real uploaded Storage URL.
 * Checked separately from isHttpsUrl below purely so the rejection message
 * can be specific ("upload it first") rather than the generic
 * "must be HTTPS" message every other rejected scheme gets.
 */
export function isDataUrlFileReference(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase().startsWith("data:");
}

/**
 * True only for a well-formed, absolute URL whose scheme is exactly
 * `https:`. Rejects (among others):
 * - `"#"`, `""`, whitespace-only — no scheme at all, `new URL()` throws.
 * - `javascript:`, `file:`, `blob:`, `data:` — parse fine, wrong protocol.
 * - Anything `new URL()` can't parse as absolute at all (a relative path,
 *   a protocol-relative `//host/...`, or plain garbage text).
 * Real Firebase/Cloud Storage download URLs (`https://storage.googleapis.com/...`,
 * `https://firebasestorage.googleapis.com/v0/b/...`) all parse and pass.
 */
export function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  return parsed.protocol === "https:";
}

export interface ChatSendPayloadInput {
  type?: unknown;
  text?: unknown;
  fileUrl?: unknown;
}

/**
 * Validates a POST /api/shipments/:id/chat body, independent of role/
 * channel (those are validated separately — see chatVisibility.ts). Rules:
 *
 * - Any non-empty `fileUrl` must be a valid HTTPS URL (see isHttpsUrl) —
 *   checked regardless of `type`, since the intent is always "reject this
 *   before it reaches Firestore," not "only when the caller correctly
 *   labeled the message as type: file." An inline `data:` URL gets its own,
 *   more specific error message; every other rejected scheme/malformed
 *   value gets the generic "must be HTTPS" one.
 * - `type === "file"` requires a `fileUrl` to be present at all (and, by
 *   the rule above, a valid HTTPS one) — a caller can't declare a file
 *   message with no URL.
 * - Any other type requires non-whitespace `text` — an attachment-only
 *   message (type: "file", no text) is valid; a text message with only
 *   whitespace is not.
 * - `text`, when present, may not exceed MAX_CHAT_TEXT_LENGTH after
 *   trimming — applies to a file message's caption text too.
 */
export function validateChatSendPayload(input: ChatSendPayloadInput): ChatSendValidationResult {
  const text = typeof input.text === "string" ? input.text : "";
  const trimmedText = text.trim();
  const fileUrl = typeof input.fileUrl === "string" ? input.fileUrl.trim() : undefined;
  const isFileMessage = input.type === "file";

  if (fileUrl) {
    if (isDataUrlFileReference(fileUrl)) {
      return {
        ok: false,
        error: "Inline file data is not allowed. Please upload the file to storage and try again.",
      };
    }
    if (!isHttpsUrl(fileUrl)) {
      return {
        ok: false,
        error: "File URL must be a valid HTTPS storage link.",
      };
    }
  }

  if (isFileMessage) {
    if (!fileUrl) {
      return { ok: false, error: "A valid uploaded file URL is required." };
    }
  } else if (!trimmedText) {
    return { ok: false, error: "Message text cannot be empty." };
  }

  if (trimmedText.length > MAX_CHAT_TEXT_LENGTH) {
    return {
      ok: false,
      error: `Message text is too long (max ${MAX_CHAT_TEXT_LENGTH} characters).`,
    };
  }

  return { ok: true };
}
