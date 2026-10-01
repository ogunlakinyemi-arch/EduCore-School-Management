import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Briefcase, CreditCard, History, Lock, RefreshCw, ShieldAlert, UserRound } from 'lucide-react';
import {
  useAssignEmployeeNfcCard, useChangeEmployeeNfcCardStatus, useGetAuthorizedContext, useGetMyEmployeeNfcProfile,
  useGetSchoolEmployeeNfcAttendanceDaily, useGetSchoolEmployeeNfcAttendanceMonthly, useGetSchoolEmployeeNfcId,
  useListEmployeeNfcCardHistory, useListEmployeeNfcCards, useListMyEmployeeNfcAttendance,
  useListSchoolEmployeeNfcAttendance, useListSchoolEmployeeNfcAttendanceDiscrepancies,
  useReplaceEmployeeNfcCard, useResolveSchoolEmployeeNfcAttendanceDiscrepancy,
} from '@workspace/api-client-react';
import type {
  EmployeeNfcCardView, EmployeeNfcProfile, ResolveSchoolEmployeeNfcAttendanceDiscrepancyBodyResolution,
} from '@workspace/api-client-react';
import {
  Button, EmptyState, ErrorState, Field, Info, Metric, Modal, PageHeading, SkeletonPage, StatusPill,
  TenantPicker, cx, date, time, useTenant,
} from '@/components/shared';

const FRESH = { staleTime: 15_000, refetchOnMount: 'always' as const, refetchOnWindowFocus: true };

type CtxLike = { isPlatformOwner?: boolean; roles?: Array<{ schoolId?: number | null; role: string; status: string }> } | undefined;

/** Pure role resolution. Corporate/payroll roles never receive NFC access. */
export function employeeNfcAccess(context: CtxLike, schoolId: number) {
  const owner = context?.isPlatformOwner === true;
  const active = (context?.roles ?? []).filter(r => r.status === 'ACTIVE');
  const corporate = active.some(r => r.role === 'COMPANY_ACCOUNTANT' || r.role === 'DEVICE_ACTIVATION_OFFICER');
  if (corporate && !owner) return { canView: false, canManageCards: false, canResolve: false, readOnlyAttendance: false, isOwner: false };
  const admin = !owner && !!schoolId && active.some(r => r.schoolId === schoolId && r.role === 'SCHOOL_ADMIN');
  return {
    isOwner: owner,
    canView: owner || admin,
    canManageCards: owner || admin,
    canResolve: admin,
    readOnlyAttendance: owner,
  };
}

/** Activation is only offered for a locked card whose term subscription is paid. */
export function activationBlockedReason(card: Pick<EmployeeNfcCardView, 'status' | 'termEligibility' | 'nfcEligible' | 'paymentRequired'>): string | null {
  if (card.status !== 'LOCKED') return 'Only a locked card can be activated.';
  if (card.termEligibility !== 'PAID' && (card.paymentRequired || !card.nfcEligible)) {
    return card.termEligibility === 'PENDING' ? 'Term payment is pending. Activation stays locked until it is verified.' : 'Term subscription is not paid. Activation stays locked.';
  }
  return null;
}

const monthNow = () => new Date().toISOString().slice(0, 7);
const dayNow = () => new Date().toISOString().slice(0, 10);
const errMsg = (e: unknown, fallback: string) => (e as { data?: { error?: string }; message?: string })?.data?.error || fallback;

function IdentityBadge({ type }: { type?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--primary)/.35)] bg-[hsl(var(--primary)/.08)] px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-[hsl(var(--primary))]" data-testid="badge-employee-identity">
      <Briefcase size={12} /> Employee {type ? `· ${type.toLowerCase()}` : 'card'}
    </span>
  );
}

function EligibilityPill({ value }: { value: string }) {
  return <StatusPill value={value === 'NOT_CONFIGURED' ? 'Not configured' : value} />;
}

function Tabs<T extends string>({ items, value, onChange }: { items: T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl bg-[hsl(var(--muted)/.45)] p-1">
      {items.map(i => (
        <button key={i} type="button" onClick={() => onChange(i)} className={cx('rounded-lg px-3 py-2 text-xs font-bold capitalize transition-colors', value === i ? 'bg-[hsl(var(--card))] text-[hsl(var(--primary))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]')}>{i}</button>
      ))}
    </div>
  );
}

function useRefreshNfc() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ predicate: q => String(q.queryKey[0] ?? '').toLowerCase().includes('employee-nfc') || String(q.queryKey[0] ?? '').toLowerCase().includes('employee_nfc') || JSON.stringify(q.queryKey).toLowerCase().includes('nfc') });
}

/* ------------------------------ ID card ------------------------------ */

function EmployeeIdCard({ p }: { p: EmployeeNfcProfile }) {
  return (
    <div className="panel relative overflow-hidden p-0" data-testid="employee-id-card">
      <div className="flex items-center justify-between bg-[hsl(var(--primary))] px-5 py-3 text-[hsl(var(--primary-foreground))]">
        <div className="flex items-center gap-3">
          {p.schoolLogo ? <img src={p.schoolLogo} alt="" className="h-9 w-9 rounded-lg bg-white/90 object-contain p-0.5" /> : <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/15"><Briefcase size={16} /></span>}
          <div>
            <div className="text-sm font-bold">{p.schoolName ?? 'School'}</div>
            <div className="text-[10px] uppercase tracking-widest opacity-80">Employee identity card</div>
          </div>
        </div>
        <span className="rounded bg-white/15 px-2 py-1 text-[10px] font-bold uppercase tracking-widest">Not a student card</span>
      </div>
      <div className="grid gap-5 p-5 sm:grid-cols-[120px_1fr]">
        <div className="grid h-36 w-28 place-items-center overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
          {p.photo ? <img src={p.photo} alt={p.employeeName} className="h-full w-full object-cover" /> : <UserRound size={36} className="text-[hsl(var(--muted-foreground))]" />}
        </div>
        <div className="space-y-3">
          <div>
            <div className="display-font text-2xl font-bold">{p.employeeName}</div>
            <div className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{p.roleTitle || p.personType}</div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Info label="Employee no." value={p.employeeNo} />
            <Info label="Role" value={p.personType} />
            <Info label="NFC identifier" value={p.uid ? <span className="font-mono">{p.uid}</span> : 'Not assigned'} />
            <Info label="Card status" value={<StatusPill value={p.status} />} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Self page ------------------------------ */

export function MyEmployeeNfcPage() {
  const profile = useGetMyEmployeeNfcProfile({ query: { ...FRESH, queryKey: ['my-employee-nfc-profile'] } as never });
  const month = monthNow();
  const from = `${month}-01`;
  const to = dayNow();
  const att = useListMyEmployeeNfcAttendance({ from, to }, { query: { ...FRESH, enabled: profile.isSuccess } as never });

  if (profile.isLoading) return <SkeletonPage />;
  if (profile.isError) return <ErrorState retry={() => profile.refetch()} message={errMsg(profile.error, 'Your employee NFC profile is not available for this account.')} />;
  const p = profile.data as EmployeeNfcProfile | undefined;
  if (!p) return <EmptyState icon={CreditCard} title="No employee card record" description="Your school has not set up an employee NFC identity for you yet." />;

  const events = att.data ?? [];
  const entries = events.filter(e => e.eventType === 'SCHOOL_ENTRY');
  const days = new Set(entries.map(e => e.occurredAt.slice(0, 10))).size;
  const late = events.filter(e => e.status === 'LATE').length;
  const early = events.filter(e => e.status === 'LEFT_EARLY').length;

  return (
    <div className="fade-up">
      <PageHeading eyebrow="My workspace / Employee NFC" title="My employee card" description="Your staff identity. This card records your own attendance only and is separate from any student card." action={<Button variant="outline" onClick={() => { void profile.refetch(); void att.refetch(); }}><RefreshCw size={15} />Refresh</Button>} />
      <div className="mb-5"><IdentityBadge type={p.personType} /></div>
      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <EmployeeIdCard p={p} />
        <div className="panel space-y-4 p-5">
          <div className="eyebrow">Subscription</div>
          <div className="flex flex-wrap items-center gap-3">
            <EligibilityPill value={p.termEligibility} />
            <span className="text-sm">{p.nfcEligible ? 'Eligible for NFC attendance' : 'Not eligible for NFC attendance yet'}</span>
          </div>
          <Info label="Current term" value={p.currentTerm ? `${p.currentTerm.termName} · ${p.currentTerm.academicYear}` : 'No current term'} />
          <Info label="Activated" value={p.activatedAt ? date(p.activatedAt) : 'Not activated'} />
          {p.status === 'LOCKED' && <p className="flex gap-2 text-sm text-[hsl(var(--muted-foreground))]"><Lock size={16} className="mt-0.5 shrink-0" />Your card is locked until your school activates it after payment is verified.</p>}
          <Link href="/my-nfc-subscription" className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-bold hover:border-[hsl(var(--primary)/.4)]" data-testid="link-my-nfc-subscription"><BadgeCheck size={15} />Open my NFC subscription</Link>
        </div>
      </div>
      <div className="mt-8">
        <h2 className="display-font mb-4 text-xl font-bold">This month, so far</h2>
        {att.isError ? <ErrorState retry={() => att.refetch()} message="Could not load your attendance for this month." /> : att.isLoading ? <SkeletonPage /> : (
          <>
            <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Days attended" value={days} icon={BadgeCheck} accent />
              <Metric label="Late arrivals" value={late} icon={History} />
              <Metric label="Early departures" value={early} icon={ShieldAlert} />
              <Metric label="Scans recorded" value={events.length} icon={CreditCard} />
            </div>
            <div className="panel overflow-hidden"><EventRows rows={events} /></div>
          </>
        )}
      </div>
    </div>
  );
}

function EventRows({ rows, names }: { rows: Array<{ id: number; employeeId: number; eventType: string; status: string; occurredAt: string; identificationMethod: string; discrepancy: boolean }>; names?: Map<number, string> }) {
  if (!rows.length) return <EmptyState icon={History} title="No attendance recorded" description="Check-ins and check-outs appear here once recorded for this period." />;
  return (
    <div className="divide-y divide-[hsl(var(--border)/.6)]">
      {rows.map(r => (
        <div key={r.id} className="grid gap-2 px-5 py-3.5 text-sm md:grid-cols-[1.4fr_1fr_1fr_1fr_auto] md:items-center">
          <div className="font-semibold">{names ? (names.get(r.employeeId) ?? `Employee #${r.employeeId}`) : (r.eventType === 'SCHOOL_ENTRY' ? 'Check-in' : 'Check-out')}</div>
          <div>{r.eventType === 'SCHOOL_ENTRY' ? 'Check-in' : 'Check-out'} · {date(r.occurredAt)} {time(r.occurredAt)}</div>
          <div><StatusPill value={r.status} /></div>
          <div className="text-xs text-[hsl(var(--muted-foreground))]">{r.identificationMethod}</div>
          <div>{r.discrepancy && <StatusPill value="attention" />}</div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ Admin / Owner page ------------------------------ */

type AdminTab = 'cards' | 'attendance' | 'summary' | 'discrepancies';
const AdminTabs = Tabs<AdminTab>;
const DiscrepancyTabs = Tabs<'OPEN' | 'RESOLVED'>;

export function EmployeeNfcPage() {
  const { schoolId } = useTenant();
  const ctx = useGetAuthorizedContext();
  const access = employeeNfcAccess(ctx.data as CtxLike, schoolId);
  const [tab, setTab] = useState<AdminTab>('cards');

  if (ctx.isLoading) return <SkeletonPage />;
  if (ctx.isError) return <ErrorState retry={() => ctx.refetch()} />;
  const head = (
    <PageHeading eyebrow="Operations / Employee NFC" title="Employee NFC" description="Staff and teacher identity cards, kept apart from student cards so attendance lands on the right person." action={<TenantPicker />} />
  );
  if (!access.canView && !schoolId && access.isOwner) return <div className="fade-up">{head}<EmptyState icon={Briefcase} title="Select a school" description="Choose a school to inspect its employee NFC cards and attendance." /></div>;
  if (!access.canView) return <div className="fade-up">{head}<EmptyState icon={ShieldAlert} title="Employee NFC is not available" description="Your role in this school is not authorised to manage employee NFC cards." /></div>;
  if (!schoolId) return <div className="fade-up">{head}<EmptyState icon={Briefcase} title="Select a school" description="Choose a school to continue." /></div>;

  return (
    <div className="fade-up" data-testid="employee-nfc-page">
      {head}
      <div className="mb-5 flex flex-wrap items-center gap-3"><IdentityBadge />{access.readOnlyAttendance && <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))]" data-testid="owner-readonly-note">Owner view: attendance and discrepancies are read-only. Card lifecycle controls remain available.</span>}</div>
      <div className="panel overflow-hidden">
        <div className="border-b border-[hsl(var(--border))] p-4"><AdminTabs items={['cards', 'attendance', 'summary', 'discrepancies']} value={tab} onChange={setTab} /></div>
        {tab === 'cards' && <CardsTab key={schoolId} schoolId={schoolId} canManage={access.canManageCards} />}
        {tab === 'attendance' && <AttendanceTab key={schoolId} schoolId={schoolId} />}
        {tab === 'summary' && <SummaryTab key={schoolId} schoolId={schoolId} />}
        {tab === 'discrepancies' && <DiscrepancyTab key={schoolId} schoolId={schoolId} canResolve={access.canResolve} />}
      </div>
    </div>
  );
}

type Dialog = { kind: 'assign'; card: EmployeeNfcCardView } | { kind: 'status'; card: EmployeeNfcCardView; action: 'ACTIVATE' | 'LOCK' | 'DEACTIVATE' } | { kind: 'replace'; card: EmployeeNfcCardView } | { kind: 'history'; card: EmployeeNfcCardView } | { kind: 'id'; card: EmployeeNfcCardView } | null;

function CardsTab({ schoolId, canManage }: { schoolId: number; canManage: boolean }) {
  const [search, setSearch] = useState('');
  const [personType, setPersonType] = useState('');
  const [status, setStatus] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const params = { search: search || undefined, personType: (personType || undefined) as 'TEACHER' | 'STAFF' | undefined, status: (status || undefined) as 'ACTIVE' | undefined, limit: 100 };
  const list = useListEmployeeNfcCards(schoolId, params, { query: { ...FRESH, enabled: !!schoolId } as never });
  const cards = list.data ?? [];

  return (
    <div>
      <div className="flex flex-wrap gap-2 border-b border-[hsl(var(--border))] p-4">
        <input type="search" placeholder="Search name or employee no." value={search} onChange={e => setSearch(e.target.value)} aria-label="Search employees" className="min-w-[200px] flex-1" />
        <select value={personType} onChange={e => setPersonType(e.target.value)} aria-label="Employee role"><option value="">Teachers and staff</option><option value="TEACHER">Teachers</option><option value="STAFF">Staff</option></select>
        <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Card status"><option value="">All statuses</option>{['UNASSIGNED', 'LOCKED', 'ACTIVE', 'DEACTIVATED', 'REPLACED'].map(s => <option key={s} value={s}>{s.toLowerCase()}</option>)}</select>
        <Button variant="outline" onClick={() => list.refetch()}><RefreshCw size={15} />Refresh</Button>
      </div>
      {list.isLoading ? <div className="p-6"><SkeletonPage /></div> : list.isError ? <ErrorState retry={() => list.refetch()} message={errMsg(list.error, 'Could not load employee cards.')} /> : !cards.length ? (
        <EmptyState icon={CreditCard} title="No employee cards match" description="Teachers and staff appear here once added under Employees. Adjust the filters to widen the list." />
      ) : (
        <div className="divide-y divide-[hsl(var(--border)/.6)]">
          {cards.map(c => {
            const blocked = activationBlockedReason(c);
            return (
              <div key={`${c.employeeId}-${c.cardId ?? 'none'}`} className="grid gap-3 px-5 py-4 lg:grid-cols-[1.4fr_1fr_1fr_auto] lg:items-center" data-testid={`employee-card-row-${c.employeeId}`}>
                <div>
                  <div className="flex flex-wrap items-center gap-2"><span className="font-bold">{c.employeeName}</span><IdentityBadge type={c.personType} /></div>
                  <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{c.employeeNo} · {c.uid ? <span className="font-mono">{c.uid}</span> : 'no card'} · {c.scans} scans</div>
                </div>
                <div className="flex flex-wrap items-center gap-2"><StatusPill value={c.status} /></div>
                <div className="text-xs"><EligibilityPill value={c.termEligibility} /><div className="mt-1 text-[hsl(var(--muted-foreground))]">{c.currentTerm ? `${c.currentTerm.termName} ${c.currentTerm.academicYear}` : 'No current term'}</div></div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="quiet" onClick={() => setDialog({ kind: 'id', card: c })}>E-ID</Button>
                  {c.cardId != null && <Button variant="quiet" onClick={() => setDialog({ kind: 'history', card: c })}><History size={14} />History</Button>}
                  {canManage && c.status === 'UNASSIGNED' && <Button onClick={() => setDialog({ kind: 'assign', card: c })}>Assign card</Button>}
                  {canManage && c.cardId != null && c.status === 'LOCKED' && <Button disabled={!!blocked} title={blocked ?? undefined} onClick={() => setDialog({ kind: 'status', card: c, action: 'ACTIVATE' })} testId={`button-activate-${c.employeeId}`}>Activate</Button>}
                  {canManage && c.cardId != null && c.status === 'ACTIVE' && <Button variant="outline" onClick={() => setDialog({ kind: 'status', card: c, action: 'LOCK' })}>Lock</Button>}
                  {canManage && c.cardId != null && (c.status === 'ACTIVE' || c.status === 'LOCKED') && <Button variant="danger" onClick={() => setDialog({ kind: 'status', card: c, action: 'DEACTIVATE' })}>Deactivate</Button>}
                  {canManage && c.cardId != null && ['ACTIVE', 'LOCKED', 'DEACTIVATED'].includes(c.status) && <Button variant="outline" onClick={() => setDialog({ kind: 'replace', card: c })}>Replace</Button>}
                </div>
                {canManage && c.status === 'LOCKED' && blocked && <p className="text-xs text-[hsl(var(--muted-foreground))] lg:col-span-4" data-testid={`activation-blocked-${c.employeeId}`}>{blocked}</p>}
              </div>
            );
          })}
        </div>
      )}
      {dialog?.kind === 'assign' && <Modal title="Assign employee card" eyebrow={dialog.card.employeeName} onClose={() => setDialog(null)}><AssignForm schoolId={schoolId} card={dialog.card} onDone={() => setDialog(null)} /></Modal>}
      {dialog?.kind === 'status' && <Modal title={`${dialog.action.charAt(0)}${dialog.action.slice(1).toLowerCase()} card`} eyebrow={dialog.card.employeeName} onClose={() => setDialog(null)}><StatusForm schoolId={schoolId} card={dialog.card} action={dialog.action} onDone={() => setDialog(null)} /></Modal>}
      {dialog?.kind === 'replace' && <Modal title="Replace card" eyebrow={dialog.card.employeeName} onClose={() => setDialog(null)}><ReplaceForm schoolId={schoolId} card={dialog.card} onDone={() => setDialog(null)} /></Modal>}
      {dialog?.kind === 'history' && dialog.card.cardId != null && <Modal title="Card history" eyebrow={dialog.card.employeeName} onClose={() => setDialog(null)}><HistoryList schoolId={schoolId} cardId={dialog.card.cardId} /></Modal>}
      {dialog?.kind === 'id' && <Modal title="Employee e-ID" eyebrow="School private" onClose={() => setDialog(null)}><IdPreview schoolId={schoolId} employeeId={dialog.card.employeeId} /></Modal>}
    </div>
  );
}

function FormFooter({ pending, error, label, onCancel }: { pending: boolean; error?: string; label: string; onCancel?: () => void }) {
  return (
    <>
      {error && <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{error}</p>}
      <div className="flex justify-end gap-3 border-t border-[hsl(var(--border))] pt-4">
        {onCancel && <Button variant="outline" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" disabled={pending}>{pending ? 'Saving...' : label}</Button>
      </div>
    </>
  );
}

function AssignForm({ schoolId, card, onDone }: { schoolId: number; card: EmployeeNfcCardView; onDone: () => void }) {
  const m = useAssignEmployeeNfcCard();
  const refresh = useRefreshNfc();
  const [uid, setUid] = useState('');
  const [reason, setReason] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate({ schoolId, data: { uid: uid.trim(), employeeId: card.employeeId, personType: card.personType, reason: reason.trim() || undefined } }, { onSuccess: () => { void refresh(); onDone(); } });
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-[hsl(var(--muted-foreground))]">Assigns a school-bound prepared card to this {card.personType.toLowerCase()}. The card starts locked and is activated after term payment.</p>
      <Field label="Card UID (printed or read from the card)"><input required value={uid} onChange={e => setUid(e.target.value)} className="font-mono" /></Field>
      <Field label="Note (optional)"><textarea value={reason} onChange={e => setReason(e.target.value)} /></Field>
      <FormFooter pending={m.isPending} error={m.isError ? errMsg(m.error, 'Could not assign this card. It may be unprepared, used, or belong to another school.') : undefined} label="Assign card" onCancel={onDone} />
    </form>
  );
}

function StatusForm({ schoolId, card, action, onDone }: { schoolId: number; card: EmployeeNfcCardView; action: 'ACTIVATE' | 'LOCK' | 'DEACTIVATE'; onDone: () => void }) {
  const m = useChangeEmployeeNfcCardStatus();
  const refresh = useRefreshNfc();
  const [reason, setReason] = useState('');
  const blocked = action === 'ACTIVATE' ? activationBlockedReason(card) : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (blocked || card.cardId == null) return;
    m.mutate({ schoolId, cardId: card.cardId, data: { action, reason: reason.trim() } }, { onSuccess: () => { void refresh(); onDone(); } });
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      {blocked && <p className="rounded-xl bg-[hsl(35_83%_53%/.15)] p-3 text-sm" role="alert">{blocked}</p>}
      <Field label="Reason (required)"><textarea required minLength={3} value={reason} onChange={e => setReason(e.target.value)} /></Field>
      <FormFooter pending={m.isPending || !!blocked} error={m.isError ? errMsg(m.error, 'The card status was not changed.') : undefined} label={`Confirm ${action.toLowerCase()}`} onCancel={onDone} />
    </form>
  );
}

function ReplaceForm({ schoolId, card, onDone }: { schoolId: number; card: EmployeeNfcCardView; onDone: () => void }) {
  const m = useReplaceEmployeeNfcCard();
  const refresh = useRefreshNfc();
  const [uid, setUid] = useState('');
  const [reason, setReason] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (card.cardId == null) return;
    m.mutate({ schoolId, cardId: card.cardId, data: { uid: uid.trim(), reason: reason.trim() } }, { onSuccess: () => { void refresh(); onDone(); } });
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-[hsl(var(--muted-foreground))]">The current card ({card.uid ?? 'none'}) is retired and its history is kept.</p>
      <Field label="New card UID"><input required value={uid} onChange={e => setUid(e.target.value)} className="font-mono" /></Field>
      <Field label="Reason (required)"><textarea required minLength={3} value={reason} onChange={e => setReason(e.target.value)} /></Field>
      <FormFooter pending={m.isPending} error={m.isError ? errMsg(m.error, 'Could not replace this card.') : undefined} label="Replace card" onCancel={onDone} />
    </form>
  );
}

function HistoryList({ schoolId, cardId }: { schoolId: number; cardId: number }) {
  const q = useListEmployeeNfcCardHistory(schoolId, cardId, { query: { ...FRESH } as never });
  if (q.isLoading) return <div className="h-24 animate-pulse rounded-xl bg-[hsl(var(--muted))]" />;
  if (q.isError) return <ErrorState retry={() => q.refetch()} />;
  const rows = q.data ?? [];
  if (!rows.length) return <EmptyState icon={History} title="No history yet" description="Lifecycle events for this card will be listed here." />;
  return (
    <ol className="space-y-3">
      {rows.map(h => (
        <li key={h.id} className="rounded-xl border border-[hsl(var(--border))] p-3 text-sm">
          <div className="flex items-center justify-between gap-2"><strong>{h.action.replaceAll('_', ' ')}</strong><span className="text-xs text-[hsl(var(--muted-foreground))]">{date(h.occurredAt)} {time(h.occurredAt)}</span></div>
          {(h.previousStatus || h.newStatus) && <div className="mt-1 text-xs">{h.previousStatus ?? '—'} to {h.newStatus ?? '—'}</div>}
          {h.reason && <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{h.reason}</div>}
        </li>
      ))}
    </ol>
  );
}

function IdPreview({ schoolId, employeeId }: { schoolId: number; employeeId: number }) {
  const q = useGetSchoolEmployeeNfcId(schoolId, employeeId, { query: { ...FRESH } as never });
  if (q.isLoading) return <div className="h-40 animate-pulse rounded-xl bg-[hsl(var(--muted))]" />;
  if (q.isError || !q.data) return <ErrorState retry={() => q.refetch()} message="This employee e-ID could not be loaded." />;
  return <EmployeeIdCard p={q.data} />;
}

/* ---- attendance ---- */

function useNameMap(schoolId: number) {
  const l = useListEmployeeNfcCards(schoolId, { limit: 200 }, { query: { ...FRESH, enabled: !!schoolId } as never });
  return useMemo(() => new Map((l.data ?? []).map(c => [c.employeeId, c.employeeName])), [l.data]);
}

function AttendanceTab({ schoolId }: { schoolId: number }) {
  const [from, setFrom] = useState(() => new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(dayNow);
  const [status, setStatus] = useState('');
  const names = useNameMap(schoolId);
  const q = useListSchoolEmployeeNfcAttendance(schoolId, { from, to, status: (status || undefined) as 'LATE' | undefined }, { query: { ...FRESH } as never });
  return (
    <div>
      <div className="flex flex-wrap gap-3 border-b border-[hsl(var(--border))] p-4 text-xs font-semibold">
        <label className="flex items-center gap-2">From <input type="date" value={from} onChange={e => e.target.value && setFrom(e.target.value)} /></label>
        <label className="flex items-center gap-2">To <input type="date" value={to} onChange={e => e.target.value && setTo(e.target.value)} /></label>
        <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Attendance status"><option value="">All statuses</option>{['PRESENT', 'LATE', 'LEFT_EARLY', 'EXCUSED', 'UNKNOWN', 'MISMATCH'].map(s => <option key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</option>)}</select>
      </div>
      {q.isLoading ? <div className="p-6"><SkeletonPage /></div> : q.isError ? <ErrorState retry={() => q.refetch()} /> : <EventRows rows={q.data ?? []} names={names} />}
    </div>
  );
}

function SummaryTab({ schoolId }: { schoolId: number }) {
  const [day, setDay] = useState(dayNow);
  const [month, setMonth] = useState(monthNow);
  const daily = useGetSchoolEmployeeNfcAttendanceDaily(schoolId, { date: day }, { query: { ...FRESH } as never });
  const monthly = useGetSchoolEmployeeNfcAttendanceMonthly(schoolId, { month }, { query: { ...FRESH, enabled: /^\d{4}-(0[1-9]|1[0-2])$/.test(month) } as never });
  const d = daily.data;
  return (
    <div className="p-5">
      <div className="mb-4 flex flex-wrap gap-3 text-xs font-semibold">
        <label className="flex items-center gap-2">Day <input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} /></label>
        <label className="flex items-center gap-2">Month <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} /></label>
      </div>
      {daily.isError ? <ErrorState retry={() => daily.refetch()} /> : daily.isLoading ? <div className="h-32 animate-pulse rounded-2xl bg-[hsl(var(--muted))]" /> : d && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label="Employees" value={d.employees} icon={Briefcase} />
          <Metric label="Check-ins" value={d.entries} icon={BadgeCheck} accent />
          <Metric label="Check-outs" value={d.exits} icon={History} />
          <Metric label="Late" value={d.late} icon={ShieldAlert} />
          <Metric label="Discrepancies" value={d.discrepancies} icon={ShieldAlert} />
        </div>
      )}
      {monthly.isError ? <ErrorState retry={() => monthly.refetch()} /> : monthly.isLoading ? <div className="h-32 animate-pulse rounded-2xl bg-[hsl(var(--muted))]" /> : !(monthly.data ?? []).length ? (
        <EmptyState icon={History} title="No monthly records" description="No employee attendance was recorded for this month." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[hsl(var(--border))]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[hsl(var(--muted)/.4)] text-xs uppercase tracking-wider text-[hsl(var(--muted-foreground))]"><tr>{['Employee', 'Days', 'Late', 'Early departures', 'Check-ins', 'Check-outs'].map(h => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-[hsl(var(--border)/.6)]">
              {(monthly.data ?? []).map(r => <tr key={r.employeeId}><td className="px-4 py-3 font-semibold">{r.employeeName}<div className="text-xs font-normal text-[hsl(var(--muted-foreground))]">{r.employeeNo} · {r.personType}</div></td><td className="px-4 py-3">{r.attendanceDays}</td><td className="px-4 py-3">{r.late}</td><td className="px-4 py-3">{r.earlyDeparture}</td><td className="px-4 py-3">{r.entries}</td><td className="px-4 py-3">{r.exits}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DiscrepancyTab({ schoolId, canResolve }: { schoolId: number; canResolve: boolean }) {
  const [status, setStatus] = useState<'OPEN' | 'RESOLVED'>('OPEN');
  const [target, setTarget] = useState<number | null>(null);
  const q = useListSchoolEmployeeNfcAttendanceDiscrepancies(schoolId, { status }, { query: { ...FRESH } as never });
  const rows = q.data ?? [];
  const sel = rows.find(r => r.id === target);
  return (
    <div>
      <div className="border-b border-[hsl(var(--border))] p-4"><DiscrepancyTabs items={['OPEN', 'RESOLVED']} value={status} onChange={setStatus} /></div>
      {q.isLoading ? <div className="p-6"><SkeletonPage /></div> : q.isError ? <ErrorState retry={() => q.refetch()} /> : !rows.length ? <EmptyState icon={BadgeCheck} title="No discrepancies" description={`No ${status.toLowerCase()} employee attendance discrepancies.`} /> : (
        <div className="divide-y divide-[hsl(var(--border)/.6)]">
          {rows.map(r => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm">
              <div><div className="font-bold">{r.employeeName}</div><div className="text-xs text-[hsl(var(--muted-foreground))]">{r.eventType === 'SCHOOL_ENTRY' ? 'Check-in' : 'Check-out'} · {date(r.detectedAt)} {time(r.detectedAt)}{r.reason ? ` · ${r.reason}` : ''}</div>{r.resolutionHistory.length > 0 && <div className="mt-1 text-xs">{r.resolutionHistory.length} resolution note(s) on file</div>}</div>
              <div className="flex items-center gap-2"><StatusPill value={r.status} />{canResolve && r.status === 'OPEN' && <Button variant="outline" onClick={() => setTarget(r.id)}>Resolve</Button>}</div>
            </div>
          ))}
        </div>
      )}
      {canResolve && sel && <Modal title="Resolve discrepancy" eyebrow={sel.employeeName} onClose={() => setTarget(null)}><ResolveForm schoolId={schoolId} id={sel.id} onDone={() => setTarget(null)} /></Modal>}
    </div>
  );
}

function ResolveForm({ schoolId, id, onDone }: { schoolId: number; id: number; onDone: () => void }): ReactNode {
  const m = useResolveSchoolEmployeeNfcAttendanceDiscrepancy();
  const refresh = useRefreshNfc();
  const [resolution, setResolution] = useState<ResolveSchoolEmployeeNfcAttendanceDiscrepancyBodyResolution>('ACCEPT');
  const [reason, setReason] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate({ schoolId, discrepancyId: id, data: { resolution, reason: reason.trim() } }, { onSuccess: () => { void refresh(); onDone(); } });
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Resolution"><select value={resolution} onChange={e => setResolution(e.target.value as typeof resolution)}><option value="ACCEPT">Accept the record</option><option value="IGNORE">Ignore</option><option value="FOLLOW_UP">Needs follow-up</option></select></Field>
      <Field label="Reason (required)"><textarea required minLength={3} value={reason} onChange={e => setReason(e.target.value)} /></Field>
      <FormFooter pending={m.isPending} error={m.isError ? errMsg(m.error, 'Could not record the resolution.') : undefined} label="Record resolution" onCancel={onDone} />
    </form>
  );
}
