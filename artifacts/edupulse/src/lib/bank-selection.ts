export type BankValue = { bankName: string; bankCode: string };
export const hasTransferCode = (code: string) => /^\d{3,6}$/.test(code.trim());
/**
 * A bank selection may be saved when it is the untouched saved record, or when it was chosen
 * from the directory (and, when a transfer code is needed, carries a verified code).
 */
export function bankSelectionAllowed(current: BankValue, original: BankValue | null | undefined, requireCode = true): boolean {
  if (!current.bankName.trim()) return false;
  if (original && original.bankName === current.bankName && original.bankCode === current.bankCode) return true;
  return requireCode ? hasTransferCode(current.bankCode) : true;
}

import { useGetPaymentAccountProviders } from '@workspace/api-client-react';

/** New cache namespace discards the old all-unverified fallback. Both picker
 * and save guard consume this exact contract and cache, not separate copies. */
export function useBankDirectory() {
  return useGetPaymentAccountProviders({
    query:{queryKey:['payment-account-providers','provider-record-isolation-v2'],staleTime:60_000,refetchOnMount:'always'},
    request:{cache:'no-store'},
  });
}
/**
 * Save guard backed by the loaded catalogue. A new/changed provider is accepted only when it matches a
 * directory entry (and, if a code is required, a currently verified entry carrying exactly that code).
 * A failed or UNAVAILABLE catalogue never verifies anything.
 */
export function useBankSelectionGuard() {
  const q = useBankDirectory();
  const data = q.isError ? undefined : q.data;
  return (current: BankValue, original: BankValue | null | undefined, requireCode = true): boolean => {
    if (!current.bankName.trim()) return false;
    if (!requireCode && original && original.bankName === current.bankName && original.bankCode === current.bankCode) return true;
    const entry = data?.providers.find(p => p.name === current.bankName && (!requireCode || p.code === current.bankCode));
    if (!entry) return false;
    if (!requireCode) return true;
    return data?.status === 'AVAILABLE' && entry.transferCodeVerified && !!entry.code && entry.code === current.bankCode && hasTransferCode(current.bankCode);
  };
}
