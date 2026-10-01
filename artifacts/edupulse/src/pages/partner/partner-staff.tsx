import { useGetPartnerProfile } from '@workspace/api-client-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Check, RotateCw, Users, XCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Button, EmptyState, ErrorState, Field, SkeletonPage, StatusPill } from '@/components/shared';

type PartnerStaffMember = {
  userId: number;
  email: string;
  fullName: string;
  role: string;
  status: string;
};

export type PartnerStaffInvitation = {
  id: number;
  email: string;
  recipient: string;
  status: 'PENDING' | 'EXPIRED' | 'DISPATCHING' | 'UNKNOWN_PROVIDER_STATE' | string;
  role: string;
  permission: 'STANDARD' | 'FINANCE' | 'ADMIN' | string;
  invitationAttemptId?: string | null;
  invitationAttemptStatus?: 'FINALIZED' | 'RECOVERED' | string;
  selectedInvitationId?: number | null;
  createdAt?: string | null;
  expiresAt?: string | null;
};

type InvitationActionState = {
  pendingAction?: 'resend' | 'reconcile' | 'revoke';
  message?: string;
  error?: string;
};

const invitationQueryKey = (partnerId: number | undefined) => ['partner-staff-invitations', partnerId];
const staffQueryKey = (partnerId: number | undefined) => ['partner-staff', partnerId];

async function partnerApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result?.error || 'Partner request failed');
  return result as T;
}

function permissionLabel(invitation: PartnerStaffInvitation) {
  const labels: Record<string, string> = {
    STANDARD: 'Partner Staff · Standard',
    FINANCE: 'Partner Staff · Finance',
    ADMIN: 'Partner Administrator',
  };
  return labels[invitation.permission] ??
    invitation.role.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateTime(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('en-NG');
}

function PartnerStaffInvitationList({
  invitations,
  queryKey,
}: {
  invitations: PartnerStaffInvitation[];
  queryKey: readonly unknown[];
}) {
  const queryClient = useQueryClient();
  const [actions, setActions] = useState<Record<number, InvitationActionState>>({});
  const [recentActions, setRecentActions] = useState<Array<{ id: number; recipient: string; message: string }>>([]);
  const inFlight = useRef(new Set<number>());

  const runAction = async (invitation: PartnerStaffInvitation, action: 'resend' | 'reconcile' | 'revoke') => {
    const selectedId = invitation.id;
    if (!Number.isSafeInteger(selectedId) || selectedId < 1 || inFlight.current.has(selectedId)) return;
    inFlight.current.add(selectedId);
    setActions(current => ({
      ...current,
      [selectedId]: { pendingAction: action },
    }));

    try {
      if (action === 'resend' || action === 'reconcile') {
        const replacement = await partnerApi<PartnerStaffInvitation>(
          `/partner/staff-invitations/${selectedId}/resend`,
          {
            method: 'POST',
            ...(action === 'reconcile' ? { body: JSON.stringify({ mode: 'reconcile' }) } : {}),
          },
        );
        const message = replacement.invitationAttemptStatus === 'RECOVERED' || action === 'reconcile'
          ? 'Invitation recovered. No new email was sent.'
          : 'Resend Link request accepted. Email delivery is not verified.';
        setActions(current => ({
          ...current,
          [replacement.id]: { message },
        }));
        queryClient.setQueryData<PartnerStaffInvitation[]>(queryKey, current => {
          if (!current) return current;
          return current
            .map(item => item.id === selectedId ? replacement : item)
            .filter(item => item.status === 'PENDING' || item.status === 'EXPIRED');
        });
        setRecentActions(current => [
          { id: replacement.id, recipient: replacement.recipient || replacement.email, message },
          ...current.filter(item => item.id !== replacement.id),
        ]);
      } else {
        await partnerApi(`/partner/staff-invitations/${selectedId}`, { method: 'DELETE' });
        setActions(current => ({
          ...current,
          [selectedId]: { message: 'Invitation revoked.' },
        }));
        queryClient.setQueryData<PartnerStaffInvitation[]>(queryKey, current =>
          current?.filter(item => item.id !== selectedId),
        );
        setRecentActions(current => [
          { id: selectedId, recipient: invitation.recipient || invitation.email, message: 'Invitation revoked.' },
          ...current.filter(item => item.id !== selectedId),
        ]);
      }
      await queryClient.invalidateQueries({ queryKey });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invitation action failed.';
      setActions(current => ({ ...current, [selectedId]: { error: message } }));
      setRecentActions(current => [
        { id: selectedId, recipient: invitation.recipient || invitation.email, message: `Action failed: ${message}` },
        ...current.filter(item => item.id !== selectedId),
      ]);
      await queryClient.invalidateQueries({ queryKey });
    } finally {
      inFlight.current.delete(selectedId);
      setActions(current => {
        const state = current[selectedId];
        if (!state?.pendingAction) return current;
        return { ...current, [selectedId]: { ...state, pendingAction: undefined } };
      });
    }
  };

  const eligibleInvitations = invitations.filter(invitation =>
    (invitation.status === 'PENDING' || invitation.status === 'EXPIRED' ||
      invitation.status === 'DISPATCHING' || invitation.status === 'UNKNOWN_PROVIDER_STATE') &&
    ['STANDARD', 'FINANCE', 'ADMIN'].includes(invitation.permission) &&
    Number.isSafeInteger(invitation.id) && invitation.id > 0,
  );

  return (
    <section className="panel overflow-hidden" aria-label="Partner staff invitations">
      <div className="border-b border-[hsl(var(--border))] p-5">
        <h2 className="display-font text-xl font-bold">Pending invitations</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
          Pending and expired invitations can be resent or revoked. Unresolved attempts can only be reconciled; recovery does not send another email.
        </p>
      </div>
      {eligibleInvitations.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="bg-[hsl(var(--muted)/.4)] text-xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              <tr>
                <th className="p-4">Recipient</th>
                <th className="p-4">Email</th>
                <th className="p-4">Role / permission</th>
                <th className="p-4">Status</th>
                <th className="p-4">Sent</th>
                <th className="p-4">Expires</th>
                <th className="p-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[hsl(var(--border))]">
              {eligibleInvitations.map(invitation => {
                const action = actions[invitation.id];
                const recipient = invitation.recipient || invitation.email;
                const recoveryRequired = invitation.status === 'DISPATCHING' ||
                  invitation.status === 'UNKNOWN_PROVIDER_STATE';
                return (
                  <tr key={invitation.id} data-testid={`row-partner-invitation-${invitation.id}`}>
                    <td className="p-4 font-semibold" data-testid={`text-invitation-recipient-${invitation.id}`}>{recipient}</td>
                    <td className="p-4 text-[hsl(var(--muted-foreground))]" data-testid={`text-invitation-email-${invitation.id}`}>{invitation.email}</td>
                    <td className="p-4" data-testid={`text-invitation-role-${invitation.id}`}>{permissionLabel(invitation)}</td>
                    <td className="p-4"><StatusPill value={invitation.status} /></td>
                    <td className="p-4 text-xs text-[hsl(var(--muted-foreground))]">{dateTime(invitation.createdAt)}</td>
                    <td className="p-4 text-xs text-[hsl(var(--muted-foreground))]">{dateTime(invitation.expiresAt)}</td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          className="h-8 px-3 text-xs"
                          disabled={!!action?.pendingAction}
                          onClick={() => void runAction(invitation, recoveryRequired ? 'reconcile' : 'resend')}
                          testId={recoveryRequired
                            ? `button-reconcile-partner-invitation-${invitation.id}`
                            : `button-resend-partner-invitation-${invitation.id}`}
                        >
                          <RotateCw size={13} />
                          {action?.pendingAction === 'resend'
                            ? 'Resending…'
                            : action?.pendingAction === 'reconcile'
                              ? 'Checking status…'
                              : recoveryRequired ? 'Retry reconciliation' : 'Resend Link'}
                        </Button>
                        {!recoveryRequired && (
                          <Button
                            variant="quiet"
                            className="h-8 px-2 text-xs"
                            disabled={!!action?.pendingAction}
                            onClick={() => void runAction(invitation, 'revoke')}
                            testId={`button-revoke-partner-invitation-${invitation.id}`}
                          >
                            <XCircle size={13} />
                            {action?.pendingAction === 'revoke' ? 'Cancelling…' : 'Cancel'}
                          </Button>
                        )}
                      </div>
                      {action?.pendingAction && (
                        <p role="status" data-testid={`status-invitation-action-${invitation.id}`} className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                          {action.pendingAction === 'resend'
                            ? 'Requesting a replacement invitation…'
                            : action.pendingAction === 'reconcile'
                              ? 'Checking the existing invitation attempt. No new email will be sent.'
                              : 'Revoking invitation…'}
                        </p>
                      )}
                      {action?.error && (
                        <p role="alert" data-testid={`error-invitation-action-${invitation.id}`} className="mt-2 text-xs text-[hsl(var(--destructive))]">
                          {action.error}
                        </p>
                      )}
                      {action?.message && (
                        <p role="status" data-testid={`status-invitation-action-${invitation.id}`} className="mt-2 text-xs text-emerald-700">
                          <Check size={12} className="mr-1 inline" />{action.message}
                        </p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!eligibleInvitations.length && <div className="p-6 text-sm text-[hsl(var(--muted-foreground))]">No pending invitations.</div>}
        </div>
      ) : (
        <div className="p-6 text-sm text-[hsl(var(--muted-foreground))]">No pending invitations.</div>
      )}
      {!!recentActions.length && (
        <div className="border-t border-[hsl(var(--border))] p-4" aria-label="Recent invitation actions">
          {recentActions.slice(0, 3).map(result => (
            <p key={`${result.id}-${result.message}`} data-testid={`status-invitation-action-${result.id}`} className="py-1 text-xs text-[hsl(var(--muted-foreground))]">
              {result.recipient}: {result.message}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

function StaffAccessControl({ member }: { member: PartnerStaffMember }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const permissionForRole: Record<string, string> = {
    PARTNER_STAFF: 'STANDARD',
    PARTNER_FINANCE: 'FINANCE',
    PARTNER_ADMIN: 'ADMIN',
  };
  const initialPermission = permissionForRole[member.role] ?? 'STANDARD';
  const [permission, setPermission] = useState(initialPermission);
  const [savedPermission, setSavedPermission] = useState(initialPermission);
  const update = useMutation({
    mutationFn: () => partnerApi(`/partner/staff/${member.userId}/permissions`, {
      method: 'PATCH',
      body: JSON.stringify({ permission }),
    }),
    onSuccess: () => {
      setSavedPermission(permission);
      toast({ title: 'Staff access updated' });
      queryClient.invalidateQueries({ queryKey: ['partner-staff'] });
    },
    onError: (error: Error) => toast({
      title: 'Could not update access', description: error.message, variant: 'destructive',
    }),
  });
  return (
    <div className="flex items-end gap-3">
      <div className="flex-1">
        <Field label="Permissions">
          <select value={permission} onChange={(event) => setPermission(event.target.value)}>
            <option value="STANDARD">Standard staff — schools & referrals</option>
            <option value="FINANCE">Finance — commissions & payout reports</option>
            <option value="ADMIN">Administrator — staff, profile & payout settings</option>
          </select>
        </Field>
      </div>
      <Button type="button" variant="outline" disabled={update.isPending || permission === savedPermission}
        onClick={() => update.mutate()}>
        {update.isPending ? 'Saving…' : 'Save access'}
      </Button>
    </div>
  );
}

export default function PartnerStaff() {
  const profile = useGetPartnerProfile();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<'STANDARD' | 'FINANCE' | 'ADMIN'>('STANDARD');
  const partnerId = profile.data?.id;
  const isOwner = !!(profile.data as any)?.isOwner ||
    ['PARTNER_OWNER', 'PARTNER_ADMIN'].includes((profile.data as any)?.partnerRole);
  const staff = useQuery({
    queryKey: staffQueryKey(partnerId),
    enabled: isOwner && partnerId != null,
    queryFn: () => partnerApi<PartnerStaffMember[]>('/partner/staff'),
  });
  const invitations = useQuery({
    queryKey: invitationQueryKey(partnerId),
    enabled: isOwner && partnerId != null,
    queryFn: () => partnerApi<PartnerStaffInvitation[]>('/partner/staff/invitations'),
  });
  const invite = useMutation({
    mutationFn: (input: { email: string; permission: string }) => partnerApi('/partner/staff-invitations', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    onSuccess: (_result, variables) => {
      toast({
        title: 'Invitation request accepted',
        description: `Clerk accepted the invitation request for ${variables.email}; email delivery is not verified.`,
      });
      setEmail('');
      setPermission('STANDARD');
      queryClient.invalidateQueries({ queryKey: invitationQueryKey(partnerId) });
    },
    onError: (error: Error) => toast({
      title: 'Invitation failed', description: error.message, variant: 'destructive',
    }),
  });

  if (profile.isLoading) return <SkeletonPage />;
  if (profile.isError || !profile.data) return (
    <ErrorState message={(profile.error as Error)?.message ?? 'Partner profile could not be loaded.'} retry={() => void profile.refetch()} />
  );
  if (!isOwner) {
    return <div className="mx-auto max-w-3xl p-8"><div className="panel p-8 text-center">
      <h1 className="display-font text-2xl font-bold">Partner owner access required</h1>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Only a partner owner or administrator can manage staff invitations.</p>
    </div></div>;
  }
  if (staff.isLoading || invitations.isLoading) return <SkeletonPage />;
  if (staff.isError) return <ErrorState message={(staff.error as Error).message} retry={() => void staff.refetch()} />;

  return (
    <div className="mx-auto max-w-5xl p-5 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-7">
        <div className="eyebrow">Partner access</div>
        <h1 className="display-font mt-2 text-3xl font-bold">Partner Staff</h1>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Invite staff through Clerk. Recipients set their own password; staff do not receive partner-owner controls.</p>
      </div>
      <form className="panel mb-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          const normalizedEmail = email.trim();
          if (normalizedEmail) invite.mutate({ email: normalizedEmail, permission });
        }}>
        <div className="flex-1">
          <Field label="Staff email address">
            <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)}
              placeholder="staff@example.com" autoComplete="email" data-testid="input-partner-staff-email" />
          </Field>
        </div>
        <div className="sm:w-56">
          <Field label="Access level">
            <select value={permission} onChange={(event) => setPermission(event.target.value as typeof permission)} data-testid="select-partner-staff-permission">
              <option value="STANDARD">Standard staff</option>
              <option value="FINANCE">Finance reports</option>
              <option value="ADMIN">Partner administrator</option>
            </select>
          </Field>
        </div>
        <Button type="submit" disabled={invite.isPending || !email.trim()} testId="button-invite-partner-staff">
          {invite.isPending ? 'Sending invitation…' : 'Invite staff'}
        </Button>
      </form>
      {invitations.isError && <div className="mb-4 text-sm text-[hsl(var(--destructive))]" role="alert">{(invitations.error as Error).message}</div>}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel overflow-hidden">
          <div className="border-b border-[hsl(var(--border))] p-5">
            <h2 className="display-font text-xl font-bold">Active staff</h2>
          </div>
          {(staff.data ?? []).length ? (staff.data ?? []).map(member => (
            <div key={member.userId} className="border-b border-[hsl(var(--border)/.6)] p-4 last:border-0">
              <div className="mb-3 flex items-center justify-between">
                <div><div className="font-semibold">{member.fullName || member.email}</div><div className="text-sm text-[hsl(var(--muted-foreground))]">{member.email}</div></div>
                <StatusPill value={member.status} />
              </div>
              <StaffAccessControl member={member} />
            </div>
          )) : <EmptyState icon={Users} title="No staff yet" description="Send a secure invitation to add a partner staff member." />}
        </section>
        {invitations.data && (
          <PartnerStaffInvitationList
            invitations={invitations.data}
            queryKey={invitationQueryKey(partnerId)}
          />
        )}
      </div>
    </div>
  );
}