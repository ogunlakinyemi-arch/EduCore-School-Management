import { useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { ArrowLeft, ArrowRight, Banknote, BookOpen, Check, CircleDollarSign, Clock3, FileText, Layers3, Plus, ReceiptText, ShieldCheck, SlidersHorizontal, X } from 'lucide-react';
import {
  useGetFinanceSettings, useUpdateFinanceSettings, useListFeeCategories, useCreateFeeCategory, useUpdateFeeCategory,
  useListFeeStructures, useCreateFeeStructure, usePublishFeeStructure, useAssignFeeStructure,
  useListFeeInvoices, useListParentFeeInvoices, useListStudentFeeInvoices, useSubmitManualBankTransfer, useGetParentFeeInvoiceBankDetails, useGetAuthorizedContext,
  useRequestFeeAdjustment, useGetSchoolFinanceSummary, useGetParentChild,
  useListAcademicSessions, useListAcademicTerms, useListClasses, useListStudents,
  getGetFinanceSettingsQueryKey, getGetParentFeeInvoiceBankDetailsQueryKey, getListFeeCategoriesQueryKey, getListFeeStructuresQueryKey,
  getListFeeInvoicesQueryKey, getListParentFeeInvoicesQueryKey, getListStudentFeeInvoicesQueryKey,
  getGetSchoolFinanceSummaryQueryKey, getListAcademicSessionsQueryKey, getListAcademicTermsQueryKey,
  getListClassesQueryKey, getListStudentsQueryKey, getListSchoolFinancePaymentsQueryKey,
  getListPendingFeeAdjustmentsQueryKey, getListParentFeePaymentsQueryKey, getListStudentFeePaymentsQueryKey,
} from '@workspace/api-client-react';
import type { FeeCategory, FeeInvoice, FeeStructure, FeePayment, FinanceSettings } from '@workspace/api-client-react';
import { Button, EmptyState, ErrorState, Field, Modal, PageHeading, SkeletonPage, StatusPill, TenantPicker, useTenant } from '@/components/shared';
import { FamilyPaymentHistory, PendingAdjustments, SchoolPaymentQueue } from './finance-operations';
import { BulkAssignment, FinanceReports, RefundDesk } from './finance-phase7';
import { ParentOnlineMethods } from './finance-online';

const naira = (minor: number) => `₦${(minor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const toMinor = (value: string) => Math.round(Number(value) * 100);
const entry = 'w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3.5 py-2.5 text-sm font-medium outline-none focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.12)]';
const note = 'text-xs leading-5 text-[hsl(var(--muted-foreground))]';
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed. Please try again.';
type Tab = 'overview' | 'invoices' | 'transfers' | 'adjustments' | 'structures' | 'bulk' | 'refunds' | 'reports' | 'categories' | 'controls';

function BankTransferSettings({ schoolId, settings, canEdit, onSaved }: { schoolId: number; settings: FinanceSettings; canEdit: boolean; onSaved: (message: string) => void }) {
  const update = useUpdateFinanceSettings();
  const [enabled, setEnabled] = useState(settings.bankTransferEnabled);
  const [bankName, setBankName] = useState(settings.bankName ?? '');
  const [accountName, setAccountName] = useState(settings.accountName ?? '');
  const [accountNumber, setAccountNumber] = useState(settings.accountNumber ?? '');
  const [failure, setFailure] = useState('');
  const complete = bankName.trim().length >= 2 && bankName.trim().length <= 100
    && accountName.trim().length >= 2 && accountName.trim().length <= 150
    && /^[0-9]{10}$/.test(accountNumber);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    if (enabled && !complete) { setFailure('Add a bank name, account name and valid 10-digit Nigerian account number before enabling transfers.'); return; }
    try {
      const saved = await update.mutateAsync({ params: { schoolId }, data: {
        bankTransferEnabled: enabled,
        ...(complete ? { bankName: bankName.trim(), accountName: accountName.trim(), accountNumber } : {}),
      } });
      setEnabled(saved.bankTransferEnabled);
      setBankName(saved.bankName ?? '');
      setAccountName(saved.accountName ?? '');
      setAccountNumber(saved.accountNumber ?? '');
      setFailure('');
      onSaved(enabled ? 'Approved bank transfer details saved.' : 'Bank transfers disabled for parents.');
    } catch (error) { setFailure(errorText(error)); }
  };
  return <section className="panel p-6 md:p-8">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="eyebrow">School-approved destination</div><h2 className="display-font mt-2 text-xl font-bold">Bank transfer account</h2></div><StatusPill value={settings.bankTransferEnabled ? 'ACTIVE' : 'INACTIVE'} /></div>
    <p className={`mt-3 ${note}`}>Only enabled details are shared with parents. Disabling transfers removes the payment instructions and submission option from their invoice view.</p>
    {canEdit ? <form onSubmit={save} className="mt-6 space-y-4">
      <Field label="Bank name"><input required={enabled} minLength={enabled ? 2 : undefined} maxLength={100} value={bankName} onChange={e => setBankName(e.target.value)} className={entry} data-testid="input-finance-bank-name" /></Field>
      <Field label="Account name"><input required={enabled} minLength={enabled ? 2 : undefined} maxLength={150} value={accountName} onChange={e => setAccountName(e.target.value)} className={entry} data-testid="input-finance-account-name" /></Field>
      <Field label="Account number · 10 digits"><input type="text" inputMode="numeric" pattern={enabled ? '[0-9]{10}' : undefined} maxLength={10} required={enabled} value={accountNumber} onChange={e => setAccountNumber(e.target.value.replace(/\D/g, ''))} className={`${entry} font-mono tracking-widest`} data-testid="input-finance-account-number" /></Field>
      <label className="flex items-center gap-3 rounded-xl bg-[hsl(var(--secondary))] p-4 text-sm font-bold"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} data-testid="checkbox-finance-bank-enabled" />Enable these approved details for parent transfers</label>
      {failure && <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{failure}</p>}
      <Button type="submit" disabled={update.isPending || (enabled && !complete)} testId="button-save-bank-details">{update.isPending ? 'Saving…' : 'Save bank settings'}</Button>
    </form> : <div className="mt-6 space-y-3 rounded-xl bg-[hsl(var(--secondary))] p-5 text-sm"><div><span className="eyebrow">Bank</span><div className="mt-1 font-bold">{settings.bankName || 'Not configured'}</div></div><div><span className="eyebrow">Account holder</span><div className="mt-1 font-bold">{settings.accountName || 'Not configured'}</div></div><div><span className="eyebrow">Account number</span><div className="mt-1 font-mono font-bold">{settings.accountNumber || 'Not configured'}</div></div><p className={note}>Only a School Admin can approve or change these settings.</p></div>}
  </section>;
}

function ProviderSettings({ schoolId, settings, canEdit, onSaved }: { schoolId: number; settings: FinanceSettings; canEdit: boolean; onSaved: (message: string) => void }) {
  const update = useUpdateFinanceSettings();
  const [failure, setFailure] = useState('');
  return <section className="panel p-6 md:p-8">
    <div className="eyebrow">Hosted checkout controls</div><h2 className="display-font mt-2 text-xl font-bold">Online payment methods</h2>
    <p className={`mt-3 ${note}`}>Enabling a method requires configured provider test credentials and a secure checkout return URL on the server. Sandbox unavailable or incomplete configuration means the method will not be offered to parents. Remita checkout is unavailable.</p>
    <div className="mt-5 divide-y divide-[hsl(var(--border))] rounded-xl border border-[hsl(var(--border))]">{([
      ['PAYSTACK', 'Paystack', 'paystackEnabled'], ['FLUTTERWAVE', 'Flutterwave', 'flutterwaveEnabled'],
    ] as const).map(([, label, key]) => <div key={key} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><div className="text-sm font-bold">{label} · test checkout</div><div className={note}>{settings[key] ? 'School enabled; only shown when server confirms availability' : 'Disabled for parent checkout'}</div></div>{canEdit ? <Button variant="outline" disabled={update.isPending} onClick={async () => { if (!window.confirm(`${settings[key] ? 'Disable' : 'Enable'} ${label} test checkout for this school? The method is shown only when backend provider configuration is available.`)) return; try { await update.mutateAsync({ params: { schoolId }, data: { [key]: !settings[key] } }); setFailure(''); onSaved(`${label} checkout setting saved. Availability is confirmed by the server per invoice.`); } catch (error) { setFailure(errorText(error)); } }}>{settings[key] ? 'Disable' : 'Enable'} {label}</Button> : <span className={note}>School Admin only</span>}</div>)}</div>
    {failure && <p role="alert" className="mt-3 text-sm text-[hsl(var(--destructive))]">{failure}</p>}
  </section>;
}

function FinanceCard({ label, amount, detail, dark = false }: { label: string; amount: string; detail: string; dark?: boolean }) {
  return <div className={dark ? 'rounded-[22px] bg-[hsl(var(--sidebar))] p-6 text-[hsl(var(--sidebar-foreground))]' : 'panel rounded-[22px] p-6'}>
    <div className="text-[11px] font-bold uppercase tracking-[.16em] opacity-65">{label}</div>
    <div className="display-font mt-5 text-3xl font-bold tabular-nums md:text-4xl">{amount}</div>
    <div className="mt-4 text-xs font-medium opacity-65">{detail}</div>
  </div>;
}

function InvoiceList({ invoices, onAdjust }: { invoices: FeeInvoice[]; onAdjust?: (invoice: FeeInvoice) => void }) {
  if (!invoices.length) return <EmptyState icon={ReceiptText} title="No invoices yet" description="Assigned fee structures will appear here as individual student invoices." />;
  return <div className="divide-y divide-[hsl(var(--border))]">
    {invoices.map(invoice => <div key={invoice.id} className="grid gap-4 px-5 py-5 hover:bg-[hsl(var(--muted)/.2)] md:grid-cols-[minmax(0,1.6fr)_1fr_1fr_auto] md:items-center md:px-6" data-testid={`row-invoice-${invoice.id}`}>
      <div><div className="font-bold">{invoice.studentName}</div><div className="mt-1 font-mono text-[11px] text-[hsl(var(--muted-foreground))]">{invoice.invoiceNumber} · Student #{invoice.studentId}</div></div>
      <div><div className="text-xs text-[hsl(var(--muted-foreground))]">Billed / verified paid</div><div className="mt-1 text-sm font-bold tabular-nums">{naira(invoice.totalMinor)} <span className="text-[hsl(var(--muted-foreground))]">/ {naira(invoice.paidMinor)}</span></div></div>
      <div><div className="text-xs text-[hsl(var(--muted-foreground))]">Outstanding</div><div className="mt-1 text-sm font-extrabold tabular-nums">{naira(invoice.outstandingMinor)}</div></div>
      <div className="flex items-center gap-3"><StatusPill value={invoice.status} />{onAdjust && invoice.outstandingMinor > 0 && <Button variant="quiet" onClick={() => onAdjust(invoice)} testId={`button-adjust-${invoice.id}`}>Adjust</Button>}</div>
    </div>)}
  </div>;
}

export function FinancePage() {
  const { schoolId } = useTenant();
  const qc = useQueryClient();
  const context = useGetAuthorizedContext();
  const canEditSettings = context.data?.roles?.some(role => role.role === 'SCHOOL_ADMIN' && role.schoolId === schoolId && role.status === 'ACTIVE') === true;
  const [tab, setTab] = useState<Tab>('overview');
  const [dialog, setDialog] = useState<'category' | 'structure' | 'assignment' | 'adjustment' | null>(null);
  const [editing, setEditing] = useState<FeeCategory | null>(null);
  const [selectedStructure, setSelectedStructure] = useState<FeeStructure | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<FeeInvoice | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [categoryDescription, setCategoryDescription] = useState('');
  const [compulsory, setCompulsory] = useState(true);
  const [sessionId, setSessionId] = useState('');
  const [termId, setTermId] = useState('');
  const [classId, setClassId] = useState('');
  const [section, setSection] = useState('');
  const [lines, setLines] = useState([{ categoryId: '', amount: '', description: '' }]);
  const [studentId, setStudentId] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [adjustmentKind, setAdjustmentKind] = useState<'DISCOUNT' | 'SCHOLARSHIP' | 'WAIVER'>('DISCOUNT');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [feedback, setFeedback] = useState('');
  const [failure, setFailure] = useState('');
  const params = { schoolId };
  const summary = useGetSchoolFinanceSummary(params, { query: { enabled: !!schoolId, queryKey: getGetSchoolFinanceSummaryQueryKey(params), refetchInterval: 30000 } });
  const categories = useListFeeCategories(params, { query: { enabled: !!schoolId, queryKey: getListFeeCategoriesQueryKey(params) } });
  const structures = useListFeeStructures(params, { query: { enabled: !!schoolId, queryKey: getListFeeStructuresQueryKey(params) } });
  const invoices = useListFeeInvoices(params, { query: { enabled: !!schoolId, queryKey: getListFeeInvoicesQueryKey(params) } });
  const settings = useGetFinanceSettings(params, { query: { enabled: !!schoolId, queryKey: getGetFinanceSettingsQueryKey(params) } });
  const sessions = useListAcademicSessions(params, { query: { enabled: !!schoolId && dialog === 'structure', queryKey: getListAcademicSessionsQueryKey(params) } });
  const terms = useListAcademicTerms(Number(sessionId), params, { query: { enabled: !!schoolId && !!sessionId && dialog === 'structure', queryKey: getListAcademicTermsQueryKey(Number(sessionId), params) } });
  const classes = useListClasses(params, { query: { enabled: !!schoolId && dialog === 'structure', queryKey: getListClassesQueryKey(params) } });
  const students = useListStudents(params, { query: { enabled: !!schoolId && dialog === 'assignment', queryKey: getListStudentsQueryKey(params) } });
  const createCategory = useCreateFeeCategory();
  const updateCategory = useUpdateFeeCategory();
  const createStructure = useCreateFeeStructure();
  const publishStructure = usePublishFeeStructure();
  const assignStructure = useAssignFeeStructure();
  const updateSettings = useUpdateFinanceSettings();
  const requestAdjustment = useRequestFeeAdjustment();
  const busy = [createCategory, updateCategory, createStructure, publishStructure, assignStructure, updateSettings, requestAdjustment].some(m => m.isPending);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: getGetSchoolFinanceSummaryQueryKey(params) });
    qc.invalidateQueries({ queryKey: getListFeeCategoriesQueryKey(params) });
    qc.invalidateQueries({ queryKey: getListFeeStructuresQueryKey(params) });
    qc.invalidateQueries({ queryKey: getListFeeInvoicesQueryKey(params) });
    qc.invalidateQueries({ queryKey: getGetFinanceSettingsQueryKey(params) });
    qc.invalidateQueries({ queryKey: getListParentFeeInvoicesQueryKey() });
    qc.invalidateQueries({ queryKey: getListStudentFeeInvoicesQueryKey() });
    qc.invalidateQueries({ queryKey: getListSchoolFinancePaymentsQueryKey(params) });
    qc.invalidateQueries({ queryKey: getListSchoolFinancePaymentsQueryKey({ schoolId, status: 'PENDING' }) });
    qc.invalidateQueries({ queryKey: getListPendingFeeAdjustmentsQueryKey(params) });
    qc.invalidateQueries({ queryKey: getListParentFeePaymentsQueryKey() });
    qc.invalidateQueries({ queryKey: getListStudentFeePaymentsQueryKey() });
  };
  const done = (message: string) => { setDialog(null); setFeedback(message); setFailure(''); refresh(); };
  const fail = (e: unknown) => { setFailure(errorText(e)); setFeedback(''); };
  const openCategory = (category?: FeeCategory) => { setEditing(category ?? null); setCategoryName(category?.name ?? ''); setCategoryDescription(category?.description ?? ''); setCompulsory(category?.compulsory ?? true); setFailure(''); setDialog('category'); };
  const saveCategory = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (editing) await updateCategory.mutateAsync({ categoryId: editing.id, params, data: { name: categoryName.trim(), description: categoryDescription.trim(), compulsory } });
      else await createCategory.mutateAsync({ params, data: { name: categoryName.trim(), description: categoryDescription.trim(), compulsory } });
      done(editing ? 'Category updated.' : 'Category created.');
    } catch (err) { fail(err); }
  };
  const saveStructure = async (e: FormEvent) => {
    e.preventDefault();
    if (lines.some(line => !Number(line.categoryId) || toMinor(line.amount) < 1)) { setFailure('Each line needs a category and an amount greater than zero.'); return; }
    try {
      await createStructure.mutateAsync({ params, data: { sessionId: Number(sessionId), termId: Number(termId), classId: Number(classId), section: section.trim() || null, lines: lines.map(line => ({ categoryId: Number(line.categoryId), amountMinor: toMinor(line.amount), description: line.description.trim() })) } });
      done('Draft structure created. Publish it before assigning.');
    } catch (err) { fail(err); }
  };
  const assign = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedStructure) return;
    if (dueDate < issueDate) { setFailure('Due date must be on or after issue date.'); return; }
    try { await assignStructure.mutateAsync({ params, data: { structureId: selectedStructure.id, studentId: Number(studentId), issueDate, dueDate } }); done('Invoice issued to student.'); }
    catch (err) { fail(err); }
  };
  const adjust = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedInvoice) return;
    try {
      const result = await requestAdjustment.mutateAsync({ invoiceId: selectedInvoice.id, params, data: { kind: adjustmentKind, amountMinor: toMinor(adjustmentAmount), reason: adjustmentReason.trim() } });
      done(`Adjustment request #${result.id} recorded. It is not effective until approved.`);
      setTab('adjustments');
    } catch (err) { fail(err); }
  };
  if (!schoolId) return <><PageHeading eyebrow="School operations / Finance" title="School fees" action={<TenantPicker />} /><EmptyState icon={CircleDollarSign} title="Choose a school" description="Select an authorized school context to see its fee ledger." /></>;
  const loading = summary.isLoading || categories.isLoading || structures.isLoading || invoices.isLoading || settings.isLoading;
  const broken = summary.isError || categories.isError || structures.isError || invoices.isError || settings.isError;
  return <div className="fade-up">
    <PageHeading eyebrow="School operations / Finance" title="School fees, accounted for." description="Set the fee schedule, issue invoices and track only verified collections. All amounts are in Nigerian naira." action={<TenantPicker />} />
    {feedback && <div className="mb-5 flex items-center gap-2 rounded-xl border border-[hsl(157_37%_43%/.3)] bg-[hsl(157_37%_43%/.08)] px-4 py-3 text-sm font-semibold" role="status" data-testid="status-finance-success"><Check size={16} />{feedback}<button className="ml-auto" onClick={() => setFeedback('')} aria-label="Dismiss message"><X size={15} /></button></div>}
    {failure && !dialog && <div role="alert" className="mb-5 rounded-xl bg-[hsl(var(--destructive)/.08)] px-4 py-3 text-sm text-[hsl(var(--destructive))]">{failure}</div>}
    {loading ? <SkeletonPage /> : broken ? <ErrorState retry={() => { summary.refetch(); categories.refetch(); structures.refetch(); invoices.refetch(); settings.refetch(); }} /> : <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[1.2fr_1fr_1fr_.8fr]">
        <FinanceCard dark label="Verified collections" amount={naira(summary.data?.totalCollectedMinor ?? 0)} detail="Only confirmed payments count here" />
        <FinanceCard label="Total billed" amount={naira(summary.data?.totalBilledMinor ?? 0)} detail="Issued student invoices" />
        <FinanceCard label="Outstanding" amount={naira(summary.data?.totalOutstandingMinor ?? 0)} detail="Amount still due" />
        <FinanceCard label="Awaiting review" amount={String(summary.data?.pendingPayments ?? 0)} detail="Manual transfers pending verification" />
      </div>
      <div className="mt-7 flex gap-1 overflow-x-auto border-b border-[hsl(var(--border))]" role="tablist" aria-label="Finance sections">
        {([['overview', 'Overview'], ['transfers', 'Transfers'], ['adjustments', 'Approvals'], ['refunds', 'Refunds'], ['invoices', 'Invoices'], ['structures', 'Fee structures'], ['bulk', 'Bulk assignment'], ['reports', 'Reports'], ['categories', 'Categories'], ['controls', 'Controls']] as const).map(([id, label]) =>
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} data-testid={`tab-finance-${id}`} className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-bold transition-colors ${tab === id ? 'border-[hsl(var(--primary))] text-[hsl(var(--primary))]' : 'border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'}`}>{label}</button>)}
      </div>
      {tab === 'overview' && <div className="mt-6 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="panel overflow-hidden"><div className="flex items-center justify-between border-b border-[hsl(var(--border))] p-5 md:p-6"><div><div className="eyebrow">Recent ledger</div><h2 className="display-font mt-1 text-xl font-bold">Student invoices</h2></div><Button variant="quiet" onClick={() => setTab('invoices')}>View all <ArrowRight size={15} /></Button></div><InvoiceList invoices={(invoices.data ?? []).slice(0, 5)} /></section>
        <div className="space-y-5"><section className="rounded-[22px] bg-[hsl(var(--secondary))] p-6"><div className="flex items-center gap-2 text-[hsl(var(--primary))]"><ShieldCheck size={19} /><span className="text-xs font-extrabold uppercase tracking-widest">Verification boundary</span></div><h2 className="display-font mt-5 text-xl font-bold">Submitted is not settled.</h2><p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">A transfer submission stays pending until a school finance operator checks it against the bank record. No receipt is issued before verification.</p></section>
        <section className="panel p-6"><div className="eyebrow">Manual transfer queue</div><div className="mt-4 text-2xl font-bold">{summary.data?.pendingPayments ?? 0} pending</div><p className={`mt-2 ${note}`}>Open each submission to inspect its reference and supporting evidence against the bank record.</p><Button variant="outline" className="mt-4" onClick={() => setTab('transfers')} testId="button-open-transfer-queue">Review transfers <ArrowRight size={15} /></Button></section></div>
      </div>}
      {tab === 'controls' && settings.data && <div className="mt-5"><ProviderSettings key={`providers-${schoolId}`} schoolId={schoolId} settings={settings.data} canEdit={canEditSettings} onSaved={message => { setFeedback(message); setFailure(''); refresh(); qc.invalidateQueries({ predicate: query => typeof query.queryKey[0] === 'string' && /\/payment-methods$/.test(query.queryKey[0]) }); }} /></div>}
      {tab === 'transfers' && <SchoolPaymentQueue schoolId={schoolId} onChanged={message => { setFeedback(message); setFailure(''); }} />}
      {tab === 'adjustments' && <PendingAdjustments schoolId={schoolId} onChanged={message => { setFeedback(message); setFailure(''); }} />}
      {tab === 'refunds' && <RefundDesk key={schoolId} schoolId={schoolId} canApprove={canEditSettings} onChanged={message => { setFeedback(message); setFailure(''); refresh(); }} />}
      {tab === 'reports' && <FinanceReports key={schoolId} schoolId={schoolId} />}
      {tab === 'bulk' && <BulkAssignment key={schoolId} schoolId={schoolId} structures={structures.data ?? []} onChanged={message => { setFeedback(message); setFailure(''); refresh(); }} />}
      {tab === 'invoices' && <section className="panel mt-6 overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--border))] p-5 md:p-6"><div><div className="eyebrow">Account ledger</div><h2 className="display-font mt-1 text-xl font-bold">{invoices.data?.length ?? 0} invoices</h2></div></div><InvoiceList invoices={invoices.data ?? []} onAdjust={invoice => { setSelectedInvoice(invoice); setAdjustmentAmount(''); setAdjustmentReason(''); setFailure(''); setDialog('adjustment'); }} /></section>}
      {tab === 'categories' && <section className="panel mt-6 overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--border))] p-5 md:p-6"><div><div className="eyebrow">Fee catalogue</div><h2 className="display-font mt-1 text-xl font-bold">Categories</h2></div><Button onClick={() => openCategory()} testId="button-create-fee-category"><Plus size={16} />New category</Button></div>{!categories.data?.length ? <EmptyState icon={Layers3} title="Start with a category" description="Name the charges your school collects before building a term fee structure." action={<Button onClick={() => openCategory()}>Create category</Button>} /> : <div className="divide-y divide-[hsl(var(--border))]">{categories.data.map(category => <div key={category.id} className="flex flex-wrap items-center gap-4 px-5 py-4 md:px-6"><div className="min-w-0 flex-1"><div className="font-bold">{category.name}</div><div className={note}>{category.description || 'No description'} · {category.compulsory ? 'Compulsory' : 'Optional'}</div></div><StatusPill value={category.status} /><Button variant="quiet" onClick={() => openCategory(category)} testId={`button-edit-category-${category.id}`}>Edit</Button><Button variant="quiet" disabled={busy} onClick={async () => { try { await updateCategory.mutateAsync({ categoryId: category.id, params, data: { status: category.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' } }); done('Category status updated.'); } catch (err) { fail(err); } }} testId={`button-toggle-category-${category.id}`}>{category.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</Button></div>)}</div>}</section>}
      {tab === 'structures' && <section className="panel mt-6 overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--border))] p-5 md:p-6"><div><div className="eyebrow">Versioned schedules</div><h2 className="display-font mt-1 text-xl font-bold">Fee structures</h2></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setTab('bulk')}>Bulk assignment</Button><Button disabled={!categories.data?.some(c => c.status === 'ACTIVE')} onClick={() => { setLines([{ categoryId: '', amount: '', description: '' }]); setSessionId(''); setTermId(''); setClassId(''); setFailure(''); setDialog('structure'); }} testId="button-create-structure"><Plus size={16} />New structure</Button></div></div>{!structures.data?.length ? <EmptyState icon={BookOpen} title="No fee structures" description="Build a draft schedule for a session, term and class. Publish it when the amounts are final." /> : <div className="divide-y divide-[hsl(var(--border))]">{structures.data.map(structure => <div key={structure.id} className="flex flex-col gap-4 px-5 py-5 md:flex-row md:items-center md:px-6"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-bold">Structure #{structure.id} · v{structure.version}</span><StatusPill value={structure.status} /></div><div className={`mt-1 ${note}`}>Session #{structure.sessionId} · Term #{structure.termId} · Class #{structure.classId}{structure.section ? ` · ${structure.section}` : ''}</div><div className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">{structure.lines.map(line => `${line.categoryName}: ${naira(line.amountMinor)}`).join(' · ')}</div></div><div className="text-lg font-extrabold tabular-nums">{naira(structure.lines.reduce((sum, line) => sum + line.amountMinor, 0))}</div><div className="flex gap-2">{structure.status === 'DRAFT' && <Button variant="outline" disabled={busy} onClick={async () => { if (!window.confirm('Publish this structure? Published fees can be assigned to students.')) return; try { await publishStructure.mutateAsync({ structureId: structure.id, params }); done('Structure published.'); } catch (err) { fail(err); } }} testId={`button-publish-structure-${structure.id}`}>Publish</Button>}{structure.status === 'PUBLISHED' && <Button onClick={() => { setSelectedStructure(structure); setStudentId(''); setDueDate(''); setFailure(''); setDialog('assignment'); }} testId={`button-assign-structure-${structure.id}`}>Issue invoice</Button>}</div></div>)}</div>}</section>}
      {tab === 'controls' && <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_1.15fr]">
        <section className="panel p-6 md:p-8"><div className="eyebrow">Payment rules</div><h2 className="display-font mt-2 text-xl font-bold">Partial bank transfers</h2><p className="mt-3 max-w-xl text-sm leading-6 text-[hsl(var(--muted-foreground))]">When disabled, the submitted amount must cover the outstanding invoice balance. Changing this does not verify any payment.</p><div className="mt-6 flex items-center justify-between gap-5 rounded-xl border border-[hsl(var(--border))] p-4"><div className="text-sm font-bold">{settings.data?.partialPaymentsEnabled ? 'Allowed' : 'Not allowed'}</div>{canEditSettings ? <Button variant="outline" disabled={busy} onClick={async () => { try { await updateSettings.mutateAsync({ params, data: { partialPaymentsEnabled: !settings.data?.partialPaymentsEnabled } }); done('Payment rule saved.'); } catch (err) { fail(err); } }} testId="button-toggle-partial-payments"><SlidersHorizontal size={15} />Change rule</Button> : <span className={note}>School Admin only</span>}</div></section>
        {settings.data && <BankTransferSettings key={schoolId} schoolId={schoolId} settings={settings.data} canEdit={canEditSettings} onSaved={message => { setFeedback(message); setFailure(''); refresh(); qc.invalidateQueries({ predicate: query => typeof query.queryKey[0] === 'string' && /^\/api\/parent\/fees\/invoices\/\d+\/bank-details$/.test(query.queryKey[0]) }); }} />}
      </div>}
    </>}
    {dialog === 'category' && <Modal title={editing ? 'Edit category' : 'New fee category'} eyebrow="Fee catalogue" onClose={() => setDialog(null)}><form onSubmit={saveCategory} className="space-y-4"><Field label="Category name"><input required maxLength={100} value={categoryName} onChange={e => setCategoryName(e.target.value)} className={entry} data-testid="input-category-name" /></Field><Field label="Description"><textarea maxLength={500} value={categoryDescription} onChange={e => setCategoryDescription(e.target.value)} className={entry} rows={3} data-testid="input-category-description" /></Field><label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={compulsory} onChange={e => setCompulsory(e.target.checked)} data-testid="checkbox-category-compulsory" />Compulsory charge</label>{failure && <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{failure}</p>}<Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save category'}</Button></form></Modal>}
    {dialog === 'structure' && <Modal title="Build a fee structure" eyebrow="Draft schedule" onClose={() => setDialog(null)}><form onSubmit={saveStructure} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><Field label="Academic session"><select required value={sessionId} onChange={e => { setSessionId(e.target.value); setTermId(''); }} className={entry} data-testid="select-structure-session"><option value="">Select session</option>{sessions.data?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Term"><select required value={termId} onChange={e => setTermId(e.target.value)} className={entry} data-testid="select-structure-term"><option value="">Select term</option>{terms.data?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Class"><select required value={classId} onChange={e => setClassId(e.target.value)} className={entry} data-testid="select-structure-class"><option value="">Select class</option>{classes.data?.map(item => <option key={item.id} value={item.id}>{item.name} {item.section}</option>)}</select></Field><Field label="Section (optional)"><input value={section} onChange={e => setSection(e.target.value)} className={entry} maxLength={80} data-testid="input-structure-section" /></Field></div><div className="border-t border-[hsl(var(--border))] pt-4"><div className="mb-3 text-sm font-bold">Charge lines</div>{lines.map((line, index) => <div key={index} className="mb-3 rounded-xl bg-[hsl(var(--muted)/.5)] p-3"><div className="grid gap-2 sm:grid-cols-[1fr_110px_auto]"><select required value={line.categoryId} onChange={e => setLines(current => current.map((l, i) => i === index ? { ...l, categoryId: e.target.value } : l))} className={entry} data-testid={`select-line-category-${index}`}><option value="">Category</option>{categories.data?.filter(c => c.status === 'ACTIVE').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><input required min="0.01" step="0.01" type="number" placeholder="₦ amount" value={line.amount} onChange={e => setLines(current => current.map((l, i) => i === index ? { ...l, amount: e.target.value } : l))} className={entry} data-testid={`input-line-amount-${index}`} /><button type="button" disabled={lines.length === 1} onClick={() => setLines(current => current.filter((_, i) => i !== index))} aria-label="Remove line" className="px-2 disabled:opacity-30" data-testid={`button-remove-line-${index}`}><X size={16} /></button></div><input placeholder="Line note (optional)" maxLength={300} value={line.description} onChange={e => setLines(current => current.map((l, i) => i === index ? { ...l, description: e.target.value } : l))} className={`${entry} mt-2`} data-testid={`input-line-description-${index}`} /></div>)}<Button variant="quiet" onClick={() => setLines(current => [...current, { categoryId: '', amount: '', description: '' }])}><Plus size={15} />Add line</Button></div>{failure && <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{failure}</p>}<Button type="submit" disabled={busy || !sessions.data?.length || !classes.data?.length}>Save draft structure</Button></form></Modal>}
    {dialog === 'assignment' && selectedStructure && <Modal title="Issue student invoice" eyebrow={`Structure #${selectedStructure.id}`} onClose={() => setDialog(null)}><form onSubmit={assign} className="space-y-4"><p className={note}>This creates an individual invoice from the published fee schedule. Check the student and dates before issuing.</p><Field label="Student"><select required value={studentId} onChange={e => setStudentId(e.target.value)} className={entry} data-testid="select-invoice-student"><option value="">Select student</option>{students.data?.map(s => <option key={s.id} value={s.id}>{s.firstName} {s.lastName} · {s.admissionNo}</option>)}</select></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Issue date"><input required type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} className={entry} data-testid="input-invoice-issue-date" /></Field><Field label="Due date"><input required type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={entry} data-testid="input-invoice-due-date" /></Field></div>{failure && <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{failure}</p>}<Button type="submit" disabled={busy || !students.data?.length}>Issue invoice</Button></form></Modal>}
    {dialog === 'adjustment' && selectedInvoice && <Modal title="Request fee adjustment" eyebrow={selectedInvoice.invoiceNumber} onClose={() => setDialog(null)}><form onSubmit={adjust} className="space-y-4"><p className={note}>A request is not an approved adjustment. Invoice totals remain unchanged until approval.</p><Field label="Adjustment type"><select value={adjustmentKind} onChange={e => setAdjustmentKind(e.target.value as typeof adjustmentKind)} className={entry} data-testid="select-adjustment-kind"><option value="DISCOUNT">Discount</option><option value="SCHOLARSHIP">Scholarship</option><option value="WAIVER">Waiver</option></select></Field><Field label="Amount (₦)"><input required min="0.01" max={selectedInvoice.outstandingMinor / 100} step="0.01" type="number" value={adjustmentAmount} onChange={e => setAdjustmentAmount(e.target.value)} className={entry} data-testid="input-adjustment-amount" /></Field><Field label="Reason"><textarea required minLength={3} maxLength={500} value={adjustmentReason} onChange={e => setAdjustmentReason(e.target.value)} className={entry} data-testid="input-adjustment-reason" /></Field>{failure && <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{failure}</p>}<Button type="submit" disabled={busy}>Submit request</Button></form></Modal>}
  </div>;
}

function FamilyInvoiceRows({ invoices, onTransfer, payment }: { invoices: FeeInvoice[]; onTransfer?: (invoice: FeeInvoice) => void; payment: FeePayment | null }) {
  if (!invoices.length) return <EmptyState icon={FileText} title="Nothing due here yet" description="Your school's issued invoices will appear here when they are ready." />;
  return <div className="divide-y divide-[hsl(var(--border))]">{invoices.map(invoice => <article key={invoice.id} className="p-5 md:p-6" data-testid={`card-family-invoice-${invoice.id}`}><div className="flex flex-col justify-between gap-3 sm:flex-row"><div><div className="font-mono text-xs font-bold text-[hsl(var(--primary))]">{invoice.invoiceNumber}</div><h3 className="display-font mt-1 text-lg font-bold">{invoice.studentName}</h3><div className={`mt-1 ${note}`}>Session #{invoice.sessionId} · Term #{invoice.termId}</div></div><StatusPill value={invoice.status} /></div><div className="mt-5 grid gap-3 rounded-xl bg-[hsl(var(--secondary)/.65)] p-4 sm:grid-cols-3"><div><div className="eyebrow">Billed</div><div className="mt-1 font-bold tabular-nums">{naira(invoice.totalMinor)}</div></div><div><div className="eyebrow">Verified paid</div><div className="mt-1 font-bold tabular-nums">{naira(invoice.paidMinor)}</div></div><div><div className="eyebrow">Still due</div><div className="mt-1 font-extrabold tabular-nums text-[hsl(var(--primary))]">{naira(invoice.outstandingMinor)}</div></div></div>{payment?.invoiceId === invoice.id && <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-[hsl(var(--muted-foreground))]"><Clock3 size={14} />Transfer {payment.reference} · <StatusPill value={payment.status} />{payment.status === 'PENDING' && 'Awaiting school verification; not counted as paid.'}</div>}{onTransfer && invoice.outstandingMinor > 0 && !['WAIVED', 'CANCELLED'].includes(invoice.status) && <><ParentOnlineMethods invoice={invoice} studentId={invoice.studentId} /><div className="mt-4"><Button variant="outline" onClick={() => onTransfer(invoice)} testId={`button-submit-transfer-${invoice.id}`}><Banknote size={16} />Manual bank transfer</Button></div></>}</article>)}</div>;
}

export function MyFeesPage() {
  const query = useListStudentFeeInvoices();
  const invoices = query.data ?? [];
  return <div className="fade-up"><PageHeading eyebrow="Student portal / Finance" title="My fees" description="Your school invoices and verified balances in one place." />{query.isLoading ? <SkeletonPage /> : query.isError ? <ErrorState retry={() => query.refetch()} /> : <><div className="grid gap-4 sm:grid-cols-2"><FinanceCard dark label="Outstanding" amount={naira(invoices.reduce((sum, item) => sum + item.outstandingMinor, 0))} detail="Across all issued invoices" /><FinanceCard label="Verified paid" amount={naira(invoices.reduce((sum, item) => sum + item.paidMinor, 0))} detail="Pending transfers are excluded" /></div><section className="panel mt-6 overflow-hidden"><div className="border-b border-[hsl(var(--border))] p-5"><div className="eyebrow">School-issued records</div><h2 className="display-font mt-1 text-xl font-bold">Invoices</h2></div><FamilyInvoiceRows invoices={invoices} payment={null} /></section><FamilyPaymentHistory audience="student" /></>}</div>;
}

export function ParentFeesPage({ studentId }: { studentId: number }) {
  const qc = useQueryClient();
  const submissionKeys = useRef(new Map<string, string>());
  const child = useGetParentChild(studentId);
  const query = useListParentFeeInvoices();
  const [invoice, setInvoice] = useState<FeeInvoice | null>(null);
  const [payment, setPayment] = useState<FeePayment | null>(null);
  const [bank, setBank] = useState('');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [transferDate, setTransferDate] = useState(new Date().toISOString().slice(0, 10));
  const [proofUrl, setProofUrl] = useState('');
  const [failure, setFailure] = useState('');
  // The request options are captured by the generated mutation hook. Resolve the key
  // during render from the exact normalized payload, not after mutateAsync is called.
  // Failed retries reuse it; a changed submission gets its own key.
  const submissionFingerprint = invoice ? JSON.stringify([
    invoice.id, toMinor(amount), bank.trim(), reference.trim(), transferDate, proofUrl.trim(),
  ]) : '';
  let submissionKey = submissionFingerprint ? submissionKeys.current.get(submissionFingerprint) : undefined;
  if (submissionFingerprint && !submissionKey) {
    submissionKey = crypto.randomUUID();
    submissionKeys.current.set(submissionFingerprint, submissionKey);
  }
  const submit = useSubmitManualBankTransfer({ request: { headers: submissionKey ? { 'Idempotency-Key': submissionKey } : {} } });
  const authorizedInvoice = !!invoice && !!child.data && query.data?.some(item => item.id === invoice.id && item.studentId === studentId && item.schoolId === invoice.schoolId) === true;
  const bankDetails = useGetParentFeeInvoiceBankDetails(invoice?.id ?? 0, {
    query: { enabled: authorizedInvoice, queryKey: getGetParentFeeInvoiceBankDetailsQueryKey(invoice?.id ?? 0), refetchOnMount: 'always', refetchOnWindowFocus: true },
  });
  const details = bankDetails.data;
  const approvedBank = authorizedInvoice && details?.available === true && details.invoiceId === invoice?.id
    && details.schoolId === invoice.schoolId && !!details.bankName.trim() && !!details.accountName.trim()
    && /^[0-9]{10}$/.test(details.accountNumber);
  const invoices = (query.data ?? []).filter(item => item.studentId === studentId);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!invoice || !authorizedInvoice || !approvedBank) { setFailure('Approved bank details are unavailable for this invoice. You cannot submit a transfer here.'); return; }
    const amountMinor = toMinor(amount);
    if (amountMinor < 1 || amountMinor > invoice.outstandingMinor) { setFailure('Amount must be greater than zero and no more than the outstanding balance.'); return; }
    if (proofUrl.trim()) {
      try { if (new URL(proofUrl.trim()).protocol !== 'https:') { setFailure('Proof links must use HTTPS.'); return; } }
      catch { setFailure('Enter a valid HTTPS proof link or leave the field empty.'); return; }
    }
    try {
      const latest = await bankDetails.refetch();
      if (latest.isError || latest.data?.available !== true || latest.data.invoiceId !== invoice.id || latest.data.schoolId !== invoice.schoolId || !/^[0-9]{10}$/.test(latest.data.accountNumber)) {
        setFailure('This school is no longer accepting transfers for this invoice. No payment was submitted.');
        return;
      }
      const result = await submit.mutateAsync({ invoiceId: invoice.id, data: { amountMinor, bank: bank.trim(), transferReference: reference.trim(), transferDate, ...(proofUrl.trim() ? { proofUrl: proofUrl.trim() } : {}) } });
      setPayment(result); setInvoice(null); setFailure('');
      submissionKeys.current.delete(submissionFingerprint);
      qc.invalidateQueries({ queryKey: getListParentFeeInvoicesQueryKey() });
      qc.invalidateQueries({ queryKey: getListParentFeePaymentsQueryKey() });
    } catch (err) { setFailure(errorText(err)); }
  };
  if (child.isLoading) return <div className="mx-auto max-w-5xl p-8"><SkeletonPage /></div>;
  if (child.isError || !child.data) return <div className="mx-auto max-w-5xl p-8"><ErrorState retry={() => child.refetch()} message="This child is not linked to your parent account." /></div>;
  return <div className="mx-auto max-w-5xl p-5 md:p-8">
    <Link href={`/parent/children/${studentId}`} className="mb-6 inline-flex items-center gap-2 text-xs font-bold text-[hsl(var(--primary))]" data-testid="link-back-child"><ArrowLeft size={15} />Back to child profile</Link>
    <PageHeading eyebrow="Parent portal / Finance" title="Fees & payments" description="Review this child's school-issued invoices. A submitted transfer stays pending until the school verifies it." />
    {query.isLoading ? <SkeletonPage /> : query.isError ? <ErrorState retry={() => query.refetch()} /> : <>
      <div className="grid gap-4 sm:grid-cols-2">
        <FinanceCard dark label="Still due" amount={naira(invoices.reduce((sum, item) => sum + item.outstandingMinor, 0))} detail="Excludes transfers awaiting verification" />
        <FinanceCard label="Verified paid" amount={naira(invoices.reduce((sum, item) => sum + item.paidMinor, 0))} detail="Confirmed by the school" />
      </div>
      <section className="panel mt-6 overflow-hidden">
        <div className="border-b border-[hsl(var(--border))] p-5 md:p-6"><div className="eyebrow">Child #{studentId}</div><h2 className="display-font mt-1 text-xl font-bold">Invoices</h2></div>
        <FamilyInvoiceRows invoices={invoices} payment={payment} onTransfer={item => { setInvoice(item); setAmount((item.outstandingMinor / 100).toFixed(2)); setFailure(''); }} />
      </section>
      <FamilyPaymentHistory audience="parent" studentId={studentId} />
      <div className={`mt-4 flex items-start gap-2 ${note}`}><ShieldCheck size={16} className="shrink-0" />Only invoices belonging to linked children are available. Your school will verify transfers against its bank records before they affect the balance or produce a receipt.</div>
    </>}
    {invoice && <Modal title="Bank transfer" eyebrow={invoice.invoiceNumber} onClose={() => setInvoice(null)}>
      {!authorizedInvoice ? <div role="alert" className={note}>This invoice is not available for this linked child. No transfer can be submitted.</div>
        : bankDetails.isFetching ? <div className="space-y-3"><div className="skeleton h-24 rounded-xl" /><div className="skeleton h-16 rounded-xl" /></div>
        : bankDetails.isError ? <div><ErrorState retry={() => bankDetails.refetch()} message="Approved bank details could not be loaded. Transfer submission is unavailable until they can be confirmed." /></div>
        : !approvedBank ? <div className="rounded-xl bg-[hsl(var(--secondary))] p-5" role="status"><Banknote className="text-[hsl(var(--primary))]" size={23} /><h3 className="display-font mt-3 text-lg font-bold">Bank transfers unavailable</h3><p className={`mt-2 ${note}`}>This school has not enabled complete, approved bank details for this invoice. Do not transfer funds using unverified account information; contact the school finance office. You cannot submit a transfer here.</p></div>
        : details?.available === true && <form onSubmit={send} className="space-y-4">
        <div className="rounded-xl border border-[hsl(var(--primary)/.2)] bg-[hsl(var(--secondary))] p-5" data-testid="approved-invoice-bank-details"><div className="flex items-center gap-2 text-[hsl(var(--primary))]"><ShieldCheck size={18} /><span className="text-xs font-extrabold uppercase tracking-widest">School-approved bank account</span></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><div><div className="eyebrow">Bank</div><div className="mt-1 font-bold">{details.bankName}</div></div><div><div className="eyebrow">Account holder</div><div className="mt-1 font-bold">{details.accountName}</div></div><div className="sm:col-span-2"><div className="eyebrow">Account number</div><div className="mt-1 font-mono text-xl font-bold tracking-wider" data-testid="text-approved-account-number">{details.accountNumber}</div></div></div></div>
        <div className={note}><strong>{naira(invoice.outstandingMinor)}</strong> outstanding. This form records a transfer already made to the approved account above; it does not initiate payment. Submission remains pending until school verification.</div>
        <Field label="Amount transferred (₦)"><input required type="number" step="0.01" min="0.01" max={invoice.outstandingMinor / 100} value={amount} onChange={e => setAmount(e.target.value)} className={entry} data-testid="input-transfer-amount" /></Field>
        <Field label="Sending bank"><input required minLength={2} maxLength={100} value={bank} onChange={e => setBank(e.target.value)} className={entry} data-testid="input-transfer-bank" /></Field>
        <Field label="Bank transfer reference"><input required minLength={2} maxLength={150} value={reference} onChange={e => setReference(e.target.value)} className={entry} data-testid="input-transfer-reference" /></Field>
        <Field label="Transfer date"><input required type="date" max={new Date().toISOString().slice(0, 10)} value={transferDate} onChange={e => setTransferDate(e.target.value)} className={entry} data-testid="input-transfer-date" /></Field>
        <Field label="Proof link (optional)"><input type="url" maxLength={1000} placeholder="https://" value={proofUrl} onChange={e => setProofUrl(e.target.value)} className={entry} data-testid="input-transfer-proof" /></Field>
        {failure && <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{failure}</p>}
        <Button type="submit" disabled={submit.isPending}>{submit.isPending ? 'Submitting…' : 'Submit for verification'}</Button>
      </form>}
    </Modal>}
    {payment && <div className="fixed bottom-5 right-5 z-30 max-w-sm rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-xl" role="status" data-testid="status-transfer-submitted"><div className="flex items-center gap-2 font-bold"><Clock3 size={18} />Transfer submitted</div><p className={`mt-2 ${note}`}>Payment #{payment.id} · Reference {payment.reference} is {payment.status.toLowerCase()}. It is not a receipt and does not count as paid until verified.</p><Button variant="quiet" onClick={() => setPayment(null)} className="mt-3">Dismiss</Button></div>}
  </div>;
}