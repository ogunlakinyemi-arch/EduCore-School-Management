import { AuthError } from "../middlewares/auth";

/** Calendar date of collection, distinct from the audit/verification timestamp. */
export function cashCollectionDate(raw: unknown, issueDate: string, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const value = raw === undefined ? today : raw;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)
      || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))
      || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
      || value > today || value < String(issueDate).slice(0, 10)) {
    throw new AuthError(400, "Cash collection date must be a real date between the invoice issue date and today in Nigeria.");
  }
  return value;
}
