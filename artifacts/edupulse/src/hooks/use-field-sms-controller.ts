import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetFieldSmsCampaigns, getGetFieldSmsCampaignsQueryKey,
  usePreviewFieldSmsCampaign, useRecordFieldSmsPermission, useDispatchFieldSmsCampaign,
} from '@workspace/api-client-react';

export type SmsLead = { id: number; schoolName: string; contactPhone: string | null; allowed: boolean; eligible: boolean; reason: string | null };
export type SmsRecipient = { leadId: number; schoolName: string; phone: string; state: string; providerReference?: string | null; error?: string | null; retryable?: boolean };
export type SmsCampaign = { id: number; message: string; digest: string; createdAt: string; createdBy: string | number; recipients: SmsRecipient[] };
export type SmsData = { leads: SmsLead[]; campaigns: SmsCampaign[]; blockedReason: string | null };
export type SmsPreview = { id: number; digest: string; message: string; recipients: SmsRecipient[] };
export type SmsNotice = { tone: 'ok' | 'warn' | 'error'; text: string };
export type SmsPerm = { leadId: number; allowed: boolean; reason: string };

/** Cookie session on the same origin. Never a bearer token. */
export const SMS_REQUEST = { credentials: 'same-origin' } as const;

/** Clerk can refresh its cookie just after the first read. Retry that READ once,
 * never a preview/permission/dispatch mutation or an unavailable-storage error. */
export const retrySmsSessionRead = (failures: number, error: unknown) =>
  failures < 1 && (error as {status?:number} | null)?.status === 401;

export const VISIT_FOLLOW_UP_DRAFT =
  'Hello from Yetenia EduCore. Thank you for welcoming our team during the recent visit to your school. '
  + 'We would be glad to answer your questions and agree a convenient time to continue the conversation. '
  + 'To continue, please contact your Yetenia representative.';

export const isSmsData = (d: unknown): d is SmsData => { const s = d as SmsData | null; return !!s && Array.isArray(s.leads) && Array.isArray(s.campaigns); };

/** Server-decided eligibility only; never inferred from local lead fields. */
export const smsSendable = (l: SmsLead | undefined) => !!l && l.eligible && l.allowed;

const exclusionLabels: Record<string,string> = {
  SCHOOL_ALREADY_REGISTERED: 'Already onboarded',
  VISIT_REQUIRED: 'No completed school visit recorded',
  CONTACT_DECLINED: 'Contact opted out or is not interested',
  VALID_PHONE_REQUIRED: 'A valid contact phone is required',
  CONTACT_PERMISSION_REQUIRED: 'Verified contact permission is required',
  CONTACT_CHANGED_AFTER_PREVIEW: 'Contact changed; prepare a new preview',
};
export function smsExclusion(l: SmsLead | undefined): string {
  if (!l) return 'Not in server SMS contacts';
  if (!l.eligible) return l.reason ? (exclusionLabels[l.reason] ?? l.reason) : 'Not eligible (server)';
  if (!l.allowed) return l.reason || 'Contact permission not recorded';
  return '';
}

export function useFieldSmsController() {
  const { isLoaded, isSignedIn, sessionId, userId } = useAuth();
  const qc = useQueryClient();
  const sessionReady = !!(isLoaded && isSignedIn && sessionId && userId);
  const query = useGetFieldSmsCampaigns({
    query: {
      queryKey: [...getGetFieldSmsCampaignsQueryKey(), userId ?? 'anonymous', sessionId ?? 'no-session'],
      enabled: sessionReady,
      staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true, refetchInterval: 15_000,
      retry: retrySmsSessionRead, retryDelay: 1_000,
    },
    request: SMS_REQUEST,
  });
  const preview = usePreviewFieldSmsCampaign({ request: SMS_REQUEST, mutation: {retry:false} });
  const permission = useRecordFieldSmsPermission({ request: SMS_REQUEST, mutation: {retry:false} });
  const dispatch = useDispatchFieldSmsCampaign({ request: SMS_REQUEST, mutation: {retry:false} });

  const [message, setMessage] = useState(VISIT_FOLLOW_UP_DRAFT);
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [frozen, setFrozen] = useState<SmsPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState<SmsNotice | null>(null);
  const [perm, setPerm] = useState<SmsPerm | null>(null);
  const previewKey = useRef<string | null>(null);
  const uncertainCampaigns = useRef(new Set<number>());
  const composerRef = useRef<HTMLDivElement | null>(null);

  const resetPreview = () => { setFrozen(null); setConfirmed(false); previewKey.current = null; };

  // A genuine identity/session change discards all selection and frozen previews.
  const identity = `${userId ?? ''}:${sessionId ?? ''}`;
  const lastIdentity = useRef(identity);
  useEffect(() => {
    if (lastIdentity.current === identity) return;
    lastIdentity.current = identity;
    setPicked(new Set()); setAll(false); setPerm(null); setNotice(null);
    setFrozen(null); setConfirmed(false); previewKey.current = null; uncertainCampaigns.current = new Set();
  }, [identity]);

  const data = isSmsData(query.data) ? query.data : null;
  const byId = new Map((data?.leads ?? []).map(l => [l.id, l] as const));
  const sendable = (id: number) => smsSendable(byId.get(id));

  const toggle = (id: number) => {
    if (!sendable(id)) return;
    setAll(false);
    setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    resetPreview();
  };
  const setVisible = (ids: number[], on: boolean) => {
    const ok = ids.filter(sendable);
    setAll(false);
    setPicked(p => { const n = new Set(p); ok.forEach(id => on ? n.add(id) : n.delete(id)); return n; });
    resetPreview();
  };
  const focusComposer = () => {
    const el = composerRef.current;
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    el?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true });
  };
  /** Row action: replaces selection with exactly this school, discards any preview, opens the composer. Never sends. */
  const remind = (id: number) => {
    if (!sendable(id)) return;
    setAll(false); setPicked(new Set([id])); resetPreview();
    focusComposer();
  };
  /** Opens the existing reason-required permission / opt-out recorder. Never grants anything by itself. */
  const openPermission = (id: number, allowed = true) => {
    setPerm({ leadId: id, allowed, reason: '' });
    setTimeout(() => document.querySelector('[data-testid="sms-permission-form"]')?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }), 0);
  };
  /** Async completions must check this token so an old session's result never lands in a new session's UI. */
  const captureSession = () => { const t = lastIdentity.current; return () => t === lastIdentity.current; };
  const invalidate = () => qc.invalidateQueries({ queryKey: getGetFieldSmsCampaignsQueryKey() });

  return {
    query, data, sessionReady, isLoaded, isSignedIn, preview, permission, dispatch,
    message, setMessage, all, setAll, picked, setPicked, frozen, setFrozen, confirmed, setConfirmed,
    notice, setNotice, perm, setPerm, previewKey, uncertainCampaigns, composerRef,
    resetPreview, captureSession, sendable, toggle, setVisible, remind, focusComposer, openPermission, invalidate, byId,
  };
}

export type FieldSmsController = ReturnType<typeof useFieldSmsController>;
