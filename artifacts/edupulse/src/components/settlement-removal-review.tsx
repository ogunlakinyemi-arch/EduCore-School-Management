import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  reviewCompanySettlementRemoval, reviewSchoolSettlementRemoval,
  removeCompanyPendingSettlement, removeSchoolPendingSettlement,
} from '@workspace/api-client-react';
import type { SettlementRemovalReview } from '@workspace/api-client-react';
import { Button, ErrorState, Info, Modal } from './shared';
import { entry, errMsg, Notice } from '@/pages/payroll-common';

export function SettlementRemovalReviewControl({ schoolId }: { schoolId?: number }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [result, setResult] = useState('');
  const qc = useQueryClient();
  const review = useQuery<SettlementRemovalReview>({
    queryKey: ['settlement-removal-review', schoolId ?? 'company'],
    queryFn: () => schoolId ? reviewSchoolSettlementRemoval(schoolId) : reviewCompanySettlementRemoval(),
    enabled: open && import.meta.env.DEV,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  useEffect(() => { setConfirmation(''); }, [review.data?.profileId, review.data?.version]);
  const removal = useMutation({
    mutationFn: async () => {
      const p = review.data;
      if (!p?.eligible || !p.profileId || !p.version || confirmation !== `REMOVE PROFILE ${p.profileId}`) {
        throw new Error('Review the exact profile and type its confirmation first.');
      }
      const input = { expectedProfileId: p.profileId, expectedVersion: p.version, confirmation };
      return schoolId ? removeSchoolPendingSettlement(schoolId, input) : removeCompanyPendingSettlement(input);
    },
    onSuccess: (r) => {
      setOpen(false); setConfirmation('');
      setResult(`Pending profile ${r.profileId} removed. Audit and payment history retained. No provider operation performed.`);
      qc.invalidateQueries({ predicate: q => typeof q.queryKey[0] === 'string'
        && (/payment-settlement|settlement/.test(q.queryKey[0])) });
    },
    onError: () => { review.refetch(); setConfirmation(''); },
  });
  if (!import.meta.env.DEV) return null;
  const p = review.data;
  return <div className="mt-5">
    {result && <Notice kind="ok" onClose={() => setResult('')}>{result}</Notice>}
    <Button variant="quiet" testId="button-review-pending-removal" onClick={() => {
      setConfirmation(''); removal.reset(); setOpen(true);
    }}>Review pending profile removal (Development only)</Button>
    {open && <Modal title="Review pending settlement profile" eyebrow="Development only" onClose={() => {
      if (!removal.isPending) setOpen(false);
    }}>
      <p className="mb-4">Opening this review does not remove anything. Removal requires a separate explicit authorization for this exact record.</p>
      {review.isPending ? <p>Checking Development isolation and profile eligibility...</p> :
        review.isError ? <ErrorState message={errMsg(review.error)} retry={() => review.refetch()} /> :
        p && <div className="space-y-4">
          <Info label="Business" value={p.businessName ?? 'No profile'} />
          <Info label="Profile ID" value={p.profileId?.toString() ?? 'None'} />
          <Info label="Scope" value={p.scope === 'SCHOOL' ? `School ${p.schoolId}` : 'Company'} />
          <Info label="Exact version" value={p.version ?? 'None'} />
          <Info label="Status" value={p.status} />
          <p>{p.notice}</p>
          {!p.eligible ? <Notice kind="error">This profile is not eligible for removal. Verified or linked profiles are never removed here.</Notice> :
            <label className="block">Only after separate authorization, type <strong>REMOVE PROFILE {p.profileId}</strong>
              <input aria-label="Exact removal confirmation" className={entry} value={confirmation}
                disabled={removal.isPending} onChange={e => setConfirmation(e.target.value)} />
            </label>}
          {removal.isError && <Notice kind="error">{errMsg(removal.error)}</Notice>}
          <div className="flex gap-2">
            <Button testId="button-remove-pending-profile" disabled={!p.eligible || review.isFetching || removal.isPending
              || confirmation !== `REMOVE PROFILE ${p.profileId}`}
              onClick={() => removal.mutate()}>
              {removal.isPending ? 'Removing...' : 'Remove this exact pending profile'}
            </Button>
            <Button variant="quiet" disabled={removal.isPending} onClick={() => setOpen(false)}>Cancel — keep profile</Button>
          </div>
        </div>}
    </Modal>}
  </div>;
}
