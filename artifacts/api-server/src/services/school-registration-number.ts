import { randomUUID } from "node:crypto";

/** Generated only at creation; legacy schools are intentionally not backfilled. */
export function generateSchoolRegistrationNumber(): string {
  return `YEM-SCH-${randomUUID().toUpperCase()}`;
}

export function registrationNumberChanged(requested: unknown, current: unknown): boolean {
  if (requested === undefined) return false;
  const normalized = (value: unknown) => value == null || value === "" ? null : String(value).trim();
  return normalized(requested) !== normalized(current);
}