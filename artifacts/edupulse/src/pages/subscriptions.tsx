import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { WalletCards, Plus, Search, Check, CircleAlert } from 'lucide-react';
import { 
  useListSubscriptions, useCreateSubscription, useVerifySubscription, 
  getListSubscriptionsQueryKey 
} from '@workspace/api-client-react';
import { 
  PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, 
  TenantPicker, useTenant, money, date, useSchoolAdminAccess
} from '@/components/shared';
import { useGetAuthorizedContext } from '@workspace/api-client-react';

// Phase 3 compliant Subscriptions Page
export function SubscriptionsPage() {
  const { schoolId, setSchoolId } = useTenant();
  const { isPlatformOwner } = useSchoolAdminAccess();
  const context = useGetAuthorizedContext().data;
  const canVerify = !isPlatformOwner && !!context?.roles?.some(
    role => role.schoolId === schoolId && role.role === 'ACCOUNTANT' && role.status === 'ACTIVE'
  );
  const qc = useQueryClient();
  const verify = useVerifySubscription();
  
  const query = useListSubscriptions({ schoolId }, { query: { enabled: !!schoolId, queryKey: getListSubscriptionsQueryKey({ schoolId }) } }); 
  const subscriptions: any[] = query.data ?? [];
  
  const handleVerify = (id: number) => {
    verify.mutate({ subscriptionId: id, data: { status: 'active', transactionReference: `VER-${Date.now()}` } as any }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListSubscriptionsQueryKey({ schoolId }) })
    });
  };
  
  return (
    <div className="fade-up">
      <PageHeading 
        eyebrow="Financials / Subscriptions" 
        title="Revenue & Access." 
        description="Monitor student payment statuses and term enrollment." 
        action={
          <div className="flex items-center gap-3">
            <TenantPicker />
          </div>
        } 
      />
      
      {!schoolId ? (
        <EmptyState icon={WalletCards} title="Select a school context" description="Select a school to view its subscriptions." />
      ) : query.isLoading ? (
        <SkeletonPage />
      ) : query.isError ? (
        <ErrorState retry={() => query.refetch()} />
      ) : (
        <div className="panel overflow-hidden">
          <div className="hidden grid-cols-[1.5fr_1fr_1fr_1fr_auto] gap-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-6 py-4 text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] md:grid">
            <span>Student Reference</span>
            <span>Amount</span>
            <span>Term Limit</span>
            <span>Status</span>
            <span />
          </div>
          {subscriptions.length ? subscriptions.map((sub: any) => (
            <div key={sub.id} className="grid gap-3 border-b border-[hsl(var(--border)/.6)] px-5 py-5 transition-colors hover:bg-[hsl(var(--muted)/.2)] last:border-0 md:grid-cols-[1.5fr_1fr_1fr_1fr_auto] md:items-center md:gap-4 md:px-6">
              <div>
                <div className="font-bold text-sm text-[hsl(var(--foreground))]">Student ID: {sub.studentId}</div>
                <div className="mt-1 text-xs font-mono text-[hsl(var(--muted-foreground))]">{sub.transactionReference || 'No ref'}</div>
              </div>
              <div className="text-sm font-bold display-font tracking-tight">{money(sub.amount)}</div>
              <div className="text-sm font-medium text-[hsl(var(--muted-foreground))]">{date(sub.endDate)}</div>
              <div><StatusPill value={sub.status} /></div>
              <div className="flex justify-end">
                {canVerify && sub.status === 'pending' && (
                  <Button variant="outline" onClick={() => handleVerify(sub.id)} disabled={verify.isPending}>
                    <Check size={14} />Verify
                  </Button>
                )}
              </div>
            </div>
          )) : (
            <EmptyState icon={CircleAlert} title="No subscriptions" description="No payment records found for this term." />
          )}
        </div>
      )}
    </div>
  );
}