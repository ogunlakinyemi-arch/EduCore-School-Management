import { liveAmountMinor } from "./flutterwave-live-finalization-event";
import { LiveFinalizationBlocked, type LiveCollectionEvidence, type LiveCollectionVerifier } from "./flutterwave-live-verification";

// Deliberately NOT an environment variable. No release in this implementation.
const LIVE_VERIFICATION_TRANSPORT_RELEASED: boolean = false;
type RecipientReport = {
  environment: "LIVE"; merchantScope: string; transactionId: string; reference: string;
  source: "TRANSACTION_BOUND"; recipients: LiveCollectionEvidence["recipients"];
};

/** A separate, independently authenticated transaction-linked recipient report is
 * mandatory. Checkout metadata or aggregate amount_settled cannot supply it.
 * No implementation/contract for retrieving that report is invented here.
 */
export function normalizeLiveIndependentRead(data: Record<string, unknown>, report: RecipientReport,
  expected: Parameters<LiveCollectionVerifier["verify"]>[0], merchantScope: string): LiveCollectionEvidence {
  if (data.status!=="successful" || data.currency!=="NGN" || data.tx_ref!==expected.reference
    || String(data.id)!==expected.transactionId || typeof data.flw_ref!=="string" || !data.flw_ref.length
    || liveAmountMinor(data.amount)!==500000 || liveAmountMinor(data.charged_amount)!==500000
    || report.environment!=="LIVE" || report.merchantScope!==merchantScope
    || report.transactionId!==expected.transactionId || report.reference!==expected.reference
    || report.source!=="TRANSACTION_BOUND" || !Array.isArray(report.recipients)
    || report.recipients.length!==1 || report.recipients[0]?.subaccountId!==expected.schoolSubaccountId
    || report.recipients[0]?.currency!=="NGN" || report.recipients[0]?.amountMinor!==190000) {
    throw new LiveFinalizationBlocked("LIVE_INDEPENDENT_REPORT_MISMATCH");
  }
  // Missing fee components remain unknown; never default them to zero or VAT.
  const providerFeeMinor=liveAmountMinor(data.app_fee),additionalFeeMinor=liveAmountMinor(data.merchant_fee);
  if(providerFeeMinor+additionalFeeMinor>=300000) throw new LiveFinalizationBlocked("LIVE_COST_REQUIRES_REVIEW");
  return {environment:"LIVE",merchantScope,reference:expected.reference,transactionId:expected.transactionId,
    providerReference:data.flw_ref,status:"succeeded",currency:"NGN",amountMinor:500000,chargedAmountMinor:500000,
    providerFeeMinor,additionalFeeMinor,recipientEvidence:"TRANSACTION_BOUND",recipients:report.recipients};
}

/** Reads only, no checkout/refund/transfer method or secret access. Every call is
 * hard-blocked BEFORE either injected reader can execute, even in fixture mode.
 * Native tests use a fictional verifier, not a bypass of this transport gate.
 */
export class IsolatedLiveVerificationTransport implements LiveCollectionVerifier {
  readonly enabled = LIVE_VERIFICATION_TRANSPORT_RELEASED;
  readonly environment = "LIVE";
  constructor(readonly merchantScope: string, private readonly readers: {
    transactionGet(path: string, signal: AbortSignal): Promise<Record<string,unknown>>;
    recipientReport(transactionId: string, signal: AbortSignal): Promise<RecipientReport>;
  }) {}
  async verify(input: Parameters<LiveCollectionVerifier["verify"]>[0]): Promise<LiveCollectionEvidence> {
    if(!LIVE_VERIFICATION_TRANSPORT_RELEASED) throw new LiveFinalizationBlocked("LIVE_VERIFICATION_TRANSPORT_DISABLED");
    if(!/^[1-9][0-9]{0,15}$/.test(input.transactionId)) throw new LiveFinalizationBlocked("LIVE_TRANSACTION_ID_INVALID");
    const data=await this.readers.transactionGet(`transactions/${input.transactionId}/verify`,input.signal);
    const report=await this.readers.recipientReport(input.transactionId,input.signal);
    return normalizeLiveIndependentRead(data,report,input,this.merchantScope);
  }
}
