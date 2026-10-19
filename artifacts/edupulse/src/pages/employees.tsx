import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Briefcase, Plus, Search, Pencil } from 'lucide-react';
import { DirectoryExport } from '@/components/directory-export';
import { EmployeePhotoField } from '@/components/employee-photo-field';
import { personPhotoSource } from '@/lib/person-photo-source';
import { 
  useListEmployees, useCreateEmployee, useUpdateEmployee, useUpdateEmployeeStatus, getListEmployeesQueryKey
} from '@workspace/api-client-react';
import { 
  PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, 
  Modal, Field, TenantPicker, useTenant, cx, date, useSchoolAdminAccess
} from '@/components/shared';

export function EmployeesPage() {
  const { schoolId, setSchoolId } = useTenant();
  const { canManageSchool } = useSchoolAdminAccess();
  const [search, setSearch] = useState(''); 
  const [status, setStatus] = useState('ACTIVE'); 
  const [modal, setModal] = useState<any>(null);
  const [statusEmployee, setStatusEmployee] = useState<any>(null);
  const [photoEmployee, setPhotoEmployee] = useState<any>(null);
  const [photoMissing, setPhotoMissing] = useState(() => new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).get('photo') === 'missing');
  const qc = useQueryClient();
  useEffect(() => { setModal(null); setStatusEmployee(null); setPhotoEmployee(null); }, [schoolId]);
  
  const params = { schoolId, search: search || undefined, status: photoMissing ? undefined : status as any };
  const query = useListEmployees(params, { query: { enabled: !!schoolId, queryKey: getListEmployeesQueryKey(params) } });
  const employees: any[] = (query.data ?? []).filter(emp => !photoMissing || !personPhotoSource('employee', schoolId, emp.id, emp.photoUrl));
  const refreshPhotos = () => {
    void qc.invalidateQueries({ predicate: q => /employees|employee-nfc|cards/.test(String(q.queryKey[0])) });
  };
  
  const done = () => { 
    setModal(null); 
    qc.invalidateQueries({ queryKey: getListEmployeesQueryKey() }); 
  };
  
  return (
    <div className="fade-up">
      <PageHeading 
        eyebrow="Directory / Employees" 
        title="Teachers & Staff." 
        description="Manage institutional staff records, roles, and employment status." 
        action={
          <div className="flex items-center gap-3">
            <TenantPicker />
            {canManageSchool && <Button onClick={() => setModal({ create: true })} disabled={!schoolId} testId="button-add-employee">
              <Plus size={16} />Add employee
            </Button>}
          </div>
        } 
      />
      
      <div className="mb-4 grid gap-2">
        <DirectoryExport key={`staff-${schoolId}`} kind="staff" />
        <DirectoryExport key={`teachers-${schoolId}`} kind="teachers" />
      </div>
      <label className="mb-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={photoMissing} onChange={e => setPhotoMissing(e.target.checked)} />Photo missing / needs private upload (all statuses)</label>
      {!schoolId ? (
        <EmptyState 
          icon={Briefcase} 
          title="Select a school context" 
          description="You must select a school to view or manage its employees." 
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
                placeholder="Search by name, ID or department..." 
              />
            </label>
            <div className="flex gap-2 overflow-auto pb-1 md:pb-0">
              {['ACTIVE', 'INACTIVE', 'SUSPENDED', 'RESIGNED', 'TERMINATED'].map(item => (
                <button 
                  key={item} 
                  onClick={() => setStatus(item)} 
                  className={cx(
                    'whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-bold capitalize transition-all', 
                    status === item
                      ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-md' 
                      : 'bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] hover:bg-[hsl(var(--muted))]'
                  )} 
                >
                  {item.toLowerCase()}
                </button>
              ))}
            </div>
          </div>
          
          <div className="panel overflow-hidden">
            <div className="hidden grid-cols-[1.5fr_1fr_1.5fr_1fr_auto] gap-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-6 py-4 text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] md:grid">
              <span>Employee</span>
              <span>Role</span>
              <span>Contact</span>
              <span>Status</span>
              <span />
            </div>
            {employees.length ? employees.map((emp: any) => (
              <div key={emp.id} className="grid gap-3 border-b border-[hsl(var(--border)/.6)] px-5 py-5 transition-colors hover:bg-[hsl(var(--muted)/.2)] last:border-0 md:grid-cols-[1.5fr_1fr_1.5fr_1fr_auto] md:items-center md:gap-4 md:px-6">
                <div>
                  <div className="font-bold text-sm text-[hsl(var(--foreground))]">
                    {[emp.firstName, emp.lastName].filter(Boolean).join(' ')}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                    <span className="font-mono bg-[hsl(var(--secondary))] px-1.5 py-0.5 rounded text-[10px]">{emp.employeeId}</span>
                    <span>{emp.department || 'No department'}</span>
                  </div>
                </div>
                <div>
                  <div className="text-sm font-bold uppercase tracking-wider text-[hsl(var(--primary))] dark:text-[hsl(var(--accent))]">{emp.type}</div>
                </div>
                <div>
                  <div className="text-sm font-medium">{emp.email || 'No email'}</div>
                  {emp.phone && <div className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1 font-mono">{emp.phone}</div>}
                </div>
                <div>
                  <StatusPill value={emp.status} />
                </div>
                {canManageSchool && <div className="flex flex-wrap gap-2"><Button variant="quiet" onClick={() => setModal(emp)} testId={`button-edit-employee-${emp.id}`}>
                  <Pencil size={15} />Edit
                </Button>
                  <Button variant="quiet" onClick={() => setPhotoEmployee(emp)} testId={`button-employee-photo-${emp.id}`}>Passport photo</Button>
                  {['ACTIVE', 'INACTIVE'].includes(emp.status) && <Button variant="outline" onClick={() => setStatusEmployee(emp)} testId={`button-status-employee-${emp.id}`}>
                    {emp.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                  </Button>}
                </div>}
              </div>
            )) : (
              <EmptyState 
                icon={Briefcase} 
                title="No employees found" 
                description="Try adjusting your filters or hire a new employee." 
                action={canManageSchool ? <Button onClick={() => setModal({ create: true })}><Plus size={15} />Add employee</Button> : undefined}
              />
            )}
          </div>
          
          {statusEmployee && canManageSchool && (
            <Modal viewport title={statusEmployee.status === 'ACTIVE' ? 'Deactivate employee' : 'Reactivate employee'} eyebrow="Employment access" onClose={() => setStatusEmployee(null)}>
              <EmployeeStatusConfirmation key={`${schoolId}-${statusEmployee.id}`} schoolId={schoolId} employee={statusEmployee} onCancel={() => setStatusEmployee(null)} onDone={() => { setStatusEmployee(null); done(); }} />
            </Modal>
          )}
          {photoEmployee && canManageSchool && <Modal viewport title={`Passport photo — ${photoEmployee.firstName} ${photoEmployee.lastName}`} eyebrow="Employee record" onClose={() => setPhotoEmployee(null)}>
            <EmployeePhotoField key={`${schoolId}-${photoEmployee.id}`} schoolId={schoolId} employeeId={photoEmployee.id} photoUrl={photoEmployee.photoUrl} onUpdated={refreshPhotos} />
          </Modal>}
          {modal && (
            <Modal viewport title={modal.create ? 'Hire new employee' : 'Edit employee profile'} eyebrow="HR Records" onClose={() => setModal(null)}>
              <EmployeeForm key={`${schoolId}-${modal.id ?? 'new'}`} schoolId={schoolId} initial={modal.create ? undefined : modal} onDone={done} onCancel={() => setModal(null)} />
            </Modal>
          )}
        </>
      )}
    </div>
  );
}

export function EmployeeStatusConfirmation({ schoolId, employee, onDone, onCancel }: { schoolId: number; employee: any; onDone: () => void; onCancel: () => void }) {
  const mutation = useUpdateEmployeeStatus();
  const deactivate = employee.status === 'ACTIVE';
  return <div className="space-y-5">
    <p>{deactivate ? 'Deactivate' : 'Reactivate'} <strong>{employee.firstName} {employee.lastName}</strong>?</p>
    <p className="text-sm">{deactivate
      ? 'Their matching Teacher/Staff access to this school will be denied on subsequent requests. Historical records, parent access and other-school roles are preserved.'
      : 'Their existing matching Teacher/Staff membership can regain access to this school. No new membership is created.'}</p>
    {mutation.isError && <p role="alert">Could not change employment status. Please retry.</p>}
    <div className="flex justify-end gap-3">
      <Button variant="outline" disabled={mutation.isPending} onClick={onCancel}>Cancel</Button>
      <Button disabled={mutation.isPending} onClick={() => mutation.mutate({ employeeId: employee.id, params: { schoolId }, data: { status: deactivate ? 'INACTIVE' : 'ACTIVE' } }, { onSuccess: onDone })}>
        {mutation.isPending ? 'Saving…' : deactivate ? 'Confirm deactivation' : 'Confirm reactivation'}
      </Button>
    </div>
  </div>;
}

export function EmployeeForm({ schoolId, initial, onDone, onCancel }: { schoolId: number; initial?: any; onDone: () => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const create = useCreateEmployee(); 
  const update = useUpdateEmployee(); 
  
  const [form, setForm] = useState({ 
    firstName: initial?.firstName ?? '', 
    lastName: initial?.lastName ?? '', 
    type: initial?.type ?? 'TEACHER', 
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    department: initial?.department ?? '',
    qualification: initial?.qualification ?? ''
  });
  
  const save = (e: FormEvent) => { 
    e.preventDefault(); 
    if (initial) {
      update.mutate({ employeeId: initial.id, params: { schoolId }, data: { ...form, email: form.email || undefined } }, { onSuccess: onDone });
    } else {
      create.mutate({ params: { schoolId }, data: { ...form, type: form.type as 'TEACHER' | 'STAFF' | 'ACCOUNTANT' | 'CLEANER' | 'ASSISTANT' | 'DRIVER', email: form.email || undefined } }, { onSuccess: onDone });
    }
  };
  
  const pending = create.isPending || update.isPending;

  return (
    <form onSubmit={save} className="space-y-5">
      {initial && <EmployeePhotoField schoolId={schoolId} employeeId={initial.id} photoUrl={initial.photoUrl} onUpdated={() => { void qc.invalidateQueries({ predicate: q => /employees|employee-nfc|cards/.test(String(q.queryKey[0])) }); }} />}
      {!initial && (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Employee number">
            <p className="py-3 text-sm">Generated automatically and permanent.</p>
          </Field>
          <Field label="Employee Type">
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
              <option value="TEACHER">Teacher</option>
              <option value="ACCOUNTANT">Accountant</option>
              <option value="CLEANER">Cleaner</option>
              <option value="ASSISTANT">Assistant</option>
              <option value="DRIVER">Driver</option>
              <option value="STAFF">General Staff</option>
            </select>
          </Field>
        </div>
      )}
      
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="First Name">
          <input required minLength={2} value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} placeholder="First name" />
        </Field>
        <Field label="Last Name">
          <input required minLength={2} value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} placeholder="Last name" />
        </Field>
      </div>
      
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Email Address">
          <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="Institutional email" />
        </Field>
        <Field label="Phone Number">
          <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Contact number" />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Department">
          <input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} placeholder="e.g. Science, Admin" />
        </Field>
        <Field label="Highest Qualification">
          <input value={form.qualification} onChange={e => setForm({ ...form, qualification: e.target.value })} placeholder="e.g. B.Sc, B.Ed" />
        </Field>
      </div>

      {initial && (
        <Field label="Employment Status">
          <p>{initial.status}. Use the directory's Deactivate or Reactivate action to change active employment access.</p>
        </Field>
      )}

      <div className="flex justify-end gap-3 pt-5 border-t border-[hsl(var(--border))]">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : initial ? 'Save changes' : 'Add employee'}</Button>
      </div>
      {(create.isError || update.isError) && <p role="alert" className="text-sm font-medium text-[hsl(var(--destructive))]">Could not save this record. Check the fields and try again.</p>}
    </form>
  );
}