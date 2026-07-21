/**
 * toastTimer.ts — Performance Phase 3.
 *
 * One dismiss timer per toast surface. Every triggerToast used to schedule a
 * bare setTimeout with no handle: timers were never cancelled, so an OLDER
 * timer could dismiss a NEWER toast early (App.tsx's `prev === msg` guard
 * only protected *different* messages — a repeated identical toast was still
 * cut short; DriverApplication/PublicTracking/AdminPanel had no guard at
 * all). This controller re-arms a single timer instead: showing a toast
 * always cancels the previous timer first, so whatever is on screen always
 * gets its full duration, and dispose() (component unmount) clears the
 * pending timer outright.
 *
 * Framework-independent: the timer functions are injectable so the behavior
 * is deterministically unit-tested in the node harness; components hold one
 * instance in a ref and pass their existing setToast + duration unchanged.
 */

export type ToastTimerHandle = unknown;

export interface ToastTimerDeps {
  /** Called with the message to show, and with null to dismiss. */
  onChange: (message: string | null) => void;
  /** Dismiss delay in ms (each component keeps its existing duration). */
  delayMs: number;
  /** Injectable timer fns (default: global setTimeout/clearTimeout). */
  setTimer?: (cb: () => void, ms: number) => ToastTimerHandle;
  clearTimer?: (h: ToastTimerHandle) => void;
}

export interface ToastTimer {
  /** Show a message and (re)arm the single dismiss timer. */
  show: (message: string) => void;
  /** Cancel any pending dismiss timer (does not touch the visible message). */
  cancel: () => void;
  /** Cancel the timer and dismiss immediately — for component cleanup. */
  dispose: () => void;
  /** True while a dismiss timer is pending (test/inspection helper). */
  isPending: () => boolean;
}

export function createToastTimer(deps: ToastTimerDeps): ToastTimer {
  const setTimer = deps.setTimer ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const clearTimer = deps.clearTimer ?? ((h: ToastTimerHandle) => clearTimeout(h as any));
  let handle: ToastTimerHandle | null = null;

  const cancel = () => {
    if (handle !== null) {
      clearTimer(handle);
      handle = null;
    }
  };

  return {
    show(message: string) {
      // Re-arm: the previous timer (whatever toast it belonged to) can never
      // fire against this newer toast — including a repeat of the same text.
      cancel();
      deps.onChange(message);
      handle = setTimer(() => {
        handle = null;
        deps.onChange(null);
      }, deps.delayMs);
    },
    cancel,
    dispose() {
      cancel();
      deps.onChange(null);
    },
    isPending: () => handle !== null,
  };
}
