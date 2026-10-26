import {Router} from "express";
import {requireAuthentication} from "../middlewares/auth";
import {FlutterwavePayrollV3Client,FlutterwaveProviderResponseError,FlutterwaveProviderUncertainError} from "../lib/flutterwave-payroll-v3";
import {paymentAccountProviders,type PaymentAccountProviderDirectory} from "../lib/nigerian-payment-providers";
import {bankDirectoryDiagnostic} from "../lib/bank-directory-diagnostic";

/** Public institution metadata only; no account data or database reads.
 * This endpoint cannot initialize checkout, resolve accounts or make transfers. */
export function createPaymentAccountProvidersRouter(client=new FlutterwavePayrollV3Client()){
  const router=Router();
  let cached:{value:PaymentAccountProviderDirectory;until:number;diagnostic:Record<string,unknown>}|null=null;
  let pending:Promise<PaymentAccountProviderDirectory>|null=null;
  router.get("/payment-account-providers",(_req,res,next)=>{
    res.setHeader("Cache-Control","private, no-store");
    next();
  },requireAuthentication(),async(req,res)=>{
    const cacheHit=!!cached&&cached.until>Date.now();
    if(!cached||cached.until<=Date.now()){
      pending??=(async()=>{
        let value:PaymentAccountProviderDirectory;
        let report:Record<string,unknown>=bankDirectoryDiagnostic(null,null);
        try{
          const catalogue=await client.listNigerianBanks();
          report=catalogue.diagnostic??bankDirectoryDiagnostic(null,{data:catalogue.banks});
          value=paymentAccountProviders(catalogue.banks,catalogue.environment);
          report={...report,verifiedEntries:value.providers.filter(p=>p.transferCodeVerified).length,
            unsupportedEntries:value.providers.filter(p=>!p.transferCodeVerified).length};
        }catch(error){
          value=paymentAccountProviders(null,null);
          const directoryDiagnostic=(error as {directoryDiagnostic?:Record<string,unknown>}|null)?.directoryDiagnostic;
          if(directoryDiagnostic)report=directoryDiagnostic;
          const diagnostic=error instanceof FlutterwaveProviderResponseError||error instanceof FlutterwaveProviderUncertainError
            ?error.diagnostic:null;
          report={...report,reason:report.reason??diagnostic?.category??"DIRECTORY_RESPONSE_INVALID",
            httpStatus:report.httpStatus??diagnostic?.providerHttpStatus??null};
          value={...value,message:"The bank list is temporarily unavailable. Try again shortly, or contact the Platform Owner if the issue continues."};
        }
        req.log?.[value.status==="AVAILABLE"?"info":"warn"]({bankDirectory:report},"Flutterwave bank directory result");
        // A user retry must perform a new read after failure, not replay it.
        cached={value,diagnostic:report,until:value.status==="AVAILABLE"?Date.now()+300_000:0};
        return value;
      })();
      try{await pending;}finally{pending=null;}
    }
    res.setHeader("X-Bank-Directory-Cache",cacheHit?"HIT":"MISS");
    res.json(cached!.value);
  });
  return router;
}
export const paymentAccountProvidersRouter=createPaymentAccountProvidersRouter();
