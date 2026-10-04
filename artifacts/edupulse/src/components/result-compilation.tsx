import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useListAcademicSessions, useListAcademicTerms, useListClasses, getListAcademicTermsQueryKey } from '@workspace/api-client-react';
import { Button, EmptyState, ErrorState, Field, SkeletonPage, StatusPill } from '@/components/shared';
import { Notice } from '@/components/school-ops-kit';
import { BarChart3 } from 'lucide-react';

export type CompilationSubject = { subjectId: number; subjectName: string; teacherName: string | null; score: number | null; maxScore: number | null; grade: string | null; status: string; missing: boolean; resultIds: number[] };
export type CompilationStudent = { studentId: number; studentName: string; admissionNo: string | null; classId: number; className: string; section: string | null; studentClassAssignmentId: number | null; subjects: CompilationSubject[]; missingSubjects: string[]; complete: boolean; total: number | null; average: number | null };

export type PeriodFilter = { schoolId: number; sessionId?: number; termId?: number; classId?: number; section?: string };

async function getJson(url: string, fallback: string) {
  const r = await fetch(url, { credentials: 'include' });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(body?.error || `${fallback} (${r.status})`);
  return body;
}
const qs = (f: PeriodFilter) => {
  const p = new URLSearchParams({ schoolId: String(f.schoolId) });
  if (f.sessionId) p.set('sessionId', String(f.sessionId));
  if (f.termId) p.set('termId', String(f.termId));
  if (f.classId) p.set('classId', String(f.classId));
  if (f.section) p.set('section', f.section);
  return p.toString();
};

export function usePeriodStudents(f: PeriodFilter, enabled = true) {
  return useQuery({
    queryKey: ['academic-period-students', f.schoolId, f.sessionId, f.termId, f.classId, f.section ?? ''],
    enabled: enabled && !!f.schoolId && !!f.sessionId && !!f.termId && !!f.classId,
    queryFn: () => getJson(`/api/academic/period-students?${qs(f)}`, 'Could not load students for this period') as Promise<Array<{ id: number; firstName: string; lastName: string; admissionNo: string; classId: number; section: string | null; studentClassAssignmentId: number | null }>>,
  });
}

export function useResultCompilation(f: PeriodFilter, enabled = true) {
  return useQuery({
    queryKey: ['academic-result-compilation', f.schoolId, f.sessionId, f.termId, f.classId, f.section ?? ''],
    enabled: enabled && !!f.schoolId && !!f.sessionId && !!f.termId,
    queryFn: () => getJson(`/api/academic/result-compilation?${qs(f)}`, 'Could not load result compilation') as Promise<{ students: CompilationStudent[]; sessionId: number; termId: number; classId: number }>,
  });
}

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b?.error || `Request failed (${r.status})`);
}

export function SubjectRow({ subject, schoolId, canManage, onChanged }: { subject: CompilationSubject; schoolId: number; canManage: boolean; onChanged: () => void }) {
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<void>) => {
    setError(''); setPending(true);
    try { await fn(); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); } finally { setPending(false); }
  };
  const review = (decision: 'APPROVE' | 'RETURN') => {
    if (decision === 'RETURN' && !comment.trim()) return setError('Add a comment explaining the correction required.');
    run(async () => { for (const id of subject.resultIds) await post(`/api/academic/results/${id}/review`, { schoolId, decision, comment: comment.trim() || null }); setComment(''); });
  };
  if (subject.missing) return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" data-testid={`subject-missing-${subject.subjectId}`}>
      <div><div className="text-sm font-semibold">{subject.subjectName}</div><div className="text-xs text-[hsl(var(--muted-foreground))]">{subject.teacherName ?? 'Teacher not assigned'}</div></div>
      <span className="rounded bg-[hsl(var(--muted))] px-2 py-1 text-xs font-bold">Awaiting Teacher Submission</span>
    </div>
  );
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid={`subject-row-${subject.subjectId}`}>
      <div className="min-w-40 flex-1"><div className="text-sm font-semibold">{subject.subjectName}</div><div className="text-xs text-[hsl(var(--muted-foreground))]">{subject.teacherName ?? 'Teacher not recorded'}</div></div>
      <div className="w-24 text-sm font-semibold">{subject.score ?? '—'}{subject.maxScore != null ? `/${subject.maxScore}` : ''}</div>
      <div className="w-12 text-sm font-bold">{subject.grade ?? '—'}</div>
      <StatusPill value={subject.status} />
      {canManage && subject.status === 'SUBMITTED' && <>
        <input className="min-w-40 flex-1" aria-label={`Review comment for ${subject.subjectName}`} placeholder="Comment (required to return)" value={comment} onChange={e => setComment(e.target.value)} disabled={pending} />
        <Button variant="outline" onClick={() => review('RETURN')} disabled={pending} aria-label={`Return ${subject.subjectName}`}>Return</Button>
        <Button onClick={() => review('APPROVE')} disabled={pending} aria-label={`Approve ${subject.subjectName}`}>Approve</Button>
      </>}
      {error && <p role="alert" className="basis-full text-xs text-[hsl(var(--destructive))]">{error}</p>}
    </div>
  );
}

export function ResultCompilation({ schoolId, canManage }: { schoolId: number; canManage: boolean }) {
  const qc = useQueryClient();
  const sessions = useListAcademicSessions({ schoolId }, { query: { enabled: !!schoolId, queryKey: ['compilation-sessions', schoolId] } });
  const [sessionPick, setSessionPick] = useState(0);
  const sessionId = sessionPick || sessions.data?.find((s: any) => s.isCurrent)?.id || sessions.data?.[0]?.id || 0;
  const terms = useListAcademicTerms(sessionId, { schoolId }, { query: { enabled: !!sessionId, queryKey: getListAcademicTermsQueryKey(sessionId, { schoolId }) } });
  const [termPick, setTermPick] = useState(0);
  const termId = (terms.data ?? []).some((t: any) => t.id === termPick) ? termPick : ((terms.data ?? []).find((t: any) => t.isCurrent) ?? terms.data?.[0])?.id || 0;
  const classes = useListClasses({ schoolId }, { query: { enabled: !!schoolId, queryKey: ['compilation-classes', schoolId] } });
  const [classId, setClassId] = useState(0);
  const [section, setSection] = useState('');
  const filter = { schoolId, sessionId, termId, classId: classId || undefined, section: section || undefined };
  const q = useResultCompilation(filter);
  const students = q.data?.students ?? [];
  const changed = () => qc.invalidateQueries({ queryKey: ['academic-result-compilation'] });

  return (
    <div className="space-y-6" data-testid="result-compilation">
      <div className="panel flex flex-wrap items-end gap-4 p-5">
        <Field label="Session"><select aria-label="Compilation session" value={sessionId || ''} onChange={e => { setSessionPick(Number(e.target.value)); setTermPick(0); }}>
          {(sessions.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Term"><select aria-label="Compilation term" value={termId || ''} onChange={e => setTermPick(Number(e.target.value))}>
          {(terms.data ?? []).map((t: any) => <option key={t.id} value={t.id}>{String(t.name).toLowerCase()}</option>)}</select></Field>
        <Field label="Class"><select aria-label="Compilation class" value={classId} onChange={e => setClassId(Number(e.target.value))}>
          <option value={0}>All classes</option>{(classes.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Section (optional)"><input aria-label="Compilation section" value={section} onChange={e => setSection(e.target.value)} /></Field>
      </div>
      {q.isLoading ? <SkeletonPage /> : q.isError ? <ErrorState retry={() => q.refetch()} message={(q.error as Error).message} />
        : !students.length ? <div className="panel"><EmptyState icon={BarChart3} title="No students to compile" description="No students were enrolled for this period and class." /></div>
        : students.map(st => (
          <section key={`${st.studentId}-${st.studentClassAssignmentId ?? st.classId}`} className="panel overflow-hidden" data-testid={`compilation-student-${st.studentId}`}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] p-4">
              <div><h3 className="font-bold">{st.studentName}</h3><p className="text-xs text-[hsl(var(--muted-foreground))]">{st.admissionNo} · {st.className}{st.section ? ` ${st.section}` : ''}</p></div>
              <div className="text-right text-xs">
                <div className="font-bold">{st.complete ? 'Complete' : `Incomplete: ${st.missingSubjects.length} awaiting`}</div>
                <div>Total {st.total ?? '—'} · Average {st.average ?? '—'}</div>
              </div>
            </div>
            <div className="divide-y divide-[hsl(var(--border)/.6)]">
              {st.subjects.map(s => <SubjectRow key={s.subjectId} subject={s} schoolId={schoolId} canManage={canManage} onChanged={changed} />)}
            </div>
          </section>
        ))}
      {q.isFetching && !q.isLoading && <Notice>Refreshing…</Notice>}
    </div>
  );
}
