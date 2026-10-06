import { useGetMyPartnerNfcAccess, getGetMyPartnerNfcAccessQueryKey } from '@workspace/api-client-react';
import { useAuth } from '@clerk/react';

/** Live access: polled every 10s and on focus. Error or enabled=false means no activation UI. */
export function usePartnerNfcAccess() {
  const {userId,isLoaded,isSignedIn}=useAuth();
  const query = useGetMyPartnerNfcAccess({
    query: {
      queryKey: [...getGetMyPartnerNfcAccessQueryKey(),userId??'signed-out'],
      enabled:isLoaded&&isSignedIn===true,
      refetchInterval: 10000,
      refetchOnWindowFocus: true,
      retry: false,
      gcTime: 0,
    },
  });
  const allowed = isLoaded&&isSignedIn===true&&!query.isError && query.data?.enabled === true;
  return { query, allowed };
}

export function canAssign(p: { allowed: boolean; schoolsError: boolean; studentsError: boolean; cardsError: boolean; schoolEligible: boolean; studentId: number | null; cardNumber: string; pending: boolean }) {
  return p.allowed && !p.schoolsError && !p.studentsError && !p.cardsError && p.schoolEligible &&
    p.studentId != null && /^[a-zA-Z0-9:_-]{4,100}$/.test(p.cardNumber) && !p.pending;
}
