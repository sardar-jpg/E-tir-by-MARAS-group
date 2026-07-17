/**
 * driverJobFlow.ts
 *
 * feature/driver-app-comprehensive-redesign — the single source of truth
 * for every "what does this job mean for the DRIVER right now" decision
 * the redesigned Driver App makes:
 *
 *  - which group a job belongs to on the Jobs screen
 *    (upcoming / active / completed),
 *  - which single job is THE driver's active job (Home card, Chat default,
 *    GPS reporting) — previously Home, the shipment list filter, and the
 *    GPS effect each computed their own variant of "active", and they
 *    disagreed (Home treated "Arrived" as finished; the list did not),
 *  - whether location reporting should be running for a job,
 *  - the exact payload a GPS update sends (location fields ONLY — never a
 *    stale spread of the whole driver profile),
 *  - the localized action label for the one status the driver may submit
 *    next.
 *
 * Everything here derives from the already-authoritative transition rules
 * in shipmentStatusTransitions.ts (getDriverSubmittableNextStatus /
 * isShipmentClosed) — this module never re-encodes the status sequences,
 * so it can't drift from the server's enforcement. Pure functions, no
 * I/O, unit-tested in driverJobFlow.test.ts.
 */
import type { AppNotification, Language, Shipment, ShipmentStatus } from "../types";
import { getDriverSubmittableNextStatus } from "./shipmentStatusTransitions";
import { isNotificationReadForUser } from "./notificationAccess";

/**
 * True while there is still at least one status the DRIVER may submit for
 * this shipment. "Arrived" (Land) is explicitly still true here — the
 * driver must still be able to submit "Delivered". Turns false only at
 * Delivered (whose sole next step is the admin-only closing transition)
 * and at Closed/Completed.
 */
export function hasRemainingDriverAction(
  status: ShipmentStatus,
  freightType?: string | null
): boolean {
  return getDriverSubmittableNextStatus(status, freightType) !== null;
}

export type DriverJobGroup = "upcoming" | "active" | "completed";

/**
 * Jobs screen grouping:
 *  - "upcoming":  Assigned (awaiting the driver's accept/decline) and New
 *    (back with dispatch after a decline — nothing for the driver to do
 *    yet). A driver never gets a normal status-progression action while a
 *    job is in this group.
 *  - "active":    accepted and still moving — everything from Accepted
 *    through Arrived. Arrived is NEVER completed for the driver: the
 *    Delivered submission is still theirs to make.
 *  - "completed": no driver-submittable status remains (Delivered, and the
 *    terminal Closed/Completed). Chat/documents may still be available —
 *    that's governed by isShipmentClosed, not by this grouping.
 */
export function getDriverJobGroup(
  status: ShipmentStatus,
  freightType?: string | null
): DriverJobGroup {
  if (!hasRemainingDriverAction(status, freightType)) return "completed";
  if (status === "New" || status === "Assigned") return "upcoming";
  return "active";
}

/**
 * Shipment-chat lifecycle rule for the DRIVER side: the conversation
 * exists for the driver only once they have ACCEPTED the assigned job —
 * never during the offer stage, never merely because Operations selected
 * them. "New" (back with dispatch) and "Assigned" (awaiting the driver's
 * accept/decline) are the two pre-acceptance states; everything after
 * them — including Delivered and the terminal Closed/Completed — keeps
 * the conversation VISIBLE. Whether it is also WRITABLE is a separate,
 * existing rule (isShipmentClosed → read-only), so closing a job never
 * hides history, it only locks the composer.
 */
export function isDriverChatAvailable(status: ShipmentStatus): boolean {
  return status !== "New" && status !== "Assigned";
}

type JobLike = Pick<Shipment, "id" | "status" | "freightType" | "updatedAt">;

/**
 * THE one active-job selection rule, shared by Home, the Chat default
 * thread, and location reporting. Priority:
 *   1. a job already underway ("active" group — Accepted…Arrived),
 *   2. a job awaiting the driver's response ("Assigned"),
 *   3. anything else not yet completed (e.g. "New" after a decline).
 * Ties broken by most recently updated. Returns null when every job is
 * completed for the driver (or there are none).
 */
export function selectDriverActiveJob<T extends JobLike>(shipments: T[]): T | null {
  const candidates = shipments.filter(
    (s) => getDriverJobGroup(s.status, s.freightType) !== "completed"
  );
  if (candidates.length === 0) return null;

  const priority = (s: T): number => {
    const group = getDriverJobGroup(s.status, s.freightType);
    if (group === "active") return 0;
    if (s.status === "Assigned") return 1;
    return 2;
  };

  return [...candidates].sort((a, b) => {
    const pd = priority(a) - priority(b);
    if (pd !== 0) return pd;
    return (b.updatedAt || "").localeCompare(a.updatedAt || "");
  })[0];
}

/**
 * Location reporting runs while the job is actually underway — the
 * "active" group, i.e. from Accepted all the way THROUGH Arrived (a
 * driver at the destination is still working the delivery; dispatch still
 * needs their position). It stops only at the driver's true terminal
 * point: Delivered onward, where no driver-submittable status remains.
 * Never keyed to which screen the driver happens to have open.
 */
export function shouldReportDriverLocation(
  status: ShipmentStatus,
  freightType?: string | null
): boolean {
  return getDriverJobGroup(status, freightType) === "active";
}

export interface DriverLocationUpdatePayload {
  latitude: number;
  longitude: number;
  lastUpdated: string;
}

/**
 * The COMPLETE body of a driver GPS update — latitude, longitude, and the
 * fix timestamp, nothing else. PUT /api/drivers/:id merges fields
 * individually (server.ts), so sending only these can never clobber the
 * profile. The old client spread the whole locally-cached driver record
 * into every GPS ping, which re-submitted stale name/phone/truck data on
 * a 15-minute timer and could silently revert a profile edit made
 * elsewhere.
 */
export function buildDriverLocationUpdatePayload(
  latitude: number,
  longitude: number,
  lastUpdated: string
): DriverLocationUpdatePayload {
  return { latitude, longitude, lastUpdated };
}

export interface DriverNextActionLabel {
  en: string;
  tr: string;
  ar: string;
}

/**
 * Driver-facing action button labels, keyed by the status the action
 * SUBMITS (the next status), phrased as the physical thing the driver
 * just did / is starting — never raw workflow jargon. Land is the fully
 * curated set (drivers run Land shipments); any other submittable status
 * (Sea/Air edge cases) falls back to the shared status label via the
 * caller. "Accepted" is deliberately absent: accepting an assignment goes
 * through the dedicated accept/decline workflow, not this generic action.
 */
const NEXT_ACTION_LABELS: Partial<Record<ShipmentStatus, DriverNextActionLabel>> = {
  Loading: { en: "Start Loading", tr: "Yüklemeye Başla", ar: "بدء التحميل" },
  Loaded: { en: "Cargo Loaded", tr: "Yükleme Tamamlandı", ar: "تم تحميل البضاعة" },
  "In Transit": { en: "Start Journey", tr: "Yola Çık", ar: "بدء الرحلة" },
  "Border Crossing": { en: "Reached Border", tr: "Sınıra Ulaştım", ar: "وصلت إلى الحدود" },
  "Customs Clearance": { en: "Start Customs Clearance", tr: "Gümrük İşlemine Başla", ar: "بدء التخليص الجمركي" },
  Arrived: { en: "Arrived at Destination", tr: "Varış Noktasına Ulaştım", ar: "وصلت إلى الوجهة" },
  Delivered: { en: "Confirm Delivery", tr: "Teslimatı Onayla", ar: "تأكيد التسليم" },
};

export interface DriverNextAction {
  /** The one status this action submits — always the single legal next status. */
  nextStatus: ShipmentStatus;
  label: DriverNextActionLabel;
}

/**
 * The single primary action the driver may take on this job right now,
 * or null when there is none:
 *  - null at "New" (waiting on dispatch) and "Assigned" (the dedicated
 *    accept/decline workflow owns that moment — never a generic button),
 *  - null from Delivered onward (nothing left for the driver to submit).
 * Backed by getDriverSubmittableNextStatus, so it can never offer a
 * skipped, backward, or closing status.
 */
export function getDriverNextAction(
  status: ShipmentStatus,
  freightType?: string | null
): DriverNextAction | null {
  if (status === "New" || status === "Assigned") return null;
  const nextStatus = getDriverSubmittableNextStatus(status, freightType);
  if (!nextStatus) return null;
  const label = NEXT_ACTION_LABELS[nextStatus];
  if (label) return { nextStatus, label };
  // Sea/Air statuses outside the curated Land set: a plain "Mark as …"
  // built from the same per-language status labels the timeline uses.
  return {
    nextStatus,
    label: {
      en: `Mark as ${nextStatus}`,
      tr: `${nextStatus} olarak işaretle`,
      ar: `تحديث الحالة إلى ${nextStatus}`,
    },
  };
}

export function localizeNextActionLabel(action: DriverNextAction, lang: Language): string {
  return action.label[lang] ?? action.label.en;
}

/**
 * Unread driver-visible chat notifications for one shipment — powers the
 * per-job unread badge on the Jobs screen and the Chat tab badge. Counts
 * only type "chat" notifications not yet read by THIS user
 * (isNotificationReadForUser — per-user readByUserIds, never the legacy
 * shared flag). The notifications list itself is already scoped
 * server-side to what this driver may see (channel + ownership), so no
 * channel re-filtering happens here.
 */
export function countUnreadChatForShipment(
  notifications: AppNotification[],
  shipmentId: string,
  userId: string
): number {
  return notifications.filter(
    (n) =>
      n.type === "chat" &&
      n.shipmentId === shipmentId &&
      !isNotificationReadForUser(n, userId)
  ).length;
}
