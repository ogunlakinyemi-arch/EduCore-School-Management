import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Send, FileText, History, UsersRound, RefreshCw, ChevronRight, RotateCcw } from 'lucide-react';
import {
  CommunicationCategory, CommunicationChannel, CommunicationOutboundChannel, CommunicationTargetType, CommunicationTemplateVariable,
  useGetAuthorizedContext, useListClasses, getListClassesQueryKey,
  useListCommunicationTemplates, useCreateCommunicationTemplate, useUpdateCommunicationTemplate,
  usePreviewCommunicationAnnouncement, useCreateCommunicationAnnouncement, useListCommunicationAnnouncements,
  useGetCommunicationAnnouncement, useRetryCommunicationDelivery,
  getListCommunicationTemplatesQueryKey, getListCommunicationAnnouncementsQueryKey, getGetCommunicationAnnouncementQueryKey
} from '@workspace/api-client-react';
import type { CommunicationTemplate, CommunicationTargetType as TargetType, CommunicationOutboundChannel as OutboundChannel, CommunicationCategory as Category } from '@workspace/api-client-react';
import { PageHeading, TenantPicker, useTenant, Button, Field, StatusPill, EmptyState, ErrorState, SkeletonPage, date, time, cx } from '@/components/shared';
import { campaignStatusLabel, deliveryStatusLabel, isSimulatedDelivery, manualCategory, type ComposeRole } from './communication-contract';

const categories = Object.values(CommunicationCategory);
const outbound = Object.values(CommunicationOutboundChannel);
const label = (value: string) => value.toLowerCase().replaceAll('_', ' ');
const inputClass = 'w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2.5 text-sm';

export function CommunicationsPage() {
  const { schoolId } = useTenant();
  const context = useGetAuthorizedContext().data;
  const roles = context?.roles?.filter(role => role.schoolId === schoolId && role.status === 'ACTIVE').map(role => role.role) ?? [];
  const admin = !context?.isPlatformOwner && roles.includes('SCHOOL_ADMIN');
  const teacher = !context?.isPlatformOwner && roles.includes('TEACHER');
  const accountant = !context?.isPlatformOwner && roles.includes('ACCOUNTANT');
  const [tab, setTab] = useState<'compose' | 'history' | 'templates'>('compose');
  if (context?.isPlatformOwner) return <div className="panel p-8" role="alert">School communication is not available to Platform Owners.</div>;
  return <div className="fade-up">
    <PageHeading eyebrow="School / Community" title="Communications." description={accountant && !admin && !teacher ? 'Send general finance notices to families and review communication history. This is not a payment confirmation channel.' : 'Write with care. Preview the audience before sending a school message.'} action={<TenantPicker />} />
    {!schoolId ? <EmptyState icon={UsersRound} title="Choose a school" description="Select an authorized school to view its communication workspace." /> : !(admin || teacher || accountant) ? <div className="panel p-8" role="alert">You do not have communication access for this school.</div> : <>
      <div role="tablist" aria-label="Communication workspace" className="mb-6 flex gap-1 overflow-x-auto rounded-xl bg-[hsl(var(--secondary)/.65)] p-1.5">
        {([{ id: 'compose' as const, title: 'Compose', icon: Send }, { id: 'history' as const, title: 'Delivery history', icon: History }, ...(admin ? [{ id: 'templates' as const, title: 'Templates', icon: FileText }] : [])]).map(({ id, title, icon: Icon }) => <button type="button" key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} data-testid={`tab-communications-${id}`} className={cx('inline-flex shrink-0 items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold', tab === id ? 'bg-[hsl(var(--card))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]')}><Icon size={16} />{title}</button>)}
      </div>
      {tab === 'compose' && <Compose key={schoolId} schoolId={schoolId} role={admin ? 'admin' : teacher ? 'teacher' : 'accountant'} onSent={() => setTab('history')} />}
      {tab === 'history' && <DeliveryHistory schoolId={schoolId} />}
      {tab === 'templates' && admin && <Templates schoolId={schoolId} />}
    </>}
  </div>;
}

function Compose({ schoolId, role, onSent }: { schoolId: number; role: ComposeRole; onSent: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const category = manualCategory(role);
  const [targetType, setTargetType] = useState<TargetType>(role === 'teacher' ? 'CLASS' : role === 'accountant' ? 'PARENTS' : 'SCHOOL');
  const [classId, setClassId] = useState('');
  const [section, setSection] = useState('');
  const [channels, setChannels] = useState<OutboundChannel[]>(['IN_APP']);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [previewValid, setPreviewValid] = useState(false);
  const [message, setMessage] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const classes = useListClasses({ schoolId }, { query: { enabled: !!schoolId, queryKey: getListClassesQueryKey({ schoolId }) } });
  const templates = useListCommunicationTemplates({ schoolId }, { query: { enabled: !!schoolId && role === 'admin', queryKey: getListCommunicationTemplatesQueryKey({ schoolId }) } });
  const preview = usePreviewCommunicationAnnouncement();
  const create = useCreateCommunicationAnnouncement();
  const criteria = targetType === 'CLASS' || targetType === 'SECTION' ? { classId: Number(classId), ...(targetType === 'SECTION' ? { section: section.trim() } : {}) } : {};
  const ready = !!title.trim() && !!body.trim() && !!channels.length && (!['CLASS', 'SECTION'].includes(targetType) || (Number(classId) > 0 && (targetType !== 'SECTION' || !!section.trim())));
  const dirty = () => { setPreviewValid(false); setMessage(''); };
  const onPreview = async () => {
    try { await preview.mutateAsync({ data: { schoolId, targetType, targetCriteria: criteria, channels } }); setPreviewValid(true); setMessage(''); }
    catch (cause) { setPreviewValid(false); setMessage(cause instanceof Error ? cause.message : 'Audience preview failed.'); }
  };
  const onSend = async () => {
    if (!previewValid || !preview.data?.recipientCount) return;
    if (!window.confirm(`Queue this message for ${preview.data.recipientCount} recipients? SMS and email use the current development test adapter; this does not confirm real-world delivery.`)) return;
    try {
      await create.mutateAsync({ data: { schoolId, title: title.trim(), subject: subject.trim() || null, body: body.trim(), category, targetType, targetCriteria: criteria, channels, templateId, idempotencyKey: key } });
      setKey(crypto.randomUUID()); setMessage('Message queued. Review delivery history for progress.'); setPreviewValid(false);
      await qc.invalidateQueries({ queryKey: getListCommunicationAnnouncementsQueryKey({ schoolId }) }); onSent();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Message could not be queued. The same request key is retained for a safe retry.'); }
  };
  const options: TargetType[] = role === 'teacher' ? ['CLASS', 'SECTION'] : role === 'accountant' ? ['PARENTS', 'STUDENTS'] : ['SCHOOL', 'PARENTS', 'STUDENTS', 'TEACHERS', 'STAFF', 'CLASS', 'SECTION'];
  return <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_330px]">
    <section className="panel p-5 md:p-7"><div className="eyebrow">01 / Draft</div><h2 className="display-font mt-2 text-2xl font-bold">Write a message</h2><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">{role === 'teacher' ? 'Class messages are limited to your assigned classes. The server verifies your assignment.' : role === 'accountant' ? 'A general finance notice for families only. Do not use this to confirm payments, issue receipts, or report verified balances; those updates come from the finance system.' : 'The school audience is resolved by the server, not by this browser. Manual messages are general announcements only.'}</p>
      <div className="mt-7 space-y-5">
        {role === 'admin' && <Field label="Use an active announcement template"><select className={inputClass} data-testid="select-message-template" value={templateId ?? ''} onChange={e => { const template = templates.data?.find(item => item.id === Number(e.target.value)); setTemplateId(template?.id ?? null); if (template) { setSubject(template.subject ?? ''); setBody(template.body); setChannels([template.channel as OutboundChannel]); } dirty(); }}><option value="">Write from scratch</option>{templates.data?.filter(item => item.isActive && item.category === category && item.channel !== 'PUSH').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>}
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Internal title"><input className={inputClass} data-testid="input-announcement-title" maxLength={160} required value={title} onChange={e => { setTitle(e.target.value); dirty(); }} placeholder="e.g. Term opening note" /></Field><div><div className="mb-1.5 text-xs font-bold text-[hsl(var(--muted-foreground))]">Manual message category</div><div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.4)] px-3 py-2.5 text-sm font-semibold" data-testid="text-announcement-category">{role === 'accountant' ? 'General finance notice' : 'General announcement'}</div></div></div>
        <Field label="Subject (optional)"><input className={inputClass} data-testid="input-announcement-subject" maxLength={200} value={subject} onChange={e => { setSubject(e.target.value); dirty(); }} /></Field>
        <Field label="Message"><textarea className={`${inputClass} min-h-44 resize-y`} data-testid="textarea-announcement-body" maxLength={10000} value={body} onChange={e => { setBody(e.target.value); dirty(); }} placeholder="Write your update here..." /></Field>
      </div>
    </section>
    <aside className="space-y-5">
      <section className="panel p-5 md:p-6"><div className="eyebrow">02 / Audience</div><h2 className="display-font mt-2 text-xl font-bold">Who receives it?</h2>
        <div className="mt-5 space-y-4"><Field label="Recipients"><select className={inputClass} data-testid="select-announcement-target" value={targetType} onChange={e => { setTargetType(e.target.value as TargetType); dirty(); }}>{options.map(item => <option key={item} value={item}>{label(item)}</option>)}</select></Field>
          {(targetType === 'CLASS' || targetType === 'SECTION') && <Field label="Class"><select className={inputClass} data-testid="select-announcement-class" value={classId} onChange={e => { setClassId(e.target.value); dirty(); }}><option value="">Select a class</option>{classes.data?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{classes.isError && <button type="button" onClick={() => void classes.refetch()} className="mt-2 text-xs font-bold text-[hsl(var(--primary))]">Retry classes</button>}</Field>}
          {targetType === 'SECTION' && <Field label="Section name"><input className={inputClass} data-testid="input-announcement-section" value={section} maxLength={100} onChange={e => { setSection(e.target.value); dirty(); }} /></Field>}
          <fieldset><legend className="mb-2 text-xs font-bold text-[hsl(var(--muted-foreground))]">Channels</legend><div className="flex flex-wrap gap-2">{outbound.map(item => <label key={item} className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-xs font-bold"><input type="checkbox" data-testid={`checkbox-channel-${item}`} checked={channels.includes(item)} onChange={() => { setChannels(prev => prev.includes(item) ? prev.filter(channel => channel !== item) : [...prev, item]); dirty(); }} />{label(item)}</label>)}</div></fieldset>
          <Button variant="outline" className="w-full" onClick={() => void onPreview()} disabled={!ready || preview.isPending}><UsersRound size={16} />{preview.isPending ? 'Checking recipients...' : 'Preview recipients'}</Button>
        </div>
      </section>
      <section className="panel p-5 md:p-6"><div className="eyebrow">03 / Dispatch</div><h2 className="display-font mt-2 text-xl font-bold">Review before sending</h2>
        {previewValid && preview.data ? <div className="mt-4"><div className="display-font text-4xl font-bold" data-testid="text-recipient-count">{preview.data.recipientCount}</div><p className="text-xs text-[hsl(var(--muted-foreground))]">eligible recipients</p><div className="mt-4 space-y-2">{preview.data.channelCounts.map(row => <div key={row.channel} className="flex justify-between text-xs"><span>{label(row.channel)}</span><strong>{row.eligibleRecipientCount}</strong></div>)}</div></div> : <p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">Preview the current audience to unlock sending. Changing any field resets the preview.</p>}
        <p className="mt-4 text-xs leading-5 text-[hsl(var(--muted-foreground))]">SMS and email provider acceptance is simulated in development. Queued and sent statuses do not prove delivery to a real device.</p>
        {message && <p className="mt-3 text-sm text-[hsl(var(--destructive))]" role="status">{message}</p>}
        <Button className="mt-5 w-full" disabled={!previewValid || !preview.data?.recipientCount || create.isPending} onClick={() => void onSend()}><Send size={16} />{create.isPending ? 'Queuing...' : 'Queue message'}</Button>
      </section>
    </aside>
  </div>;
}

function Templates({ schoolId }: { schoolId: number }) {
  const qc = useQueryClient();
  const query = useListCommunicationTemplates({ schoolId }, { query: { queryKey: getListCommunicationTemplatesQueryKey({ schoolId }) } });
  const create = useCreateCommunicationTemplate();
  const update = useUpdateCommunicationTemplate();
  const [editing, setEditing] = useState<CommunicationTemplate | 'new' | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ templateKey: '', name: '', category: 'ANNOUNCEMENT' as Category, channel: 'IN_APP' as typeof CommunicationChannel[keyof typeof CommunicationChannel], subject: '', body: '', allowedVariables: [] as (typeof CommunicationTemplateVariable[keyof typeof CommunicationTemplateVariable])[], isActive: true });
  const open = (item: CommunicationTemplate | 'new') => { setEditing(item); setError(''); setForm(item === 'new' ? { templateKey: '', name: '', category: 'ANNOUNCEMENT', channel: 'IN_APP', subject: '', body: '', allowedVariables: [], isActive: true } : { templateKey: item.templateKey, name: item.name, category: item.category, channel: item.channel, subject: item.subject ?? '', body: item.body, allowedVariables: item.allowedVariables, isActive: item.isActive }); };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const payload = { name: form.name.trim(), category: form.category, channel: form.channel, subject: form.subject.trim() || null, body: form.body.trim(), allowedVariables: form.allowedVariables, isActive: form.isActive };
      if (editing === 'new') await create.mutateAsync({ data: { ...payload, schoolId, templateKey: form.templateKey.trim() } });
      else if (editing) await update.mutateAsync({ templateId: editing.id, data: payload });
      setEditing(null); await qc.invalidateQueries({ queryKey: getListCommunicationTemplatesQueryKey({ schoolId }) });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save template.'); }
  };
  return <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,.8fr)]"><section className="panel overflow-hidden"><div className="flex items-center justify-between gap-4 border-b border-[hsl(var(--border))] p-5"><div><div className="eyebrow">Reusable copy</div><h2 className="display-font mt-1 text-xl font-bold">Templates</h2></div><Button onClick={() => open('new')}>New template</Button></div>
    {query.isLoading ? <SkeletonPage /> : query.isError ? <ErrorState retry={() => void query.refetch()} /> : !query.data?.length ? <EmptyState icon={FileText} title="No templates yet" description="Save common messages here to keep your school’s voice consistent." /> : <div className="divide-y divide-[hsl(var(--border))]">{query.data.map(item => <div key={item.id} className="flex items-center justify-between gap-3 p-5"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong>{item.name}</strong><StatusPill value={item.isActive ? 'Active' : 'Archived'} /></div><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{item.templateKey} · {label(item.category)} · {label(item.channel)}</div></div><Button variant="outline" onClick={() => open(item)}>Edit</Button></div>)}</div>}</section>
    <section className="panel h-fit p-5 md:p-6">{!editing ? <EmptyState icon={FileText} title="Select a template" description="Create a reusable message or select one to edit, archive, or restore." /> : <form onSubmit={event => void save(event)} className="space-y-4"><div className="eyebrow">{editing === 'new' ? 'New template' : 'Edit template'}</div>
      {editing === 'new' && <Field label="Unique key"><input className={inputClass} data-testid="input-template-key" required pattern="[a-zA-Z0-9_-]+" maxLength={80} value={form.templateKey} onChange={e => setForm({ ...form, templateKey: e.target.value })} /></Field>}
      <Field label="Name"><input className={inputClass} data-testid="input-template-name" required maxLength={120} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Category"><select className={inputClass} data-testid="select-template-category" value={form.category} onChange={e => setForm({ ...form, category: e.target.value as Category })}>{categories.map(item => <option key={item} value={item}>{label(item)}</option>)}</select></Field><Field label="Channel"><select className={inputClass} data-testid="select-template-channel" value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value as typeof form.channel })}>{Object.values(CommunicationChannel).map(item => <option key={item} value={item}>{label(item)}</option>)}</select></Field></div>
      <Field label="Subject"><input className={inputClass} data-testid="input-template-subject" maxLength={200} value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} /></Field><Field label="Body"><textarea className={`${inputClass} min-h-36`} data-testid="textarea-template-body" required maxLength={5000} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} /></Field>
      <fieldset><legend className="mb-2 text-xs font-bold">Allowed variables</legend><div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">{Object.values(CommunicationTemplateVariable).map(variable => <label key={variable} className="flex items-center gap-1 rounded-lg bg-[hsl(var(--secondary))] px-2 py-1 text-xs"><input type="checkbox" checked={form.allowedVariables.includes(variable)} onChange={() => setForm({ ...form, allowedVariables: form.allowedVariables.includes(variable) ? form.allowedVariables.filter(value => value !== variable) : [...form.allowedVariables, variable] })} />{variable}</label>)}</div></fieldset>
      <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} />Active</label>
      {error && <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{error}</p>}<div className="flex gap-2"><Button type="submit" disabled={create.isPending || update.isPending}>Save template</Button><Button variant="quiet" onClick={() => setEditing(null)}>Cancel</Button></div>
    </form>}</section></div>;
}

function DeliveryHistory({ schoolId }: { schoolId: number }) {
  const [beforeId, setBeforeId] = useState<number | undefined>();
  const [selected, setSelected] = useState<number | null>(null);
  const params = { schoolId, limit: 25, ...(beforeId ? { beforeId } : {}) };
  const query = useListCommunicationAnnouncements(params, { query: { queryKey: getListCommunicationAnnouncementsQueryKey(params) } });
  return <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(330px,.9fr)]"><section className="panel overflow-hidden"><div className="flex items-center justify-between border-b border-[hsl(var(--border))] p-5"><div><div className="eyebrow">Campaigns</div><h2 className="display-font mt-1 text-xl font-bold">Delivery history</h2><p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">Campaign statuses show processing progress, not proof of real-world delivery. Open a campaign to see test-adapter details.</p></div><Button variant="quiet" onClick={() => void query.refetch()}><RefreshCw size={15} />Refresh</Button></div>
    {query.isLoading ? <SkeletonPage /> : query.isError ? <ErrorState retry={() => void query.refetch()} /> : !query.data?.items.length ? <EmptyState icon={History} title="Nothing sent yet" description="Queued school messages and their delivery progress will be shown here." /> : <div className="divide-y divide-[hsl(var(--border))]">{query.data.items.map(item => <button type="button" onClick={() => setSelected(item.id)} key={item.id} data-testid={`button-campaign-${item.id}`} className={cx('flex w-full items-center gap-4 p-5 text-left hover:bg-[hsl(var(--secondary)/.35)]', selected === item.id && 'bg-[hsl(var(--secondary)/.6)]')}><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]"><Send size={17} /></span><span className="min-w-0 flex-1"><strong className="block truncate">{item.title}</strong><span className="mt-1 block text-xs text-[hsl(var(--muted-foreground))]">{date(item.createdAt)} · {item.recipientCount} recipients · {label(item.category)}</span></span><StatusPill value={campaignStatusLabel(item.status)} /><ChevronRight size={15} /></button>)}{query.data.hasMore && <div className="p-4 text-center"><Button variant="outline" onClick={() => setBeforeId(query.data?.nextBeforeId ?? undefined)}>Older campaigns</Button></div>}</div>}</section>
    <section className="panel h-fit overflow-hidden">{selected ? <CampaignDetail key={selected} id={selected} schoolId={schoolId} /> : <EmptyState icon={UsersRound} title="Choose a campaign" description="Select a message to inspect recipients, channel statuses and failed deliveries." />}</section>
  </div>;
}

function CampaignDetail({ id, schoolId }: { id: number; schoolId: number }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const query = useGetCommunicationAnnouncement(id, { query: { queryKey: getGetCommunicationAnnouncementQueryKey(id) } });
  const retry = useRetryCommunicationDelivery();
  const onRetry = async (deliveryId: number) => {
    if (!window.confirm('Retry this failed delivery?')) return;
    try { await retry.mutateAsync({ deliveryId }); setError(''); await Promise.all([qc.invalidateQueries({ queryKey: getGetCommunicationAnnouncementQueryKey(id) }), qc.invalidateQueries({ queryKey: getListCommunicationAnnouncementsQueryKey({ schoolId }) })]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Retry failed.'); }
  };
  if (query.isLoading) return <SkeletonPage />;
  if (query.isError || !query.data) return <ErrorState retry={() => void query.refetch()} />;
  const campaign = query.data;
  return <div><div className="border-b border-[hsl(var(--border))] p-5"><div className="eyebrow">Campaign #{id}</div><h2 className="display-font mt-2 text-xl font-bold">{campaign.title}</h2><div className="mt-3 flex flex-wrap gap-2"><StatusPill value={campaignStatusLabel(campaign.status)} /><span className="text-xs text-[hsl(var(--muted-foreground))]">{date(campaign.createdAt)} {time(campaign.createdAt)}</span></div><p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">Campaign status is processing progress, not confirmed device delivery.</p><p className="mt-3 whitespace-pre-wrap break-words text-sm text-[hsl(var(--muted-foreground))]">{campaign.body}</p></div>
    {error && <p role="alert" className="p-4 text-sm text-[hsl(var(--destructive))]">{error}</p>}
    <div className="max-h-[620px] divide-y divide-[hsl(var(--border))] overflow-y-auto">{campaign.recipients.length ? campaign.recipients.map(recipient => <div key={recipient.recipientUserId} className="p-5"><div className="flex items-center justify-between gap-3"><span className="text-xs font-bold">{label(recipient.recipientRole)} · User #{recipient.recipientUserId}</span><StatusPill value={recipient.status === 'SENT' && recipient.deliveries.some(isSimulatedDelivery) ? 'Simulated send' : recipient.status} /></div><div className="mt-3 space-y-2">{recipient.deliveries.map(delivery => <div key={delivery.id} className="rounded-xl bg-[hsl(var(--secondary)/.35)] p-3 text-xs"><div className="flex flex-wrap items-center gap-2"><strong>{label(delivery.channel)}</strong><StatusPill value={deliveryStatusLabel(delivery)} /><span className="text-[hsl(var(--muted-foreground))]">{isSimulatedDelivery(delivery) ? 'Development test adapter — no real delivery' : delivery.provider ?? 'Not assigned'}</span></div>{delivery.lastError && <p className="mt-2 text-[hsl(var(--destructive))]">{delivery.lastError}</p>}{delivery.status === 'FAILED' && <button type="button" disabled={retry.isPending} onClick={() => void onRetry(delivery.id)} className="mt-2 inline-flex items-center gap-1 font-bold text-[hsl(var(--primary))]" data-testid={`button-retry-delivery-${delivery.id}`}><RotateCcw size={12} />Retry failed delivery</button>}</div>)}</div></div>) : <EmptyState icon={UsersRound} title="No recipients" description="This campaign has no resolved recipients." />}</div>
  </div>;
}