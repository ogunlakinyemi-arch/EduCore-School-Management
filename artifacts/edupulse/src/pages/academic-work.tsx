import { useState, FormEvent, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, Modal, Field, TenantPicker, useTenant, cx, date, useSchoolAdminAccess } from '@/components/shared';
import { 
  useListAcademicAssignments, useCreateAcademicAssignment, useUpdateAcademicAssignment, getListAcademicAssignmentsQueryKey,
  useListAcademicAssessmentTypes, useCreateAcademicAssessmentType, getListAcademicAssessmentTypesQueryKey,
  useListAcademicAssessments, useCreateAcademicAssessment, useUpdateAcademicAssessment, getListAcademicAssessmentsQueryKey,
  useListAcademicSessions, useListAcademicTerms, useListClasses, useListSubjects
} from '@workspace/api-client-react';
import { Plus, Pencil, BookOpen, Layers } from 'lucide-react';

function useAcademicContext(schoolId: number) {
  const sessions = useListAcademicSessions({ schoolId }, { query: { enabled: !!schoolId, queryKey: ['sessions', schoolId] } });
  const activeSession = sessions.data?.find((s: any) => s.isCurrent) || sessions.data?.[0];
  const terms = useListAcademicTerms(activeSession?.id as number, { schoolId }, { query: { enabled: !!(schoolId && activeSession?.id), queryKey: ['terms', activeSession?.id, schoolId] } });
  const activeTerm = terms.data?.find((t: any) => t.isCurrent) || terms.data?.[0];
  const classes = useListClasses({ schoolId }, { query: { enabled: !!schoolId, queryKey: ['classes', schoolId] } });
  const subjects = useListSubjects({ schoolId }, { query: { enabled: !!schoolId, queryKey: ['subjects', schoolId] } });

  return { activeSession, activeTerm, classes: classes.data ?? [], subjects: subjects.data ?? [], isLoading: sessions.isLoading || terms.isLoading || classes.isLoading || subjects.isLoading };
}

export function AcademicWorkPage() {
  const { schoolId } = useTenant();
  const { isPlatformOwner, isSchoolAdmin } = useSchoolAdminAccess();
  const readOnly = isPlatformOwner;
  const [tab, setTab] = useState<'assignments' | 'assessments' | 'types'>('assignments');
  
  return (
    <div className="fade-up">
      <PageHeading 
        eyebrow="Academics" 
        title="Academic Work." 
        description={readOnly ? 'View school academic work. School Admins manage assignments and assessments.' : 'Manage assignments, assessments, and assessment types for your classes.'}
        action={<TenantPicker />} 
      />
      {!schoolId ? (
        <EmptyState icon={BookOpen} title="Select a school context" description="Select a school to view academic work." />
      ) : (
        <>
          <div className="mb-6 flex gap-2 border-b border-[hsl(var(--border))]">
            {[{id: 'assignments', label: 'Assignments'}, {id: 'assessments', label: 'Assessments'}, {id: 'types', label: 'Assessment Types'}].map(t => (
              <button 
                key={t.id} 
                onClick={() => setTab(t.id as any)} 
                className={cx("px-4 py-2.5 text-sm font-bold border-b-2 transition-colors", tab === t.id ? "border-[hsl(var(--primary))] text-[hsl(var(--foreground))]" : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]")}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === 'assignments' && <AssignmentsView schoolId={schoolId} readOnly={readOnly} />}
          {tab === 'assessments' && <AssessmentsView schoolId={schoolId} readOnly={readOnly || isSchoolAdmin} />}
          {tab === 'types' && <AssessmentTypesView schoolId={schoolId} readOnly={readOnly} />}
        </>
      )}
    </div>
  );
}

function AssignmentsView({ schoolId, readOnly }: { schoolId: number; readOnly: boolean }) {
  const { activeSession, activeTerm, classes, subjects, isLoading } = useAcademicContext(schoolId);
  const query = useListAcademicAssignments(
    { schoolId, sessionId: activeSession?.id, termId: activeTerm?.id }, 
    { query: { enabled: !!(schoolId && activeSession?.id && activeTerm?.id), queryKey: getListAcademicAssignmentsQueryKey({ schoolId, sessionId: activeSession?.id, termId: activeTerm?.id }) } }
  );
  
  const [modal, setModal] = useState<any>(null);
  const qc = useQueryClient();

  if (isLoading || query.isLoading) return <SkeletonPage />;
  if (query.isError) return <ErrorState retry={() => query.refetch()} />;

  const assignments = query.data ?? [];

  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-[hsl(var(--border))] px-6 py-5 flex items-center justify-between bg-[hsl(var(--muted)/.3)]">
        <div>
          <h3 className="display-font text-lg font-bold">Class Assignments</h3>
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">For {activeSession?.name} • {activeTerm?.name} Term</p>
        </div>
         {!readOnly && <Button onClick={() => setModal({ create: true })}><Plus size={16} />New Assignment</Button>}
      </div>
      
      {assignments.length > 0 ? (
        <div className="divide-y divide-[hsl(var(--border)/.6)]">
          {assignments.map((item: any) => (
            <div key={item.id} className="flex items-center justify-between p-5 hover:bg-[hsl(var(--muted)/.2)]">
              <div>
                <div className="font-bold">{item.title}</div>
                <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                  Class: {classes.find((c: any) => c.id === item.classId)?.name || item.classId} {item.section ? `(${item.section})` : ''} • 
                  Subject: {subjects.find((s: any) => s.id === item.subjectId)?.name || item.subjectId}
                </div>
                <div className="text-xs font-medium mt-1">Due: {date(item.dueDate)} • Max Score: {item.maxScore}</div>
              </div>
              <div className="flex items-center gap-4">
                <StatusPill value={item.status} />
                 {!readOnly && <button onClick={() => setModal(item)} className="p-2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"><Pencil size={15} /></button>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={BookOpen} title="No assignments found" description="Create assignments for your classes to get started." />
      )}

      {!readOnly && modal && (
        <Modal title={modal.create ? "Create Assignment" : "Edit Assignment"} onClose={() => setModal(null)}>
          <AssignmentForm 
            schoolId={schoolId} sessionId={activeSession?.id} termId={activeTerm?.id}
            classes={classes} subjects={subjects} initial={modal.create ? null : modal}
            onDone={() => { setModal(null); qc.invalidateQueries({ queryKey: getListAcademicAssignmentsQueryKey() }); }}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
    </div>
  );
}

function AssignmentForm({ schoolId, sessionId, termId, classes, subjects, initial, onDone, onCancel }: any) {
  const create = useCreateAcademicAssignment();
  const update = useUpdateAcademicAssignment();
  const [form, setForm] = useState({
    title: initial?.title || '',
    description: initial?.description || '',
    classId: initial?.classId || '',
    section: initial?.section || '',
    subjectId: initial?.subjectId || '',
    issueDate: initial?.issueDate ? new Date(initial.issueDate).toISOString().split('T')[0] : '',
    dueDate: initial?.dueDate ? new Date(initial.dueDate).toISOString().split('T')[0] : '',
    maxScore: initial?.maxScore || 100,
    status: initial?.status || 'DRAFT'
  });

  const save = (e: FormEvent) => {
    e.preventDefault();
    const data = {
      ...form,
      classId: Number(form.classId),
      subjectId: Number(form.subjectId),
      maxScore: Number(form.maxScore),
      issueDate: form.issueDate,
      dueDate: form.dueDate,
    };
    if (initial) {
      update.mutate({ assignmentId: initial.id, params: { schoolId }, data }, { onSuccess: onDone });
    } else {
      create.mutate({ params: { schoolId }, data: { ...data, sessionId: Number(sessionId), termId: Number(termId) } }, { onSuccess: onDone });
    }
  };

  const pending = create.isPending || update.isPending;

  return (
    <form onSubmit={save} className="space-y-4">
      <Field label="Assignment Title">
        <input required minLength={2} value={form.title} onChange={e => setForm({...form, title: e.target.value})} placeholder="e.g. Chapter 4 Exercises" className="w-full" />
      </Field>
      <Field label="Description">
        <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="w-full min-h-[80px]" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Class">
          <select required value={form.classId} onChange={e => setForm({...form, classId: e.target.value})} className="w-full">
            <option value="">Select class...</option>
            {classes.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Section (Optional)">
          <input value={form.section} onChange={e => setForm({...form, section: e.target.value})} placeholder="e.g. A" className="w-full" />
        </Field>
      </div>
      <Field label="Subject">
        <select required value={form.subjectId} onChange={e => setForm({...form, subjectId: e.target.value})} className="w-full">
          <option value="">Select subject...</option>
          {subjects.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Issue Date">
          <input type="date" required value={form.issueDate} onChange={e => setForm({...form, issueDate: e.target.value})} className="w-full" />
        </Field>
        <Field label="Due Date">
          <input type="date" required value={form.dueDate} onChange={e => setForm({...form, dueDate: e.target.value})} className="w-full" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Max Score">
          <input type="number" required min={1} value={form.maxScore} onChange={e => setForm({...form, maxScore: Number(e.target.value)})} className="w-full" />
        </Field>
        <Field label="Status">
          <select value={form.status} onChange={e => setForm({...form, status: e.target.value})} className="w-full">
            <option value="DRAFT">Draft</option>
            <option value="PUBLISHED">Published</option>
            <option value="CLOSED">Closed</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </Field>
      </div>
      <div className="flex justify-end gap-3 pt-4 border-t border-[hsl(var(--border))]">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? 'Saving...' : 'Save'}</Button>
      </div>
    </form>
  );
}

function AssessmentTypesView({ schoolId, readOnly }: { schoolId: number; readOnly: boolean }) {
  const query = useListAcademicAssessmentTypes({ schoolId }, { query: { enabled: !!schoolId, queryKey: getListAcademicAssessmentTypesQueryKey({ schoolId }) } });
  const [modal, setModal] = useState<any>(null);
  const qc = useQueryClient();

  if (query.isLoading) return <SkeletonPage />;
  if (query.isError) return <ErrorState retry={() => query.refetch()} />;

  const types = query.data ?? [];

  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-[hsl(var(--border))] px-6 py-5 flex items-center justify-between bg-[hsl(var(--muted)/.3)]">
        <div>
          <h3 className="display-font text-lg font-bold">Assessment Types</h3>
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">Configure assessment categories</p>
        </div>
        {!readOnly && <Button onClick={() => setModal({ create: true })}><Plus size={16} />New Type</Button>}
      </div>
      
      {types.length > 0 ? (
        <div className="divide-y divide-[hsl(var(--border)/.6)]">
          {types.map((item: any) => (
            <div key={item.id} className="flex items-center justify-between p-5 hover:bg-[hsl(var(--muted)/.2)]">
              <div>
                <div className="font-bold">{item.name}</div>
                <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1">{item.code}</div>
              </div>
              <StatusPill value={item.status} />
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={Layers} title="No assessment types" description="Create types like 'Mid-Term', 'Exam', 'Continuous Assessment'." />
      )}

      {!readOnly && modal && (
        <Modal title="Create Assessment Type" onClose={() => setModal(null)}>
          <AssessmentTypeForm 
            schoolId={schoolId} 
            onDone={() => { setModal(null); qc.invalidateQueries({ queryKey: getListAcademicAssessmentTypesQueryKey() }); }}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
    </div>
  );
}

function AssessmentTypeForm({ schoolId, onDone, onCancel }: any) {
  const create = useCreateAcademicAssessmentType();
  const [form, setForm] = useState({
    name: '',
    code: ''
  });

  const save = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ params: { schoolId }, data: { name: form.name, code: form.code.trim().toUpperCase() } }, { onSuccess: onDone });
  };

  const pending = create.isPending;

  return (
    <form onSubmit={save} className="space-y-4">
      <Field label="Type Name">
        <input required minLength={2} value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="e.g. Mid-Term Project" className="w-full" />
      </Field>
      <Field label="Code">
        <input required value={form.code} onChange={e => setForm({...form, code: e.target.value})} placeholder="e.g. MIDTERM" className="w-full" />
      </Field>
      <div className="flex justify-end gap-3 pt-4 border-t border-[hsl(var(--border))]">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? 'Saving...' : 'Create'}</Button>
      </div>
    </form>
  );
}

function AssessmentsView({ schoolId, readOnly }: { schoolId: number; readOnly: boolean }) {
  const { activeSession, activeTerm, classes, subjects, isLoading } = useAcademicContext(schoolId);
  const typesQuery = useListAcademicAssessmentTypes({ schoolId }, { query: { enabled: !!schoolId, queryKey: getListAcademicAssessmentTypesQueryKey({ schoolId }) } });
  
  const query = useListAcademicAssessments(
    { schoolId, sessionId: activeSession?.id, termId: activeTerm?.id }, 
    { query: { enabled: !!(schoolId && activeSession?.id && activeTerm?.id), queryKey: getListAcademicAssessmentsQueryKey({ schoolId, sessionId: activeSession?.id, termId: activeTerm?.id }) } }
  );
  
  const [modal, setModal] = useState<any>(null);
  const qc = useQueryClient();

  if (isLoading || query.isLoading || typesQuery.isLoading) return <SkeletonPage />;
  if (query.isError) return <ErrorState retry={() => query.refetch()} />;

  const assessments = query.data ?? [];
  const types = typesQuery.data ?? [];

  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-[hsl(var(--border))] px-6 py-5 flex items-center justify-between bg-[hsl(var(--muted)/.3)]">
        <div>
          <h3 className="display-font text-lg font-bold">Assessments</h3>
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">Formal assessments & examinations</p>
        </div>
        {!readOnly && <Button onClick={() => setModal({ create: true })}><Plus size={16} />New Assessment</Button>}
      </div>
      
      {assessments.length > 0 ? (
        <div className="divide-y divide-[hsl(var(--border)/.6)]">
          {assessments.map((item: any) => (
            <div key={item.id} className="flex items-center justify-between p-5 hover:bg-[hsl(var(--muted)/.2)]">
              <div>
                <div className="flex items-center gap-2">
                  <div className="font-bold">{item.title}</div>
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))] px-2 py-0.5 rounded">
                    {types.find((t: any) => t.id === item.assessmentTypeId)?.name || 'Unknown Type'}
                  </span>
                </div>
                <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1.5">
                  Class: {classes.find((c: any) => c.id === item.classId)?.name || item.classId} {item.section ? `(${item.section})` : ''} • 
                  Subject: {subjects.find((s: any) => s.id === item.subjectId)?.name || item.subjectId}
                </div>
                <div className="text-xs font-medium mt-1">Date: {date(item.date)} • Max Score: {item.maxScore}</div>
              </div>
              <div className="flex items-center gap-4">
                <StatusPill value={item.status} />
                 {!readOnly && <button onClick={() => setModal(item)} className="p-2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"><Pencil size={15} /></button>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={Layers} title="No formal assessments" description="Schedule exams and continuous assessments." />
      )}

      {!readOnly && modal && (
        <Modal title={modal.create ? "Create Assessment" : "Edit Assessment"} onClose={() => setModal(null)}>
          <AssessmentForm 
            schoolId={schoolId} sessionId={activeSession?.id} termId={activeTerm?.id}
            classes={classes} subjects={subjects} types={types} initial={modal.create ? null : modal}
            onDone={() => { setModal(null); qc.invalidateQueries({ queryKey: getListAcademicAssessmentsQueryKey() }); }}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
    </div>
  );
}

function AssessmentForm({ schoolId, sessionId, termId, classes, subjects, types, initial, onDone, onCancel }: any) {
  const create = useCreateAcademicAssessment();
  const update = useUpdateAcademicAssessment();
  const [form, setForm] = useState({
    title: initial?.title || '',
    assessmentTypeId: initial?.assessmentTypeId || '',
    classId: initial?.classId || '',
    section: initial?.section || '',
    subjectId: initial?.subjectId || '',
    date: initial?.date ? new Date(initial.date).toISOString().split('T')[0] : '',
    maxScore: initial?.maxScore || 100,
    status: initial?.status || 'DRAFT'
  });

  const save = (e: FormEvent) => {
    e.preventDefault();
    const data = {
      ...form,
      assessmentTypeId: Number(form.assessmentTypeId),
      classId: Number(form.classId),
      subjectId: Number(form.subjectId),
      maxScore: Number(form.maxScore),
      date: form.date,
    };
    if (initial) {
      update.mutate({ assessmentId: initial.id, params: { schoolId }, data }, { onSuccess: onDone });
    } else {
      create.mutate({ params: { schoolId }, data: { ...data, sessionId: Number(sessionId), termId: Number(termId) } }, { onSuccess: onDone });
    }
  };

  const pending = create.isPending || update.isPending;

  return (
    <form onSubmit={save} className="space-y-4">
      <Field label="Assessment Title">
        <input required minLength={2} value={form.title} onChange={e => setForm({...form, title: e.target.value})} placeholder="e.g. End of Term Exam" className="w-full" />
      </Field>
      <Field label="Assessment Type">
        <select required value={form.assessmentTypeId} onChange={e => setForm({...form, assessmentTypeId: e.target.value})} className="w-full">
          <option value="">Select type...</option>
          {types.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Class">
          <select required value={form.classId} onChange={e => setForm({...form, classId: e.target.value})} className="w-full">
            <option value="">Select class...</option>
            {classes.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Section (Optional)">
          <input value={form.section} onChange={e => setForm({...form, section: e.target.value})} placeholder="e.g. A" className="w-full" />
        </Field>
      </div>
      <Field label="Subject">
        <select required value={form.subjectId} onChange={e => setForm({...form, subjectId: e.target.value})} className="w-full">
          <option value="">Select subject...</option>
          {subjects.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Assessment Date">
          <input type="date" required value={form.date} onChange={e => setForm({...form, date: e.target.value})} className="w-full" />
        </Field>
        <Field label="Max Score">
          <input type="number" required min={1} value={form.maxScore} onChange={e => setForm({...form, maxScore: Number(e.target.value)})} className="w-full" />
        </Field>
      </div>
      <Field label="Status">
        <select value={form.status} onChange={e => setForm({...form, status: e.target.value})} className="w-full">
          <option value="DRAFT">Draft</option>
          <option value="OPEN">Open</option>
          <option value="CLOSED">Closed</option>
          <option value="PUBLISHED">Published</option>
          <option value="ARCHIVED">Archived</option>
        </select>
      </Field>
      <div className="flex justify-end gap-3 pt-4 border-t border-[hsl(var(--border))]">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? 'Saving...' : 'Save'}</Button>
      </div>
    </form>
  );
}
