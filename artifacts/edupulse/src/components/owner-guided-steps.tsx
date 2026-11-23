import type { ReactNode } from 'react';
import { CheckCircle2, CircleDashed, CircleSlash, MinusCircle } from 'lucide-react';
import { cx } from '@/components/shared';

export type StepState = 'done' | 'open' | 'blocked' | 'na';
export type GuidedStep = { id: string; title: string; state: StepState; detail: ReactNode };

const OK = new Set(['READY', 'PASS', 'PASSED', 'OK', 'COMPLETE']);
const NA = new Set(['NOT_APPLICABLE', 'N/A', 'NA', 'RETIRED', 'SKIPPED']);
const BAD = new Set(['FAILED', 'BLOCKED', 'REJECTED', 'EXPIRED']);

export function checkState(status: string): StepState {
  const s = String(status).toUpperCase();
  return OK.has(s) ? 'done' : NA.has(s) ? 'na' : BAD.has(s) ? 'blocked' : 'open';
}

type Check = { code: string; label: string; status: string; detail: string };
/** Exact check codes emitted by api-server services/direct-student-live-release.ts (8 codes). */
export const READINESS_GROUPS: { id: string; title: string; codes: string[] }[] = [
  { id: 'merchant', title: 'Merchant capability (independent evidence)', codes: ['NON_SPLIT_EVIDENCE'] },
  { id: 'config', title: 'App configuration', codes: ['MERCHANT_CONFIG'] },
  { id: 'webhook', title: 'Callback and webhook configuration', codes: ['HTTPS_ENDPOINTS'] },
  { id: 'settlement', title: 'School/term reconciliation evidence', codes: ['RECONCILIATION'] },
  { id: 'release', title: 'Platform release controls', codes: ['SCHEMA', 'STUDENT_RULE', 'COLLECTION_ROLLOUT', 'RUNTIME_SWITCH'] },
];
export const LEGACY_STEPS: GuidedStep[] = [
  { id: 'legacy-split', title: 'Split settlement / school subaccounts', state: 'na', detail: 'Retired. Direct collection settles 100% to the Platform Owner merchant; not a prerequisite and not a pass.' },
  { id: 'legacy-hosted', title: 'Legacy hosted checkout', state: 'na', detail: 'Retired. Not a prerequisite and not a pass.' },
];

/** Groups actual server checks by exact code. A group with no reported check stays "not reported", never done. */
export function groupReadiness(checks: Check[]): GuidedStep[] {
  const known = new Set(READINESS_GROUPS.flatMap(g => g.codes));
  const steps = READINESS_GROUPS.map(g => toStep(g.id, g.title, checks.filter(c => g.codes.includes(c.code))));
  const rest = checks.filter(c => !known.has(c.code));
  if (rest.length) steps.push(toStep('other', 'Other reported checks', rest));
  return [...steps,
    {id:'webhook-proof',title:'Independent webhook verification',state:'open' as const,
      detail:'Not reported separately by this readiness endpoint. HTTPS callback/webhook configuration is not proof of authenticated webhook receipt or verified collection.'},
    {id:'bank-proof',title:'Applicable bank / settlement evidence',state:'open' as const,
      detail:'Not reported separately by this readiness endpoint. Review existing independently verified merchant settlement and payout evidence where applicable. School/term reconciliation and collection readiness do not prove bank credit or BRO payout capability.'},
    ...LEGACY_STEPS];
}

function toStep(id: string, title: string, items: Check[]): GuidedStep {
  if (!items.length) return { id, title, state: 'open', detail: 'Not reported by the server for this scope. Treat as unverified.' };
  // An explicit server N/A is shown as such; it is never counted as verified.
  const states = items.map(c => checkState(c.status));
  const state: StepState = states.includes('blocked') ? 'blocked' : states.includes('open') ? 'open' : states.every(s => s === 'na') ? 'na' : 'done';
  return { id, title, state, detail: <ul className="space-y-0.5">{items.map(c => <li key={c.code}><b>{c.label}</b> · {String(c.status).toUpperCase()} · {c.detail}</li>)}</ul> };
}

const ICON = { done: CheckCircle2, open: CircleDashed, blocked: CircleSlash, na: MinusCircle } as const;
const WORD = { done: 'Verified', open: 'Needs evidence', blocked: 'Blocked', na: 'Not applicable' } as const;
const TONE = { done: 'text-emerald-700', open: 'text-amber-700', blocked: 'text-rose-700', na: 'text-[hsl(var(--muted-foreground))]' } as const;

export function GuidedSteps({ steps, testId, label }: { steps: GuidedStep[]; testId: string; label: string }) {
  return <ol aria-label={label} className="divide-y divide-[hsl(var(--border))] rounded-xl border border-[hsl(var(--border))]" data-testid={testId}>
    {steps.map((s, i) => { const Icon = ICON[s.state]; return <li key={s.id} className="flex gap-3 p-3 text-sm" data-testid={`${testId}-${s.id}`}>
      <Icon size={18} className={cx('mt-0.5 shrink-0', TONE[s.state])} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-bold"><span className="mr-1 font-mono text-xs opacity-60">{i + 1}</span>{s.title}</span>
          <span className={cx('text-xs font-bold', TONE[s.state])} data-testid={`${testId}-${s.id}-state`}>{WORD[s.state]}</span></div>
        <div className="mt-1 break-words text-xs leading-5 text-[hsl(var(--muted-foreground))]">{s.detail}</div>
      </div></li>; })}
  </ol>;
}
