import { useUser } from '@clerk/react';
import { useGetMyBroCommissionEntitlements, getGetMyBroCommissionEntitlementsQueryKey } from '@workspace/api-client-react';
import { ErrorState, SkeletonPage, date } from '@/components/shared';
import { ConnectedFinancePanel } from '@/components/current-finance-panel';

const naira = (minor: number) => `₦${(minor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
export default function OwnBroCommissions() {
  return <><LegacyBroCommissions /><ConnectedFinancePanel mode="bro" /></>;
}

function LegacyBroCommissions() {
  const { user } = useUser();
  const query = useGetMyBroCommissionEntitlements({ query: {
    queryKey: [...getGetMyBroCommissionEntitlementsQueryKey(), user?.id],
    enabled: !!user?.id, staleTime: 0, refetchOnMount: 'always',
    refetchOnWindowFocus: true, refetchInterval: 10_000, retry: false,
  } });
  if (query.isLoading) return <SkeletonPage />;
  if (query.isError || !query.data) return <ErrorState
    message="Your commission entitlements could not be confirmed. No balance can be inferred."
    retry={() => void query.refetch()} />;
  return <section className="panel my-6 overflow-hidden" data-testid="own-bro-commissions">
    <div className="border-b border-[hsl(var(--border))] p-5">
      <div className="eyebrow">Original accrual evidence</div>
      <h2 className="display-font mt-2 text-2xl font-bold">{naira(query.data.earnedMinor)} earned</h2>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Only your eligible, independently verified student-term subscriptions are included. These immutable entries show their original accrual status, not current withdrawal decisions. The connected lifecycle below shows current approvals and payouts. Accrual is not a bank transfer.</p>
    </div>
    {!query.data.items.length ? <p className="p-5 text-sm">No eligible commission has been earned yet.</p>
      : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <thead><tr><th className="p-4">Student</th><th className="p-4">Academic term</th>
          <th className="p-4">Your commission</th><th className="p-4">Earned</th><th className="p-4">Original status</th></tr></thead>
        <tbody>{query.data.items.map(item => <tr key={item.id} className="border-t border-[hsl(var(--border))]">
          <td className="p-4">Student #{item.studentId}</td><td className="p-4">Term #{item.termId}</td>
          <td className="p-4 font-bold">{naira(item.amountMinor)}</td><td className="p-4">{date(item.earnedAt)}</td>
          <td className="p-4">{item.status === 'PENDING_OWNER_APPROVAL' ? 'Earned · awaiting approval' : item.status}</td>
        </tr>)}</tbody>
      </table></div>}
  </section>;
}
