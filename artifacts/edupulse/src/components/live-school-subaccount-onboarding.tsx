import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { LiveSchoolSubaccount } from '@workspace/api-client-react';
import { useGetAuthorizedContext, useGetLiveSchoolSubaccounts, getGetLiveSchoolSubaccountsQueryKey, submitLiveSchoolSubaccount, reviewLiveSchoolSubaccount } from '@workspace/api-client-react';
import { Button, ErrorState, Info, Modal, SkeletonPage } from '@/components/shared';
import { Freshness, Notice, entry, errMsg, note, FRESH_MS } from '@/pages/payroll-common';

export type LiveItem = LiveSchoolSubaccount;

export const BLOCKER_TEXT: Record<string, string> = {
  PRODUCTION_RUNTIME_REQUIRED: 'The server must run in production mode (NODE_ENV=production).',
  EXPLICIT_LIVE_MODE_REQUIRED: 'Set EDUCORE_FLUTTERWAVE_MODE to LIVE explicitly. There is no TEST fallback.',
  LIVE_ONBOARDING_ENABLEMENT_REQUIRED: 'Set EDUCORE_FLUTTERWAVE_LIVE_ONBOARDING_ENABLED to true. This release is separate from checkout and is off by default.',
  LIVE_ONBOARDING_RELEASE_APPROVAL_REQUIRED: 'Set EDUCORE_FLUTTERWAVE_ONBOARDING_RELEASE to the approved onboarding release identifier.',
  REVIEWED_MERCHANT_SCOPE_REQUIRED: 'Set EDUCORE_FLUTTERWAVE_MERCHANT_SCOPE to the reviewed merchant scope identifier.',
  DEDICATED_LIVE_CREDENTIAL_REQUIRED: 'A dedicated LIVE provider credential must be configured in FLUTTERWAVE_LIVE_SECRET_KEY by the deployment owner. Never paste it into this page.',
  MERCHANT_KYC_APPROVAL_REQUIRED: 'Merchant KYC approval must be confirmed (FLUTTERWAVE_KYC_APPROVED).',
  LIVE_SUBACCOUNT_API_PERMISSION_REQUIRED: 'LIVE subaccount API permission must be confirmed with the provider (FLUTTERWAVE_SUBACCOUNT_CREATION_CONFIRMED).',
  SUBACCOUNT_DEFAULT_SPLIT_POLICY_REVIEW_REQUIRED: 'Subaccount default split policy must be reviewed and confirmed (FLUTTERWAVE_SUBACCOUNT_DEFAULTS_CONFIRMED).',
  LIVE_WEBHOOK_BINDING_REQUIRED: 'A LIVE webhook verifier must be bound, with EDUCORE_FLUTTERWAVE_WEBHOOK_ENVIRONMENT set to LIVE.',
  DISTINCT_TEST_WEBHOOK_BINDING_REQUIRED: 'A TEST webhook verifier (FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH) must be configured and differ from the LIVE one.',
  REVIEWED_PUBLIC_APP_URL_REQUIRED: 'PUBLIC_APP_URL must be set to the reviewed production application URL.',
  LIVE_ONBOARDING_SCHEMA_APPROVAL_REQUIRED: 'The onboarding database schema has not been approved and applied on the target database. This is a separate approval step.',
  LIVE_ONBOARDING_TARGET_RELEASE_APPROVAL_REQUIRED: 'The onboarding release record for this merchant scope is not enabled and verified in the target database. This is separate from schema approval.',
  BANK_ENCRYPTION_CONFIGURATION_REQUIRED: 'The versioned payroll bank-encryption configuration must be available, including retained keys for saved profiles. The deployment owner must check PAYROLL_BANK_ENCRYPTION_ACTIVE_VERSION and its keyring. Never paste keys here.',
};
const BUSY = ['CREATING', 'CREATION_UNKNOWN', 'LIVE_VERIFIED'];
const blockerText = (c: string) => BLOCKER_TEXT[c] ?? `Prerequisite not met: ${c.replaceAll('_', ' ').toLowerCase()}.`;

const STATUS_TEXT: Record<string, string> = {
  SUBMITTED: 'Submitted, awaiting LIVE bank verification',
  BANK_VERIFIED: 'LIVE bank verified, awaiting Owner approval',
  ACTION_REQUIRED: 'Action required',
  STALE: 'Stale: saved details changed after submission; resubmit',
  REJECTED: 'Rejected before creation',
  CREATING: 'Creating at provider (in progress)',
  CREATION_UNKNOWN: 'Creation outcome unknown: recover by read-only lookup',
  LIVE_VERIFIED: 'LIVE_VERIFIED: provider subaccount read back',
};
const SHA = /^[a-f0-9]{64}$/i;
const EVIDENCE = [
  ['ownershipEvidenceSha256', 'Account ownership evidence SHA-256'],
  ['merchantEvidenceSha256', 'Merchant ownership evidence SHA-256'],
  ['feeBearerEvidenceSha256', 'Fee bearer evidence SHA-256'],
  ['splitPolicyEvidenceSha256', 'Split policy evidence SHA-256'],
] as const;
const CHECKS = [
  ['ownershipConfirmed', 'The bank account belongs to this school'],
  ['distinctFromPlatformAccountConfirmed', 'The account is distinct from the platform account'],
  ['merchantOwnershipConfirmed', 'The school is the merchant of record owner'],
  ['kycConfirmed', 'KYC has been completed for this school'],
] as const;

function Distinction() {
  return <p className={note} data-testid="live-distinction">This is the LIVE-only school subaccount workflow. It is separate from the generic bank account verification above, which may run in TEST mode and never creates a provider subaccount. There is no TEST fallback here.</p>;
}

function Card({ item, actions, owner }: { item: LiveItem; actions?: React.ReactNode; owner?: boolean }) {
  return <div className="space-y-3 p-4" data-testid={`live-item-${item.id}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-bold">{item.schoolName}</div>
      <span className="rounded border px-2 py-0.5 text-xs font-mono" data-testid={`live-status-${item.id}`}>{item.status}</span></div>
    <p className={note}>{STATUS_TEXT[item.status] ?? item.status}</p>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Info label="Bank" value={item.bankName} /><Info label="Account name" value={item.accountName} />
      <Info label="Account" value={<span className="font-mono" data-testid={`live-masked-${item.id}`}>{item.maskedAccount}</span>} />
      <Info label="Business" value={item.businessName} /><Info label="Contact email" value={item.businessEmail} /><Info label="Contact phone" value={item.businessPhone} />
      <Info label="Provider subaccount" value={item.providerSubaccountId ? (owner ? <span className="font-mono" data-testid={`live-provider-id-${item.id}`}>{item.providerSubaccountId}</span> : 'Read back from provider') : 'Not created'} />
      <Info label="Checkout" value={item.checkoutEnabled ? 'Enabled (separately gated)' : 'Not enabled'} />
    </div>
    {item.errorCode && <p role="alert" className="text-sm text-[hsl(var(--destructive))]" data-testid={`live-error-${item.id}`}>{item.errorCode}{item.providerHttpStatus ? ` (provider HTTP ${item.providerHttpStatus})` : ''}: {item.errorMessage ?? 'The server reported a problem.'}</p>}
    {item.status === 'LIVE_VERIFIED' && <p className={note}>LIVE_VERIFIED means the provider subaccount was read back. It does not mean checkout is enabled, funds settled, or any payment succeeded. Checkout remains separately gated.</p>}
    {item.status === 'LIVE_VERIFIED' && owner && item.providerSubaccountId && <p className={note}>The provider subaccount ID above is a public provider identifier, not a secret. Showing it does not enable checkout.</p>}
    {item.status === 'CREATION_UNKNOWN' && <p className={note}>Creation is never resent. Recovery only reads from the provider. If it stays ambiguous, escalate to reconciliation; do not create or enter subaccount IDs manually.</p>}
    {actions}
  </div>;
}

function useLive(schoolId: number | undefined, actor: string) {
  const ctx = useGetAuthorizedContext();
  const userId = ctx.data?.user?.id;
  const params = schoolId ? { schoolId } : undefined;
  const key = [...getGetLiveSchoolSubaccountsQueryKey(params), `user:${userId ?? 'unknown'}`, actor];
  const q = useGetLiveSchoolSubaccounts(params, { query: {
    queryKey: key, enabled: userId != null, staleTime: FRESH_MS,
    refetchInterval: (query: { state: { data?: { items?: LiveItem[] } } }) => query.state.data?.items?.some(i => i.status === 'CREATING') ? 5000 : FRESH_MS,
  } as never });
  return { q, key };
}

function Shell({ q, children, title }: { q: ReturnType<typeof useLive>['q']; children: React.ReactNode; title: string }) {
  const d = q.data;
  return <section className="panel mt-6 p-6" data-testid="live-onboarding">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="display-font text-xl font-bold">{title}</h2>
      <Freshness updatedAt={q.dataUpdatedAt} fetching={q.isFetching} onRefresh={() => q.refetch()} /></div>
    <Distinction />
    {q.isLoading ? <SkeletonPage /> : q.isError || !d ? <ErrorState retry={() => q.refetch()} /> : <>
      {!d.ready && <div className="my-3 rounded border p-3" data-testid="live-blockers"><div className="mb-1 text-sm font-bold">Prerequisites not met</div>
        <ul className="list-disc pl-5 text-sm">{d.blockers.map(b => <li key={b} data-testid={`blocker-${b}`}>{blockerText(b)}</li>)}</ul></div>}
      {children}
    </>}
  </section>;
}

export function SchoolLiveOnboarding({ schoolId }: { schoolId: number }) {
  const qc = useQueryClient();
  const { q, key } = useLive(schoolId, `admin:${schoolId}`);
  const [msg, setMsg] = useState(''); const [fail, setFail] = useState('');
  const submit = useMutation({ mutationFn: () => submitLiveSchoolSubaccount(schoolId) });
  const d = q.data;
  const existingBusy = !!d?.items.some(i => BUSY.includes(i.status));
  const run = async () => {
    setMsg(''); setFail('');
    try {
      const r = await submit.mutateAsync() as LiveItem;
      if (r.status === 'ACTION_REQUIRED') setFail(`Bank verification needs action${r.errorCode ? ` (${r.errorCode})` : ''}: ${r.errorMessage ?? 'review the saved bank details and submit again.'}`);
      else if (r.status === 'BANK_VERIFIED') setMsg('LIVE bank verification passed. Owner approval is still required; no provider subaccount is created by this step.');
      else setMsg(`Submission recorded with status ${r.status}. No provider subaccount is created by this step.`);
    }
    catch (e) { setFail(errMsg(e)); }
    finally { qc.invalidateQueries({ queryKey: key }); }
  };
  return <Shell q={q} title="LIVE collection subaccount onboarding">
    {msg && <Notice kind="ok" onClose={() => setMsg('')}>{msg}</Notice>}{fail && <Notice kind="error" onClose={() => setFail('')}>{fail}</Notice>}
    <p className={note}>Submitting freezes the currently saved school profile (shown masked) for independent LIVE bank verification. Account details cannot be edited here. Checkout stays separately gated.</p>
    <div className="my-3"><Button onClick={run} disabled={submit.isPending || !d?.ready || existingBusy} testId="button-submit-live-onboarding">{submit.isPending ? 'Submitting...' : 'Submit saved school details for LIVE verification'}</Button></div>
    {existingBusy && <p className={note} data-testid="live-submit-locked">A subaccount creation is already claimed or verified for this school. Resubmission is disabled; any recovery or replacement requires Owner review.</p>}
    {d && !d.items.length ? <p className={note} data-testid="live-empty">No LIVE submission yet for this school.</p> :
      <div className="divide-y divide-[hsl(var(--border))]">{d?.items.map(i => <Card key={i.id} item={i} />)}</div>}
  </Shell>;
}

type Form = { note: string; ownershipConfirmed: boolean; distinctFromPlatformAccountConfirmed: boolean; merchantOwnershipConfirmed: boolean; kycConfirmed: boolean; ownershipEvidenceSha256: string; merchantEvidenceSha256: string; feeBearerEvidenceSha256: string; splitPolicyEvidenceSha256: string };
const blank: Form = { note: '', ownershipConfirmed: false, distinctFromPlatformAccountConfirmed: false, merchantOwnershipConfirmed: false, kycConfirmed: false, ownershipEvidenceSha256: '', merchantEvidenceSha256: '', feeBearerEvidenceSha256: '', splitPolicyEvidenceSha256: '' };

function ApproveModal({ item, busy, error, onSubmit, onClose }: { item: LiveItem; busy: boolean; error: string; onSubmit: (b: Record<string, unknown>) => void; onClose: () => void }) {
  const [f, setF] = useState<Form>(blank);
  const [tried, setTried] = useState(false);
  const problems: string[] = [];
  if (f.note.trim().length < 10) problems.push('Note must be at least 10 characters.');
  CHECKS.forEach(([k, l]) => { if (!f[k]) problems.push(`Confirm: ${l}.`); });
  EVIDENCE.forEach(([k, l]) => { if (!SHA.test(f[k].trim())) problems.push(`${l} must be 64 hex characters.`); });
  const go = () => {
    setTried(true); if (problems.length) return;
    const { note: n, ...rest } = f;
    const ev = Object.fromEntries(EVIDENCE.map(([k]) => [k, f[k].trim().toLowerCase()]));
    onSubmit({ action: 'APPROVE_AND_CREATE', note: n.trim(), ownershipConfirmed: true, distinctFromPlatformAccountConfirmed: true, merchantOwnershipConfirmed: true, kycConfirmed: true, feeBearer: 'MERCHANT', ...ev, ...(rest ? {} : {}) });
  };
  return <Modal title={`Approve ${item.schoolName}`} eyebrow="LIVE subaccount creation" onClose={onClose}>
    <div className="space-y-3" data-testid="form-live-approve">
      <p className={note}>Approval creates one real LIVE provider subaccount for {item.accountName} at {item.bankName} ({item.maskedAccount}). Paste document commitments (SHA-256 hashes) only; never secrets or full account numbers.</p>
      {error && <Notice kind="error">{error}</Notice>}
      {CHECKS.map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f[k]} onChange={e => setF(s => ({ ...s, [k]: e.target.checked }))} data-testid={`check-${k}`} />{l}</label>)}
      <p className={note}>Fee bearer: MERCHANT (fixed).</p>
      {EVIDENCE.map(([k, l]) => <label key={k} className="block text-sm">{l}<input className={`${entry} font-mono`} value={f[k]} onChange={e => setF(s => ({ ...s, [k]: e.target.value }))} data-testid={`input-${k}`} /></label>)}
      <label className="block text-sm">Review note (10+ characters)<textarea className={entry} value={f.note} onChange={e => setF(s => ({ ...s, note: e.target.value }))} data-testid="input-live-note" maxLength={1000} /></label>
      {tried && problems.length > 0 && <ul role="alert" className="list-disc pl-5 text-sm text-[hsl(var(--destructive))]" data-testid="live-validation">{problems.map(p => <li key={p}>{p}</li>)}</ul>}
      <div className="flex gap-2"><Button onClick={go} disabled={busy} testId="button-live-approve-confirm">{busy ? 'Creating...' : 'Approve and create LIVE subaccount'}</Button><Button variant="quiet" onClick={onClose}>Cancel</Button></div>
    </div></Modal>;
}

function NoteModal({ title, label, busy, error, cta, onSubmit, onClose }: { title: string; label: string; busy: boolean; error: string; cta: string; onSubmit: (n: string) => void; onClose: () => void }) {
  const [n, setN] = useState('');
  return <Modal title={title} eyebrow="LIVE subaccount review" onClose={onClose}><div className="space-y-3">
    <p className={note}>{label}</p>{error && <Notice kind="error">{error}</Notice>}
    <textarea className={entry} value={n} onChange={e => setN(e.target.value)} maxLength={1000} aria-label="Review note" data-testid="input-live-action-note" />
    <div className="flex gap-2"><Button onClick={() => onSubmit(n.trim())} disabled={busy || n.trim().length < 10} testId="button-live-action-confirm">{busy ? 'Working...' : cta}</Button><Button variant="quiet" onClick={onClose}>Cancel</Button></div></div></Modal>;
}

export function OwnerLiveOnboarding() {
  const qc = useQueryClient();
  const [filterText, setFilterText] = useState(''); const [filterId, setFilterId] = useState<number | undefined>();
  const { q, key } = useLive(filterId, 'owner');
  const [msg, setMsg] = useState(''); const [fail, setFail] = useState('');
  const [dlg, setDlg] = useState<{ kind: 'approve' | 'recover' | 'reject'; item: LiveItem } | null>(null);
  const [dlgErr, setDlgErr] = useState('');
  const review = useMutation({ mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) => reviewLiveSchoolSubaccount(id, body as never) });
  const d = q.data;
  const send = async (item: LiveItem, body: Record<string, unknown>) => {
    setDlgErr(''); setFail('');
    try {
      const r = await review.mutateAsync({ id: item.id, body }) as LiveItem;
      setDlg(null); setMsg(`${item.schoolName}: status ${r.status}. Checkout remains separately gated.`);
    } catch (e) { setDlgErr(errMsg(e)); }
    finally { qc.invalidateQueries({ queryKey: key }); }
  };
  const act = (i: LiveItem) => {
    const lock = review.isPending || !d?.ready;
    const canReject = ['SUBMITTED', 'BANK_VERIFIED', 'ACTION_REQUIRED'].includes(i.status);
    return <div className="flex flex-wrap gap-2">
      {i.canApprove && <Button onClick={() => { setDlgErr(''); setDlg({ kind: 'approve', item: i }); }} disabled={lock} testId={`button-live-approve-${i.id}`}>Review and approve</Button>}
      {i.canRecover && <Button variant="outline" onClick={() => { setDlgErr(''); setDlg({ kind: 'recover', item: i }); }} disabled={lock} testId={`button-live-recover-${i.id}`}>Recover from provider (read only)</Button>}
      {canReject && <Button variant="quiet" onClick={() => { setDlgErr(''); setDlg({ kind: 'reject', item: i }); }} disabled={lock} testId={`button-live-reject-${i.id}`}>Reject</Button>}
    </div>;
  };
  return <Shell q={q} title="LIVE school subaccount requests">
    {msg && <Notice kind="ok" onClose={() => setMsg('')}>{msg}</Notice>}{fail && <Notice kind="error" onClose={() => setFail('')}>{fail}</Notice>}
    <form className="mb-3 flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); const n = Number(filterText.trim()); setFilterId(filterText.trim() && Number.isInteger(n) && n > 0 ? n : undefined); }}>
      <input className={`${entry} max-w-[180px]`} inputMode="numeric" placeholder="School ID" aria-label="Filter by school ID" value={filterText} onChange={e => setFilterText(e.target.value)} data-testid="input-live-school-filter" />
      <Button type="submit" variant="outline" testId="button-live-school-filter">Filter</Button>
      {filterId && <Button variant="quiet" onClick={() => { setFilterText(''); setFilterId(undefined); }}>Clear</Button>}
    </form>
    <p className={note} data-testid="live-list-scope">{filterId ? `Showing requests for school ID ${filterId}.` : `Showing the newest 200 requests only${d && d.items.length >= 200 ? ' (limit reached; older requests are hidden)' : ''}. Filter by school ID to find a specific school.`}</p>
    {d && !d.items.length ? <p className={note} data-testid="live-empty">No schools have submitted LIVE onboarding requests.</p> :
      <div className="divide-y divide-[hsl(var(--border))]">{d?.items.map(i => <Card key={i.id} item={i} owner actions={act(i)} />)}</div>}
    {dlg?.kind === 'approve' && <ApproveModal item={dlg.item} busy={review.isPending} error={dlgErr} onClose={() => setDlg(null)} onSubmit={b => send(dlg.item, b)} />}
    {dlg?.kind === 'recover' && <NoteModal title={`Recover ${dlg.item.schoolName}`} label="Performs a read-only provider lookup. It never resends creation." cta="Run read-only recovery" busy={review.isPending} error={dlgErr} onClose={() => setDlg(null)} onSubmit={n => send(dlg.item, { action: 'RECOVER', note: n })} />}
    {dlg?.kind === 'reject' && <NoteModal title={`Reject ${dlg.item.schoolName}`} label="Rejection is only available before any provider creation." cta="Reject request" busy={review.isPending} error={dlgErr} onClose={() => setDlg(null)} onSubmit={n => send(dlg.item, { action: 'REJECT', note: n })} />}
  </Shell>;
}
