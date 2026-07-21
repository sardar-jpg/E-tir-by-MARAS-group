import { useEffect, useRef } from "react";
import { DEFAULT_POLL_SCHEDULE, DEFAULT_BACKOFF, type BackoffConfig } from "../lib/adaptivePolling";
import { attachBrowserPolling, type AttachedPolling } from "./browserPolling";

/**
 * usePolling — Performance Phase 1.
 *
 * A thin React/DOM adapter over the framework-agnostic, fully unit-tested
 * PollingController (src/lib/adaptivePolling.ts). ALL scheduling, backoff,
 * pause/resume, no-duplicate-timer, and no-overlap logic lives in the
 * controller (see adaptivePolling.test.ts). This hook only:
 *   - feeds the controller the browser's foreground/online signals
 *     (`visibilitychange`, `online`, `offline`), and
 *   - starts/stops it with the component's lifecycle.
 *
 * Capacitor note: `@capacitor/app` is NOT a dependency of this project, so we
 * deliberately do not import it. Capacitor's WebView emits the standard
 * `visibilitychange`/`document.hidden` transitions when the native app is
 * backgrounded/foregrounded, so browser visibility handling doubles as the
 * mobile app-state handling. If `@capacitor/app` is added later, its
 * `appStateChange` listener can call the returned `reset`/`pollNow` handle —
 * no change to this hook's contract is required.
 *
 * The hook never changes WHAT is fetched or any business rule — only WHEN.
 */
export interface UsePollingOptions {
  /**
   * Perform one poll. Resolve `true` when the response carried a meaningful
   * change (stay fast), `false`/`void` when nothing changed (back off).
   * Reject to signal a transient error (bounded exponential backoff).
   * The latest closure is always used — capture fresh state freely.
   */
  poll: () => Promise<boolean | void>;
  /** When false the poller is fully stopped (default true). */
  enabled?: boolean;
  /** Bounded interval schedule; defaults to 3s→5s→10s→20s→30s. */
  schedule?: readonly number[];
  backoff?: BackoffConfig;
  /** ±ratio of random jitter to de-synchronize clients (default 0.1 = ±10%). */
  jitterRatio?: number;
  /**
   * When this value changes, the poller resets to the fast interval and does
   * one immediate refresh — use it for the active chat/shipment context id.
   */
  resetKey?: unknown;
}

export interface UsePollingHandle {
  /** Reset to the fast interval (message sent / manual refresh). */
  reset: (immediate?: boolean) => void;
  /** Force one immediate poll (if currently active). */
  pollNow: () => void;
}

export function usePolling(options: UsePollingOptions): UsePollingHandle {
  const {
    schedule = DEFAULT_POLL_SCHEDULE,
    backoff = DEFAULT_BACKOFF,
    jitterRatio = 0.1,
    enabled = true,
    resetKey,
  } = options;

  // Always call the freshest poll closure without re-attaching.
  const pollRef = useRef(options.poll);
  pollRef.current = options.poll;

  const attachedRef = useRef<AttachedPolling | null>(null);

  // Attach/detach with the `enabled` flag. attachBrowserPolling owns all the
  // browser-listener + timer wiring (and its own cleanup).
  useEffect(() => {
    if (!enabled) {
      attachedRef.current?.stop();
      attachedRef.current = null;
      return;
    }
    const attached = attachBrowserPolling({
      poll: () => pollRef.current(),
      schedule,
      backoff,
      jitterRatio,
    });
    attachedRef.current = attached;
    return () => {
      attached.stop();
      attachedRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // A context switch (active chat/shipment id) resets to fast + refreshes now.
  const firstResetKey = useRef(true);
  useEffect(() => {
    if (firstResetKey.current) {
      firstResetKey.current = false;
      return; // don't double-fire on mount
    }
    attachedRef.current?.reset(true);
  }, [resetKey]);

  return {
    reset: (immediate = false) => attachedRef.current?.reset(immediate),
    pollNow: () => attachedRef.current?.pollNow(),
  };
}
