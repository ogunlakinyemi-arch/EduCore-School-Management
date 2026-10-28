import { useRef, useState, type FormEvent } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Landmark } from 'lucide-react';
import {
  useGetAuthorizedContext, useGetPlatformPaymentSettlement, useUpdatePlatformPaymentSettlement,
  useListPlatformSettlementHistory,
  useVerifyOwnerReceivingAccount,
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
    <Info label="Assistance account verification" value={<StatusPill value={p.status === 'VERIFIED' ? 'verified' : p.status === 'ACTION_REQUIRED' ? 'failed' : p.status === 'PENDING_VERIFICATION' ? 'pending' : 'unverified'} />} />
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
    <p className={note}>Saving stores Owner-provided receiving bank details for optional school subscription bank-transfer assistance at ₦3,200 per student per academic term. It does not start account verification or configure Flutterwave merchant settlement. No supported company verification action is currently available; unverified transfer details remain hidden from schools. Cash and company-account transfers never activate NFC or pay a subscription, even when receipt is confirmed. The Owner must initiate a separate authorized Flutterwave checkout; only a successful, independently server-verified transaction can establish the student's term entitlement.</p>
    <div className="flex gap-2"><Button type="submit" disabled={saving || f.accountNumber.length !== 10} testId="button-save-settlement">{saving ? 'Saving...' : 'Save bank details'}</Button><Button variant="quiet" onClick={onCancel}>Cancel</Button></div>
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
  const verify = useVerifyOwnerReceivingAccount();
  const verifyAccount = async () => {
    setFail(''); setMsg('');
    try {
      const result = await verify.mutateAsync();
      qc.setQueryData(getGetPlatformPaymentSettlementQueryKey(), result);
      setMsg('Beneficiary details verified against the official company name using LIVE account resolution. This is not proof of a transfer, receipt or Flutterwave settlement.');
    } catch (e) {
      setFail(errMsg(e));
    } finally {
      invalidateAll(qc);
    }
  };
  const save = async (d: FormState) => {
    try {
      await update.mutateAsync({ data: { businessName: d.businessName.trim(), businessRegistrationNumber: d.businessRegistrationNumber.trim() || null, settlementContactEmail: d.settlementContactEmail.trim() || undefined, settlementContactPhone: d.settlementContactPhone.trim() || null, bankName: d.bankName.trim(), bankCode: d.bankCode, accountName: d.accountName.trim(), accountNumber: d.accountNumber, currency: 'NGN' } });
      setEditing(false); setFail(''); setMsg('Owner-provided assistance bank details saved, not verified. Use Verify account details explicitly; unverified transfer instructions remain hidden from schools.'); invalidateAll(qc);
    } catch (e) { setFail(errMsg(e)); }
  };
  return <div>
    {tab === 'history' && <><IdentityBoundary scope="COMPANY" /><ProviderBanner capability={company.data?.capability} /></>}
    {tab === 'company' && <p className={`${note} mb-5`} data-testid="company-assistance-purpose">This EduCore record holds the Platform Owner's receiving bank details solely for optional school subscription bank-transfer assistance: ₦3,200 per student per academic term, subject to the applicable collection period and billing rules. Flutterwave merchant settlement configuration and evidence are handled separately in Flutterwave. This record is not a school settlement account or split/subaccount configuration, and does not establish Flutterwave LIVE readiness or proof of money movement. Cash and company-account transfers never activate NFC or pay a subscription, even when receipt is confirmed. A separate authorized Flutterwave checkout must succeed and be independently server-verified for the exact student and term.</p>}
    {msg && <Notice kind="ok" onClose={() => setMsg('')}>{msg}</Notice>}{fail && !editing && <Notice kind="error" onClose={() => setFail('')}>{fail}</Notice>}
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><Tabs tabs={[['company', 'Company profile'], ['schools', 'NFC fee collection'], ['history', 'All settlement history']] as const} value={tab} onChange={setTab} />
      <Freshness updatedAt={company.dataUpdatedAt} fetching={company.isFetching} onRefresh={() => { company.refetch(); if (tab === 'history') hist.refetch(); }} /></div>
    {tab === 'company' && (company.isLoading ? <SkeletonPage /> : company.isError || !company.data ? <ErrorState retry={() => company.refetch()} /> :
      <section className="panel p-6"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="display-font text-xl font-bold">Owner receiving account · subscription assistance</h2><Button disabled={verify.isPending} onClick={() => { setFail(''); setEditing(true); }} testId="button-edit-company-settlement">{company.data.status === 'NOT_CONFIGURED' ? 'Add details' : 'Update details'}</Button></div>
        {company.data.status === 'NOT_CONFIGURED' ? <EmptyState icon={Landmark} title="Assistance receiving account not configured" description="Save the official company receiving account, then explicitly verify its details. Unverified transfer details are not shown to schools." /> : <ProfileView p={company.data} />}
        {['PENDING_VERIFICATION', 'ACTION_REQUIRED'].includes(company.data.status) && <>
          <p className={`${note} mt-4`} role="status" data-testid="company-verification-guidance">Saving or refreshing will not verify this account. Verify account details checks the saved bank number and beneficiary against YETENIA TECHNOLOGIES LIMITED using LIVE Flutterwave account resolution. Only case, spacing, punctuation separators and a final LTD abbreviation are accepted; approximate or personal-name matches are rejected. Sandbox and Development results cannot verify the account. Schools cannot view unverified details and should contact the Platform Owner. Beneficiary resolution does not prove money movement, receipt of a school transfer or merchant settlement.</p>
          <Button disabled={verify.isPending || update.isPending || editing} onClick={verifyAccount} testId="button-verify-owner-account">{verify.isPending ? 'Verifying…' : 'Verify account details'}</Button>
          <SettlementRemovalReviewControl />
        </>}</section>)}
    {tab === 'schools' && <NfcFeeCollectionOversight />}
    {tab === 'history' && <section className="panel overflow-hidden">{hist.isLoading ? <SkeletonPage /> : hist.isError ? <ErrorState retry={() => hist.refetch()} /> : <SettlementHistoryTable rows={hist.data ?? []} showSchool />}</section>}
    {editing && <Modal title="Owner assistance receiving details" eyebrow="Company" onClose={() => setEditing(false)}>{fail && <Notice kind="error">{fail}</Notice>}<SettlementForm profile={company.data} saving={update.isPending} onSubmit={save} onCancel={() => setEditing(false)} /></Modal>}
  </div>;
}

export function PaymentSettlementPage() {
  const ctx = useGetAuthorizedContext();
  const isOwner = ctx.data?.isPlatformOwner === true;
  return <div className="fade-up">
    <PageHeading eyebrow="Owner Finance" title="Owner payment settings" description="Owner receiving details for optional subscription bank-transfer assistance, retained transaction history and read-only fee collection oversight. Flutterwave merchant settlement is separate; school split settlement remains retired." />
    {ctx.isLoading ? <SkeletonPage /> : ctx.isError ? <ErrorState retry={() => ctx.refetch()} /> :
      isOwner ? <OwnerSettlement /> :
      <EmptyState icon={Landmark} title="Owner-only settings" description="School settlement account collection is retired. These company account settings are only available to the Platform Owner. School fees and platform subscriptions remain in School Finance." />}
  </div>;
}
