import { useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Repeat, UserRoundCheck, Ban } from 'lucide-react';
import {
  useListSchoolTeacherAssignments, getListSchoolTeacherAssignmentsQueryKey, useCreateSchoolTeacherAssignment,
  useUpdateSchoolTeacherAssignment, useListEmployees, useListClasses, useListSubjects, useListAcademicSessions,
  type SchoolTeacherAssignment,
} from '@workspace/api-client-react';
import { PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, Modal, Field, TenantPicker } from '@/components/shared';
import { FRESH, Notice, SearchSelect, errMsg, fmtDay, isValidRange, todayIso, useSchoolRole } from '@/components/school-ops-kit';

type Kind = 'CLASS_TEACHER' | 'SUBJECT_TEACHER';
type Filter = 'ACTIVE' | 'INACTIVE' | 'all';

export function TeacherAssignmentsPage() {
  const role = useSchoolRole();
  const { schoolId, canManage, canRead } = role;
  const qc = useQueryClient();
  const [status, setStatus] = useState<Filter>('ACTIVE');
  const [modal, setModal] = useState<null | { replace?: SchoolTeacherAssignment }>(null);
  const [done, setDone] = useState('');

  const sessionsQ = useListAcademicSessions({ schoolId }, { query: { enabled: canManage, queryKey: ['sessions-assign', schoolId], ...FRESH } });
  const params = { status };
  const q = useListSchoolTeacherAssignments(schoolId, params, { query: { enabled: canRead, queryKey: getListSchoolTeacherAssignmentsQueryKey(schoolId, params), ...FRESH } });
  const rows = q.data ?? [];
  const update = useUpdateSchoolTeacherAssignment();

  const refresh = () => qc.invalidateQueries({ queryKey: getListSchoolTeacherAssignmentsQueryKey(schoolId) });
  const deactivate = (a: SchoolTeacherAssignment) => {
    setDone('');
    update.mutate({ schoolId, assignmentKind: a.assignmentKind, assignmentId: a.id, data: { status: 'INACTIVE', endDate: todayIso() } },
      { onSuccess: () => { setDone(`${a.employeeName} was released from ${a.subjectName ?? a.className ?? 'this assignment'}.`); refresh(); } });
  };

  return (
    <div className="fade-up">
      <PageHeading eyebrow="Academics / Staffing" title="Teacher assignments." description={canManage ? 'Who teaches which class and subject, this session.' : 'Your own class and subject assignments.'}
        action={<div className="flex items-center gap-3"><TenantPicker />{canManage && <Button onClick={() => setModal({})} testId="button-add-assignment"><Plus size={16} />Assign teacher</Button>}</div>} />
      {done && <div className="mb-5"><Notice tone="success">{done}</Notice></div>}
      {update.isError && <div className="mb-5"><Notice tone="error">{errMsg(update.error)}</Notice></div>}
      {role.loading ? <SkeletonPage /> : !canRead ? (
        <EmptyState icon={UserRoundCheck} title="Select a school" description="Pick a school you are authorised for to see its assignments." />
      ) : (
        <>
          <div className="mb-5 flex gap-2">
            {(['ACTIVE', 'INACTIVE', 'all'] as Filter[]).map(s => (
              <button key={s} onClick={() => setStatus(s)} aria-pressed={status === s}
                className={`rounded-xl px-4 py-2 text-xs font-bold capitalize ${status === s ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'bg-[hsl(var(--secondary))]'}`}>{s.toLowerCase()}</button>
            ))}
          </div>
          {q.isLoading ? <SkeletonPage /> : q.isError ? <ErrorState retry={() => q.refetch()} message={errMsg(q.error, 'Assignments could not be loaded.')} /> : (
            <div className="panel overflow-hidden">
              {rows.length === 0 ? <EmptyState icon={UserRoundCheck} title="No assignments" description={canManage ? 'Assign a teacher to a class or subject to begin.' : 'You have no assignments in this view.'} /> : rows.map(a => (
                <div key={`${a.assignmentKind}-${a.id}`} className="grid gap-3 border-b border-[hsl(var(--border)/.6)] px-5 py-4 last:border-0 md:grid-cols-[1.3fr_1.5fr_1fr_auto_auto] md:items-center">
                  <div><div className="text-sm font-bold">{a.employeeName}</div><div className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">{a.employeeNo}</div></div>
                  <div className="text-sm">
                    <span className="font-bold">{a.assignmentType === 'CLASS_TEACHER' ? 'Class teacher' : 'Subject teacher'}</span>
                    <span className="text-[hsl(var(--muted-foreground))]"> · {[a.className && `${a.className}${a.section ? ` ${a.section}` : ''}`, a.subjectName].filter(Boolean).join(' / ') || '—'} · {a.sessionName}</span>
                  </div>
                  <div className="text-xs text-[hsl(var(--muted-foreground))]">{fmtDay(a.startDate)} to {a.endDate ? fmtDay(a.endDate) : 'open'}</div>
                  <StatusPill value={a.status} />
                  {canManage && a.status === 'ACTIVE' ? (
                    <div className="flex gap-1">
                      <Button variant="quiet" onClick={() => setModal({ replace: a })} testId={`button-replace-${a.id}`}><Repeat size={14} />Replace</Button>
                      <Button variant="danger" disabled={update.isPending} onClick={() => deactivate(a)} testId={`button-deactivate-${a.id}`}><Ban size={14} />End</Button>
                    </div>
                  ) : <span />}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {canManage && modal && (
        <Modal title={modal.replace ? 'Replace teacher' : 'Assign teacher'} eyebrow="Staffing" onClose={() => setModal(null)}>
          <AssignForm schoolId={schoolId} replace={modal.replace} sessions={sessionsQ.data ?? []} onCancel={() => setModal(null)}
            onDone={msg => { setModal(null); setDone(msg); refresh(); }} />
        </Modal>
      )}
    </div>
  );
}

type UpdateBody = Parameters<ReturnType<typeof useUpdateSchoolTeacherAssignment>['mutateAsync']>[0]['data'];
/** Single adapter for the atomic-replacement contract. Adjust field names here once codegen lands. */
export function buildReplaceBody(replacementEmployeeId: number, effectiveDate: string): UpdateBody {
  return { replacementEmployeeId, replacementStartDate: effectiveDate, endDate: effectiveDate } as unknown as UpdateBody;
}

function AssignForm({ schoolId, replace, sessions, onDone, onCancel }: {
  schoolId: number; replace?: SchoolTeacherAssignment; sessions: Array<{ id: number; name: string; isCurrent?: boolean }>;
  onDone: (m: string) => void; onCancel: () => void;
}) {
  const teachersQ = useListEmployees({ schoolId, role: 'TEACHER', status: 'ACTIVE' }, { query: { queryKey: ['assign-teachers', schoolId], ...FRESH } });
  const classesQ = useListClasses({ schoolId }, { query: { queryKey: ['assign-classes', schoolId], ...FRESH } });
  const subjectsQ = useListSubjects({ schoolId, status: 'ACTIVE' }, { query: { queryKey: ['assign-subjects', schoolId], ...FRESH } });
  const create = useCreateSchoolTeacherAssignment();
  const update = useUpdateSchoolTeacherAssignment();
  const current = sessions.find(s => s.isCurrent)?.id ?? sessions[0]?.id ?? null;
  const [sessionId, setSessionId] = useState<number | null>(replace?.sessionId ?? current);
  const [type, setType] = useState<Kind>(replace?.assignmentType ?? 'CLASS_TEACHER');
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [classId, setClassId] = useState<number | null>(replace?.classId ?? null);
  const [subjectId, setSubjectId] = useState<number | null>(replace?.subjectId ?? null);
  const [startDate, setStartDate] = useState(todayIso());
  const [err, setErr] = useState('');

  const teachers = useMemo(() => (teachersQ.data ?? []).map(t => ({ value: t.id, label: `${t.firstName} ${t.lastName}`, hint: t.employeeId })), [teachersQ.data]);
  const classes = useMemo(() => (classesQ.data ?? []).map(c => ({ value: c.id, label: `${c.name} ${c.section}`.trim() })), [classesQ.data]);
  const subjects = useMemo(() => (subjectsQ.data ?? []).map(s => ({ value: s.id, label: s.name, hint: s.code })), [subjectsQ.data]);
  const loadingLists = teachersQ.isLoading || classesQ.isLoading || subjectsQ.isLoading;
  const listError = teachersQ.isError || classesQ.isError || subjectsQ.isError;
  const pending = create.isPending || update.isPending;

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    if (!sessionId || !employeeId) return setErr('Choose a session and a teacher.');
    if (type === 'CLASS_TEACHER' && !classId) return setErr('A class teacher needs a class.');
    if (type === 'SUBJECT_TEACHER' && !subjectId) return setErr('A subject teacher needs a subject.');
    if (!isValidRange(startDate)) return setErr('Enter a valid start date.');
    try {
      if (replace) {
        // Atomic: one request ends the old assignment and creates the replacement server-side.
        await update.mutateAsync({ schoolId, assignmentKind: replace.assignmentKind, assignmentId: replace.id, data: buildReplaceBody(employeeId, startDate) });
      } else {
        await create.mutateAsync({ schoolId, data: {
          employeeId, sessionId, assignmentType: type, startDate,
          classId: classId ?? null, subjectId: type === 'SUBJECT_TEACHER' ? subjectId : null,
        } });
      }
      onDone(replace ? 'Teacher replaced.' : 'Teacher assigned.');
    } catch (outer) { setErr(errMsg(outer)); }
  };

  if (loadingLists) return <SkeletonPage />;
  if (listError) return <ErrorState retry={() => { teachersQ.refetch(); classesQ.refetch(); subjectsQ.refetch(); }} />;
  return (
    <form onSubmit={submit} className="space-y-5">
      {replace && <Notice>Replacing {replace.employeeName}: the swap happens in one step, so the post is never left uncovered if it fails.</Notice>}
      <Field label="Session">
        <select value={sessionId ?? ''} onChange={e => setSessionId(Number(e.target.value))} disabled={!!replace}>
          {sessions.map(s => <option key={s.id} value={s.id}>{s.name}{s.isCurrent ? ' (current)' : ''}</option>)}
        </select>
      </Field>
      <Field label="Assignment type">
        <select value={type} onChange={e => setType(e.target.value as Kind)} disabled={!!replace}>
          <option value="CLASS_TEACHER">Class teacher</option><option value="SUBJECT_TEACHER">Subject teacher</option>
        </select>
      </Field>
      <SearchSelect label="Teacher" options={teachers} value={employeeId} onChange={setEmployeeId} placeholder="Search teachers" testId="select-teacher" />
      <SearchSelect label={type === 'CLASS_TEACHER' ? 'Class' : 'Class (optional)'} options={classes} value={classId} onChange={setClassId} placeholder="Search classes" disabled={!!replace} testId="select-class" />
      {type === 'SUBJECT_TEACHER' && <SearchSelect label="Subject" options={subjects} value={subjectId} onChange={setSubjectId} placeholder="Search subjects" disabled={!!replace} testId="select-subject" />}
      <Field label="Start date"><input type="date" required value={startDate} onChange={e => setStartDate(e.target.value)} /></Field>
      {err && <Notice tone="error">{err}</Notice>}
      <div className="flex justify-end gap-3 border-t border-[hsl(var(--border))] pt-5">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={pending} testId="button-save-assignment">{pending ? 'Saving…' : replace ? 'Replace teacher' : 'Assign teacher'}</Button>
      </div>
    </form>
  );
}
