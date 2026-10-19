export type ApplicantType = 'SCHOOL_ADMIN' | 'PARTNER';
const KEY = 'edupulse:application-intent';
// Non-authoritative UI hint only. The server decides everything.
export function parseApplicantType(v: string | null | undefined): ApplicantType | null {
  return v === 'SCHOOL_ADMIN' || v === 'PARTNER' ? v : null;
}
export function saveApplicationIntent(type: ApplicantType, referralToken?: string | null) {
  try { window.sessionStorage.setItem(KEY, JSON.stringify({ type, referralToken: referralToken || '' })); } catch {
    // Browser storage is a convenience, never an authorization requirement.
  }
}
export function readApplicationIntent(): { type: ApplicantType | null; referralToken: string } {
  try {
    const raw = JSON.parse(window.sessionStorage.getItem(KEY) || 'null');
    return { type: parseApplicantType(raw?.type), referralToken: typeof raw?.referralToken === 'string' ? raw.referralToken : '' };
  } catch { return { type: null, referralToken: '' }; }
}
export function clearApplicationIntent() { try { window.sessionStorage.removeItem(KEY); } catch { /* Optional UI hint. */ } }
export function applyErrorMessage(e: unknown): string {
  const x = e as { status?: number; data?: { error?: string }; message?: string };
  if (x?.data?.error) return x.data.error;
  if (x?.status === 409) return 'This request conflicts with the current account or application state. Refresh to review it.';
  return x?.data?.error || x?.message || 'Something went wrong. Please try again.';
}
export function notificationCopy(s: string): string {
  switch (s) {
    case 'ACCEPTED': return 'Email accepted by provider (delivery not confirmed)';
    case 'SENDING': return 'Email sending: needs review, will not be resent automatically';
    case 'UNKNOWN': return 'Email outcome unknown: needs review, will not be resent automatically';
    case 'FAILED': return 'Email failed';
    case 'UNAVAILABLE': return 'Email unavailable';
    default: return 'No email requested';
  }
}
