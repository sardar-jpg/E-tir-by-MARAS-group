/**
 * chatDisplay.ts
 *
 * feature/chat-ui-ux-phase2
 *
 * Pure, testable display-only logic shared by all four chat surfaces
 * (ChatCenter.tsx, App.tsx, DriverApplication.tsx, ClientDashboard.tsx):
 * date-separator grouping/labels, the "smart auto-scroll" near-bottom
 * threshold check, and auto-growing textarea height computation. No
 * business/permission/notification/attachment logic lives here — see
 * chatVisibility.ts / chatMessageValidation.ts / chatComposerState.ts for
 * that; this file is UI presentation only.
 */

function dateKeyFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Calendar-day key in the viewer's local timezone, e.g. "2026-07-13". */
export function localDateKey(isoTimestamp: string): string {
  return dateKeyFromDate(new Date(isoTimestamp));
}

/**
 * Whether a date separator should render immediately before the message
 * timestamped `currentTimestamp`, given the immediately preceding
 * message's timestamp (or `undefined` for the very first message in a
 * thread, which always gets one). Messages are compared by local calendar
 * day, not a rolling 24-hour window — a message at 11:59pm and one at
 * 12:01am the same night are on different calendar days and get a
 * separator between them; two messages 20 hours apart but on the same
 * calendar day (e.g. 1am and 9pm) do not.
 */
export function shouldShowDateSeparator(currentTimestamp: string, previousTimestamp?: string): boolean {
  if (!previousTimestamp) return true;
  return localDateKey(currentTimestamp) !== localDateKey(previousTimestamp);
}

export type SupportedChatLang = "en" | "tr" | "ar";

/**
 * "Today" / "Yesterday" / a locale-formatted date for a date-separator
 * label. `now` is an explicit parameter (defaulting to the real current
 * time) purely so this stays deterministic and testable — callers should
 * never need to pass it themselves outside a test.
 */
export function formatDateSeparatorLabel(
  isoTimestamp: string,
  lang: SupportedChatLang,
  now: Date = new Date()
): string {
  const targetKey = dateKeyFromDate(new Date(isoTimestamp));
  const todayKey = dateKeyFromDate(now);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayKey = dateKeyFromDate(yesterday);

  if (targetKey === todayKey) {
    return lang === "tr" ? "Bugün" : lang === "ar" ? "اليوم" : "Today";
  }
  if (targetKey === yesterdayKey) {
    return lang === "tr" ? "Dün" : lang === "ar" ? "أمس" : "Yesterday";
  }
  const locale = lang === "tr" ? "tr-TR" : lang === "ar" ? "ar-IQ" : "en-US";
  return new Date(isoTimestamp).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
}

/** Default "close enough to the bottom to keep auto-scrolling" threshold, in pixels. */
export const NEAR_BOTTOM_THRESHOLD_PX = 120;

/**
 * The core "smart auto-scroll" decision: given how far a scrollable
 * message container currently is from its own bottom
 * (`scrollHeight - scrollTop - clientHeight`, measured BEFORE a new
 * message is appended), whether an incoming message should still
 * auto-scroll the view to the new bottom. When the viewer has scrolled up
 * to read older history (distance greater than the threshold), an
 * incoming message must never yank them back down.
 */
export function isNearBottom(distanceFromBottomPx: number, thresholdPx: number = NEAR_BOTTOM_THRESHOLD_PX): boolean {
  return distanceFromBottomPx <= thresholdPx;
}

/**
 * Auto-growing textarea height, clamped between a minimum (one line) and
 * a maximum (so a very long paste/message doesn't take over the screen —
 * the textarea scrolls internally past that point). `contentScrollHeight`
 * is the textarea's own `scrollHeight` read after resetting its height to
 * "auto", per the standard auto-grow technique.
 */
export function computeAutoGrowHeightPx(
  contentScrollHeight: number,
  minHeightPx: number,
  maxHeightPx: number
): number {
  return Math.min(Math.max(contentScrollHeight, minHeightPx), maxHeightPx);
}
