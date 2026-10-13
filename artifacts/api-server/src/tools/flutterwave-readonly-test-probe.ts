/**
 * Dedicated TEST authentication evidence only. No DB/application imports,
 * transactions, checkout creation, recipients, payouts, refunds or notifications.
 * NODE_ENV=development pnpm --filter @workspace/scripts exec tsx \
 *   ../artifacts/api-server/src/tools/flutterwave-readonly-test-probe.ts --banks-only
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { developmentFlutterwaveCredential } from "../lib/flutterwave-development-config";

export async function probeTestBankCatalog(
  env: NodeJS.ProcessEnv = process.env,
  transport: typeof fetch = fetch,
) {
  const credential = developmentFlutterwaveCredential(env);
  if (credential.state !== "CONFIGURED" || !env.REPLIT_DEV_DOMAIN)
    return { evidence: "NOT_RUN", credentialState: credential.state, databaseAccess: "NONE" };
  try {
    const response = await transport("https://api.flutterwave.com/v3/banks/NG", {
      method: "GET", headers: { Authorization: `Bearer ${credential.secret}`, Accept: "application/json" },
      redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    const payload: unknown = await response.json().catch(() => null);
    const body = typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? payload as Record<string, unknown> : null;
    const accepted = response.ok && body?.status === "success" && Array.isArray(body.data);
    return {
      evidence: "GENUINE_PROVIDER_READ_ONLY", method: "GET", endpoint: "/v3/banks/NG",
      httpStatus: response.status, testAuthenticationAccepted: accepted,
      catalogEntryCount: accepted && Array.isArray(body?.data) ? body.data.length : null,
      databaseAccess: "NONE", providerMutations: 0, paymentVerified: false,
      webhookDeliveryVerified: false, settlementVerified: false,
    };
  } catch {
    // Never print upstream bodies, transport errors, credentials or bank details.
    return { evidence: "PROVIDER_READ_UNCONFIRMED", databaseAccess: "NONE", providerMutations: 0 };
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "--banks-only") {
    console.error("Only the explicit --banks-only read is permitted.");
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(await probeTestBankCatalog(), null, 2));
  }
}
