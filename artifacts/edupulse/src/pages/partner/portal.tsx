import { UserButton } from '@clerk/react';
import { Route, Switch, Link, useLocation } from 'wouter';
import { 
  useGetPartnerDashboard,
  useGetPartnerProfile,
  useGetPartnerReferralLink,
  useListMyPartnerSchools,
  useGetMyPartnerCommissions,
  useGetMyPartnerPayouts,
  useGetPartnerPayoutInformation,
  useUpdatePartnerProfile,
  useUpdatePartnerPayoutInformation
} from '@workspace/api-client-react';
import { 
  Building2, 
  ChevronRight, 
  CreditCard, 
  HandCoins, 
  LayoutDashboard, 
  Link as LinkIcon,
  Settings2,
  Zap,
  TrendingUp,
  Banknote,
  School as SchoolIcon,
  Copy,
  Check,
  Users,
  FileSpreadsheet
} from 'lucide-react';
import { 
  cx, 
  money, 
  date, 
  StatusPill, 
  Button, 
  Field, 
  Modal, 
  SkeletonPage, 
  ErrorState, 
  EmptyState 
} from '@/components/shared';
import NotFound from '@/pages/not-found';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CommunicationInbox, CommunicationInboxBadge } from '@/pages/communication-inbox';
import { NotificationSettings } from '@/pages/notification-settings';
import { ReportingPage } from '@/pages/reporting';

function Loading() {
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-5 md:p-8">
      <div className="skeleton h-11 w-64 rounded-xl" />
      <div className="grid gap-4 md:grid-cols-3">
        <div className="skeleton h-40 rounded-[18px]" />
        <div className="skeleton h-40 rounded-[18px]" />
        <div className="skeleton h-40 rounded-[18px]" />
      </div>
    </div>
  );
}

function PortalHeader() {
  const [location] = useLocation();
  const profile = useGetPartnerProfile();
  const isSetup = !!profile.data;
  const isOwner = (profile.data as any)?.isOwner ||
    ['PARTNER_OWNER', 'PARTNER_ADMIN'].includes((profile.data as any)?.partnerRole);
  const canViewFinance = isOwner || (profile.data as any)?.partnerRole === 'PARTNER_FINANCE';
  
  return (
    <header className="sticky top-0 z-20 border-b border-[hsl(var(--border)/.8)] bg-[hsl(var(--background)/.94)] backdrop-blur-xl">
      <div className="mx-auto flex h-[70px] max-w-6xl items-center justify-between px-5">
        <Link href="/partner" className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]">
            <Zap size={18} />
          </span>
          <span className="display-font font-bold">Yemait EduCore Partner</span>
        </Link>
        <div className="flex items-center gap-6">
          {isSetup && (
            <nav className="hidden md:flex items-center gap-4 text-sm font-semibold text-[hsl(var(--muted-foreground))]">
              <Link href="/partner" className={cx("hover:text-[hsl(var(--foreground))]", location === '/partner' && "text-[hsl(var(--primary))]")}>Dashboard</Link>
              <Link href="/partner/schools" className={cx("hover:text-[hsl(var(--foreground))]", location.startsWith('/partner/schools') && "text-[hsl(var(--primary))]")}>Schools</Link>
              {isOwner && <Link href="/partner/staff" className={cx("hover:text-[hsl(var(--foreground))]", location.startsWith('/partner/staff') && "text-[hsl(var(--primary))]")}>Staff</Link>}
              {canViewFinance && <Link href="/partner/commissions" className={cx("hover:text-[hsl(var(--foreground))]", location.startsWith('/partner/commissions') && "text-[hsl(var(--primary))]")}>Commissions</Link>}
              {canViewFinance && <Link href="/partner/payouts" className={cx("hover:text-[hsl(var(--foreground))]", location.startsWith('/partner/payouts') && "text-[hsl(var(--primary))]")}>Payouts</Link>}
              <Link href="/reporting" className={cx("hover:text-[hsl(var(--foreground))]", location === '/reporting' && "text-[hsl(var(--primary))]")} data-testid="link-partner-reporting">Reports</Link>
              {isOwner && <Link href="/partner/profile" className={cx("hover:text-[hsl(var(--foreground))]", location === '/partner/profile' && "text-[hsl(var(--primary))]")}>Settings</Link>}
            </nav>
          )}
          <CommunicationInboxBadge />
          {isSetup && <Link href="/reporting" className="inline-flex items-center gap-1 text-xs font-bold text-[hsl(var(--primary))] md:hidden" data-testid="link-partner-reporting-mobile"><FileSpreadsheet size={15} /> Reports</Link>}
          <Link href="/notification-settings" className="hidden text-xs font-bold text-[hsl(var(--primary))] sm:block" data-testid="link-partner-notification-settings">Preferences</Link>
          <UserButton />
        </div>
      </div>
    </header>
  );
}

function Dashboard() {
  const profile = useGetPartnerProfile();
  const dashboard = useGetPartnerDashboard();
  const link = useGetPartnerReferralLink();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  if (profile.isLoading || dashboard.isLoading) return <Loading />;
  if (profile.isError || !profile.data) return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="panel p-8 text-center">
        <h1 className="display-font text-2xl font-bold">Partner account not ready</h1>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Your partner profile is pending setup. Contact your administrator.</p>
      </div>
    </div>
  );

  const data = dashboard.data;
  const canViewFinance = (profile.data as any)?.isOwner ||
    ['PARTNER_ADMIN', 'PARTNER_FINANCE'].includes((profile.data as any)?.partnerRole);

  const handleCopyLink = () => {
    if (link.data?.url) {
      navigator.clipboard.writeText(link.data.url);
      setCopied(true);
      toast({ title: 'Link copied', description: 'Referral link copied to clipboard.' });
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="mx-auto max-w-6xl p-5 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-7 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Partner Portal</div>
          <h1 className="display-font mt-2 text-3xl font-bold md:text-4xl">Welcome, {profile.data.fullName}.</h1>
        </div>
        {link.data?.url && (
          <div className="shrink-0 flex items-center gap-2 bg-[hsl(var(--muted)/.4)] rounded-xl p-1.5 border border-[hsl(var(--border))]">
            <span className="text-xs font-mono text-[hsl(var(--muted-foreground))] px-3 truncate max-w-[200px]">
              {link.data.url}
            </span>
            <Button variant="outline" className="h-8 px-3" onClick={handleCopyLink}>
              {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        )}
      </div>

      <div className={`grid gap-5 ${canViewFinance ? 'md:grid-cols-3' : 'md:grid-cols-1'} mb-8`}>
        <div className="panel p-6 border-t-4 border-t-[hsl(var(--primary))]">
          <div className="eyebrow mb-2">Referred Schools</div>
          <div className="display-font text-4xl font-bold">{data?.referredSchools || 0}</div>
          <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-[hsl(var(--muted-foreground))]">
            <SchoolIcon size={14} /> Active within network
          </div>
        </div>
        
        {canViewFinance && <div className="panel p-6 border-t-4 border-t-[hsl(157_37%_43%)]">
          <div className="eyebrow mb-2">Unpaid Commissions</div>
          <div className="display-font text-4xl font-bold text-[hsl(157_37%_43%)] dark:text-[hsl(157_37%_55%)]">
            ₦{data?.outstandingCommission?.toLocaleString() || 0}
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-[hsl(var(--muted-foreground))]">
            <Banknote size={14} /> Available for next payout
          </div>
        </div>}

        {canViewFinance && <div className="panel p-6 border-t-4 border-t-[hsl(var(--accent))]">
          <div className="eyebrow mb-2">Lifetime Earned</div>
          <div className="display-font text-4xl font-bold">
            ₦{data?.lifetimeCommission?.toLocaleString() || 0}
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-[hsl(var(--muted-foreground))]">
            <TrendingUp size={14} /> Total since joining
          </div>
        </div>}
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_300px]">
        <div className="panel overflow-hidden">
          <div className="border-b border-[hsl(var(--border))] p-5 md:p-6 flex items-center justify-between">
            <div>
              <div className="eyebrow">Network</div>
              <h2 className="display-font mt-1 text-xl font-bold">Quick Actions</h2>
            </div>
          </div>
          <div className="divide-y divide-[hsl(var(--border)/.6)]">
            <Link href="/partner/invite-school" className="flex items-center justify-between p-5 hover:bg-[hsl(var(--muted)/.4)] transition-colors">
              <div className="flex items-center gap-4">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]">
                  <LinkIcon size={18} />
                </div>
                <div>
                  <div className="font-bold">Invite a new school</div>
                  <div className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">Use your referral link to onboard a school</div>
                </div>
              </div>
              <ChevronRight size={16} className="text-[hsl(var(--muted-foreground))]" />
            </Link>
            <Link href="/partner/schools" className="flex items-center justify-between p-5 hover:bg-[hsl(var(--muted)/.4)] transition-colors">
              <div className="flex items-center gap-4">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-[hsl(var(--accent)/.15)] text-[hsl(var(--accent))]">
                  <Building2 size={18} />
                </div>
                <div>
                  <div className="font-bold">View my schools</div>
                  <div className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">See details for schools you referred</div>
                </div>
              </div>
              <ChevronRight size={16} className="text-[hsl(var(--muted-foreground))]" />
            </Link>
          </div>
        </div>

        <div className="panel p-5 md:p-6 bg-[hsl(var(--sidebar))] text-[hsl(var(--sidebar-foreground))]">
          <div className="flex items-center gap-2 mb-4">
            <Zap size={16} className="text-[hsl(var(--accent))]" />
            <span className="font-bold">Yemait EduCore Partner Program</span>
          </div>
          <p className="text-sm leading-relaxed text-[hsl(var(--sidebar-foreground)/.7)] mb-6">
            You earn commission on all eligible subscription payments from your referred schools. Payouts are processed at the start of each academic term.
          </p>
          <Link href="/partner/profile">
            <Button variant="outline" className="w-full bg-transparent border-[hsl(var(--sidebar-border))] hover:bg-[hsl(var(--sidebar-accent))] text-[hsl(var(--sidebar-foreground))]">
              <Settings2 size={16} /> Manage settings
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

function MySchools() {
  const query = useListMyPartnerSchools();
  
  if (query.isLoading) return <SkeletonPage />;
  if (query.isError) return <ErrorState retry={() => query.refetch()} />;

  const schools = query.data ?? [];

  return (
    <div className="mx-auto max-w-6xl p-5 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-7">
        <div className="eyebrow">Network</div>
        <h1 className="display-font mt-2 text-3xl font-bold">My Schools</h1>
      </div>

      <div className="panel overflow-hidden">
        {schools.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[hsl(var(--muted)/.4)] font-bold text-[hsl(var(--muted-foreground))]">
                <tr>
                  <th className="p-4">School</th>
                  <th className="p-4">Attribution</th>
                  <th className="p-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))]">
                {schools.map(school => (
                  <tr key={school.schoolId} className="transition-colors hover:bg-[hsl(var(--muted)/.2)]">
                    <td className="p-4">
                      <div className="font-bold text-[hsl(var(--foreground))]">{school.schoolName}</div>
                      <div className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))] font-mono">{school.schoolCode}</div>
                    </td>
                    <td className="p-4 text-[hsl(var(--muted-foreground))]">
                      Since {date(school.startDate)}
                    </td>
                    <td className="p-4"><StatusPill value={school.attributionStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState 
            icon={Building2} 
            title="No schools yet" 
            description="You haven't referred any schools that completed onboarding yet." 
            action={
              <Link href="/partner/invite-school">
                <Button>Get your referral link</Button>
              </Link>
            }
          />
        )}
      </div>
    </div>
  );
}

function MyCommissions() {
  const query = useGetMyPartnerCommissions();
  
  if (query.isLoading) return <SkeletonPage />;
  if (query.isError) return <ErrorState retry={() => query.refetch()} />;

  const commissions = query.data ?? [];

  return (
    <div className="mx-auto max-w-6xl p-5 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-7">
        <div className="eyebrow">Financials</div>
        <h1 className="display-font mt-2 text-3xl font-bold">Commissions</h1>
      </div>

      <div className="panel overflow-hidden">
        {commissions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[hsl(var(--muted)/.4)] font-bold text-[hsl(var(--muted-foreground))]">
                <tr>
                  <th className="p-4">Date</th>
                  <th className="p-4">School ID</th>
                  <th className="p-4">Session/Term</th>
                  <th className="p-4">Amount</th>
                  <th className="p-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))]">
                {commissions.map(comm => (
                  <tr key={comm.id} className="transition-colors hover:bg-[hsl(var(--muted)/.2)]">
                    <td className="p-4 text-[hsl(var(--muted-foreground))]">{date(comm.generatedAt)}</td>
                    <td className="p-4 font-mono text-xs">{comm.schoolId}</td>
                    <td className="p-4">
                      {comm.academicSession ? `${comm.academicSession} - Term ${comm.term || '?'}` : '—'}
                    </td>
                    <td className="p-4 font-bold text-[hsl(157_37%_43%)] dark:text-[hsl(157_37%_55%)]">
                      {comm.currency} {comm.amount.toLocaleString()}
                    </td>
                    <td className="p-4"><StatusPill value={comm.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState 
            icon={HandCoins} 
            title="No commissions yet" 
            description="Commissions will appear here once your referred schools process subscriptions." 
          />
        )}
      </div>
    </div>
  );
}

function MyPayouts() {
  const query = useGetMyPartnerPayouts();
  
  if (query.isLoading) return <SkeletonPage />;
  if (query.isError) return <ErrorState retry={() => query.refetch()} />;

  const payouts = query.data ?? [];

  return (
    <div className="mx-auto max-w-6xl p-5 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-7">
        <div className="eyebrow">Financials</div>
        <h1 className="display-font mt-2 text-3xl font-bold">Payouts</h1>
      </div>

      <div className="panel overflow-hidden">
        {payouts.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[hsl(var(--muted)/.4)] font-bold text-[hsl(var(--muted-foreground))]">
                <tr>
                  <th className="p-4">Date</th>
                  <th className="p-4">Amount</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))]">
                {payouts.map(payout => (
                  <tr key={payout.id} className="transition-colors hover:bg-[hsl(var(--muted)/.2)]">
                    <td className="p-4 text-[hsl(var(--muted-foreground))]">{date(payout.createdAt)}</td>
                    <td className="p-4 font-bold">{payout.currency} {payout.amount.toLocaleString()}</td>
                    <td className="p-4"><StatusPill value={payout.status} /></td>
                    <td className="p-4 font-mono text-xs text-[hsl(var(--muted-foreground))]">
                      {payout.paymentReference || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState 
            icon={Banknote} 
            title="No payouts yet" 
            description="Payouts are processed termly based on your accumulated commissions." 
          />
        )}
      </div>
    </div>
  );
}

const profileSchema = z.object({
  fullName: z.string().min(2),
  businessName: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  state: z.string().optional(),
  lga: z.string().optional(),
});

const payoutInfoSchema = z.object({
  payoutMethod: z.enum(['BANK_TRANSFER', 'MOBILE_MONEY', 'OTHER']),
  bankName: z.string().min(2).optional(),
  accountName: z.string().min(2),
  accountNumber: z.string().optional(),
});

function PartnerSettings() {
  const profileQuery = useGetPartnerProfile();
  const payoutInfoQuery = useGetPartnerPayoutInformation();
  const updateProfile = useUpdatePartnerProfile();
  const updatePayoutInfo = useUpdatePartnerPayoutInformation();
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const profileForm = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    values: profileQuery.data ? {
      fullName: profileQuery.data.fullName,
      businessName: profileQuery.data.businessName || '',
      phone: profileQuery.data.phone || '',
      address: profileQuery.data.address || '',
      state: profileQuery.data.state || '',
      lga: profileQuery.data.lga || '',
    } : undefined
  });

  const payoutForm = useForm<z.infer<typeof payoutInfoSchema>>({
    resolver: zodResolver(payoutInfoSchema),
    values: payoutInfoQuery.data ? {
      payoutMethod: payoutInfoQuery.data.payoutMethod as any,
      bankName: payoutInfoQuery.data.bankName || '',
      accountName: payoutInfoQuery.data.accountName || '',
      accountNumber: '', // Never populate write-only field
    } : undefined
  });

  const onProfileSubmit = profileForm.handleSubmit((data) => {
    updateProfile.mutate({ data }, {
      onSuccess: () => {
        toast({ title: 'Profile updated' });
        queryClient.invalidateQueries({ queryKey: ['getPartnerProfile'] });
      }
    });
  });

  const onPayoutSubmit = payoutForm.handleSubmit((data) => {
    updatePayoutInfo.mutate({ data: data as any }, {
      onSuccess: () => {
        toast({ title: 'Payout info updated' });
        queryClient.invalidateQueries({ queryKey: ['getPartnerPayoutInformation'] });
        payoutForm.setValue('accountNumber', '');
      }
    });
  });

  if (profileQuery.isLoading || payoutInfoQuery.isLoading) return <SkeletonPage />;
  if (profileQuery.isError) return <ErrorState retry={() => profileQuery.refetch()} />;
  const canManagePartner = (profileQuery.data as any)?.isOwner ||
    ['PARTNER_OWNER', 'PARTNER_ADMIN'].includes((profileQuery.data as any)?.partnerRole);
  if (!canManagePartner) return (
    <div className="mx-auto max-w-3xl p-8"><div className="panel p-8 text-center">
      <h1 className="display-font text-2xl font-bold">Partner administrator access required</h1>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Only a partner owner or administrator can change profile and payout settings.</p>
    </div></div>
  );

  return (
    <div className="mx-auto max-w-4xl p-5 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-7">
        <div className="eyebrow">Settings</div>
        <h1 className="display-font mt-2 text-3xl font-bold">Profile & Preferences</h1>
      </div>

      <div className="grid gap-8">
        <section className="panel p-6 md:p-8">
          <div className="mb-6 border-b border-[hsl(var(--border))] pb-4">
            <h2 className="display-font text-xl font-bold">Partner Profile</h2>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">Update your contact and business details.</p>
          </div>
          
          <form onSubmit={onProfileSubmit} className="space-y-5">
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Full Name" error={profileForm.formState.errors.fullName?.message}>
                <input {...profileForm.register('fullName')} />
              </Field>
              <Field label="Business Name" error={profileForm.formState.errors.businessName?.message}>
                <input {...profileForm.register('businessName')} />
              </Field>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Phone" error={profileForm.formState.errors.phone?.message}>
                <input {...profileForm.register('phone')} />
              </Field>
              <Field label="State" error={profileForm.formState.errors.state?.message}>
                <input {...profileForm.register('state')} />
              </Field>
            </div>
            <Field label="Address" error={profileForm.formState.errors.address?.message}>
              <input {...profileForm.register('address')} />
            </Field>
            
            <div className="flex justify-end pt-4">
              <Button type="submit" disabled={updateProfile.isPending || !profileForm.formState.isDirty}>
                {updateProfile.isPending ? 'Saving...' : 'Save Profile'}
              </Button>
            </div>
          </form>
        </section>

        <section className="panel p-6 md:p-8">
          <div className="mb-6 border-b border-[hsl(var(--border))] pb-4">
            <h2 className="display-font text-xl font-bold">Payout Information</h2>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">Where we send your commission payouts.</p>
          </div>
          
          <form onSubmit={onPayoutSubmit} className="space-y-5">
            <Field label="Payout Method" error={payoutForm.formState.errors.payoutMethod?.message}>
              <select {...payoutForm.register('payoutMethod')}>
                <option value="BANK_TRANSFER">Bank Transfer</option>
                <option value="MOBILE_MONEY">Mobile Money</option>
              </select>
            </Field>
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Bank Name" error={payoutForm.formState.errors.bankName?.message}>
                <input {...payoutForm.register('bankName')} placeholder="e.g. Zenith Bank" />
              </Field>
              <Field label="Account Name" error={payoutForm.formState.errors.accountName?.message}>
                <input {...payoutForm.register('accountName')} placeholder="Exact name on account" />
              </Field>
            </div>
            <Field label="Account Number" error={payoutForm.formState.errors.accountNumber?.message}>
              <input {...payoutForm.register('accountNumber')} placeholder={payoutInfoQuery.data?.maskedAccountNumber || "Enter new account number"} />
            </Field>
            
            <div className="flex justify-end pt-4">
              <Button type="submit" disabled={updatePayoutInfo.isPending || (!payoutForm.formState.isDirty && !payoutForm.getValues('accountNumber'))}>
                {updatePayoutInfo.isPending ? 'Saving...' : 'Update Payout Details'}
              </Button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}

function InviteSchool() {
  const link = useGetPartnerReferralLink();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (link.data?.url) {
      navigator.clipboard.writeText(link.data.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-5 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-7">
        <Link href="/partner" className="text-xs font-bold text-[hsl(var(--primary))] mb-4 inline-block">← Back to Dashboard</Link>
        <div className="eyebrow">Growth</div>
        <h1 className="display-font mt-2 text-3xl font-bold">Invite a School</h1>
      </div>

      <div className="panel p-6 md:p-10 text-center flex flex-col items-center">
        <div className="h-16 w-16 bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))] rounded-2xl flex items-center justify-center mb-6">
          <LinkIcon size={32} />
        </div>
        
        <h2 className="display-font text-2xl font-bold mb-3">Your Unique Referral Link</h2>
        <p className="text-[hsl(var(--muted-foreground))] max-w-md mx-auto mb-8">
          Share this link with school administrators. When they register their school on Yemait EduCore using this link, they will be permanently attributed to your partner account.
        </p>

        {link.isLoading ? (
          <div className="skeleton h-14 w-full max-w-lg rounded-xl" />
        ) : link.isError ? (
          <ErrorState retry={() => link.refetch()} message="Could not load your referral link" />
        ) : (
          <div className="w-full max-w-lg flex flex-col sm:flex-row gap-3">
            <div className="flex-1 bg-[hsl(var(--muted)/.5)] border border-[hsl(var(--border))] rounded-xl px-4 py-3 text-sm font-mono text-left overflow-x-auto whitespace-nowrap">
              {link.data?.url}
            </div>
            <Button className="shrink-0 h-12" onClick={handleCopy}>
              {copied ? <Check size={18} /> : <Copy size={18} />}
              {copied ? 'Copied' : 'Copy Link'}
            </Button>
          </div>
        )}
        
        <div className="mt-10 bg-[hsl(var(--sidebar))] text-[hsl(var(--sidebar-foreground))] rounded-2xl p-6 text-left w-full max-w-lg">
          <div className="font-bold mb-2 flex items-center gap-2">
            <Zap size={16} className="text-[hsl(var(--accent))]" /> Best Practices
          </div>
          <ul className="text-sm text-[hsl(var(--sidebar-foreground)/.7)] space-y-2 list-disc list-inside pl-4">
            <li>Ensure the school uses this exact link for their initial registration.</li>
            <li>Schools can also enter your Partner Code manually during sign up.</li>
            <li>Attribution is locked upon successful registration.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

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

function PartnerStaff() {
  const profile = useGetPartnerProfile();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState('STANDARD');
  const staff = useQuery({
    queryKey: ['partner-staff'],
    queryFn: () => partnerApi<Array<{ userId: number; email: string; fullName: string; role: string; status: string }>>('/partner/staff'),
  });
  const invitations = useQuery({
    queryKey: ['partner-staff-invitations'],
    queryFn: () => partnerApi<Array<{ id: number; email: string; status: string; expiresAt: string }>>('/partner/staff/invitations'),
  });
  const invite = useMutation({
    mutationFn: (inviteEmail: string) => partnerApi('/partner/staff-invitations', {
      method: 'POST',
      body: JSON.stringify({ email: inviteEmail, permission }),
    }),
    onSuccess: () => {
      toast({ title: 'Invitation sent', description: `A secure Clerk invitation was sent to ${email}.` });
      setEmail('');
      setPermission('STANDARD');
      queryClient.invalidateQueries({ queryKey: ['partner-staff-invitations'] });
    },
    onError: (error: Error) => toast({
      title: 'Invitation failed', description: error.message, variant: 'destructive',
    }),
  });

  const isOwner = (profile.data as any)?.isOwner ||
    ['PARTNER_OWNER', 'PARTNER_ADMIN'].includes((profile.data as any)?.partnerRole);
  if (profile.isLoading || staff.isLoading || invitations.isLoading) return <SkeletonPage />;
  if (!isOwner) {
    return <div className="mx-auto max-w-3xl p-8"><div className="panel p-8 text-center">
      <h1 className="display-font text-2xl font-bold">Partner owner access required</h1>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Only a partner owner or administrator can manage staff invitations.</p>
    </div></div>;
  }
  if (staff.isError) return <ErrorState message={(staff.error as Error).message} retry={() => staff.refetch()} />;

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
          if (email.trim()) invite.mutate(email.trim());
        }}>
        <div className="flex-1">
          <Field label="Staff email address">
            <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)}
              placeholder="staff@example.com" autoComplete="email" />
          </Field>
        </div>
        <div className="sm:w-56">
          <Field label="Access level">
            <select value={permission} onChange={(event) => setPermission(event.target.value)}>
              <option value="STANDARD">Standard staff</option>
              <option value="FINANCE">Finance reports</option>
              <option value="ADMIN">Partner administrator</option>
            </select>
          </Field>
        </div>
        <Button type="submit" disabled={invite.isPending || !email.trim()}>
          {invite.isPending ? 'Sending invitation…' : 'Invite staff'}
        </Button>
      </form>
      {invitations.isError && <div className="mb-4 text-sm text-[hsl(var(--destructive))]">{(invitations.error as Error).message}</div>}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel overflow-hidden">
          <div className="border-b border-[hsl(var(--border))] p-5">
            <h2 className="display-font text-xl font-bold">Active staff</h2>
          </div>
          {(staff.data ?? []).length ? (staff.data ?? []).map((member) => (
            <div key={member.userId} className="border-b border-[hsl(var(--border)/.6)] p-4 last:border-0">
              <div className="mb-3 flex items-center justify-between">
                <div><div className="font-semibold">{member.fullName || member.email}</div><div className="text-sm text-[hsl(var(--muted-foreground))]">{member.email}</div></div>
                <StatusPill value={member.status} />
              </div>
              <StaffAccessControl member={member} />
            </div>
          )) : <EmptyState icon={Users} title="No staff yet" description="Send a secure invitation to add a partner staff member." />}
        </section>
        <section className="panel overflow-hidden">
          <div className="border-b border-[hsl(var(--border))] p-5">
            <h2 className="display-font text-xl font-bold">Pending invitations</h2>
          </div>
          {(invitations.data ?? []).length ? (invitations.data ?? []).map((pending) => (
            <div key={pending.id} className="flex items-center justify-between border-b border-[hsl(var(--border)/.6)] p-4 last:border-0">
              <div><div className="font-semibold">{pending.email}</div><div className="text-xs text-[hsl(var(--muted-foreground))]">Expires {date(pending.expiresAt)}</div></div>
              <StatusPill value="PENDING" />
            </div>
          )) : <div className="p-6 text-sm text-[hsl(var(--muted-foreground))]">No pending invitations.</div>}
        </section>
      </div>
    </div>
  );
}

function StaffAccessControl({ member }: {
  member: { userId: number; role: string };
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const permissionForRole: Record<string, string> = {
    PARTNER_STAFF: 'STANDARD',
    PARTNER_FINANCE: 'FINANCE',
    PARTNER_ADMIN: 'ADMIN',
  };
  const [permission, setPermission] = useState(permissionForRole[member.role] ?? 'STANDARD');
  const [savedPermission, setSavedPermission] = useState(permissionForRole[member.role] ?? 'STANDARD');
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
        {update.isPending ? 'Saving…' : 'Save'}
      </Button>
    </div>
  );
}

export default function PartnerPortal() {
  return (
    <div className="min-h-[100dvh] bg-[hsl(var(--background))]">
      <PortalHeader />
      <Switch>
        <Route path="/reporting"><main className="mx-auto max-w-6xl p-5 md:p-8"><ReportingPage audience="partner" /></main></Route>
        <Route path="/inbox"><CommunicationInbox standalone /></Route>
        <Route path="/notification-settings"><NotificationSettings standalone /></Route>
        <Route path="/partner" component={Dashboard} />
        <Route path="/partner/schools" component={MySchools} />
        <Route path="/partner/staff" component={PartnerStaff} />
        <Route path="/partner/commissions" component={MyCommissions} />
        <Route path="/partner/payouts" component={MyPayouts} />
        <Route path="/partner/profile" component={PartnerSettings} />
        <Route path="/partner/invite-school" component={InviteSchool} />
        <Route component={NotFound} />
      </Switch>
    </div>
  );
}