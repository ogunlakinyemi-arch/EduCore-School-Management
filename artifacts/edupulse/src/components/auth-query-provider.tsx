import { useMemo, type ReactNode } from 'react';
import { useAuth } from '@clerk/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Keep account-specific authorization and school queries out of the next
// account's cache, without resetting active queries during tenant mounting.
export function AuthQueryProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  const queryClient = useMemo(() => new QueryClient(), [userId]);

  // Changing the cache alone leaves child-local paginated inbox rows mounted.
  // Remount only for an actual identity change, never token/device rotation.
  return <QueryClientProvider key={userId??'anonymous'} client={queryClient}>{children}</QueryClientProvider>;
}