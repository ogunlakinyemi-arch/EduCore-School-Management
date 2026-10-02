import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Bell, Smartphone, ShieldCheck, ArrowLeft } from 'lucide-react';
import { useGetCommunicationPreferences, useUpdateCommunicationPreference, useListCommunicationPushDevices, useRegisterCommunicationPushDevice, useRevokeCommunicationPushDevice, getGetCommunicationPreferencesQueryKey, getListCommunicationPushDevicesQueryKey } from '@workspace/api-client-react';
import type { CommunicationCategory, CommunicationChannel, CommunicationPreference } from '@workspace/api-client-react';
import { PageHeading, Button, EmptyState, ErrorState, SkeletonPage, StatusPill, date, useTenant } from '@/components/shared';
import { pushDevices } from './communication-contract';
import { WebPushControl } from '@/components/web-push-control';
import { SchoolCommunicationDefaultsControl } from '@/components/school-communication-defaults';
import { useSchoolAdminAccess } from '@/components/shared';

export function NotificationSettings({ standalone = false }: { standalone?: boolean }) {
  const { schoolId } = useTenant();
  const schoolAccess = useSchoolAdminAccess();
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [reference, setReference] = useState('');
  const params = schoolId ? { schoolId } : undefined;
  const prefs = useGetCommunicationPreferences(params, { query: { queryKey: getGetCommunicationPreferencesQueryKey(params) } });
  const devices = useListCommunicationPushDevices(params, { query: { queryKey: getListCommunicationPushDevicesQueryKey(params) } });
  const update = useUpdateCommunicationPreference();
  const register = useRegisterCommunicationPushDevice();
  const revoke = useRevokeCommunicationPushDevice();
  const onToggle = async (category: CommunicationCategory, channel: CommunicationChannel, enabled: boolean) => {
    try { await update.mutateAsync({ data: { schoolId: schoolId || null, category, channel, enabled } }); setError(''); await qc.invalidateQueries({ queryKey: getGetCommunicationPreferencesQueryKey(params) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Preference could not be saved.'); }
  };
  const onRegister = async () => {
    if (!reference.trim()) return;
    try { await register.mutateAsync({ data: { schoolId: schoolId || null, opaqueDeviceReference: reference.trim() } }); setReference(''); setError(''); await qc.invalidateQueries({ queryKey: getListCommunicationPushDevicesQueryKey(params) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Device reference could not be registered.'); }
  };
  const onRevoke = async (id: number) => {
    if (!window.confirm('Revoke this push device reference?')) return;
    try { await revoke.mutateAsync({ deviceId: id }); setError(''); await qc.invalidateQueries({ queryKey: getListCommunicationPushDevicesQueryKey(params) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Device reference could not be revoked.'); }
  };
  const grouped = (prefs.data?.preferences ?? []).reduce<Record<string, CommunicationPreference[]>>((acc, item) => {
    (acc[item.category] ??= []).push(item);
    return acc;
  }, {});
  return <div className={standalone ? 'mx-auto max-w-6xl p-5 md:p-8 fade-up' : 'fade-up'}>
    {schoolId && (schoolAccess.isSchoolAdmin || schoolAccess.isPlatformOwner) && <SchoolCommunicationDefaultsControl schoolId={schoolId} />}
    <PageHeading eyebrow="Your messages / Controls" title="Notification settings." description="Choose how school updates reach you. Security and account messages may remain required." action={<Link href="/inbox" className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-bold" data-testid="link-back-inbox"><ArrowLeft size={15} /> Inbox</Link>} />
    {error && <div role="alert" className="mb-5 rounded-xl border border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.07)] p-4 text-sm text-[hsl(var(--destructive))]">{error}</div>}
    <div className="grid gap-6 xl:grid-cols-[1.4fr_.8fr]">
      <section className="panel overflow-hidden">
        <div className="border-b border-[hsl(var(--border))] p-5 md:p-6"><div className="eyebrow">Delivery choices</div><h2 className="display-font mt-1 text-xl font-bold">Preferences</h2><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">{schoolId ? 'For your current school' : 'Global preferences'}</p></div>
        {prefs.isLoading ? <SkeletonPage /> : prefs.isError ? <ErrorState retry={() => void prefs.refetch()} /> : !prefs.data?.preferences.length ? <EmptyState icon={Bell} title="No preferences available" description="Your available notification preferences will appear here when configured." /> :
          <div className="divide-y divide-[hsl(var(--border))]">{Object.entries(grouped).map(([category, rows]) => <div key={category} className="p-5 md:p-6">
            <h3 className="text-sm font-bold capitalize">{category.toLowerCase().replaceAll('_', ' ')}</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">{rows?.map(row => <div key={`${row.category}:${row.channel}`} className="flex items-center justify-between gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.25)] p-3">
              <div><div className="text-xs font-bold">{row.channel.replaceAll('_', ' ')}</div>{row.mandatory && <div className="mt-1 flex items-center gap-1 text-[11px] text-[hsl(var(--muted-foreground))]"><ShieldCheck size={12} /> Required</div>}</div>
              <button type="button" role="switch" aria-checked={row.enabled} aria-label={`${category} via ${row.channel}`} data-testid={`switch-preference-${category}-${row.channel}`} disabled={row.mandatory || update.isPending} onClick={() => void onToggle(row.category, row.channel, !row.enabled)} className={`relative h-7 w-12 rounded-full transition-colors disabled:opacity-60 ${row.enabled ? 'bg-[hsl(var(--primary))]' : 'bg-[hsl(var(--muted-foreground)/.4)]'}`}><span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-[hsl(var(--card))] shadow-sm transition-transform ${row.enabled ? 'translate-x-5' : 'translate-x-0'}`} /></button>
            </div>)}</div>
          </div>)}</div>}
      </section>
      <section className="panel h-fit overflow-hidden">
        <WebPushControl schoolId={schoolId ?? null} />
        <div className="border-b border-[hsl(var(--border))] p-5 md:p-6"><Smartphone size={22} className="text-[hsl(var(--primary))]" /><h2 className="display-font mt-3 text-xl font-bold">Push device readiness</h2><p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">Device references are for development testing. Registering one does not subscribe this browser to Web Push or prove that any real notification will arrive.</p></div>
        <div className="p-5 md:p-6">
          <label className="block text-xs font-bold" htmlFor="device-reference">Opaque test device reference</label>
          <input id="device-reference" data-testid="input-device-reference" value={reference} onChange={e => setReference(e.target.value)} maxLength={256} placeholder="Reference supplied by your test client" className="mt-2 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3 text-sm" />
          <Button className="mt-3 w-full" disabled={!reference.trim() || register.isPending} onClick={() => void onRegister()}>Register test reference</Button>
          <div className="mt-6 border-t border-[hsl(var(--border))] pt-5"><div className="eyebrow mb-3">Registered references</div>
            {devices.isLoading ? <div className="skeleton h-20 rounded-xl" /> : devices.isError ? <ErrorState retry={() => void devices.refetch()} /> : !pushDevices(devices.data).length ? <p className="text-sm text-[hsl(var(--muted-foreground))]">No device references registered.</p> : <div className="space-y-3">{pushDevices(devices.data).map(device => <div key={device.id} className="rounded-xl border border-[hsl(var(--border))] p-3" data-testid={`row-push-device-${device.id}`}><div className="flex items-center justify-between gap-3"><span className="text-xs font-bold">Device #{device.id}</span><StatusPill value={device.status} /></div><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Added {date(device.createdAt)} · {device.provider}</p>{device.status === 'ACTIVE' && <button type="button" onClick={() => void onRevoke(device.id)} disabled={revoke.isPending} className="mt-2 text-xs font-bold text-[hsl(var(--destructive))]" data-testid={`button-revoke-device-${device.id}`}>Revoke reference</button>}</div>)}</div>}
          </div>
        </div>
      </section>
    </div>
  </div>;
}