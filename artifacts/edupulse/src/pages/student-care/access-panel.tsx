import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useListStudentCareGrants, useSetStudentCareGrant, useListSchoolUsers, getListStudentCareGrantsQueryKey } from '@workspace/api-client-react';
import { Button, EmptyState } from '@/components/shared';
import { GRANTABLE, grantPayload, errorInfo, label } from './care-contract';
import { Banner, SkeletonRows, Select } from './care-ui';

export function AccessPanel({ schoolId }: { schoolId: number }) {
  const qc = useQueryClient();
  const grants = useListStudentCareGrants(schoolId, { query: { retry: false, queryKey: getListStudentCareGrantsQueryKey(schoolId) } });
  const users = useListSchoolUsers({ schoolId }, { query: { retry: false, queryKey: ['/api/school-users', schoolId] } });
  const save = useSetStudentCareGrant();
  const [userId, setUserId] = useState('');
  const [perms, setPerms] = useState<string[]>([]);
  const [ok, setOk] = useState('');

  // Existing school users only. Platform owners are never listed; the API also rejects them.
  const eligible = (users.data ?? []).filter(u => u.membershipStatus?.toUpperCase() === 'ACTIVE' && u.userStatus?.toUpperCase() === 'ACTIVE' && u.role !== 'PLATFORM_OWNER' && u.role !== 'PARENT' && u.role !== 'STUDENT');
  const nameOf = (id: number) => { const u = (users.data ?? []).find(x => x.id === id); return u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email : `User #${id}`; };
  const run = (uid: number, active: boolean, p: string[]) => {
    if (save.isPending) return;
    setOk('');
    save.mutate({ schoolId, data: grantPayload(uid, active, p) }, {
      onSuccess: async () => { setOk(active ? 'Access saved.' : 'Access revoked.'); setUserId(''); setPerms([]); await qc.invalidateQueries({ queryKey: getListStudentCareGrantsQueryKey(schoolId) }); },
    });
  };
  const toggle = (p: string) => setPerms(c => c.includes(p) ? c.filter(x => x !== p) : [...c, p]);
  const list = grants.data ?? [];
  return (
    <section className="panel p-5 md:p-6">
      <div className="mb-1 flex items-center gap-2"><KeyRound size={18} className="text-[hsl(var(--primary))]" /><h3 className="display-font text-xl font-bold">Student-care access</h3></div>
      <p className="mb-5 text-xs text-[hsl(var(--muted-foreground))]">Medical, welfare, safeguarding and behaviour access is explicit. School Admin role alone does not open clinical records. Platform Owner accounts cannot be granted access.</p>
      <div className="mb-6 rounded-2xl border border-[hsl(var(--border))] p-4">
        <Select value={userId} onChange={setUserId} blank={users.isLoading ? 'Loading users…' : 'Choose a school user'} options={eligible.map(u => ({ value: String(u.id), label: `${`${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email} (${label(u.role)})` }))} />
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {GRANTABLE.map(p => <label key={p} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={perms.includes(p)} onChange={() => toggle(p)} />{label(p)}</label>)}
        </div>
        <div className="mt-4"><Button disabled={!userId || !perms.length || save.isPending} onClick={() => run(Number(userId), true, perms)} testId="button-grant-care-access">{save.isPending ? 'Saving…' : 'Grant access'}</Button></div>
      </div>
      {save.error ? <div className="mb-4"><Banner tone="error">{errorInfo(save.error).message}</Banner></div> : null}
      {ok && <div className="mb-4"><Banner tone="ok">{ok}</Banner></div>}
      {grants.isLoading ? <SkeletonRows n={2} /> : grants.isError ? <Banner tone="error">{errorInfo(grants.error).message} <button className="ml-2 underline" onClick={() => grants.refetch()}>Retry</button></Banner> : !list.length ? (
        <EmptyState icon={KeyRound} title="No one has care access yet" description="Grant specific permissions to the staff who need them." />
      ) : (
        <ul className="divide-y divide-[hsl(var(--border)/.7)]">
          {list.map(g => (
            <li key={g.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0"><div className="text-sm font-bold">{nameOf(g.userId)} {!g.active && <span className="text-xs text-[hsl(var(--destructive))]">revoked</span>}</div><div className="mt-1 flex flex-wrap gap-1">{g.permissions.map(p => <span key={p} className="rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[10px] font-bold">{label(p)}</span>)}</div></div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setUserId(String(g.userId)); setPerms([...g.permissions]); }}>Edit</Button>
                {g.active && <Button variant="danger" disabled={save.isPending} onClick={() => run(g.userId, false, [...g.permissions])}>Revoke</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
