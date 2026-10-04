import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bus, CircleDollarSign, GaugeCircle, History, Inbox, MapPinned, Pencil, Plus, Route as RouteIcon, ShieldAlert, UserRoundCog, UsersRound } from 'lucide-react';
import {
  useGetAuthorizedContext, useListTransportBuses, useCreateTransportBus, useUpdateTransportBus, useSearchTransportDrivers,
  useListTransportRoutes, useCreateTransportRoute, useUpdateTransportRoute, useAddTransportStop, useUpdateTransportStop,
  useSearchTransportStudents, useListTransportAssignments, useCreateTransportAssignment, useUpdateTransportAssignment,
  useGetTransportAssignmentHistory, useListTransportRequests, useReviewTransportRequest, useGetPlatformTransportOverview,
  type TransportBus, type TransportRoute, type TransportStop, type TransportAssignment, type TransportRequest,
  type TransportAssignmentUpdate, type TransportRouteInput, type TransportStopInput,
} from '@workspace/api-client-react';
import { Button, EmptyState, ErrorState, Field, Metric, Modal, PageHeading, StatusPill, cx, date, useTenant } from '@/components/shared';
import { HistoryList, InvoiceList, ListSkeleton, Notice, RequestRow, Tabs, AssignmentSummary, inputCls } from '@/components/transport-parts';
import { FeePlanModal, PolicyPanel, RouteStaffModal } from '@/components/transport-extras';
import {
  TRANSPORT_POLL_MS, TRANSPORT_STALE_MS, activeDrivers, busChoice, routeBlock, routesForBus, type PickerRoute, assignmentTone, capacityState, errorMessage, formatNaira,
  ownerTotals, stopsFor, transportAudience, validateEffective,
} from '@/components/transport-logic';

const fresh = { staleTime: TRANSPORT_STALE_MS, refetchInterval: TRANSPORT_POLL_MS, refetchOnWindowFocus: true, refetchOnMount: 'always' } as const;
const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;
const today = () => new Date().toISOString().slice(0, 10);

function useInvalidateTransport() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ predicate: q => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).includes('transport') });
}

function useDebounced(value: string, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export default function TransportPage() {
  const { schoolId } = useTenant();
  const ctx = useGetAuthorizedContext();
  if (ctx.isLoading) return <ListSkeleton rows={4} />;
  if (ctx.isError) return <ErrorState retry={() => ctx.refetch()} message="We could not confirm your access to transport." />;
  const audience = transportAudience(ctx.data, schoolId);
  if (audience === 'owner') return <OwnerOverview />;
  if (audience === 'admin') return <AdminTransport schoolId={schoolId} />;
  return (
    <div data-testid="transport-denied"><PageHeading eyebrow="Transport" title="Transport" />
      <div className="panel"><EmptyState icon={ShieldAlert} title="School Admin access required" description="Transport is managed by the School Admin of the selected school. Parents and students can open My transport instead." /></div>
    </div>
  );
}

/* ------------------------------- Owner ------------------------------- */

function OwnerOverview() {
  const { schoolId } = useTenant();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState<'all' | 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE'>('all');
  const params = { ...(schoolId ? { schoolId } : {}), ...(from ? { fromDate: from } : {}), ...(to ? { toDate: to } : {}), ...(status !== 'all' ? { status } : {}), limit: 100 };
  const q = useGetPlatformTransportOverview(params, { query: { ...fresh, queryKey: ['/api/transport/platform-owner/overview', params] } });
  const num = (o: Record<string, unknown> | undefined, k: string) => Number(o?.[k] ?? 0);
  const ops = q.data?.operationalSummary as Record<string, unknown> | undefined;
  const fin = q.data?.financeSummary as Record<string, unknown> | undefined;
  const invoices = q.data?.invoices ?? [];
  const empty = q.data && !num(ops, 'busCount') && !num(fin, 'invoiceCount');
  return (
    <div data-testid="transport-owner-overview">
      <PageHeading eyebrow="Platform overview" title="Transport" description="A read-only view across schools. Operational changes are made by each school's administrator." />
      <div className="panel mb-6 flex flex-wrap items-end gap-4 p-4">
        <Field label="From"><input type="date" className={inputCls} value={from} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" className={inputCls} value={to} onChange={e => setTo(e.target.value)} /></Field>
        <Field label="Invoice status"><select className={inputCls} value={status} onChange={e => setStatus(e.target.value as typeof status)} data-testid="select-owner-status"><option value="all">All</option><option value="UNPAID">Unpaid</option><option value="PARTIALLY_PAID">Partly paid</option><option value="PAID">Paid</option><option value="OVERDUE">Overdue</option></select></Field>
        <p className="pb-2 text-xs text-[hsl(var(--muted-foreground))]">{schoolId ? 'Filtered to the school chosen in the header.' : 'Showing every school. Use the header school picker to focus on one.'}</p>
        {(from || to) && <Button variant="quiet" onClick={() => { setFrom(''); setTo(''); }}>Clear dates</Button>}
      </div>
      {q.isLoading ? <ListSkeleton rows={4} /> : q.isError ? <ErrorState retry={() => q.refetch()} message={errorMessage(q.error)} /> : empty ? (
        <div className="panel"><EmptyState icon={Bus} title="No transport data yet" description="No school in this filter has set up buses or routes." /></div>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Invoiced" value={formatNaira(num(fin, 'invoicedMinor'))} detail={`Paid ${formatNaira(num(fin, 'paidMinor'))}`} icon={CircleDollarSign} accent />
            <Metric label="Outstanding" value={formatNaira(num(fin, 'outstandingMinor'))} detail={`${num(fin, 'overdueInvoiceCount')} overdue of ${num(fin, 'invoiceCount')} invoices`} icon={ShieldAlert} />
            <Metric label="Riders" value={num(ops, 'activeAssignmentCount')} detail={`${num(ops, 'suspendedAssignmentCount')} suspended, ${num(ops, 'deactivatedAssignmentCount')} deactivated`} icon={UsersRound} />
            <Metric label="Buses and seats" value={`${num(ops, 'activeBusCount')} / ${num(ops, 'activeSeatCapacity')}`} detail={`${num(ops, 'activeRouteCount')} routes, ${num(ops, 'assignedDriverCount')} drivers, ${num(ops, 'activeCompanionCount')} companions`} icon={GaugeCircle} />
          </div>
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead><tr className="border-b border-[hsl(var(--border))] text-xs uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                {['School', 'Student', 'Route', 'Term', 'Total', 'Outstanding', 'Invoice status', 'Due'].map(h => <th key={h} className="p-4 font-bold">{h}</th>)}
              </tr></thead>
              <tbody>
                {invoices.map(i => (
                  <tr key={i.invoiceId} className="border-b border-[hsl(var(--border)/.6)] last:border-0" data-testid={`owner-transport-invoice-${i.invoiceId}`}>
                    <td className="p-4 font-bold">{i.schoolName}</td><td className="p-4">{i.studentName}</td><td className="p-4">{i.routeName}</td>
                    <td className="p-4">{i.sessionName} - {i.termName}</td><td className="p-4">{formatNaira(i.totalMinor)}</td><td className="p-4">{formatNaira(i.outstandingMinor)}</td>
                    <td className="p-4"><StatusPill value={i.status} /></td><td className="p-4">{date(i.dueDate)}</td>
                  </tr>
                ))}
                {!invoices.length && <tr><td colSpan={8} className="p-6 text-center text-sm text-[hsl(var(--muted-foreground))]">No transport invoices match this filter.</td></tr>}
              </tbody>
            </table>
          </div>
          {(q.data?.invoiceTotalCount ?? 0) > invoices.length && <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">Showing {invoices.length} of {q.data?.invoiceTotalCount}. Narrow the filters to see others.</p>}
        </>
      )}
    </div>
  );
}

/* -------------------------------- Admin ------------------------------- */

type Tab = 'assignments' | 'requests' | 'buses' | 'routes' | 'policy';
const TransportTabs = Tabs<Tab>;

function AdminTransport({ schoolId }: { schoolId: number }) {
  const [tab, setTab] = useState<Tab>('assignments');
  const buses = useListTransportBuses({ schoolId }, { query: { ...fresh, queryKey: ['/api/transport/buses', { schoolId }] } });
  const routes = useListTransportRoutes({ schoolId }, { query: { ...fresh, queryKey: ['/api/transport/routes', { schoolId }] } });
  const assignments = useListTransportAssignments({ schoolId, status: 'all' }, { query: { ...fresh, queryKey: ['/api/transport/assignments', { schoolId, status: 'all' }] } });
  const requests = useListTransportRequests({ schoolId, status: 'all' }, { query: { ...fresh, queryKey: ['/api/transport/requests', { schoolId, status: 'all' }] } });
  const pending = (requests.data ?? []).filter(r => r.status === 'PENDING').length;
  return (
    <div data-testid="transport-admin">
      <PageHeading eyebrow="School operations" title="Transport" description="Buses, routes and who rides where. Fees stay in School Fees; nothing here creates a second billing system." />
      <TransportTabs value={tab} onChange={setTab} items={[
        { id: 'assignments', label: 'Riders', count: assignments.data?.length }, { id: 'requests', label: 'Parent requests', count: pending },
        { id: 'buses', label: 'Buses', count: buses.data?.length }, { id: 'routes', label: 'Routes', count: routes.data?.length },
        { id: 'policy', label: 'Payment policy' },
      ]} />
      {tab === 'assignments' && <AssignmentsTab schoolId={schoolId} q={assignments} routes={routes.data ?? []} />}
      {tab === 'requests' && <RequestsTab schoolId={schoolId} q={requests} />}
      {tab === 'buses' && <BusesTab schoolId={schoolId} q={buses} />}
      {tab === 'policy' && <PolicyPanel schoolId={schoolId} />}
      {tab === 'routes' && <RoutesTab schoolId={schoolId} q={routes} buses={buses.data ?? []} />}
    </div>
  );
}

type Q<T> = { data?: T; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown };

function Frame<T extends unknown[]>({ q, empty, children }: { q: Q<T>; empty: React.ReactNode; children: (items: T) => React.ReactNode }) {
  if (q.isLoading) return <ListSkeleton />;
  if (q.isError) return <ErrorState retry={() => q.refetch()} message={errorMessage(q.error)} />;
  if (!q.data?.length) return <div className="panel">{empty}</div>;
  return <>{children(q.data)}</>;
}

/* Buses */
function BusesTab({ schoolId, q }: { schoolId: number; q: Q<TransportBus[]> }) {
  const [editing, setEditing] = useState<TransportBus | 'new' | null>(null);
  return (
    <div>
      <div className="mb-4 flex justify-end"><Button onClick={() => setEditing('new')} testId="button-add-bus"><Plus size={16} />Add bus</Button></div>
      <Frame q={q} empty={<EmptyState icon={Bus} title="No buses yet" description="Add the first bus with its registration number and seat capacity." />}>
        {buses => (
          <div className="grid gap-4 md:grid-cols-2">
            {buses.map(b => {
              const c = capacityState(b);
              return (
                <div key={b.id} className="panel p-5" data-testid={`bus-card-${b.id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div><div className="display-font text-lg font-bold">{b.name}</div><div className="text-xs text-[hsl(var(--muted-foreground))]">{b.registrationNumber}{b.make ? ` - ${b.make}` : ''}</div></div>
                    <StatusPill value={b.status ?? 'ACTIVE'} />
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div className={cx('h-full rounded-full', c.full ? 'bg-[hsl(var(--destructive))]' : 'bg-[hsl(var(--primary))]')} style={{ width: `${c.pct}%` }} /></div>
                  <div className="mt-2 flex justify-between text-xs font-medium text-[hsl(var(--muted-foreground))]"><span>{b.passengerCount} of {b.capacity} seats used</span><span>{c.full ? 'Full' : `${c.left} free`} - {b.routeCount} routes</span></div>
                  {b.notes && <p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">{b.notes}</p>}
                  <div className="mt-4"><Button variant="outline" onClick={() => setEditing(b)} testId={`button-edit-bus-${b.id}`}><Pencil size={14} />Edit</Button></div>
                </div>
              );
            })}
          </div>
        )}
      </Frame>
      {editing && <BusForm schoolId={schoolId} bus={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function BusForm({ schoolId, bus, onClose }: { schoolId: number; bus?: TransportBus; onClose: () => void }) {
  const invalidate = useInvalidateTransport();
  const create = useCreateTransportBus();
  const update = useUpdateTransportBus();
  const [f, setF] = useState({ name: bus?.name ?? '', registrationNumber: bus?.registrationNumber ?? '', make: bus?.make ?? '', capacity: String(bus?.capacity ?? ''), status: bus?.status ?? 'ACTIVE', notes: bus?.notes ?? '' });
  const [err, setErr] = useState<string | null>(null);
  const busy = create.isPending || update.isPending;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const capacity = Number(f.capacity);
    if (!f.name.trim() || !f.registrationNumber.trim()) return setErr('Name and registration number are required.');
    if (!Number.isInteger(capacity) || capacity < 1) return setErr('Capacity must be a whole number of at least 1.');
    if (bus && capacity < bus.passengerCount) return setErr(`${bus.passengerCount} seats are already reserved, so capacity cannot go below that.`);
    setErr(null);
    const done = { onSuccess: () => { invalidate(); onClose(); }, onError: (x: unknown) => setErr(errorMessage(x)) };
    if (bus) update.mutate({ busId: bus.id, params: { schoolId }, data: { name: f.name.trim(), registrationNumber: f.registrationNumber.trim(), make: f.make.trim() || null, capacity, status: f.status as TransportBus['status'], notes: f.notes.trim() || null } }, done);
    else create.mutate({ params: { schoolId }, data: { name: f.name.trim(), registrationNumber: f.registrationNumber.trim(), capacity, status: f.status as TransportBus['status'], ...(f.make.trim() ? { make: f.make.trim() } : {}), ...(f.notes.trim() ? { notes: f.notes.trim() } : {}) } }, done);
  };
  return (
    <Modal title={bus ? 'Edit bus' : 'Add bus'} eyebrow="Fleet" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Bus name"><input className={inputCls} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} data-testid="input-bus-name" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Registration number"><input className={inputCls} value={f.registrationNumber} onChange={e => setF({ ...f, registrationNumber: e.target.value })} data-testid="input-bus-registration" /></Field>
          <Field label="Make (optional)"><input className={inputCls} value={f.make} onChange={e => setF({ ...f, make: e.target.value })} /></Field>
          <Field label="Seat capacity"><input type="number" min={1} className={inputCls} value={f.capacity} onChange={e => setF({ ...f, capacity: e.target.value })} data-testid="input-bus-capacity" /></Field>
          <Field label="Status"><select className={inputCls} value={f.status} onChange={e => setF({ ...f, status: e.target.value as typeof f.status })}><option value="ACTIVE">Active</option><option value="MAINTENANCE">Maintenance</option><option value="INACTIVE">Inactive</option></select></Field>
        </div>
        <Field label="Notes (optional)"><textarea rows={2} className={inputCls} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
        {err && <Notice tone="error" testId="bus-form-error">{err}</Notice>}
        <div className="flex justify-end gap-2"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy} testId="button-save-bus">{busy ? 'Saving...' : 'Save bus'}</Button></div>
      </form>
    </Modal>
  );
}

/* Routes */
function RoutesTab({ schoolId, q, buses }: { schoolId: number; q: Q<TransportRoute[]>; buses: TransportBus[] }) {
  const [editing, setEditing] = useState<TransportRoute | 'new' | null>(null);
  const [stopsFor_, setStopsFor] = useState<number | null>(null);
  const [staffFor, setStaffFor] = useState<number | null>(null);
  const live = (q.data ?? []).find(r => r.id === stopsFor_);
  const staffRoute = (q.data ?? []).find(r => r.id === staffFor);
  return (
    <div>
      <div className="mb-4 flex justify-end"><Button onClick={() => setEditing('new')} disabled={!buses.length} title={buses.length ? undefined : 'Add a bus first'} testId="button-add-route"><Plus size={16} />Add route</Button></div>
      {!buses.length && <div className="mb-4"><Notice>Routes run on a bus. Add a bus before creating a route.</Notice></div>}
      <Frame q={q} empty={<EmptyState icon={RouteIcon} title="No routes yet" description="Create a route with a driver, a schedule and its stops." />}>
        {routes => (
          <div className="space-y-4">
            {routes.map(r => (
              <div key={r.id} className="panel p-5" data-testid={`route-card-${r.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="display-font text-lg font-bold">{r.name}</div>
                    <div className="text-xs text-[hsl(var(--muted-foreground))]">{r.busName} ({r.registrationNumber}) - Driver {r.driverName}</div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{r.departureTime} to {r.arrivalTime} - {r.weekdays.map(d => d.slice(0, 3)).join(', ')} - Fare {formatNaira(r.fareMinor)}</div>
                  </div>
                  <div className="flex items-center gap-2"><StatusPill value={r.status ?? 'ACTIVE'} />{r.isOverCapacity && <span className="rounded-full bg-[hsl(var(--destructive)/.12)] px-2.5 py-1 text-[11px] font-bold uppercase text-[hsl(var(--destructive))]">Over capacity</span>}</div>
                </div>
                <div className="mt-3 text-xs font-medium text-[hsl(var(--muted-foreground))]">{r.reservedPassengerCount} of {r.busCapacity} seats reserved - {r.stops.length} stops</div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setEditing(r)} testId={`button-edit-route-${r.id}`}><Pencil size={14} />Edit route</Button>
                  <Button variant="outline" onClick={() => setStopsFor(r.id)} testId={`button-stops-route-${r.id}`}><MapPinned size={14} />Manage stops</Button>
                  <Button variant="outline" onClick={() => setStaffFor(r.id)} testId={`button-staff-route-${r.id}`}><UserRoundCog size={14} />Companions</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Frame>
      {editing && <RouteForm schoolId={schoolId} route={editing === 'new' ? undefined : editing} buses={buses} onClose={() => setEditing(null)} />}
      {staffRoute && <RouteStaffModal schoolId={schoolId} route={staffRoute} onClose={() => setStaffFor(null)} />}
      {live && <StopsModal schoolId={schoolId} route={live} onClose={() => setStopsFor(null)} />}
    </div>
  );
}

function RouteForm({ schoolId, route, buses, onClose }: { schoolId: number; route?: TransportRoute; buses: TransportBus[]; onClose: () => void }) {
  const invalidate = useInvalidateTransport();
  const create = useCreateTransportRoute();
  const update = useUpdateTransportRoute();
  const [search, setSearch] = useState('');
  const dq = useDebounced(search);
  const drivers = useSearchTransportDrivers({ schoolId, ...(dq ? { search: dq } : {}) }, { query: { queryKey: ['/api/transport/drivers', { schoolId, search: dq }], staleTime: TRANSPORT_STALE_MS } });
  const [f, setF] = useState({ name: route?.name ?? '', busId: String(route?.busId ?? buses[0]?.id ?? ''), driver: route ? String(route.driverEmployeeId) : '', weekdays: route?.weekdays ?? ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'], dep: route?.departureTime ?? '06:30', arr: route?.arrivalTime ?? '08:00', fare: route ? String((route.fareMinor ?? 0) / 100) : '', status: route?.status ?? 'ACTIVE' });
  const [pickupName, setPickupName] = useState('');
  const [dropName, setDropName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const list = activeDrivers(drivers.data);
  const hasCurrent = route && list.some(d => d.employeeId === route.driverEmployeeId);
  const busy = create.isPending || update.isPending;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const fare = f.fare === '' ? 0 : Number(f.fare);
    if (!f.name.trim()) return setErr('Route name is required.');
    if (!f.busId) return setErr('Choose a bus.');
    if (!f.driver) return setErr('Choose a driver from the school employees.');
    if (!f.weekdays.length) return setErr('Choose at least one running day.');
    if (!f.dep || !f.arr) return setErr('Set departure and arrival times.');
    if (!(fare >= 0)) return setErr('Fare must be zero or more.');
    if (!route && (pickupName.trim().length < 2 || dropName.trim().length < 2)) return setErr('Name the first pickup stop and the final drop-off stop. You can add more stops afterwards.');
    setErr(null);
    const data = { name: f.name.trim(), busId: Number(f.busId), driverEmployeeId: Number(f.driver), weekdays: f.weekdays, departureTime: f.dep, arrivalTime: f.arr, fareMinor: Math.round(fare * 100), status: f.status };
    const done = { onSuccess: () => { invalidate(); onClose(); }, onError: (x: unknown) => setErr(errorMessage(x)) };
    if (route) update.mutate({ routeId: route.id, params: { schoolId }, data }, done); else create.mutate({ params: { schoolId }, data: { ...data, stops: [{ name: pickupName.trim(), stopType: 'PICKUP', sequence: 1 }, { name: dropName.trim(), stopType: 'DROPOFF', sequence: 2 }] } }, done);
  };
  return (
    <Modal title={route ? 'Edit route' : 'Add route'} eyebrow="Routes" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Route name"><input className={inputCls} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} data-testid="input-route-name" /></Field>
        <Field label="Bus"><select className={inputCls} value={f.busId} onChange={e => setF({ ...f, busId: e.target.value })} data-testid="select-route-bus">{buses.map(b => <option key={b.id} value={b.id}>{b.name} ({b.registrationNumber}) - {b.capacity} seats</option>)}</select></Field>
        <Field label="Find a driver"><input className={inputCls} placeholder="Search drivers by name or employee number" value={search} onChange={e => setSearch(e.target.value)} /></Field>
        <Field label="Driver">
          <select className={inputCls} value={f.driver} onChange={e => setF({ ...f, driver: e.target.value })} data-testid="select-route-driver">
            <option value="">{drivers.isLoading ? 'Loading drivers...' : list.length ? 'Select a driver' : 'No drivers found'}</option>
            {route && !hasCurrent && <option value={route.driverEmployeeId}>{route.driverName} (current)</option>}
            {list.map(d => <option key={d.employeeId} value={d.employeeId}>{d.name} ({d.employeeNo})</option>)}
          </select>
        </Field>
        {drivers.isError && <Notice tone="error">{errorMessage(drivers.error)}</Notice>}
        <fieldset><legend className="mb-1.5 text-xs font-bold text-[hsl(var(--muted-foreground))]">Running days</legend>
          <div className="flex flex-wrap gap-2">{DAYS.map(d => { const on = f.weekdays.includes(d); return <button type="button" key={d} aria-pressed={on} onClick={() => setF({ ...f, weekdays: on ? f.weekdays.filter(x => x !== d) : [...f.weekdays, d] })} className={cx('rounded-lg border px-3 py-1.5 text-xs font-bold', on ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]' : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]')}>{d.slice(0, 3)}</button>; })}</div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Departure"><input type="time" className={inputCls} value={f.dep} onChange={e => setF({ ...f, dep: e.target.value })} /></Field>
          <Field label="Arrival"><input type="time" className={inputCls} value={f.arr} onChange={e => setF({ ...f, arr: e.target.value })} /></Field>
          {!route && <><Field label="First pickup stop"><input className={inputCls} value={pickupName} onChange={e => setPickupName(e.target.value)} data-testid="input-first-pickup" /></Field><Field label="Final drop-off stop"><input className={inputCls} value={dropName} onChange={e => setDropName(e.target.value)} data-testid="input-final-dropoff" /></Field></>}
          <Field label="Fare (NGN)"><input type="number" min={0} step="0.01" className={inputCls} value={f.fare} onChange={e => setF({ ...f, fare: e.target.value })} /></Field>
        </div>
        <Field label="Status"><select className={inputCls} value={f.status} onChange={e => setF({ ...f, status: e.target.value as typeof f.status })}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></Field>
        {err && <Notice tone="error" testId="route-form-error">{err}</Notice>}
        <div className="flex justify-end gap-2"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy} testId="button-save-route">{busy ? 'Saving...' : 'Save route'}</Button></div>
      </form>
    </Modal>
  );
}

function StopsModal({ schoolId, route, onClose }: { schoolId: number; route: TransportRoute; onClose: () => void }) {
  const invalidate = useInvalidateTransport();
  const add = useAddTransportStop();
  const upd = useUpdateTransportStop();
  const [editing, setEditing] = useState<TransportStop | null>(null);
  const nextSeq = Math.max(0, ...route.stops.map(s => s.sequence)) + 1;
  const [f, setF] = useState<{ name: string; stopType: TransportStopInput['stopType']; sequence: string; notes: string }>({ name: '', stopType: 'BOTH', sequence: String(nextSeq), notes: '' });
  const [err, setErr] = useState<string | null>(null);
  const reset = () => { setEditing(null); setF({ name: '', stopType: 'BOTH', sequence: String(nextSeq + (editing ? 0 : 1)), notes: '' }); };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const seq = Number(f.sequence);
    if (!f.name.trim()) return setErr('Stop name is required.');
    if (!Number.isInteger(seq) || seq < 1) return setErr('Order must be a whole number from 1.');
    setErr(null);
    const data: TransportStopInput = { name: f.name.trim(), stopType: f.stopType, sequence: seq, isActive: editing?.isActive ?? true, ...(f.notes.trim() ? { notes: f.notes.trim() } : {}) };
    const done = { onSuccess: () => { invalidate(); reset(); }, onError: (x: unknown) => setErr(errorMessage(x)) };
    if (editing) upd.mutate({ routeId: route.id, stopId: editing.id, params: { schoolId }, data }, done); else add.mutate({ routeId: route.id, params: { schoolId }, data }, done);
  };
  const toggle = (s: TransportStop) => upd.mutate({ routeId: route.id, stopId: s.id, params: { schoolId }, data: { name: s.name, stopType: s.stopType, sequence: s.sequence, notes: s.notes, isActive: !s.isActive } }, { onSuccess: () => invalidate(), onError: x => setErr(errorMessage(x)) });
  const stops = [...route.stops].sort((a, b) => a.sequence - b.sequence);
  return (
    <Modal title={`Stops - ${route.name}`} eyebrow="Pickup and drop-off" onClose={onClose}>
      <div className="mb-5 space-y-2" data-testid="stops-list">
        {stops.length ? stops.map(s => (
          <div key={s.id} className={cx('flex items-center gap-3 rounded-xl border border-[hsl(var(--border))] p-3', !s.isActive && 'opacity-60')}>
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-[hsl(var(--muted))] text-xs font-bold">{s.sequence}</span>
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{s.name}</div><div className="text-xs text-[hsl(var(--muted-foreground))]">{s.stopType === 'BOTH' ? 'Pickup and drop-off' : s.stopType === 'PICKUP' ? 'Pickup' : 'Drop-off'}{s.isActive ? '' : ' - inactive'}</div></div>
            <Button variant="quiet" onClick={() => { setEditing(s); setF({ name: s.name, stopType: s.stopType, sequence: String(s.sequence), notes: s.notes ?? '' }); }}><Pencil size={14} /></Button>
            <Button variant="quiet" onClick={() => toggle(s)} disabled={upd.isPending}>{s.isActive ? 'Deactivate' : 'Activate'}</Button>
          </div>
        )) : <p className="text-sm text-[hsl(var(--muted-foreground))]">No stops yet. Add at least one pickup and one drop-off before assigning students.</p>}
      </div>
      <form onSubmit={submit} className="space-y-3 border-t border-[hsl(var(--border))] pt-4">
        <div className="eyebrow">{editing ? 'Edit stop' : 'Add stop'}</div>
        <Field label="Stop name"><input className={inputCls} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} data-testid="input-stop-name" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type"><select className={inputCls} value={f.stopType} onChange={e => setF({ ...f, stopType: e.target.value as typeof f.stopType })}><option value="BOTH">Pickup and drop-off</option><option value="PICKUP">Pickup only</option><option value="DROPOFF">Drop-off only</option></select></Field>
          <Field label="Order on route"><input type="number" min={1} className={inputCls} value={f.sequence} onChange={e => setF({ ...f, sequence: e.target.value })} /></Field>
        </div>
        <Field label="Notes (optional)"><input className={inputCls} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
        {err && <Notice tone="error">{err}</Notice>}
        <div className="flex justify-end gap-2">{editing && <Button variant="quiet" onClick={reset}>Cancel edit</Button>}<Button type="submit" disabled={add.isPending || upd.isPending} testId="button-save-stop">{editing ? 'Save stop' : 'Add stop'}</Button></div>
      </form>
    </Modal>
  );
}

/* Assignments */
function AssignmentsTab({ schoolId, q, routes }: { schoolId: number; q: Q<TransportAssignment[]>; routes: TransportRoute[] }) {
  const [creating, setCreating] = useState(false);
  const [acting, setActing] = useState<TransportAssignment | null>(null);
  const [viewing, setViewing] = useState<TransportAssignment | null>(null);
  const [planning, setPlanning] = useState<TransportAssignment | null>(null);
  const [filter, setFilter] = useState<'all' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED'>('all');
  const rows = (q.data ?? []).filter(a => filter === 'all' || a.status === filter);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <select aria-label="Filter riders" className={cx(inputCls, '!w-auto')} value={filter} onChange={e => setFilter(e.target.value as typeof filter)}>
          <option value="all">All riders</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option><option value="DEACTIVATED">Deactivated</option>
        </select>
        <Button onClick={() => setCreating(true)} disabled={!routes.length} title={routes.length ? undefined : 'Create a route first'} testId="button-assign-student"><Plus size={16} />Assign student</Button>
      </div>
      <Frame q={q} empty={<EmptyState icon={UsersRound} title="No riders assigned" description="Search existing students and assign them to a route with pickup and drop-off stops." />}>
        {() => rows.length ? (
          <div className="space-y-3">
            {rows.map(a => (
              <div key={a.id} className="panel p-5" data-testid={`assignment-${a.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><div className="font-bold">{a.studentName}</div><div className="text-xs text-[hsl(var(--muted-foreground))]">{a.admissionNo} - {a.className} {a.section}</div></div>
                  <StatusPill value={a.status} />
                </div>
                <div className="mt-3 text-sm">{a.busName} - {a.routeName}</div>
                <div className="text-xs text-[hsl(var(--muted-foreground))]">Pickup {a.pickup.name} - Drop-off {a.dropoff.name} - since {date(a.effectiveDate)}</div>
                {a.guardians.length > 0 && <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Guardians: {a.guardians.map(g => `${g.name} (${g.phone})`).join(', ')}</div>}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setActing(a)} testId={`button-manage-assignment-${a.id}`}>Change status or route</Button>
                  <Button variant="quiet" onClick={() => setViewing(a)} testId={`button-history-${a.id}`}><History size={14} />History and fees</Button>
                  <Button variant="quiet" onClick={() => setPlanning(a)} testId={`button-fee-plan-${a.id}`}><CircleDollarSign size={14} />Fee plan</Button>
                </div>
              </div>
            ))}
          </div>
        ) : <div className="panel"><EmptyState icon={UsersRound} title="No riders in this filter" description="Try another status." /></div>}
      </Frame>
      {creating && <AssignForm schoolId={schoolId} routes={routes} onClose={() => setCreating(false)} />}
      {acting && <ManageAssignment schoolId={schoolId} a={acting} routes={routes} onClose={() => setActing(null)} />}
      {viewing && <HistoryModal schoolId={schoolId} a={viewing} onClose={() => setViewing(null)} />}
      {planning && <FeePlanModal schoolId={schoolId} a={planning} onClose={() => setPlanning(null)} />}
    </div>
  );
}

function RoutePicker({ schoolId, routes, routeId, setRouteId, pickup, setPickup, dropoff, setDropoff, currentReservedBusId }: { schoolId: number; routes: TransportRoute[]; routeId: string; setRouteId: (v: string) => void; pickup: string; setPickup: (v: string) => void; dropoff: string; setDropoff: (v: string) => void; currentReservedBusId?: number }) {
  const all = routes as PickerRoute[];
  const route = all.find(r => String(r.id) === routeId);
  const [busId, setBusId] = useState(route ? String(route.busId) : '');
  useEffect(() => {
    if (route) setBusId(String(route.busId));
  }, [route?.busId]);
  const applicableCount = (rs: PickerRoute[], id: number) => routesForBus(rs, String(id)).length;
  const busesQ = useListTransportBuses({ schoolId }, { query: { ...fresh, queryKey: ['/api/transport/buses', { schoolId }] } });
  const buses = busesQ.data ?? [];
  const bus = buses.find(b => String(b.id) === busId);
  const noRoutes = !!bus && !applicableCount(all, bus.id);
  const applicable = routesForBus(all, busId);
  const block = routeBlock(route, currentReservedBusId);
  return (
    <>
      <Field label="Bus">
        <select className={inputCls} value={busId} onChange={e => { setBusId(e.target.value); setRouteId(''); setPickup(''); setDropoff(''); }} data-testid="select-assign-bus">
          <option value="">Select a bus</option>
          {buses.map(b => { const c = busChoice(b, all, b.id, currentReservedBusId); return <option key={b.id} value={b.id} disabled={c.disabled}>{b.name} ({b.registrationNumber}) - {b.passengerCount}/{b.capacity}{c.note ? ` - ${c.note}` : ''}</option>; })}
        </select>
      </Field>
      {busesQ.isError && <Notice tone="error">{errorMessage(busesQ.error)}</Notice>}
      {!busesQ.isLoading && !buses.length && <Notice>No buses exist yet. Add one under Buses.</Notice>}
      {noRoutes && <Notice testId="bus-no-routes">This bus has no active route. Create a route for it under the Routes tab first; assignments always go through an existing route.</Notice>}
      <Field label="Route">
        <select className={inputCls} value={routeId} disabled={!bus} onChange={e => { setRouteId(e.target.value); setPickup(''); setDropoff(''); }} data-testid="select-assign-route">
          <option value="">{bus ? 'Select a route' : 'Choose a bus first'}</option>
          {applicable.map(r => <option key={r.id} value={r.id} disabled={!!routeBlock(r, currentReservedBusId)}>{r.name} - {r.departureTime} to {r.arrivalTime}{routeBlock(r, currentReservedBusId) ? ` (${routeBlock(r, currentReservedBusId)})` : ''}</option>)}
        </select>
      </Field>
      {route && (
        <div className="rounded-xl border border-[hsl(var(--border))] p-3 text-xs text-[hsl(var(--muted-foreground))]" data-testid="route-details">
          <div><b>Driver:</b> {route.driverName}{route.driverEmployeeNo ? ` (${route.driverEmployeeNo})` : ''}{route.driverPhone ? ` - ${route.driverPhone}` : ''}</div>
          <div><b>Schedule:</b> {route.departureTime} to {route.arrivalTime}, {route.weekdays.map(d => d.slice(0, 3)).join(', ')}</div>
          <div><b>Bus:</b> {route.busName} - {route.registrationNumber} - {route.reservedPassengerCount} of {route.busCapacity} seats reserved</div>
        </div>
      )}
      {block && <Notice tone="error" testId="route-full-warning">{block} New riders cannot be assigned to this route.</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Pickup stop"><select className={inputCls} value={pickup} onChange={e => setPickup(e.target.value)} disabled={!route || !!block} data-testid="select-assign-pickup"><option value="">Select</option>{stopsFor(route, 'PICKUP').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Drop-off stop"><select className={inputCls} value={dropoff} onChange={e => setDropoff(e.target.value)} disabled={!route || !!block} data-testid="select-assign-dropoff"><option value="">Select</option>{stopsFor(route, 'DROPOFF').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      </div>
      {route && !block && (!stopsFor(route, 'PICKUP').length || !stopsFor(route, 'DROPOFF').length) && <Notice>This route needs active pickup and drop-off stops. Add them under Routes.</Notice>}
    </>
  );
}

function AssignForm({ schoolId, routes, onClose }: { schoolId: number; routes: TransportRoute[]; onClose: () => void }) {
  const invalidate = useInvalidateTransport();
  const create = useCreateTransportAssignment();
  const [search, setSearch] = useState('');
  const dq = useDebounced(search);
  const students = useSearchTransportStudents({ schoolId, limit: 20, ...(dq ? { search: dq } : {}) }, { query: { queryKey: ['/api/transport/students', { schoolId, search: dq }], staleTime: TRANSPORT_STALE_MS } });
  const options = students.data ?? [];
  const [studentId, setStudentId] = useState<number | null>(null);
  const chosen = (students.data ?? []).find(s => s.studentId === studentId);
  const [routeId, setRouteId] = useState(''); const [pickup, setPickup] = useState(''); const [dropoff, setDropoff] = useState('');
  const [eff, setEff] = useState(today()); const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!studentId) return setErr('Select an existing student from the search results.');
    if (routeBlock((routes as PickerRoute[]).find(r => String(r.id) === routeId))) return setErr('Choose a route that is active and has free seats.');
    if (!routeId || !pickup || !dropoff) return setErr('Choose a route, a pickup stop and a drop-off stop.');
    const v = validateEffective(eff, reason); if (v) return setErr(v);
    setErr(null);
    create.mutate({ params: { schoolId }, data: { studentId, routeId: Number(routeId), pickupStopId: Number(pickup), dropoffStopId: Number(dropoff), effectiveDate: eff, reason: reason.trim() } }, { onSuccess: () => { invalidate(); onClose(); }, onError: x => setErr(errorMessage(x)) });
  };
  return (
    <Modal title="Assign student to transport" eyebrow="Riders" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Search existing students"><input className={inputCls} placeholder="Name or admission number" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-student-search" /></Field>
        <div className="max-h-48 space-y-1.5 overflow-auto" data-testid="student-results">
          {students.isLoading && <div className="skeleton h-12 rounded-xl" />}
          {students.isError && <Notice tone="error">{errorMessage(students.error)}</Notice>}
          {!students.isLoading && !students.isError && !options.length && <p className="py-3 text-center text-sm text-[hsl(var(--muted-foreground))]">No assignable students match. Students must already exist in the school records.</p>}
          {options.map(s => (
            <button type="button" key={s.studentId} disabled={!!s.activeAssignment} onClick={() => setStudentId(s.studentId)} aria-pressed={studentId === s.studentId} data-testid={`student-option-${s.studentId}`}
              className={cx('w-full rounded-xl border p-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-60', studentId === s.studentId ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/.08)]' : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted)/.5)]')}>
              <div className="font-bold">{s.studentName}</div>
              <div className="text-xs text-[hsl(var(--muted-foreground))]">{s.admissionNo} - {s.className} {s.section}{s.guardians.length ? ` - ${s.guardians.map(g => g.name).join(', ')}` : ' - no guardian on record'}</div>
              {s.activeAssignment && <div className="mt-1 text-xs font-bold text-[hsl(var(--destructive))]" data-testid={`student-assigned-${s.studentId}`}>Already rides {s.activeAssignment.routeName} on {s.activeAssignment.busName}. Update it from the Riders tab.</div>}
            </button>
          ))}
        </div>
        {chosen && <Notice>Selected: {chosen.studentName}. Class and guardians come from the student record.</Notice>}
        <RoutePicker schoolId={schoolId} routes={routes} routeId={routeId} setRouteId={setRouteId} pickup={pickup} setPickup={setPickup} dropoff={dropoff} setDropoff={setDropoff} />
        <Field label="Effective date"><input type="date" className={inputCls} value={eff} onChange={e => setEff(e.target.value)} /></Field>
        <Field label="Reason"><textarea rows={2} className={inputCls} value={reason} onChange={e => setReason(e.target.value)} placeholder="For example: parent requested school bus from term start" data-testid="input-assign-reason" /></Field>
        {err && <Notice tone="error" testId="assign-form-error">{err}</Notice>}
        <div className="flex justify-end gap-2"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button type="submit" disabled={create.isPending || !studentId || !routeId || !pickup || !dropoff || !!routeBlock(routes.find(r => String(r.id) === routeId))} testId="button-save-assignment">{create.isPending ? 'Assigning...' : 'Assign student'}</Button></div>
      </form>
    </Modal>
  );
}

type ActionKey = 'CHANGE_ROUTE' | 'CHANGE_STOPS' | 'ACTIVATE' | 'SUSPEND' | 'DEACTIVATE';

function ManageAssignment({ schoolId, a, routes, onClose }: { schoolId: number; a: TransportAssignment; routes: TransportRoute[]; onClose: () => void }) {
  const invalidate = useInvalidateTransport();
  const update = useUpdateTransportAssignment();
  const options: Array<{ id: ActionKey; label: string }> = [
    ...(a.status !== 'ACTIVE' ? [{ id: 'ACTIVATE' as const, label: 'Activate' }] : []),
    ...(a.status === 'ACTIVE' ? [{ id: 'SUSPEND' as const, label: 'Suspend' }] : []),
    ...(a.status !== 'DEACTIVATED' ? [{ id: 'DEACTIVATE' as const, label: 'Deactivate' }] : []),
    { id: 'CHANGE_ROUTE', label: 'Change route or bus' }, { id: 'CHANGE_STOPS', label: 'Change stops' },
  ];
  const [action, setAction] = useState<ActionKey>(options[0].id);
  const [routeId, setRouteId] = useState(action === 'CHANGE_STOPS' ? String(a.routeId) : '');
  const [pickup, setPickup] = useState(''); const [dropoff, setDropoff] = useState('');
  const [eff, setEff] = useState(today()); const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const pickAction = (k: ActionKey) => { setAction(k); setErr(null); setPickup(''); setDropoff(''); setRouteId(k === 'CHANGE_STOPS' ? String(a.routeId) : ''); };
  const needsRoute = action === 'CHANGE_ROUTE' || action === 'CHANGE_STOPS';
  const currentReservedBusId = a.status === 'ACTIVE' || a.status === 'SUSPENDED' ? a.busId : undefined;
  const selectedRoute = routes.find(r => r.id === Number(needsRoute ? routeId : a.routeId));
  const block = needsRoute || action === 'ACTIVATE' ? routeBlock(selectedRoute, currentReservedBusId) : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = validateEffective(eff, reason); if (v) return setErr(v);
    if (block) return setErr(block);
    const body: TransportAssignmentUpdate = { action, effectiveDate: eff, reason: reason.trim() };
    if (needsRoute) {
      if (!routeId || !pickup || !dropoff) return setErr('Choose the route and both stops.');
      body.routeId = Number(routeId); body.pickupStopId = Number(pickup); body.dropoffStopId = Number(dropoff);
    } else body.status = action === 'ACTIVATE' ? 'ACTIVE' : action === 'SUSPEND' ? 'SUSPENDED' : 'DEACTIVATED';
    setErr(null);
    update.mutate({ assignmentId: a.id, params: { schoolId }, data: body }, { onSuccess: () => { invalidate(); onClose(); }, onError: x => setErr(errorMessage(x)) });
  };
  return (
    <Modal title={a.studentName} eyebrow="Change transport" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="text-xs text-[hsl(var(--muted-foreground))]">Now: {a.status.toLowerCase()} on {a.routeName} ({a.busName})</div>
        <Field label="Action"><select className={inputCls} value={action} onChange={e => pickAction(e.target.value as ActionKey)} data-testid="select-assignment-action">{options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></Field>
        {needsRoute && <RoutePicker schoolId={schoolId} routes={routes} routeId={routeId} setRouteId={setRouteId} pickup={pickup} setPickup={setPickup} dropoff={dropoff} setDropoff={setDropoff} currentReservedBusId={currentReservedBusId} />}
        {!needsRoute && block && <Notice tone="error">{block}</Notice>}
        <Field label="Effective date"><input type="date" className={inputCls} value={eff} onChange={e => setEff(e.target.value)} data-testid="input-action-date" /></Field>
        <Field label="Reason"><textarea rows={2} className={inputCls} value={reason} onChange={e => setReason(e.target.value)} data-testid="input-action-reason" /></Field>
        {err && <Notice tone="error" testId="manage-form-error">{err}</Notice>}
        <div className="flex justify-end gap-2"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button type="submit" variant={action === 'DEACTIVATE' || action === 'SUSPEND' ? 'danger' : 'primary'} disabled={update.isPending || !!block || (needsRoute && (!routeId || !pickup || !dropoff))} testId="button-confirm-action">{update.isPending ? 'Saving...' : 'Confirm change'}</Button></div>
      </form>
    </Modal>
  );
}

function HistoryModal({ schoolId, a, onClose }: { schoolId: number; a: TransportAssignment; onClose: () => void }) {
  const q = useGetTransportAssignmentHistory(a.id, { schoolId }, { query: { ...fresh, queryKey: ['/api/transport/assignments', a.id, 'history', { schoolId }] } });
  return (
    <Modal title={a.studentName} eyebrow="Transport history" onClose={onClose}>
      <AssignmentSummary a={a} />
      <div className="mt-5"><div className="eyebrow mb-2">Transport invoices ({assignmentTone(a.status)})</div><InvoiceList invoices={a.invoices} financeHref="/finance" financeLabel="Open School Fees" /></div>
      <div className="mt-6"><div className="eyebrow mb-3">Changes</div>
        {q.isLoading ? <ListSkeleton rows={2} /> : q.isError ? <Notice tone="error">{errorMessage(q.error)} <button className="underline" onClick={() => q.refetch()}>Retry</button></Notice> : <HistoryList entries={q.data ?? []} />}
      </div>
    </Modal>
  );
}

/* Requests */
function RequestsTab({ schoolId, q }: { schoolId: number; q: Q<TransportRequest[]> }) {
  const [reviewing, setReviewing] = useState<TransportRequest | null>(null);
  return (
    <div>
      <Notice>Approving a request never changes a student's transport on its own. Choose the school action explicitly when you review.</Notice>
      <div className="mt-4">
        <Frame q={q} empty={<EmptyState icon={Inbox} title="No parent requests" description="Requests from parents to start or stop transport will arrive here." />}>
          {items => (
            <div className="space-y-3">
              {[...items].sort((a, b) => (a.status === 'PENDING' ? -1 : 1) - (b.status === 'PENDING' ? -1 : 1) || b.createdAt.localeCompare(a.createdAt)).map(r => (
                <RequestRow key={r.id} r={r}>{r.status === 'PENDING' && <div className="mt-3"><Button onClick={() => setReviewing(r)} testId={`button-review-${r.id}`}>Review request</Button></div>}</RequestRow>
              ))}
            </div>
          )}
        </Frame>
      </div>
      {reviewing && <ReviewForm schoolId={schoolId} r={reviewing} onClose={() => setReviewing(null)} />}
    </div>
  );
}

function ReviewForm({ schoolId, r, onClose }: { schoolId: number; r: TransportRequest; onClose: () => void }) {
  const invalidate = useInvalidateTransport();
  const review = useReviewTransportRequest();
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT'>('APPROVE');
  const [act, setAct] = useState<'NO_CHANGE' | 'ACTIVATE' | 'SUSPEND' | 'DEACTIVATE'>('NO_CHANGE');
  const [eff, setEff] = useState(r.effectiveDate.slice(0, 10)); const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (note.trim().length < 3) return setErr('Add a note the parent will see.');
    if (!eff) return setErr('Choose an effective date.');
    setErr(null);
    review.mutate({ requestId: r.id, params: { schoolId }, data: { decision, action: decision === 'REJECT' ? 'NO_CHANGE' : act, effectiveDate: eff, schoolNote: note.trim() } }, { onSuccess: () => { invalidate(); onClose(); }, onError: x => setErr(errorMessage(x)) });
  };
  return (
    <Modal title={r.studentName} eyebrow="Review request" onClose={onClose}>
      <RequestRow r={r} />
      <form onSubmit={submit} className="mt-4 space-y-4">
        <Field label="Decision"><select className={inputCls} value={decision} onChange={e => setDecision(e.target.value as typeof decision)} data-testid="select-review-decision"><option value="APPROVE">Approve</option><option value="REJECT">Reject</option></select></Field>
        {decision === 'APPROVE' && <Field label="School action"><select className={inputCls} value={act} onChange={e => setAct(e.target.value as typeof act)} data-testid="select-review-action"><option value="NO_CHANGE">Record approval only (no transport change)</option><option value="ACTIVATE">Activate transport</option><option value="SUSPEND">Suspend transport</option><option value="DEACTIVATE">Deactivate transport</option></select></Field>}
        <Field label="Effective date"><input type="date" className={inputCls} value={eff} onChange={e => setEff(e.target.value)} /></Field>
        <Field label="Note to parent"><textarea rows={2} className={inputCls} value={note} onChange={e => setNote(e.target.value)} data-testid="input-review-note" /></Field>
        {err && <Notice tone="error">{err}</Notice>}
        <div className="flex justify-end gap-2"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button type="submit" variant={decision === 'REJECT' ? 'danger' : 'primary'} disabled={review.isPending} testId="button-submit-review">{review.isPending ? 'Saving...' : decision === 'APPROVE' ? 'Approve request' : 'Reject request'}</Button></div>
      </form>
    </Modal>
  );
}

