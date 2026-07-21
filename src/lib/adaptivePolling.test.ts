import { describe, it, expect } from "vitest";
import {
  nextPollingState,
  intervalForState,
  initialPollingState,
  PollingController,
  DEFAULT_POLL_SCHEDULE,
  type PollingControllerDeps,
} from "./adaptivePolling";

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

/**
 * A deterministic harness: one pending timer at a time (the controller
 * guarantees this), a live visible/online flag, and a counted poll whose
 * result we control per call. `fire()` runs the pending timer and flushes
 * the async poll.
 */
function harness(pollImpl: (call: number) => boolean | void | Promise<boolean | void>) {
  let visible = true;
  let online = true;
  let seq = 1;
  const timers = new Map<number, { cb: () => void; ms: number }>();
  let pollCalls = 0;

  const deps: PollingControllerDeps = {
    poll: async () => pollImpl(++pollCalls),
    setTimer: (cb, ms) => {
      const id = seq++;
      timers.set(id, { cb, ms });
      return id;
    },
    clearTimer: (h) => {
      timers.delete(h as number);
    },
    jitter: (ms) => ms, // deterministic
    isVisible: () => visible,
    isOnline: () => online,
  };
  const ctl = new PollingController(deps);

  return {
    ctl,
    get pollCalls() {
      return pollCalls;
    },
    pendingCount: () => timers.size,
    pendingMs: () => {
      const vals = [...timers.values()];
      return vals.length ? vals[vals.length - 1].ms : null;
    },
    fire: async () => {
      const entries = [...timers.entries()];
      if (entries.length === 0) return;
      const [id, t] = entries[entries.length - 1];
      timers.delete(id);
      t.cb();
      await flush();
    },
    setVisible: (v: boolean) => {
      visible = v;
      ctl.setVisible(v);
    },
    setOnline: (v: boolean) => {
      online = v;
      ctl.setOnline(v);
    },
  };
}

describe("polling state machine", () => {
  it("unchanged climbs the schedule and stops at the ceiling", () => {
    let s = initialPollingState();
    const seen: number[] = [intervalForState(s)];
    for (let i = 0; i < 6; i++) {
      s = nextPollingState(s, { type: "unchanged" });
      seen.push(intervalForState(s));
    }
    expect(seen).toEqual([3000, 5000, 10000, 20000, 30000, 30000, 30000]);
  });

  it("changed and reset snap back to the fast interval", () => {
    let s = initialPollingState();
    for (let i = 0; i < 4; i++) s = nextPollingState(s, { type: "unchanged" });
    expect(intervalForState(s)).toBe(30000);
    expect(intervalForState(nextPollingState(s, { type: "changed" }))).toBe(3000);
    expect(intervalForState(nextPollingState(s, { type: "reset" }))).toBe(3000);
  });

  it("errors back off exponentially up to the max", () => {
    let s = initialPollingState();
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      s = nextPollingState(s, { type: "error" });
      seen.push(intervalForState(s));
    }
    expect(seen).toEqual([3000, 6000, 12000, 24000, 30000, 30000]); // capped at 30000
  });

  it("a success after errors returns to the normal schedule", () => {
    let s = initialPollingState();
    s = nextPollingState(s, { type: "error" });
    s = nextPollingState(s, { type: "error" });
    expect(s.mode).toBe("error");
    s = nextPollingState(s, { type: "unchanged" });
    expect(s.mode).toBe("normal");
    expect(intervalForState(s)).toBe(5000); // stepIndex advanced by the success
  });
});

describe("PollingController lifecycle", () => {
  it("unchanged responses lengthen the interval; changed resets it", async () => {
    const h = harness(() => false); // always unchanged
    h.ctl.start();
    expect(h.pendingMs()).toBe(3000);
    await h.fire();
    expect(h.pendingMs()).toBe(5000);
    await h.fire();
    expect(h.pendingMs()).toBe(10000);
    // Now something changes:
    const h2 = harness((n) => n >= 2); // 1st unchanged, 2nd changed
    h2.ctl.start();
    await h2.fire(); // unchanged -> 5000
    expect(h2.pendingMs()).toBe(5000);
    await h2.fire(); // changed -> back to 3000
    expect(h2.pendingMs()).toBe(3000);
  });

  it("reset() (message sent / context change / manual) returns to fast interval without an extra poll", async () => {
    const h = harness(() => false);
    h.ctl.start();
    await h.fire(); // 5000
    await h.fire(); // 10000
    expect(h.pendingMs()).toBe(10000);
    const before = h.pollCalls;
    h.ctl.reset(); // e.g. user sent a message
    expect(h.pendingMs()).toBe(3000);
    expect(h.pollCalls).toBe(before); // no immediate poll fired
  });

  it("hidden pauses polling; returning visible does exactly one immediate refresh and resumes fast", async () => {
    let changeNext = false;
    const h = harness(() => {
      const c = changeNext;
      changeNext = false;
      return c;
    });
    h.ctl.start();
    await h.fire(); // unchanged -> 5000
    await h.fire(); // unchanged -> 10000
    expect(h.pendingMs()).toBe(10000);
    expect(h.pendingCount()).toBe(1);
    h.setVisible(false);
    expect(h.pendingCount()).toBe(0); // paused
    const before = h.pollCalls;
    changeNext = true; // the resume refresh reports a change
    h.setVisible(true);
    await flush();
    expect(h.pollCalls).toBe(before + 1); // exactly one immediate refresh
    // State was reset to fast on resume; the changed result keeps it fast.
    expect(h.pendingMs()).toBe(3000);
  });

  it("offline pauses network polling; back online triggers one refresh", async () => {
    const h = harness(() => false);
    h.ctl.start();
    await h.fire();
    expect(h.pendingCount()).toBe(1);
    h.setOnline(false);
    expect(h.pendingCount()).toBe(0);
    const before = h.pollCalls;
    h.setOnline(true);
    await flush();
    expect(h.pollCalls).toBe(before + 1);
  });

  it("repeated same-state visibility transitions never stack duplicate timers", async () => {
    const h = harness(() => false);
    h.ctl.start();
    const before = h.pollCalls;
    h.setVisible(true);
    h.setVisible(true);
    h.setVisible(true);
    await flush();
    expect(h.pendingCount()).toBe(1); // still exactly one
    expect(h.pollCalls).toBe(before); // no spurious immediate polls
  });

  it("error backs off then recovers", async () => {
    let fail = true;
    const h = harness(() => {
      if (fail) throw new Error("transient");
      return false;
    });
    h.ctl.start();
    expect(h.pendingMs()).toBe(3000);
    await h.fire(); // error 1 -> 3000
    expect(h.pendingMs()).toBe(3000);
    await h.fire(); // error 2 -> 6000
    expect(h.pendingMs()).toBe(6000);
    fail = false;
    await h.fire(); // recovers
    expect(h.ctl.getState().mode).toBe("normal");
  });

  it("stop() clears the timer and prevents further polls", async () => {
    const h = harness(() => false);
    h.ctl.start();
    await h.fire();
    h.ctl.stop();
    expect(h.pendingCount()).toBe(0);
    const before = h.pollCalls;
    // Even a stray manual pollNow after stop is inert (not active).
    h.ctl.pollNow();
    await flush();
    expect(h.pollCalls).toBe(before);
  });

  it("starting while hidden does not poll; becoming visible then starts", async () => {
    const h = harness(() => false);
    h.setVisible(false);
    h.ctl.start();
    expect(h.pendingCount()).toBe(0);
    expect(h.pollCalls).toBe(0);
    h.setVisible(true);
    await flush();
    expect(h.pollCalls).toBe(1); // immediate refresh on activation
  });

  it("does not overlap a slow poll with a second fire", async () => {
    let resolve!: (v: boolean) => void;
    const h = harness(
      () =>
        new Promise<boolean>((r) => {
          resolve = r;
        })
    );
    h.ctl.start();
    await h.fire(); // starts a poll that hasn't resolved yet
    // No pending timer while in-flight, and pollNow is suppressed.
    h.ctl.pollNow();
    expect(h.pollCalls).toBe(1);
    resolve(false);
    await flush();
    expect(h.pendingCount()).toBe(1); // reschedules after completion
  });
});

it("DEFAULT_POLL_SCHEDULE is the documented bounded schedule", () => {
  expect(DEFAULT_POLL_SCHEDULE).toEqual([3000, 5000, 10000, 20000, 30000]);
});
