import { useState } from 'react';
import { Bus, ShieldAlert, UsersRound } from 'lucide-react';
import { useGetAuthorizedContext, useGetDriverTransport, getGetDriverTransportQueryKey } from '@workspace/api-client-react';
import { EmptyState, ErrorState, PageHeading, StatusPill } from '@/components/shared';
import { ListSkeleton } from '@/components/transport-parts';
import { TRANSPORT_POLL_MS, TRANSPORT_STALE_MS, driverAudience, driverSchools } from '@/components/transport-logic';

export function driverTransportUrl(schoolId?: number | null) {
  return `/api/driver/transport${schoolId ? `?schoolId=${schoolId}` : ''}`;
}

export default function DriverTransportPage() {
  const ctx = useGetAuthorizedContext();
  const schools = driverSchools(ctx.data);
  const [pick, setPick] = useState<number | null>(null);
  const schoolId = pick ?? schools[0] ?? null;
  const params = schoolId ? { schoolId } : undefined;
  const q = useGetDriverTransport(params, { query: {
    queryKey: getGetDriverTransportQueryKey(params), enabled: driverAudience(ctx.data),
    staleTime: TRANSPORT_STALE_MS, refetchInterval: TRANSPORT_POLL_MS, refetchOnMount: 'always', refetchOnWindowFocus: true,
  } });
  if (ctx.isLoading) return <ListSkeleton rows={3} />;
  if (ctx.isError) return <ErrorState retry={() => ctx.refetch()} message="We could not confirm your access." />;
  if (!driverAudience(ctx.data)) {
    return <div data-testid="driver-transport-denied"><PageHeading eyebrow="Driver" title="Driver transport" /><div className="panel"><EmptyState icon={ShieldAlert} title="Drivers only" description="This page is for school drivers. It shows only your own routes and riders." /></div></div>;
  }
  const d = q.data;
  return (
    <div className="mx-auto max-w-5xl" data-testid="driver-transport">
      <PageHeading eyebrow="Driver" title="Driver transport" description="Your active routes and the students who ride them. Contact details and fees are not shown here." />
      <nav aria-label="Driver sections" className="mb-5 flex flex-wrap gap-4 text-sm font-semibold text-[hsl(var(--primary))]"><a href="#driver-profile">My profile</a><a href="#driver-journeys">My vehicle and journeys</a><a href="#driver-instructions">Instructions</a></nav>
      {schools.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="Choose school">
          {schools.map(id => <button key={id} role="tab" aria-selected={id === schoolId} onClick={() => setPick(id)} data-testid={`select-driver-school-${id}`} className={`rounded-xl border px-4 py-2 text-sm font-bold ${id === schoolId ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/.08)]' : 'border-[hsl(var(--border))]'}`}>School {id}</button>)}
        </div>
      )}
      {q.isLoading ? <ListSkeleton rows={3} /> : q.isError || !d ? <ErrorState retry={() => q.refetch()} message={q.error instanceof Error ? q.error.message : undefined} /> : (
        <div className="space-y-6">
          <section id="driver-profile" className="panel p-5" data-testid="driver-profile">
            <div className="display-font text-lg font-bold">{d.employee.name}</div>
            <div className="text-xs text-[hsl(var(--muted-foreground))]">{d.employee.employeeNo} - {d.employee.schoolName}{d.employee.phone ? ` - ${d.employee.phone}` : ''}</div>
          </section>
          <div id="driver-journeys" />
          <section id="driver-instructions" className="panel p-5"><h2 className="font-bold">Journey instructions</h2><p className="mt-2 text-sm">Follow the assigned route times and each rider's listed pickup and drop-off stops below. Ask the School Admin about route or rider changes. This account does not collect fees or change student enrollment.</p></section>
          {!d.routes.length ? <div className="panel"><EmptyState icon={Bus} title="No active routes" description="You have no active route assigned. The school administrator assigns routes." /></div> : d.routes.map(r => {
            const riders = d.assignments.filter(a => a.routeId === r.id);
            return (
              <section key={r.id} className="panel p-5" data-testid={`driver-route-${r.id}`}>
                <div className="display-font text-lg font-bold">{r.name}</div>
                <div className="text-xs text-[hsl(var(--muted-foreground))]">{r.busName} ({r.registrationNumber}) - {r.departureTime} to {r.arrivalTime} - {r.weekdays.map(x => x.slice(0, 3)).join(', ')}</div>
                <div className="mt-4 space-y-2">
                  {riders.length ? riders.map(a => (
                    <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[hsl(var(--border))] p-3 text-sm" data-testid={`driver-rider-${a.id}`}>
                      <div><div className="font-bold">{a.studentName}</div><div className="text-xs text-[hsl(var(--muted-foreground))]">{a.admissionNo} - {a.className} {a.section} - Pickup {a.pickupName} - Drop-off {a.dropoffName}</div></div>
                      <StatusPill value={a.status} />
                    </div>
                  )) : <p className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]"><UsersRound size={14} />No riders on this route.</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
