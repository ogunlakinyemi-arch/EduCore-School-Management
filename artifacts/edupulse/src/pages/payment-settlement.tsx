import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Landmark } from 'lucide-react';
import {
  useGetAuthorizedContext, useGetPlatformPaymentSettlement, useUpdatePlatformPaymentSettlement, useListPlatformSchoolSettlements,
  useVerifyPlatformSchoolSettlement, useGetSchoolPaymentSettlement, useUpdateSchoolPaymentSettlement, useListSchoolSettlementHistory,
  useListPlatformSettlementHistory, useGetPlatformSchoolSettlement,
  getGetPlatformPaymentSettlementQueryKey, getListPlatformSchoolSettlementsQueryKey, getGetSchoolPaymentSettlementQueryKey,
  getListSchoolSettlementHistoryQueryKey, getListPlatformSettlementHistoryQueryKey, getGetPlatformSchoolSettlementQueryKey,
} from '@workspace/api-client-react';
import type { SchoolSettlementSummary } from '@workspace/api-client-react';
import { Button, EmptyState, ErrorState, Field, Info, Modal, PageHeading, SkeletonPage, StatusPill, TenantPicker, useTenant, date } from '@/components/shared';
import { BankFields, Freshness, IdentityBoundary, Notice, ProviderBanner, SettlementHistoryTable, Tabs, entry, errMsg, note, FRESH_MS } from './payroll-common';

type Profile = { status: string; bankName?: string | null; accountName?: string | null; accountLast4?: string | null; updatedAt?: string | null; businessName?: string | null; bankCode?: string | null; businessRegistrationNumber?: string | null; settlementContactEmail?: string | null; settlementContactPhone?: string | null; providerSubaccountId?: string | null };

function ProfileView({ p }: { p: Profile }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="settlement-profile">
    <Info label="Business" value={p.businessName} /><Info label="Bank" value={p.bankName} /><Info label="Account name" value={p.accountName} />
    <Info label="Account (last 4)" value={p.accountLast4 ? <span className="font-mono">{'****' + p.accountLast4}</span> : 'None on file'} />
    <Info label="Recipient verification" value={<StatusPill value={p.status === 'VERIFIED' ? 'verified' : p.status === 'ACTION_REQUIRED' ? 'failed' : p.status === 'PENDING_VERIFICATION' ? 'pending' : 'unverified'} />} />
    <Info label="Provider subaccount" value={p.providerSubaccountId ? 'Linked' : 'Not linked'} /><Info label="Contact" value={p.settlementContactEmail} /><Info label="Updated" value={date(p.updatedAt)} />
  </div>;
}

type FormState = { businessName: string; businessRegistrationNumber: string; settlementContactEmail: string; settlementContactPhone: string; bankName: string; bankCode: string; accountName: string; accountNumber: string };
const blank = (p?: Profile | null): FormState => ({ businessName: p?.businessName ?? '', businessRegistrationNumber: p?.businessRegistrationNumber ?? '', settlementContactEmail: p?.settlementContactEmail ?? '', settlementContactPhone: p?.settlementContactPhone ?? '', bankName: p?.bankName ?? '', bankCode: p?.bankCode ?? '', accountName: p?.accountName ?? '', accountNumber: '' });

function SettlementForm({ profile, scope, saving, onSubmit, onCancel }: { profile?: Profile | null; scope: 'COMPANY' | 'SCHOOL'; saving: boolean; onSubmit: (d: FormState) => void; onCancel: () => void }) {
  const [f, setF] = useState<FormState>(() => blank(profile));
  const patch = (p: Partial<FormState>) => setF(s => ({ ...s, ...p }));
  const submit = (e: FormEvent) => { e.preventDefault(); onSubmit(f); };
  return <form onSubmit={submit} className="space-y-4" data-testid="form-settlement">
    <Field label="Business name"><input required minLength={2} className={entry} value={f.businessName} onChange={e => patch({ businessName: e.target.value })} /></Field>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Registration number (optional)"><input className={entry} value={f.businessRegistrationNumber} onChange={e => patch({ businessRegistrationNumber: e.target.value })} /></Field>
      <Field label="Phone (optional)"><input className={entry} value={f.settlementContactPhone} onChange={e => patch({ settlementContactPhone: e.target.value })} /></Field>
    </div>
    <Field label={scope === 'SCHOOL' ? 'Settlement contact email' : 'Settlement contact email (optional)'}><input type="email" required={scope === 'SCHOOL'} className={entry} value={f.settlementContactEmail} onChange={e => patch({ settlementContactEmail: e.target.value })} /></Field>
    <BankFields v={f} set={patch} maskedCurrent={profile?.accountLast4 ? `****${profile.accountLast4}` : null} />
    <p className={note}>Saving submits recipient details for provider verification. Entering a bank account does not mean funds have settled; settlement shows only after the provider confirms it.</p>
    <div className="flex gap-2"><Button type="submit" disabled={saving || f.accountNumber.length !== 10} testId="button-save-settlement">{saving ? 'Saving...' : 'Save for verification'}</Button><Button variant="quiet" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ predicate: q => typeof q.queryKey[0] === 'string' && /payment-settlement|settlement/.test(q.queryKey[0]) });
}

function SchoolAdminSettlement({ schoolId }: { schoolId: number }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'profile' | 'history'>('profile');
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState(''); const [fail, setFail] = useState('');
  const q = useGetSchoolPaymentSettlement(schoolId, { query: { enabled: !!schoolId, queryKey: getGetSchoolPaymentSettlementQueryKey(schoolId), staleTime: FRESH_MS, refetchInterval: FRESH_MS } });
  const hp = { limit: 50 };
  const h = useListSchoolSettlementHistory(schoolId, hp, { query: { enabled: !!schoolId && tab === 'history', queryKey: getListSchoolSettlementHistoryQueryKey(schoolId, hp), staleTime: FRESH_MS, refetchInterval: FRESH_MS } });
  const update = useUpdateSchoolPaymentSettlement();
  const save = async (d: FormState) => {
    try {
      await update.mutateAsync({ schoolId, data: { businessName: d.businessName.trim(), businessRegistrationNumber: d.businessRegistrationNumber.trim() || null, settlementContactEmail: d.settlementContactEmail.trim(), settlementContactPhone: d.settlementContactPhone.trim() || null, bankName: d.bankName.trim(), bankCode: d.bankCode, accountName: d.accountName.trim(), accountNumber: d.accountNumber, currency: 'NGN' } });
      setEditing(false); setFail(''); setMsg('Settlement details saved. They stay unverified until the provider confirms the recipient.'); invalidateAll(qc);
    } catch (e) { setFail(errMsg(e)); }
  };
  if (q.isLoading) return <SkeletonPage />;
  if (q.isError || !q.data) return <ErrorState retry={() => q.refetch()} />;
  const p = q.data;
  return <div>
    <IdentityBoundary scope="SCHOOL" /><ProviderBanner capability={p.capability} />
    {msg && <Notice kind="ok" onClose={() => setMsg('')}>{msg}</Notice>}{fail && !editing && <Notice kind="error">{fail}</Notice>}
    <div className="mb-4 flex justify-between"><Tabs tabs={[['profile', 'Settlement profile'], ['history', 'Settlement history']] as const} value={tab} onChange={setTab} />
      <Freshness updatedAt={q.dataUpdatedAt} fetching={q.isFetching} onRefresh={() => { q.refetch(); h.refetch(); }} /></div>
    {tab === 'profile' && <section className="panel p-6"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="display-font text-xl font-bold">School settlement account</h2><Button onClick={() => { setFail(''); setEditing(true); }} testId="button-edit-settlement">{p.status === 'NOT_CONFIGURED' ? 'Add details' : 'Update details'}</Button></div>
      {p.status === 'NOT_CONFIGURED' ? <EmptyState icon={Landmark} title="No settlement account yet" description="Add the school's own bank recipient. It is never shared with Yemait company payroll money." /> : <ProfileView p={p} />}</section>}
    {tab === 'history' && <section className="panel overflow-hidden">{h.isLoading ? <SkeletonPage /> : h.isError ? <ErrorState retry={() => h.refetch()} /> : <SettlementHistoryTable rows={h.data ?? []} />}</section>}
    {editing && <Modal title="Settlement details" eyebrow="School account" onClose={() => setEditing(false)}>{fail && <Notice kind="error">{fail}</Notice>}<SettlementForm profile={p} scope="SCHOOL" saving={update.isPending} onSubmit={save} onCancel={() => setEditing(false)} /></Modal>}
  </div>;
}

function SchoolDetail({ s, onClose }: { s: SchoolSettlementSummary; onClose: () => void }) {
  const q = useGetPlatformSchoolSettlement(s.schoolId, { query: { queryKey: getGetPlatformSchoolSettlementQueryKey(s.schoolId), staleTime: FRESH_MS } });
  const d = q.data ?? s;
  return <Modal title={s.schoolName} eyebrow="School settlement (read only)" onClose={onClose}>
    {q.isError && <Notice kind="error">Latest detail could not load; showing list data.</Notice>}
    {d.status === 'NOT_CONFIGURED'
      ? <EmptyState icon={Landmark} title="School account not configured" description="This school has not configured its settlement recipient. Bank account details are not available yet." />
      : <ProfileView p={d} />}<div className="mt-4"><ProviderBanner capability={d.capability} /></div>
    <p className={note}>Last settlement: {d.lastSettlementAt ? `${date(d.lastSettlementAt)} (${d.lastSettlementStatus ?? 'unknown'})` : 'none recorded'}. Owner access is oversight only; school bank details cannot be edited here.</p>
  </Modal>;
}

function OwnerSettlement() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'company' | 'schools' | 'history'>('company');
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState(''); const [fail, setFail] = useState('');
  const [search, setSearch] = useState(''); const [status, setStatus] = useState<'all' | 'NOT_CONFIGURED' | 'PENDING_VERIFICATION' | 'VERIFIED' | 'ACTION_REQUIRED'>('all');
  const [detail, setDetail] = useState<SchoolSettlementSummary | null>(null);
  const company = useGetPlatformPaymentSettlement({ query: { queryKey: getGetPlatformPaymentSettlementQueryKey(), staleTime: FRESH_MS, refetchInterval: FRESH_MS } });
  const sp = { status, ...(search.trim() ? { search: search.trim() } : {}), limit: 100 };
  const schools = useListPlatformSchoolSettlements(sp, { query: { enabled: tab === 'schools', queryKey: getListPlatformSchoolSettlementsQueryKey(sp), staleTime: FRESH_MS, refetchInterval: FRESH_MS } });
  const hp = { limit: 50 };
  const hist = useListPlatformSettlementHistory(hp, { query: { enabled: tab === 'history', queryKey: getListPlatformSettlementHistoryQueryKey(hp), staleTime: FRESH_MS, refetchInterval: FRESH_MS } });
  const update = useUpdatePlatformPaymentSettlement();
  const verify = useVerifyPlatformSchoolSettlement();
  const save = async (d: FormState) => {
    try {
      await update.mutateAsync({ data: { businessName: d.businessName.trim(), businessRegistrationNumber: d.businessRegistrationNumber.trim() || null, settlementContactEmail: d.settlementContactEmail.trim() || undefined, settlementContactPhone: d.settlementContactPhone.trim() || null, bankName: d.bankName.trim(), bankCode: d.bankCode, accountName: d.accountName.trim(), accountNumber: d.accountNumber, currency: 'NGN' } });
      setEditing(false); setFail(''); setMsg('Company settlement details saved for provider verification.'); invalidateAll(qc);
    } catch (e) { setFail(errMsg(e)); }
  };
  const runVerify = async (s: SchoolSettlementSummary) => {
    if (!window.confirm(`Ask the provider to verify the recipient for ${s.schoolName}? This does not settle any funds.`)) return;
    try { const r = await verify.mutateAsync({ schoolId: s.schoolId }); setFail(''); setMsg(`${s.schoolName}: provider reports recipient status ${r.status.replaceAll('_', ' ').toLowerCase()}.`); invalidateAll(qc); }
    catch (e) { setFail(errMsg(e)); }
  };
  return <div>
    <IdentityBoundary scope="COMPANY" /><ProviderBanner capability={company.data?.capability} />
    {msg && <Notice kind="ok" onClose={() => setMsg('')}>{msg}</Notice>}{fail && !editing && <Notice kind="error" onClose={() => setFail('')}>{fail}</Notice>}
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><Tabs tabs={[['company', 'Company profile'], ['schools', 'School oversight'], ['history', 'All settlement history']] as const} value={tab} onChange={setTab} />
      <Freshness updatedAt={company.dataUpdatedAt} fetching={company.isFetching} onRefresh={() => { company.refetch(); schools.refetch(); hist.refetch(); }} /></div>
    {tab === 'company' && (company.isLoading ? <SkeletonPage /> : company.isError || !company.data ? <ErrorState retry={() => company.refetch()} /> :
      <section className="panel p-6"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="display-font text-xl font-bold">Yemait company account</h2><Button onClick={() => { setFail(''); setEditing(true); }} testId="button-edit-company-settlement">{company.data.status === 'NOT_CONFIGURED' ? 'Add details' : 'Update details'}</Button></div>
        {company.data.status === 'NOT_CONFIGURED' ? <EmptyState icon={Landmark} title="Company account not configured" description="Add the company bank recipient used for company payroll. School money is never mixed with it." /> : <ProfileView p={company.data} />}</section>)}
    {tab === 'schools' && <section className="panel overflow-hidden"><div className="flex flex-wrap gap-3 border-b border-[hsl(var(--border))] p-4">
      <input className={`${entry} max-w-xs`} placeholder="Search schools" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search schools" />
      <select className={`${entry} max-w-[220px]`} value={status} onChange={e => setStatus(e.target.value as typeof status)} aria-label="Status filter">{['all', 'NOT_CONFIGURED', 'PENDING_VERIFICATION', 'VERIFIED', 'ACTION_REQUIRED'].map(s => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s.replaceAll('_', ' ')}</option>)}</select></div>
      {schools.isLoading ? <SkeletonPage /> : schools.isError ? <ErrorState retry={() => schools.refetch()} /> : !(schools.data ?? []).length ? <EmptyState icon={Landmark} title="No schools match" description="Adjust the filter or search." /> :
        <div className="divide-y divide-[hsl(var(--border))]">{(schools.data ?? []).map(s => <div key={s.schoolId} className="flex flex-wrap items-center gap-4 p-4" data-testid={`row-school-settlement-${s.schoolId}`}>
          <div className="min-w-0 flex-1"><div className="font-bold">{s.schoolName}</div><div className={note}>{s.bankName ?? 'No bank'} {s.accountLast4 ? `/ ****${s.accountLast4}` : ''} / {s.capability.mode.replace('_', ' ').toLowerCase()} mode</div></div>
          <StatusPill value={s.status === 'VERIFIED' ? 'verified' : s.status === 'ACTION_REQUIRED' ? 'failed' : s.status === 'PENDING_VERIFICATION' ? 'pending' : 'unverified'} />
          <Button variant="outline" onClick={() => setDetail(s)}>Details</Button>
          <Button variant="quiet" disabled={verify.isPending || s.status === 'NOT_CONFIGURED' || !s.capability.bankSubaccountsSupported} title={!s.capability.bankSubaccountsSupported ? 'Provider API does not support bank subaccounts' : undefined} onClick={() => runVerify(s)} testId={`button-verify-${s.schoolId}`}>{s.capability.bankSubaccountsSupported ? 'Verify recipient' : 'Verification unsupported'}</Button>
        </div>)}</div>}</section>}
    {tab === 'history' && <section className="panel overflow-hidden">{hist.isLoading ? <SkeletonPage /> : hist.isError ? <ErrorState retry={() => hist.refetch()} /> : <SettlementHistoryTable rows={hist.data ?? []} showSchool />}</section>}
    {editing && <Modal title="Company settlement details" eyebrow="Yemait company" onClose={() => setEditing(false)}>{fail && <Notice kind="error">{fail}</Notice>}<SettlementForm profile={company.data} scope="COMPANY" saving={update.isPending} onSubmit={save} onCancel={() => setEditing(false)} /></Modal>}
    {detail && <SchoolDetail s={detail} onClose={() => setDetail(null)} />}
  </div>;
}

export function PaymentSettlementPage() {
  const { schoolId } = useTenant();
  const ctx = useGetAuthorizedContext();
  const isOwner = ctx.data?.isPlatformOwner === true;
  const isAdmin = !!schoolId && ctx.data?.roles?.some(r => r.schoolId === schoolId && r.role === 'SCHOOL_ADMIN' && r.status === 'ACTIVE') === true;
  return <div className="fade-up">
    <PageHeading eyebrow="Finance / Payment settlement" title="Payment settlement" description="Recipient details and provider-verified settlement outcomes. Company money and school money never share an account." action={isAdmin && !isOwner ? <TenantPicker /> : undefined} />
    {ctx.isLoading ? <SkeletonPage /> : ctx.isError ? <ErrorState retry={() => ctx.refetch()} /> :
      isOwner ? <OwnerSettlement /> : isAdmin ? <SchoolAdminSettlement key={schoolId} schoolId={schoolId} /> :
      <EmptyState icon={Landmark} title="Not available for your role" description="Payment settlement is limited to School Admins for their own school and the Platform Owner." />}
  </div>;
}
