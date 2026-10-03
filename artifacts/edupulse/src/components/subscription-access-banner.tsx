import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { getGetMySubscriptionEnforcementQueryKey, useGetMySubscriptionEnforcement } from '@workspace/api-client-react';
import type { SubscriptionAccessStatus } from '@workspace/api-client-react';
import { date } from '@/components/shared';

export type BannerAudience = 'teacher' | 'student' | 'parent';

export function describeAccess(items: SubscriptionAccessStatus[], audience: BannerAudience) {
  const restricted = items.filter(i => i.restricted && (audience === 'teacher' ? i.studentId === null : i.studentId !== null));
  const active = items.filter(i => !i.restricted && i.studentId !== null && i.state !== 'UNAVAILABLE');
  return { restricted, active };
}

export function SubscriptionAccessBanner({ audience }: { audience: BannerAudience }) {
  const query = useGetMySubscriptionEnforcement({
    query: { queryKey: getGetMySubscriptionEnforcementQueryKey(), staleTime: 30_000, refetchInterval: 60_000, refetchOnMount: 'always' },
  });
  const items = query.data ?? [];
  const { restricted, active } = describeAccess(items, audience);
  if (query.isError) return <p role="status" className="mb-4 text-sm">Subscription status is unavailable. <button type="button" className="underline" onClick={() => void query.refetch()}>Retry</button></p>;
  if (!restricted.length) return null;
  const copy = (i: SubscriptionAccessStatus) => {
    const when = i.enforcementDate ? ` Enforcement date: ${date(i.enforcementDate)}.` : '';
    const term = i.termName ? ` for ${i.termName}` : '';
    if (audience === 'teacher') return `${i.schoolName}: your school card and reader access is restricted${term} because no student subscription is covered at this school.${when}`;
    if (audience === 'student') return `${i.schoolName}: your card and device access is restricted${term} because your own subscription is unpaid.${when}`;
    return `${i.schoolName}: card and device access for linked child #${i.studentId} is restricted${term} because that child's subscription is unpaid.${when}`;
  };
  return (
    <div role="alert" data-testid="subscription-access-banner" className="mb-5 rounded-xl border border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.07)] p-4 text-sm">
      <div className="flex items-center gap-2 font-bold text-[hsl(var(--destructive))]"><ShieldAlert size={16} />Subscription restriction</div>
      <ul className="mt-2 space-y-1.5">{restricted.map(i => <li key={`${i.schoolId}-${i.studentId}`}>{copy(i)}</li>)}</ul>
      {audience === 'parent' && active.length > 0 && (
        <p className="mt-2 flex items-start gap-2 text-xs font-semibold text-[hsl(157_37%_30%)]"><ShieldCheck size={14} className="mt-0.5 shrink-0" />{active.length} other linked {active.length === 1 ? 'child remains' : 'children remain'} fully active.</p>
      )}
      <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">Login, your account, payments and the inbox stay available. Historical records remain safely stored.</p>
    </div>
  );
}
