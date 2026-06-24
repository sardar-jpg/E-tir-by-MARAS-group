import { useState, useEffect } from "react";

/**
 * Reactively tracks whether the viewport is narrower than `breakpoint`.
 *
 * This replaces the old pattern of a single, one-time
 * `window.innerWidth < N` check computed at render time. That approach
 * has a real failure mode on physical devices: if the WebView hasn't
 * finished settling its real viewport dimensions by the time the check
 * runs (a known timing difference between the iOS Simulator and real
 * hardware, especially when loading a remote https:// URL rather than
 * bundled local files), the check can read a stale or incorrect width
 * and lock the UI into the wrong layout for the rest of the session,
 * since nothing ever re-evaluates it.
 *
 * This hook re-checks on mount (after layout has settled) and on every
 * resize/orientation change, so it self-corrects regardless of initial
 * timing quirks.
 */
export function useIsMobile(breakpoint: number = 768): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < breakpoint;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const check = () => setIsMobile(window.innerWidth < breakpoint);

    // Re-check shortly after mount too, in case the WebView's viewport
    // wasn't fully settled at the moment of the initial render.
    check();
    const settleTimer = window.setTimeout(check, 150);

    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);

    return () => {
      window.clearTimeout(settleTimer);
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, [breakpoint]);

  return isMobile;
}
