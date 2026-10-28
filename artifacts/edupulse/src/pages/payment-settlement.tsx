import { useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Landmark } from 'lucide-react';
import {
  useGetAuthorizedContext, useGetPlatformPaymentSettlement, useUpdatePlatformPaymentSettlement,
  useListPlatformSettlementHistory,
   getGetPlatformPaymentSettlementQueryKey, getListPlatformSettlementHistoryQueryKey,
} from '@workspace/api-client-react';
import { Button, EmptyState, ErrorState, Info, Modal, PageHeading, SkeletonPage, StatusPill, date } from '@/components/shared';
import { Freshness, IdentityBoundary, Notice, ProviderBanner, SettlementHistoryTable, Tabs, errMsg, note, FRESH_MS } from './payroll-common';
import { SettlementRemovalReviewControl } from '@/components/settlement-removal-review';
import { OwnerReceivingAccountForm, type OwnerAccountFormState } from '@/components/owner-receiving-account-form';
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
  const save = async (d: OwnerAccountFormState) => {
    try {
      const saved = await update.mutateAsync({ data: { businessName: d.businessName.trim(), businessRegistrationNumber: d.businessRegistrationNumber.trim() || null, settlementContactEmail: d.settlementContactEmail.trim() || undefined, settlementContactPhone: d.settlementContactPhone.trim() || null, bankName: d.bankName.trim(), bankCode: d.bankCode, accountName: d.accountName, accountNumber: d.accountNumber, lookupToken: d.lookupToken, currency: 'NGN' } });
      qc.setQueryData(getGetPlatformPaymentSettlementQueryKey(), saved);
      setEditing(false); setFail(''); setMsg('Matched company receiving account saved. School Admins can now view these details for optional assistance. Account-name resolution is not proof of funds received or merchant settlement.'); invalidateAll(qc);
    } catch (e) { setFail(errMsg(e)); }
  };
  return <div>
    {tab === 'history' && <><IdentityBoundary scope="COMPANY" /><ProviderBanner capability={company.data?.capability} /></>}
    {tab === 'company' && <p className={`${note} mb-5`} data-testid="company-assistance-purpose">This EduCore record holds the Platform Owner's receiving bank details solely for optional school subscription bank-transfer assistance: ₦3,200 per student per academic term, subject to the applicable collection period and billing rules. Flutterwave merchant settlement configuration and evidence are handled separately in Flutterwave. This record is not a school settlement account or split/subaccount configuration, and does not establish Flutterwave LIVE readiness or proof of money movement. Cash and company-account transfers never activate NFC or pay a subscription, even when receipt is confirmed. A separate authorized Flutterwave checkout must succeed and be independently server-verified for the exact student and term.</p>}
    {msg && <Notice kind="ok" onClose={() => setMsg('')}>{msg}</Notice>}{fail && !editing && <Notice kind="error" onClose={() => setFail('')}>{fail}</Notice>}
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><Tabs tabs={[['company', 'Company profile'], ['schools', 'NFC fee collection'], ['history', 'All settlement history']] as const} value={tab} onChange={setTab} />
      <Freshness updatedAt={company.dataUpdatedAt} fetching={company.isFetching} onRefresh={() => { company.refetch(); if (tab === 'history') hist.refetch(); }} /></div>
    {tab === 'company' && (company.isLoading ? <SkeletonPage /> : company.isError || !company.data ? <ErrorState retry={() => company.refetch()} /> :
      <section className="panel p-6"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="display-font text-xl font-bold">Owner receiving account · subscription assistance</h2><Button onClick={() => { setFail(''); setEditing(true); }} testId="button-edit-company-settlement">{company.data.status === 'NOT_CONFIGURED' ? 'Add details' : 'Update details'}</Button></div>
        {company.data.status === 'NOT_CONFIGURED' ? <EmptyState icon={Landmark} title="Assistance receiving account not configured" description="Select the bank and enter the account number. The name is looked up automatically; save after the official company beneficiary matches. Unverified details remain hidden from schools." /> : <ProfileView p={company.data} />}
        {['PENDING_VERIFICATION', 'ACTION_REQUIRED'].includes(company.data.status) && <>
          <p className={`${note} mt-4`} role="status" data-testid="company-verification-guidance">Update details, select the bank and enter the account number to look up the name automatically. Save Details becomes available only after the official YETENIA TECHNOLOGIES LIMITED beneficiary matches. Saving without a matching lookup or refreshing never verifies this account. Sandbox and Development results cannot verify the account. Schools cannot view unverified details and should contact the Platform Owner. Beneficiary resolution does not prove money movement, receipt of a school transfer or merchant settlement.</p>
          <SettlementRemovalReviewControl />
        </>}</section>)}
    {tab === 'schools' && <NfcFeeCollectionOversight />}
    {tab === 'history' && <section className="panel overflow-hidden">{hist.isLoading ? <SkeletonPage /> : hist.isError ? <ErrorState retry={() => hist.refetch()} /> : <SettlementHistoryTable rows={hist.data ?? []} showSchool />}</section>}
    {editing && <Modal title="Owner assistance receiving details" eyebrow="Company" onClose={() => { if (!update.isPending) setEditing(false); }}>{fail && <Notice kind="error">{fail}</Notice>}<OwnerReceivingAccountForm profile={company.data} saving={update.isPending} onSubmit={save} onCancel={() => setEditing(false)} /></Modal>}
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
