import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Briefcase, Plus, Search, Pencil } from 'lucide-react';
import { 
  useListEmployees, useCreateEmployee, useUpdateEmployee, getListEmployeesQueryKey 
} from '@workspace/api-client-react';
import { 
  PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, 
  Modal, Field, TenantPicker, useTenant, cx, date
} from '@/components/shared';

export function EmployeesPage() {
  const { schoolId, setSchoolId } = useTenant();
  const [search, setSearch] = useState(''); 
  const [status, setStatus] = useState('ACTIVE'); 
  const [modal, setModal] = useState<any>(null); 
  const qc = useQueryClient();
  
  const query = useListEmployees({ schoolId, search: search || undefined, status: status as any }, { query: { enabled: !!schoolId, queryKey: getListEmployeesQueryKey({ schoolId, search: search || undefined, status: status as any }) } }); 
  const employees: any[] = query.data ?? [];
  
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
            <Button onClick={() => setModal({ create: true })} disabled={!schoolId} testId="button-add-employee">
              <Plus size={16} />Add employee
            </Button>
          </div>
        } 
      />
      
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
                    {emp.firstName} {emp.lastName}
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
                <Button variant="quiet" onClick={() => setModal(emp)} testId={`button-edit-employee-${emp.id}`}>
                  <Pencil size={15} />Edit
                </Button>
              </div>
            )) : (
              <EmptyState 
                icon={Briefcase} 
                title="No employees found" 
                description="Try adjusting your filters or hire a new employee." 
                action={<Button onClick={() => setModal({ create: true })}><Plus size={15} />Add employee</Button>} 
              />
            )}
          </div>
          
          {modal && (
            <Modal title={modal.create ? 'Hire new employee' : 'Edit employee profile'} eyebrow="HR Records" onClose={() => setModal(null)}>
              <EmployeeForm schoolId={schoolId} initial={modal.create ? undefined : modal} onDone={done} onCancel={() => setModal(null)} />
            </Modal>
          )}
        </>
      )}
    </div>
  );
}

function EmployeeForm({ schoolId, initial, onDone, onCancel }: { schoolId: number; initial?: any; onDone: () => void; onCancel: () => void }) {
  const create = useCreateEmployee(); 
  const update = useUpdateEmployee(); 
  
  const [form, setForm] = useState({ 
    employeeId: initial?.employeeId ?? '', 
    firstName: initial?.firstName ?? '', 
    lastName: initial?.lastName ?? '', 
    type: initial?.type ?? 'TEACHER', 
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    department: initial?.department ?? '',
    qualification: initial?.qualification ?? '',
    status: initial?.status ?? 'ACTIVE'
  });
  
  const save = (e: FormEvent) => { 
    e.preventDefault(); 
    if (initial) {
      update.mutate({ employeeId: initial.id, params: { schoolId }, data: form as any }, { onSuccess: onDone }); 
    } else {
      create.mutate({ params: { schoolId }, data: form as any }, { onSuccess: onDone }); 
    }
  };
  
  const pending = create.isPending || update.isPending;

  return (
    <form onSubmit={save} className="space-y-5">
      {!initial && (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Employee ID">
            <input required minLength={2} value={form.employeeId} onChange={e => setForm({ ...form, employeeId: e.target.value })} placeholder="e.g. EMP-1042" className="font-mono" />
          </Field>
          <Field label="Employee Type">
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
              <option value="TEACHER">Teacher</option>
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
          <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="RESIGNED">Resigned</option>
            <option value="TERMINATED">Terminated</option>
          </select>
        </Field>
      )}

      <div className="flex justify-end gap-3 pt-5 border-t border-[hsl(var(--border))]">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : initial ? 'Save changes' : 'Add employee'}</Button>
      </div>
      {(create.isError || update.isError) && <p className="text-sm font-medium text-[hsl(var(--destructive))]">Could not save this record. Check the fields and try again.</p>}
    </form>
  );
}