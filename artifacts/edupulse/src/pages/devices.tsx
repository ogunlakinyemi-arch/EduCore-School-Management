import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Smartphone, Plus, Search, ShieldCheck, Tag, Loader2, Link as LinkIcon, Building2 } from 'lucide-react';
import { 
  useListPlatformDevices, useCreatePlatformDevice, useUpdatePlatformDevice, useListSchools,
  getListPlatformDevicesQueryKey, getListSchoolsQueryKey,
  PlatformDeviceDeviceType, PlatformDeviceStatus
} from '@workspace/api-client-react';
import { 
  PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, 
  Modal, Field, cx, date
} from '@/components/shared';

export function DevicesPage() {
  const [modal, setModal] = useState<any>(null);
  const [search, setSearch] = useState('');
  
  const qc = useQueryClient();
  const devicesQuery = useListPlatformDevices();
  const schoolsQuery = useListSchools({ status: 'active' as any });

  const devices = devicesQuery.data ?? [];
  const schools = schoolsQuery.data ?? [];

  const filteredDevices = useMemo(() => {
    if (!search) return devices;
    const lower = search.toLowerCase();
    return devices.filter(d => 
      d.name.toLowerCase().includes(lower) || 
      d.serialNumber.toLowerCase().includes(lower) ||
      d.schoolName?.toLowerCase().includes(lower)
    );
  }, [devices, search]);

  const done = () => {
    setModal(null);
    qc.invalidateQueries({ queryKey: getListPlatformDevicesQueryKey() });
  };

  return (
    <div className="fade-up">
      <PageHeading 
        eyebrow="Hardware / Inventory" 
        title="Platform Devices." 
        description="Manage hardware lifecycle, assignments, and provisioning across all tenants."
        action={
          <Button onClick={() => setModal({ create: true })}>
            <Plus size={16} /> Register Device
          </Button>
        } 
      />

      {devicesQuery.isLoading || schoolsQuery.isLoading ? (
        <SkeletonPage />
      ) : devicesQuery.isError || schoolsQuery.isError ? (
        <ErrorState retry={() => { devicesQuery.refetch(); schoolsQuery.refetch(); }} />
      ) : (
        <>
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-4">
              <div className="panel px-4 py-3 min-w-[140px]">
                <div className="text-xs font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1">Total Devices</div>
                <div className="display-font text-2xl font-bold">{devices.length}</div>
              </div>
              <div className="panel px-4 py-3 min-w-[140px]">
                <div className="text-xs font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1">Assigned</div>
                <div className="display-font text-2xl font-bold">{devices.filter(d => d.schoolId).length}</div>
              </div>
            </div>
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" size={16} />
              <input 
                type="text" 
                placeholder="Search serial, name or school..." 
                value={search} 
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9"
              />
            </div>
          </div>

          <div className="panel overflow-hidden">
            <div className="hidden grid-cols-[1.5fr_1fr_1.5fr_1fr_auto] gap-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-6 py-4 text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] md:grid">
              <span>Device Profile</span>
              <span>Type</span>
              <span>Tenant Assignment</span>
              <span>Status</span>
              <span />
            </div>
            {filteredDevices.length ? filteredDevices.map((dev) => (
              <div key={dev.id} className="grid gap-3 border-b border-[hsl(var(--border)/.6)] px-5 py-5 transition-colors hover:bg-[hsl(var(--muted)/.2)] last:border-0 md:grid-cols-[1.5fr_1fr_1.5fr_1fr_auto] md:items-center md:gap-4 md:px-6">
                <div>
                  <div className="font-bold text-sm text-[hsl(var(--foreground))]">{dev.name}</div>
                  <div className="flex items-center gap-1.5 mt-1 text-xs text-[hsl(var(--muted-foreground))] font-mono">
                    <Tag size={12} /> {dev.serialNumber}
                  </div>
                </div>
                <div>
                  <span className="bg-[hsl(var(--primary)/.08)] text-[hsl(var(--primary))] dark:bg-[hsl(var(--accent)/.15)] dark:text-[hsl(var(--accent))] text-[10px] font-bold px-2 py-0.5 rounded border border-[hsl(var(--primary)/.2)]">
                    {dev.deviceType}
                  </span>
                </div>
                <div>
                  {dev.schoolId ? (
                    <div className="flex items-center gap-1.5 text-sm font-bold text-[hsl(var(--foreground))]">
                      <Building2 size={14} className="text-[hsl(var(--primary))]" />
                      <span className="truncate max-w-[200px]">{dev.schoolName}</span>
                    </div>
                  ) : (
                    <span className="text-xs font-medium text-[hsl(var(--muted-foreground))] italic">Unassigned hardware</span>
                  )}
                </div>
                <div>
                  <StatusPill value={dev.status} />
                  {dev.lastSeenAt && (
                    <div className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">Seen: {date(dev.lastSeenAt)}</div>
                  )}
                </div>
                <div>
                  <Button variant="outline" onClick={() => setModal({ edit: dev })}>
                    Configure
                  </Button>
                </div>
              </div>
            )) : (
              <EmptyState icon={Smartphone} title="No devices found" description="Register a new device to start tracking hardware inventory." />
            )}
          </div>

          {modal?.create && (
            <Modal title="Register New Device" eyebrow="Hardware Provisioning" onClose={() => setModal(null)}>
              <DeviceForm schools={schools} onDone={done} onCancel={() => setModal(null)} />
            </Modal>
          )}

          {modal?.edit && (
            <Modal title="Configure Device" eyebrow={modal.edit.serialNumber} onClose={() => setModal(null)}>
              <DeviceUpdateForm device={modal.edit} schools={schools} onDone={done} onCancel={() => setModal(null)} />
            </Modal>
          )}
        </>
      )}
    </div>
  );
}

function DeviceForm({ schools, onDone, onCancel }: { schools: any[]; onDone: () => void; onCancel: () => void }) {
  const createDevice = useCreatePlatformDevice();
  const [form, setForm] = useState({
    serialNumber: '',
    name: '',
    deviceType: PlatformDeviceDeviceType.NFC as any,
    schoolId: ''
  });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    await createDevice.mutateAsync({
      data: {
        serialNumber: form.serialNumber,
        name: form.name,
        deviceType: form.deviceType,
        schoolId: form.schoolId ? Number(form.schoolId) : undefined
      }
    });
    onDone();
  };

  const isPending = createDevice.isPending;

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Serial Number">
          <input required type="text" value={form.serialNumber} onChange={e => setForm({...form, serialNumber: e.target.value})} placeholder="HW-12345..." className="font-mono text-sm" />
        </Field>
        <Field label="Device Name">
          <input required type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Main Gate Scanner" />
        </Field>
      </div>

      <Field label="Hardware Type">
        <select required value={form.deviceType} onChange={e => setForm({...form, deviceType: e.target.value})}>
          {Object.values(PlatformDeviceDeviceType).map(type => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
      </Field>

      <div className="p-4 rounded-xl border border-[hsl(var(--primary)/.2)] bg-[hsl(var(--primary)/.04)]">
        <div className="flex items-center gap-2 mb-3 text-sm font-bold text-[hsl(var(--foreground))]">
          <LinkIcon size={16} className="text-[hsl(var(--primary))]" /> Initial Assignment
        </div>
        <Field label="Target Tenant (Optional)">
          <select value={form.schoolId} onChange={e => setForm({...form, schoolId: e.target.value})}>
            <option value="">Unassigned (Inventory Pool)</option>
            {schools.map(s => (
              <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex justify-end gap-3 pt-5 border-t border-[hsl(var(--border))]">
        <Button variant="outline" onClick={onCancel} type="button">Cancel</Button>
        <Button type="submit" disabled={isPending}>{isPending ? 'Registering…' : 'Register Device'}</Button>
      </div>
      {createDevice.isError && <p className="text-sm font-medium text-[hsl(var(--destructive))]">Failed to register device. Serial number might be in use.</p>}
    </form>
  );
}

function DeviceUpdateForm({ device, schools, onDone, onCancel }: { device: any; schools: any[]; onDone: () => void; onCancel: () => void }) {
  const updateDevice = useUpdatePlatformDevice();
  const [form, setForm] = useState({
    schoolId: device.schoolId?.toString() || '',
    status: device.status
  });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateDevice.mutateAsync({
      deviceId: device.id,
      data: {
        schoolId: form.schoolId ? Number(form.schoolId) : null,
        status: form.status as any
      }
    });
    onDone();
  };

  const isPending = updateDevice.isPending;

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="mb-4 grid grid-cols-2 gap-4">
        <div className="p-3 rounded-lg bg-[hsl(var(--muted))] text-sm">
          <span className="block text-[10px] uppercase font-bold text-[hsl(var(--muted-foreground))]">Name</span>
          <span className="font-bold">{device.name}</span>
        </div>
        <div className="p-3 rounded-lg bg-[hsl(var(--muted))] text-sm">
          <span className="block text-[10px] uppercase font-bold text-[hsl(var(--muted-foreground))]">Type</span>
          <span className="font-bold">{device.deviceType}</span>
        </div>
      </div>

      <Field label="Operational Status">
        <select required value={form.status} onChange={e => setForm({...form, status: e.target.value})}>
          {Object.values(PlatformDeviceStatus).map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </Field>

      <Field label="Tenant Assignment">
        <select value={form.schoolId} onChange={e => setForm({...form, schoolId: e.target.value})}>
          <option value="">Unassigned (Return to Inventory)</option>
          {schools.map((s: any) => (
            <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
          ))}
        </select>
      </Field>

      <div className="flex justify-end gap-3 pt-5 border-t border-[hsl(var(--border))]">
        <Button variant="outline" onClick={onCancel} type="button">Cancel</Button>
        <Button type="submit" disabled={isPending}>{isPending ? 'Applying…' : 'Save Configuration'}</Button>
      </div>
      {updateDevice.isError && <p className="text-sm font-medium text-[hsl(var(--destructive))]">Failed to update device configuration.</p>}
    </form>
  );
}
