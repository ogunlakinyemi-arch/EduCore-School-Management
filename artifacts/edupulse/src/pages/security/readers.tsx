import { useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useListEligibleSchoolSecurityDevices, getListEligibleSchoolSecurityDevicesQueryKey } from '@workspace/api-client-react';
import { useListSchoolSecurityLocations, getListSchoolSecurityLocationsQueryKey, useCreateSchoolSecurityLocation, useSetSchoolSecurityLocationStatus, useListSchoolSecurityReaders, getListSchoolSecurityReadersQueryKey, useConfigureSchoolSecurityReader, useSetSchoolSecurityReaderStatus } from '@workspace/api-client-react';
import type { SecurityLocationInputZoneType, SecurityReaderInputPermissionsItem } from '@workspace/api-client-react';
import { Button, Field, StatusPill } from '@/components/shared';
import { safeMessage } from './security-contract';
import { inputClass, Notice, QueryBoundary } from './ui';

export function Readers({ schoolId, canMutate }: { schoolId: number; canMutate: boolean }) {
  const qc = useQueryClient();
  const locs = useListSchoolSecurityLocations(schoolId, { query: { enabled: !!schoolId, queryKey: getListSchoolSecurityLocationsQueryKey(schoolId), staleTime: 15000 } });
  const readers = useListSchoolSecurityReaders(schoolId, { query: { enabled: !!schoolId, queryKey: getListSchoolSecurityReadersQueryKey(schoolId), staleTime: 15000 } });
  const createLoc = useCreateSchoolSecurityLocation(); const setLoc = useSetSchoolSecurityLocationStatus();
  const config = useConfigureSchoolSecurityReader(); const setReader = useSetSchoolSecurityReaderStatus();
  const [msg, setMsg] = useState('');
  const [name, setName] = useState(''); const [zone, setZone] = useState<SecurityLocationInputZoneType>('GATE');
  const devices = useListEligibleSchoolSecurityDevices(schoolId, { query: { enabled: !!schoolId, queryKey: getListEligibleSchoolSecurityDevicesQueryKey(schoolId), staleTime: 30000 } });
  const [rName, setRName] = useState(''); const [rLoc, setRLoc] = useState(''); const [rDev, setRDev] = useState(''); const [perms, setPerms] = useState<SecurityReaderInputPermissionsItem[]>(['ENTRY']);
  const refresh = async () => { await qc.invalidateQueries({ queryKey: getListSchoolSecurityLocationsQueryKey(schoolId) }); await qc.invalidateQueries({ queryKey: getListSchoolSecurityReadersQueryKey(schoolId) }); };
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); setMsg(''); await refresh(); } catch (e) { setMsg(safeMessage(e)); } };
  return <div className="grid gap-6 lg:grid-cols-2">
    {msg && <div className="lg:col-span-2"><Notice tone="error">{msg}</Notice></div>}
    <section className="panel p-5"><div className="eyebrow">Locations</div>
      <QueryBoundary query={locs}><ul className="mt-3 divide-y divide-[hsl(var(--border)/.7)]">{(locs.data ?? []).map(l => <li key={l.id} className="flex items-center justify-between gap-3 py-3" data-testid={`row-location-${l.id}`}><div><div className="font-bold">{l.name}</div><div className="text-xs text-[hsl(var(--muted-foreground))]">{l.zoneType ?? 'GATE'} · #{l.id}</div></div><div className="flex items-center gap-2"><StatusPill value={l.status} />{canMutate && <Button variant="outline" disabled={setLoc.isPending} onClick={() => void run(() => setLoc.mutateAsync({ schoolId, locationId: l.id, data: { status: l.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' } }))}>{l.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</Button>}</div></li>)}{!locs.data?.length && <li className="py-6 text-sm text-[hsl(var(--muted-foreground))]">No locations yet.</li>}</ul></QueryBoundary>
      {canMutate && <form className="mt-4 space-y-3 border-t border-[hsl(var(--border))] pt-4" onSubmit={e => { e.preventDefault(); if (!name.trim()) return; void run(async () => { await createLoc.mutateAsync({ schoolId, data: { name: name.trim(), zoneType: zone } }); setName(''); }); }}>
        <Field label="New location name"><input className={inputClass} value={name} onChange={e => setName(e.target.value)} maxLength={120} data-testid="input-location-name" /></Field>
        <Field label="Zone"><select className={inputClass} value={zone} onChange={e => setZone(e.target.value as SecurityLocationInputZoneType)}>{['GATE', 'CAMPUS', 'BUILDING', 'OTHER'].map(z => <option key={z}>{z}</option>)}</select></Field>
        <Button type="submit" disabled={createLoc.isPending || !name.trim()} testId="button-add-location">Add location</Button></form>}
    </section>
    <section className="panel p-5"><div className="eyebrow">Readers</div>
      <QueryBoundary query={readers}><ul className="mt-3 divide-y divide-[hsl(var(--border)/.7)]">{(readers.data ?? []).map(r => <li key={r.id} className="flex items-center justify-between gap-3 py-3" data-testid={`row-reader-${r.id}`}><div><div className="font-bold">{r.name}</div><div className="text-xs text-[hsl(var(--muted-foreground))]">{r.locationName} · {r.deviceName} ({r.deviceSerial}) · {r.permissions.join('/')}</div></div><div className="flex items-center gap-2"><StatusPill value={r.status} />{canMutate && <Button variant="outline" disabled={setReader.isPending} onClick={() => void run(() => setReader.mutateAsync({ schoolId, readerId: r.id, data: { status: r.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' } }))}>{r.status === 'ACTIVE' ? 'Disable' : 'Enable'}</Button>}</div></li>)}{!readers.data?.length && <li className="py-6 text-sm text-[hsl(var(--muted-foreground))]">No readers configured.</li>}</ul></QueryBoundary>
      {canMutate && <form className="mt-4 space-y-3 border-t border-[hsl(var(--border))] pt-4" onSubmit={e => { e.preventDefault(); if (!rName.trim() || !Number(rLoc) || !Number(rDev) || !perms.length) return; void run(async () => { await config.mutateAsync({ schoolId, data: { name: rName.trim(), locationId: Number(rLoc), deviceId: Number(rDev), permissions: perms } }); setRName(''); setRDev(''); }); }}>
        <Field label="Reader name"><input className={inputClass} value={rName} onChange={e => setRName(e.target.value)} data-testid="input-reader-name" /></Field>
        <Field label="Location"><select className={inputClass} value={rLoc} onChange={e => setRLoc(e.target.value)} data-testid="select-reader-location"><option value="">Select</option>{(locs.data ?? []).filter(l => l.status === 'ACTIVE').map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
        <Field label="Device"><select className={inputClass} value={rDev} onChange={e => setRDev(e.target.value)} data-testid="select-reader-device"><option value="">Select an eligible device</option>{(devices.data ?? []).map(d => <option key={d.id} value={d.id}>{d.name} - {d.serialNumber}{d.readerName ? ` (in use: ${d.readerName})` : ''}</option>)}</select></Field>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">Device IDs come from registered devices (<Link href="/devices" className="font-bold text-[hsl(var(--primary))]">Devices</Link>).</p>
        <div className="flex gap-3">{(['ENTRY', 'EXIT'] as const).map(p => <label key={p} className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={perms.includes(p)} onChange={() => setPerms(x => x.includes(p) ? x.filter(i => i !== p) : [...x, p])} />{p}</label>)}</div>
        <Button type="submit" disabled={config.isPending} testId="button-save-reader">Save reader</Button></form>}
    </section></div>;
}
