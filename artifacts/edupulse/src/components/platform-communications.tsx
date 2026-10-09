import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, UsersRound, History } from 'lucide-react';
import { phase9Request } from '@/hooks/use-phase9-api';
import { PageHeading, Button, Field, StatusPill, EmptyState, ErrorState, SkeletonPage, date, time } from '@/components/shared';

type DirSchool = { id: number; name: string; code: string; status: string };
type Preview = { schools: { id: number; name: string; recipientCount: number }[]; recipientCount: number };
type Campaign = { id: number; schoolId: number; schoolName: string; subject: string; body: string; status: string; recipientCount: number; createdAt: string; deliveryStates: { status: string; count: number }[] };
type Payload = { schoolIds: number[]; subject: string; body: string; idempotencyKey: string; confirmedRecipientCount:number };
const inputClass = 'w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2.5 text-sm';
const newKey = () => `owner-${crypto.randomUUID()}`.slice(0, 80);

export function PlatformCommunications() {
  const qc = useQueryClient();
  const dir = useQuery<{ schools: DirSchool[] }>({ queryKey: ['platform', 'schools-directory'], queryFn: () => phase9Request('/platform/schools/directory'), staleTime: 15_000 });
  const history = useQuery<{ campaigns: Campaign[] }>({ queryKey: ['platform', 'communications'], queryFn: () => phase9Request('/platform/communications'), staleTime: 5_000, refetchInterval: 20_000 });
  const [selected, setSelected] = useState<number[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, setPending] = useState<{ payload: Payload } | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const busy = useRef(false);
  const active = useMemo(() => (dir.data?.schools ?? []).filter(s => s.status.toUpperCase() === 'ACTIVE'), [dir.data]);
  const names = (ids: number[]) => ids.map(id => active.find(s => s.id === id)?.name ?? `School #${id}`);
  const locked = !!pending;
  const dirty = () => { setPreview(null); setNotice(''); setConfirming(false); };
  const sub = subject.trim(), bod = body.trim();
  const valid = selected.length >= 1 && selected.length <= 50 && sub.length >= 1 && sub.length <= 160 && bod.length >= 1 && bod.length <= 5000;

  const previewM = useMutation({ mutationFn: (ids: number[]) => phase9Request<Preview>('/platform/communications/preview', 'POST', { schoolIds: ids }) });
  const sendM = useMutation({ mutationFn: (p: Payload) => phase9Request<{ campaigns: Campaign[] }>('/platform/communications', 'POST', p) });

  const onPreview = async () => {
    if (busy.current || !valid) return; busy.current = true; setError('');
    try { setPreview(await previewM.mutateAsync(selected)); } catch (e) { setPreview(null); setError(e instanceof Error ? e.message : 'Preview failed.'); } finally { busy.current = false; }
  };
  const send = async (payload: Payload) => {
    if (busy.current) return; busy.current = true; setError(''); setConfirming(false);
    try {
      const r = await sendM.mutateAsync(payload);
      setPending(null); setSelected([]); setSubject(''); setBody(''); setPreview(null);
      setNotice(`Saved for ${r.campaigns.length} school${r.campaigns.length === 1 ? '' : 's'}. Delivery is in-app only; see history for states.`);
      await qc.invalidateQueries({ queryKey: ['platform', 'communications'] });
    } catch (e) {
      setPending({ payload });
      setError((e instanceof Error ? e.message : 'Network failure') + ' The outcome is unknown. Retry sends the identical message with the same key, so it cannot duplicate.');
    } finally { busy.current = false; }
  };
  const startConfirm = () => { if (!preview || busy.current) return; setConfirming(true); };
  const confirmSend = () => {if(preview)void send({ schoolIds: [...selected], subject: sub, body: bod, idempotencyKey: newKey(),confirmedRecipientCount:preview.recipientCount });};
  const startNew = () => { if (!window.confirm('Start a new message? The unconfirmed one may already have been sent; the new one will be treated as separate.')) return; setPending(null); setError(''); setPreview(null); };

  return <div className="fade-up">
    <PageHeading eyebrow="Platform / Communications" title="Platform communications." description="Send an in-app message to the School Admins of schools you explicitly choose. There is no broadcast to all schools. Messages appear in their existing inbox; no email or SMS is sent." />
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,.8fr)]">
      <section className="panel p-5 md:p-7">
        <div className="eyebrow">01 / Schools</div>
        <h2 className="display-font mt-1 text-xl font-bold">Choose recipients</h2>
        {dir.isLoading ? <SkeletonPage /> : dir.isError ? <ErrorState retry={() => void dir.refetch()} /> : <>
          <div className="mt-2 text-xs font-bold" data-testid="text-comm-count">{selected.length} of 50 active schools selected</div>
          <div className="mt-2 max-h-60 divide-y divide-[hsl(var(--border))] overflow-y-auto rounded-xl border border-[hsl(var(--border))]">
            {active.map(s => <label key={s.id} className="flex items-center gap-3 p-3 text-sm"><input type="checkbox" data-testid={`checkbox-comm-school-${s.id}`} disabled={locked || (!selected.includes(s.id) && selected.length >= 50)} checked={selected.includes(s.id)} onChange={() => { setSelected(p => p.includes(s.id) ? p.filter(x => x !== s.id) : [...p, s.id]); dirty(); }} /><span className="flex-1 font-semibold">{s.name}</span><span className="text-xs text-[hsl(var(--muted-foreground))]">{s.code}</span></label>)}
            {!active.length && <p className="p-4 text-sm text-[hsl(var(--muted-foreground))]">No active schools.</p>}
          </div></>}
        <div className="mt-6 space-y-4">
          <Field label="Subject (1-160 characters)"><input className={inputClass} data-testid="input-comm-subject" maxLength={160} disabled={locked} value={subject} onChange={e => { setSubject(e.target.value); dirty(); }} /></Field>
          <Field label="Message (1-5000 characters)"><textarea className={`${inputClass} min-h-40 resize-y`} data-testid="textarea-comm-body" maxLength={5000} disabled={locked} value={body} onChange={e => { setBody(e.target.value); dirty(); }} /></Field>
        </div>
        <div className="mt-5 rounded-xl bg-[hsl(var(--secondary)/.4)] p-4 text-sm">
          <div className="eyebrow mb-2">02 / Recipients</div>
          {preview ? <div data-testid="panel-comm-preview"><div className="display-font text-3xl font-bold">{preview.recipientCount}</div><p className="text-xs text-[hsl(var(--muted-foreground))]">School Admins across {preview.schools.length} schools</p><ul className="mt-2 space-y-1 text-xs">{preview.schools.map(s => <li key={s.id} className="flex justify-between"><span>{s.name}</span><strong>{s.recipientCount}</strong></li>)}</ul></div> : <p className="text-xs text-[hsl(var(--muted-foreground))]">{selected.length ? `Selected: ${names(selected).join(', ')}. ` : ''}Preview recipients to unlock sending. Any change resets the preview.</p>}
        </div>
        {error && <p role="alert" data-testid="text-comm-error" className="mt-4 text-sm text-[hsl(var(--destructive))]">{error}</p>}
        {notice && <p role="status" data-testid="text-comm-notice" className="mt-4 text-sm font-semibold">{notice}</p>}
        {confirming && preview && <div role="alertdialog" aria-label="Confirm send" className="mt-4 rounded-xl border border-[hsl(var(--primary)/.4)] p-4 text-sm" data-testid="panel-comm-confirm"><p className="font-bold">Send "{sub}" to School Admins of {preview.schools.length} schools?</p><p className="mt-1 text-xs">{names(selected).join(', ')}</p><div className="mt-3 flex gap-2"><Button testId="button-comm-confirm" onClick={confirmSend}><Send size={15} />Confirm and send</Button><Button variant="quiet" onClick={() => setConfirming(false)}>Cancel</Button></div></div>}
        <div className="mt-5 flex flex-wrap gap-2">
          {pending ? <>
            <Button testId="button-comm-retry" disabled={sendM.isPending} onClick={() => void send(pending.payload)}><Send size={15} />{sendM.isPending ? 'Sending...' : 'Retry same message'}</Button>
            <Button variant="outline" disabled={sendM.isPending} onClick={startNew}>Start a new message</Button>
          </> : <>
            <Button variant="outline" testId="button-comm-preview" disabled={!valid || previewM.isPending} onClick={() => void onPreview()}><UsersRound size={16} />{previewM.isPending ? 'Checking...' : 'Preview recipients'}</Button>
            <Button testId="button-comm-send" disabled={!preview || !preview.recipientCount || sendM.isPending || !valid} onClick={startConfirm}><Send size={16} />{sendM.isPending ? 'Sending...' : 'Review and send'}</Button>
          </>}
        </div>
      </section>
      <section className="panel overflow-hidden">
        <div className="border-b border-[hsl(var(--border))] p-5"><div className="eyebrow">History</div><h2 className="display-font mt-1 text-xl font-bold">Sent messages</h2></div>
        {history.isLoading ? <SkeletonPage /> : history.isError ? <ErrorState retry={() => void history.refetch()} /> : !history.data?.campaigns.length ? <EmptyState icon={History} title="Nothing sent yet" description="Messages you send to School Admins will be listed here with their delivery states." /> :
          <div className="max-h-[720px] divide-y divide-[hsl(var(--border))] overflow-y-auto">{history.data.campaigns.map(c => <div key={c.id} className="p-5" data-testid={`row-campaign-${c.id}`}>
            <div className="flex items-start justify-between gap-3"><strong className="text-sm">{c.subject}</strong><StatusPill value={c.status} /></div>
            <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{c.schoolName} · {c.recipientCount} recipients · {date(c.createdAt)} {time(c.createdAt)}</div>
            <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs">{c.body}</p>
            <div className="mt-2 flex flex-wrap gap-2">{c.deliveryStates.map(d => <span key={d.status} className="rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[11px] font-bold">{d.status.toLowerCase().replaceAll('_', ' ')}: {d.count}</span>)}</div>
          </div>)}</div>}
      </section>
    </div>
  </div>;
}
