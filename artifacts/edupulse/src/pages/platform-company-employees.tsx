import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BriefcaseBusiness, Pencil, Plus, ShieldCheck } from 'lucide-react';
import {
  getListDeviceActivationOfficersQueryKey,
  useGrantDeviceActivationOfficer,
  useListDeviceActivationOfficers,
  useRevokeDeviceActivationOfficer,
} from '@workspace/api-client-react';
import {
  Button, EmptyState, ErrorState, Field, Modal, PageHeading, SkeletonPage, StatusPill
} from '@/components/shared';

type CompanyEmployee = {
  id: number;
  fullName: string;
  email: string;
  phone: string | null;
  jobTitle: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
};

type EmployeeProfileInput = {
  fullName: string;
  email: string;
  phone?: string;
  jobTitle?: string;
  status?: 'ACTIVE' | 'INACTIVE';
};

type EmployeeFormValues = {
  fullName: string;
  email: string;
  phone: string;
  jobTitle: string;
  status: 'ACTIVE' | 'INACTIVE';
};

type OwnerSchool = { id: number; name: string; status: string };

const endpoint = '/api/platform/company-employees';
const queryKey = ['platform', 'company-employees'];

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (typeof body?.error === 'string') message = body.error;
    } catch {
      // Preserve the HTTP error when the response body is not JSON.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export function PlatformCompanyEmployeesPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<CompanyEmployee | null>(null);
  const [creating, setCreating] = useState(false);
  const [selectedEmployeeEmail, setSelectedEmployeeEmail] = useState('');
  const [selectedSchoolId, setSelectedSchoolId] = useState('');
  const employeesQuery = useQuery({
    queryKey,
    queryFn: () => request<CompanyEmployee[]>(endpoint),
  });
  const schoolsQuery = useQuery({
    queryKey: ['platform-school-directory', 'all'],
    queryFn: async () => {
      const directory = await request<{ schools: OwnerSchool[] }>('/api/platform/schools/directory?status=all');
      return directory.schools.filter((school) => school.status.toUpperCase() === 'ACTIVE');
    },
  });
  const selectedSchoolNumber = Number(selectedSchoolId);
  const grantsQuery = useListDeviceActivationOfficers(
    selectedSchoolNumber,
    { email: selectedEmployeeEmail },
    {
      query: {
        enabled: Boolean(selectedSchoolId && selectedEmployeeEmail),
        queryKey: getListDeviceActivationOfficersQueryKey(selectedSchoolNumber, { email: selectedEmployeeEmail }),
      },
    },
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const refreshGrants = () => queryClient.invalidateQueries({
    queryKey: getListDeviceActivationOfficersQueryKey(selectedSchoolNumber),
  });
  const createEmployee = useMutation({
    mutationFn: (input: EmployeeProfileInput) => request<CompanyEmployee>(endpoint, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    onSuccess: async () => {
      setCreating(false);
      await refresh();
    },
  });
  const updateEmployee = useMutation({
    mutationFn: ({ id, input }: { id: number; input: Partial<EmployeeProfileInput> }) =>
      request<CompanyEmployee>(`${endpoint}/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: async () => {
      setEditing(null);
      await refresh();
    },
  });
  const grantActivationAccess = useGrantDeviceActivationOfficer({ mutation: { onSuccess: refreshGrants } });
  const revokeActivationAccess = useRevokeDeviceActivationOfficer({ mutation: { onSuccess: refreshGrants } });
  const activeError = createEmployee.error || updateEmployee.error;
  const activeEmployees = employeesQuery.data?.filter((employee) => employee.status === 'ACTIVE') ?? [];
  const canManageActivation = Boolean(selectedEmployeeEmail && selectedSchoolId);
  const activeGrantExists = grantsQuery.data?.some((grant) => grant.status === 'ACTIVE') ?? false;
  const activationError = grantActivationAccess.error || revokeActivationAccess.error || grantsQuery.error || schoolsQuery.error;

  return (
    <div className="fade-up">
      <PageHeading
        eyebrow="Platform / Yemait Technologies"
        title="Company Employees."
        description="Maintain basic profiles for the Yemait Technologies team. These profiles are separate from school staff and do not create sign-in accounts."
        action={
          <Button onClick={() => { createEmployee.reset(); setCreating(true); }} testId="button-add-company-employee">
            <Plus size={16} />Add employee
          </Button>
        }
      />

      <section className="panel mb-6 p-5 sm:p-6" aria-labelledby="activation-access-heading">
        <div className="mb-4 flex items-start gap-3">
          <div className="rounded-xl bg-[hsl(var(--primary)/.1)] p-2 text-[hsl(var(--primary))]"><ShieldCheck size={20} /></div>
          <div>
            <h2 id="activation-access-heading" className="font-bold">Device activation access</h2>
            <p className="mt-1 max-w-3xl text-sm text-[hsl(var(--muted-foreground))]">
              Grant an active company employee access to activate NFC cards at a selected school. The employee must sign in once to create an app account; this does not invite them or send email.
            </p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Active company employee">
            <select
              value={selectedEmployeeEmail}
              onChange={(event) => { setSelectedEmployeeEmail(event.target.value); grantActivationAccess.reset(); revokeActivationAccess.reset(); }}
              data-testid="select-activation-employee"
            >
              <option value="">Choose an employee</option>
              {activeEmployees.map((employee) => (
                <option key={employee.id} value={employee.email}>{employee.fullName} — {employee.email}</option>
              ))}
            </select>
          </Field>
          <Field label="School">
            <select
              value={selectedSchoolId}
              onChange={(event) => { setSelectedSchoolId(event.target.value); grantActivationAccess.reset(); revokeActivationAccess.reset(); }}
              data-testid="select-activation-school"
            >
              <option value="">Choose an active school</option>
              {(schoolsQuery.data ?? []).map((school) => (
                <option key={school.id} value={school.id}>{school.name}</option>
              ))}
            </select>
          </Field>
          <Button
            disabled={!canManageActivation || activeGrantExists || grantActivationAccess.isPending || grantsQuery.isPending}
            onClick={() => grantActivationAccess.mutate({
              schoolId: selectedSchoolNumber,
              data: { email: selectedEmployeeEmail },
            })}
            testId="button-grant-activation-access"
          >
            <ShieldCheck size={15} />{grantActivationAccess.isPending ? 'Granting…' : activeGrantExists ? 'Access already active' : 'Grant access'}
          </Button>
        </div>
        {schoolsQuery.isError && (
          <p role="alert" className="mt-4 text-sm text-[hsl(var(--destructive))]">{errorMessage(schoolsQuery.error)}</p>
        )}
        {activationError && !schoolsQuery.isError && (
          <p role="alert" className="mt-4 text-sm text-[hsl(var(--destructive))]">{errorMessage(activationError)}</p>
        )}
        {canManageActivation && (
          <div className="mt-5 border-t border-[hsl(var(--border))] pt-4" aria-live="polite">
            <h3 className="mb-3 text-sm font-bold">Current access</h3>
            {grantsQuery.isPending ? (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">Checking current access…</p>
            ) : grantsQuery.isError ? null : grantsQuery.data?.length ? (
              <div className="space-y-2">
                {grantsQuery.data.map((grant) => (
                  <div key={grant.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[hsl(var(--muted)/.35)] px-4 py-3" data-testid={`activation-grant-${grant.id}`}>
                    <div>
                      <div className="text-sm font-semibold">{grant.fullName || selectedEmployeeEmail}</div>
                      <div className="text-xs text-[hsl(var(--muted-foreground))]">{grant.email} · {grant.status === 'ACTIVE' ? 'Access active' : 'Access revoked'}</div>
                    </div>
                    {grant.status === 'ACTIVE' && (
                      <Button
                        variant="outline"
                        disabled={revokeActivationAccess.isPending}
                        onClick={() => revokeActivationAccess.mutate({ schoolId: selectedSchoolNumber, userId: grant.userId })}
                        testId={`button-revoke-activation-access-${grant.userId}`}
                      >
                        Revoke access
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                No access grant for this employee at this school. If they have not signed in before, ask them to sign in once so their app account can be matched; no invitation or email is sent here.
              </p>
            )}
          </div>
        )}
      </section>

      {activeError && !creating && !editing && (
        <p role="alert" className="mb-5 rounded-xl border border-[hsl(var(--destructive)/.25)] bg-[hsl(var(--destructive)/.08)] p-4 text-sm text-[hsl(var(--destructive))]">
          {errorMessage(activeError)}
        </p>
      )}

      {employeesQuery.isPending ? (
        <SkeletonPage />
      ) : employeesQuery.isError ? (
        <ErrorState retry={() => employeesQuery.refetch()} message={errorMessage(employeesQuery.error)} />
      ) : employeesQuery.data.length === 0 ? (
        <EmptyState
          icon={BriefcaseBusiness}
          title="No company profiles yet"
          description="Add a Yemait Technologies employee profile to start the internal directory."
          action={<Button onClick={() => { createEmployee.reset(); setCreating(true); }}><Plus size={16} />Add employee</Button>}
        />
      ) : (
        <div className="panel overflow-hidden">
          <div className="hidden grid-cols-[1.5fr_1.2fr_1fr_1fr_auto] gap-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-6 py-4 text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] md:grid">
            <span>Employee</span>
            <span>Contact</span>
            <span>Job title</span>
            <span>Status</span>
            <span>Actions</span>
          </div>
          <div className="divide-y divide-[hsl(var(--border)/.6)]">
            {employeesQuery.data.map((employee) => (
              <div key={employee.id} className="grid gap-3 p-5 transition-colors hover:bg-[hsl(var(--muted)/.2)] md:grid-cols-[1.5fr_1.2fr_1fr_1fr_auto] md:items-center md:gap-4 md:px-6">
                <div className="min-w-0">
                  <div className="font-bold">{employee.fullName}</div>
                  <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Yemait Technologies</div>
                </div>
                <div className="min-w-0 text-sm">
                  <div className="truncate">{employee.email}</div>
                  <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{employee.phone || 'No phone provided'}</div>
                </div>
                <div className="text-sm text-[hsl(var(--muted-foreground))]">{employee.jobTitle || '—'}</div>
                <div><StatusPill value={employee.status} /></div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => { updateEmployee.reset(); setEditing(employee); }}
                    title={`Edit ${employee.fullName}`}
                    testId={`button-edit-company-employee-${employee.id}`}
                  >
                    <Pencil size={14} />Edit
                  </Button>
                  <Button
                    variant="quiet"
                    disabled={updateEmployee.isPending}
                    onClick={() => updateEmployee.mutate({
                      id: employee.id,
                      input: { status: employee.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' },
                    })}
                    title={employee.status === 'ACTIVE' ? 'Deactivate profile' : 'Activate profile'}
                  >
                    {employee.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(creating || editing) && (
        <Modal
          title={creating ? 'Add company employee' : 'Edit company employee'}
          eyebrow="Yemait Technologies"
          onClose={() => {
            setCreating(false);
            setEditing(null);
            createEmployee.reset();
            updateEmployee.reset();
          }}
        >
          <CompanyEmployeeForm
            key={creating ? 'create' : editing?.id}
            initial={editing ?? undefined}
            pending={creating ? createEmployee.isPending : updateEmployee.isPending}
            error={creating ? createEmployee.error : updateEmployee.error}
            onCancel={() => { setCreating(false); setEditing(null); }}
            onSubmit={(values) => {
              if (editing) updateEmployee.mutate({ id: editing.id, input: values });
              else createEmployee.mutate(values);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function CompanyEmployeeForm({
  initial,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: CompanyEmployee;
  pending: boolean;
  error: unknown;
  onSubmit: (values: EmployeeProfileInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<EmployeeFormValues>({
    fullName: initial?.fullName ?? '',
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    jobTitle: initial?.jobTitle ?? '',
    status: initial?.status ?? 'ACTIVE',
  });

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit({
      fullName: form.fullName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || undefined,
      jobTitle: form.jobTitle.trim() || undefined,
      ...(initial ? { status: form.status } : {}),
    });
  };

  return (
    <form onSubmit={save} className="space-y-5">
      <Field label="Full name">
        <input
          required
          minLength={2}
          maxLength={160}
          autoComplete="name"
          value={form.fullName}
          onChange={(event) => setForm({ ...form, fullName: event.target.value })}
          placeholder="Employee name"
        />
      </Field>
      <Field label="Work email">
        <input
          required
          type="email"
          maxLength={254}
          autoComplete="email"
          value={form.email}
          onChange={(event) => setForm({ ...form, email: event.target.value })}
          placeholder="name@yemait.com"
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Phone">
          <input
            type="tel"
            maxLength={160}
            autoComplete="tel"
            value={form.phone}
            onChange={(event) => setForm({ ...form, phone: event.target.value })}
            placeholder="Optional"
          />
        </Field>
        <Field label="Job title">
          <input
            maxLength={160}
            value={form.jobTitle}
            onChange={(event) => setForm({ ...form, jobTitle: event.target.value })}
            placeholder="Optional"
          />
        </Field>
      </div>
      {initial && (
        <Field label="Profile status">
          <select
            value={form.status}
            onChange={(event) => setForm({ ...form, status: event.target.value as EmployeeFormValues['status'] })}
          >
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </Field>
      )}
      {Boolean(error) && (
        <p role="alert" className="rounded-xl border border-[hsl(var(--destructive)/.25)] bg-[hsl(var(--destructive)/.08)] p-3 text-sm text-[hsl(var(--destructive))]">
          {errorMessage(error)}
        </p>
      )}
      <div className="flex justify-end gap-3 border-t border-[hsl(var(--border))] pt-5">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : initial ? 'Save changes' : 'Create profile'}
        </Button>
      </div>
    </form>
  );
}