import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'wouter';
import { Ban, Eye, FileClock, FilePlus2, Handshake, Landmark, Layers3, Lock, Pencil, PlugZap, RefreshCw, ShieldCheck, WalletCards, XCircle } from 'lucide-react';
import { Button, EmptyState, ErrorState, Field, Info, Modal, PageHeading, SkeletonPage, StatusPill, cx, date } from '@/components/shared';
import { DirectAssistanceCheckout } from '@/components/direct-assistance-checkout';

/* ---------- Types ---------- */
export type StaffRuleSnapshot = { id: number; version: number; priceMinor: number; schoolShareMinor: number; partnerCommissionMinor: number; effectiveAt: string; status: string };
export type BroRuleSnapshot = { id: number; name: string; status: string; term: string | null; partnerAmount: number; schoolAmount: number; effectiveDate: string };
export type AuditSnapshot = { id: number; user: string; action: string; timestamp: string; metadata: unknown };
/** Optional non-secret capability flags. Never include keys or secret values. */
export type FlutterwaveCapabilitySnapshot = { configured: boolean; mode?: string | null; splitSettlements?: boolean; hostedCheckout?: boolean; webhookVerification?: boolean };
export type RuleProposalSnapshot = { id: number; product: string; status: string; amountMinor: number; currency: string; billingPeriod: string; schoolShareMinor: number; effectiveAt: string; endsAt: string | null; reason: string; version: number; nativeRuleId: number | null };
export type AssistanceSnapshot = { id: number; schoolId: number; studentId: number; termId: number; amountMinor: number; status: string; requestNote: string; bankName?: string | null; bankStatementReference?: string | null; bankCreditDate?: string | null; verifiedAmountMinor?: number | null };
export type SubscriptionPaymentRulesSnapshot = {
  staffRules: StaffRuleSnapshot[];
  broRules: BroRuleSnapshot[];
  audit: AuditSnapshot[];
  proposals?: RuleProposalSnapshot[];
  assistance?: AssistanceSnapshot[];
  flutterwave?: FlutterwaveCapabilitySnapshot | null;
  error?: string | null;
  loading?: boolean;
};

export type RuleProduct = 'STUDENT_PLATFORM' | 'TEACHER_STAFF_PLATFORM' | 'BRO_COMMISSION';
export type RuleDraftInput = { product: RuleProduct; amountMinor: number; currency: 'NGN'; billingPeriod: 'ACADEMIC_TERM'; schoolShareMinor: 0; effectiveAt: string; endsAt: string | null; reason: string };
export type RuleEditInput = RuleDraftInput & { version: number };
export type RulePreviewResult = { rule: RuleProposalSnapshot; activationAvailable: boolean; blocker: string | null; previewDigest: string | null };
export type AssistanceRequestInput = { schoolId: number; studentId: number; termId: number; amountMinor: number; requestNote: string };
export type BankVerificationInput = { bankName: string; bankStatementReference: string; creditDate: string; verifiedAmountMinor: number; independentlyChecked: true };

export type SubscriptionPaymentRulesProps = {
  snapshot: SubscriptionPaymentRulesSnapshot;
  onRefresh: () => void | Promise<unknown>;
  onCreateDraft?: (input: RuleDraftInput) => Promise<unknown>;
  onEditDraft?: (id: number, input: RuleEditInput) => Promise<unknown>;
  onPreview?: (id: number) => Promise<RulePreviewResult>;
  onActivate?: (id: number, body: { version: number; previewDigest: string }) => Promise<unknown>;
  onRetire?: (id: number, body: { reason: string }) => Promise<unknown>;
  onRequestAssistance?: (input: AssistanceRequestInput) => Promise<unknown>;
  onVerifyBank?: (id: number, body: BankVerificationInput) => Promise<unknown>;
};

/* ---------- Helpers ---------- */
const note = 'text-xs leading-5 text-[hsl(var(--muted-foreground))]';
const entry = 'w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3.5 py-2.5 text-sm font-medium outline-none focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.12)]';
const linkCls = 'inline-flex items-center gap-1.5 rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-xs font-bold hover:bg-[hsl(var(--muted))]';
const errCls = 'text-sm font-semibold text-[hsl(var(--destructive))]';
const ngnMinor = (m: number) => `₦${(m / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ngn = (n: number) => `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dt = (v: string | null | undefined) => { if (!v) return '—'; const d = new Date(v); return Number.isNaN(d.getTime()) ? v : d.toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }); };
const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'; } catch { return 'local time'; } })();
const PRODUCTS: { value: RuleProduct; label: string; defaultNaira: string }[] = [
  { value: 'STUDENT_PLATFORM', label: 'Student NFC & EduCore platform', defaultNaira: '3200' },
  { value: 'TEACHER_STAFF_PLATFORM', label: 'Teacher/Staff NFC E-ID', defaultNaira: '2000' },
  { value: 'BRO_COMMISSION', label: 'BRO commission', defaultNaira: '100' },
];
const productLabel = (p: string) => PRODUCTS.find(x => x.value === p)?.label ?? p;

/** Exact NGN → kobo conversion without floating point. Returns null if invalid. */
export function nairaToMinor(raw: string): number | null {
  const v = raw.trim().replace(/,/g, '');
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(v);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}
const minorToNairaInput = (m: number) => `${Math.floor(m / 100)}${m % 100 ? '.' + String(m % 100).padStart(2, '0') : ''}`;
const toLocalInput = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); if (Number.isNaN(d.getTime())) return ''; const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
function safeError(e: unknown): string {
  const raw = e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string' ? (e as { message: string }).message : '';
  const clean = raw.replace(/[<>]/g, '').slice(0, 240).trim();
  return clean || 'The action could not be completed. Nothing was changed on this screen; refresh and try again.';
}
const metaField = (m: unknown, k: string): string | null => {
  if (m && typeof m === 'object' && k in m) { const v = (m as Record<string, unknown>)[k]; return typeof v === 'string' || typeof v === 'number' ? String(v) : null; }
  return null;
};
const auditSummary = (m: unknown, key: 'before' | 'after'): string | null => {
  if (!m || typeof m !== 'object') return null;
  const v = (m as Record<string, unknown>)[key];
  if (!v || typeof v !== 'object') return key === 'before' ? 'New record' : null;
  const record = v as Record<string, unknown>;
  const fields: string[] = [];
  if (typeof record.product === 'string') fields.push(productLabel(record.product));
  if (typeof record.status === 'string') fields.push(record.status);
  if (typeof record.amountMinor === 'number' && Number.isSafeInteger(record.amountMinor)) fields.push(ngnMinor(record.amountMinor));
  if (typeof record.effectiveAt === 'string') fields.push(`Effective ${dt(record.effectiveAt)}`);
  if (typeof record.endsAt === 'string') fields.push(`Ends ${dt(record.endsAt)}`);
  return fields.join(' · ') || null;
};

/* ---------- Small UI ---------- */
function Section({ id, n, icon: Icon, title, kicker, children, tone = 'default', className }: { id: string; n: string; icon: typeof Lock; title: string; kicker: string; children: ReactNode; tone?: 'default' | 'blocked'; className?: string }) {
  return <section className={cx('panel p-5 sm:p-6', tone === 'blocked' && 'border-l-4 border-l-[hsl(var(--destructive))]', className)} data-testid={`section-${id}`}>
    <div className="mb-4 flex items-start gap-3">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[hsl(var(--primary)/.08)] text-[hsl(var(--primary))]"><Icon className="h-5 w-5" /></div>
      <div className="min-w-0"><div className="eyebrow">{n} · {kicker}</div><h2 className="display-font text-lg font-bold">{title}</h2></div>
    </div>
    {children}
  </section>;
}
function Flag({ label, on }: { label: string; on: boolean | undefined }) {
  const v = on === undefined ? 'Not reported' : on ? 'Reported available' : 'Unavailable';
  return <div className="flex items-center justify-between gap-3 py-2 text-sm" data-testid={`flag-${label.toLowerCase().replace(/\s+/g, '-')}`}><span className="font-semibold">{label}</span><span className={note}>{v}</span></div>;
}
function Unwired({ what }: { what: string }) { return <p className={note} data-testid="text-unwired">{what} is not connected on this screen yet.</p>; }
function Check({ checked, onChange, children, testId }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; testId: string }) {
  return <label className="flex items-start gap-2 text-sm font-semibold"><input type="checkbox" className="mt-1 h-4 w-4" checked={checked} onChange={e => onChange(e.target.checked)} data-testid={testId} /><span>{children}</span></label>;
}

/* ---------- Rule form (create / edit draft) ---------- */
type RuleFormState = { product: RuleProduct; amount: string; effectiveAt: string; endsAt: string; reason: string };
function validateRule(f: RuleFormState): { errors: string[]; input?: RuleDraftInput } {
  const errors: string[] = [];
  const amountMinor = nairaToMinor(f.amount);
  if (amountMinor === null) errors.push('Enter the amount in naira, e.g. 3200 or 3200.50 (max two decimals).');
  else if (amountMinor <= 0 && f.product !== 'BRO_COMMISSION') errors.push('Amount must be greater than zero.');
  const eff = new Date(f.effectiveAt);
  if (!f.effectiveAt || Number.isNaN(eff.getTime())) errors.push('Choose an effective date and time.');
  else if (eff.getTime() <= Date.now()) errors.push('Effective date must be in the future.');
  let endsAt: string | null = null;
  if (f.endsAt) {
    const end = new Date(f.endsAt);
    if (Number.isNaN(end.getTime())) errors.push('End date is invalid.');
    else if (!Number.isNaN(eff.getTime()) && end.getTime() <= eff.getTime()) errors.push('End date must be after the effective date.');
    else endsAt = end.toISOString();
  }
  if (f.reason.trim().length < 10) errors.push('Give a reason of at least 10 characters for the audit trail.');
  if (errors.length || amountMinor === null) return { errors };
  return { errors, input: { product: f.product, amountMinor, currency: 'NGN', billingPeriod: 'ACADEMIC_TERM', schoolShareMinor: 0, effectiveAt: eff.toISOString(), endsAt, reason: f.reason.trim() } };
}

function RuleForm({ initial, lockProduct, submitLabel, onSubmit, testPrefix }: { initial: RuleFormState; lockProduct?: boolean; submitLabel: string; onSubmit: (input: RuleDraftInput) => Promise<void>; testPrefix: string }) {
  const [f, setF] = useState<RuleFormState>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const minor = nairaToMinor(f.amount);
  const set = (k: keyof RuleFormState) => (e: { target: { value: string } }) => setF(p => ({ ...p, [k]: e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = validateRule(f);
    if (!v.input) { setErrors(v.errors); return; }
    setBusy(true); setErrors([]);
    try { await onSubmit(v.input); } catch (er) { setErrors([safeError(er)]); } finally { setBusy(false); }
  };
  return <form onSubmit={submit} className="space-y-4" data-testid={`form-${testPrefix}`}>
    <Field label="Product">
      <select className={entry} value={f.product} disabled={lockProduct} onChange={e => { const p = e.target.value as RuleProduct; setF(s => ({ ...s, product: p, amount: PRODUCTS.find(x => x.value === p)?.defaultNaira ?? s.amount })); }} data-testid={`select-${testPrefix}-product`}>
        {PRODUCTS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>
    </Field>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Amount (₦, NGN)"><input className={entry} inputMode="decimal" value={f.amount} onChange={set('amount')} data-testid={`input-${testPrefix}-amount`} /></Field>
      <Info label="Stored as" value={<span className="text-sm tabular-nums" data-testid={`text-${testPrefix}-minor`}>{minor === null ? 'Invalid amount' : `${minor.toLocaleString('en-NG')} kobo`}</span>} />
    </div>
    <div className="grid grid-cols-3 gap-2 text-xs"><Info label="Currency" value="NGN" /><Info label="Billing" value="1 academic term" /><Info label="School share" value="₦0 (fixed)" /></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={`Effective from (${TZ})`}><input type="datetime-local" className={entry} value={f.effectiveAt} onChange={set('effectiveAt')} data-testid={`input-${testPrefix}-effective`} /></Field>
      <Field label={`Ends (optional, ${TZ})`}><input type="datetime-local" className={entry} value={f.endsAt} onChange={set('endsAt')} data-testid={`input-${testPrefix}-ends`} /></Field>
    </div>
    <Field label="Reason (recorded in audit)"><textarea className={cx(entry, 'min-h-[76px]')} value={f.reason} onChange={set('reason')} data-testid={`input-${testPrefix}-reason`} /></Field>
    <p className={note}>Saving creates or updates a <strong>draft</strong> only. Drafts are not billable and do not change any school's charges. Activation is a separate, previewed step.</p>
    {errors.length > 0 && <ul role="alert" className={cx(errCls, 'list-disc pl-5')} data-testid={`errors-${testPrefix}`}>{errors.map(m => <li key={m}>{m}</li>)}</ul>}
    <Button type="submit" disabled={busy} testId={`button-${testPrefix}-submit`}>{busy ? 'Saving…' : submitLabel}</Button>
  </form>;
}

/* ---------- Page ---------- */
type Dialog =
  | { kind: 'edit'; p: RuleProposalSnapshot }
  | { kind: 'preview'; p: RuleProposalSnapshot }
  | { kind: 'retire'; p: RuleProposalSnapshot }
  | { kind: 'verify'; a: AssistanceSnapshot }
  | null;

export function SubscriptionPaymentRulesPage(props: SubscriptionPaymentRulesProps) {
  const { snapshot, onRefresh, onCreateDraft, onEditDraft, onPreview, onActivate, onRetire, onRequestAssistance, onVerifyBank } = props;
  const { staffRules, broRules, audit, flutterwave, error, loading } = snapshot;
  const proposals = useMemo(() => [...(snapshot.proposals ?? [])].sort((a, b) => b.id - a.id), [snapshot.proposals]);
  const assistance = snapshot.assistance ?? [];
  const [dialog, setDialog] = useState<Dialog>(null);
  const [flash, setFlash] = useState('');
  const [formKey, setFormKey] = useState(0);

  const done = async (msg: string) => { setFlash(msg); setDialog(null); try { await onRefresh(); } catch { /* parent surfaces refresh errors via snapshot.error */ } };

  const refresh = <Button variant="outline" onClick={() => { void onRefresh(); }} disabled={loading} testId="button-refresh"><RefreshCw className="h-4 w-4" /> Refresh</Button>;
  if (loading) return <div className="fade-up"><PageHeading eyebrow="Owner / Payment rules" title="Subscription & payment rules" /><SkeletonPage /></div>;
  if (error) return <div className="fade-up"><PageHeading eyebrow="Owner / Payment rules" title="Subscription & payment rules" /><ErrorState retry={() => { void onRefresh(); }} message={error} /></div>;
  const sortedStaff = [...staffRules].sort((a, b) => b.version - a.version);
  const blankRule: RuleFormState = { product: 'STUDENT_PLATFORM', amount: '3200', effectiveAt: '', endsAt: '', reason: '' };

  return <div className="fade-up">
    <PageHeading eyebrow="Owner / Payment rules" title="Subscription & payment rules" description="Intent, evidence and activation are kept separate. Drafts are never billable; activation requires an explicit preview and your fresh confirmation." action={refresh} />

    {flash && <div role="status" className="panel mb-6 flex items-center justify-between gap-3 p-4 text-sm font-semibold" data-testid="status-flash"><span>{flash}</span><button type="button" className="text-xs underline" onClick={() => setFlash('')} data-testid="button-dismiss-flash">Dismiss</button></div>}

    <div className="mb-6 grid gap-3 sm:grid-cols-3" data-testid="legend-states">
      <Info label="Intent" value={<span className="text-sm">A draft price. Not billable.</span>} />
      <Info label="Evidence" value={<span className="text-sm">A receipt, upload or request. Never proves bank credit.</span>} />
      <Info label="Activation" value={<span className="text-sm">Previewed, digest-confirmed, server-applied.</span>} />
    </div>

    <div className="grid gap-6 lg:grid-cols-2">
      <Section id="student" n="01" icon={Ban} kicker="Intent only · blocked" title="Student NFC & EduCore platform" tone="blocked">
        <div className="mb-3 flex items-baseline gap-3"><span className="display-font text-3xl font-bold tabular-nums" data-testid="text-student-intended">₦3,200</span><StatusPill value="Blocked" /></div>
        <p className={note}>Intended per-student amount only. It is <strong>not active</strong> and is not being charged. Activation is blocked pending a reviewed transition from the current student fee rules. Drafts may be prepared below, but previews may report a blocker and no activation is promised.</p>
      </Section>

      <Section id="staff" n="02" icon={WalletCards} kicker="Active native rules" title="Teacher / Staff NFC E-ID">
        <p className={cx(note, 'mb-3')}>₦2,000 per term, platform revenue only. No school share. Rules are effective-dated; existing subscriptions keep their original amounts.</p>
        {sortedStaff.length === 0 ? <p className="text-sm font-semibold" data-testid="text-staff-empty">No staff rule version is recorded.</p> :
          <div className="divide-y divide-[hsl(var(--border))] rounded-xl border border-[hsl(var(--border))]" data-testid="list-staff-rules">
            {sortedStaff.map(r => <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm" data-testid={`row-staff-rule-${r.id}`}>
              <div><div className="font-bold tabular-nums">v{r.version} · {ngnMinor(r.priceMinor)}</div><div className={note}>Effective {date(r.effectiveAt)} · school {ngnMinor(r.schoolShareMinor)} · BRO {ngnMinor(r.partnerCommissionMinor)}</div>{r.schoolShareMinor !== 0 && <div className="text-xs font-bold text-[hsl(var(--destructive))]">Non-zero school share — review this version.</div>}</div>
              <StatusPill value={r.status} />
            </div>)}
          </div>}
        <div className="mt-4"><Link href="/billing-rules" className={linkCls} data-testid="link-billing-rules"><Layers3 className="h-3.5 w-3.5" /> Open billing rules</Link></div>
      </Section>

      <Section id="bro" n="03" icon={Handshake} kicker="Separate configuration" title="BRO commission">
        <p className={cx(note, 'mb-3')}>Configured on the existing partner route. Listed amounts are configuration, not payouts; nothing here implies a commission is owed or paid. BRO drafts may be blocked at preview.</p>
        {broRules.length === 0 ? <p className="text-sm font-semibold" data-testid="text-bro-empty">No BRO rule is recorded.</p> :
          <div className="divide-y divide-[hsl(var(--border))] rounded-xl border border-[hsl(var(--border))]" data-testid="list-bro-rules">
            {broRules.map(r => <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm" data-testid={`row-bro-rule-${r.id}`}>
              <div><div className="font-bold">{r.name}</div><div className={note}>{r.term ?? 'All terms'} · from {date(r.effectiveDate)} · partner {ngn(r.partnerAmount)} · school {ngn(r.schoolAmount)}</div></div>
              <StatusPill value={r.status} />
            </div>)}
          </div>}
        <div className="mt-4"><Link href="/partners" className={linkCls} data-testid="link-partners"><Handshake className="h-3.5 w-3.5" /> Open BRO configuration</Link></div>
      </Section>

      <Section id="access" n="04" icon={ShieldCheck} kicker="Operational gating" title="Access policies">
        <p className={cx(note, 'mb-3')}>Unpaid or unresolved staff subscriptions gate operational features only. Unresolved staff checkout cannot proceed until resolved. These always remain available:</p>
        <ul className="grid grid-cols-2 gap-2 text-sm font-semibold" data-testid="list-preserved-access">
          {['Login', 'Renewal', 'Support', 'Inbox', 'Read-only records'].map(x => <li key={x} className="rounded-lg bg-[hsl(var(--muted))] px-3 py-2">{x}</li>)}
        </ul>
        <div className="mt-4"><Link href="/subscription-enforcement" className={linkCls} data-testid="link-enforcement"><Lock className="h-3.5 w-3.5" /> Open term enforcement</Link></div>
      </Section>
    </div>

    {/* ---------- Proposals ---------- */}
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.3fr]">
      <Section id="new-draft" n="05" icon={FilePlus2} kicker="Draft only" title="New rule draft">
        {onCreateDraft ? <RuleForm key={formKey} initial={blankRule} submitLabel="Save draft" testPrefix="create-draft" onSubmit={async input => { await onCreateDraft(input); setFormKey(k => k + 1); await done(`Draft saved for ${productLabel(input.product)} at ${ngnMinor(input.amountMinor)}. It is not active.`); }} /> : <Unwired what="Draft creation" />}
      </Section>

      <section className="panel overflow-hidden" data-testid="section-proposals">
        <div className="border-b border-[hsl(var(--border))] p-5"><div className="eyebrow">06 · Proposals</div><h2 className="display-font text-lg font-bold">Rule proposals</h2></div>
        {proposals.length === 0 ? <EmptyState icon={Layers3} title="No proposals" description="Saved drafts appear here with their status and effective dates." /> :
          <div className="divide-y divide-[hsl(var(--border))]" data-testid="list-proposals">
            {proposals.map(p => {
              const st = p.status.toUpperCase();
              const isDraft = st === 'DRAFT';
              const canRetire = !['RETIRED', 'SUPERSEDED'].includes(st);
              return <div key={p.id} className="px-5 py-4 text-sm" data-testid={`row-proposal-${p.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-bold">{productLabel(p.product)} · <span className="tabular-nums">{ngnMinor(p.amountMinor)}</span> <span className={note}>{p.currency} · v{p.version}</span></div>
                  <StatusPill value={p.status} />
                </div>
                <div className={cx(note, 'mt-1')}>Effective {dt(p.effectiveAt)} · ends {p.endsAt ? dt(p.endsAt) : 'open-ended'} · {p.billingPeriod === 'ACADEMIC_TERM' ? 'per academic term' : p.billingPeriod} · school share {ngnMinor(p.schoolShareMinor)}{p.nativeRuleId ? ` · native rule #${p.nativeRuleId}` : ''}</div>
                <div className={cx(note, 'mt-1 break-words')}>Reason: {p.reason || '—'}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {isDraft && onEditDraft && <Button variant="outline" onClick={() => setDialog({ kind: 'edit', p })} testId={`button-edit-${p.id}`}><Pencil className="h-3.5 w-3.5" /> Edit draft</Button>}
                  {isDraft && onPreview && <Button variant="outline" onClick={() => setDialog({ kind: 'preview', p })} testId={`button-preview-${p.id}`}><Eye className="h-3.5 w-3.5" /> Preview activation</Button>}
                  {canRetire && onRetire && <Button variant="quiet" onClick={() => setDialog({ kind: 'retire', p })} testId={`button-retire-${p.id}`}><XCircle className="h-3.5 w-3.5" /> Retire</Button>}
                </div>
              </div>;
            })}
          </div>}
      </section>
    </div>

    {/* ---------- Assistance ---------- */}
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.3fr]">
      <Section id="assistance" n="07" icon={Landmark} kicker="Request ≠ proof" title="Payment assistance request">
        <div className="mb-4 rounded-xl border border-[hsl(var(--destructive)/.4)] bg-[hsl(var(--destructive)/.06)] p-3 text-xs font-semibold leading-5" data-testid="text-assistance-limitation">
          Limitation: a request or upload is <strong>never proof of payment</strong>. Independent bank verification is required for assistance. Direct LIVE checkout stays <strong>unavailable until separately approved</strong> release, effective rule and term reconciliation checks pass; a bank credit alone never authorizes Flutterwave.
        </div>
        {onRequestAssistance ? <AssistanceForm onSubmit={async input => { await onRequestAssistance(input); await done('Assistance request recorded. It is unverified until a bank credit is independently checked.'); }} /> : <Unwired what="Assistance requests" />}
      </Section>

      <section className="panel overflow-hidden" data-testid="section-assistance-list">
        <div className="border-b border-[hsl(var(--border))] p-5"><div className="eyebrow">08 · Bank verification</div><h2 className="display-font text-lg font-bold">Assistance cases</h2></div>
        {assistance.length === 0 ? <EmptyState icon={Landmark} title="No assistance cases" description="Requests appear here. Each stays unverified until a bank credit is independently checked." /> :
          <div className="divide-y divide-[hsl(var(--border))]" data-testid="list-assistance">
            {assistance.map(a => {
              const verified = a.verifiedAmountMinor != null && !!a.bankStatementReference;
              return <div key={a.id} className="px-5 py-4 text-sm" data-testid={`row-assistance-${a.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-bold">School #{a.schoolId} · Student #{a.studentId} · Term #{a.termId}</div><StatusPill value={a.status} /></div>
                <div className={cx(note, 'mt-1')}>Requested {ngnMinor(a.amountMinor)} · {a.requestNote || 'No note'}</div>
                {verified ? <div className="mt-1 text-xs font-semibold" data-testid={`text-verified-${a.id}`}>Bank verified: {a.bankName ?? '—'} · ref {a.bankStatementReference} · credited {a.bankCreditDate ? date(a.bankCreditDate) : '—'} · {ngnMinor(a.verifiedAmountMinor ?? 0)}</div>
                  : <div className={cx(note, 'mt-1 font-semibold')}>Not bank-verified. Not proof of payment.</div>}
                {verified && <DirectAssistanceCheckout caseFile={a} />}
                {!verified && onVerifyBank && <div className="mt-3"><Button variant="outline" onClick={() => setDialog({ kind: 'verify', a })} testId={`button-verify-${a.id}`}><Landmark className="h-3.5 w-3.5" /> Record bank verification</Button></div>}
              </div>;
            })}
          </div>}
      </section>
    </div>

    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      <Section id="flutterwave" n="09" icon={PlugZap} kicker="Capability only · no secrets" title="Flutterwave status">
        {!flutterwave ? <p className="text-sm font-semibold" data-testid="text-flw-unreported">Capability not reported. Treat as unavailable.</p> :
          <div className="divide-y divide-[hsl(var(--border))]" data-testid="list-flw-capability">
            <Flag label="Configured" on={flutterwave.configured} />
            <div className="flex items-center justify-between py-2 text-sm"><span className="font-semibold">Mode</span><span className={note} data-testid="text-flw-mode">{flutterwave.mode ?? 'Not reported'}</span></div>
            <Flag label="Split settlements" on={flutterwave.splitSettlements} />
            <Flag label="Hosted checkout" on={flutterwave.hostedCheckout} />
            <Flag label="Webhook verification" on={flutterwave.webhookVerification} />
          </div>}
        <p className={cx(note, 'mt-3')}>Keys and secrets are never displayed. Capability does not mean subscription payment initiation is available.</p>
      </Section>

      <section className="panel overflow-hidden" data-testid="section-audit">
        <div className="border-b border-[hsl(var(--border))] p-5"><div className="eyebrow">10 · Audit history</div><h2 className="display-font text-lg font-bold">Recorded changes</h2></div>
        {audit.length === 0 ? <EmptyState icon={FileClock} title="No audit entries" description="Rule and policy changes appear here once recorded." /> :
          <div className="max-h-[520px] divide-y divide-[hsl(var(--border))] overflow-y-auto">
            {audit.map(a => { const reason = metaField(a.metadata, 'reason'); const source = metaField(a.metadata, 'source'); return <div key={a.id} className="px-5 py-3 text-sm" data-testid={`row-audit-${a.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-bold break-words">{a.action}</div><div className={note}>{dt(a.timestamp)}</div></div>
              <div className={note}>Actor: {a.user}{source ? ` · Source: ${source}` : ''}</div>
              {reason && <div className={cx(note, 'break-words')}>Reason: {reason}</div>}
              {auditSummary(a.metadata, 'before') && <div className={cx(note, 'break-words')}>Before: {auditSummary(a.metadata, 'before')}</div>}
              {auditSummary(a.metadata, 'after') && <div className={cx(note, 'break-words')}>After: {auditSummary(a.metadata, 'after')}</div>}
            </div>; })}
          </div>}
      </section>
    </div>

    {dialog?.kind === 'edit' && onEditDraft && <Modal eyebrow={`Draft #${dialog.p.id} · v${dialog.p.version}`} title="Edit draft" onClose={() => setDialog(null)}>
      <p className={cx(note, 'mb-3')}>Saved only if the server still holds version {dialog.p.version}. If someone else changed it, refresh and re-open.</p>
      <RuleForm lockProduct testPrefix="edit-draft" submitLabel="Save changes to draft" initial={{ product: (PRODUCTS.some(x => x.value === dialog.p.product) ? dialog.p.product : 'STUDENT_PLATFORM') as RuleProduct, amount: minorToNairaInput(dialog.p.amountMinor), effectiveAt: toLocalInput(dialog.p.effectiveAt), endsAt: toLocalInput(dialog.p.endsAt), reason: dialog.p.reason }} 
        onSubmit={async input => { await onEditDraft(dialog.p.id, { ...input, version: dialog.p.version }); await done(`Draft #${dialog.p.id} updated. Still not active.`); }} />
    </Modal>}
    {dialog?.kind === 'preview' && onPreview && <PreviewDialog p={dialog.p} onPreview={onPreview} onActivate={onActivate} onClose={() => setDialog(null)} onDone={done} />}
    {dialog?.kind === 'retire' && onRetire && <RetireDialog p={dialog.p} onRetire={onRetire} onClose={() => setDialog(null)} onDone={done} />}
    {dialog?.kind === 'verify' && onVerifyBank && <VerifyDialog a={dialog.a} onVerify={onVerifyBank} onClose={() => setDialog(null)} onDone={done} />}
  </div>;
}

/* ---------- Preview + activation ---------- */
function PreviewDialog({ p, onPreview, onActivate, onClose, onDone }: { p: RuleProposalSnapshot; onPreview: NonNullable<SubscriptionPaymentRulesProps['onPreview']>; onActivate?: SubscriptionPaymentRulesProps['onActivate']; onClose: () => void; onDone: (m: string) => Promise<void> }) {
  const [res, setRes] = useState<RulePreviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(false);
  const runPreview = async () => {
    setBusy(true); setErr(''); setConfirm(false); setRes(null);
    try { setRes(await onPreview(p.id)); } catch (e) { setErr(safeError(e)); } finally { setBusy(false); }
  };
  const activate = async () => {
    if (!res?.previewDigest || !res.activationAvailable || !confirm || !onActivate) return;
    setBusy(true); setErr('');
    try { await onActivate(p.id, { version: res.rule.version, previewDigest: res.previewDigest }); await onDone(`Proposal #${p.id} activation submitted. Status shown below is the server's.`); }
    catch (e) { setErr(safeError(e)); setConfirm(false); } finally { setBusy(false); }
  };
  const r = res?.rule;
  return <Modal eyebrow={`Proposal #${p.id}`} title="Preview activation" onClose={onClose}>
    <div className="space-y-4" data-testid="dialog-preview">
      <p className={note}>Preview asks the server whether this draft can be activated. Nothing changes until you confirm and press Activate.</p>
      <Button variant="outline" onClick={runPreview} disabled={busy} testId="button-run-preview"><Eye className="h-4 w-4" /> {busy && !res ? 'Checking…' : res ? 'Run preview again' : 'Run preview'}</Button>
      {err && <p role="alert" className={errCls} data-testid="text-preview-error">{err}</p>}
      {r && <div className="space-y-2 rounded-xl border border-[hsl(var(--border))] p-4 text-sm" data-testid="preview-summary">
        <div className="font-bold">{productLabel(r.product)} · {ngnMinor(r.amountMinor)} {r.currency}</div>
        <div className={note}>v{r.version} · effective {dt(r.effectiveAt)} · ends {r.endsAt ? dt(r.endsAt) : 'open-ended'} · school share {ngnMinor(r.schoolShareMinor)}</div>
        <div className="break-all font-mono text-xs" data-testid="text-preview-digest">Digest: {res?.previewDigest ?? 'none issued'}</div>
      </div>}
      {res && !res.activationAvailable && <div role="alert" className="rounded-xl border border-[hsl(var(--destructive)/.4)] bg-[hsl(var(--destructive)/.06)] p-3 text-sm font-semibold" data-testid="text-preview-blocker">Activation blocked: {res.blocker || 'The server did not permit activation.'} This draft stays inactive.</div>}
      {res?.activationAvailable && res.previewDigest && (onActivate ? <>
        <Check checked={confirm} onChange={setConfirm} testId="checkbox-confirm-activate">I reviewed the amount, product, dates and digest above and authorize activation of this exact version.</Check>
        <Button onClick={activate} disabled={!confirm || busy} testId="button-activate">{busy ? 'Activating…' : 'Activate this version'}</Button>
      </> : <Unwired what="Activation" />)}
    </div>
  </Modal>;
}

/* ---------- Retire ---------- */
function RetireDialog({ p, onRetire, onClose, onDone }: { p: RuleProposalSnapshot; onRetire: NonNullable<SubscriptionPaymentRulesProps['onRetire']>; onClose: () => void; onDone: (m: string) => Promise<void> }) {
  const [reason, setReason] = useState(''); const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 10) { setErr('Give a retirement reason of at least 10 characters.'); return; }
    if (!confirm) { setErr('Confirm retirement to continue.'); return; }
    setBusy(true); setErr('');
    try { await onRetire(p.id, { reason: reason.trim() }); await onDone(`Proposal #${p.id} retirement submitted.`); } catch (er) { setErr(safeError(er)); } finally { setBusy(false); }
  };
  return <Modal eyebrow={`Proposal #${p.id} · ${p.status}`} title="Retire rule" onClose={onClose}>
    <form onSubmit={submit} className="space-y-4" data-testid="form-retire">
      <p className={note}>Retirement stops this rule from applying to future subscriptions. Historical records are not rewritten.</p>
      <Field label="Retirement reason"><textarea className={cx(entry, 'min-h-[76px]')} value={reason} onChange={e => setReason(e.target.value)} data-testid="input-retire-reason" /></Field>
      <Check checked={confirm} onChange={setConfirm} testId="checkbox-confirm-retire">I confirm retiring {productLabel(p.product)} v{p.version} ({ngnMinor(p.amountMinor)}).</Check>
      {err && <p role="alert" className={errCls} data-testid="text-retire-error">{err}</p>}
      <Button type="submit" variant="danger" disabled={busy} testId="button-confirm-retire">{busy ? 'Retiring…' : 'Retire rule'}</Button>
    </form>
  </Modal>;
}

/* ---------- Assistance request ---------- */
function AssistanceForm({ onSubmit }: { onSubmit: (i: AssistanceRequestInput) => Promise<void> }) {
  const blank = { schoolId: '', studentId: '', termId: '', amount: '3200', note: '' };
  const [f, setF] = useState(blank); const [err, setErr] = useState<string[]>([]); const [busy, setBusy] = useState(false);
  const id = (k: 'schoolId' | 'studentId' | 'termId') => (e: { target: { value: string } }) => setF(p => ({ ...p, [k]: e.target.value.replace(/\D/g, '') }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: string[] = []; const amountMinor = nairaToMinor(f.amount);
    if (!Number(f.schoolId) || !Number(f.studentId) || !Number(f.termId)) errs.push('School, student and term IDs are required.');
    if (amountMinor === null || amountMinor <= 0) errs.push('Enter a valid naira amount (max two decimals).');
    if (f.note.trim().length < 5) errs.push('Add a short note describing the request.');
    if (errs.length || amountMinor === null) { setErr(errs); return; }
    setBusy(true); setErr([]);
    try { await onSubmit({ schoolId: Number(f.schoolId), studentId: Number(f.studentId), termId: Number(f.termId), amountMinor, requestNote: f.note.trim() }); setF(blank); } catch (er) { setErr([safeError(er)]); } finally { setBusy(false); }
  };
  return <form onSubmit={submit} className="space-y-4" data-testid="form-assistance">
    <div className="grid grid-cols-3 gap-2">
      <Field label="School ID"><input className={entry} inputMode="numeric" value={f.schoolId} onChange={id('schoolId')} data-testid="input-assist-school" /></Field>
      <Field label="Student ID"><input className={entry} inputMode="numeric" value={f.studentId} onChange={id('studentId')} data-testid="input-assist-student" /></Field>
      <Field label="Term ID"><input className={entry} inputMode="numeric" value={f.termId} onChange={id('termId')} data-testid="input-assist-term" /></Field>
    </div>
    <Field label="Amount (₦)"><input className={entry} inputMode="decimal" value={f.amount} onChange={e => setF(p => ({ ...p, amount: e.target.value }))} data-testid="input-assist-amount" /></Field>
    <Field label="Request note"><textarea className={cx(entry, 'min-h-[68px]')} value={f.note} onChange={e => setF(p => ({ ...p, note: e.target.value }))} data-testid="input-assist-note" /></Field>
    {err.length > 0 && <ul role="alert" className={cx(errCls, 'list-disc pl-5')} data-testid="errors-assistance">{err.map(m => <li key={m}>{m}</li>)}</ul>}
    <Button type="submit" disabled={busy} testId="button-request-assistance">{busy ? 'Recording…' : 'Record request (unverified)'}</Button>
  </form>;
}

/* ---------- Bank verification ---------- */
function VerifyDialog({ a, onVerify, onClose, onDone }: { a: AssistanceSnapshot; onVerify: NonNullable<SubscriptionPaymentRulesProps['onVerifyBank']>; onClose: () => void; onDone: (m: string) => Promise<void> }) {
  const [f, setF] = useState({ bankName: '', ref: '', creditDate: '', amount: '' }); const [checked, setChecked] = useState(false);
  const [err, setErr] = useState<string[]>([]); const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: string[] = []; const minor = nairaToMinor(f.amount);
    if (f.bankName.trim().length < 2) errs.push('Enter the bank name.');
    if (f.ref.trim().length < 4) errs.push('Enter the bank statement reference.');
    if (!f.creditDate || f.creditDate > today) errs.push('Enter a credit date that is not in the future.');
    if (minor === null || minor <= 0) errs.push('Enter the credited amount exactly as shown on the statement.');
    if (!checked) errs.push('Confirm you checked the bank statement independently.');
    if (errs.length || minor === null) { setErr(errs); return; }
    setBusy(true); setErr([]);
    try { await onVerify(a.id, { bankName: f.bankName.trim(), bankStatementReference: f.ref.trim(), creditDate: f.creditDate, verifiedAmountMinor: minor, independentlyChecked: true }); await onDone(`Bank verification recorded for case #${a.id}.`); }
    catch (er) { setErr([safeError(er)]); } finally { setBusy(false); }
  };
  const minor = nairaToMinor(f.amount);
  return <Modal eyebrow={`Case #${a.id} · requested ${ngnMinor(a.amountMinor)}`} title="Independent bank verification" onClose={onClose}>
    <form onSubmit={submit} className="space-y-4" data-testid="form-verify-bank">
      <p className={note}>Record only what you confirmed on the platform's own bank statement. Receipts, screenshots and the request itself are not evidence of credit.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Bank name"><input className={entry} value={f.bankName} onChange={e => setF(p => ({ ...p, bankName: e.target.value }))} data-testid="input-verify-bank" /></Field>
        <Field label="Statement reference"><input className={entry} value={f.ref} onChange={e => setF(p => ({ ...p, ref: e.target.value }))} data-testid="input-verify-ref" /></Field>
        <Field label="Credit date"><input type="date" max={today} className={entry} value={f.creditDate} onChange={e => setF(p => ({ ...p, creditDate: e.target.value }))} data-testid="input-verify-date" /></Field>
        <Field label="Credited amount (₦)"><input className={entry} inputMode="decimal" value={f.amount} onChange={e => setF(p => ({ ...p, amount: e.target.value }))} data-testid="input-verify-amount" /></Field>
      </div>
      {minor !== null && minor !== a.amountMinor && <p className="text-xs font-bold text-[hsl(var(--destructive))]" data-testid="text-verify-mismatch">Credited amount differs from the requested {ngnMinor(a.amountMinor)}. Record the statement figure as-is.</p>}
      <Check checked={checked} onChange={setChecked} testId="checkbox-independently-checked">I independently checked this credit on the bank statement myself, not from a receipt or upload.</Check>
      {err.length > 0 && <ul role="alert" className={cx(errCls, 'list-disc pl-5')} data-testid="errors-verify">{err.map(m => <li key={m}>{m}</li>)}</ul>}
      <Button type="submit" disabled={busy} testId="button-submit-verify">{busy ? 'Recording…' : 'Record bank verification'}</Button>
    </form>
  </Modal>;
}

export default SubscriptionPaymentRulesPage;
