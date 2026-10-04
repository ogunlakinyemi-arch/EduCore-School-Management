import { useState, useEffect, FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeading, Button, SkeletonPage, ErrorState, EmptyState, Modal, Field, TenantPicker, useTenant, cx, time } from '@/components/shared';
import { 
  useListAcademicTimetable, useCreateAcademicTimetableEntry, useUpdateAcademicTimetableEntry, getListAcademicTimetableQueryKey,
  useGetMyAcademicTimetable, getGetMyAcademicTimetableQueryKey,
  useListAcademicSessions, useListAcademicTerms, useListClasses, useListSubjects, useListEmployees,
  getListAcademicSessionsQueryKey, getListAcademicTermsQueryKey, getListClassesQueryKey, getListSubjectsQueryKey, getListEmployeesQueryKey,
  useListClassSubjectAssignments, useListTeacherClassAssignments,
  getListClassSubjectAssignmentsQueryKey, getListTeacherClassAssignmentsQueryKey
} from '@workspace/api-client-react';
import { Plus, Pencil, Calendar, Clock, MapPin } from 'lucide-react';
import { useGetAuthorizedContext } from '@workspace/api-client-react';
import { academicSaveError } from '@/components/academic-save-error';
import { matchingTimetableSubjects, matchingTimetableTeachers } from './timetable-eligibility';

const freshChoices = { staleTime: 0, refetchOnMount: 'always' as const, refetchOnWindowFocus: true };

function useAcademicContext(schoolId: number, sessionId: number | null = 0, termId: number | null = 0) {
  const params = { schoolId };
  const sessions = useListAcademicSessions(params, { query: { ...freshChoices, enabled: !!schoolId, queryKey: getListAcademicSessionsQueryKey(params) } });
  // 0 selects the initial default; null is an explicit clear and must not fall
  // back to a current/first record from a different selection.
  const activeSession = sessionId === null ? undefined : sessionId
    ? sessions.data?.find(s => s.id === sessionId)
    : sessions.data?.find(s => s.isCurrent) || sessions.data?.[0];
  const sessionKey = activeSession?.id ?? 0;
  const terms = useListAcademicTerms(sessionKey, params, { query: { ...freshChoices, enabled: !!(schoolId && sessionKey), queryKey: getListAcademicTermsQueryKey(sessionKey, params) } });
  const activeTerm = !activeSession || termId === null ? undefined : termId
    ? terms.data?.find(t => t.id === termId)
    : terms.data?.find(t => t.isCurrent) || terms.data?.[0];
  const classes = useListClasses(params, { query: { ...freshChoices, enabled: !!schoolId, queryKey: getListClassesQueryKey(params) } });
  const subjects = useListSubjects(params, { query: { ...freshChoices, enabled: !!schoolId, queryKey: getListSubjectsQueryKey(params) } });
  const teachers = useListEmployees(params, { query: { ...freshChoices, enabled: !!schoolId, queryKey: getListEmployeesQueryKey(params) } });

  return { activeSession, activeTerm, sessions: sessions.data ?? [], terms: activeSession ? terms.data ?? [] : [], error: sessions.error || terms.error || classes.error || subjects.error || teachers.error, classes: classes.data ?? [], subjects: subjects.data ?? [], teachers: teachers.data ?? [], isLoading: sessions.isLoading || terms.isLoading || classes.isLoading || subjects.isLoading || teachers.isLoading,
    coreLoading: sessions.isLoading || terms.isLoading || classes.isLoading,
    coreError: sessions.error || terms.error || classes.error,
    subjectLoading: !!subjects.isFetching, subjectError: subjects.error,
    teacherLoading: !!teachers.isFetching, teacherError: teachers.error,
    refetchSubjects: () => subjects.refetch(), refetchTeachers: () => teachers.refetch(),
    refetch: () => Promise.all([sessions.refetch(), classes.refetch(), subjects.refetch(), teachers.refetch(), ...(activeSession ? [terms.refetch()] : [])]),
  };
}

export function TimetablePage() {
  const { schoolId } = useTenant();
  const contextQuery = useGetAuthorizedContext();
  const roles = contextQuery.data?.roles?.map(r => r.role) || [];
  
  const canManage = !contextQuery.data?.isPlatformOwner && !!contextQuery.data?.roles?.some(
    role => role.role === 'SCHOOL_ADMIN' && role.schoolId === schoolId && role.status === 'ACTIVE'
  );
  const canViewSchoolSchedule = !!contextQuery.data?.isPlatformOwner || canManage;
  const isTeacherOrStudent = roles.includes('TEACHER') || roles.includes('STUDENT');
  const isStudent = roles.includes('STUDENT') && !roles.includes('TEACHER');
  
  const [tab, setTab] = useState<'manage' | 'mine'>('manage');
  const activeTab = canViewSchoolSchedule ? tab : 'mine';

  if (contextQuery.isLoading) return <SkeletonPage />;
  
  return (
    <div className="fade-up">
      <PageHeading 
        eyebrow="Academics" 
        title="Timetable." 
        description="Class schedules and academic calendar blocks." 
        action={<TenantPicker />} 
      />
      {!schoolId ? (
        <EmptyState icon={Calendar} title="Select a school context" description="You must select a school to view timetables." />
      ) : (
        <>
          {canManage && isTeacherOrStudent && (
            <div className="mb-6 flex gap-2 border-b border-[hsl(var(--border))]">
               <button onClick={() => setTab('manage')} className={cx("px-4 py-2.5 text-sm font-bold border-b-2 transition-colors", activeTab === 'manage' ? "border-[hsl(var(--primary))] text-[hsl(var(--foreground))]" : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]")}>{canManage ? 'Manage Timetable' : 'View Timetable'}</button>
               <button onClick={() => setTab('mine')} className={cx("px-4 py-2.5 text-sm font-bold border-b-2 transition-colors", activeTab === 'mine' ? "border-[hsl(var(--primary))] text-[hsl(var(--foreground))]" : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]")}>My Schedule</button>
            </div>
          )}
          {activeTab === 'manage' && canViewSchoolSchedule && <ManageTimetableView key={schoolId} schoolId={schoolId} canEdit={canManage} />}
           {activeTab === 'mine' && isTeacherOrStudent && <MyScheduleView schoolId={schoolId} isStudent={isStudent} />}
        </>
      )}
    </div>
  );
}

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

function initialTimetableFilter(schoolId: number, name: 'sessionId' | 'termId' | 'classId') {
  const search = new URLSearchParams(window.location.search);
  if (search.get('schoolId') !== String(schoolId)) return undefined;
  const raw = search.get(name);
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function ManageTimetableView({ schoolId, canEdit }: { schoolId: number; canEdit: boolean }) {
  const [sessionId,setSessionId] = useState<number | null>(() => initialTimetableFilter(schoolId, 'sessionId') ?? 0);
  const [termId,setTermId] = useState<number | null>(() => initialTimetableFilter(schoolId, 'termId') ?? 0);
  const { activeSession, activeTerm, sessions, terms, coreError: error, classes, subjects, teachers, coreLoading: isLoading } = useAcademicContext(schoolId,sessionId,termId);
  const assignmentParams = { schoolId, sessionId: activeSession?.id };
  const subjectAssignments = useListClassSubjectAssignments(assignmentParams, { query: {
    ...freshChoices, enabled: canEdit && !!activeSession, queryKey: getListClassSubjectAssignmentsQueryKey(assignmentParams),
  } });
  const teacherAssignments = useListTeacherClassAssignments(assignmentParams, { query: {
    ...freshChoices, enabled: canEdit && !!activeSession, queryKey: getListTeacherClassAssignmentsQueryKey(assignmentParams),
  } });
  const [classId, setClassId] = useState<number | ''>(() => initialTimetableFilter(schoolId, 'classId') ?? '');
  
  const query = useListAcademicTimetable(
    { schoolId, sessionId: activeSession?.id, termId: activeTerm?.id, classId: classId || undefined }, 
    { query: { enabled: !!(schoolId && activeSession?.id && activeTerm?.id && classId), queryKey: getListAcademicTimetableQueryKey({ schoolId, sessionId: activeSession?.id, termId: activeTerm?.id, classId: classId || undefined }) } }
  );
  
  const [modal, setModal] = useState<any>(null);
  const qc = useQueryClient();

  // Keep the saved view visible after reload without changing the tenant picker
  // or treating URL IDs as authorization. Catalogs and every API remain scoped
  // to the currently authorized school.
  useEffect(() => {
    if (isLoading) return;
    const url = new URL(window.location.href);
    url.searchParams.set('schoolId', String(schoolId));
    for (const [name, value] of [['sessionId', activeSession?.id], ['termId', activeTerm?.id], ['classId', classId]] as const) {
      if (value) url.searchParams.set(name, String(value));
      else url.searchParams.delete(name);
    }
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, '', next);
    }
  }, [schoolId, activeSession?.id, activeTerm?.id, classId, isLoading]);

  // Shared choice-query failures must not unmount the editor: it owns the
  // per-dropdown loading/error/Retry states and blocks saving until recovered.
  if (isLoading) return <SkeletonPage />;
  if (error) return <ErrorState retry={() => qc.invalidateQueries()} message="Timetable choices could not be loaded. Retry before saving." />;

  const entries = query.data ?? [];

  return (
    <div className="space-y-6">
      <div className="panel p-5 flex flex-wrap items-center gap-4 bg-[hsl(var(--card))] border border-[hsl(var(--border))]">
        <Field label="Academic Session"><select value={activeSession?.id ?? ''} onChange={e=>{setSessionId(e.target.value ? Number(e.target.value) : null);setTermId(null);setClassId('');setModal(null);}} data-testid="select-timetable-session">
          <option value="">Select session...</option>
          {!sessions.length && <option value="">No sessions configured</option>}
          {sessions.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
        </select></Field>
        <Field label="Term"><select value={activeTerm?.id ?? ''} disabled={!activeSession} onChange={e=>{setTermId(e.target.value ? Number(e.target.value) : null);setClassId('');setModal(null);}} data-testid="select-timetable-term">
          <option value="">Select term...</option>
          {!terms.length && <option value="">No terms configured</option>}
          {terms.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
        </select></Field>
        <div className="w-full max-w-sm">
          <Field label="Filter by Class">
            <select value={classId} disabled={!activeTerm} onChange={e => { setClassId(e.target.value ? Number(e.target.value) : ''); setModal(null); }} className="w-full" data-testid="select-timetable-filter-class">
              <option value="">Choose a class...</option>
              {classes.map((c: any) => <option key={c.id} value={c.id}>{c.name} {c.section}</option>)}
            </select>
          </Field>
        </div>
        {canEdit && (
          <div className="ml-auto mt-4">
             <Button disabled={!sessions.length} onClick={() => setModal({ create: true, classId: classId || undefined })} testId="button-add-timetable-entry"><Plus size={16}/> Add Timetable Entry</Button>
          </div>
        )}
      </div>

      {classId ? query.isLoading ? (
        <div className="p-8 text-center text-[hsl(var(--muted-foreground))]">Loading timetable...</div>
      ) : query.isError ? <ErrorState retry={() => query.refetch()} message="The timetable could not be loaded." /> : entries.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {DAYS.map(day => {
            const dayEntries = entries.filter((e: any) => e.weekday === day).sort((a: any, b: any) => a.startTime.localeCompare(b.startTime));
            if (dayEntries.length === 0) return null;
            return (
              <div key={day} className="panel overflow-hidden">
                <div className="bg-[hsl(var(--muted)/.4)] px-4 py-3 border-b border-[hsl(var(--border))] font-bold text-sm tracking-wide text-[hsl(var(--muted-foreground))]">{day}</div>
                <div className="divide-y divide-[hsl(var(--border)/.5)]">
                  {dayEntries.map((item: any) => (
                    <div key={item.id} className="p-4 group hover:bg-[hsl(var(--muted)/.15)] relative">
                      {canEdit && <button aria-label="Edit timetable entry" onClick={() => setModal(item)} className="absolute top-4 right-4 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 focus:opacity-100 bg-[hsl(var(--card))] border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-all"><Pencil size={12} /></button>}
                      <div className="flex items-center gap-2 text-xs font-medium text-[hsl(var(--primary))] mb-1.5">
                        <Clock size={12} /> {item.startTime} — {item.endTime}
                      </div>
                      <div className="font-bold">{item.subjectName || subjects.find((s: any) => s.id === item.subjectId)?.name || 'Subject'}</div>
                      <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1">Teacher: {item.teacherFirstName || teachers.find((t: any) => t.id === item.teacherId)?.firstName} {item.teacherLastName || teachers.find((t: any) => t.id === item.teacherId)?.lastName}</div>
                      {item.room && <div className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5 flex items-center gap-1"><MapPin size={10} /> Room {item.room}</div>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Calendar} title="Timetable is empty" description={canEdit ? "Add schedule blocks to build the class timetable." : "No schedule blocks are available for this class."} />
      ) : (
        <EmptyState icon={Calendar} title="Select a class" description={canEdit ? "Choose a class to view and manage its timetable." : "Choose a class to view its timetable."} />
      )}

      {canEdit && modal && (
        <Modal viewport title={modal.create ? "Add Timetable Entry" : "Edit Timetable Entry"} onClose={() => setModal(null)}>
          <TimetableEditor
            schoolId={schoolId} initialSessionId={activeSession?.id} initialTermId={activeTerm?.id}
            initial={modal.create ? null : modal}
            defaultClassId={modal.classId}
            onDone={(saved: any) => { setSessionId(saved.sessionId); setTermId(saved.termId); setClassId(saved.classId); setModal(null); qc.invalidateQueries({ queryKey: getListAcademicTimetableQueryKey() }); qc.invalidateQueries({queryKey:getGetMyAcademicTimetableQueryKey()}); }}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
    </div>
  );
}

export function TimetableEditor({ schoolId, initialSessionId, initialTermId, initial, defaultClassId, onDone, onCancel }: any) {
  const [sessionId, setSessionId] = useState<number | null>(initial?.sessionId ?? initialSessionId ?? 0);
  const [termId, setTermId] = useState<number | null>(initial?.termId ?? initialTermId ?? 0);
  const [periodChanged, setPeriodChanged] = useState(false);
  const context = useAcademicContext(schoolId, sessionId, termId);
  const params = { schoolId, sessionId: context.activeSession?.id };
  const subjectAssignments = useListClassSubjectAssignments(params, { query: {
    ...freshChoices, enabled: !!context.activeSession, queryKey: getListClassSubjectAssignmentsQueryKey(params),
  } });
  const teacherAssignments = useListTeacherClassAssignments(params, { query: {
    ...freshChoices, enabled: !!context.activeSession, queryKey: getListTeacherClassAssignmentsQueryKey(params),
  } });
  if (context.coreLoading) return <SkeletonPage />;
  if (context.coreError) {
    return <ErrorState message="Timetable choices could not be loaded. Retry before saving."
      retry={() => { void context.refetch(); if (context.activeSession) { void subjectAssignments.refetch(); void teacherAssignments.refetch(); } }} />;
  }
  return <TimetableEntryForm key={`${schoolId}:${context.activeSession?.id ?? ''}:${context.activeTerm?.id ?? ''}:${periodChanged}`}
    schoolId={schoolId} sessionId={context.activeSession?.id} termId={context.activeTerm?.id} session={context.activeSession}
    classes={context.classes} subjects={context.subjects} teachers={context.teachers}
    subjectAssignments={subjectAssignments.data ?? []} teacherAssignments={teacherAssignments.data ?? []}
    subjectLoading={context.subjectLoading || subjectAssignments.isFetching || teacherAssignments.isFetching}
    subjectError={context.subjectError || subjectAssignments.error || teacherAssignments.error}
    teacherLoading={context.teacherLoading || subjectAssignments.isFetching || teacherAssignments.isFetching}
    teacherError={context.teacherError || subjectAssignments.error || teacherAssignments.error}
    onRetrySubjects={() => { void context.refetchSubjects(); void subjectAssignments.refetch(); void teacherAssignments.refetch(); }}
    onRetryTeachers={() => { void context.refetchTeachers(); void subjectAssignments.refetch(); void teacherAssignments.refetch(); }}
    initial={periodChanged && initial ? { ...initial, classId: '', subjectId: '', teacherId: '', section: '' } : initial}
    defaultClassId={periodChanged ? undefined : defaultClassId}
    sessions={context.sessions} terms={context.terms}
    onSessionChange={(value: number | null) => { setSessionId(value); setTermId(null); setPeriodChanged(true); }}
    onTermChange={(value: number | null) => { setTermId(value); setPeriodChanged(true); }}
    onDone={onDone} onCancel={onCancel} />;
}

export function TimetableEntryForm({ schoolId, sessionId, termId, session, classes, subjects, teachers, subjectAssignments = [], teacherAssignments = [], subjectLoading = false, subjectError, teacherLoading = false, teacherError, onRetrySubjects, onRetryTeachers, initial, defaultClassId, sessions, terms, onSessionChange, onTermChange, onDone, onCancel }: any) {
  const create = useCreateAcademicTimetableEntry();
  const update = useUpdateAcademicTimetableEntry();
  const [failure,setFailure] = useState('');
  const [form, setForm] = useState({
    classId: initial?.classId || defaultClassId || '',
    subjectId: initial?.subjectId || '',
    teacherId: initial?.teacherId || '',
    weekday: initial?.weekday || 'MONDAY',
    startTime: initial?.startTime || '08:00',
    endTime: initial?.endTime || '09:00',
    room: initial?.room || ''
  });
  const [sectionChosen, setSectionChosen] = useState(!!(initial?.classId || defaultClassId));
  const section = classes.find((c: any) => c.id === Number(form.classId))?.section ?? '';
  const selection = { schoolId, sessionId, termId, classId: Number(form.classId), section, subjectId: Number(form.subjectId) };
  const assignedSubjects = sessionId && termId && sectionChosen ? matchingTimetableSubjects(subjectAssignments, selection, teacherAssignments, session) : [];
  const eligibleSubjects = subjects.filter((subject: any) => subject.schoolId === schoolId && assignedSubjects.some(a => a.subjectId === subject.id));
  const subjectValid = eligibleSubjects.some((subject: any) => subject.id === Number(form.subjectId));
  const eligibleTeachers = sectionChosen && termId && subjectValid ? matchingTimetableTeachers(teachers, subjectAssignments, teacherAssignments, session, selection) : [];
  const teacherValid = eligibleTeachers.some(teacher => teacher.id === Number(form.teacherId));
  // Assignment changes/refetches must not leave an old option selected.
  useEffect(() => {
    if (subjectLoading || subjectError) return;
    if ((form.subjectId && !subjectValid) || (!teacherLoading && !teacherError && form.teacherId && !teacherValid)) {
      setForm(previous => ({ ...previous, subjectId: subjectValid ? previous.subjectId : '', teacherId: '' }));
    }
  }, [subjectValid, teacherValid, form.subjectId, form.teacherId, subjectLoading, subjectError, teacherLoading, teacherError]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (create.isPending || update.isPending) return;
    setFailure('');
    if (subjectLoading || teacherLoading) return setFailure('Wait for subjects and teachers to finish loading.');
    if (subjectError || teacherError) return setFailure('Unable to load timetable choices. Try again before saving.');
    if (!sessionId || !termId) return setFailure('Select a valid session and term before saving.');
    if (form.startTime >= form.endTime) return setFailure('End time must be later than start time.');
    if (!subjectValid) return setFailure('Select a subject assigned to this class/section in the selected session and term.');
    if (!teacherValid) {
      return setFailure('Selected teacher is not assigned to this subject/class in the selected session.');
    }
    const data = {
      ...form,
      classId: Number(form.classId),
      subjectId: Number(form.subjectId),
      teacherId: Number(form.teacherId),
      schoolId,
      sessionId: Number(sessionId),
      termId: Number(termId),
      section: classes.find((c: any) => c.id === Number(form.classId))?.section ?? '',
    };
    try {
      if (initial) await update.mutateAsync({ entryId: initial.id, data });
      else await create.mutateAsync({ data });
      onDone(data);
    } catch (error) {
      setFailure(academicSaveError(error, 'Could not save the timetable. Check the selected period and teacher assignment, then retry.'));
    }
  };

  const pending = create.isPending || update.isPending;

  return (
    <form onSubmit={save} className="space-y-4">
      {sessions && <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Session"><select aria-label="Timetable session" value={sessionId ?? ''} required
          onChange={e => onSessionChange(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Select session...</option>
          {sessions.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></Field>
        <Field label="Term"><select aria-label="Timetable term" value={termId ?? ''} required disabled={!sessionId}
          onChange={e => onTermChange(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Select term...</option>
          {terms.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select></Field>
      </div>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Class">
          <select required aria-label="Timetable class" disabled={!sessionId || !termId} value={form.classId} onChange={e => { setSectionChosen(false); setForm({...form, classId: e.target.value, subjectId: '', teacherId: ''}); }} className="w-full">
            <option value="">Select class...</option>
            {classes.map((c: any) => <option key={c.id} value={c.id}>{c.name} {c.section}</option>)}
          </select>
        </Field>
        <Field label="Day of Week">
          <select required value={form.weekday} onChange={e => setForm({...form, weekday: e.target.value})} className="w-full">
            {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Start Time">
          <input type="time" required value={form.startTime} onChange={e => setForm({...form, startTime: e.target.value})} className="w-full" />
        </Field>
        <Field label="End Time">
          <input type="time" required value={form.endTime} onChange={e => setForm({...form, endTime: e.target.value})} className="w-full" />
        </Field>
      </div>
      <Field label="Section"><select value={sectionChosen ? section || '__none__' : '__choose__'} required disabled={!form.classId || !termId} aria-label="Timetable section"
        onChange={e => {
          const current = classes.find((c: any) => c.id === Number(form.classId));
          const selectedSection = e.target.value === '__none__' ? '' : e.target.value;
          const next = classes.find((c: any) => c.name === current?.name && (c.section ?? '') === selectedSection);
          setSectionChosen(!!next);
          setForm(previous => ({ ...previous, classId: next?.id ?? previous.classId, subjectId: '', teacherId: '' }));
        }}>
        <option value="__choose__" disabled>Select section...</option>
        {classes.filter((c: any) => c.name === classes.find((row: any) => row.id === Number(form.classId))?.name)
          .map((c: any) => <option key={c.id} value={c.section || '__none__'}>{c.section || 'No section'}</option>)}
      </select><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Choose an existing section of this class. No class or assignment is created.</p></Field>
      <Field label="Subject">
        <select required aria-label="Timetable subject" value={form.subjectId} onChange={e => setForm({...form, subjectId: e.target.value, teacherId: ''})} className="w-full" disabled={subjectLoading || !!subjectError || !eligibleSubjects.length}>
          <option value="">{subjectLoading ? 'Loading subjects...' : subjectError ? 'Unable to load subjects. Try again.' : 'Select subject...'}</option>
          {eligibleSubjects.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {subjectError ? <p role="alert" className="mt-1 text-xs text-[hsl(var(--destructive))]">Unable to load subjects. Try again. <button type="button" className="underline" onClick={onRetrySubjects}>Try again</button></p>
          : subjectLoading ? <p role="status">Loading subjects...</p>
          : !eligibleSubjects.length && <p role="status" className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{!form.classId || !sectionChosen
          ? 'Select a class and section to see its assigned subjects.'
          : 'No subjects are assigned to this class.'}</p>}
      </Field>
      <Field label="Teacher">
        <select required aria-label="Timetable teacher" value={form.teacherId} onChange={e => setForm({...form, teacherId: e.target.value})} className="w-full" disabled={teacherLoading || !!teacherError || !eligibleTeachers.length} aria-describedby="timetable-teacher-help">
          <option value="">{subjectValid && teacherLoading ? 'Loading teachers...' : subjectValid && teacherError ? 'Unable to load teachers. Try again.' : eligibleTeachers.length ? 'Select teacher' : 'No eligible teachers available'}</option>
          {eligibleTeachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.firstName} {teacher.lastName}</option>)}
        </select>
        <p id="timetable-teacher-help" role={eligibleTeachers.length ? undefined : 'status'} className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
          {!subjectValid ? 'Select an assigned subject to see its eligible teachers.'
            : teacherError ? <>Unable to load teachers. Try again. <button type="button" className="underline" onClick={onRetryTeachers}>Try again</button></>
            : teacherLoading ? 'Loading teachers...'
            : eligibleTeachers.length
            ? 'Only teachers assigned to this class/section and subject in the selected session are available. Assignments are checked again when saving.'
            : !form.subjectId ? 'Select an assigned subject to see its eligible teachers.' : 'No teacher is assigned to this subject/class.'}
        </p>
      </Field>
      <Field label="Room (Optional)">
        <input value={form.room} onChange={e => setForm({...form, room: e.target.value})} placeholder="e.g. Rm 102" className="w-full" />
      </Field>
      <div className="flex justify-end gap-3 pt-4 border-t border-[hsl(var(--border))]">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={pending || subjectLoading || teacherLoading || !!subjectError || !!teacherError || !subjectValid || !teacherValid}>{pending ? 'Saving...' : 'Save'}</Button>
      </div>
      {failure && <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{failure}</p>}
    </form>
  );
}

function MyScheduleView({ schoolId, isStudent }: { schoolId: number; isStudent: boolean }) {
  const { activeSession, activeTerm, classes, subjects, isLoading } = useAcademicContext(schoolId);
  const studentQuery = useGetMyAcademicTimetable(
    { schoolId, sessionId: activeSession?.id, termId: activeTerm?.id },
    { query: { enabled: isStudent && !!(schoolId && activeSession?.id && activeTerm?.id), queryKey: getGetMyAcademicTimetableQueryKey({ schoolId, sessionId: activeSession?.id, termId: activeTerm?.id }) } }
  );
  const teacherQuery = useListAcademicTimetable(
    { schoolId, sessionId: activeSession?.id, termId: activeTerm?.id },
    { query: { enabled: !isStudent && !!(schoolId && activeSession?.id && activeTerm?.id), queryKey: getListAcademicTimetableQueryKey({ schoolId, sessionId: activeSession?.id, termId: activeTerm?.id }) } }
  );
  const query = isStudent ? studentQuery : teacherQuery;

  if (isLoading || query.isLoading) return <SkeletonPage />;
  if (query.isError) return <ErrorState retry={() => query.refetch()} />;

  const entries = query.data ?? [];

  if (entries.length === 0) {
    return <EmptyState icon={Calendar} title="No schedule found" description="You have no classes scheduled for the active term." />;
  }

  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {DAYS.map(day => {
        const dayEntries = entries.filter((e: any) => e.weekday === day).sort((a: any, b: any) => a.startTime.localeCompare(b.startTime));
        if (dayEntries.length === 0) return null;
        return (
          <div key={day} className="panel overflow-hidden border border-[hsl(var(--primary)/.2)]">
            <div className="bg-[hsl(var(--primary)/.05)] px-4 py-3 border-b border-[hsl(var(--primary)/.1)] font-bold text-sm tracking-wide text-[hsl(var(--primary))]">{day}</div>
            <div className="divide-y divide-[hsl(var(--border)/.5)]">
              {dayEntries.map((item: any) => (
                <div key={item.id} className="p-4 bg-[hsl(var(--card))]">
                  <div className="flex items-center gap-2 text-xs font-bold text-[hsl(var(--foreground))] mb-1.5">
                    <Clock size={12} className="text-[hsl(var(--muted-foreground))]" /> {item.startTime} — {item.endTime}
                  </div>
                  <div className="font-bold text-base">{subjects.find((s: any) => s.id === item.subjectId)?.name || 'Subject'}</div>
                  <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1">Class: {classes.find((c: any) => c.id === item.classId)?.name || 'Class'}</div>
                  {item.room && <div className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5 flex items-center gap-1"><MapPin size={10} /> Room {item.room}</div>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
