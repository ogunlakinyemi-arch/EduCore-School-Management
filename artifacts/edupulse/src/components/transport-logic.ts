import type { TransportAssignment, TransportBus, TransportRoute, TransportStop, TransportStudentOption } from '@workspace/api-client-react';

export type TransportAudience = 'owner' | 'admin' | 'denied';
export type FamilyAudience = 'parent' | 'student' | 'both' | 'denied';

type RoleLike = { role: string; status: string; schoolId?: number | null };
type ContextLike = { isPlatformOwner?: boolean; roles?: RoleLike[] } | undefined | null;

const active = (roles: RoleLike[] | undefined, role: string, schoolId?: number) =>
  (roles ?? []).some(r => r.role === role && r.status === 'ACTIVE' && (schoolId === undefined || r.schoolId === schoolId));

/** Platform Owner is always read-only, even when the account also holds school roles. */
export function transportAudience(context: ContextLike, schoolId: number): TransportAudience {
  if (!context) return 'denied';
  if (context.isPlatformOwner) return 'owner';
  if (schoolId && active(context.roles, 'SCHOOL_ADMIN', schoolId)) return 'admin';
  return 'denied';
}

export function familyAudience(context: ContextLike): FamilyAudience {
  if (!context || context.isPlatformOwner) return 'denied';
  const parent = active(context.roles, 'PARENT');
  const student = active(context.roles, 'STUDENT');
  if (parent && student) return 'both';
  if (parent) return 'parent';
  if (student) return 'student';
  return 'denied';
}

export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const e = error as { data?: { error?: string; code?: string } | null; message?: string } | null;
  const code = e?.data?.code;
  const text = e?.data?.error;
  if (code && /CAPACITY/i.test(code)) return text || 'This bus is already at full capacity. Choose another route or raise the bus capacity first.';
  if (code && /DUPLICATE|ALREADY|EXISTS|CONFLICT/i.test(code)) return text || 'This record already exists. Update the existing record instead.';
  return text || e?.message || fallback;
}

export function capacityState(bus: Pick<TransportBus, 'capacity' | 'passengerCount'>) {
  const left = bus.capacity - bus.passengerCount;
  return { left, full: left <= 0, over: left < 0, pct: bus.capacity > 0 ? Math.min(100, Math.round((bus.passengerCount / bus.capacity) * 100)) : 0 };
}

export function stopsFor(route: Pick<TransportRoute, 'stops'> | undefined, kind: 'PICKUP' | 'DROPOFF'): TransportStop[] {
  return (route?.stops ?? [])
    .filter(s => s.isActive && (s.stopType === kind || s.stopType === 'BOTH'))
    .sort((a, b) => a.sequence - b.sequence);
}

export function formatNaira(minor?: number | null) {
  return `\u20A6${((minor ?? 0) / 100).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function activeDrivers<T extends { employeeType: string }>(drivers: T[] | undefined) {
  return (drivers ?? []).filter(d => d.employeeType === 'DRIVER');
}

/** Students come only from the school's existing records; unassigned ones are assignable. */
export function selectableStudents(options: TransportStudentOption[] | undefined) {
  return (options ?? []).filter(o => !o.activeAssignment?.assignment || o.activeAssignment.transportStatus !== 'ACTIVE');
}

export function validateEffective(effectiveDate: string, reason: string) {
  if (!effectiveDate) return 'Choose an effective date.';
  if (reason.trim().length < 3) return 'Give a reason so the history stays meaningful.';
  return null;
}

export function ownerTotals(rows: Array<{ busCapacity: number; reservedPassengerCount: number; activeStudents: number; inactiveStudents: number; activeStaff: number; activeDrivers: number; transportRevenueMinor: number; outstandingMinor: number; busCount: number; routeCount: number }> | undefined) {
  const r = rows ?? [];
  const sum = (k: keyof (typeof r)[number]) => r.reduce((t, x) => t + (x[k] ?? 0), 0);
  return {
    buses: sum('busCount'), routes: sum('routeCount'), capacity: sum('busCapacity'), passengers: sum('reservedPassengerCount'),
    active: sum('activeStudents'), inactive: sum('inactiveStudents'), staff: sum('activeStaff'), drivers: sum('activeDrivers'),
    revenue: sum('transportRevenueMinor'), outstanding: sum('outstandingMinor'),
  };
}

export function assignmentTone(status: TransportAssignment['status'] | string) {
  return status === 'ACTIVE' ? 'active' : status === 'SUSPENDED' ? 'pending' : 'inactive';
}

export const TRANSPORT_STALE_MS = 15_000;
export const TRANSPORT_POLL_MS = 30_000;
