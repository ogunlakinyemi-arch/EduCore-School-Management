import { useState, FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeading, Button, SkeletonPage, ErrorState, EmptyState, Modal, Field, TenantPicker, useTenant, cx, time } from '@/components/shared';
import { 
  useListAcademicTimetable, useCreateAcademicTimetableEntry, useUpdateAcademicTimetableEntry, getListAcademicTimetableQueryKey,
  useGetMyAcademicTimetable, getGetMyAcademicTimetableQueryKey,
  useListAcademicSessions, useListAcademicTerms, useListClasses, useListSubjects, useListEmployees
} from '@workspace/api-client-react';
import { Plus, Pencil, Calendar, Clock, MapPin } from 'lucide-react';
import { useGetAuthorizedContext } from '@workspace/api-client-react';

function useAcademicContext(schoolId: number) {
  const sessions = useListAcademicSessions({ schoolId }, { query: { enabled: !!schoolId, queryKey: ['sessions', schoolId] } });
  const activeSession = sessions.data?.find((s: any) => s.isCurrent) || sessions.data?.[0];
  const terms = useListAcademicTerms(activeSession?.id as number, { schoolId }, { query: { enabled: !!(schoolId && activeSession?.id), queryKey: ['terms', activeSession?.id, schoolId] } });
  const activeTerm = terms.data?.find((t: any) => t.isCurrent) || terms.data?.[0];
  const classes = useListClasses({ schoolId }, { query: { enabled: !!schoolId, queryKey: ['classes', schoolId] } });
  const subjects = useListSubjects({ schoolId }, { query: { enabled: !!schoolId, queryKey: ['subjects', schoolId] } });
  const teachers = useListEmployees({ schoolId }, { query: { enabled: !!schoolId, queryKey: ['teachers', schoolId] } });

  return { activeSession, activeTerm, classes: classes.data ?? [], subjects: subjects.data ?? [], teachers: teachers.data ?? [], isLoading: sessions.isLoading || terms.isLoading || classes.isLoading || subjects.isLoading || teachers.isLoading };
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
          {activeTab === 'manage' && canViewSchoolSchedule && <ManageTimetableView schoolId={schoolId} canEdit={canManage} />}
           {activeTab === 'mine' && isTeacherOrStudent && <MyScheduleView schoolId={schoolId} isStudent={isStudent} />}
        </>
      )}
    </div>
  );
}

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

function ManageTimetableView({ schoolId, canEdit }: { schoolId: number; canEdit: boolean }) {
  const { activeSession, activeTerm, classes, subjects, teachers, isLoading } = useAcademicContext(schoolId);
  const [classId, setClassId] = useState<number | ''>('');
  
  const query = useListAcademicTimetable(
    { schoolId, sessionId: activeSession?.id, termId: activeTerm?.id, classId: classId || undefined }, 
    { query: { enabled: !!(schoolId && activeSession?.id && activeTerm?.id && classId), queryKey: getListAcademicTimetableQueryKey({ schoolId, sessionId: activeSession?.id, termId: activeTerm?.id, classId: classId || undefined }) } }
  );
  
  const [modal, setModal] = useState<any>(null);
  const qc = useQueryClient();

  if (isLoading) return <SkeletonPage />;

  const entries = query.data ?? [];

  return (
    <div className="space-y-6">
      <div className="panel p-5 flex items-center gap-4 bg-[hsl(var(--card))] border border-[hsl(var(--border))]">
        <div className="w-full max-w-sm">
          <Field label="Filter by Class">
            <select value={classId} onChange={e => setClassId(e.target.value ? Number(e.target.value) : '')} className="w-full">
              <option value="">Choose a class...</option>
              {classes.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
        {classId && canEdit && (
          <div className="ml-auto mt-4">
             <Button onClick={() => setModal({ create: true, classId: Number(classId) })}><Plus size={16}/> Add Entry</Button>
          </div>
        )}
      </div>

      {classId ? query.isLoading ? (
        <div className="p-8 text-center text-[hsl(var(--muted-foreground))]">Loading timetable...</div>
      ) : entries.length > 0 ? (
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
                      {canEdit && <button onClick={() => setModal(item)} className="absolute top-4 right-4 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 bg-[hsl(var(--card))] border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-all"><Pencil size={12} /></button>}
                      <div className="flex items-center gap-2 text-xs font-medium text-[hsl(var(--primary))] mb-1.5">
                        <Clock size={12} /> {item.startTime} — {item.endTime}
                      </div>
                      <div className="font-bold">{subjects.find((s: any) => s.id === item.subjectId)?.name || 'Subject'}</div>
                      <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1">Teacher: {teachers.find((t: any) => t.id === item.teacherId)?.firstName} {teachers.find((t: any) => t.id === item.teacherId)?.lastName}</div>
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
        <Modal title={modal.create ? "Add Timetable Entry" : "Edit Timetable Entry"} onClose={() => setModal(null)}>
          <TimetableEntryForm 
            schoolId={schoolId} sessionId={activeSession?.id} termId={activeTerm?.id}
            classes={classes} subjects={subjects} teachers={teachers} initial={modal.create ? null : modal}
            defaultClassId={modal.classId}
            onDone={() => { setModal(null); qc.invalidateQueries({ queryKey: getListAcademicTimetableQueryKey() }); }}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
    </div>
  );
}

function TimetableEntryForm({ schoolId, sessionId, termId, classes, subjects, teachers, initial, defaultClassId, onDone, onCancel }: any) {
  const create = useCreateAcademicTimetableEntry();
  const update = useUpdateAcademicTimetableEntry();
  const [form, setForm] = useState({
    classId: initial?.classId || defaultClassId || '',
    subjectId: initial?.subjectId || '',
    teacherId: initial?.teacherId || '',
    weekday: initial?.weekday || 'MONDAY',
    startTime: initial?.startTime || '08:00',
    endTime: initial?.endTime || '09:00',
    room: initial?.room || ''
  });

  const save = (e: FormEvent) => {
    e.preventDefault();
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
    if (initial) {
      update.mutate({ entryId: initial.id, data }, { onSuccess: onDone });
    } else {
      create.mutate({ data }, { onSuccess: onDone });
    }
  };

  const pending = create.isPending || update.isPending;

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Class">
          <select required value={form.classId} onChange={e => setForm({...form, classId: e.target.value})} className="w-full">
            <option value="">Select class...</option>
            {classes.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
      <Field label="Subject">
        <select required value={form.subjectId} onChange={e => setForm({...form, subjectId: e.target.value})} className="w-full">
          <option value="">Select subject...</option>
          {subjects.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>
      <Field label="Teacher">
        <select required value={form.teacherId} onChange={e => setForm({...form, teacherId: e.target.value})} className="w-full">
          <option value="">Select teacher</option>
          {teachers.map((t: any) => <option key={t.id} value={t.id}>{t.firstName} {t.lastName}</option>)}
        </select>
      </Field>
      <Field label="Room (Optional)">
        <input value={form.room} onChange={e => setForm({...form, room: e.target.value})} placeholder="e.g. Rm 102" className="w-full" />
      </Field>
      <div className="flex justify-end gap-3 pt-4 border-t border-[hsl(var(--border))]">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? 'Saving...' : 'Save'}</Button>
      </div>
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
