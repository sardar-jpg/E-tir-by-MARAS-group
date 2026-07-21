import {
  PollingController,
  DEFAULT_POLL_SCHEDULE,
  DEFAULT_BACKOFF,
  type BackoffConfig,
} from "../lib/adaptivePolling";

/**
 * attachBrowserPolling — Performance Phase 1.
 *
 * Imperative adapter that wires a (fully unit-tested) PollingController to the
 * browser's foreground/online signals and starts it. Returns a `stop()` that
 * clears the timer AND removes every listener. Use this INSIDE an existing
 * `useEffect` when the poll function is already defined there (App.tsx,
 * ChatCenter, DriverApplication), so the change stays local and no fetch
 * logic has to be lifted out. `usePolling` (the React hook) is built on this
 * same primitive.
 *
 * Capacitor: `@capacitor/app` is not a project dependency; the WebView emits
 * standard `visibilitychange` when backgrounded/foregrounded, so browser
 * visibility handling is also the mobile app-state handling.
 */
export interface BrowserPollingOptions {
  /** Resolve true = meaningful change (stay fast); false/void = unchanged. */
  poll: () => Promise<boolean | void>;
  schedule?: readonly number[];
  backoff?: BackoffConfig;
  /** ±ratio of jitter to de-synchronize clients (default 0.1). */
  jitterRatio?: number;
}

export interface AttachedPolling {
  controller: PollingController;
  reset: (immediate?: boolean) => void;
  pollNow: () => void;
  /** Stop polling and remove all browser listeners. */
  stop: () => void;
}

const docVisible = (): boolean =>
  typeof document === "undefined" ? true : document.visibilityState !== "hidden";
const navOnline = (): boolean =>
  typeof navigator === "undefined" || navigator.onLine === undefined ? true : navigator.onLine !== false;

export function attachBrowserPolling(opts: BrowserPollingOptions): AttachedPolling {
  const jitterRatio = opts.jitterRatio ?? 0.1;
  const controller = new PollingController({
    poll: opts.poll,
    setTimer: (cb, ms) => (typeof window === "undefined" ? setTimeout(cb, ms) : window.setTimeout(cb, ms)),
    clearTimer: (h) => (typeof window === "undefined" ? clearTimeout(h as any) : window.clearTimeout(h as number)),
    schedule: opts.schedule ?? DEFAULT_POLL_SCHEDULE,
    backoff: opts.backoff ?? DEFAULT_BACKOFF,
    jitter: (ms) => (jitterRatio ? Math.max(0, ms * (1 + (Math.random() * 2 - 1) * jitterRatio)) : ms),
    isVisible: docVisible,
    isOnline: navOnline,
  });

  const onVisibility = () => controller.setVisible(docVisible());
  const onOnline = () => controller.setOnline(true);
  const onOffline = () => controller.setOnline(false);

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
  }

  controller.start();

  return {
    controller,
    reset: (immediate = false) => controller.reset(immediate),
    pollNow: () => controller.pollNow(),
    stop: () => {
      controller.stop();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
      }
    },
  };
}
