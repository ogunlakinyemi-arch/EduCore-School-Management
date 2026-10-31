import { useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, CalendarClock, Info, Lock, Users } from 'lucide-react';
import {
  useListClasses, useListSubjects, useListAcademicSessions, useListAcademicTerms, useListEmployees,
  useListClassSubjectAssignments, useListTeacherClassAssignments, useSaveClassSubjectSetup,
  getListClassesQueryKey, getListSubjectsQueryKey, getListAcademicSessionsQueryKey, getListAcademicTermsQueryKey,
  getListEmployeesQueryKey, getListClassSubjectAssignmentsQueryKey, getListTeacherClassAssignmentsQueryKey,
  getListAcademicTimetableQueryKey,
} from '@workspace/api-client-react';
import type { AcademicSession, ClassSubjectAssignment, Employee, TeacherClassAssignment } from '@workspace/api-client-react';
import { PageHeading, Button, SkeletonPage, ErrorState, EmptyState, Field, TenantPicker, useTenant, useSchoolAdminAccess, cx } from '@/components/shared';
import { academicSaveError } from '@/components/academic-save-error';
import {
  type SetupScope, type SubjectChoice, exactScopeLinks, inheritedSessionLinks, retainedOtherLinks,
  implicitStaffingLinks, initialChoices, eligibleSetupTeachers, setupTeacherChoices, buildSetupPayload, scopeQuery, urlScopeId,
} from './class-subject-setup-model';

export function ClassSubjectsPage() {
  const { schoolId } = useTenant();
  const { canManageSchool } = useSchoolAdminAccess();
  return (
    <div className="fade-up">
      <PageHeading eyebrow="Structure / Class subjects" title="Class Subject Setup."
        description="Pick a class first, then tick which catalogue subjects it takes for the session or a single term."
        action={<div className="flex items-center gap-3"><TenantPicker /></div>} />
      {!schoolId ? <EmptyState icon={BookOpen} title="Select a school context" description="Choose a school to set up its class subjects." />
        : !canManageSchool ? <EmptyState icon={Lock} title="School Admins only" description="Only an active School Admin of this school can change class subjects." />
        : <ClassSubjectSetup key={schoolId} schoolId={schoolId} />}
    </div>
  );
}

const fresh = { staleTime: 0, refetchOnWindowFocus: true };

export function ClassSubjectSetup({ schoolId, search = typeof window === 'undefined' ? '' : window.location.search }: { schoolId: number; search?: string }) {
  const qc = useQueryClient();
  const p = { schoolId };
  const urlSession = urlScopeId(search, schoolId, 'sessionId');
  const urlTerm = urlScopeId(search, schoolId, 'termId');
  const urlClass = urlScopeId(search, schoolId, 'classId');
  const [sessionPick, setSessionPick] = useState<number | null>(urlSession ?? 0);
  const [termId, setTermId] = useState<number | null>(urlTerm ?? null);
  const [classId, setClassId] = useState<number | null>(urlClass ?? null);
  const [version, setVersion] = useState(0);
  const [success, setSuccess] = useState<null | { count: number; scope: SetupScope }>(null);
  const dirtyRef = useRef(false);

  const sessionsQ = useListAcademicSessions(p, { query: { ...fresh, queryKey: getListAcademicSessionsQueryKey(p) } });
  const sessions = sessionsQ.data ?? [];
  // 0 = default to current session; an explicit URL ID never falls back to another record.
  const session = sessionPick === 0 ? sessions.find(s => s.isCurrent) : sessions.find(s => s.id === sessionPick);
  const sessionId = session?.id ?? 0;
  const termsQ = useListAcademicTerms(sessionId, p, { query: { ...fresh, enabled: !!sessionId, queryKey: getListAcademicTermsQueryKey(sessionId, p) } });
  const classesQ = useListClasses(p, { query: { ...fresh, queryKey: getListClassesQueryKey(p) } });
  const subjectsQ = useListSubjects(p, { query: { ...fresh, queryKey: getListSubjectsQueryKey(p) } });
  const employeesQ = useListEmployees(p, { query: { ...fresh, queryKey: getListEmployeesQueryKey(p) } });
  const ap = { schoolId, sessionId };
  const linksQ = useListClassSubjectAssignments(ap, { query: { ...fresh, enabled: !!sessionId, queryKey: getListClassSubjectAssignmentsQueryKey(ap) } });
  const staffQ = useListTeacherClassAssignments(ap, { query: { ...fresh, enabled: !!sessionId, queryKey: getListTeacherClassAssignmentsQueryKey(ap) } });

  const terms = termsQ.data ?? [];
  const classes = classesQ.data ?? [];
  const term = termId == null ? null : terms.find(t => t.id === termId);
  const cls = classId == null ? undefined : classes.find(c => c.id === classId);

  const confirmLeave = () => !dirtyRef.current || window.confirm('You have unsaved subject changes for this class and scope. Discard them?');
  const change = (fn: () => void) => { if (!confirmLeave()) return; dirtyRef.current = false; setSuccess(null); fn(); };

  if (sessionsQ.isLoading || classesQ.isLoading) return <SkeletonPage />;
  if (sessionsQ.isError || classesQ.isError) return <ErrorState message="Sessions or classes could not be loaded." retry={() => { void sessionsQ.refetch(); void classesQ.refetch(); }} />;

  const sessionMissing = sessionPick !== 0 && sessionPick != null && !session;
  const termMissing = termId != null && !!sessionId && !termsQ.isLoading && !term;
  const classMissing = classId != null && !cls;
  const ready = !!session && !!cls && !termMissing && !termsQ.isLoading;
  const loadingChildren = ready && (subjectsQ.isLoading || employeesQ.isLoading || linksQ.isLoading || staffQ.isLoading);
  const childError = subjectsQ.error || employeesQ.error || linksQ.error || staffQ.error || termsQ.error;
  const scope: SetupScope | null = ready ? { schoolId, sessionId, termId: term?.id ?? null, classId: cls!.id, section: cls!.section ?? '' } : null;

  return (
    <div className="space-y-6">
      <div className="panel grid gap-4 p-5 md:grid-cols-[1.3fr_1fr_1fr]" data-testid="panel-class-subject-scope">
        <Field label="1. Class">
          <select aria-label="Setup class" data-testid="select-setup-class" value={classId ?? ''} onChange={e => change(() => setClassId(e.target.value ? Number(e.target.value) : null))}>
            <option value="">Choose a class...</option>
            {classes.map(c => <option key={c.id} value={c.id}>{c.name}{c.section ? ` ${c.section}` : ''}</option>)}
          </select>
        </Field>
        <Field label="2. Session">
          <select aria-label="Setup session" data-testid="select-setup-session" value={session?.id ?? ''} onChange={e => change(() => { setSessionPick(e.target.value ? Number(e.target.value) : null); setTermId(null); })}>
            <option value="">Select session...</option>
            {sessions.map(s => <option key={s.id} value={s.id}>{s.name}{s.isCurrent ? ' (current)' : ''}</option>)}
          </select>
        </Field>
        <Field label="3. Term (optional)">
          <select aria-label="Setup term" data-testid="select-setup-term" value={termId ?? ''} disabled={!session || termsQ.isLoading} onChange={e => change(() => setTermId(e.target.value ? Number(e.target.value) : null))}>
            <option value="">Whole session</option>
            {terms.map(t => <option key={t.id} value={t.id}>{String(t.name).charAt(0) + String(t.name).slice(1).toLowerCase()} term</option>)}
          </select>
        </Field>
      </div>

      {(sessionMissing || classMissing || termMissing) && (
        <div role="alert" className="rounded-xl border border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.06)] px-4 py-3 text-sm" data-testid="text-scope-link-missing">
          The link you followed points to a {classMissing ? 'class' : sessionMissing ? 'session' : 'term'} that is not in this school. Choose it again above; nothing was preselected for you.
        </div>
      )}

      <ScopeExplainer />

      {success && (
        <div role="status" className="panel flex flex-wrap items-center justify-between gap-3 border-[hsl(var(--primary)/.3)] p-5" data-testid="notice-setup-saved">
          <div>
            <div className="font-bold">Class subjects saved.</div>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">{success.count} subject{success.count === 1 ? '' : 's'} linked. Next, build the timetable for this class.</p>
          </div>
          <Link href={`/timetable?${scopeQuery(success.scope)}`} className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-bold text-[hsl(var(--primary-foreground))]" data-testid="link-next-timetable">
            <CalendarClock size={16} />Open timetable
          </Link>
        </div>
      )}

      {!cls ? <EmptyState icon={BookOpen} title="Start with a class" description="Choose the class first. Its subjects and eligible teachers appear here." />
        : !session ? <EmptyState icon={BookOpen} title="Select a session" description="Class subjects are stored per academic session. Pick one above." />
        : childError ? <ErrorState message="Subjects, teachers or existing links could not be loaded. Saving is blocked until they load." retry={() => { void subjectsQ.refetch(); void employeesQ.refetch(); void linksQ.refetch(); void staffQ.refetch(); void termsQ.refetch(); }} />
        : !scope ? <EmptyState icon={BookOpen} title="Select a valid term" description="Choose a term from this session, or choose Whole session to manage session-wide subjects." />
        : loadingChildren ? <SkeletonPage />
        : <SubjectLinkForm
            key={`${schoolId}:${scope.sessionId}:${scope.termId ?? 'all'}:${scope.classId}:${version}`}
            scope={scope} session={session} className={`${cls.name}${cls.section ? ` ${cls.section}` : ''}`}
            subjects={(subjectsQ.data ?? []).filter(s => s.schoolId === schoolId)}
            links={linksQ.data ?? []} staffing={staffQ.data ?? []} teachers={employeesQ.data ?? []}
            terms={terms}
            syncing={linksQ.isFetching || staffQ.isFetching || subjectsQ.isFetching || employeesQ.isFetching}
            onDirty={d => { dirtyRef.current = d; }}
            onSaved={async (count) => {
              dirtyRef.current = false;
              await Promise.all([
                qc.invalidateQueries({ queryKey: getListClassSubjectAssignmentsQueryKey() }),
                qc.invalidateQueries({ queryKey: getListTeacherClassAssignmentsQueryKey() }),
                qc.invalidateQueries({ queryKey: getListAcademicTimetableQueryKey() }),
              ]);
              setSuccess({ count, scope });
              setVersion(v => v + 1);
            }} />}
    </div>
  );
}

function ScopeExplainer() {
  return (
    <details className="panel p-4 text-sm" data-testid="text-class-subject-guidance">
      <summary className="flex cursor-pointer items-center gap-2 font-bold"><Info size={15} />How class subject links work</summary>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[hsl(var(--muted-foreground))]">
        <li>Subjects come from the school catalogue. This page links existing subjects only; add new ones on the Subjects page.</li>
        <li>Changes affect future validation (timetable, marks entry). Existing timetable entries and marks are not rewritten.</li>
        <li>Whole session links apply to every term. Term-specific links apply only to that term.</li>
        <li>A term-specific explicit link supersedes staffing-only subject-teacher links for that subject across the whole session.</li>
        <li>Choosing a responsible teacher explicitly assigns them to this class and subject if needed. Existing staffing assignments are retained. Leave the teacher empty to link a subject without changing staffing.</li>
      </ul>
    </details>
  );
}

type FormProps = {
  scope: SetupScope; session: AcademicSession; className: string; subjects: any[]; terms: any[];
  links: ClassSubjectAssignment[]; staffing: TeacherClassAssignment[]; teachers: Employee[];
  syncing: boolean; onDirty: (dirty: boolean) => void; onSaved: (count: number) => Promise<void>;
};

export function SubjectLinkForm({ scope, session, className, subjects, terms, links, staffing, teachers, syncing, onDirty, onSaved }: FormProps) {
  const save = useSaveClassSubjectSetup();
  // Captured once per keyed mount: background refetches never overwrite edits.
  const [baseline] = useState(() => ({
    choices: initialChoices(links, staffing, session, scope),
    expected: exactScopeLinks(links, scope).map(a => a.id),
  }));
  const [choices, setChoices] = useState<Map<number, SubjectChoice>>(() => new Map(baseline.choices));
  const [failure, setFailure] = useState('');

  const inherited = useMemo(() => inheritedSessionLinks(links, scope), [links, scope]);
  const inheritedIds = new Set(inherited.map(a => a.subjectId));
  const implicitIds = new Set(implicitStaffingLinks(links, staffing, session, scope).map(a => a.subjectId));
  const retained = retainedOtherLinks(links, scope);
  const currentExpected = exactScopeLinks(links, scope).map(a => a.id).sort().join(',');
  const serverChanged = currentExpected !== [...baseline.expected].sort().join(',');

  const dirty = (() => {
    if (choices.size !== baseline.choices.size) return true;
    for (const [id, c] of choices) { const b = baseline.choices.get(id); if (!b || b.teacherId !== c.teacherId) return true; }
    return false;
  })();
  onDirty(dirty);

  const toggle = (subjectId: number, on: boolean) => setChoices(prev => {
    const next = new Map(prev);
    if (on) { if (!next.has(subjectId)) next.set(subjectId, { subjectId, teacherId: null }); }
    else next.delete(subjectId);
    return next;
  });
  const setTeacher = (subjectId: number, teacherId: number | null) => setChoices(prev => {
    const next = new Map(prev); next.set(subjectId, { subjectId, teacherId }); return next;
  });

  const schoolTeachers = setupTeacherChoices(teachers, scope.schoolId);
  const eligibleFor = (subjectId: number) => eligibleSetupTeachers(teachers, staffing, session, scope, subjectId);
  const invalidTeacher = [...choices.values()].some(c => c.teacherId != null && !schoolTeachers.some(t => t.id === c.teacherId));
  const termLabel = (id: number | null | undefined) => { const t = terms.find(x => x.id === id); return t ? `${String(t.name).toLowerCase()} term` : `term ${id}`; };
  const scopeLabel = scope.termId == null ? 'the whole session' : termLabel(scope.termId);
  const staffingHref = `/teacher-assignments?${scopeQuery(scope)}`;

  const submit = async () => {
    setFailure('');
    if (save.isPending) return;
    if (serverChanged) return setFailure('Class subject links changed. Reload them before saving.');
    if (syncing) return setFailure('Wait for the latest subjects and teachers to finish loading.');
    if (invalidTeacher) return setFailure('A selected responsible teacher is not an active teacher of this school. Choose another or leave it empty.');
    try {
      const data = buildSetupPayload(scope, baseline.expected, choices);
      const result = await save.mutateAsync({ data });
      await onSaved(result?.linkedSubjectCount ?? data.subjects.length);
    } catch (error) {
      setFailure(academicSaveError(error, 'Could not save class subjects. Someone may have changed them; reload and retry.'));
    }
  };

  return (
    <div className="space-y-6">
      <div className="panel overflow-hidden" data-testid="panel-subject-links">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[hsl(var(--border))] px-6 py-5">
          <div>
            <div className="eyebrow">Editing {scopeLabel}</div>
            <h3 className="display-font mt-1 text-xl font-bold">{className}</h3>
          </div>
          <div className="text-xs text-[hsl(var(--muted-foreground))]" data-testid="text-selected-count">{choices.size} selected{dirty ? ' · unsaved changes' : ''}</div>
        </div>
        {serverChanged && <p role="status" className="border-b border-[hsl(var(--border))] bg-[hsl(var(--accent)/.12)] px-6 py-3 text-sm" data-testid="text-server-changed">These links changed on the server since you opened them. Your edits are kept; saving will be rejected if they conflict, so reload the scope if needed.</p>}
        {subjects.length === 0 ? (
          <EmptyState icon={BookOpen} title="The subject catalogue is empty" description="Add subjects to the school catalogue first, then link them here."
            action={<Link href="/subjects" className="text-sm font-bold underline" data-testid="link-empty-catalogue">Open Subjects</Link>} />
        ) : (
          <ul className="divide-y divide-[hsl(var(--border)/.6)]">
            {subjects.map(subject => {
              const isInherited = inheritedIds.has(subject.id) && !choices.has(subject.id);
              const checked = choices.has(subject.id);
              const eligible = checked ? eligibleFor(subject.id) : [];
              const choice = choices.get(subject.id);
              return (
                <li key={subject.id} className={cx('grid gap-3 px-6 py-4 md:grid-cols-[1.4fr_1fr] md:items-center', checked && 'bg-[hsl(var(--primary)/.04)]')} data-testid={`row-subject-${subject.id}`}>
                  <label className="flex items-start gap-3">
                    <input type="checkbox" className="mt-0.5 h-5 w-5" checked={checked || isInherited} disabled={isInherited || subject.status === 'INACTIVE' && !checked}
                      onChange={e => toggle(subject.id, e.target.checked)} aria-label={`Link ${subject.name}`} data-testid={`checkbox-subject-${subject.id}`} />
                    <span>
                      <span className="font-bold">{subject.name}</span> <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">{subject.code}</span>
                      {isInherited && <span className="mt-1 block text-xs text-[hsl(var(--muted-foreground))]" data-testid={`text-inherited-${subject.id}`}>Inherited from the whole session (read-only). Select Whole session to edit.</span>}
                      {implicitIds.has(subject.id) && <span className="mt-1 block text-xs text-[hsl(var(--muted-foreground))]">Currently implied by a subject-teacher assignment. Saving makes it an explicit link.</span>}
                      {subject.status === 'INACTIVE' && <span className="mt-1 block text-xs text-[hsl(var(--muted-foreground))]">Inactive in the catalogue.</span>}
                    </span>
                  </label>
                  {checked && (
                    <div>
                      <select aria-label={`Responsible teacher for ${subject.name}`} value={choice?.teacherId ?? ''} data-testid={`select-teacher-${subject.id}`}
                        onChange={e => setTeacher(subject.id, e.target.value ? Number(e.target.value) : null)}>
                        <option value="">No responsible teacher</option>
                        {schoolTeachers.map(t => <option key={t.id} value={t.id}>{t.firstName} {t.lastName}{eligible.some(e => e.id === t.id) ? ' (assigned)' : ''}</option>)}
                        {choice?.teacherId != null && !schoolTeachers.some(t => t.id === choice.teacherId) && <option value={choice.teacherId}>Teacher {choice.teacherId} (not an active teacher)</option>}
                      </select>
                      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]" data-testid={`text-teacher-help-${subject.id}`}>
                        Optional. Choosing a teacher assigns them to this class and subject when you save (an existing assignment is reused, otherwise a subject-teacher assignment is added). Nothing changes in staffing unless you choose one; timetables and marks are not rewritten.
                        {!eligible.length && <> No teacher is assigned yet; you can still link the subject. <Link href={staffingHref} className="font-bold underline">Detailed staffing</Link></>}
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {inherited.length > 0 && scope.termId != null && (
        <div className="panel p-5 text-sm" data-testid="panel-inherited">
          <div className="font-bold">Session-wide subjects ({inherited.length})</div>
          <p className="mt-1 text-[hsl(var(--muted-foreground))]">These apply to every term. Select Whole session to edit them.</p>
        </div>
      )}
      {retained.length > 0 && (
        <div className="panel p-5 text-sm" data-testid="panel-retained">
          <div className="font-bold">Other links kept as they are</div>
          <ul className="mt-2 space-y-1 text-[hsl(var(--muted-foreground))]">
            {retained.map(a => <li key={a.id}>{subjects.find(s => s.id === a.subjectId)?.name ?? `Subject ${a.subjectId}`}: {a.termId != null ? termLabel(a.termId) : 'whole session'}{String(a.status).toUpperCase() !== 'ACTIVE' ? ` (${String(a.status).toLowerCase()})` : ''}</li>)}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={staffingHref} className="inline-flex items-center gap-2 text-sm font-bold underline" data-testid="link-teacher-assignments"><Users size={15} />Manage teacher assignments</Link>
        <div className="flex gap-3">
          <Button variant="outline" disabled={!dirty || save.isPending} onClick={() => setChoices(new Map(baseline.choices))} testId="button-reset-subjects">Discard changes</Button>
          <Button onClick={() => void submit()} disabled={save.isPending || syncing || !dirty || invalidTeacher || serverChanged} testId="button-save-class-subjects">{save.isPending ? 'Saving...' : 'Save class subjects'}</Button>
        </div>
      </div>
      {failure && <p role="alert" className="text-sm font-medium text-[hsl(var(--destructive))]" data-testid="text-save-failure">{failure}</p>}
    </div>
  );
}
