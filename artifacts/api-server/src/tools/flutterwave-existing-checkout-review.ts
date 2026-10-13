/**
 * Read an already-created provider-only TEST checkout. Never initializes or
 * completes a charge, follows a callback, imports the DB or settles app records.
 * NODE_ENV=development pnpm --filter @workspace/scripts exec tsx \
 *   ../artifacts/api-server/src/tools/flutterwave-existing-checkout-review.ts --existing-probe-only
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { FlutterwaveTestAdapter } from "../lib/fee-providers";
import { developmentFlutterwaveCredential } from "../lib/flutterwave-development-config";

export async function reviewExistingTestCheckout(
  reference: unknown,
  env: NodeJS.ProcessEnv = process.env,
  transport: typeof fetch = fetch,
) {
  const safety = {
    providerMutations: 0, databaseAccess: "NONE", webhookDeliveryVerified: false,
    applicationSettlementVerified: false, subscriptionActivated: false, receiptCreated: false,
  } as const;
  const credential = developmentFlutterwaveCredential(env);
  if (credential.state !== "CONFIGURED" || !env.REPLIT_DEV_DOMAIN
      || typeof reference !== "string" || !/^fw_split_probe_[a-f0-9]{32}$/.test(reference)) {
    return { ...safety, evidence: "NOT_RUN", credentialState: credential.state, paymentVerified: false };
  }
  const requests: { phase: "REFERENCE_LOOKUP" | "TRANSACTION_VERIFICATION"; httpStatus: number }[] = [];
  let transactionId: string | null = null;
  let attempts = 0;
  const boundedRead: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const phase = attempts === 0 ? "REFERENCE_LOOKUP" : "TRANSACTION_VERIFICATION";
    if (++attempts > 2 || init?.method !== "GET" || url.origin !== "https://api.flutterwave.com"
        || url.username || url.password || url.hash
        || (phase === "REFERENCE_LOOKUP"
          ? url.pathname !== "/v3/transactions/verify_by_reference"
            || url.search !== `?tx_ref=${encodeURIComponent(reference)}`
          : !transactionId || url.pathname !== `/v3/transactions/${transactionId}/verify` || !!url.search)) {
      throw new Error("Only the bound read-only verification endpoints are allowed");
    }
    const response = await transport(url.toString(), {
      ...init, redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    requests.push({ phase, httpStatus: response.status });
    if (phase === "REFERENCE_LOOKUP") {
      const payload: unknown = await response.clone().json().catch(() => null);
      if (payload && typeof payload === "object" && "data" in payload
          && payload.data && typeof payload.data === "object" && "id" in payload.data) {
        const id = payload.data.id;
        if ((typeof id === "number" && Number.isSafeInteger(id) && id > 0)
            || (typeof id === "string" && /^[1-9][0-9]{0,15}$/.test(id))) {
          transactionId = String(id);
        }
      }
    }
    return response;
  };
  try {
    const adapter = new FlutterwaveTestAdapter({ secretKey: credential.secret }, { fetch: boundedRead });
    const payment = await adapter.verifyCheckoutStatus({ reference, amountMinor: 500000, currency: "NGN" });
    return {
      ...safety, evidence: "PROVIDER_ONLY_READ", requests,
      expectedAmountMinor: 500000, expectedCurrency: "NGN",
      verificationOutcome: payment.status, paymentVerified: payment.status === "succeeded",
      referenceTransactionAmountCurrencyMatched: true,
    };
  } catch {
    // Neither upstream bodies nor exception text are safe to publish.
    return {
      ...safety, evidence: "PROVIDER_READ_UNCONFIRMED", requests,
      expectedAmountMinor: 500000, expectedCurrency: "NGN",
      verificationOutcome: "UNVERIFIED", paymentVerified: false,
      referenceTransactionAmountCurrencyMatched: false,
    };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== "--existing-probe-only") {
    console.error("Only the explicit existing provider-only probe review is permitted.");
    process.exitCode = 1;
  } else {
    try {
      const state: unknown = JSON.parse(await readFile(
        new URL("../../../../.local/flutterwave-split-probe/state.json", import.meta.url), "utf8",
      ));
      const reference = state && typeof state === "object" && "reference" in state ? state.reference : null;
      console.log(JSON.stringify(await reviewExistingTestCheckout(reference), null, 2));
    } catch {
      console.error("Existing TEST reference could not be reviewed; no mutations performed.");
      process.exitCode = 1;
    }
  }
}
