import { useMemo, type ReactNode } from 'react';
import { useAuth } from '@clerk/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Keep account-specific authorization and school queries out of the next
// account's cache, without resetting active queries during tenant mounting.
export function AuthQueryProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  const queryClient = useMemo(() => new QueryClient(), [userId]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}