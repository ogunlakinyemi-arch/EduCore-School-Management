import { useEffect, useState, type FormEvent } from 'react';
import { lookupOwnerReceivingAccount, type OwnerReceivingAccountLookup } from '@workspace/api-client-react';
import { Button, Field } from '@/components/shared';
import { BankProviderSelect } from './bank-provider-select';
import { useBankSelectionGuard } from '@/lib/bank-selection';
import { entry, errMsg, note } from '@/pages/payroll-common';

export type OwnerAccountFormState = {
  businessName: string; businessRegistrationNumber: string; settlementContactEmail: string;
  settlementContactPhone: string; bankName: string; bankCode: string; accountName: string;
  accountNumber: string; lookupToken: string;
};
type Profile = { [K in keyof Omit<OwnerAccountFormState, 'accountNumber' | 'lookupToken'>]?: string | null } & { accountLast4?: string | null };

export function OwnerReceivingAccountForm({ profile, saving, onSubmit, onCancel }: {
  profile?: Profile | null; saving: boolean; onSubmit: (data: OwnerAccountFormState) => void; onCancel: () => void;
}) {
  const [f, setF] = useState(() => ({
    businessName: 'YETENIA TECHNOLOGIES LIMITED',
    businessRegistrationNumber: profile?.businessRegistrationNumber ?? '',
    settlementContactEmail: profile?.settlementContactEmail ?? '',
    settlementContactPhone: profile?.settlementContactPhone ?? '',
    bankName: profile?.bankName ?? '', bankCode: profile?.bankCode ?? '', accountNumber: '',
  }));
  const [lookup, setLookup] = useState<(OwnerReceivingAccountLookup & { key: string }) | null>(null);
  const [phase, setPhase] = useState<'idle' | 'waiting' | 'loading' | 'error' | 'matched'>('idle');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const bankAllowed = useBankSelectionGuard();
  const supported = bankAllowed(f, null);
  const key = JSON.stringify([f.bankName, f.bankCode, f.accountNumber]);
  const matched = supported && lookup?.key === key && lookup.accountNumberMatched === true
    && lookup.accountLast4 === f.accountNumber.slice(-4) && Date.parse(lookup.expiresAt) > Date.now();
  useEffect(() => {
    setLookup(null); setError(''); setPhase('idle');
    if (!supported || !/^[0-9]{10}$/.test(f.accountNumber)) return;
    let active = true;
    let expiration: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    setPhase('waiting');
    const timer = setTimeout(async () => {
      setPhase('loading');
      try {
        const result = await lookupOwnerReceivingAccount({
          bankName: f.bankName, bankCode: f.bankCode, accountNumber: f.accountNumber,
        }, { signal: controller.signal, cache: 'no-store' });
        if (!active) return;
        const remaining = Date.parse(result.expiresAt) - Date.now();
        if (result.accountNumberMatched !== true || result.accountLast4 !== f.accountNumber.slice(-4)
          || !/^\s*YETENIA[\s.,-]+TECHNOLOGIES[\s.,-]+(?:LIMITED|LTD)[\s.,-]*$/i.test(result.accountName)
          || !result.lookupToken || !Number.isFinite(remaining) || remaining <= 0) {
          throw new Error('The lookup was not confirmed. Check the selected bank and number, then retry.');
        }
        setLookup({ ...result, key }); setPhase('matched');
        expiration = setTimeout(() => {
          setLookup(null); setPhase('error'); setError('Account-name lookup expired. Retry before saving.');
        }, remaining);
      } catch (e) {
        if (!active) return;
        setLookup(null); setPhase('error'); setError(errMsg(e));
      }
    }, 500);
    return () => { active = false; controller.abort(); clearTimeout(timer); clearTimeout(expiration); };
  }, [f.bankName, f.bankCode, f.accountNumber, supported, key, retry]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!matched || !lookup || saving) { setError('A successful matching account-name lookup is required before saving.'); return; }
    onSubmit({ ...f, accountName: lookup.accountName, lookupToken: lookup.lookupToken });
  };
  return <form onSubmit={submit} className="space-y-4" data-testid="form-settlement">
    <Field label="Company"><input readOnly className={entry} value={f.businessName} /></Field>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Registration number (optional)"><input className={entry} value={f.businessRegistrationNumber} onChange={e => setF(v => ({ ...v, businessRegistrationNumber: e.target.value }))} /></Field>
      <Field label="Phone (optional)"><input className={entry} value={f.settlementContactPhone} onChange={e => setF(v => ({ ...v, settlementContactPhone: e.target.value }))} /></Field>
    </div>
    <Field label="Contact email (optional)"><input type="email" className={entry} value={f.settlementContactEmail} onChange={e => setF(v => ({ ...v, settlementContactEmail: e.target.value }))} /></Field>
    <BankProviderSelect value={f} onSelect={b => setF(v => ({ ...v, bankName: b.bankName, bankCode: b.bankCode }))} />
    <Field label="Account number (10 digits)"><input required type="password" inputMode="numeric" pattern="[0-9]{10}" maxLength={10} autoComplete="off"
      className={`${entry} font-mono`} data-testid="input-account-number" value={f.accountNumber}
      placeholder={profile?.accountLast4 ? `Current: ****${profile.accountLast4}` : ''}
      onChange={e => setF(v => ({ ...v, accountNumber: e.target.value.replace(/\D/g, '') }))} /></Field>
    <Field label="Account name (automatic)"><input readOnly className={entry} data-testid="input-account-name"
      value={matched && lookup ? lookup.accountName : ''} placeholder="Select a bank and enter the full account number" /></Field>
    <div aria-live="polite" role="status" className={note}>
      {phase === 'waiting' || phase === 'loading' ? 'Looking up account name…' : matched ? 'Company beneficiary matched. Save Details to use this account for assistance instructions.' : 'Only a successful LIVE lookup matching YETENIA TECHNOLOGIES LIMITED can be saved.'}
    </div>
    {error && <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{error}</p>}
    {phase === 'error' && <Button variant="quiet" onClick={() => setRetry(v => v + 1)}>Retry lookup</Button>}
    <p className={note}>Account-name resolution accepts only the official company name, ignoring case, spacing and punctuation separators, with a final LTD abbreviation allowed. It does not prove funds were received or verify Flutterwave merchant settlement. Saving without a fresh matching lookup or refreshing never verifies an account. Schools see details only after the matched account is saved. ₦3,200/student/term assistance does not pay a subscription or activate NFC; that requires a separate authorized, independently verified Flutterwave checkout.</p>
    <div className="flex gap-2"><Button type="submit" disabled={saving || !matched} testId="button-save-settlement">{saving ? 'Saving…' : 'Save Details'}</Button><Button variant="quiet" disabled={saving} onClick={onCancel}>Cancel</Button></div>
  </form>;
}
