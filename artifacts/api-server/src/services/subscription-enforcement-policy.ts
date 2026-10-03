export type SubscriptionStudent = {
  studentId: number;
  paid: boolean;
  waived: boolean;
  pending: boolean;
  unknown?: boolean;
};

/** Calendar dates are interpreted in the school's existing Nigerian calendar. */
export function subscriptionPolicy(
  term: { startDate: string; endDate: string },
  students: SubscriptionStudent[],
  today: string,
) {
  const start = Date.parse(`${term.startDate}T00:00:00Z`);
  const end = Date.parse(`${term.endDate}T00:00:00Z`);
  const day = Date.parse(`${today}T00:00:00Z`);
  if (![start, end, day].every(Number.isFinite) || end < start || day < start || day > end) {
    throw new Error("Current academic calendar is unavailable");
  }
  const enforcementDate = new Date(start + 7 * 86_400_000).toISOString().slice(0, 10);
  const grace = today < enforcementDate;
  const covered = students.filter(student => student.paid || student.waived);
  const unpaid = students.filter(student => !student.paid && !student.waived && !student.unknown);
  const restrictedStudentIds = grace ? [] : unpaid.map(student => student.studentId).sort((a, b) => a - b);
  // Automatic enforcement is per student, including a completely unpaid school.
  // Only an independent, explicit Owner action can lock teachers/readers.
  const schoolLocked = false;
  const status = students.some(student => student.unknown && !student.paid && !student.waived) ? "UNAVAILABLE"
    : students.length === 0 ? "NOT_REQUIRED"
    : covered.length === students.length ? (students.every(student => student.waived) ? "WAIVED" : "PAID")
    : covered.length > 0 ? "PARTIALLY_PAID"
    : students.some(student => student.pending) ? "PENDING"
    : grace ? "UNPAID" : "OVERDUE";
  return {
    status, enforcementDate, inGracePeriod: grace, schoolLocked,
    restrictedStudentIds,
    state: grace ? "IN_GRACE_PERIOD" : restrictedStudentIds.length ? "SUBSCRIPTION_RESTRICTED" : status === "UNAVAILABLE" ? "UNAVAILABLE" : "ACTIVE",
    studentsTotal: students.length, studentsPaid: covered.length,
    studentsAffected: restrictedStudentIds.length,
  };
}