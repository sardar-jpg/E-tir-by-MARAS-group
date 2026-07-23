import { describe, it, expect } from "vitest";
import { deriveJourneyProgress, JOURNEY_MILESTONE_ORDER } from "./journeyMilestones";

const get = (r: ReturnType<typeof deriveJourneyProgress>, key: string) =>
  r.milestones.find(m => m.key === key)!;

describe("deriveJourneyProgress — structure", () => {
  it("always returns all 8 milestones in operational order", () => {
    const r = deriveJourneyProgress("New", []);
    expect(r.milestones.map(m => m.key)).toEqual([...JOURNEY_MILESTONE_ORDER]);
  });
});

describe("pre-departure shipment", () => {
  it("marks origin current and everything else pending; 0% estimated", () => {
    const r = deriveJourneyProgress("Loading", [{ status: "New", timestamp: "2026-07-01T08:00:00Z" }]);
    expect(get(r, "origin").state).toBe("current");
    for (const k of ["departed", "border_arrival", "customs_clearance", "border_exit", "in_transit", "destination_arrival", "delivered"]) {
      expect(get(r, k).state).toBe("pending");
    }
    expect(r.estimatedPercent).toBe(0);
  });
});

describe("in transit before the border", () => {
  it("completes origin+departed, in_transit is current, border stages stay PENDING (never GPS-inferred)", () => {
    const r = deriveJourneyProgress("In Transit", [
      { status: "New", timestamp: "2026-07-01T08:00:00Z" },
      { status: "In Transit", timestamp: "2026-07-02T09:00:00Z" },
    ]);
    expect(get(r, "origin").state).toBe("completed");
    expect(get(r, "departed").state).toBe("completed");
    expect(get(r, "border_arrival").state).toBe("pending");
    expect(get(r, "customs_clearance").state).toBe("pending");
    expect(get(r, "border_exit").state).toBe("pending");
    expect(get(r, "in_transit").state).toBe("current");
    expect(get(r, "destination_arrival").state).toBe("pending");
    expect(r.estimatedPercent).toBe(Math.round((2 / 8) * 100));
  });
});

describe("recorded border and customs stages", () => {
  it("Border Crossing as the CURRENT status marks border_arrival current, not completed", () => {
    const r = deriveJourneyProgress("Border Crossing", [
      { status: "In Transit", timestamp: "2026-07-02T09:00:00Z" },
      { status: "Border Crossing", timestamp: "2026-07-03T10:00:00Z" },
    ]);
    expect(get(r, "border_arrival").state).toBe("current");
    expect(get(r, "customs_clearance").state).toBe("pending");
    expect(get(r, "border_exit").state).toBe("pending");
  });

  it("recorded Customs Clearance completes border_arrival and marks customs current", () => {
    const r = deriveJourneyProgress("Customs Clearance", [
      { status: "Border Crossing", timestamp: "2026-07-03T10:00:00Z" },
      { status: "Customs Clearance", timestamp: "2026-07-03T14:00:00Z" },
    ]);
    expect(get(r, "border_arrival").state).toBe("completed");
    expect(get(r, "customs_clearance").state).toBe("current");
    // No recorded movement after customs yet -> exit not confirmed.
    expect(get(r, "border_exit").state).toBe("pending");
  });

  it("border_exit completes ONLY from a recorded post-border movement entry", () => {
    const r = deriveJourneyProgress("In Transit", [
      { status: "Border Crossing", timestamp: "2026-07-03T10:00:00Z" },
      { status: "Customs Clearance", timestamp: "2026-07-03T14:00:00Z" },
      { status: "In Transit", timestamp: "2026-07-03T18:00:00Z" },
    ]);
    expect(get(r, "border_exit").state).toBe("completed");
    expect(get(r, "border_exit").timestamp).toBe("2026-07-03T18:00:00Z");
    expect(get(r, "in_transit").state).toBe("current");
  });

  it("an In Transit entry BEFORE the border does not confirm border_exit", () => {
    const r = deriveJourneyProgress("Customs Clearance", [
      { status: "In Transit", timestamp: "2026-07-02T09:00:00Z" },
      { status: "Border Crossing", timestamp: "2026-07-03T10:00:00Z" },
      { status: "Customs Clearance", timestamp: "2026-07-03T14:00:00Z" },
    ]);
    expect(get(r, "border_exit").state).toBe("pending");
  });
});

describe("journey moved past a stage WITHOUT data → unknown, never completed", () => {
  it("Arrived with no recorded border/customs shows those stages as unknown", () => {
    const r = deriveJourneyProgress("Arrived", [
      { status: "In Transit", timestamp: "2026-07-02T09:00:00Z" },
      { status: "Arrived", timestamp: "2026-07-05T09:00:00Z" },
    ]);
    expect(get(r, "border_arrival").state).toBe("unknown");
    expect(get(r, "customs_clearance").state).toBe("unknown");
    expect(get(r, "border_exit").state).toBe("unknown");
    expect(get(r, "destination_arrival").state).toBe("current");
    expect(get(r, "in_transit").state).toBe("completed");
  });
});

describe("terminal shipment", () => {
  it("Delivered completes the lifecycle milestones it entails; undated border stays unknown", () => {
    const r = deriveJourneyProgress("Delivered", [
      { status: "In Transit", timestamp: "2026-07-02T09:00:00Z" },
      { status: "Arrived", timestamp: "2026-07-05T09:00:00Z" },
      { status: "Delivered", timestamp: "2026-07-05T15:00:00Z" },
    ]);
    expect(get(r, "origin").state).toBe("completed");
    expect(get(r, "departed").state).toBe("completed");
    expect(get(r, "in_transit").state).toBe("completed");
    expect(get(r, "destination_arrival").state).toBe("completed");
    expect(get(r, "delivered").state).toBe("completed");
    expect(get(r, "border_arrival").state).toBe("unknown");
  });

  it("full recorded corridor journey reaches 100%", () => {
    const r = deriveJourneyProgress("Delivered", [
      { status: "New", timestamp: "2026-07-01T08:00:00Z" },
      { status: "In Transit", timestamp: "2026-07-02T09:00:00Z" },
      { status: "Border Crossing", timestamp: "2026-07-03T10:00:00Z" },
      { status: "Customs Clearance", timestamp: "2026-07-03T14:00:00Z" },
      { status: "In Transit", timestamp: "2026-07-03T18:00:00Z" },
      { status: "Arrived", timestamp: "2026-07-05T09:00:00Z" },
      { status: "Delivered", timestamp: "2026-07-05T15:00:00Z" },
    ]);
    expect(r.milestones.every(m => m.state === "completed")).toBe(true);
    expect(r.estimatedPercent).toBe(100);
  });
});

describe("percentage derivation", () => {
  it("counts ONLY completed milestones (current ones don't inflate the estimate)", () => {
    const r = deriveJourneyProgress("Border Crossing", [
      { status: "In Transit", timestamp: "2026-07-02T09:00:00Z" },
      { status: "Border Crossing", timestamp: "2026-07-03T10:00:00Z" },
    ]);
    // completed: origin, departed => 2/8
    expect(r.estimatedPercent).toBe(25);
  });
});

describe("robustness", () => {
  it("tolerates a missing/empty timeline (evidence = current status only)", () => {
    const r = deriveJourneyProgress("In Transit", undefined);
    expect(get(r, "departed").state).toBe("completed");
    expect(get(r, "in_transit").state).toBe("current");
    expect(get(r, "border_exit").state).toBe("pending");
  });

  it("ignores unparsable timestamps rather than fabricating order", () => {
    const r = deriveJourneyProgress("In Transit", [
      { status: "Border Crossing", timestamp: "not-a-date" },
      { status: "In Transit", timestamp: "also-bad" },
    ]);
    // Border recorded (status set) but no valid ordering data -> exit not confirmed.
    expect(get(r, "border_arrival").state).toBe("completed");
    expect(get(r, "border_exit").state).toBe("pending");
  });
});
