// Pure request/response contract helpers for student care. No React.
export const WELFARE_CATEGORIES = ['WELFARE_CONCERN', 'COUNSELLING_REFERRAL', 'SAFEGUARDING', 'FAMILY_SUPPORT', 'LEARNING_SUPPORT'] as const;
export const WELFARE_FOLLOW_UP = ['NOT_REQUIRED', 'PENDING', 'IN_PROGRESS', 'COMPLETE'] as const;
export const WELFARE_STATUS = ['OPEN', 'IN_PROGRESS', 'RESOLVED'] as const;
export const BEHAVIOUR_TYPES = ['POSITIVE', 'CONCERN', 'INCIDENT', 'RULE_VIOLATION', 'RECOGNITION'] as const;
export const SEVERITIES = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'] as const;
export const BEHAVIOUR_STATUS = ['REVIEW', 'ACTION', 'PARENT_NOTIFICATION', 'FOLLOW_UP', 'RESOLVED'] as const;
export const GRANTABLE = [
  'MEDICAL_READ', 'MEDICAL_WRITE', 'WELFARE_READ', 'WELFARE_WRITE', 'SAFEGUARDING_READ', 'SAFEGUARDING_WRITE',
  'BEHAVIOUR_READ', 'BEHAVIOUR_WRITE', 'BEHAVIOUR_REVIEW', 'BEHAVIOUR_ACTION',
] as const;

export const label = (v?: string | null) => (v ? v.replaceAll('_', ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase()) : '—');

export function newIdempotencyKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `care-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
export const idempotencyHeaders = (key: string) => ({ 'Idempotency-Key': key });
export const versionHeaders = (version: number) => ({ 'If-Match-Version': String(version) });

export const splitLines = (t: string) => t.split('\n').map(s => s.trim()).filter(Boolean);
export const joinLines = (a?: string[] | null) => (a ?? []).join('\n');
const nz = (s: string) => (s.trim() ? s.trim() : null);
export const toIso = (local: string) => (local ? new Date(local).toISOString() : null);
export const toLocalInput = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function errorInfo(e: unknown): { status: number; message: string; conflict: boolean; denied: boolean } {
  const x = e as { status?: number; data?: { error?: string }; message?: string } | undefined;
  const status = x?.status ?? 0;
  const message = x?.data?.error ?? (status === 409 ? 'This record changed since you opened it.' : status === 403 ? 'You do not have access.' : x?.message ?? 'Something went wrong.');
  return { status, message, conflict: status === 409, denied: status === 403 };
}

// ---- Medical profile
export type ContactRow = { name: string; phone: string; relationship: string };
export type ProviderRow = { name: string; role: string; phone: string; email: string };
export type MedicalForm = {
  bloodGroup: string; genotype: string; allergies: string; conditions: string; supportNeeds: string; medications: string;
  emergencyMedicalNotes: string; providerContacts: ProviderRow[]; emergencyContacts: ContactRow[];
};
export const emptyMedical = (): MedicalForm => ({ bloodGroup: '', genotype: '', allergies: '', conditions: '', supportNeeds: '', medications: '', emergencyMedicalNotes: '', providerContacts: [], emergencyContacts: [] });
export function medicalFromRecord(p?: any | null): MedicalForm {
  if (!p) return emptyMedical();
  return {
    bloodGroup: p.bloodGroup ?? '', genotype: p.genotype ?? '', allergies: joinLines(p.allergies), conditions: joinLines(p.conditions),
    supportNeeds: joinLines(p.supportNeeds), medications: joinLines(p.medications), emergencyMedicalNotes: p.emergencyMedicalNotes ?? '',
    providerContacts: (p.providerContacts ?? []).map((c: any) => ({ name: c.name ?? '', role: c.role ?? '', phone: c.phone ?? '', email: c.email ?? '' })),
    emergencyContacts: (p.emergencyContacts ?? []).map((c: any) => ({ name: c.name ?? '', phone: c.phone ?? '', relationship: c.relationship ?? '' })),
  };
}
export function medicalPayload(f: MedicalForm, expectedVersion: number) {
  return {
    expectedVersion,
    bloodGroup: nz(f.bloodGroup), genotype: nz(f.genotype),
    allergies: splitLines(f.allergies), conditions: splitLines(f.conditions), supportNeeds: splitLines(f.supportNeeds), medications: splitLines(f.medications),
    emergencyMedicalNotes: nz(f.emergencyMedicalNotes),
    providerContacts: f.providerContacts.filter(c => c.name.trim() || c.phone.trim()).map(c => ({ name: c.name.trim(), role: nz(c.role), phone: c.phone.trim(), email: nz(c.email) })),
    emergencyContacts: f.emergencyContacts.filter(c => c.name.trim() || c.phone.trim()).map(c => ({ name: c.name.trim(), phone: c.phone.trim(), relationship: c.relationship.trim() })),
  };
}
export function validateMedical(f: MedicalForm): Record<string, string> {
  const e: Record<string, string> = {};
  f.emergencyContacts.forEach((c, i) => { if ((c.name || c.phone || c.relationship) && !(c.name.trim() && c.phone.trim() && c.relationship.trim())) e[`ec${i}`] = 'Name, phone and relationship are all required.'; });
  f.providerContacts.forEach((c, i) => { if ((c.name || c.phone) && !(c.name.trim() && c.phone.trim())) e[`pc${i}`] = 'Name and phone are required.'; });
  return e;
}

// ---- Visits
export type VisitForm = { occurredAt: string; reason: string; symptoms: string; observations: string; actionTaken: string; treatment: string; referral: string; followUpAt: string; followUpNotes: string; notes: string };
export const emptyVisit = (): VisitForm => ({ occurredAt: toLocalInput(new Date().toISOString()), reason: '', symptoms: '', observations: '', actionTaken: '', treatment: '', referral: '', followUpAt: '', followUpNotes: '', notes: '' });
export const visitFromRecord = (v: any): VisitForm => ({ occurredAt: toLocalInput(v.occurredAt), reason: v.reason ?? '', symptoms: v.symptoms ?? '', observations: v.observations ?? '', actionTaken: v.actionTaken ?? '', treatment: v.treatment ?? '', referral: v.referral ?? '', followUpAt: toLocalInput(v.followUpAt), followUpNotes: v.followUpNotes ?? '', notes: v.notes ?? '' });
export const visitPayload = (f: VisitForm) => ({
  occurredAt: toIso(f.occurredAt) as string, reason: f.reason.trim(), symptoms: nz(f.symptoms), observations: nz(f.observations), actionTaken: nz(f.actionTaken),
  treatment: nz(f.treatment), referral: nz(f.referral), followUpAt: toIso(f.followUpAt), followUpNotes: nz(f.followUpNotes), notes: nz(f.notes),
});
export function validateVisit(f: VisitForm) {
  const e: Record<string, string> = {};
  if (!f.occurredAt) e.occurredAt = 'When did the visit happen?';
  if (!f.reason.trim()) e.reason = 'Reason for the visit is required.';
  return e;
}

// ---- Welfare
export type WelfareForm = { category: string; concern: string; assignedStaffUserId: string; followUpAt: string; followUpStatus: string; status: string; resolution: string; internalNotes: string; parentVisible: boolean };
export const emptyWelfare = (): WelfareForm => ({ category: 'WELFARE_CONCERN', concern: '', assignedStaffUserId: '', followUpAt: '', followUpStatus: 'NOT_REQUIRED', status: 'OPEN', resolution: '', internalNotes: '', parentVisible: false });
export const welfareFromRecord = (r: any): WelfareForm => ({ category: r.category, concern: r.concern ?? '', assignedStaffUserId: r.assignedStaffUserId ? String(r.assignedStaffUserId) : '', followUpAt: toLocalInput(r.followUpAt), followUpStatus: r.followUpStatus ?? 'NOT_REQUIRED', status: r.status ?? 'OPEN', resolution: r.resolution ?? '', internalNotes: r.internalNotes ?? '', parentVisible: !!r.parentVisible });
export const welfarePayload = (f: WelfareForm) => ({
  category: f.category, concern: f.concern.trim(), assignedStaffUserId: f.assignedStaffUserId ? Number(f.assignedStaffUserId) : null,
  followUpAt: toIso(f.followUpAt), followUpStatus: f.followUpStatus, status: f.status, resolution: nz(f.resolution), internalNotes: nz(f.internalNotes),
  // Safeguarding is never parent-visible.
  parentVisible: f.category === 'SAFEGUARDING' ? false : f.parentVisible,
});
export function validateWelfare(f: WelfareForm) {
  const e: Record<string, string> = {};
  if (!f.concern.trim()) e.concern = 'Describe the concern.';
  if (f.status === 'RESOLVED' && !f.resolution.trim()) e.resolution = 'A resolution is required to mark this resolved.';
  if (f.followUpStatus !== 'NOT_REQUIRED' && f.followUpStatus !== 'COMPLETE' && !f.followUpAt) e.followUpAt = 'Set a follow-up date.';
  return e;
}

// ---- Behaviour
export type BehaviourForm = { category: string; severity: string; occurredAt: string; schoolClassId: string; subjectId: string; location: string; description: string; action: string; followUpAt: string; followUpNotes: string; resolution: string; internalNotes: string; parentVisible: boolean };
export const emptyBehaviour = (): BehaviourForm => ({ category: 'CONCERN', severity: 'LOW', occurredAt: toLocalInput(new Date().toISOString()), schoolClassId: '', subjectId: '', location: '', description: '', action: '', followUpAt: '', followUpNotes: '', resolution: '', internalNotes: '', parentVisible: false });
export const behaviourFromRecord = (r: any): BehaviourForm => ({ category: r.category, severity: r.severity, occurredAt: toLocalInput(r.occurredAt), schoolClassId: r.schoolClassId ? String(r.schoolClassId) : '', subjectId: r.subjectId ? String(r.subjectId) : '', location: r.location ?? '', description: r.description ?? '', action: r.action ?? '', followUpAt: toLocalInput(r.followUpAt), followUpNotes: r.followUpNotes ?? '', resolution: r.resolution ?? '', internalNotes: r.internalNotes ?? '', parentVisible: !!r.parentVisible });
export const behaviourPayload = (f: BehaviourForm) => ({
  category: f.category, severity: f.severity, occurredAt: toIso(f.occurredAt) ?? undefined,
  schoolClassId: f.schoolClassId ? Number(f.schoolClassId) : null, subjectId: f.subjectId ? Number(f.subjectId) : null,
  location: nz(f.location), description: f.description.trim(), action: nz(f.action), followUpAt: toIso(f.followUpAt),
  followUpNotes: nz(f.followUpNotes), resolution: nz(f.resolution), internalNotes: nz(f.internalNotes), parentVisible: f.parentVisible,
});
export function validateBehaviour(f: BehaviourForm) {
  const e: Record<string, string> = {};
  if (!f.description.trim()) e.description = 'Describe what happened.';
  if (!f.occurredAt) e.occurredAt = 'Date and time are required.';
  return e;
}
export function behaviourProgressPayload(rec: any, status: string, expectedVersion: number, notify = false) {
  const p: any = { ...behaviourPayload(behaviourFromRecord(rec)), expectedVersion, status };
  if (notify) p.parentNotificationRequested = true;
  return p;
}
export const notificationTruth: Record<string, string> = {
  NOT_REQUESTED: 'No parent notification requested.',
  QUEUED: 'Queued with the communication service. Delivery is not confirmed.',
  PARTIAL: 'Queued for some guardians only. Delivery is not confirmed.',
  NOT_CONFIGURED: 'Not sent: no delivery channel is configured for this school.',
  FAILED: 'Could not be queued.',
};

// ---- Grants
export function grantPayload(userId: number, active: boolean, permissions: string[]) {
  return { userId, active, permissions: GRANTABLE.filter(p => permissions.includes(p)) };
}

// ---- Family privacy: whitelist only approved summary fields.
export function sanitizeParentSummary(s: any) {
  return {
    studentId: Number(s?.studentId),
    welfare: (s?.welfare ?? []).map((w: any) => ({ id: w.id, category: w.category, concern: w.concern, status: w.status, updatedAt: w.updatedAt })),
    behaviour: (s?.behaviour ?? []).map((b: any) => ({ id: b.id, category: b.category, description: b.description, status: b.status, occurredAt: b.occurredAt })),
  };
}
