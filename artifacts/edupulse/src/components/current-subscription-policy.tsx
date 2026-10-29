/** Current direct school-admin subscription policy; never relabel historical ledger rows. */
export function CurrentSubscriptionPolicy() {
  return <section className="panel mb-5 p-5" data-testid="current-subscription-policy">
    <div className="eyebrow">NFC subscription · current policy</div>
    <h2 className="mt-2 text-lg font-bold">₦3,200 per student per academic term</h2>
    <p className="mt-2 text-sm">School Admins pay EduCore separately from school fees. The full gross subscription belongs to the platform; there is no school allocation, split payment or school subaccount settlement. Provider fees are a separate platform expense.</p>
    <p className="mt-2 text-sm">Eligible BRO commission is ₦150 per student per term under the current effective-dated rules, recorded internally and subject to approval. It is not a checkout split or an automatic transfer.</p>
    <p className="mt-2 text-sm">The current term remains free. Collection resumes from each school’s actual January 2027 second term. Existing payments, receipts, historical allocations and earlier commission rules remain unchanged.</p>
  </section>;
}
