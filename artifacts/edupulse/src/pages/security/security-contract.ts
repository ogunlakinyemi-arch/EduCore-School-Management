import type { StudentPickupRequest, SecurityDashboard, SecurityAccess as SecurityAccessDto } from '@workspace/api-client-react';

export const EMERGENCY_CONFIRMATION = 'I CONFIRM EMERGENCY BROADCAST' as const;

export type SecurityAccess = {
  overview: boolean; events: boolean; mutate: boolean; incidents: boolean; grants: boolean; delegated: boolean;
};

/** Owner: read-only overview + events. Admin: all. Staff: delegated core privileges (backend enforces grants). */
export function securityAccess(role: 'OWNER' | 'SCHOOL_ADMIN' | 'STAFF'): SecurityAccess {
  if (role === 'OWNER') return { overview: true, events: true, mutate: false, incidents: false, grants: false, delegated: false };
  if (role === 'SCHOOL_ADMIN') return { overview: true, events: true, mutate: true, incidents: true, grants: true, delegated: false };
  return { overview: true, events: true, mutate: true, incidents: true, grants: false, delegated: true };
}

export function httpStatus(error: unknown): number | null {
  if (error && typeof error === 'object' && 'status' in error && typeof (error as { status: unknown }).status === 'number') return (error as { status: number }).status;
  return null;
}
export const isForbidden = (error: unknown) => httpStatus(error) === 403;
export function safeMessage(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  const status = httpStatus(error);
  if (status === 403) return 'You do not have permission for this action.';
  if (status === 409) return 'This record changed elsewhere. Refresh and try again.';
  return error instanceof Error && status && status < 500 ? error.message : fallback;
}

export function dayRange(from: string, to: string): { from?: string; to?: string } {
  const out: { from?: string; to?: string } = {};
  if (from) out.from = new Date(`${from}T00:00:00`).toISOString();
  if (to) out.to = new Date(`${to}T23:59:59.999`).toISOString();
  return out;
}

export function presenceUncertain(d: Pick<SecurityDashboard, 'presenceRequiresReview'>): boolean { return d.presenceRequiresReview > 0; }

export type PickupCompletionCheck = { ok: true; eventId: number } | { ok: false; reason: string };
export function checkPickupCompletion(req: Pick<StudentPickupRequest, 'status' | 'validFrom' | 'validUntil'>, eventIdText: string, now = new Date()): PickupCompletionCheck {
  if (req.status !== 'APPROVED') return { ok: false, reason: 'Only approved requests can be completed.' };
  const t = now.getTime();
  if (t < new Date(req.validFrom).getTime()) return { ok: false, reason: 'The pickup window has not opened yet.' };
  if (t > new Date(req.validUntil).getTime()) return { ok: false, reason: 'The pickup window has closed.' };
  const id = Number(eventIdText);
  if (!/^\d+$/.test(eventIdText.trim()) || !Number.isSafeInteger(id) || id <= 0) return { ok: false, reason: 'Enter the confirmed EXIT event ID.' };
  return { ok: true, eventId: id };
}

export type EmergencyCheck = { ok: boolean; reason?: string };
export function checkEmergency(i: { confirmation: string; previewCount: number | null; previewFresh: boolean; channels: string[] }): EmergencyCheck {
  if (!i.channels.includes('IN_APP')) return { ok: false, reason: 'In-app delivery is mandatory for emergency broadcasts.' };
  if (!i.previewFresh || !i.previewCount) return { ok: false, reason: 'Preview the audience again before sending.' };
  if (i.confirmation !== EMERGENCY_CONFIRMATION) return { ok: false, reason: `Type "${EMERGENCY_CONFIRMATION}" exactly.` };
  return { ok: true };
}

export const newKey = () => crypto.randomUUID();
export const fmtDateTime = (v?: string | null) => v ? new Date(v).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

/** Keeps one Idempotency-Key per operation signature; a new key only when the signature changes. */
export function createKeyStore() {
  const headers: Record<string, string> = {};
  let sig = '';
  return {
    headers,
    use(signature: string): string {
      if (signature !== sig || !headers['Idempotency-Key']) { sig = signature; headers['Idempotency-Key'] = newKey(); }
      return headers['Idempotency-Key'];
    },
  };
}

export type LiveAccess = { read: boolean; view: boolean; presence: boolean; readers: boolean; visitors: boolean; pickup: boolean; incidents: boolean; settings: boolean; grants: boolean; delegated: boolean; readOnly: boolean };

/** Derive tab visibility from the server's effective permissions; read-only or revoked actors get no mutation tabs. */
export function liveAccess(a: Pick<SecurityAccessDto, 'actorRole' | 'canView' | 'readOnly'> & { permissions: readonly string[] } | undefined | null): LiveAccess {
  const none: LiveAccess = { read: false, view: false, presence: false, readers: false, visitors: false, pickup: false, incidents: false, settings: false, grants: false, delegated: false, readOnly: true };
  if (!a || !a.canView) return none;
  const has = (...p: string[]) => p.some(x => a.permissions.includes(x));
  const read = has('SECURITY_READ', 'READ');
  if (a.readOnly) return { ...none, view: true, read };
  const manage = has('SECURITY_MANAGE');
  return {
    view: true, read, readOnly: false,
    presence: manage || has('REVIEW_PRESENCE'), readers: manage || has('MANAGE_READERS'), visitors: has('VISITOR_MANAGE'),
    pickup: has('PICKUP_APPROVE'), incidents: has('INCIDENT_MANAGE'), settings: manage,
    grants: a.actorRole === 'SCHOOL_ADMIN', delegated: a.actorRole === 'STAFF',
  };
}

/** Pick EXIT events for one student from a page of events (server cannot filter by student). */
export function exitEventsForStudent<E extends { eventType: string; identityResult: string; studentId: number | null }>(events: readonly E[], studentId: number): E[] {
  return events.filter(e => e.studentId === studentId && e.eventType === 'EXIT' && e.identityResult === 'CONFIRMED');
}
