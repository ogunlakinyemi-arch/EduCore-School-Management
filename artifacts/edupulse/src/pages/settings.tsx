import type React from 'react';
import { useState } from 'react';
import { useClerk } from '@clerk/react';
import { ShieldCheck, Database, UserRound, Bell } from 'lucide-react';
import { PageHeading, Info, Button, cx } from '@/components/shared';
import { useGetAuthorizedContext } from '@workspace/api-client-react';
import { NotificationSettings as NotificationSettingsPage } from './notification-settings';
import { PlatformSchoolExport } from '@/components/platform-school-export';

const tabs = [
  { id: 'general', label: 'General', icon: UserRound },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'export', label: 'Data Export', icon: Database },
] as const;
type Tab = typeof tabs[number]['id'];

export function SettingsPage() {
  const context = useGetAuthorizedContext().data;
  const clerk = useClerk();
  const [accountError,setAccountError] = useState('');
  const openAccount = () => {
    try { setAccountError(''); clerk.openUserProfile(); }
    catch(cause) { setAccountError(cause instanceof Error?cause.message:'The account manager could not be opened. Retry when your sign-in session is ready.'); }
  };
  const [tab, setTab] = useState<Tab>('general');
  const owner = context?.isPlatformOwner === true;
  const visible = owner ? tabs : tabs.filter(t => t.id !== 'export');
  const NotificationsView = NotificationSettingsPage;

  return (
    <div className="fade-up">
      <PageHeading eyebrow="Workspace / Settings" title="Workspace Configuration." description="Manage your account and operational boundaries." />
      {accountError&&<p role="alert" className="mb-4 text-[hsl(var(--destructive))]">{accountError}</p>}
      <div className="grid gap-8 lg:grid-cols-[1fr_2fr]">
        <div className="space-y-2" role="tablist" aria-label="Settings sections">
          {visible.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} data-testid={`tab-settings-${id}`} onClick={() => setTab(id)}
              className={cx('flex w-full items-center gap-2 rounded-xl px-4 py-3 text-left text-sm font-bold transition-colors', tab === id ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-md' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]')}>
              <Icon size={16} />{label}
            </button>
          ))}
        </div>
        <div className="space-y-6">
          {tab === 'general' && (
            <div className="panel p-6 md:p-8">
              <div className="mb-6 flex items-center gap-3"><UserRound size={24} className="text-[hsl(var(--primary))]" /><h2 className="display-font text-2xl font-bold">Account identity</h2></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Info label="Clerk Identity" value={context?.user?.email} />
                <Info label="Full Name" value={context?.user?.name} />
                <Info label="Platform Role" value={owner ? 'Platform Owner' : 'Standard User'} />
              </div>
              <p className="mt-6 text-sm text-[hsl(var(--muted-foreground))]">Name, email, profile photo and connected accounts are edited in your account profile.</p>
              <Button className="mt-4" testId="button-open-profile" onClick={openAccount}>Edit account profile</Button>
              <div className="mt-8">
                <div className="eyebrow mb-4">Active Tenancies</div>
                {context?.roles?.length ? <div className="space-y-3">{context.roles.map(r => (
                  <div key={r.id} className="flex items-center justify-between rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
                    <div><div className="text-sm font-bold">School ID: {r.schoolId || 'Platform'}</div><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Authorized scope</div></div>
                    <span className="rounded-full bg-[hsl(var(--primary)/.1)] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[hsl(var(--primary))]">{r.role.replace('_', ' ')}</span>
                  </div>))}</div>
                  : <p className="text-sm text-[hsl(var(--muted-foreground))]">No active tenant roles. Ask your administrator for access.</p>}
              </div>
            </div>
          )}
          {tab === 'security' && (
            <div className="panel p-6 md:p-8">
              <div className="mb-4 flex items-center gap-3"><ShieldCheck size={24} className="text-[hsl(var(--primary))]" /><h2 className="display-font text-2xl font-bold">Sign-in and security</h2></div>
              <p className="text-sm leading-6">Your password, active sessions and any multi-factor options your sign-in provider offers are managed in your account profile under Security.</p>
              <Button className="mt-4" testId="button-open-security" onClick={openAccount}>Open account security</Button>
              <p className="mt-6 rounded-xl bg-[hsl(var(--secondary)/.4)] p-4 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Platform-wide login and security policies are not configured by this app. They are controlled by the identity provider, so no policy switches are shown here.</p>
            </div>
          )}
          {tab === 'notifications' && <NotificationsView globalOnly={owner} />}
          {tab === 'export' && owner && <PlatformSchoolExport />}
        </div>
      </div>
    </div>
  );
}
