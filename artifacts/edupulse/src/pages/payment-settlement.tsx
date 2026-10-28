import { useRef, useState, type FormEvent } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Landmark } from 'lucide-react';
import {
  useGetAuthorizedContext, useGetPlatformPaymentSettlement, useUpdatePlatformPaymentSettlement,
  useListPlatformSettlementHistory,
   getGetPlatformPaymentSettlementQueryKey, getListPlatformSettlementHistoryQueryKey,
} from '@workspace/api-client-react';
import { Button, EmptyState, ErrorState, Field, Info, Modal, PageHeading, SkeletonPage, StatusPill, date } from '@/components/shared';
import { BankFields, Freshness, IdentityBoundary, Notice, ProviderBanner, SettlementHistoryTable, Tabs, entry, errMsg, note, FRESH_MS } from './payroll-common';
import { SettlementRemovalReviewControl } from '@/components/settlement-removal-review';
import { useBankSelectionGuard } from '@/lib/bank-selection';
import { NfcFeeCollectionOversight } from '@/components/nfc-fee-collection-oversight';

type Profile = { status: string; bankName?: string | null; accountName?: string | null; accountLast4?: string | null; updatedAt?: string | null; businessName?: string | null; bankCode?: string | null; businessRegistrationNumber?: string | null; settlementContactEmail?: string | null; settlementContactPhone?: string | null; providerSubaccountId?: string | null };

function ProfileView({ p }: { p: Profile }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="settlement-profile">
    <Info label="Business" value={p.businessName} /><Info label="Bank" value={p.bankName} /><Info label="Account name" value={p.accountName} />
    <Info label="Account (last 4)" value={p.accountLast4 ? <span className="font-mono">{'****' + p.accountLast4}</span> : 'None on file'} />
    <Info label="Bank account verification" value={<StatusPill value={p.status === 'VERIFIED' ? 'verified' : p.status === 'ACTION_REQUIRED' ? 'failed' : p.status === 'PENDING_VERIFICATION' ? 'pending' : 'unverified'} />} />
    <Info label="Contact" value={p.settlementContactEmail} /><Info label="Updated" value={date(p.updatedAt)} />
  </div>;
}

type FormState = { businessName: string; businessRegistrationNumber: string; settlementContactEmail: string; settlementContactPhone: string; bankName: string; bankCode: string; accountName: string; accountNumber: string };
const blank = (p?: Profile | null): FormState => ({ businessName: p?.businessName ?? '', businessRegistrationNumber: p?.businessRegistrationNumber ?? '', settlementContactEmail: p?.settlementContactEmail ?? '', settlementContactPhone: p?.settlementContactPhone ?? '', bankName: p?.bankName ?? '', bankCode: p?.bankCode ?? '', accountName: p?.accountName ?? '', accountNumber: '' });

function SettlementForm({ profile, saving, onSubmit, onCancel }: { profile?: Profile | null; saving: boolean; onSubmit: (d: FormState) => void; onCancel: () => void }) {
  const [f, setF] = useState<FormState>(() => blank(profile));
  const bankAllowed = useBankSelectionGuard();
  const patch = (p: Partial<FormState>) => setF(s => ({ ...s, ...p }));
  const original = useRef({ bankName: profile?.bankName ?? '', bankCode: profile?.bankCode ?? '' });
  const [blocked, setBlocked] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!bankAllowed(f, original.current)) { setBlocked('Choose your bank from the verified bank list before saving.'); return; }
    setBlocked(''); onSubmit(f);
  };
  return <form onSubmit={submit} className="space-y-4" data-testid="form-settlement">
    <Field label="Business name"><input required minLength={2} className={entry} value={f.businessName} onChange={e => patch({ businessName: e.target.value })} /></Field>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Registration number (optional)"><input className={entry} value={f.businessRegistrationNumber} onChange={e => patch({ businessRegistrationNumber: e.target.value })} /></Field>
      <Field label="Phone (optional)"><input className={entry} value={f.settlementContactPhone} onChange={e => patch({ settlementContactPhone: e.target.value })} /></Field>
    </div>
    <Field label="Settlement contact email (optional)"><input type="email" className={entry} value={f.settlementContactEmail} onChange={e => patch({ settlementContactEmail: e.target.value })} /></Field>
    <BankFields v={f} set={patch} maskedCurrent={profile?.accountLast4 ? `****${profile.accountLast4}` : null} />
    {blocked && <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{blocked}</p>}
    <p className={note}>Saving submits company recipient details for verification. Entering a bank account does not confirm receipt of a school transfer or credit any subscription.</p>
    <div className="flex gap-2"><Button type="submit" disabled={saving || f.accountNumber.length !== 10} testId="button-save-settlement">{saving ? 'Saving...' : 'Save for verification'}</Button><Button variant="quiet" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ predicate: q => typeof q.queryKey[0] === 'string' && /payment-settlement|settlement/.test(q.queryKey[0]) });
}

function OwnerSettlement() {
  const qc = useQueryClient();
  const search = useSearch();
  const [, navigate] = useLocation();
  const requestedTab = new URLSearchParams(search).get('tab');
  const tab = requestedTab === 'schools' || requestedTab === 'history' ? requestedTab : 'company';
  const setTab = (value: 'company' | 'schools' | 'history') => {
    const params = new URLSearchParams(search);
    if (value === 'company') params.delete('tab');
    else params.set('tab', value);
    navigate(`/payment-settlement${params.size ? `?${params}` : ''}`);
  };
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState(''); const [fail, setFail] = useState('');
  const company = useGetPlatformPaymentSettlement({ query: { queryKey: getGetPlatformPaymentSettlementQueryKey(), staleTime: FRESH_MS, refetchInterval: FRESH_MS } });
  const hp = { limit: 50 };
  const hist = useListPlatformSettlementHistory(hp, { query: { enabled: tab === 'history', queryKey: getListPlatformSettlementHistoryQueryKey(hp), staleTime: FRESH_MS, refetchInterval: FRESH_MS } });
  const update = useUpdatePlatformPaymentSettlement();
  const save = async (d: FormState) => {
    try {
      await update.mutateAsync({ data: { businessName: d.businessName.trim(), businessRegistrationNumber: d.businessRegistrationNumber.trim() || null, settlementContactEmail: d.settlementContactEmail.trim() || undefined, settlementContactPhone: d.settlementContactPhone.trim() || null, bankName: d.bankName.trim(), bankCode: d.bankCode, accountName: d.accountName.trim(), accountNumber: d.accountNumber, currency: 'NGN' } });
      setEditing(false); setFail(''); setMsg('Company settlement details saved for provider verification.'); invalidateAll(qc);
    } catch (e) { setFail(errMsg(e)); }
  };
  return <div>
    <IdentityBoundary scope="COMPANY" /><ProviderBanner capability={company.data?.capability} />
    {msg && <Notice kind="ok" onClose={() => setMsg('')}>{msg}</Notice>}{fail && !editing && <Notice kind="error" onClose={() => setFail('')}>{fail}</Notice>}
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><Tabs tabs={[['company', 'Company profile'], ['schools', 'NFC fee collection'], ['history', 'All settlement history']] as const} value={tab} onChange={setTab} />
      <Freshness updatedAt={company.dataUpdatedAt} fetching={company.isFetching} onRefresh={() => { company.refetch(); if (tab === 'history') hist.refetch(); }} /></div>
    {tab === 'company' && (company.isLoading ? <SkeletonPage /> : company.isError || !company.data ? <ErrorState retry={() => company.refetch()} /> :
      <section className="panel p-6"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="display-font text-xl font-bold">Company account</h2><Button onClick={() => { setFail(''); setEditing(true); }} testId="button-edit-company-settlement">{company.data.status === 'NOT_CONFIGURED' ? 'Add details' : 'Update details'}</Button></div>
        {company.data.status === 'NOT_CONFIGURED' ? <EmptyState icon={Landmark} title="Company account not configured" description="Add the company bank recipient used for company payroll. School money is never mixed with it." /> : <ProfileView p={company.data} />}
        {company.data.status === 'PENDING_VERIFICATION' && <SettlementRemovalReviewControl />}</section>)}
    {tab === 'schools' && <NfcFeeCollectionOversight />}
    {tab === 'history' && <section className="panel overflow-hidden">{hist.isLoading ? <SkeletonPage /> : hist.isError ? <ErrorState retry={() => hist.refetch()} /> : <SettlementHistoryTable rows={hist.data ?? []} showSchool />}</section>}
    {editing && <Modal title="Company settlement details" eyebrow="Company" onClose={() => setEditing(false)}>{fail && <Notice kind="error">{fail}</Notice>}<SettlementForm profile={company.data} saving={update.isPending} onSubmit={save} onCancel={() => setEditing(false)} /></Modal>}
  </div>;
}

export function PaymentSettlementPage() {
  const ctx = useGetAuthorizedContext();
  const isOwner = ctx.data?.isPlatformOwner === true;
  return <div className="fade-up">
    <PageHeading eyebrow="Owner Finance" title="Owner payment settings" description="Owner business receiving account, retained settlement history and read-only fee collection oversight. School split settlement is retired." />
    {ctx.isLoading ? <SkeletonPage /> : ctx.isError ? <ErrorState retry={() => ctx.refetch()} /> :
      isOwner ? <OwnerSettlement /> :
      <EmptyState icon={Landmark} title="Owner-only settings" description="School settlement account collection is retired. These company account settings are only available to the Platform Owner. School fees and platform subscriptions remain in School Finance." />}
  </div>;
}
