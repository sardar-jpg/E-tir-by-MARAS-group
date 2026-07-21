/**
 * adaptivePolling.ts — Performance Phase 1.
 *
 * Pure, framework-agnostic building blocks for visibility-aware, adaptive
 * polling. Two pieces:
 *
 *   1. A small state machine (nextPollingState / intervalForState) that
 *      progresses a polling interval along a bounded schedule when nothing
 *      changes, snaps back to the fast interval when something does, and does
 *      bounded exponential backoff on transient errors.
 *
 *   2. A PollingController that drives a single self-rescheduling timer from
 *      that state machine and from foreground/online signals. It touches NO
 *      DOM and NO React — every side effect (the timer, the clock, the
 *      poll itself, and the visible/online predicates) is injected — so the
 *      whole thing is deterministically unit-testable in the node harness.
 *      The React/DOM wiring lives in src/hooks/usePolling.ts and is a thin
 *      adapter over this controller.
 *
 * Nothing here changes business rules; it only decides WHEN to re-fetch.
 */

/** Default bounded chat/data schedule: fast when active, backing off while idle. */
export const DEFAULT_POLL_SCHEDULE: readonly number[] = [3000, 5000, 10000, 20000, 30000];

export interface BackoffConfig {
  /** First transient-error delay. */
  baseMs: number;
  /** Hard ceiling for error backoff. */
  maxMs: number;
}

export const DEFAULT_BACKOFF: BackoffConfig = { baseMs: 3000, maxMs: 30000 };

export interface PollingState {
  /** Index into the schedule for the no-change progression. */
  stepIndex: number;
  /** Consecutive transient errors (drives exponential backoff). */
  errorCount: number;
  mode: "normal" | "error";
}

export function initialPollingState(): PollingState {
  return { stepIndex: 0, errorCount: 0, mode: "normal" };
}

export type PollEvent =
  /** A successful poll whose payload carried no meaningful change. */
  | { type: "unchanged" }
  /** New / meaningful data arrived. */
  | { type: "changed" }
  /**
   * A hard reset to the fast interval: foreground resume, network back
   * online, user sent a message, chat/shipment context changed, or a manual
   * refresh.
   */
  | { type: "reset" }
  /** A transient error (network/5xx). */
  | { type: "error" };

/** Advance the state machine. Pure. */
export function nextPollingState(
  state: PollingState,
  event: PollEvent,
  schedule: readonly number[] = DEFAULT_POLL_SCHEDULE
): PollingState {
  const lastIndex = Math.max(0, schedule.length - 1);
  switch (event.type) {
    case "unchanged":
      return { stepIndex: Math.min(state.stepIndex + 1, lastIndex), errorCount: 0, mode: "normal" };
    case "changed":
    case "reset":
      return { stepIndex: 0, errorCount: 0, mode: "normal" };
    case "error":
      return { stepIndex: state.stepIndex, errorCount: state.errorCount + 1, mode: "error" };
    default:
      return state;
  }
}

/** The delay (ms) implied by the current state. Pure. */
export function intervalForState(
  state: PollingState,
  schedule: readonly number[] = DEFAULT_POLL_SCHEDULE,
  backoff: BackoffConfig = DEFAULT_BACKOFF
): number {
  if (state.mode === "error") {
    const exp = backoff.baseMs * Math.pow(2, Math.max(0, state.errorCount - 1));
    return Math.min(exp, backoff.maxMs);
  }
  const idx = Math.min(Math.max(0, state.stepIndex), Math.max(0, schedule.length - 1));
  return schedule[idx] ?? schedule[schedule.length - 1] ?? DEFAULT_BACKOFF.baseMs;
}

// ---------------------------------------------------------------------------
// PollingController — a single self-rescheduling timer, no DOM, no React.
// ---------------------------------------------------------------------------

export type TimerHandle = unknown;

export interface PollingControllerDeps {
  /**
   * Perform one poll. Resolve `true` when the response carried a meaningful
   * change (snap back to fast), `false`/`void` when unchanged (back off).
   * Reject to signal a transient error (exponential backoff).
   */
  poll: () => Promise<boolean | void>;
  setTimer: (cb: () => void, ms: number) => TimerHandle;
  clearTimer: (h: TimerHandle) => void;
  schedule?: readonly number[];
  backoff?: BackoffConfig;
  /** Deterministic jitter hook for tests; default adds ±10% (see usePolling). */
  jitter?: (ms: number) => number;
  /** Foreground predicate; default always-visible (server/non-DOM). */
  isVisible?: () => boolean;
  /** Network predicate; default always-online. */
  isOnline?: () => boolean;
}

/**
 * Drives poll() on an adaptive cadence. Guarantees:
 *  - at most ONE timer is ever pending (every schedule clears the previous
 *    handle first) — repeated visibility/online transitions never stack
 *    duplicate intervals;
 *  - polling is paused while hidden or offline;
 *  - a transition back to visible/online performs exactly ONE immediate
 *    refresh and resets to the fast interval;
 *  - overlapping polls are suppressed (a slow poll won't be double-fired).
 */
export class PollingController {
  private readonly poll: PollingControllerDeps["poll"];
  private readonly setTimer: PollingControllerDeps["setTimer"];
  private readonly clearTimer: PollingControllerDeps["clearTimer"];
  private readonly schedule: readonly number[];
  private readonly backoff: BackoffConfig;
  private readonly jitter: (ms: number) => number;
  private readonly isVisible: () => boolean;
  private readonly isOnline: () => boolean;

  private state: PollingState = initialPollingState();
  private handle: TimerHandle | null = null;
  private started = false;
  private inFlight = false;

  constructor(deps: PollingControllerDeps) {
    this.poll = deps.poll;
    this.setTimer = deps.setTimer;
    this.clearTimer = deps.clearTimer;
    this.schedule = deps.schedule ?? DEFAULT_POLL_SCHEDULE;
    this.backoff = deps.backoff ?? DEFAULT_BACKOFF;
    this.jitter = deps.jitter ?? ((ms) => ms);
    this.isVisible = deps.isVisible ?? (() => true);
    this.isOnline = deps.isOnline ?? (() => true);
  }

  /** True when we are allowed to be actively polling right now. */
  private get active(): boolean {
    return this.started && this.isVisible() && this.isOnline();
  }

  /** Begin polling. Schedules the first tick at the fast interval if active. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.state = initialPollingState();
    this.wasActive = this.active;
    if (this.active) this.scheduleNext();
  }

  /** Stop polling and clear any pending timer. Safe to call repeatedly. */
  stop(): void {
    this.started = false;
    this.wasActive = false;
    this.clearPending();
  }

  /** Foreground/background signal. Resuming does one immediate refresh. */
  setVisible(visible: boolean): void {
    this.onActivenessSignal(visible, this.isOnline());
  }

  /** Online/offline signal. Coming online does one immediate refresh. */
  setOnline(online: boolean): void {
    this.onActivenessSignal(this.isVisible(), online);
  }

  /**
   * Hard reset to the fast interval (user sent a message, changed chat/
   * shipment context, or triggered a manual refresh). Reschedules; does not
   * force an immediate poll unless `immediate` is set.
   */
  reset(immediate = false): void {
    this.state = initialPollingState();
    if (!this.active) return;
    if (immediate) this.pollNow();
    else this.scheduleNext();
  }

  /** Poll right now (if active), then resume the adaptive schedule. */
  pollNow(): void {
    if (!this.active) return;
    this.clearPending();
    void this.runPoll();
  }

  // The predicates (isVisible/isOnline) are the source of truth; this just
  // reacts to an edge. We recompute `active` after applying the new signal by
  // reading the predicates, so callers wire setVisible/setOnline to update
  // whatever those predicates read (the hook passes live closures).
  private wasActive = false;
  private onActivenessSignal(_visible: boolean, _online: boolean): void {
    const nowActive = this.active;
    if (nowActive && !this.wasActive) {
      // inactive -> active: one immediate refresh at the fast interval.
      this.state = initialPollingState();
      this.wasActive = true;
      this.pollNow();
    } else if (!nowActive && this.wasActive) {
      // active -> inactive: pause.
      this.wasActive = false;
      this.clearPending();
    } else {
      this.wasActive = nowActive;
    }
  }

  private clearPending(): void {
    if (this.handle !== null) {
      this.clearTimer(this.handle);
      this.handle = null;
    }
  }

  private scheduleNext(): void {
    this.clearPending(); // never leave two timers pending
    if (!this.active) return;
    const ms = Math.max(0, Math.round(this.jitter(intervalForState(this.state, this.schedule, this.backoff))));
    this.handle = this.setTimer(() => {
      this.handle = null;
      void this.runPoll();
    }, ms);
  }

  private async runPoll(): Promise<void> {
    if (!this.active || this.inFlight) return;
    this.inFlight = true;
    try {
      const changed = await this.poll();
      this.state = nextPollingState(this.state, { type: changed ? "changed" : "unchanged" }, this.schedule);
    } catch {
      this.state = nextPollingState(this.state, { type: "error" }, this.schedule);
    } finally {
      this.inFlight = false;
      // Only keep the loop going while still active/started.
      if (this.active) this.scheduleNext();
    }
  }

  /** Test/inspection helpers (no sensitive data). */
  getState(): PollingState {
    return { ...this.state };
  }
  isPending(): boolean {
    return this.handle !== null;
  }
}
