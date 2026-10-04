import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { CreditCard, RefreshCw } from 'lucide-react';
import {
  useGetAuthorizedContext, useListCards, getListCardsQueryKey,
  useListCardReplacements, getListCardReplacementsQueryKey, useRequestCardReplacement, useIssueCardReplacement,
  useVerifyCardReplacementPayment, useInitializeFeeProviderPayment,
} from '@workspace/api-client-react';
import { PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, TenantPicker, useTenant, Field } from '@/components/shared';
import {
  REPLACEMENT_FEE_MINOR, formatNairaMinor, replacementPermissions, canIssueRequest, replacementStatusLabel,
  preparedUnassignedCards, idempotencyKeyFor,
} from './card-replacements-model';

const errText = (e: unknown) => {
  const x = e as any;
  return x?.data?.error ?? x?.response?.data?.error ?? (e instanceof Error ? e.message : 'The request failed.');
};

function RequestRow({ req, actor, perms, schoolId }: { req: any; actor: any; perms: ReturnType<typeof replacementPermissions>; schoolId: number }) {
  const qc = useQueryClient();
  const [uid, setUid] = useState('');
  const [txn, setTxn] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const checkout = useInitializeFeeProviderPayment({ request: { headers: { 'Idempotency-Key': idempotencyKeyFor(req.id) } } });
  const verify = useVerifyCardReplacementPayment();
  const issue = useIssueCardReplacement();
  const cardsQuery = useListCards({ schoolId: req.schoolId }, { query: { enabled: canIssueRequest(req, actor), queryKey: getListCardsQueryKey({ schoolId: req.schoolId }) } });
  const prepared = preparedUnassignedCards((cardsQuery.data ?? []) as any[]);
  const refresh = () => { qc.invalidateQueries({ queryKey: getListCardReplacementsQueryKey() }); qc.invalidateQueries({ queryKey: getListCardsQueryKey() }); };
  const pay = async () => {
    setErr(''); setMsg('');
    try {
      const r: any = await checkout.mutateAsync({ invoiceId: req.invoiceId, provider: 'FLUTTERWAVE', data: { amountMinor: REPLACEMENT_FEE_MINOR } } as any);
      const url = new URL(r.checkoutUrl);
      if (url.protocol !== 'https:') throw new Error('The provider did not return a secure checkout address.');
      window.location.assign(url.href);
    } catch (e) { setErr(errText(e)); }
  };
  const doVerify = () => verify.mutate({ requestId: req.id, data: { providerTransactionId: txn.trim() } }, {
    onSuccess: result => { setMsg(result.paymentStatus === 'PAID' ? 'Payment verified.' : 'Payment is not yet confirmed as successful. Issuance remains blocked.'); setErr(''); refresh(); },
    onError: e => { setErr(errText(e)); },
  });
  const doIssue = () => issue.mutate({ requestId: req.id, data: { uid } }, {
    onSuccess: () => { setMsg('Replacement card issued.'); setErr(''); setUid(''); refresh(); },
    onError: e => { setErr(errText(e)); },
  });
  return <div className="border-b border-[hsl(var(--border)/.6)] p-5 last:border-0" data-testid={`row-replacement-${req.id}`}>
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="font-bold">{req.studentName}</div>
        <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Request #{req.id} · old card #{req.oldCardId}{req.newCardId ? ` · new card #${req.newCardId}` : ''} · {new Date(req.createdAt).toLocaleDateString('en-NG')}</div>
      </div>
      <span className="text-sm font-bold" data-testid={`text-replacement-amount-${req.id}`}>{formatNairaMinor(req.amountMinor)}</span>
      <StatusPill value={req.paymentStatus} />
      <StatusPill value={req.status} />
    </div>
    <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]" data-testid={`text-replacement-state-${req.id}`}>{replacementStatusLabel(req)}</p>
    {req.paymentStatus === 'UNPAID' && perms.canPay && <div className="mt-3 space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={pay} disabled={checkout.isPending} testId={`button-pay-replacement-${req.id}`}><CreditCard size={15} />{checkout.isPending ? 'Opening checkout...' : `Pay ${formatNairaMinor(REPLACEMENT_FEE_MINOR)} with Flutterwave`}</Button>
        <Link href={`/parent/fees/${req.studentId}`} className="inline-flex items-center text-xs font-bold text-[hsl(var(--primary))] underline" data-testid={`link-replacement-fees-${req.id}`}>Open fees page</Link>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Provider transaction ID (after checkout)"><input value={txn} onChange={e => setTxn(e.target.value)} data-testid={`input-transaction-${req.id}`} /></Field>
        <Button variant="outline" onClick={doVerify} disabled={!txn.trim() || verify.isPending} testId={`button-verify-replacement-${req.id}`}>{verify.isPending ? 'Verifying...' : 'Verify payment'}</Button>
      </div>
    </div>}
    {req.paymentStatus === 'UNPAID' && !perms.canPay && <p className="mt-2 text-xs font-semibold" data-testid={`text-unpaid-gate-${req.id}`}>Issuance is blocked until the parent pays and the payment is verified.</p>}
    {canIssueRequest(req, actor) && <div className="mt-3 flex flex-wrap items-end gap-2">
      <Field label="Prepared unassigned card">
        <select value={uid} onChange={e => setUid(e.target.value)} data-testid={`select-new-card-${req.id}`}>
          <option value="">{cardsQuery.isLoading ? 'Loading cards...' : prepared.length ? 'Select a card UID' : 'No prepared unassigned cards'}</option>
          {prepared.map((c: any) => <option key={c.id} value={c.uid}>{c.uid}</option>)}
        </select>
      </Field>
      <Button onClick={doIssue} disabled={!uid || issue.isPending} testId={`button-issue-replacement-${req.id}`}>{issue.isPending ? 'Issuing...' : 'Issue replacement'}</Button>
    </div>}
    {msg && <p role="status" className="mt-2 text-sm font-semibold text-emerald-600">{msg}</p>}
    {err && <p role="alert" className="mt-2 text-sm font-semibold text-[hsl(var(--destructive))]">{err}</p>}
    <span className="hidden">{schoolId}</span>
  </div>;
}

export function CardReplacementsPage() {
  const { schoolId } = useTenant();
  const ctx = useGetAuthorizedContext().data;
  const qc = useQueryClient();
  const actor = { owner: ctx?.isPlatformOwner === true, roles: (ctx?.roles ?? []).filter(r => r.status === 'ACTIVE').map(r => String(r.role)) };
  const perms = replacementPermissions(actor);
  const params = schoolId ? { schoolId } : undefined;
  const query = useListCardReplacements(params, { query: { queryKey: getListCardReplacementsQueryKey(params), staleTime: 15_000, refetchInterval: 30_000, refetchOnWindowFocus: true } });
  const request = useRequestCardReplacement();
  const [cardId, setCardId] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const requests = query.data?.requests ?? [];
  const cards = query.data?.cards ?? [];
  const submit = () => request.mutate({ data: { cardId: Number(cardId), reason: reason.trim() } }, {
    onSuccess: () => { setCardId(''); setReason(''); setErr(''); qc.invalidateQueries({ queryKey: getListCardReplacementsQueryKey() }); qc.invalidateQueries({ queryKey: getListCardsQueryKey() }); },
    onError: e => setErr(errText(e)),
  });
  return <div className="fade-up">
    <PageHeading eyebrow="Security / NFC Cards" title="Card Replacements" description={`A replacement card costs ${formatNairaMinor(REPLACEMENT_FEE_MINOR)}. Requesting reports the old card lost. Only the platform Owner issues the new card, after payment is verified.`}
      action={<div className="flex gap-3">{actor.owner && <TenantPicker />}<Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching} testId="button-refresh-replacements"><RefreshCw size={15} />Refresh</Button></div>} />
    {ctx && !perms.canView ? <div className="panel p-8" role="alert">Card replacements are not available for your role.</div> :
    query.isLoading ? <SkeletonPage /> : query.isError ? <ErrorState retry={() => query.refetch()} message={errText(query.error)} /> : <>
      {perms.canRequest && <div className="panel mb-6 p-5">
        <h2 className="display-font text-lg font-bold">Request a replacement</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_2fr_auto] md:items-end">
          <Field label="Card"><select value={cardId} onChange={e => setCardId(e.target.value)} data-testid="select-replacement-card"><option value="">{cards.length ? 'Select a card' : 'No eligible cards'}</option>{cards.map(c => <option key={c.id} value={c.id}>{c.studentName} · {c.status}</option>)}</select></Field>
          <Field label="Reason"><input value={reason} maxLength={500} onChange={e => setReason(e.target.value)} data-testid="input-replacement-reason" /></Field>
          <Button onClick={submit} disabled={!cardId || reason.trim().length < 3 || request.isPending} testId="button-request-replacement">{request.isPending ? 'Requesting...' : `Request (${formatNairaMinor(REPLACEMENT_FEE_MINOR)})`}</Button>
        </div>
        {err && <p role="alert" className="mt-3 text-sm font-semibold text-[hsl(var(--destructive))]">{err}</p>}
      </div>}
      <div className="panel overflow-hidden">
        {requests.length ? requests.map(r => <RequestRow key={r.id} req={r} actor={actor} perms={perms} schoolId={schoolId} />)
          : <EmptyState icon={CreditCard} title="No replacement requests" description="Requests and their persisted payment and issuance status appear here." />}
      </div>
    </>}
  </div>;
}
export default CardReplacementsPage;
