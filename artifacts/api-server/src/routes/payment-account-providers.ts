import {Router} from "express";
import {requireAuthentication} from "../middlewares/auth";
import {FlutterwavePayrollV3Client,FlutterwavePayrollUnavailableError,FlutterwaveProviderResponseError,FlutterwaveProviderUncertainError} from "../lib/flutterwave-payroll-v3";
import {paymentAccountProviders,type PaymentAccountProviderDirectory} from "../lib/nigerian-payment-providers";

/** Public institution metadata only; no account data or database reads.
 * This endpoint cannot initialize checkout, resolve accounts or make transfers. */
export function createPaymentAccountProvidersRouter(client=new FlutterwavePayrollV3Client()){
  const router=Router();
  let cached:{value:PaymentAccountProviderDirectory;until:number}|null=null;
  let pending:Promise<PaymentAccountProviderDirectory>|null=null;
  router.get("/payment-account-providers",requireAuthentication(),async(_req,res)=>{
    res.setHeader("Cache-Control","private, no-store");
    if(!cached||cached.until<=Date.now()){
      pending??=(async()=>{
        let value:PaymentAccountProviderDirectory;
        try{
          const catalogue=await client.listNigerianBanks();
          value=paymentAccountProviders(catalogue.banks,catalogue.environment);
        }catch(error){
          value=paymentAccountProviders(null,null);
          const diagnostic=error instanceof FlutterwaveProviderResponseError||error instanceof FlutterwaveProviderUncertainError
            ?error.diagnostic:null;
          const reason=diagnostic?.category==="PROVIDER_AUTH_REJECTED"
            ?"Flutterwave rejected directory authentication. Ask the administrator to review the dedicated credential and provider permissions."
            :diagnostic?.category==="PROVIDER_RATE_LIMITED"
            ?"Flutterwave temporarily rate-limited the directory. Wait briefly, then retry."
            :!diagnostic&&error instanceof FlutterwavePayrollUnavailableError
            ?"The Flutterwave directory configuration or response is unavailable. Ask the administrator to review the explicit environment and dedicated credential."
            :"The Flutterwave directory could not be loaded. The provider may be unavailable; retry the directory.";
          value.message=`${reason} No new transfer-enabled bank selection can be saved without a confirmed provider code.`;
        }
        // A user retry must perform a new read after failure, not replay it.
        cached={value,until:value.status==="AVAILABLE"?Date.now()+300_000:0};
        return value;
      })();
      try{await pending;}finally{pending=null;}
    }
    res.json(cached!.value);
  });
  return router;
}
export const paymentAccountProvidersRouter=createPaymentAccountProvidersRouter();
