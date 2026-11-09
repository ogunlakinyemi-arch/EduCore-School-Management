/** Presentation only. UTC/offset-bearing API timestamps are never rewritten. */
export function notificationTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone:"Africa/Lagos",day:"2-digit",month:"short",year:"numeric",
    hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23",
  }).formatToParts(instant);
  const get = (type: string) => parts.find(p=>p.type===type)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")}:${get("second")} WAT`;
}

/** Convert explicit ISO instants in displayed message text once. */
export function notificationText(value: string): string {
  return value.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\b/g,
    instant => notificationTime(instant) === "—" ? instant : notificationTime(instant));
}
