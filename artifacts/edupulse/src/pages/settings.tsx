import { Settings2, ShieldCheck, Database, Key } from 'lucide-react';
import { PageHeading, Info } from '@/components/shared';
import { useGetAuthorizedContext } from '@workspace/api-client-react';

export function SettingsPage() {
  const contextQuery = useGetAuthorizedContext();
  const context = contextQuery.data;

  return (
    <div className="fade-up">
      <PageHeading 
        eyebrow="Workspace / Settings" 
        title="Workspace Configuration." 
        description="Manage your account preferences and operational boundaries." 
      />
      
      <div className="grid gap-8 lg:grid-cols-[1fr_2fr]">
        <div className="space-y-2">
          <button className="w-full text-left rounded-xl bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-bold text-sm px-4 py-3 shadow-md">
            General Security
          </button>
          <button className="w-full text-left rounded-xl text-[hsl(var(--muted-foreground))] font-bold text-sm px-4 py-3 hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors">
            Notifications
          </button>
          <button className="w-full text-left rounded-xl text-[hsl(var(--muted-foreground))] font-bold text-sm px-4 py-3 hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors">
            Data Export
          </button>
        </div>
        
        <div className="space-y-6">
          <div className="panel p-6 md:p-8">
            <div className="flex items-center gap-3 text-[hsl(var(--foreground))] mb-6">
              <ShieldCheck size={24} className="text-[hsl(var(--primary))]" />
              <h2 className="display-font text-2xl font-bold">Identity & Authorization</h2>
            </div>
            
            <div className="grid gap-4 sm:grid-cols-2">
              <Info label="Clerk Identity" value={context?.user?.email} />
              <Info label="Full Name" value={context?.user?.name} />
              <Info label="Platform Role" value={context?.isPlatformOwner ? 'Platform Owner' : 'Standard User'} className={context?.isPlatformOwner ? "border-[hsl(var(--primary)/.3)] bg-[hsl(var(--primary)/.05)]" : ""} />
            </div>
            
            <div className="mt-8">
              <div className="eyebrow mb-4">Active Tenancies</div>
              {context?.roles?.length ? (
                <div className="space-y-3">
                  {context.roles.map(r => (
                    <div key={r.id} className="flex items-center justify-between border border-[hsl(var(--border))] rounded-xl p-4 bg-[hsl(var(--card))]">
                      <div>
                        <div className="font-bold text-sm">School ID: {r.schoolId || 'Platform'}</div>
                        <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1">Authorized scope</div>
                      </div>
                      <span className="bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))] dark:text-[hsl(var(--accent))] text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                        {r.role.replace('_', ' ')}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[hsl(var(--muted-foreground))]">No active tenant roles. Ask your administrator for access.</p>
              )}
            </div>
          </div>
          
          <div className="panel p-6 md:p-8 opacity-70">
            <div className="flex items-center gap-3 text-[hsl(var(--muted-foreground))] mb-4">
              <Database size={24} />
              <h2 className="display-font text-xl font-bold">Data & Privacy</h2>
            </div>
            <p className="text-sm">Data export functionality is managed by the Platform Owner. Your data is isolated per tenant.</p>
          </div>
        </div>
      </div>
    </div>
  );
}