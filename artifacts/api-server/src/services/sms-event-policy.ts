/** SMS is a narrowly scoped opt-in, never a general notification transport. */
export const smsEventAllowed = (event: string) =>
  event === "EMERGENCY" || event === "ATTENDANCE_ABSENCE";

export function smsNotificationAllowed(category: string, eventKey: string | null, studentId: unknown): boolean {
  const key = (eventKey ?? "").toUpperCase();
  return /(?:^|:)EMERGENCY(?:$|:)/.test(key)
    || (category === "ATTENDANCE" && /ABSEN/.test(key)
      && Number.isSafeInteger(Number(studentId)) && Number(studentId) > 0);
}
