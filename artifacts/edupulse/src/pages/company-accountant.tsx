import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleDollarSign, RotateCw } from 'lucide-react';
import {
  Button, EmptyState, ErrorState, PageHeading, SkeletonPage, StatusPill,
} from '@/components/shared';

type Overview = {
  subscriptions: {
    verifiedSubscriptionCount: number;
    verifiedRevenue: string;
    verifiedEduPulseShare: string;
    unverifiedSubscriptionCount: number;
    activeVerifiedCount: number;
  };
  commissions: Array<{ status: string; currency: string; count: number; amount: string }>;
  payouts: Array<{ status: string; currency: string; count: number; amount: string }>;
};
type FinanceRecord = Record<string, string | number | null>;

const paths = {
  overview: '/api/company/accountant/overview',
  subscriptions: '/api/company/accountant/subscriptions',
  reconciliation: '/api/company/accountant/reconciliation',
  commissions: '/api/company/accountant/commissions',
  payouts: '/api/company/accountant/payouts',
} as const;
type Section = keyof typeof paths;

async function request<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (typeof body?.error === 'string') message = body.error;
    } catch {
      // Keep the HTTP status message when an error response is not JSON.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function money(value: string | number | null, currency = 'NGN') {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
    : '—';
}

export function CompanyAccountantPage() {
  const [section, setSection] = useState<Section>('overview');
  const overviewQuery = useQuery({
    queryKey: ['company-accountant', 'overview'],
    queryFn: () => request<Overview>(paths.overview),
  });
  const listQuery = useQuery({
    queryKey: ['company-accountant', section],
    queryFn: () => request<FinanceRecord[]>(paths[section] as string),
    enabled: section !== 'overview',
  });

  const title = section === 'overview' ? 'Finance overview'
    : section === 'subscriptions' ? 'Subscription transactions'
      : section === 'reconciliation' ? 'Unverified payments'
        : section === 'commissions' ? 'Partner commissions' : 'Partner payouts';
  const error = section === 'overview' ? overviewQuery.error : listQuery.error;

  return (
    <div className="fade-up">
      <PageHeading
        eyebrow="Yemait Technologies / Restricted access"
        title="Company Finance."
        description="Company-level subscription revenue, partner commissions and payouts only. School fees and school finance records are not available here."
        action={
          <Button
            variant="outline"
            onClick={() => {
              void overviewQuery.refetch();
              if (section !== 'overview') void listQuery.refetch();
            }}
            testId="button-refresh-company-finance"
          >
            <RotateCw size={15} />Refresh
          </Button>
        }
      />

      <nav className="mb-6 flex flex-wrap gap-2" aria-label="Company finance views">
        {([
          ['overview', 'Overview'],
          ['subscriptions', 'Subscription transactions'],
          ['reconciliation', 'Reconciliation'],
          ['commissions', 'Partner commissions'],
          ['payouts', 'Partner payouts'],
        ] as const).map(([key, label]) => (
          <Button
            key={key}
            variant={section === key ? 'primary' : 'outline'}
            onClick={() => setSection(key)}
            aria-current={section === key ? 'page' : undefined}
            testId={`button-company-finance-${key}`}
          >
            {label}
          </Button>
        ))}
      </nav>

      {error && (
        <div className="mb-5">
          <ErrorState
            retry={() => section === 'overview' ? overviewQuery.refetch() : listQuery.refetch()}
            message={error instanceof Error ? error.message : 'Company finance could not be loaded.'}
          />
        </div>
      )}

      {section === 'overview' ? (
        overviewQuery.isPending ? <SkeletonPage /> : overviewQuery.data ? (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Verified subscription revenue" value={money(overviewQuery.data.subscriptions.verifiedRevenue)} />
              <Metric label="EduPulse share of verified revenue" value={money(overviewQuery.data.subscriptions.verifiedEduPulseShare)} />
              <Metric label="Verified subscriptions" value={String(overviewQuery.data.subscriptions.verifiedSubscriptionCount)} />
              <Metric label="Awaiting verification" value={String(overviewQuery.data.subscriptions.unverifiedSubscriptionCount)} />
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <SummaryTable title="Commission totals" rows={overviewQuery.data.commissions} />
              <SummaryTable title="Payout totals" rows={overviewQuery.data.payouts} />
            </div>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Only the existing platform subscription, partner commission, and partner payout records are shown.
              School fee reconciliation and school transaction/receipt records are intentionally excluded.
            </p>
          </div>
        ) : null
      ) : listQuery.isPending ? <SkeletonPage /> : listQuery.data?.length ? (
        <RecordTable section={section} rows={listQuery.data} />
      ) : !error ? (
        <EmptyState
          icon={CircleDollarSign}
          title={section === 'reconciliation' ? 'No unverified transactions' : `No ${title.toLowerCase()} yet`}
          description={section === 'reconciliation'
            ? 'All recorded platform subscription payments are verified.'
            : 'There are no company-level records to display.'}
        />
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <section className="panel p-5">
      <p className="text-sm text-[hsl(var(--muted-foreground))]">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </section>
  );
}

function SummaryTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ status: string; currency: string; count: number; amount: string }>;
}) {
  return (
    <section className="panel overflow-hidden">
      <h2 className="border-b border-[hsl(var(--border))] px-5 py-4 font-bold">{title}</h2>
      {rows.length ? (
        <div className="divide-y divide-[hsl(var(--border)/.6)]">
          {rows.map((row) => (
            <div key={`${row.currency}-${row.status}`} className="flex items-center justify-between gap-3 px-5 py-3">
              <div>
                <StatusPill value={row.status} />
                <span className="ml-2 text-xs text-[hsl(var(--muted-foreground))]">{row.count} records</span>
              </div>
              <span className="font-semibold">{money(row.amount, row.currency)}</span>
            </div>
          ))}
        </div>
      ) : <p className="p-5 text-sm text-[hsl(var(--muted-foreground))]">No records.</p>}
    </section>
  );
}

function RecordTable({ section, rows }: { section: Section; rows: FinanceRecord[] }) {
  const columns: Array<[string, string]> = section === 'subscriptions'
    ? [['id', 'Record'], ['amount', 'Amount'], ['edupulseShare', 'EduPulse share'], ['provider', 'Provider'], ['providerReference', 'Reference'], ['verificationStatus', 'Verification'], ['createdAt', 'Created']]
    : section === 'reconciliation'
      ? [['id', 'Record'], ['amount', 'Amount'], ['provider', 'Provider'], ['providerReference', 'Reference'], ['status', 'Status'], ['verificationStatus', 'Verification'], ['createdAt', 'Created']]
      : section === 'commissions'
        ? [['partnerName', 'Partner'], ['amount', 'Amount'], ['currency', 'Currency'], ['status', 'Status'], ['paymentReference', 'Payment reference'], ['createdAt', 'Created']]
        : [['partnerName', 'Partner'], ['amount', 'Amount'], ['currency', 'Currency'], ['status', 'Status'], ['paymentReference', 'Payment reference'], ['periodStart', 'Period start'], ['periodEnd', 'Period end'], ['paidAt', 'Paid']];

  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-[hsl(var(--muted)/.3)] text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          <tr>{columns.map(([key, label]) => <th key={key} className="px-4 py-3 font-semibold">{label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-[hsl(var(--border)/.6)]">
          {rows.map((row, index) => (
            <tr key={String(row.id ?? `${row.partnerCode}-${index}`)}>
              {columns.map(([key]) => (
                <td key={key} className="max-w-64 px-4 py-3">
                  {key === 'status' || key === 'verificationStatus'
                    ? <StatusPill value={String(row[key] ?? 'UNKNOWN')} />
                    : key === 'amount' || key === 'edupulseShare'
                      ? money(row[key] as string | number | null, String(row.currency ?? 'NGN'))
                      : String(row[key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}