/** Normalized independent evidence, NOT webhook claims or echoed checkout metadata.
 * The separate default-disabled runtime supplies V3 collection readback plus a
 * reviewed transaction-bound provider allocation report.
 */
export interface LiveCollectionEvidence {
  environment: string;
  merchantScope: string;
  reference: string;
  transactionId: string;
  providerReference: string;
  status: string;
  currency: string;
  amountMinor: number;
  chargedAmountMinor: number;
  providerFeeMinor: number;
  additionalFeeMinor: number;
  recipientEvidence: string;
  recipients: { subaccountId: string; currency: string; amountMinor: number }[];
}

export interface LiveCollectionVerifier {
  readonly enabled: boolean;
  readonly environment: string;
  readonly merchantScope: string;
  verify(input: {
    reference: string;
    transactionId: string;
    currency: "NGN";
    amountMinor: 500000;
    schoolSubaccountId: string;
    signal: AbortSignal;
  }): Promise<LiveCollectionEvidence>;
}

export class LiveFinalizationBlocked extends Error {
  constructor(public readonly code: string) {
    super("LIVE finalization unavailable or requires reconciliation");
  }
}

/** Retained default refusal; operational callers must pass the separately gated verifier. */
export const blockedLiveCollectionVerifier: LiveCollectionVerifier = Object.freeze({
  enabled: false,
  environment: "LIVE",
  merchantScope: "",
  async verify(): Promise<LiveCollectionEvidence> {
    throw new LiveFinalizationBlocked("LIVE_VERIFICATION_TRANSPORT_DISABLED");
  },
});
