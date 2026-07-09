const MAX_LOG_FIELD_LENGTH = 300;

function capText(value: unknown, maxLength: number = MAX_LOG_FIELD_LENGTH): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

export interface RawLogInput {
  shipmentId?: unknown;
  shipmentNumber?: unknown;
  actor?: unknown;
  actionEn?: unknown;
  actionTr?: unknown;
  actionAr?: unknown;
}

export interface SanitizedLogInput {
  shipmentId: string;
  shipmentNumber: string;
  actor: string;
  actionEn: string;
  actionTr: string;
  actionAr: string;
}

/**
 * Any admin session can POST /api/logs with free-text fields — this caps
 * length and coerces non-strings to "" so the audit log can't be used to
 * store arbitrarily large or malformed content.
 */
export function sanitizeLogInput(input: RawLogInput): SanitizedLogInput {
  return {
    shipmentId: capText(input.shipmentId),
    shipmentNumber: capText(input.shipmentNumber),
    actor: capText(input.actor) || "Operator",
    actionEn: capText(input.actionEn),
    actionTr: capText(input.actionTr),
    actionAr: capText(input.actionAr),
  };
}

/**
 * Masks a login identifier (email, phone, or username) for failed/blocked
 * login audit entries, so the admin-readable log doesn't retain a full
 * attempted email/phone verbatim.
 */
export function maskLoginIdentifier(raw: string | undefined | null): string {
  const value = (raw || "").trim();
  if (!value) return "unknown";

  if (value.includes("@")) {
    const [user, domain] = value.split("@");
    if (!user || !domain) return "***";
    return `${user[0]}***@${domain}`;
  }

  if (/^[+\d\s()-]+$/.test(value)) {
    const digits = value.replace(/\D/g, "");
    return digits.length >= 4 ? `***${digits.slice(-4)}` : "***";
  }

  if (value.length <= 2) return `${value[0]}*`;
  return `${value[0]}${"*".repeat(Math.min(value.length - 1, 6))}`;
}
