import type { FeeCategory } from '@workspace/api-client-react';

export const SCHOOL_NFC_CATEGORY = 'builtin:school-nfc';
export const SCHOOL_NFC_LABEL = 'School NFC Subscription Fee';
export const isSchoolNfcCategory = (name: string) => name.trim().toLowerCase() === SCHOOL_NFC_LABEL.toLowerCase();
export const isReservedPlatformCategory = (name: string) =>
  /nfc.*subscription|subscription.*nfc/i.test(name) && !/^school\s+nfc\b/i.test(name.trim());
export type FeeChargeLine = { categoryId: string; amount: string; description: string };
type Category = Pick<FeeCategory, 'id' | 'schoolId' | 'name' | 'status'>;

export function schoolChargeMinor(value: string) {
  const m = value.trim().match(/^(?:([0-9]+)(?:\.([0-9]{0,2}))?|\.([0-9]{1,2}))$/);
  if (!m) return null;
  const amount = BigInt(m[1] || '0') * 100n + BigInt((m[2] ?? m[3] ?? '').padEnd(2, '0') || '0');
  return amount > 0n && amount <= 2147483647n ? Number(amount) : null;
}
export function validFeeChargeLines(lines: FeeChargeLine[], categories: Category[], schoolId: number) {
  return lines.length > 0 && lines.every(l => schoolChargeMinor(l.amount) !== null &&
    (l.categoryId === SCHOOL_NFC_CATEGORY || categories.some(c => c.schoolId === schoolId &&
      c.id === Number(l.categoryId) && c.status === 'ACTIVE' && !isReservedPlatformCategory(c.name))));
}
export function feeChargeInput(line: FeeChargeLine) {
  const amountMinor = schoolChargeMinor(line.amount);
  if (amountMinor === null) throw new Error('Enter an amount greater than zero for every school charge.');
  return line.categoryId === SCHOOL_NFC_CATEGORY
    ? { builtInCategory: 'SCHOOL_NFC' as const, amountMinor }
    : { categoryId: Number(line.categoryId), amountMinor, description: line.description };
}

export function SchoolFeeChargeLine({ line, index, categories, schoolId, onChange, onRemove }: {
  line: FeeChargeLine; index: number; categories: Category[]; schoolId: number;
  onChange: (line: FeeChargeLine) => void; onRemove?: () => void;
}) {
  const input = 'w-full rounded-xl border bg-[hsl(var(--card))] px-3 py-2.5 text-sm';
  const builtin = line.categoryId === SCHOOL_NFC_CATEGORY;
  return <div className="mb-3 rounded-xl bg-[hsl(var(--muted)/.5)] p-3">
    <div className="grid gap-2 sm:grid-cols-[1fr_140px_auto]">
      <select required aria-label={`Fee category ${index + 1}`} value={line.categoryId} className={input}
        data-testid={`select-line-category-${index}`} onChange={e => onChange({
          ...line, categoryId: e.target.value,
          ...(e.target.value === SCHOOL_NFC_CATEGORY ? { amount: '', description: '' } : {}),
        })}>
        <option value="">Category</option>
        <option value={SCHOOL_NFC_CATEGORY}>{SCHOOL_NFC_LABEL}</option>
        {categories.filter(c => c.schoolId === schoolId && c.status === 'ACTIVE' &&
          !isReservedPlatformCategory(c.name) && !isSchoolNfcCategory(c.name))
          .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <input required aria-label={builtin ? "School NFC amount" : `Fee amount ${index + 1}`}
        min="0.01" step="0.01" type="number" placeholder="₦ amount (required)" value={line.amount}
        className={input} data-testid={`input-line-amount-${index}`}
        onChange={e => onChange({ ...line, amount: e.target.value })} />
      <button type="button" disabled={!onRemove} onClick={onRemove} aria-label="Remove line"
        className="px-2 disabled:opacity-30" data-testid={`button-remove-line-${index}`}>Remove</button>
    </div>
    {builtin ? <p className="mt-2 text-xs">Required school-defined charge, collected by your school. This does not pay or activate a Yetenia platform subscription.</p>
      : <input placeholder="Line note (optional)" maxLength={300} value={line.description}
        className={`${input} mt-2`} data-testid={`input-line-description-${index}`}
        onChange={e => onChange({ ...line, description: e.target.value })} />}
  </div>;
}
