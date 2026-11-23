import {Router} from "express";
import {pool as appPool} from "@workspace/db";
import {requireAuthentication,assertRoles} from "../middlewares/auth";
import {GetFieldSmsCampaignsResponse,PreviewFieldSmsCampaignBody,PreviewFieldSmsCampaignResponse,
 RecordFieldSmsPermissionBody,RecordFieldSmsPermissionResponse,DispatchFieldSmsCampaignBody,
 DispatchFieldSmsCampaignParams,DispatchFieldSmsCampaignResponse} from "@workspace/api-zod";
import {readFieldSms,previewFieldSms,recordFieldPermission,dispatchFieldSms,type FieldSmsDependencies} from "../services/bro-field-sms";
import type {CurrentPool} from "../services/current-financial-contract";
import {currentFinanceError} from "./current-finance";
export function createFieldSmsRouter(pool:CurrentPool=appPool,deps:FieldSmsDependencies={}){
 const router=Router();
 router.use("/bro-field/sms",requireAuthentication(),(req,res,next)=>{
  res.setHeader("Cache-Control","no-store");
  try{res.locals.fieldSmsActorId=assertRoles(req,["PLATFORM_OWNER"]).user.id;next();}
  catch(e){currentFinanceError(res,e);}
 });
 router.get("/bro-field/sms",async(_req,res)=>{
  try{res.json(GetFieldSmsCampaignsResponse.parse(await readFieldSms(pool,res.locals.fieldSmsActorId,deps)));}
  catch(e){currentFinanceError(res,e);}
 });
 router.post("/bro-field/sms/permission",async(req,res)=>{
  try{const b=RecordFieldSmsPermissionBody.parse(req.body);
   res.json(RecordFieldSmsPermissionResponse.parse(await recordFieldPermission(pool,res.locals.fieldSmsActorId,b.leadId,b.allowed,b.reason)));}
  catch(e){currentFinanceError(res,e);}
 });
 router.post("/bro-field/sms/preview",async(req,res)=>{
  try{res.json(PreviewFieldSmsCampaignResponse.parse(await previewFieldSms(pool,res.locals.fieldSmsActorId,PreviewFieldSmsCampaignBody.parse(req.body))));}
  catch(e){currentFinanceError(res,e);}
 });
 router.post("/bro-field/sms/:id/dispatch",async(req,res)=>{
  try{const p=DispatchFieldSmsCampaignParams.parse(req.params),b=DispatchFieldSmsCampaignBody.parse(req.body);
   res.json(DispatchFieldSmsCampaignResponse.parse(await dispatchFieldSms(pool,res.locals.fieldSmsActorId,p.id,b.digest,b.confirm,deps)));}
  catch(e){currentFinanceError(res,e);}
 });
 return router;
}
export default createFieldSmsRouter();
