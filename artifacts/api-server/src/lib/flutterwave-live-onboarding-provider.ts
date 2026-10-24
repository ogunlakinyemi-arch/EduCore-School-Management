import {collectionSubaccountBankMatches} from "./flutterwave-subaccount-identity";
import {normalizeResolvedAccountName} from "./payroll-bank-encryption";
import {onboardingConfiguration} from "./flutterwave-live-onboarding-gate";

export class LiveOnboardingBlocked extends Error{
  constructor(public code:string,public providerHttpStatus:number|null=null){super(code);}
}
export type LiveSchoolBank={
  bankCode:string;accountNumber:string;accountName:string;bankName:string;
  businessName:string;businessEmail:string;businessPhone:string;
};
export type LiveSubaccountIdentity={providerId:number;subaccountId:string};

/** Dedicated LIVE transport; deliberately NOT a subclass of the TEST adapter.
 * No checkout, transfer, configuration mutation or undocumented retry header. */
export class FlutterwaveLiveOnboardingProvider{
  constructor(private env:NodeJS.ProcessEnv,private fetcher:typeof fetch=fetch){}
  private async api(path:string,body?:object):Promise<any>{
    if(this.env.NODE_ENV!=="production"||this.env.EDUCORE_FLUTTERWAVE_MODE!=="LIVE"
      ||!/^FLWSECK-(?!TEST-)[A-Za-z0-9_-]{8,}$/.test(this.env.FLUTTERWAVE_LIVE_SECRET_KEY??""))
      throw new LiveOnboardingBlocked("LIVE_ONBOARDING_CREDENTIAL_CONFIGURATION_REQUIRED");
    let response:Response;
    try{
      response=await this.fetcher(`https://api.flutterwave.com/v3/${path}`,{
        method:body?"POST":"GET",redirect:"error",signal:AbortSignal.timeout(12_000),
        headers:{authorization:`Bearer ${this.env.FLUTTERWAVE_LIVE_SECRET_KEY}`,accept:"application/json","content-type":"application/json"},
        ...(body?{body:JSON.stringify(body)}:{}),
      });
    }catch{throw new LiveOnboardingBlocked("LIVE_PROVIDER_OUTCOME_UNCONFIRMED");}
    if(response.status===401)throw new LiveOnboardingBlocked("LIVE_PROVIDER_AUTHENTICATION_REQUIRED",401);
    if(response.status===403)throw new LiveOnboardingBlocked("LIVE_SUBACCOUNT_API_PERMISSION_REQUIRED",403);
    const reader=response.body?.getReader();let text="";
    if(!reader)throw new LiveOnboardingBlocked("LIVE_PROVIDER_RESPONSE_UNCONFIRMED",response.status);
    try{
      const decoder=new TextDecoder();let size=0;
      while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;
        if(size>1_048_576){await reader.cancel();throw Error("size");}text+=decoder.decode(chunk.value,{stream:true});}
    }catch{throw new LiveOnboardingBlocked("LIVE_PROVIDER_RESPONSE_UNCONFIRMED",response.status);}
    let data:any;try{data=JSON.parse(text);}catch{throw new LiveOnboardingBlocked("LIVE_PROVIDER_RESPONSE_UNCONFIRMED",response.status);}
    // Established provider empty-list contract; never apply it to a creation POST.
    if(path==="subaccounts"&&!body&&response.status===400&&data?.status==="error"
      &&data.message==="Subaccounts not found"&&data.data===null)return {status:"success",data:[]};
    if(!response.ok||data?.status!=="success"||!data.data)
      throw new LiveOnboardingBlocked(response.status===429?"LIVE_PROVIDER_RATE_LIMITED":response.status>=500?"LIVE_PROVIDER_UNAVAILABLE":
        path==="accounts/resolve"?"LIVE_BANK_RESOLUTION_REJECTED":"LIVE_PROVIDER_RESPONSE_UNCONFIRMED",response.status);
    return data;
  }
  async resolve(bank:LiveSchoolBank){
    const r=await this.api("accounts/resolve",{account_bank:bank.bankCode,account_number:bank.accountNumber});
    if(r.data.account_number!==bank.accountNumber||typeof r.data.account_name!=="string"
      ||normalizeResolvedAccountName(r.data.account_name)!==normalizeResolvedAccountName(bank.accountName))
      throw new LiveOnboardingBlocked("LIVE_BANK_ACCOUNT_HOLDER_MISMATCH");
  }
  async create(bank:LiveSchoolBank):Promise<number>{
    const configuration=onboardingConfiguration(this.env);
    if(configuration.blockers.length)throw new LiveOnboardingBlocked(configuration.blockers.join(","));
    const r=await this.api("subaccounts",{account_bank:bank.bankCode,account_number:bank.accountNumber,
      country:"NG",business_name:bank.businessName,business_mobile:bank.businessPhone,business_email:bank.businessEmail,
      // Merchant-default policy requires a reviewed contract commitment. Billing
      // continues to use its existing explicit flat_subaccount=1900 override.
      split_type:"flat",split_value:3100});
    if(!Number.isSafeInteger(r.data.id)||r.data.id<=0)throw new LiveOnboardingBlocked("LIVE_PROVIDER_RESPONSE_UNCONFIRMED");
    return r.data.id;
  }
  async verify(id:number,bank:LiveSchoolBank):Promise<LiveSubaccountIdentity>{
    if(!Number.isSafeInteger(id)||id<=0)throw new LiveOnboardingBlocked("LIVE_SUBACCOUNT_READBACK_MISMATCH");
    const r=await this.api(`subaccounts/${id}`),d=r.data;
    if(!collectionSubaccountBankMatches(d,id,bank)
      ||normalizeResolvedAccountName(String(d.business_name??d.full_name??""))!==normalizeResolvedAccountName(bank.businessName)
      ||d.split_type!=="flat"||Number(d.split_value)!==3100
      ||(d.business_email!==undefined&&String(d.business_email).toLowerCase()!==bank.businessEmail.toLowerCase()))
      throw new LiveOnboardingBlocked("LIVE_SUBACCOUNT_READBACK_MISMATCH");
    return {providerId:id,subaccountId:d.subaccount_id};
  }
  async find(bank:LiveSchoolBank):Promise<number|null>{
    const r=await this.api("subaccounts");
    if(!Array.isArray(r.data)||r.data.length>5000||Number(r.meta?.page_info?.total_pages??1)>1
      ||r.meta?.next_page||r.meta?.next)
      throw new LiveOnboardingBlocked("LIVE_SUBACCOUNT_COMPLETE_LIST_REQUIRED");
    const matches=r.data.filter((d:any)=>d.account_number===bank.accountNumber&&String(d.account_bank)===bank.bankCode);
    if(matches.length>1)throw new LiveOnboardingBlocked("LIVE_SUBACCOUNT_AMBIGUOUS_MATCH");
    if(!matches.length)return null;
    const id=Number(matches[0].id);
    await this.verify(id,bank);return id;
  }
}
