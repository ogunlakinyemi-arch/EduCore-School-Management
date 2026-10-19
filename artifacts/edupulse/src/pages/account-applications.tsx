import AccountApplicationsPanel from '@/components/account-applications-panel';

// Keep review independent of platform metrics, school selection and directory queries.
export default function AccountApplicationsPage() {
  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl" data-testid="page-owner-applications">
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        Review public School Admin and Partner applications. Applicants remain without operational access until approved.
      </p>
      <AccountApplicationsPanel />
    </div>
  );
}
