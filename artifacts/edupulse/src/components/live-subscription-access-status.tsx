import type { SubscriptionAccessStatus } from '@workspace/api-client-react';

const copy = {
  PENDING: ['Verification pending', 'This payment has not granted verified LIVE access. Do not pay again while its outcome is uncertain.'],
  VERIFIED_ACTIVE: ['Verified subscription', 'Authoritative LIVE records confirm this student’s current subscription.'],
  FAILED: ['Payment failure reported', 'A failure was reported, but it is not independent financial verification. No paid access was granted. Contact the school before trying again.'],
  REFUNDED_REVERSED: ['Refund or reversal review', 'Access is on hold following an adverse event. This does not confirm that a refund settled or that funds were recovered.'],
  UNAVAILABLE: ['LIVE status unavailable', 'Verified access cannot be confirmed. Contact the school; no TEST payment or receipt will be used instead.'],
} as const;

/** Presentation only. Never infer entitlement from a receipt, grace period,
 * HTTP success, or the words "active" in a different financial namespace. */
export function LiveSubscriptionAccessStatus({items, audience}:{
  items:SubscriptionAccessStatus[]; audience:'student'|'parent';
}) {
  const visible = items.filter(item=>item.environment==='LIVE' && item.audiences?.includes(audience));
  if (!visible.length) return null;
  return <section aria-label="LIVE subscription access" className="mb-5 space-y-3">
    {visible.map(item=>{
      const status = item.liveStatus && item.liveStatus in copy ? item.liveStatus : 'UNAVAILABLE';
      const verified = status==='VERIFIED_ACTIVE' && item.entitled===true;
      const [title,description] = copy[status==='VERIFIED_ACTIVE'&&!verified?'UNAVAILABLE':status];
      const locked = item.restrictionReason==='SCHOOL_SUBSCRIPTION_LOCKED';
      return <div key={`${item.schoolId}-${item.studentId}`} role="status"
        data-testid={`live-subscription-${item.studentId}`} className="rounded-xl border bg-card p-4 text-sm">
        <p className="font-semibold">{audience==='parent'?item.studentName||`Child #${item.studentId}`:'Your subscription'} · {item.schoolName}{item.termName?` · ${item.termName}`:''}</p>
        <p className="mt-1 font-semibold">{title}</p>
        <p className="mt-1 text-muted-foreground">{description}</p>
        {locked && <p className="mt-2 font-semibold">School locked: the independent school lock still restricts access, even with a verified subscription.</p>}
        {!locked && item.restricted && <p className="mt-2">Subscription access is restricted.</p>}
        {item.receiptNumber && <p className="mt-2">Retained LIVE receipt: {item.receiptNumber}. A receipt alone does not grant access.</p>}
      </div>;
    })}
    <p className="text-xs text-muted-foreground">Sign-in, your account and inbox remain available. LIVE checkout is disabled. Bank settlement is not verified by this screen.</p>
  </section>;
}
