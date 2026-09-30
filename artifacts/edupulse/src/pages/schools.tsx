import { useState, type FormEvent } from 'react';
import { useLocation, useParams, Link } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  Building2, Plus, Search, Pencil, ArrowLeft, GraduationCap, ShieldCheck,
  CircleAlert, BarChart3, CreditCard, UsersRound, UserRound, Briefcase,
  Smartphone, FileClock, Link as LinkIcon, RefreshCw, Save, X
} from 'lucide-react';
import { 
  useGetSchool, useUpdateSchool, useGetSchoolDashboard,
  useGetAuthorizedContext, getListSchoolsQueryKey
} from '@workspace/api-client-react';
import { 
  PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, 
  Modal, Field, Info, Metric, ActivityFeed, cx, date, time, useTenant
} from '@/components/shared';

type OwnerSchool = {
  id: number;
  code: string;
  name: string;
  city: string;
  state: string;
  status: string;
  createdAt: string;
  subscriptionStatus: string;
  studentCount: number;
  activeStudentCount: number;
  teacherCount: number;
  staffCount: number;
  employeeCount: number;
  accountantCount: number;
  parentCount: number;
  administrators: Array<{ id: number; name: string; email: string; status: string }>;
  partnerReferral: null | {
    partnerId: number;
    partnerName: string;
    source: string;
    status: string;
    referralLinkId: number | null;
    registrationDate: string;
  };
};

type OwnerDirectoryResponse = {
  schools: OwnerSchool[];
  totals: {
    schoolCount: number;
    studentCount: number;
    activeStudentCount: number;
    teacherCount: number;
    staffCount: number;
    parentCount: number;
  };
};

async function fetchOwnerDirectory(search: string, status: string): Promise<OwnerDirectoryResponse> {
  const params = new URLSearchParams({ search, status });
  const response = await fetch(`/api/platform/schools/directory?${params}`, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Could not load the platform school directory (${response.status})`);
  return response.json();
}

async function fetchOwnerSchoolOverview(schoolId: number) {
  const response = await fetch(`/api/platform/schools/${schoolId}/overview`, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Could not load the school overview (${response.status})`);
  return response.json();
}

async function createSchoolWithAdministrator(school: any, administrator: { fullName: string; email: string }) {
  const response = await fetch('/api/schools/with-administrator', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ school, administrator }),
  });
  if (!response.ok) {
    const details = await response.json().catch(() => null);
    const error = new Error(details?.message || details?.error || `School and administrator invitation could not be completed (${response.status})`);
    (error as any).status = response.status;
    throw error;
  }
  return response.json();
}

async function inviteSchoolAdministrator(
  schoolId: number,
  fullName: string,
  email: string,
): Promise<any> {
  const response = await fetch(`/api/schools/${schoolId}/administrators`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName, email }),
  });
  if (!response.ok) {
    const details = await response.json().catch(() => null);
    throw new Error(details?.error || details?.message || `Administrator invitation could not be completed (${response.status})`);
  }
  return response.json();
}

type SchoolAdminInvitation = {
  invitationId: number | string;
  claimId: string | null;
  email: string;
  fullName: string | null;
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'SUPERSEDED';
  clerkStatus: string | null;
  isCurrent: boolean;
  membershipId: number | string | null;
  userId: number | string | null;
  createdAt: string;
  expiresAt: string | null;
};

async function fetchSchoolAdminInvitations(schoolId: number): Promise<{
  schoolId: number;
  role: 'SCHOOL_ADMIN';
  invitations: SchoolAdminInvitation[];
}> {
  const response = await fetch(`/api/schools/${schoolId}/invitations`, { credentials: 'same-origin' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.error || result?.message || `Could not load administrator invitations (${response.status})`);
  }
  return result;
}

async function updateSchoolAdminInvitation(schoolId: number, invitationId: number | string, email: string) {
  const response = await fetch(`/api/schools/${schoolId}/invitations/${invitationId}`, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.error || result?.message || `Could not update administrator invitation (${response.status})`);
  }
  return result;
}

async function resendSchoolAdminInvitation(schoolId: number, invitationId: number | string) {
  const response = await fetch(`/api/schools/${schoolId}/invitations/${invitationId}/resend`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.error || result?.message || `Could not resend administrator invitation (${response.status})`);
  }
  return result;
}

const schoolAdminInvitationsQueryKey = (schoolId: number) => ['school-admin-invitations', schoolId];

function isPendingAdministratorRegistration(school: any) {
  return String(school?.status ?? '').toLowerCase() === 'pending';
}

function operationalStatusLabel(school: any) {
  return isPendingAdministratorRegistration(school)
    ? 'Pending Administrator Registration'
    : school?.status;
}

export function SchoolsPage() {
  const [search, setSearch] = useState(''); 
  const [status, setStatus] = useState('all'); 
  const [modal, setModal] = useState<any>(null); 
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  
  const query = useQuery({
    queryKey: ['platform-school-directory', search, status],
    queryFn: () => fetchOwnerDirectory(search, status),
  });
  const schools = query.data?.schools ?? [];
  
  const done = () => { 
    setModal(null); 
    qc.invalidateQueries({ queryKey: getListSchoolsQueryKey() }); 
    qc.invalidateQueries({ queryKey: ['platform-school-directory'] });
  };
  
  if (query.isLoading) return <SkeletonPage />;
  if (query.isError) return <ErrorState retry={() => query.refetch()} />;

  return (
    <div className="fade-up">
      <PageHeading 
        eyebrow="Platform / schools" 
        title="Schools in your orbit." 
        description="Keep every operator visible, while keeping every tenant safely separate." 
        action={
          <Button onClick={() => setModal({ create: true })} testId="button-add-school">
            <Plus size={16} />Add school
          </Button>
        } 
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Schools in view" value={query.data?.totals.schoolCount ?? 0} icon={Building2} accent />
        <Metric label="Students" value={(query.data?.totals.studentCount ?? 0).toLocaleString()} detail={`${(query.data?.totals.activeStudentCount ?? 0).toLocaleString()} active`} icon={GraduationCap} />
        <Metric label="Teachers" value={(query.data?.totals.teacherCount ?? 0).toLocaleString()} icon={Briefcase} />
        <Metric label="Other staff" value={(query.data?.totals.staffCount ?? 0).toLocaleString()} icon={UserRound} />
        <Metric label="Parent accounts" value={(query.data?.totals.parentCount ?? 0).toLocaleString()} icon={UsersRound} />
      </div>
      
      <div className="panel mb-6 flex flex-col gap-4 p-4 md:flex-row">
        <label className="relative flex-1">
          <Search className="absolute left-4 top-3 text-[hsl(var(--muted-foreground))]" size={18} />
          <input 
            className="pl-11" 
            value={search} 
            onChange={e => setSearch(e.target.value)} 
            placeholder="Search by school, city or code..." 
            data-testid="input-search-schools" 
          />
        </label>
        <div className="flex gap-2 overflow-auto pb-1 md:pb-0">
          {['all', 'active', 'attention', 'suspended'].map(item => (
            <button 
              key={item} 
              onClick={() => setStatus(item === 'attention' ? 'inactive' : item)} 
              className={cx(
                'whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-bold capitalize transition-all', 
                status === (item === 'attention' ? 'inactive' : item) 
                  ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-md' 
                  : 'bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] hover:bg-[hsl(var(--muted))]'
              )} 
              data-testid={`filter-school-${item}`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      
      <div className="panel overflow-hidden">
        <div className="hidden grid-cols-[1.5fr_1fr_.8fr_.8fr_.8fr_.8fr_1.3fr_.9fr_auto] gap-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-6 py-4 text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] lg:grid">
          <span>School & administrator</span>
          <span>Location</span>
          <span>Students</span>
          <span>Teachers</span>
          <span>Staff</span>
          <span>Parents</span>
          <span>Partner / source</span>
          <span>Status</span>
          <span />
        </div>
        {schools.length ? schools.map((school: any) => (
          <div key={school.id} className="grid gap-3 border-b border-[hsl(var(--border)/.6)] px-5 py-5 transition-colors hover:bg-[hsl(var(--muted)/.2)] last:border-0 md:grid-cols-2 md:gap-x-6 lg:grid-cols-[1.5fr_1fr_.8fr_.8fr_.8fr_.8fr_1.3fr_.9fr_auto] lg:items-center lg:gap-4 lg:px-6">
            <div className="min-w-0">
              <Link href={`/schools/${school.id}`} className="font-bold text-sm hover:text-[hsl(var(--primary))] transition-colors" data-testid={`link-school-${school.id}`}>
                {school.name}
              </Link>
              <div className="mt-1.5 flex items-center gap-2.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                <span className="font-mono bg-[hsl(var(--secondary))] px-1.5 py-0.5 rounded text-[10px]">{school.code}</span>
              </div>
              <div className="mt-1 truncate text-xs text-[hsl(var(--muted-foreground))]">
                {school.administrators?.length
                  ? school.administrators.map((admin: any) => admin.email).join(', ')
                  : 'No school administrator assigned'}
              </div>
            </div>
            <div className="text-sm text-[hsl(var(--muted-foreground))] font-medium">{school.city}, {school.state}</div>
            <div className="text-sm font-bold">{school.studentCount?.toLocaleString() ?? 0}</div>
            <div className="text-sm font-bold">{school.teacherCount ?? 0}</div>
            <div className="text-sm font-bold">{school.staffCount ?? 0}</div>
            <div className="text-sm font-bold">{school.parentCount ?? 0}</div>
            <div className="min-w-0 text-sm">
              {school.partnerReferral
                ? <><div className="truncate font-bold">{school.partnerReferral.partnerName}</div><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{school.partnerReferral.source.replaceAll('_', ' ')}</div></>
                : <span className="text-[hsl(var(--muted-foreground))]">Direct / unassigned</span>}
              <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Joined {date(school.createdAt)}</div>
            </div>
            <div className="space-y-1" aria-label="School and subscription status">
              <StatusPill value={operationalStatusLabel(school)} />
              <StatusPill value={school.subscriptionStatus} />
            </div>
            <Button variant="quiet" onClick={() => setModal(school)} testId={`button-edit-school-${school.id}`}>
              <Pencil size={15} />Edit
            </Button>
          </div>
        )) : (
          <EmptyState 
            icon={Building2} 
            title="No schools match that view" 
            description="Try another status or add the next school to your network." 
            action={<Button onClick={() => setModal({ create: true })} testId="button-empty-add-school"><Plus size={15} />Add a school</Button>} 
          />
        )}
      </div>
      
      {query.data && schools.length > 0 && (
        <p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">Referral attribution is shown only for a currently active school-partner relationship.</p>
      )}

      {modal && (
        <Modal title={modal.create ? 'Add a new school' : 'Edit school profile'} eyebrow="Tenant setup" onClose={() => setModal(null)}>
          <SchoolForm initial={modal.create ? undefined : modal} onDone={done} onCancel={() => setModal(null)} />
        </Modal>
      )}
    </div>
  );
}

function SchoolForm({ initial, onDone, onCancel }: { initial?: any; onDone: () => void; onCancel: () => void }) {
  const update = useUpdateSchool();
  const queryClient = useQueryClient();
  const [administrator, setAdministrator] = useState({ fullName: '', email: '' });
  const [inviting, setInviting] = useState(false);
  const [invitationError, setInvitationError] = useState('');
  const [invitationNotice, setInvitationNotice] = useState('');
  const [createdSchoolId, setCreatedSchoolId] = useState<number | null>(null);
  const [creationNeedsReview, setCreationNeedsReview] = useState(false);
  const isPendingRegistration = !!initial && isPendingAdministratorRegistration(initial);
  const createdSchoolQuery = useQuery({
    queryKey: ['platform-school-overview', createdSchoolId],
    queryFn: () => fetchOwnerSchoolOverview(createdSchoolId!),
    enabled: createdSchoolId !== null,
  });
  
  const [form, setForm] = useState({ 
    code: initial?.code ?? '',
    name: initial?.name ?? '', 
    city: initial?.city ?? '', 
    state: initial?.state ?? '', 
    status: initial?.status ?? ''
  });
  
  const pending = update.isPending || inviting;
  
  const save = async (event: FormEvent) => {
    event.preventDefault(); 
    if (initial) {
      update.mutate({ schoolId: initial.id, data: form }, { onSuccess: onDone }); 
    } else {
      setInvitationError('');
      if (creationNeedsReview) return;
      setInviting(true);
      try {
        const result = await createSchoolWithAdministrator({
          code: form.code,
          name: form.name,
          city: form.city,
          state: form.state,
        }, administrator);
        setCreatedSchoolId(result.schoolId);
        setInvitationNotice('Clerk accepted the administrator invitation request; inbox delivery is not verified.');
        setCreationNeedsReview(true);
        queryClient.invalidateQueries({ queryKey: ['platform-school-directory'] });
      } catch (error) {
        const status = (error as any)?.status;
        if (status >= 500 || status === undefined) {
          setCreationNeedsReview(true);
          setInvitationError(`${error instanceof Error ? error.message : 'School creation status could not be confirmed.'} Check the school directory before retrying; the school and invitation may already exist.`);
        } else {
          setInvitationError(error instanceof Error ? error.message : 'Could not create the school and invite its administrator.');
        }
      } finally {
        setInviting(false);
      }
    }
  };

  return (
    <form onSubmit={save} className="space-y-5">
      {!initial && (
        <Field label="School Code (Unique identifier)">
          <input required minLength={2} maxLength={10} value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="e.g. CGA" data-testid="input-school-code" className="font-mono uppercase" />
        </Field>
      )}
      <Field label="School name">
        <input required minLength={2} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Cedar Grove Academy" data-testid="input-school-name" />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="City">
          <input required value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} placeholder="Lagos" data-testid="input-school-city" />
        </Field>
        <Field label="State">
          <input required value={form.state} onChange={e => setForm({ ...form, state: e.target.value })} placeholder="Lagos" data-testid="input-school-state" />
        </Field>
      </div>
      {initial && !isPendingRegistration ? (
        <Field label="Operational status">
          <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} data-testid="select-school-status">
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="inactive">Inactive</option>
          </select>
        </Field>
      ) : initial ? (
        <section aria-label="Operational status" data-testid="operational-school-status" className="rounded-xl border border-[hsl(var(--border))] p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Operational status</div>
          <p className="mt-1 text-sm font-bold">{operationalStatusLabel(initial)}</p>
        </section>
      ) : null}
      {!initial && createdSchoolId !== null && createdSchoolQuery.data && (
        <section aria-label="Operational status" data-testid="operational-school-status" className="rounded-xl border border-[hsl(var(--border))] p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Operational status</div>
          <p className="mt-1 text-sm font-bold">{operationalStatusLabel(createdSchoolQuery.data)}</p>
        </section>
      )}
      {!initial && createdSchoolId !== null && createdSchoolQuery.isError && (
        <p role="alert" className="text-sm text-[hsl(var(--destructive))]">Could not confirm operational status. Refresh the school directory to check the latest backend status.</p>
      )}
      {!initial && (
        <div className="grid gap-5 border-t border-[hsl(var(--border))] pt-5 sm:grid-cols-2">
          <Field label="School Administrator name">
            <input required minLength={2} value={administrator.fullName} onChange={e => setAdministrator({ ...administrator, fullName: e.target.value })} placeholder="Administrator's full name" />
          </Field>
          <Field label="School Administrator email">
            <input required type="email" value={administrator.email} onChange={e => setAdministrator({ ...administrator, email: e.target.value })} placeholder="administrator@school.edu" />
          </Field>
        </div>
      )}
      <div className="flex justify-end gap-3 pt-4 border-t border-[hsl(var(--border))]">
        <Button variant="outline" onClick={onCancel} testId="button-cancel-school">{invitationNotice ? 'Done' : 'Cancel'}</Button>
        <Button type="submit" disabled={pending || creationNeedsReview} testId="button-save-school">
          {pending ? 'Saving…' : initial ? 'Save changes' : invitationNotice ? 'Invitation request accepted' : 'Create school & invite administrator'}
        </Button>
      </div>
      {invitationError && <p role="alert" className="text-sm font-medium text-[hsl(var(--destructive))]">{invitationError}</p>}
      {invitationNotice && (
        <section aria-label="Administrator invitation" className="rounded-xl border border-[hsl(var(--border))] p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Administrator invitation</div>
          <p role="status" className="mt-1 text-sm font-medium text-[hsl(var(--primary))]">
            {createdSchoolId ? `School ${createdSchoolId} was created. ` : ''}{invitationNotice}
          </p>
        </section>
      )}
      {update.isError && <p className="text-sm font-medium text-[hsl(var(--destructive))]">Could not save this school. Check the fields and try again.</p>}
    </form>
  );
}

function OwnerAdminInvitationForm({ schoolId }: { schoolId: number }) {
  const queryClient = useQueryClient();
  const invitationsQuery = useQuery({
    queryKey: schoolAdminInvitationsQueryKey(schoolId),
    queryFn: () => fetchSchoolAdminInvitations(schoolId),
    enabled: Number.isSafeInteger(schoolId) && schoolId > 0,
  });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [editingInvitationId, setEditingInvitationId] = useState<number | string | null>(null);
  const [editedEmail, setEditedEmail] = useState('');
  const [workingInvitationId, setWorkingInvitationId] = useState<number | string | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  const refreshInvitations = () => {
    queryClient.invalidateQueries({ queryKey: schoolAdminInvitationsQueryKey(schoolId) });
    queryClient.invalidateQueries({ queryKey: ['platform-school-overview', schoolId] });
    queryClient.invalidateQueries({ queryKey: ['platform-school-directory'] });
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setError('');
    try {
      await inviteSchoolAdministrator(schoolId, name, email);
      setMessage('Administrator invitation request completed. Check the invitation list below for its actual status; inbox delivery is not verified.');
      setName('');
      setEmail('');
      refreshInvitations();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not invite this administrator.');
    } finally {
      setBusy(false);
    }
  }

  async function saveEmail(invitation: SchoolAdminInvitation) {
    setWorkingInvitationId(invitation.invitationId);
    setActionError('');
    setActionMessage('');
    try {
      await updateSchoolAdminInvitation(schoolId, invitation.invitationId, editedEmail.trim());
      setEditingInvitationId(null);
      setEditedEmail('');
      setActionMessage('Pending invitation email updated.');
      refreshInvitations();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Could not update this invitation email.');
    } finally {
      setWorkingInvitationId(null);
    }
  }

  async function resend(invitation: SchoolAdminInvitation) {
    setWorkingInvitationId(invitation.invitationId);
    setActionError('');
    setActionMessage('');
    try {
      const result = await resendSchoolAdminInvitation(schoolId, invitation.invitationId);
      setActionMessage(
        `Invitation ${result.status} request accepted for ${result.email}. Inbox delivery is ${result.deliveryStatus === 'UNVERIFIED' ? 'unverified' : String(result.deliveryStatus || 'unverified').toLowerCase()}.`,
      );
      refreshInvitations();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Could not resend this invitation.');
    } finally {
      setWorkingInvitationId(null);
    }
  }

  return (
    <div className="mt-4 space-y-4 border-t border-[hsl(var(--border))] pt-4">
      <form onSubmit={submit} className="space-y-3">
        <div className="text-sm font-bold">Invite a school administrator</div>
        <Field label="Full name"><input required minLength={2} value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field label="Email"><input required type="email" value={email} onChange={e => setEmail(e.target.value)} /></Field>
        <Button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send invitation'}</Button>
        {message && <p role="status" className="text-sm">{message}</p>}
        {error && <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{error}</p>}
      </form>

      <section aria-label="School administrator invitations" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold">Administrator invitation status</h3>
          <Button type="button" variant="quiet" onClick={() => invitationsQuery.refetch()} disabled={invitationsQuery.isFetching}>
            <RefreshCw size={14} />Refresh
          </Button>
        </div>
        {invitationsQuery.isLoading ? (
          <p role="status" className="text-sm text-[hsl(var(--muted-foreground))]">Loading invitation status…</p>
        ) : invitationsQuery.isError ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-[hsl(var(--destructive))]">
              {invitationsQuery.error instanceof Error ? invitationsQuery.error.message : 'Could not load administrator invitation status.'}
            </p>
            <Button type="button" variant="outline" onClick={() => invitationsQuery.refetch()}>Try again</Button>
          </div>
        ) : invitationsQuery.data?.invitations?.length ? (
          <ul className="divide-y divide-[hsl(var(--border))] rounded-xl border border-[hsl(var(--border))]">
            {invitationsQuery.data.invitations.map(invitation => (
              <li key={invitation.invitationId} className="space-y-3 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold">{invitation.fullName || invitation.email}</div>
                    <div className="break-all text-xs text-[hsl(var(--muted-foreground))]">{invitation.email}</div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                      Created {date(invitation.createdAt)}
                      {invitation.expiresAt ? ` · Expires ${date(invitation.expiresAt)}` : ''}
                    </div>
                  </div>
                  <StatusPill value={invitation.status} />
                </div>
                {editingInvitationId === invitation.invitationId ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="Correct email">
                      <input type="email" required value={editedEmail} onChange={event => setEditedEmail(event.target.value)} />
                    </Field>
                    <Button type="button" onClick={() => saveEmail(invitation)} disabled={workingInvitationId === invitation.invitationId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editedEmail.trim())}>
                      <Save size={14} />Save email
                    </Button>
                    <Button type="button" variant="quiet" onClick={() => { setEditingInvitationId(null); setEditedEmail(''); }}>
                      <X size={14} />Cancel
                    </Button>
                  </div>
                ) : invitation.status === 'PENDING' || invitation.status === 'EXPIRED' ? (
                  <div className="flex flex-wrap gap-2">
                    {invitation.status === 'PENDING' && (
                      <Button type="button" variant="outline" onClick={() => { setEditingInvitationId(invitation.invitationId); setEditedEmail(invitation.email); setActionError(''); setActionMessage(''); }}>
                        <Pencil size={14} />Edit email
                      </Button>
                    )}
                    <Button type="button" variant="outline" onClick={() => resend(invitation)} disabled={workingInvitationId === invitation.invitationId}>
                      <RefreshCw size={14} />{workingInvitationId === invitation.invitationId ? 'Resending…' : 'Resend'}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">No school administrator invitations have been recorded.</p>
        )}
        {actionMessage && <p role="status" className="text-sm text-[hsl(var(--primary))]">{actionMessage}</p>}
        {actionError && <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{actionError}</p>}
      </section>
    </div>
  );
}

export function SchoolOverview() {
  const params = useParams<{ id: string }>(); 
  const [, setLocation] = useLocation(); 
  const schoolId = Number(params.id); 
  const { setSchoolId } = useTenant();
  
  const contextQuery = useGetAuthorizedContext();
  const isPlatformOwner = !!contextQuery.data?.isPlatformOwner;
  const schoolQuery = useGetSchool(schoolId);
  const dash = useGetSchoolDashboard({ schoolId });
  const ownerOverviewQuery = useQuery({
    queryKey: ['platform-school-overview', schoolId],
    queryFn: () => fetchOwnerSchoolOverview(schoolId),
    enabled: isPlatformOwner && Number.isSafeInteger(schoolId) && schoolId > 0,
  });
  
  if (contextQuery.isLoading || schoolQuery.isLoading || (!isPlatformOwner && dash.isLoading) || (isPlatformOwner && ownerOverviewQuery.isLoading)) return <SkeletonPage />;
  if (contextQuery.isError || schoolQuery.isError || (!isPlatformOwner && dash.isError) || (isPlatformOwner && ownerOverviewQuery.isError)) {
    return <ErrorState retry={() => {
      contextQuery.refetch();
      schoolQuery.refetch();
      if (isPlatformOwner) ownerOverviewQuery.refetch();
      else dash.refetch();
    }} />;
  }
  
  const school: any = isPlatformOwner ? ownerOverviewQuery.data : schoolQuery.data;
  const data: any = isPlatformOwner ? ownerOverviewQuery.data : dash.data;

  return (
    <div className="fade-up">
      <Link href="/schools" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]" data-testid="link-back-schools">
        <ArrowLeft size={16} />Back to all schools
      </Link>
      
      <PageHeading 
        eyebrow={`School / ${school?.code}`} 
        title={school?.name ?? 'School overview'} 
        description={`${school?.city}, ${school?.state} · joined ${date(school?.createdAt)}`} 
        action={
          <div className="flex flex-wrap gap-2">
            {isPlatformOwner && (
              <Button variant="outline" onClick={() => { setSchoolId(schoolId); setLocation('/'); }} testId="button-open-owner-dashboard">
                <BarChart3 size={16} />Open dashboard snapshot
              </Button>
            )}
            <Button variant="outline" onClick={() => { setSchoolId(schoolId); setLocation('/students'); }} testId="button-open-school-directory">
              <GraduationCap size={16} />Open directory
            </Button>
          </div>
        } 
      />
      
      {isPlatformOwner ? (
        <>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Students" value={data?.studentCount ?? 0} detail={`${data?.activeStudentCount ?? 0} active`} icon={GraduationCap} accent />
            <Metric label="Teachers" value={data?.teacherCount ?? 0} detail={`${data?.employeeCount ?? 0} active employees`} icon={Briefcase} />
            <Metric label="Parent accounts" value={data?.parentCount ?? 0} detail={`${data?.accountantCount ?? 0} accountants`} icon={UsersRound} />
            <Metric label="Classes" value={data?.classCount ?? 0} detail={`${data?.subscriptionCount ?? 0} subscriptions`} icon={BarChart3} />
          </div>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Attendance events" value={data?.attendanceEventCount ?? 0} icon={CircleAlert} />
            <Metric label="Academic results" value={data?.resultCount ?? 0} icon={BarChart3} />
            <Metric label="NFC devices" value={data?.deviceCount ?? 0} icon={Smartphone} />
            <Metric label="NFC cards" value={data?.cardCount ?? 0} detail={`${data?.activeCardCount ?? 0} active`} icon={CreditCard} />
          </div>
        </>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Total students" value={data?.totalStudents ?? 0} detail={`${data?.activeStudents ?? 0} currently active`} icon={GraduationCap} accent />
          <Metric label="Unpaid students" value={data?.unpaidStudents ?? 0} detail="Need subscription follow-up" icon={CircleAlert} />
          <Metric label="Attendance" value="Not available" detail="Attendance is planned for a later phase" icon={BarChart3} accent />
          <Metric label="Active cards" value={data?.activeCards ?? 0} detail={`${data?.lockedCards ?? 0} locked`} icon={CreditCard} />
        </div>
      )}
      
      <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="panel p-6 md:p-8">
          <div className="eyebrow mb-2">{isPlatformOwner ? 'Platform school context' : 'Tenant context'}</div>
          <h2 className="display-font text-2xl font-bold mb-6">{isPlatformOwner ? 'School snapshot' : 'Operational snapshot'}</h2>
          
          <div className="grid gap-4 sm:grid-cols-2">
            <Info label="School code" value={<span className="font-mono">{school?.code}</span>} />
            <Info label="Operational status" value={<span data-testid="operational-school-status"><StatusPill value={isPlatformOwner ? operationalStatusLabel(school) : school?.status} /></span>} />
            <Info label="Subscription health" value={<StatusPill value={school?.subscriptionStatus} />} />
            <Info label={isPlatformOwner ? "Active staff" : "Staff on record"} value={isPlatformOwner ? data?.staffCount ?? 0 : school?.staffCount ?? 0} />
            {isPlatformOwner && <Info label="Parents" value={data?.parentCount ?? 0} />}
            {isPlatformOwner && <Info label="Accountants" value={data?.accountantCount ?? 0} />}
          </div>

          {isPlatformOwner && (
            <>
              <div className="mt-6 rounded-2xl border border-[hsl(var(--border))] p-5">
                <div className="eyebrow mb-3">School administrators</div>
                {school?.administrators?.length ? (
                  <ul className="space-y-2">
                    {school.administrators.map((admin: any) => (
                      <li key={admin.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="font-bold">{admin.name || admin.email}</span>
                        <span className="text-[hsl(var(--muted-foreground))]">{admin.email}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-[hsl(var(--muted-foreground))]">No administrator is assigned yet. If an earlier invitation failed, retry it below.</p>}
                <OwnerAdminInvitationForm schoolId={schoolId} />
              </div>
              <div className="mt-4 rounded-2xl border border-[hsl(var(--border))] p-5">
                <div className="eyebrow mb-2">Onboarding source</div>
                {school?.partnerReferral ? (
                  <div className="space-y-1 text-sm">
                    <div className="font-bold">{school.partnerReferral.partnerName}</div>
                    <div className="text-[hsl(var(--muted-foreground))]">{school.partnerReferral.source.replaceAll('_', ' ')} · Referral #{school.partnerReferral.referralLinkId ?? '—'}</div>
                    <div className="text-[hsl(var(--muted-foreground))]">Registered {date(school.partnerReferral.registrationDate)} · {school.partnerReferral.status}</div>
                  </div>
                ) : <p className="text-sm text-[hsl(var(--muted-foreground))]">Platform Owner / direct onboarding; no current partner attribution.</p>}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/devices"><Button variant="outline"><Smartphone size={15} />NFC devices</Button></Link>
                <Link href="/cards" onClick={() => setSchoolId(schoolId)}><Button variant="outline"><CreditCard size={15} />NFC cards</Button></Link>
                <Link href="/audit" onClick={() => setSchoolId(schoolId)}><Button variant="outline"><FileClock size={15} />Audit log</Button></Link>
                <Link href="/partners"><Button variant="outline"><LinkIcon size={15} />Partner directory</Button></Link>
              </div>
              <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">The school context will be selected automatically when opening its directory, cards, or audit trail.</p>
            </>
          )}
          
          <div className="mt-6 rounded-2xl bg-[hsl(var(--secondary))] p-5 border border-[hsl(var(--border))]">
            <div className="flex items-center gap-2.5 text-sm font-bold text-[hsl(var(--foreground))]">
              <ShieldCheck size={18} className="text-[hsl(var(--primary))]" />
              Data boundary is active
            </div>
            <p className="mt-2 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
              Students, payments and card events shown here belong only to {school?.name}.
            </p>
          </div>
        </div>
        
        <div className="panel p-6 md:p-8">
          <div className="mb-6 flex items-start justify-between">
            <div>
              <div className="eyebrow">School activity</div>
              <h2 className="display-font mt-2 text-2xl font-bold">Recent movement</h2>
            </div>
            <Link href="/audit" className="text-sm font-bold text-[hsl(var(--primary))] hover:underline" data-testid="link-school-audit">Full trail</Link>
          </div>
          <ActivityFeed items={data?.recentActivity} />
        </div>
      </div>
    </div>
  );
}