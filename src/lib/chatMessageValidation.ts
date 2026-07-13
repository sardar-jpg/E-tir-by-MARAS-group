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
 * Two independent rules live here:
 *
 * 1. A chat message's `fileUrl` may never be an inline `data:` URL. Every
 *    upload surface (ChatCenter.tsx, App.tsx, DriverApplication.tsx) is
 *    supposed to call POST /api/upload first and only ever send the real
 *    Storage URL that returns — but that's a client-side convention with
 *    nothing stopping a client (buggy or otherwise) from sending the raw
 *    base64 `data:` URL it read the file into instead, e.g. as a fallback
 *    when the upload call itself failed. A `data:` URL can be arbitrarily
 *    large (up to this server's 20mb JSON body limit) and, once written to
 *    Firestore, permanently inflates that message document — for
 *    client_admin/admin-sent messages it can also get copied into
 *    shipment.documents (shouldSaveChatFileAsShipmentDocument,
 *    chatVisibility.ts) and rewrite the ENTIRE shipment document, risking
 *    Firestore's 1 MiB per-document limit on an otherwise-healthy shipment
 *    record. This is the server-side backstop: reject the request
 *    outright rather than trust the client already did the right thing.
 *
 * 2. Message text has a maximum length and can't be whitespace-only unless
 *    a valid (non-`data:`) file is attached — there was previously no
 *    length limit anywhere in the pipeline at all.
 */

export const MAX_CHAT_TEXT_LENGTH = 5000;

export type ChatSendValidationResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * True for any string that is (or, after trimming, starts as) an inline
 * `data:` URL — the browser-native representation of a file read via
 * FileReader.readAsDataURL(), as opposed to a real uploaded Storage URL
 * (which always starts with `https://`).
 */
export function isDataUrlFileReference(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase().startsWith("data:");
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
 * - Any `fileUrl` that is an inline `data:` URL is rejected outright,
 *   regardless of `type` — defense in depth, since the intent is always
 *   "reject this before it reaches Firestore," not "only when the caller
 *   correctly labeled the message as type: file."
 * - `type === "file"` requires a non-empty, non-`data:` `fileUrl` — a
 *   caller can't declare a file message with no (or an unusable) URL.
 * - Any other type requires non-whitespace `text` — an attachment-only
 *   message (type: "file", no text) is valid; a text message with only
 *   whitespace is not.
 * - `text`, when present, may not exceed MAX_CHAT_TEXT_LENGTH after
 *   trimming — applies to a file message's caption text too.
 */
export function validateChatSendPayload(input: ChatSendPayloadInput): ChatSendValidationResult {
  const text = typeof input.text === "string" ? input.text : "";
  const trimmedText = text.trim();
  const fileUrl = typeof input.fileUrl === "string" ? input.fileUrl : undefined;
  const isFileMessage = input.type === "file";

  if (fileUrl !== undefined && fileUrl.trim() && isDataUrlFileReference(fileUrl)) {
    return {
      ok: false,
      error: "Inline file data is not allowed. Please upload the file to storage and try again.",
    };
  }

  if (isFileMessage) {
    if (!fileUrl || !fileUrl.trim()) {
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
