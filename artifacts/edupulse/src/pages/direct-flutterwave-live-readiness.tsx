import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import {AdvanceSubscriptionAuthorizationPanel} from '../components/advance-subscription-authorization';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CircleSlash, FileClock, Lock, ShieldCheck } from 'lucide-react';
import {
  useGetAuthorizedContext, useGetNfcFeeCollectionFilterOptions, getGetNfcFeeCollectionFilterOptionsQueryKey,
  useGetOwnerSubscriptionPaymentRules, getGetOwnerSubscriptionPaymentRulesQueryKey,
  useGetDirectLiveReleaseReadiness, getGetDirectLiveReleaseReadinessQueryKey,
  useListDirectLiveReleaseReviews, getListDirectLiveReleaseReviewsQueryKey,
  useCreateDirectLiveReleaseReview, useDecideDirectLiveReleaseReview,
} from '@workspace/api-client-react';
import type { DirectReleaseReadiness, DirectReleaseReview, DirectReleaseDecisionInputAction } from '@workspace/api-client-react';
import { Button, PageHeading, cx } from '@/components/shared';
import { hasActiveGlobalOwner } from '@/components/navigation-model';
import { entry, note, FRESH_MS } from '@/pages/payroll-common';
import {PilotCalendarReadiness} from "@/components/pilot-calendar-readiness";
import { GuidedSteps, groupReadiness } from '@/components/owner-guided-steps';
import {PaymentReadinessGuidance} from "@/components/payment-readiness-guidance";

export const POLICY = 'NEW_ONLY_PRESERVE_LEGACY';
export const PLATFORM_AMOUNT_MINOR = 320000;
const SCHEMA_NOT_VERIFIED = 'Required review schema, permissions or history guards have not passed verification.';
const ELIGIBLE_RULE_STATUSES = ['DRAFT', 'SCHEDULED', 'ACTIVE'];
const OK = new Set(['READY', 'PASS', 'PASSED', 'OK', 'COMPLETE']);
/** Checks that are expected to remain open at approval time; they gate the separate operational switch. */
export const APPROVAL_EXEMPT = new Set(['NON_SPLIT_EVIDENCE', 'RUNTIME_SWITCH']);

type Proposal = { id: number; product: string; status: string; amountMinor: number; currency?: string; effectiveAt: string; endsAt: string | null; version: number; schoolShareMinor?: number };
type Scope = { schoolId: number; termId: number; ruleId: number };

export const isEligibleProposal = (p: Proposal) => p.product === 'STUDENT_PLATFORM' && p.amountMinor === PLATFORM_AMOUNT_MINOR
  && p.currency === 'NGN' && p.schoolShareMinor === 0
  && ELIGIBLE_RULE_STATUSES.includes(String(p.status).toUpperCase());

export function approvalBlockers(r: DirectReleaseReadiness | undefined): string[] {
  if (!r) return ['Readiness has not loaded.'];
  const out = r.checks.filter(c => !APPROVAL_EXEMPT.has(c.code) && !OK.has(String(c.status).toUpperCase())).map(c => `${c.label}: ${c.detail}`);
  if (!r.schemaReady) out.unshift(`${SCHEMA_NOT_VERIFIED} No review can be created.`);
  if (!r.approvalReady) out.push('Server reports approval is not ready for this scope.');
  return out;
}

export const validHash = (v: string) => /^[0-9a-f]{64}$/.test(v);
export function validExpiry(v: string, now = Date.now()) {
  const t = new Date(v).getTime();
  return Number.isFinite(t) && t > now && t <= now + 7 * 864e5;
}
const short = (d?: string | null) => d ? `${d.slice(0, 12)}…${d.slice(-6)}` : 'not available';
const when = (d?: string | null) => { if (!d) return 'not set'; const t = new Date(d); return Number.isNaN(t.getTime()) ? d : t.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }); };
export const errText = (e: unknown) => {
  const d = (e as { data?: { error?: string; message?: string; code?: string } } | null)?.data;
  return d?.message ?? d?.error ?? d?.code ?? (e instanceof Error ? e.message : 'The request could not be completed.');
};

export function OperationalSwitchWarning() {
  return <div role="note" className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 text-sm text-amber-950" data-testid="warning-operational-switch">
    <div className="mb-1 flex items-center gap-2 font-bold"><Lock size={16} /> Independent operational switch</div>
    <p>Readiness complete or an approval recorded here NEVER initiates a payment and NEVER enables LIVE checkout. Approval only schedules a Draft Student rule from its own effective date. Runtime settings and staff billing are not changed. The LIVE switch is a separate, independently controlled operation.</p>
  </div>;
}

function Tone({ status }: { status: string }) {
  const s = status.toUpperCase();
  const cls = OK.has(s) || s === 'APPROVED' ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
    : s === 'REJECTED' || s === 'EXPIRED' || s === 'BLOCKED' || s === 'FAILED' ? 'border-rose-300 bg-rose-50 text-rose-800'
    : 'border-amber-300 bg-amber-50 text-amber-900';
  return <span className={cx('inline-flex rounded-md border px-2 py-0.5 font-mono text-[11px] font-bold', cls)} data-testid={`badge-${s.toLowerCase()}`}>{s}</span>;
}

function Fact({ k, v, testId }: { k: string; v: ReactNode; testId?: string }) {
  return <div className="flex flex-col gap-0.5 border-b border-[hsl(var(--border))] py-2 sm:flex-row sm:gap-4">
    <dt className="eyebrow w-48 shrink-0">{k}</dt><dd className="min-w-0 break-all font-mono text-xs" data-testid={testId}>{v}</dd>
  </div>;
}

export function DirectFlutterwaveLiveReadinessPage() {
  const ctx = useGetAuthorizedContext();
  const owner = hasActiveGlobalOwner(ctx.data);
  const actor = ctx.data?.user?.id ?? null;
  if (ctx.isLoading) return <div role="status" className="p-8">Verifying Owner access…</div>;
  if (!owner || actor == null) return <div className="panel p-8" data-testid="direct-live-denied">
    <h1 className="display-font text-2xl font-bold">Owner access required</h1>
    <p className={note}>Only an active global Platform Owner can review Direct Flutterwave LIVE readiness. Nothing was loaded.</p>
  </div>;
  return <OwnerWorkspace actor={actor} />;
}

function OwnerWorkspace({ actor }: { actor: number }) {
  const [schoolId, setSchoolId] = useState('');
  const [termId, setTermId] = useState('');
  const [ruleId, setRuleId] = useState('');
  const tag = `actor:${actor}`;
  const catalog = useGetNfcFeeCollectionFilterOptions({}, { query: {
    queryKey: [...getGetNfcFeeCollectionFilterOptionsQueryKey({}), tag], staleTime: FRESH_MS, retry: false, refetchOnWindowFocus: false } });
  const termParams = schoolId ? { schoolId: Number(schoolId) } : {};
  const terms = useGetNfcFeeCollectionFilterOptions(termParams, { query: {
    queryKey: [...getGetNfcFeeCollectionFilterOptionsQueryKey(termParams), tag], enabled: !!schoolId, staleTime: FRESH_MS, retry: false, refetchOnWindowFocus: false } });
  const rules = useGetOwnerSubscriptionPaymentRules({ query: {
    queryKey: [...getGetOwnerSubscriptionPaymentRulesQueryKey(), 'actor', actor], staleTime: FRESH_MS, retry: false, refetchOnWindowFocus: false } });
  const termList = (terms.data?.terms ?? []).filter(t => t.schoolId === Number(schoolId));
  const proposals = useMemo(() => (((rules.data as { proposals?: Proposal[] } | undefined)?.proposals) ?? []).filter(isEligibleProposal), [rules.data]);
  const optionsAvailable = catalog.isSuccess && terms.isSuccess && rules.isSuccess
    && !catalog.isFetching && !terms.isFetching && !rules.isFetching;
  const selectedScopeAvailable = optionsAvailable
    && catalog.data?.schools.some(s => String(s.id) === schoolId)
    && termList.some(t => String(t.id) === termId)
    && proposals.some(p => String(p.id) === ruleId);
  const scope: Scope | null = selectedScopeAvailable ? { schoolId: Number(schoolId), termId: Number(termId), ruleId: Number(ruleId) } : null;
  const rule = proposals.find(p => String(p.id) === ruleId);

  return <div className="fade-up space-y-6" data-testid="page-direct-live-readiness">
    <PageHeading eyebrow="Platform finance · Owner only" title="Direct Flutterwave LIVE Readiness"
      description="Review one exact school, term and Student platform rule. Readiness is read-only; reviews are recorded only from the explicit buttons below."
      action={<Link href="/subscription-payment-rules" className="text-sm font-bold underline" data-testid="link-back-rules">Subscription & Payment Rules</Link>} />
    <OperationalSwitchWarning />
    <PilotCalendarReadiness actorId={actor} />
    <section className="panel p-5" data-testid="section-scope">
      <div className="eyebrow mb-3">01 · Exact scope</div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm font-bold">School
          <select className={cx(entry, 'mt-1')} value={schoolId} disabled={!catalog.isSuccess} data-testid="select-live-school"
             onChange={e => { setSchoolId(e.target.value); setTermId(''); setRuleId(''); }}>
            <option value="">{catalog.isLoading ? 'Loading schools…' : 'Select school'}</option>
            {(catalog.data?.schools ?? []).map(s => <option key={s.id} value={s.id}>{s.name} · #{s.id}</option>)}
          </select></label>
        <label className="text-sm font-bold">Academic term
          <select className={cx(entry, 'mt-1')} value={termId} disabled={!schoolId || !terms.isSuccess || terms.isFetching} data-testid="select-live-term"
            onChange={e => setTermId(e.target.value)}>
            <option value="">{!schoolId ? 'Select a school first' : terms.isLoading ? 'Loading terms…' : 'Select academic term'}</option>
            {termList.map(t => <option key={t.id} value={t.id}>{t.sessionName} · {t.name} ({t.startDate} – {t.endDate}) · #{t.id}{t.isCurrent ? ' · Current' : ''}</option>)}
          </select></label>
        <label className="text-sm font-bold">Student platform rule (NGN 3,200)
          <select className={cx(entry, 'mt-1')} value={ruleId} disabled={!rules.isSuccess} data-testid="select-live-rule"
            onChange={e => setRuleId(e.target.value)}>
            <option value="">{rules.isLoading ? 'Loading rules…' : 'Select rule proposal'}</option>
            {proposals.map(p => <option key={p.id} value={p.id}>#{p.id} · {p.status} · v{p.version} · from {p.effectiveAt.slice(0, 10)}</option>)}
          </select></label>
      </div>
      <p className={cx(note, 'mt-2')} data-testid="text-scope-help">
        {catalog.isError || terms.isError || rules.isError ? 'Scope options could not load. No changes were made.'
          : rules.isSuccess && !proposals.length ? 'No eligible NGN 3,200 Student rule is available. Prerequisite guidance remains below; rule creation requires separate review in Subscription & Payment Rules.'
          : schoolId && terms.isSuccess && !termList.length ? 'This school has no academic terms. None will be created here.'
          : 'Nothing is pre-selected. Changing any selection discards the previous readiness, form and confirmations.'}
      </p>
      {(catalog.isError || terms.isError || rules.isError) && <Button variant="outline" className="mt-2" testId="button-retry-scope"
        onClick={() => { catalog.refetch(); if (schoolId) terms.refetch(); rules.refetch(); }}>Retry</Button>}
    </section>
    {scope && rule ? <ScopeWorkspace key={`${actor}-${scope.schoolId}-${scope.termId}-${scope.ruleId}`} actor={actor} scope={scope} rule={rule} />
      : <><div className="panel p-8 text-center" data-testid="empty-scope"><FileClock className="mx-auto mb-2 opacity-60" /><p className={note}>Select a school, academic term and Student rule to load readiness.</p></div>
        <PaymentReadinessGuidance /></>}
  </div>;
}

function ScopeWorkspace({ actor, scope, rule }: { actor: number; scope: Scope; rule: Proposal }) {
  const qc = useQueryClient();
  const rKey = [...getGetDirectLiveReleaseReadinessQueryKey(scope), 'actor', actor];
  const lKey = [...getListDirectLiveReleaseReviewsQueryKey(scope), 'actor', actor];
  const readiness = useGetDirectLiveReleaseReadiness(scope, { query: { queryKey: rKey, enabled: true, staleTime: FRESH_MS, retry: false, refetchOnWindowFocus: false } });
  const list = useListDirectLiveReleaseReviews(scope, { query: { queryKey: lKey, enabled: true, staleTime: FRESH_MS, retry: false, refetchOnWindowFocus: false } });
  // Approval moves a Draft Student rule to Scheduled, so the actor-scoped rules/governance cache is reconciled too.
  const rulesKey = [...getGetOwnerSubscriptionPaymentRulesQueryKey(), 'actor', actor];
  const reconcile = async () => { await Promise.allSettled([qc.invalidateQueries({ queryKey: rKey }), qc.invalidateQueries({ queryKey: lKey }), qc.invalidateQueries({ queryKey: rulesKey })]); };
  const r = readiness.data;
  const reviews = list.data?.reviews ?? [];
  const open = reviews.some(v => v.status === 'CREATED' || v.status === 'REVIEWED');

  return <>
    <PaymentReadinessGuidance checks={r?.checks ?? []} />
    {r && <section className="panel p-5" data-testid="section-guided-checklist">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><div className="eyebrow">Guided checklist · from server checks only</div><h2 className="display-font text-lg font-bold">What is verified, what is missing</h2></div>
        <span className={cx('rounded-md border px-2 py-0.5 font-mono text-xs font-bold', String(r.facts.environment).toUpperCase() === 'LIVE' ? 'border-rose-300 bg-rose-50 text-rose-800' : 'border-sky-300 bg-sky-50 text-sky-900')} data-testid="badge-environment">
          {String(r.facts.environment).toUpperCase() === 'LIVE' ? 'LIVE environment reported' : `${String(r.facts.environment).toUpperCase()} environment, not LIVE`}</span>
      </div>
      <p className={cx(note, 'my-3')}>Each step reflects the actual reported checks. TEST success does not prove LIVE capability, and collection readiness does not prove BRO payout capability. Retired split/hosted prerequisites are not required here.</p>
      <GuidedSteps label="Flutterwave prerequisites" testId="guided-readiness" steps={[
        ...groupReadiness(r.checks),
        { id: 'review', title: 'Owner review recorded', state: reviews.some(v => v.status === 'APPROVED') ? 'done' : open ? 'open' : 'open', detail: reviews.some(v => v.status === 'APPROVED') ? 'An approval is recorded for this scope. It schedules the rule only.' : open ? 'A review is open. Decide it in step 04 below.' : 'No approved review. Create one in step 03 once evidence is ready.' },
        { id: 'switch', title: 'Separate LIVE authorization', state: 'blocked', detail: 'Never performed on this screen. LIVE is enabled only by an independently authorized operational switch after every step above is verified.' },
      ]} />
    </section>}
    <section className="panel overflow-hidden" data-testid="section-readiness">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[hsl(var(--border))] p-5">
        <div><div className="eyebrow">02 · Read-only readiness</div><h2 className="display-font text-lg font-bold">Release checks</h2></div>
        <Button variant="outline" onClick={() => readiness.refetch()} disabled={readiness.isFetching} testId="button-refresh-readiness">Refresh readiness</Button>
      </div>
      {readiness.isLoading ? <div className="h-32 animate-pulse bg-[hsl(var(--muted))]" data-testid="skeleton-readiness" />
        : readiness.isError || !r ? <div className="p-5 text-sm text-rose-800" data-testid="error-readiness">Readiness could not load: {errText(readiness.error)}. No changes were made.</div>
        : <div className="grid gap-6 p-5 lg:grid-cols-2">
          <ul className="space-y-2" data-testid="list-checks">{r.checks.map(c => <li key={c.code} className="rounded-xl border border-[hsl(var(--border))] p-3" data-testid={`check-${c.code}`}>
            <div className="flex items-center justify-between gap-2"><span className="font-bold">{c.label}</span><Tone status={c.status} /></div>
            <p className={note}>{c.detail}{c.code === 'NON_SPLIT_EVIDENCE' ? ' This evidence is mandatory in the review request and final confirmation.'
              : c.code === 'RUNTIME_SWITCH' ? ' This independent operational setting is never changed here.' : ''}</p></li>)}</ul>
          <dl>
            <Fact k="Release" v={String(r.facts.release)} /><Fact k="Environment" v={String(r.facts.environment)} testId="text-environment" />
            <Fact k="Merchant scope" v={r.facts.merchantScope ?? 'not configured'} /><Fact k="Callback URL" v={r.facts.callbackUrl ?? 'not configured'} />
            <Fact k="Webhook URL" v={r.facts.webhookUrl ?? 'not configured'} /><Fact k="Webhook auth" v={r.facts.webhookAuthentication ?? 'not configured'} />
            <Fact k="Policy" v={r.facts.policy} /><Fact k="Report digest" v={r.facts.reportDigest ?? 'not available'} testId="text-report-digest" />
            <Fact k="Eligible new students" v={r.facts.eligibleStudentIds.length} /><Fact k="Legacy (preserved)" v={r.facts.legacyCount} />
            <Fact k="Preview digest" v={r.previewDigest} testId="text-preview-digest" />
            <Fact k="Checkout in this workflow" v={r.checkoutEnabled ? 'ENABLED (unexpected, stop)' : 'Disabled here; School Admin eligibility is checked separately.'} testId="text-checkout-enabled" />
          </dl>
          <div className="lg:col-span-2" data-testid="list-blockers">{approvalBlockers(r).length
            ? <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900"><div className="mb-1 flex items-center gap-2 font-bold"><CircleSlash size={16} /> Approval blockers</div>
                <ul className="list-disc pl-5">{approvalBlockers(r).map(b => <li key={b}>{b}</li>)}</ul></div>
            : <div className="flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm font-bold text-emerald-900"><CheckCircle2 size={16} /> No approval blockers. LIVE remains off.</div>}</div>
        </div>}
    </section>
    <AdvanceSubscriptionAuthorizationPanel scope={scope} actor={actor} />
    {r && <CreateReview scope={scope} readiness={r} disabled={open} onSettled={reconcile} />}
    <section className="panel overflow-hidden" data-testid="section-reviews">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[hsl(var(--border))] p-5">
        <div><div className="eyebrow">04 · Request lifecycle & audit</div><h2 className="display-font text-lg font-bold">Release reviews</h2></div>
        <Button variant="outline" onClick={() => list.refetch()} disabled={list.isFetching} testId="button-refresh-reviews">Refresh reviews</Button>
      </div>
      {list.isLoading ? <div className="h-24 animate-pulse bg-[hsl(var(--muted))]" />
        : list.isError ? <div className="p-5 text-sm text-rose-800" data-testid="error-reviews">Reviews could not load: {errText(list.error)}</div>
        : !reviews.length ? <p className={cx(note, 'p-5')} data-testid="empty-reviews">No release review exists for this scope.</p>
        : <div className="divide-y divide-[hsl(var(--border))]">{reviews.map(v => <ReviewCard key={v.id} review={v} readiness={r} rule={rule} onSettled={reconcile} />)}</div>}
    </section>
  </>;
}

function CreateReview({ scope, readiness, disabled, onSettled }: { scope: Scope; readiness: DirectReleaseReadiness; disabled: boolean; onSettled: () => Promise<void> }) {
  const create = useCreateDirectLiveReleaseReview();
  const [ref, setRef] = useState(''); const [hash, setHash] = useState(''); const [expires, setExpires] = useState('');
  const [reason, setReason] = useState(''); const [noSplit, setNoSplit] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const valid = ref.trim().length >= 8 && ref.trim().length <= 300 && validHash(hash) && validExpiry(expires)
    && reason.trim().length >= 3 && reason.trim().length <= 500 && noSplit && readiness.schemaReady;
  const submit = () => {
    if (!valid || create.isPending) return;
    create.mutate({ data: { ...scope, previewDigest: readiness.previewDigest, merchantEvidenceReference: ref.trim(), merchantEvidenceHash: hash,
      noSplitConfirmed: true, policy: POLICY, expiresAt: new Date(expires).toISOString(), reason: reason.trim() } }, {
      onSuccess: v => { setMsg({ ok: true, text: `Review #${v.id} created (${v.status}). No payment was initiated.` }); setNoSplit(false); },
      onError: e => setMsg({ ok: false, text: `${errText(e)}. The outcome was checked by reloading reviews; the request was not repeated.` }),
      onSettled: () => { void onSettled(); },
    });
  };
  return <section className="panel p-5" data-testid="section-create-review">
    <div className="eyebrow mb-1">03 · Create release review</div>
    <p className={cx(note, 'mb-3')}>Binds merchant evidence to preview digest <span className="font-mono">{short(readiness.previewDigest)}</span>. Creating a review does not approve, schedule or enable anything.</p>
    {!readiness.schemaReady && <p className="mb-3 rounded-lg bg-rose-50 p-2 text-sm text-rose-900" data-testid="text-schema-blocked">{SCHEMA_NOT_VERIFIED} Creation is blocked.</p>}
    {disabled && <p className="mb-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-900" data-testid="text-open-review">An open review already exists for this scope. Decide it below first.</p>}
    <div className="grid gap-3 md:grid-cols-2">
      <input className={entry} placeholder="Merchant evidence reference (8-300 chars)" maxLength={300} value={ref} onChange={e => setRef(e.target.value)} data-testid="input-evidence-ref" />
      <input className={cx(entry, 'font-mono')} placeholder="Merchant evidence SHA-256 (64 lowercase hex)" maxLength={64} value={hash} onChange={e => setHash(e.target.value.trim())} data-testid="input-evidence-hash" />
      <label className="text-sm">Review expires (within 7 days)<input type="datetime-local" className={cx(entry, 'mt-1')} value={expires} onChange={e => setExpires(e.target.value)} data-testid="input-expires" /></label>
      <textarea className={entry} placeholder="Reason (3-500 chars)" maxLength={500} value={reason} onChange={e => setReason(e.target.value)} data-testid="input-create-reason" />
    </div>
    <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={noSplit} onChange={e => setNoSplit(e.target.checked)} data-testid="checkbox-no-split" />
      I confirm the merchant evidence shows no split: zero school/BRO shares, 100% to Yetenia. Policy {POLICY}: only new eligible students; legacy records are preserved, not converted.</label>
    {hash && !validHash(hash) && <p className="mt-1 text-xs text-rose-700">Hash must be exactly 64 lowercase hex characters.</p>}
    {expires && !validExpiry(expires) && <p className="mt-1 text-xs text-rose-700">Expiry must be in the future and no more than 7 days away.</p>}
    <Button className="mt-4" disabled={!valid || disabled || create.isPending} onClick={submit} testId="button-create-review">{create.isPending ? 'Recording…' : 'Create release review'}</Button>
    {msg && <p role="status" className={cx('mt-3 text-sm', msg.ok ? 'text-emerald-800' : 'text-rose-800')} data-testid="text-create-result">{msg.text}</p>}
  </section>;
}

function ReviewCard({ review, readiness, rule, onSettled }: { review: DirectReleaseReview; readiness?: DirectReleaseReadiness; rule: Proposal; onSettled: () => Promise<void> }) {
  const decide = useDecideDirectLiveReleaseReview();
  const [reason, setReason] = useState(''); const [confirm, setConfirm] = useState(false); const [finalOpen, setFinalOpen] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const s = review.status;
  const stale = !readiness || readiness.previewDigest !== review.previewDigest;
  const blockers = approvalBlockers(readiness);
  const expired = new Date(review.expiresAt).getTime() <= Date.now();
  const reasonOk = reason.trim().length >= 3 && reason.trim().length <= 500;
  const act = (action: DirectReleaseDecisionInputAction) => {
    if (decide.isPending || !reasonOk) return;
    decide.mutate({ id: review.id, data: { action, evidenceDigest: review.evidenceDigest, reason: reason.trim(), confirmScope: action === 'APPROVED' ? confirm : true } }, {
      onSuccess: v => { setMsg({ ok: true, text: `Review #${v.id} is now ${v.status}. LIVE remains off; no payment was initiated.` }); setReason(''); setConfirm(false); setFinalOpen(false); },
      onError: e => setMsg({ ok: false, text: `${errText(e)}. Status was reloaded from the server; the action was not repeated.` }),
      onSettled: () => { void onSettled(); },
    });
  };
  const canApprove = s === 'REVIEWED' && !stale && !blockers.length && !expired && confirm && reasonOk;
  return <article className="space-y-3 p-5" data-testid={`review-${review.id}`}>
    <div className="flex flex-wrap items-center gap-2"><span className="font-bold">Review #{review.id}</span><Tone status={s} />
      {stale && (s === 'CREATED' || s === 'REVIEWED') && <span className="flex items-center gap-1 text-xs font-bold text-rose-700" data-testid={`text-stale-${review.id}`}><AlertTriangle size={14} /> Stale: readiness changed since this review was created</span>}</div>
    <p className={note}>Created {when(review.createdAt)} · expires {when(review.expiresAt)} · evidence digest <span className="font-mono">{short(review.evidenceDigest)}</span></p>
    <p className="text-sm">{review.reason}</p>
    <ol className="space-y-1 border-l-2 border-[hsl(var(--border))] pl-3 text-xs" data-testid={`history-${review.id}`}>
      {review.events.map(ev => <li key={ev.id}><span className="font-mono font-bold">{ev.action}</span> by actor #{ev.actorId} · {when(ev.createdAt)} · {ev.reason}</li>)}
    </ol>
    {s !== 'REJECTED' && s !== 'EXPIRED' && <div className="space-y-2 rounded-xl bg-[hsl(var(--secondary))] p-3">
      <textarea className={entry} placeholder="Decision reason (3-500 chars)" maxLength={500} value={reason} onChange={e => setReason(e.target.value)} data-testid={`input-decision-reason-${review.id}`} />
      <div className="flex flex-wrap gap-2">
        {s === 'CREATED' && <Button variant="outline" disabled={!reasonOk || decide.isPending || stale} onClick={() => act('REVIEWED')} testId={`button-mark-reviewed-${review.id}`}>Mark reviewed</Button>}
        {s === 'REVIEWED' && <Button variant="outline" disabled={decide.isPending} onClick={() => setFinalOpen(o => !o)} testId={`button-open-final-${review.id}`}>Open final review</Button>}
        <Button variant="danger" disabled={!reasonOk || decide.isPending} onClick={() => act('REJECTED')} testId={`button-reject-${review.id}`}>{s === 'APPROVED' ? 'Withdraw approval' : 'Reject'}</Button>
        {expired && s !== 'APPROVED' && <Button variant="quiet" disabled={!reasonOk || decide.isPending} onClick={() => act('EXPIRED')} testId={`button-expire-${review.id}`}>Record expiry</Button>}
      </div>
    </div>}
    {finalOpen && s === 'REVIEWED' && <div className="rounded-2xl border-2 border-[hsl(var(--primary)/.4)] p-4" data-testid={`final-review-${review.id}`}>
      <div className="mb-2 flex items-center gap-2 font-bold"><ShieldCheck size={16} /> Final approval review</div>
      <dl>
        <Fact k="School / term / rule" v={`#${review.schoolId} / #${review.termId} / #${review.ruleId}`} testId="final-scope" />
        <Fact k="Rule" v={`${rule.status} · v${rule.version} · NGN 3,200 per term · ${when(rule.effectiveAt)} to ${rule.endsAt ? when(rule.endsAt) : 'open-ended'}`} testId="final-rule" />
        <Fact k="Merchant evidence" v={`${review.merchantEvidenceReference} · ${review.merchantEvidenceHash}`} testId="final-evidence" />
        <Fact k="Report hash" v={String(review.facts.reportDigest ?? 'not available')} testId="final-report" />
        <Fact k="Shares" v="School 0 · BRO 0 · Yetenia 100% (no split)" testId="final-shares" />
        <Fact k="Legacy" v={`${review.facts.legacyCount} legacy records preserved; no conversion`} testId="final-legacy" />
        <Fact k="Effect" v="Schedules the Draft Student rule from its own effective date. Runtime settings and staff billing unchanged. LIVE stays off." />
      </dl>
      {(stale || blockers.length > 0 || expired) && <p className="mt-2 text-sm text-rose-800" data-testid={`text-approval-blocked-${review.id}`}>Approval blocked: {stale ? 'readiness changed; refresh and create a new review. ' : ''}{expired ? 'review expired. ' : ''}{blockers.join(' ')}</p>}
      <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} data-testid={`checkbox-confirm-scope-${review.id}`} />
        I confirm this exact scope, rule version, merchant evidence, report hash, zero shares and no legacy conversion. I understand this does not enable LIVE or take any payment.</label>
      <Button className="mt-3" disabled={!canApprove || decide.isPending} onClick={() => act('APPROVED')} testId={`button-approve-${review.id}`}>Record approval</Button>
    </div>}
    {msg && <p role="status" className={cx('text-sm', msg.ok ? 'text-emerald-800' : 'text-rose-800')} data-testid={`text-decision-result-${review.id}`}>{msg.text}</p>}
  </article>;
}
