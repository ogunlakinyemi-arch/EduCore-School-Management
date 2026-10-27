/** No legacy component mounts here: old links cannot initialize or settle funds. */
export function ArchivedPaymentWorkflowPage(){
  return <section className="panel space-y-4 p-6">
    <h1 className="display-font text-2xl font-bold">Payment workflow archived</h1>
    <p>School split settlements, subaccount onboarding and Hosted Payments are no longer available.</p>
    <p>Historical financial records, receipts, provider references, subaccount IDs and audit history are retained unchanged for reporting, verification and referential integrity. This page has no payment, settlement or account-configuration actions.</p>
    <p>Student platform obligations are separate from parent-to-school fees. A new platform checkout requires a reviewed active rule and the existing reconciliation safeguards. Contact your administrator for payment instructions.</p>
  </section>;
}
