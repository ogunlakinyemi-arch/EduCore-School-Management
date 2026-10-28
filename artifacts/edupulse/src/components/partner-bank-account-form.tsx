import { useEffect, useState, type FormEvent } from 'react';
import { lookupPartnerReceivingAccount, type PartnerBankLookup, type PartnerPayoutInformationInput } from '@workspace/api-client-react';
import { Button, Field } from '@/components/shared';
import { BankProviderSelect } from './bank-provider-select';
import { useBankSelectionGuard } from '@/lib/bank-selection';

type Masked = { bankName?: string | null; accountName?: string | null; maskedAccountNumber?: string | null; verified?: boolean } | null | undefined;
function registeredName(value: string) {
  if (!/^[A-Za-z\s.,'-]+$/.test(value)) return null;
  const words = value.toUpperCase().replace(/[.,'-]/g, ' ').trim().split(/\s+/);
  return words.length >= 2 && words.every(Boolean) ? words.join(' ') : null;
}

function errMsg(e: unknown) {
  const err = e as { error?: string; message?: string; data?: { error?: string } } | null;
  return err?.data?.error || err?.error || err?.message || 'Account-name lookup failed. Retry.';
}

/**
 * Automatic, server-matched BRO bank verification. Only a fresh lookup response for the exact
 * current bank + number + registered BRO name can be saved. The server performs the
 * name comparison; the client only checks the response shape, last4, token and expiry.
 */
export function PartnerBankAccountForm({ current, fullName, saving, onSave }: {
  current: Masked; fullName: string; saving: boolean; onSave: (data: PartnerPayoutInformationInput) => void;
}) {
  const [f, setF] = useState({ bankName: '', bankCode: '', accountNumber: '' });
  const [lookup, setLookup] = useState<(PartnerBankLookup & { key: string }) | null>(null);
  const [phase, setPhase] = useState<'idle' | 'waiting' | 'loading' | 'error' | 'matched'>('idle');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const bankAllowed = useBankSelectionGuard();
  const supported = bankAllowed(f, null);
  const key = JSON.stringify([f.bankName, f.bankCode, f.accountNumber, fullName]);
  const matched = supported && phase === 'matched' && lookup?.key === key
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
        const result = await lookupPartnerReceivingAccount({
          bankName: f.bankName, bankCode: f.bankCode, accountNumber: f.accountNumber,
        }, { signal: controller.signal, cache: 'no-store' });
        if (!active) return;
        const remaining = Date.parse(result?.expiresAt ?? '') - Date.now();
        if (!result || typeof result.accountName !== 'string' || !result.accountName.trim()
          || !registeredName(fullName) || registeredName(result.accountName) !== registeredName(fullName)
          || result.accountLast4 !== f.accountNumber.slice(-4)
          || typeof result.lookupToken !== 'string' || !result.lookupToken
          || !Number.isFinite(remaining) || remaining <= 0) {
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
    onSave({
      payoutMethod: 'BANK_TRANSFER', bankName: f.bankName, bankCode: f.bankCode,
      accountNumber: f.accountNumber, accountName: lookup.accountName, lookupToken: lookup.lookupToken,
    });
  };

  const verified = current?.verified === true ? current : null;
  return <form onSubmit={submit} className="space-y-5" data-testid="form-partner-bank">
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.35)] p-4 text-sm" data-testid="text-current-bank">
      {verified ? <>
        <div className="eyebrow">Verified payout account</div>
        <div className="mt-1 font-bold">{verified.bankName}</div>
        <div className="text-[hsl(var(--muted-foreground))]">{verified.accountName} <span className="font-mono">{verified.maskedAccountNumber}</span></div>
      </> : <span className="text-[hsl(var(--muted-foreground))]">No verified payout account on file. Payouts stay blocked until one is saved through automatic lookup.</span>}
    </div>
    <BankProviderSelect value={f} onSelect={b => setF(v => ({ ...v, bankName: b.bankName, bankCode: b.bankCode }))} />
    <div className="grid gap-5 md:grid-cols-2">
      <Field label="Account number (10 digits)">
        <input type="password" inputMode="numeric" maxLength={10} autoComplete="off" className="font-mono"
          data-testid="input-partner-account-number" value={f.accountNumber}
          placeholder={verified?.maskedAccountNumber ? `Current: ${verified.maskedAccountNumber}` : ''}
          onChange={e => setF(v => ({ ...v, accountNumber: e.target.value.replace(/\D/g, '').slice(0, 10) }))} />
      </Field>
      <Field label="Account name (automatic)">
        <input readOnly data-testid="input-partner-account-name" value={matched && lookup ? lookup.accountName : ''}
          placeholder="Select a bank and enter the full number" />
      </Field>
    </div>
    <div aria-live="polite" role="status" className="text-xs leading-5 text-[hsl(var(--muted-foreground))]" data-testid="status-partner-lookup">
      {phase === 'waiting' || phase === 'loading' ? 'Looking up account name…'
        : matched ? 'Account name matches your registered BRO name. Save to use this account for payouts.'
        : `The account name must match your registered BRO name (${fullName}) exactly, ignoring only case, spacing and punctuation separators.`}
    </div>
    {error && <p role="alert" className="text-sm text-[hsl(var(--destructive))]" data-testid="text-partner-lookup-error">{error}</p>}
    {phase === 'error' && <Button type="button" variant="quiet" onClick={() => setRetry(v => v + 1)} testId="button-retry-partner-lookup">Retry lookup</Button>}
    <p className="text-xs leading-5 text-[hsl(var(--muted-foreground))]">Refreshing this page or saving without a fresh matching lookup never verifies an account. Changing your profile name clears any pending lookup.</p>
    <div className="flex justify-end">
      <Button type="submit" disabled={saving || !matched} testId="button-save-partner-bank">{saving ? 'Saving…' : 'Save verified account'}</Button>
    </div>
  </form>;
}
