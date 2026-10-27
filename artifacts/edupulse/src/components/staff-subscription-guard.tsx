import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { getGetMyStaffSubscriptionAccessQueryKey, useGetMyStaffSubscriptionAccess } from '@workspace/api-client-react';

export function isStaffOperationalPage(path: string) {
  return /^\/(?:teacher-assignments|teacher-duty|lesson-notes|academics|academic-work|exam-record|timetable|attendance|library|operations|transport)(?:\/|$)/.test(path.split('?')[0]);
}

export function StaffSubscriptionNotice({ status, unavailable = false }: { status?: string; unavailable?: boolean }) {
  return <section role="alert" data-testid="staff-subscription-notice" className="mb-5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] p-4 text-sm">
    <h2 className="font-bold">{unavailable ? 'Staff subscription status unavailable' : 'Staff subscription renewal required'}</h2>
    <p className="mt-2">{unavailable ? 'We cannot confirm your subscription right now. Operational changes are unavailable until status is confirmed.' : `Your current-term subscription is ${(status ?? 'unpaid').toLowerCase().replaceAll('_', ' ')}. Teacher/Staff renewal is ₦2,000 per academic term, paid directly to Yetenia through Flutterwave.`}</p>
    <p className="mt-2 text-xs">Your account, payment status, support, inbox and read-only records remain available. A pending payment does not restore operational access.</p>
    <Link href="/my-nfc-subscription" className="mt-3 inline-block font-bold underline" data-testid="staff-subscription-renew">View subscription / Renew</Link>
  </section>;
}

export function StaffSubscriptionGuard({ schoolId, actorId, active, path, children }: {
  schoolId: number | null; actorId?: number; active: boolean; path: string; children: ReactNode;
}) {
  const enabled = active && !!schoolId;
  const access = useGetMyStaffSubscriptionAccess({ schoolId: schoolId ?? 0 }, {
    query: { queryKey: [...getGetMyStaffSubscriptionAccessQueryKey({schoolId: schoolId ?? 0}), actorId], enabled, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true,
      refetchInterval: 15000, retry: false },
  });
  if (!enabled) return <>{children}</>;
  const blocked = access.isError || !access.data || access.data.restricted;
  const operational = isStaffOperationalPage(path);
  return <>
    {blocked && !access.isLoading && <StaffSubscriptionNotice status={access.data?.status} unavailable={access.isError || !access.data} />}
    {blocked && operational
      ? <fieldset disabled className="m-0 min-w-0 border-0 p-0" data-testid="staff-operations-readonly">
          <legend className="sr-only">Read-only until a current staff subscription is verified</legend>{children}
        </fieldset>
      : children}
  </>;
}
