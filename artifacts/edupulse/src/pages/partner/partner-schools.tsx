import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useAuth } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, RefreshCw } from 'lucide-react';
import {
  useCreateMyPartnerSchool, useResendMyPartnerSchoolInvitation, useListMyPartnerSchools,
  useGetPartnerProfile, getListMyPartnerSchoolsQueryKey, getGetPartnerDashboardQueryKey,
  type PartnerSchool,
} from '@workspace/api-client-react';
import { Button, EmptyState, ErrorState, Field, SkeletonPage, StatusPill } from '@/components/shared';

export type PartnerSchoolRow = PartnerSchool;

const fmt = (v?: string | null) => (v ? new Date(v).toLocaleDateString() : '-');
export const canManagePartnerSchools = (profile: any) =>
  !!profile && (profile.isOwner === true || ['PARTNER_OWNER', 'PARTNER_ADMIN'].includes(profile.partnerRole));

/** Cache is scoped to the signed-in identity; prefix stays the generated key so generic invalidation still matches. */
export function usePartnerSchools() {
  const { userId } = useAuth();
  return useListMyPartnerSchools({
    query: {
      queryKey: [...getListMyPartnerSchoolsQueryKey(), userId ?? 'anonymous'],
      enabled: !!userId,
      refetchInterval: 15000,
      refetchOnWindowFocus: true,
      gcTime: 0,
    },
  });
}

function useRefreshPartnerLists() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: getListMyPartnerSchoolsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetPartnerDashboardQueryKey() });
  };
}

export function invitationExplanation(s: PartnerSchool) {
  if (s.registrationStatus === 'ACTIVE') return 'The administrator accepted the invitation and the school is registered.';
  if (s.invitationStatus === 'PENDING') return 'Invitation request accepted by the provider; the administrator has not accepted yet. Inbox delivery is unverified.';
  if (s.invitationStatus === 'ACCEPTED') return 'Invitation accepted; registration is being finalised.';
  return 'The invitation state is uncertain (it may be expired, revoked or unconfirmed). Resend is unavailable; contact support.';
}
export const canResend = (s: PartnerSchool) =>
  s.registrationStatus === 'PENDING' && s.invitationStatus === 'PENDING' && !!s.invitationId;

const empty = { name: '', city: '', state: '', phone: '', email: '', fullName: '', adminEmail: '', adminPhone: '' };

export function AddSchoolForm({ onDone }: { onDone?: () => void }) {
  const qc = useQueryClient();
  const { userId } = useAuth();
  const refresh = useRefreshPartnerLists();
  const [f, setF] = useState(empty);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [review, setReview] = useState(false);
  const inflight = useRef(false);
  const create = useCreateMyPartnerSchool();
  const set = (k: keyof typeof empty) => (e: any) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (inflight.current || review) return;
    inflight.current = true;
    setError('');
    setNotice('');
    const sub = { ...f };
    try {
      const result = await create.mutateAsync({
        data: {
          school: {
            name: sub.name.trim(), city: sub.city.trim(), state: sub.state.trim(),
            ...(sub.phone.trim() ? { phone: sub.phone.trim() } : {}),
            ...(sub.email.trim() ? { email: sub.email.trim() } : {}),
          },
          administrator: { fullName: sub.fullName.trim(), email: sub.adminEmail.trim(), phone: sub.adminPhone.trim() },
        },
      });
      // Show the confirmed pending row immediately; the refetch replaces it with server truth.
      qc.setQueryData<PartnerSchool[]>([...getListMyPartnerSchoolsQueryKey(), userId ?? 'anonymous'], (old = []) => [
        {
          schoolId: result.schoolId, schoolName: sub.name.trim(), schoolCode: null,
          attributionStatus: 'ACTIVE', attributionSource: 'PARTNER_ADDED',
          startDate: new Date().toISOString(), adminName: sub.fullName.trim(),
          adminEmail: sub.adminEmail.trim(), adminPhone: sub.adminPhone.trim(),
          registrationStatus: 'PENDING', invitationId: result.administratorInvitation.invitationId,
          invitationStatus: 'PENDING', invitationSentAt: null, acceptedAt: null,
          dateAdded: new Date().toISOString(), totalStudents: 0, subscriptionStatus: '-',
        } as unknown as PartnerSchool,
        ...old.filter(r => r.schoolId !== result.schoolId),
      ]);
      setNotice('School saved as Pending. The provider accepted the invitation request; inbox delivery is unverified until the administrator accepts.');
      setF(empty);
      refresh();
      onDone?.();
    } catch (err: any) {
      const status = err?.status;
      if (status === 409) setError(err.message || 'A school like this may already exist. Check My Schools.');
      else if (status === 400 || status === 403 || status === 422) setError(err.message || 'The request was rejected.');
      else {
        setReview(true);
        setError(`${err?.message ?? 'The outcome could not be confirmed.'} Check My Schools before retrying; the school and invitation may already exist.`);
        refresh();
      }
    } finally {
      inflight.current = false;
    }
  };

  return (
    <form onSubmit={submit} className="panel space-y-5 p-6 md:p-8" data-testid="form-add-school">
      <div className="eyebrow">School Information</div>
      <Field label="School Name"><input required minLength={2} value={f.name} onChange={set('name')} data-testid="input-school-name" /></Field>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="City"><input required value={f.city} onChange={set('city')} data-testid="input-school-city" /></Field>
        <Field label="State"><input required value={f.state} onChange={set('state')} data-testid="input-school-state" /></Field>
        <Field label="School Phone (optional)"><input value={f.phone} onChange={set('phone')} data-testid="input-school-phone" /></Field>
        <Field label="School Email (optional)"><input type="email" value={f.email} onChange={set('email')} data-testid="input-school-email" /></Field>
      </div>
      <div className="eyebrow border-t border-[hsl(var(--border))] pt-5">School Administrator Information</div>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">The administrator creates their own password through the invitation.</p>
      <div className="grid gap-5 md:grid-cols-3">
        <Field label="Admin Full Name"><input required minLength={2} value={f.fullName} onChange={set('fullName')} data-testid="input-admin-name" /></Field>
        <Field label="Admin Email"><input required type="email" value={f.adminEmail} onChange={set('adminEmail')} data-testid="input-admin-email" /></Field>
        <Field label="Admin Phone Number"><input required value={f.adminPhone} onChange={set('adminPhone')} data-testid="input-admin-phone" /></Field>
      </div>
      {error && <p role="alert" className="text-sm font-medium text-[hsl(var(--destructive))]">{error}</p>}
      {notice && (
        <p role="status" className="text-sm font-medium text-[hsl(var(--primary))]" data-testid="text-add-school-notice">
          {notice} <Link href="/partner/schools" className="underline" data-testid="link-view-my-schools">View My Schools</Link>
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={create.isPending || review} testId="button-send-school-invitation">
          {create.isPending ? 'Sending...' : 'Send School Invitation'}
        </Button>
      </div>
    </form>
  );
}

export function AddSchoolPage() {
  const profile = useGetPartnerProfile();
  if (profile.isLoading) return <SkeletonPage />;
  if (profile.isError || !canManagePartnerSchools(profile.data)) {
    return (
      <div className="mx-auto max-w-3xl p-8" data-testid="add-school-forbidden">
        <div className="panel p-8 text-center">
          <h1 className="display-font text-2xl font-bold">Partner administrator access required</h1>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Only a partner owner or administrator can add schools.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-4xl p-5 md:p-8">
      <div className="mb-7">
        <div className="eyebrow">Network</div>
        <h1 className="display-font mt-2 text-3xl font-bold">Add School</h1>
      </div>
      <AddSchoolForm />
    </div>
  );
}

export function AddSchoolButton({ href = '/partner/schools/add' }: { href?: string }) {
  return (
    <Link href={href} data-testid="link-add-school" className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-bold text-[hsl(var(--primary-foreground))]">
      <Plus size={16} /> Add School
    </Link>
  );
}

export function MySchoolsTable({ canManage }: { canManage: boolean }) {
  const refresh = useRefreshPartnerLists();
  const query = usePartnerSchools();
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const busyRef = useRef(new Set<string>());
  const [open, setOpen] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const resendMut = useResendMyPartnerSchoolInvitation();

  const resend = async (s: PartnerSchool) => {
    if (!canResend(s)) return;
    const invitationId = s.invitationId as string;
    const key = `${s.schoolId}:${invitationId}`;
    if (busyRef.current.has(key)) return;
    busyRef.current.add(key);
    setBusy(new Set(busyRef.current));
    setErr(''); setMsg('');
    try {
      const r = await resendMut.mutateAsync({ schoolId: s.schoolId, invitationId, data: {} });
      setMsg(`Resend request accepted for ${r.email}. Inbox delivery is unverified.`);
    } catch (e: any) {
      setErr(e?.status === 404 || e?.status === 409
        ? 'This invitation is no longer current. The list was refreshed; review the new status.'
        : `${e?.message ?? 'The outcome could not be confirmed.'} The list was refreshed; check status before trying again.`);
    } finally {
      busyRef.current.delete(key);
      setBusy(new Set(busyRef.current));
      refresh();
    }
  };

  if (query.isLoading) return <SkeletonPage />;
  if (query.isError) return <ErrorState retry={() => query.refetch()} />;
  const schools = query.data ?? [];
  if (!schools.length) {
    return <EmptyState icon={Building2} title="No schools yet" description="Add a school to send its administrator an invitation." action={canManage ? <AddSchoolButton /> : undefined} />;
  }
  return (
    <div>
      {msg && <p role="status" className="p-3 text-sm">{msg}</p>}
      {err && <p role="alert" className="p-3 text-sm text-[hsl(var(--destructive))]">{err}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm" data-testid="table-my-schools">
          <thead className="bg-[hsl(var(--muted)/.4)] font-bold text-[hsl(var(--muted-foreground))]">
            <tr>
              <th className="p-4">School</th><th className="p-4">Admin</th><th className="p-4">Status</th>
              <th className="p-4">Invitation</th><th className="p-4">Dates</th><th className="p-4">Students</th>
              <th className="p-4">Subscription</th><th className="p-4">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[hsl(var(--border))]">
            {schools.map(s => {
              const key = `${s.schoolId}:${s.invitationId}`;
              const pending = s.registrationStatus === 'PENDING';
              const isOpen = open === s.schoolId;
              return (
                <tr key={s.schoolId} data-testid={`row-school-${s.schoolId}`}>
                  <td className="p-4"><div className="font-bold">{s.schoolName}</div><div className="font-mono text-xs text-[hsl(var(--muted-foreground))]">{s.schoolCode}</div></td>
                  <td className="p-4"><div>{s.adminName ?? '-'}</div><div className="text-xs">{s.adminEmail}</div><div className="text-xs">{s.adminPhone}</div></td>
                  <td className="p-4"><StatusPill value={pending ? 'Pending' : s.registrationStatus === 'ACTIVE' ? 'Active' : (s.registrationStatus ?? '-')} /></td>
                  <td className="p-4"><StatusPill value={s.invitationStatus === 'UNKNOWN' ? 'Uncertain' : (s.invitationStatus ?? '-')} /></td>
                  <td className="p-4 text-xs">Added {fmt(s.dateAdded)}<br />Sent {fmt(s.invitationSentAt)}<br />Accepted {fmt(s.acceptedAt)}</td>
                  <td className="p-4">{s.totalStudents ?? '-'}</td>
                  <td className="p-4">{s.subscriptionStatus ? <StatusPill value={s.subscriptionStatus} /> : '-'}</td>
                  <td className="p-4 space-y-2">
                    <Button variant="quiet" onClick={() => setOpen(isOpen ? null : s.schoolId)} testId={`button-status-${s.schoolId}`}>View Status</Button>
                    {canManage && canResend(s) && (
                      <Button variant="outline" onClick={() => resend(s)} disabled={busy.has(key)} testId={`button-resend-${s.schoolId}`}>
                        <RefreshCw size={14} />{busy.has(key) ? 'Resending...' : 'Resend Invitation'}
                      </Button>
                    )}
                    {isOpen && <p className="max-w-[220px] text-xs" data-testid={`text-status-detail-${s.schoolId}`}>{invitationExplanation(s)}</p>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
