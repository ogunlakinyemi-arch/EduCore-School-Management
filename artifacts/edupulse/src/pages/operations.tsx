import { useState } from 'react';
import { Boxes, Building2, ClipboardList, Wrench, Plus, Pencil, BarChart3, Settings2, Tag, Package, History } from 'lucide-react';
import { useGetAuthorizedContext } from '@workspace/api-client-react';
import { AddButton, RecordDialog, StatusLine, WorkspaceList, WorkspaceTabs, phase9Label, type FormField } from '@/components/phase9-workspace';
import { usePhase9List, usePhase9Save, toPayload, type Phase9Record } from '@/hooks/use-phase9-api';
import { operationRecordPayload, staffNextStatuses, adminNextStatuses } from './operations-contract';
import { Button, EmptyState, ErrorState, Metric, Modal, PageHeading, SkeletonPage, TenantPicker, date, time, useTenant } from '@/components/shared';

type Area = 'assets' | 'maintenance' | 'facilities' | 'tasks' | 'categories' | 'reports' | 'settings';
type Row = Phase9Record & { name?: string; title?: string; status?: string; priority?: string; location?: string; condition?: string; quantity?: number; assetCode?: string; facilityType?: string; dueOn?: string; description?: string; categoryType?: string; isActive?: boolean; assignedToUserId?: number | null; reportedByUserId?: number };
const priority = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const conditions = ['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED'];
const statuses = {
  assets: ['AVAILABLE', 'ACTIVE', 'ASSIGNED', 'MAINTENANCE', 'DAMAGED', 'LOST', 'RETIRED'],
  maintenance: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'],
  facilities: ['ACTIVE', 'INACTIVE', 'MAINTENANCE', 'RETIRED'],
  tasks: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'],
};
const choices = (options: string[]) => options.map(value => ({ value, label: phase9Label(value) }));
const select = (key: string, label: string, options: string[]): FormField => ({ key, label, type: 'select', options: choices(options) });
const fieldSets: Record<'assets' | 'maintenance' | 'facilities' | 'tasks' | 'categories', FormField[]> = {
  assets: [
    { key: 'name', label: 'Asset name', required: true }, { key: 'assetCode', label: 'Asset code' }, { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'quantity', label: 'Quantity', type: 'number', min: 0 }, { key: 'unit', label: 'Unit' }, { key: 'location', label: 'Location' },
    select('condition', 'Condition', conditions), select('status', 'Status', statuses.assets),
    { key: 'assignedToUserId', label: 'Assigned user ID', type: 'number', min: 1 },
    { key: 'acquiredOn', label: 'Acquired on', type: 'date' }, { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  maintenance: [
    { key: 'title', label: 'Request title', required: true }, { key: 'description', label: 'What needs attention?', type: 'textarea', required: true },
    { key: 'location', label: 'Location' }, { key: 'assetId', label: 'Related asset ID', type: 'number', min: 1 },
    select('priority', 'Priority', priority), select('status', 'Status', statuses.maintenance),
    { key: 'assignedToUserId', label: 'Assigned user ID', type: 'number', min: 1 }, { key: 'dueOn', label: 'Due on', type: 'date' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  facilities: [
    { key: 'name', label: 'Facility name', required: true }, { key: 'facilityType', label: 'Facility type', required: true },
    { key: 'location', label: 'Location' }, { key: 'capacity', label: 'Capacity', type: 'number', min: 0 },
    select('condition', 'Condition', conditions), select('status', 'Status', statuses.facilities), { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  tasks: [
    { key: 'title', label: 'Task title', required: true }, { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'assignedToUserId', label: 'Assigned user ID', type: 'number', min: 1 }, select('priority', 'Priority', priority),
    select('status', 'Status', statuses.tasks), { key: 'dueOn', label: 'Due on', type: 'date' }, { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  categories: [
    select('categoryType', 'Category area', ['ASSET', 'MAINTENANCE', 'TASK']), { key: 'name', label: 'Category name', required: true },
    { key: 'description', label: 'Description', type: 'textarea' }, { key: 'isActive', label: 'Active', type: 'checkbox' },
  ],
};
const endpoint: Record<keyof typeof fieldSets, string> = {
  assets: 'operations/assets', maintenance: 'operations/maintenance-requests', facilities: 'operations/facilities',
  tasks: 'operations/tasks', categories: 'operations/categories',
};

export function OperationsPage() {
  const { schoolId } = useTenant();
  const context = useGetAuthorizedContext().data;
  const roles = context?.roles?.filter(role => role.schoolId === schoolId && role.status === 'ACTIVE').map(role => role.role) ?? [];
  const admin = !context?.isPlatformOwner && roles.includes('SCHOOL_ADMIN');
  const staff = !context?.isPlatformOwner && roles.includes('STAFF');
  const [area, setArea] = useState<Area>('assets');
  if (!schoolId) return <><PageHeading eyebrow="School / Stewardship" title="Operations." description="The working record of places, equipment and the people keeping them ready." action={<TenantPicker />} /><EmptyState icon={Building2} title="Choose a school" description="Select an authorized school to see its operations." /></>;
  if (!admin && !staff) return <div className="panel p-8" role="alert">Operations access is not available for your role at this school.</div>;
  const tabs: { id: Area; label: string }[] = admin ? [
    { id: 'assets', label: 'Assets & inventory' }, { id: 'maintenance', label: 'Maintenance' }, { id: 'facilities', label: 'Facilities' },
    { id: 'tasks', label: 'Tasks' }, { id: 'categories', label: 'Categories' }, { id: 'reports', label: 'Reports' }, { id: 'settings', label: 'Settings' },
  ] : [{ id: 'maintenance', label: 'My maintenance requests' }, { id: 'tasks', label: 'Assigned tasks' }];
  const activeArea = admin ? area : area === 'tasks' ? 'tasks' : 'maintenance';
  return <div className="fade-up">
    <PageHeading eyebrow="School / Stewardship" title="Operations." description="Keep a clear record of what the school owns, what needs fixing, and what comes next." action={<TenantPicker />} />
    <div className="mb-6 grid gap-4 lg:grid-cols-[1.4fr_.6fr]">
      <div className="relative overflow-hidden rounded-2xl bg-[hsl(var(--sidebar))] p-7 text-[hsl(var(--sidebar-foreground))]">
        <div className="eyebrow text-[hsl(var(--accent))]">The working campus</div><h2 className="display-font mt-3 max-w-lg text-3xl font-bold">Nothing important should slip between shifts.</h2>
        <p className="mt-3 max-w-xl text-sm leading-6 opacity-70">From a projector in a classroom to a repair request awaiting attention, this is your school's shared operational ledger.</p>
        <Wrench size={112} strokeWidth={.7} className="absolute -bottom-7 right-3 rotate-[-18deg] opacity-10" />
      </div>
      <div className="panel flex flex-col justify-center p-6"><div className="eyebrow">Access level</div><div className="display-font mt-2 text-xl font-bold">{admin ? 'School administration' : 'Staff workspace'}</div><p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{admin ? 'Manage records and assignments for this school.' : 'Follow your reported issues and assigned work. Only assigned work can be progressed.'}</p></div>
    </div>
    <WorkspaceTabs items={tabs} active={activeArea} onChange={id => setArea(id as Area)} />
    {activeArea === 'reports' && admin ? <OperationsReports schoolId={schoolId} /> : activeArea === 'settings' && admin ? <OperationsSettings schoolId={schoolId} /> :
      <OperationsRecords key={`${schoolId}-${activeArea}`} schoolId={schoolId} area={activeArea as keyof typeof fieldSets} admin={admin} currentUserId={context?.user?.id ?? 0} />}
  </div>;
}

function OperationsRecords({ schoolId, area, admin, currentUserId }: { schoolId: number; area: keyof typeof fieldSets; admin: boolean; currentUserId: number }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [historyAsset, setHistoryAsset] = useState<Row | null>(null);
  const [failure, setFailure] = useState('');
  const path = endpoint[area];
  const categories = usePhase9List<(Phase9Record & { name: string; categoryType: string; isActive: boolean })[]>('operations/categories', schoolId, {}, admin && area !== 'categories');
  const query = usePhase9List<Row[]>(path, schoolId, area === 'assets' ? { ...(status ? { status } : {}), ...(search ? { search } : {}) } : area === 'maintenance' && status ? { status } : {});
  const save = usePhase9Save(path, schoolId);
  const rows = query.data?.filter(row => area === 'assets' || (!status || row.status === status) && (!search || `${row.name ?? row.title ?? ''} ${row.location ?? ''}`.toLowerCase().includes(search.toLowerCase())));
  const fields = fieldSets[area].filter(field => (editing !== 'new' || !['status', 'isActive'].includes(field.key)) && (admin || !['status', 'assignedToUserId'].includes(field.key)) && !(area === 'categories' && editing !== 'new' && field.key === 'categoryType'));
  if (admin && area !== 'categories' && area !== 'facilities') fields.splice(1, 0, { key: 'categoryId', label: 'Category', type: 'select', options: (categories.data ?? []).filter(item => item.isActive && item.categoryType === (area === 'assets' ? 'ASSET' : area === 'maintenance' ? 'MAINTENANCE' : 'TASK')).map(item => ({ value: String(item.id), label: item.name })) });
  if (editing && editing !== 'new' && (area === 'maintenance' || area === 'tasks') && editing.status) {
    const statusField = fields.find(field => field.key === 'status');
    if (statusField) statusField.options = [editing.status, ...(adminNextStatuses[editing.status] ?? [])].map(value => ({ value, label: phase9Label(value) }));
  }
  const submit = async (values: Record<string, string | number | boolean | null>) => {
    const payload = operationRecordPayload(area, editing === 'new', values);
    try {
      await save.mutateAsync({ id: editing !== 'new' ? editing?.id : undefined, data: payload });
      setEditing(null); setFailure('');
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : 'Record could not be saved.'); }
  };
  const advanceStatus = async (row: Row, nextStatus: string) => {
    if (nextStatus === 'COMPLETED' && !window.confirm(`Mark "${row.title}" completed?`)) return;
    try {
      await save.mutateAsync({ id: row.id, data: { status: nextStatus } });
      setFailure('');
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : 'Status could not be updated.'); }
  };
  const canCreate = admin || area === 'maintenance';
  const title = area === 'maintenance' ? 'Maintenance requests' : area === 'assets' ? 'Assets & inventory' : phase9Label(area);
  return <>
    {failure && !editing && <div role="alert" className="mb-4 rounded-xl border border-[hsl(var(--destructive)/.2)] bg-[hsl(var(--destructive)/.08)] px-4 py-3 text-sm text-[hsl(var(--destructive))]">{failure}</div>}
    <WorkspaceList index={`operations-${area}`} title={title} empty={area === 'maintenance' ? 'Report a facility or equipment issue to begin tracking it.' : 'Add the first record to establish your school ledger.'}
      rows={rows} loading={query.isLoading} error={query.isError} retry={() => void query.refetch()}
      filter={area === 'assets' || area === 'categories' || area === 'facilities' || area === 'tasks' ? search : undefined}
      onFilter={area === 'assets' || area === 'categories' || area === 'facilities' || area === 'tasks' ? setSearch : undefined}
      status={area !== 'categories' ? status : undefined} onStatus={area !== 'categories' ? setStatus : undefined} statuses={area !== 'categories' ? statuses[area] : []}
      action={canCreate && <AddButton label={area === 'maintenance' ? 'Report an issue' : `Add ${area === 'categories' ? 'category' : area === 'assets' ? 'asset' : area === 'facilities' ? 'facility' : 'task'}`} onClick={() => { setEditing('new'); setFailure(''); }} />}
      render={row => <div className="flex flex-wrap items-center gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[hsl(var(--primary)/.08)] text-[hsl(var(--primary))]">{area === 'assets' ? <Package size={19} /> : area === 'maintenance' ? <Wrench size={19} /> : area === 'facilities' ? <Building2 size={19} /> : area === 'categories' ? <Tag size={19} /> : <ClipboardList size={19} />}</span>
        <div className="min-w-[160px] flex-1"><div className="font-bold">{row.name ?? row.title}</div><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{[row.assetCode, row.facilityType, row.categoryType, row.location, row.quantity !== undefined ? `${row.quantity} units` : null, row.dueOn ? `Due ${date(row.dueOn)}` : null].filter(Boolean).join(' · ') || row.description || `Record #${row.id}`}</div></div>
        <div className="flex items-center gap-3">{row.status ? <StatusLine value={row.status} detail={row.priority ? phase9Label(row.priority) : row.condition ? phase9Label(row.condition) : undefined} /> : <StatusLine value={row.isActive ? 'ACTIVE' : 'INACTIVE'} />}
          {!admin && currentUserId > 0 && row.assignedToUserId === currentUserId && (area === 'maintenance' || area === 'tasks') && (staffNextStatuses[row.status ?? ''] ?? []).map(nextStatus => <Button key={nextStatus} variant={nextStatus === 'COMPLETED' ? 'primary' : 'outline'} disabled={save.isPending} onClick={() => void advanceStatus(row, nextStatus)} testId={`button-${area}-${nextStatus.toLowerCase()}-${row.id}`}>{nextStatus === 'COMPLETED' ? 'Complete' : phase9Label(nextStatus)}</Button>)}
          {admin && area === 'assets' && <Button variant="quiet" onClick={() => setHistoryAsset(row)} testId={`button-asset-history-${row.id}`}><History size={14} />History</Button>}
          {admin && <Button variant="quiet" onClick={() => { setEditing(row); setFailure(''); }} testId={`button-edit-${area}-${row.id}`}><Pencil size={14} />Edit</Button>}</div>
      </div>}
    />
    {historyAsset && <AssetHistory key={historyAsset.id} asset={historyAsset} schoolId={schoolId} onClose={() => setHistoryAsset(null)} />}
    {editing && <RecordDialog key={`${area}-${editing === 'new' ? 'new' : editing.id}`} title={`${editing === 'new' ? 'Add' : 'Edit'} ${area === 'maintenance' ? 'maintenance request' : area === 'categories' ? 'category' : area === 'facilities' ? 'facility' : area === 'assets' ? 'asset' : 'task'}`} fields={fields} values={editing === 'new' ? {} : editing as unknown as Record<string, string | number | boolean | null>} onClose={() => setEditing(null)} onSave={submit} pending={save.isPending} error={failure} />}
  </>;
}

type AssetEvent = {
  id: number; eventType: string; eventAt: string; actorUserId: number;
  quantityBefore: number | null; quantityAfter: number | null;
  assignedToBeforeUserId: number | null; assignedToAfterUserId: number | null;
  statusBefore: string | null; statusAfter: string | null;
};
function AssetHistory({ asset, schoolId, onClose }: { asset: Row; schoolId: number; onClose: () => void }) {
  const query = usePhase9List<AssetEvent[]>(`operations/assets/${asset.id}/history`, schoolId);
  return <Modal title={asset.name ?? 'Asset history'} eyebrow="Inventory / Audit trail" onClose={onClose}>
    <p className="mb-5 text-sm text-[hsl(var(--muted-foreground))]">Recorded changes to quantity, assignment and status for this school asset.</p>
    {query.isLoading ? <SkeletonPage /> : query.isError ? <ErrorState retry={() => void query.refetch()} /> : !query.data?.length ? <EmptyState icon={History} title="No activity yet" description="The asset history will appear here once recorded." /> :
      <ol className="max-h-[55dvh] space-y-0 overflow-y-auto border-l border-[hsl(var(--border))] pl-5">{query.data.map(event => <li key={event.id} data-testid={`row-asset-history-${event.id}`} className="relative border-b border-[hsl(var(--border)/.7)] py-4 last:border-0 before:absolute before:-left-[25px] before:top-6 before:h-2 before:w-2 before:rounded-full before:bg-[hsl(var(--primary))]"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{phase9Label(event.eventType)}</strong><span className="text-xs text-[hsl(var(--muted-foreground))]">{date(event.eventAt)} · {time(event.eventAt)}</span></div><div className="mt-2 space-y-1 text-xs text-[hsl(var(--muted-foreground))]">{event.quantityBefore !== event.quantityAfter && event.quantityAfter !== null && <div>Quantity: {event.quantityBefore ?? '—'} → {event.quantityAfter}</div>}{event.assignedToBeforeUserId !== event.assignedToAfterUserId && <div>Assigned user: {event.assignedToBeforeUserId ?? 'Unassigned'} → {event.assignedToAfterUserId ?? 'Unassigned'}</div>}{event.statusBefore !== event.statusAfter && event.statusAfter && <div>Status: {event.statusBefore ? phase9Label(event.statusBefore) : '—'} → {phase9Label(event.statusAfter)}</div>}</div><div className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">Changed by user #{event.actorUserId}</div></li>)}</ol>}
  </Modal>;
}

type Report = { activeAssets: number; inventoryQuantity: number; facilities: number; openMaintenanceRequests: number; overdueMaintenanceRequests: number; openTasks: number; overdueTasks: number; damagedAssets: number; lostAssets: number };
function OperationsReports({ schoolId }: { schoolId: number }) {
  const query = usePhase9List<Report>('operations/reports', schoolId);
  if (query.isLoading) return <SkeletonPage />;
  if (query.isError || !query.data) return <ErrorState retry={() => void query.refetch()} />;
  const report = query.data;
  return <section><div className="eyebrow mb-3">Live school snapshot</div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    <Metric label="Active assets" value={report.activeAssets} icon={Boxes} detail={`${report.inventoryQuantity} units in inventory`} accent />
    <Metric label="Facilities" value={report.facilities} icon={Building2} />
    <Metric label="Open repairs" value={report.openMaintenanceRequests} icon={Wrench} detail={`${report.overdueMaintenanceRequests} overdue`} />
    <Metric label="Open tasks" value={report.openTasks} icon={ClipboardList} detail={`${report.overdueTasks} overdue`} />
  </div><div className="panel mt-5 grid gap-5 p-6 sm:grid-cols-2"><div><BarChart3 size={20} className="text-[hsl(var(--primary))]" /><h3 className="display-font mt-3 text-xl font-bold">Condition watch</h3><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Review assets needing replacement or investigation.</p></div><div className="grid grid-cols-2 gap-4"><div className="rounded-xl bg-[hsl(var(--destructive)/.08)] p-4"><div className="eyebrow">Damaged</div><strong className="display-font mt-2 block text-3xl">{report.damagedAssets}</strong></div><div className="rounded-xl bg-[hsl(var(--secondary))] p-4"><div className="eyebrow">Lost</div><strong className="display-font mt-2 block text-3xl">{report.lostAssets}</strong></div></div></div></section>;
}

type Settings = { defaultMaintenancePriority: string; defaultTaskPriority: string; staffCanReportMaintenance: boolean };
function OperationsSettings({ schoolId }: { schoolId: number }) {
  const query = usePhase9List<Settings>('operations/settings', schoolId);
  const save = usePhase9Save('operations/settings', schoolId);
  const [editing, setEditing] = useState(false);
  const [failure, setFailure] = useState('');
  if (query.isLoading) return <SkeletonPage />;
  if (query.isError || !query.data) return <ErrorState retry={() => void query.refetch()} />;
  const settings = query.data;
  return <section className="panel max-w-3xl p-6 md:p-8"><Settings2 size={22} className="text-[hsl(var(--primary))]" /><div className="eyebrow mt-5">School-specific rules</div><h2 className="display-font mt-2 text-2xl font-bold">Operations settings</h2><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">These defaults apply only to this school.</p><div className="mt-6 grid gap-4 sm:grid-cols-3"><div><div className="eyebrow">Maintenance priority</div><strong>{phase9Label(settings.defaultMaintenancePriority)}</strong></div><div><div className="eyebrow">Task priority</div><strong>{phase9Label(settings.defaultTaskPriority)}</strong></div><div><div className="eyebrow">Staff reporting</div><strong>{settings.staffCanReportMaintenance ? 'Enabled' : 'Disabled'}</strong></div></div><Button className="mt-7" onClick={() => setEditing(true)}><Plus size={15} />Adjust settings</Button>
    {editing && <RecordDialog title="Operations settings" fields={[select('defaultMaintenancePriority', 'Default maintenance priority', priority), select('defaultTaskPriority', 'Default task priority', priority), { key: 'staffCanReportMaintenance', label: 'Staff can report maintenance', type: 'checkbox' }]} values={settings} onClose={() => setEditing(false)} pending={save.isPending} error={failure} onSave={async values => { try { await save.mutateAsync({ method: 'PUT', data: toPayload(values) }); setEditing(false); setFailure(''); } catch (cause) { setFailure(cause instanceof Error ? cause.message : 'Could not save settings.'); } }} />}
  </section>;
}