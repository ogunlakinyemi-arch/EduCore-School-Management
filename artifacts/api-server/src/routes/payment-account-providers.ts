import {Router} from "express";
import {requireAuthentication} from "../middlewares/auth";
import {FlutterwavePayrollV3Client} from "../lib/flutterwave-payroll-v3";
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
        }catch{value=paymentAccountProviders(null,null);}
        cached={value,until:Date.now()+(value.status==="AVAILABLE"?300_000:15_000)};
        return value;
      })();
      try{await pending;}finally{pending=null;}
    }
    res.json(cached!.value);
  });
  return router;
}
export const paymentAccountProvidersRouter=createPaymentAccountProvidersRouter();
