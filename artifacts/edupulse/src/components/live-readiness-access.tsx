import { Link } from 'wouter';
import { useGetAuthorizedContext } from '@workspace/api-client-react';

/** Discovery only: callers pass their server-authorized Owner status.
 * The destination and API retain their independent permission checks.
 */
export function LiveReadinessAccess({ isOwner }: { isOwner: boolean }) {
  const authorization = useGetAuthorizedContext();
  if (!import.meta.env.DEV || isOwner !== true || authorization.isLoading || authorization.isError
    || authorization.data?.isPlatformOwner !== true) return null;
  return (
    <aside className="panel mb-5 flex min-w-0 flex-col gap-3 border border-[hsl(var(--primary))] p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="live-readiness-access">
      <div className="min-w-0">
        <h2 className="font-bold">Flutterwave LIVE readiness — Owner evidence preview</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Separate from TEST Split Settlements. Read-only validation: no approval, saved evidence, payment or LIVE activation. Existing Owner permission is still required.</p>
      </div>
      <Link href="/partners/live-readiness" data-testid="link-open-live-readiness" className="inline-flex w-full shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--primary))] px-4 py-3 text-center text-sm font-bold text-[hsl(var(--primary-foreground))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 sm:w-auto">
        Open LIVE readiness
      </Link>
    </aside>
  );
}
