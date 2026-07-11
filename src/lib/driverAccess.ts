/**
 * driverAccess.ts
 *
 * Pure, unit-tested logic for the driver self-registration / pending
 * approval flow, split out of server.ts the same way
 * adminAccess.ts/clientAccess.ts/documentAccess.ts already are.
 */
import type { Driver } from "../types";

/** Fields a registration candidate is checked against for collisions. */
export type DriverDuplicateCandidate = {
  username?: string;
  email?: string;
  phone?: string;
};

export type DriverDuplicateField = "username" | "email" | "phone";

function normalize(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

function normalizePhone(value: string | undefined): string {
  return (value || "").replace(/\s+/g, "");
}

/**
 * A brand-new driver's username/email/phone must not collide with an
 * existing driver — login matches by username/email/phone (see
 * POST /api/login in server.ts), so a silent duplicate would make the
 * second registrant permanently unable to log in (or, worse, land on the
 * first registrant's account) with no error surfaced anywhere. Returns
 * which field collided first, or null if the candidate is clear.
 */
export function findDuplicateDriverField(
  existingDrivers: Pick<Driver, "username" | "email" | "phone">[],
  candidate: DriverDuplicateCandidate
): DriverDuplicateField | null {
  const username = normalize(candidate.username);
  const email = normalize(candidate.email);
  const phone = normalizePhone(candidate.phone);

  for (const d of existingDrivers) {
    if (username && normalize(d.username) === username) return "username";
    if (email && normalize(d.email) === email) return "email";
    if (phone && normalizePhone(d.phone) === phone) return "phone";
  }
  return null;
}

/**
 * True if a driver is allowed to log in and use operational features.
 * Drivers created before this approval workflow existed have no `status`
 * field at all — those are treated as already-approved so this change
 * never locks out an existing driver.
 */
export function isDriverApproved(driver: Pick<Driver, "status">): boolean {
  return driver.status === undefined || driver.status === "approved";
}

/** Same rule as isDriverApproved — a driver eligible to be assigned to a shipment. */
export const isDriverAssignable = isDriverApproved;

/** Drivers eligible to appear in a shipment's driver-assignment selectors. */
export function getAssignableDrivers(drivers: Driver[]): Driver[] {
  return drivers.filter(isDriverAssignable);
}

/**
 * Options for a "Core Driver" select that already has a value (editing an
 * existing shipment): assignable drivers, plus the currently-assigned
 * driver even if they're no longer assignable (e.g. rejected after being
 * assigned) — so the select never silently mismatches its own value and an
 * existing assignment is never visually dropped.
 */
export function getCoreDriverSelectOptions(drivers: Driver[], currentlyAssignedId?: string): Driver[] {
  const assignable = getAssignableDrivers(drivers);
  if (!currentlyAssignedId || assignable.some(d => d.id === currentlyAssignedId)) {
    return assignable;
  }
  const current = drivers.find(d => d.id === currentlyAssignedId);
  return current ? [...assignable, current] : assignable;
}

export type DriverLoginBlock = {
  blocked: boolean;
  message?: string;
};

const PENDING_MESSAGE = "Your driver account is pending admin approval. Please check back soon.";
const REJECTED_MESSAGE = "Your driver registration was not approved. Please contact MARAS Group support.";

/**
 * Single source of truth for the driver-facing pending/rejected block
 * message, shared by both the password-login path and the
 * Firebase-verified /api/verify-session path in server.ts (previously two
 * independent copies with slightly different wording).
 */
export function resolveDriverLoginBlock(status: Driver["status"]): DriverLoginBlock {
  if (status === "pending") return { blocked: true, message: PENDING_MESSAGE };
  if (status === "rejected") return { blocked: true, message: REJECTED_MESSAGE };
  return { blocked: false };
}
