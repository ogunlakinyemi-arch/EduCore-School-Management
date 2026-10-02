import { useState } from 'react';
import { useListSchoolParentMessageThreads, getListSchoolParentMessageThreadsQueryKey, useListStudents, getListStudentsQueryKey } from '@workspace/api-client-react';
import { MessageSquare } from 'lucide-react';
import { EmptyState, ErrorState, SkeletonPage, StatusPill, date } from '@/components/shared';
import { inputClass, Notice } from './security/ui';
import { Thread } from './parent-communication/threads';

export function SchoolThreads({ schoolId, teacher }: { schoolId: number; teacher: boolean }) {
  const [search, setSearch] = useState(''); const [childId, setChildId] = useState(0); const [open, setOpen] = useState<number | null>(null);
  const sp = { schoolId, ...(search.trim() ? { search: search.trim() } : {}) };
  const students = useListStudents(sp, { query: { enabled: !!schoolId && search.trim().length > 1, queryKey: getListStudentsQueryKey(sp), staleTime: 30000 } });
  const params = { schoolId, ...(childId ? { childId } : {}) };
  const needsChild = teacher && !childId;
  const q = useListSchoolParentMessageThreads(params, { query: { enabled: !!schoolId && !needsChild, queryKey: getListSchoolParentMessageThreadsQueryKey(params), staleTime: 15000 } });
  if (open) return <Thread id={open} onBack={() => setOpen(null)} onChanged={() => void q.refetch()} />;
  return <div className="space-y-4" data-testid="school-threads">
    <div className="panel grid gap-3 p-4 sm:grid-cols-2">
      <label className="text-xs font-bold">Find student<input className={inputClass} value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or admission number" data-testid="input-thread-student-search" /></label>
      <label className="text-xs font-bold">Student<select className={inputClass} value={childId} onChange={e => setChildId(Number(e.target.value))} data-testid="select-thread-student"><option value={0}>{teacher ? 'Select a student' : 'All students'}</option>{(students.data ?? []).map(s => <option key={s.id} value={s.id}>{s.admissionNo}</option>)}</select></label>
    </div>
    {teacher && <Notice>Teachers see conversations for students in their assigned classes only. Parents write to the school office and assigned teachers automatically.</Notice>}
    <div className="panel overflow-hidden">{needsChild ? <EmptyState icon={MessageSquare} title="Choose a student" description="Search for a student in your class to see their family conversations." /> : q.isLoading ? <SkeletonPage /> : q.isError ? <ErrorState retry={() => void q.refetch()} /> : !q.data?.items.length ? <EmptyState icon={MessageSquare} title="No conversations" description="Parents' messages will appear here." /> : <div className="divide-y divide-[hsl(var(--border)/.7)]">{q.data.items.map(t => <button key={t.id} onClick={() => setOpen(t.id)} className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-[hsl(var(--secondary)/.4)]" data-testid={`row-school-thread-${t.id}`}><div className="min-w-0"><div className="truncate font-bold">{t.subject}</div><div className="text-xs text-[hsl(var(--muted-foreground))]">{t.childName} - {date(t.lastMessageAt)}</div></div>{t.archived ? <StatusPill value="archived" /> : t.unreadCount > 0 && <span className="rounded-full bg-[hsl(var(--primary))] px-2 py-0.5 text-xs font-bold text-[hsl(var(--primary-foreground))]">{t.unreadCount}</span>}</button>)}</div>}</div>
  </div>;
}
