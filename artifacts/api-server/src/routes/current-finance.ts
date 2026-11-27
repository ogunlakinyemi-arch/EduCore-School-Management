import {Router} from "express";
import {z} from "zod";
import {pool as appPool} from "@workspace/db";
import {GetCurrentFinanceOverviewQueryParams,GetCurrentFinanceOverviewResponse,ActOnCurrentFinanceBody,
 ActOnCurrentFinanceResponse,GetCurrentFinanceReceiptParams,GetCurrentFinanceReceiptQueryParams,
 GetCurrentFinanceReceiptResponse} from "@workspace/api-zod";
import {requireAuthentication,assertRoles} from "../middlewares/auth";
import {CurrentFinancialBlocked,demand,type CurrentCapabilities,type CurrentPool} from "../services/current-financial-contract";
import {parseEntitlementKey} from "../services/current-finance-access";
import {currentProviderAdapters} from "../services/current-provider-adapters";
import {requestCurrentStudentRefund,approveCurrentStudentRefund,dispatchCurrentStudentRefund,
 reconcileCurrentStudentRefund,recordCurrentCollectionReversal} from "../services/current-student-refunds";
import {initiateCurrentBroPayout,reconcileCurrentBroPayout,recordCurrentBroRecovery} from "../services/current-bro-lifecycle";
import {requestCurrentBroWithdrawal,decideCurrentBroWithdrawal} from "../services/current-bro-withdrawals";
import {createCurrentBulk,verifyCurrentBulk,recoverCurrentBulk,type BulkDependencies} from "../services/current-bulk-subscriptions";
import {readCurrentFinanceOverview,readCurrentBulkReceipt} from "../services/current-finance-overview";
import {requestBankRemittance,bankRemittanceInstructions,verifyBankRemittance,postBankRemittance,
 closeBankRemittance,cancelLegacyAssistance} from "../services/company-bank-remittances";
import {retryCurrentBulk} from "../services/current-bulk-retry";
const id=z.number().int().positive().safe(),key=z.string().regex(/^[A-Za-z0-9_-]{16,100}$/),reason=z.string().trim().min(3).max(500);
const source={source:z.enum(["DIRECT","BULK"]),sourceId:id};
const sourceValue=(p:{source:"DIRECT"|"BULK";sourceId:number})=>p.source==="DIRECT"?p.sourceId:{allocationId:p.sourceId};
export function currentFinanceError(res:any,e:any){
 const code=e instanceof CurrentFinancialBlocked?e.code:
   /^[A-Z][A-Z0-9_]{5,150}$/.test(e?.code??"")?e.code:
   /^[A-Z][A-Z0-9_]{5,150}$/.test(e?.message??"")?e.message:
   ["42P01","42703"].includes(e?.code)?"CURRENT_FINANCIAL_SCHEMA_NOT_APPLIED":
   e?.code==="23505"?"CONCURRENT_OR_DUPLICATE_CLAIM_REFRESH_BEFORE_RETRY":"CURRENT_OPERATION_NOT_CONFIRMED_REFRESH_BEFORE_RETRY";
 res.status(e instanceof z.ZodError?400:e?.statusCode??(/NOT_AUTHORIZED|ACCESS_DENIED|PROFILE_OWNER_REQUIRED|OWN_ENTITLEMENT/.test(code)?403:
   /NOT_APPLIED|MIGRATION|GUARDS_REQUIRED/.test(code)?503:409)).json({error:code});
}
export function createCurrentFinanceRouter(pool:CurrentPool=appPool,dependencies?:CurrentCapabilities,bulk:BulkDependencies={}){
 const router=Router();
 const caps=()=>dependencies??currentProviderAdapters(pool);
 router.use("/current-finance",requireAuthentication(),(req,res,next)=>{
   res.setHeader("Cache-Control","no-store");
   try{res.locals.currentActorId=assertRoles(req,["PLATFORM_OWNER","PARTNER","SCHOOL_ADMIN","ACCOUNTANT"]).user.id;next();}
   catch(e){currentFinanceError(res,e);}
 });
 router.get("/current-finance/overview",async(req,res)=>{
  try{const p=GetCurrentFinanceOverviewQueryParams.parse(req.query);
   const projection=await readCurrentFinanceOverview(pool,res.locals.currentActorId,p.schoolId,p.termId);
   res.locals.scopedCurrentFinanceProjection=true;
   res.json(GetCurrentFinanceOverviewResponse.parse(projection));}
  catch(e){currentFinanceError(res,e);}
 });
 router.get("/current-finance/receipts/:id",async(req,res)=>{
  try{const p=GetCurrentFinanceReceiptParams.parse(req.params),q=GetCurrentFinanceReceiptQueryParams.parse(req.query);
   res.json(GetCurrentFinanceReceiptResponse.parse(await readCurrentBulkReceipt(pool,res.locals.currentActorId,p.id,q.allocationId)));}
  catch(e){currentFinanceError(res,e);}
 });
 router.post("/current-finance/actions",async(req,res)=>{
  try{
   const {action,payload}=ActOnCurrentFinanceBody.parse(req.body),actorId=res.locals.currentActorId;
   assertRoles(req,action==="WITHDRAW_REQUEST"?["PARTNER"]:
     ["BULK_CREATE","BULK_VERIFY","BULK_RECOVER","BULK_RETRY","BANK_REQUEST","BANK_INSTRUCTIONS","BANK_CANCEL"].includes(action)
       ?["PLATFORM_OWNER","SCHOOL_ADMIN","ACCOUNTANT"]:["PLATFORM_OWNER"]);
   let result:object;
   switch(action){
    case "REFUND_REQUEST":{
     const p=z.object({...source,amountMinor:id,key,reason}).strict().parse(payload);
     demand(p.amountMinor>=10000,"REFUND_MINIMUM_NGN_100");
     result=await requestCurrentStudentRefund(pool,actorId,sourceValue(p),p.amountMinor,p.key,p.reason);break;
    }
    case "REFUND_APPROVE":{
     const p=z.object({id,key}).strict().parse(payload);
     result=await approveCurrentStudentRefund(pool,actorId,p.id,p.key);break;
    }
    case "REFUND_DISPATCH":case "REFUND_RECONCILE":{
     const p=z.object({id}).strict().parse(payload);
     result=await (action==="REFUND_DISPATCH"?dispatchCurrentStudentRefund:reconcileCurrentStudentRefund)(pool,actorId,p.id,caps());break;
    }
    case "COLLECTION_REVERSAL":{
     const p=z.object({...source,eventReference:z.string().min(3).max(200),key}).strict().parse(payload);
     demand(p.source==="DIRECT","BULK_REVERSAL_ALLOCATION_EVIDENCE_REQUIRED");
     result=await recordCurrentCollectionReversal(pool,actorId,p.sourceId,p.eventReference,p.key,caps());break;
    }
    case "WITHDRAW_REQUEST":{
     const p=z.object({entitlementKeys:z.array(z.string()).min(1).max(500),key,reason}).strict().parse(payload);
     result=await requestCurrentBroWithdrawal(pool,actorId,p.entitlementKeys,p.key,p.reason);break;
    }
    case "WITHDRAW_DECIDE":{
     const p=z.object({requestId:id,entitlementKey:z.string(),decision:z.enum(["APPROVED","REJECTED"]),key,reason}).strict().parse(payload);
     result=await decideCurrentBroWithdrawal(pool,actorId,p,caps());break;
    }
    case "PAYOUT_INITIATE":{
     const p=z.object({entitlementKey:z.string(),key,reason}).strict().parse(payload);
     result=await initiateCurrentBroPayout(pool,actorId,parseEntitlementKey(p.entitlementKey),p.key,p.reason,caps());break;
    }
    case "PAYOUT_RECONCILE":{
     const p=z.object({id}).strict().parse(payload);result=await reconcileCurrentBroPayout(pool,actorId,p.id,caps());break;
    }
    case "BRO_RECOVERY":{
     const p=z.object({id,amountMinor:id,key,evidenceReference:z.string().min(3).max(200)}).strict().parse(payload);
     result=await recordCurrentBroRecovery(pool,actorId,p.id,p.amountMinor,p.key,p.evidenceReference,caps());break;
    }
    case "BULK_CREATE":{
     const p=z.object({schoolId:id,termId:id,studentIds:z.array(id).min(1).max(500),key,reason}).strict().parse(payload);
     result=await createCurrentBulk(pool,actorId,p,bulk);break;
    }
    case "BULK_VERIFY":{
     const p=z.object({id,transactionId:z.string().regex(/^[1-9][0-9]{0,15}$/)}).strict().parse(payload);
     result=await verifyCurrentBulk(pool,actorId,p.id,p.transactionId,bulk);break;
    }
    case "BULK_RECOVER":{
     const p=z.object({id}).strict().parse(payload);result=await recoverCurrentBulk(pool,actorId,p.id);break;
    }
    case "BANK_REQUEST":{
     const p=z.object({schoolId:id,termId:id,studentIds:z.array(id).min(1).max(500),key,reason}).strict().parse(payload);
     result=await requestBankRemittance(pool,actorId,p);break;
    }
    case "BANK_INSTRUCTIONS":{
     const p=z.object({id}).strict().parse(payload);result=await bankRemittanceInstructions(pool,actorId,p.id);break;
    }
    case "BANK_VERIFY":{
     const p=z.object({id,bankName:z.string().trim().min(2).max(100),
       statementReference:z.string().regex(/^[A-Za-z0-9/._ -]{6,120}$/),
       creditDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),amountMinor:id,
       independentlyChecked:z.literal(true),key,reason}).strict().parse(payload);
     result=await verifyBankRemittance(pool,actorId,p);break;
    }
    case "BANK_POST":{
     const p=z.object({id,key,reason}).strict().parse(payload);result=await postBankRemittance(pool,actorId,p.id,p.key,p.reason);break;
    }
    case "BANK_REJECT":case "BANK_CANCEL":{
     const p=z.object({id,key,reason}).strict().parse(payload);
     result=await closeBankRemittance(pool,actorId,p.id,p.key,p.reason,action==="BANK_REJECT"?"REJECTED":"CANCELLED");break;
    }
    case "LEGACY_ASSISTANCE_CANCEL":{
     const p=z.object({id,key,reason}).strict().parse(payload);
     result=await cancelLegacyAssistance(pool,actorId,p.id,p.key,p.reason);break;
    }
    case "BULK_RETRY":{
     const p=z.object({id,key,reason}).strict().parse(payload);result=await retryCurrentBulk(pool,actorId,p,bulk);break;
    }
   }
   res.json(ActOnCurrentFinanceResponse.parse(result!));
  }catch(e){currentFinanceError(res,e);}
 });
 return router;
}
export default createCurrentFinanceRouter();
