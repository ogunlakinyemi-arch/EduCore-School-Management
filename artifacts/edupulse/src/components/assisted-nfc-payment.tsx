import { useAuth } from '@clerk/react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { customFetch, useGetAuthorizedContext } from '@workspace/api-client-react';
import { Button, Modal } from '@/components/shared';
import { DirectStudentLivePanel } from './direct-student-live-panel';

export type AssistedOptions = {
  students: { id: number; firstName: string; lastName: string; admissionNo: string }[];
  terms: { id: number; name: string; sessionName: string }[];
  amountMinor: number;
};
export function canCreateAssistedNfcPayment(
  context: { isPlatformOwner?: boolean; roles?: { role: string; status: string; schoolId?: number | null }[] } | undefined,
  schoolId?: number,
) {
  if (!context || context.isPlatformOwner || !schoolId) return false;
  return (context.roles ?? []).some(r => r.role === 'SCHOOL_ADMIN' && r.status === 'ACTIVE' && r.schoolId === schoolId);
}
export const assistedOptionsKey = (identity: string, schoolId: number) => ['/api/student-nfc/assisted-options', identity, schoolId] as const;

export function AssistedNfcPayment({ schoolId, onCreated }: { schoolId?: number; onCreated?: () => void }) {
  const context = useGetAuthorizedContext().data;
  const { userId } = useAuth();
  const [open, setOpen] = useState(false);
  if (!canCreateAssistedNfcPayment(context, schoolId) || !userId || !schoolId) return null;
  return <>
    <Button onClick={() => setOpen(true)} testId="button-create-assisted-nfc">
      <Plus size={14} />Student platform subscription — free rollout
    </Button>
    {open && <Modal title="Pay Student platform fee" eyebrow="School → Yetenia EduCore" onClose={() => setOpen(false)}>
      <PlatformPaymentForm key={`${userId}:${schoolId}`} schoolId={schoolId} identity={userId} onCreated={onCreated} />
    </Modal>}
  </>;
}
function PlatformPaymentForm({ schoolId, identity, onCreated }: { schoolId: number; identity: string; onCreated?: () => void }) {
  const options = useQuery({
    queryKey: assistedOptionsKey(identity, schoolId),
    queryFn: ({ signal }) => customFetch<AssistedOptions>(`/api/student-nfc/assisted-options?schoolId=${schoolId}`, { method: 'GET', signal }),
    staleTime: 0, refetchOnMount: 'always', retry: false,
  });
  if (options.isLoading) return <p role="status">Loading this school's students and academic terms…</p>;
  if (options.isError) return <p role="alert">Student and term choices could not be loaded. <button type="button" onClick={() => void options.refetch()}>Retry</button></p>;
  if (options.data?.amountMinor !== 320000) return <p role="alert">The fixed ₦3,200 platform fee could not be confirmed. Checkout is blocked.</p>;
  if (!options.data.students.length || !options.data.terms.length)
    return <p role="status">No eligible student and academic term are available. No payment can start.</p>;
  return <DirectStudentLivePanel schoolId={schoolId} selectionOptions={options.data} showAssistance={false} onPaymentStateChange={onCreated} />;
}
