import { describe, it, expect } from "vitest";
import { createToastTimer, type ToastTimerHandle } from "./toastTimer";

/** Deterministic fake timers: fire manually, track pending handles. */
function fakeTimers() {
  let seq = 1;
  const pending = new Map<number, { cb: () => void; ms: number }>();
  return {
    setTimer: (cb: () => void, ms: number): ToastTimerHandle => {
      const id = seq++;
      pending.set(id, { cb, ms });
      return id;
    },
    clearTimer: (h: ToastTimerHandle) => {
      pending.delete(h as number);
    },
    pendingCount: () => pending.size,
    /** Fire a specific pending timer (simulates an old timer going off). */
    fire: (h?: number) => {
      const id = h ?? [...pending.keys()][0];
      const t = pending.get(id);
      pending.delete(id);
      t?.cb();
    },
    lastHandle: () => Math.max(0, ...pending.keys()),
  };
}

function harness(delayMs = 3500) {
  const timers = fakeTimers();
  const changes: (string | null)[] = [];
  let visible: string | null = null;
  const timer = createToastTimer({
    onChange: (m) => {
      visible = m;
      changes.push(m);
    },
    delayMs,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  return { timer, timers, changes, get visible() { return visible; } };
}

describe("createToastTimer", () => {
  it("arms one dismiss timer on first show, and dismisses after the delay", () => {
    const h = harness(3500);
    h.timer.show("saved");
    expect(h.visible).toBe("saved");
    expect(h.timers.pendingCount()).toBe(1);
    expect(h.timer.isPending()).toBe(true);
    h.timers.fire();
    expect(h.visible).toBeNull();
    expect(h.timer.isPending()).toBe(false);
  });

  it("re-arm clears the previous timer — never two pending timers", () => {
    const h = harness();
    h.timer.show("first");
    h.timer.show("second");
    h.timer.show("third");
    expect(h.timers.pendingCount()).toBe(1);
    expect(h.visible).toBe("third");
  });

  it("an older timer can never dismiss a newer toast", () => {
    const h = harness();
    h.timer.show("first");
    const oldHandle = h.timers.lastHandle();
    h.timer.show("second");
    // The old handle was cleared on re-arm; even a stray fire of it is inert
    // (it no longer exists in the pending set).
    h.timers.fire(oldHandle); // no-op: already cleared
    expect(h.visible).toBe("second");
    // Only the NEW timer dismisses.
    h.timers.fire();
    expect(h.visible).toBeNull();
  });

  it("a repeated identical message stays visible for the full latest duration", () => {
    const h = harness();
    h.timer.show("uploading…");
    const firstHandle = h.timers.lastHandle();
    // Same text again shortly before the first timer would have fired: the
    // first timer is cancelled, so the toast is NOT cut short (this was the
    // exact defect in the old `prev === msg ? null : prev` guard).
    h.timer.show("uploading…");
    h.timers.fire(firstHandle); // stray old fire: inert
    expect(h.visible).toBe("uploading…");
    h.timers.fire(); // the latest timer completes the full duration
    expect(h.visible).toBeNull();
  });

  it("cancel() clears the pending timer without hiding the toast", () => {
    const h = harness();
    h.timer.show("sticky");
    h.timer.cancel();
    expect(h.timers.pendingCount()).toBe(0);
    expect(h.visible).toBe("sticky"); // still shown; just no auto-dismiss
  });

  it("dispose() clears the timer and dismisses — safe for unmount cleanup", () => {
    const h = harness();
    h.timer.show("bye");
    h.timer.dispose();
    expect(h.timers.pendingCount()).toBe(0);
    expect(h.visible).toBeNull();
    // Safe to call repeatedly.
    h.timer.dispose();
    expect(h.timers.pendingCount()).toBe(0);
  });

  it("honors the configured delay", () => {
    const timers = fakeTimers();
    let seenMs = 0;
    const t = createToastTimer({
      onChange: () => {},
      delayMs: 3000,
      setTimer: (cb, ms) => {
        seenMs = ms;
        return timers.setTimer(cb, ms);
      },
      clearTimer: timers.clearTimer,
    });
    t.show("x");
    expect(seenMs).toBe(3000);
  });
});
