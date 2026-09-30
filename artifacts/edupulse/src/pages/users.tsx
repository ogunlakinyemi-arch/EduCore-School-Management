import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
                     title: isPlatformOwner ? 'Administrator invitation request completed' : result.status === 'DISPATCH_REQUESTED' ? 'Invitation request accepted' : 'Access granted',
                     description: isPlatformOwner
                       ? `Check the school's administrator invitation list for its actual status. Inbox delivery is not verified.${result.expiresAt ? ` The request expires ${date(result.expiresAt)}.` : ''}`
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
  fullName: z.string().min(2, 'Full name is required'),
  email: z.string().email('Valid email required'),
  phone: z.string().optional(),
  role: z.enum(['SCHOOL_ADMIN', 'TEACHER', 'ACCOUNTANT', 'STAFF', 'PARENT', 'STUDENT']),
  studentId: z.coerce.number().optional(),
}).refine(data => data.role !== 'PARENT' || !!data.phone?.trim(), {
  message: 'A phone number is required for parent invitations',
  path: ['phone']
}).refine(data => data.role !== 'STUDENT' || (Number.isInteger(data.studentId) && Number(data.studentId) > 0), {
  message: 'Select an existing student profile',
  path: ['studentId']
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
  const [studentSearch, setStudentSearch] = useState('');

  const form = useForm<z.infer<typeof schoolInvitationSchema>>({
    resolver: zodResolver(schoolInvitationSchema),
    defaultValues: {
      fullName: '',
      email: '',
      phone: '',
      role: isPlatformOwner ? 'SCHOOL_ADMIN' : 'TEACHER',
      studentId: undefined,
    }
  });
  const role = form.watch('role');
  useEffect(() => {
    form.setValue('studentId', undefined, { shouldValidate: true });
    form.clearErrors('studentId');
    setStudentSearch('');
  }, [schoolId, role]);

  const studentParams = {
    schoolId,
    status: 'ACTIVE' as const,
    search: studentSearch.trim() || undefined,
  };
  const students = useListStudents(studentParams, {
    query: {
      enabled: !isPlatformOwner && role === 'STUDENT',
      queryKey: getListStudentsQueryKey(studentParams),
    },
  });

  const onSubmit = async (data: z.infer<typeof schoolInvitationSchema>) => {
    setErrorMsg(null);
    if (isPlatformOwner && data.role === 'STUDENT') {
      setErrorMsg('Platform owners can only invite school administrators.');
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
            fullName: data.fullName,
            email: data.email,
            phone: data.phone,
            role: data.role,
            ...(data.role === 'STUDENT' ? { studentId: data.studentId } : {}),
          });
      onDone(result);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to send invitation');
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      {errorMsg && <div className="text-sm font-bold text-[hsl(var(--destructive))] bg-[hsl(var(--destructive)/.1)] p-3 rounded-xl">{errorMsg}</div>}
      <div className="space-y-1">
        <label className="text-xs font-bold text-[hsl(var(--muted-foreground))]">Full Name</label>
        <input type="text" {...form.register('fullName')} className="w-full" placeholder="Jordan Doe" autoComplete="name" />
        {form.formState.errors.fullName && <p className="text-xs text-[hsl(var(--destructive))]">{form.formState.errors.fullName.message}</p>}
      </div>
      <div className="space-y-1">
        <label className="text-xs font-bold text-[hsl(var(--muted-foreground))]">Email</label>
        <input type="email" {...form.register('email')} className="w-full" placeholder="person@school.edu" autoComplete="email" />
        {form.formState.errors.email && <p className="text-xs text-[hsl(var(--destructive))]">{form.formState.errors.email.message}</p>}
      </div>
      {!isPlatformOwner && (
        <div className="space-y-1">
          <label className="text-xs font-bold text-[hsl(var(--muted-foreground))]">School Role</label>
          <select {...form.register('role', {
            onChange: () => {
              form.setValue('studentId', undefined);
              form.clearErrors('studentId');
            },
          })} className="w-full">
            <option value="TEACHER">Teacher</option>
            <option value="ACCOUNTANT">Accountant</option>
            <option value="STAFF">Staff</option>
            <option value="PARENT">Parent</option>
            <option value="STUDENT">Student</option>
          </select>
          {form.formState.errors.role && <p className="text-xs text-[hsl(var(--destructive))]">{form.formState.errors.role.message}</p>}
        </div>
      )}
      {!isPlatformOwner && role === 'STUDENT' && (
        <div className="space-y-1">
          <label className="text-xs font-bold text-[hsl(var(--muted-foreground))]">Existing student profile</label>
          <input
            type="search"
            value={studentSearch}
            onChange={event => {
              setStudentSearch(event.target.value);
              form.setValue('studentId', undefined, { shouldValidate: true });
            }}
            className="w-full"
            placeholder="Search active students by name or admission number"
            aria-label="Search active students"
          />
          <select
            {...form.register('studentId')}
            value={form.watch('studentId') ?? ''}
            onChange={event => form.setValue('studentId', event.target.value ? Number(event.target.value) : undefined, { shouldValidate: true })}
            className="w-full"
            aria-label="Existing student profile"
          >
            <option value="" disabled>Select a student</option>
            {(students.data ?? []).map((student: any) => (
              <option key={student.id} value={student.id}>
                {student.firstName} {student.lastName} · {student.admissionNo}
              </option>
            ))}
          </select>
          {students.isLoading && <p role="status" className="text-xs text-[hsl(var(--muted-foreground))]">Loading active student profiles…</p>}
          {students.isError && <p className="text-xs text-[hsl(var(--destructive))]">Could not load this school&apos;s student profiles.</p>}
          {!students.isLoading && !students.isError && !(students.data ?? []).length && (
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {studentSearch ? 'No active student profiles match this search.' : 'No active student profiles are available in this school.'}
            </p>
          )}
          {form.formState.errors.studentId && <p className="text-xs text-[hsl(var(--destructive))]">{form.formState.errors.studentId.message}</p>}
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Student access links to this existing school profile. The profile has no student email field; enter the invitee&apos;s email above.</p>
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
        <Button type="submit" disabled={form.formState.isSubmitting}>
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