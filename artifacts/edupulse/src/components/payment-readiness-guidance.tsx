const actions: Record<string, string> = {
  COLLECTION_ROLLOUT: "Use this school's saved academic calendar and actual January 2027 second-term start. The current-term free rollout is not an error to bypass.",
  MERCHANT_CONFIG: "Dedicated LIVE merchant configuration must be independently verified in the serving environment. Credential presence is not merchant approval; do not expose or paste secret values.",
  HTTPS_ENDPOINTS: "Verify the exact public HTTPS callback and same-origin webhook configuration, merchant-dashboard registration and authenticated delivery. A configured URL is not delivery evidence.",
  SCHEMA: "The full direct-payment/BRO contract requires four approved functions and nine triggers, with exact definitions, bindings and enablement verified through a supported database release mechanism. Direct-payment readiness checks its own subset; it does not certify BRO enforcement. Ordinary Publish and manual managed-Production SQL do not resolve the known delivery gap. Do not bypass this check.",
  STUDENT_RULE: "Retain the NGN 3,200, zero-school-share Student rule and its reviewed effective dates. Do not change the price or activate a rule merely to pass readiness.",
  RECONCILIATION: "Review fresh evidence for this exact school and term. Preserve legacy payments and obligations; do not convert, delete or rebill them.",
  NON_SPLIT_EVIDENCE: "Obtain independently reviewed merchant evidence for the non-split NGN 3,200 platform collection. A reference and hash record evidence; they do not prove a real settlement by themselves.",
  RUNTIME_SWITCH: "Leave LIVE disabled during preparation. Any later operational release requires separate authorization and verified prerequisites; review approval never enables the switch.",
};

const expectedChecks = [
  { code: "COLLECTION_ROLLOUT", label: "School-specific term rollout" },
  { code: "MERCHANT_CONFIG", label: "LIVE merchant configuration" },
  { code: "HTTPS_ENDPOINTS", label: "Callback and webhook evidence" },
  { code: "SCHEMA", label: "Database enforcement" },
  { code: "STUDENT_RULE", label: "Reviewed ₦3,200 Student rule" },
  { code: "RECONCILIATION", label: "School and term reconciliation" },
  { code: "NON_SPLIT_EVIDENCE", label: "Independent non-split merchant evidence" },
  { code: "RUNTIME_SWITCH", label: "Separate operational authorization" },
].map(c => ({ ...c, status: "NOT_EVALUATED" }));

/** Static, secret-free guidance; never changes or substitutes for server readiness. */
export function PaymentReadinessGuidance({ checks }: {
  checks?: { code: string; label: string; status: string }[];
}) {
  return <section className="panel min-w-0 p-5" data-testid="payment-readiness-guidance">
    <h2 className="display-font text-xl font-bold">Remaining payment prerequisites</h2>
    <p className="mt-2 text-sm">Preparation is not activation. Legacy split and hosted checkout remain archived.
      The separate parent-to-school fee workflow and historical records are unchanged.
      BRO earnings remain a separate expense with their own storage and approval checks.</p>
    {checks === undefined && <p className="mt-3 text-sm font-semibold" data-testid="readiness-not-evaluated">
      Guidance only — no selected scope has been evaluated. This checklist remains available when rules or catalogs are empty or unavailable.
      It reports no current Production status and grants no approval. Do not create or activate a rule merely to reveal diagnostics.
    </p>}
    <ul className="mt-4 space-y-3 text-sm">
      {(checks ?? expectedChecks).filter(c => !['READY', 'PASS', 'PASSED', 'OK', 'COMPLETE'].includes(c.status.toUpperCase())).map(c =>
        <li key={c.code} className="rounded-xl border border-[hsl(var(--border))] p-3">
          <strong>{c.label}</strong>
          <p className="mt-1">{actions[c.code] ?? "This prerequisite has not passed. Keep payment blocked and resolve the server-reported requirement; no approval or guarantee is inferred."}</p>
        </li>)}
    </ul>
    <p className="mt-3 text-xs">A passing check applies only to the selected scope and evidence at review time.
      Application safeguards do not protect against privileged direct SQL. Local test results do not certify Production, bank credit or provider settlement.</p>
  </section>;
}
