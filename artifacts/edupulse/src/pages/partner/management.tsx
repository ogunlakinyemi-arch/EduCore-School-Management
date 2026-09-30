import { useState } from 'react';
import { Route, Switch, Link, useLocation } from 'wouter';
import { useMutation, useQuery } from '@tanstack/react-query';
import { 
  useListPartners, 
  useCreatePartnerInvitation,
  useGetPartner,
  useUpdatePartnerStatus,
  useListPartnerSchools,
  useListPartnerCommissions,
  useListPartnerPayouts,
  useListPlatformPartnerPayouts,
  useUpdatePartnerCommissionStatus,
  useUpdatePartnerPayout,
  useListPartnerAttributionConflicts,
  useResolvePartnerAttributionConflict,
  useCreatePartnerPayout
} from '@workspace/api-client-react';
import { 
  PageHeading, 
  Button, 
  StatusPill, 
  money, 
  date, 
  SkeletonPage, 
  EmptyState,
  ErrorState,
  Modal,
  Field,
  cx,
  Metric
} from '@/components/shared';
import { Handshake, UserPlus, FileCheck, CheckCircle2, XCircle, Search, ExternalLink, RefreshCw, HandCoins, AlertTriangle, AlertCircle, Pencil, Send } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import NotFound from '@/pages/not-found';

const inviteSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2),
  businessName: z.string().optional(),
  phone: z.string().optional(),
  partnerType: z.enum(['INDIVIDUAL', 'BUSINESS']).default('BUSINESS'),
});

const invitationEmailSchema = z.object({ email: z.string().email() });

type PlatformPartnerInvitation = {
  id: number;
  partnerId: number;
  email: string;
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'DISPATCHING' | 'UNKNOWN_PROVIDER_STATE' | 'FAILED' | 'RATE_LIMITED';
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
};

async function platformPartnerRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || 'Partner invitation request failed');
  return result as T;
}

function PartnersOverview() {
  const query = useListPartners();
  const invitations = useQuery({
    queryKey: ['platformPartnerInvitations'],
    queryFn: () => platformPartnerRequest<PlatformPartnerInvitation[]>('/platform/partners/invitations'),
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showInvite, setShowInvite] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingInvitation, setEditingInvitation] = useState<PlatformPartnerInvitation | null>(null);
  const updateInvitationEmail = useMutation({
    mutationFn: ({ partnerId, email }: { partnerId: number; email: string }) =>
      platformPartnerRequest(`/platform/partners/${partnerId}`, {
        method: 'PATCH',
        body: JSON.stringify({ email }),
      }),
    onSuccess: async () => {
      toast({ title: 'Invitation email updated', description: 'The previous invitation was superseded.' });
      setEditingInvitation(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['platformPartnerInvitations'] }),
        queryClient.invalidateQueries({ queryKey: ['listPartners'] }),
      ]);
    },
    onError: (error: Error) => toast({
      title: 'Email update failed',
      description: error.message,
      variant: 'destructive',
    }),
  });
  const resendInvitation = useMutation({
    mutationFn: ({ partnerId }: { partnerId: number; reconcile: boolean }) =>
      platformPartnerRequest(`/platform/partners/${partnerId}/invitations/resend`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: async (_result, { reconcile }) => {
      toast(reconcile
        ? { title: 'Invitation reconciliation completed', description: 'The existing provider attempt was reconciled; no new invitation was sent.' }
        : { title: 'Replacement invitation requested', description: 'The invitation list will refresh shortly.' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['platformPartnerInvitations'] }),
        queryClient.invalidateQueries({ queryKey: ['listPartners'] }),
      ]);
    },
    onError: async (error: Error, { reconcile }) => {
      toast({
        title: reconcile ? 'Invitation remains unresolved' : 'Resend failed',
        description: reconcile
          ? `${error.message} No blind resend was attempted; use Retry reconciliation again when provider state is available.`
          : error.message,
        variant: 'destructive',
      });
      if (reconcile) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['platformPartnerInvitations'] }),
          queryClient.invalidateQueries({ queryKey: ['listPartners'] }),
        ]);
      }
    },
  });
  
  if (query.isLoading) return <SkeletonPage />;
  if (query.isError) return <ErrorState retry={() => query.refetch()} />;

  const partners = query.data ?? [];
  const latestInvitationByPartner = new Map<number, PlatformPartnerInvitation>();
  for (const invitation of invitations.data ?? []) {
    const current = latestInvitationByPartner.get(invitation.partnerId);
    const invitationTime = Date.parse(invitation.createdAt || invitation.updatedAt || invitation.expiresAt || '') || invitation.id;
    const currentTime = current
      ? Date.parse(current.createdAt || current.updatedAt || current.expiresAt || '') || current.id
      : -1;
    if (!current || invitationTime >= currentTime) latestInvitationByPartner.set(invitation.partnerId, invitation);
  }
  const filtered = partners.filter(p => 
    p.fullName.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (p.businessName && p.businessName.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeading 
        eyebrow="Ecosystem" 
        title="Partners & Resellers" 
        description="Manage your network of affiliates, resellers, and consultants."
        action={<Button onClick={() => setShowInvite(true)}><UserPlus size={16} />Invite partner</Button>}
      />
      
      <div className="mb-6 flex gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" size={16} />
          <input 
            type="text" 
            placeholder="Search partners by name, email or business..." 
            className="pl-9"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[hsl(var(--muted)/.4)] font-bold text-[hsl(var(--muted-foreground))]">
              <tr>
                <th className="p-4">Partner</th>
                <th className="p-4">Type</th>
                <th className="p-4">Contact</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[hsl(var(--border))]">
              {filtered.map(partner => (
                <tr key={partner.id} className="transition-colors hover:bg-[hsl(var(--muted)/.2)]">
                  <td className="p-4">
                    <div className="font-bold text-[hsl(var(--foreground))]">{partner.fullName}</div>
                    {partner.businessName && <div className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">{partner.businessName}</div>}
                    <div className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))] uppercase font-mono tracking-wider">{partner.partnerCode}</div>
                  </td>
                  <td className="p-4">
                    <span className="inline-flex items-center rounded-md bg-[hsl(var(--primary)/.1)] px-2 py-1 text-xs font-semibold text-[hsl(var(--primary))] dark:text-[hsl(var(--primary-foreground))]">
                      {partner.partnerType}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className="text-[hsl(var(--foreground))]">{partner.email}</div>
                    {partner.phone && <div className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">{partner.phone}</div>}
                  </td>
                <td className="p-4">
                  {(() => {
                    const invitation = latestInvitationByPartner.get(partner.id);
                    const status = invitation?.status ?? (partner.status === 'INVITED' ? 'PENDING' : partner.status);
                    const isUnresolved = status === 'DISPATCHING' || status === 'UNKNOWN_PROVIDER_STATE';
                    const label = status === 'PENDING' ? 'Pending' : status === 'ACTIVE' ? 'Active' :
                      status === 'DISPATCHING' ? 'Dispatch in progress' :
                        status === 'UNKNOWN_PROVIDER_STATE' ? 'Provider state unknown' :
                          status === 'RATE_LIMITED' ? 'Rate limited' : status === 'FAILED' ? 'Failed' : status;
                    return <div className="space-y-1">
                      <StatusPill value={status} />
                      <div className="text-xs text-[hsl(var(--muted-foreground))]">Invitation: {label}</div>
                      {isUnresolved && <div className="max-w-xs text-xs text-amber-700 dark:text-amber-300" role="status">
                        Provider state is unresolved. Do not send another invitation; reconcile the existing attempt.
                      </div>}
                      {status === 'RATE_LIMITED' && <div className="max-w-xs text-xs text-[hsl(var(--muted-foreground))]">
                        Resend is available; the server enforces the provider cooldown.
                      </div>}
                    </div>;
                  })()}
                </td>
                  <td className="p-4 text-right">
                  <div className="flex justify-end gap-2">
                    {(() => {
                      const invitation = latestInvitationByPartner.get(partner.id);
                      const invitationStatus = invitation?.status ?? (partner.status === 'INVITED' ? 'PENDING' : partner.status);
                      const isUnresolved = invitationStatus === 'DISPATCHING' || invitationStatus === 'UNKNOWN_PROVIDER_STATE';
                      const canResendInvitation = invitationStatus === 'PENDING' || invitationStatus === 'EXPIRED' ||
                        invitationStatus === 'FAILED' || invitationStatus === 'RATE_LIMITED';
                      const canManageInvitation = canResendInvitation || isUnresolved;
                      return canManageInvitation && <>
                        {invitationStatus === 'PENDING' && <Button
                          variant="outline"
                          className="h-8 px-3 text-xs"
                          disabled={updateInvitationEmail.isPending || invitations.isError}
                          onClick={() => setEditingInvitation(invitation ?? {
                            id: 0,
                            partnerId: partner.id,
                            email: partner.email,
                            status: 'PENDING',
                          })}
                          aria-label={`Edit invitation email for ${partner.fullName}`}
                        ><Pencil size={13} />Edit email</Button>}
                        <Button
                          className="h-8 px-3 text-xs"
                          disabled={resendInvitation.isPending || invitations.isError}
                          onClick={() => resendInvitation.mutate({ partnerId: partner.id, reconcile: isUnresolved })}
                          aria-label={isUnresolved
                            ? `Retry invitation reconciliation for ${partner.fullName}`
                            : `Resend invitation for ${partner.fullName}`}
                        ><Send size={13} />{isUnresolved ? 'Retry reconciliation' : 'Resend'}</Button>
                      </>;
                    })()}
                    <Link href={`/partners/${partner.id}`}>
                      <Button variant="outline" className="h-8 text-xs py-0 px-3">View details</Button>
                    </Link>
                  </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-[hsl(var(--muted-foreground))]">
                    No partners found matching your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {invitations.isError && (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-[hsl(var(--destructive)/.35)] bg-[hsl(var(--destructive)/.06)] p-4 text-sm" role="alert">
          <span>Invitation statuses could not be loaded: {(invitations.error as Error).message}</span>
          <Button variant="outline" className="h-8 px-3 text-xs" onClick={() => invitations.refetch()}>
            <RefreshCw size={13} />Refresh
          </Button>
        </div>
      )}

      {showInvite && <InvitePartnerModal onClose={() => setShowInvite(false)} />}
      {editingInvitation && <EditPartnerInvitationModal
        invitation={editingInvitation}
        isPending={updateInvitationEmail.isPending}
        onClose={() => setEditingInvitation(null)}
        onSave={(email) => updateInvitationEmail.mutate({ partnerId: editingInvitation.partnerId, email })}
      />}
    </div>
  );
}

function EditPartnerInvitationModal({
  invitation,
  isPending,
  onClose,
  onSave,
}: {
  invitation: PlatformPartnerInvitation;
  isPending: boolean;
  onClose: () => void;
  onSave: (email: string) => void;
}) {
  const form = useForm<z.infer<typeof invitationEmailSchema>>({
    resolver: zodResolver(invitationEmailSchema),
    defaultValues: { email: invitation.email },
  });

  return (
    <Modal title="Edit invitation email" eyebrow="Partner access" onClose={onClose}>
      <form onSubmit={form.handleSubmit(({ email }) => onSave(email))} className="space-y-5">
        <Field label="Email address" error={form.formState.errors.email?.message}>
          <input type="email" {...form.register('email')} />
        </Field>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Saving updates the partner email and supersedes the previous invitation.
        </p>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isPending}>{isPending ? 'Saving…' : 'Save email'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function InvitePartnerModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const invite = useCreatePartnerInvitation();
  const form = useForm<z.infer<typeof inviteSchema>>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '', fullName: '', businessName: '', phone: '', partnerType: 'BUSINESS' }
  });

  const onSubmit = form.handleSubmit((data) => {
    invite.mutate({ data: data as any }, {
      onSuccess: () => {
        toast({
          title: 'Invitation request accepted',
          description: `Clerk accepted the invitation request for ${data.email}; inbox delivery is not verified.`,
        });
        queryClient.invalidateQueries({ queryKey: ['listPartners'] });
        onClose();
      },
      onError: (err: any) => {
        toast({ title: 'Error', description: err.error || 'Failed to send invitation', variant: 'destructive' });
      }
    });
  });

  return (
    <Modal title="Invite a Partner" eyebrow="Ecosystem" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-5">
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Full Name" error={form.formState.errors.fullName?.message}>
            <input {...form.register('fullName')} placeholder="e.g. Jane Doe" />
          </Field>
          <Field label="Email Address" error={form.formState.errors.email?.message}>
            <input type="email" {...form.register('email')} placeholder="partner@example.com" />
          </Field>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Business Name (Optional)" error={form.formState.errors.businessName?.message}>
            <input {...form.register('businessName')} placeholder="e.g. EduConsulting Ltd" />
          </Field>
          <Field label="Phone Number (Optional)" error={form.formState.errors.phone?.message}>
            <input {...form.register('phone')} placeholder="+234..." />
          </Field>
        </div>
        <Field label="Partner Type" error={form.formState.errors.partnerType?.message}>
          <select {...form.register('partnerType')}>
            <option value="BUSINESS">Business</option>
            <option value="INDIVIDUAL">Individual</option>
          </select>
        </Field>
        <div className="pt-2 flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={invite.isPending}>
            {invite.isPending ? 'Sending...' : 'Send Invitation'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PartnerDetail({ id }: { id: number }) {
  const query = useGetPartner(id);
  const [, setLocation] = useLocation();
  const updateStatus = useUpdatePartnerStatus();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  if (query.isLoading) return <SkeletonPage />;
  if (query.isError || !query.data) return <ErrorState retry={() => query.refetch()} />;
  
  const partner = query.data;

  const handleStatusChange = (newStatus: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED') => {
    updateStatus.mutate({ partnerId: id, data: { status: newStatus as any } }, {
      onSuccess: () => {
        toast({ title: 'Status updated', description: `Partner status changed to ${newStatus}` });
        queryClient.invalidateQueries({ queryKey: ['getPartner', id] });
      }
    });
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-6 flex items-center gap-3">
        <Button variant="quiet" className="h-8 w-8 p-0 rounded-full" onClick={() => setLocation('/partners')}>
          <XCircle size={18} className="rotate-45" />
        </Button>
        <div className="text-sm font-bold text-[hsl(var(--muted-foreground))]">Back to Partners</div>
      </div>
      
      <div className="panel p-6 md:p-8 mb-8 flex flex-col md:flex-row gap-6 justify-between items-start md:items-center">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className="inline-flex items-center rounded-md bg-[hsl(var(--primary)/.1)] px-2.5 py-1 text-xs font-bold text-[hsl(var(--primary))] dark:text-[hsl(var(--primary-foreground))] uppercase tracking-wider">
              {partner.partnerType}
            </span>
            <StatusPill value={partner.status} />
            <span className="font-mono text-sm text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] px-2 py-0.5 rounded-md">
              {partner.partnerCode}
            </span>
          </div>
          <h1 className="display-font text-3xl font-bold">{partner.fullName}</h1>
          {partner.businessName && <div className="mt-1 text-lg text-[hsl(var(--muted-foreground))]">{partner.businessName}</div>}
          <div className="mt-4 flex flex-wrap gap-4 text-sm text-[hsl(var(--muted-foreground))]">
            <div><strong>Email:</strong> {partner.email}</div>
            {partner.phone && <div><strong>Phone:</strong> {partner.phone}</div>}
            <div><strong>Joined:</strong> {date(partner.createdAt)}</div>
          </div>
        </div>
        <div className="flex flex-col gap-2 shrink-0 w-full md:w-auto">
          {partner.status === 'ACTIVE' ? (
            <Button variant="danger" onClick={() => handleStatusChange('SUSPENDED')}>Suspend Partner</Button>
          ) : (
            <Button variant="primary" onClick={() => handleStatusChange('ACTIVE')}>Activate Partner</Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <PartnerSchoolsList partnerId={id} />
        <PartnerCommissionsList partnerId={id} />
      </div>
    </div>
  );
}

function PartnerSchoolsList({ partnerId }: { partnerId: number }) {
  const query = useListPartnerSchools(partnerId);
  
  return (
    <div className="panel p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="display-font text-xl font-bold">Attributed Schools</h2>
        <span className="text-sm font-bold bg-[hsl(var(--muted))] px-2.5 py-1 rounded-full">
          {query.data?.length || 0}
        </span>
      </div>
      
      {query.isLoading ? (
        <div className="space-y-3"><div className="skeleton h-12 rounded-xl"/><div className="skeleton h-12 rounded-xl"/></div>
      ) : query.isError ? (
        <div className="text-sm text-[hsl(var(--destructive))]">Failed to load schools.</div>
      ) : query.data?.length ? (
        <div className="space-y-3">
          {query.data.map((school: any) => (
            <div key={school.schoolId} className="flex items-center justify-between p-3 rounded-xl border border-[hsl(var(--border))]">
              <div>
                <div className="font-bold">{school.schoolName}</div>
                <div className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5 font-mono">{school.schoolCode}</div>
              </div>
              <div className="text-right">
                <StatusPill value={school.attributionStatus} />
                <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1">Since {date(school.startDate)}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center p-6 text-[hsl(var(--muted-foreground))] text-sm">
          No schools attributed yet.
        </div>
      )}
    </div>
  );
}

function PartnerCommissionsList({ partnerId }: { partnerId: number }) {
  const query = useListPartnerCommissions(partnerId);
  const updateStatus = useUpdatePartnerCommissionStatus();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const transition = (commissionId: number, status: 'APPROVED' | 'PAYABLE' | 'HELD' | 'CANCELLED') => {
    updateStatus.mutate({ commissionId, data: { status } }, {
      onSuccess: () => {
        toast({ title: 'Commission updated', description: `Commission moved to ${status.toLowerCase()}.` });
        queryClient.invalidateQueries({ queryKey: ['listPartnerCommissions', partnerId] });
      },
      onError: (err: any) => {
        toast({ title: 'Update failed', description: err.error || 'The commission could not be updated.', variant: 'destructive' });
      },
    });
  };
  
  return (
    <div className="panel p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="display-font text-xl font-bold">Recent Commissions</h2>
        <span className="text-sm font-bold bg-[hsl(var(--muted))] px-2.5 py-1 rounded-full">
          {query.data?.length || 0}
        </span>
      </div>
      
      {query.isLoading ? (
        <div className="space-y-3"><div className="skeleton h-12 rounded-xl"/><div className="skeleton h-12 rounded-xl"/></div>
      ) : query.isError ? (
        <div className="text-sm text-[hsl(var(--destructive))]">Failed to load commissions.</div>
      ) : query.data?.length ? (
        <div className="space-y-3">
          {query.data.slice(0, 5).map((comm: any) => (
            <div key={comm.id} className="flex items-center justify-between p-3 rounded-xl border border-[hsl(var(--border))]">
              <div>
                <div className="font-bold text-[hsl(157_37%_43%)] dark:text-[hsl(157_37%_55%)]">
                  {comm.currency} {comm.amount.toLocaleString()}
                </div>
                <div className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">School ID: {comm.schoolId}</div>
              </div>
              <div className="text-right">
                <StatusPill value={comm.status} />
                <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1">{date(comm.createdAt)}</div>
                <div className="mt-2 flex justify-end gap-1">
                  {comm.status === 'PENDING' && <Button className="h-7 px-2 text-xs" onClick={() => transition(comm.id, 'APPROVED')}>Approve</Button>}
                  {comm.status === 'APPROVED' && <Button className="h-7 px-2 text-xs" onClick={() => transition(comm.id, 'PAYABLE')}>Make payable</Button>}
                  {comm.status === 'HELD' && <Button className="h-7 px-2 text-xs" onClick={() => transition(comm.id, 'APPROVED')}>Release</Button>}
                  {['PENDING', 'APPROVED', 'PAYABLE'].includes(comm.status) && <Button variant="outline" className="h-7 px-2 text-xs" onClick={() => transition(comm.id, 'HELD')}>Hold</Button>}
                </div>
              </div>
            </div>
          ))}
          {query.data.length > 5 && (
            <Button variant="quiet" className="w-full text-xs">View all {query.data.length} records</Button>
          )}
        </div>
      ) : (
        <div className="text-center p-6 text-[hsl(var(--muted-foreground))] text-sm">
          No commissions earned yet.
        </div>
      )}
    </div>
  );
}

function PayoutsOverview() {
  const query = useListPlatformPartnerPayouts();
  const createPayout = useCreatePartnerPayout();
  const updatePayout = useUpdatePartnerPayout();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [partnerId, setPartnerId] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('NGN');
  
  if (query.isLoading) return <SkeletonPage />;
  if (query.isError) return <ErrorState retry={() => query.refetch()} />;

  const payouts = query.data ?? [];

  const create = () => {
    const parsedPartnerId = Number(partnerId);
    const parsedAmount = Number(amount);
    if (!Number.isInteger(parsedPartnerId) || parsedPartnerId < 1 || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast({ title: 'Invalid payout', description: 'Enter a valid partner ID and positive amount.', variant: 'destructive' });
      return;
    }
    createPayout.mutate({ data: { partnerId: parsedPartnerId, amount: parsedAmount, currency } }, {
      onSuccess: () => {
        toast({ title: 'Payout created', description: 'The payable commission entries are now reserved.' });
        setPartnerId('');
        setAmount('');
        queryClient.invalidateQueries({ queryKey: ['listPlatformPartnerPayouts'] });
      },
      onError: (err: any) => {
        toast({ title: 'Payout creation failed', description: err.error || 'Use an amount matching whole payable commission entries.', variant: 'destructive' });
      },
    });
  };

  const transition = (payoutId: number, status: 'PROCESSING' | 'PAID' | 'FAILED' | 'REVERSED') => {
    const paymentReference = status === 'PAID'
      ? window.prompt('Enter the payment reference')
      : undefined;
    if (status === 'PAID' && !paymentReference?.trim()) return;
    updatePayout.mutate({ payoutId, data: { status, paymentReference: paymentReference?.trim() } }, {
      onSuccess: () => {
        toast({ title: 'Payout updated', description: `Payout moved to ${status.toLowerCase()}.` });
        queryClient.invalidateQueries({ queryKey: ['listPlatformPartnerPayouts'] });
      },
      onError: (err: any) => {
        toast({ title: 'Payout update failed', description: err.error || 'The payout could not be updated.', variant: 'destructive' });
      },
    });
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeading 
        eyebrow="Financials" 
        title="Partner Payouts" 
        description="Review and process platform-wide commission payouts."
      />

      <div className="panel mb-6 grid gap-4 p-5 md:grid-cols-[1fr_1fr_140px_auto] md:items-end">
        <Field label="Partner ID">
          <input inputMode="numeric" value={partnerId} onChange={(event) => setPartnerId(event.target.value)} placeholder="e.g. 12" />
        </Field>
        <Field label="Exact payable amount">
          <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="e.g. 5000" />
        </Field>
        <Field label="Currency">
          <input maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
        </Field>
        <Button onClick={create} disabled={createPayout.isPending}>{createPayout.isPending ? 'Creating…' : 'Create payout'}</Button>
      </div>

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[hsl(var(--muted)/.4)] font-bold text-[hsl(var(--muted-foreground))]">
              <tr>
                <th className="p-4">Date</th>
                <th className="p-4">Partner ID</th>
                <th className="p-4">Amount</th>
                <th className="p-4">Status</th>
                <th className="p-4">Ref</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[hsl(var(--border))]">
              {payouts.map(payout => (
                <tr key={payout.id} className="transition-colors hover:bg-[hsl(var(--muted)/.2)]">
                  <td className="p-4">{date(payout.createdAt)}</td>
                  <td className="p-4 font-mono text-xs">{payout.partnerId}</td>
                  <td className="p-4 font-bold text-[hsl(var(--foreground))]">{payout.currency} {payout.amount.toLocaleString()}</td>
                  <td className="p-4"><StatusPill value={payout.status} /></td>
                  <td className="p-4 text-[hsl(var(--muted-foreground))] font-mono text-xs">{payout.paymentReference || '—'}</td>
                  <td className="p-4">
                    <div className="flex justify-end gap-2">
                      {payout.status === 'PENDING' && <>
                        <Button className="h-8 px-3 text-xs" onClick={() => transition(payout.id, 'PROCESSING')}>Process</Button>
                        <Button variant="outline" className="h-8 px-3 text-xs" onClick={() => transition(payout.id, 'FAILED')}>Fail</Button>
                      </>}
                      {payout.status === 'PROCESSING' && <>
                        <Button className="h-8 px-3 text-xs" onClick={() => transition(payout.id, 'PAID')}>Mark paid</Button>
                        <Button variant="outline" className="h-8 px-3 text-xs" onClick={() => transition(payout.id, 'FAILED')}>Fail</Button>
                      </>}
                      {payout.status === 'PAID' && <Button variant="outline" className="h-8 px-3 text-xs" onClick={() => transition(payout.id, 'REVERSED')}>Reverse</Button>}
                    </div>
                  </td>
                </tr>
              ))}
              {payouts.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-[hsl(var(--muted-foreground))]">
                    No payouts found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AttributionConflicts() {
  const query = useListPartnerAttributionConflicts();
  const resolve = useResolvePartnerAttributionConflict();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  if (query.isLoading) return <SkeletonPage />;
  if (query.isError) return <ErrorState retry={() => query.refetch()} />;

  const conflicts = query.data ?? [];

  const handleResolve = (id: number, partnerId: number, decision: 'ACCEPT' | 'REJECT', note: string) => {
    resolve.mutate({ conflictId: id, data: { decision, note } }, {
      onSuccess: () => {
        toast({ title: 'Conflict resolved', description: 'Attribution has been awarded.' });
        queryClient.invalidateQueries({ queryKey: ['listPartnerAttributionConflicts'] });
      }
    });
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeading 
        eyebrow="Ecosystem" 
        title="Attribution Conflicts" 
        description="Resolve disputes when multiple partners claim the same school referral."
      />

      <div className="grid gap-5">
        {conflicts.map(conflict => (
          <div key={conflict.id} className="panel p-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-5">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <AlertCircle size={16} className={conflict.status === 'OPEN' ? 'text-[hsl(var(--accent))]' : 'text-[hsl(var(--muted-foreground))]'} />
                  <span className="font-bold">Conflict #{conflict.id}</span>
                  <StatusPill value={conflict.status} />
                </div>
                <div className="text-sm text-[hsl(var(--muted-foreground))]">
                  School ID: <strong>{conflict.schoolId}</strong> · Raised: {date(conflict.createdAt)}
                </div>
              </div>
            </div>
            
            <div className="grid md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-[hsl(var(--border))] p-4 bg-[hsl(var(--card))]">
                <div className="eyebrow mb-2">Existing Claim</div>
                <div className="font-bold">{conflict.existingPartnerId ? `Partner ID: ${conflict.existingPartnerId}` : 'None'}</div>
              </div>
              <div className="rounded-xl border border-[hsl(var(--border))] p-4 bg-[hsl(var(--card))]">
                <div className="eyebrow mb-2">Attempted Claim</div>
                <div className="font-bold">Partner ID: {conflict.attemptedPartnerId}</div>
                <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1">Source: {conflict.attemptedAttributionSource || 'Unknown'}</div>
              </div>
            </div>

            {conflict.status === 'OPEN' && (
              <div className="mt-5 flex gap-3 justify-end pt-5 border-t border-[hsl(var(--border))]">
                <Button variant="outline" onClick={() => handleResolve(conflict.id, conflict.attemptedPartnerId, 'ACCEPT', 'Awarded to new claimant')}>
                  Award to New Claimant
                </Button>
                {conflict.existingPartnerId && (
                  <Button variant="primary" onClick={() => handleResolve(conflict.id, conflict.existingPartnerId!, 'REJECT', 'Maintained existing attribution')}>
                    Keep Existing
                  </Button>
                )}
              </div>
            )}
            
            {conflict.resolutionNote && (
              <div className="mt-4 text-sm bg-[hsl(var(--muted)/.5)] p-3 rounded-lg">
                <strong>Resolution Note:</strong> {conflict.resolutionNote}
              </div>
            )}
          </div>
        ))}
        {conflicts.length === 0 && (
          <EmptyState icon={CheckCircle2} title="No conflicts" description="All attributions are currently undisputed." />
        )}
      </div>
    </div>
  );
}

export default function PartnerManagement() {
  const [location] = useLocation();

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8 flex gap-2 border-b border-[hsl(var(--border))] pb-2 overflow-x-auto">
        <Link href="/partners">
          <button className={cx("px-4 py-2 text-sm font-bold border-b-2 transition-colors", location === '/partners' || location.match(/^\/partners\/\d+$/) ? "border-[hsl(var(--primary))] text-[hsl(var(--primary))]" : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]")}>
            Partners
          </button>
        </Link>
        <Link href="/partners/payouts">
          <button className={cx("px-4 py-2 text-sm font-bold border-b-2 transition-colors", location === '/partners/payouts' ? "border-[hsl(var(--primary))] text-[hsl(var(--primary))]" : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]")}>
            Payouts
          </button>
        </Link>
        <Link href="/partners/conflicts">
          <button className={cx("px-4 py-2 text-sm font-bold border-b-2 transition-colors", location === '/partners/conflicts' ? "border-[hsl(var(--primary))] text-[hsl(var(--primary))]" : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]")}>
            Attribution Conflicts
          </button>
        </Link>
      </div>

      <Switch>
        <Route path="/partners" component={PartnersOverview} />
        <Route path="/partners/payouts" component={PayoutsOverview} />
        <Route path="/partners/conflicts" component={AttributionConflicts} />
        <Route path="/partners/:id">
          {params => <PartnerDetail id={Number(params.id)} />}
        </Route>
      </Switch>
    </div>
  );
}
