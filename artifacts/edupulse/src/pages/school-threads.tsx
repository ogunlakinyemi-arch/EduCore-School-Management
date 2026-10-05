import { useEffect, useState } from 'react';
import { useListSchoolParentMessageThreads, getListSchoolParentMessageThreadsQueryKey,
  useListCommunicationStudents, useListCommunicationGuardians, useCreateSchoolParentMessageThread } from '@workspace/api-client-react';
import { MessageSquare } from 'lucide-react';
import { EmptyState, ErrorState, SkeletonPage, StatusPill, date } from '@/components/shared';
import { inputClass, Notice } from './security/ui';
import { Thread } from './parent-communication/threads';
import { Button } from '@/components/shared';
import { errMsg } from '@/components/school-ops-kit';

export function SchoolThreads({ schoolId, teacher }: { schoolId: number; teacher: boolean }) {
  const [search, setSearch] = useState(''); const [childId, setChildId] = useState(0); const [open, setOpen] = useState<number | null>(null);
  const [parentId,setParentId]=useState(0),[subject,setSubject]=useState(''),[body,setBody]=useState(''),[error,setError]=useState('');
  const [requestKey,setRequestKey]=useState(()=>crypto.randomUUID());
  const sp = { schoolId, ...(search.trim() ? { search: search.trim() } : {}) };
  const students = useListCommunicationStudents(sp, { query: { enabled: !!schoolId, staleTime: 15000 } });
  const guardians=useListCommunicationGuardians(childId,{schoolId},{query:{enabled:!!childId&&!!schoolId,staleTime:15000}});
  const create=useCreateSchoolParentMessageThread();
  useEffect(()=>{setParentId(0);setError('');setRequestKey(crypto.randomUUID());},[childId]);
  useEffect(()=>{if(childId&&guardians.data?.length===1)setParentId(guardians.data[0].userId);},[childId,guardians.data]);
  const send=async()=>{
    setError('');
    try{const sent=await create.mutateAsync({data:{schoolId,studentId:childId,parentUserId:parentId,
      subject:subject.trim(),body:body.trim(),category:'GENERAL',idempotencyKey:requestKey}});
      setSubject('');setBody('');setRequestKey(crypto.randomUUID());void q.refetch();setOpen(sent.thread.id);
    }catch(e){setError(errMsg(e));}
  };
  const params = { schoolId, ...(childId ? { childId } : {}) };
  const needsChild = teacher && !childId;
  const q = useListSchoolParentMessageThreads(params, { query: { enabled: !!schoolId && !needsChild, queryKey: getListSchoolParentMessageThreadsQueryKey(params), staleTime: 15000 } });
  if (open) return <Thread id={open} onBack={() => setOpen(null)} onChanged={() => void q.refetch()} />;
  return <div className="space-y-4" data-testid="school-threads">
    <div className="panel grid gap-3 p-4 sm:grid-cols-2">
      <label className="text-xs font-bold">Find student<input className={inputClass} value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or admission number" data-testid="input-thread-student-search" /></label>
      <label className="text-xs font-bold">Student<select className={inputClass} value={childId} onChange={e => setChildId(Number(e.target.value))} data-testid="select-thread-student"><option value={0}>{students.isLoading?'Loading authorized students…':teacher ? 'Select a student' : 'All students'}</option>{(students.data ?? []).map(s => <option key={s.id} value={s.id}>{s.firstName} {s.lastName} · {s.admissionNo} · {s.className} / {s.section}</option>)}</select></label>
    </div>
    {students.isError&&<ErrorState retry={()=>void students.refetch()}/>}
    {!students.isLoading&&!students.isError&&!students.data?.length&&<Notice>No active current students match your authorized class/section assignments.</Notice>}
    {!!childId&&<div className="panel space-y-4 p-4" data-testid="form-message-parent">
      <h2 className="font-bold">Message parent</h2>
      {guardians.isLoading?<p>Loading linked parents / guardians…</p>:guardians.isError?<ErrorState retry={()=>void guardians.refetch()}/>:!guardians.data?.length?
        <Notice><span data-testid="text-no-linked-parent">No linked parent/guardian is available for this student.</span></Notice>:
        <><label className="block text-xs font-bold">Linked parent / guardian<select className={inputClass} value={parentId} onChange={e=>{setParentId(Number(e.target.value));setRequestKey(crypto.randomUUID());}} data-testid="select-message-guardian"><option value={0}>Select linked recipient</option>{guardians.data.map(p=><option key={p.userId} value={p.userId}>{p.firstName} {p.lastName}</option>)}</select></label>
          <label className="block text-xs font-bold">Subject<input className={inputClass} maxLength={200} value={subject} onChange={e=>{setSubject(e.target.value);setRequestKey(crypto.randomUUID());}} data-testid="input-parent-message-subject"/></label>
          <label className="block text-xs font-bold">Message<textarea className={inputClass} maxLength={5000} value={body} onChange={e=>{setBody(e.target.value);setRequestKey(crypto.randomUUID());}} data-testid="input-parent-message-body"/></label>
          <Button onClick={()=>void send()} disabled={create.isPending||!parentId||!subject.trim()||!body.trim()} testId="button-send-parent-message">{create.isPending?'Sending…':'Send message'}</Button>
        </>}
      {error&&<div role="alert"><Notice>{error}</Notice></div>}
    </div>}
    {teacher && <Notice>Teachers see conversations for students in their assigned classes only. Parents write to the school office and assigned teachers automatically.</Notice>}
    <div className="panel overflow-hidden">{needsChild ? <EmptyState icon={MessageSquare} title="Choose a student" description="Search for a student in your class to see their family conversations." /> : q.isLoading ? <SkeletonPage /> : q.isError ? <ErrorState retry={() => void q.refetch()} /> : !q.data?.items.length ? <EmptyState icon={MessageSquare} title="No conversations" description="Parents' messages will appear here." /> : <div className="divide-y divide-[hsl(var(--border)/.7)]">{q.data.items.map(t => <button key={t.id} onClick={() => setOpen(t.id)} className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-[hsl(var(--secondary)/.4)]" data-testid={`row-school-thread-${t.id}`}><div className="min-w-0"><div className="truncate font-bold">{t.subject}</div><div className="text-xs text-[hsl(var(--muted-foreground))]">{t.childName} - {date(t.lastMessageAt)}</div></div>{t.archived ? <StatusPill value="archived" /> : t.unreadCount > 0 && <span className="rounded-full bg-[hsl(var(--primary))] px-2 py-0.5 text-xs font-bold text-[hsl(var(--primary-foreground))]">{t.unreadCount}</span>}</button>)}</div>}</div>
  </div>;
}
