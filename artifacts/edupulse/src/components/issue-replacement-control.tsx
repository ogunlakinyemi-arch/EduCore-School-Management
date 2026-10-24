import { useState } from 'react';
import { customFetch, useIssueCardReplacement } from '@workspace/api-client-react';
import { Button, Field } from '@/components/shared';
import { useUidInventory } from '@/components/owner-uid-reader';
import { backendError, useInvalidateCardData } from '@/components/uid-actions';

/** Rendered only once the parent has confirmed the request is Owner-issuable (REQUESTED + PAID). */
export function IssueReplacementControl({ requestId, prepared, preparedLoading, onMessage, onError, onDone }: {
  requestId: number; prepared: { id: number; uid: string }[]; preparedLoading: boolean;
  onMessage: (m: string) => void; onError: (m: string) => void; onDone: () => void;
}) {
  const [uid, setUid] = useState('');
  const [busy, setBusy] = useState(false);
  const issue = useIssueCardReplacement();
  const inv = useUidInventory();
  const invalidateAll = useInvalidateCardData();
  const captured = (inv.data?.inventory ?? []).filter(u => !u.assigned);
  const isCaptured = captured.some(u => u.uid === uid);
  const run = async () => {
    setBusy(true);
    try {
      if (isCaptured) {
        await customFetch(`/api/platform/uid-inventory/replacements/${requestId}/issue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid, confirm: true }) });
      } else {
        await issue.mutateAsync({ requestId, data: { uid } });
        onDone();
      }
      await invalidateAll();
      onMessage('Replacement card issued.'); setUid('');
    } catch (e) { onError(backendError(e)); } finally { setBusy(false); }
  };
  return <div className="mt-3 flex flex-wrap items-end gap-2">
    <Field label="Prepared or captured UID">
      <select value={uid} onChange={e => setUid(e.target.value)} data-testid={`select-new-card-${requestId}`}>
        <option value="">{preparedLoading ? 'Loading cards...' : prepared.length || captured.length ? 'Select a card UID' : 'No prepared or captured UIDs available'}</option>
        {prepared.map(c => <option key={c.id} value={c.uid}>{c.uid}</option>)}
        {captured.map(u => <option key={`cap-${u.uid}`} value={u.uid} data-testid={`option-captured-${u.uid}`}>{u.uid} (captured)</option>)}
      </select>
    </Field>
    <Button onClick={() => void run()} disabled={!uid || busy} testId={`button-issue-replacement-${requestId}`}>{busy ? 'Issuing...' : 'Issue replacement'}</Button>
  </div>;
}
