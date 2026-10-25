/**
 * Dedicated TEST authentication evidence only. No DB/application imports,
 * transactions, checkout creation, recipients, payouts, refunds or notifications.
 * NODE_ENV=development pnpm --filter @workspace/scripts exec tsx \
 *   ../artifacts/api-server/src/tools/flutterwave-readonly-test-probe.ts --banks-only
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { developmentFlutterwaveCredential } from "../lib/flutterwave-development-config";
import { paymentAccountProviders } from "../lib/nigerian-payment-providers";
import { bankDirectoryDiagnostic } from "../lib/bank-directory-diagnostic";

export async function probeTestBankCatalog(
  env: NodeJS.ProcessEnv = process.env,
  transport: typeof fetch = fetch,
) {
  const credential = developmentFlutterwaveCredential(env);
  if (credential.state !== "CONFIGURED" || !env.REPLIT_DEV_DOMAIN)
    return { evidence: "NOT_RUN", credentialState: credential.state, databaseAccess: "NONE" };
  try {
    const response = await transport("https://api.flutterwave.com/v3/banks/NG?include_provider_type=1", {
      method: "GET", headers: { Authorization: `Bearer ${credential.secret}`, Accept: "application/json" },
      redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    const payload: unknown = await response.json().catch(() => null);
    const body = typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? payload as Record<string, unknown> : null;
    const accepted = response.ok && body?.status === "success" && Array.isArray(body.data);
    const mapped = accepted ? paymentAccountProviders(body!.data as unknown[],"TEST") : null;
    const fields = (value: unknown) => value && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value).filter(key => /^[a-z][a-z0-9_]{0,39}$/i.test(key)).sort() : [];
    const rows = Array.isArray(body?.data) ? body.data : [];
    const codes = new Map<string, Set<string>>();
    for (const row of rows) {
      if (typeof row?.code !== "string" || typeof row?.name !== "string") continue;
      const names = codes.get(row.code) ?? new Set<string>();
      names.add(row.name.toLowerCase().replace(/[^a-z0-9]/g, "")); codes.set(row.code, names);
    }
    return {
      evidence: "GENUINE_PROVIDER_READ_ONLY", method: "GET", endpoint: "/v3/banks/NG?include_provider_type=1",
      httpStatus: response.status, testAuthenticationAccepted: accepted,
      catalogEntryCount: accepted && Array.isArray(body?.data) ? body.data.length : null,
      providerStatus: body?.status === "success" ? "success" : body?.status === "error" ? "error" : "UNRECOGNISED",
      responseFields: fields(body), dataFields: fields(body?.data),
      entryFields: [...new Set(rows.flatMap(fields))].sort(),
      codeTypes: [...new Set(rows.map(row => typeof row?.code))],
      codeLengths: [...new Set(rows.map(row => typeof row?.code === "string" ? row.code.length : null))],
      invalidCodeRows: rows.filter(row => typeof row?.code !== "string" || !/^\d{3,9}$/.test(row.code)).length,
      invalidNameRows: rows.filter(row => typeof row?.name !== "string" || !row.name.trim() || row.name.length > 180).length,
      conflictingCodeGroups: [...codes.values()].filter(names => names.size > 1).length,
      mappingStatus:mapped?.status??"NOT_RUN",
      mappedProviderCount:mapped?.providers.length??0,
      verifiedProviderCount:mapped?.providers.filter(row=>row.transferCodeVerified).length??0,
      unsupportedProviderCount:mapped?.providers.filter(row=>!row.transferCodeVerified).length??0,
      diagnostic:bankDirectoryDiagnostic(response.status,payload),
      credentialState: credential.state,
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
