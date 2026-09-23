import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, Plus, Search } from 'lucide-react';
import { 
  useListStudentClassAssignments, useAssignStudentClass, getListStudentClassAssignmentsQueryKey,
  useListTeacherClassAssignments, useAssignTeacherClass, getListTeacherClassAssignmentsQueryKey
} from '@workspace/api-client-react';
import { 
  PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, 
  Modal, Field, TenantPicker, useTenant, cx
} from '@/components/shared';

export function AssignmentsPage() {
  const { schoolId, setSchoolId } = useTenant();
  const [tab, setTab] = useState<'students' | 'teachers'>('teachers');
  const [modal, setModal] = useState<any>(null); 
  const [searchStudentId, setSearchStudentId] = useState<string>('');
  const qc = useQueryClient();
  
  const studentId = parseInt(searchStudentId);
  const studentQuery = useListStudentClassAssignments(studentId, { schoolId }, { query: { enabled: !!schoolId && tab === 'students' && !isNaN(studentId) && studentId > 0, queryKey: getListStudentClassAssignmentsQueryKey(studentId, { schoolId }) } }); 
  const teacherQuery = useListTeacherClassAssignments({ schoolId }, { query: { enabled: !!schoolId && tab === 'teachers', queryKey: getListTeacherClassAssignmentsQueryKey({ schoolId }) } }); 
  
  const students: any[] = studentQuery.data ?? [];
  const teachers: any[] = teacherQuery.data ?? [];
  
  const isLoading = tab === 'students' ? studentQuery.isLoading : teacherQuery.isLoading;
  const isError = tab === 'students' ? studentQuery.isError : teacherQuery.isError;
  const refetch = tab === 'students' ? studentQuery.refetch : teacherQuery.refetch;

  const done = () => { 
    setModal(null); 
    if (tab === 'students' && !isNaN(studentId)) {
      qc.invalidateQueries({ queryKey: getListStudentClassAssignmentsQueryKey(studentId, { schoolId }) }); 
    } else {
      qc.invalidateQueries({ queryKey: getListTeacherClassAssignmentsQueryKey({ schoolId }) }); 
    }
  };
  
  return (
    <div className="fade-up">
      <PageHeading 
        eyebrow="Structure / Assignments" 
        title="Class Assignments." 
        description="Map students and teachers to classes and sections for the academic term." 
        action={
          <div className="flex items-center gap-3">
            <TenantPicker />
            <Button onClick={() => setModal({ create: true })} disabled={!schoolId}>
              <Plus size={16} />{tab === 'students' ? 'Assign Student' : 'Assign Teacher'}
            </Button>
          </div>
        } 
      />
      
      {!schoolId ? (
        <EmptyState 
          icon={BookOpen} 
          title="Select a school context" 
          description="You must select a school to manage class assignments." 
        />
      ) : (
        <>
          <div className="mb-6 flex gap-2 border-b border-[hsl(var(--border))]">
            <button 
              onClick={() => setTab('teachers')}
              className={cx("px-4 py-3 text-sm font-bold border-b-2 transition-all", tab === 'teachers' ? "border-[hsl(var(--primary))] text-[hsl(var(--primary))]" : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]")}
            >
              Teacher Mapping
            </button>
            <button 
              onClick={() => setTab('students')}
              className={cx("px-4 py-3 text-sm font-bold border-b-2 transition-all", tab === 'students' ? "border-[hsl(var(--primary))] text-[hsl(var(--primary))]" : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]")}
            >
              Student History
            </button>
          </div>

          {tab === 'students' && (
            <div className="panel mb-6 p-4 flex items-center">
              <label className="relative flex-1 max-w-sm">
                <Search className="absolute left-4 top-3 text-[hsl(var(--muted-foreground))]" size={18} />
                <input 
                  type="number"
                  min="1"
                  className="pl-11" 
                  value={searchStudentId} 
                  onChange={e => setSearchStudentId(e.target.value)} 
                  placeholder="Enter Student ID to view history..." 
                />
              </label>
            </div>
          )}

          {isLoading ? (
            <SkeletonPage />
          ) : isError ? (
            <ErrorState retry={() => refetch()} />
          ) : tab === 'students' ? (
            <div className="panel overflow-hidden">
              <div className="hidden grid-cols-[1.5fr_1fr_1fr_1fr_auto] gap-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-6 py-4 text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] md:grid">
                <span>Student</span>
                <span>Class & Section</span>
                <span>Session</span>
                <span>Status</span>
                <span />
              </div>
              {students.length ? students.map((assign: any) => (
                <div key={assign.id} className="grid gap-3 border-b border-[hsl(var(--border)/.6)] px-5 py-5 transition-colors hover:bg-[hsl(var(--muted)/.2)] last:border-0 md:grid-cols-[1.5fr_1fr_1fr_1fr_auto] md:items-center md:gap-4 md:px-6">
                  <div className="font-bold text-sm text-[hsl(var(--foreground))]">Student ID: {assign.studentId}</div>
                  <div>
                    <div className="font-bold text-sm">{assign.className || `Class ${assign.classId}`}</div>
                    <div className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">Section {assign.section}</div>
                  </div>
                  <div className="text-sm font-medium">Session ID: {assign.sessionId}</div>
                  <div><StatusPill value={assign.status} /></div>
                  <div />
                </div>
              )) : (
                <EmptyState icon={BookOpen} title={!searchStudentId ? "Enter a Student ID" : "No assignments found"} description={!searchStudentId ? "Provide a student ID above to view their class history." : "This student has no class assignments."} />
              )}
            </div>
          ) : (
            <div className="panel overflow-hidden">
              <div className="hidden grid-cols-[1.5fr_1fr_1fr_1fr_auto] gap-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-6 py-4 text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] md:grid">
                <span>Teacher</span>
                <span>Role</span>
                <span>Class & Section</span>
                <span>Status</span>
                <span />
              </div>
              {teachers.length ? teachers.map((assign: any) => (
                <div key={assign.id} className="grid gap-3 border-b border-[hsl(var(--border)/.6)] px-5 py-5 transition-colors hover:bg-[hsl(var(--muted)/.2)] last:border-0 md:grid-cols-[1.5fr_1fr_1fr_1fr_auto] md:items-center md:gap-4 md:px-6">
                  <div className="font-bold text-sm text-[hsl(var(--foreground))]">Teacher ID: {assign.teacherId}</div>
                  <div className="text-sm font-bold text-[hsl(var(--primary))] dark:text-[hsl(var(--accent))] uppercase tracking-wider">{assign.assignmentType.replace('_', ' ')}</div>
                  <div>
                    <div className="font-bold text-sm">{assign.className || `Class ${assign.classId}`}</div>
                    <div className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">Section {assign.section}</div>
                  </div>
                  <div><StatusPill value={assign.status} /></div>
                  <div />
                </div>
              )) : (
                <EmptyState icon={BookOpen} title="No teacher assignments" description="Teachers have not been mapped to classes yet." />
              )}
            </div>
          )}

          {modal && (
            <Modal title={tab === 'students' ? 'Assign Student' : 'Assign Teacher'} eyebrow="Class Mapping" onClose={() => setModal(null)}>
              {tab === 'students' ? (
                <StudentAssignForm schoolId={schoolId} onDone={done} onCancel={() => setModal(null)} />
              ) : (
                <TeacherAssignForm schoolId={schoolId} onDone={done} onCancel={() => setModal(null)} />
              )}
            </Modal>
          )}
        </>
      )}
    </div>
  );
}

function StudentAssignForm({ schoolId, onDone, onCancel }: { schoolId: number; onDone: () => void; onCancel: () => void }) {
  const assign = useAssignStudentClass();
  const [form, setForm] = useState({ studentId: '', sessionId: '', termId: '', classId: '', section: '' });

  const save = (e: FormEvent) => {
    e.preventDefault();
    assign.mutate({ studentId: Number(form.studentId), params: { schoolId }, data: { 
      sessionId: Number(form.sessionId), 
      termId: form.termId ? Number(form.termId) : undefined, 
      classId: Number(form.classId), 
      section: form.section 
    } as any }, { onSuccess: onDone });
  };

  return (
    <form onSubmit={save} className="space-y-5">
      <Field label="Student ID">
        <input required type="number" min={1} value={form.studentId} onChange={e => setForm({ ...form, studentId: e.target.value })} placeholder="Numeric ID" />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Session ID">
          <input required type="number" min={1} value={form.sessionId} onChange={e => setForm({ ...form, sessionId: e.target.value })} placeholder="Numeric Session ID" />
        </Field>
        <Field label="Term ID (Optional)">
          <input type="number" min={1} value={form.termId} onChange={e => setForm({ ...form, termId: e.target.value })} placeholder="Numeric Term ID" />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Class ID">
          <input required type="number" min={1} value={form.classId} onChange={e => setForm({ ...form, classId: e.target.value })} placeholder="Numeric Class ID" />
        </Field>
        <Field label="Section">
          <input required value={form.section} onChange={e => setForm({ ...form, section: e.target.value })} placeholder="e.g. A" />
        </Field>
      </div>
      <div className="flex justify-end gap-3 pt-5 border-t border-[hsl(var(--border))]">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={assign.isPending}>{assign.isPending ? 'Saving…' : 'Map student'}</Button>
      </div>
    </form>
  );
}

function TeacherAssignForm({ schoolId, onDone, onCancel }: { schoolId: number; onDone: () => void; onCancel: () => void }) {
  const assign = useAssignTeacherClass();
  const [form, setForm] = useState({ teacherId: '', sessionId: '', classId: '', section: '', assignmentType: 'CLASS_TEACHER', startDate: '' });

  const save = (e: FormEvent) => {
    e.preventDefault();
    assign.mutate({ params: { schoolId }, data: { 
      teacherId: Number(form.teacherId), 
      sessionId: Number(form.sessionId), 
      classId: Number(form.classId), 
      section: form.section,
      assignmentType: form.assignmentType as any,
      startDate: new Date(form.startDate).toISOString()
    } }, { onSuccess: onDone });
  };

  return (
    <form onSubmit={save} className="space-y-5">
      <Field label="Teacher ID (Employee ID)">
        <input required type="number" min={1} value={form.teacherId} onChange={e => setForm({ ...form, teacherId: e.target.value })} placeholder="Numeric ID" />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Session ID">
          <input required type="number" min={1} value={form.sessionId} onChange={e => setForm({ ...form, sessionId: e.target.value })} placeholder="Numeric Session ID" />
        </Field>
        <Field label="Role">
          <select value={form.assignmentType} onChange={e => setForm({ ...form, assignmentType: e.target.value })}>
            <option value="CLASS_TEACHER">Class Teacher</option>
            <option value="SUBJECT_TEACHER">Subject Teacher</option>
            <option value="ASSISTANT_TEACHER">Assistant Teacher</option>
          </select>
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Class ID">
          <input required type="number" min={1} value={form.classId} onChange={e => setForm({ ...form, classId: e.target.value })} placeholder="Numeric Class ID" />
        </Field>
        <Field label="Section">
          <input required value={form.section} onChange={e => setForm({ ...form, section: e.target.value })} placeholder="e.g. A" />
        </Field>
      </div>
      <Field label="Start Date">
        <input required type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} />
      </Field>
      <div className="flex justify-end gap-3 pt-5 border-t border-[hsl(var(--border))]">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={assign.isPending}>{assign.isPending ? 'Saving…' : 'Map teacher'}</Button>
      </div>
    </form>
  );
}