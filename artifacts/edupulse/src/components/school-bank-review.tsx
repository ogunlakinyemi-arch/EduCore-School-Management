import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetPlatformSchoolSettlementQueryKey, reviewPlatformSchoolSettlement, useGetPlatformSchoolSettlement } from '@workspace/api-client-react';
import { Button, Field, Modal, SkeletonPage } from '@/components/shared';
import { entry, note } from '@/pages/payroll-common';

export function SchoolBankReview({ schoolId, schoolName, onClose }: {
  schoolId: number; schoolName: string; onClose: () => void;
}) {
  const qc = useQueryClient();
  const query = useGetPlatformSchoolSettlement(schoolId, {
    query: { queryKey: getGetPlatformSchoolSettlementQueryKey(schoolId), staleTime: 0, refetchOnMount: 'always' },
  });
  const [decision, setDecision] = useState<'VERIFY' | 'REJECT'>('VERIFY');
  const [evidence, setEvidence] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [confirmedSnapshot, setConfirmedSnapshot] = useState('');
  const [noteSnapshot, setNoteSnapshot] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const submission = useRef<{ payload: string; key: string } | null>(null);
  const inFlight = useRef(false);
  const p = query.data;
  const eligible = p && ['PENDING_VERIFICATION', 'ACTION_REQUIRED'].includes(p.status);
  const ready = eligible && !!p.reviewSnapshot && noteSnapshot === p.reviewSnapshot && reason.trim().length >= 20 &&
    (decision === 'REJECT' || (/^[a-f0-9]{64}$/.test(evidence) && confirmed && confirmedSnapshot === p.reviewSnapshot));
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready || inFlight.current || !p?.reviewSnapshot) return;
    const input = { decision, expectedSnapshot: p.reviewSnapshot, note: reason.trim(),
      ...(decision === 'VERIFY' ? { evidenceSha256: evidence, independentAccountMatchConfirmed: true } : {}) };
    const payload = JSON.stringify(input);
    if (submission.current?.payload !== payload) submission.current = { payload, key: crypto.randomUUID() };
    const key = submission.current.key;
    if (!window.confirm(decision === 'VERIFY'
      ? `Record ${schoolName}'s bank account as verified against the independent evidence you reviewed? This does not activate payments.`
      : `Reject ${schoolName}'s bank submission and request correction? No account or history will be deleted.`)) return;
    inFlight.current = true; setPending(true); setError('');
    try {
      const result = await reviewPlatformSchoolSettlement(schoolId, input, { headers: { 'Idempotency-Key': key } });
      const expectedStatus = decision === 'VERIFY' ? 'VERIFIED' : 'ACTION_REQUIRED';
      if (result.status !== expectedStatus) throw new Error('The saved status differs from this decision. Reload and check the audit history before retrying.');
      setSuccess(decision === 'VERIFY' ? 'Independent-evidence verification recorded with an audit trail. Payments remain unchanged.'
        : 'Rejection recorded with an audit trail. The school account now requires correction.');
      await qc.invalidateQueries({ predicate: q => typeof q.queryKey[0] === 'string' && /settlement/.test(q.queryKey[0]) });
    } catch {
      setError('The decision could not be confirmed. Refresh the details and check settlement history before changing the decision. An unchanged retry uses the same review key.');
    } finally { inFlight.current = false; setPending(false); }
  };
  return <Modal title={`Review ${schoolName}`} eyebrow="Owner bank decision" onClose={() => { if (!pending) onClose(); }}>
    {query.isLoading ? <SkeletonPage /> : query.isError || !p ? <div role="alert">The latest saved bank details could not load. <Button onClick={() => void query.refetch()}>Reload details</Button></div> :
      <div className="min-w-0 space-y-4 break-words">
        <dl className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2" data-testid="review-bank-profile">
          <div><dt>Business</dt><dd>{p.businessName || 'Not supplied'}</dd></div>
          <div><dt>Bank</dt><dd>{p.bankName || 'Not supplied'}</dd></div>
          <div><dt>Account holder</dt><dd>{p.accountName || 'Not supplied'}</dd></div>
          <div><dt>Account</dt><dd>{p.accountLast4 ? `Ending ${p.accountLast4}` : 'Not supplied'}</dd></div>
        </dl>
        <p className={note}>A merchant activation email, dashboard screenshot or subaccount permission does not verify this school’s account. Review an independent bank statement or account-resolution result and the school’s authority to use this beneficiary. Do not enter full account numbers or credentials here.</p>
        {success ? <p role="status">{success}</p> : <form onSubmit={save} className="space-y-4" data-testid="form-bank-review">
          {!eligible && <p role="status">This account is {p.status.replaceAll('_', ' ').toLowerCase()}. Only pending or action-required submissions can receive a decision here.</p>}
          {eligible && !p.reviewSnapshot && <p role="alert">A current review version is unavailable. Reload; the updated API must be deployed before a decision can be saved.</p>}
          {eligible && noteSnapshot && noteSnapshot !== p.reviewSnapshot && <p role="alert">The saved details changed. Review the current details, update the review note and confirm the match again before deciding.</p>}
          <Field label="Decision"><select className={entry} value={decision} disabled={pending} onChange={e => { setDecision(e.target.value as 'VERIFY' | 'REJECT'); setConfirmed(false); }} data-testid="review-decision">
            <option value="VERIFY">Verify against independent evidence</option><option value="REJECT">Reject and request correction</option>
          </select></Field>
          {decision === 'VERIFY' && <>
            <Field label="Independent evidence SHA-256"><input className={`${entry} font-mono`} value={evidence} maxLength={64} disabled={pending} onChange={e => { setEvidence(e.target.value.trim().toLowerCase()); setConfirmed(false); }} data-testid="review-evidence" /></Field>
            <label className="flex min-w-0 items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 p-0" checked={confirmed && confirmedSnapshot === p.reviewSnapshot} disabled={pending} onChange={e => { setConfirmed(e.target.checked); setConfirmedSnapshot(p.reviewSnapshot ?? ''); }} data-testid="review-confirm" /><span className="min-w-0 flex-1">I independently confirmed the submitted account and holder match, and this school is authorized to use the beneficiary.</span></label>
          </>}
          <Field label={decision === 'VERIFY' ? 'Evidence reviewed and conclusion (20–1,000 characters)' : 'Reason for rejection (20–1,000 characters)'}>
            <textarea className={entry} rows={4} minLength={20} maxLength={1000} value={reason} disabled={pending} onChange={e => { setReason(e.target.value); setNoteSnapshot(p.reviewSnapshot ?? ''); }} data-testid="review-note" />
          </Field>
          <p className={note}>{decision === 'VERIFY' ? 'Saving requires an evidence digest, explicit confirmation and a review note.' : 'Rejection preserves the profile and history and sets Action required; it does not delete the account.'}</p>
          {error && <p role="alert">{error} <button type="button" className="underline" disabled={pending} onClick={() => void query.refetch()}>Refresh details</button></p>}
          <div className="flex flex-wrap gap-3"><Button type="submit" disabled={!ready || pending || !!success} testId="button-save-bank-review">{pending ? 'Recording decision…' : 'Record decision'}</Button><Button type="button" variant="quiet" disabled={pending} onClick={onClose}>Cancel</Button></div>
        </form>}
      </div>}
  </Modal>;
}
