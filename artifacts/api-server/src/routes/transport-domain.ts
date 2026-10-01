import { AuthError } from "../middlewares/auth";

export const TRANSPORT_WEEKDAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const;

export type TransportWeekday = (typeof TRANSPORT_WEEKDAYS)[number];
export type TransportInvoiceStatus = "PAID" | "PENDING" | "OVERDUE" | "SUSPENDED" | "INACTIVE" | "CANCELLED";

const weekdaySet = new Set<string>(TRANSPORT_WEEKDAYS);

export function requireRecordId(value: unknown, label: string): number {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new AuthError(400, `${label} must be a positive integer`);
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new AuthError(400, `${label} must be a positive integer`);
  }
  return id;
}

export function normalizeTransportWeekdays(value: unknown): TransportWeekday[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > TRANSPORT_WEEKDAYS.length ||
    value.some((day) => typeof day !== "string" || !weekdaySet.has(day)) ||
    new Set(value).size !== value.length
  ) {
    throw new AuthError(400, "weekdays must contain one or more unique valid weekday names");
  }
  return [...value] as TransportWeekday[];
}

export function normalizeTransportTime(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) {
    throw new AuthError(400, `${label} must use a valid 24-hour HH:mm or HH:mm:ss time`);
  }
  return value.length === 5 ? `${value}:00` : value;
}

export function ensureTransportArrivalAfterDeparture(departureTime: string, arrivalTime: string): void {
  if (arrivalTime <= departureTime) {
    throw new AuthError(400, "arrivalTime must be later than departureTime on the same school day");
  }
}

export function requireReason(value: unknown, label = "reason", maxLength = 500): string {
  if (
    typeof value !== "string" ||
    value.trim().length < 3 ||
    value.trim().length > maxLength
  ) {
    throw new AuthError(400, `${label} must contain between 3 and ${maxLength} characters`);
  }
  return value.trim();
}

export function requireTransportDate(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AuthError(400, `${label} must be a real date in YYYY-MM-DD format`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new AuthError(400, `${label} must be a real date in YYYY-MM-DD format`);
  }
  return value;
}

export function requireTransportAmountMinor(value: unknown, label: string, allowZero = true): number {
  if (!Number.isSafeInteger(value) || (allowZero ? Number(value) < 0 : Number(value) < 1) || Number(value) > 1_000_000_000) {
    throw new AuthError(
      400,
      `${label} must be a whole NGN subunit amount between ${allowZero ? 0 : 1} and 1,000,000,000`,
    );
  }
  return Number(value);
}

export function resolveTransportFeePlanAmount(explicitAmountMinor: unknown, routeFareMinor: unknown): number {
  return requireTransportAmountMinor(
    explicitAmountMinor === undefined ? routeFareMinor : explicitAmountMinor,
    explicitAmountMinor === undefined ? "route fare" : "feePlanAmountMinor",
  );
}

export function resolveTransportFeePlanDueDate(
  explicitDueDate: unknown,
  termStartDate: unknown,
  termEndDate: unknown,
): string {
  const startDate = requireTransportDate(termStartDate, "academic term start date");
  const dueDate = requireTransportDate(
    explicitDueDate === undefined ? termEndDate : explicitDueDate,
    explicitDueDate === undefined ? "academic term end date" : "dueDate",
  );
  if (dueDate < startDate) {
    throw new AuthError(400, "dueDate cannot be earlier than the selected academic term");
  }
  return dueDate;
}

export function ensureTransportSeatAvailable(
  busCapacity: number,
  reservedPassengerCount: number,
  additionalPassengers = 1,
): void {
  if (
    !Number.isSafeInteger(busCapacity) ||
    busCapacity < 1 ||
    !Number.isSafeInteger(reservedPassengerCount) ||
    reservedPassengerCount < 0 ||
    !Number.isSafeInteger(additionalPassengers) ||
    additionalPassengers < 0
  ) {
    throw new AuthError(500, "Transport bus capacity information is invalid");
  }
  if (reservedPassengerCount + additionalPassengers > busCapacity) {
    throw new AuthError(409, "The bus has no remaining passenger capacity");
  }
}

export function isValidTransportStopPair(
  pickup: { id: number; stopType: string; isActive: boolean; sequence: number } | undefined,
  dropoff: { id: number; stopType: string; isActive: boolean; sequence: number } | undefined,
): boolean {
  return Boolean(
    pickup &&
      dropoff &&
      pickup.isActive &&
      dropoff.isActive &&
      pickup.id !== dropoff.id &&
      pickup.sequence < dropoff.sequence &&
      ["PICKUP", "BOTH"].includes(pickup.stopType) &&
      ["DROPOFF", "BOTH"].includes(dropoff.stopType),
  );
}

export function projectTransportInvoiceStatus(input: {
  outstandingMinor: number;
  feeStatus: string;
  dueDate: string;
  assignmentStatus: string;
  currentDate?: string;
  suspendWhenOverdue?: boolean;
}): TransportInvoiceStatus {
  if (input.feeStatus === "CANCELLED") return "CANCELLED";
  if (input.assignmentStatus === "DEACTIVATED") return "INACTIVE";
  if (input.assignmentStatus === "SUSPENDED") return "SUSPENDED";
  if (input.outstandingMinor <= 0 || input.feeStatus === "PAID") return "PAID";
  const date = input.currentDate ?? new Date().toISOString().slice(0, 10);
  const isOverdue = input.dueDate < date || input.feeStatus === "OVERDUE";
  if (isOverdue && input.suspendWhenOverdue) return "SUSPENDED";
  return isOverdue ? "OVERDUE" : "PENDING";
}

export function requireAllowedKeys(body: unknown, allowedKeys: readonly string[], objectName = "body"): Record<string, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new AuthError(400, `${objectName} must be a JSON object`);
  }
  const record = body as Record<string, unknown>;
  const unexpected = Object.keys(record).find((key) => !allowedKeys.includes(key));
  if (unexpected) throw new AuthError(400, `${objectName} contains an unsupported field: ${unexpected}`);
  return record;
}