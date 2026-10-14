import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { FlaskConical } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetLocalFlutterwaveSplitSimulation, getGetLocalFlutterwaveSplitSimulationQueryKey,
  useRunLocalFlutterwaveSplitSimulation,
} from '@workspace/api-client-react';
import type { LocalFlutterwaveSplitSimulationInput } from '@workspace/api-client-react';
import { PageHeading, Button, SkeletonPage, EmptyState, ErrorState, money } from '@/components/shared';
import { LocalSplitSimulationReview } from './local-split-simulation-review';

/** Separate screen: no operational recipient/configuration/checkout mutation hooks. */
export function FlutterwaveSplitSimulationPage() {
  const { userId, isLoaded } = useAuth();
  const qc = useQueryClient();
  const key = [...getGetLocalFlutterwaveSplitSimulationQueryKey(),userId];
  const preview = useGetLocalFlutterwaveSplitSimulation({query:{
    queryKey:key,enabled:isLoaded && !!userId,retry:false,refetchOnMount:'always',
  }});
  const action = useRunLocalFlutterwaveSplitSimulation();
  const [ackFor, setAckFor] = useState<string | null>(null);
  const acknowledged = !!userId && ackFor === userId;
  const [reviewFor, setReviewFor] = useState<string | null>(null);
  const reviewOpen = !!userId && reviewFor === userId;
  const reviewTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { setReviewFor(null); }, [userId]);
  const [error, setError] = useState<{userId:string|null|undefined;text:string}|null>(null);
  const heading = <PageHeading eyebrow="Development simulation — TEST / NOT REAL" title="TEST / NOT REAL — no-partner split simulation"
    description="Fictional in-memory workflow only. Does not change school 1496 or prove any provider allocation." />;
  const run = (value:LocalFlutterwaveSplitSimulationInput['action']) => {
    if (!userId || action.isPending) return;
    setError(null);
    action.mutate({data:{mode:'LOCAL_SPLIT_SIMULATION',exampleSchoolId:1496,action:value,acknowledgeFictional:acknowledged}},{
      onSuccess: data => {
        qc.setQueryData(key,data);
        if (value==='RESET' || value==='DISABLE') setAckFor(null);
        if (value==='RESET') setReviewFor(null);
      },
      onError: () => setError({userId,text:'TEST / NOT REAL action failed. No operational settings were changed; do not assume simulation enablement succeeded.'}),
    });
  };
  if (!isLoaded || preview.isLoading) return <div>{heading}<SkeletonPage /></div>;
  if (!userId) return <div>{heading}<EmptyState icon={FlaskConical} title="TEST / NOT REAL — sign in required" description="Active Owner access is required." /></div>;
  if (preview.isError || !preview.data) return <div>{heading}<ErrorState message="TEST / NOT REAL simulation unavailable. Development and active Owner access are required." retry={()=>void preview.refetch()} /></div>;
  const d = preview.data;
  // Fail closed even if an API/cache response is malformed or optimistic.
  if (d.mode!=='LOCAL_SPLIT_SIMULATION' || d.label!=='TEST / NOT REAL'
      || d.recipientState!=='LOCAL_ONLY_UNVERIFIED' || d.operationalEnabled!==false || d.testReady!==false
      || d.providerVerified!==false || d.ownershipVerified!==false || d.checkoutAllowed!==false
      || d.webhooksAllowed!==false || d.allocationProven!==false || d.bankSettlementVerified!==false
      || d.providerFeesIncluded!==false || d.noPartner!==true
      || d.simulationTotalMinor!==500000 || d.simulationSchoolMinor!==200000 || d.simulationPlatformGrossMinor!==300000) {
    return <div>{heading}<ErrorState message="TEST / NOT REAL safety contract rejected. No operational action is available." retry={()=>void preview.refetch()} /></div>;
  }
  return <div key={userId} className="space-y-5">
    {heading}
    <div role="status" className="panel border-2 border-amber-500 p-5">
      <strong>TEST / NOT REAL — LOCAL ONLY — UNVERIFIED</strong>
      <p className="mt-2 text-sm">{d.notice}</p>
    </div>
    {error?.userId===userId && <p role="alert">{error?.text}</p>}
    <section className="panel min-w-0 space-y-2 p-5 [overflow-wrap:anywhere]" data-testid="simulation-fixture">
      <h2 className="font-bold">TEST / NOT REAL fictional recipient</h2>
      <p>Example school ID 1496 — {d.exampleSchoolName}. This is a label, not a saved association.</p>
      <dl className="space-y-1 text-sm">
        <dt>Fictional business — TEST / NOT REAL</dt><dd>{d.fictionalBusiness}</dd>
        <dt>Fictional contact — TEST / NOT REAL</dt><dd>{d.fictionalContact} · {d.fictionalPhone}</dd>
        <dt>Fictional bank/account — TEST / NOT REAL</dt><dd>{d.fictionalBank} · {d.fictionalBankCode} · {d.fictionalAccount}</dd>
      </dl>
      <p className="text-sm">State: LOCAL_ONLY_UNVERIFIED. Never TEST_READY. No ownership or provider verification.</p>
    </section>
    <section className="panel space-y-3 p-5" data-testid="simulation-split">
      <h2 className="font-bold">TEST / NOT REAL — simulated no-partner amounts</h2>
      <p>Total {money(d.simulationTotalMinor/100)} · School {money(d.simulationSchoolMinor/100)} · Yetenia platform gross {money(d.simulationPlatformGrossMinor/100)}</p>
      <p>Provider fees are excluded. Platform net is not calculated. No real allocation or settlement is proven.</p>
      <p data-testid="simulation-state">TEST / NOT REAL simulated switch: {d.simulatedEnabled?'ON':'OFF'}. Operational split settings: unchanged.</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={acknowledged}
        disabled={action.isPending} onChange={e=>setAckFor(e.target.checked?userId:null)} data-testid="simulation-ack" />
        I understand this is TEST / NOT REAL, not ownership review, provider verification or permission to pay.</label>
      <div className="flex flex-wrap gap-2">
        <button type="button" ref={reviewTrigger} disabled={action.isPending || !acknowledged}
          aria-expanded={reviewOpen} aria-controls="simulation-review-panel" data-testid="simulation-review"
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-bold text-[hsl(var(--primary-foreground))] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          onClick={event => { event.preventDefault(); event.stopPropagation(); setReviewFor(userId); }}>
          Review fictional fixture — TEST / NOT REAL
        </button>
        <Button type="button" disabled={action.isPending || !acknowledged || !d.reviewedForSimulation} onClick={()=>run('ENABLE')} testId="simulation-enable">Enable simulation only — TEST / NOT REAL</Button>
        <Button type="button" variant="outline" disabled={action.isPending || !d.simulatedEnabled} onClick={()=>run('DISABLE')} testId="simulation-disable">Disable simulation — TEST / NOT REAL</Button>
        <Button type="button" variant="outline" disabled={action.isPending} onClick={()=>run('RESET')} testId="simulation-reset">Reset local preview — TEST / NOT REAL</Button>
      </div>
      {reviewOpen && <LocalSplitSimulationReview fixture={d} pending={action.isPending} acknowledged={acknowledged}
        onConfirm={()=>run('REVIEW')}
        onClose={()=>{ setReviewFor(null); reviewTrigger.current?.focus(); }} />}
      {action.isPending && <p role="status">TEST / NOT REAL — processing local simulation action only…</p>}
      <p>No checkout, payment, webhook or recipient-promotion action exists here. Refresh resets the preview; nothing is saved.</p>
    </section>
  </div>;
}
