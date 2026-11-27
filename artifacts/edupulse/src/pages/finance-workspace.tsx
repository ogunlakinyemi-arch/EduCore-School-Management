import { Link } from 'wouter';
import { useGetAuthorizedContext } from '@workspace/api-client-react';
import { PageHeading, useTenant } from '@/components/shared';

export function FinanceWorkspacePage() {
  const { schoolId } = useTenant();
  const { data } = useGetAuthorizedContext();
  const owner = data?.isPlatformOwner === true;
  const schoolFinance = !owner && data?.roles?.some(role =>
    role.status === 'ACTIVE' && role.schoolId === schoolId &&
    (role.role === 'SCHOOL_ADMIN' || role.role === 'ACCOUNTANT'));
  const schoolAdmin = schoolFinance && data?.roles?.some(role =>
    role.status === 'ACTIVE' && role.schoolId === schoolId && role.role === 'SCHOOL_ADMIN');
  const links = owner
    ? [
        ['/schools', 'Schools', 'Manage schools.'],
        ['/free-academic-terms', 'Free academic terms', 'Grant or revoke a free saved academic term.'],
        ['/staff-nfc-finance', 'Teacher payment status', 'View existing subscription payments.'],
        ['/payment-assistance', 'School payment assistance', 'Respond to requests submitted by schools.'],
      ]
    : schoolFinance
      ? [
          ['/finance', 'School fees', 'Invoices, payments, receipts and student statements.'],
          ['/staff-nfc-finance', 'Staff NFC subscriptions', 'School allocations, outstanding subscriptions and receipts.'],
          ...(schoolAdmin ? [
            ['/payroll', 'Payroll & salaries', 'Your school’s teachers and staff only.'],
            ['/transport', 'Transport fees', 'Bus assignments linked to the existing Finance invoices.'],
          ] : []),
        ]
      : [];
  return <div className="fade-up">
    <PageHeading eyebrow="Finance" title={owner ? 'School subscriptions' : 'School Finance'} />
    <div className="grid gap-4 md:grid-cols-2">
      {links.map(([href, title, description]) =>
        <Link key={href} href={href} className="panel p-6 transition-colors hover:bg-[hsl(var(--muted))]">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">{description}</p>
        </Link>)}
    </div>
  </div>;
}