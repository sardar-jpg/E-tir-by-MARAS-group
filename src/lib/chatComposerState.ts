/**
 * chatComposerState.ts
 *
 * fix/chat-safety-reliability-phase1
 *
 * Small, pure pieces of chat UI logic pulled out of ChatCenter.tsx / App.tsx
 * / DriverApplication.tsx so the actual behavior they're responsible for is
 * unit-testable without a component-testing harness (this project's test
 * suite is Vitest-only, no jsdom/@testing-library/react — see
 * chatVisibility.ts / uploadValidation.ts for the same extraction pattern).
 * Each piece is used by at least one real chat surface; none of this is
 * speculative API.
 */

/**
 * The shared duplicate-send guard: whether a chat composer's Send action
 * may actually run right now. Used identically by ChatCenter.tsx (internal
 * staff), App.tsx (admin drawer), and DriverApplication.tsx (driver) — a
 * composer must have real content (non-whitespace text, or an attachment)
 * and must not already have a send in flight. Previously this in-flight
 * check didn't exist at all in App.tsx/DriverApplication.tsx, so a rapid
 * double-tap/double-Enter could fire two POSTs before the first resolved.
 */
export function canSubmitChatMessage(input: {
  text: string;
  hasAttachment: boolean;
  isSending: boolean;
}): boolean {
  if (input.isSending) return false;
  return Boolean(input.text.trim()) || input.hasAttachment;
}

/**
 * Whether a chat poll response was requested for a shipment/channel the
 * user has since navigated away from. Both ChatCenter.tsx/App.tsx (which
 * use a `cancelled` boolean captured by the effect's cleanup) and
 * DriverApplication.tsx (which compares against a ref that always holds
 * the current shipment id) are, in effect, checking exactly this — this
 * is the ref-comparison form, used directly by DriverApplication.tsx's two
 * poll loops. A request fired for `requestedKey` that resolves after the
 * user has moved on to a different `currentKey` must be discarded rather
 * than applied, or it can overwrite the new thread with the old one's data.
 */
export function isStaleChatPollResponse(
  currentKey: string | null,
  requestedKey: string | null
): boolean {
  return currentKey !== requestedKey;
}

export interface ChatPollState<TMessage> {
  messages: TMessage[];
  hasLoadedOnce: boolean;
  pollError: boolean;
}

/**
 * The only state transition a successful poll may produce: the new
 * messages replace the old ones, the channel is now known to have loaded
 * at least once, and any previous error clears.
 */
export function applySuccessfulChatPoll<TMessage>(messages: TMessage[]): ChatPollState<TMessage> {
  return { messages, hasLoadedOnce: true, pollError: false };
}

/**
 * The only state transition a failed poll (non-OK response, or a thrown
 * error) may produce: `pollError` flips to true and NOTHING else changes —
 * in particular `messages` is carried over unchanged. This is the specific
 * invariant that fixes ChatCenter.tsx's previous behavior of wiping a
 * populated thread to an empty array on any transient failure.
 */
export function applyFailedChatPoll<TMessage>(prev: ChatPollState<TMessage>): ChatPollState<TMessage> {
  return { ...prev, pollError: true };
}

/**
 * Whether a "mark channel read" callback (e.g. ChatCenter.tsx's
 * onChannelRead, which lets the parent optimistically clear this admin's
 * local unread badge) should actually fire. Previously this was called
 * unconditionally after POST /chat/seen regardless of its response status,
 * so a failed mark-seen write could still clear the local unread badge
 * even though the server never recorded the read.
 */
export function shouldConfirmChannelRead(markSeenResponseOk: boolean): boolean {
  return markSeenResponseOk === true;
}
