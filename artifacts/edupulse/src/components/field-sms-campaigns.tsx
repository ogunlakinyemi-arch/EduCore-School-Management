import { useRef, useState, type ReactNode } from 'react';
import { useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetFieldSmsCampaigns, getGetFieldSmsCampaignsQueryKey,
  usePreviewFieldSmsCampaign, useRecordFieldSmsPermission, useDispatchFieldSmsCampaign,
} from '@workspace/api-client-react';
import { MessageSquareText, RefreshCw, ShieldAlert } from 'lucide-react';
import { Button, Field, StatusPill } from '@/components/shared';
import { apiErrorText, isDefinitiveRejection, isUnavailable, newKey } from '@/lib/current-finance';

type Lead = { id: number; schoolName: string; contactPhone: string | null; allowed: boolean; eligible: boolean; reason: string | null };
type Recipient = { leadId: number; schoolName: string; phone: string; state: string; providerReference?: string | null; error?: string | null; retryable?:boolean };
type Campaign = { id: number; message: string; digest: string; createdAt: string; createdBy: string | number; recipients: Recipient[] };
type SmsData = { leads: Lead[]; campaigns: Campaign[]; blockedReason: string | null };
type Preview = { id: number; digest: string; message: string; recipients: Recipient[] };

const muted = 'text-[hsl(var(--muted-foreground))]';
const isSms = (d: unknown): d is SmsData => { const s = d as SmsData | null; return !!s && Array.isArray(s.leads) && Array.isArray(s.campaigns); };
const UNCERTAIN = ['REQUESTED', 'PROCESSING', 'UNKNOWN'];

/** A campaign may be re-dispatched only when every non-final recipient is a proven failure. */
export function campaignRetryable(c: Campaign): boolean {
  return c.recipients.some(r => r.state === 'FAILED'&&r.retryable===true) && !c.recipients.some(r => UNCERTAIN.includes(r.state));
}

export function FieldSmsCampaigns() {
  const { user } = useUser();
  const qc = useQueryClient();
  const q = useGetFieldSmsCampaigns({ query: {
    queryKey: [...getGetFieldSmsCampaignsQueryKey(), user?.id ?? 'anonymous'], enabled: !!user?.id,
    staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true, refetchInterval: 15_000, retry: false,
  } });
  const preview = usePreviewFieldSmsCampaign();
  const permission = useRecordFieldSmsPermission();
  const dispatch = useDispatchFieldSmsCampaign();
  const [message, setMessage] = useState('');
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [frozen, setFrozen] = useState<Preview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [perm, setPerm] = useState<{ leadId: number; allowed: boolean; reason: string } | null>(null);
  const previewKey = useRef<string | null>(null);
  const uncertainCampaigns = useRef(new Set<number>());

  const invalidate = () => qc.invalidateQueries({ queryKey: getGetFieldSmsCampaignsQueryKey() });
  const resetPreview = () => { setFrozen(null); setConfirmed(false); previewKey.current = null; };

  const wrap = (body: ReactNode) => <section className="panel mb-6 overflow-hidden" data-testid="field-sms">
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-[hsl(var(--border))] p-5">
      <div><div className="eyebrow">Owner outreach · SMS only</div><h2 className="display-font mt-1 text-xl font-bold">Field SMS campaigns</h2>
        <p className={`mt-1 max-w-2xl text-xs ${muted}`}>Contacts are not messaged by default. Record a legitimate permission first; selecting a recipient is never permission. Every send needs an explicit preview and confirmation.</p></div>
      <Button variant="outline" onClick={() => void q.refetch()} testId="button-refresh-sms"><RefreshCw size={14} />Refresh</Button>
    </header>
    {notice && <div role={notice.tone === 'error' ? 'alert' : 'status'} className={`m-5 rounded-xl border p-3 text-sm ${notice.tone === 'ok' ? 'border-[hsl(157_37%_43%/.4)]' : notice.tone === 'warn' ? 'border-[hsl(var(--accent)/.5)] bg-[hsl(var(--accent)/.08)]' : 'border-[hsl(var(--destructive)/.4)]'}`} data-testid="sms-notice">{notice.text}</div>}
    {body}
  </section>;

  if (q.isLoading) return wrap(<div className="space-y-3 p-5">{[0, 1, 2].map(i => <div key={i} className="skeleton h-12 rounded-xl" />)}</div>);
  if (q.isError && isUnavailable(q.error)) return wrap(<div className="flex gap-3 p-5" role="status"><ShieldAlert size={18} className="text-[hsl(var(--accent))]" /><p className="text-sm">Field SMS is not enabled on this server. No message can be sent.</p></div>);
  if (q.isError || !isSms(q.data)) return wrap(<div className="p-5" role="alert"><p className="text-sm">{q.isError ? apiErrorText(q.error, 'SMS campaigns could not be loaded.') : 'Unexpected server response.'}</p><Button className="mt-3" variant="outline" onClick={() => void q.refetch()}>Retry</Button></div>);
  const data = q.data;
  const eligible = data.leads.filter(l => l.eligible && l.allowed);
  const leadIds = [...picked].filter(id => eligible.some(l => l.id === id)).sort((a, b) => a - b);
  const blocked = !!data.blockedReason;

  const doPreview = async () => {
    previewKey.current ??= newKey();
    try {
      const res = await preview.mutateAsync({ data: { message: message.trim(), key: previewKey.current, all, ...(all ? {} : { leadIds }) } }) as unknown as Preview;
      setFrozen(res); setConfirmed(false); setNotice({ tone: 'ok', text: `Preview frozen for ${res.recipients.length} recipient(s). Nothing has been sent.` });
    } catch (e) {
      if (isDefinitiveRejection(e)) previewKey.current = null;
      setNotice({ tone: 'error', text: apiErrorText(e, 'Preview failed.') });
    }
  };
  const doDispatch = async (id: number, digest: string) => {
    try {
      await dispatch.mutateAsync({ id, data: { digest, confirm: true } });
      setNotice({ tone: 'ok', text: 'Dispatch results saved. Review recipient states and continue any unsent contacts from history. Provider acceptance is not proof of delivery.' });
      resetPreview(); setMessage(''); setPicked(new Set()); setAll(false);
    } catch (e) {
      if (!isDefinitiveRejection(e)) uncertainCampaigns.current.add(id);
      setNotice({ tone: isDefinitiveRejection(e) ? 'error' : 'warn', text: isDefinitiveRejection(e) ? apiErrorText(e, 'Dispatch was refused.')
        : `${apiErrorText(e, 'Dispatch outcome is unknown.')} Uncertain recipients will not be resent. Refresh history to review any unsent contacts before continuing.` });
    } finally { await invalidate(); }
  };
  const savePermission = async () => {
    if (!perm) return;
    try {
      await permission.mutateAsync({ data: { leadId: perm.leadId, allowed: perm.allowed, reason: perm.reason.trim() } });
      setNotice({ tone: 'ok', text: perm.allowed ? 'Contact permission recorded.' : 'Opt-out recorded. This contact will be excluded.' }); setPerm(null); resetPreview();
    } catch (e) { setNotice({ tone: 'error', text: apiErrorText(e, 'Permission could not be recorded.') }); }
    finally { await invalidate(); }
  };

  return wrap(<div className="grid gap-0 lg:grid-cols-[1.1fr_1fr]">
    <div className="border-b border-[hsl(var(--border))] p-5 lg:border-b-0 lg:border-r">
      {blocked && <div role="status" className="mb-4 rounded-xl border border-[hsl(var(--accent)/.5)] bg-[hsl(var(--accent)/.08)] p-3 text-sm" data-testid="sms-blocked">SMS sending is blocked: {data.blockedReason}</div>}
      <div className="mb-2 flex items-center justify-between"><h3 className="font-bold">Contacts</h3>
        <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" className="!w-4 h-4" checked={all} onChange={e => { setAll(e.target.checked); resetPreview(); }} data-testid="check-sms-all" />All eligible ({eligible.length})</label></div>
      {data.leads.length === 0 ? <p className={`rounded-xl border border-dashed p-4 text-sm ${muted}`}>No field leads with contact numbers yet.</p> :
        <ul className="max-h-[420px] divide-y divide-[hsl(var(--border))] overflow-y-auto text-sm">{data.leads.map(l => <li key={l.id} className="py-2.5">
          <div className="flex items-start gap-3">
            <input type="checkbox" className="!w-4 mt-1 h-4" disabled={all || !l.eligible || !l.allowed} checked={all ? l.eligible && l.allowed : picked.has(l.id)} onChange={() => { setPicked(p => { const n = new Set(p); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; }); resetPreview(); }} aria-label={`Select ${l.schoolName}`} data-testid={`check-sms-lead-${l.id}`} />
            <div className="min-w-0 flex-1"><div className="font-semibold">{l.schoolName}</div>
              <div className={`font-mono text-xs ${muted}`}>{l.contactPhone ?? 'No phone'}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs"><StatusPill value={l.allowed ? 'PERMITTED' : 'NO_PERMISSION'} />{l.reason && <span className={muted}>{l.reason}</span>}</div></div>
            <div className="flex shrink-0 gap-1">
              <button type="button" className="text-xs font-bold underline" onClick={() => setPerm({ leadId: l.id, allowed: true, reason: '' })} data-testid={`button-permit-${l.id}`}>Permit</button>
              <button type="button" className="text-xs font-bold text-[hsl(var(--destructive))] underline" onClick={() => setPerm({ leadId: l.id, allowed: false, reason: '' })} data-testid={`button-optout-${l.id}`}>Opt out</button></div>
          </div>
          {perm?.leadId === l.id && <div className="mt-2 grid gap-2 rounded-xl bg-[hsl(var(--muted)/.4)] p-3 md:grid-cols-[1fr_auto] md:items-end">
            <Field label={perm.allowed ? 'How was permission obtained? (5-500 chars)' : 'Opt-out reason (5-500 chars)'}><input value={perm.reason} maxLength={500} onChange={e => setPerm({ ...perm, reason: e.target.value })} data-testid="input-permission-reason" /></Field>
            <div className="flex gap-2"><Button variant="outline" className="h-9 px-3 text-xs" onClick={() => setPerm(null)}>Cancel</Button>
              <Button className="h-9 px-3 text-xs" disabled={perm.reason.trim().length < 5 || permission.isPending} onClick={() => void savePermission()} testId="button-save-permission">{permission.isPending ? 'Saving...' : 'Record'}</Button></div></div>}
        </li>)}</ul>}
    </div>
    <div className="p-5">
      <Field label={`Message (${message.length}/1000)`}><textarea rows={4} maxLength={1000} value={message} onChange={e => { setMessage(e.target.value); resetPreview(); }} data-testid="input-sms-message" /></Field>
      <Button className="mt-3" variant="outline" disabled={blocked || !message.trim() || (!all && !leadIds.length) || preview.isPending || !!frozen} onClick={() => void doPreview()} testId="button-sms-preview">{preview.isPending ? 'Freezing preview...' : 'Preview recipients'}</Button>
      {frozen && <div className="mt-4 rounded-xl border border-[hsl(var(--primary)/.35)] p-4" data-testid="sms-preview">
        <div className="eyebrow">Frozen preview · nothing sent</div>
        <p className="mt-2 whitespace-pre-wrap rounded-lg bg-[hsl(var(--muted)/.4)] p-3 text-sm">{frozen.message}</p>
        <ul className="mt-3 max-h-40 overflow-y-auto text-xs">{frozen.recipients.map(r => <li key={r.leadId} className="flex justify-between gap-2 py-1"><span>{r.schoolName} <span className="font-mono">{r.phone}</span></span><StatusPill value={r.state} /></li>)}</ul>
        <div className={`mt-2 break-all font-mono text-[10px] ${muted}`}>Digest {frozen.digest}</div>
        <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" className="!w-4 mt-0.5 h-4" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} data-testid="check-sms-confirm" />I confirm sending this exact message to the {frozen.recipients.filter(r => r.state==='REQUESTED'||(r.state==='FAILED'&&r.retryable===true)).length} queued or proven retryable recipient(s). Accepted and uncertain sends will not be repeated.</label>
        <Button className="mt-3" disabled={!confirmed || blocked || dispatch.isPending} onClick={() => void doDispatch(frozen.id, frozen.digest)} testId="button-sms-send">{dispatch.isPending ? 'Sending...' : 'Send confirmed campaign'}</Button>
      </div>}
      <h3 className="mt-6 font-bold">History</h3>
      {data.campaigns.length === 0 ? <div className={`mt-2 flex items-center gap-2 text-sm ${muted}`}><MessageSquareText size={15} />No campaigns sent yet.</div> :
        <ul className="mt-2 space-y-3">{data.campaigns.map(c => { const retry = campaignRetryable(c) && !uncertainCampaigns.current.has(c.id); return <li key={c.id} className="rounded-xl border border-[hsl(var(--border))] p-3 text-sm" data-testid={`sms-campaign-${c.id}`}>
          <div className={`text-xs ${muted}`}>#{c.id} · {new Date(c.createdAt).toLocaleString('en-NG',{timeZone:'Africa/Lagos'})} WAT · by {String(c.createdBy)}</div>
          <p className="mt-1 line-clamp-2 whitespace-pre-wrap">{c.message}</p>
          <ul className="mt-2 space-y-1 text-xs">{c.recipients.map(r => <li key={r.leadId} className="flex flex-wrap justify-between gap-2"><span>{r.schoolName} <span className="font-mono">{r.phone}</span>{r.error && <span className="ml-1 text-[hsl(var(--destructive))]">{r.error}</span>}</span><StatusPill value={r.state} /></li>)}</ul>
          {(retry||c.recipients.some(r=>r.state==='REQUESTED')) && <Button variant="outline" className="mt-2 h-8 px-3 text-xs" disabled={blocked || dispatch.isPending} onClick={() => {setFrozen(c);setConfirmed(false);setNotice({tone:'warn',text:'Review the full frozen preview above, then confirm. Only queued or proven retryable recipients will be sent.'});}} testId={`button-sms-retry-${c.id}`}>{c.recipients.some(r=>r.state==='REQUESTED')?'Review unsent recipients':'Review failed recipients'}</Button>}
          {c.recipients.some(r => UNCERTAIN.includes(r.state)) && <p className={`mt-2 text-xs ${muted}`}>Some recipients are unresolved; this campaign cannot be retried until their outcome is known.</p>}
        </li>; })}</ul>}
    </div>
  </div>);
}
