/**
 * journeyMilestones.ts
 *
 * Operations Center — honest Journey Progress derivation.
 *
 * The drawer shows a fixed 8-milestone operational timeline (border and
 * customs stages are operationally central to the Turkey↔Iraq eTIR
 * corridor):
 *
 *   Origin → Departed → Border Arrival → Customs Clearance → Border Exit
 *   → In Transit → Destination Arrival → Delivered
 *
 * HONESTY RULES (the reason this is a pure, unit-tested module):
 *  - A milestone is COMPLETED or CURRENT only when the shipment's RECORDED
 *    lifecycle data explicitly supports it — the current `status` plus the
 *    timestamped `timeline` entries the system already stores. Lifecycle
 *    entailment is allowed (a shipment recorded as Arrived has necessarily
 *    departed), but border/customs stages are NEVER entailed: they complete
 *    only when a 'Border Crossing' / 'Customs Clearance' status was actually
 *    recorded.
 *  - Border status is NEVER inferred from GPS proximity.
 *  - 'Border Exit' has no dedicated status; it completes only when the
 *    timeline explicitly records post-border movement (an In Transit /
 *    Arrived / Delivered entry timestamped AFTER the recorded border or
 *    customs entry). Otherwise it stays pending/unknown.
 *  - A milestone the journey has moved past WITHOUT data is "unknown"
 *    (shown as not-confirmed), never silently completed.
 *  - The percentage is derived ONLY from confirmed (completed) milestones
 *    and must always be presented as Estimated by the UI.
 */

import type { ShipmentStatus } from "../types";

export type JourneyMilestoneKey =
  | "origin"
  | "departed"
  | "border_arrival"
  | "customs_clearance"
  | "border_exit"
  | "in_transit"
  | "destination_arrival"
  | "delivered";

export const JOURNEY_MILESTONE_ORDER: readonly JourneyMilestoneKey[] = [
  "origin",
  "departed",
  "border_arrival",
  "customs_clearance",
  "border_exit",
  "in_transit",
  "destination_arrival",
  "delivered",
];

export type JourneyMilestoneState = "completed" | "current" | "pending" | "unknown";

export interface JourneyMilestone {
  key: JourneyMilestoneKey;
  state: JourneyMilestoneState;
  /** Real recorded timestamp backing the milestone, when one exists. */
  timestamp: string | null;
}

export interface JourneyProgress {
  milestones: JourneyMilestone[];
  /**
   * 0–100, rounded, = confirmed (completed) milestones / total. Derived
   * exclusively from confirmed milestone states; the UI must label it
   * "Estimated".
   */
  estimatedPercent: number;
}

export interface TimelineEntryLike {
  status: ShipmentStatus | string;
  timestamp?: string;
}

/** Statuses whose recording logically entails that the truck departed. */
const DEPARTURE_ENTAILING: ReadonlySet<string> = new Set([
  "In Transit",
  "Border Crossing",
  "Customs Clearance",
  "Arrived",
  "Delivered",
  "Closed",
]);

/** Statuses that entail the shipment reached the destination. */
const ARRIVAL_ENTAILING: ReadonlySet<string> = new Set(["Arrived", "Delivered", "Closed"]);

/** Statuses that entail final delivery. */
const DELIVERY_ENTAILING: ReadonlySet<string> = new Set(["Delivered", "Closed"]);

function parseTs(ts?: string): number | null {
  if (!ts) return null;
  const n = new Date(ts).getTime();
  return Number.isNaN(n) ? null : n;
}

export function deriveJourneyProgress(
  currentStatus: ShipmentStatus | string,
  timeline?: TimelineEntryLike[] | null
): JourneyProgress {
  const entries = Array.isArray(timeline) ? timeline : [];
  // Recorded evidence = every timeline status + the current status.
  const recorded = new Set<string>(entries.map(e => e.status));
  recorded.add(currentStatus);

  const firstTs = (statuses: readonly string[]): string | null => {
    let best: { t: number; iso: string } | null = null;
    for (const e of entries) {
      if (!statuses.includes(e.status)) continue;
      const t = parseTs(e.timestamp);
      if (t !== null && (best === null || t < best.t)) best = { t, iso: e.timestamp! };
    }
    return best?.iso ?? null;
  };

  const hasAny = (statuses: readonly string[]) => statuses.some(s => recorded.has(s));

  // --- Explicit confirmations -------------------------------------------
  const departedConfirmed = hasAny([...DEPARTURE_ENTAILING]);
  const borderArrivalConfirmed = recorded.has("Border Crossing");
  const customsConfirmed = recorded.has("Customs Clearance");
  const arrivalConfirmed = hasAny([...ARRIVAL_ENTAILING]);
  const deliveredConfirmed = hasAny([...DELIVERY_ENTAILING]);

  // Border Exit: ONLY a recorded post-border movement entry confirms it —
  // an In Transit / Arrived / Delivered / Closed timeline entry timestamped
  // strictly after the recorded border/customs entry. No status, no
  // timestamps, or no such later entry → not confirmed. Never GPS-derived.
  const borderRefTsRaw = (() => {
    const customsTs = parseTs(firstTs(["Customs Clearance"]) ?? undefined);
    const borderTs = parseTs(firstTs(["Border Crossing"]) ?? undefined);
    return customsTs ?? borderTs;
  })();
  let borderExitConfirmed = false;
  let borderExitTs: string | null = null;
  if (borderRefTsRaw !== null) {
    for (const e of entries) {
      if (!["In Transit", "Arrived", "Delivered", "Closed"].includes(e.status)) continue;
      const t = parseTs(e.timestamp);
      if (t !== null && t > borderRefTsRaw) {
        borderExitConfirmed = true;
        borderExitTs = e.timestamp!;
        break;
      }
    }
    // Arrival/delivery recorded after a border stage entails the truck left
    // the border even without an intermediate In Transit entry.
    if (!borderExitConfirmed && arrivalConfirmed) {
      const arrTs = parseTs(firstTs(["Arrived", "Delivered", "Closed"]) ?? undefined);
      if (arrTs !== null && arrTs > borderRefTsRaw) {
        borderExitConfirmed = true;
        borderExitTs = firstTs(["Arrived", "Delivered", "Closed"]);
      }
    }
  }

  // --- Current milestone (from the live status, exact mapping only) ------
  const currentKey: JourneyMilestoneKey | null =
    currentStatus === "In Transit" ? "in_transit"
    : currentStatus === "Border Crossing" ? "border_arrival"
    : currentStatus === "Customs Clearance" ? "customs_clearance"
    : currentStatus === "Arrived" ? "destination_arrival"
    : DEPARTURE_ENTAILING.has(currentStatus) ? null // Delivered/Closed → all done
    : "origin"; // every pre-departure status: the shipment is at origin

  const completedByKey: Record<JourneyMilestoneKey, boolean> = {
    origin: departedConfirmed, // origin is "done" once the truck left it
    departed: departedConfirmed,
    border_arrival: borderArrivalConfirmed,
    customs_clearance: customsConfirmed,
    border_exit: borderExitConfirmed,
    in_transit: arrivalConfirmed,
    destination_arrival: arrivalConfirmed,
    delivered: deliveredConfirmed,
  };

  const tsByKey: Record<JourneyMilestoneKey, string | null> = {
    origin: firstTs(["New", "Waiting for Driver Quotes", "Assigned", "Accepted", "Loading", "Loaded"]),
    departed: firstTs(["In Transit", "Border Crossing", "Customs Clearance", "Arrived", "Delivered", "Closed"]),
    border_arrival: firstTs(["Border Crossing"]),
    customs_clearance: firstTs(["Customs Clearance"]),
    border_exit: borderExitTs,
    in_transit: firstTs(["In Transit"]),
    destination_arrival: firstTs(["Arrived"]),
    delivered: firstTs(["Delivered", "Closed"]),
  };

  // --- Assemble states ---------------------------------------------------
  // The live status wins for its own milestone: being AT a stage right now
  // renders as "current" even though that stage's status is, by definition,
  // already part of the recorded evidence.
  const draft = JOURNEY_MILESTONE_ORDER.map((key) => {
    let state: JourneyMilestoneState;
    if (key === currentKey) state = "current";
    else if (completedByKey[key]) state = "completed";
    else state = "pending";
    return { key, state, timestamp: tsByKey[key] };
  });

  // A pending milestone that the journey has verifiably moved PAST without
  // any recorded data is "unknown" (not-confirmed), never assumed complete.
  // "Moved past" requires a later milestone to be CONFIRMED (completed) —
  // a merely-current later stage isn't proof the earlier one was skipped
  // (e.g. the single "In Transit" status covers both border legs).
  const lastProgressIdx = draft.reduce(
    (max, m, i) => (m.state === "completed" ? i : max),
    -1
  );
  const milestones: JourneyMilestone[] = draft.map((m, i) => ({
    ...m,
    state: m.state === "pending" && i < lastProgressIdx ? "unknown" : m.state,
  }));

  const completedCount = milestones.filter(m => m.state === "completed").length;
  const estimatedPercent = Math.round((completedCount / JOURNEY_MILESTONE_ORDER.length) * 100);

  return { milestones, estimatedPercent };
}
