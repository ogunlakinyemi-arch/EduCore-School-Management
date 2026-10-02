import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGetSchoolSecuritySettings, getGetSchoolSecuritySettingsQueryKey, useUpdateSchoolSecuritySettings, useListSchoolSecurityStaffGrants, getListSchoolSecurityStaffGrantsQueryKey, useGrantSchoolSecurityStaff, useRevokeSchoolSecurityStaffGrant } from '@workspace/api-client-react';
import type { SecurityGrantInputPermissionsItem } from '@workspace/api-client-react';
import { Button, Field, StatusPill, date } from '@/components/shared';
import { safeMessage } from './security-contract';
import { inputClass, Notice, QueryBoundary } from './ui';

const PERMS: SecurityGrantInputPermissionsItem[] = ['READ', 'MANAGE_READERS', 'MANAGE_CARDS', 'REVIEW_PRESENCE', 'SECURITY_READ', 'SECURITY_MANAGE', 'VISITOR_MANAGE', 'PICKUP_APPROVE', 'INCIDENT_MANAGE', 'EMERGENCY_BROADCAST', 'COMMUNICATION_SEND'];

export function Settings({ schoolId, canMutate, canGrant, delegated }: { schoolId: number; canMutate: boolean; canGrant: boolean; delegated: boolean }) {
  const qc = useQueryClient();
  const q = useGetSchoolSecuritySettings(schoolId, { query: { enabled: !!schoolId, queryKey: getGetSchoolSecuritySettingsQueryKey(schoolId), staleTime: 15000 } });
  const update = useUpdateSchoolSecuritySettings();
  const [v, setV] = useState({ securityEnabled: false, parentEntryAlerts: false, parentExitAlerts: false });
  const [msg, setMsg] = useState('');
  useEffect(() => { if (q.data) setV({ securityEnabled: q.data.securityEnabled, parentEntryAlerts: q.data.parentEntryAlerts, parentExitAlerts: q.data.parentExitAlerts }); }, [q.data]);
  const save = async () => { try { await update.mutateAsync({ schoolId, data: v }); setMsg('Settings saved.'); await qc.invalidateQueries({ queryKey: getGetSchoolSecuritySettingsQueryKey(schoolId) }); } catch (e) { setMsg(safeMessage(e)); } };
  return <div className="grid gap-6 lg:grid-cols-2">
    <section className="panel p-5"><div className="eyebrow">Settings</div>
      <QueryBoundary query={q}><div className="mt-3 space-y-3">{([['securityEnabled', 'Campus security enabled'], ['parentEntryAlerts', 'Alert parents on entry'], ['parentExitAlerts', 'Alert parents on exit']] as const).map(([k, l]) => <label key={k} className="flex items-center gap-3 text-sm font-bold"><input type="checkbox" disabled={!canMutate} checked={v[k]} onChange={e => setV(s => ({ ...s, [k]: e.target.checked }))} data-testid={`switch-${k}`} />{l}</label>)}
        <p className="text-xs text-[hsl(var(--muted-foreground))]">Alerts are in-app notifications. SMS, email and push are only sent when a provider is configured; see delivery status.</p>
        {msg && <Notice>{msg}</Notice>}{canMutate && <Button onClick={() => void save()} disabled={update.isPending} testId="button-save-settings">Save settings</Button>}</div></QueryBoundary></section>
    {delegated && <section className="panel p-5"><div className="eyebrow">Delegated privileges</div><h3 className="display-font mt-1 text-lg font-bold">Your staff access</h3><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">As staff you operate on delegated core privileges: readers, visitors, pickup handling and presence review. School Admins hold the grants; the server enforces each action and will refuse anything not delegated to you.</p></section>}
    {canGrant && <Grants schoolId={schoolId} />}
  </div>;
}

function Grants({ schoolId }: { schoolId: number }) {
  const qc = useQueryClient();
  const q = useListSchoolSecurityStaffGrants(schoolId, { query: { enabled: !!schoolId, queryKey: getListSchoolSecurityStaffGrantsQueryKey(schoolId), staleTime: 15000 } });
  const grant = useGrantSchoolSecurityStaff(); const revoke = useRevokeSchoolSecurityStaffGrant();
  const [userId, setUserId] = useState(''); const [perms, setPerms] = useState<SecurityGrantInputPermissionsItem[]>(['SECURITY_READ']); const [exp, setExp] = useState(''); const [msg, setMsg] = useState('');
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); setMsg(''); await qc.invalidateQueries({ queryKey: getListSchoolSecurityStaffGrantsQueryKey(schoolId) }); } catch (e) { setMsg(safeMessage(e)); } };
  return <section className="panel p-5 lg:col-span-2"><div className="eyebrow">Staff grants</div>
    {msg && <Notice tone="error">{msg}</Notice>}
    <QueryBoundary query={q}><ul className="mt-3 divide-y divide-[hsl(var(--border)/.7)]">{(q.data ?? []).map(g => <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-3" data-testid={`row-grant-${g.id}`}><div><div className="font-bold">User #{g.userId}</div><div className="text-xs text-[hsl(var(--muted-foreground))]">{g.permissions.join(', ')}{g.expiresAt ? ` · expires ${date(g.expiresAt)}` : ''}</div></div><div className="flex items-center gap-2"><StatusPill value={g.status} />{g.status === 'ACTIVE' && <Button variant="danger" disabled={revoke.isPending} onClick={() => { if (window.confirm('Revoke this grant?')) void run(() => revoke.mutateAsync({ schoolId, grantId: g.id })); }}>Revoke</Button>}</div></li>)}{!q.data?.length && <li className="py-6 text-sm text-[hsl(var(--muted-foreground))]">No grants issued.</li>}</ul></QueryBoundary>
    <form className="mt-4 space-y-3 border-t border-[hsl(var(--border))] pt-4" onSubmit={e => { e.preventDefault(); if (!Number(userId) || !perms.length) return; void run(async () => { await grant.mutateAsync({ schoolId, data: { userId: Number(userId), permissions: perms, expiresAt: exp ? new Date(exp).toISOString() : null } }); setUserId(''); }); }}>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Staff user ID"><input className={inputClass} inputMode="numeric" value={userId} onChange={e => setUserId(e.target.value.replace(/\D/g, ''))} data-testid="input-grant-user" /></Field><Field label="Expires (optional)"><input type="datetime-local" className={inputClass} value={exp} onChange={e => setExp(e.target.value)} /></Field></div>
      <div className="flex flex-wrap gap-2">{PERMS.map(p => <label key={p} className="flex items-center gap-1.5 rounded-xl border border-[hsl(var(--border))] px-2.5 py-1.5 text-xs font-bold"><input type="checkbox" checked={perms.includes(p)} onChange={() => setPerms(x => x.includes(p) ? x.filter(i => i !== p) : [...x, p])} />{p.replaceAll('_', ' ')}</label>)}</div>
      <Button type="submit" disabled={grant.isPending} testId="button-grant">Grant access</Button></form></section>;
}
