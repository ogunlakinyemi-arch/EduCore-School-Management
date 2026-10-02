import { AdmissionApplicationStatus } from '@workspace/api-client-react';
import type {
  AdmissionApplicantInput, AdmissionDocumentInput, AdmissionDocumentUploadInput,
  AdmissionEmergencyContactInput, AdmissionGuardianInput,
} from '@workspace/api-client-react';

export const STATUS_VALUES = Object.values(AdmissionApplicationStatus) as AdmissionApplicationStatus[];
/** Enrolled is set only by conversion. */
export const TRANSITION_VALUES = STATUS_VALUES.filter(s => s !== 'Enrolled');
export const GENDERS = ['Female', 'Male', 'Other', 'PreferNotToSay'] as const;
export const ACCEPTED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

const appBase = () => (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

export function portalUrlFor(portalKey: string, origin = typeof window !== 'undefined' ? window.location.origin : ''): string {
  return `${origin}${appBase()}/admissions/portal/${encodeURIComponent(portalKey)}`;
}

/** Normalises Nigerian local numbers (080...) to E.164. Returns null when invalid. */
export function normalizePhone(input: string): string | null {
  let v = input.replace(/[\s()-]/g, '');
  if (/^0\d{10}$/.test(v)) v = `+234${v.slice(1)}`;
  else if (/^234\d{10}$/.test(v)) v = `+${v}`;
  return /^\+[1-9][0-9]{7,14}$/.test(v) ? v : null;
}

export function makeRequestKey(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c?.randomUUID) return `adm-${c.randomUUID()}`;
  return `adm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export type KeyHolder = { current: { key: string; fingerprint: string } | null };
/** Same payload -> same key (safe retries). Changed payload -> new key. Cleared after success. */
export function resolveRequestKey(holder: KeyHolder, payload: unknown): string {
  const fingerprint = JSON.stringify(payload);
  if (!holder.current || holder.current.fingerprint !== fingerprint) holder.current = { key: makeRequestKey(), fingerprint };
  return holder.current.key;
}
export const idempotencyHeaders = (key: string) => ({ headers: { 'Idempotency-Key': key } });

export type FormValues = {
  firstName: string; middleName: string; lastName: string; dateOfBirth: string;
  gender: (typeof GENDERS)[number] | ''; previousSchool: string; previousClass: string;
  intendedClassId: string; academicSessionId: string; academicTermId: string; address: string;
  guardianName: string; guardianPhone: string; guardianEmail: string; guardianRelationship: string; guardianAddress: string;
  emergencyName: string; emergencyPhone: string; emergencyRelationship: string;
};
export const emptyForm: FormValues = {
  firstName: '', middleName: '', lastName: '', dateOfBirth: '', gender: '', previousSchool: '', previousClass: '',
  intendedClassId: '', academicSessionId: '', academicTermId: '', address: '',
  guardianName: '', guardianPhone: '', guardianEmail: '', guardianRelationship: '', guardianAddress: '',
  emergencyName: '', emergencyPhone: '', emergencyRelationship: '',
};

export type FormErrors = Partial<Record<keyof FormValues | 'documents', string>>;

export function validateForm(v: FormValues, opts: { requiredDocuments?: string[]; documents?: AdmissionDocumentInput[]; draft?: boolean } = {}): FormErrors {
  const e: FormErrors = {};
  if (!v.firstName.trim()) e.firstName = 'Enter the applicant first name.';
  if (!v.lastName.trim()) e.lastName = 'Enter the applicant last name.';
  if (!v.dateOfBirth || Number.isNaN(Date.parse(v.dateOfBirth)) || new Date(v.dateOfBirth) > new Date()) e.dateOfBirth = 'Enter a valid date of birth in the past.';
  if (!v.gender) e.gender = 'Select a gender.';
  if (!v.intendedClassId) e.intendedClassId = 'Select the class applied for.';
  if (!v.guardianName.trim()) e.guardianName = 'Enter the guardian full name.';
  if (!normalizePhone(v.guardianPhone)) e.guardianPhone = 'Enter a valid phone number, for example 08031234567.';
  if (v.guardianEmail.trim() && !/^\S+@\S+\.\S+$/.test(v.guardianEmail.trim())) e.guardianEmail = 'Enter a valid email or leave it blank.';
  const anyEmergency = v.emergencyName.trim() || v.emergencyPhone.trim();
  if (anyEmergency || !opts.draft) {
    if (!v.emergencyName.trim()) e.emergencyName = 'Enter the emergency contact name.';
    if (!normalizePhone(v.emergencyPhone)) e.emergencyPhone = 'Enter a valid emergency phone number.';
  }
  if (!opts.draft && opts.requiredDocuments?.length) {
    const have = new Set((opts.documents ?? []).map(d => d.documentType.toLowerCase()));
    const missing = opts.requiredDocuments.filter(d => !have.has(d.toLowerCase()));
    if (missing.length) e.documents = `Upload required document(s): ${missing.join(', ')}.`;
  }
  return e;
}

const opt = (s: string) => (s.trim() ? s.trim() : undefined);
const optNull = (s: string) => (s.trim() ? s.trim() : null);

export function buildPayload(v: FormValues, photoObjectPath: string | undefined, documents: AdmissionDocumentInput[]): {
  applicant: AdmissionApplicantInput; guardian: AdmissionGuardianInput; emergencyContact?: AdmissionEmergencyContactInput; documents?: AdmissionDocumentInput[];
} {
  const applicant: AdmissionApplicantInput = {
    firstName: v.firstName.trim(), middleName: optNull(v.middleName), lastName: v.lastName.trim(),
    dateOfBirth: v.dateOfBirth, gender: v.gender as AdmissionApplicantInput['gender'],
    previousSchool: optNull(v.previousSchool), previousClass: optNull(v.previousClass),
    intendedClassId: Number(v.intendedClassId), address: optNull(v.address),
    ...(photoObjectPath ? { photoObjectPath } : {}),
    ...(v.academicSessionId ? { academicSessionId: Number(v.academicSessionId) } : {}),
    ...(v.academicTermId ? { academicTermId: Number(v.academicTermId) } : {}),
  };
  const guardian: AdmissionGuardianInput = {
    fullName: v.guardianName.trim(), phone: normalizePhone(v.guardianPhone) as string,
    ...(opt(v.guardianEmail) ? { email: opt(v.guardianEmail) } : {}),
    relationship: optNull(v.guardianRelationship), address: optNull(v.guardianAddress),
  };
  const out: ReturnType<typeof buildPayload> = { applicant, guardian };
  if (v.emergencyName.trim() && normalizePhone(v.emergencyPhone)) {
    out.emergencyContact = { fullName: v.emergencyName.trim(), phone: normalizePhone(v.emergencyPhone) as string, relationship: optNull(v.emergencyRelationship) };
  }
  if (documents.length) out.documents = documents;
  return out;
}

export function checkFile(file: File, kind: 'photo' | 'document'): string | null {
  if (!(ACCEPTED_MIME as readonly string[]).includes(file.type)) return 'Use a PDF, JPEG, PNG or WebP file.';
  if (kind === 'photo' && !file.type.startsWith('image/')) return 'A photograph must be an image.';
  if (file.size < 1 || file.size > MAX_FILE_BYTES) return 'File must be between 1 byte and 5 MB.';
  return null;
}

export const uploadInput = (file: File, documentType: string): AdmissionDocumentUploadInput => ({
  documentType, fileName: file.name, contentType: file.type as AdmissionDocumentUploadInput['contentType'], byteSize: file.size,
});

export async function putToSignedUrl(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
  if (!res.ok) throw new Error(`Upload failed (${res.status}). Try again.`);
}

export function apiMessage(err: unknown, fallback = 'Something went wrong. Check the details and try again.'): string {
  const e = err as { data?: { error?: string; message?: string } | null; message?: string; status?: number } | null;
  if (e?.status === 429) return 'Too many attempts. Wait a minute and retry.';
  return e?.data?.error ?? e?.data?.message ?? (e?.message && e.message.length < 200 ? e.message : fallback);
}

export function canConvert(app: { status: string; studentId?: number | null }): boolean {
  return app.status === 'Accepted' && !app.studentId;
}

export function receiptText(r: { applicationNumber: string; receiptSecret: string }, school?: string): string {
  return [
    school ? `School: ${school}` : '', `Application number: ${r.applicationNumber}`, `Tracking code: ${r.receiptSecret}`,
    'Keep this code private. You need it, the application number and the guardian phone number to track the application.',
  ].filter(Boolean).join('\n');
}

/** Request options whose Idempotency-Key is read at call time from the holder (so mutate() right after resolve uses the fresh key). */
export function liveKeyRequest(keyRef: { current: string }) {
  return { headers: { get 'Idempotency-Key'() { return keyRef.current; } } as Record<string, string> };
}

/** Validate the API-returned portalUrl: same-origin only; relative paths are anchored to the app base. */
export function resolvePortalUrl(portalUrl: string | undefined, portalKey: string, origin = typeof window !== 'undefined' ? window.location.origin : ''): string {
  try {
    if (portalUrl) {
      if (portalUrl.startsWith('/') && !portalUrl.startsWith('//')) {
        const base = appBase();
        return `${origin}${base && !portalUrl.startsWith(`${base}/`) ? base : ''}${portalUrl}`;
      }
      const u = new URL(portalUrl);
      if (u.origin === origin) return u.href;
    }
  } catch { /* fall through */ }
  return portalUrlFor(portalKey, origin);
}

export function formFromApplication(a: {
  applicant: { firstName: string; middleName: string | null; lastName: string; dateOfBirth: string; gender: string; previousSchool: string | null; previousClass: string | null; intendedClassId: number; academicSessionId: number; academicTermId: number | null; address: string | null };
  guardian: { fullName: string; phone: string; email: string | null; relationship: string | null; address: string | null };
  emergencyContact?: { fullName: string; phone: string; relationship: string | null } | null;
}): FormValues {
  const p = a.applicant, g = a.guardian, e = a.emergencyContact;
  return {
    firstName: p.firstName, middleName: p.middleName ?? '', lastName: p.lastName, dateOfBirth: p.dateOfBirth.slice(0, 10), gender: p.gender as FormValues['gender'],
    previousSchool: p.previousSchool ?? '', previousClass: p.previousClass ?? '', intendedClassId: String(p.intendedClassId),
    academicSessionId: String(p.academicSessionId), academicTermId: p.academicTermId ? String(p.academicTermId) : '', address: p.address ?? '',
    guardianName: g.fullName, guardianPhone: g.phone, guardianEmail: g.email ?? '', guardianRelationship: g.relationship ?? '', guardianAddress: g.address ?? '',
    emergencyName: e?.fullName ?? '', emergencyPhone: e?.phone ?? '', emergencyRelationship: e?.relationship ?? '',
  };
}
