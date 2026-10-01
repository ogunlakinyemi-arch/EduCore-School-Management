import { useRef, useState, type FormEvent } from 'react';
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
  invitationStatus: {
    employeeId: number;
    email: string;
    status: 'ACTIVE' | 'PENDING' | 'EXPIRED' | 'NOT_INVITED';
    invitation: {
      email?: string;
      role?: string;
      status: string;
      deliveryConfirmed: boolean;
      invitationId?: string;
      expiresAt?: string;
      createdAt?: string | null;
    } | null;
  };
};

type EmployeeProfileInput = {
  fullName: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  role?: 'COMPANY_ACCOUNTANT' | 'DEVICE_ACTIVATION_OFFICER';
  schoolId?: number;
};

type EmployeeFormValues = {
  fullName: string;
  email: string;
  phone: string;
  jobTitle: string;
  status: 'ACTIVE' | 'INACTIVE';
  role: '' | 'COMPANY_ACCOUNTANT' | 'DEVICE_ACTIVATION_OFFICER';
  schoolId: string;
};

type OwnerSchool = { id: number; name: string; status: string };
type InvitationResult = {
  id: number;
  fullName: string;
  email: string;
  role: 'COMPANY_ACCOUNTANT' | 'DEVICE_ACTIVATION_OFFICER';
  invitation: { status: string; deliveryConfirmed: boolean; expiresAt: string };
};
type InvitationDetail = {
  employeeId: number;
  email: string;
  status: 'ACTIVE' | 'PENDING' | 'EXPIRED' | 'NOT_INVITED';
  invitation: {
    email?: string;
    role?: string;
    status: string;
    deliveryConfirmed: boolean;
    invitationId?: string;
    expiresAt?: string;
    createdAt?: string | null;
  } | null;
};
type ResentInvitation = {
  employeeId: number;
  email: string;
  role: 'COMPANY_ACCOUNTANT' | 'DEVICE_ACTIVATION_OFFICER';
  schoolId: number | null;
  invitation: {
    status: 'DISPATCH_REQUEST_ACCEPTED';
    deliveryConfirmed: false;
    invitationId: string;
    expiresAt: string;
  };
};

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

function formatRequestedAt(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

export function PlatformCompanyEmployeesPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<CompanyEmployee | null>(null);
  const [creating, setCreating] = useState(false);
  const [selectedEmployeeEmail, setSelectedEmployeeEmail] = useState('');
  const [selectedSchoolId, setSelectedSchoolId] = useState('');
  const [lastInvitation, setLastInvitation] = useState<InvitationResult | null>(null);
  const [invitationEditing, setInvitationEditing] = useState<CompanyEmployee | null>(null);
  const [invitationNotice, setInvitationNotice] = useState('');
  const [rowResendFeedback, setRowResendFeedback] = useState<Record<number, {
    kind: 'success' | 'error';
    message: string;
  }>>({});
  const resendingInvitationIdsRef = useRef(new Set<string>());
  const [resendingInvitationIds, setResendingInvitationIds] = useState<Set<string>>(() => new Set());
  const employeesQuery = useQuery({
    queryKey,
    queryFn: () => request<CompanyEmployee[]>(endpoint),
  });
  const invitationQuery = useQuery({
    queryKey: [...queryKey, invitationEditing?.id, 'invitation'],
    queryFn: () => request<InvitationDetail>(`${endpoint}/${invitationEditing!.id}/invitation`),
    enabled: Boolean(invitationEditing),
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
    mutationFn: (input: EmployeeProfileInput) => request<InvitationResult>(endpoint, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    onSuccess: async (result) => {
      setCreating(false);
      setLastInvitation(result);
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
  const editInvitation = useMutation({
    mutationFn: ({ id, email }: { id: number; email: string }) =>
      request<InvitationDetail>(`${endpoint}/${id}/invitation`, {
        method: 'PATCH',
        body: JSON.stringify({ email }),
      }),
    onMutate: () => setInvitationNotice(''),
    onSuccess: async (_, variables) => {
      setInvitationNotice('Invitation email updated.');
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: [...queryKey, variables.id, 'invitation'] }),
      ]);
    },
  });
  const resendInvitation = useMutation({
    mutationFn: ({ employeeId, invitationId }: { employeeId: number; invitationId: string }) =>
      request<ResentInvitation>(`${endpoint}/${employeeId}/invitation/resend`, {
        method: 'POST',
        body: JSON.stringify({ invitationId }),
      }),
    onMutate: ({ employeeId }) => {
      setInvitationNotice('');
      setRowResendFeedback((previous) => {
        const next = { ...previous };
        delete next[employeeId];
        return next;
      });
    },
    onSuccess: async (result) => {
      const message = `Clerk accepted the invitation request for ${result.email}. Dispatch and inbox delivery are not confirmed.`;
      setInvitationNotice(message);
      setRowResendFeedback((previous) => ({
        ...previous,
        [result.employeeId]: { kind: 'success', message },
      }));
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: [...queryKey, result.employeeId, 'invitation'] }),
      ]);
    },
    onError: (error, variables) => setRowResendFeedback((previous) => ({
      ...previous,
      [variables.employeeId]: { kind: 'error', message: errorMessage(error) },
    })),
  });
  const grantActivationAccess = useGrantDeviceActivationOfficer({ mutation: { onSuccess: refreshGrants } });
  const revokeActivationAccess = useRevokeDeviceActivationOfficer({ mutation: { onSuccess: refreshGrants } });
  const activeError = createEmployee.error || updateEmployee.error;
  const activeEmployees = employeesQuery.data?.filter((employee) => employee.status === 'ACTIVE') ?? [];
  const canManageActivation = Boolean(selectedEmployeeEmail && selectedSchoolId);
  const activeGrantExists = grantsQuery.data?.some((grant) => grant.status === 'ACTIVE') ?? false;
  const activationError = grantActivationAccess.error || revokeActivationAccess.error || grantsQuery.error || schoolsQuery.error;
  const requestInvitationResend = (employeeId: number, invitationId: string) => {
    const key = `${employeeId}:${invitationId}`;
    if (resendingInvitationIdsRef.current.has(key)) return;
    resendingInvitationIdsRef.current.add(key);
    setResendingInvitationIds(new Set(resendingInvitationIdsRef.current));
    void resendInvitation.mutateAsync({ employeeId, invitationId })
      .finally(() => {
        resendingInvitationIdsRef.current.delete(key);
        setResendingInvitationIds(new Set(resendingInvitationIdsRef.current));
      })
      .catch(() => undefined);
  };

  return (
    <div className="fade-up">
      <PageHeading
        eyebrow="Platform / Yemait Technologies"
        title="Company Employees."
        description="Invite internal Yemait Technologies employees into one restricted role. Company finance and school-scoped device activation are separate from school staff access."
        action={
          <Button onClick={() => { createEmployee.reset(); setCreating(true); }} testId="button-add-company-employee">
            <Plus size={16} />Add employee
          </Button>
        }
      />

      {lastInvitation && (
        <p className="mb-5 rounded-xl border border-[hsl(var(--primary)/.25)] bg-[hsl(var(--primary)/.06)] p-4 text-sm" role="status">
          Clerk accepted the {lastInvitation.role.replaceAll('_', ' ').toLowerCase()} invitation request for {lastInvitation.email} with notifications enabled
          (expires {new Date(lastInvitation.invitation.expiresAt).toLocaleDateString()}). Email dispatch and inbox delivery are not independently confirmed.
        </p>
      )}

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
          <div className="hidden grid-cols-[1.5fr_1.2fr_1fr_1fr_1fr_auto] gap-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-6 py-4 text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] md:grid">
            <span>Employee</span>
            <span>Contact</span>
            <span>Job title</span>
            <span>Profile status</span>
            <span>Invitation status</span>
            <span>Actions</span>
          </div>
          <div className="divide-y divide-[hsl(var(--border)/.6)]">
            {employeesQuery.data.map((employee) => (
              <div key={employee.id} className="grid gap-3 p-5 transition-colors hover:bg-[hsl(var(--muted)/.2)] md:grid-cols-[1.5fr_1.2fr_1fr_1fr_1fr_auto] md:items-center md:gap-4 md:px-6">
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
                <div className="space-y-1">
                  <StatusPill value={employee.invitationStatus.status} />
                  {employee.invitationStatus.invitation?.role && (
                    <div className="text-xs text-[hsl(var(--muted-foreground))]">
                      Role: {employee.invitationStatus.invitation.role.replaceAll('_', ' ')}
                    </div>
                  )}
                  {employee.invitationStatus.invitation?.email && (
                    <div className="break-all text-xs text-[hsl(var(--muted-foreground))]">
                      Invitation email: {employee.invitationStatus.invitation.email}
                    </div>
                  )}
                  {formatRequestedAt(employee.invitationStatus.invitation?.createdAt) && (
                    <div className="text-xs text-[hsl(var(--muted-foreground))]">
                      Requested {formatRequestedAt(employee.invitationStatus.invitation?.createdAt)}
                    </div>
                  )}
                  {employee.invitationStatus.invitation?.expiresAt && (
                    <div className="text-xs text-[hsl(var(--muted-foreground))]">
                      Expires {new Date(employee.invitationStatus.invitation.expiresAt).toLocaleDateString()}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => { updateEmployee.reset(); setEditing(employee); }}
                    title={`Edit ${employee.fullName}`}
                    testId={`button-edit-company-employee-${employee.id}`}
                  >
                    <Pencil size={14} />Edit
                  </Button>
                  {(['PENDING', 'EXPIRED'].includes(employee.invitationStatus.status) &&
                    typeof employee.invitationStatus.invitation?.invitationId === 'string' &&
                    employee.invitationStatus.invitation.invitationId.trim().length > 0) && (
                    <Button
                      variant="outline"
                      disabled={resendingInvitationIds.has(`${employee.id}:${employee.invitationStatus.invitation.invitationId}`)}
                      onClick={() => requestInvitationResend(
                        employee.id,
                        employee.invitationStatus.invitation!.invitationId!,
                      )}
                      title={`Resend invitation to ${employee.invitationStatus.invitation.email ?? employee.invitationStatus.email}`}
                      testId={`button-resend-invitation-row-${employee.id}`}
                    >
                      {resendingInvitationIds.has(`${employee.id}:${employee.invitationStatus.invitation.invitationId}`)
                        ? 'Requesting…'
                        : 'Resend Link'}
                    </Button>
                  )}
                  {(['PENDING', 'EXPIRED'].includes(employee.invitationStatus.status)) && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        editInvitation.reset();
                        resendInvitation.reset();
                        setInvitationNotice('');
                        setInvitationEditing(employee);
                      }}
                      title={`Edit or resend invitation for ${employee.fullName}`}
                      testId={`button-edit-invitation-${employee.id}`}
                    >
                      Edit invitation
                    </Button>
                  )}
                  {rowResendFeedback[employee.id] && (
                    <p
                      role={rowResendFeedback[employee.id].kind === 'success' ? 'status' : 'alert'}
                      className={`basis-full text-xs ${rowResendFeedback[employee.id].kind === 'error' ? 'text-[hsl(var(--destructive))]' : 'text-[hsl(var(--primary))]'}`}
                    >
                      {rowResendFeedback[employee.id].message}
                    </p>
                  )}
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
            schools={schoolsQuery.data ?? []}
            onCancel={() => { setCreating(false); setEditing(null); }}
            onSubmit={(values) => {
              if (editing) updateEmployee.mutate({ id: editing.id, input: values });
              else createEmployee.mutate(values);
            }}
          />
        </Modal>
      )}
      {invitationEditing && (
        <Modal
          title="Manage employee invitation"
          eyebrow="Invitation email"
          onClose={() => {
            setInvitationEditing(null);
            setInvitationNotice('');
            editInvitation.reset();
            resendInvitation.reset();
          }}
        >
          {invitationQuery.isPending ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">Loading invitation…</p>
          ) : invitationQuery.isError ? (
            <div className="space-y-4">
              <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{errorMessage(invitationQuery.error)}</p>
              <Button variant="outline" onClick={() => invitationQuery.refetch()}>Retry</Button>
            </div>
          ) : invitationQuery.data.status === 'PENDING' || invitationQuery.data.status === 'EXPIRED' ? (
            <InvitationEditor
              key={`${invitationEditing.id}-${invitationQuery.data.email}`}
              employee={invitationEditing}
              invitation={invitationQuery.data}
              emailPending={editInvitation.isPending}
              resendPending={resendingInvitationIds.has(`${invitationEditing.id}:${invitationQuery.data.invitation?.invitationId ?? ''}`)}
              error={editInvitation.error || resendInvitation.error}
              notice={invitationNotice}
              onEmailChange={() => {
                setInvitationNotice('');
                editInvitation.reset();
                resendInvitation.reset();
              }}
              onSave={(email) => editInvitation.mutate({ id: invitationEditing.id, email })}
              onResend={() => {
                const invitationId = invitationQuery.data?.invitation?.invitationId;
                if (typeof invitationId === 'string' && invitationId.trim()) {
                  requestInvitationResend(invitationEditing.id, invitationId);
                }
              }}
            />
          ) : (
            <p role="status" className="text-sm">
              This invitation is {invitationQuery.data.status.toLowerCase()}. Email editing and resend are available only for pending or expired invitations.
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}

function CompanyEmployeeForm({
  initial,
  pending,
  error,
  schools,
  onSubmit,
  onCancel,
}: {
  initial?: CompanyEmployee;
  pending: boolean;
  error: unknown;
  schools: OwnerSchool[];
  onSubmit: (values: EmployeeProfileInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<EmployeeFormValues>({
    fullName: initial?.fullName ?? '',
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    jobTitle: initial?.jobTitle ?? '',
    status: initial?.status ?? 'ACTIVE',
    role: '',
    schoolId: '',
  });

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit({
      fullName: form.fullName.trim(),
      ...(!initial ? { email: form.email.trim() } : {}),
      phone: form.phone.trim() || undefined,
      jobTitle: form.jobTitle.trim() || undefined,
      ...(initial ? { status: form.status } : {
        ...(form.role ? { role: form.role } : {}),
        ...(form.role === 'DEVICE_ACTIVATION_OFFICER' ? { schoolId: Number(form.schoolId) } : {}),
      }),
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
          readOnly={Boolean(initial)}
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
      {!initial && (
        <>
          <Field label="Restricted employee role">
            <select
              required
              value={form.role}
              onChange={(event) => setForm({
                ...form,
                role: event.target.value as EmployeeFormValues['role'],
                schoolId: '',
              })}
              data-testid="select-company-employee-role"
            >
              <option value="" disabled>Choose an employee role</option>
              <option value="COMPANY_ACCOUNTANT">Company Accountant — company financial views only</option>
              <option value="DEVICE_ACTIVATION_OFFICER">Device Activation Officer — selected school only</option>
            </select>
          </Field>
          {form.role === 'DEVICE_ACTIVATION_OFFICER' && (
            <Field label="Authorized school">
              <select
                required
                value={form.schoolId}
                onChange={(event) => setForm({ ...form, schoolId: event.target.value })}
                data-testid="select-company-employee-authorized-school"
              >
                <option value="">Choose an active school</option>
                {schools.map((school) => (
                  <option key={school.id} value={school.id}>{school.name}</option>
                ))}
              </select>
            </Field>
          )}
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            The invitation request asks Clerk to send an email. The app reports Clerk request acceptance, not confirmed dispatch or inbox delivery.
            Employees are not added as school STAFF or OWNER accounts.
          </p>
        </>
      )}
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

function InvitationEditor({
  employee,
  invitation,
  emailPending,
  resendPending,
  error,
  notice,
  onEmailChange,
  onSave,
  onResend,
}: {
  employee: CompanyEmployee;
  invitation: InvitationDetail;
  emailPending: boolean;
  resendPending: boolean;
  error: unknown;
  notice: string;
  onEmailChange: () => void;
  onSave: (email: string) => void;
  onResend: () => void;
}) {
  const [email, setEmail] = useState(invitation.email);
  const invitationId = invitation.invitation?.invitationId;
  const hasInvitationId = typeof invitationId === 'string' && invitationId.trim().length > 0;

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave(email.trim());
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="font-semibold">{employee.fullName}</p>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
          Invitation status: {invitation.status}. Profile status is managed separately.
        </p>
        {invitation.invitation?.role && (
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
            Role: {invitation.invitation.role.replaceAll('_', ' ')}
          </p>
        )}
        {formatRequestedAt(invitation.invitation?.createdAt) && (
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
            Requested {formatRequestedAt(invitation.invitation?.createdAt)}
          </p>
        )}
        {hasInvitationId && (
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
            Invitation ID: <span data-testid={`invitation-id-${employee.id}`}>{invitationId}</span>
          </p>
        )}
      </div>
      <form onSubmit={save} className="space-y-4">
        <Field label="Invitation email">
          <input
            required
            type="email"
            maxLength={254}
            autoComplete="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              onEmailChange();
            }}
            data-testid={`input-invitation-email-${employee.id}`}
          />
        </Field>
        <Button type="submit" disabled={emailPending || resendPending}>
          {emailPending ? 'Updating…' : 'Update invitation email'}
        </Button>
      </form>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">
        Resending requests a replacement invitation for this employee’s existing role and school assignment. Request acceptance is not confirmation of dispatch or inbox delivery.
      </p>
      {!hasInvitationId && (
        <p role="status" className="text-sm text-[hsl(var(--muted-foreground))]">
          Invitation ID is unavailable. Refresh invitation status before attempting a resend.
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-3 border-t border-[hsl(var(--border))] pt-4">
        <Button
          type="button"
          variant="outline"
          disabled={emailPending || resendPending || !hasInvitationId}
          onClick={onResend}
          testId={`button-resend-invitation-${employee.id}`}
        >
          {resendPending ? 'Requesting…' : 'Resend Link'}
        </Button>
      </div>
      {notice && <p role="status" className="text-sm text-[hsl(var(--primary))]">{notice}</p>}
      {Boolean(error) && (
        <p role="alert" className="rounded-xl border border-[hsl(var(--destructive)/.25)] bg-[hsl(var(--destructive)/.08)] p-3 text-sm text-[hsl(var(--destructive))]">
          {errorMessage(error)}
        </p>
      )}
    </div>
  );
}