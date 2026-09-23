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
  Check
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
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

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
  
  return (
    <header className="sticky top-0 z-20 border-b border-[hsl(var(--border)/.8)] bg-[hsl(var(--background)/.94)] backdrop-blur-xl">
      <div className="mx-auto flex h-[70px] max-w-6xl items-center justify-between px-5">
        <Link href="/partner" className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]">
            <Zap size={18} />
          </span>
          <span className="display-font font-bold">EduPulse Partner</span>
        </Link>
        <div className="flex items-center gap-6">
          {isSetup && (
            <nav className="hidden md:flex items-center gap-4 text-sm font-semibold text-[hsl(var(--muted-foreground))]">
              <Link href="/partner" className={cx("hover:text-[hsl(var(--foreground))]", location === '/partner' && "text-[hsl(var(--primary))]")}>Dashboard</Link>
              <Link href="/partner/schools" className={cx("hover:text-[hsl(var(--foreground))]", location.startsWith('/partner/schools') && "text-[hsl(var(--primary))]")}>Schools</Link>
              <Link href="/partner/commissions" className={cx("hover:text-[hsl(var(--foreground))]", location.startsWith('/partner/commissions') && "text-[hsl(var(--primary))]")}>Commissions</Link>
              <Link href="/partner/payouts" className={cx("hover:text-[hsl(var(--foreground))]", location.startsWith('/partner/payouts') && "text-[hsl(var(--primary))]")}>Payouts</Link>
              <Link href="/partner/profile" className={cx("hover:text-[hsl(var(--foreground))]", location === '/partner/profile' && "text-[hsl(var(--primary))]")}>Settings</Link>
            </nav>
          )}
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

      <div className="grid gap-5 md:grid-cols-3 mb-8">
        <div className="panel p-6 border-t-4 border-t-[hsl(var(--primary))]">
          <div className="eyebrow mb-2">Referred Schools</div>
          <div className="display-font text-4xl font-bold">{data?.referredSchools || 0}</div>
          <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-[hsl(var(--muted-foreground))]">
            <SchoolIcon size={14} /> Active within network
          </div>
        </div>
        
        <div className="panel p-6 border-t-4 border-t-[hsl(157_37%_43%)]">
          <div className="eyebrow mb-2">Unpaid Commissions</div>
          <div className="display-font text-4xl font-bold text-[hsl(157_37%_43%)] dark:text-[hsl(157_37%_55%)]">
            ₦{data?.outstandingCommission?.toLocaleString() || 0}
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-[hsl(var(--muted-foreground))]">
            <Banknote size={14} /> Available for next payout
          </div>
        </div>

        <div className="panel p-6 border-t-4 border-t-[hsl(var(--accent))]">
          <div className="eyebrow mb-2">Lifetime Earned</div>
          <div className="display-font text-4xl font-bold">
            ₦{data?.lifetimeCommission?.toLocaleString() || 0}
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-[hsl(var(--muted-foreground))]">
            <TrendingUp size={14} /> Total since joining
          </div>
        </div>
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
            <span className="font-bold">EduPulse Partner Program</span>
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
          Share this link with school administrators. When they register their school on EduPulse using this link, they will be permanently attributed to your partner account.
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

export default function PartnerPortal() {
  return (
    <div className="min-h-[100dvh] bg-[hsl(var(--background))]">
      <PortalHeader />
      <Switch>
        <Route path="/partner" component={Dashboard} />
        <Route path="/partner/schools" component={MySchools} />
        <Route path="/partner/commissions" component={MyCommissions} />
        <Route path="/partner/payouts" component={MyPayouts} />
        <Route path="/partner/profile" component={PartnerSettings} />
        <Route path="/partner/invite-school" component={InviteSchool} />
        <Route component={NotFound} />
      </Switch>
    </div>
  );
}