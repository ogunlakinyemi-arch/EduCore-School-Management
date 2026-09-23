import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { UserCog, Plus, ShieldCheck } from 'lucide-react';
import { 
  useListUsers, useListSchoolUsers, useCreateSchoolMembership, useCreatePlatformMembership,
  getListUsersQueryKey, getListSchoolUsersQueryKey, useGetAuthorizedContext
} from '@workspace/api-client-react';
import { 
  PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, 
  Modal, Field, TenantPicker, useTenant, cx, date
} from '@/components/shared';

export function UsersPage() {
  const { schoolId, setSchoolId } = useTenant();
  const [modal, setModal] = useState<any>(null); 
  const contextQuery = useGetAuthorizedContext();
  const isPlatformOwner = !!contextQuery.data?.isPlatformOwner;
  
  const qc = useQueryClient();
  
  // If no school selected but user is platform owner, show platform users.
  // If school selected, show school users.
  const isViewingPlatform = !schoolId && isPlatformOwner;
  const isViewingSchool = !!schoolId;

  const platformQuery = useListUsers({ query: { enabled: isViewingPlatform, queryKey: getListUsersQueryKey() } });
  const schoolQuery = useListSchoolUsers({ schoolId }, { query: { enabled: isViewingSchool, queryKey: getListSchoolUsersQueryKey({ schoolId }) } });
  
  const users = isViewingSchool ? schoolQuery.data ?? [] : platformQuery.data ?? [];
  const isLoading = (isViewingPlatform && platformQuery.isLoading) || (isViewingSchool && schoolQuery.isLoading);
  const isError = (isViewingPlatform && platformQuery.isError) || (isViewingSchool && schoolQuery.isError);

  const done = () => { 
    setModal(null); 
    if (isViewingSchool) qc.invalidateQueries({ queryKey: getListSchoolUsersQueryKey() });
    if (isViewingPlatform) qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
  };
  
  return (
    <div className="fade-up">
      <PageHeading 
        eyebrow="Security / Users" 
        title="Identity & Access." 
        description="Manage role-based access for platform operators and school staff." 
        action={
          <div className="flex items-center gap-3">
            <TenantPicker />
            <Button onClick={() => setModal({ create: true })} disabled={!isPlatformOwner && !schoolId}>
              <Plus size={16} />Assign Role
            </Button>
          </div>
        } 
      />
      
      {(!isPlatformOwner && !schoolId) ? (
        <EmptyState icon={UserCog} title="Select a school context" description="You must select a school to manage its users." />
      ) : isLoading ? (
        <SkeletonPage />
      ) : isError ? (
        <ErrorState retry={() => isViewingSchool ? schoolQuery.refetch() : platformQuery.refetch()} />
      ) : (
        <>
          <div className="mb-4 text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            {isViewingPlatform ? 'Platform-wide identities' : 'Tenant-scoped access'}
          </div>
          <div className="panel overflow-hidden">
            <div className="hidden grid-cols-[1.5fr_1.5fr_1fr_auto] gap-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-6 py-4 text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] md:grid">
              <span>User Identity</span>
              <span>Assigned Role</span>
              <span>Status</span>
              <span />
            </div>
            {users.length ? users.map((user: any) => (
              <div key={user.id} className="grid gap-3 border-b border-[hsl(var(--border)/.6)] px-5 py-5 transition-colors hover:bg-[hsl(var(--muted)/.2)] last:border-0 md:grid-cols-[1.5fr_1.5fr_1fr_auto] md:items-center md:gap-4 md:px-6">
                <div>
                  <div className="font-bold text-sm text-[hsl(var(--foreground))]">{user.firstName ? `${user.firstName} ${user.lastName}` : 'Anonymous User'}</div>
                  <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{user.email}</div>
                </div>
                <div>
                  {isViewingPlatform ? (
                    <div className="flex flex-wrap gap-1">
                      {user.memberships?.map((m: any) => (
                         <span key={m.id} className="bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))] dark:text-[hsl(var(--accent))] text-[10px] font-bold px-2 py-0.5 rounded border border-[hsl(var(--primary)/.2)]">
                           {m.role.replace('_', ' ')}
                         </span>
                      ))}
                    </div>
                  ) : (
                    <span className="bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))] dark:text-[hsl(var(--accent))] text-[10px] font-bold px-2 py-0.5 rounded border border-[hsl(var(--primary)/.2)]">
                      {user.role?.replace('_', ' ')}
                    </span>
                  )}
                </div>
                <div><StatusPill value={user.status || user.userStatus} /></div>
                <div />
              </div>
            )) : (
              <EmptyState icon={ShieldCheck} title="No users found" description="No role assignments found in this context." />
            )}
          </div>
          
          {modal && (
            <Modal title="Assign Role" eyebrow="Access Control" onClose={() => setModal(null)}>
              <MembershipForm isPlatformOwner={isViewingPlatform} schoolId={schoolId} onDone={done} onCancel={() => setModal(null)} />
            </Modal>
          )}
        </>
      )}
    </div>
  );
}

function MembershipForm({ isPlatformOwner, schoolId, onDone, onCancel }: { isPlatformOwner: boolean; schoolId?: number; onDone: () => void; onCancel: () => void }) {
  const createPlatform = useCreatePlatformMembership(); 
  const createSchool = useCreateSchoolMembership(); 
  
  const [form, setForm] = useState({ userId: '', role: isPlatformOwner ? 'PLATFORM_OWNER' : 'SCHOOL_ADMIN' });
  
  const save = (e: FormEvent) => { 
    e.preventDefault(); 
    const userId = Number(form.userId);
    if (isPlatformOwner) {
      createPlatform.mutate({ data: { userId, role: form.role as any } }, { onSuccess: onDone }); 
    } else if (schoolId) {
      createSchool.mutate({ data: { userId, schoolId, role: form.role as any } }, { onSuccess: onDone }); 
    }
  };
  
  const pending = createPlatform.isPending || createSchool.isPending;

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="rounded-xl border border-[hsl(var(--accent)/.3)] bg-[hsl(var(--accent)/.05)] p-4 text-sm text-[hsl(var(--foreground))]">
        <strong>Note:</strong> Users must first sign up via Clerk. Enter their internal User ID here to grant them specific roles.
      </div>
      
      <Field label="Target User ID">
        <input required type="number" min={1} value={form.userId} onChange={e => setForm({ ...form, userId: e.target.value })} placeholder="Internal numeric ID" />
      </Field>
      
      <Field label="Role Assignment">
        <select required value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
          {isPlatformOwner ? (
            <option value="PLATFORM_OWNER">Platform Owner</option>
          ) : (
            <>
              <option value="SCHOOL_ADMIN">School Administrator</option>
              <option value="ACCOUNTANT">Accountant</option>
              <option value="TEACHER">Teacher</option>
              <option value="STAFF">Staff</option>
            </>
          )}
        </select>
      </Field>

      <div className="flex justify-end gap-3 pt-5 border-t border-[hsl(var(--border))]">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Grant access'}</Button>
      </div>
      {(createPlatform.isError || createSchool.isError) && <p className="text-sm font-medium text-[hsl(var(--destructive))]">Could not assign role. Ensure the User ID exists.</p>}
    </form>
  );
}