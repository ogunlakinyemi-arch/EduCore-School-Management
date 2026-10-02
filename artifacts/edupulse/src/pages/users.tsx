import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserCog, Plus, ShieldCheck, UserPlus } from 'lucide-react';
import { 
  useListUsers, useListSchoolUsers, getListUsersQueryKey, getListSchoolUsersQueryKey,
  useGetAuthorizedContext, useListStudents, getListStudentsQueryKey
} from '@workspace/api-client-react';
import { 
  PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, 
  Modal, Field, TenantPicker, useTenant, cx, date
} from '@/components/shared';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useToast } from '@/hooks/use-toast';
import { SchoolUserInvitationManagement } from '@/components/school-user-invitation-management';

export function UsersPage() {
  const { schoolId, setSchoolId } = useTenant();
  const [modal, setModal] = useState<any>(null); 
  const contextQuery = useGetAuthorizedContext();
  const isPlatformOwner = !!contextQuery.data?.isPlatformOwner;
  const isSchoolAdmin = !!contextQuery.data?.roles?.some(
    (assignment: any) => assignment.schoolId === schoolId && assignment.role === 'SCHOOL_ADMIN'
  );
  
  const qc = useQueryClient();
  const { toast } = useToast();
  
  // If no school selected but user is platform owner, show platform users.
  // If school selected, show school users.
  const isViewingPlatform = !schoolId && isPlatformOwner;
  const isViewingSchool = !!schoolId;

  const platformQuery = useListUsers({ query: { enabled: isViewingPlatform, queryKey: getListUsersQueryKey() } });
  const schoolQuery = useListSchoolUsers({ schoolId }, { query: { enabled: isViewingSchool, queryKey: getListSchoolUsersQueryKey({ schoolId }) } });
  
  const users = isViewingSchool ? schoolQuery.data ?? [] : platformQuery.data ?? [];
  const isLoading = (isViewingPlatform && platformQuery.isLoading) || (isViewingSchool && schoolQuery.isLoading);
  const isError = (isViewingPlatform && platformQuery.isError) || (isViewingSchool && schoolQuery.isError);

  const done = () => { 
    setModal(null); 
    if (isViewingSchool) qc.invalidateQueries({ queryKey: getListSchoolUsersQueryKey() });
    if (isViewingPlatform) qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
  };
  
  return (
    <div className="fade-up">
      <PageHeading 
        eyebrow="Security / Users" 
        title="Identity & Access." 
        description="Manage role-based access for platform operators and school staff." 
        action={
          <div className="flex items-center gap-3">
            <TenantPicker />
            {isViewingSchool && (isPlatformOwner || isSchoolAdmin) && (
              <Button onClick={() => setModal({ invite: true })} variant="outline">
                <UserPlus size={16} />{isPlatformOwner ? 'Invite School Admin' : 'Invite User'}
              </Button>
            )}
            {isViewingPlatform && (
              <Button onClick={() => setModal({ createPlatform: true })}>
                <Plus size={16} />Assign Platform Owner
              </Button>
            )}
          </div>
        } 
      />
      
      {(!isPlatformOwner && !schoolId) ? (
        <EmptyState icon={UserCog} title="Select a school context" description="You must select a school to manage its users." />
      ) : isLoading ? (
        <SkeletonPage />
      ) : isError ? (
        <ErrorState retry={() => isViewingSchool ? schoolQuery.refetch() : platformQuery.refetch()} />
      ) : (
        <>
          {isViewingSchool && !isPlatformOwner && isSchoolAdmin && schoolId && (
            <SchoolUserInvitationManagement schoolId={schoolId} />
          )}
          <div className="mb-4 text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            {isViewingPlatform ? 'Platform-wide identities' : 'Tenant-scoped access'}
          </div>
          <div className="panel overflow-hidden">
            <div className="hidden grid-cols-[1.5fr_1.5fr_1fr_auto] gap-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-6 py-4 text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] md:grid">
              <span>User Identity</span>
              <span>Assigned Role</span>
              <span>Status</span>
              <span />
            </div>
            {users.length ? users.map((user: any) => (
              <div key={user.id} className="grid gap-3 border-b border-[hsl(var(--border)/.6)] px-5 py-5 transition-colors hover:bg-[hsl(var(--muted)/.2)] last:border-0 md:grid-cols-[1.5fr_1.5fr_1fr_auto] md:items-center md:gap-4 md:px-6">
                <div>
                  <div className="font-bold text-sm text-[hsl(var(--foreground))]">{user.firstName ? `${user.firstName} ${user.lastName}` : 'Anonymous User'}</div>
                  <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{user.email}</div>
                </div>
                <div>
                  {isViewingPlatform ? (
                    <div className="flex flex-wrap gap-1">
                      {user.memberships?.map((m: any) => (
                         <span key={m.id} className="bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))] dark:text-[hsl(var(--accent))] text-[10px] font-bold px-2 py-0.5 rounded border border-[hsl(var(--primary)/.2)]">
                           {m.role.replace('_', ' ')}
                         </span>
                      ))}
                    </div>
                  ) : (
                    <span className="bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))] dark:text-[hsl(var(--accent))] text-[10px] font-bold px-2 py-0.5 rounded border border-[hsl(var(--primary)/.2)]">
                      {user.role?.replace('_', ' ')}
                    </span>
                  )}
                </div>
                <div><StatusPill value={user.status || user.userStatus} /></div>
                <div />
              </div>
            )) : (
              <EmptyState icon={ShieldCheck} title="No users found" description="No role assignments found in this context." />
            )}
          </div>
          
          {modal?.createPlatform && (
            <Modal title="Assign Platform Owner" eyebrow="Access Control" onClose={() => setModal(null)}>
              <PlatformMembershipForm
                onDone={() => {
                  done();
                  toast({ title: 'Platform access granted' });
                }}
                onCancel={() => setModal(null)}
              />
            </Modal>
          )}
          {modal?.invite && schoolId && (
            <Modal
              title={isPlatformOwner ? 'Invite School Administrator' : 'Invite School User'}
              eyebrow="Secure Invitation"
              onClose={() => setModal(null)}
            >
              <SchoolInvitationForm
                schoolId={schoolId}
                isPlatformOwner={isPlatformOwner}
                onDone={(result) => {
                  done();
                  if (isPlatformOwner) {
                    qc.invalidateQueries({ queryKey: ['school-admin-invitations', schoolId] });
                    qc.invalidateQueries({ queryKey: ['platform-school-overview', schoolId] });
                    qc.invalidateQueries({ queryKey: ['platform-school-directory'] });
                  }
                  toast({
                     title: result.status === 'LINKED' ? 'Children linked to existing parent account' : isPlatformOwner ? 'Administrator invitation request completed' : result.status === 'DISPATCH_REQUESTED' ? 'Invitation request accepted' : 'Access granted',
                     description: isPlatformOwner
                       ? `Check the school's administrator invitation list for its actual status. Inbox delivery is not verified.${result.expiresAt ? ` The request expires ${date(result.expiresAt)}.` : ''}`
                        : result.status === 'LINKED'
                          ? 'The existing parent account was reused. No activation invitation was sent.'
                       : result.status === 'DISPATCH_REQUESTED'
                         ? `Clerk accepted the invitation request for ${result.email}; inbox delivery is not verified. It expires ${date(result.expiresAt)}.`
                         : `${result.email} was added to this school using their existing account.`,
                  });
                }}
                onCancel={() => setModal(null)}
              />
            </Modal>
          )}
        </>
      )}
    </div>
  );
}

const schoolInvitationSchema = z.object({
  selectedPersonId: z.coerce.number().int().positive().optional(),
  fullName: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  role: z.enum(['SCHOOL_ADMIN', 'TEACHER', 'ACCOUNTANT', 'STAFF', 'PARENT', 'STUDENT']),
});

async function postAuthInvitation(path: string, data: Record<string, unknown>) {
  const response = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.error || `Invitation request failed (${response.status})`);
  }
  return result;
}

function SchoolInvitationForm({
  schoolId,
  isPlatformOwner,
  onDone,
  onCancel,
}: {
  schoolId: number;
  isPlatformOwner: boolean;
  onDone: (result: any) => void;
  onCancel: () => void;
}) {
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [personSearch, setPersonSearch] = useState('');
  const [candidates, setCandidates] = useState<any[]>([]);
  const [candidateError, setCandidateError] = useState('');
  const [children, setChildren] = useState<number[]>([]);
  const [linkPending, setLinkPending] = useState(false);

  const form = useForm<z.infer<typeof schoolInvitationSchema>>({
    resolver: zodResolver(schoolInvitationSchema),
    defaultValues: {
      fullName: '',
      email: '',
      phone: '',
      role: isPlatformOwner ? 'SCHOOL_ADMIN' : 'TEACHER',
      selectedPersonId: undefined,
    }
  });
  const role = form.watch('role');
  useEffect(() => {
    form.setValue('selectedPersonId', undefined, { shouldValidate: true });
    form.clearErrors('selectedPersonId');
    setPersonSearch('');
    setChildren([]);
  }, [schoolId, role]);

  const candidateParams = { schoolId, role, search: personSearch.trim() };
  const candidatesQuery = useQuery({
    queryKey: ['school-activation-candidates', candidateParams],
    enabled: !isPlatformOwner && !!schoolId,
    queryFn: async () => {
      const params = new URLSearchParams({ schoolId: String(schoolId), role, search: personSearch.trim() });
      const response = await fetch(`/api/school-users/activation-candidates?${params}`, { credentials: 'include' });
      const result = await response.json().catch(() => []);
      if (!response.ok) throw new Error(result?.error || `Could not load existing people (${response.status})`);
      return result;
    },
  });
  const parentInvitationsQuery = useQuery({
    queryKey: ['school-user-invitations-for-activation', schoolId],
    enabled: !isPlatformOwner && role === 'PARENT' && !!schoolId &&
      !(candidatesQuery.data?.find((candidate: any) =>
        candidate.personId === form.watch('selectedPersonId') &&
        candidate.linkedUserId &&
        String(candidate.accountStatus).toUpperCase() === 'ACTIVE',
      )),
    queryFn: async () => {
      const response = await fetch(`/api/schools/${schoolId}/users/invitations`, { credentials: 'include' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || `Could not inspect existing parent invitations (${response.status})`);
      return Array.isArray(result.invitations) ? result.invitations : [];
    },
  });
  const studentParams = { schoolId, status: 'ACTIVE' as const };
  const students = useListStudents(studentParams, {
    query: {
      enabled: !isPlatformOwner && role === 'PARENT' &&
        !!candidatesQuery.data?.find((candidate: any) => candidate.personId === form.watch('selectedPersonId')),
      queryKey: getListStudentsQueryKey(studentParams),
    },
  });
  const selectedPerson = candidatesQuery.data?.find(
    (candidate: any) => candidate.personId === form.watch('selectedPersonId'),
  );
  const pendingParentInvitation = (parentInvitationsQuery.data ?? []).find((invitation: any) =>
    invitation.role === 'PARENT' &&
    ['PENDING', 'EXPIRED', 'RECOVERY_REQUIRED'].includes(invitation.status) &&
    String(invitation.email).toLowerCase() === String(selectedPerson?.email ?? '').toLowerCase(),
  );
  const activeLinkedParent = !!selectedPerson?.linkedUserId &&
    String(selectedPerson.accountStatus).toUpperCase() === 'ACTIVE';

  useEffect(() => {
    setCandidates(candidatesQuery.data ?? []);
    setCandidateError(candidatesQuery.error instanceof Error ? candidatesQuery.error.message : '');
  }, [candidatesQuery.data, candidatesQuery.error]);

  const onSubmit = async (data: z.infer<typeof schoolInvitationSchema>) => {
    setErrorMsg(null);
    if (isPlatformOwner && data.role === 'STUDENT') {
      setErrorMsg('Platform owners can only invite school administrators.');
      return;
    }
    const person = isPlatformOwner ? null : candidates.find(candidate => candidate.personId === data.selectedPersonId);
    if (isPlatformOwner && (!data.fullName?.trim() || !data.email?.trim())) {
      setErrorMsg('A full name and verified administrator email are required.');
      return;
    }
    if (!isPlatformOwner && !person) {
      setErrorMsg('Select an existing school person before activation.');
      return;
    }
    if (!isPlatformOwner && !person!.email?.trim()) {
      setErrorMsg('This person has no email on their school profile. Correct the profile before activation; do not re-enter an email here.');
      return;
    }
    if (!isPlatformOwner && person!.linkedUserId) {
      setErrorMsg('This school person is already linked to an account. Do not create another login.');
      return;
    }
    if (!isPlatformOwner && data.role === 'PARENT' && !person!.phone?.trim()) {
      setErrorMsg('This parent profile has no phone number. Correct the profile before activation.');
      return;
    }
    try {
      const result = isPlatformOwner
        ? await postAuthInvitation(`/schools/${schoolId}/administrators`, {
            fullName: data.fullName,
            email: data.email,
            phone: data.phone,
          })
        : await postAuthInvitation('/school-users/invitations', {
            schoolId,
            fullName: person!.fullName,
            email: person!.email,
            phone: person!.phone ?? data.phone,
            role: data.role,
            personId: person!.personId,
            ...(data.role === 'STUDENT' ? { studentId: person!.personId } : {}),
          });
      onDone(result);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to send invitation');
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      {errorMsg && <div className="text-sm font-bold text-[hsl(var(--destructive))] bg-[hsl(var(--destructive)/.1)] p-3 rounded-xl">{errorMsg}</div>}
      {isPlatformOwner ? <>
      <div className="space-y-1">
        <label className="text-xs font-bold text-[hsl(var(--muted-foreground))]">Full Name</label>
        <input type="text" {...form.register('fullName')} className="w-full" placeholder="Jordan Doe" autoComplete="name" />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-bold text-[hsl(var(--muted-foreground))]">Email</label>
        <input type="email" {...form.register('email')} className="w-full" placeholder="person@school.edu" autoComplete="email" />
      </div>
      </> : <div className="space-y-1">
        <label className="text-xs font-bold text-[hsl(var(--muted-foreground))]">Existing school person</label>
        <input
          type="search"
          value={personSearch}
          onChange={event => {
            setPersonSearch(event.target.value);
            form.setValue('selectedPersonId', undefined, { shouldValidate: true });
            setChildren([]);
          }}
          className="w-full"
          placeholder="Search existing people in this school"
          aria-label="Search existing school people"
        />
        <select
          value={form.watch('selectedPersonId') ?? ''}
          onChange={event => {
            const person = candidates.find(candidate => candidate.personId === Number(event.target.value));
            form.setValue('selectedPersonId', person?.personId, { shouldValidate: true });
            form.setValue('phone', person?.phone ?? '');
            setChildren([]);
          }}
          className="w-full"
          aria-label="Existing school person"
        >
          <option value="">Select a person</option>
          {candidates.map(person => (
            <option key={`${person.personType}-${person.personId}`} value={person.personId}>
              {person.fullName} · {person.email || 'Email missing'}{person.admissionNo ? ` · ${person.admissionNo}` : person.employeeNo ? ` · ${person.employeeNo}` : ''}
            </option>
          ))}
        </select>
        {candidatesQuery.isLoading && <p role="status" className="text-xs text-[hsl(var(--muted-foreground))]">Loading existing school people…</p>}
        {candidateError && <p className="text-xs text-[hsl(var(--destructive))]">{candidateError}</p>}
        {selectedPerson && <p className="text-xs text-[hsl(var(--muted-foreground))]">
          Selected profile: {selectedPerson.fullName} · Profile email {selectedPerson.profileEmail || selectedPerson.email || 'missing'} · Account email {selectedPerson.accountEmail || 'not linked'} · Profile {selectedPerson.profileStatus || 'unknown'} · Account {selectedPerson.accountStatus || 'not linked'}
        </p>}
        {selectedPerson && !selectedPerson.email && <p className="text-xs text-[hsl(var(--destructive))]">Correct the email on this existing school profile before activation. Email cannot be entered in this form.</p>}
        {form.formState.errors.selectedPersonId && <p className="text-xs text-[hsl(var(--destructive))]">{form.formState.errors.selectedPersonId.message}</p>}
      </div>}
      {!isPlatformOwner && role === 'PARENT' && selectedPerson && (
        <div className="space-y-2 rounded-xl border border-[hsl(var(--border))] p-3">
          <p className="text-sm font-semibold">
            {activeLinkedParent
              ? 'This parent already has an active account. Select children to link without an invitation.'
              : 'Select the children for this parent profile. The existing or new invitation will be reused; links are saved before activation.'}
          </p>
          {students.isLoading ? <p role="status" className="text-xs">Loading active students…</p> : students.isError ? (
            <p className="text-xs text-[hsl(var(--destructive))]">Could not load school students.</p>
          ) : (students.data ?? []).map((student: any) => (
            <label key={student.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={children.includes(student.id)} onChange={event => setChildren(current =>
                event.target.checked ? [...current, student.id] : current.filter(id => id !== student.id))} />
              {student.firstName} {student.lastName} · {student.admissionNo}
            </label>
          ))}
          {!activeLinkedParent && parentInvitationsQuery.isError && <p role="alert" className="text-xs text-[hsl(var(--destructive))]">
            Could not check existing invitations: {(parentInvitationsQuery.error as Error).message}
          </p>}
          <Button type="button" disabled={!children.length || linkPending ||
            (!activeLinkedParent && (parentInvitationsQuery.isLoading || parentInvitationsQuery.isError))} onClick={async () => {
            setErrorMsg(null);
            setLinkPending(true);
            try {
              const response = await fetch(`/api/parents/${selectedPerson.personId}/children?schoolId=${schoolId}`, {
                method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ studentIds: children, relationshipType: 'Guardian' }),
              });
              const responseBody = await response.json().catch(() => ({}));
              if (!response.ok) throw new Error(responseBody?.error || `Could not link children (${response.status})`);
              if (activeLinkedParent) {
                onDone({ status: 'LINKED' });
                return;
              }
              let activationResult;
              if (pendingParentInvitation?.status === 'RECOVERY_REQUIRED') {
                const invitationId = encodeURIComponent(pendingParentInvitation.invitationId);
                const resend = await fetch(`/api/schools/${schoolId}/users/invitations/${invitationId}/reconcile`, {
                  method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}',
                });
                activationResult = await resend.json().catch(() => ({}));
                if (!resend.ok) throw new Error(activationResult?.error || `Could not reconcile invitation (${resend.status})`);
              } else if (pendingParentInvitation) {
                const invitationId = encodeURIComponent(pendingParentInvitation.invitationId);
                const resend = await fetch(`/api/schools/${schoolId}/users/invitations/${invitationId}/resend`, {
                  method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}',
                });
                activationResult = await resend.json().catch(() => ({}));
                if (!resend.ok) throw new Error(activationResult?.error || `Could not resend existing invitation (${resend.status})`);
              } else {
                const invite = await fetch('/api/school-users/invitations', {
                  method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    schoolId, role: 'PARENT', personId: selectedPerson.personId,
                    fullName: selectedPerson.fullName, email: selectedPerson.email, phone: selectedPerson.phone,
                  }),
                });
                activationResult = await invite.json().catch(() => ({}));
                if (!invite.ok) throw new Error(activationResult?.error || `Could not activate parent (${invite.status})`);
              }
              onDone(activationResult);
            } catch (error) {
              setErrorMsg(error instanceof Error ? error.message : 'Could not link children');
            } finally {
              setLinkPending(false);
            }
          }}>
            {linkPending ? 'Saving…' : activeLinkedParent
              ? 'Link children without invitation'
              : pendingParentInvitation
                ? 'Link children and reuse existing invitation'
                : 'Link children and send invitation'}
          </Button>
        </div>
      )}
      {!isPlatformOwner && role === 'PARENT' && selectedPerson?.profileStatus === 'PENDING' && pendingParentInvitation && (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          This existing {pendingParentInvitation.status.toLowerCase()} parent invitation will be reused when you save the selected children.
        </p>
      )}
      {!isPlatformOwner && (
        <div className="space-y-1">
          <label className="text-xs font-bold text-[hsl(var(--muted-foreground))]">School Role</label>
          <select {...form.register('role')} className="w-full">
            <option value="SCHOOL_ADMIN">School Admin</option>
            <option value="TEACHER">Teacher</option>
            <option value="ACCOUNTANT">Accountant</option>
            <option value="STAFF">Staff</option>
            <option value="PARENT">Parent</option>
            <option value="STUDENT">Student</option>
          </select>
          {form.formState.errors.role && <p className="text-xs text-[hsl(var(--destructive))]">{form.formState.errors.role.message}</p>}
        </div>
      )}
      <div className="space-y-1">
        <label className="text-xs font-bold text-[hsl(var(--muted-foreground))]">
          Phone {role === 'PARENT' ? '(required)' : '(optional)'}
        </label>
        <input type="tel" {...form.register('phone')} className="w-full" placeholder="+1234567890" autoComplete="tel" />
        {form.formState.errors.phone && <p className="text-xs text-[hsl(var(--destructive))]">{form.formState.errors.phone.message}</p>}
      </div>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">
        Clerk accepts a single-use invitation dispatch request that expires in seven days. Inbox delivery is not verified; the invitee creates their own password.
      </p>

      <div className="flex justify-end gap-3 pt-5 border-t border-[hsl(var(--border))]">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={form.formState.isSubmitting || (!isPlatformOwner && (!selectedPerson || !!selectedPerson.linkedUserId || !selectedPerson.email || candidatesQuery.isLoading || (role === 'PARENT' && !!pendingParentInvitation)))}>
          {form.formState.isSubmitting ? 'Sending…' : 'Send Invitation'}
        </Button>
      </div>
    </form>
  );
}

function PlatformMembershipForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [email, setEmail] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);
    setPending(true);
    try {
      await postAuthInvitation('/platform-users', { email: email.trim(), role: 'PLATFORM_OWNER' });
      onDone();
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Could not assign platform access');
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="rounded-xl border border-[hsl(var(--accent)/.3)] bg-[hsl(var(--accent)/.05)] p-4 text-sm text-[hsl(var(--foreground))]">
        Assign platform access to an existing account by its verified email identity. This does not create or change that user's password.
      </div>
      <Field label="Account Email">
        <input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="operator@yemait.com" />
      </Field>

      <div className="flex justify-end gap-3 pt-5 border-t border-[hsl(var(--border))]">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Grant platform access'}</Button>
      </div>
      {errorMsg && <p className="text-sm font-medium text-[hsl(var(--destructive))]">{errorMsg}</p>}
    </form>
  );
}