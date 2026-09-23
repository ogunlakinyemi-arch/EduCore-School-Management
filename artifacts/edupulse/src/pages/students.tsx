import { useState, type FormEvent } from 'react';
import { useLocation, Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { 
  GraduationCap, Plus, Search, Pencil, ArrowLeft, UsersRound, Calendar, 
  MapPin, Phone 
} from 'lucide-react';
import { 
  useListStudents, useCreateStudent, useUpdateStudent, 
  getListStudentsQueryKey 
} from '@workspace/api-client-react';
import { 
  PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, 
  Modal, Field, Info, TenantPicker, useTenant, cx, date
} from '@/components/shared';

export function StudentsPage() {
  const { schoolId, setSchoolId } = useTenant();
  const [search, setSearch] = useState(''); 
  const [status, setStatus] = useState('active'); 
  const [modal, setModal] = useState<any>(null); 
  const qc = useQueryClient();
  
  const query = useListStudents({ schoolId, search: search || undefined, status: status as any }, { query: { enabled: !!schoolId, queryKey: getListStudentsQueryKey({ schoolId, search: search || undefined, status: status as any }) } }); 
  const students: any[] = query.data ?? [];
  
  const done = () => { 
    setModal(null); 
    qc.invalidateQueries({ queryKey: getListStudentsQueryKey() }); 
  };
  
  return (
    <div className="fade-up">
      <PageHeading 
        eyebrow="Directory / Students" 
        title="Student Directory." 
        description="Search, filter, and manage all student records within the selected tenant context." 
        action={
          <div className="flex items-center gap-3">
            <TenantPicker />
            <Button onClick={() => setModal({ create: true })} disabled={!schoolId} testId="button-add-student">
              <Plus size={16} />Add student
            </Button>
          </div>
        } 
      />
      
      {!schoolId ? (
        <EmptyState 
          icon={GraduationCap} 
          title="Select a school context" 
          description="You must select a school to view or manage its students." 
        />
      ) : query.isLoading ? (
        <SkeletonPage />
      ) : query.isError ? (
        <ErrorState retry={() => query.refetch()} />
      ) : (
        <>
          <div className="panel mb-6 flex flex-col gap-4 p-4 md:flex-row">
            <label className="relative flex-1">
              <Search className="absolute left-4 top-3 text-[hsl(var(--muted-foreground))]" size={18} />
              <input 
                className="pl-11" 
                value={search} 
                onChange={e => setSearch(e.target.value)} 
                placeholder="Search by name, admission number, or class..." 
                data-testid="input-search-students" 
              />
            </label>
            <div className="flex gap-2 overflow-auto pb-1 md:pb-0">
              {['ACTIVE', 'INACTIVE', 'GRADUATED', 'TRANSFERRED'].map(item => (
                <button 
                  key={item} 
                  onClick={() => setStatus(item)} 
                  className={cx(
                    'whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-bold capitalize transition-all', 
                    status === item
                      ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-md' 
                      : 'bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] hover:bg-[hsl(var(--muted))]'
                  )} 
                  data-testid={`filter-student-${item.toLowerCase()}`}
                >
                  {item.toLowerCase()}
                </button>
              ))}
            </div>
          </div>
          
          <div className="panel overflow-hidden">
            <div className="hidden grid-cols-[1.5fr_1fr_1fr_1fr_auto] gap-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-6 py-4 text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] md:grid">
              <span>Student</span>
              <span>Class</span>
              <span>Parent/Guardian</span>
              <span>Status</span>
              <span />
            </div>
            {students.length ? students.map((student: any) => (
              <div key={student.id} className="grid gap-3 border-b border-[hsl(var(--border)/.6)] px-5 py-5 transition-colors hover:bg-[hsl(var(--muted)/.2)] last:border-0 md:grid-cols-[1.5fr_1fr_1fr_1fr_auto] md:items-center md:gap-4 md:px-6">
                <div>
                  <div className="font-bold text-sm text-[hsl(var(--foreground))]">
                    {student.firstName} {student.lastName}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                    <span className="font-mono bg-[hsl(var(--secondary))] px-1.5 py-0.5 rounded text-[10px]">{student.admissionNo}</span>
                    <span>{date(student.joinedAt)}</span>
                  </div>
                </div>
                <div>
                  <div className="text-sm font-bold">{student.className}</div>
                  <div className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1">{student.section}</div>
                </div>
                <div>
                  <div className="text-sm font-medium">{student.parentName || '—'}</div>
                  {student.parentPhone && <div className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1">{student.parentPhone}</div>}
                </div>
                <div>
                  <StatusPill value={student.status} />
                  <div className="mt-1"><StatusPill value={student.subscriptionStatus} /></div>
                </div>
                <Button variant="quiet" onClick={() => setModal(student)} testId={`button-edit-student-${student.id}`}>
                  <Pencil size={15} />Edit
                </Button>
              </div>
            )) : (
              <EmptyState 
                icon={GraduationCap} 
                title="No students found" 
                description="Try adjusting your filters or add a new student to this school." 
                action={<Button onClick={() => setModal({ create: true })} testId="button-empty-add-student"><Plus size={15} />Add student</Button>} 
              />
            )}
          </div>
          
          {modal && (
            <Modal title={modal.create ? 'Admit new student' : 'Edit student profile'} eyebrow="Student Records" onClose={() => setModal(null)}>
              <StudentForm schoolId={schoolId} initial={modal.create ? undefined : modal} onDone={done} onCancel={() => setModal(null)} />
            </Modal>
          )}
        </>
      )}
    </div>
  );
}

function StudentForm({ schoolId, initial, onDone, onCancel }: { schoolId: number; initial?: any; onDone: () => void; onCancel: () => void }) {
  const create = useCreateStudent(); 
  const update = useUpdateStudent(); 
  
  const [form, setForm] = useState({ 
    admissionNo: initial?.admissionNo ?? '', 
    firstName: initial?.firstName ?? '', 
    lastName: initial?.lastName ?? '', 
    gender: initial?.gender ?? 'female', 
    className: initial?.className ?? '', 
    section: initial?.section ?? '', 
    parentName: initial?.parentName ?? '', 
    parentPhone: initial?.parentPhone ?? '', 
    status: initial?.status ?? 'ACTIVE' 
  });
  
  const save = (e: FormEvent) => { 
    e.preventDefault(); 
    if (initial) {
      update.mutate({ studentId: initial.id, params: { schoolId }, data: { firstName: form.firstName, lastName: form.lastName, className: form.className, section: form.section, status: form.status as any } }, { onSuccess: onDone }); 
    } else {
      create.mutate({ params: { schoolId }, data: form as any }, { onSuccess: onDone }); 
    }
  };
  
  const pending = create.isPending || update.isPending;

  return (
    <form onSubmit={save} className="space-y-5">
      {!initial && (
        <Field label="Admission Number">
          <input required minLength={2} value={form.admissionNo} onChange={e => setForm({ ...form, admissionNo: e.target.value })} placeholder="e.g. ADM/2024/001" className="font-mono" />
        </Field>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="First Name">
          <input required minLength={2} value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} placeholder="First name" />
        </Field>
        <Field label="Last Name">
          <input required minLength={2} value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} placeholder="Last name" />
        </Field>
      </div>
      
      {!initial && (
        <Field label="Gender">
          <select value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })}>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
          </select>
        </Field>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Class">
          <input required value={form.className} onChange={e => setForm({ ...form, className: e.target.value })} placeholder="e.g. Year 1" />
        </Field>
        <Field label="Section">
          <input required value={form.section} onChange={e => setForm({ ...form, section: e.target.value })} placeholder="e.g. A" />
        </Field>
      </div>

      {!initial && (
        <div className="grid gap-5 sm:grid-cols-2 pt-4 border-t border-[hsl(var(--border))]">
          <Field label="Parent/Guardian Name">
            <input value={form.parentName} onChange={e => setForm({ ...form, parentName: e.target.value })} placeholder="Full name" />
          </Field>
          <Field label="Parent Phone">
            <input value={form.parentPhone} onChange={e => setForm({ ...form, parentPhone: e.target.value })} placeholder="Phone number" />
          </Field>
        </div>
      )}

      {initial && (
        <Field label="Enrollment Status">
          <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="GRADUATED">Graduated</option>
            <option value="TRANSFERRED">Transferred</option>
            <option value="WITHDRAWN">Withdrawn</option>
          </select>
        </Field>
      )}

      <div className="flex justify-end gap-3 pt-5 border-t border-[hsl(var(--border))]">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : initial ? 'Save changes' : 'Admit student'}</Button>
      </div>
      {(create.isError || update.isError) && <p className="text-sm font-medium text-[hsl(var(--destructive))]">Could not save this record. Check the fields and try again.</p>}
    </form>
  );
}