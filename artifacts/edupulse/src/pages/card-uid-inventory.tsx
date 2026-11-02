import { useState } from 'react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Radio, Search } from 'lucide-react';
import { Button, EmptyState, PageHeading } from '@/components/shared';
import { CopyUid, OwnerUidReaderSection, uidInventoryKey, type UidInventory } from '@/components/owner-uid-reader';
import { AssignUidModal } from '@/components/uid-actions';

const time = (value?: string) => value ? new Date(value).toLocaleString('en-NG') : 'Unavailable';
export function CardUidInventoryPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [page, setPage] = useState(1);
  const [assign, setAssign] = useState<string | null>(null);
  const params = new URLSearchParams({ page: String(page), pageSize: '50' });
  if (q.trim()) params.set('q', q.trim());
  if (status) params.set('status', status);
  if (deviceId) params.set('deviceId', deviceId);
  const inventory = useQuery({
    queryKey: [...uidInventoryKey, 'search', params.toString()],
    queryFn: () => customFetch<UidInventory>(`/api/platform/uid-inventory?${params}`),
    refetchInterval: 3_000,
  });
  const rows = inventory.data?.inventory ?? [];
  const total = inventory.data?.total ?? 0;
  return <div className="fade-up">
    <PageHeading eyebrow="Platform Owner / NFC hardware" title="Card UID Inventory"
      description="Permanent UIDs reported by your authenticated readers, including cards not connected to a student."
      action={<span className="flex flex-wrap gap-4"><Link href="/nfc-scan-audit" className="text-sm font-bold underline" data-testid="link-nfc-scan-audit">NFC Card Scan Audit</Link><Link href="/devices" className="text-sm font-bold underline">Manage readers & credentials</Link></span>} />
    <div className="panel mb-6 p-5 text-sm">
      <p className="font-bold">Capture is not assignment or activation.</p>
      <p className="mt-1 text-[hsl(var(--muted-foreground))]">Every successful UID read is saved here. Unknown cards need no student connection. Registration is a separate, confirmed action. No attendance, access, subscription or payment action occurs during capture.</p>
    </div>
    <OwnerUidReaderSection inventory={inventory} showInventory={false} />
    <section className="panel overflow-hidden" aria-label="Captured card UIDs">
      <div className="border-b border-[hsl(var(--border))] p-5">
        <h2 className="text-lg font-bold">Captured card UIDs</h2>
        <p className="mb-4 text-xs text-[hsl(var(--muted-foreground))]">{total} matching UIDs · refreshes every 3 seconds · first/last seen are authenticated receipt times</p>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm">Search UID or reader
            <span className="relative mt-1 block"><Search className="absolute left-3 top-3" size={16} />
              <input aria-label="Search UID or reader" className="w-full pl-9" value={q} placeholder="UID, device name or serial" maxLength={128} onChange={e => { setQ(e.target.value); setPage(1); }} />
            </span>
          </label>
          <label className="text-sm">Capture / registration status
            <select aria-label="Capture status" value={status} className="mt-1 w-full" onChange={e => { setStatus(e.target.value); setPage(1); }}>
              <option value="">All successfully captured cards</option>
              <option value="UNKNOWN_UNASSIGNED">Unknown / unassigned</option>
              <option value="ASSIGNED">Assigned</option>
              <option value="RESERVED">Registered / reserved</option>
              <option value="DUPLICATE">Duplicate / already in inventory</option>
            </select>
          </label>
          <label className="text-sm">Seen on device
            <input aria-label="Seen on device ID" className="mt-1 w-full" type="number" min={1} step={1} value={deviceId} placeholder="All devices — enter Device ID" onChange={e => {
              const value = e.target.value;
              if (value === '' || /^[1-9]\d*$/.test(value)) { setDeviceId(value); setPage(1); }
            }} />
          </label>
        </div>
      </div>
      {inventory.isError && <div role="alert" className="border-b border-[hsl(var(--border))] p-5 text-sm text-[hsl(var(--destructive))]">
        Inventory delivery failed. Previously loaded results, if any, are retained; live status is unavailable.
        <Button variant="outline" onClick={() => void inventory.refetch()}>Retry inventory</Button>
      </div>}
      {inventory.isLoading ? <p role="status" className="p-5">Loading captured UIDs…</p> : rows.length ? rows.map(row =>
        <article key={row.uid} className="grid gap-4 border-b border-[hsl(var(--border))] p-5 lg:grid-cols-[1.2fr_1fr_1fr]" data-testid={`inventory-uid-${row.uid}`}>
          <div>
            <h3 className="select-all break-all font-mono text-xl font-bold">{row.rawUid ?? row.uid}</h3>
            {row.rawUid && row.rawUid !== row.uid && <p className="mt-1 text-xs">Inventory UID: <span className="select-all font-mono">{row.uid}</span></p>}
            <p className="my-2 text-sm font-bold" data-testid={`status-inventory-${row.uid}`}>{!row.assigned && (row.source === 'SCHOOL' || /PENDING/i.test(row.registrationStatus ?? '')) ? `Pending Registration — discovered on ${row.source === 'SCHOOL' ? 'school' : 'Owner'} reader` : !row.assigned ? 'Unknown / unassigned — UID captured' : row.studentId ? 'Assigned — UID captured' : 'Registered / reserved — UID captured'}</p>
            {row.duplicate && <p className="mb-2 text-xs">Duplicate UID · already in inventory / registration. No duplicate card record created.</p>}
            <CopyUid uid={row.rawUid ?? row.uid} />
          </div>
          <dl className="space-y-2 text-sm">
            <div><dt className="text-xs text-[hsl(var(--muted-foreground))]">Latest source device</dt><dd>{row.deviceName ?? `Device #${row.readerDeviceId}`} {row.serialNumber ? `(${row.serialNumber})` : ''}</dd><dd className="text-xs">Device ID {row.readerDeviceId}</dd></div>
            <div><dt className="text-xs text-[hsl(var(--muted-foreground))]">Discovery source</dt><dd>{row.source === 'SCHOOL' ? 'School reader' : row.source === 'OWNER' ? 'Owner reader' : 'Owner reader'}</dd>{row.sourceSchoolId != null && <dd className="text-xs">{row.sourceSchoolName ?? 'School'} (ID {row.sourceSchoolId})</dd>}</div>
            <div><dt className="text-xs text-[hsl(var(--muted-foreground))]">Successful physical reports</dt><dd>{row.scanCount ?? 1} · transport retries excluded</dd></div>
          </dl>
          <div className="space-y-2 text-sm">
            <p><span className="block text-xs text-[hsl(var(--muted-foreground))]">First seen</span>{time(row.firstSeenAt ?? row.capturedAt)}</p>
            <p><span className="block text-xs text-[hsl(var(--muted-foreground))]">Last seen</span>{time(row.lastSeenAt ?? row.capturedAt)}</p>
            {!row.assigned ? <Button variant="outline" onClick={() => setAssign(row.uid)}>Add to Registration</Button>
              : <Link href="/cards" className="inline-block text-sm font-bold underline">View existing card inventory</Link>}
          </div>
        </article>) : !inventory.isError && <EmptyState icon={Radio}
          title={q || status || deviceId ? 'No matching UIDs' : 'No UIDs captured yet'}
          description={q || status || deviceId ? 'Change the search or filters to find other captured cards.' : 'A card does not need a student connection. Configure the linked terminal with its dedicated Owner key and callback, then present a compatible card. Unsupported and failed scan statuses appear above, not as invented UIDs.'} />}
      <div className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm">Page {page} of {Math.max(1, Math.ceil(total / 50))}</p>
        <div className="flex gap-2">
          <Button variant="outline" disabled={page === 1 || inventory.isFetching} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <Button variant="outline" disabled={page * 50 >= total || inventory.isFetching} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      </div>
    </section>
    {assign && <AssignUidModal uid={assign} onClose={() => setAssign(null)} />}
  </div>;
}
