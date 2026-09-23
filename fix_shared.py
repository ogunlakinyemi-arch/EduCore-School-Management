import os
import re

with open("artifacts/edupulse/src/components/shared.tsx", "r") as f:
    shared = f.read()

# Add new imports
shared = shared.replace(
    "import { useState, type ReactNode, type FormEvent } from 'react';",
    "import { useState, type ReactNode, type FormEvent, createContext, useContext, useEffect, useRef } from 'react';"
)
shared = shared.replace(
    "import { useGetAuthorizedContext, useListSchools, getListSchoolsQueryKey } from '@workspace/api-client-react';",
    "import { useGetAuthorizedContext, useListSchools, getListSchoolsQueryKey, useGetCurrentUserSchools } from '@workspace/api-client-react';"
)

# Update Shell
shell_replacement = """export function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const { schoolId } = useTenant();
  const contextQuery = useGetAuthorizedContext();
  const context = contextQuery.data;
  
  if (contextQuery.isLoading) return <div className="min-h-[100dvh] bg-[hsl(var(--background))]" />;

  const roles = context?.roles?.map(r => r.role) || [];
  const isPlatformOwner = context?.isPlatformOwner || false;
  if (isPlatformOwner && !roles.includes('PLATFORM_OWNER')) roles.push('PLATFORM_OWNER');

  const visibleNav = nav.filter(item => !item.roles || item.roles.some(role => roles.includes(role)));
  const name = context?.user?.name ?? 'EduPulse user';
  const roleDisplay = isPlatformOwner ? 'Platform Owner' : (roles[0]?.replaceAll('_', ' ') ?? 'User').toLowerCase();
  const initials = name.split(' ').slice(0, 2).map(part => part[0]).join('').toUpperCase();
  
  const userSchoolsQuery = useGetCurrentUserSchools({ query: { enabled: !isPlatformOwner && !!contextQuery.data } });
  const schoolsQuery = useListSchools({ status: 'active' as any }, { query: { enabled: isPlatformOwner, queryKey: getListSchoolsQueryKey({ status: 'active' as any }) } }); 
  
  let schoolName = 'Platform Network';
  if (schoolId) {
    if (isPlatformOwner) {
      schoolName = schoolsQuery.data?.find((s: any) => s.id === schoolId)?.name || 'Authorized School';
    } else {
      schoolName = userSchoolsQuery.data?.find((s: any) => s.schoolId === schoolId)?.name || 'Authorized School';
    }
  }"""

shared = re.sub(r"export function Shell\(\{ children \}: \{ children: ReactNode \}\) \{.*?const schoolName = !isPlatformOwner && context\?.roles\?\.\[0\]\?.schoolId \? 'Authorized School' : 'Platform Network';", shell_replacement, shared, flags=re.DOTALL)


# Update TenantPicker and add Provider
tenant_logic = """type TenantContextType = {
  schoolId: number;
  setSchoolId: (id: number) => void;
};

const TenantContext = createContext<TenantContextType>({ schoolId: 0, setSchoolId: () => {} });

export function TenantProvider({ children }: { children: ReactNode }) {
  const [schoolId, setSchoolId] = useState<number>(0);
  const initialized = useRef(false);
  
  const contextQuery = useGetAuthorizedContext();
  const isPlatformOwner = contextQuery.data?.isPlatformOwner;
  
  const userSchoolsQuery = useGetCurrentUserSchools({ query: { enabled: !isPlatformOwner && !!contextQuery.data } });
  
  useEffect(() => {
    if (initialized.current || contextQuery.isLoading) return;
    
    if (isPlatformOwner) {
      setSchoolId(0);
      initialized.current = true;
    } else if (userSchoolsQuery.data && userSchoolsQuery.data.length > 0) {
      setSchoolId(userSchoolsQuery.data[0].schoolId);
      initialized.current = true;
    }
  }, [contextQuery.isLoading, isPlatformOwner, userSchoolsQuery.data]);

  return <TenantContext.Provider value={{ schoolId, setSchoolId }}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  return useContext(TenantContext);
}

export function TenantPicker() {
  const { schoolId, setSchoolId } = useTenant();
  const contextQuery = useGetAuthorizedContext();
  const isPlatformOwner = contextQuery.data?.isPlatformOwner || false;
  
  const schoolsQuery = useListSchools({ status: 'active' as any }, { query: { enabled: isPlatformOwner, queryKey: getListSchoolsQueryKey({ status: 'active' as any }) } }); 
  const userSchoolsQuery = useGetCurrentUserSchools({ query: { enabled: !isPlatformOwner && !!contextQuery.data } });

  const authorizedSchools = isPlatformOwner 
    ? (schoolsQuery.data ?? []) 
    : (userSchoolsQuery.data ?? []).map((s: any) => ({ id: s.schoolId, name: s.name }));

  if (!isPlatformOwner && authorizedSchools.length <= 1) return null;

  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3.5 py-2 shadow-sm">
      <Building2 size={16} className="text-[hsl(var(--primary))]" />
      <select 
        value={schoolId || ''} 
        onChange={e => setSchoolId(Number(e.target.value))} 
        className="max-w-[200px] border-0 bg-transparent p-0 text-sm font-bold outline-none ring-0 focus:ring-0" 
        data-testid="select-tenant-school"
      >
        {isPlatformOwner ? <option value="">Platform Network</option> : (!schoolId && <option value="">Select a school context</option>)}
        {authorizedSchools.map((school: any) => (
          <option key={school.id} value={school.id}>{school.name}</option>
        ))}
      </select>
    </div>
  );
}"""

shared = re.sub(r"export function TenantPicker.*", tenant_logic, shared, flags=re.DOTALL)

with open("artifacts/edupulse/src/components/shared.tsx", "w") as f:
    f.write(shared)

