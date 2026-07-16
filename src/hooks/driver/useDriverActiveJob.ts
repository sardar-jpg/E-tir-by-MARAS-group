import { useMemo } from "react";
import type { Shipment } from "../../types";
import { selectDriverActiveJob, shouldReportDriverLocation } from "../../lib/driverJobFlow";

/**
 * feature/driver-app-comprehensive-redesign — THE single authoritative
 * "which job is my active job" answer, shared by Home, the Chat default
 * thread, and location reporting. Wraps selectDriverActiveJob
 * (driverJobFlow.ts) so no screen ever re-derives its own variant of
 * "active" — the exact duplicated-calculation bug this redesign removes.
 */
export function useDriverActiveJob(shipments: Shipment[]): {
  activeJob: Shipment | null;
  /** True while the active job is genuinely underway (Accepted…Arrived) — the window location reporting must run in. */
  isReportingLocation: boolean;
} {
  const activeJob = useMemo(() => selectDriverActiveJob(shipments), [shipments]);
  const isReportingLocation =
    !!activeJob && shouldReportDriverLocation(activeJob.status, activeJob.freightType);
  return { activeJob, isReportingLocation };
}
