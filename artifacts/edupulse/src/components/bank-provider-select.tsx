import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useGetPaymentAccountProviders } from '@workspace/api-client-react';
import { hasTransferCode, type BankValue } from '@/lib/bank-selection';

const entry = 'w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3.5 py-2.5 text-sm font-medium outline-none focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.12)]';
const note = 'text-xs leading-5 text-[hsl(var(--muted-foreground))]';

export type BankProviderSelection = BankValue & { verified: boolean };
type Provider = { id: string; name: string; code: string | null; transferCodeVerified: boolean };

/**
 * Searchable bank directory picker. The parent only ever receives names from the directory;
 * bankCode is empty unless the entry's transfer code is verified in the current catalogue.
 */
export function BankProviderSelect({ value, onSelect, label = 'Bank name', requireCode = true, required = true, testId = 'input-bank-name' }: {
  value: BankValue; onSelect: (s: BankProviderSelection) => void; label?: string; requireCode?: boolean; required?: boolean; testId?: string;
}) {
  const q = useGetPaymentAccountProviders();
  const id = useId();
  const listId = `${id}-list`;
  const errId = `${id}-err`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [selection, setPicked] = useState<Provider | null>(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const catalogue = q.data;
  const trusted = !q.isError && catalogue?.status === 'AVAILABLE';
  const providers: Provider[] = useMemo(() => (catalogue?.providers ?? []).map(p => trusted ? p : { ...p, code: null, transferCodeVerified: false }), [catalogue, trusted]);
  const picked = selection ? providers.find(p => p.id === selection.id) ?? { ...selection, code: null, transferCodeVerified: false } : null;
  const matches = useMemo(() => {
    const t = text.trim().toLowerCase();
    return t ? providers.filter(p => p.name.toLowerCase().includes(t)) : providers;
  }, [providers, text]);
  const hasValue = !!value.bankName.trim();
  const savedOnly = hasValue && !picked;
  const pending = text.trim() !== '' && text !== (picked?.name ?? '');
  const unverified = !!picked && !!value.bankName && (!picked.transferCodeVerified || !picked.code || !hasTransferCode(picked.code));
  const confirmed = trusted && providers.some(p => p.name === value.bankName && p.code === value.bankCode && p.transferCodeVerified && !!p.code && hasTransferCode(p.code));
  const invalidMsg = pending ? 'Choose a bank from the list.'
    : !hasValue ? (required ? 'Choose a bank from the list.' : '')
    : requireCode && !confirmed ? `${value.bankName} has no currently confirmed transfer code and cannot be saved.` : '';
  useEffect(() => { inputRef.current?.setCustomValidity(invalidMsg); }, [invalidMsg]);
  const choose = (p: Provider) => {
    const verified = trusted && p.transferCodeVerified && !!p.code && hasTransferCode(p.code);
    setPicked(p); setText(p.name); setOpen(false);
    onSelect({ bankName: p.name, bankCode: verified ? p.code! : '', verified });
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && open && matches[active]) { e.preventDefault(); choose(matches[active]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };
  const unavailable = q.isError || (!!catalogue && catalogue.status !== 'AVAILABLE');
  return <div className="block">
    <label htmlFor={`${id}-input`} className="mb-1.5 block text-xs font-bold text-[hsl(var(--muted-foreground))]">{label}</label>
    <div className="relative">
      <input ref={inputRef} id={`${id}-input`} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={open && matches[active] ? `${id}-opt-${matches[active].id}` : undefined}
        className={entry} autoComplete="off" placeholder={savedOnly ? value.bankName : 'Search banks'} disabled={q.isLoading}
        aria-invalid={!!invalidMsg && (pending || hasValue)} aria-describedby={invalidMsg && (pending || hasValue) ? errId : unavailable ? `${id}-unavail` : undefined}
        value={text} onChange={e => {
          const t = e.target.value; setText(t); setActive(0); setOpen(true);
          if (t.trim() === '' && !picked) return;
          setPicked(null);
          if (value.bankName || value.bankCode) onSelect({ bankName: '', bankCode: '', verified: false });
        }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)} onKeyDown={onKey} data-testid={testId} />
      {open && <ul id={listId} role="listbox" aria-label={label} className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-1 text-sm shadow-lg">
        {matches.map((p, i) => <li key={p.id} id={`${id}-opt-${p.id}`} role="option" aria-selected={picked?.id === p.id} data-testid={`bank-option-${p.id}`}
          className={`cursor-pointer px-3.5 py-2 ${i === active ? 'bg-[hsl(var(--muted)/.6)]' : ''}`} onMouseDown={e => { e.preventDefault(); choose(p); }}>{p.name}{!(trusted && p.transferCodeVerified && p.code) && <span className={`ml-2 ${note}`}>transfer code not verified</span>}</li>)}
        {!matches.length && <li role="presentation" className={`px-3.5 py-2 ${note}`}>{providers.length ? 'No bank matches your search.' : 'The bank directory has no entries to choose from.'}</li>}
      </ul>}
    </div>
    {q.isLoading && <span className={`mt-1 block ${note}`}>Loading bank directory...</span>}
    {pending && <span id={errId} role="alert" className={`mt-1 block ${note} text-[hsl(var(--destructive))]`} data-testid="bank-pending-alert">{invalidMsg}</span>}
    {unavailable && <div id={`${id}-unavail`} role="alert" className={`mt-1 ${note} text-[hsl(var(--destructive))]`}>{catalogue?.message || 'The bank directory could not be loaded.'} Listed banks cannot be saved until the directory is available. <button type="button" disabled={q.isFetching} className="font-bold underline" onClick={() => void q.refetch()} data-testid="button-refresh-banks">{q.isFetching ? 'Retrying directory...' : 'Refresh the directory'}</button> or contact an administrator.</div>}
    {savedOnly && !pending && <span className={`mt-1 block ${note}`} data-testid="bank-saved-note">Saved bank: {value.bankName}{value.bankCode ? ` (code ${value.bankCode})` : ''}. {confirmed ? 'Code confirmed against the current directory.' : 'Not checked against the current directory. Search to choose a different bank.'}</span>}
    {savedOnly && !pending && invalidMsg && <span id={errId} role="alert" className={`mt-1 block ${note} text-[hsl(var(--destructive))]`}>{invalidMsg}</span>}
    {picked && !pending && !unverified && <span className={`mt-1 block ${note}`}>Transfer code {picked.code} found in the current bank directory.</span>}
    {picked && !pending && unverified && <span id={errId} role="alert" className={`mt-1 block ${note} text-[hsl(var(--destructive))]`} data-testid="bank-unverified-alert">{picked.name} has no verified transfer code in the current directory{requireCode ? ', so it cannot be saved' : ''}. Refresh the directory or contact an administrator.</span>}
  </div>;
}
