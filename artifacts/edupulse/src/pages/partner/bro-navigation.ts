export type BroNavItem = { href: string; label: string; hint: string; testId: string; ownerOnly?: boolean; devOnly?: boolean };

/** Primary BRO oversight workflow, in the order an Owner works through it. */
export const broPrimaryNav: BroNavItem[] = [
  { href: '/partners', label: 'Overview', hint: 'BROs, invitations, NFC access', testId: 'link-bro-overview' },
  { href: '/partners/term-commissions', label: 'Commissions', hint: 'Earned per student-term', testId: 'link-bro-commissions' },
  { href: '/partners/finance', label: 'Withdrawal decisions', hint: 'Approve or reject each line', testId: 'link-owner-connected-finance', ownerOnly: true },
  { href: '/partners/payouts', label: 'Payout status & history', hint: 'Prepared, recorded, verified', testId: 'link-bro-payouts' },
  { href: '/partners/field-operations', label: 'Field Operations', hint: 'Leads, visits, SMS', testId: 'link-owner-field-operations' },
];

/** Secondary evidence and controls. Always reachable; never removed. */
export const broSecondaryNav: BroNavItem[] = [
  { href: '/partners/conflicts', label: 'Attribution conflicts', hint: 'Disputed school attribution', testId: 'link-bro-conflicts' },
  { href: '/partners/live-readiness', label: 'LIVE readiness', hint: 'Development diagnostics', testId: 'link-bro-live-readiness', ownerOnly: true, devOnly: true },
];

export function visibleBroNav(items: BroNavItem[], opts: { isOwner: boolean; dev: boolean }) {
  return items.filter(i => (!i.ownerOnly || opts.isOwner) && (!i.devOnly || opts.dev));
}

export function isBroNavActive(href: string, location: string) {
  if (href === '/partners') return location === '/partners' || /^\/partners\/\d+$/.test(location);
  return location === href;
}
