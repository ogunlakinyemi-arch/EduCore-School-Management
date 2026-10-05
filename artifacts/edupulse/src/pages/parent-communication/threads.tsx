import { useState } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useListParentMessageThreads, getListParentMessageThreadsQueryKey, useGetParentCommunicationThread, getGetParentCommunicationThreadQueryKey, useReplyToParentCommunicationThread, useCreateParentMessageThread, useMarkParentCommunicationThreadRead, useArchiveParentCommunicationThread } from '@workspace/api-client-react';
import type { ParentCreateCommunicationThreadCategory } from '@workspace/api-client-react';
import { MessageSquare } from 'lucide-react';
import { Button, EmptyState, ErrorState, Field, Modal, SkeletonPage, StatusPill, date, time, cx } from '@/components/shared';
import { inputClass, Notice } from '../security/ui';
import { newKey, safeMessage } from '../security/security-contract';

export function Thread({ id, onBack, onChanged }: { id: number; onBack: () => void; onChanged?: () => void }) {
  const qc = useQueryClient();
  const q = useGetParentCommunicationThread(id, undefined, { query: { queryKey: getGetParentCommunicationThreadQueryKey(id), staleTime: 10000 } });
  const reply = useReplyToParentCommunicationThread(); const markRead = useMarkParentCommunicationThreadRead(); const archive = useArchiveParentCommunicationThread();
  const [body, setBody] = useState(''); const [key, setKey] = useState(newKey); const [msg, setMsg] = useState('');
  const inv = async () => { await qc.invalidateQueries({ queryKey: getGetParentCommunicationThreadQueryKey(id) }); await qc.invalidateQueries({ queryKey: getListParentMessageThreadsQueryKey() }); onChanged?.(); };
  const send = async () => { if (!body.trim()) return; try { await reply.mutateAsync({ threadId: id, data: { body: body.trim(), idempotencyKey: key } }); setBody(''); setKey(newKey()); setMsg(''); await inv(); } catch (e) { setMsg(safeMessage(e, 'Not sent. Your message is kept; press Send to retry.')); } };
  const t = q.data;
  return <div className="panel p-4 md:p-5">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><Button variant="quiet" onClick={onBack}>Back to threads</Button>{t && <div className="flex gap-2">{t.unreadCount > 0 && <Button variant="outline" onClick={() => void markRead.mutateAsync({ threadId: id }).then(inv)}>Mark read</Button>}{!t.archived && <Button variant="outline" onClick={() => void archive.mutateAsync({ threadId: id }).then(() => { onBack(); return inv(); })} testId="button-archive-thread">Archive</Button>}</div>}</div>
    {q.isLoading ? <SkeletonPage /> : q.isError || !t ? <ErrorState retry={() => void q.refetch()} /> : <>
      <h3 className="display-font text-lg font-bold">{t.subject}</h3><p className="text-xs text-[hsl(var(--muted-foreground))]">{t.childName} · {t.schoolName}</p>
      <ol className="my-4 space-y-3" data-testid="list-thread-messages">{[...t.messages].reverse().map(m => <li key={m.id} className={cx('max-w-[85%] rounded-2xl p-3 text-sm', m.senderRole === 'PARENT' ? 'ml-auto bg-[hsl(var(--primary)/.1)]' : 'bg-[hsl(var(--secondary))]')}><div className="whitespace-pre-wrap break-words">{m.body}</div><div className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">{m.senderRole.toLowerCase()} · {date(m.createdAt)} {time(m.createdAt)}</div></li>)}</ol>
      {!t.archived ? <form onSubmit={e => { e.preventDefault(); void send(); }} className="space-y-2"><textarea className={`${inputClass} min-h-20`} value={body} onChange={e => setBody(e.target.value)} placeholder="Write a reply" maxLength={5000} data-testid="input-thread-reply" />{msg && <Notice tone="error">{msg}</Notice>}<Button type="submit" disabled={reply.isPending || !body.trim()} testId="button-send-reply">Send reply</Button></form> : <Notice>This thread is archived.</Notice>}</>}</div>;
}

export function ThreadLinkPage({ threadId,parent=false }: {threadId:string;parent?:boolean}) {
  const [,navigate]=useLocation();
  const id=Number(threadId);
  if(!/^[1-9]\d*$/.test(threadId)||!Number.isSafeInteger(id))return <ErrorState />;
  return <main className="mx-auto max-w-6xl p-5 md:p-8" data-testid="communication-thread-link">
    <Thread id={id} onBack={()=>navigate(parent?'/parent/communication':'/communications')} />
  </main>;
}

function NewThread({ children, onClose }: { children: { studentId: number; label: string }[]; onClose: () => void }) {
  const qc = useQueryClient(); const create = useCreateParentMessageThread();
  const [studentId, setStudentId] = useState(children[0]?.studentId ?? 0); const [subject, setSubject] = useState(''); const [category, setCategory] = useState<ParentCreateCommunicationThreadCategory>('GENERAL'); const [body, setBody] = useState(''); const [key] = useState(newKey); const [msg, setMsg] = useState('');
  return <Modal title="New message to school" eyebrow="Messages" onClose={onClose}><form className="space-y-3" onSubmit={e => { e.preventDefault(); if (!studentId || !subject.trim() || !body.trim()) return; void (async () => { try { await create.mutateAsync({ data: { studentId, subject: subject.trim(), category, body: body.trim(), idempotencyKey: key } }); await qc.invalidateQueries({ queryKey: getListParentMessageThreadsQueryKey() }); onClose(); } catch (er) { setMsg(safeMessage(er)); } })(); }}>
    <Field label="About which child"><select className={inputClass} value={studentId} onChange={e => setStudentId(Number(e.target.value))}>{children.map(c => <option key={c.studentId} value={c.studentId}>{c.label}</option>)}</select></Field>
    <Field label="Topic"><select className={inputClass} value={category} onChange={e => setCategory(e.target.value as ParentCreateCommunicationThreadCategory)}>{['GENERAL', 'ACADEMIC', 'ASSIGNMENT', 'FINANCE'].map(c => <option key={c}>{c}</option>)}</select></Field>
    <Field label="Subject"><input className={inputClass} required maxLength={200} value={subject} onChange={e => setSubject(e.target.value)} data-testid="input-thread-subject" /></Field>
    <Field label="Message"><textarea className={`${inputClass} min-h-28`} required value={body} onChange={e => setBody(e.target.value)} data-testid="input-thread-body" /></Field>
    {msg && <Notice tone="error">{msg}</Notice>}<Button type="submit" disabled={create.isPending} testId="button-create-thread">Send message</Button></form></Modal>;
}

export function Threads({ schoolId, childId, children }: { schoolId: number; childId: number; children: { studentId: number; label: string }[] }) {
  const [open, setOpen] = useState<number | null>(null); const [search, setSearch] = useState(''); const [archived, setArchived] = useState(false); const [composing, setComposing] = useState(false);
  const params = { schoolId, childId, limit: 30, includeArchived: archived, ...(search.trim() ? { search: search.trim() } : {}) };
  const q = useListParentMessageThreads(params, { query: { queryKey: getListParentMessageThreadsQueryKey(params), staleTime: 20000 } });
  if (open !== null) return <Thread id={open} onBack={() => setOpen(null)} />;
  return <div className="space-y-4"><div className="flex flex-wrap items-end gap-3"><label className="text-xs font-bold">Search<input className={inputClass} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search threads" /></label><label className="flex items-center gap-2 pb-2.5 text-xs font-bold"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} />Include archived</label><Button onClick={() => setComposing(true)} testId="button-new-message">New message</Button></div>
    <div className="panel overflow-hidden">{q.isLoading ? <SkeletonPage /> : q.isError ? <ErrorState retry={() => void q.refetch()} /> : !q.data?.items.length ? <EmptyState icon={MessageSquare} title="No conversations" description="Start a message to your child's school." /> : <div className="divide-y divide-[hsl(var(--border)/.7)]">{q.data.items.map(t => <button key={t.id} onClick={() => setOpen(t.id)} className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-[hsl(var(--secondary)/.4)]" data-testid={`row-thread-${t.id}`}><div className="min-w-0"><div className="truncate font-bold">{t.subject}</div><div className="text-xs text-[hsl(var(--muted-foreground))]">{t.childName} · {date(t.lastMessageAt)}</div></div>{t.archived ? <StatusPill value="archived" /> : t.unreadCount > 0 && <span className="rounded-full bg-[hsl(var(--primary))] px-2 py-0.5 text-xs font-bold text-[hsl(var(--primary-foreground))]">{t.unreadCount}</span>}</button>)}</div>}</div>
    {composing && <NewThread children={children} onClose={() => setComposing(false)} />}</div>;
}
