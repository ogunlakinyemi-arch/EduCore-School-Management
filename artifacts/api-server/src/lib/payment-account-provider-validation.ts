import { AuthError } from "../middlewares/auth";
import { FlutterwavePayrollV3Client } from "./flutterwave-payroll-v3";
import { paymentAccountProviders, type PaymentAccountProviderDirectory } from "./nigerian-payment-providers";

/** Browser selection is not authority: validate before writes with the same
 * current directory mapping, including its per-record ambiguity checks. */
export async function requireVerifiedPaymentAccountProvider(
  selection:{bankName?:unknown;bankCode?:unknown},
  client:Pick<FlutterwavePayrollV3Client,"listNigerianBanks">=new FlutterwavePayrollV3Client(),
) {
  let directory:PaymentAccountProviderDirectory;
  try {
    const catalogue=await client.listNigerianBanks();
    directory=paymentAccountProviders(catalogue.banks,catalogue.environment);
  } catch {
    throw new AuthError(503,"The bank list could not be checked. Refresh it and try again before saving.");
  }
  if(directory.status!=="AVAILABLE"||!directory.providers.some(p=>p.transferCodeVerified&&p.code
    &&p.name===selection.bankName&&p.code===selection.bankCode))
    throw new AuthError(400,"Choose a bank from the current verified bank list.");
}
