import { UserButton } from '@clerk/react';
import { HelpLink } from '@/components/help-link';
import { Route, Switch, Link, Redirect, useLocation } from 'wouter';
import { 
  useGetPartnerDashboard,
  useGetMyDeferredCommissions,
  useGetPartnerProfile,
  useGetMyPartnerCommissions,
  useGetMyPartnerPayouts,
  useGetPartnerPayoutInformation,
  useUpdatePartnerProfile,
  useUpdatePartnerPayoutInformation,
  getGetPartnerPayoutInformationQueryKey,
  getGetPartnerProfileQueryKey,
  getGetPartnerDashboardQueryKey,
  type PartnerPayoutInformationInput
} from '@workspace/api-client-react';
import { 
  Building2, 
  ChevronRight, 
  CreditCard, 
  HandCoins, 
  LayoutDashboard, 
  Settings2,
  Zap,
  TrendingUp,
  Banknote,
  School as SchoolIcon,
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
import OwnBroCommissions from './own-commissions';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { PartnerBankAccountForm } from '@/components/partner-bank-account-form';
import { useBankSelectionGuard } from '@/lib/bank-selection';
import { useToast } from '@/hooks/use-toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CommunicationInbox, CommunicationInboxBadge } from '@/pages/communication-inbox';
import { NotificationSettings } from '@/pages/notification-settings';
import { ReportingPage } from '@/pages/reporting';
import PartnerStaff from '@/pages/partner/partner-staff';
import PartnerNfcActivation from '@/pages/partner/nfc-activation';
import { usePartnerNfcAccess } from '@/pages/partner/nfc-access';
import { AddSchoolPage, AddSchoolButton, MySchoolsTable, canManagePartnerSchools } from '@/pages/partner/partner-schools';

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

import { ArchivedPaymentWorkflowPage } from '@/pages/archived-payment-workflow';

function PortalHeader() {
  const [location] = useLocation();
  const profile = useGetPartnerProfile();
  const isSetup = !!profile.data;
  const { allowed: nfcAllowed } = usePartnerNfcAccess();
  const isOwner = (profile.data as any)?.isOwner ||
    ['PARTNER_OWNER', 'PARTNER_ADMIN'].includes((profile.data as any)?.partnerRole);
  const canViewFinance = (profile.data as any)?.isOwner === true;
  
  return (
    <header className="sticky top-0 z-20 border-b border-[hsl(var(--border)/.8)] bg-[hsl(var(--background)/.94)] backdrop-blur-xl">
      <div className="mx-auto flex h-[70px] max-w-6xl items-center justify-between px-5">
        <Link href="/partner" className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]">
            <Zap size={18} />
          </span>
          <span className="display-font font-bold">Yetenia EduCore Business Relationship Officers (BRO)</span>
        </Link>
        <div className="flex items-center gap-6">
          {isSetup && (
            <nav className="hidden md:flex items-center gap-4 text-sm font-semibold text-[hsl(var(--muted-foreground))]">
              <Link href="/partner" className={cx("hover:text-[hsl(var(--foreground))]", location === '/partner' && "text-[hsl(var(--primary))]")}>Dashboard</Link>
              <Link href="/partner/schools" className={cx("hover:text-[hsl(var(--foreground))]", location.startsWith('/partner/schools') && "text-[hsl(var(--primary))]")}>Schools</Link>
              {isOwner && <Link href="/partner/staff" className={cx("hover:text-[hsl(var(--foreground))]", location.startsWith('/partner/staff') && "text-[hsl(var(--primary))]")}>Staff</Link>}
              {canViewFinance && <Link href="/partner/commissions" className={cx("hover:text-[hsl(var(--foreground))]", location.startsWith('/partner/commissions') && "text-[hsl(var(--primary))]")}>Commissions</Link>}
              {nfcAllowed && <Link href="/partner/nfc-activation" className={cx("hover:text-[hsl(var(--foreground))]", location === '/partner/nfc-activation' && "text-[hsl(var(--primary))]")} data-testid="link-partner-nfc-activation">NFC Activation</Link>}
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
      <div className="mx-auto max-w-6xl px-5"><HelpLink className="text-[hsl(var(--primary))]" /></div>
      {isSetup && <nav aria-label="BRO navigation" className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-3 border-t border-[hsl(var(--border)/.6)] px-5 py-3 text-xs font-bold text-[hsl(var(--primary))] md:hidden">
        <Link href="/partner" data-testid="link-partner-dashboard-mobile" className="hover:underline">Dashboard</Link>
        <Link href="/partner/schools" data-testid="link-partner-schools-mobile" className="hover:underline">Schools</Link>
        {isOwner && <Link href="/partner/staff" data-testid="link-partner-staff-mobile" className="hover:underline">Staff</Link>}
        {canViewFinance && <Link href="/partner/commissions" data-testid="link-partner-commissions-mobile" className="hover:underline">Commissions</Link>}
        {nfcAllowed && <Link href="/partner/nfc-activation" data-testid="link-partner-nfc-activation-mobile" className="whitespace-nowrap hover:underline">NFC Activation</Link>}
        {isOwner && <Link href="/partner/profile" data-testid="link-partner-settings-mobile" className="hover:underline">Settings</Link>}
        <Link href="/notification-settings" data-testid="link-partner-preferences-mobile" className="hover:underline">Preferences</Link>
      </nav>}
    </header>
  );
}

function Dashboard() {
  const profile = useGetPartnerProfile();
  const dashboard = useGetPartnerDashboard({ query: { queryKey: getGetPartnerDashboardQueryKey(), refetchInterval: 15000, staleTime: 0 } });
  // Finance-only history is no longer requested by a BRO dashboard.
  if (profile.isLoading || dashboard.isLoading) return <Loading />;
  if (profile.isError || !profile.data) return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="panel p-8 text-center">
        <h1 className="display-font text-2xl font-bold">BRO account not ready</h1>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Your BRO profile is pending setup. Contact your administrator.</p>
      </div>
    </div>
  );
  if (dashboard.isError || !dashboard.data) return <ErrorState
    message="The BRO network could not be loaded."
    retry={() => { void dashboard.refetch(); }} />;

  const data = dashboard.data;
  const canManageSchools = canManagePartnerSchools(profile.data);
  const canViewFinance = (profile.data as any)?.isOwner === true;

  return (
    <div className="mx-auto max-w-6xl p-5 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-7 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Business Relationship Officer (BRO) Portal</div>
          <h1 className="display-font mt-2 text-3xl font-bold md:text-4xl">Welcome, {profile.data.fullName}.</h1>
        </div>
        {canManageSchools && <AddSchoolButton />}
      </div>

      <div className="grid gap-5 mb-8">
        <div className="panel p-6 border-t-4 border-t-[hsl(var(--primary))]">
          <div className="eyebrow mb-2">Referred Schools</div>
          <div className="display-font text-4xl font-bold">{data?.referredSchools || 0}</div>
          <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-[hsl(var(--muted-foreground))]">
            <SchoolIcon size={14} /> Active within network
          </div>
        </div>
        
      </div>

      {canViewFinance && <OwnBroCommissions />}
      <div className="grid gap-6 md:grid-cols-[1fr_300px]">
        <div className="panel overflow-hidden">
          <div className="border-b border-[hsl(var(--border))] p-5 md:p-6 flex items-center justify-between">
            <div>
              <div className="eyebrow">Network</div>
              <h2 className="display-font mt-1 text-xl font-bold">Quick Actions</h2>
            </div>
          </div>
          <div className="divide-y divide-[hsl(var(--border)/.6)]">
            <Link href="/partner/schools/add" className="flex items-center justify-between p-5 hover:bg-[hsl(var(--muted)/.4)] transition-colors">
              <div className="flex items-center gap-4">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]">
                  <SchoolIcon size={18} />
                </div>
                <div>
                  <div className="font-bold">Add School</div>
                  <div className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">Send a school administrator an invitation</div>
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
            <span className="font-bold">Yetenia EduCore Business Relationship Officer (BRO) Program</span>
          </div>
          <p className="text-sm leading-relaxed text-[hsl(var(--sidebar-foreground)/.7)] mb-6">
            Manage your school relationships and account details. You can view your own earned commission entitlements.
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
  const profile = useGetPartnerProfile();
  const canManage = canManagePartnerSchools(profile.data);
  return (
    <div className="mx-auto max-w-6xl p-5 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-7 flex items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Network</div>
          <h1 className="display-font mt-2 text-3xl font-bold">My Schools</h1>
        </div>
        {canManage && <AddSchoolButton />}
      </div>
      <div className="panel overflow-hidden"><MySchoolsTable canManage={canManage} /></div>
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
        <p className="mt-2 text-xs">Your earned entitlements are available in Commissions. Overall financial policies and reports remain restricted to the Platform Owner.</p>
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

export function PartnerSettings() {
  const profileQuery = useGetPartnerProfile();
  const updateProfile = useUpdatePartnerProfile();
  
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

  const onProfileSubmit = profileForm.handleSubmit((data) => {
    updateProfile.mutate({ data }, {
      onSuccess: () => {
        toast({ title: 'Profile updated' });
        queryClient.invalidateQueries({ queryKey: getGetPartnerProfileQueryKey() });
      }
    });
  });


  if (profileQuery.isLoading) return <SkeletonPage />;
  if (profileQuery.isError) return <ErrorState retry={() => profileQuery.refetch()} />;
  const canManagePartner = (profileQuery.data as any)?.isOwner ||
    ['PARTNER_OWNER', 'PARTNER_ADMIN'].includes((profileQuery.data as any)?.partnerRole);
  if (!canManagePartner) return (
    <div className="mx-auto max-w-3xl p-8"><div className="panel p-8 text-center">
      <h1 className="display-font text-2xl font-bold">BRO administrator access required</h1>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Only a BRO administrator can change profile settings.</p>
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
            <h2 className="display-font text-xl font-bold">BRO Profile</h2>
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

      </div>
    </div>
  );
}

export default function PartnerPortal() {
  return (
    <div className="min-h-[100dvh] bg-[hsl(var(--background))]">
      <PortalHeader />
      <Switch>
        {/* Ordinary sign-in returns to /. Only the authorized BRO portal
            canonicalizes that known landing path; unknown URLs remain 404s. */}
        <Route path="/"><Redirect to="/partner" replace /><Loading /></Route>
        <Route path="/reporting"><main className="mx-auto max-w-6xl p-5 md:p-8"><ReportingPage audience="partner" /></main></Route>
        <Route path="/inbox"><CommunicationInbox standalone /></Route>
        <Route path="/notification-settings"><NotificationSettings standalone /></Route>
        <Route path="/partner" component={Dashboard} />
        <Route path="/partner/schools" component={MySchools} />
        <Route path="/partner/staff" component={PartnerStaff} />
        <Route path="/partner/nfc-activation" component={PartnerNfcActivation} />
        <Route path="/partner/commissions" component={OwnBroCommissions} />
        <Route path="/partner/payouts" component={NotFound} />
        <Route path="/partner/flutterwave-settlements" component={ArchivedPaymentWorkflowPage} />
        <Route path="/partner/profile" component={PartnerSettings} />
        <Route path="/partner/schools/add" component={AddSchoolPage} />
        <Route path="/partner/invite-school" component={AddSchoolPage} />
        <Route component={NotFound} />
      </Switch>
    </div>
  );
}