import type { ApplicantType } from '@/lib/application-intent';
import type { AccountApplicationInput } from '@workspace/api-client-react';
import { z } from 'zod';

export type PartnerType = 'BUSINESS' | 'INDIVIDUAL';
export interface ApplicationValues {
  applicantType: ApplicantType;
  fullName: string; phone: string; email: string;
  schoolName: string; address: string; businessName: string; partnerType: '' | PartnerType;
  referralToken: string;
}
export type FieldErrors = Partial<Record<keyof ApplicationValues, string>>;
export const DRAFT_KEY = 'edupulse:application-draft';
export const DRAFT_TTL_MS = 30 * 60 * 1000;

export function emptyValues(applicantType: ApplicantType = 'SCHOOL_ADMIN', referralToken = ''): ApplicationValues {
  return { applicantType, fullName: '', phone: '', email: '', schoolName: '', address: '', businessName: '', partnerType: '', referralToken: applicantType === 'SCHOOL_ADMIN' ? referralToken : '' };
}
// Switching type keeps only shared fields; incompatible fields are discarded.
export function switchApplicantType(v: ApplicationValues, t: ApplicantType): ApplicationValues {
  if (v.applicantType === t) return v;
  return { ...emptyValues(t, v.referralToken), fullName: v.fullName, phone: v.phone };
}
export function normalizePhone(raw: string): string {
  let p = raw.replace(/[\s\-.()]/g, '');
  if (p.startsWith('00')) p = `+${p.slice(2)}`;
  else if (/^0[789]\d{9}$/.test(p)) p = `+234${p.slice(1)}`;
  else if (/^234\d{10}$/.test(p)) p = `+${p}`;
  return p;
}
export const normalizeName = (s: string) => s.replace(/\s+/g, ' ').trim();
export function validateApplication(v: ApplicationValues): { errors: FieldErrors; data: AccountApplicationInput | null } {
  const errors: FieldErrors = {};
  const school = v.applicantType === 'SCHOOL_ADMIN';
  const fullName = normalizeName(v.fullName);
  const phone = normalizePhone(v.phone);
  const email = v.email.trim().toLowerCase();
  if (fullName.length < 2 || fullName.length > 200) errors.fullName = 'Enter your full name (2–200 characters).';
  if (!v.phone.trim()) errors.phone = 'Phone Number is required.';
  else if (!/^\+[1-9]\d{7,14}$/.test(phone)) errors.phone = 'Enter a valid phone number, for example 0803 123 4567 or +14155550123.';
  if (school && (v.schoolName.trim().length < 2 || v.schoolName.trim().length > 200)) errors.schoolName = 'Enter a School Name (2–200 characters).';
  if (v.address.trim().length > 500) errors.address = 'Address must be at most 500 characters.';
  if (v.businessName.trim().length > 200) errors.businessName = 'Business Name must be at most 200 characters.';
  if (!email) errors.email = 'Email is required.';
  else if (email.length > 254 || !z.string().email().safeParse(email).success) errors.email = 'Enter a valid email address.';
  if (!school) {
    if (v.partnerType !== 'BUSINESS' && v.partnerType !== 'INDIVIDUAL') errors.partnerType = 'Choose a Partner Type.';
  }
  if (Object.keys(errors).length) return { errors, data: null };
  const data: AccountApplicationInput = { applicantType: v.applicantType, fullName, phone, email };
  if (school) {
    data.schoolName = normalizeName(v.schoolName);
    if (v.address.trim()) data.address = normalizeName(v.address);
    if (v.referralToken) data.referralToken = v.referralToken;
  } else {
    data.email = email; data.partnerType = v.partnerType as PartnerType;
    if (v.businessName.trim()) data.businessName = normalizeName(v.businessName);
  }
  return { errors, data };
}
export function saveDraft(v: ApplicationValues): { ok: boolean; error?: string } {
  try { window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ v, savedAt: Date.now() })); return { ok: true }; }
  catch { return { ok: false, error: 'Your browser blocked temporary storage, so we cannot continue sign-up safely. Enable site storage and try again.' }; }
}
export function loadDraft(): ApplicationValues | null {
  try {
    const raw = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) || 'null');
    if (!raw?.v || typeof raw.savedAt !== 'number' || Date.now() - raw.savedAt > DRAFT_TTL_MS || raw.savedAt > Date.now() + 60000) { clearDraft(); return null; }
    const t = raw.v.applicantType;
    if (t !== 'SCHOOL_ADMIN' && t !== 'PARTNER') return null;
    const base = emptyValues(t);
    const out = { ...base };
    for (const k of Object.keys(base) as (keyof ApplicationValues)[]) if (typeof raw.v[k] === 'string') (out as Record<string, string>)[k] = raw.v[k];
    return out;
  } catch { return null; }
}
export function clearDraft() { try { window.sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } }
