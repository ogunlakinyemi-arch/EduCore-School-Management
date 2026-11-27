/** Current direct school-admin subscription policy; never relabel historical ledger rows. */
export function CurrentSubscriptionPolicy({ showInternal = false }: { showInternal?: boolean }) {
  return <section className="panel mb-5 p-5" data-testid="current-subscription-policy">
    <div className="eyebrow">Platform subscription · current policy</div>
    <h2 className="mt-2 text-lg font-bold">₦3,200 per student per academic term</h2>
    <p className="mt-2 text-sm">Pay student subscriptions separately from parent-to-school fees. The school sets its own parent-facing charges.</p>
    {showInternal && <p className="mt-2 text-sm">Eligible BRO commission is ₦150 per student per term under the current effective-dated rules, recorded internally and subject to approval. It is not a checkout split or an automatic transfer.</p>}
    <p className="mt-2 text-sm">Free terms require no payment. Check eligibility for the selected school and term. Existing payments and receipts are unchanged.</p>
    <p className="mt-2 text-sm">Payment must be verified for each student and term. A request or uploaded receipt is not payment.</p>
  </section>;
}
